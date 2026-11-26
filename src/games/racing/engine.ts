import { buildRacingPlan, getContentBundle, mulberry32, type ScheduledRacingPlan } from '../../../content'
import type { GameMode, RacingRunEvent, RunEndReason } from '../../domain/types'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type TunnelLane = 0 | 1 | 2

export interface TrackEntity {
  id: string
  kind: 'vehicle' | 'obstacle'
  lane: TunnelLane
  z: number
  collided: boolean
  overtaken: boolean
}

export interface RacingStateSnapshot {
  isPractice: boolean
  z: number
  courseLength: number
  lane: TunnelLane
  driveTimerMs: number
  maxDriveTimerMs: number
  activeDurationMs: number
  boostersLeft: number
  boosterRemainingMs: number
  slowdownRemainingMs: number
  inGateZone: boolean
  gateResolved: boolean
  gateChoice: 'left' | 'right' | 'center' | 'none'
  gateCorrect: boolean
  finalSectionLit: boolean
  activeCheckpointBanner: {
    domain: 'mission' | 'vision' | 'core_value'
    text: string
  } | null
  gateFeedbackBanner: string | null
  overtakeCount: number
  collisionCount: number
  netScore: number
  entities: readonly TrackEntity[]
  plan: ScheduledRacingPlan
  finished: boolean
  endReason: RunEndReason | null
}

export const COURSE_LENGTH_M = 5_800
export const CHECKPOINT_Z: readonly [number, number, number] = [1_350, 2_850, 4_550]
export const GATE_ZONE_START_Z = 2_920
export const GATE_ZONE_END_Z = 3_320

/**
 * 3D와 간소화 2D 화면이 100% 동일한 차선·속도·추월·충돌·게이트 판정을 공유하는 순수 레이싱 시뮬레이션 엔진
 */
export class RacingSimulation {
  readonly mode: GameMode
  readonly isPractice: boolean
  readonly plan: ScheduledRacingPlan
  readonly maxDriveTimerMs: number
  readonly baseSpeedMps: number
  readonly courseLength: number

  private z = 0
  private lane: TunnelLane = 1
  private driveTimerMs = 0
  private activeDurationMs = 0
  private boostersLeft = 2
  private boosterRemainingMs = 0
  private slowdownRemainingMs = 0
  private gateResolved = false
  private gateChoice: 'left' | 'right' | 'center' | 'none' = 'none'
  private gateCorrect = false
  private finalSectionLit = false
  private activeCheckpointBanner: RacingStateSnapshot['activeCheckpointBanner'] = null
  private gateFeedbackBanner: string | null = null
  private triggeredCheckpoints = new Set<number>()
  private overtakeCount = 0
  private collisionCount = 0
  private finished = false
  private endReason: RunEndReason | null = null
  private seq = 0
  private readonly events: RacingRunEvent[] = []
  private readonly entities: TrackEntity[]

  constructor(params: {
    seed: number
    mode: GameMode
    contentVersion: string
    isPractice?: boolean
  }) {
    this.mode = params.mode
    this.isPractice = Boolean(params.isPractice)
    const bundle = getContentBundle(params.contentVersion)
    this.plan = buildRacingPlan(bundle, params.seed)
    this.maxDriveTimerMs = this.isPractice
      ? 30_000
      : params.mode === 'assisted'
        ? 105_000
        : 75_000
    // Assisted mode runs at 80% of standard forward speed
    this.baseSpeedMps = params.mode === 'assisted' ? 76 : 95
    this.courseLength = this.isPractice ? 900 : COURSE_LENGTH_M
    this.entities = this.buildTrackEntities(params.seed)
  }

