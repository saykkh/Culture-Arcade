import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertContentAssignable,
  buildTypingSchedule,
  SAMPLE_CONTENT_V04,
  validateContentBundle,
} from '../content'
import { ADMIN_COOKIE_NAME, handleApiRequest, PARTICIPANT_COOKIE_NAME } from '../server/router'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'

function extractCookieToken(setCookieHeader: string | string[] | undefined, cookieName: string): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : (setCookieHeader ?? '')
  const match = raw.match(new RegExp(`${cookieName}=([^;]+)`))
  return match ? decodeURIComponent(match[1]!) : ''
}

describe('Stage 1 · 공통 규칙과 데이터 검증', () => {
  it('샘플/승인 콘텐츠 분리 및 번들 정합성을 검증하고, 운영 환경에 미승인 콘텐츠 배정을 차단한다', () => {
    const report = validateContentBundle(SAMPLE_CONTENT_V04)
    expect(report.valid).toBe(true)
    expect(report.errors).toEqual([])
    expect(SAMPLE_CONTENT_V04.isSample).toBe(true)
    expect(SAMPLE_CONTENT_V04.approved).toBe(false)

    expect(() =>
      assertContentAssignable(SAMPLE_CONTENT_V04.contentVersion, { requireApproved: true }),
    ).toThrow(/unapproved sample content/i)
  })

  it('시작일 전(DEV-002)과 시작일 후(DEV-001) 가상 참가자를 구분하고 시작일 전 게임 시작을 잠근다', async () => {
    const fixedNow = new Date('2026-11-26T09:00:00.000Z')
    const store = new ArcadeStore({ filePath: null, clock: () => fixedNow })

    // 1) Future participant (DEV-002: 2099-01-01)
    const futureLogin = await handleApiRequest(
      {
        method: 'POST',
        url: '/api/session/code',
        headers: {},
        body: { code: SAMPLE_VIRTUAL_CODES.FUTURE_START },
      },
      store,
    )
    expect(futureLogin.status).toBe(200)
    const futureData = JSON.parse(futureLogin.body)
    expect(futureData.beforeStartDate).toBe(true)
    expect(futureData.availableFromDate).toBe('2099-01-01')

    const futureToken = extractCookieToken(
      futureLogin.headers['Set-Cookie'],
      PARTICIPANT_COOKIE_NAME,
    )
    const blockedStart = await handleApiRequest(
      {
        method: 'POST',
        url: '/api/games/typing/runs',
        headers: { cookie: `${PARTICIPANT_COOKIE_NAME}=${futureToken}` },
        body: { mode: 'standard' },
      },
      store,
    )
    expect(blockedStart.status).toBe(403)
    expect(JSON.parse(blockedStart.body).code).toBe('BEFORE_START_DATE')

    // Admin still sees future participant as '시작 전' even after early login
    const adminView = store.queryAdminParticipants({ search: 'DEV-002' })
    expect(adminView.participants[0]?.learningStatus).toBe('before_start')
    expect(adminView.participants[0]?.learningStatusLabel).toBe('시작 전')

    // 2) Active participant (DEV-001: 2026-11-20)
    const activeLogin = await handleApiRequest(
      {
        method: 'POST',
        url: '/api/session/code',
        headers: {},
        body: { code: 'lswy 2026 play' }, // lowercase + spaces normalized
      },
      store,
    )
    expect(activeLogin.status).toBe(200)
    const activeData = JSON.parse(activeLogin.body)
    expect(activeData.beforeStartDate).toBe(false)
    expect(activeData.requiresNickname).toBe(true)
  })

  it('다른 PC에서 동일 개인 코드로 접속 시 같은 참가자·진도를 복원하고, 중복 결과 제출을 방지한다', async () => {
    const fixedNow = new Date('2026-11-26T09:00:00.000Z')
    const store = new ArcadeStore({ filePath: null, clock: () => fixedNow })

    // PC #1 login + set nickname + clear typing in assisted mode on first run
    const loginPc1 = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-1')
    store.setParticipantNickname(loginPc1.sessionToken, '전선신입_01')

    const run = await store.startGameRun(loginPc1.sessionToken, 'typing', 'assisted')
    expect(run.mode).toBe('assisted')
    expect(run.attemptKind).toBe('first_attempt')

    const schedule = buildTypingSchedule(SAMPLE_CONTENT_V04, run.seed, run.mode)
    const events = schedule.slice(0, 10).map((slot, idx) => ({
      seq: idx + 1,
      t_ms: (idx + 1) * 2_000,
      type: 'submit_phrase' as const,
      slotId: slot.slotId,
      input: slot.displayKo,
    }))

    const firstSubmit = await store.finalizeGameRun(loginPc1.sessionToken, run.runId, {
      events,
      activeDurationMs: 25_000,
      endReason: 'completed_all',
    })
    expect(firstSubmit.cleared).toBe(true)
    expect(firstSubmit.score).toBe(1000)
    expect(firstSubmit.newlyLitSocket).toBe(true)
    expect(firstSubmit.requiredClearedCount).toBe(1)

    // Duplicate submission of the exact same runId must be idempotent (no double count, keeps exact response)
    const duplicateSubmit = await store.finalizeGameRun(loginPc1.sessionToken, run.runId, {
      events,
      activeDurationMs: 25_000,
      endReason: 'completed_all',
    })
    expect(duplicateSubmit).toEqual(firstSubmit)

    // PC #2 login with same personal code restores exact participant, nickname, and 1/5 cable progress
    const loginPc2 = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-2')
    expect(loginPc2.participantId).toBe(loginPc1.participantId)
    expect(loginPc2.requiresNickname).toBe(false)

    const mePc2 = store.getParticipantMe(loginPc2.sessionToken)
    expect(mePc2.nickname).toBe('전선신입_01')
    expect(mePc2.requiredClearedCount).toBe(1)
    expect(mePc2.litSockets.typing).toBe(true)
    const typingProgress = mePc2.games.find((g) => g.gameId === 'typing')
    expect(typingProgress?.finalizedAttemptCount).toBe(1)
    expect(typingProgress?.assistedBestScore).toBe(1000)

    // Code reissue immediately invalidates old sessions while preserving nickname & progress
    const reissued = store.reissueParticipantCodeByAdmin(loginPc1.participantId)
    expect(() => store.getParticipantMe(loginPc1.sessionToken)).toThrow(/무효화|재발급/)
    expect(() => store.getParticipantMe(loginPc2.sessionToken)).toThrow(/무효화|재발급/)

    const loginNewCode = store.loginWithPersonalCode(reissued.issuedCodeOnce, 'pc-2')
    const meRestored = store.getParticipantMe(loginNewCode.sessionToken)
    expect(meRestored.nickname).toBe('전선신입_01')
    expect(meRestored.requiredClearedCount).toBe(1)
  })

  it('일반 참가자 세션은 관리자 API(/api/admin/*) 접근이 거절되며 관리자 인증 후에만 허용된다', async () => {
    const store = new ArcadeStore({ filePath: null })
    const participantLogin = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'ip-1')

    const denied = await handleApiRequest(
      {
        method: 'GET',
        url: '/api/admin/participants',
        headers: { cookie: `${PARTICIPANT_COOKIE_NAME}=${participantLogin.sessionToken}` },
      },
      store,
    )
    expect(denied.status).toBe(403)

    const adminLogin = await handleApiRequest(
      {
        method: 'POST',
        url: '/api/admin/session',
        headers: {},
        body: { password: process.env.ARCADE_ADMIN_PASSWORD || 'lsway-admin-dev' },
      },
      store,
    )
    expect(adminLogin.status).toBe(200)
    const adminCookie = extractCookieToken(adminLogin.headers['Set-Cookie'], ADMIN_COOKIE_NAME)

    const allowed = await handleApiRequest(
      {
        method: 'GET',
        url: '/api/admin/participants',
        headers: { cookie: `${ADMIN_COOKIE_NAME}=${adminCookie}` },
      },
      store,
    )
    expect(allowed.status).toBe(200)
  })

  it('프로덕션 빌드 결과물(dist/assets)에 서버 비밀값이나 개인 원문 코드 해시 키가 노출되지 않는다', () => {
    const distAssetsDir = join(process.cwd(), 'dist', 'assets')
    if (!existsSync(distAssetsDir)) {
      return
    }
    const files = readdirSync(distAssetsDir).filter((f) => f.endsWith('.js'))
    for (const file of files) {
      const js = readFileSync(join(distAssetsDir, file), 'utf8')
      expect(js).not.toContain('ls-way-arcade-dev-pepper-v04-isolated')
      expect(js).not.toContain('lsway-admin-dev')
      expect(js).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
      if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 8) {
        expect(js).not.toContain(process.env.OPENAI_API_KEY)
      }
    }
  })
})
