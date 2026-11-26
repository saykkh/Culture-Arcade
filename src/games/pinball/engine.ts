import { getContentBundle } from '../../../content/index.js'
import { BASE_ACTION_POINTS, PASSING_SCORE } from '../../domain/rules.js'
import type { CoreValueCode, GameMode, PinballRunEvent, RunEndReason } from '../../domain/types.js'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export const PINBALL_WIDTH = 540
export const PINBALL_HEIGHT = 450
export const FIXED_DT_MS = 1000 / 120
const CHUTE_DIVIDER_X = 488

export interface BumperNode {
  letter: CoreValueCode
  labelKo: string
  x: number
  y: number
  radius: number
  preferredFlipper: 'left' | 'right'
}

export interface FlipperState {
  side: 'left' | 'right'
  pivotX: number
  pivotY: number
  length: number
  angleRad: number
  angularVel: number
  pressed: boolean
  swingBoostMs: number
}

export interface PinballSnapshot {
  isPractice: boolean
  activeDurationMs: number
  maxDurationMs: number
  ballId: number
  ballsRemaining: number
  ballWaitingLaunch: boolean
  inLaunchChute: boolean
  ballX: number
  ballY: number
  ballVx: number
  ballVy: number
  ballRadius: number
  bumpers: readonly BumperNode[]
  leftFlipper: FlipperState
  rightFlipper: FlipperState
  centerPostReady: boolean
  currentSetLetters: CoreValueCode[]
  missingLetters: CoreValueCode[]
  highlightedFinalLetter: CoreValueCode | null
  completedSets: number
  validHits: number
  score: number
  cleared: boolean
  justCompletedSetFlash: boolean
  finished: boolean
  endReason: RunEndReason | null
}

const CORE_LETTERS: readonly CoreValueCode[] = ['C', 'O', 'R', 'E']

/**
 * C.O.R.E. 핀볼 120Hz 물리 시뮬레이션 엔진 (개선본)
 * - 우측 전용 발사 슈트(x=488..524) + 상단 곡선 디플렉터를 통해 발사 즉시 상단 범퍼 구역으로 시원하게 진입
 * - 플리퍼 타격 시 스윙 부스트(260ms) 및 홀드 반발력을 모두 적용해 공이 확실히 상단 범퍼까지 솟구침
 * - 중앙 세이브 포스트(쿨타임 2초)로 억울한 중앙 직하강 유실 완화
 * - 배점: 유효 범퍼 명중 +2점, C·O·R·E 1세트 완성 보너스 +4점 (10점 이상 통과 후 고득점 경쟁)
 */
export class PinballSimulation {
  readonly mode: GameMode
  readonly isPractice: boolean
  readonly maxDurationMs: number
  readonly ballRadius = 9.5
  readonly bumpers: readonly BumperNode[]

  private activeDurationMs = 0
  private physicsAccumMs = 0
  private ballId = 1
  private ballsLost = 0
  private ballWaitingLaunch = true
  private inLaunchChute = true
  private autoLaunchDelayMs = 350
  private ballX = 506
  private ballY = PINBALL_HEIGHT - 46
  private ballVx = 0
  private ballVy = 0

  private leftFlipper: FlipperState
  private rightFlipper: FlipperState
  private centerPostCooldownMs = 0

  private readonly touchingBumpers = new Set<CoreValueCode>()
  private readonly separatedSinceHit: Record<CoreValueCode, boolean> = {
    C: true,
    O: true,
    R: true,
    E: true,
  }
  private readonly lastScoredMs: Partial<Record<CoreValueCode, number>> = {}
  private readonly currentSet = new Set<CoreValueCode>()

  private validHits = 0
  private completedSets = 0
  private setFlashRemainingMs = 0
  private finished = false
  private endReason: RunEndReason | null = null
  private seq = 0
  private readonly events: PinballRunEvent[] = []

