import {
  buildShooterRound,
  buildSnakeSentenceSequence,
  buildTypingSchedule,
  getContentBundle,
} from '../../content/index.js'
import {
  BASE_ACTION_POINTS,
  GAME_CATALOG,
  normalizePhraseInput,
  PASSING_SCORE,
} from './rules.js'
import type {
  CoreValueCode,
  FirstExposureOutcome,
  GameActionSummary,
  GameId,
  GameMode,
  GameRunEvent,
  RunEndReason,
  RunnerRunEvent,
  ShooterRunEvent,
  SnakeRunEvent,
  TypingRunEvent,
} from './types.js'

export interface ItemResponseOutcome {
  gameId: 'shooter'
  itemId: string
  firstOutcome: FirstExposureOutcome
  selectedIsCorrect: boolean | null
}

export interface VerifiedRunOutcome {
  score: number
  cleared: boolean
  activeDurationMs: number
  actionSummary: GameActionSummary
  itemOutcomes: ItemResponseOutcome[]
}

export class RunVerificationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const MAX_ACTIVE_DURATION_BY_GAME: Record<GameId, Record<GameMode, number>> = {
  typing: { standard: 65_000, assisted: 80_000 },
  snake: { standard: 95_000, assisted: 125_000 },
  shooter: { standard: 180_000, assisted: 240_000 },
  runner: { standard: 68_000, assisted: 85_000 },
}

const ALLOWED_END_REASONS: Record<GameId, readonly RunEndReason[]> = {
  typing: ['completed_all', 'time_up', 'miss_limit'],
  snake: ['completed_all', 'time_up', 'lives_exhausted'],
  shooter: ['completed_all', 'time_up'],
  runner: ['course_finished', 'time_up'],
}

function verifyEnvelopeAndTiming(
  gameId: GameId,
  mode: GameMode,
  events: readonly GameRunEvent[],
  activeDurationMs: number,
  endReason: RunEndReason,
): void {
  if (!GAME_CATALOG[gameId].allowedModes.includes(mode)) {
    throw new RunVerificationError('INVALID_MODE', `Mode ${mode} not allowed for ${gameId}`)
  }
  if (!ALLOWED_END_REASONS[gameId].includes(endReason)) {
    throw new RunVerificationError('INVALID_END_REASON', `Invalid endReason ${endReason}`)
  }
  const maxDuration = MAX_ACTIVE_DURATION_BY_GAME[gameId][mode]
  if (
    typeof activeDurationMs !== 'number' ||
    !Number.isFinite(activeDurationMs) ||
    activeDurationMs < 0 ||
    activeDurationMs > maxDuration
  ) {
    throw new RunVerificationError(
      'INVALID_DURATION',
      `Active duration ${activeDurationMs}ms out of bounds for ${gameId}/${mode}.`,
    )
  }
  if (!Array.isArray(events) || events.length > 600) {
    throw new RunVerificationError('INVALID_EVENTS', 'Event list is malformed or exceeds cap.')
  }

  let prevSeq = -1
  let prevTime = 0
  for (const ev of events) {
    if (
      typeof ev.seq !== 'number' ||
      !Number.isInteger(ev.seq) ||
      ev.seq <= prevSeq ||
      typeof ev.t_ms !== 'number' ||
      !Number.isFinite(ev.t_ms) ||
      ev.t_ms < prevTime ||
      ev.t_ms > maxDuration
    ) {
      throw new RunVerificationError(
        'INVALID_EVENT_SEQUENCE',
        'Event seq or t_ms violated monotonic ordering.',
      )
    }
    prevSeq = ev.seq
    prevTime = ev.t_ms
  }
}

