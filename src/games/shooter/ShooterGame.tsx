import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildShooterRound, getContentBundle } from '../../../content'
import type { GameMode, RunEndReason, ShooterRunEvent } from '../../domain/types'
import { useArcadePreferences } from '../../lib/preferences'
import { playArcadeSfx } from '../../lib/sound'
import { findHitTargetLane, TARGET_HITBOXES } from './hitboxes'

export interface ShooterGameProps {
  seed: number
  mode: GameMode
  contentVersion: string
  isPractice?: boolean
  onPracticeSuccess?: () => void
  onPracticeTimeUp?: () => void
  onFinishRound?: (result: {
    events: ShooterRunEvent[]
    activeDurationMs: number
    endReason: RunEndReason
  }) => void
}

type QuestionPhase = 'reading' | 'aiming' | 'feedback'

/**
 * 가치 표적 슈팅 (shooter)
 * - 12문항 (C·O·R·E 각 3문항, 세 위치에 정답 4회씩 균등 시드 배치), 8문항 이상 정답 시 클리어 (+100점/문항)
 * - 읽기 화면: 시간 압박 없이 문항과 고정된 3개 표적 확인 → '조준 시작' 시 6초(지원 9초) 카운트 시작
 * - 시작 키(Space)를 놓은 뒤의 Space 입력부터 발사하며, 빈 틈에 빗맞히면 남은 시간에 재발사 가능
 * - 오답 피드백에는 '내가 고른 가치'와 '정답 가치'의 승인 설명을 한 줄씩 함께 표시
 */
