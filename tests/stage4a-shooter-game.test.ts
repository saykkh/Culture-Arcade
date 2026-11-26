import { describe, expect, it } from 'vitest'
import { buildShooterRound, SAMPLE_CONTENT_V04 } from '../content'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'
import { findHitTargetLane } from '../src/games/shooter/hitboxes'
import type { ShooterRunEvent } from '../src/domain/types'

describe('Stage 4A · 가치 표적 슈팅(shooter) 규칙·경계·집계 검증', () => {
  it('표적 히트박스와 빈 틈(빗맞힘 구간)이 명확히 분리되고 12문항 세 위치 정답 균형(4/4/4)을 만족한다', () => {
    expect(findHitTargetLane(0.18)).toBe(0)
    expect(findHitTargetLane(0.34)).toBeNull() // gap between lane 0 and lane 1 -> miss!
    expect(findHitTargetLane(0.50)).toBe(1)
    expect(findHitTargetLane(0.66)).toBeNull() // gap between lane 1 and lane 2 -> miss!
    expect(findHitTargetLane(0.82)).toBe(2)

    const round = buildShooterRound(SAMPLE_CONTENT_V04, 777)
    const counts = [0, 0, 0]
    for (const r of round) counts[r.correctLane] += 1
    expect(counts).toEqual([4, 4, 4])
  })

  it('7/8정답 경계, 8정답+4오답(800점 클리어), 8정답+4시간초과(800점 클리어), 9정답+3오답(900점), 빗맞힘 후 명중 시 명중 결과만 확정됨을 검증한다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T10:30:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-sht')
    store.setParticipantNickname(login.sessionToken, '슈팅명사수')

    const makeEvents = (
      seed: number,
      plan: Array<'correct' | 'wrong' | 'timeout' | 'miss_then_correct'>,
    ): ShooterRunEvent[] => {
      const round = buildShooterRound(SAMPLE_CONTENT_V04, seed)
      const events: ShooterRunEvent[] = []
      let seq = 0
      let t = 1000
      round.forEach((entry, idx) => {
        const action = plan[idx]!
        // Reading wait gap (e.g. 5s) before aim_start preserves aimDurationMs budget!
        t += 5000
        seq += 1
        events.push({ seq, t_ms: t, type: 'aim_start', itemId: entry.item.id })
        if (action === 'miss_then_correct') {
          t += 1200
          seq += 1
          events.push({ seq, t_ms: t, type: 'shot_miss', itemId: entry.item.id })
          t += 1500
          seq += 1
          events.push({
            seq,
            t_ms: t,
            type: 'hit_option',
            itemId: entry.item.id,
            aimDurationMs: 2700,
            selectedRecordId: entry.item.correct_id,
          })
        } else if (action === 'correct') {
          t += 2000
          seq += 1
          events.push({
            seq,
            t_ms: t,
            type: 'hit_option',
            itemId: entry.item.id,
            aimDurationMs: 2000,
            selectedRecordId: entry.item.correct_id,
          })
        } else if (action === 'wrong') {
          const wrongOpt = entry.options.find((o) => o.recordId !== entry.item.correct_id)!
          t += 2000
          seq += 1
          events.push({
            seq,
            t_ms: t,
            type: 'hit_option',
            itemId: entry.item.id,
            aimDurationMs: 2000,
            selectedRecordId: wrongOpt.recordId,
          })
        } else {
          t += 6000
          seq += 1
          events.push({
            seq,
            t_ms: t,
            type: 'item_timeout',
            itemId: entry.item.id,
            aimDurationMs: 6000,
          })
        }
      })
      return events
    }

    // 1) 7 correct + 5 wrong -> 700점, NOT cleared!
    const run7 = await store.startGameRun(login.sessionToken, 'shooter', 'standard')
    const res7 = await store.finalizeGameRun(login.sessionToken, run7.runId, {
      events: makeEvents(run7.seed, [
        'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct',
        'wrong', 'wrong', 'wrong', 'wrong', 'wrong',
      ]),
      activeDurationMs: 95_000,
      endReason: 'completed_all',
    })
    expect(res7.score).toBe(700)
    expect(res7.cleared).toBe(false)

    // 2) 8 correct (including miss_then_correct!) + 4 wrong -> 800점 CLEAR!
    const run8Wrong = await store.startGameRun(login.sessionToken, 'shooter', 'standard')
    const res8Wrong = await store.finalizeGameRun(login.sessionToken, run8Wrong.runId, {
      events: makeEvents(run8Wrong.seed, [
        'miss_then_correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct',
        'wrong', 'wrong', 'wrong', 'wrong',
      ]),
      activeDurationMs: 100_000,
      endReason: 'completed_all',
    })
    expect(res8Wrong.score).toBe(800)
    expect(res8Wrong.cleared).toBe(true)
    if (res8Wrong.actionSummary.kind === 'shooter') {
      expect(res8Wrong.actionSummary.missedShots).toBe(1)
      expect(res8Wrong.actionSummary.correctCount).toBe(8)
      expect(res8Wrong.actionSummary.wrongCount).toBe(4)
    }

    // 3) 8 correct + 4 timeout -> 800점 CLEAR!
    const run8Timeout = await store.startGameRun(login.sessionToken, 'shooter', 'assisted')
    const res8Timeout = await store.finalizeGameRun(login.sessionToken, run8Timeout.runId, {
      events: makeEvents(run8Timeout.seed, [
        'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct',
        'timeout', 'timeout', 'timeout', 'timeout',
      ]),
      activeDurationMs: 120_000,
      endReason: 'completed_all',
    })
    expect(res8Timeout.score).toBe(800)
    expect(res8Timeout.cleared).toBe(true)

    // 4) 9 correct + 3 wrong -> 900점 CLEAR!
    const run9 = await store.startGameRun(login.sessionToken, 'shooter', 'standard')
    const res9 = await store.finalizeGameRun(login.sessionToken, run9.runId, {
      events: makeEvents(run9.seed, [
        'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct',
        'wrong', 'wrong', 'wrong',
      ]),
      activeDurationMs: 95_000,
      endReason: 'completed_all',
    })
    expect(res9.score).toBe(900)
    expect(res9.cleared).toBe(true)
  })
})
