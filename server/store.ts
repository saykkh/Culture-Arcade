import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  assertContentAssignable,
  DEFAULT_PILOT_CONTENT_VERSION,
  getContentBundle,
} from '../content'
import { computeLobbyRecommendation } from '../src/domain/recommendation'
import {
  ALL_GAME_IDS,
  BONUS_GAME_ID,
  computeParticipantDueStatus,
  computeParticipantLearningStatus,
  CURRENT_LEARNING_VERSION_ID,
  CURRENT_RULE_VERSION,
  DUE_STATUS_LABELS,
  GAME_CATALOG,
  isAvailableOnKst,
  isRequiredGameId,
  isValidGameId,
  LEARNING_STATUS_LABELS,
  normalizeParticipantCode,
  REQUIRED_GAME_ORDER,
  RUN_SUBMISSION_TTL_MS,
  SESSION_TTL_MS,
  toKstDateString,
  validateAndNormalizeNickname,
} from '../src/domain/rules'
import { RunVerificationError, verifyAndScoreRun } from '../src/domain/scoring'
import type {
  AttemptKind,
  FirstExposureOutcome,
  GameActionSummary,
  GameId,
  GameMode,
  GameRunEvent,
  LearningVersionRecord,
  ParticipantDueStatus,
  ParticipantLearningStatus,
  ParticipantProgressRecord,
  RecommendationBanner,
  RunEndReason,
} from '../src/domain/types'
import {
  computeCodeLookupDigest,
  computeSessionLookupDigest,
  generateParticipantCode,
  generateSessionToken,
} from './crypto'

export const SAMPLE_VIRTUAL_CODES = {
  ACTIVE_TODAY: 'LSWY-2026-PLAY',
  FUTURE_START: 'LSWY-2099-WAIT',
} as const

export interface StoredParticipant {
  id: string
  learningVersionId: string
  rosterRef: string
  nickname: string | null
  nicknameKey: string | null
  availableFromDate: string
  recommendedDueDate: string | null
  firstSeenAt: string | null
  lastSeenAt: string | null
  firstPlayedAt: string | null
  onboardingCompletedAt: string | null
  dueDateAtCompletion: string | null
  createdAt: string
  isVirtualSample?: boolean
}

export interface StoredCredential {
  id: string
  participantId: string
  lookupDigest: string
  generation: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface StoredSession {
  id: string
  participantId: string
  lookupDigest: string
  credentialGeneration: number
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

export interface StoredGameRun {
  id: string
  participantId: string
  gameId: GameId
  mode: GameMode
  ruleVersion: string
  contentVersion: string
  seed: number
  status: 'started' | 'finalized' | 'abandoned'
  attemptKind: AttemptKind
  afterBadgeAtStart: boolean
  startedAt: string
  expiresAt: string
  finalizedAt: string | null
  endReason: RunEndReason | null
  renderMode: '3d' | 'simplified' | 'panel-list' | null
  activeDurationMs: number | null
  score: number | null
  cleared: boolean | null
  actionSummary: GameActionSummary | null
  finalizedResponse: FinalizeRunResult | null
}

export interface StoredFirstItemResponse {
  participantId: string
  contentVersion: string
  gameId: 'shooter' | 'control-room'
  itemId: string
  firstOutcome: FirstExposureOutcome
  isCorrect: boolean | null
  firstExposedAt: string
  firstSelectedAt: string | null
}

export interface DatabaseState {
  learningVersions: LearningVersionRecord[]
  participants: StoredParticipant[]
  credentials: StoredCredential[]
  sessions: StoredSession[]
  runs: StoredGameRun[]
  progress: ParticipantProgressRecord[]
  firstItemResponses: StoredFirstItemResponse[]
}

export interface FinalizeRunResult {
  runId: string
  gameId: GameId
  mode: GameMode
  score: number
  cleared: boolean
  activeDurationMs: number
  actionSummary: GameActionSummary
  previousActionSummary: GameActionSummary | null
  personalBestScore: number
  standardBestScore: number | null
  assistedBestScore: number | null
  newlyLitSocket: boolean
  newlyLitControlLamp: boolean
  newlyEarnedBadge: boolean
  requiredClearedCount: number
  badgeEarned: boolean
  controlLampLit: boolean
  litSockets: Record<string, boolean>
  recommendation: RecommendationBanner
}

export class ArcadeApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function sanitizeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  const guarded = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

function createInitialState(requireApprovedContent: boolean): DatabaseState {
  const lv: LearningVersionRecord = {
    id: CURRENT_LEARNING_VERSION_ID,
    ruleVersion: CURRENT_RULE_VERSION,
    contentVersion: DEFAULT_PILOT_CONTENT_VERSION,
    publishedAt: '2026-11-26T00:00:00.000Z',
  }

  if (requireApprovedContent) {
    return {
      learningVersions: [lv],
      participants: [],
      credentials: [],
      sessions: [],
      runs: [],
      progress: [],
      firstItemResponses: [],
    }
  }

  const p1Id = '00000000-0000-4000-8000-000000000001'
  const p2Id = '00000000-0000-4000-8000-000000000002'
  const createdAt = '2026-11-26T00:00:00.000Z'

  return {
    learningVersions: [lv],
    participants: [
      {
        id: p1Id,
        learningVersionId: lv.id,
        rosterRef: 'DEV-001',
        nickname: null,
        nicknameKey: null,
        availableFromDate: '2026-11-20',
        recommendedDueDate: '2026-12-10',
        firstSeenAt: null,
        lastSeenAt: null,
        firstPlayedAt: null,
        onboardingCompletedAt: null,
        dueDateAtCompletion: null,
        createdAt,
        isVirtualSample: true,
      },
      {
        id: p2Id,
        learningVersionId: lv.id,
        rosterRef: 'DEV-002',
        nickname: null,
        nicknameKey: null,
        availableFromDate: '2099-01-01',
        recommendedDueDate: '2099-01-15',
        firstSeenAt: null,
        lastSeenAt: null,
        firstPlayedAt: null,
        onboardingCompletedAt: null,
        dueDateAtCompletion: null,
        createdAt,
        isVirtualSample: true,
      },
    ],
    credentials: [
      {
        id: randomUUID(),
        participantId: p1Id,
        lookupDigest: computeCodeLookupDigest(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY),
        generation: 1,
        expiresAt: null,
        revokedAt: null,
        createdAt,
      },
      {
        id: randomUUID(),
        participantId: p2Id,
        lookupDigest: computeCodeLookupDigest(SAMPLE_VIRTUAL_CODES.FUTURE_START),
        generation: 1,
        expiresAt: null,
        revokedAt: null,
        createdAt,
      },
    ],
    sessions: [],
    runs: [],
    progress: [],
    firstItemResponses: [],
  }
}

export interface ArcadeStoreOptions {
  filePath?: string | null
  requireApprovedContent?: boolean
  clock?: () => Date
}

export class ArcadeStore {
  private state: DatabaseState
  private readonly filePath: string | null
  private readonly requireApprovedContent: boolean
  private readonly clock: () => Date
  private readonly locks = new Map<string, Promise<void>>()
  private readonly failedAttempts = new Map<string, { count: number; windowStartMs: number; lockedUntilMs: number }>()

  constructor(options: ArcadeStoreOptions = {}) {
    this.filePath = options.filePath === undefined ? null : options.filePath
    this.requireApprovedContent = Boolean(options.requireApprovedContent)
    this.clock = options.clock ?? (() => new Date())

    if (this.filePath && existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as DatabaseState
        this.state = parsed
      } catch {
        this.state = createInitialState(this.requireApprovedContent)
        this.persist()
      }
    } else {
      this.state = createInitialState(this.requireApprovedContent)
      this.persist()
    }
  }

  private persist(): void {
    if (!this.filePath) return
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8')
    } catch {
      // Ignore transient filesystem write errors in read-only edge environments
    }
  }

