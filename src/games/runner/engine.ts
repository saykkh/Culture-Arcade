import { getContentBundle, mulberry32, seededShuffle } from '../../../content/index.js'
import { BASE_ACTION_POINTS, PASSING_SCORE } from '../../domain/rules.js'
import type {
  CoreValueCode,
  GameMode,
  RunEndReason,
  RunnerBonusKind,
  RunnerHazardKind,
  RunnerRunEvent,
} from '../../domain/types.js'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type LaneIndex = 0 | 1 | 2

export interface TrackBoosterPad {
  kind: 'booster'
  id: string
  z: number
  lane: LaneIndex
  letter: CoreValueCode
  shortLabel: string
  fullLabel: string
  triggered: boolean
}

export interface TrackBonusDevice {
  kind: 'bonus'
  id: string
  z: number
  lane: LaneIndex
  bonusKind: RunnerBonusKind
  triggered: boolean
}

export interface TrackHazardDevice {
  kind: 'hazard'
  id: string
  z: number
  lane: LaneIndex
  hazardKind: RunnerHazardKind
  triggered: boolean
  clearedByJump: boolean
  blockedByShield: boolean
}

export type TrackEntity = TrackBoosterPad | TrackBonusDevice | TrackHazardDevice

export interface RunnerSnapshot {
  elapsedMs: number
  remainingMs: number
  distance: number
  trackLength: number
  lane: LaneIndex
  visualLane: number
  jumpHeight: number
  jumpRemainingMs: number
  isSuperJump: boolean
  hasShield: boolean
  speedMultiplier: number
  hyperRemainMs: number
  boostRemainMs: number
  slipRemainMs: number
  sludgeRemainMs: number
  stunRemainMs: number
  score: number
  cleared: boolean
  boostCount: number
  bonusItemCount: number
  hazardHitCount: number
  stunStopCount: number
  shieldBlockedCount: number
  jumpedHazardCount: number
  completedCoreSets: number
  currentSetLetters: CoreValueCode[]
  statusBanner: {
    tone: 'boost' | 'super' | 'shield' | 'slip' | 'stun' | 'jump' | 'neutral'
    text: string
  }
  entities: TrackEntity[]
  finished: boolean
  practiceCleared: boolean
}

export interface StepEffects {
  boostedLetter: CoreValueCode | null
  completedCoreSet: boolean
  collectedBonus: RunnerBonusKind | null
  slippedOrSludged: 'banana' | 'sludge' | null
  stunnedBy: 'barricade' | 'emp_shock' | null
  shieldBlocked: RunnerHazardKind | null
  jumpedHazard: boolean
  practiceJustCleared: boolean
  finishedReason: RunEndReason | null
}

const CORE_ORDER: readonly CoreValueCode[] = ['C', 'O', 'R', 'E'] as const

export const RUNNER_TRACK_LENGTH = 6_200
const NORMAL_JUMP_MS = 640
const SUPER_JUMP_MS = 920
const BOOST_DURATION_MS = 1_500
const HYPER_DURATION_MS = 1_850
const BANANA_SLIP_MS = 1_100
const SLUDGE_SLOW_MS = 1_650
const BARRICADE_STUN_MS = 460
const EMP_SHOCK_STUN_MS = 700

/**
 * 8종 다양한 기믹 트랙 생성기 (시드 기반 결정론적 배치):
 * 1) ⚡ 핵심가치 발판 (C·O·R·E, +2점·155% 가속)
 * 2) 🚀 초전도 하이퍼 링 (hyper_ring, +3점·195% 초고속 질주)
 * 3) 🛡️ 절연 보호 실드 (shield, +1점·다음 방해물 1회 완전 무효화)
 * 4) 🔼 스프링 점프대 (jump_ramp, +1점·자동 1.4배 고공 슈퍼점프)
 * 5) 🍌 바나나 껍질 (banana, −1점·55% 미끄러짐 감속 · 점프 가능)
 * 6) 🟣 점착 타르 늪 (sludge, −1점·35% 거북이 중감속 · 점프 가능)
 * 7) 🚧 공사 바리케이드 (barricade, −1점·0.46초 충돌 멈칫 정지 · 점프 가능)
 * 8) ⚡ 과전류 쇼크 게이트 (emp_shock, −2점·0.7초 감전 완전 정지 · 차선이동/슈퍼점프/실드로 돌파!)
 */