  constructor(params: {
    mode: GameMode
    contentVersion: string
    isPractice?: boolean
    disableAutoLaunch?: boolean
  }) {
    this.mode = params.mode
    this.isPractice = Boolean(params.isPractice)
    this.maxDurationMs = this.isPractice
      ? 30_000
      : params.mode === 'assisted'
        ? 125_000
        : 100_000
    if (params.disableAutoLaunch) {
      this.autoLaunchDelayMs = -1
    }

    const bundle = getContentBundle(params.contentVersion)
    const shortName = (code: CoreValueCode) => {
      const cfg = bundle.pinballBumpers.find((b) => b.letter === code)!
      const rec = bundle.records[cfg.recordId]!
      return rec.display_ko.split('(')[0]!.trim()
    }

    // Positioned inside main playfield [20 .. 488]
    this.bumpers = [
      { letter: 'C', labelKo: shortName('C'), x: 118, y: 142, radius: 28, preferredFlipper: 'right' },
      { letter: 'O', labelKo: shortName('O'), x: 204, y: 94, radius: 28, preferredFlipper: 'left' },
      { letter: 'R', labelKo: shortName('R'), x: 304, y: 94, radius: 28, preferredFlipper: 'right' },
      { letter: 'E', labelKo: shortName('E'), x: 390, y: 142, radius: 28, preferredFlipper: 'left' },
    ]

    const baseLen = 102
    const flipperLen = params.mode === 'assisted' ? Math.round(baseLen * 1.15) : baseLen

    this.leftFlipper = {
      side: 'left',
      pivotX: 128,
      pivotY: 392,
      length: flipperLen,
      angleRad: 0.38,
      angularVel: 0,
      pressed: false,
      swingBoostMs: 0,
    }
    this.rightFlipper = {
      side: 'right',
      pivotX: 380,
      pivotY: 392,
      length: flipperLen,
      angleRad: Math.PI - 0.38,
      angularVel: 0,
      pressed: false,
      swingBoostMs: 0,
    }
  }

  private pushEvent(ev: DistributiveOmit<PinballRunEvent, 'seq' | 't_ms'>): void {
    if (this.isPractice) return
    this.seq += 1
    this.events.push({
      ...ev,
      seq: this.seq,
      t_ms: Math.round(this.activeDurationMs),
    } as PinballRunEvent)
  }

  setFlipperPressed(side: 'left' | 'right', pressed: boolean): void {
    const f = side === 'left' ? this.leftFlipper : this.rightFlipper
    if (pressed && !f.pressed) {
      f.swingBoostMs = 260
    }
    f.pressed = pressed
  }

  launchBall(): boolean {
    if (this.finished || !this.ballWaitingLaunch) return false
    this.ballWaitingLaunch = false
    this.inLaunchChute = true
    this.ballX = 506
    this.ballY = PINBALL_HEIGHT - 52
    // Strong upward launch straight up the dedicated right chute!
    this.ballVx = -8
    this.ballVy = -650
    return true
  }

  aimBallTowardBumper(targetLetter: CoreValueCode): void {
    const target = this.bumpers.find((b) => b.letter === targetLetter)!
    this.ballWaitingLaunch = false
    this.inLaunchChute = false
    const fromLeft = target.preferredFlipper === 'left'
    this.ballX = fromLeft ? 178 : 330
    this.ballY = 360
    const dx = target.x - this.ballX
    const dy = target.y - this.ballY
    const flightSec = 0.42
    this.ballVx = dx / flightSec
    this.ballVy = (dy - 0.5 * 330 * flightSec * flightSec) / flightSec
  }

  dropBallBetweenFlippers(): void {
    this.ballWaitingLaunch = false
    this.inLaunchChute = false
    this.centerPostCooldownMs = 5_000 // disable center save post for deterministic drain test
    this.ballX = 254
    this.ballY = 418
    this.ballVx = 0
    this.ballVy = 280
  }

  step(dtMs: number): PinballSnapshot {
    if (this.finished || dtMs <= 0) {
      return this.getSnapshot()
    }

    const clampedDt = Math.min(100, dtMs)
    this.physicsAccumMs += clampedDt

    while (this.physicsAccumMs >= FIXED_DT_MS && !this.finished) {
      this.physicsAccumMs -= FIXED_DT_MS
      this.stepFixed(FIXED_DT_MS)
    }

    return this.getSnapshot()
  }

