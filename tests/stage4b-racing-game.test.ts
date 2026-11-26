import { describe, expect, it } from 'vitest'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'
import {
  GATE_ZONE_END_Z,
  GATE_ZONE_START_Z,
  RacingSimulation,
  type TunnelLane,
} from '../src/games/racing/engine'

describe('Stage 4B · 3D 케이블 터널 레이싱(racing) +2점/-1점 · 10점 통과 · 최대 40점 경쟁 검증', () => {
  it('동일 입력 시 게이트 정답·오답·미선택 간 점수(최대 40점)가 동일하며, 9점 미통과 / 10점 통과 경계를 검증한다', async () => {
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
          expect(sim.triggerBooster()).toBe(false)
        } else {
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

    expect(simLeft.getSnapshot().netScore).toBe(simCenter.getSnapshot().netScore)
    expect(simRight.getSnapshot().netScore).toBe(simCenter.getSnapshot().netScore)
    expect(simLeft.getSnapshot().overtakeCount).toBe(20)
    expect(simLeft.getSnapshot().netScore).toBe(40)

    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T11:00:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-race')
    store.setParticipantNickname(login.sessionToken, '터널레이서')

    // 9점 (5 overtakes = 10점, 1 collision = -1점 -> 9점) => NOT cleared!
    const run9 = await store.startGameRun(login.sessionToken, 'racing', 'standard')
    const res9 = await store.finalizeGameRun(login.sessionToken, run9.runId, {
      events: [
        ...Array.from({ length: 5 }, (_, i) => ({
          seq: i + 1,
          t_ms: (i + 1) * 2000,
          type: 'overtake' as const,
          vehicleId: `veh-${i + 1}`,
        })),
        { seq: 6, t_ms: 15000, type: 'collision' as const, targetKind: 'obstacle' as const, entityId: 'obs-1' },
      ],
      activeDurationMs: 40_000,
      endReason: 'course_finished',
      renderMode: '3d',
    })
    expect(res9.score).toBe(9)
    expect(res9.cleared).toBe(false)

    // 10점 (5 overtakes = 10점) => CLEARED!
    const run10 = await store.startGameRun(login.sessionToken, 'racing', 'standard')
    const res10 = await store.finalizeGameRun(login.sessionToken, run10.runId, {
      events: Array.from({ length: 5 }, (_, i) => ({
        seq: i + 1,
        t_ms: (i + 1) * 2000,
        type: 'overtake' as const,
        vehicleId: `veh-${i + 1}`,
      })),
      activeDurationMs: 40_000,
      endReason: 'course_finished',
      renderMode: 'simplified',
    })
    expect(res10.score).toBe(10)
    expect(res10.cleared).toBe(true)
  })
})
