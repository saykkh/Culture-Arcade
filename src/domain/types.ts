export type LearningDomain = 'mission' | 'vision' | 'core_value' | 'philosophy'

export type CoreValueCode = 'C' | 'O' | 'R' | 'E'

export type RequiredGameId = 'typing' | 'snake' | 'shooter' | 'runner'
export type GameId = RequiredGameId

export type GameMode = 'standard' | 'assisted'

export type AttemptKind = 'first_attempt' | 'retry_before_clear' | 'retry_after_clear'

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

export type RunnerBonusKind = 'hyper_ring' | 'shield' | 'jump_ramp'

export type RunnerHazardKind = 'banana' | 'sludge' | 'barricade' | 'emp_shock'

export interface RunnerActionSummary {
  kind: 'runner'
  boostCount: number
  bonusItemCount: number
  hazardHitCount: number
  stunStopCount: number
  shieldBlockedCount: number
  completedCoreSets: number
  collectedLetters: CoreValueCode[]
}

export type GameActionSummary =
  | TypingActionSummary
  | SnakeActionSummary
  | ShooterActionSummary
  | RunnerActionSummary

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

export type RunnerRunEvent =
  | {
      seq: number
      t_ms: number
      type: 'step_booster'
      padId: string
      letter: CoreValueCode
    }
  | {
      seq: number
      t_ms: number
      type: 'collect_bonus'
      bonusId: string
      bonusKind: RunnerBonusKind
    }
  | {
      seq: number
      t_ms: number
      type: 'hit_hazard'
      hazardId: string
      hazardKind: RunnerHazardKind
      blockedByShield?: boolean
    }

export type GameRunEvent =
  | TypingRunEvent
  | SnakeRunEvent
  | ShooterRunEvent
  | RunnerRunEvent

export type RunEndReason =
  | 'completed_all'
  | 'time_up'
  | 'miss_limit'
  | 'lives_exhausted'
  | 'course_finished'

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