export function buildRunnerTrack(params: {
  seed: number
  contentVersion: string
}): TrackEntity[] {
  const bundle = getContentBundle(params.contentVersion)
  const padMetaByLetter = new Map(
    bundle.runnerPads.map((p) => {
      const rec = bundle.records[p.recordId]
      return [
        p.letter,
        {
          shortLabel: p.shortLabel,
          fullLabel: rec?.display_ko ?? p.shortLabel,
        },
      ]
    }),
  )

  const rng = mulberry32(params.seed ^ 0x6c8e9cf5)
  const entities: TrackEntity[] = []

  const letters: CoreValueCode[] = []
  for (let s = 0; s < 9; s += 1) {
    const chunk = seededShuffle(CORE_ORDER, (params.seed + s * 977) >>> 0)
    letters.push(...chunk)
  }

  const bonusCycle: readonly RunnerBonusKind[] = [
    'hyper_ring',
    'shield',
    'jump_ramp',
  ]
  const hazardCycle: readonly RunnerHazardKind[] = [
    'banana',
    'sludge',
    'barricade',
    'emp_shock',
  ]

  let bonusCounter = 0
  let specialBonusCursor = 0
  let hazardCounter = 0

  const lanePhaseOffset = Math.floor(rng() * 3)
  for (let i = 0; i < 30; i += 1) {
    const rowZ = 155 + i * 192
    const allLanes: LaneIndex[] = [0, 1, 2]
    // Rotate booster pad lanes strictly so camping any single lane never farms free boosters
    const shiftedPadLane = ((i + lanePhaseOffset + (Math.floor(i / 3) % 3)) % 3) as LaneIndex

    const letter = letters[i]!
    const meta = padMetaByLetter.get(letter) ?? {
      shortLabel: letter,
      fullLabel: letter,
    }

    entities.push({
      kind: 'booster',
      id: `pad-${i + 1}`,
      z: rowZ,
      lane: shiftedPadLane,
      letter,
      shortLabel: meta.shortLabel,
      fullLabel: meta.fullLabel,
      triggered: false,
    })

    const remainingLanes = allLanes.filter((l) => l !== shiftedPadLane)

    // Place 2 hazards on the non-booster lanes in alternating patterns so standing AFK in ANY lane hits frequent hazards!
    for (let hSlot = 0; hSlot < remainingLanes.length; hSlot += 1) {
      if (hazardCounter >= 56) break
      if (hSlot === 1 && i % 3 === 0) continue
      hazardCounter += 1
      const hazardKind = hazardCycle[(i + hSlot) % hazardCycle.length]!
      entities.push({
        kind: 'hazard',
        id: `haz-${hazardCounter}`,
        z: rowZ + (hSlot === 0 ? -12 : 18),
        lane: remainingLanes[hSlot]!,
        hazardKind,
        triggered: false,
        clearedByJump: false,
        blockedByShield: false,
      })
    }

    // Mid-segment bonus gadgets (Hyper Ring, Shield, or Spring Jump Ramp + obstacle combo!)
    if (i % 4 === 2 && bonusCounter < 45 && hazardCounter < 56) {
      const rampLane = remainingLanes[0]!
      bonusCounter += 1
      hazardCounter += 1
      entities.push({
        kind: 'bonus',
        id: `bon-${bonusCounter}`,
        z: rowZ + 82,
        lane: rampLane,
        bonusKind: 'jump_ramp',
        triggered: false,
      })
      entities.push({
        kind: 'hazard',
        id: `haz-${hazardCounter}`,
        z: rowZ + 126,
        lane: rampLane,
        hazardKind: i % 8 === 2 ? 'emp_shock' : 'barricade',
        triggered: false,
        clearedByJump: false,
        blockedByShield: false,
      })
    } else if (i % 2 === 1 && bonusCounter < 45) {
      bonusCounter += 1
      const bKind = bonusCycle[specialBonusCursor % bonusCycle.length]!
      specialBonusCursor += 1
      const bonusLane = ((shiftedPadLane + 1) % 3) as LaneIndex
      entities.push({
        kind: 'bonus',
        id: `bon-${bonusCounter}`,
        z: rowZ + 94,
        lane: bonusLane,
        bonusKind: bKind,
        triggered: false,
      })
    }
  }

  entities.sort((a, b) => a.z - b.z)
  return entities
}

