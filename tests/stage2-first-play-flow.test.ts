import { describe, expect, it } from 'vitest'
import { buildTypingSchedule, SAMPLE_CONTENT_V04 } from '../content'
import { normalizePhraseInput } from '../src/domain/rules'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'

describe('Stage 2 · 첫 판 전체 구현 검증 (코드→닉네임→로비→타자→케이블 점등→복구→관리자 조회)', () => {
  it('최초 입장 시 산성비 타자를 첫 판 추천하고, 미클리어 중단/종료 후 재방문 시 이어서 도전을 안내한다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T09:00:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-a')
    store.setParticipantNickname(login.sessionToken, '오락실첫손님')

    // First visit: recommends typing
    const firstMe = store.getParticipantMe(login.sessionToken)
    expect(firstMe.recommendation.kind).toBe('first_visit')
    expect(firstMe.recommendation.targetGameId).toBe('typing')
    expect(firstMe.recommendation.headline).toContain('첫 판 추천')

    // Start typing in assisted mode on first run, submit 9/10 (uncleared boundary!)
    const run9 = await store.startGameRun(login.sessionToken, 'typing', 'assisted')
    const schedule9 = buildTypingSchedule(SAMPLE_CONTENT_V04, run9.seed, run9.mode)
    const events9 = schedule9.slice(0, 9).map((s, idx) => ({
      seq: idx + 1,
      t_ms: (idx + 1) * 1500,
      type: 'submit_phrase' as const,
      slotId: s.slotId,
      input: s.displayKo,
    }))
    const res9 = await store.finalizeGameRun(login.sessionToken, run9.runId, {
      events: events9,
      activeDurationMs: 20_000,
      endReason: 'time_up',
    })
    expect(res9.cleared).toBe(false)
    expect(res9.score).toBe(900)
    expect(res9.newlyLitSocket).toBe(false)
    expect(res9.litSockets.typing).toBe(false)

    // Revisit lobby after uncleared run -> '이어서 도전 · 산성비 타자' + '필수 0/5 완료 · 이번 판은 처음부터 시작'
    const revisitUncleared = store.getParticipantMe(login.sessionToken)
    expect(revisitUncleared.recommendation.kind).toBe('resume_uncleared')
    expect(revisitUncleared.recommendation.headline).toBe('이어서 도전 · 산성비 타자')
    expect(revisitUncleared.recommendation.subline).toBe('필수 0/5 완료 · 이번 판은 처음부터 시작')
  })

  it('타자 3연속 전류 콤보·오입력 후 콤보 초기화 및 점수 보존·NFC 정규화·10개 클리어·다른 브라우저 1/5 복구·관리자 진도를 검증한다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T09:10:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'browser-1')
    store.setParticipantNickname(login.sessionToken, '케이블연결러')

    const run = await store.startGameRun(login.sessionToken, 'typing', 'standard')
    const schedule = buildTypingSchedule(SAMPLE_CONTENT_V04, run.seed, 'standard')

    // Verify NFD decomposed Hangul normalizes to NFC cleanly
    const decomposed = schedule[0]!.displayKo.normalize('NFD')
    expect(normalizePhraseInput(`  ${decomposed}  `)).toBe(schedule[0]!.displayKo)

    // 3 consecutive correct -> 1 wrong input (combo resets, score kept) -> 1 missed slot -> 7 more correct = 10 correct!
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
    expect(result.score).toBe(1000)
    expect(result.newlyLitSocket).toBe(true)
    expect(result.actionSummary.kind).toBe('typing')
    if (result.actionSummary.kind === 'typing') {
      expect(result.actionSummary.correctCount).toBe(10)
      expect(result.actionSummary.wrongSubmitCount).toBe(1)
      expect(result.actionSummary.missedCount).toBe(1)
      expect(result.actionSummary.maxCombo).toBe(7)
    }

    // Second browser logs in with same code -> 1/5 recovered and recommends next required game ('snake')
    const browser2 = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'browser-2')
    const me2 = store.getParticipantMe(browser2.sessionToken)
    expect(me2.requiredClearedCount).toBe(1)
    expect(me2.litSockets.typing).toBe(true)
    expect(me2.recommendation.kind).toBe('next_uncleared')
    expect(me2.recommendation.targetGameId).toBe('snake')

    // Admin view reflects 1/5 progress and typing standard best 1000
    const admin = store.queryAdminParticipants({ search: '케이블연결러' })
    expect(admin.participants).toHaveLength(1)
    expect(admin.participants[0]!.requiredClearedCount).toBe(1)
    expect(admin.participants[0]!.requiredGames.typing?.standardBestScore).toBe(1000)
    expect(admin.participants[0]!.requiredGames.typing?.cleared).toBe(true)
  })
})
