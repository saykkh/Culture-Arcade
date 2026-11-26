import { describe, expect, it } from 'vitest'
import { buildTypingSchedule, SAMPLE_CONTENT_V04 } from '../content'
import { normalizePhraseInput } from '../src/domain/rules'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'

describe('Stage 2 · 첫 판 전체 구현 검증 (+2점 기본 득점 · 10점 통과 · 추가 고득점 경쟁)', () => {
  it('최초 입장 시 산성비 타자를 첫 판 추천하고, 8점(4개 입력) 미통과 후 재방문 시 이어서 도전을 안내한다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T09:00:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-a')
    store.setParticipantNickname(login.sessionToken, '오락실첫손님')

    const firstMe = store.getParticipantMe(login.sessionToken)
    expect(firstMe.recommendation.kind).toBe('first_visit')
    expect(firstMe.recommendation.targetGameId).toBe('typing')

    // 4 phrases = 8점 (< 10점 통과 기준) -> uncleared!
    const run4 = await store.startGameRun(login.sessionToken, 'typing', 'assisted')
    const schedule4 = buildTypingSchedule(SAMPLE_CONTENT_V04, run4.seed, run4.mode)
    const events4 = schedule4.slice(0, 4).map((s, idx) => ({
      seq: idx + 1,
      t_ms: (idx + 1) * 1500,
      type: 'submit_phrase' as const,
      slotId: s.slotId,
      input: s.displayKo,
    }))
    const res4 = await store.finalizeGameRun(login.sessionToken, run4.runId, {
      events: events4,
      activeDurationMs: 20_000,
      endReason: 'time_up',
    })
    expect(res4.cleared).toBe(false)
    expect(res4.score).toBe(8)
    expect(res4.newlyLitSocket).toBe(false)

    const revisitUncleared = store.getParticipantMe(login.sessionToken)
    expect(revisitUncleared.recommendation.kind).toBe('resume_uncleared')
    expect(revisitUncleared.recommendation.headline).toBe('이어서 도전 · 산성비 타자')
  })

  it('타자 5개(10점) 통과 이후에도 계속 입력해 고득점(20점)을 기록하고 다른 브라우저에서 1/5 복구된다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T09:10:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'browser-1')
    store.setParticipantNickname(login.sessionToken, '케이블연결러')

    const run = await store.startGameRun(login.sessionToken, 'typing', 'standard')
    const schedule = buildTypingSchedule(SAMPLE_CONTENT_V04, run.seed, 'standard')

    const decomposed = schedule[0]!.displayKo.normalize('NFD')
    expect(normalizePhraseInput(`  ${decomposed}  `)).toBe(schedule[0]!.displayKo)

    // 3 correct + 1 wrong + 1 miss + 7 more correct = 10 correct = 20점 (> 10점 통과!)
    const events = [
      { seq: 1, t_ms: 1000, type: 'submit_phrase' as const, slotId: schedule[0]!.slotId, input: decomposed },
      { seq: 2, t_ms: 2000, type: 'submit_phrase' as const, slotId: schedule[1]!.slotId, input: schedule[1]!.displayKo },
      { seq: 3, t_ms: 3000, type: 'submit_phrase' as const, slotId: schedule[2]!.slotId, input: schedule[2]!.displayKo },
      { seq: 4, t_ms: 3500, type: 'submit_phrase' as const, slotId: schedule[3]!.slotId, input: '오타입력테스트' },
      { seq: 5, t_ms: 4000, type: 'slot_missed' as const, slotId: schedule[3]!.slotId },
      ...schedule.slice(4, 11).map((s, idx) => ({
        seq: 6 + idx,
        t_ms: 5000 + idx * 1000,
        type: 'submit_phrase' as const,
        slotId: s.slotId,
        input: s.displayKo,
      })),
    ]

    const result = await store.finalizeGameRun(login.sessionToken, run.runId, {
      events,
      activeDurationMs: 18_000,
      endReason: 'completed_all',
    })

    expect(result.cleared).toBe(true)
    expect(result.score).toBe(20)
    expect(result.newlyLitSocket).toBe(true)

    const browser2 = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'browser-2')
    const me2 = store.getParticipantMe(browser2.sessionToken)
    expect(me2.requiredClearedCount).toBe(1)
    expect(me2.litSockets.typing).toBe(true)
    expect(me2.recommendation.targetGameId).toBe('snake')

    const admin = store.queryAdminParticipants({ search: '케이블연결러' })
    expect(admin.participants[0]!.requiredGames.typing?.standardBestScore).toBe(20)
  })
})
