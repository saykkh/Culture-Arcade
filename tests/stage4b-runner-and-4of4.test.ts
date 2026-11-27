import { describe, expect, it } from 'vitest'
import {
  buildShooterRound,
  buildSnakeSentenceSequence,
  buildTypingSchedule,
  SAMPLE_CONTENT_V04,
} from '../content'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'
import { RunnerSimulation } from '../src/games/runner/engine'

describe('Stage 4B · C.O.R.E. 부스터 런(runner) 및 4종 전체 완주(4/4) 검증', () => {
  it('부스터 발판(+2점·가속), 4글자 세트(+4점), 바나나 미끄러짐(−1점·감속), Space 점프 바나나 회피 물리 동작을 검증한다', () => {
    const sim = new RunnerSimulation({
      seed: 2026,
      mode: 'standard',
      contentVersion: SAMPLE_CONTENT_V04.contentVersion,
      isPractice: false,
    })

    // 1) Step onto first booster pad -> speed boosts to 1.55x and score +2
    const firstPad = sim.entities.find((e) => e.kind === 'booster')!
    sim.setLane(firstPad.lane)
    // Advance until runner reaches firstPad.z
    let boosted = false
    for (let i = 0; i < 60 && !boosted; i += 1) {
      const fx = sim.step(50)
      if (fx.boostedLetter) boosted = true
    }
    expect(boosted).toBe(true)
    expect(sim.getSnapshot().boostCount).toBeGreaterThanOrEqual(1)
    expect(sim.getSnapshot().speedMultiplier).toBeGreaterThan(1.4)
    expect(sim.getScore()).toBeGreaterThanOrEqual(2)

    // 2) Jump over an upcoming banana hazard -> avoids slowdown & penalty!
    const simJump = new RunnerSimulation({
      seed: 2026,
      mode: 'standard',
      contentVersion: SAMPLE_CONTENT_V04.contentVersion,
      isPractice: false,
    })
    const firstBanana = simJump.entities.find((e) => e.kind === 'hazard')!
    simJump.setLane(firstBanana.lane)
    let jumpedOver = false
    for (let i = 0; i < 120 && !jumpedOver; i += 1) {
      const distToBanana = firstBanana.z - simJump.getSnapshot().distance
      if (distToBanana <= 26 && distToBanana > 4) {
        simJump.triggerJump()
      }
      const fx = simJump.step(40)
      if (fx.jumpedBanana) jumpedOver = true
    }
    expect(jumpedOver).toBe(true)
    expect(simJump.getSnapshot().bananaSlipCount).toBe(0)

    // 3) Grounded contact with banana -> slips, slows down (0.52x), and records slip count
    const simSlip = new RunnerSimulation({
      seed: 2026,
      mode: 'standard',
      contentVersion: SAMPLE_CONTENT_V04.contentVersion,
      isPractice: false,
    })
    const targetBanana = simSlip.entities.find((e) => e.kind === 'hazard')!
    simSlip.setLane(targetBanana.lane)
    let slipped = false
    for (let i = 0; i < 120 && !slipped; i += 1) {
      const fx = simSlip.step(40)
      if (fx.slippedBanana) slipped = true
    }
    expect(slipped).toBe(true)
    expect(simSlip.getSnapshot().bananaSlipCount).toBe(1)
    expect(simSlip.getSnapshot().speedMultiplier).toBeLessThan(0.6)
  })

  it('9점 미통과(부스터 5회 10점 − 바나나 1회 = 9점) vs 10점 통과 경계 및 4/4 전체 완주 배지를 검증한다', async () => {
    const store = new ArcadeStore({
      filePath: null,
      clock: () => new Date('2026-11-27T01:00:00Z'),
    })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.QUICK_TEST, 'pc-runner')
    store.setParticipantNickname(login.sessionToken, '부스터러너')

    // 1) 5 pads (C, C, O, O, R = 10점) + 1 banana (-1점) = 9점 -> NOT cleared
    const run9 = await store.startGameRun(login.sessionToken, 'runner', 'standard')
    const res9 = await store.finalizeGameRun(login.sessionToken, run9.runId, {
      events: [
        { seq: 1, t_ms: 2000, type: 'step_booster', padId: 'pad-1', letter: 'C' },
        { seq: 2, t_ms: 4000, type: 'step_booster', padId: 'pad-2', letter: 'C' },
        { seq: 3, t_ms: 6000, type: 'step_booster', padId: 'pad-3', letter: 'O' },
        { seq: 4, t_ms: 8000, type: 'step_booster', padId: 'pad-4', letter: 'O' },
        { seq: 5, t_ms: 10000, type: 'step_booster', padId: 'pad-5', letter: 'R' },
        { seq: 6, t_ms: 12000, type: 'hit_hazard', hazardId: 'haz-1', hazardKind: 'banana' },
      ],
      activeDurationMs: 25_000,
      endReason: 'time_up',
    })
    expect(res9.score).toBe(9)
    expect(res9.cleared).toBe(false)

    // 2) Clear all 4 games (#1 typing, #2 snake, #3 shooter, #4 runner) -> 4/4 badgeEarned!
    const r1 = await store.startGameRun(login.sessionToken, 'typing', 'standard')
    const sc1 = buildTypingSchedule(SAMPLE_CONTENT_V04, r1.seed, 'standard')
    await store.finalizeGameRun(login.sessionToken, r1.runId, {
      events: sc1.slice(0, 6).map((slot, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 1500,
        type: 'submit_phrase' as const,
        slotId: slot.slotId,
        input: slot.displayKo,
      })),
      activeDurationMs: 15_000,
      endReason: 'completed_all',
    })

    const r2 = await store.startGameRun(login.sessionToken, 'snake', 'standard')
    const sc2 = buildSnakeSentenceSequence(SAMPLE_CONTENT_V04, r2.seed)
    let seq = 0
    await store.finalizeGameRun(login.sessionToken, r2.runId, {
      events: sc2.slice(0, 2).flatMap((sent) =>
        sent.chunks.map((c, stepIndex) => ({
          seq: ++seq,
          t_ms: seq * 1200,
          type: 'pick_chunk' as const,
          sentenceId: sent.id,
          stepIndex,
          chunkText: c,
        })),
      ),
      activeDurationMs: 18_000,
      endReason: 'time_up',
    })

    const r3 = await store.startGameRun(login.sessionToken, 'shooter', 'standard')
    const sc3 = buildShooterRound(SAMPLE_CONTENT_V04, r3.seed)
    seq = 0
    await store.finalizeGameRun(login.sessionToken, r3.runId, {
      events: sc3.slice(0, 5).flatMap((q) => [
        { seq: ++seq, t_ms: seq * 1200, type: 'aim_start' as const, itemId: q.item.id },
        {
          seq: ++seq,
          t_ms: seq * 1200,
          type: 'hit_option' as const,
          itemId: q.item.id,
          aimDurationMs: 1200,
          selectedRecordId: q.item.correct_id,
        },
      ]),
      activeDurationMs: 20_000,
      endReason: 'completed_all',
    })

    // 4th game: Runner C·O·R·E set (4 pads * 2 + 4 set bonus = 12점 >= 10점) -> 4/4 complete!
    const r4 = await store.startGameRun(login.sessionToken, 'runner', 'standard')
    const fin4 = await store.finalizeGameRun(login.sessionToken, r4.runId, {
      events: (['C', 'O', 'R', 'E'] as const).map((letter, idx) => ({
        seq: idx + 1,
        t_ms: (idx + 1) * 2000,
        type: 'step_booster' as const,
        padId: `pad-${idx + 1}`,
        letter,
      })),
      activeDurationMs: 22_000,
      endReason: 'course_finished',
    })

    expect(fin4.score).toBe(12)
    expect(fin4.cleared).toBe(true)
    expect(fin4.requiredClearedCount).toBe(4)
    expect(fin4.newlyEarnedBadge).toBe(true)
    expect(fin4.badgeEarned).toBe(true)
    expect(fin4.recommendation.kind).toBe('all_completed')
  })
})