  private async withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.locks.set(key, prev.then(() => current))
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(key) === current) {
        this.locks.delete(key)
      }
    }
  }

  getStorageSummary(): {
    mode: 'isolated-local' | 'supabase-configured'
    requireApprovedContent: boolean
    learningVersionId: string
    ruleVersion: string
    contentVersion: string
    isSampleContent: boolean
  } {
    const lv = this.state.learningVersions[0]!
    const bundle = getContentBundle(lv.contentVersion)
    const supabaseConfigured = Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
    return {
      mode: supabaseConfigured ? 'supabase-configured' : 'isolated-local',
      requireApprovedContent: this.requireApprovedContent,
      learningVersionId: lv.id,
      ruleVersion: lv.ruleVersion,
      contentVersion: lv.contentVersion,
      isSampleContent: bundle.isSample,
    }
  }

  private checkCodeRateLimit(clientKey: string, nowMs: number): void {
    const rec = this.failedAttempts.get(clientKey)
    if (!rec) return
    if (rec.lockedUntilMs > nowMs) {
      throw new ArcadeApiError(
        429,
        'TOO_MANY_ATTEMPTS',
        '코드 입력 실패가 반복되어 잠시 요청이 제한되었습니다. 1분 후 다시 시도해 주세요.',
      )
    }
    if (nowMs - rec.windowStartMs > 60_000) {
      this.failedAttempts.delete(clientKey)
    }
  }

  private recordCodeFailure(clientKey: string, nowMs: number): void {
    const rec = this.failedAttempts.get(clientKey)
    if (!rec || nowMs - rec.windowStartMs > 60_000) {
      this.failedAttempts.set(clientKey, {
        count: 1,
        windowStartMs: nowMs,
        lockedUntilMs: 0,
      })
      return
    }
    rec.count += 1
    if (rec.count >= 5) {
      rec.lockedUntilMs = nowMs + 60_000
    }
  }

  loginWithPersonalCode(rawCode: string, clientKey: string = 'default'): {
    sessionToken: string
    expiresAt: string
    requiresNickname: boolean
    beforeStartDate: boolean
    availableFromDate: string
    participantId: string
    nickname: string | null
  } {
    const now = this.clock()
    const nowMs = now.getTime()
    this.checkCodeRateLimit(clientKey, nowMs)

    const clean = normalizeParticipantCode(rawCode)
    if (clean.length !== 12) {
      this.recordCodeFailure(clientKey, nowMs)
      throw new ArcadeApiError(
        401,
        'INVALID_CODE',
        '유효하지 않은 개인 코드입니다. 코드를 다시 확인해 주세요.',
      )
    }

    const digest = computeCodeLookupDigest(clean)
    const credential = this.state.credentials.find((c) => c.lookupDigest === digest)
    if (
      !credential ||
      credential.revokedAt !== null ||
      (credential.expiresAt !== null && Date.parse(credential.expiresAt) <= nowMs)
    ) {
      this.recordCodeFailure(clientKey, nowMs)
      throw new ArcadeApiError(
        401,
        'INVALID_CODE',
        '유효하지 않은 개인 코드입니다. 코드를 다시 확인해 주세요.',
      )
    }

    const participant = this.state.participants.find((p) => p.id === credential.participantId)
    if (!participant) {
      this.recordCodeFailure(clientKey, nowMs)
      throw new ArcadeApiError(
        401,
        'INVALID_CODE',
        '유효하지 않은 개인 코드입니다. 코드를 다시 확인해 주세요.',
      )
    }

    this.failedAttempts.delete(clientKey)
    const nowIso = now.toISOString()
    if (!participant.firstSeenAt) {
      participant.firstSeenAt = nowIso
    }
    participant.lastSeenAt = nowIso

    const { token, lookupDigest } = generateSessionToken()
    const expiresAt = new Date(nowMs + SESSION_TTL_MS).toISOString()
    this.state.sessions.push({
      id: randomUUID(),
      participantId: participant.id,
      lookupDigest,
      credentialGeneration: credential.generation,
      expiresAt,
      revokedAt: null,
      createdAt: nowIso,
    })
    this.persist()

    const available = isAvailableOnKst(participant.availableFromDate, now)
    return {
      sessionToken: token,
      expiresAt,
      requiresNickname: available && !participant.nickname,
      beforeStartDate: !available,
      availableFromDate: participant.availableFromDate,
      participantId: participant.id,
      nickname: participant.nickname,
    }
  }

  authenticateParticipantSession(token: string | undefined): StoredParticipant {
    if (!token) {
      throw new ArcadeApiError(401, 'UNAUTHENTICATED', '참가자 로그인이 필요합니다.')
    }
    const now = this.clock()
    const nowMs = now.getTime()
    const digest = computeSessionLookupDigest(token)
    const session = this.state.sessions.find((s) => s.lookupDigest === digest)
    if (!session || session.revokedAt !== null || Date.parse(session.expiresAt) <= nowMs) {
      throw new ArcadeApiError(
        401,
        'SESSION_EXPIRED',
        '세션이 만료되었거나 무효화되었습니다. 개인 코드로 다시 접속해 주세요.',
      )
    }

    const activeCred = this.state.credentials.find(
      (c) => c.participantId === session.participantId && c.revokedAt === null,
    )
    if (!activeCred || activeCred.generation !== session.credentialGeneration) {
      session.revokedAt = now.toISOString()
      this.persist()
      throw new ArcadeApiError(
        401,
        'SESSION_INVALIDATED',
        '개인 코드가 재발급되어 이전 세션이 종료되었습니다. 새 코드로 접속해 주세요.',
      )
    }

    const participant = this.state.participants.find((p) => p.id === session.participantId)
    if (!participant) {
      throw new ArcadeApiError(401, 'UNAUTHENTICATED', '참가자 정보를 찾을 수 없습니다.')
    }
    participant.lastSeenAt = now.toISOString()
    return participant
  }

  logoutParticipantSession(token: string | undefined): void {
    if (!token) return
    const digest = computeSessionLookupDigest(token)
    const session = this.state.sessions.find((s) => s.lookupDigest === digest)
    if (session && !session.revokedAt) {
      session.revokedAt = this.clock().toISOString()
      this.persist()
    }
  }

  setParticipantNickname(token: string | undefined, rawNickname: string): { nickname: string } {
    const participant = this.authenticateParticipantSession(token)
    const now = this.clock()
    if (!isAvailableOnKst(participant.availableFromDate, now)) {
      throw new ArcadeApiError(
        403,
        'BEFORE_START_DATE',
        `개인 시작일(${participant.availableFromDate}) 00:00 이후부터 입장할 수 있습니다.`,
      )
    }
    const checked = validateAndNormalizeNickname(rawNickname)
    if (!checked.valid) {
      throw new ArcadeApiError(400, 'INVALID_NICKNAME', checked.error!)
    }

    const duplicate = this.state.participants.find(
      (p) => p.id !== participant.id && p.nicknameKey === checked.key,
    )
    if (duplicate) {
      throw new ArcadeApiError(
        409,
        'DUPLICATE_NICKNAME',
        '이미 사용 중인 닉네임입니다. 다른 별칭을 입력해 주세요.',
      )
    }

    participant.nickname = checked.display
    participant.nicknameKey = checked.key
    this.persist()
    return { nickname: checked.display }
  }

  private getProgressMap(participantId: string): Partial<Record<GameId, ParticipantProgressRecord>> {
    const map: Partial<Record<GameId, ParticipantProgressRecord>> = {}
    for (const row of this.state.progress) {
      if (row.participantId === participantId) {
        map[row.gameId] = row
      }
    }
    return map
  }

  private getOrCreateProgress(participantId: string, gameId: GameId): ParticipantProgressRecord {
    let row = this.state.progress.find(
      (p) => p.participantId === participantId && p.gameId === gameId,
    )
    if (!row) {
      row = {
        participantId,
        gameId,
        standardBestScore: null,
        standardBestAchievedAt: null,
        assistedBestScore: null,
        firstClearedAt: null,
        lastStartedAt: null,
        finalizedAttemptCount: 0,
      }
      this.state.progress.push(row)
    }
    return row
  }

  getParticipantMe(token: string | undefined) {
    const participant = this.authenticateParticipantSession(token)
    const now = this.clock()
    const available = isAvailableOnKst(participant.availableFromDate, now)
    const lv = this.state.learningVersions.find((v) => v.id === participant.learningVersionId)!
    const bundle = getContentBundle(lv.contentVersion)
    const progressByGame = this.getProgressMap(participant.id)

    const litSockets: Record<string, boolean> = {}
    let requiredClearedCount = 0
    for (const gid of REQUIRED_GAME_ORDER) {
      const lit = Boolean(progressByGame[gid]?.firstClearedAt)
      litSockets[gid] = lit
      if (lit) requiredClearedCount += 1
    }
    const controlLampLit = Boolean(progressByGame[BONUS_GAME_ID]?.firstClearedAt)
    const badgeEarned = Boolean(participant.onboardingCompletedAt)
    const recommendation = computeLobbyRecommendation(progressByGame)

    const games = ALL_GAME_IDS.map((gid) => {
      const prog = progressByGame[gid]
      const meta = GAME_CATALOG[gid]
      return {
        gameId: gid,
        title: meta.title,
        category: meta.category,
        allowedModes: meta.allowedModes,
        standardBestScore: prog?.standardBestScore ?? null,
        assistedBestScore: prog?.assistedBestScore ?? null,
        firstClearedAt: prog?.firstClearedAt ?? null,
        lastStartedAt: prog?.lastStartedAt ?? null,
        finalizedAttemptCount: prog?.finalizedAttemptCount ?? 0,
        cleared: Boolean(prog?.firstClearedAt),
      }
    })

    return {
      participantId: participant.id,
      nickname: participant.nickname,
      requiresNickname: available && !participant.nickname,
      beforeStartDate: !available,
      availableFromDate: participant.availableFromDate,
      recommendedDueDate: participant.recommendedDueDate,
      onboardingCompletedAt: participant.onboardingCompletedAt,
      ruleVersion: lv.ruleVersion,
      contentVersion: lv.contentVersion,
      isSampleContent: bundle.isSample,
      sampleNotice: bundle.sampleNotice,
      requiredClearedCount,
      badgeEarned,
      controlLampLit,
      litSockets,
      recommendation,
      games,
    }
  }

  async startGameRun(
    token: string | undefined,
    rawGameId: string,
    requestedMode: GameMode,
  ): Promise<{
    runId: string
    gameId: GameId
    mode: GameMode
    seed: number
    ruleVersion: string
    contentVersion: string
    startedAt: string
    expiresAt: string
    attemptKind: AttemptKind
  }> {
    const participant = this.authenticateParticipantSession(token)
    if (!isValidGameId(rawGameId)) {
      throw new ArcadeApiError(400, 'INVALID_GAME', '존재하지 않는 게임입니다.')
    }
    const gameId = rawGameId
    const now = this.clock()
    if (!isAvailableOnKst(participant.availableFromDate, now)) {
      throw new ArcadeApiError(
        403,
        'BEFORE_START_DATE',
        `개인 시작일(${participant.availableFromDate}) 00:00 이후부터 게임을 시작할 수 있습니다.`,
      )
    }
    if (!participant.nickname) {
      throw new ArcadeApiError(400, 'NICKNAME_REQUIRED', '먼저 닉네임을 설정해 주세요.')
    }
    if (!GAME_CATALOG[gameId].allowedModes.includes(requestedMode)) {
      throw new ArcadeApiError(
        400,
        'MODE_NOT_ALLOWED',
        '이 게임에서 허용되지 않는 모드입니다.',
      )
    }

    return this.withLock(`participant:${participant.id}`, () => {
      const lv = this.state.learningVersions.find((v) => v.id === participant.learningVersionId)!
      const prog = this.getOrCreateProgress(participant.id, gameId)
      const hadPreviousStart =
        prog.lastStartedAt !== null ||
        this.state.runs.some(
          (r) => r.participantId === participant.id && r.gameId === gameId,
        )

      let attemptKind: AttemptKind
      if (!hadPreviousStart) {
        attemptKind = 'first_attempt'
      } else if (!prog.firstClearedAt) {
        attemptKind = 'retry_before_clear'
      } else {
        attemptKind = 'retry_after_clear'
      }

      const nowIso = this.clock().toISOString()
      const expiresAt = new Date(Date.parse(nowIso) + RUN_SUBMISSION_TTL_MS).toISOString()
      const seed = Math.floor(Math.random() * 0x7fffffff) || 20261126

      if (!participant.firstPlayedAt) {
        participant.firstPlayedAt = nowIso
      }
      prog.lastStartedAt = nowIso

      const run: StoredGameRun = {
        id: randomUUID(),
        participantId: participant.id,
        gameId,
        mode: requestedMode,
        ruleVersion: lv.ruleVersion,
        contentVersion: lv.contentVersion,
        seed,
        status: 'started',
        attemptKind,
        afterBadgeAtStart: Boolean(participant.onboardingCompletedAt),
        startedAt: nowIso,
        expiresAt,
        finalizedAt: null,
        endReason: null,
        renderMode: null,
        activeDurationMs: null,
        score: null,
        cleared: null,
        actionSummary: null,
        finalizedResponse: null,
      }
      this.state.runs.push(run)
      this.persist()

      return {
        runId: run.id,
        gameId: run.gameId,
        mode: run.mode,
        seed: run.seed,
        ruleVersion: run.ruleVersion,
        contentVersion: run.contentVersion,
        startedAt: run.startedAt,
        expiresAt: run.expiresAt,
        attemptKind: run.attemptKind,
      }
    })
  }

  async finalizeGameRun(
    token: string | undefined,
    runId: string,
    payload: {
      events: GameRunEvent[]
      activeDurationMs: number
      endReason: RunEndReason
      renderMode?: '3d' | 'simplified' | 'panel-list'
    },
  ): Promise<FinalizeRunResult> {
    const participant = this.authenticateParticipantSession(token)

    return this.withLock(`participant:${participant.id}`, () => {
      const run = this.state.runs.find((r) => r.id === runId)
      if (!run || run.participantId !== participant.id) {
        throw new ArcadeApiError(404, 'RUN_NOT_FOUND', '유효한 플레이 기록을 찾을 수 없습니다.')
      }

      // Idempotent duplicate submission returns exact first finalized response
      if (run.status === 'finalized' && run.finalizedResponse) {
        return run.finalizedResponse
      }

      const now = this.clock()
      if (now.getTime() > Date.parse(run.expiresAt)) {
        throw new ArcadeApiError(
          410,
          'RUN_EXPIRED',
          '결과 제출 기한(시작 후 20분)이 만료되었습니다. 새 라운드를 시작해 주세요.',
        )
      }

      let verified
      try {
        verified = verifyAndScoreRun({
          gameId: run.gameId,
          mode: run.mode,
          seed: run.seed,
          contentVersion: run.contentVersion,
          events: payload.events,
          activeDurationMs: payload.activeDurationMs,
          endReason: payload.endReason,
          renderMode: payload.renderMode,
        })
      } catch (err) {
        if (err instanceof RunVerificationError) {
          throw new ArcadeApiError(400, err.code, err.message)
        }
        throw err
      }

      // Previous finalized run of same (participantId, gameId, mode)
      const prevFinalized = [...this.state.runs]
        .filter(
          (r) =>
            r.participantId === participant.id &&
            r.gameId === run.gameId &&
            r.mode === run.mode &&
            r.status === 'finalized' &&
            r.actionSummary !== null,
        )
        .sort((a, b) => Date.parse(b.finalizedAt!) - Date.parse(a.finalizedAt!))[0]
      const previousActionSummary = prevFinalized?.actionSummary ?? null

      const finalizedAt = now.toISOString()
      const prog = this.getOrCreateProgress(participant.id, run.gameId)
      prog.finalizedAttemptCount += 1

      if (run.mode === 'standard') {
        if (prog.standardBestScore === null || verified.score > prog.standardBestScore) {
          prog.standardBestScore = verified.score
          prog.standardBestAchievedAt = finalizedAt
        }
      } else {
        if (prog.assistedBestScore === null || verified.score > prog.assistedBestScore) {
          prog.assistedBestScore = verified.score
        }
      }

      let newlyLitSocket = false
      let newlyLitControlLamp = false
      if (verified.cleared && !prog.firstClearedAt) {
        prog.firstClearedAt = finalizedAt
        if (isRequiredGameId(run.gameId)) {
          newlyLitSocket = true
        } else {
          newlyLitControlLamp = true
        }
      }

      // Update first_item_responses (first exposure + first actual selection)
      for (const itemOutcome of verified.itemOutcomes) {
        const existing = this.state.firstItemResponses.find(
          (r) =>
            r.participantId === participant.id &&
            r.contentVersion === run.contentVersion &&
            r.gameId === itemOutcome.gameId &&
            r.itemId === itemOutcome.itemId,
        )
        if (!existing) {
          this.state.firstItemResponses.push({
            participantId: participant.id,
            contentVersion: run.contentVersion,
            gameId: itemOutcome.gameId,
            itemId: itemOutcome.itemId,
            firstOutcome: itemOutcome.firstOutcome,
            isCorrect: itemOutcome.selectedIsCorrect,
            firstExposedAt: finalizedAt,
            firstSelectedAt: itemOutcome.selectedIsCorrect !== null ? finalizedAt : null,
          })
        } else if (existing.isCorrect === null && itemOutcome.selectedIsCorrect !== null) {
          existing.isCorrect = itemOutcome.selectedIsCorrect
          existing.firstSelectedAt = finalizedAt
        }
      }

      const progressByGame = this.getProgressMap(participant.id)
      const litSockets: Record<string, boolean> = {}
      let requiredClearedCount = 0
      for (const gid of REQUIRED_GAME_ORDER) {
        const lit = Boolean(progressByGame[gid]?.firstClearedAt)
        litSockets[gid] = lit
        if (lit) requiredClearedCount += 1
      }

      let newlyEarnedBadge = false
      if (
        requiredClearedCount === REQUIRED_GAME_ORDER.length &&
        !participant.onboardingCompletedAt
      ) {
        participant.onboardingCompletedAt = finalizedAt
        participant.dueDateAtCompletion = participant.recommendedDueDate
        newlyEarnedBadge = true
      }

      const personalBestScore =
        run.mode === 'standard'
          ? (prog.standardBestScore ?? verified.score)
          : (prog.assistedBestScore ?? verified.score)
      const recommendation = computeLobbyRecommendation(progressByGame)

      const response: FinalizeRunResult = {
        runId: run.id,
        gameId: run.gameId,
        mode: run.mode,
        score: verified.score,
        cleared: verified.cleared,
        activeDurationMs: verified.activeDurationMs,
        actionSummary: verified.actionSummary,
        previousActionSummary,
        personalBestScore,
        standardBestScore: prog.standardBestScore,
        assistedBestScore: prog.assistedBestScore,
        newlyLitSocket,
        newlyLitControlLamp,
        newlyEarnedBadge,
        requiredClearedCount,
        badgeEarned: Boolean(participant.onboardingCompletedAt),
        controlLampLit: Boolean(progressByGame[BONUS_GAME_ID]?.firstClearedAt),
        litSockets,
        recommendation,
      }

      run.status = 'finalized'
      run.finalizedAt = finalizedAt
      run.endReason = payload.endReason
      run.renderMode = payload.renderMode ?? null
      run.activeDurationMs = verified.activeDurationMs
      run.score = verified.score
      run.cleared = verified.cleared
      run.actionSummary = verified.actionSummary
      run.finalizedResponse = response
      this.persist()

      return response
    })
  }

  getLeaderboard(token: string | undefined, rawGameId: string) {
    const caller = this.authenticateParticipantSession(token)
    if (!isRequiredGameId(rawGameId)) {
      throw new ArcadeApiError(
        400,
        'INVALID_LEADERBOARD_GAME',
        '랭킹은 필수 게임 5종에 대해서만 제공됩니다.',
      )
    }
    const gameId = rawGameId
    const lv = this.state.learningVersions.find((v) => v.id === caller.learningVersionId)!
    const sameVersionParticipantMap = new Map(
      this.state.participants
        .filter((p) => p.learningVersionId === caller.learningVersionId)
        .map((p) => [p.id, p]),
    )

    const ranked = this.state.progress
      .filter(
        (prog) =>
          prog.gameId === gameId &&
          prog.standardBestScore !== null &&
          prog.standardBestAchievedAt !== null &&
          sameVersionParticipantMap.has(prog.participantId),
      )
      .sort((a, b) => {
        if (b.standardBestScore! !== a.standardBestScore!) {
          return b.standardBestScore! - a.standardBestScore!
        }
        const tDiff =
          Date.parse(a.standardBestAchievedAt!) - Date.parse(b.standardBestAchievedAt!)
        if (tDiff !== 0) return tDiff
        return a.participantId.localeCompare(b.participantId)
      })
      .map((prog, idx) => {
        const p = sameVersionParticipantMap.get(prog.participantId)!
        return {
          rank: idx + 1,
          participantId: p.id,
          nickname: p.nickname ?? '익명 도전자',
          score: prog.standardBestScore!,
          achievedAt: prog.standardBestAchievedAt!,
          cleared: Boolean(prog.firstClearedAt),
          isMe: p.id === caller.id,
        }
      })

    const myFullEntry = ranked.find((r) => r.participantId === caller.id) ?? null
    const callerProg = this.state.progress.find(
      (p) => p.participantId === caller.id && p.gameId === gameId,
    )

    return {
      gameId,
      gameTitle: GAME_CATALOG[gameId].title,
      ruleVersion: lv.ruleVersion,
      contentVersion: lv.contentVersion,
      top10: ranked.slice(0, 10).map(({ participantId: _pid, ...pub }) => pub),
      totalRankedCount: ranked.length,
      myStanding: myFullEntry
        ? {
            rank: myFullEntry.rank,
            score: myFullEntry.score,
            achievedAt: myFullEntry.achievedAt,
            nickname: myFullEntry.nickname,
          }
        : null,
      assistedBestScore: callerProg?.assistedBestScore ?? null,
      noStandardScoreNotice: myFullEntry
        ? null
        : '아직 이 게임의 기본 속도(정규 모드) 기록이 없습니다. 기본 속도로 완주하면 TOP 10 순위가 집계됩니다.',
    }
  }

  registerParticipantByAdmin(input: {
    rosterRef: string
    availableFromDate?: string
    recommendedDueDate?: string | null
    contentVersion?: string
  }) {
    const now = this.clock()
    const rosterRef = input.rosterRef.trim()
    if (!rosterRef || rosterRef.length > 40) {
      throw new ArcadeApiError(400, 'INVALID_ROSTER_REF', '관리번호를 입력해 주세요.')
    }
    if (this.state.participants.some((p) => p.rosterRef === rosterRef)) {
      throw new ArcadeApiError(409, 'DUPLICATE_ROSTER_REF', '이미 등록된 관리번호입니다.')
    }

    const availableFromDate = input.availableFromDate || toKstDateString(now)
    const recommendedDueDate = input.recommendedDueDate || null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(availableFromDate)) {
      throw new ArcadeApiError(400, 'INVALID_START_DATE', '시작일 형식이 올바르지 않습니다.')
    }
    if (recommendedDueDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(recommendedDueDate)) {
        throw new ArcadeApiError(400, 'INVALID_DUE_DATE', '권장 완료일 형식이 올바르지 않습니다.')
      }
      if (recommendedDueDate < availableFromDate) {
        throw new ArcadeApiError(
          400,
          'DUE_BEFORE_START',
          '권장 완료일은 개인 시작일과 같거나 이후여야 합니다.',
        )
      }
    }

    let lv = this.state.learningVersions[0]!
    if (input.contentVersion && input.contentVersion !== lv.contentVersion) {
      assertContentAssignable(input.contentVersion, {
        requireApproved: this.requireApprovedContent,
      })
      let found = this.state.learningVersions.find(
        (v) =>
          v.ruleVersion === CURRENT_RULE_VERSION && v.contentVersion === input.contentVersion,
      )
      if (!found) {
        found = {
          id: `lv-${input.contentVersion}-${CURRENT_RULE_VERSION}`,
          ruleVersion: CURRENT_RULE_VERSION,
          contentVersion: input.contentVersion,
          publishedAt: now.toISOString(),
        }
        this.state.learningVersions.push(found)
      }
      lv = found
    } else {
      assertContentAssignable(lv.contentVersion, {
        requireApproved: this.requireApprovedContent,
      })
    }

    // Generate globally unique personal code
    let generated = generateParticipantCode()
    let digest = computeCodeLookupDigest(generated.raw)
    while (this.state.credentials.some((c) => c.lookupDigest === digest)) {
      generated = generateParticipantCode()
      digest = computeCodeLookupDigest(generated.raw)
    }

    const participant: StoredParticipant = {
      id: randomUUID(),
      learningVersionId: lv.id,
      rosterRef,
      nickname: null,
      nicknameKey: null,
      availableFromDate,
      recommendedDueDate,
      firstSeenAt: null,
      lastSeenAt: null,
      firstPlayedAt: null,
      onboardingCompletedAt: null,
      dueDateAtCompletion: null,
      createdAt: now.toISOString(),
    }
    this.state.participants.push(participant)
    this.state.credentials.push({
      id: randomUUID(),
      participantId: participant.id,
      lookupDigest: digest,
      generation: 1,
      expiresAt: null,
      revokedAt: null,
      createdAt: now.toISOString(),
    })
    this.persist()

    return {
      participantId: participant.id,
      rosterRef: participant.rosterRef,
      availableFromDate: participant.availableFromDate,
      recommendedDueDate: participant.recommendedDueDate,
      issuedCodeOnce: generated.formatted,
      generation: 1,
    }
  }

  updateParticipantByAdmin(
    participantId: string,
    patch: {
      availableFromDate?: string
      recommendedDueDate?: string | null
      nickname?: string
    },
  ) {
    const participant = this.state.participants.find((p) => p.id === participantId)
    if (!participant) {
      throw new ArcadeApiError(404, 'PARTICIPANT_NOT_FOUND', '참가자를 찾을 수 없습니다.')
    }

    if (
      patch.availableFromDate !== undefined &&
      patch.availableFromDate !== participant.availableFromDate
    ) {
      if (participant.firstPlayedAt) {
        throw new ArcadeApiError(
          400,
          'START_DATE_LOCKED',
          '첫 게임을 시작한 이후에는 개인 시작일을 변경할 수 없으며 권장 완료일만 조정할 수 있습니다.',
        )
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.availableFromDate)) {
        throw new ArcadeApiError(400, 'INVALID_START_DATE', '시작일 형식이 올바르지 않습니다.')
      }
      participant.availableFromDate = patch.availableFromDate
    }

    if (patch.recommendedDueDate !== undefined) {
      const nextDue = patch.recommendedDueDate || null
      if (nextDue) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDue)) {
          throw new ArcadeApiError(400, 'INVALID_DUE_DATE', '권장 완료일 형식이 올바르지 않습니다.')
        }
        if (nextDue < participant.availableFromDate) {
          throw new ArcadeApiError(
            400,
            'DUE_BEFORE_START',
            '권장 완료일은 개인 시작일과 같거나 이후여야 합니다.',
          )
        }
      }
      participant.recommendedDueDate = nextDue
      // Note: dueDateAtCompletion is intentionally preserved if already completed!
    }

    if (patch.nickname !== undefined) {
      const checked = validateAndNormalizeNickname(patch.nickname)
      if (!checked.valid) {
        throw new ArcadeApiError(400, 'INVALID_NICKNAME', checked.error!)
      }
      const dup = this.state.participants.find(
        (p) => p.id !== participant.id && p.nicknameKey === checked.key,
      )
      if (dup) {
        throw new ArcadeApiError(409, 'DUPLICATE_NICKNAME', '이미 사용 중인 닉네임입니다.')
      }
      participant.nickname = checked.display
      participant.nicknameKey = checked.key
    }

    this.persist()
    return { participantId: participant.id }
  }

  reissueParticipantCodeByAdmin(participantId: string): {
    participantId: string
    rosterRef: string
    issuedCodeOnce: string
    generation: number
  } {
    const participant = this.state.participants.find((p) => p.id === participantId)
    if (!participant) {
      throw new ArcadeApiError(404, 'PARTICIPANT_NOT_FOUND', '참가자를 찾을 수 없습니다.')
    }
    const nowIso = this.clock().toISOString()

    let maxGen = 0
    for (const cred of this.state.credentials) {
      if (cred.participantId === participantId) {
        if (cred.generation > maxGen) maxGen = cred.generation
        if (!cred.revokedAt) cred.revokedAt = nowIso
      }
    }
    for (const sess of this.state.sessions) {
      if (sess.participantId === participantId && !sess.revokedAt) {
        sess.revokedAt = nowIso
      }
    }

    let generated = generateParticipantCode()
    let digest = computeCodeLookupDigest(generated.raw)
    while (this.state.credentials.some((c) => c.lookupDigest === digest)) {
      generated = generateParticipantCode()
      digest = computeCodeLookupDigest(generated.raw)
    }

    const nextGen = maxGen + 1
    this.state.credentials.push({
      id: randomUUID(),
      participantId,
      lookupDigest: digest,
      generation: nextGen,
      expiresAt: null,
      revokedAt: null,
      createdAt: nowIso,
    })
    this.persist()

    return {
      participantId,
      rosterRef: participant.rosterRef,
      issuedCodeOnce: generated.formatted,
      generation: nextGen,
    }
  }

  queryAdminParticipants(filters: {
    startFrom?: string
    startTo?: string
    search?: string
    learningStatus?: ParticipantLearningStatus | ''
    dueStatus?: ParticipantDueStatus | ''
  } = {}) {
    const now = this.clock()
    const rows = this.state.participants.map((p) => {
      const lv = this.state.learningVersions.find((v) => v.id === p.learningVersionId)!
      const progMap = this.getProgressMap(p.id)
      const hasAnyRun = this.state.runs.some((r) => r.participantId === p.id)
      const learningStatus = computeParticipantLearningStatus({
        availableFromDate: p.availableFromDate,
        firstSeenAt: p.firstSeenAt,
        hasAnyStartedOrFinalizedRun: hasAnyRun,
        onboardingCompletedAt: p.onboardingCompletedAt,
        now,
      })
      const dueStatus = computeParticipantDueStatus({
        recommendedDueDate: p.recommendedDueDate,
        onboardingCompletedAt: p.onboardingCompletedAt,
        dueDateAtCompletion: p.dueDateAtCompletion,
        now,
      })

      const requiredGames = Object.fromEntries(
        REQUIRED_GAME_ORDER.map((gid) => {
          const gp = progMap[gid]
          return [
            gid,
            {
              standardBestScore: gp?.standardBestScore ?? null,
              assistedBestScore: gp?.assistedBestScore ?? null,
              cleared: Boolean(gp?.firstClearedAt),
              firstClearedAt: gp?.firstClearedAt ?? null,
              attempts: gp?.finalizedAttemptCount ?? 0,
            },
          ]
        }),
      ) as Record<
        string,
        {
          standardBestScore: number | null
          assistedBestScore: number | null
          cleared: boolean
          firstClearedAt: string | null
          attempts: number
        }
      >

      const totalFinalizedAttempts = ALL_GAME_IDS.reduce(
        (sum, gid) => sum + (progMap[gid]?.finalizedAttemptCount ?? 0),
        0,
      )
      const requiredClearedCount = REQUIRED_GAME_ORDER.filter((gid) =>
        Boolean(progMap[gid]?.firstClearedAt),
      ).length
      const bonusCleared = Boolean(progMap[BONUS_GAME_ID]?.firstClearedAt)

      // Effective active duration of finalized required runs up to onboarding completion
      const completedAtMs = p.onboardingCompletedAt ? Date.parse(p.onboardingCompletedAt) : null
      const effectiveDurationMs = completedAtMs
        ? this.state.runs
            .filter(
              (r) =>
                r.participantId === p.id &&
                isRequiredGameId(r.gameId) &&
                r.status === 'finalized' &&
                r.finalizedAt !== null &&
                Date.parse(r.finalizedAt) <= completedAtMs,
            )
            .reduce((acc, r) => acc + (r.activeDurationMs ?? 0), 0)
        : null

      return {
        id: p.id,
        rosterRef: p.rosterRef,
        nickname: p.nickname,
        availableFromDate: p.availableFromDate,
        recommendedDueDate: p.recommendedDueDate,
        dueDateAtCompletion: p.dueDateAtCompletion,
        learningStatus,
        learningStatusLabel: LEARNING_STATUS_LABELS[learningStatus],
        dueStatus,
        dueStatusLabel: DUE_STATUS_LABELS[dueStatus],
        firstSeenAt: p.firstSeenAt,
        lastSeenAt: p.lastSeenAt,
        firstPlayedAt: p.firstPlayedAt,
        onboardingCompletedAt: p.onboardingCompletedAt,
        canEditStartDate: !p.firstPlayedAt,
        requiredClearedCount,
        totalFinalizedAttempts,
        bonusCleared,
        effectiveDurationMs,
        ruleVersion: lv.ruleVersion,
        contentVersion: lv.contentVersion,
        isVirtualSample: Boolean(p.isVirtualSample),
        requiredGames,
      }
    })

    // Cohort pilot KPIs across all registered participants
    const startedCohort = rows.filter((r) => r.learningStatus !== 'before_start')
    const accessedInStarted = startedCohort.filter((r) => r.firstSeenAt !== null)
    const completedInAccessed = accessedInStarted.filter((r) => r.learningStatus === 'completed')

    // Past-due cohort: for completed use dueDateAtCompletion, for incomplete use recommendedDueDate
    const pastDueCohort = rows.filter((r) => {
      const effectiveDue = r.onboardingCompletedAt ? r.dueDateAtCompletion : r.recommendedDueDate
      if (!effectiveDue) return false
      return r.dueStatus === 'overdue' || r.dueStatus === 'completed_on_time' || r.dueStatus === 'completed_late'
        ? (r.onboardingCompletedAt
            ? Date.now() >= 0 // evaluate past-due cohort where effective due date has passed or already evaluated
            : true)
        : false
    }).filter((r) => {
      const effectiveDue = r.onboardingCompletedAt ? r.dueDateAtCompletion : r.recommendedDueDate
      if (!effectiveDue) return false
      return now.getTime() >= Date.parse(`${effectiveDue}T00:00:00+09:00`) + 24 * 60 * 60 * 1000
    })
    const onTimeInPastDue = pastDueCohort.filter((r) => r.dueStatus === 'completed_on_time')

    const durations = rows
      .map((r) => r.effectiveDurationMs)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b)
    const medianDurationMs =
      durations.length === 0
        ? null
        : durations.length % 2 === 1
          ? durations[(durations.length - 1) / 2]!
          : Math.round(
              (durations[durations.length / 2 - 1]! + durations[durations.length / 2]!) / 2,
            )

    // Retry analytics across finalized runs
    const finalizedRuns = this.state.runs.filter((r) => r.status === 'finalized')
    const retryStats = ALL_GAME_IDS.flatMap((gid) =>
      GAME_CATALOG[gid].allowedModes.map((mode) => {
        const subset = finalizedRuns.filter((r) => r.gameId === gid && r.mode === mode)
        const countGroup = (kind: AttemptKind) => {
          const matched = subset.filter((r) => r.attemptKind === kind)
          return {
            attempts: matched.length,
            uniqueParticipants: new Set(matched.map((r) => r.participantId)).size,
          }
        }
        const afterBadge = subset.filter((r) => r.afterBadgeAtStart)
        return {
          gameId: gid,
          gameTitle: GAME_CATALOG[gid].title,
          mode,
          firstAttempt: countGroup('first_attempt'),
          retryBeforeClear: countGroup('retry_before_clear'),
          retryAfterClear: countGroup('retry_after_clear'),
          afterBadge: {
            attempts: afterBadge.length,
            uniqueParticipants: new Set(afterBadge.map((r) => r.participantId)).size,
          },
        }
      }),
    )

    // Apply UI filters
    const searchLower = filters.search?.trim().toLowerCase() || ''
    const filtered = rows.filter((r) => {
      if (filters.startFrom && r.availableFromDate < filters.startFrom) return false
      if (filters.startTo && r.availableFromDate > filters.startTo) return false
      if (filters.learningStatus && r.learningStatus !== filters.learningStatus) return false
      if (filters.dueStatus && r.dueStatus !== filters.dueStatus) return false
      if (searchLower) {
        const hitRoster = r.rosterRef.toLowerCase().includes(searchLower)
        const hitNick = (r.nickname ?? '').toLowerCase().includes(searchLower)
        if (!hitRoster && !hitNick) return false
      }
      return true
    })

    return {
      storage: this.getStorageSummary(),
      kpis: {
        startedEligibleCount: startedCohort.length,
        accessedCount: accessedInStarted.length,
        accessRatePct:
          startedCohort.length > 0
            ? Math.round((accessedInStarted.length / startedCohort.length) * 1000) / 10
            : null,
        completedCount: completedInAccessed.length,
        completionRatePct:
          accessedInStarted.length > 0
            ? Math.round((completedInAccessed.length / accessedInStarted.length) * 1000) / 10
            : null,
        pastDueEligibleCount: pastDueCohort.length,
        onTimeCompletedInPastDueCount: onTimeInPastDue.length,
        onTimeCompletionRatePct:
          pastDueCohort.length > 0
            ? Math.round((onTimeInPastDue.length / pastDueCohort.length) * 1000) / 10
            : null,
        medianEffectiveDurationMs: medianDurationMs,
      },
      retryStats,
      participants: filtered,
    }
  }

  exportParticipantsCsv(filters: Parameters<ArcadeStore['queryAdminParticipants']>[0] = {}): string {
    const { participants } = this.queryAdminParticipants(filters)
    const headers = [
      '관리번호',
      '닉네임',
      '개인시작일',
      '권장완료일',
      '학습상태',
      '기한상태',
      '최초접속시각',
      '최근접속시각',
      '최초플레이시각',
      '온보딩완료시각',
      '타자_정규최고점',
      '타자_클리어',
      '타자_확정시도수',
      '뱀_정규최고점',
      '뱀_클리어',
      '뱀_확정시도수',
      '슈팅_정규최고점',
      '슈팅_클리어',
      '슈팅_확정시도수',
      '레이싱_정규최고점',
      '레이싱_클리어',
      '레이싱_확정시도수',
      '핀볼_정규최고점',
      '핀볼_클리어',
      '핀볼_확정시도수',
      '전체확정시도수',
      '보너스완료',
    ]

    const lines = [headers.map(sanitizeCsvCell).join(',')]
    for (const p of participants) {
      const g = p.requiredGames
      const row = [
        p.rosterRef,
        p.nickname ?? '',
        p.availableFromDate,
        p.recommendedDueDate ?? '',
        p.learningStatusLabel,
        p.dueStatusLabel,
        p.firstSeenAt ?? '',
        p.lastSeenAt ?? '',
        p.firstPlayedAt ?? '',
        p.onboardingCompletedAt ?? '',
        g.typing?.standardBestScore ?? '',
        g.typing?.cleared ? 'Y' : 'N',
        g.typing?.attempts ?? 0,
        g.snake?.standardBestScore ?? '',
        g.snake?.cleared ? 'Y' : 'N',
        g.snake?.attempts ?? 0,
        g.shooter?.standardBestScore ?? '',
        g.shooter?.cleared ? 'Y' : 'N',
        g.shooter?.attempts ?? 0,
        g.racing?.standardBestScore ?? '',
        g.racing?.cleared ? 'Y' : 'N',
        g.racing?.attempts ?? 0,
        g.pinball?.standardBestScore ?? '',
        g.pinball?.cleared ? 'Y' : 'N',
        g.pinball?.attempts ?? 0,
        p.totalFinalizedAttempts,
        p.bonusCleared ? 'Y' : 'N',
      ]
      lines.push(row.map(sanitizeCsvCell).join(','))
    }

    return `\uFEFF${lines.join('\r\n')}`
  }

  getAdminLearningInsights(contentVersion: string = DEFAULT_PILOT_CONTENT_VERSION) {
    const bundle = getContentBundle(contentVersion)
    const responses = this.state.firstItemResponses.filter(
      (r) => r.contentVersion === contentVersion,
    )

    const items = [
      ...bundle.shooterQuestions.map((q) => {
        const coreRec = bundle.records[q.correct_id]!
        return {
          gameId: 'shooter' as const,
          gameTitle: GAME_CATALOG.shooter.title,
          itemId: q.id,
          prompt: q.prompt,
          coreCode: q.coreCode,
          coreName: coreRec.display_ko,
        }
      }),
      ...bundle.controlRoomStages.map((s) => {
        const coreRec = bundle.records[s.recordId]!
        return {
          gameId: 'control-room' as const,
          gameTitle: GAME_CATALOG['control-room'].title,
          itemId: s.clueId,
          prompt: s.cluePrompt,
          coreCode: s.correctPanelCode,
          coreName: coreRec.display_ko,
        }
      }),
    ]

    const evaluated = items.map((meta) => {
      const itemRows = responses.filter(
        (r) => r.gameId === meta.gameId && r.itemId === meta.itemId,
      )
      const rawExposureCount = itemRows.length
      const rawTimeoutCount = itemRows.filter((r) => r.firstOutcome === 'timeout').length
      const selectedRows = itemRows.filter((r) => r.isCorrect !== null)
      const rawResponderCount = selectedRows.length
      const rawWrongCount = selectedRows.filter((r) => r.isCorrect === false).length

      const selectionSampleSufficient = rawResponderCount >= 5
      const timeoutSampleSufficient = meta.gameId === 'shooter' && rawExposureCount >= 5

      const wrongRatePct = selectionSampleSufficient
        ? Math.round((rawWrongCount / rawResponderCount) * 1000) / 10
        : null

      return {
        gameId: meta.gameId,
        gameTitle: meta.gameTitle,
        contentVersion,
        itemId: meta.itemId,
        prompt: meta.prompt,
        coreCode: meta.coreCode,
        coreName: meta.coreName,
        selectionSampleSufficient,
        responderCount: selectionSampleSufficient ? rawResponderCount : null,
        wrongCount: selectionSampleSufficient ? rawWrongCount : null,
        wrongRatePct,
        hasTimeoutColumn: meta.gameId === 'shooter',
        timeoutSampleSufficient,
        firstExposureTimeoutCount:
          meta.gameId === 'shooter'
            ? timeoutSampleSufficient
              ? rawTimeoutCount
              : null
            : null,
      }
    })

    // Sort: wrongRatePct DESC (sufficient samples first), tie-breaker responderCount DESC
    evaluated.sort((a, b) => {
      if (a.selectionSampleSufficient !== b.selectionSampleSufficient) {
        return a.selectionSampleSufficient ? -1 : 1
      }
      if (a.wrongRatePct !== null && b.wrongRatePct !== null && b.wrongRatePct !== a.wrongRatePct) {
        return b.wrongRatePct - a.wrongRatePct
      }
      if (
        a.responderCount !== null &&
        b.responderCount !== null &&
        b.responderCount !== a.responderCount
      ) {
        return b.responderCount - a.responderCount
      }
      return a.itemId.localeCompare(b.itemId)
    })

    return {
      contentVersion,
      isSampleContent: bundle.isSample,
      sampleThreshold: 5,
      items: evaluated,
    }
  }
}

let defaultSingletonStore: ArcadeStore | null = null

export function getDefaultArcadeStore(): ArcadeStore {
  if (!defaultSingletonStore) {
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
    const filePath = isServerless
      ? '/tmp/ls-way-arcade-v04-db.json'
      : '.data/ls-way-arcade-v04-db.json'
    const requireApprovedContent = process.env.ARCADE_ENV === 'production'
    defaultSingletonStore = new ArcadeStore({
      filePath,
      requireApprovedContent,
    })
  }
  return defaultSingletonStore
}
