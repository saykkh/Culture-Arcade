import {
  createAdminSessionToken,
  signJsonPayload,
  verifyAdminSessionToken,
  verifySignedJsonPayload,
} from './crypto.js'
import {
  ArcadeApiError,
  ArcadeStore,
  type EphemeralParticipantSync,
  getDefaultArcadeStore,
  SAMPLE_VIRTUAL_CODES,
} from './store.js'
import type {
  GameMode,
  GameRunEvent,
  ParticipantDueStatus,
  ParticipantLearningStatus,
  RunEndReason,
} from '../src/domain/types.js'

export const PARTICIPANT_COOKIE_NAME = 'arcade_session'
export const PARTICIPANT_SYNC_COOKIE_NAME = 'arcade_ephemeral_sync'
export const ADMIN_COOKIE_NAME = 'arcade_admin_session'

export interface HttpApiRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

export interface HttpApiResponse {
  status: number
  headers: Record<string, string | string[]>
  body: string
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {}
  const result: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=')
    if (idx > 0) {
      const k = part.slice(0, idx).trim()
      const v = part.slice(idx + 1).trim()
      result[k] = decodeURIComponent(v)
    }
  }
  return result
}

function buildCookieHeader(
  name: string,
  value: string,
  maxAgeSec: number,
  isSecure: boolean,
): string {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ]
  if (isSecure) {
    attrs.push('Secure')
  }
  return attrs.join('; ')
}

function isHttpsRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const proto = headers['x-forwarded-proto']
  if (typeof proto === 'string' && proto.includes('https')) return true
  return process.env.NODE_ENV === 'production'
}

function getHeaderString(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const val = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(val)) return val[0]
  return val
}

function jsonResponse(
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string | string[]> = {},
): HttpApiResponse {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  }
}

function getExpectedAdminPassword(): { password: string; usingDevFallback: boolean } {
  const configured = process.env.ARCADE_ADMIN_PASSWORD
  if (configured && configured.trim().length > 0) {
    return { password: configured.trim(), usingDevFallback: false }
  }
  if (process.env.ARCADE_ENV === 'production') {
    throw new ArcadeApiError(
      503,
      'ADMIN_NOT_CONFIGURED',
      '운영 환경의 ARCADE_ADMIN_PASSWORD가 설정되지 않았습니다.',
    )
  }
  return { password: 'lsway-admin-dev', usingDevFallback: true }
}

function requireAdminAuth(cookies: Record<string, string>): void {
  const adminToken = cookies[ADMIN_COOKIE_NAME]
  if (!verifyAdminSessionToken(adminToken)) {
    throw new ArcadeApiError(403, 'ADMIN_FORBIDDEN', '관리자 인증이 필요합니다.')
  }
}