export class RunnerSimulation {
  readonly mode: GameMode
  readonly isPractice: boolean
  readonly roundDurationMs: number
  readonly baseSpeedPerSec: number
  readonly entities: TrackEntity[]

  private elapsedMs = 0
  private distance = 0
  private lane: LaneIndex = 1
  private visualLane = 1
  private jumpRemainingMs = 0
  private currentJumpDurationMs = NORMAL_JUMP_MS
  private isSuperJump = false
  private hasShield = false

  private hyperRemainMs = 0
  private boostRemainMs = 0
  private slipRemainMs = 0
  private sludgeRemainMs = 0
  private stunRemainMs = 0

  private boostCount = 0
  private bonusItemCount = 0
  private bonusPoints = 0
  private hazardHitCount = 0
  private stunStopCount = 0
  private shieldBlockedCount = 0
  private hazardPenaltyPoints = 0
  private jumpedHazardCount = 0
  private completedCoreSets = 0
  private currentSet = new Set<CoreValueCode>()

  private seq = 0
  private events: RunnerRunEvent[] = []
  private finished = false
  private practiceCleared = false

  private statusBanner: RunnerSnapshot['statusBanner'] = {
    tone: 'neutral',
    text: '⚡핵심가치·🚀하이퍼링·🛡️실드·🔼점프대를 챙기고, 🍌바나나·🟣점착늪·🚧바리케이드·⚡감전을 돌파하세요!',
  }

  constructor(params: {
    seed: number
    mode: GameMode
    contentVersion: string
    isPractice: boolean
  }) {
    this.mode = params.mode
    this.isPractice = params.isPractice
    this.roundDurationMs = params.isPractice
      ? 30_000
      : params.mode === 'assisted'
        ? 75_000
        : 60_000
    this.baseSpeedPerSec = params.mode === 'assisted' ? 72 : 90
    this.entities = buildRunnerTrack({
      seed: params.seed,
      contentVersion: params.contentVersion,
    })
  }

  private pushEvent(ev: DistributiveOmit<RunnerRunEvent, 'seq' | 't_ms'>): void {
    if (this.isPractice) return
    this.seq += 1
    this.events.push({
      ...ev,
      seq: this.seq,
      t_ms: Math.min(this.roundDurationMs, Math.round(this.elapsedMs)),
    } as RunnerRunEvent)
  }

  switchLane(delta: -1 | 1): boolean {
    if (this.finished || this.stunRemainMs > 180) return false
    const next = Math.max(0, Math.min(2, this.lane + delta)) as LaneIndex
    if (next === this.lane) return false
    this.lane = next
    return true
  }

  setLane(target: LaneIndex): boolean {
    if (this.finished || this.stunRemainMs > 180 || target === this.lane) return false
    this.lane = target
    return true
  }

  triggerJump(superLaunch: boolean = false): boolean {
    if (this.finished || this.stunRemainMs > 0) return false
    if (!superLaunch && this.jumpRemainingMs > 90) return false
    this.isSuperJump = superLaunch
    this.currentJumpDurationMs = superLaunch ? SUPER_JUMP_MS : NORMAL_JUMP_MS
    this.jumpRemainingMs = this.currentJumpDurationMs
    return true
  }

