import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSnakeSentenceSequence, getContentBundle } from '../../../content'
import { BASE_ACTION_POINTS, PASSING_SCORE } from '../../domain/rules'
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
  core_value: '핵심가치',
}

/**
 * 단어 먹는 뱀 (와이드 20x12 네온 아레나 & 연속 웨이브 경쟁 개편본)
 * - 기본 득점: 정답 단어 조각 +2점, 문장 완성 보너스 +2점 (10점 달성 시 통과!)
 * - 통과 이후에도 남은 시간(90초 / 여유 120초) 동안 문장이 계속 순환 출제되어 고득점 경쟁 가능
 * - 넓은 풀-와이드 캔버스 + 매끄러운 네온 뱀 스파인 + 겹치지 않는 일체형 단어 캡슐 디자인
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
  const stepIntervalMs = mode === 'assisted' ? 215 : 170

  const initialSnake = useMemo(() => createSafeSnakeBody(4), [])
  const initialCandidates = useMemo(() => {
    const firstSentence = sentences[0]!
    return spawnCandidateChunks({
      snakeBody: initialSnake.body,
      correctText: firstSentence.chunks[0]!,
      distractors: isPractice
        ? [firstSentence.distractorsByStep[0]![0]!]
        : firstSentence.distractorsByStep[0]!,
      seed: seed ^ 0x101,
    })
  }, [initialSnake.body, sentences, isPractice, seed])

  const [elapsedMs, setElapsedMs] = useState(0)
  const [tabPaused, setTabPaused] = useState(false)
  const [lives, setLives] = useState(3)
  const [sentenceCursor, setSentenceCursor] = useState(0)
  const [stepIdx, setStepIdx] = useState(0)
  const [correctChunks, setCorrectChunks] = useState(0)
  const [completedSentences, setCompletedSentences] = useState(0)
  const [snakeBody, setSnakeBody] = useState<GridPoint[]>(initialSnake.body)
  const [directionState, setDirectionState] = useState<GridDirection>(initialSnake.direction)
  const [candidates, setCandidates] = useState<CandidateChunkOnGrid[]>(initialCandidates)
  const [practiceCleared, setPracticeCleared] = useState(false)
  const [eatBurst, setEatBurst] = useState<{ x: number; y: number; label: string } | null>(null)

  const [wrongOverlay, setWrongOverlay] = useState<{
    chosenText: string
    expectedText: string
  } | null>(null)
  const [toastBanner, setToastBanner] = useState<{
    tone: 'clear' | 'warn' | 'info'
    text: string
  }>({
    tone: 'info',
    text: isPractice
      ? '방향키(↑↓←→)로 네온 뱀을 움직여 정답 단어 캡슐 1개를 먹어 보세요!'
      : '방향키(↑↓←→ / WASD)로 공식 문장의 다음 단어 캡슐을 순서대로 획득하세요! (조각 +2점 · 문장 완성 +2점 · 10점 통과)',
  })

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const finishedRef = useRef(false)
  const elapsedRef = useRef(0)
  const moveAccumRef = useRef(0)
  const seqRef = useRef(0)
  const eventsRef = useRef<SnakeRunEvent[]>([])

  const bodyRef = useRef<GridPoint[]>(initialSnake.body)
  const dirRef = useRef<GridDirection>(initialSnake.direction)
  const queuedDirRef = useRef<GridDirection | null>(null)
  const candidatesRef = useRef<CandidateChunkOnGrid[]>(initialCandidates)
  const livesRef = useRef(3)
  const sentenceCursorRef = useRef(0)
  const stepIdxRef = useRef(0)
  const correctChunksRef = useRef(0)
  const completedSentencesRef = useRef(0)
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
    const curSentence = sentences[sentenceCursorRef.current % sentences.length]!
    const curStep = stepIdxRef.current
    spawnCounterRef.current += 1
    const nextCands = spawnCandidateChunks({
      snakeBody: bodyRef.current,
      correctText: curSentence.chunks[curStep]!,
      distractors: curSentence.distractorsByStep[curStep]!,
      seed: seed ^ (spawnCounterRef.current * 7919),
    })
    candidatesRef.current = nextCands
    setCandidates(nextCands)
    modalPausedRef.current = false
    setWrongOverlay(null)
    setToastBanner({
      tone: 'warn',
      text: `다음 이어질 조각은 "${curSentence.chunks[curStep]}" 입니다. 다시 노려 보세요!`,
    })
  }, [wrongOverlay, sentences, seed])

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
  }, [wrongOverlay, tabPaused, confirmWrongOverlay])

  const queueDirectionInput = useCallback((desired: GridDirection) => {
    if (finishedRef.current || modalPausedRef.current) return
    const baseDir = queuedDirRef.current ?? dirRef.current
    if (desired !== baseDir && !isOppositeDirection(baseDir, desired)) {
      queuedDirRef.current = desired
      playArcadeSfx('select')
    }
  }, [])

  const isSimulationPaused = tabPaused || Boolean(wrongOverlay) || practiceCleared

  useEffect(() => {
    if (isSimulationPaused || finishedRef.current) return
    let lastTs = performance.now()
    let rafId = 0

    const stepSimulation = (nowMs: number) => {
      if (queuedDirRef.current && !isOppositeDirection(dirRef.current, queuedDirRef.current)) {
        dirRef.current = queuedDirRef.current
        setDirectionState(dirRef.current)
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
          setDirectionState(safe.direction)
          setSnakeBody(safe.body)
          setToastBanner({
            tone: 'warn',
            text: '연습 중에는 목숨 차감 없이 중앙에서 바로 다시 출발합니다!',
          })
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

        const safe = createSafeSnakeBody(Math.min(6, currentBody.length))
        bodyRef.current = safe.body
        dirRef.current = safe.direction
        setDirectionState(safe.direction)
        setSnakeBody(safe.body)

        const curSentence = sentences[sentenceCursorRef.current % sentences.length]!
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
        setToastBanner({
          tone: 'warn',
          text: `충돌! 목숨 1개 차감 (남은 목숨 ${nextLives}/3) · 수집한 단어와 점수는 그대로 유지됩니다.`,
        })
        return
      }

      const hitCandidate = candidatesRef.current.find(
        (c) => c.x === nextHead.x && c.y === nextHead.y,
      )

      if (hitCandidate) {
        const curSentence = sentences[sentenceCursorRef.current % sentences.length]!
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
          if (!prefs.reduceMotion) {
            setEatBurst({ x: nextHead.x, y: nextHead.y, label: '+2점!' })
            window.setTimeout(() => setEatBurst(null), 420)
          }
          // Cap max visual tail length at 12 so endless high-score play stays nimble & fun!
          const grownBody = [nextHead, ...currentBody].slice(0, 12)
          bodyRef.current = grownBody
          setSnakeBody(grownBody)

          if (isPractice) {
            playArcadeSfx('clear')
            modalPausedRef.current = true
            setPracticeCleared(true)
            setToastBanner({
              tone: 'clear',
              text: '연습 성공! 정답 단어 캡슐을 획득했습니다. 바로 본게임을 시작해 보세요!',
            })
            onPracticeSuccess?.()
            return
          }

          correctChunksRef.current += 1
          setCorrectChunks(correctChunksRef.current)

          const nextStep = curStep + 1
          if (nextStep >= curSentence.chunks.length) {
            playArcadeSfx('clear')
            completedSentencesRef.current += 1
            setCompletedSentences(completedSentencesRef.current)

            const fullText =
              bundle.records[curSentence.recordId]?.display_ko ?? curSentence.chunks.join(' ')

            // Advance immediately to next sentence (cycling endlessly past 4 for high-score competition!)
            const nextCursor = sentenceCursorRef.current + 1
            sentenceCursorRef.current = nextCursor
            stepIdxRef.current = 0
            setSentenceCursor(nextCursor)
            setStepIdx(0)

            const nextSentence = sentences[nextCursor % sentences.length]!
            spawnCounterRef.current += 1
            const nextCands = spawnCandidateChunks({
              snakeBody: grownBody,
              correctText: nextSentence.chunks[0]!,
              distractors: nextSentence.distractorsByStep[0]!,
              seed: seed ^ (spawnCounterRef.current * 6151),
            })
            candidatesRef.current = nextCands
            setCandidates(nextCands)

            setToastBanner({
              tone: 'clear',
              text: `★ 문장 완성 (+2점 보너스): “${fullText}” — 다음 문장으로 연속 도전!`,
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
          setToastBanner({
            tone: 'clear',
            text: `✓ "${hitCandidate.text}" 획득 (+2점)! 이어서 ${nextStep + 1}번째 조각을 찾으세요.`,
          })
        } else {
          playArcadeSfx('wrong')
          modalPausedRef.current = true
          setWrongOverlay({
            chosenText: hitCandidate.text,
            expectedText: curSentence.chunks[curStep]!,
          })
        }
        return
      }

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
    prefs.reduceMotion,
  ])

  // Render Wide 20x12 Neon Cyber-Snake Arena (1100 x 504)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const cellW = width / SNAKE_GRID_COLS // 55px
    const cellH = height / SNAKE_GRID_ROWS // 42px

    // Deep neon arcade background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height)
    bgGrad.addColorStop(0, '#070d18')
    bgGrad.addColorStop(1, '#0b1424')
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, width, height)

    // Soft spotlight glow around snake head
    const head = snakeBody[0]!
    const headCx = (head.x + 0.5) * cellW
    const headCy = (head.y + 0.5) * cellH
    if (!prefs.reduceMotion) {
      const spot = ctx.createRadialGradient(headCx, headCy, 12, headCx, headCy, 190)
      spot.addColorStop(0, 'rgba(67, 231, 242, 0.14)')
      spot.addColorStop(1, 'rgba(67, 231, 242, 0)')
      ctx.fillStyle = spot
      ctx.fillRect(0, 0, width, height)
    }

    // Crisp subtle grid lines & intersection dots
    ctx.strokeStyle = 'rgba(67, 231, 242, 0.065)'
    ctx.lineWidth = 1
    for (let x = 1; x < SNAKE_GRID_COLS; x += 1) {
      ctx.beginPath()
      ctx.moveTo(x * cellW, 0)
      ctx.lineTo(x * cellW, height)
      ctx.stroke()
    }
    for (let y = 1; y < SNAKE_GRID_ROWS; y += 1) {
      ctx.beginPath()
      ctx.moveTo(0, y * cellH)
      ctx.lineTo(width, y * cellH)
      ctx.stroke()
    }

    // Glowing arena boundary frame
    ctx.strokeStyle = 'rgba(67, 231, 242, 0.48)'
    ctx.lineWidth = 3
    ctx.strokeRect(1.5, 1.5, width - 3, height - 3)

    // Smooth continuous neon spine connecting snake segments
    if (snakeBody.length > 1) {
      ctx.save()
      ctx.strokeStyle = '#7be851'
      ctx.lineWidth = Math.min(cellW, cellH) * 0.64
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (!prefs.reduceMotion) {
        ctx.shadowColor = '#B9F66C'
        ctx.shadowBlur = 12
      }
      ctx.beginPath()
      snakeBody.forEach((seg, idx) => {
        const cx = (seg.x + 0.5) * cellW
        const cy = (seg.y + 0.5) * cellH
        if (idx === 0) ctx.moveTo(cx, cy)
        else ctx.lineTo(cx, cy)
      })
      ctx.stroke()
      ctx.restore()
    }

    // Inner core scales along body + Cyber Visor Head
    for (let i = snakeBody.length - 1; i >= 1; i -= 1) {
      const seg = snakeBody[i]!
      const cx = (seg.x + 0.5) * cellW
      const cy = (seg.y + 0.5) * cellH
      const r = Math.max(6, Math.min(cellW, cellH) * (0.26 - i * 0.008))
      ctx.fillStyle = i % 2 === 0 ? '#d2ff96' : '#43E7F2'
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
    }

    // Snake Head with directional eyes
    ctx.save()
    ctx.fillStyle = '#43E7F2'
    if (!prefs.reduceMotion) {
      ctx.shadowColor = '#43E7F2'
      ctx.shadowBlur = 14
    }
    ctx.beginPath()
    ctx.roundRect(headCx - 21, headCy - 16, 42, 32, 11)
    ctx.fill()
    ctx.restore()

    const eyeOffset = DIRECTION_DELTAS[directionState]
    ctx.fillStyle = '#061019'
    ctx.beginPath()
    ctx.arc(headCx + eyeOffset.x * 7 - eyeOffset.y * 6, headCy + eyeOffset.y * 6 - eyeOffset.x * 6, 3.5, 0, Math.PI * 2)
    ctx.arc(headCx + eyeOffset.x * 7 + eyeOffset.y * 6, headCy + eyeOffset.y * 6 + eyeOffset.x * 6, 3.5, 0, Math.PI * 2)
    ctx.fill()

    // Integrated Neon Word Capsules right at each candidate cell!
    ctx.font = '800 15px "Paperlogy", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const badgeColors = ['#43E7F2', '#FFBD64', '#A78BFA']

    for (const cand of candidates) {
      const cx = (cand.x + 0.5) * cellW
      const cy = (cand.y + 0.5) * cellH
      const accent = badgeColors[(cand.badgeIndex - 1) % badgeColors.length]!

      // Glowing target ring on the exact grid cell to eat
      ctx.save()
      ctx.fillStyle = 'rgba(67, 231, 242, 0.2)'
      ctx.strokeStyle = accent
      ctx.lineWidth = 2.5
      if (!prefs.reduceMotion) {
        ctx.shadowColor = accent
        ctx.shadowBlur = 12
      }
      ctx.beginPath()
      ctx.arc(cx, cy, 16, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()

      // Crisp pill label anchored cleanly just above (or below if top row) the glowing orb
      const label = `${cand.badgeIndex}. ${cand.text}`
      const textWidth = ctx.measureText(label).width
      const pillW = textWidth + 22
      const pillH = 26
      const clampedX = Math.min(width - pillW / 2 - 8, Math.max(pillW / 2 + 8, cx))
      const pillY = cand.y <= 1 ? cy + 28 : cy - 28

      ctx.fillStyle = 'rgba(13, 23, 38, 0.94)'
      ctx.strokeStyle = accent
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.roundRect(clampedX - pillW / 2, pillY - pillH / 2, pillW, pillH, 999)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#F2F6FB'
      ctx.fillText(label, clampedX, pillY + 0.5)
    }

    if (eatBurst && !prefs.reduceMotion) {
      const bx = (eatBurst.x + 0.5) * cellW
      const by = (eatBurst.y + 0.5) * cellH
      ctx.save()
      ctx.strokeStyle = '#B9F66C'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(bx, by, 28, 0, Math.PI * 2)
      ctx.stroke()
      ctx.font = '900 18px "Paperlogy", sans-serif'
      ctx.fillStyle = '#B9F66C'
      ctx.fillText(eatBurst.label, bx, by - 26)
      ctx.restore()
    }
  }, [snakeBody, candidates, directionState, eatBurst, prefs.reduceMotion])

  const currentSentence = sentences[sentenceCursor % sentences.length]!
  const collectedChunks = currentSentence.chunks.slice(0, stepIdx)
  const remainingSec = Math.max(0, Math.ceil((maxDurationMs - elapsedMs) / 1000))
  const score =
    correctChunks * BASE_ACTION_POINTS + completedSentences * BASE_ACTION_POINTS
  const cleared = score >= PASSING_SCORE

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 6 }}>
      {/* Compact Wide HUD */}
      <div className="play-hud-bar" style={{ marginBottom: 0, padding: '6px 12px' }}>
        <div className="hud-metric">
          <span className="cabinet-badge-type">
            {DOMAIN_BADGE_LABELS[currentSentence.domain]}
          </span>
          <strong style={{ color: cleared ? 'var(--accent-clear)' : 'var(--accent-select)' }}>
            {isPractice
              ? `연습 조각 ${practiceCleared ? 1 : 0}/1`
              : cleared
                ? `✓ 통과 달성! · 완성 ${completedSentences}문장 (고득점 경쟁 중)`
                : `통과까지 ${Math.max(0, PASSING_SCORE - score)}점 남음 (${score}/${PASSING_SCORE}점)`}
          </strong>
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
                {'♡'.repeat(Math.max(0, 3 - lives))}
              </span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>점수</span>
              <span className="mono-num" style={{ fontSize: 22, color: 'var(--accent-clear)' }}>
                {score}점
              </span>
            </>
          )}
        </div>
      </div>

      {/* Inline Sentence Assembly + Live Toast Strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          padding: '6px 12px',
          background: '#121b29',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>
            현재 조립:
          </span>
          {currentSentence.chunks.map((chunk, i) => {
            const collected = i < collectedChunks.length
            const isCurrentTarget = i === collectedChunks.length
            return (
              <span
                key={i}
                style={{
                  padding: '2px 9px',
                  borderRadius: 999,
                  fontSize: 14,
                  fontWeight: 700,
                  background: collected
                    ? 'rgba(185, 246, 108, 0.16)'
                    : isCurrentTarget
                      ? 'rgba(67, 231, 242, 0.16)'
                      : '#0d131d',
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
                {collected ? `✓ ${chunk}` : isCurrentTarget ? `▶ ${i + 1}번째 조각 찾기` : `· ${i + 1}번째`}
              </span>
            )
          })}
        </div>

        <span
          style={{
            fontSize: 13,
            color:
              toastBanner.tone === 'clear'
                ? 'var(--accent-clear)'
                : toastBanner.tone === 'warn'
                  ? 'var(--accent-warn)'
                  : 'var(--text-muted)',
            fontWeight: 600,
          }}
        >
          {toastBanner.text}
        </span>
      </div>

      {/* Full-Width Spacious 20x12 Neon Arena */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#070d18',
          border: '1.5px solid rgba(67, 231, 242, 0.35)',
          borderRadius: 10,
          overflow: 'hidden',
          minHeight: 430,
        }}
      >
        <canvas
          ref={canvasRef}
          width={1100}
          height={504}
          style={{
            width: '100%',
            height: '100%',
            maxHeight: 520,
            objectFit: 'contain',
            display: 'block',
          }}
          aria-label="단어 먹는 뱀 와이드 아레나"
        />

        {wrongOverlay && (
          <div
            role="dialog"
            aria-label="오답 조각 안내"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(9, 14, 23, 0.88)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              zIndex: 12,
            }}
          >
            <div className="cabinet-modal-card" style={{ maxWidth: 480 }}>
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
                확인 · 이어서 다시 고르기 (Enter / Space)
              </button>
            </div>
          </div>
        )}

        {tabPaused && !wrongOverlay && (
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

      {/* Tactile Arcade D-Pad Controls (Mouse / Touch / Keyboard Friendly) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        <button
          type="button"
          className="btn-arcade btn-compact"
          disabled={isSimulationPaused}
          onClick={() => queueDirectionInput('left')}
        >
          ◀ 좌측 (← / A)
        </button>
        <button
          type="button"
          className="btn-arcade btn-compact"
          disabled={isSimulationPaused}
          onClick={() => queueDirectionInput('up')}
        >
          ▲ 상단 (↑ / W)
        </button>
        <button
          type="button"
          className="btn-arcade btn-compact"
          disabled={isSimulationPaused}
          onClick={() => queueDirectionInput('down')}
        >
          ▼ 하단 (↓ / S)
        </button>
        <button
          type="button"
          className="btn-arcade btn-compact"
          disabled={isSimulationPaused}
          onClick={() => queueDirectionInput('right')}
        >
          우측 (→ / D) ▶
        </button>
      </div>
    </div>
  )
}
