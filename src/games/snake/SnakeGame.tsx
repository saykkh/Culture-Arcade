import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSnakeSentenceSequence, getContentBundle } from '../../../content'
import type { GameMode, LearningDomain, RunEndReason, SnakeRunEvent } from '../../domain/types'
import { useArcadePreferences } from '../../lib/preferences'
import { playArcadeSfx } from '../../lib/sound'
import {
  createSafeSnakeBody,
  DIRECTION_DELTAS,
  isInsideGrid,
  isOppositeDirection,
  SNAKE_GRID_COLS,
  SNAKE_GRID_ROWS,
  spawnCandidateChunks,
  type CandidateChunkOnGrid,
  type GridDirection,
  type GridPoint,
} from './engine'

export interface SnakeGameProps {
  seed: number
  mode: GameMode
  contentVersion: string
  isPractice?: boolean
  onPracticeSuccess?: () => void
  onPracticeTimeUp?: () => void
  onFinishRound?: (result: {
    events: SnakeRunEvent[]
    activeDurationMs: number
    endReason: RunEndReason
  }) => void
}

const DOMAIN_BADGE_LABELS: Record<LearningDomain, string> = {
  philosophy: '경영철학',
  mission: '미션',
  vision: '비전',
  core_value: '핵심가치 종합',
}

/**
 * 단어 먹는 뱀 (snake)
 * - 정규: 최대 90초, 이동 간격 180ms, 목숨 3개, 4문장 중 3문장 완성 시 클리어 (문장당 +300점)
 * - 지원: 최대 120초, 이동 속도 정규의 80% (간격 225ms)
 * - 첫 문장은 경영철학 고정, 2·3번째는 미션·비전(시드 교환), 4번째는 핵심가치 종합 문장
 * - 오답 조각: 목숨·점수·수집 순서 보존, 일시 정지 후 고른 조각과 알맞은 다음 조각 안내 → 같은 자리에서 재선택
 * - 벽/몸통 충돌: 목숨 1개만 차감, 수집 순서·점수 보존, 안전한 중앙 칸에서 재개
 * - 문장 완성 시 한 줄 공식 문장 + 해설 표시 (해설 확인 시간은 90초 타이머에서 제외)
 */
