import { getContentBundle } from '../../../content'
import type { CoreValueCode, GameMode, PinballRunEvent, RunEndReason } from '../../domain/types'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export const PINBALL_WIDTH = 480
export const PINBALL_HEIGHT = 420
export const FIXED_DT_MS = 1000 / 120 // 8.333ms fixed physics timestep

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
}

export interface PinballSnapshot {
  isPractice: boolean
  activeDurationMs: number
  maxDurationMs: number
  ballId: number
  ballsRemaining: number
  ballWaitingLaunch: boolean
  ballX: number
  ballY: number
  ballVx: number
  ballVy: number
  ballRadius: number
  bumpers: readonly BumperNode[]
  leftFlipper: FlipperState
  rightFlipper: FlipperState
  currentSetLetters: CoreValueCode[]
  missingLetters: CoreValueCode[]
  highlightedFinalLetter: CoreValueCode | null
  completedSets: number
  validHits: number
  score: number
  justCompletedSetFlash: boolean
  finished: boolean
  endReason: RunEndReason | null
}

const CORE_LETTERS: readonly CoreValueCode[] = ['C', 'O', 'R', 'E']

/**
 * C.O.R.E. 핀볼 고정 시간 간격(120Hz) 물리 시뮬레이션 엔진
 * - 좌·우 방향키로 각 플리퍼 구동(누르면 상승, 놓으면 하강), Space로 발사
 * - 공이 범퍼에서 분리된 뒤 재접촉하고 같은 범퍼 직전 득점과 300ms 이상 차이 시 +100점
 * - 공을 잃어도 현재 세트의 글자는 유지되며, 1글자만 남으면 해당 범퍼와 추천 플리퍼 경로를 점등
 * - 4글자 완성 시 +500점 세트 보너스 후 글자를 비우고 남은 공·시간으로 계속 도전
 */
export class PinballSimulation {
  readonly mode: GameMode
  readonly isPractice: boolean
  readonly maxDurationMs: number
  readonly ballRadius = 9
  readonly bumpers: readonly BumperNode[]

  private activeDurationMs = 0
  private physicsAccumMs = 0
  private ballId = 1
  private ballsLost = 0
  private ballWaitingLaunch = true
  private ballX = PINBALL_WIDTH - 28
  private ballY = PINBALL_HEIGHT - 54
  private ballVx = 0
  private ballVy = 0