  private buildTrackEntities(seed: number): TrackEntity[] {
    if (this.isPractice) {
      // Single vehicle ahead in center lane so switching lanes & passing completes practice!
      return [
        {
          id: 'veh-1',
          kind: 'vehicle',
          lane: 1,
          z: 260,
          collided: false,
          overtaken: false,
        },
      ]
    }

    const rng = mulberry32(seed ^ 0x2f6e2b1)
    const items: TrackEntity[] = []

    // Place 15 overtake vehicles outside gate zone [2920..3320]
    const vehicleZPositions = [
      360, 620, 880, 1140, 1520, 1800, 2080, 2360, 2640,
      3540, 3840, 4140, 4440, 4880, 5240,
    ]
    vehicleZPositions.forEach((vz, idx) => {
      const lane = (Math.floor(rng() * 3) as TunnelLane)
      items.push({
        id: `veh-${idx + 1}`,
        kind: 'vehicle',
        lane,
        z: vz,
        collided: false,
        overtaken: false,
      })
    })

    // Place 8 obstacles in lanes that never block all 3 lanes simultaneously
    const obstacleZPositions = [500, 1010, 1660, 2220, 2760, 3690, 4300, 5060]
    obstacleZPositions.forEach((oz, idx) => {
      const lane = ((Math.floor(rng() * 3) + 1) % 3) as TunnelLane
      items.push({
        id: `obs-${idx + 1}`,
        kind: 'obstacle',
        lane,
        z: oz,
        collided: false,
        overtaken: false,
      })
    })

    return items.sort((a, b) => a.z - b.z)
  }

  private pushEvent(ev: DistributiveOmit<RacingRunEvent, 'seq' | 't_ms'>): void {
    if (this.isPractice) return
    this.seq += 1
    this.events.push({
      ...ev,
      seq: this.seq,
      t_ms: Math.round(this.activeDurationMs),
    } as RacingRunEvent)
  }

  moveLane(delta: -1 | 1): boolean {
    if (this.finished) return false
    const next = (this.lane + delta) as number
    if (next < 0 || next > 2) return false
    this.lane = next as TunnelLane
    return true
  }

  setLane(target: TunnelLane): void {
    if (this.finished) return
    this.lane = target
  }

  triggerBooster(): boolean {
    if (this.finished) return false
    // Gate zone ignores booster input WITHOUT consuming charges!
    if (this.isInGateZone()) {
      return false
    }
    if (this.boostersLeft <= 0 || this.boosterRemainingMs > 0) {
      return false
    }
    this.boostersLeft -= 1
    this.boosterRemainingMs = 2_000
    return true
  }

  isInGateZone(): boolean {
    return !this.isPractice && this.z >= GATE_ZONE_START_Z && this.z < GATE_ZONE_END_Z
  }