export function SnakeGame({
  seed,
  mode,
  contentVersion,
  isPractice = false,
  onPracticeSuccess,
  onPracticeTimeUp,
  onFinishRound,
}: SnakeGameProps) {
  const { prefs } = useArcadePreferences()
  const bundle = useMemo(() => getContentBundle(contentVersion), [contentVersion])
  const sentences = useMemo(() => buildSnakeSentenceSequence(bundle, seed), [bundle, seed])

  const maxDurationMs = isPractice ? 30_000 : mode === 'assisted' ? 120_000 : 90_000
  const stepIntervalMs = mode === 'assisted' ? 225 : 180

  const initialSnake = useMemo(() => createSafeSnakeBody(3), [])
  const initialCandidates = useMemo(() => {
    const firstSentence = sentences[0]!
    return spawnCandidateChunks({
      snakeBody: initialSnake.body,
      correctText: firstSentence.chunks[0]!,
      distractors: isPractice ? [firstSentence.distractorsByStep[0]![0]!] : firstSentence.distractorsByStep[0]!,
      seed: seed ^ 0x101,
    })
  }, [initialSnake.body, sentences, isPractice, seed])

  const [elapsedMs, setElapsedMs] = useState(0)
  const [tabPaused, setTabPaused] = useState(false)
  const [lives, setLives] = useState(3)
  const [sentenceIdx, setSentenceIdx] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [snakeBody, setSnakeBody] = useState<GridPoint[]>(initialSnake.body)
  const [candidates, setCandidates] = useState<CandidateChunkOnGrid[]>(initialCandidates)
  const [practiceCleared, setPracticeCleared] = useState(false)

  // Modal overlays that pause active timer (wrong chunk comparison & sentence completion reveal)
  const [wrongOverlay, setWrongOverlay] = useState<{
    chosenText: string
    expectedText: string
  } | null>(null)
  const [completedOverlay, setCompletedOverlay] = useState<{
    domainLabel: string
    fullSentence: string
    explanation: string
    isLastSentence: boolean
  } | null>(null)
  const [statusNotice, setStatusNotice] = useState<string>(
    isPractice
      ? '연습: 방향키(↑↓←→)로 뱀을 움직여 첫 번째 정답 단어 조각을 먹어 보세요.'
      : '방향키(↑↓←→)로 움직여 공식 문장의 다음 단어 조각을 순서대로 모으세요.',
  )

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const finishedRef = useRef(false)
  const elapsedRef = useRef(0)
  const moveAccumRef = useRef(0)
  const seqRef = useRef(0)
  const eventsRef = useRef<SnakeRunEvent[]>([])

  // Mutable simulation refs synced with React state for crisp deterministic ticks
  const bodyRef = useRef<GridPoint[]>(initialSnake.body)
  const dirRef = useRef<GridDirection>(initialSnake.direction)
  const queuedDirRef = useRef<GridDirection | null>(null)
  const candidatesRef = useRef<CandidateChunkOnGrid[]>(initialCandidates)
  const livesRef = useRef(3)
  const sentenceIdxRef = useRef(0)
  const stepIdxRef = useRef(0)
  const completedCountRef = useRef(0)
  const spawnCounterRef = useRef(1)
  const modalPausedRef = useRef(false)

  const finishOnce = useCallback(
    (reason: RunEndReason, finalMs: number) => {
      if (finishedRef.current) return
      finishedRef.current = true
      if (isPractice) {
        onPracticeTimeUp?.()
        return
      }
      onFinishRound?.({
        events: [...eventsRef.current],
        activeDurationMs: Math.min(maxDurationMs, Math.round(finalMs)),
        endReason: reason,
      })
    },
    [isPractice, maxDurationMs, onFinishRound, onPracticeTimeUp],
  )

  // Pause when browser tab becomes hidden
  useEffect(() => {
    const onVisChange = () => {
      if (document.hidden && !finishedRef.current) {
        setTabPaused(true)
      }
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [])

  const confirmWrongOverlay = useCallback(() => {
    if (!wrongOverlay) return
    const currentSentence = sentences[sentenceIdxRef.current]!
    const currentStep = stepIdxRef.current
    spawnCounterRef.current += 1
    // Respawn candidates from the current safe head position so player picks again at the same spot
    const nextCands = spawnCandidateChunks({
      snakeBody: bodyRef.current,
      correctText: currentSentence.chunks[currentStep]!,
      distractors: currentSentence.distractorsByStep[currentStep]!,
      seed: seed ^ (spawnCounterRef.current * 7919),
    })
    candidatesRef.current = nextCands
    setCandidates(nextCands)
    modalPausedRef.current = false
    setWrongOverlay(null)
    setStatusNotice(`다시 선택하세요 · 다음 조각 힌트: "${currentSentence.chunks[currentStep]}"`)
  }, [wrongOverlay, sentences, seed])

  const confirmCompletedOverlay = useCallback(() => {
    if (!completedOverlay) return
    if (completedOverlay.isLastSentence) {
      setCompletedOverlay(null)
      finishOnce('completed_all', elapsedRef.current)
      return
    }
    const nextSentenceIndex = sentenceIdxRef.current + 1
    sentenceIdxRef.current = nextSentenceIndex
    stepIdxRef.current = 0
    setSentenceIdx(nextSentenceIndex)
    setStepIdx(0)

    const resetSnake = createSafeSnakeBody(Math.min(5, bodyRef.current.length))
    bodyRef.current = resetSnake.body
    dirRef.current = resetSnake.direction
    queuedDirRef.current = null
    setSnakeBody(resetSnake.body)

    const nextSentence = sentences[nextSentenceIndex]!
    spawnCounterRef.current += 1
    const nextCands = spawnCandidateChunks({
      snakeBody: resetSnake.body,
      correctText: nextSentence.chunks[0]!,
      distractors: nextSentence.distractorsByStep[0]!,
      seed: seed ^ (spawnCounterRef.current * 6151),
    })
    candidatesRef.current = nextCands
    setCandidates(nextCands)
    modalPausedRef.current = false
    setCompletedOverlay(null)
    setStatusNotice(
      `${nextSentenceIndex + 1}번째 문장 (${DOMAIN_BADGE_LABELS[nextSentence.domain]}) 조립을 시작합니다!`,
    )
  }, [completedOverlay, finishOnce, sentences, seed])

  // Keyboard controls (Arrow keys + WASD, Enter/Space to dismiss modal overlays)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (finishedRef.current) return

      if (wrongOverlay) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          confirmWrongOverlay()
        }
        return
      }

      if (completedOverlay) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          confirmCompletedOverlay()
        }
        return
      }

      if (tabPaused) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          setTabPaused(false)
        }
        return
      }

      let desired: GridDirection | null = null
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') desired = 'up'
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') desired = 'down'
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') desired = 'left'
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') desired = 'right'

      if (desired) {
        e.preventDefault()
        e.stopPropagation()
        const baseDir = queuedDirRef.current ?? dirRef.current
        if (desired !== baseDir && !isOppositeDirection(baseDir, desired)) {
          queuedDirRef.current = desired
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [wrongOverlay, completedOverlay, tabPaused, confirmWrongOverlay, confirmCompletedOverlay])

  const isSimulationPaused =
    tabPaused || Boolean(wrongOverlay) || Boolean(completedOverlay) || practiceCleared

  // Main simulation & timer loop (excludes completedOverlay / wrongOverlay / tabPaused time!)
  useEffect(() => {
    if (isSimulationPaused || finishedRef.current) return
    let lastTs = performance.now()
    let rafId = 0

    const stepSimulation = (nowMs: number) => {
      if (queuedDirRef.current && !isOppositeDirection(dirRef.current, queuedDirRef.current)) {
        dirRef.current = queuedDirRef.current
      }
      queuedDirRef.current = null

      const currentBody = bodyRef.current
      const head = currentBody[0]!
      const delta = DIRECTION_DELTAS[dirRef.current]
      const nextHead: GridPoint = { x: head.x + delta.x, y: head.y + delta.y }

      const hitWall = !isInsideGrid(nextHead)
      const bodyWithoutTail = currentBody.slice(0, -1)
      const hitBody =
        !hitWall && bodyWithoutTail.some((seg) => seg.x === nextHead.x && seg.y === nextHead.y)

      if (hitWall || hitBody) {
        playArcadeSfx('wrong')
        if (isPractice) {
          const safe = createSafeSnakeBody(currentBody.length)
          bodyRef.current = safe.body
          dirRef.current = safe.direction
          setSnakeBody(safe.body)
          setStatusNotice('연습 중에는 목숨 차감 없이 중앙 안전 위치에서 다시 출발합니다!')
          return
        }

        seqRef.current += 1
        eventsRef.current.push({
          seq: seqRef.current,
          t_ms: Math.min(maxDurationMs, Math.round(nowMs)),
          type: 'collision',
          cause: hitWall ? 'wall' : 'body',
        })

        const nextLives = livesRef.current - 1
        livesRef.current = nextLives
        setLives(nextLives)

        if (nextLives <= 0) {
          finishOnce('lives_exhausted', nowMs)
          return
        }

        const safe = createSafeSnakeBody(currentBody.length)
        bodyRef.current = safe.body
        dirRef.current = safe.direction
        setSnakeBody(safe.body)

        const curSentence = sentences[sentenceIdxRef.current]!
        const curStep = stepIdxRef.current
        spawnCounterRef.current += 1
        const safeCands = spawnCandidateChunks({
          snakeBody: safe.body,
          correctText: curSentence.chunks[curStep]!,
          distractors: curSentence.distractorsByStep[curStep]!,
          seed: seed ^ (spawnCounterRef.current * 4099),
        })
        candidatesRef.current = safeCands
        setCandidates(safeCands)
        setStatusNotice(
          `충돌! 목숨 1개 차감 (남은 목숨 ${nextLives}/3) · 수집한 단어와 점수는 그대로 유지됩니다.`,
        )
        return
      }

      const hitCandidate = candidatesRef.current.find(
        (c) => c.x === nextHead.x && c.y === nextHead.y,
      )

      if (hitCandidate) {
        const curSentence = sentences[sentenceIdxRef.current]!
        const curStep = stepIdxRef.current

        if (!isPractice) {
          seqRef.current += 1
          eventsRef.current.push({
            seq: seqRef.current,
            t_ms: Math.min(maxDurationMs, Math.round(nowMs)),
            type: 'pick_chunk',
            sentenceId: curSentence.id,
            stepIndex: curStep,
            chunkText: hitCandidate.text,
          })
        }

        if (hitCandidate.isCorrect) {
          // Grow body by keeping tail
          const grownBody = [nextHead, ...currentBody]
          bodyRef.current = grownBody
          setSnakeBody(grownBody)

          if (isPractice) {
            playArcadeSfx('clear')
            modalPausedRef.current = true
            setPracticeCleared(true)
            setStatusNotice('연습 성공! 정답 단어 조각을 먹어 몸이 길어졌습니다. 본게임을 시작해 보세요.')
            onPracticeSuccess?.()
            return
          }

          const nextStep = curStep + 1
          if (nextStep >= curSentence.chunks.length) {
            playArcadeSfx('clear')
            modalPausedRef.current = true
            const newCompleted = completedCountRef.current + 1
            completedCountRef.current = newCompleted
            setCompletedCount(newCompleted)
            setStepIdx(nextStep)
            const fullRecord = bundle.records[curSentence.recordId]
            setCompletedOverlay({
              domainLabel: DOMAIN_BADGE_LABELS[curSentence.domain],
              fullSentence: fullRecord?.display_ko ?? curSentence.chunks.join(' '),
              explanation: curSentence.explanation,
              isLastSentence: sentenceIdxRef.current >= sentences.length - 1,
            })
            return
          }

          playArcadeSfx('score')
          stepIdxRef.current = nextStep
          setStepIdx(nextStep)
          spawnCounterRef.current += 1
          const nextCands = spawnCandidateChunks({
            snakeBody: grownBody,
            correctText: curSentence.chunks[nextStep]!,
            distractors: curSentence.distractorsByStep[nextStep]!,
            seed: seed ^ (spawnCounterRef.current * 8191),
          })
          candidatesRef.current = nextCands
          setCandidates(nextCands)
          setStatusNotice(`✓ "${hitCandidate.text}" 수집 완료! 다음 이어질 조각을 찾으세요.`)
        } else {
          // Wrong chunk: preserve lives, score, and collected chunks; pause and show comparison
          playArcadeSfx('wrong')
          modalPausedRef.current = true
          setWrongOverlay({
            chosenText: hitCandidate.text,
            expectedText: curSentence.chunks[curStep]!,
          })
        }
        return
      }

      // Normal step forward
      const movedBody = [nextHead, ...bodyWithoutTail]
      bodyRef.current = movedBody
      setSnakeBody(movedBody)
    }

    const tick = (nowTs: number) => {
      if (finishedRef.current || modalPausedRef.current) return
      const dt = Math.min(100, Math.max(0, nowTs - lastTs))
      lastTs = nowTs

      const nextElapsed = elapsedRef.current + dt
      elapsedRef.current = nextElapsed
      setElapsedMs(nextElapsed)

      if (nextElapsed >= maxDurationMs) {
        finishOnce('time_up', maxDurationMs)
        return
      }

      moveAccumRef.current += dt
      while (
        moveAccumRef.current >= stepIntervalMs &&
        !finishedRef.current &&
        !modalPausedRef.current
      ) {
        moveAccumRef.current -= stepIntervalMs
        stepSimulation(elapsedRef.current)
        if (finishedRef.current || modalPausedRef.current) return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [
    isSimulationPaused,
    isPractice,
    maxDurationMs,
    stepIntervalMs,
    sentences,
    bundle,
    seed,
    finishOnce,
    onPracticeSuccess,
  ])

  // Render 2D Canvas grid, snake segments, and labeled candidate word orbs
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const cellW = width / SNAKE_GRID_COLS
    const cellH = height / SNAKE_GRID_ROWS

    ctx.fillStyle = '#091019'
    ctx.fillRect(0, 0, width, height)

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(67, 231, 242, 0.08)'
    ctx.lineWidth = 1
    for (let x = 0; x <= SNAKE_GRID_COLS; x += 1) {
      ctx.beginPath()
      ctx.moveTo(x * cellW, 0)
      ctx.lineTo(x * cellW, height)
      ctx.stroke()
    }
    for (let y = 0; y <= SNAKE_GRID_ROWS; y += 1) {
      ctx.beginPath()
      ctx.moveTo(0, y * cellH)
      ctx.lineTo(width, y * cellH)
      ctx.stroke()
    }

    // Outer border warning frame
    ctx.strokeStyle = 'rgba(255, 189, 100, 0.35)'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, width - 2, height - 2)

    // Draw snake body from tail to head
    for (let i = snakeBody.length - 1; i >= 0; i -= 1) {
      const seg = snakeBody[i]!
      const px = seg.x * cellW + 3
      const py = seg.y * cellH + 3
      const pw = cellW - 6
      const ph = cellH - 6
      const isHead = i === 0

      ctx.fillStyle = isHead ? '#43E7F2' : i % 2 === 0 ? '#97e855' : '#6dc238'
      ctx.beginPath()
      ctx.roundRect(px, py, pw, ph, isHead ? 8 : 6)
      ctx.fill()

      if (isHead) {
        ctx.fillStyle = '#08131a'
        ctx.beginPath()
        ctx.arc(px + pw * 0.68, py + ph * 0.34, 3, 0, Math.PI * 2)
        ctx.arc(px + pw * 0.68, py + ph * 0.66, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Draw candidate chunks with crisp pill labels centered on their target cell
    ctx.font = '700 14px Pretendard, "Malgun Gothic", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (const cand of candidates) {
      const cx = (cand.x + 0.5) * cellW
      const cy = (cand.y + 0.5) * cellH

      // Target beacon cell box
      ctx.fillStyle = 'rgba(67, 231, 242, 0.18)'
      ctx.strokeStyle = '#43E7F2'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(cand.x * cellW + 4, cand.y * cellH + 4, cellW - 8, cellH - 8, 7)
      ctx.fill()
      ctx.stroke()

      // Floating readable text badge right above/on cell (clamped inside canvas bounds)
      const textMetrics = ctx.measureText(cand.text)
      const pillW = Math.max(cellW - 4, textMetrics.width + 18)
      const pillH = 24
      const clampedX = Math.min(width - pillW / 2 - 6, Math.max(pillW / 2 + 6, cx))
      const badgeY = cand.y === 0 ? cy + cellH * 0.58 : cy - cellH * 0.52

      ctx.fillStyle = '#162336'
      ctx.strokeStyle = 'rgba(242, 246, 251, 0.65)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.roundRect(clampedX - pillW / 2, badgeY - pillH / 2, pillW, pillH, 6)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#F2F6FB'
      ctx.fillText(cand.text, clampedX, badgeY + 0.5)
    }
  }, [snakeBody, candidates, prefs.reduceMotion])

  const currentSentence = sentences[sentenceIdx]!
  const collectedChunks = currentSentence.chunks.slice(0, stepIdx)
  const remainingSec = Math.max(0, Math.ceil((maxDurationMs - elapsedMs) / 1000))
  const score = completedCount * 300

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}>
      {/* Top HUD */}
      <div className="play-hud-bar">
        <div className="hud-metric">
          <span className="cabinet-badge-type">
            {DOMAIN_BADGE_LABELS[currentSentence.domain]}
          </span>
          <strong style={{ color: completedCount >= 3 ? 'var(--accent-clear)' : 'var(--accent-select)' }}>
            {isPractice
              ? `연습 조각 ${practiceCleared ? 1 : 0}/1`
              : `완성 문장 ${completedCount}/3`}
          </strong>
          {!isPractice && (
            <span className="mono-num" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              ({sentenceIdx + 1}/4번째 문장)
            </span>
          )}
        </div>

        <div className="hud-metric" style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>남은 시간</span>
          <span
            className="mono-num"
            style={{
              fontSize: 20,
              color: remainingSec <= 15 ? 'var(--accent-warn)' : 'var(--text-primary)',
            }}
          >
            {remainingSec}s
          </span>
        </div>

        <div className="hud-metric" style={{ justifyContent: 'flex-end' }}>
          {!isPractice && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>목숨</span>
              <span
                aria-label={`남은 목숨 ${lives}개`}
                style={{ color: lives === 1 ? 'var(--accent-danger)' : '#ff7b93', fontWeight: 700 }}
              >
                {'♥'.repeat(Math.max(0, lives))}
                {'♡'.repeat(Math.max(0, 3 - lives))} ({lives}/3)
              </span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>점수</span>
              <span className="mono-num" style={{ fontSize: 20, color: 'var(--accent-clear)' }}>
                {score}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Collected Word Sequence Bar (PRD 3.2: 다음 조각 후보를 고를 때까지 이미 수집한 단어 순서를 HUD에 표시) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '8px 12px',
          background: '#131c29',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          minHeight: 42,
        }}
        aria-label="수집한 공식 문장 단어 순서"
      >
        <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>
          조립 중인 공식 문장 ({stepIdx}/{currentSentence.chunks.length}조각):
        </span>
        {currentSentence.chunks.map((chunk, i) => {
          const collected = i < collectedChunks.length
          const isCurrentTarget = i === collectedChunks.length
          return (
            <span
              key={i}
              style={{
                padding: '3px 10px',
                borderRadius: 6,
                fontSize: 15,
                fontWeight: 700,
                background: collected
                  ? 'rgba(185, 246, 108, 0.16)'
                  : isCurrentTarget
                    ? 'rgba(67, 231, 242, 0.14)'
                    : '#0e141f',
                border: `1px solid ${
                  collected
                    ? 'var(--accent-clear)'
                    : isCurrentTarget
                      ? 'var(--accent-select)'
                      : 'rgba(242,246,251,0.14)'
                }`,
                color: collected
                  ? 'var(--accent-clear)'
                  : isCurrentTarget
                    ? 'var(--accent-select)'
                    : 'var(--text-muted)',
              }}
            >
              {collected ? `✓ ${chunk}` : isCurrentTarget ? `? ${i + 1}번째 조각 선택` : `· ${i + 1}번째 조각`}
            </span>
          )
        })}
      </div>

      {/* 2D Grid Stage + Pause/Feedback Overlays */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#091019',
          border: '1px solid rgba(67, 231, 242, 0.26)',
          borderRadius: 10,
          overflow: 'hidden',
          minHeight: 330,
        }}
      >
        <canvas
          ref={canvasRef}
          width={896}
          height={350}
          style={{ width: '100%', height: '100%', maxHeight: 370, display: 'block' }}
          aria-label="단어 먹는 뱀 플레이 격자"
        />

        {/* Wrong Chunk Feedback Modal (preserves lives, score, collected chunks!) */}
        {wrongOverlay && (
          <div
            role="dialog"
            aria-label="오답 조각 안내"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(11, 15, 23, 0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              zIndex: 12,
            }}
          >
            <div className="cabinet-modal-card" style={{ maxWidth: 500 }}>
              <div style={{ color: 'var(--accent-warn)', fontWeight: 800, marginBottom: 6 }}>
                ▲ 다른 조각을 골랐습니다 (목숨·점수·수집 조각 유지)
              </div>
              <div style={{ display: 'grid', gap: 8, margin: '10px 0 16px' }} className="instruction-text">
                <div>
                  내가 고른 조각:{' '}
                  <strong style={{ color: 'var(--accent-warn)' }}>"{wrongOverlay.chosenText}"</strong>
                </div>
                <div>
                  알맞은 다음 조각:{' '}
                  <strong style={{ color: 'var(--accent-clear)' }}>"{wrongOverlay.expectedText}"</strong>
                </div>
              </div>
              <button
                type="button"
                className="btn-arcade btn-start"
                autoFocus
                onClick={confirmWrongOverlay}
              >
                확인 · 같은 자리에서 다시 고르기 (Enter)
              </button>
            </div>
          </div>
        )}

        {/* Sentence Completed Unfold Overlay (excluded from 90s timer!) */}
        {completedOverlay && (
          <div
            role="dialog"
            aria-label="공식 문장 완성 해설"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(11, 15, 23, 0.92)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              zIndex: 12,
            }}
          >
            <div className="cabinet-modal-card" style={{ maxWidth: 580, borderColor: 'var(--accent-clear)' }}>
              <span className="cabinet-status-tag cleared">
                ✓ {completedOverlay.domainLabel} 문장 완성 (+300점 · 해설 중 타이머 정지)
              </span>
              <h3 style={{ margin: '12px 0 8px', fontSize: 21, color: 'var(--text-primary)' }}>
                “{completedOverlay.fullSentence}”
              </h3>
              <p className="instruction-text" style={{ color: 'var(--text-muted)', marginTop: 0 }}>
                {completedOverlay.explanation}
              </p>
              <button
                type="button"
                className="btn-arcade btn-clear-cta"
                autoFocus
                onClick={confirmCompletedOverlay}
              >
                {completedOverlay.isLastSentence
                  ? '4문장 모두 완성 · 결과 확인하기 (Enter) ▶'
                  : '확인 · 다음 공식 문장으로 (Enter) ▶'}
              </button>
            </div>
          </div>
        )}

        {/* Tab Hidden Pause Overlay */}
        {tabPaused && !wrongOverlay && !completedOverlay && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(11, 15, 23, 0.88)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              zIndex: 11,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800 }}>일시 정지됨</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>
              탭 전환으로 타이머와 뱀 이동이 멈췄습니다.
            </div>
            <button
              type="button"
              className="btn-arcade btn-start"
              onClick={() => setTabPaused(false)}
            >
              ▶ 계속하기
            </button>
          </div>
        )}
      </div>

      {/* Status + Touch/Click Direction Pad Helper */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '6px 10px',
          background: '#131b28',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 14 }}>{statusNotice}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['left', 'up', 'down', 'right'] as const).map((d) => {
            const label = d === 'left' ? '←' : d === 'up' ? '↑' : d === 'down' ? '↓' : '→'
            return (
              <button
                key={d}
                type="button"
                className="btn-arcade btn-compact"
                onClick={() => {
                  const base = queuedDirRef.current ?? dirRef.current
                  if (d !== base && !isOppositeDirection(base, d)) {
                    queuedDirRef.current = d
                  }
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
