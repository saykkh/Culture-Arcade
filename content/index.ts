import type { CoreValueCode, GameMode, LearningDomain } from '../src/domain/types.js'
import { APPROVED_CONTENT_TEMPLATE_V04 } from './approved-v04.js'
import { SAMPLE_CONTENT_V04 } from './sample-v04.js'
import type {
  LearningContentBundle,
  PhraseLengthClass,
  ShooterQuestionItem,
  SnakeSentenceItem,
} from './types.js'

export * from './types.js'
export { SAMPLE_CONTENT_V04, APPROVED_CONTENT_TEMPLATE_V04 }

export const CONTENT_BUNDLES: Record<string, LearningContentBundle> = {
  [SAMPLE_CONTENT_V04.contentVersion]: SAMPLE_CONTENT_V04,
  [APPROVED_CONTENT_TEMPLATE_V04.contentVersion]: APPROVED_CONTENT_TEMPLATE_V04,
}

export const DEFAULT_PILOT_CONTENT_VERSION = SAMPLE_CONTENT_V04.contentVersion

export function getContentBundle(contentVersion: string): LearningContentBundle {
  const bundle = CONTENT_BUNDLES[contentVersion]
  if (!bundle) {
    throw new Error(`Unknown content_version: ${contentVersion}`)
  }
  return bundle
}

export function assertContentAssignable(
  contentVersion: string,
  options: { requireApproved: boolean },
): LearningContentBundle {
  const bundle = getContentBundle(contentVersion)
  if (options.requireApproved && !bundle.approved) {
    throw new Error(
      `Content version "${contentVersion}" is unapproved sample content and cannot be assigned to real participants in production.`,
    )
  }
  return bundle
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items]
  const rng = mulberry32(seed)
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = copy[i]!
    copy[i] = copy[j]!
    copy[j] = tmp
  }
  return copy
}

export interface ScheduledTypingSlot {
  slotId: number
  itemId: string
  recordId: string
  displayKo: string
  displayEn: string
  domain: LearningDomain
  lengthClass: PhraseLengthClass
  acceptedAnswers: string[]
  spawnMs: number
  fallDurationMs: number
  deadlineMs: number
  lane: number
}

/**
 * 24개 슬롯을 시드 기반으로 편성하되(5개=10점 통과 후 최대 48점까지 경쟁 가능),
 * 긴 문구('long') 두 개의 낙하 마감(deadlineMs)이 정규·지원 모드 어느 쪽에서도 3,000ms 이내로 겹치지 않도록 편성한다.
 */
export function buildTypingSchedule(
  bundle: LearningContentBundle,
  seed: number,
  mode: GameMode,
): ScheduledTypingSlot[] {
  const totalSlots = 24
  const roundDurationMs = mode === 'assisted' ? 75_000 : 60_000
  const baseFallMs = mode === 'assisted' ? 14_200 : 11_400
  const longItems = seededShuffle(
    bundle.typingItems.filter((item) => item.lengthClass === 'long'),
    seed ^ 0x13579bdf,
  )
  const otherItems = seededShuffle(
    bundle.typingItems.filter((item) => item.lengthClass !== 'long'),
    seed ^ 0x2468ace0,
  )

  const ordered = Array.from(
    { length: totalSlots },
    () => null as (typeof bundle.typingItems)[number] | null,
  )
  const longIndices = [3, 9, 15, 21]
  longItems.forEach((item, idx) => {
    const slotIdx = longIndices[idx] ?? Math.min(totalSlots - 1, idx * 6 + 3)
    ordered[slotIdx] = item
  })

  let otherCursor = 0
  for (let i = 0; i < totalSlots; i += 1) {
    if (!ordered[i]) {
      ordered[i] = otherItems[otherCursor % otherItems.length]!
      otherCursor += 1
    }
  }

  const maxSpawnWindowMs = roundDurationMs - baseFallMs - 2_000
  const stepMs = Math.floor(maxSpawnWindowMs / (totalSlots - 1))

  return ordered.map((item, slotId) => {
    const resolved = item!
    const record = bundle.records[resolved.recordId]!
    const spawnMs = slotId * stepMs
    const lengthBonusMs =
      resolved.lengthClass === 'long' ? 1_400 : resolved.lengthClass === 'medium' ? 600 : 0
    const fallDurationMs = baseFallMs + lengthBonusMs
    return {
      slotId,
      itemId: resolved.id,
      recordId: resolved.recordId,
      displayKo: record.display_ko,
      displayEn: record.display_en,
      domain: record.domain,
      lengthClass: resolved.lengthClass,
      acceptedAnswers: [record.display_ko, ...record.accepted_aliases],
      spawnMs,
      fallDurationMs,
      deadlineMs: spawnMs + fallDurationMs,
      lane: slotId % 4,
    }
  })
}

/**
 * 뱀 문장 순서: 첫 문장은 경영철학 고정, 두 번째·세 번째는 미션·비전을 시드로 교환,
 * 네 번째는 앞 세 개와 다른 승인 문장으로 배치한다.
 */
