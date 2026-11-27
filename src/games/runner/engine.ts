import { getContentBundle, mulberry32, seededShuffle } from '../../../content/index.js'
import { BASE_ACTION_POINTS, PASSING_SCORE } from '../../domain/rules.js'
import type { CoreValueCode, GameMode, RunEndReason, RunnerRunEvent } from '../../domain/types.js'

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

export interface TrackBananaHazard {
  kind: 'hazard'
  id: string
  z: number
  lane: LaneIndex
  hazardKind: 'banana'
  triggered: boolean
  clearedByJump: boolean
}

export type TrackEntity = TrackBoosterPad | TrackBananaHazard

export interface RunnerSnapshot {
  elapsedMs: number
  remainingMs: number
  distance: number
  trackLength: number
  lane: LaneIndex
  visualLane: number
  jumpHeight: number
  speedMultiplier: number
  boostRemainMs: number
  slipRemainMs: number
  score: number
  cleared: boolean
  boostCount: number
  bananaSlipCount: number
  jumpedBananaCount: number
  completedCoreSets: number
  currentSetLetters: CoreValueCode[]
  statusBanner: {
    tone: 'boost' | 'super' | 'slip' | 'jump' | 'neutral'
    text: string
  }
  entities: TrackEntity[]
  finished: boolean
  practiceCleared: boolean
}

export interface StepEffects {
  boostedLetter: CoreValueCode | null
  completedCoreSet: boolean
  slippedBanana: boolean
  jumpedBanana: boolean
  practiceJustCleared: boolean
  finishedReason: RunEndReason | null
}

const CORE_ORDER: readonly CoreValueCode[] = ['C', 'O', 'R', 'E'] as const

