import { describe, expect, it } from 'vitest'
import { buildSnakeSentenceSequence, SAMPLE_CONTENT_V04 } from '../content'
import { ArcadeStore, SAMPLE_VIRTUAL_CODES } from '../server/store'
import {
  createSafeSnakeBody,
  isTargetReachable,
  pointKey,
  spawnCandidateChunks,
} from '../src/games/snake/engine'

describe('Stage 3 · 단어 먹는 뱀(snake) 규칙·경계·소켓 점등 검증', () => {
  it('다양한 시드에서 3개의 단어 조각 후보 배치 시 정답 조각까지의 BFS 도달 가능성을 보장한다', () => {
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

  it('문장 편성 순서(첫 문장 경영철학 고정, 2·3번째 미션·비전 교환, 4번째 별도 문장)를 보장한다', () => {
    const seenSecondDomains = new Set<string>()
    for (let seed = 1; seed <= 20; seed += 1) {
      const seq = buildSnakeSentenceSequence(SAMPLE_CONTENT_V04, seed)
      expect(seq).toHaveLength(4)
      expect(seq[0]!.domain).toBe('philosophy')
      seenSecondDomains.add(seq[1]!.domain)
      const firstThreeDomains = new Set([seq[0]!.domain, seq[1]!.domain, seq[2]!.domain])
      expect(firstThreeDomains).toEqual(new Set(['philosophy', 'mission', 'vision']))
      expect(seq[3]!.id).not.toBe(seq[0]!.id)
      expect(seq[3]!.id).not.toBe(seq[1]!.id)
      expect(seq[3]!.id).not.toBe(seq[2]!.id)
    }
    // Verify seed swap actually occurs across seeds
    expect(seenSecondDomains.has('mission')).toBe(true)
    expect(seenSecondDomains.has('vision')).toBe(true)
  })

  it('2/3문장 미클리어(600점)와 3/3문장 클리어(900점) 경계, 오답 시 목숨 보존, 충돌 시 1개 차감, 중복 문장 채점 방지를 검증한다', async () => {
    const store = new ArcadeStore({ filePath: null, clock: () => new Date('2026-11-26T10:00:00Z') })
    const login = store.loginWithPersonalCode(SAMPLE_VIRTUAL_CODES.ACTIVE_TODAY, 'pc-snake')
    store.setParticipantNickname(login.sessionToken, '뱀마스터')

    // 1) 2 sentences completed + 1 wrong chunk -> 600 points, NOT cleared, records confusedPairs
    const run2 = await store.startGameRun(login.sessionToken, 'snake', 'standard')
    const seq2 = buildSnakeSentenceSequence(SAMPLE_CONTENT_V04, run2.seed)
    let seqNo = 0
    const nextSeq = () => {
      seqNo += 1
      return seqNo
    }

    const events2 = [
      // Sentence 0 completed
      ...seq2[0]!.chunks.map((chunk, idx) => ({
        seq: nextSeq(),
        t_ms: seqNo * 1000,
        type: 'pick_chunk' as const,
        sentenceId: seq2[0]!.id,
        stepIndex: idx,
        chunkText: chunk,
      })),
      // Wrong chunk on Sentence 1 step 0 (preserves lives & progress!)
      {
        seq: nextSeq(),
        t_ms: seqNo * 1000,
        type: 'pick_chunk' as const,
        sentenceId: seq2[1]!.id,
        stepIndex: 0,
        chunkText: seq2[1]!.distractorsByStep[0]![0]!,
      },
      // Sentence 1 completed
      ...seq2[1]!.chunks.map((chunk, idx) => ({
        seq: nextSeq(),
        t_ms: seqNo * 1000,
        type: 'pick_chunk' as const,
        sentenceId: seq2[1]!.id,
        stepIndex: idx,
        chunkText: chunk,
      })),
    ]

    const res2 = await store.finalizeGameRun(login.sessionToken, run2.runId, {
      events: events2,
      activeDurationMs: 32_000,
      endReason: 'time_up',
    })
    expect(res2.cleared).toBe(false)
    expect(res2.score).toBe(600)
    expect(res2.litSockets.snake).toBe(false)
    if (res2.actionSummary.kind === 'snake') {
      expect(res2.actionSummary.completedSentences).toBe(2)
      expect(res2.actionSummary.wrongChunkCount).toBe(1)
      expect(res2.actionSummary.confusedPairs).toHaveLength(1)
    }

    // 2) Assisted mode (120s allowed): 2 collisions (lives 3 -> 1) + wrong chunk + 3 unique sentences + duplicate sentence attempt = 900 clear!
    const run3 = await store.startGameRun(login.sessionToken, 'snake', 'assisted')
    const seq3 = buildSnakeSentenceSequence(SAMPLE_CONTENT_V04, run3.seed)
    seqNo = 0
    const events3 = [
      { seq: nextSeq(), t_ms: 1000, type: 'collision' as const, cause: 'wall' as const },
      { seq: nextSeq(), t_ms: 2000, type: 'collision' as const, cause: 'body' as const },
      // Wrong pick does NOT consume remaining 1 life!
      {
        seq: nextSeq(),
        t_ms: 3000,
        type: 'pick_chunk' as const,
        sentenceId: seq3[0]!.id,
        stepIndex: 0,
        chunkText: seq3[0]!.distractorsByStep[0]![0]!,
      },
      ...seq3.slice(0, 3).flatMap((sentence) =>
        sentence.chunks.map((chunk, idx) => ({
          seq: nextSeq(),
          t_ms: 4000 + seqNo * 1000,
          type: 'pick_chunk' as const,
          sentenceId: sentence.id,
          stepIndex: idx,
          chunkText: chunk,
        })),
      ),
      // Duplicate submission of already completed sentence 0 is ignored (single scoring guarantee)
      {
        seq: nextSeq(),
        t_ms: 35000,
        type: 'pick_chunk' as const,
        sentenceId: seq3[0]!.id,
        stepIndex: 0,
        chunkText: seq3[0]!.chunks[0]!,
      },
    ]

    const res3 = await store.finalizeGameRun(login.sessionToken, run3.runId, {
      events: events3,
      activeDurationMs: 110_000, // valid in assisted mode (up to 120s)
      endReason: 'time_up',
    })
    expect(res3.cleared).toBe(true)
    expect(res3.score).toBe(900)
    expect(res3.newlyLitSocket).toBe(true)
    expect(res3.litSockets.snake).toBe(true)
    if (res3.actionSummary.kind === 'snake') {
      expect(res3.actionSummary.completedSentences).toBe(3)
      expect(res3.actionSummary.collisions).toBe(2)
      expect(res3.actionSummary.wrongChunkCount).toBe(1)
    }
  })
})