  private stepFixed(dtMs: number): void {
    const dtSec = dtMs / 1000
    this.activeDurationMs += dtMs
    if (this.setFlashRemainingMs > 0) {
      this.setFlashRemainingMs = Math.max(0, this.setFlashRemainingMs - dtMs)
    }
    if (this.centerPostCooldownMs > 0) {
      this.centerPostCooldownMs = Math.max(0, this.centerPostCooldownMs - dtMs)
    }

    if (this.activeDurationMs >= this.maxDurationMs) {
      this.finished = true
      this.endReason = 'time_up'
      return
    }

    // Update flipper angles & swing boost timers
    const updateFlipper = (f: FlipperState) => {
      if (f.swingBoostMs > 0) {
        f.swingBoostMs = Math.max(0, f.swingBoostMs - dtMs)
      }
      const restAngle = f.side === 'left' ? 0.38 : Math.PI - 0.38
      const upAngle = f.side === 'left' ? -0.48 : Math.PI + 0.48
      const target = f.pressed ? upAngle : restAngle
      const prev = f.angleRad
      const rate = 18 * dtSec
      if (Math.abs(target - prev) <= rate) {
        f.angleRad = target
      } else {
        f.angleRad += Math.sign(target - prev) * rate
      }
      f.angularVel = (f.angleRad - prev) / dtSec
    }
    updateFlipper(this.leftFlipper)
    updateFlipper(this.rightFlipper)

    // Auto-launch ball 1 shortly after round starts so players see the ball fly up immediately!
    if (this.ballWaitingLaunch) {
      if (this.autoLaunchDelayMs >= 0) {
        this.autoLaunchDelayMs -= dtMs
        if (this.autoLaunchDelayMs <= 0) {
          this.launchBall()
        }
      }
      return
    }

    // Slightly lighter arcade gravity (330 px/s^2) for floaty, satisfying bumper combos
    const gravity = 330
    this.ballVy += gravity * dtSec
    this.ballX += this.ballVx * dtSec
    this.ballY += this.ballVy * dtSec

    const leftWall = 20
    const outerRightWall = PINBALL_WIDTH - 16
    const topWall = 20

    if (this.inLaunchChute) {
      // Inside right launch chute [488 .. 524]: guide straight up and deflect left at top!
      if (this.ballX + this.ballRadius > outerRightWall) {
        this.ballX = outerRightWall - this.ballRadius
        this.ballVx = -Math.abs(this.ballVx) * 0.8
      }
      if (this.ballY > 105 && this.ballX - this.ballRadius < CHUTE_DIVIDER_X) {
        this.ballX = CHUTE_DIVIDER_X + this.ballRadius
        this.ballVx = Math.abs(this.ballVx) * 0.5
      }
      // Angled top deflector roof sends ball cleanly into upper bumper field!
      if (this.ballY - this.ballRadius <= 44) {
        this.ballY = 44 + this.ballRadius
        this.ballVx = -310 - (this.ballId % 3) * 25
        this.ballVy = 55
      }
      if (this.ballX < CHUTE_DIVIDER_X - this.ballRadius - 2) {
        this.inLaunchChute = false
      }
      return
    }

    // Main Playfield Walls [20 .. 488] (one-way gate keeps ball out of launch chute!)
    if (this.ballX - this.ballRadius < leftWall) {
      this.ballX = leftWall + this.ballRadius
      this.ballVx = Math.abs(this.ballVx) * 0.9 + 25
    } else if (this.ballX + this.ballRadius > CHUTE_DIVIDER_X) {
      this.ballX = CHUTE_DIVIDER_X - this.ballRadius
      this.ballVx = -Math.abs(this.ballVx) * 0.9 - 25
    }
    if (this.ballY - this.ballRadius < topWall) {
      this.ballY = topWall + this.ballRadius
      this.ballVy = Math.abs(this.ballVy) * 0.9 + 20
    }

    // Side Slingshot Inlanes feeding cleanly onto Left (128,392) & Right (380,392) Flippers
    this.collideSegment(20, 286, 128, 392, 0.82, 0)
    this.collideSegment(CHUTE_DIVIDER_X, 286, 380, 392, 0.82, 0)

    // Center Save Post at (254, 412) bounces dead-center drops back into play!
    if (this.centerPostCooldownMs <= 0) {
      const pdx = this.ballX - 254
      const pdy = this.ballY - 412
      const pdist = Math.hypot(pdx, pdy)
      const pMin = this.ballRadius + 10
      if (pdist <= pMin) {
        const nx = pdist > 0.001 ? pdx / pdist : 0.15
        this.ballX = 254 + nx * (pMin + 1)
        this.ballY = 412 - (pMin + 1)
        this.ballVx = nx * 160 + (this.ballVx >= 0 ? 65 : -65)
        this.ballVy = -430
        this.centerPostCooldownMs = 2_200
      }
    }

    // Flipper Collisions (strong upward rebound both during swing AND while held!)
    this.collideFlipper(this.leftFlipper)
    this.collideFlipper(this.rightFlipper)

    // 4 C.O.R.E. Bumpers
    for (const bumper of this.bumpers) {
      const dx = this.ballX - bumper.x
      const dy = this.ballY - bumper.y
      const dist = Math.hypot(dx, dy)
      const minDist = this.ballRadius + bumper.radius

      if (dist <= minDist) {
        const nx = dist > 0.001 ? dx / dist : 0
        const ny = dist > 0.001 ? dy / dist : -1
        this.ballX = bumper.x + nx * (minDist + 1.5)
        this.ballY = bumper.y + ny * (minDist + 1.5)

        const bounceSpeed = Math.max(330, Math.hypot(this.ballVx, this.ballVy) * 0.98)
        this.ballVx = nx * bounceSpeed
        this.ballVy = ny * bounceSpeed

        if (!this.touchingBumpers.has(bumper.letter)) {
          this.touchingBumpers.add(bumper.letter)
          const wasSeparated = this.separatedSinceHit[bumper.letter]
          const prevHitMs = this.lastScoredMs[bumper.letter]
          const cooldownOk =
            prevHitMs === undefined || this.activeDurationMs - prevHitMs >= 300

          if (wasSeparated && cooldownOk) {
            this.separatedSinceHit[bumper.letter] = false
            this.lastScoredMs[bumper.letter] = this.activeDurationMs
            this.validHits += 1
            this.currentSet.add(bumper.letter)

            this.pushEvent({
              type: 'bumper_hit',
              ballId: this.ballId,
              letter: bumper.letter,
              separatedSinceLastHit: true,
            })

            if (this.currentSet.size === 4) {
              this.completedSets += 1
              this.currentSet.clear()
              this.setFlashRemainingMs = 1_500
            }
          }
        }
      } else if (dist > minDist + 5) {
        if (this.touchingBumpers.has(bumper.letter)) {
          this.touchingBumpers.delete(bumper.letter)
        }
        this.separatedSinceHit[bumper.letter] = true
      }
    }

    const speed = Math.hypot(this.ballVx, this.ballVy)
    if (speed > 700) {
      this.ballVx = (this.ballVx / speed) * 700
      this.ballVy = (this.ballVy / speed) * 700
    }

    // Drain check below flippers
    if (this.ballY - this.ballRadius > PINBALL_HEIGHT + 10) {
      if (this.isPractice) {
        this.ballWaitingLaunch = true
        this.inLaunchChute = true
        this.autoLaunchDelayMs = 300
        this.ballX = 506
        this.ballY = PINBALL_HEIGHT - 46
        this.ballVx = 0
        this.ballVy = 0
        return
      }

      this.pushEvent({
        type: 'ball_lost',
        ballId: this.ballId,
      })
      this.ballsLost += 1
      if (this.ballsLost >= 3) {
        this.finished = true
        this.endReason = 'balls_exhausted'
        return
      }
      this.ballId += 1
      this.ballWaitingLaunch = true
      this.inLaunchChute = true
      this.autoLaunchDelayMs = -1 // let user press Space or click Launch for next ball
      this.ballX = 506
      this.ballY = PINBALL_HEIGHT - 46
      this.ballVx = 0
      this.ballVy = 0
    }
  }

