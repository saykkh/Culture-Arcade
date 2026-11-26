import { describe, expect, it } from 'vitest'
import { buildShooterRound, SAMPLE_CONTENT_V04 } from '../content'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'
import { findHitTargetLane } from '../src/games/shooter/hitboxes'
import type { ShooterRunEvent } from '../src/domain/types'

describe('Stage 4A · 가치 표적 슈팅(shooter) +2점/10점 통과 및 24점 만점 경쟁 검증', () => {
  it('표적 히트박스와 빈 틈이 분리되고 12문항 세 위치 정답 균형(4/4/4)을 만족한다', () => {
    expect(findHitTargetLane(0.18)).toBe(0)
    expect(findHitTargetLane(0.34)).toBeNull()
    expect(findHitTargetLane(0.50)).toBe(1)
    expect(findHitTargetLane(0.82)).toBe(2)

    const round = buildShooterRound(SAMPLE_CONTENT_V04, 777)
    const counts = [0, 0, 0]
    for (const r of round) counts[r.correctLane] += 1
    expect(counts).toEqual([4, 4, 4])
  })

  it('4정답(8점 미통과) vs 5정답(10점 통과) 경계와 12문항 계속 진행(18점 경쟁)을 검증한다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T10:30:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-sht')
    store.setParticipantNickname(login.sessionToken, '슈팅명사수')

    const makeEvents = (seed: number, correctTargetCount: number): ShooterRunEvent[] => {
      const round = buildShooterRound(SAMPLE_CONTENT_V04, seed)
      const events: ShooterRunEvent[] = []
      let seq = 0
      let t = 1000
      round.forEach((entry, idx) => {
        t += 3000
        events.push({ seq: ++seq, t_ms: t, type: 'aim_start', itemId: entry.item.id })
        const wrongOpt = entry.options.find((o) => o.recordId !== entry.item.correct_id)!
        t += 1500
        events.push({
          seq: ++seq,
          t_ms: t,
          type: 'hit_option',
          itemId: entry.item.id,
          aimDurationMs: 1500,
          selectedRecordId: idx < correctTargetCount ? entry.item.correct_id : wrongOpt.recordId,
        })
      })
      return events
    }

    // 4 correct = 8점 (< 10점) -> NOT cleared
    const run4 = await store.startGameRun(login.sessionToken, 'shooter', 'standard')
    const res4 = await store.finalizeGameRun(login.sessionToken, run4.runId, {
      events: makeEvents(run4.seed, 4),
      activeDurationMs: 60_000,
      endReason: 'completed_all',
    })
    expect(res4.score).toBe(8)
    expect(res4.cleared).toBe(false)

    // 5 correct = 10점 -> CLEARED!
    const run5 = await store.startGameRun(login.sessionToken, 'shooter', 'standard')
    const res5 = await store.finalizeGameRun(login.sessionToken, run5.runId, {
      events: makeEvents(run5.seed, 5),
      activeDurationMs: 60_000,
      endReason: 'completed_all',
    })
    expect(res5.score).toBe(10)
    expect(res5.cleared).toBe(true)

    // 9 correct = 18점 -> higher competitive score recorded!
    const run9 = await store.startGameRun(login.sessionToken, 'shooter', 'standard')
    const res9 = await store.finalizeGameRun(login.sessionToken, run9.runId, {
      events: makeEvents(run9.seed, 9),
      activeDurationMs: 60_000,
      endReason: 'completed_all',
    })
    expect(res9.score).toBe(18)
    expect(res9.personalBestScore).toBe(18)
  })
})
