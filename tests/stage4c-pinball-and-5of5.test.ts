import { describe, expect, it } from 'vitest'
import {
  buildShooterRound,
  buildSnakeSentenceSequence,
  buildTypingSchedule,
  SAMPLE_CONTENT_V04,
} from '../content'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'
import { PinballSimulation } from '../src/games/pinball/engine'

describe('Stage 4C · C.O.R.E. 핀볼(pinball) 및 필수 5종 이수·온보딩 배지 통합 검증', () => {
  it('핀볼 4범퍼 의도 조준 명중(900점 클리어), 마지막 1글자 경로 점등, 공 소실 시 글자 유지, 동일 범퍼 15회(1,500점 미클리어)를 재현한다', async () => {
    const sim = new PinballSimulation({
      mode: 'standard',
      contentVersion: 'sample-v0.4',
    })

    // Aim C -> O -> R -> check highlightedFinalLetter === 'E' -> lose ball 1 -> confirm letters kept -> aim E!
    for (const letter of ['C', 'O', 'R'] as const) {
      sim.aimBallTowardBumper(letter)
      for (let i = 0; i < 45; i += 1) sim.step(16)
    }
    const snapAfter3 = sim.getSnapshot()
    expect(snapAfter3.currentSetLetters).toEqual(['C', 'O', 'R'])
    expect(snapAfter3.highlightedFinalLetter).toBe('E')

    // Let ball drain through the center gap between flippers -> currentSetLetters ['C', 'O', 'R'] MUST remain preserved!
    sim.dropBallBetweenFlippers()
    for (let i = 0; i < 20 && sim.getSnapshot().ballsRemaining === 3; i += 1) {
      sim.step(25)
    }
    expect(sim.getSnapshot().ballsRemaining).toBe(2)
    expect(sim.getSnapshot().currentSetLetters).toEqual(['C', 'O', 'R'])

    // Hit final letter E on ball 2 -> 4 hits * 100 + 500 set bonus = 900 CLEAR!
    sim.aimBallTowardBumper('E')
    for (let i = 0; i < 45; i += 1) sim.step(16)
    const snapCleared = sim.getSnapshot()
    expect(snapCleared.completedSets).toBe(1)
    expect(snapCleared.score).toBe(900)
    expect(snapCleared.currentSetLetters).toEqual([])

    // Verify server boundary: 1,500 points on single bumper 'C' x 15 hits (spaced >= 300ms) is NOT cleared; C·O·R·E x 1 is 900 CLEAR!
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T12:00:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-pin')
    store.setParticipantNickname(login.sessionToken, '핀볼장인')

    const run1500 = await store.startGameRun(login.sessionToken, 'pinball', 'standard')
    const res1500 = await store.finalizeGameRun(login.sessionToken, run1500.runId, {
      events: Array.from({ length: 15 }, (_, idx) => ({
        seq: idx + 1,
        t_ms: (idx + 1) * 500,
        type: 'bumper_hit' as const,
        ballId: 1,
        letter: 'C' as const,
        separatedSinceLastHit: true,
      })),
      activeDurationMs: 25_000,
      endReason: 'time_up',
    })
    expect(res1500.score).toBe(1500)
    expect(res1500.cleared).toBe(false)

    const run900 = await store.startGameRun(login.sessionToken, 'pinball', 'assisted')
    const res900 = await store.finalizeGameRun(login.sessionToken, run900.runId, {
      events: (['C', 'O', 'R', 'E'] as const).map((letter, idx) => ({
        seq: idx + 1,
        t_ms: (idx + 1) * 500,
        type: 'bumper_hit' as const,
        ballId: 1,
        letter,
        separatedSinceLastHit: true,
      })),
      activeDurationMs: 115_000, // assisted allows 125s
      endReason: 'time_up',
    })
    expect(res900.score).toBe(900)
    expect(res900.cleared).toBe(true)
  })

  it('기본 속도와 여유롭게 도전을 섞어 필수 5종을 모두 클리어하면 간판 5/5와 온보딩 배지를 단 한 번 확정하고 재도전으로 중복되지 않는다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T12:30:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-all5')
    store.setParticipantNickname(login.sessionToken, '올클리어신입')

    // 1. Typing (standard)
    const r1 = await store.startGameRun(login.sessionToken, 'typing', 'standard')
    const s1 = buildTypingSchedule(SAMPLE_CONTENT_V04, r1.seed, 'standard')
    await store.finalizeGameRun(login.sessionToken, r1.runId, {
      events: s1.slice(0, 10).map((slot, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 1200,
        type: 'submit_phrase' as const,
        slotId: slot.slotId,
        input: slot.displayKo,
      })),
      activeDurationMs: 20_000,
      endReason: 'completed_all',
    })

    // 2. Snake (assisted)
    const r2 = await store.startGameRun(login.sessionToken, 'snake', 'assisted')
    const s2 = buildSnakeSentenceSequence(SAMPLE_CONTENT_V04, r2.seed)
    let seq = 0
    await store.finalizeGameRun(login.sessionToken, r2.runId, {
      events: s2.slice(0, 3).flatMap((sent) =>
        sent.chunks.map((c, stepIndex) => ({
          seq: ++seq,
          t_ms: seq * 1500,
          type: 'pick_chunk' as const,
          sentenceId: sent.id,
          stepIndex,
          chunkText: c,
        })),
      ),
      activeDurationMs: 30_000,
      endReason: 'completed_all',
    })

    // 3. Shooter (assisted)
    const r3 = await store.startGameRun(login.sessionToken, 'shooter', 'assisted')
    const s3 = buildShooterRound(SAMPLE_CONTENT_V04, r3.seed)
    seq = 0
    await store.finalizeGameRun(login.sessionToken, r3.runId, {
      events: s3.slice(0, 8).flatMap((q) => [
        { seq: ++seq, t_ms: seq * 2000, type: 'aim_start' as const, itemId: q.item.id },
        {
          seq: ++seq,
          t_ms: seq * 2000,
          type: 'hit_option' as const,
          itemId: q.item.id,
          aimDurationMs: 2000,
          selectedRecordId: q.item.correct_id,
        },
      ]),
      activeDurationMs: 45_000,
      endReason: 'completed_all',
    })

    // 4. Racing (standard) -> 4/5 cleared, badge NOT earned yet!
    const r4 = await store.startGameRun(login.sessionToken, 'racing', 'standard')
    const res4 = await store.finalizeGameRun(login.sessionToken, r4.runId, {
      events: Array.from({ length: 10 }, (_, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 2500,
        type: 'overtake' as const,
        vehicleId: `veh-${i + 1}`,
      })),
      activeDurationMs: 40_000,
      endReason: 'course_finished',
    })
    expect(res4.requiredClearedCount).toBe(4)
    expect(res4.badgeEarned).toBe(false)

    // 5. Pinball (assisted) -> 5/5 cleared, newlyEarnedBadge = true!
    const r5 = await store.startGameRun(login.sessionToken, 'pinball', 'assisted')
    const res5 = await store.finalizeGameRun(login.sessionToken, r5.runId, {
      events: (['C', 'O', 'R', 'E'] as const).map((letter, idx) => ({
        seq: idx + 1,
        t_ms: (idx + 1) * 600,
        type: 'bumper_hit' as const,
        ballId: 1,
        letter,
        separatedSinceLastHit: true,
      })),
      activeDurationMs: 18_000,
      endReason: 'time_up',
    })
    expect(res5.requiredClearedCount).toBe(5)
    expect(res5.newlyEarnedBadge).toBe(true)
    expect(res5.badgeEarned).toBe(true)
    expect(res5.recommendation.kind).toBe('all_completed')

    // Replaying Pinball after badge sets afterBadgeAtStart = true and does NOT re-trigger newlyEarnedBadge or newlyLitSocket!
    const r6 = await store.startGameRun(login.sessionToken, 'pinball', 'standard')
    const res6 = await store.finalizeGameRun(login.sessionToken, r6.runId, {
      events: (['C', 'O', 'R', 'E'] as const).map((letter, idx) => ({
        seq: idx + 1,
        t_ms: (idx + 1) * 600,
        type: 'bumper_hit' as const,
        ballId: 1,
        letter,
        separatedSinceLastHit: true,
      })),
      activeDurationMs: 18_000,
      endReason: 'time_up',
    })
    expect(res6.newlyLitSocket).toBe(false)
    expect(res6.newlyEarnedBadge).toBe(false)
    expect(res6.requiredClearedCount).toBe(5)
  })
})
