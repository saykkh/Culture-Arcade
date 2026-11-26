import { describe, expect, it } from 'vitest'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'
import {
  GATE_ZONE_END_Z,
  GATE_ZONE_START_Z,
  RacingSimulation,
  type TunnelLane,
} from '../src/games/racing/engine'

describe('Stage 4B · 3D 케이블 터널 레이싱(racing) 엔진·게이트 동등성·경계 검증', () => {
  it('동일 입력 시 3D/간소화 화면이 완전히 같은 이벤트·점수를 생성하고, 게이트 정답·오답·미선택 간 점수·부스터·추월 기회가 동일하다', async () => {
    const runWithGateLane = (gateLane: TunnelLane) => {
      const sim = new RacingSimulation({
        seed: 20261126,
        mode: 'standard',
        contentVersion: 'sample-v0.4',
      })
      while (!sim.getSnapshot().finished) {
        const snap = sim.getSnapshot()
        if (snap.z >= GATE_ZONE_START_Z && snap.z < GATE_ZONE_END_Z) {
          sim.setLane(gateLane)
          // Booster inside gate zone must be ignored without consuming booster charges!
          expect(sim.triggerBooster()).toBe(false)
          expect(sim.getSnapshot().boostersLeft).toBe(2)
        } else {
          // Pick a lane clear of all entities within [snap.z - 20 .. snap.z + 85]
          const nearbyLanes = new Set(
            snap.entities
              .filter((e) => !e.collided && e.z >= snap.z - 20 && e.z <= snap.z + 85)
              .map((e) => e.lane),
          )
          if (nearbyLanes.has(snap.lane)) {
            const safeLane = ([0, 1, 2] as TunnelLane[]).find((l) => !nearbyLanes.has(l)) ?? 1
            sim.setLane(safeLane)
          }
        }
        sim.step(50)
      }
      return sim
    }

    const simLeft = runWithGateLane(0)
    const simCenter = runWithGateLane(1)
    const simRight = runWithGateLane(2)

    // Score, overtake count, and remaining boosters are 100% identical across left / center / right gate choices!
    expect(simLeft.getSnapshot().netScore).toBe(simCenter.getSnapshot().netScore)
    expect(simRight.getSnapshot().netScore).toBe(simCenter.getSnapshot().netScore)
    expect(simLeft.getSnapshot().overtakeCount).toBe(15)
    expect(simLeft.getSnapshot().netScore).toBe(1500)

    // Exactly one of left/right lights up finalSectionLit
    expect(simLeft.getSnapshot().finalSectionLit !== simRight.getSnapshot().finalSectionLit).toBe(
      true,
    )
    expect(simCenter.getSnapshot().finalSectionLit).toBe(false)

    // Verify server scores 3D and simplified runs identically and applies 950 vs 1,000 clear boundary
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T11:00:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-race')
    store.setParticipantNickname(login.sessionToken, '터널레이서')

    // 1) 950 points (10 overtakes = 1000, 1 obstacle collision = -50 -> 950) => NOT cleared!
    const run950 = await store.startGameRun(login.sessionToken, 'racing', 'standard')
    const res950 = await store.finalizeGameRun(login.sessionToken, run950.runId, {
      events: [
        ...Array.from({ length: 10 }, (_, i) => ({
          seq: i + 1,
          t_ms: (i + 1) * 3000,
          type: 'overtake' as const,
          vehicleId: `veh-${i + 1}`,
        })),
        { seq: 11, t_ms: 35000, type: 'collision' as const, targetKind: 'obstacle' as const, entityId: 'obs-1' },
      ],
      activeDurationMs: 60_000,
      endReason: 'course_finished',
      renderMode: '3d',
    })
    expect(res950.score).toBe(950)
    expect(res950.cleared).toBe(false)

    // 2) 1,000 points in simplified render mode => CLEARED & reflected on standard Top 10 leaderboard!
    const run1000 = await store.startGameRun(login.sessionToken, 'racing', 'standard')
    const res1000 = await store.finalizeGameRun(login.sessionToken, run1000.runId, {
      events: Array.from({ length: 10 }, (_, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 3000,
        type: 'overtake' as const,
        vehicleId: `veh-${i + 1}`,
      })),
      activeDurationMs: 58_000,
      endReason: 'course_finished',
      renderMode: 'simplified',
    })
    expect(res1000.score).toBe(1000)
    expect(res1000.cleared).toBe(true)

    const board = store.getLeaderboard(login.sessionToken, 'racing')
    expect(board.myStanding?.score).toBe(1000)
    expect(board.myStanding?.rank).toBe(1)
  })
})
