import type {
  GameActionSummary,
  GameId,
  GameMode,
  GameRunEvent,
  ParticipantDueStatus,
  ParticipantLearningStatus,
  RecommendationBanner,
  RunEndReason,
} from '../domain/types'

export interface ParticipantGameSummary {
  gameId: GameId
  title: string
  allowedModes: readonly GameMode[]
  standardBestScore: number | null
  assistedBestScore: number | null
  firstClearedAt: string | null
  lastStartedAt: string | null
  finalizedAttemptCount: number
  latestAttempt?: {
    score: number
    cleared: boolean
    actionSummary: GameActionSummary
  } | null
  cleared: boolean
}

export interface ParticipantMeResponse {
  participantId: string
  nickname: string | null
  requiresNickname: boolean
  beforeStartDate: boolean
  availableFromDate: string
  recommendedDueDate: string | null
  onboardingCompletedAt: string | null
  ruleVersion: string
  contentVersion: string
  isSampleContent: boolean
  sampleNotice: string | null
  requiredClearedCount: number
  badgeEarned: boolean
  litSockets: Record<string, boolean>
  recommendation: RecommendationBanner
  games: ParticipantGameSummary[]
}

export interface StartRunResponse {
  runId: string
  gameId: GameId
  mode: GameMode
  seed: number
  ruleVersion: string
  contentVersion: string
  startedAt: string
  expiresAt: string
  attemptKind: 'first_attempt' | 'retry_before_clear' | 'retry_after_clear'
}

export interface FinalizeRunResponse {
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
  newlyEarnedBadge: boolean
  requiredClearedCount: number
  badgeEarned: boolean
  litSockets: Record<string, boolean>
  recommendation: RecommendationBanner
}

export interface PendingRunSubmission {
  participantId: string
  runId: string
  gameId: GameId
  mode: GameMode
  expiresAt: string
  events: GameRunEvent[]
  activeDurationMs: number
  endReason: RunEndReason
}

const PENDING_SUBMISSION_KEY = 'ls-way-arcade:pending-submission:v04'

export function savePendingSubmission(item: PendingRunSubmission): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PENDING_SUBMISSION_KEY, JSON.stringify(item))
  } catch {
    // Ignore localStorage quota failure
  }
}

export function loadPendingSubmission(participantId: string): PendingRunSubmission | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PENDING_SUBMISSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingRunSubmission
    if (parsed.participantId !== participantId) {
      return null
    }
    if (Date.now() > Date.parse(parsed.expiresAt)) {
      clearPendingSubmission()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearPendingSubmission(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PENDING_SUBMISSION_KEY)
  } catch {
    // Ignore
  }
}

export class ClientApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      ...init,
    })
  } catch {
    throw new ClientApiError(
      0,
      'NETWORK_ERROR',
      '네트워크 연결이 불안정합니다. 연결 확인 후 다시 시도해 주세요.',
    )
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new ClientApiError(
      res.status,
      String(data.code ?? 'API_ERROR'),
      String(data.message ?? '요청 처리 중 오류가 발생했습니다.'),
    )
  }
  return data as T
}

