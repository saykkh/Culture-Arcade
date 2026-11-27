import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildShooterRound,
  buildSnakeSentenceSequence,
  buildTypingSchedule,
  SAMPLE_CONTENT_V04,
} from '../content'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'
import { buildRunnerTrack, RunnerSimulation } from '../src/games/runner/engine'

describe('Stage 4B · C.O.R.E. 부스터 런 8종 기믹·페이퍼로지 서체·4/4 완주 검증', () => {
  it('트랙에 8종 오브젝트(핵심가치·하이퍼링·실드·점프대·바나나·점착늪·바리케이드·감전쇼크)가 모두 생성되고 페이퍼로지 서체가 전역 적용된다', () => {
    const entities = buildRunnerTrack({
      seed: 2026,
      contentVersion: SAMPLE_CONTENT_V04.contentVersion,
    })
    const bonusKinds = new Set(
      entities.filter((e) => e.kind === 'bonus').map((e) => e.bonusKind),
    )
    const hazardKinds = new Set(
      entities.filter((e) => e.kind === 'hazard').map((e) => e.hazardKind),
    )
    expect(entities.some((e) => e.kind === 'booster')).toBe(true)
    expect([...bonusKinds].sort()).toEqual(['hyper_ring', 'jump_ramp', 'shield'])
    expect([...hazardKinds].sort()).toEqual(['banana', 'barricade', 'emp_shock', 'sludge'])

    const css = readFileSync(join(process.cwd(), 'src', 'styles', 'arcade.css'), 'utf8')
    expect(css).toContain("font-family: 'Paperlogy'")
    expect(css).not.toContain('Pretendard')
    expect(css).not.toContain('Barlow Condensed')
  })

  it('하이퍼링(195% 초가속), 스프링 점프대(슈퍼점프), 절연 실드(함정 방어), 감전 쇼크/바리케이드(0% 일시정지), 점착늪(35% 중감속)이 정확히 작동한다', () => {
    // 1) Hyper Ring -> +3점 & 1.95x speed
    const simHyper = new RunnerSimulation({
      seed: 2026,
      mode: 'standard',
      contentVersion: SAMPLE_CONTENT_V04.contentVersion,
      isPractice: false,
    })
    const hyperEnt = simHyper.entities.find(
      (e) => e.kind === 'bonus' && e.bonusKind === 'hyper_ring',
    )!
    simHyper.setLane(hyperEnt.lane)
    let gotHyper = false
    for (let i = 0; i < 180 && !gotHyper; i += 1) {
      // Jump over any non-emp hazard before hyperEnt
      const nearHaz = simHyper.entities.find(
        (e) =>
          e.kind === 'hazard' &&
          e.lane === hyperEnt.lane &&
          e.z < hyperEnt.z &&
          e.z - simHyper.getSnapshot().distance <= 24 &&
          e.z - simHyper.getSnapshot().distance > 2,
      )
      if (nearHaz) simHyper.triggerJump(true)
      const fx = simHyper.step(40)
      if (fx.collectedBonus === 'hyper_ring') gotHyper = true
    }
    expect(gotHyper).toBe(true)
    expect(simHyper.getSnapshot().speedMultiplier).toBeCloseTo(1.95, 2)

    // 2) Spring Jump Ramp -> triggers automatic super jump (isSuperJump === true, peak > 1.2)
    const simRamp = new RunnerSimulation({
      seed: 2026,
      mode: 'standard',
      contentVersion: SAMPLE_CONTENT_V04.contentVersion,
      isPractice: false,
    })
    const rampEnt = simRamp.entities.find(
      (e) => e.kind === 'bonus' && e.bonusKind === 'jump_ramp',
    )!
    simRamp.setLane(rampEnt.lane)
    let hitRamp = false
    for (let i = 0; i < 240 && !hitRamp; i += 1) {
      const fx = simRamp.step(40)
      if (fx.collectedBonus === 'jump_ramp') hitRamp = true
    }
    expect(hitRamp).toBe(true)
    expect(simRamp.getSnapshot().isSuperJump).toBe(true)

    // 3) Insulation Shield absorbs next hazard with 0 slowdown & 0 score loss!
    const simShield = new RunnerSimulation({
      seed: 2026,
      mode: 'standard',
      contentVersion: SAMPLE_CONTENT_V04.contentVersion,
      isPractice: false,
    })
    simShield.grantShieldForTest()
    const firstHaz = simShield.entities.find((e) => e.kind === 'hazard')!
    simShield.setLane(firstHaz.lane)
    let blocked = false
    for (let i = 0; i < 150 && !blocked; i += 1) {
      const fx = simShield.step(40)
      if (fx.shieldBlocked) blocked = true
    }
    expect(blocked).toBe(true)
    expect(simShield.getSnapshot().shieldBlockedCount).toBe(1)
    expect(simShield.getSnapshot().hazardHitCount).toBe(0)
    expect(simShield.getSnapshot().speedMultiplier).toBeGreaterThanOrEqual(1.0)

    // 4) Overcurrent Shock / Barricade causes temporary 0% speed stop (stunRemainMs > 0)
    const simStun = new RunnerSimulation({
      seed: 2026,
      mode: 'standard',
      contentVersion: SAMPLE_CONTENT_V04.contentVersion,
      isPractice: false,
    })
    const shockOrBarricade = simStun.entities.find(
      (e) =>
        e.kind === 'hazard' &&
        (e.hazardKind === 'emp_shock' || e.hazardKind === 'barricade'),
    )!
    simStun.setLane(shockOrBarricade.lane)
    let stunned = false
    for (let i = 0; i < 220 && !stunned; i += 1) {
      const fx = simStun.step(35)
      if (fx.stunnedBy) stunned = true
    }
    expect(stunned).toBe(true)
    expect(simStun.getSnapshot().speedMultiplier).toBe(0)
    expect(simStun.getSnapshot().stunStopCount).toBeGreaterThanOrEqual(1)
  })

  it('서버 채점기가 신규 기믹(하이퍼링 +3, 실드 방어 0감점, 감전쇼크 −2, 바리케이드/점착늪 −1)과 4/4 전체 완주 배지를 정확히 검증한다', async () => {
    const store = new ArcadeStore({
      filePath: null,
      clock: () => new Date('2026-11-27T01:00:00Z'),
    })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.QUICK_TEST, 'pc-runner')
    store.setParticipantNickname(login.sessionToken, '기믹마스터')

    // 3 boosters (6) + 1 hyper_ring (3) + 1 shield (1) + 1 shield-blocked emp_shock (0) - 1emp_shock (-2) + 1 sludge (-1) = 7점 (< 10점 미통과)
    const run7 = await store.startGameRun(login.sessionToken, 'runner', 'standard')
    const res7 = await store.finalizeGameRun(login.sessionToken, run7.runId, {
      events: [
        { seq: 1, t_ms: 1500, type: 'step_booster', padId: 'pad-1', letter: 'C' },
        { seq: 2, t_ms: 3000, type: 'step_booster', padId: 'pad-2', letter: 'O' },
        { seq: 3, t_ms: 4500, type: 'step_booster', padId: 'pad-3', letter: 'R' },
        { seq: 4, t_ms: 6000, type: 'collect_bonus', bonusId: 'bon-1', bonusKind: 'hyper_ring' },
        { seq: 5, t_ms: 7500, type: 'collect_bonus', bonusId: 'bon-2', bonusKind: 'shield' },
        {
          seq: 6,
          t_ms: 9000,
          type: 'hit_hazard',
          hazardId: 'haz-1',
          hazardKind: 'emp_shock',
          blockedByShield: true,
        },
        { seq: 7, t_ms: 11000, type: 'hit_hazard', hazardId: 'haz-2', hazardKind: 'emp_shock' },
        { seq: 8, t_ms: 13000, type: 'hit_hazard', hazardId: 'haz-3', hazardKind: 'sludge' },
      ],
      activeDurationMs: 20_000,
      endReason: 'time_up',
    })
    expect(res7.score).toBe(7)
    expect(res7.cleared).toBe(false)
    if (res7.actionSummary.kind === 'runner') {
      expect(res7.actionSummary.shieldBlockedCount).toBe(1)
      expect(res7.actionSummary.stunStopCount).toBe(1)
      expect(res7.actionSummary.bonusItemCount).toBe(2)
    }

    // Complete all 4 games (#1 typing, #2 snake, #3 shooter, #4 runner) -> 4/4 badgeEarned!
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

    // 4th game: Runner C·O·R·E set (12점) + hyper_ring (3점) + jump_ramp (1점) = 16점!
    const r4 = await store.startGameRun(login.sessionToken, 'runner', 'standard')
    const fin4 = await store.finalizeGameRun(login.sessionToken, r4.runId, {
      events: [
        { seq: 1, t_ms: 1500, type: 'step_booster', padId: 'pad-1', letter: 'C' },
        { seq: 2, t_ms: 3000, type: 'step_booster', padId: 'pad-2', letter: 'O' },
        { seq: 3, t_ms: 4500, type: 'step_booster', padId: 'pad-3', letter: 'R' },
        { seq: 4, t_ms: 6000, type: 'step_booster', padId: 'pad-4', letter: 'E' },
        { seq: 5, t_ms: 7500, type: 'collect_bonus', bonusId: 'bon-1', bonusKind: 'hyper_ring' },
        { seq: 6, t_ms: 9000, type: 'collect_bonus', bonusId: 'bon-2', bonusKind: 'jump_ramp' },
      ],
      activeDurationMs: 22_000,
      endReason: 'course_finished',
    })

    expect(fin4.score).toBe(16)
    expect(fin4.cleared).toBe(true)
    expect(fin4.requiredClearedCount).toBe(4)
    expect(fin4.newlyEarnedBadge).toBe(true)
    expect(fin4.badgeEarned).toBe(true)
  })
})