export async function handleApiRequest(
  req: HttpApiRequest,
  store: ArcadeStore = getDefaultArcadeStore(),
): Promise<HttpApiResponse> {
  const parsedUrl = new URL(req.url, 'http://localhost')
  const rewrittenPath = parsedUrl.searchParams.get('__path')
  const pathname =
    rewrittenPath && rewrittenPath.startsWith('/api/') ? rewrittenPath : parsedUrl.pathname
  const method = req.method.toUpperCase()
  const cookies = parseCookies(getHeaderString(req.headers, 'cookie'))
  const secureCookie = isHttpsRequest(req.headers)
  const clientIp =
    getHeaderString(req.headers, 'x-forwarded-for')?.split(',')[0]?.trim() || 'local'

  const sessionToken = cookies[PARTICIPANT_COOKIE_NAME]
  const incomingSync = verifySignedJsonPayload<EphemeralParticipantSync>(
    cookies[PARTICIPANT_SYNC_COOKIE_NAME],
  )
  if (sessionToken && incomingSync) {
    store.hydrateFromEphemeralSync(sessionToken, incomingSync)
  }

  const withSyncCookie = (token: string | undefined): Record<string, string | string[]> => {
    const sync = store.exportEphemeralSync(token)
    if (!sync) return {}
    return {
      'Set-Cookie': buildCookieHeader(
        PARTICIPANT_SYNC_COOKIE_NAME,
        signJsonPayload(sync),
        43_200,
        secureCookie,
      ),
    }
  }

  try {
    // 1. POST /api/session/code
    if (method === 'POST' && pathname === '/api/session/code') {
      const body = (req.body ?? {}) as { code?: string }
      const result = store.loginWithPersonalCode(String(body.code ?? ''), clientIp)
      const sync = store.exportEphemeralSync(result.sessionToken)
      const setCookies = [
        buildCookieHeader(
          PARTICIPANT_COOKIE_NAME,
          result.sessionToken,
          43_200,
          secureCookie,
        ),
      ]
      if (sync) {
        setCookies.push(
          buildCookieHeader(
            PARTICIPANT_SYNC_COOKIE_NAME,
            signJsonPayload(sync),
            43_200,
            secureCookie,
          ),
        )
      }
      return jsonResponse(
        200,
        {
          requiresNickname: result.requiresNickname,
          beforeStartDate: result.beforeStartDate,
          availableFromDate: result.availableFromDate,
          nickname: result.nickname,
        },
        { 'Set-Cookie': setCookies },
      )
    }

    // 2. POST /api/session/logout
    if (method === 'POST' && pathname === '/api/session/logout') {
      store.logoutParticipantSession(cookies[PARTICIPANT_COOKIE_NAME])
      return jsonResponse(
        200,
        { ok: true },
        {
          'Set-Cookie': [
            buildCookieHeader(PARTICIPANT_COOKIE_NAME, '', 0, secureCookie),
            buildCookieHeader(PARTICIPANT_SYNC_COOKIE_NAME, '', 0, secureCookie),
          ],
        },
      )
    }

    // 3. GET /api/session/sample-info (non-production helper banner metadata; never exposes real participant codes)
    if (method === 'GET' && pathname === '/api/session/sample-info') {
      const storage = store.getStorageSummary()
      return jsonResponse(200, {
        isSampleEnvironment: !storage.requireApprovedContent,
        sampleNotice: storage.isSampleContent
          ? '개발·Preview 샘플 환경 · 가상 참가자 코드로 전체 흐름을 시험할 수 있습니다.'
          : null,
        virtualSamples: !storage.requireApprovedContent
          ? [
              {
                rosterRef: 'TEST-1111',
                code: SAMPLE_VIRTUAL_CODES.QUICK_TEST,
                description: '테스트 빠른 입장 코드 (111111111111)',
              },
              {
                rosterRef: 'DEV-001',
                code: SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY,
                description: '즉시 플레이 가능 (시작일 경과)',
              },
              {
                rosterRef: 'DEV-002',
                code: SAMPLE_VIRTUAL_CODES.FUTURE_START,
                description: '시작일 전 안내 확인용 (2099-01-01 시작)',
              },
            ]
          : [],
      })
    }

    // 4. PATCH /api/me/nickname
    if (method === 'PATCH' && pathname === '/api/me/nickname') {
      const body = (req.body ?? {}) as { nickname?: string }
      const updated = store.setParticipantNickname(
        cookies[PARTICIPANT_COOKIE_NAME],
        String(body.nickname ?? ''),
      )
      return jsonResponse(200, updated, withSyncCookie(cookies[PARTICIPANT_COOKIE_NAME]))
    }

    // 5. GET /api/me
    if (method === 'GET' && pathname === '/api/me') {
      const me = store.getParticipantMe(cookies[PARTICIPANT_COOKIE_NAME])
      return jsonResponse(200, me)
    }

    // 6. POST /api/games/[gameId]/runs
    const startRunMatch = pathname.match(/^\/api\/games\/([a-z0-9-]+)\/runs$/)
    if (method === 'POST' && startRunMatch) {
      const gameId = startRunMatch[1]!
      const body = (req.body ?? {}) as { mode?: GameMode }
      const mode: GameMode = body.mode === 'assisted' ? 'assisted' : 'standard'
      const created = await store.startGameRun(cookies[PARTICIPANT_COOKIE_NAME], gameId, mode)
      return jsonResponse(201, created, withSyncCookie(cookies[PARTICIPANT_COOKIE_NAME]))
    }

    // 7. PUT /api/runs/[runId]/result
    const finishRunMatch = pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/result$/i)
    if (method === 'PUT' && finishRunMatch) {
      const runId = finishRunMatch[1]!
      const body = (req.body ?? {}) as {
        events?: GameRunEvent[]
        activeDurationMs?: number
        endReason?: RunEndReason
      }
      const finalized = await store.finalizeGameRun(cookies[PARTICIPANT_COOKIE_NAME], runId, {
        events: Array.isArray(body.events) ? body.events : [],
        activeDurationMs: Number(body.activeDurationMs ?? 0),
        endReason: (body.endReason ?? 'time_up') as RunEndReason,
      })
      return jsonResponse(200, finalized, withSyncCookie(cookies[PARTICIPANT_COOKIE_NAME]))
    }

    // 8. GET /api/leaderboards/[gameId]
    const leaderboardMatch = pathname.match(/^\/api\/leaderboards\/([a-z0-9-]+)$/)
    if (method === 'GET' && leaderboardMatch) {
      const gameId = leaderboardMatch[1]!
      const board = store.getLeaderboard(cookies[PARTICIPANT_COOKIE_NAME], gameId)
      return jsonResponse(200, board)
    }

    // 9. Admin session endpoints
    if (pathname === '/api/admin/session') {
      if (method === 'GET') {
        const authenticated = verifyAdminSessionToken(cookies[ADMIN_COOKIE_NAME])
        const storage = store.getStorageSummary()
        return jsonResponse(200, {
          authenticated,
          isSampleEnvironment: !storage.requireApprovedContent,
        })
      }
      if (method === 'POST') {
        const body = (req.body ?? {}) as { password?: string }
        const expected = getExpectedAdminPassword()
        if (String(body.password ?? '') !== expected.password) {
          throw new ArcadeApiError(
            401,
            'INVALID_ADMIN_CREDENTIALS',
            '관리자 비밀번호가 올바르지 않습니다.',
          )
        }
        const token = createAdminSessionToken()
        return jsonResponse(
          200,
          { authenticated: true, usingDevFallback: expected.usingDevFallback },
          {
            'Set-Cookie': buildCookieHeader(ADMIN_COOKIE_NAME, token, 43_200, secureCookie),
          },
        )
      }
      if (method === 'DELETE') {
        return jsonResponse(
          200,
          { authenticated: false },
          {
            'Set-Cookie': buildCookieHeader(ADMIN_COOKIE_NAME, '', 0, secureCookie),
          },
        )
      }
    }

    // All remaining /api/admin/* require verified admin cookie (participant cookies never accepted)
    if (pathname.startsWith('/api/admin/')) {
      requireAdminAuth(cookies)

      if (method === 'GET' && pathname === '/api/admin/participants/export.csv') {
        const csv = store.exportParticipantsCsv({
          startFrom: parsedUrl.searchParams.get('startFrom') || undefined,
          startTo: parsedUrl.searchParams.get('startTo') || undefined,
          search: parsedUrl.searchParams.get('search') || undefined,
          learningStatus: (parsedUrl.searchParams.get('learningStatus') ||
            '') as ParticipantLearningStatus | '',
          dueStatus: (parsedUrl.searchParams.get('dueStatus') || '') as ParticipantDueStatus | '',
        })
        return {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="ls-way-arcade-participants.csv"',
            'Cache-Control': 'no-store',
          },
          body: csv,
        }
      }

      if (method === 'GET' && pathname === '/api/admin/participants') {
        const data = store.queryAdminParticipants({
          startFrom: parsedUrl.searchParams.get('startFrom') || undefined,
          startTo: parsedUrl.searchParams.get('startTo') || undefined,
          search: parsedUrl.searchParams.get('search') || undefined,
          learningStatus: (parsedUrl.searchParams.get('learningStatus') ||
            '') as ParticipantLearningStatus | '',
          dueStatus: (parsedUrl.searchParams.get('dueStatus') || '') as ParticipantDueStatus | '',
        })
        return jsonResponse(200, data)
      }

      if (method === 'POST' && pathname === '/api/admin/participants') {
        const body = (req.body ?? {}) as {
          rosterRef?: string
          availableFromDate?: string
          recommendedDueDate?: string | null
          contentVersion?: string
        }
        const created = store.registerParticipantByAdmin({
          rosterRef: String(body.rosterRef ?? ''),
          availableFromDate: body.availableFromDate,
          recommendedDueDate: body.recommendedDueDate,
          contentVersion: body.contentVersion,
        })
        return jsonResponse(201, created)
      }

      const reissueMatch = pathname.match(
        /^\/api\/admin\/participants\/([a-f0-9-]+)\/reissue-code$/i,
      )
      if (method === 'POST' && reissueMatch) {
        const reissued = store.reissueParticipantCodeByAdmin(reissueMatch[1]!)
        return jsonResponse(200, reissued)
      }

      const patchParticipantMatch = pathname.match(/^\/api\/admin\/participants\/([a-f0-9-]+)$/i)
      if (method === 'PATCH' && patchParticipantMatch) {
        const body = (req.body ?? {}) as {
          availableFromDate?: string
          recommendedDueDate?: string | null
          nickname?: string
        }
        const updated = store.updateParticipantByAdmin(patchParticipantMatch[1]!, body)
        return jsonResponse(200, updated)
      }

      if (method === 'GET' && pathname === '/api/admin/learning-insights') {
        const cv = parsedUrl.searchParams.get('contentVersion') || undefined
        const insights = store.getAdminLearningInsights(cv)
        return jsonResponse(200, insights)
      }
    }

    return jsonResponse(404, { code: 'NOT_FOUND', message: '요청한 API 경로를 찾을 수 없습니다.' })
  } catch (err) {
    if (err instanceof ArcadeApiError) {
      return jsonResponse(err.status, { code: err.code, message: err.message })
    }
    return jsonResponse(500, {
      code: 'INTERNAL_ERROR',
      message: '일시적인 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    })
  }
}
