import {
  buildRacingPlan,
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
  ControlRoomRunEvent,
  CoreValueCode,
  FirstExposureOutcome,
  GameActionSummary,
  GameId,
  GameMode,
  GameRunEvent,
  PinballRunEvent,
  RacingRunEvent,
  RunEndReason,
  ShooterRunEvent,
  SnakeRunEvent,
  TypingRunEvent,
} from './types.js'

export interface ItemResponseOutcome {
  gameId: 'shooter' | 'control-room'
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
  racing: { standard: 80_000, assisted: 110_000 },
  pinball: { standard: 105_000, assisted: 130_000 },
  'control-room': { standard: 1_200_000, assisted: 1_200_000 },
}

const ALLOWED_END_REASONS: Record<GameId, readonly RunEndReason[]> = {
  typing: ['completed_all', 'time_up', 'miss_limit'],
  snake: ['completed_all', 'time_up', 'lives_exhausted'],
  shooter: ['completed_all', 'time_up'],
  racing: ['course_finished', 'time_up'],
  pinball: ['time_up', 'balls_exhausted'],
  'control-room': ['exit_activated', 'time_up'],
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
  renderMode?: '3d' | 'simplified' | 'panel-list'
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
          // Note: raw ev.input is intentionally never stored in summary or logs
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
              // Reset step progress to 0 so endless bonus waves can cycle sentences cleanly!
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
      const maxAimMs = mode === 'assisted' ? 9_500 : 6_500
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

    case 'racing': {
      const plan = buildRacingPlan(bundle, seed)
      const allowedVehicles = new Set(
        Array.from({ length: 20 }, (_, idx) => `veh-${idx + 1}`),
      )
      const allowedObstacles = new Set(
        Array.from({ length: 12 }, (_, idx) => `obs-${idx + 1}`),
      )
      const overtakenVehicles = new Set<string>()
      const collidedEntities = new Set<string>()
      const checkpointRecordIds: string[] = []
      let gateChoice: 'left' | 'right' | 'center' | 'none' = 'none'

      for (const rawEv of events) {
        const ev = rawEv as RacingRunEvent
        if (ev.type === 'collision') {
          const allowed =
            ev.targetKind === 'vehicle'
              ? allowedVehicles.has(ev.entityId)
              : allowedObstacles.has(ev.entityId)
          if (!allowed) {
            throw new RunVerificationError('INVALID_ENTITY', `Unknown racing entity ${ev.entityId}`)
          }
          if (!collidedEntities.has(ev.entityId)) {
            collidedEntities.add(ev.entityId)
            // If previously marked overtaken (should not happen), remove overtake credit
            overtakenVehicles.delete(ev.entityId)
          }
        } else if (ev.type === 'overtake') {
          if (!allowedVehicles.has(ev.vehicleId)) {
            throw new RunVerificationError('INVALID_VEHICLE', `Unknown vehicle ${ev.vehicleId}`)
          }
          // Collided vehicles do NOT receive overtake points
          if (!collidedEntities.has(ev.vehicleId)) {
            overtakenVehicles.add(ev.vehicleId)
          }
        } else if (ev.type === 'checkpoint') {
          const expected = plan.checkpoints[ev.checkpointIndex]
          if (!expected || expected.recordId !== ev.recordId) {
            throw new RunVerificationError('INVALID_CHECKPOINT', 'Checkpoint mismatch.')
          }
          if (!checkpointRecordIds.includes(ev.recordId)) {
            checkpointRecordIds.push(ev.recordId)
          }
        } else if (ev.type === 'gate_choice') {
          if (gateChoice === 'none') {
            gateChoice = ev.choice
          }
        } else {
          throw new RunVerificationError('INVALID_EVENT_TYPE', 'Unexpected racing event.')
        }
      }

      const overtakeCount = overtakenVehicles.size
      const collisionCount = collidedEntities.size
      // Gate score is strictly 0 regardless of choice! Overtake +2, Collision -1, Pass >= 10
      const rawScore = overtakeCount * BASE_ACTION_POINTS - collisionCount * 1
      const score = Math.max(0, rawScore)
      const cleared = score >= PASSING_SCORE
      const gateCorrect = gateChoice === plan.correctGateSide
      const renderMode = params.renderMode === 'simplified' ? 'simplified' : '3d'

      return {
        score,
        cleared,
        activeDurationMs: Math.round(activeDurationMs),
        actionSummary: {
          kind: 'racing',
          overtakeCount,
          collisionCount,
          gateChoice,
          gateCorrect,
          checkpointRecordIds,
          renderMode,
        },
        itemOutcomes: [],
      }
    }

    case 'pinball': {
      const lastScoredAtByBumper: Partial<Record<CoreValueCode, number>> = {}
      const currentSetLetters = new Set<CoreValueCode>()
      const everCollectedLetters = new Set<CoreValueCode>()
      let validHits = 0
      let completedSets = 0
      let ballsLost = 0
      let activeBall = 1

      for (const rawEv of events) {
        const ev = rawEv as PinballRunEvent
        if (ballsLost >= 3) break
        if (ev.type === 'ball_lost') {
          if (ev.ballId !== activeBall) {
            throw new RunVerificationError('INVALID_BALL', 'Ball lost out of sequence.')
          }
          ballsLost += 1
          activeBall += 1
        } else if (ev.type === 'bumper_hit') {
          if (!['C', 'O', 'R', 'E'].includes(ev.letter)) {
            throw new RunVerificationError('INVALID_BUMPER', 'Invalid bumper letter.')
          }
          if (!ev.separatedSinceLastHit) {
            continue
          }
          const prevHitMs = lastScoredAtByBumper[ev.letter]
          if (prevHitMs !== undefined && ev.t_ms - prevHitMs < 300) {
            continue
          }
          lastScoredAtByBumper[ev.letter] = ev.t_ms
          validHits += 1
          currentSetLetters.add(ev.letter)
          everCollectedLetters.add(ev.letter)
          if (currentSetLetters.size === 4) {
            completedSets += 1
            currentSetLetters.clear()
          }
        } else {
          throw new RunVerificationError('INVALID_EVENT_TYPE', 'Unexpected pinball event.')
        }
      }

      const score = validHits * BASE_ACTION_POINTS + completedSets * 4
      const cleared = score >= PASSING_SCORE
      return {
        score,
        cleared,
        activeDurationMs: Math.round(activeDurationMs),
        actionSummary: {
          kind: 'pinball',
          completedSets,
          validHits,
          uniqueLettersInCurrentSet: [...currentSetLetters],
          everCollectedLetters: [...everCollectedLetters],
          ballsLost,
        },
        itemOutcomes: [],
      }
    }

    case 'control-room': {
      const stages = bundle.controlRoomStages
      let currentStage = 0
      let wrongSelections = 0
      let exitActivated = false
      const firstChoiceRecordedByStage = new Set<number>()
      const itemOutcomes: ItemResponseOutcome[] = []

      for (const rawEv of events) {
        const ev = rawEv as ControlRoomRunEvent
        if (ev.type === 'inspect_clue') {
          if (ev.stageIndex > currentStage) {
            throw new RunVerificationError('LOCKED_CLUE', 'Cannot inspect future clue.')
          }
        } else if (ev.type === 'select_panel') {
          if (currentStage >= 4 || ev.stageIndex !== currentStage) {
            throw new RunVerificationError('INVALID_STAGE', 'Control-room stage mismatch.')
          }
          const stageCfg = stages[currentStage]!
          if (ev.clueId !== stageCfg.clueId) {
            throw new RunVerificationError('INVALID_CLUE', 'Clue ID mismatch.')
          }
          const isCorrect = ev.panelCode === stageCfg.correctPanelCode
          // Record ONLY the first actual panel choice on this stage in this run
          if (!firstChoiceRecordedByStage.has(currentStage)) {
            firstChoiceRecordedByStage.add(currentStage)
            itemOutcomes.push({
              gameId: 'control-room',
              itemId: stageCfg.clueId,
              firstOutcome: isCorrect ? 'correct' : 'wrong',
              selectedIsCorrect: isCorrect,
            })
          }
          if (isCorrect) {
            currentStage += 1
          } else {
            wrongSelections += 1
          }
        } else if (ev.type === 'activate_exit') {
          if (currentStage < 4) {
            throw new RunVerificationError('EXIT_LOCKED', 'Cannot activate exit before 4 panels.')
          }
          exitActivated = true
        } else {
          throw new RunVerificationError('INVALID_EVENT_TYPE', 'Unexpected control-room event.')
        }
      }

      const cleared = currentStage === 4 && exitActivated
      const interactionMode = params.renderMode === 'panel-list' ? 'panel-list' : '3d'
      return {
        score: currentStage * BASE_ACTION_POINTS + (exitActivated ? BASE_ACTION_POINTS : 0),
        cleared,
        activeDurationMs: Math.round(activeDurationMs),
        actionSummary: {
          kind: 'control-room',
          restoredPanels: currentStage,
          wrongSelections,
          exitActivated,
          interactionMode,
        },
        itemOutcomes,
      }
    }
  }
}
