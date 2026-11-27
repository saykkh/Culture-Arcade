import { describe, expect, it } from 'vitest'
import {
  buildShooterRound,
  buildSnakeSentenceSequence,
  buildTypingSchedule,
  SAMPLE_CONTENT_V04,
} from '../content'
import {
  handleApiRequest,
  PARTICIPANT_COOKIE_NAME,
  PARTICIPANT_SYNC_COOKIE_NAME,
} from '../server/router'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'

function extractCookieMap(setCookie: string | string[] | undefined): Record<string, string> {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  const out: Record<string, string> = {}
  for (const line of arr) {
    const first = line.split(';')[0] ?? ''
    const eq = first.indexOf('=')
    if (eq > 0) {
      out[first.slice(0, eq).trim()] = decodeURIComponent(first.slice(eq + 1).trim())
    }
  }
  return out
}

describe('Stage 5 & 6 · 운영 집계·4종 인수 경계·서버리스 상태 동기화·30명 동시 부하 검증', () => {
  it('Vercel 서버리스 리라이트(__path) 및 콜드스타트 멀티 컨테이너 환경에서도 1111-1111-1111 코드로 입장·닉네임·플레이·저장이 유지된다', async () => {
    const fixedClock = () => new Date('2026-11-26T10:00:00Z')

    const containerA = new ArcadeStore({ filePath: null, clock: fixedClock })
    const loginRes = await handleApiRequest(
      {
        method: 'POST',
        url: '/api/index?__path=/api/session/code',
        headers: { 'x-forwarded-proto': 'https' },
        body: { code: '1111-1111-1111' },
      },
      containerA,
    )
    expect(loginRes.status).toBe(200)
    let cookieJar = extractCookieMap(loginRes.headers['Set-Cookie'])
    expect(cookieJar[PARTICIPANT_COOKIE_NAME]).toBeTruthy()

    const toCookieHeader = () =>
      Object.entries(cookieJar)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('; ')

    const containerB = new ArcadeStore({ filePath: null, clock: fixedClock })
    const nickRes = await handleApiRequest(
      {
        method: 'PATCH',
        url: '/api/index?__path=/api/me/nickname',
        headers: { cookie: toCookieHeader(), 'x-forwarded-proto': 'https' },
        body: { nickname: '서버리스완주자' },
      },
      containerB,
    )
    expect(nickRes.status).toBe(200)
    cookieJar = { ...cookieJar, ...extractCookieMap(nickRes.headers['Set-Cookie']) }

    const containerC = new ArcadeStore({ filePath: null, clock: fixedClock })
    const startRes = await handleApiRequest(
      {
        method: 'POST',
        url: '/api/index?__path=/api/games/typing/runs',
        headers: { cookie: toCookieHeader(), 'x-forwarded-proto': 'https' },
        body: { mode: 'standard' },
      },
      containerC,
    )
    expect(startRes.status).toBe(201)
    cookieJar = { ...cookieJar, ...extractCookieMap(startRes.headers['Set-Cookie']) }
    const startedRun = JSON.parse(startRes.body) as { runId: string; seed: number }

    const containerD = new ArcadeStore({ filePath: null, clock: fixedClock })
    const sched = buildTypingSchedule(SAMPLE_CONTENT_V04, startedRun.seed, 'standard')
    const finRes = await handleApiRequest(
      {
        method: 'PUT',
        url: `/api/index?__path=/api/runs/${startedRun.runId}/result`,
        headers: { cookie: toCookieHeader(), 'x-forwarded-proto': 'https' },
        body: {
          events: sched.slice(0, 10).map((s, idx) => ({
            seq: idx + 1,
            t_ms: (idx + 1) * 1000,
            type: 'submit_phrase',
            slotId: s.slotId,
            input: s.displayKo,
          })),
          activeDurationMs: 15_000,
          endReason: 'completed_all',
        },
      },
      containerD,
    )
    expect(finRes.status).toBe(200)
    cookieJar = { ...cookieJar, ...extractCookieMap(finRes.headers['Set-Cookie']) }
    expect(cookieJar[PARTICIPANT_SYNC_COOKIE_NAME]).toBeTruthy()

    const containerE = new ArcadeStore({ filePath: null, clock: fixedClock })
    const meRes = await handleApiRequest(
      {
        method: 'GET',
        url: '/api/index?__path=/api/me',
        headers: { cookie: toCookieHeader(), 'x-forwarded-proto': 'https' },
      },
      containerE,
    )
    expect(meRes.status).toBe(200)
    const meJson = JSON.parse(meRes.body)
    expect(meJson.nickname).toBe('서버리스완주자')
    expect(meJson.requiredClearedCount).toBe(1)
    expect(meJson.litSockets.typing).toBe(true)
  })

  it('테스트 입장코드 111111111111(하이픈 유무 무관)로 즉시 로그인할 수 있다', () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T10:00:00Z') })
    const rawLogin = store.loginWithPersonalCode('111111111111', 'quick-ip-1')
    expect(rawLogin.beforeStartDate).toBe(false)
    expect(rawLogin.requiresNickname).toBe(true)

    const formattedLogin = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.QUICK_TEST, 'quick-ip-2')
    expect(formattedLogin.participantId).toBe(rawLogin.participantId)
  })

  it('삭제된 게임 ID(racing·pinball·control-room) 시작 요청은 400 INVALID_GAME으로 안전하게 거절된다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T10:00:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'ip-removed')
    store.setParticipantNickname(login.sessionToken, '개편검증자')

    for (const removedId of ['racing', 'pinball', 'control-room']) {
      await expect(
        store.startGameRun(login.sessionToken, removedId, 'standard'),
      ).rejects.toThrow(/존재하지 않는 게임/)
    }
  })

  it('개인 일정(기한 후 완료 보존·시작일 변경 잠금·권장일 미설정 4/4 이수)과 CSV(UTF-8 BOM·수식 방지·코드 비노출)를 검증한다', async () => {
    const now = new Date('2026-11-26T15:00:00Z') // 2026-11-27 00:00 KST (past 2026-11-25 due date)
    const store = new ArcadeStore({ filePath: null, clock: () => now })

    const lateReg = store.registerParticipantByAdmin({
      rosterRef: 'HR-LATE',
      availableFromDate: '2026-11-20',
      recommendedDueDate: '2026-11-25',
    })
    const noDueReg = store.registerParticipantByAdmin({
      rosterRef: 'HR-NODUE',
      availableFromDate: '2026-11-20',
      recommendedDueDate: null,
    })

    const loginLate = store.loginWithPersonalCode(lateReg.issuedCodeOnce, 'pc-1')
    store.setParticipantNickname(loginLate.sessionToken, '지각완주자')

    const clearAll4 = async (code: string) => {
      const s = store.loginWithPersonalCode(code, 'pc-other')
      const r1 = await store.startGameRun(s.sessionToken, 'typing', 'standard')
      const sc1 = buildTypingSchedule(SAMPLE_CONTENT_V04, r1.seed, 'standard')
      await store.finalizeGameRun(s.sessionToken, r1.runId, {
        events: sc1.slice(0, 6).map((slot, i) => ({
          seq: i + 1,
          t_ms: (i + 1) * 1000,
          type: 'submit_phrase' as const,
          slotId: slot.slotId,
          input: slot.displayKo,
        })),
        activeDurationMs: 15_000,
        endReason: 'completed_all',
      })

      const r2 = await store.startGameRun(s.sessionToken, 'snake', 'standard')
      const sc2 = buildSnakeSentenceSequence(SAMPLE_CONTENT_V04, r2.seed)
      let seq = 0
      await store.finalizeGameRun(s.sessionToken, r2.runId, {
        events: sc2.slice(0, 2).flatMap((sent) =>
          sent.chunks.map((c, stepIndex) => ({
            seq: ++seq,
            t_ms: seq * 1000,
            type: 'pick_chunk' as const,
            sentenceId: sent.id,
            stepIndex,
            chunkText: c,
          })),
        ),
        activeDurationMs: 20_000,
        endReason: 'completed_all',
      })

      const r3 = await store.startGameRun(s.sessionToken, 'shooter', 'standard')
      const sc3 = buildShooterRound(SAMPLE_CONTENT_V04, r3.seed)
      seq = 0
      await store.finalizeGameRun(s.sessionToken, r3.runId, {
        events: sc3.slice(0, 6).flatMap((q) => [
          { seq: ++seq, t_ms: seq * 1500, type: 'aim_start' as const, itemId: q.item.id },
          {
            seq: ++seq,
            t_ms: seq * 1500,
            type: 'hit_option' as const,
            itemId: q.item.id,
            aimDurationMs: 1500,
            selectedRecordId: q.item.correct_id,
          },
        ]),
        activeDurationMs: 30_000,
        endReason: 'completed_all',
      })

      const r4 = await store.startGameRun(s.sessionToken, 'runner', 'standard')
      await store.finalizeGameRun(s.sessionToken, r4.runId, {
        events: (['C', 'O', 'R', 'E'] as const).map((letter, idx) => ({
          seq: idx + 1,
          t_ms: (idx + 1) * 2000,
          type: 'step_booster' as const,
          padId: `pad-${idx + 1}`,
          letter,
        })),
        activeDurationMs: 25_000,
        endReason: 'course_finished',
      })
    }

    await clearAll4(lateReg.issuedCodeOnce)

    expect(() =>
      store.updateParticipantByAdmin(lateReg.participantId, { availableFromDate: '2026-11-22' }),
    ).toThrow(/시작일/)

    store.updateParticipantByAdmin(lateReg.participantId, { recommendedDueDate: '2026-12-30' })
    const lateRow = store.queryAdminParticipants({ search: 'HR-LATE' }).participants[0]!
    expect(lateRow.dueStatus).toBe('completed_late')
    expect(lateRow.dueStatusLabel).toBe('기한 후 완료')
    expect(lateRow.requiredClearedCount).toBe(4)

    const loginNoDue = store.loginWithPersonalCode(noDueReg.issuedCodeOnce, 'pc-nodue')
    store.setParticipantNickname(loginNoDue.sessionToken, '자유일정완주')
    await clearAll4(noDueReg.issuedCodeOnce)
    const noDueRow = store.queryAdminParticipants({ search: 'HR-NODUE' }).participants[0]!
    expect(noDueRow.learningStatus).toBe('completed')
    expect(noDueRow.dueStatus).toBe('no_due_date')

    const formulaReg = store.registerParticipantByAdmin({
      rosterRef: '=HYPERLINK("http://evil")',
      availableFromDate: '2026-11-20',
    })
    const csv = store.exportParticipantsCsv({})
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('부스터런_정규최고점')
    expect(csv).not.toContain('레이싱_정규최고점')
    expect(csv).not.toContain('보너스완료')
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect(csv).not.toContain(lateReg.issuedCodeOnce)
    expect(csv).not.toContain(formulaReg.issuedCodeOnce)
  })

  it('동점자 선착순 정렬, 지원 최고점의 정규 랭킹 비간섭, 슈팅 오답·시간초과 표본 기준(5명 경계 및 40% 오답률)을 검증한다', async () => {
    let clockMs = Date.parse('2026-11-26T08:00:00Z')
    const store = new ArcadeStore({ filePath: null, clock: () => new Date(clockMs) })

    const regs = Array.from({ length: 5 }, (_, idx) =>
      store.registerParticipantByAdmin({
        rosterRef: `INS-0${idx + 1}`,
        availableFromDate: `2026-11-1${idx + 1}`,
      }),
    )
    const tokens = regs.map((reg, idx) => {
      const l = store.loginWithPersonalCode(reg.issuedCodeOnce, `ip-${idx}`)
      store.setParticipantNickname(l.sessionToken, `참가자_${idx + 1}`)
      return l.sessionToken
    })

    clockMs = Date.parse('2026-11-26T08:01:00Z')
    const p1Run1 = await store.startGameRun(tokens[0]!, 'typing', 'standard')
    const p1Sched1 = buildTypingSchedule(SAMPLE_CONTENT_V04, p1Run1.seed, 'standard')
    await store.finalizeGameRun(tokens[0]!, p1Run1.runId, {
      events: p1Sched1.slice(0, 10).map((s, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 1000,
        type: 'submit_phrase' as const,
        slotId: s.slotId,
        input: s.displayKo,
      })),
      activeDurationMs: 15_000,
      endReason: 'completed_all',
    })

    clockMs = Date.parse('2026-11-26T08:05:00Z')
    const p2Run1 = await store.startGameRun(tokens[1]!, 'typing', 'standard')
    const p2Sched1 = buildTypingSchedule(SAMPLE_CONTENT_V04, p2Run1.seed, 'standard')
    await store.finalizeGameRun(tokens[1]!, p2Run1.runId, {
      events: p2Sched1.slice(0, 10).map((s, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 1000,
        type: 'submit_phrase' as const,
        slotId: s.slotId,
        input: s.displayKo,
      })),
      activeDurationMs: 15_000,
      endReason: 'completed_all',
    })

    clockMs = Date.parse('2026-11-26T08:10:00Z')
    const p1TieRetry = await store.startGameRun(tokens[0]!, 'typing', 'standard')
    const p1SchedTie = buildTypingSchedule(SAMPLE_CONTENT_V04, p1TieRetry.seed, 'standard')
    await store.finalizeGameRun(tokens[0]!, p1TieRetry.runId, {
      events: p1SchedTie.slice(0, 10).map((s, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 1000,
        type: 'submit_phrase' as const,
        slotId: s.slotId,
        input: s.displayKo,
      })),
      activeDurationMs: 15_000,
      endReason: 'completed_all',
    })
    const p1AssistHigh = await store.startGameRun(tokens[0]!, 'typing', 'assisted')
    const p1SchedAssist = buildTypingSchedule(SAMPLE_CONTENT_V04, p1AssistHigh.seed, 'assisted')
    await store.finalizeGameRun(tokens[0]!, p1AssistHigh.runId, {
      events: p1SchedAssist.slice(0, 14).map((s, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 1000,
        type: 'submit_phrase' as const,
        slotId: s.slotId,
        input: s.displayKo,
      })),
      activeDurationMs: 20_000,
      endReason: 'completed_all',
    })

    const board = store.getLeaderboard(tokens[0]!, 'typing')
    expect(board.top10[0]!.nickname).toBe('참가자_1')
    expect(board.top10[0]!.score).toBe(20)
    expect(board.top10[1]!.nickname).toBe('참가자_2')

    const targetItemId = 'sht-c-1'
    for (let idx = 0; idx < 5; idx += 1) {
      const sRun = await store.startGameRun(tokens[idx]!, 'shooter', 'standard')
      const sRound = buildShooterRound(SAMPLE_CONTENT_V04, sRun.seed)
      const targetEntry = sRound.find((e) => e.item.id === targetItemId)!
      const wrongOpt = targetEntry.options.find((o) => o.recordId !== targetEntry.item.correct_id)!

      if (idx === 0) {
        await store.finalizeGameRun(tokens[idx]!, sRun.runId, {
          events: [
            { seq: 1, t_ms: 1000, type: 'aim_start', itemId: targetItemId },
            { seq: 2, t_ms: 11000, type: 'item_timeout', itemId: targetItemId, aimDurationMs: 10000 },
          ],
          activeDurationMs: 12_000,
          endReason: 'time_up',
        })
      } else {
        const pickWrong = idx === 1
        await store.finalizeGameRun(tokens[idx]!, sRun.runId, {
          events: [
            { seq: 1, t_ms: 1000, type: 'aim_start', itemId: targetItemId },
            {
              seq: 2,
              t_ms: 3000,
              type: 'hit_option',
              itemId: targetItemId,
              aimDurationMs: 2000,
              selectedRecordId: pickWrong ? wrongOpt.recordId : targetEntry.item.correct_id,
            },
          ],
          activeDurationMs: 10_000,
          endReason: 'time_up',
        })
      }
    }

    const insights4 = store.getAdminLearningInsights('sample-v0.4')
    const item4 = insights4.items.find((i) => i.itemId === targetItemId)!
    expect(item4.timeoutSampleSufficient).toBe(true)
    expect(item4.firstExposureTimeoutCount).toBe(1)
    expect(item4.selectionSampleSufficient).toBe(false)
    expect(item4.responderCount).toBeNull()
    expect(item4.wrongRatePct).toBeNull()

    const p0Retry1 = await store.startGameRun(tokens[0]!, 'shooter', 'standard')
    const p0Round1 = buildShooterRound(SAMPLE_CONTENT_V04, p0Retry1.seed)
    const p0Target1 = p0Round1.find((e) => e.item.id === targetItemId)!
    const p0Wrong1 = p0Target1.options.find((o) => o.recordId !== p0Target1.item.correct_id)!
    await store.finalizeGameRun(tokens[0]!, p0Retry1.runId, {
      events: [
        { seq: 1, t_ms: 1000, type: 'aim_start', itemId: targetItemId },
        {
          seq: 2,
          t_ms: 3000,
          type: 'hit_option',
          itemId: targetItemId,
          aimDurationMs: 2000,
          selectedRecordId: p0Wrong1.recordId,
        },
      ],
      activeDurationMs: 10_000,
      endReason: 'time_up',
    })

    const p0Retry2 = await store.startGameRun(tokens[0]!, 'shooter', 'standard')
    const p0Round2 = buildShooterRound(SAMPLE_CONTENT_V04, p0Retry2.seed)
    const p0Target2 = p0Round2.find((e) => e.item.id === targetItemId)!
    await store.finalizeGameRun(tokens[0]!, p0Retry2.runId, {
      events: [
        { seq: 1, t_ms: 1000, type: 'aim_start', itemId: targetItemId },
        {
          seq: 2,
          t_ms: 3000,
          type: 'hit_option',
          itemId: targetItemId,
          aimDurationMs: 2000,
          selectedRecordId: p0Target2.item.correct_id,
        },
      ],
      activeDurationMs: 10_000,
      endReason: 'time_up',
    })

    const insights5 = store.getAdminLearningInsights('sample-v0.4')
    const item5 = insights5.items.find((i) => i.itemId === targetItemId)!
    expect(item5.selectionSampleSufficient).toBe(true)
    expect(item5.responderCount).toBe(5)
    expect(item5.wrongCount).toBe(2)
    expect(item5.wrongRatePct).toBe(40)
    expect(item5.firstExposureTimeoutCount).toBe(1)
  })

  it('두 탭 동시 시작/제출 정합성 및 동시 30명 로그인·결과 저장 부하 리허설(누락·중복 0건, p95 < 2초)을 통과한다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T13:00:00Z') })

    const twoTabReg = store.registerParticipantByAdmin({
      rosterRef: 'TWOTAB-01',
      availableFromDate: '2026-11-20',
    })
    const tab1 = store.loginWithPersonalCode(twoTabReg.issuedCodeOnce, 'tab-1')
    const tab2 = store.loginWithPersonalCode(twoTabReg.issuedCodeOnce, 'tab-2')
    store.setParticipantNickname(tab1.sessionToken, '동시탭검증')

    const [startA, startB] = await Promise.all([
      store.startGameRun(tab1.sessionToken, 'runner', 'standard'),
      store.startGameRun(tab2.sessionToken, 'runner', 'standard'),
    ])
    const kinds = [startA.attemptKind, startB.attemptKind].sort()
    expect(kinds).toEqual(['first_attempt', 'retry_before_clear'])

    const runnerClearEvents = (['C', 'O', 'R', 'E'] as const).map((letter, idx) => ({
      seq: idx + 1,
      t_ms: (idx + 1) * 1000,
      type: 'step_booster' as const,
      padId: `pad-${idx + 1}`,
      letter,
    }))
    const [finA, finB] = await Promise.all([
      store.finalizeGameRun(tab1.sessionToken, startA.runId, {
        events: runnerClearEvents,
        activeDurationMs: 12_000,
        endReason: 'course_finished',
      }),
      store.finalizeGameRun(tab2.sessionToken, startB.runId, {
        events: runnerClearEvents,
        activeDurationMs: 12_000,
        endReason: 'course_finished',
      }),
    ])
    expect([finA.newlyLitSocket, finB.newlyLitSocket].filter(Boolean)).toHaveLength(1)

    const cohort = Array.from({ length: 30 }, (_, idx) =>
      store.registerParticipantByAdmin({
        rosterRef: `LOAD-${String(idx + 1).padStart(2, '0')}`,
        availableFromDate: '2026-11-20',
      }),
    )

    const latenciesMs: number[] = []
    await Promise.all(
      cohort.map(async (reg, idx) => {
        const login = store.loginWithPersonalCode(reg.issuedCodeOnce, `load-ip-${idx}`)
        store.setParticipantNickname(login.sessionToken, `부하참가자_${idx + 1}`)
        const run = await store.startGameRun(login.sessionToken, 'runner', 'standard')
        const t0 = performance.now()
        const res = await store.finalizeGameRun(login.sessionToken, run.runId, {
          events: Array.from({ length: 6 }, (_, v) => ({
            seq: v + 1,
            t_ms: (v + 1) * 2000,
            type: 'step_booster' as const,
            padId: `pad-${v + 1}`,
            letter: (['C', 'O', 'R', 'E'] as const)[v % 4]!,
          })),
          activeDurationMs: 25_000,
          endReason: 'course_finished',
        })
        latenciesMs.push(performance.now() - t0)
        expect(res.cleared).toBe(true)
      }),
    )

    latenciesMs.sort((a, b) => a - b)
    const p95Ms = latenciesMs[Math.floor(latenciesMs.length * 0.95)]!
    expect(p95Ms).toBeLessThan(2_000)

    const loadRows = store.queryAdminParticipants({ search: 'LOAD-' })
    expect(loadRows.participants).toHaveLength(30)
    expect(loadRows.participants.every((p) => p.totalFinalizedAttempts === 1)).toBe(true)
  })
})