export function buildSnakeSentenceSequence(
  bundle: LearningContentBundle,
  seed: number,
): SnakeSentenceItem[] {
  const philosophy = bundle.snakeSentences.find((s) => s.domain === 'philosophy')!
  const mission = bundle.snakeSentences.find((s) => s.domain === 'mission')!
  const vision = bundle.snakeSentences.find((s) => s.domain === 'vision')!
  const fourth = bundle.snakeSentences.find(
    (s) => s.id !== philosophy.id && s.id !== mission.id && s.id !== vision.id,
  )!

  const swapMiddle = (mulberry32(seed ^ 0x9e3779b9)() >= 0.5)
  return swapMiddle
    ? [philosophy, vision, mission, fourth]
    : [philosophy, mission, vision, fourth]
}

export interface ScheduledShooterItem {
  index: number
  item: ShooterQuestionItem
  correctLane: 0 | 1 | 2
  options: [
    { lane: 0; recordId: string; labelKo: string; labelEn: string; coreCode?: CoreValueCode },
    { lane: 1; recordId: string; labelKo: string; labelEn: string; coreCode?: CoreValueCode },
    { lane: 2; recordId: string; labelKo: string; labelEn: string; coreCode?: CoreValueCode },
  ]
}

/**
 * 슈팅 12문항: 네 가치를 각각 3문항씩 포함하고,
 * 정답 위치(0, 1, 2)를 12문항의 세 위치에 정확히 각 네 번씩 시드로 배치한다.
 */
export function buildShooterRound(
  bundle: LearningContentBundle,
  seed: number,
): ScheduledShooterItem[] {
  const questions = seededShuffle(bundle.shooterQuestions, seed ^ 0x517cc1b7).slice(0, 12)
  const balancedLanes = seededShuffle(
    [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2] as const,
    seed ^ 0xa5a5a5a5,
  )
  const rng = mulberry32(seed ^ 0x3c6ef372)

  return questions.map((item, index) => {
    const correctLane = balancedLanes[index]!
    const distractors = rng() >= 0.5
      ? [item.distractor_ids[0], item.distractor_ids[1]]
      : [item.distractor_ids[1], item.distractor_ids[0]]
    const laneRecordIds: [string, string, string] = ['', '', '']
    laneRecordIds[correctLane] = item.correct_id
    let dIdx = 0
    for (const lane of [0, 1, 2] as const) {
      if (lane !== correctLane) {
        laneRecordIds[lane] = distractors[dIdx]!
        dIdx += 1
      }
    }

    const toOption = <L extends 0 | 1 | 2>(lane: L) => {
      const rec = bundle.records[laneRecordIds[lane]]!
      return {
        lane,
        recordId: rec.id,
        labelKo: rec.display_ko,
        labelEn: rec.display_en,
        coreCode: rec.coreCode,
      }
    }

    return {
      index,
      item,
      correctLane,
      options: [toOption(0), toOption(1), toOption(2)],
    }
  })
}

export interface ContentValidationReport {
  valid: boolean
  errors: string[]
}

export function validateContentBundle(bundle: LearningContentBundle): ContentValidationReport {
  const errors: string[] = []

  if (bundle.typingItems.length < 16) {
    errors.push('Typing items must contain at least 16 entries.')
  }

  for (const mode of ['standard', 'assisted'] as const) {
    for (const seed of [1, 42, 2026, 99991]) {
      const schedule = buildTypingSchedule(bundle, seed, mode)
      const longDeadlines = schedule
        .filter((s) => s.lengthClass === 'long')
        .map((s) => s.deadlineMs)
        .sort((a, b) => a - b)
      for (let i = 1; i < longDeadlines.length; i += 1) {
        if (longDeadlines[i]! - longDeadlines[i - 1]! < 3_000) {
          errors.push(
            `Long typing phrase deadline gap < 3000ms in mode=${mode}, seed=${seed}.`,
          )
        }
      }
    }
  }

  const seqA = buildSnakeSentenceSequence(bundle, 1)
  if (seqA[0]?.domain !== 'philosophy') {
    errors.push('Snake first sentence must be philosophy.')
  }
  const middleDomains = new Set([seqA[1]?.domain, seqA[2]?.domain])
  if (!middleDomains.has('mission') || !middleDomains.has('vision')) {
    errors.push('Snake sentences 2 and 3 must cover mission and vision.')
  }

  if (bundle.shooterQuestions.length !== 12) {
    errors.push('Shooter must have 12 questions.')
  }
  for (const code of ['C', 'O', 'R', 'E'] as const) {
    const count = bundle.shooterQuestions.filter((q) => q.coreCode === code).length
    if (count !== 3) {
      errors.push(`Shooter core value ${code} must have 3 questions, got ${count}.`)
    }
  }
  const shooterRound = buildShooterRound(bundle, 2026)
  const laneCounts = [0, 0, 0]
  shooterRound.forEach((entry) => {
    laneCounts[entry.correctLane] += 1
  })
  if (laneCounts[0] !== 4 || laneCounts[1] !== 4 || laneCounts[2] !== 4) {
    errors.push(`Shooter correct lanes must be [4,4,4], got ${laneCounts.join(',')}.`)
  }

  const padLetters = new Set(bundle.runnerPads.map((b) => b.letter))
  for (const code of ['C', 'O', 'R', 'E'] as const) {
    if (!padLetters.has(code)) {
      errors.push(`Runner missing core pad ${code}.`)
    }
  }

  return { valid: errors.length === 0, errors }
}