  /**
   * Returns 0 when grounded, up to 1.0 for normal jump, and up to 1.45 for spring super-jump!
   */
  getJumpHeight(): number {
    if (this.jumpRemainingMs <= 0) return 0
    const progress = 1 - this.jumpRemainingMs / this.currentJumpDurationMs
    const peak = this.isSuperJump ? 1.45 : this.sludgeRemainMs > 0 ? 0.8 : 1.0
    return peak * Math.sin(Math.PI * Math.min(1, Math.max(0, progress)))
  }

  getSpeedMultiplier(): number {
    if (this.stunRemainMs > 0) return 0.0
    if (this.sludgeRemainMs > 0) return 0.35
    if (this.slipRemainMs > 0) return 0.55
    if (this.hyperRemainMs > 0) return 1.95
    if (this.boostRemainMs > 0) return 1.55
    return 1.0
  }

  grantShieldForTest(): void {
    this.hasShield = true
  }

  getScore(): number {
    const raw =
      this.boostCount * BASE_ACTION_POINTS +
      this.completedCoreSets * 4 +
      this.bonusPoints -
      this.hazardPenaltyPoints
    return Math.max(0, raw)
  }

  step(dtMs: number): StepEffects {
    const effects: StepEffects = {
      boostedLetter: null,
      completedCoreSet: false,
      collectedBonus: null,
      slippedOrSludged: null,
      stunnedBy: null,
      shieldBlocked: null,
      jumpedHazard: false,
      practiceJustCleared: false,
      finishedReason: null,
    }
    if (this.finished || dtMs <= 0) return effects

    const clampedDt = Math.min(100, dtMs)
    this.elapsedMs += clampedDt

    if (this.jumpRemainingMs > 0) {
      this.jumpRemainingMs = Math.max(0, this.jumpRemainingMs - clampedDt)
      if (this.jumpRemainingMs === 0) {
        this.isSuperJump = false
      }
    }
    if (this.hyperRemainMs > 0) {
      this.hyperRemainMs = Math.max(0, this.hyperRemainMs - clampedDt)
    }
    if (this.boostRemainMs > 0) {
      this.boostRemainMs = Math.max(0, this.boostRemainMs - clampedDt)
    }
    if (this.slipRemainMs > 0) {
      this.slipRemainMs = Math.max(0, this.slipRemainMs - clampedDt)
    }
    if (this.sludgeRemainMs > 0) {
      this.sludgeRemainMs = Math.max(0, this.sludgeRemainMs - clampedDt)
    }
    if (this.stunRemainMs > 0) {
      this.stunRemainMs = Math.max(0, this.stunRemainMs - clampedDt)
    }

    // Smooth visual lane interpolation
    const laneDiff = this.lane - this.visualLane
    this.visualLane += laneDiff * Math.min(1, clampedDt * 0.018)
    if (Math.abs(this.lane - this.visualLane) < 0.01) {
      this.visualLane = this.lane
    }

    const prevZ = this.distance
    const speedMult = this.getSpeedMultiplier()
    const nextZ = prevZ + this.baseSpeedPerSec * speedMult * (clampedDt / 1000)
    this.distance = nextZ

    const jumpHeight = this.getJumpHeight()

    for (const ent of this.entities) {
      if (ent.z < prevZ - 14) continue
      if (ent.z > nextZ + 12) break

      if (ent.kind === 'booster') {
        if (ent.triggered) continue
        if (ent.lane === this.lane && ent.z <= nextZ + 8 && ent.z >= prevZ - 12 && jumpHeight < 0.85) {
          ent.triggered = true
          this.boostCount += 1
          this.boostRemainMs = BOOST_DURATION_MS
          this.slipRemainMs = 0
          this.sludgeRemainMs = 0
          this.currentSet.add(ent.letter)
          effects.boostedLetter = ent.letter
          this.pushEvent({
            type: 'step_booster',
            padId: ent.id,
            letter: ent.letter,
          })

          if (this.currentSet.size === 4) {
            this.completedCoreSets += 1
            this.currentSet.clear()
            this.hyperRemainMs = Math.max(this.hyperRemainMs, 1_500)
            effects.completedCoreSet = true
            this.statusBanner = {
              tone: 'super',
              text: '★ C·O·R·E 4대 핵심가치 세트 완성! 초고속 부스터 가동! (+2점 + 세트보너스 +4점)',
            }
          } else {
            this.statusBanner = {
              tone: 'boost',
              text: `⚡ [${ent.letter}] ${ent.fullLabel} 부스터 가속! (+${BASE_ACTION_POINTS}점)`,
            }
          }

          if (this.isPractice && !this.practiceCleared) {
            this.practiceCleared = true
            effects.practiceJustCleared = true
          }
        }
      } else if (ent.kind === 'bonus') {
        if (ent.triggered) continue
        if (ent.lane === this.lane && ent.z <= nextZ + 9 && ent.z >= prevZ - 12 && jumpHeight < 1.15) {
          ent.triggered = true
          this.bonusItemCount += 1
          effects.collectedBonus = ent.bonusKind
          this.pushEvent({
            type: 'collect_bonus',
            bonusId: ent.id,
            bonusKind: ent.bonusKind,
          })

          if (ent.bonusKind === 'hyper_ring') {
            this.bonusPoints += 3
            this.hyperRemainMs = HYPER_DURATION_MS
            this.slipRemainMs = 0
            this.sludgeRemainMs = 0
            this.stunRemainMs = 0
            this.statusBanner = {
              tone: 'super',
              text: '🚀 초전도 하이퍼 링 통과! 195% 초고속 질주 발동! (+3점)',
            }
          } else if (ent.bonusKind === 'shield') {
            this.bonusPoints += 1
            this.hasShield = true
            this.statusBanner = {
              tone: 'shield',
              text: '🛡️ 절연 보호 실드 장착! 다음 함정 충돌 1회를 완벽히 방어합니다! (+1점)',
            }
          } else if (ent.bonusKind === 'jump_ramp') {
            this.bonusPoints += 1
            this.triggerJump(true)
            this.statusBanner = {
              tone: 'jump',
              text: '🔼 스프링 점프대 발사! 고공 슈퍼점프로 앞의 함정을 뛰어넘습니다! (+1점)',
            }
          }

          if (this.isPractice && !this.practiceCleared) {
            this.practiceCleared = true
            effects.practiceJustCleared = true
          }
        }
      } else {
        if (ent.triggered || ent.clearedByJump || ent.blockedByShield) continue
        if (ent.lane === this.lane && ent.z <= nextZ + 6 && ent.z >= prevZ - 10) {
          // Required jump clearance height: emp_shock is tall (needs super-jump >= 1.05), others clear with normal Space jump >= 0.26!
          const requiredClearHeight = ent.hazardKind === 'emp_shock' ? 1.05 : 0.26
          if (jumpHeight >= requiredClearHeight) {
            ent.clearedByJump = true
            this.jumpedHazardCount += 1
            effects.jumpedHazard = true
            this.statusBanner = {
              tone: 'jump',
              text:
                ent.hazardKind === 'emp_shock'
                  ? '🦘 슈퍼점프 대성공! 높은 과전류 쇼크 게이트까지 공중 돌파했습니다!'
                  : '🦘 나이스 점프! 트랙 방해물을 가볍게 뛰어넘었습니다!',
            }
          } else if (this.hasShield) {
            ent.blockedByShield = true
            this.hasShield = false
            this.shieldBlockedCount += 1
            effects.shieldBlocked = ent.hazardKind
            this.pushEvent({
              type: 'hit_hazard',
              hazardId: ent.id,
              hazardKind: ent.hazardKind,
              blockedByShield: true,
            })
            this.statusBanner = {
              tone: 'shield',
              text: '🛡️ 절연 보호 실드가 방해물 충격을 완벽히 막아냈습니다! (감점·감속 없음)',
            }
          } else {
            ent.triggered = true
            this.hazardHitCount += 1
            this.currentSet.clear()
            this.pushEvent({
              type: 'hit_hazard',
              hazardId: ent.id,
              hazardKind: ent.hazardKind,
            })

            if (ent.hazardKind === 'banana') {
              this.hazardPenaltyPoints += 2
              this.slipRemainMs = BANANA_SLIP_MS
              this.boostRemainMs = 0
              this.hyperRemainMs = 0
              effects.slippedOrSludged = 'banana'
              this.statusBanner = {
                tone: 'slip',
                text: '🍌 바나나 미끄러짐! 속도 55% 감소 (−2점 · Space 점프로 넘으세요)',
              }
            } else if (ent.hazardKind === 'sludge') {
              this.hazardPenaltyPoints += 2
              this.sludgeRemainMs = SLUDGE_SLOW_MS
              this.boostRemainMs = 0
              this.hyperRemainMs = 0
              effects.slippedOrSludged = 'sludge'
              this.statusBanner = {
                tone: 'slip',
                text: '🟣 끈적한 점착 타르 늪! 속도 35% 거북이 중감속! (−2점)',
              }
            } else if (ent.hazardKind === 'barricade') {
              this.hazardPenaltyPoints += 2
              this.stunStopCount += 1
              this.stunRemainMs = BARRICADE_STUN_MS
              this.boostRemainMs = 0
              this.hyperRemainMs = 0
              effects.stunnedBy = 'barricade'
              this.statusBanner = {
                tone: 'stun',
                text: '🚧 공사 바리케이드 충돌! 잠깐 멈칫했습니다! (−2점 · 점프나 차선 이동으로 회피)',
              }
            } else if (ent.hazardKind === 'emp_shock') {
              this.hazardPenaltyPoints += 3
              this.stunStopCount += 1
              this.stunRemainMs = EMP_SHOCK_STUN_MS
              this.boostRemainMs = 0
              this.hyperRemainMs = 0
              effects.stunnedBy = 'emp_shock'
              this.statusBanner = {
                tone: 'stun',
                text: '⚡ 과전류 쇼크 감전! 0.7초 일시 정지! (−3점 · 옆 트랙 회피 또는 실드/점프대 활용!)',
              }
            }
          }
        }
      }
    }

    if (this.distance >= RUNNER_TRACK_LENGTH) {
      this.finished = true
      effects.finishedReason = 'course_finished'
    } else if (this.elapsedMs >= this.roundDurationMs) {
      this.elapsedMs = this.roundDurationMs
      this.finished = true
      effects.finishedReason = 'time_up'
    }

    return effects
  }

