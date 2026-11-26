import { getContentBundle, type ControlRoomStageConfig } from '../../../content'
import type { ControlRoomRunEvent, CoreValueCode } from '../../domain/types'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export interface ControlRoomSnapshot {
  currentStage: number // 0..3 = panel stages, 4 = ready for exit
  restoredDevices: Array<{
    stageIndex: number
    deviceName: string
    panelCode: CoreValueCode
    valueNameKo: string
  }>
  activeStageConfig: ControlRoomStageConfig | null
  lastFeedback: {
    tone: 'info' | 'correct' | 'hint'
    title: string
    detail: string
  }
  wrongSelections: number
  exitPowerRestored: boolean
  exitActivated: boolean
  activeDurationMs: number
}

const CORE_PANEL_CODES: readonly CoreValueCode[] = ['C', 'O', 'R', 'E']

/**
 * 3D 탐색과 '패널 목록' UI가 100% 동일한 데이터·순서·판정으로 동작하는 관제실 상태 머신
 */
export class ControlRoomSimulation {
  readonly contentVersion: string
  readonly stages: readonly [
    ControlRoomStageConfig,
    ControlRoomStageConfig,
    ControlRoomStageConfig,
    ControlRoomStageConfig,
  ]
  readonly panelOptions: Array<{
    code: CoreValueCode
    labelKo: string
    labelEn: string
    explanation: string
  }>

  private currentStage = 0
  private wrongSelections = 0
  private exitActivated = false
  private activeDurationMs = 0
  private seq = 0
  private readonly events: ControlRoomRunEvent[] = []
  private readonly restoredDevices: ControlRoomSnapshot['restoredDevices'] = []
  private readonly bundleRecords: ReturnType<typeof getContentBundle>['records']
  private lastFeedback: ControlRoomSnapshot['lastFeedback']

  constructor(contentVersion: string) {
    this.contentVersion = contentVersion
    const bundle = getContentBundle(contentVersion)
    this.stages = bundle.controlRoomStages
    this.bundleRecords = bundle.records

    this.panelOptions = CORE_PANEL_CODES.map((code) => {
      const rec = bundle.records[`core-${code.toLowerCase()}`]!
      return {
        code,
        labelKo: rec.display_ko,
        labelEn: rec.display_en,
        explanation: rec.explanation,
      }
    })

    this.lastFeedback = {
      tone: 'info',
      title: '중앙 콘솔 첫 단서 활성화됨',
      detail: this.stages[0].cluePrompt,
    }

    // Record initial clue inspection at t=0
    this.pushEvent({
      type: 'inspect_clue',
      stageIndex: 0,
      clueId: this.stages[0].clueId,
    })
  }

  private pushEvent(ev: DistributiveOmit<ControlRoomRunEvent, 'seq' | 't_ms'>): void {
    this.seq += 1
    this.events.push({
      ...ev,
      seq: this.seq,
      t_ms: Math.round(this.activeDurationMs),
    } as ControlRoomRunEvent)
  }

  advanceTime(dtMs: number): void {
    if (this.exitActivated || dtMs <= 0) return
    this.activeDurationMs += Math.min(100, dtMs)
  }

  inspectActiveClue(): ControlRoomSnapshot {
    if (this.currentStage < 4) {
      const st = this.stages[this.currentStage]!
      this.pushEvent({
        type: 'inspect_clue',
        stageIndex: this.currentStage,
        clueId: st.clueId,
      })
      this.lastFeedback = {
        tone: 'info',
        title: `단서 0${this.currentStage + 1} 확인 (${st.deviceName})`,
        detail: st.cluePrompt,
      }
    }
    return this.getSnapshot()
  }

  selectPanel(panelCode: CoreValueCode): { correct: boolean; snapshot: ControlRoomSnapshot } {
    if (this.exitActivated || this.currentStage >= 4) {
      return { correct: false, snapshot: this.getSnapshot() }
    }

    const st = this.stages[this.currentStage]!
    this.pushEvent({
      type: 'select_panel',
      stageIndex: this.currentStage,
      clueId: st.clueId,
      panelCode,
    })

    if (panelCode === st.correctPanelCode) {
      const rec = this.bundleRecords[st.recordId]!
      this.restoredDevices.push({
        stageIndex: this.currentStage,
        deviceName: st.deviceName,
        panelCode,
        valueNameKo: rec.display_ko,
      })
      this.currentStage += 1
      this.lastFeedback = {
        tone: 'correct',
        title: `✓ [${panelCode}] ${rec.display_ko} 복구 성공!`,
        detail: `${rec.explanation} — ${st.unlockedRevealText}`,
      }

      if (this.currentStage < 4) {
        const nextSt = this.stages[this.currentStage]!
        this.pushEvent({
          type: 'inspect_clue',
          stageIndex: this.currentStage,
          clueId: nextSt.clueId,
        })
      }
      return { correct: true, snapshot: this.getSnapshot() }
    }

    this.wrongSelections += 1
    this.lastFeedback = {
      tone: 'hint',
      title: `▲ [${panelCode}] 패널이 현재 단서와 일치하지 않습니다`,
      detail: st.wrongHint,
    }
    return { correct: false, snapshot: this.getSnapshot() }
  }

  activateExit(): boolean {
    if (this.currentStage < 4 || this.exitActivated) {
      this.lastFeedback = {
        tone: 'hint',
        title: '출구 전원이 아직 잠겨 있습니다',
        detail: `C·O·R·E 네 패널을 모두 복구한 뒤 출구를 작동하세요. (현재 ${this.currentStage}/4 복구)`,
      }
      return false
    }
    this.exitActivated = true
    this.pushEvent({ type: 'activate_exit' })
    this.lastFeedback = {
      tone: 'correct',
      title: '★ 관제실 출구 개방 완료!',
      detail: '네 가지 핵심가치 전원이 모두 연결되어 보너스 관제등이 켜집니다.',
    }
    return true
  }

  getEvents(): ControlRoomRunEvent[] {
    return [...this.events]
  }

  getSnapshot(): ControlRoomSnapshot {
    return {
      currentStage: this.currentStage,
      restoredDevices: [...this.restoredDevices],
      activeStageConfig: this.currentStage < 4 ? this.stages[this.currentStage]! : null,
      lastFeedback: this.lastFeedback,
      wrongSelections: this.wrongSelections,
      exitPowerRestored: this.currentStage >= 4,
      exitActivated: this.exitActivated,
      activeDurationMs: this.activeDurationMs,
    }
  }
}
