import type { CoreValueCode, LearningDomain } from '../src/domain/types.js'

export type PhraseLengthClass = 'short' | 'medium' | 'long'

export interface ContentRecord {
  id: string
  domain: LearningDomain
  coreCode?: CoreValueCode
  display_ko: string
  display_en: string
  explanation: string
  source_ref: string
  accepted_aliases: string[]
  approved: boolean
}

export interface TypingContentItem {
  id: string
  recordId: string
  lengthClass: PhraseLengthClass
}

export interface SnakeSentenceItem {
  id: string
  recordId: string
  domain: LearningDomain
  chunks: string[]
  distractorsByStep: string[][]
  explanation: string
}

export interface ShooterQuestionItem {
  id: string
  coreCode: CoreValueCode
  prompt: string
  promptKind: 'ko_name' | 'en_name' | 'description'
  correct_id: string
  distractor_ids: [string, string]
  explanation: string
  source_ref: string
}

export interface RunnerPadConfig {
  letter: CoreValueCode
  recordId: string
  shortLabel: string
}

export interface LearningContentBundle {
  contentVersion: string
  title: string
  approved: boolean
  isSample: boolean
  sampleNotice: string | null
  records: Record<string, ContentRecord>
  typingItems: TypingContentItem[]
  snakeSentences: SnakeSentenceItem[]
  shooterQuestions: ShooterQuestionItem[]
  runnerPads: RunnerPadConfig[]
}
