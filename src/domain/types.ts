export type LearningDomain = 'mission' | 'vision' | 'core_value' | 'philosophy'

export type CoreValueCode = 'C' | 'O' | 'R' | 'E'

export type RequiredGameId = 'typing' | 'snake' | 'shooter' | 'racing' | 'pinball'
export type BonusGameId = 'control-room'
export type GameId = RequiredGameId | BonusGameId

export type GameMode = 'standard' | 'assisted'

export type AttemptKind = 'first_attempt' | 'retry_before_clear' | 'retry_after_clear'

export type RenderPreference = '3d' | 'simplified' | 'panel-list'

export type ParticipantLearningStatus =
  | 'before_start'
  | 'unseen'
  | 'ready_untried'
  | 'in_progress'
  | 'completed'

export type ParticipantDueStatus =
  | 'no_due_date'
  | 'before_due'
  | 'overdue'
  | 'completed_on_time'
  | 'completed_late'

export type FirstExposureOutcome = 'correct' | 'wrong' | 'timeout'

export interface TypingActionSummary {
  kind: 'typing'
  correctCount: number
  missedCount: number
  wrongSubmitCount: number
  maxCombo: number
}

export interface SnakeActionSummary {
  kind: 'snake'
  correctChunks: number
  completedSentences: number
  completedSentenceIds: string[]
  wrongChunkCount: number
  collisions: number
  confusedPairs: Array<{ chosenText: string; expectedText: string }>
}

export interface ShooterActionSummary {
  kind: 'shooter'
  correctCount: number
  wrongCount: number
  timeoutCount: number
  missedShots: number
}

export interface RacingActionSummary {
  kind: 'racing'
  overtakeCount: number
  collisionCount: number
  gateChoice: 'left' | 'right' | 'center' | 'none'
  gateCorrect: boolean
  checkpointRecordIds: string[]
  renderMode: '3d' | 'simplified'
}

export interface PinballActionSummary {
  kind: 'pinball'
  completedSets: number
  validHits: number
  uniqueLettersInCurrentSet: CoreValueCode[]
  everCollectedLetters: CoreValueCode[]
  ballsLost: number
}

export interface ControlRoomActionSummary {
  kind: 'control-room'
  restoredPanels: number
  wrongSelections: number
  exitActivated: boolean
  interactionMode: '3d' | 'panel-list'
}

export type GameActionSummary =
  | TypingActionSummary
  | SnakeActionSummary
  | ShooterActionSummary
  | RacingActionSummary
  | PinballActionSummary
  | ControlRoomActionSummary

export type TypingRunEvent =
  | {
      seq: number
      t_ms: number
      type: 'submit_phrase'
      slotId: number
      input: string
    }
  | {
      seq: number
      t_ms: number
      type: 'slot_missed'
      slotId: number
    }

export type SnakeRunEvent =
  | {
      seq: number
      t_ms: number
      type: 'pick_chunk'
      sentenceId: string
      stepIndex: number
      chunkText: string
    }
  | {
      seq: number
      t_ms: number
      type: 'collision'
      cause: 'wall' | 'body'
    }

export type ShooterRunEvent =
  | {
      seq: number
      t_ms: number
      type: 'aim_start'
      itemId: string
    }
  | {
      seq: number
      t_ms: number
      type: 'shot_miss'
      itemId: string
    }
  | {
      seq: number
      t_ms: number
      type: 'hit_option'
      itemId: string
      aimDurationMs: number
      selectedRecordId: string
    }
  | {
      seq: number
      t_ms: number
      type: 'item_timeout'
      itemId: string
      aimDurationMs: number
    }

export type RacingRunEvent =
  | {
      seq: number
      t_ms: number
      type: 'overtake'
      vehicleId: string
    }
  | {
      seq: number
      t_ms: number
      type: 'collision'
      targetKind: 'vehicle' | 'obstacle'
      entityId: string
    }
  | {
      seq: number
      t_ms: number
      type: 'checkpoint'
      checkpointIndex: 0 | 1 | 2
      recordId: string
    }
  | {
      seq: number
      t_ms: number
      type: 'gate_choice'
      choice: 'left' | 'right' | 'center'
    }

export type PinballRunEvent =
  | {
      seq: number
      t_ms: number
      type: 'bumper_hit'
      ballId: number
      letter: CoreValueCode
      separatedSinceLastHit: boolean
    }
  | {
      seq: number
      t_ms: number
      type: 'ball_lost'
      ballId: number
    }

export type ControlRoomRunEvent =
  | {
      seq: number
      t_ms: number
      type: 'inspect_clue'
      stageIndex: number
      clueId: string
    }
  | {
      seq: number
      t_ms: number
      type: 'select_panel'
      stageIndex: number
      clueId: string
      panelCode: CoreValueCode
    }
  | {
      seq: number
      t_ms: number
      type: 'activate_exit'
    }

export type GameRunEvent =
  | TypingRunEvent
  | SnakeRunEvent
  | ShooterRunEvent
  | RacingRunEvent
  | PinballRunEvent
  | ControlRoomRunEvent

export type RunEndReason =
  | 'completed_all'
  | 'time_up'
  | 'miss_limit'
  | 'lives_exhausted'
  | 'balls_exhausted'
  | 'course_finished'
  | 'exit_activated'

export interface LearningVersionRecord {
  id: string
  ruleVersion: string
  contentVersion: string
  publishedAt: string
}

export interface ParticipantProgressRecord {
  participantId: string
  gameId: GameId
  standardBestScore: number | null
  standardBestAchievedAt: string | null
  assistedBestScore: number | null
  firstClearedAt: string | null
  lastStartedAt: string | null
  finalizedAttemptCount: number
}

export interface RecommendationBanner {
  targetGameId: RequiredGameId | null
  kind: 'first_visit' | 'resume_uncleared' | 'next_uncleared' | 'all_completed'
  headline: string
  subline: string
}