export const RUNNER_TRACK_LENGTH = 5_800
const JUMP_DURATION_MS = 640
const BOOST_DURATION_MS = 1_550
const SLIP_DURATION_MS = 1_150

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

  // Build 36 booster rows (9 sets of C, O, R, E shuffled per set so all 4 values appear evenly)
  const letters: CoreValueCode[] = []
  for (let s = 0; s < 9; s += 1) {
    const chunk = seededShuffle(CORE_ORDER, (params.seed + s * 977) >>> 0)
    letters.push(...chunk)
  }

  let hazardCounter = 0
  let prevPadLane: LaneIndex = 1

  for (let i = 0; i < 36; i += 1) {
    const z = 155 + i * 152
    const candidateLanes: LaneIndex[] = [0, 1, 2]
    // Encourage lane movement rather than camping 1 lane
    const filteredLanes =
      i % 2 === 1 ? candidateLanes.filter((l) => l !== prevPadLane) : candidateLanes
    const padLane = filteredLanes[Math.floor(rng() * filteredLanes.length)]!
    prevPadLane = padLane

    const letter = letters[i]!
    const meta = padMetaByLetter.get(letter) ?? {
      shortLabel: letter,
      fullLabel: letter,
    }

    entities.push({
      kind: 'booster',
      id: `pad-${i + 1}`,
      z,
      lane: padLane,
      letter,
      shortLabel: meta.shortLabel,
      fullLabel: meta.fullLabel,
      triggered: false,
    })

    // Place up to 24 banana hazards: either on a different lane in the same row,
    // or slightly ahead so jumping (Space) or lane-switching avoids it cleanly.
    if (hazardCounter < 24 && i >= 1 && (i % 3 !== 0 || rng() < 0.45)) {
      hazardCounter += 1
      const placeAheadSameLane = i >= 3 && i % 5 === 0
      if (placeAheadSameLane) {
        entities.push({
          kind: 'hazard',
          id: `haz-${hazardCounter}`,
          z: z + 74,
          lane: padLane,
          hazardKind: 'banana',
          triggered: false,
          clearedByJump: false,
        })
      } else {
        const otherLanes = candidateLanes.filter((l) => l !== padLane)
        const hazLane = otherLanes[Math.floor(rng() * otherLanes.length)]!
        entities.push({
          kind: 'hazard',
          id: `haz-${hazardCounter}`,
          z: z + (rng() < 0.5 ? -18 : 22),
          lane: hazLane,
          hazardKind: 'banana',
          triggered: false,
          clearedByJump: false,
        })
      }
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
  private boostRemainMs = 0
  private slipRemainMs = 0

  private boostCount = 0
  private bananaSlipCount = 0
  private jumpedBananaCount = 0
  private completedCoreSets = 0
  private currentSet = new Set<CoreValueCode>()

  private seq = 0
  private events: RunnerRunEvent[] = []
  private finished = false
  private practiceCleared = false

  private statusBanner: RunnerSnapshot['statusBanner'] = {
    tone: 'neutral',
    text: '←·→로 ⚡핵심가치 발판(+2점·부스터)을 밟고, 🍌바나나는 피하거나 Space로 점프하세요!',
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
    this.baseSpeedPerSec = params.mode === 'assisted' ? 68 : 85
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
    if (this.finished) return false
    const next = Math.max(0, Math.min(2, this.lane + delta)) as LaneIndex
    if (next === this.lane) return false
    this.lane = next
    return true
  }

  setLane(target: LaneIndex): boolean {
    if (this.finished || target === this.lane) return false
    this.lane = target
    return true
  }

  triggerJump(): boolean {
    if (this.finished || this.jumpRemainingMs > 90) return false
    this.jumpRemainingMs = JUMP_DURATION_MS
    return true
  }

  getJumpHeight(): number {
    if (this.jumpRemainingMs <= 0) return 0
    const progress = 1 - this.jumpRemainingMs / JUMP_DURATION_MS
    return Math.sin(Math.PI * Math.min(1, Math.max(0, progress)))
  }

  getSpeedMultiplier(): number {
    if (this.slipRemainMs > 0) return 0.52
    if (this.boostRemainMs > 0) return 1.55
    return 1.0
  }

  getScore(): number {
    const raw =
      this.boostCount * BASE_ACTION_POINTS +
      this.completedCoreSets * 4 -
      this.bananaSlipCount * 1
    return Math.max(0, raw)
  }

  step(dtMs: number): StepEffects {
    const effects: StepEffects = {
      boostedLetter: null,
      completedCoreSet: false,
      slippedBanana: false,
      jumpedBanana: false,
      practiceJustCleared: false,
      finishedReason: null,
    }
    if (this.finished || dtMs <= 0) return effects

    const clampedDt = Math.min(100, dtMs)
    this.elapsedMs += clampedDt

    if (this.jumpRemainingMs > 0) {
      this.jumpRemainingMs = Math.max(0, this.jumpRemainingMs - clampedDt)
    }
    if (this.boostRemainMs > 0) {
      this.boostRemainMs = Math.max(0, this.boostRemainMs - clampedDt)
    }
    if (this.slipRemainMs > 0) {
      this.slipRemainMs = Math.max(0, this.slipRemainMs - clampedDt)
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

    // Check collisions across [prevZ - 8, nextZ + 8]
    for (const ent of this.entities) {
      if (ent.z < prevZ - 14) continue
      if (ent.z > nextZ + 12) break

      if (ent.kind === 'booster') {
        if (ent.triggered) continue
        if (ent.lane === this.lane && ent.z <= nextZ + 8 && ent.z >= prevZ - 12 && jumpHeight < 0.65) {
          ent.triggered = true
          this.boostCount += 1
          this.boostRemainMs = BOOST_DURATION_MS
          this.slipRemainMs = 0
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
            this.boostRemainMs = BOOST_DURATION_MS + 650
            effects.completedCoreSet = true
            this.statusBanner = {
              tone: 'super',
              text: `★ C·O·R·E 4대 핵심가치 완성! 슈퍼 부스터 가동! (+2점 + 세트보너스 +4점)`,
            }
          } else {
            this.statusBanner = {
              tone: 'boost',
              text: `⚡ [${ent.letter}] ${ent.fullLabel} 부스터 발판 가속! (+${BASE_ACTION_POINTS}점)`,
            }
          }

          if (this.isPractice && !this.practiceCleared) {
            this.practiceCleared = true
            effects.practiceJustCleared = true
          }
        }
      } else {
        if (ent.triggered || ent.clearedByJump) continue
        if (ent.lane === this.lane && ent.z <= nextZ + 6 && ent.z >= prevZ - 10) {
          if (jumpHeight >= 0.26) {
            ent.clearedByJump = true
            this.jumpedBananaCount += 1
            effects.jumpedBanana = true
            this.statusBanner = {
              tone: 'jump',
              text: '🦘 나이스 점프! 바나나 함정을 가볍게 뛰어넘었습니다!',
            }
          } else {
            ent.triggered = true
            this.bananaSlipCount += 1
            this.slipRemainMs = SLIP_DURATION_MS
            this.boostRemainMs = 0
            effects.slippedBanana = true
            this.pushEvent({
              type: 'hit_hazard',
              hazardId: ent.id,
              hazardKind: 'banana',
            })
            this.statusBanner = {
              tone: 'slip',
              text: '🍌 바나나에 미끄러져 속도가 줄었습니다! (−1점 · Space 점프나 차선 이동으로 피하세요)',
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
      speedMultiplier: this.getSpeedMultiplier(),
      boostRemainMs: this.boostRemainMs,
      slipRemainMs: this.slipRemainMs,
      score,
      cleared: score >= PASSING_SCORE,
      boostCount: this.boostCount,
      bananaSlipCount: this.bananaSlipCount,
      jumpedBananaCount: this.jumpedBananaCount,
      completedCoreSets: this.completedCoreSets,
      currentSetLetters: [...this.currentSet],
      statusBanner: this.statusBanner,
      entities: this.entities,
      finished: this.finished,
      practiceCleared: this.practiceCleared,
    }
  }
}
