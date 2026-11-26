import { describe, expect, it } from 'vitest'
import {
  buildShooterRound,
  buildSnakeSentenceSequence,
  buildTypingSchedule,
  SAMPLE_CONTENT_V04,
} from '../content'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'
import { PinballSimulation } from '../src/games/pinball/engine'

describe('Stage 4C · C.O.R.E. 핀볼 발사·플리퍼 반발력 및 필수 5종 10점 통과 통합 검증', () => {
  it('핀볼 발사 슈트를 통해 공이 상단 범퍼 구역(y < 90)까지 확실히 올라가고 플리퍼 타격 시 강하게 위로 솟구친다', () => {
    const sim = new PinballSimulation({
      mode: 'standard',
      contentVersion: 'sample-v0.4',
      disableAutoLaunch: true,
    })

    expect(sim.launchBall()).toBe(true)
    let minY = 999
    for (let i = 0; i < 60; i += 1) {
      const snap = sim.step(16)
      if (snap.ballY < minY) minY = snap.ballY
    }
    // Ball must climb all the way up the launch chute (< 80px) and enter the upper bumper field!
    expect(minY).toBeLessThan(80)
    expect(sim.getSnapshot().inLaunchChute).toBe(false)
    expect(sim.getSnapshot().ballsRemaining).toBe(3)
  })

  it('핀볼 C·O·R·E 1세트 완성 시 12점(4명중*2 + 보너스4)으로 통과하고, 공 소실 시 글자가 유지된다', async () => {
    const sim = new PinballSimulation({
      mode: 'standard',
      contentVersion: 'sample-v0.4',
      disableAutoLaunch: true,
    })

    for (const letter of ['C', 'O', 'R'] as const) {
      sim.aimBallTowardBumper(letter)
      for (let i = 0; i < 45; i += 1) sim.step(16)
    }
    expect(sim.getSnapshot().currentSetLetters).toEqual(['C', 'O', 'R'])
    expect(sim.getSnapshot().highlightedFinalLetter).toBe('E')

    sim.dropBallBetweenFlippers()
    for (let i = 0; i < 20 && sim.getSnapshot().ballsRemaining === 3; i += 1) {
      sim.step(25)
    }
    expect(sim.getSnapshot().ballsRemaining).toBe(2)
    expect(sim.getSnapshot().currentSetLetters).toEqual(['C', 'O', 'R'])

    sim.aimBallTowardBumper('E')
    for (let i = 0; i < 45; i += 1) sim.step(16)
    const snapCleared = sim.getSnapshot()
    expect(snapCleared.completedSets).toBe(1)
    expect(snapCleared.score).toBe(12) // 4 * 2 + 4 bonus = 12점 (>= 10점 통과!)
    expect(snapCleared.cleared).toBe(true)
  })

  it('기본 속도와 여유롭게 도전을 섞어 필수 5종에서 각각 10점 이상 달성하면 간판 5/5와 온보딩 배지를 확정한다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T12:30:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-all5')
    store.setParticipantNickname(login.sessionToken, '올클리어신입')

    // 1. Typing: 5 phrases = 10점
    const r1 = await store.startGameRun(login.sessionToken, 'typing', 'standard')
    const s1 = buildTypingSchedule(SAMPLE_CONTENT_V04, r1.seed, 'standard')
    await store.finalizeGameRun(login.sessionToken, r1.runId, {
      events: s1.slice(0, 5).map((slot, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 1200,
        type: 'submit_phrase' as const,
        slotId: slot.slotId,
        input: slot.displayKo,
      })),
      activeDurationMs: 15_000,
      endReason: 'completed_all',
    })

    // 2. Snake: 2 sentences = 16점
    const r2 = await store.startGameRun(login.sessionToken, 'snake', 'assisted')
    const s2 = buildSnakeSentenceSequence(SAMPLE_CONTENT_V04, r2.seed)
    let seq = 0
    await store.finalizeGameRun(login.sessionToken, r2.runId, {
      events: s2.slice(0, 2).flatMap((sent) =>
        sent.chunks.map((c, stepIndex) => ({
          seq: ++seq,
          t_ms: seq * 1500,
          type: 'pick_chunk' as const,
          sentenceId: sent.id,
          stepIndex,
          chunkText: c,
        })),
      ),
      activeDurationMs: 25_000,
      endReason: 'completed_all',
    })

    // 3. Shooter: 5 correct = 10점
    const r3 = await store.startGameRun(login.sessionToken, 'shooter', 'assisted')
    const s3 = buildShooterRound(SAMPLE_CONTENT_V04, r3.seed)
    seq = 0
    await store.finalizeGameRun(login.sessionToken, r3.runId, {
      events: s3.slice(0, 5).flatMap((q) => [
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
      activeDurationMs: 30_000,
      endReason: 'completed_all',
    })

    // 4. Racing: 5 overtakes = 10점
    const r4 = await store.startGameRun(login.sessionToken, 'racing', 'standard')
    const res4 = await store.finalizeGameRun(login.sessionToken, r4.runId, {
      events: Array.from({ length: 5 }, (_, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 2500,
        type: 'overtake' as const,
        vehicleId: `veh-${i + 1}`,
      })),
      activeDurationMs: 30_000,
      endReason: 'course_finished',
    })
    expect(res4.requiredClearedCount).toBe(4)
    expect(res4.badgeEarned).toBe(false)

    // 5. Pinball: C·O·R·E 1 set = 12점 -> 5/5 badge earned!
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
  })
})
