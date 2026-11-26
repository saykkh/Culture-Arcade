import { describe, expect, it } from 'vitest'
import { buildSnakeSentenceSequence, SAMPLE_CONTENT_V04 } from '../content'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'
import {
  createSafeSnakeBody,
  isTargetReachable,
  pointKey,
  SNAKE_GRID_COLS,
  SNAKE_GRID_ROWS,
  spawnCandidateChunks,
} from '../src/games/snake/engine'

describe('Stage 3 · 단어 먹는 뱀(snake) 와이드 격자·10점 통과·연속 웨이브 경쟁 검증', () => {
  it('확장된 20x12 와이드 격자에서 후보 간 여유 간격과 BFS 도달 가능성을 보장한다', () => {
    expect(SNAKE_GRID_COLS).toBe(20)
    expect(SNAKE_GRID_ROWS).toBe(12)
    const snake = createSafeSnakeBody(6)
    for (let seed = 1; seed <= 30; seed += 1) {
      const candidates = spawnCandidateChunks({
        snakeBody: snake.body,
        correctText: '더 큰 가치를',
        distractors: ['단기 실적만', '개별 이익만'],
        seed: seed * 997,
      })
      expect(candidates).toHaveLength(3)
      const correct = candidates.find((c) => c.isCorrect)!
      const distractors = candidates.filter((c) => !c.isCorrect)
      const blocked = new Set<string>([
        ...snake.body.map(pointKey),
        ...distractors.map(pointKey),
      ])
      expect(isTargetReachable(snake.body[0]!, correct, blocked)).toBe(true)
    }
  })

  it('8점 미통과(1문장=8점)와 10점 통과 경계, 그리고 4문장 이후 연속 웨이브 추가 고득점 경쟁을 검증한다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T10:00:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-snake')
    store.setParticipantNickname(login.sessionToken, '뱀마스터')

    // 1) 1 sentence (3 chunks * 2 + 2 bonus = 8점 < 10점) -> NOT cleared!
    const run8 = await store.startGameRun(login.sessionToken, 'snake', 'standard')
    const seq8 = buildSnakeSentenceSequence(SAMPLE_CONTENT_V04, run8.seed)
    const res8 = await store.finalizeGameRun(login.sessionToken, run8.runId, {
      events: seq8[0]!.chunks.map((chunk, idx) => ({
        seq: idx + 1,
        t_ms: (idx + 1) * 1000,
        type: 'pick_chunk' as const,
        sentenceId: seq8[0]!.id,
        stepIndex: idx,
        chunkText: chunk,
      })),
      activeDurationMs: 12_000,
      endReason: 'time_up',
    })
    expect(res8.score).toBe(8)
    expect(res8.cleared).toBe(false)

    // 2) Endless competitive wave: complete all 4 sentences + cycle back to sentence 0 again = 5 sentences (40점)!
    const runWave = await store.startGameRun(login.sessionToken, 'snake', 'assisted')
    const seqWave = buildSnakeSentenceSequence(SAMPLE_CONTENT_V04, runWave.seed)
    let seqNo = 0
    const fiveSentences = [...seqWave, seqWave[0]!]
    const waveEvents = fiveSentences.flatMap((sentence) =>
      sentence.chunks.map((chunk, idx) => ({
        seq: ++seqNo,
        t_ms: seqNo * 1200,
        type: 'pick_chunk' as const,
        sentenceId: sentence.id,
        stepIndex: idx,
        chunkText: chunk,
      })),
    )

    const resWave = await store.finalizeGameRun(login.sessionToken, runWave.runId, {
      events: waveEvents,
      activeDurationMs: 45_000,
      endReason: 'time_up',
    })
    expect(resWave.cleared).toBe(true)
    expect(resWave.score).toBe(40) // 15 chunks * 2 + 5 sentences * 2 = 40점!
    expect(resWave.newlyLitSocket).toBe(true)
  })
})