export function verifyAndScoreRun(params: {
  gameId: GameId
  mode: GameMode
  seed: number
  contentVersion: string
  events: readonly GameRunEvent[]
  activeDurationMs: number
  endReason: RunEndReason
}): VerifiedRunOutcome {
  const { gameId, mode, seed, contentVersion, events, activeDurationMs, endReason } = params
  verifyEnvelopeAndTiming(gameId, mode, events, activeDurationMs, endReason)
  const bundle = getContentBundle(contentVersion)

  switch (gameId) {
    case 'typing': {
      const schedule = buildTypingSchedule(bundle, seed, mode)
      const slotMap = new Map(schedule.map((s) => [s.slotId, s]))
      const resolvedSlots = new Set<number>()
      let correctCount = 0
      let missedCount = 0
      let wrongSubmitCount = 0
      let combo = 0
      let maxCombo = 0

      for (const rawEv of events) {
        const ev = rawEv as TypingRunEvent
        if (ev.type !== 'submit_phrase' && ev.type !== 'slot_missed') {
          throw new RunVerificationError('INVALID_EVENT_TYPE', 'Unexpected typing event.')
        }
        const slot = slotMap.get(ev.slotId)
        if (!slot) {
          throw new RunVerificationError('INVALID_SLOT', `Unknown slotId ${ev.slotId}`)
        }
        if (resolvedSlots.has(ev.slotId)) {
          throw new RunVerificationError('DUPLICATE_SLOT', `Slot ${ev.slotId} already resolved`)
        }
        if (missedCount >= 5) {
          break
        }
        if (ev.type === 'slot_missed') {
          resolvedSlots.add(ev.slotId)
          missedCount += 1
          combo = 0
        } else {
          if (typeof ev.input !== 'string' || ev.input.length > 200) {
            throw new RunVerificationError('INVALID_INPUT', 'Invalid phrase submission.')
          }
          const normalizedSubmitted = normalizePhraseInput(ev.input)
          const matched = slot.acceptedAnswers.some(
            (alias) => normalizePhraseInput(alias) === normalizedSubmitted,
          )
          if (matched) {
            resolvedSlots.add(ev.slotId)
            correctCount += 1
            combo += 1
            if (combo > maxCombo) maxCombo = combo
          } else {
            wrongSubmitCount += 1
            combo = 0
          }
        }
      }

      const score = correctCount * BASE_ACTION_POINTS
      const cleared = score >= PASSING_SCORE
      return {
        score,
        cleared,
        activeDurationMs: Math.round(activeDurationMs),
        actionSummary: {
          kind: 'typing',
          correctCount,
          missedCount,
          wrongSubmitCount,
          maxCombo,
        },
        itemOutcomes: [],
      }
    }

    case 'snake': {
      const sequence = buildSnakeSentenceSequence(bundle, seed)
      const sentenceMap = new Map(sequence.map((s) => [s.id, s]))
      const completedSentenceIds: string[] = []
      const stepProgress = new Map<string, number>()
      const confusedPairs: Array<{ chosenText: string; expectedText: string }> = []
      let correctChunks = 0
      let completedSentences = 0
      let wrongChunkCount = 0
      let collisions = 0
      let lives = 3

      for (const rawEv of events) {
        const ev = rawEv as SnakeRunEvent
        if (lives <= 0) break
        if (ev.type === 'collision') {
          collisions += 1
          lives -= 1
        } else if (ev.type === 'pick_chunk') {
          const sentence = sentenceMap.get(ev.sentenceId)
          if (!sentence) {
            throw new RunVerificationError('INVALID_SENTENCE', `Unknown sentence ${ev.sentenceId}`)
          }
          const expectedStep = stepProgress.get(sentence.id) ?? 0
          if (ev.stepIndex !== expectedStep) {
            throw new RunVerificationError('INVALID_STEP', 'Snake chunk step out of order.')
          }
          const expectedChunk = sentence.chunks[expectedStep]!
          if (normalizePhraseInput(ev.chunkText) === normalizePhraseInput(expectedChunk)) {
            correctChunks += 1
            const nextStep = expectedStep + 1
            if (nextStep >= sentence.chunks.length) {
              completedSentences += 1
              if (!completedSentenceIds.includes(sentence.id)) {
                completedSentenceIds.push(sentence.id)
              }
              stepProgress.set(sentence.id, 0)
            } else {
              stepProgress.set(sentence.id, nextStep)
            }
          } else {
            wrongChunkCount += 1
            if (confusedPairs.length < 4) {
              confusedPairs.push({
                chosenText: ev.chunkText.slice(0, 40),
                expectedText: expectedChunk,
              })
            }
          }
        } else {
          throw new RunVerificationError('INVALID_EVENT_TYPE', 'Unexpected snake event.')
        }
      }

      const score =
        correctChunks * BASE_ACTION_POINTS + completedSentences * BASE_ACTION_POINTS
      const cleared = score >= PASSING_SCORE
      return {
        score,
        cleared,
        activeDurationMs: Math.round(activeDurationMs),
        actionSummary: {
          kind: 'snake',
          correctChunks,
          completedSentences,
          completedSentenceIds,
          wrongChunkCount,
          collisions,
          confusedPairs,
        },
        itemOutcomes: [],
      }
    }

    case 'shooter': {
      const round = buildShooterRound(bundle, seed)
      const itemMap = new Map(round.map((entry) => [entry.item.id, entry]))
      const maxAimMs = mode === 'assisted' ? 15_000 : 11_000
      const finalizedItems = new Set<string>()
      const startedItems = new Set<string>()
      let correctCount = 0
      let wrongCount = 0
      let timeoutCount = 0
      let missedShots = 0
      const itemOutcomes: ItemResponseOutcome[] = []

      for (const rawEv of events) {
        const ev = rawEv as ShooterRunEvent
        if (
          ev.type !== 'aim_start' &&
          ev.type !== 'shot_miss' &&
          ev.type !== 'hit_option' &&
          ev.type !== 'item_timeout'
        ) {
          throw new RunVerificationError('INVALID_EVENT_TYPE', 'Unexpected shooter event.')
        }
        const scheduled = itemMap.get(ev.itemId)
        if (!scheduled) {
          throw new RunVerificationError('INVALID_ITEM', `Unknown shooter item ${ev.itemId}`)
        }
        if (ev.type === 'aim_start') {
          startedItems.add(ev.itemId)
          continue
        }
        if (!startedItems.has(ev.itemId)) {
          throw new RunVerificationError('AIM_NOT_STARTED', `Aim not started for ${ev.itemId}`)
        }
        if (finalizedItems.has(ev.itemId)) {
          throw new RunVerificationError(
            'DUPLICATE_ITEM_FINALIZE',
            `Item ${ev.itemId} already finalized.`,
          )
        }
        if (ev.type === 'shot_miss') {
          missedShots += 1
          continue
        }
        if (
          typeof ev.aimDurationMs !== 'number' ||
          ev.aimDurationMs < 0 ||
          ev.aimDurationMs > maxAimMs
        ) {
          throw new RunVerificationError('INVALID_AIM_TIME', 'Aim duration exceeded limit.')
        }
        finalizedItems.add(ev.itemId)
        if (ev.type === 'item_timeout') {
          timeoutCount += 1
          itemOutcomes.push({
            gameId: 'shooter',
            itemId: ev.itemId,
            firstOutcome: 'timeout',
            selectedIsCorrect: null,
          })
        } else {
          const validOption = scheduled.options.some((o) => o.recordId === ev.selectedRecordId)
          if (!validOption) {
            throw new RunVerificationError('INVALID_OPTION', 'Selected option not in item choices.')
          }
          const isCorrect = ev.selectedRecordId === scheduled.item.correct_id
          if (isCorrect) {
            correctCount += 1
          } else {
            wrongCount += 1
          }
          itemOutcomes.push({
            gameId: 'shooter',
            itemId: ev.itemId,
            firstOutcome: isCorrect ? 'correct' : 'wrong',
            selectedIsCorrect: isCorrect,
          })
        }
      }

      const score = correctCount * BASE_ACTION_POINTS
      const cleared = score >= PASSING_SCORE
      return {
        score,
        cleared,
        activeDurationMs: Math.round(activeDurationMs),
        actionSummary: {
          kind: 'shooter',
          correctCount,
          wrongCount,
          timeoutCount,
          missedShots,
        },
        itemOutcomes,
      }
    }

    case 'runner': {
      const allowedPads = new Set(Array.from({ length: 50 }, (_, i) => `pad-${i + 1}`))
      const allowedBonuses = new Set(Array.from({ length: 50 }, (_, i) => `bon-${i + 1}`))
      const allowedHazards = new Set(Array.from({ length: 60 }, (_, i) => `haz-${i + 1}`))
      const validBonusKinds = new Set(['hyper_ring', 'shield', 'jump_ramp'])
      const validHazardKinds = new Set(['banana', 'sludge', 'barricade', 'emp_shock'])

      const usedPads = new Set<string>()
      const usedBonuses = new Set<string>()
      const usedHazards = new Set<string>()
      const currentSet = new Set<CoreValueCode>()
      const everCollected = new Set<CoreValueCode>()

      let boostCount = 0
      let bonusItemCount = 0
      let bonusPoints = 0
      let hazardHitCount = 0
      let stunStopCount = 0
      let shieldBlockedCount = 0
      let hazardPenaltyPoints = 0
      let completedCoreSets = 0

      for (const rawEv of events) {
        const ev = rawEv as RunnerRunEvent
        if (ev.type === 'step_booster') {
          if (!allowedPads.has(ev.padId) || !['C', 'O', 'R', 'E'].includes(ev.letter)) {
            throw new RunVerificationError('INVALID_BOOSTER_PAD', 'Invalid runner booster pad.')
          }
          if (usedPads.has(ev.padId)) continue
          usedPads.add(ev.padId)
          boostCount += 1
          currentSet.add(ev.letter)
          everCollected.add(ev.letter)
          if (currentSet.size === 4) {
            completedCoreSets += 1
            currentSet.clear()
          }
        } else if (ev.type === 'collect_bonus') {
          if (!allowedBonuses.has(ev.bonusId) || !validBonusKinds.has(ev.bonusKind)) {
            throw new RunVerificationError('INVALID_BONUS_ITEM', 'Invalid runner bonus item.')
          }
          if (usedBonuses.has(ev.bonusId)) continue
          usedBonuses.add(ev.bonusId)
          bonusItemCount += 1
          bonusPoints += ev.bonusKind === 'hyper_ring' ? 3 : 1
        } else if (ev.type === 'hit_hazard') {
          if (!allowedHazards.has(ev.hazardId) || !validHazardKinds.has(ev.hazardKind)) {
            throw new RunVerificationError('INVALID_HAZARD', 'Invalid runner hazard.')
          }
          if (usedHazards.has(ev.hazardId)) continue
          usedHazards.add(ev.hazardId)
          if (ev.blockedByShield) {
            shieldBlockedCount += 1
          } else {
            hazardHitCount += 1
            // Unshielded hazard hit disrupts incomplete C·O·R·E combo gauge!
            currentSet.clear()
            if (ev.hazardKind === 'emp_shock') {
              stunStopCount += 1
              hazardPenaltyPoints += 3
            } else if (ev.hazardKind === 'barricade') {
              stunStopCount += 1
              hazardPenaltyPoints += 2
            } else {
              hazardPenaltyPoints += 2
            }
          }
        } else {
          throw new RunVerificationError('INVALID_EVENT_TYPE', 'Unexpected runner event.')
        }
      }

      const rawScore =
        boostCount * BASE_ACTION_POINTS +
        completedCoreSets * 4 +
        bonusPoints -
        hazardPenaltyPoints
      const score = Math.max(0, rawScore)
      const cleared = score >= PASSING_SCORE
      return {
        score,
        cleared,
        activeDurationMs: Math.round(activeDurationMs),
        actionSummary: {
          kind: 'runner',
          boostCount,
          bonusItemCount,
          hazardHitCount,
          stunStopCount,
          shieldBlockedCount,
          completedCoreSets,
          collectedLetters: [...everCollected],
        },
        itemOutcomes: [],
      }
    }
  }
}