  private leftFlipper: FlipperState
  private rightFlipper: FlipperState

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
  }) {
    this.mode = params.mode
    this.isPractice = Boolean(params.isPractice)
    this.maxDurationMs = this.isPractice
      ? 30_000
      : params.mode === 'assisted'
        ? 125_000
        : 100_000

    const bundle = getContentBundle(params.contentVersion)
    const shortName = (code: CoreValueCode) => {
      const cfg = bundle.pinballBumpers.find((b) => b.letter === code)!
      const rec = bundle.records[cfg.recordId]!
      return rec.display_ko.split('(')[0]!.trim()
    }

    // Placed along deliberate flipper shot lanes (Left flipper -> R/E cross-court & O; Right flipper -> C/O cross-court & R)
    this.bumpers = [
      { letter: 'C', labelKo: shortName('C'), x: 118, y: 132, radius: 26, preferredFlipper: 'right' },
      { letter: 'O', labelKo: shortName('O'), x: 196, y: 88, radius: 26, preferredFlipper: 'left' },
      { letter: 'R', labelKo: shortName('R'), x: 284, y: 88, radius: 26, preferredFlipper: 'right' },
      { letter: 'E', labelKo: shortName('E'), x: 362, y: 132, radius: 26, preferredFlipper: 'left' },
    ]

    // Assisted mode increases flipper effective length to 115%!
    const baseLen = 84
    const flipperLen = params.mode === 'assisted' ? Math.round(baseLen * 1.15) : baseLen

    this.leftFlipper = {
      side: 'left',
      pivotX: 132,
      pivotY: 366,
      length: flipperLen,
      angleRad: 0.42, // downward rest
      angularVel: 0,
      pressed: false,
    }
    this.rightFlipper = {
      side: 'right',
      pivotX: 348,
      pivotY: 366,
      length: flipperLen,
      angleRad: Math.PI - 0.42,
      angularVel: 0,
      pressed: false,
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
    if (side === 'left') {
      this.leftFlipper.pressed = pressed
    } else {
      this.rightFlipper.pressed = pressed
    }
  }

  launchBall(): boolean {
    if (this.finished || !this.ballWaitingLaunch) return false
    this.ballWaitingLaunch = false
    this.ballX = PINBALL_WIDTH - 28
    this.ballY = PINBALL_HEIGHT - 64
    // Launches up and arcs cleanly into the upper bumper field
    this.ballVx = -165
    this.ballVy = -450
    return true
  }

  /**
   * 테스트 및 의도적 조준 검증용: 지정 범퍼 방향으로 플리퍼 샷 궤적을 발사한다.
   */
  aimBallTowardBumper(targetLetter: CoreValueCode): void {
    const target = this.bumpers.find((b) => b.letter === targetLetter)!
    this.ballWaitingLaunch = false
    const fromLeft = target.preferredFlipper === 'left'
    this.ballX = fromLeft ? 175 : 305
    this.ballY = 340
    const dx = target.x - this.ballX
    const dy = target.y - this.ballY
    const flightSec = 0.42
    // Ballistic velocity compensating gravity (360 px/s^2) so the shot lands dead-center on target
    this.ballVx = dx / flightSec
    this.ballVy = (dy - 0.5 * 360 * flightSec * flightSec) / flightSec
  }

  dropBallBetweenFlippers(): void {
    this.ballWaitingLaunch = false
    this.ballX = PINBALL_WIDTH / 2
    this.ballY = 388
    this.ballVx = 0
    this.ballVy = 260
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

    if (this.activeDurationMs >= this.maxDurationMs) {
      this.finished = true
      this.endReason = 'time_up'
      return
    }

    // Update flipper angles (press -> up, release -> down)
    const updateFlipper = (f: FlipperState) => {
      const restAngle = f.side === 'left' ? 0.42 : Math.PI - 0.42
      const upAngle = f.side === 'left' ? -0.46 : Math.PI + 0.46
      const target = f.pressed ? upAngle : restAngle
      const prev = f.angleRad
      const rate = 15 * dtSec
      if (Math.abs(target - prev) <= rate) {
        f.angleRad = target
      } else {
        f.angleRad += Math.sign(target - prev) * rate
      }
      f.angularVel = (f.angleRad - prev) / dtSec
    }
    updateFlipper(this.leftFlipper)
    updateFlipper(this.rightFlipper)

    if (this.ballWaitingLaunch) {
      return
    }

    // Gravity + integrate ball
    const gravity = 360
    this.ballVy += gravity * dtSec
    this.ballX += this.ballVx * dtSec
    this.ballY += this.ballVy * dtSec

    // Playfield walls & angled slingshot rails
    const leftWall = 20
    const rightWall = PINBALL_WIDTH - 20
    const topWall = 20

    if (this.ballX - this.ballRadius < leftWall) {
      this.ballX = leftWall + this.ballRadius
      this.ballVx = Math.abs(this.ballVx) * 0.88
    } else if (this.ballX + this.ballRadius > rightWall) {
      this.ballX = rightWall - this.ballRadius
      this.ballVx = -Math.abs(this.ballVx) * 0.88
    }
    if (this.ballY - this.ballRadius < topWall) {
      this.ballY = topWall + this.ballRadius
      this.ballVy = Math.abs(this.ballVy) * 0.88
    }

    // Angled side inlanes guiding ball onto left & right flippers
    this.collideSegment(20, 275, 132, 366, 0.75, 0)
    this.collideSegment(PINBALL_WIDTH - 20, 275, 348, 366, 0.75, 0)

    // Flipper segment collisions (impulse boosted when flipper is actively swinging up!)
    this.collideFlipper(this.leftFlipper)
    this.collideFlipper(this.rightFlipper)

    // 4 C.O.R.E. Bumper collisions with separation + 300ms cooldown rule
    for (const bumper of this.bumpers) {
      const dx = this.ballX - bumper.x
      const dy = this.ballY - bumper.y
      const dist = Math.hypot(dx, dy)
      const minDist = this.ballRadius + bumper.radius

      if (dist <= minDist) {
        const nx = dist > 0.001 ? dx / dist : 0
        const ny = dist > 0.001 ? dy / dist : -1
        this.ballX = bumper.x + nx * (minDist + 1)
        this.ballY = bumper.y + ny * (minDist + 1)

        // Lively arcade bumper kick
        const bounceSpeed = Math.max(290, Math.hypot(this.ballVx, this.ballVy) * 0.96)
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
              this.setFlashRemainingMs = 1_400
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

    // Clamp max ball speed for stability
    const speed = Math.hypot(this.ballVx, this.ballVy)
    if (speed > 660) {
      this.ballVx = (this.ballVx / speed) * 660
      this.ballVy = (this.ballVy / speed) * 660
    }

    // Ball drain below flippers
    if (this.ballY - this.ballRadius > PINBALL_HEIGHT + 8) {
      if (this.isPractice) {
        this.ballWaitingLaunch = true
        this.ballX = PINBALL_WIDTH - 28
        this.ballY = PINBALL_HEIGHT - 54
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
        // Note: currentSet letters remain preserved on snapshot!
        this.finished = true
        this.endReason = 'balls_exhausted'
        return
      }
      this.ballId += 1
      this.ballWaitingLaunch = true
      this.ballX = PINBALL_WIDTH - 28
      this.ballY = PINBALL_HEIGHT - 54
      this.ballVx = 0
      this.ballVy = 0
    }
  }

  private collideFlipper(f: FlipperState): void {
    const tipX = f.pivotX + Math.cos(f.angleRad) * f.length
    const tipY = f.pivotY + Math.sin(f.angleRad) * f.length
    const swingingUp =
      (f.side === 'left' && f.angularVel < -0.5) ||
      (f.side === 'right' && f.angularVel > 0.5)
    this.collideSegment(
      f.pivotX,
      f.pivotY,
      tipX,
      tipY,
      0.86,
      swingingUp ? 390 : 40,
    )
  }

  private collideSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    restitution: number,
    upwardKick: number,
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
    const thickness = 5
    const minDist = this.ballRadius + thickness

    if (dist < minDist) {
      const nx = dist > 0.001 ? dx / dist : 0
      const ny = dist > 0.001 ? dy / dist : -1
      this.ballX = closestX + nx * (minDist + 0.5)
      this.ballY = closestY + ny * (minDist + 0.5)

      const dot = this.ballVx * nx + this.ballVy * ny
      if (dot < 0) {
        this.ballVx -= (1 + restitution) * dot * nx
        this.ballVy -= (1 + restitution) * dot * ny
      }
      if (upwardKick > 0) {
        // Angle shot based on contact position t along flipper [0=pivot .. 1=tip]
        const aimAngle = -Math.PI / 2 + (t - 0.5) * 0.72 * (x2 > x1 ? 1 : -1)
        this.ballVx = Math.cos(aimAngle) * upwardKick
        this.ballVy = Math.sin(aimAngle) * upwardKick
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

    return {
      isPractice: this.isPractice,
      activeDurationMs: this.activeDurationMs,
      maxDurationMs: this.maxDurationMs,
      ballId: this.ballId,
      ballsRemaining: Math.max(0, 3 - this.ballsLost),
      ballWaitingLaunch: this.ballWaitingLaunch,
      ballX: this.ballX,
      ballY: this.ballY,
      ballVx: this.ballVx,
      ballVy: this.ballVy,
      ballRadius: this.ballRadius,
      bumpers: this.bumpers,
      leftFlipper: { ...this.leftFlipper },
      rightFlipper: { ...this.rightFlipper },
      currentSetLetters,
      missingLetters,
      highlightedFinalLetter,
      completedSets: this.completedSets,
      validHits: this.validHits,
      score: this.validHits * 100 + this.completedSets * 500,
      justCompletedSetFlash: this.setFlashRemainingMs > 0,
      finished: this.finished,
      endReason: this.endReason,
    }
  }
}