  getEvents(): RunnerRunEvent[] {
    return [...this.events]
  }

  getActiveDurationMs(): number {
    return Math.min(this.roundDurationMs, Math.round(this.elapsedMs))
  }

  getSnapshot(): RunnerSnapshot {
    const score = this.getScore()
    return {
      elapsedMs: this.elapsedMs,
      remainingMs: Math.max(0, this.roundDurationMs - this.elapsedMs),
      distance: this.distance,
      trackLength: RUNNER_TRACK_LENGTH,
      lane: this.lane,
      visualLane: this.visualLane,
      jumpHeight: this.getJumpHeight(),
      jumpRemainingMs: this.jumpRemainingMs,
      isSuperJump: this.isSuperJump,
      hasShield: this.hasShield,
      speedMultiplier: this.getSpeedMultiplier(),
      hyperRemainMs: this.hyperRemainMs,
      boostRemainMs: this.boostRemainMs,
      slipRemainMs: this.slipRemainMs,
      sludgeRemainMs: this.sludgeRemainMs,
      stunRemainMs: this.stunRemainMs,
      score,
      cleared: score >= PASSING_SCORE,
      boostCount: this.boostCount,
      bonusItemCount: this.bonusItemCount,
      hazardHitCount: this.hazardHitCount,
      stunStopCount: this.stunStopCount,
      shieldBlockedCount: this.shieldBlockedCount,
      jumpedHazardCount: this.jumpedHazardCount,
      completedCoreSets: this.completedCoreSets,
      currentSetLetters: [...this.currentSet],
      statusBanner: this.statusBanner,
      entities: this.entities,
      finished: this.finished,
      practiceCleared: this.practiceCleared,
    }
  }
}