  step(dtMs: number): RacingStateSnapshot {
    if (this.finished || dtMs <= 0) {
      return this.getSnapshot()
    }

    const clampedDt = Math.min(100, dtMs)
    this.activeDurationMs += clampedDt

    const inGate = this.isInGateZone()

    // Outside gate zone: drive timer & booster & slowdown advance normally
    let speedMps: number
    if (inGate) {
      // Auto-decelerate in gate zone; exclude from driveTimerMs & boosterRemainingMs!
      speedMps = 55
    } else {
      this.driveTimerMs += clampedDt
      let factor = 1.0
      if (this.boosterRemainingMs > 0) {
        factor *= 1.55
        this.boosterRemainingMs = Math.max(0, this.boosterRemainingMs - clampedDt)
      }
      if (this.slowdownRemainingMs > 0) {
        factor *= 0.55
        this.slowdownRemainingMs = Math.max(0, this.slowdownRemainingMs - clampedDt)
      }
      speedMps = this.baseSpeedMps * factor
    }

    const prevZ = this.z
    this.z = Math.min(this.courseLength, this.z + (speedMps * clampedDt) / 1000)

    // Checkpoints (0, 1, 2)
    if (!this.isPractice) {
      CHECKPOINT_Z.forEach((cpZ, idx) => {
        if (!this.triggeredCheckpoints.has(idx) && this.z >= cpZ) {
          this.triggeredCheckpoints.add(idx)
          const cp = this.plan.checkpoints[idx as 0 | 1 | 2]
          this.activeCheckpointBanner = {
            domain: cp.domain,
            text: cp.displayKo,
          }
          this.pushEvent({
            type: 'checkpoint',
            checkpointIndex: idx as 0 | 1 | 2,
            recordId: cp.recordId,
          })
        }
      })

      // Resolve gate choice right as player crosses GATE_ZONE_END_Z
      if (!this.gateResolved && prevZ < GATE_ZONE_END_Z && this.z >= GATE_ZONE_END_Z) {
        this.gateResolved = true
        const choice: 'left' | 'right' | 'center' =
          this.lane === 0 ? 'left' : this.lane === 2 ? 'right' : 'center'
        this.gateChoice = choice
        this.gateCorrect = choice === this.plan.correctGateSide
        this.pushEvent({
          type: 'gate_choice',
          choice,
        })
        const expectedLabel = this.plan.gatePromptDomain === 'mission' ? '미션(Mission)' : '비전(Vision)'
        if (this.gateCorrect) {
          this.finalSectionLit = true
          this.gateFeedbackBanner = `✓ 정답 게이트(${expectedLabel}) 통과! 마지막 구간 터널 조명이 점등됩니다.`
        } else {
          this.gateFeedbackBanner = `ℹ 방금 제시된 문구는 [${expectedLabel}] 표현입니다. (점수 감점 없음)`
        }
      }
    }

    // Check collisions & overtakes along [prevZ .. this.z]
    const hitHalfWindow = 14
    const passMargin = 16
    for (const ent of this.entities) {
      if (!ent.collided && !ent.overtaken) {
        const withinHitWindow =
          this.z >= ent.z - hitHalfWindow && prevZ <= ent.z + hitHalfWindow
        if (withinHitWindow && this.lane === ent.lane) {
          ent.collided = true
          this.collisionCount += 1
          this.slowdownRemainingMs = 1_100
          this.pushEvent({
            type: 'collision',
            targetKind: ent.kind,
            entityId: ent.id,
          })
          continue
        }
      }

      if (
        ent.kind === 'vehicle' &&
        !ent.collided &&
        !ent.overtaken &&
        this.z > ent.z + passMargin
      ) {
        ent.overtaken = true
        this.overtakeCount += 1
        this.pushEvent({
          type: 'overtake',
          vehicleId: ent.id,
        })
      }
    }

    if (this.z >= this.courseLength) {
      this.finished = true
      this.endReason = 'course_finished'
    } else if (this.driveTimerMs >= this.maxDriveTimerMs) {
      this.finished = true
      this.endReason = 'time_up'
    }

    return this.getSnapshot()
  }

  getEvents(): RacingRunEvent[] {
    return [...this.events]
  }

  getSnapshot(): RacingStateSnapshot {
    const netScore = Math.max(0, this.overtakeCount * 100 - this.collisionCount * 50)
    return {
      isPractice: this.isPractice,
      z: this.z,
      courseLength: this.courseLength,
      lane: this.lane,
      driveTimerMs: this.driveTimerMs,
      maxDriveTimerMs: this.maxDriveTimerMs,
      activeDurationMs: this.activeDurationMs,
      boostersLeft: this.boostersLeft,
      boosterRemainingMs: this.boosterRemainingMs,
      slowdownRemainingMs: this.slowdownRemainingMs,
      inGateZone: this.isInGateZone(),
      gateResolved: this.gateResolved,
      gateChoice: this.gateChoice,
      gateCorrect: this.gateCorrect,
      finalSectionLit: this.finalSectionLit,
      activeCheckpointBanner: this.activeCheckpointBanner,
      gateFeedbackBanner: this.gateFeedbackBanner,
      overtakeCount: this.overtakeCount,
      collisionCount: this.collisionCount,
      netScore,
      entities: this.entities,
      plan: this.plan,
      finished: this.finished,
      endReason: this.endReason,
    }
  }
}