export function ShooterGame({
  seed,
  mode,
  contentVersion,
  isPractice = false,
  onPracticeSuccess,
  onPracticeTimeUp,
  onFinishRound,
}: ShooterGameProps) {
  const { prefs } = useArcadePreferences()
  const bundle = useMemo(() => getContentBundle(contentVersion), [contentVersion])
  const roundItems = useMemo(() => {
    const full = buildShooterRound(bundle, seed)
    return isPractice ? [full[0]!] : full
  }, [bundle, seed, isPractice])

  const aimLimitMs = mode === 'assisted' ? 9_000 : 6_000
  const maxActiveRoundMs = isPractice ? 30_000 : mode === 'assisted' ? 235_000 : 175_000

  const [questionIdx, setQuestionIdx] = useState(0)
  const [phase, setPhase] = useState<QuestionPhase>('reading')
  const [aimElapsedMs, setAimElapsedMs] = useState(0)
  const [practiceElapsedMs, setPracticeElapsedMs] = useState(0)
  const [tabPaused, setTabPaused] = useState(false)
  const [shipX, setShipX] = useState(0.5)
  const [correctCount, setCorrectCount] = useState(0)
  const [practiceCleared, setPracticeCleared] = useState(false)
  const [missNotice, setMissNotice] = useState<string | null>(null)
  const [laserBeam, setLaserBeam] = useState<{ x: number; hit: boolean } | null>(null)

  const [feedbackData, setFeedbackData] = useState<{
    outcome: 'correct' | 'wrong' | 'timeout'
    chosenLabel: string | null
    chosenExplanation: string | null
    correctLabel: string
    correctExplanation: string
  } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const finishedRef = useRef(false)
  const totalActiveMsRef = useRef(0)
  const aimElapsedRef = useRef(0)
  const shipXRef = useRef(0.5)
  const keysHeldRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false })
  // Requires releasing the key used to start aiming before Space can fire!
  const requireSpaceReleaseRef = useRef(false)
  const seqRef = useRef(0)
  const eventsRef = useRef<ShooterRunEvent[]>([])
  const phaseRef = useRef<QuestionPhase>('reading')
  const questionIdxRef = useRef(0)

  const currentScheduled = roundItems[questionIdx]!

  const finishOnce = useCallback(
    (reason: RunEndReason) => {
      if (finishedRef.current) return
      finishedRef.current = true
      if (isPractice) {
        onPracticeTimeUp?.()
        return
      }
      onFinishRound?.({
        events: [...eventsRef.current],
        activeDurationMs: Math.min(maxActiveRoundMs, Math.round(totalActiveMsRef.current)),
        endReason: reason,
      })
    },
    [isPractice, maxActiveRoundMs, onFinishRound, onPracticeTimeUp],
  )

  useEffect(() => {
    const onVisChange = () => {
      if (document.hidden && !finishedRef.current) {
        keysHeldRef.current = { left: false, right: false }
        setTabPaused(true)
      }
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [])

  const beginAiming = useCallback(
    (triggeredBySpaceKey: boolean) => {
      if (finishedRef.current || phaseRef.current !== 'reading') return
      const current = roundItems[questionIdxRef.current]!
      playArcadeSfx('start')
      aimElapsedRef.current = 0
      setAimElapsedMs(0)
      setMissNotice(null)
      requireSpaceReleaseRef.current = triggeredBySpaceKey

      if (!isPractice) {
        seqRef.current += 1
        eventsRef.current.push({
          seq: seqRef.current,
          t_ms: Math.min(maxActiveRoundMs, Math.round(totalActiveMsRef.current)),
          type: 'aim_start',
          itemId: current.item.id,
        })
      }

      phaseRef.current = 'aiming'
      setPhase('aiming')
    },
    [isPractice, maxActiveRoundMs, roundItems],
  )

  const finalizeCurrentQuestion = useCallback(
    (selectedLane: 0 | 1 | 2 | null) => {
      if (finishedRef.current || phaseRef.current !== 'aiming') return
      const current = roundItems[questionIdxRef.current]!
      const aimDuration = Math.min(aimLimitMs, Math.round(aimElapsedRef.current))
      const nowActiveMs = Math.min(maxActiveRoundMs, Math.round(totalActiveMsRef.current))
      const correctRec = bundle.records[current.item.correct_id]!

      if (selectedLane === null) {
        // Timeout
        playArcadeSfx('wrong')
        if (isPractice) {
          phaseRef.current = 'reading'
          setPhase('reading')
          setMissNotice('조준 시간이 지났습니다. 다시 조준 시작을 눌러 정답 표적을 맞혀 보세요!')
          return
        }
        seqRef.current += 1
        eventsRef.current.push({
          seq: seqRef.current,
          t_ms: nowActiveMs,
          type: 'item_timeout',
          itemId: current.item.id,
          aimDurationMs: aimDuration,
        })
        setFeedbackData({
          outcome: 'timeout',
          chosenLabel: null,
          chosenExplanation: null,
          correctLabel: correctRec.display_ko,
          correctExplanation: current.item.explanation,
        })
        phaseRef.current = 'feedback'
        setPhase('feedback')
        return
      }

      const chosenOption = current.options[selectedLane]
      const chosenRec = bundle.records[chosenOption.recordId]!
      const isCorrect = chosenOption.recordId === current.item.correct_id

      if (isPractice) {
        if (isCorrect) {
          playArcadeSfx('clear')
          setPracticeCleared(true)
          onPracticeSuccess?.()
        } else {
          playArcadeSfx('wrong')
          setMissNotice(
            `오답 표적(${chosenRec.display_ko})입니다! 설명에 맞는 정답 표적으로 이동해 다시 쏴 보세요.`,
          )
        }
        return
      }

      seqRef.current += 1
      eventsRef.current.push({
        seq: seqRef.current,
        t_ms: nowActiveMs,
        type: 'hit_option',
        itemId: current.item.id,
        aimDurationMs: aimDuration,
        selectedRecordId: chosenOption.recordId,
      })

      if (isCorrect) {
        playArcadeSfx('score')
        setCorrectCount((c) => c + 1)
        setFeedbackData({
          outcome: 'correct',
          chosenLabel: chosenRec.display_ko,
          chosenExplanation: chosenRec.explanation,
          correctLabel: correctRec.display_ko,
          correctExplanation: current.item.explanation,
        })
      } else {
        playArcadeSfx('wrong')
        setFeedbackData({
          outcome: 'wrong',
          chosenLabel: chosenRec.display_ko,
          chosenExplanation: chosenRec.explanation,
          correctLabel: correctRec.display_ko,
          correctExplanation: correctRec.explanation,
        })
      }

      phaseRef.current = 'feedback'
      setPhase('feedback')
    },
    [aimLimitMs, bundle.records, isPractice, maxActiveRoundMs, onPracticeSuccess, roundItems],
  )

  const fireLaserAtX = useCallback(
    (xPos: number) => {
      if (finishedRef.current || phaseRef.current !== 'aiming' || practiceCleared) return
      const hitLane = findHitTargetLane(xPos)
      setLaserBeam({ x: xPos, hit: hitLane !== null })
      window.setTimeout(() => setLaserBeam(null), 190)

      if (hitLane === null) {
        // Shot went between targets -> record shot_miss, allow shooting again in remaining time!
        playArcadeSfx('select')
        const current = roundItems[questionIdxRef.current]!
        if (!isPractice) {
          seqRef.current += 1
          eventsRef.current.push({
            seq: seqRef.current,
            t_ms: Math.min(maxActiveRoundMs, Math.round(totalActiveMsRef.current)),
            type: 'shot_miss',
            itemId: current.item.id,
          })
        }
        setMissNotice('빗맞았습니다! 표적 중앙 아래로 이동해 남은 시간 안에 다시 Space를 누르세요.')
        return
      }

      finalizeCurrentQuestion(hitLane)
    },
    [finalizeCurrentQuestion, isPractice, maxActiveRoundMs, practiceCleared, roundItems],
  )

  const goNextQuestion = useCallback(() => {
    if (finishedRef.current || phaseRef.current !== 'feedback') return
    if (questionIdxRef.current >= roundItems.length - 1) {
      finishOnce('completed_all')
      return
    }
    const nextIdx = questionIdxRef.current + 1
    questionIdxRef.current = nextIdx
    setQuestionIdx(nextIdx)
    setFeedbackData(null)
    setMissNotice(null)
    shipXRef.current = 0.5
    setShipX(0.5)
    phaseRef.current = 'reading'
    setPhase('reading')
  }, [finishOnce, roundItems.length])

  // Keyboard listener with start-key release protection on Space!
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (finishedRef.current || tabPaused || practiceCleared) return

      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        e.stopPropagation()
        keysHeldRef.current.left = true
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        e.stopPropagation()
        keysHeldRef.current.right = true
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return

        if (phaseRef.current === 'reading') {
          beginAiming(e.key === ' ')
          return
        }
        if (phaseRef.current === 'aiming' && e.key === ' ') {
          if (requireSpaceReleaseRef.current) return
          fireLaserAtX(shipXRef.current)
          return
        }
        if (phaseRef.current === 'feedback') {
          goNextQuestion()
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keysHeldRef.current.left = false
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keysHeldRef.current.right = false
      } else if (e.key === ' ') {
        requireSpaceReleaseRef.current = false
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [beginAiming, fireLaserAtX, goNextQuestion, practiceCleared, tabPaused])

  // Active time + ship movement + aim timer loop
  useEffect(() => {
    if (tabPaused || practiceCleared || finishedRef.current) return
    let lastTs = performance.now()
    let rafId = 0

    const tick = (nowTs: number) => {
      if (finishedRef.current) return
      const dt = Math.min(100, Math.max(0, nowTs - lastTs))
      lastTs = nowTs

      totalActiveMsRef.current += dt
      if (isPractice) {
        setPracticeElapsedMs(totalActiveMsRef.current)
        if (totalActiveMsRef.current >= 30_000) {
          finishOnce('time_up')
          return
        }
      } else if (totalActiveMsRef.current >= maxActiveRoundMs) {
        finishOnce('time_up')
        return
      }

      // Smooth horizontal ship movement in reading & aiming
      if (phaseRef.current === 'reading' || phaseRef.current === 'aiming') {
        const dir =
          (keysHeldRef.current.right ? 1 : 0) - (keysHeldRef.current.left ? 1 : 0)
        if (dir !== 0) {
          const speedPerMs = 0.00072
          const nextX = Math.min(0.95, Math.max(0.05, shipXRef.current + dir * speedPerMs * dt))
          shipXRef.current = nextX
          setShipX(nextX)
        }
      }

      // Aim countdown runs ONLY in 'aiming' phase!
      if (phaseRef.current === 'aiming') {
        const nextAim = aimElapsedRef.current + dt
        aimElapsedRef.current = nextAim
        setAimElapsedMs(nextAim)
        if (nextAim >= aimLimitMs) {
          finalizeCurrentQuestion(null)
          return
        }
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [aimLimitMs, finalizeCurrentQuestion, finishOnce, isPractice, maxActiveRoundMs, practiceCleared, tabPaused])

  // Draw 2D Canvas shooter arena (3 target pods + aiming reticle + laser + ship)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.fillStyle = '#090e18'
    ctx.fillRect(0, 0, w, h)

    // Star / grid horizon lines
    ctx.strokeStyle = 'rgba(67, 231, 242, 0.09)'
    ctx.lineWidth = 1
    for (let i = 1; i <= 4; i += 1) {
      const y = (h / 5) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    const activeHoverLane = findHitTargetLane(shipX)

    // Draw the 3 target pods matching the 3 option cards directly above
    for (const box of TARGET_HITBOXES) {
      const opt = currentScheduled.options[box.lane]
      const x0 = box.minX * w
      const podW = (box.maxX - box.minX) * w
      const podY = 18
      const podH = 62
      const isHovered = activeHoverLane === box.lane

      ctx.fillStyle = isHovered ? '#172b42' : '#121b2b'
      ctx.strokeStyle = isHovered ? '#43E7F2' : 'rgba(242, 246, 251, 0.32)'
      ctx.lineWidth = isHovered ? 3 : 1.5
      ctx.beginPath()
      ctx.roundRect(x0, podY, podW, podH, 10)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = isHovered ? '#43E7F2' : '#F2F6FB'
      ctx.font = '800 18px "IBM Plex Mono", Pretendard, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        opt.coreCode ? `[${opt.coreCode}] 표적` : `표적 ${box.lane + 1}`,
        box.centerX * w,
        podY + 24,
      )

      ctx.fillStyle = '#A6B4C8'
      ctx.font = '600 13px Pretendard, "Malgun Gothic", sans-serif'
      ctx.fillText(opt.labelKo, box.centerX * w, podY + 46)
    }

    // Aiming vertical guide line from ship
    const shipPx = shipX * w
    const shipPy = h - 34
    ctx.strokeStyle =
      phase === 'aiming' ? 'rgba(67, 231, 242, 0.55)' : 'rgba(242, 246, 251, 0.18)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(shipPx, shipPy - 18)
    ctx.lineTo(shipPx, 82)
    ctx.stroke()
    ctx.setLineDash([])

    // Laser beam flash
    if (laserBeam && !prefs.reduceMotion) {
      ctx.strokeStyle = laserBeam.hit ? '#B9F66C' : '#FFBD64'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(laserBeam.x * w, shipPy - 16)
      ctx.lineTo(laserBeam.x * w, laserBeam.hit ? 78 : 10)
      ctx.stroke()
    }

    // Player Arcade Ship
    ctx.fillStyle = phase === 'aiming' ? '#43E7F2' : '#7f93b0'
    ctx.beginPath()
    ctx.moveTo(shipPx, shipPy - 18)
    ctx.lineTo(shipPx - 20, shipPy + 14)
    ctx.lineTo(shipPx + 20, shipPy + 14)
    ctx.closePath()
    ctx.fill()
  }, [currentScheduled, laserBeam, phase, prefs.reduceMotion, shipX])

  const aimRemainingSec = Math.max(0, (aimLimitMs - aimElapsedMs) / 1000).toFixed(1)
  const score = correctCount * 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}>
      {/* HUD */}
      <div className="play-hud-bar">
        <div className="hud-metric">
          <span style={{ color: 'var(--text-muted)' }}>현재 행동</span>
          <strong style={{ color: correctCount >= 8 ? 'var(--accent-clear)' : 'var(--accent-select)' }}>
            {isPractice
              ? `연습 명중 ${practiceCleared ? 1 : 0}/1`
              : `정답 명중 ${correctCount}/8`}
          </strong>
          {!isPractice && (
            <span className="mono-num" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              (문항 {questionIdx + 1}/12)
            </span>
          )}
        </div>

        <div className="hud-metric" style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {isPractice ? '연습 남은 시간' : phase === 'aiming' ? '조준 타이머' : '조준 대기'}
          </span>
          <span
            className="mono-num"
            style={{
              fontSize: 20,
              color:
                phase === 'aiming' && Number(aimRemainingSec) <= 2.0
                  ? 'var(--accent-warn)'
                  : 'var(--text-primary)',
            }}
          >
            {isPractice
              ? `${Math.max(0, Math.ceil((30_000 - practiceElapsedMs) / 1000))}s`
              : phase === 'aiming'
                ? `${aimRemainingSec}s`
                : `읽기 중 (${aimLimitMs / 1000}s 보존)`}
          </span>
        </div>

        <div className="hud-metric" style={{ justifyContent: 'flex-end' }}>
          {!isPractice && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>점수</span>
              <span className="mono-num" style={{ fontSize: 20, color: 'var(--accent-clear)' }}>
                {score}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Question Prompt Card */}
      <div
        style={{
          padding: '10px 16px',
          background: '#141d2b',
          border: '1px solid rgba(67, 231, 242, 0.35)',
          borderRadius: 9,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: 'var(--accent-select)', fontWeight: 700 }}>
            핵심가치 식별 문항 {isPractice ? '(연습)' : `#${questionIdx + 1}`}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
            “{currentScheduled.item.prompt}”
          </div>
        </div>

        {phase === 'reading' && !practiceCleared && (
          <button
            type="button"
            className="btn-arcade btn-start"
            onClick={() => beginAiming(false)}
          >
            조준 시작 ({aimLimitMs / 1000}초) · Enter/Space ▶
          </button>
        )}
      </div>

      {/* 3 Full-Text Option Cards (1366x768 non-truncating!) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {currentScheduled.options.map((opt) => {
          const box = TARGET_HITBOXES[opt.lane]!
          const isAimed = findHitTargetLane(shipX) === opt.lane
          return (
            <button
              key={opt.lane}
              type="button"
              disabled={phase === 'feedback' || practiceCleared}
              onClick={() => {
                shipXRef.current = box.centerX
                setShipX(box.centerX)
                if (phase === 'aiming') {
                  fireLaserAtX(box.centerX)
                }
              }}
              style={{
                textAlign: 'left',
                padding: '9px 12px',
                borderRadius: 8,
                background: isAimed ? 'rgba(67, 231, 242, 0.14)' : '#121926',
                border: `1.5px solid ${isAimed ? 'var(--accent-select)' : 'rgba(242,246,251,0.16)'}`,
                cursor: phase === 'aiming' ? 'crosshair' : 'pointer',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--accent-select)', fontWeight: 700 }}>
                표적 {opt.lane + 1} {isAimed ? '· [조준선 위치]' : ''}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>{opt.labelKo}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{opt.labelEn}</div>
            </button>
          )
        })}
      </div>

      {/* 2D Shooter Canvas + Feedback / Pause Overlays */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 225,
          background: '#090e18',
          border: '1px solid rgba(67, 231, 242, 0.25)',
          borderRadius: 10,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <canvas
          ref={canvasRef}
          width={900}
          height={235}
          style={{ width: '100%', height: '100%', flex: 1, display: 'block' }}
          aria-label="가치 표적 슈팅 조준 화면"
        />

        {/* Feedback Overlay: Correct / Wrong (shows both chosen & correct descriptions!) / Timeout */}
        {phase === 'feedback' && feedbackData && (
          <div
            role="dialog"
            aria-label="문항 정오답 해설"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(11, 15, 23, 0.93)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 14,
              zIndex: 12,
            }}
          >
            <div className="cabinet-modal-card" style={{ maxWidth: 640, padding: '16px 20px' }}>
              <div style={{ marginBottom: 8 }}>
                {feedbackData.outcome === 'correct' ? (
                  <span className="cabinet-status-tag cleared">✓ 정답 명중 (+100점)</span>
                ) : feedbackData.outcome === 'timeout' ? (
                  <span className="sample-pill">⏳ 조준 시간 초과 (0점)</span>
                ) : (
                  <span className="sample-pill">✕ 오답 명중 (0점)</span>
                )}
              </div>

              <div style={{ display: 'grid', gap: 8, marginBottom: 14 }} className="instruction-text">
                {feedbackData.outcome === 'wrong' && feedbackData.chosenLabel && (
                  <div style={{ color: 'var(--accent-warn)' }}>
                    <strong>내가 고른 가치 ({feedbackData.chosenLabel}):</strong>{' '}
                    {feedbackData.chosenExplanation}
                  </div>
                )}
                <div style={{ color: 'var(--accent-clear)' }}>
                  <strong>정답 가치 ({feedbackData.correctLabel}):</strong>{' '}
                  {feedbackData.correctExplanation}
                </div>
              </div>

              <button
                type="button"
                className="btn-arcade btn-start"
                autoFocus
                onClick={goNextQuestion}
              >
                {questionIdx >= roundItems.length - 1
                  ? '12문항 완료 · 결과 저장하기 (Enter/Space) ▶'
                  : '다음 문항으로 (Enter/Space) ▶'}
              </button>
            </div>
          </div>
        )}

        {tabPaused && (
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
              zIndex: 13,
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

      {/* Bottom Guidance Bar */}
      <div
        style={{
          padding: '6px 12px',
          background: '#131b28',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
          fontSize: 14,
          color: missNotice ? 'var(--accent-warn)' : 'var(--text-muted)',
        }}
      >
        {missNotice ??
          (phase === 'reading'
            ? '설명을 충분히 읽은 뒤 [조준 시작]을 누르면 카운트가 시작됩니다.'
            : '← · → 방향키로 우주선을 정답 표적 아래로 옮기고 Space로 발사하세요!')}
      </div>
    </div>
  )
}