export const arcadeApi = {
  getSampleInfo: () =>
    requestJson<{
      isSampleEnvironment: boolean
      sampleNotice: string | null
      virtualSamples: Array<{ rosterRef: string; code: string; description: string }>
    }>('/api/session/sample-info'),

  loginWithCode: (code: string) =>
    requestJson<{
      requiresNickname: boolean
      beforeStartDate: boolean
      availableFromDate: string
      nickname: string | null
    }>('/api/session/code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  logout: async () => {
    clearPendingSubmission()
    await requestJson<{ ok: boolean }>('/api/session/logout', { method: 'POST' })
  },

  setNickname: (nickname: string) =>
    requestJson<{ nickname: string }>('/api/me/nickname', {
      method: 'PATCH',
      body: JSON.stringify({ nickname }),
    }),

  getMe: () => requestJson<ParticipantMeResponse>('/api/me'),

  startRun: (gameId: GameId, mode: GameMode) =>
    requestJson<StartRunResponse>(`/api/games/${gameId}/runs`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  submitRunResult: (
    runId: string,
    payload: {
      events: GameRunEvent[]
      activeDurationMs: number
      endReason: RunEndReason
    },
  ) =>
    requestJson<FinalizeRunResponse>(`/api/runs/${runId}/result`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getLeaderboard: (gameId: string) =>
    requestJson<{
      gameId: string
      gameTitle: string
      ruleVersion: string
      contentVersion: string
      top10: Array<{
        rank: number
        nickname: string
        score: number
        achievedAt: string
        cleared: boolean
        isMe: boolean
      }>
      totalRankedCount: number
      myStanding: {
        rank: number
        score: number
        achievedAt: string
        nickname: string
      } | null
      assistedBestScore: number | null
      noStandardScoreNotice: string | null
    }>(`/api/leaderboards/${gameId}`),

  getAdminSession: () =>
    requestJson<{ authenticated: boolean; isSampleEnvironment: boolean }>('/api/admin/session'),

  loginAdmin: (password: string) =>
    requestJson<{ authenticated: boolean; usingDevFallback: boolean }>('/api/admin/session', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  logoutAdmin: () =>
    requestJson<{ authenticated: boolean }>('/api/admin/session', { method: 'DELETE' }),

  getAdminParticipants: (params: {
    startFrom?: string
    startTo?: string
    search?: string
    learningStatus?: ParticipantLearningStatus | ''
    dueStatus?: ParticipantDueStatus | ''
  }) => {
    const qs = new URLSearchParams()
    if (params.startFrom) qs.set('startFrom', params.startFrom)
    if (params.startTo) qs.set('startTo', params.startTo)
    if (params.search) qs.set('search', params.search)
    if (params.learningStatus) qs.set('learningStatus', params.learningStatus)
    if (params.dueStatus) qs.set('dueStatus', params.dueStatus)
    return requestJson<{
      storage: {
        mode: string
        requireApprovedContent: boolean
        ruleVersion: string
        contentVersion: string
        isSampleContent: boolean
      }
      kpis: {
        startedEligibleCount: number
        accessedCount: number
        accessRatePct: number | null
        completedCount: number
        completionRatePct: number | null
        pastDueEligibleCount: number
        onTimeCompletedInPastDueCount: number
        onTimeCompletionRatePct: number | null
        medianEffectiveDurationMs: number | null
      }
      retryStats: Array<{
        gameId: string
        gameTitle: string
        mode: GameMode
        firstAttempt: { attempts: number; uniqueParticipants: number }
        retryBeforeClear: { attempts: number; uniqueParticipants: number }
        retryAfterClear: { attempts: number; uniqueParticipants: number }
        afterBadge: { attempts: number; uniqueParticipants: number }
      }>
      participants: Array<{
        id: string
        rosterRef: string
        nickname: string | null
        availableFromDate: string
        recommendedDueDate: string | null
        dueDateAtCompletion: string | null
        learningStatus: ParticipantLearningStatus
        learningStatusLabel: string
        dueStatus: ParticipantDueStatus
        dueStatusLabel: string
        firstSeenAt: string | null
        lastSeenAt: string | null
        firstPlayedAt: string | null
        onboardingCompletedAt: string | null
        canEditStartDate: boolean
        requiredClearedCount: number
        totalFinalizedAttempts: number
        effectiveDurationMs: number | null
        ruleVersion: string
        contentVersion: string
        isVirtualSample: boolean
        requiredGames: Record<
          string,
          {
            standardBestScore: number | null
            assistedBestScore: number | null
            cleared: boolean
            firstClearedAt: string | null
            attempts: number
          }
        >
      }>
    }>(`/api/admin/participants?${qs.toString()}`)
  },

  registerAdminParticipant: (body: {
    rosterRef: string
    availableFromDate?: string
    recommendedDueDate?: string | null
  }) =>
    requestJson<{
      participantId: string
      rosterRef: string
      availableFromDate: string
      recommendedDueDate: string | null
      issuedCodeOnce: string
      generation: number
    }>('/api/admin/participants', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAdminParticipant: (
    participantId: string,
    body: {
      availableFromDate?: string
      recommendedDueDate?: string | null
      nickname?: string
    },
  ) =>
    requestJson<{ participantId: string }>(`/api/admin/participants/${participantId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  reissueAdminParticipantCode: (participantId: string) =>
    requestJson<{
      participantId: string
      rosterRef: string
      issuedCodeOnce: string
      generation: number
    }>(`/api/admin/participants/${participantId}/reissue-code`, {
      method: 'POST',
    }),

  getAdminLearningInsights: (contentVersion?: string) => {
    const qs = contentVersion ? `?contentVersion=${encodeURIComponent(contentVersion)}` : ''
    return requestJson<{
      contentVersion: string
      isSampleContent: boolean
      sampleThreshold: number
      items: Array<{
        gameId: 'shooter'
        gameTitle: string
        contentVersion: string
        itemId: string
        prompt: string
        coreCode: string
        coreName: string
        selectionSampleSufficient: boolean
        responderCount: number | null
        wrongCount: number | null
        wrongRatePct: number | null
        hasTimeoutColumn: boolean
        timeoutSampleSufficient: boolean
        firstExposureTimeoutCount: number | null
      }>
    }>(`/api/admin/learning-insights${qs}`)
  },
}