  private collideFlipper(f: FlipperState): void {
    const tipX = f.pivotX + Math.cos(f.angleRad) * f.length
    const tipY = f.pivotY + Math.sin(f.angleRad) * f.length
    const isSwinging = f.swingBoostMs > 0 || Math.abs(f.angularVel) > 0.4
    const kickSpeed = isSwinging ? 560 : f.pressed ? 480 : 350
    this.collideSegment(f.pivotX, f.pivotY, tipX, tipY, 0.9, kickSpeed, f.side)
  }

  private collideSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    restitution: number,
    upwardKick: number,
    flipperSide?: 'left' | 'right',
  ): void {
    const segDx = x2 - x1
    const segDy = y2 - y1
    const segLenSq = segDx * segDx + segDy * segDy
    if (segLenSq < 0.001) return

    const t = Math.max(
      0,
      Math.min(1, ((this.ballX - x1) * segDx + (this.ballY - y1) * segDy) / segLenSq),
    )
    const closestX = x1 + t * segDx
    const closestY = y1 + t * segDy
    const dx = this.ballX - closestX
    const dy = this.ballY - closestY
    const dist = Math.hypot(dx, dy)
    const thickness = flipperSide ? 7 : 5
    const minDist = this.ballRadius + thickness

    if (dist < minDist) {
      let nx = dist > 0.001 ? dx / dist : 0
      let ny = dist > 0.001 ? dy / dist : -1
      // For flippers, always push ball onto the TOP side of the flipper so it never clips downward!
      if (flipperSide && ny > -0.15) {
        ny = -0.85
        nx = flipperSide === 'left' ? 0.35 : -0.35
      }
      this.ballX = closestX + nx * (minDist + 1)
      this.ballY = closestY + ny * (minDist + 1)

      if (upwardKick > 0 && flipperSide) {
        // Aim trajectory across upper bumper field based on contact t [0=pivot .. 1=tip]
        const dirSign = flipperSide === 'left' ? 1 : -1
        const spread = (t - 0.45) * 0.78 * dirSign
        const aimAngle = -Math.PI / 2 + spread
        this.ballVx = Math.cos(aimAngle) * upwardKick
        this.ballVy = Math.min(-360, Math.sin(aimAngle) * upwardKick)
        return
      }

      const dot = this.ballVx * nx + this.ballVy * ny
      if (dot < 0) {
        this.ballVx -= (1 + restitution) * dot * nx
        this.ballVy -= (1 + restitution) * dot * ny
      }
    }
  }

  getEvents(): PinballRunEvent[] {
    return [...this.events]
  }

  getSnapshot(): PinballSnapshot {
    const currentSetLetters = CORE_LETTERS.filter((c) => this.currentSet.has(c))
    const missingLetters = CORE_LETTERS.filter((c) => !this.currentSet.has(c))
    const highlightedFinalLetter = this.isPractice
      ? 'O'
      : missingLetters.length === 1
        ? missingLetters[0]!
        : null
    const score = this.validHits * BASE_ACTION_POINTS + this.completedSets * 4

    return {
      isPractice: this.isPractice,
      activeDurationMs: this.activeDurationMs,
      maxDurationMs: this.maxDurationMs,
      ballId: this.ballId,
      ballsRemaining: Math.max(0, 3 - this.ballsLost),
      ballWaitingLaunch: this.ballWaitingLaunch,
      inLaunchChute: this.inLaunchChute,
      ballX: this.ballX,
      ballY: this.ballY,
      ballVx: this.ballVx,
      ballVy: this.ballVy,
      ballRadius: this.ballRadius,
      bumpers: this.bumpers,
      leftFlipper: { ...this.leftFlipper },
      rightFlipper: { ...this.rightFlipper },
      centerPostReady: this.centerPostCooldownMs <= 0,
      currentSetLetters,
      missingLetters,
      highlightedFinalLetter,
      completedSets: this.completedSets,
      validHits: this.validHits,
      score,
      cleared: score >= PASSING_SCORE,
      justCompletedSetFlash: this.setFlashRemainingMs > 0,
      finished: this.finished,
      endReason: this.endReason,
    }
  }
}
