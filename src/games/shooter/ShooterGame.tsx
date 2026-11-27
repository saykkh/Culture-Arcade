import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildShooterRound, getContentBundle } from '../../../content'
import { CoreBotMascot, PassMilestoneBanner } from '../../components/CoreBotMascot'
import { MobileGameHud } from '../../components/MobileGameHud'
import { useCompactGameLayout } from '../../lib/gameLayout'
import { BASE_ACTION_POINTS, PASSING_SCORE } from '../../domain/rules'
import type { CoreValueCode, GameMode, RunEndReason, ShooterRunEvent } from '../../domain/types'
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

type QuestionPhase = 'aiming' | 'celebrate' | 'feedback'
const SHOT_COLORS = { correct: '#B9F66C', wrong: '#FF6B7A', miss: '#FFBD64' } as const

const CORE_ACCENTS: Record<CoreValueCode, string> = {
  C: '#43E7F2',
  O: '#B9F66C',
  R: '#FFBD64',
  E: '#FF6B9E',
}

function getQuestionInstruction(promptKind: 'ko_name' | 'en_name' | 'description'): string {
  if (promptKind === 'en_name') {
    return '아래 영문 명칭이 뜻하는 LS전선 핵심가치(C·O·R·E) 표적을 맞히세요!'
  }
  if (promptKind === 'ko_name') return '아래 핵심가치의 영문 명칭을 맞히세요!'
  return '아래 설명이 뜻하는 LS전선 핵심가치(C·O·R·E) 표적을 맞히세요!'
}

function getTargetLabel(option: { labelKo: string; labelEn: string }, promptKind: 'ko_name' | 'en_name' | 'description') {
  if (promptKind === 'ko_name') return option.labelEn
  return option.labelKo.replace(/\s*\([^)]*[A-Za-z][^)]*\)\s*$/u, '')
}

/**
 * 필수 #3: 가치 표적 슈팅 (shooter) — 직관형 개편 버전
 * - 별도의 '조준 시작' 대기 버튼을 없애고, 문제 카드가 상단에 크게 뜨면 곧바로 조준·발사 가능!
 * - 조작 3가지 모두 지원: ① ←/→ 이동 후 Space 발사 ② 숫자키 1·2·3 즉시 발사 ③ 표적 마우스 클릭 즉시 발사
 * - 12문항 (문항당 기본 10초 / 여유 14초), 정답당 +2점 · 5문항(10점) 이상 통과, 만점 24점 경쟁
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
  const compactLayout = useCompactGameLayout()
  const bundle = useMemo(() => getContentBundle(contentVersion), [contentVersion])
  const roundItems = useMemo(() => {
    const full = buildShooterRound(bundle, seed)
    return isPractice ? [full[0]!] : full
  }, [bundle, seed, isPractice])

  const aimLimitMs = mode === 'assisted' ? 14_000 : 10_000
  const maxActiveRoundMs = isPractice ? 30_000 : mode === 'assisted' ? 235_000 : 175_000

  const [questionIdx, setQuestionIdx] = useState(0)
  const [phase, setPhase] = useState<QuestionPhase>('aiming')
  const [aimElapsedMs, setAimElapsedMs] = useState(0)
  const [activeElapsedMs, setActiveElapsedMs] = useState(0)
  const [tabPaused, setTabPaused] = useState(false)
  const [shipX, setShipX] = useState(0.5)
  const [correctCount, setCorrectCount] = useState(0)
  const [practiceCleared, setPracticeCleared] = useState(false)
  const [missNotice, setMissNotice] = useState<string | null>(null)
  const [laserBeam, setLaserBeam] = useState<{ x: number; outcome: keyof typeof SHOT_COLORS; startedMs: number } | null>(null)
  const [celebrateBurst, setCelebrateBurst] = useState<{
    lane: 0 | 1 | 2
    labelKo: string
    startedMs: number
  } | null>(null)

  const [feedbackData, setFeedbackData] = useState<{
    outcome: 'correct' | 'wrong' | 'timeout'
    chosenLabel: string | null
    chosenExplanation?: string
    correctLabel: string
    correctEnglish: string
    correctExplanation: string
  } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const finishedRef = useRef(false)
  const totalActiveMsRef = useRef(0)
  const aimElapsedRef = useRef(0)
  const shipXRef = useRef(0.5)
  const keysHeldRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false })
  const mountGuardUntilRef = useRef(0)
  const seqRef = useRef(0)
  const eventsRef = useRef<ShooterRunEvent[]>([])
  const startedItemIdsRef = useRef<Set<string>>(new Set())
  const phaseRef = useRef<QuestionPhase>('aiming')
  const questionIdxRef = useRef(0)

  const currentScheduled = roundItems[questionIdx]!

  const ensureAimStartedForCurrent = useCallback(() => {
    if (isPractice) return
    const current = roundItems[questionIdxRef.current]
    if (!current) return
    if (startedItemIdsRef.current.has(current.item.id)) return
    startedItemIdsRef.current.add(current.item.id)
    seqRef.current += 1
    eventsRef.current.push({
      seq: seqRef.current,
      t_ms: Math.min(maxActiveRoundMs, Math.round(totalActiveMsRef.current)),
      type: 'aim_start',
      itemId: current.item.id,
    })
  }, [isPractice, maxActiveRoundMs, roundItems])

  // Record aim_start for Question #1 on mount & guard accidental Space/Enter carryover for 350ms
  useEffect(() => {
    mountGuardUntilRef.current = performance.now() + 350
    ensureAimStartedForCurrent()
  }, [ensureAimStartedForCurrent])

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

  const finalizeCurrentQuestion = useCallback(
    (selectedLane: 0 | 1 | 2 | null) => {
      if (finishedRef.current || phaseRef.current !== 'aiming') return
      ensureAimStartedForCurrent()
      const current = roundItems[questionIdxRef.current]!
      const aimDuration = Math.min(aimLimitMs, Math.round(aimElapsedRef.current))
      const nowActiveMs = Math.min(maxActiveRoundMs, Math.round(totalActiveMsRef.current))
      const correctRec = bundle.records[current.item.correct_id]!

      if (selectedLane === null) {
        playArcadeSfx('wrong')
        if (isPractice) {
          aimElapsedRef.current = 0
          setAimElapsedMs(0)
          setMissNotice('제한 시간이 지났습니다! 상단 문제를 보고 알맞은 표적(1·2·3번)을 클릭하거나 Space로 쏘세요.')
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
          correctLabel: correctRec.display_ko,
          correctEnglish: correctRec.display_en,
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
            `방금 쏜 [${chosenRec.display_ko}] 표적은 오답입니다! 상단 문제에 맞는 표적을 다시 쏴 보세요.`,
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
        setMissNotice(null)
        setCelebrateBurst({
          lane: selectedLane,
          labelKo: chosenRec.display_ko,
          startedMs: totalActiveMsRef.current,
        })
        phaseRef.current = 'celebrate'
        setPhase('celebrate')
      } else {
        playArcadeSfx('wrong')
        setFeedbackData({
          outcome: 'wrong',
          chosenLabel: chosenRec.display_ko,
          chosenExplanation: chosenRec.explanation,
          correctLabel: correctRec.display_ko,
          correctEnglish: correctRec.display_en,
          correctExplanation: current.item.explanation,
        })
        phaseRef.current = 'feedback'
        setPhase('feedback')
      }
    },
    [
      aimLimitMs,
      bundle.records,
      ensureAimStartedForCurrent,
      isPractice,
      maxActiveRoundMs,
      onPracticeSuccess,
      roundItems,
    ],
  )

  const fireLaserAtX = useCallback(
    (xPos: number) => {
      if (finishedRef.current || phaseRef.current !== 'aiming' || practiceCleared) return
      ensureAimStartedForCurrent()
      const hitLane = findHitTargetLane(xPos)
      const current = roundItems[questionIdxRef.current]!
      const outcome = hitLane === null ? 'miss' : hitLane === current.correctLane ? 'correct' : 'wrong'
      setLaserBeam({ x: xPos, outcome, startedMs: totalActiveMsRef.current })

      if (hitLane === null) {
        playArcadeSfx('select')
        if (!isPractice) {
          seqRef.current += 1
          eventsRef.current.push({
            seq: seqRef.current,
            t_ms: Math.min(maxActiveRoundMs, Math.round(totalActiveMsRef.current)),
            type: 'shot_miss',
            itemId: current.item.id,
          })
        }
        setMissNotice('표적 사이 빈 공간에 발사되었습니다! 1·2·3번 표적 아래에서 쏘거나 숫자키 1·2·3을 눌러 보세요.')
        return
      }

      finalizeCurrentQuestion(hitLane)
    },
    [
      ensureAimStartedForCurrent,
      finalizeCurrentQuestion,
      isPractice,
      maxActiveRoundMs,
      practiceCleared,
      roundItems,
    ],
  )

  const snapAndFireLane = useCallback(
    (lane: 0 | 1 | 2) => {
      if (finishedRef.current || phaseRef.current !== 'aiming' || practiceCleared) return
      const box = TARGET_HITBOXES[lane]!
      shipXRef.current = box.centerX
      setShipX(box.centerX)
      fireLaserAtX(box.centerX)
    },
    [fireLaserAtX, practiceCleared],
  )

  const goNextQuestion = useCallback(() => {
    if (
      finishedRef.current ||
      (phaseRef.current !== 'feedback' && phaseRef.current !== 'celebrate')
    ) {
      return
    }
    if (questionIdxRef.current >= roundItems.length - 1) {
      finishOnce('completed_all')
      return
    }
    const nextIdx = questionIdxRef.current + 1
    questionIdxRef.current = nextIdx
    setQuestionIdx(nextIdx)
    setFeedbackData(null)
    setCelebrateBurst(null)
    setMissNotice(null)
    aimElapsedRef.current = 0
    setAimElapsedMs(0)
    shipXRef.current = 0.5
    setShipX(0.5)
    phaseRef.current = 'aiming'
    setPhase('aiming')
    ensureAimStartedForCurrent()
  }, [ensureAimStartedForCurrent, finishOnce, roundItems.length])

  // Let the player see the Korean and English names before continuing.
  useEffect(() => {
    if (phase !== 'celebrate') return
    const timer = window.setTimeout(() => {
      goNextQuestion()
    }, 920)
    return () => window.clearTimeout(timer)
  }, [goNextQuestion, phase])

  // Keyboard controls: Left/Right glide, 1/2/3 quick-aim & fire, Space/Enter fire or next
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
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        if (phaseRef.current === 'aiming' && !e.repeat) {
          e.preventDefault()
          e.stopPropagation()
          const lane = (Number(e.key) - 1) as 0 | 1 | 2
          snapAndFireLane(lane)
        }
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (phaseRef.current === 'aiming' && e.target instanceof HTMLButtonElement) return
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        if (performance.now() < mountGuardUntilRef.current) return

        if (phaseRef.current === 'aiming') {
          fireLaserAtX(shipXRef.current)
          return
        }
        if (phaseRef.current === 'feedback' || phaseRef.current === 'celebrate') {
          goNextQuestion()
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keysHeldRef.current.left = false
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keysHeldRef.current.right = false
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [fireLaserAtX, goNextQuestion, practiceCleared, snapAndFireLane, tabPaused])

  // Active time + ship movement + question timer loop
  useEffect(() => {
    if (tabPaused || practiceCleared || finishedRef.current) return
    let lastTs = performance.now()
    let rafId = 0

    const tick = (nowTs: number) => {
      if (finishedRef.current) return
      const dt = Math.min(100, Math.max(0, nowTs - lastTs))
      lastTs = nowTs

      totalActiveMsRef.current += dt
      if (isPractice || !prefs.reduceMotion) setActiveElapsedMs(totalActiveMsRef.current)
      if (isPractice) {
        if (totalActiveMsRef.current >= 30_000) {
          finishOnce('time_up')
          return
        }
      } else if (totalActiveMsRef.current >= maxActiveRoundMs) {
        finishOnce('time_up')
        return
      }

      if (phaseRef.current === 'aiming') {
        const dir =
          (keysHeldRef.current.right ? 1 : 0) - (keysHeldRef.current.left ? 1 : 0)
        if (dir !== 0) {
          const speedPerMs = 0.00082
          const nextX = Math.min(0.94, Math.max(0.06, shipXRef.current + dir * speedPerMs * dt))
          shipXRef.current = nextX
          setShipX(nextX)
        }

        const nextAim = aimElapsedRef.current + dt
        aimElapsedRef.current = nextAim
        setAimElapsedMs(nextAim)
        if (nextAim >= aimLimitMs) {
          finalizeCurrentQuestion(null)
        }
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [
    aimLimitMs,
    finalizeCurrentQuestion,
    finishOnce,
    isPractice,
    maxActiveRoundMs,
    practiceCleared,
    prefs.reduceMotion,
    tabPaused,
  ])

  // Unified Shooter Arena Canvas (Warp Starfield + Hovering Drone Shields + Twin-Wing Starfighter + Wingmen!)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    const tSec = prefs.reduceMotion ? 0 : activeElapsedMs / 1000
    const shotAge = laserBeam ? Math.max(0, activeElapsedMs - laserBeam.startedMs) : Infinity
    const shotFade = Math.max(0, 1 - shotAge / 200)
    const isClearedBonusMode = !isPractice && correctCount * BASE_ACTION_POINTS >= PASSING_SCORE

    // Deep Galactic Nebula Backdrop
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h)
    bgGrad.addColorStop(0, '#040814')
    bgGrad.addColorStop(0.55, isClearedBonusMode ? '#111b3b' : '#0a1326')
    bgGrad.addColorStop(1, '#10203a')
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, w, h)

    const neb1X = w * (0.25 + Math.sin(tSec * 0.24) * 0.11)
    const neb1 = ctx.createRadialGradient(neb1X, h * 0.35, 10, neb1X, h * 0.35, 240)
    neb1.addColorStop(0, 'rgba(67, 231, 242, 0.14)')
    neb1.addColorStop(1, 'rgba(4, 8, 20, 0)')
    ctx.fillStyle = neb1
    ctx.fillRect(0, 0, w, h)

    const neb2X = w * (0.78 + Math.cos(tSec * 0.18) * 0.11)
    const neb2 = ctx.createRadialGradient(neb2X, h * 0.45, 10, neb2X, h * 0.45, 220)
    neb2.addColorStop(0, 'rgba(255, 107, 158, 0.12)')
    neb2.addColorStop(1, 'rgba(4, 8, 20, 0)')
    ctx.fillStyle = neb2
    ctx.fillRect(0, 0, w, h)

    // Multi-Layer Streaming Warp Starfield!
    if (!prefs.reduceMotion) {
      for (let s = 0; s < 42; s += 1) {
        const sx = (s * 73 + 19) % w
        const speed = 55 + (s % 4) * 45
        const sy = (tSec * speed + s * 37) % h
        const len = 3 + (s % 4) * 3.5
        ctx.fillStyle = s % 3 === 0 ? 'rgba(185, 246, 108, 0.6)' : 'rgba(154, 220, 248, 0.65)'
        ctx.fillRect(sx, sy, 2, len)
      }
    }

    const activeHoverLane = findHitTargetLane(shipX)
    const shipPx = shipX * w
    const shipPy = h - 38

    // Subtle Camera Shake on Laser Hit!
    ctx.save()
    if (laserBeam && laserBeam.outcome !== 'miss' && !prefs.reduceMotion && shotFade > 0) {
      ctx.translate(Math.sin(tSec * 90) * 3 * shotFade, Math.cos(tSec * 80) * 3 * shotFade)
    }

    // Vertical laser sight line BEFORE targets so it connects ship to shield
    ctx.strokeStyle =
      activeHoverLane !== null ? 'rgba(185, 246, 108, 0.72)' : 'rgba(67, 231, 242, 0.35)'
    ctx.lineWidth = activeHoverLane !== null ? 2.6 : 1.5
    ctx.setLineDash([7, 6])
    ctx.beginPath()
    ctx.moveTo(shipPx, shipPy - 24)
    ctx.lineTo(shipPx, 134)
    ctx.stroke()
    ctx.setLineDash([])

    // Draw 3 Hovering Sci-Fi Drone Shields!
    for (const box of TARGET_HITBOXES) {
      const opt = currentScheduled.options[box.lane]
      const x0 = box.minX * w
      const podW = (box.maxX - box.minX) * w
      const bobY = prefs.reduceMotion ? 0 : Math.sin(tSec * 3.2 + box.lane * 1.6) * 4.5
      const podY = 18
      const podH = 120
      const centerX = box.centerX * w
      const isLocked = activeHoverLane === box.lane
      const accent = opt.coreCode ? CORE_ACCENTS[opt.coreCode] : '#43E7F2'

      // Drone Bottom Hover Thruster Flames
      if (!prefs.reduceMotion) {
        ctx.fillStyle = `${accent}88`
        ctx.beginPath()
        ctx.moveTo(x0 + 22, podY + podH)
        ctx.lineTo(x0 + 28, podY + podH + 11 + bobY)
        ctx.lineTo(x0 + 34, podY + podH)
        ctx.moveTo(x0 + podW - 34, podY + podH)
        ctx.lineTo(x0 + podW - 28, podY + podH + 11 - bobY)
        ctx.lineTo(x0 + podW - 22, podY + podH)
        ctx.fill()
      }

      // Outer Target Shield Card
      ctx.save()
      if (isLocked) {
        ctx.shadowColor = accent
        ctx.shadowBlur = 18
      }
      ctx.fillStyle = isLocked ? '#172d48' : '#101a2c'
      ctx.strokeStyle = isLocked ? accent : 'rgba(242, 246, 251, 0.3)'
      ctx.lineWidth = isLocked ? 3.5 : 1.8
      ctx.beginPath()
      ctx.roundRect(x0, podY, podW, podH, 14)
      ctx.fill()
      ctx.stroke()
      ctx.restore()

      // Top Shortcut Pill
      ctx.fillStyle = isLocked ? accent : 'rgba(242, 246, 251, 0.12)'
      ctx.beginPath()
      ctx.roundRect(centerX - 66, podY + 10, 132, 22, 11)
      ctx.fill()

      ctx.fillStyle = isLocked ? '#07121c' : '#A6B4C8'
      ctx.font = '800 12px "Paperlogy", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        isLocked ? `🎯 ${box.lane + 1}번 조준됨 · 발사!` : `${box.lane + 1}번 표적 (숫자키 ${box.lane + 1})`,
        centerX,
        podY + 21,
      )

      // Core Value Letter + Korean Name
      ctx.fillStyle = isLocked ? accent : '#F2F6FB'
      ctx.font = '800 20px "Paperlogy", sans-serif'
      ctx.fillText(getTargetLabel(opt, currentScheduled.item.promptKind), centerX, podY + 62, podW - 16)

      // Offer translations in the explanation once the choice has been made.
      if (currentScheduled.item.promptKind === 'description') {
        ctx.fillStyle = '#9FB0C7'
        ctx.font = '600 13px "Paperlogy", sans-serif'
        ctx.fillText(opt.labelEn, centerX, podY + 92, podW - 16)
      }

      // Bottom Bullseye Connector Node
      ctx.fillStyle = isLocked ? '#B9F66C' : accent
      ctx.beginPath()
      ctx.arc(centerX, podY + podH, isLocked ? 8.5 : 5.5, 0, Math.PI * 2)
      ctx.fill()

      // Explosive Neon Hit Burst on Correct Shot!
      if (celebrateBurst && celebrateBurst.lane === box.lane) {
        ctx.save()
        ctx.fillStyle = 'rgba(185, 246, 108, 0.26)'
        ctx.strokeStyle = '#B9F66C'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.roundRect(x0 - 4, podY - 4, podW + 8, podH + 8, 16)
        ctx.fill()
        ctx.stroke()

        if (!prefs.reduceMotion) {
          const progress = Math.min(1, Math.max(0, (activeElapsedMs - celebrateBurst.startedMs) / 420))
          ctx.save()
          ctx.globalAlpha = 1 - progress
          ctx.strokeStyle = 'rgba(67, 231, 242, 0.8)'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(centerX, podY + 62, 36 + progress * 70, 0, Math.PI * 2)
          ctx.stroke()

          for (let r = 0; r < 12; r += 1) {
            const ang = (Math.PI * 2 * r) / 12
            ctx.strokeStyle = r % 2 === 0 ? '#B9F66C' : '#43E7F2'
            ctx.lineWidth = 3
            ctx.beginPath()
            const radius = 30 + progress * 65
            ctx.moveTo(centerX + Math.cos(ang) * radius, podY + 62 + Math.sin(ang) * radius)
            ctx.lineTo(centerX + Math.cos(ang) * (radius + 22), podY + 62 + Math.sin(ang) * (radius + 22))
            ctx.stroke()
          }
          ctx.restore()
        }

        ctx.font = '900 24px "Paperlogy", sans-serif'
        ctx.strokeStyle = '#061019'
        ctx.lineWidth = 5
        ctx.strokeText('⭕ 정답 명중! +2점!', centerX, podY + podH + 34)
        ctx.fillStyle = '#B9F66C'
        ctx.fillText('⭕ 정답 명중! +2점!', centerX, podY + podH + 34)
        ctx.restore()
      }
    }

    // Fired Laser Beam + Muzzle Flash (+ Twin Wingman Lasers when cleared!)
    if (laserBeam && !prefs.reduceMotion && shotFade > 0) {
      ctx.save()
      ctx.globalAlpha = shotFade
      const shotColor = SHOT_COLORS[laserBeam.outcome]
      ctx.strokeStyle = shotColor
      ctx.shadowColor = shotColor
      ctx.shadowBlur = 20
      ctx.lineWidth = 7
      if (laserBeam.outcome === 'miss') ctx.setLineDash([12, 9])
      ctx.beginPath()
      ctx.moveTo(laserBeam.x * w, shipPy - 22)
      ctx.lineTo(laserBeam.x * w, laserBeam.outcome === 'miss' ? 12 : 140)
      ctx.stroke()

      if (isClearedBonusMode && laserBeam.outcome === 'correct') {
        ctx.lineWidth = 3
        ctx.strokeStyle = '#43E7F2'
        ctx.beginPath()
        ctx.moveTo(laserBeam.x * w - 42, shipPy - 8)
        ctx.lineTo(laserBeam.x * w - 12, 140)
        ctx.moveTo(laserBeam.x * w + 42, shipPy - 8)
        ctx.lineTo(laserBeam.x * w + 12, 140)
        ctx.stroke()
      }

      // Muzzle flash orb
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.arc(laserBeam.x * w, shipPy - 22, 9, 0, Math.PI * 2)
      ctx.fill()
      if (laserBeam.outcome === 'wrong') {
        const x = laserBeam.x * w
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(x - 10, 130)
        ctx.lineTo(x + 10, 150)
        ctx.moveTo(x + 10, 130)
        ctx.lineTo(x - 10, 150)
        ctx.stroke()
      }
      ctx.restore()
    }

    // Autonomous Escort Wingman Drones once 10점 Cleared!
    if (isClearedBonusMode) {
      for (const side of [-1, 1]) {
        const wx = shipPx + side * 44
        const wy = shipPy + 4 + (prefs.reduceMotion ? 0 : Math.sin(tSec * 6 + side) * 3)
        ctx.fillStyle = '#B9F66C'
        ctx.beginPath()
        ctx.moveTo(wx, wy - 10)
        ctx.lineTo(wx - 9, wy + 7)
        ctx.lineTo(wx + 9, wy + 7)
        ctx.closePath()
        ctx.fill()
      }
    }

    // Twin-Wing Starfighter Ship with Afterburner Flame!
    ctx.save()
    ctx.translate(shipPx, shipPy)
    const bankTilt = (shipX - 0.5) * 0.22
    ctx.rotate(bankTilt)

    // Dual Afterburner Thrusters
    if (!prefs.reduceMotion) {
      ctx.fillStyle = '#FF6B9E'
      ctx.beginPath()
      ctx.moveTo(-12, 14)
      ctx.lineTo(-8, 26 + Math.sin(tSec * 24) * 4)
      ctx.lineTo(-4, 14)
      ctx.moveTo(4, 14)
      ctx.lineTo(8, 26 + Math.cos(tSec * 24) * 4)
      ctx.lineTo(12, 14)
      ctx.fill()
    }

    // Swept Outer Wings
    ctx.fillStyle = '#1d3c5e'
    ctx.strokeStyle = activeHoverLane !== null ? '#B9F66C' : '#43E7F2'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, -14)
    ctx.lineTo(-32, 16)
    ctx.lineTo(-12, 12)
    ctx.lineTo(12, 12)
    ctx.lineTo(32, 16)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // Fuselage Core
    ctx.fillStyle = activeHoverLane !== null ? '#B9F66C' : '#43E7F2'
    ctx.beginPath()
    ctx.moveTo(0, -26)
    ctx.lineTo(-14, 14)
    ctx.lineTo(0, 9)
    ctx.lineTo(14, 14)
    ctx.closePath()
    ctx.fill()

    // Glowing Pilot Canopy
    ctx.fillStyle = '#F2F6FB'
    ctx.beginPath()
    ctx.ellipse(0, -6, 4.5, 8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.restore()
  }, [
    activeElapsedMs,
    celebrateBurst,
    compactLayout,
    correctCount,
    currentScheduled,
    isPractice,
    laserBeam,
    prefs.reduceMotion,
    shipX,
  ])

  const aimRemainingSec = Math.max(0, (aimLimitMs - aimElapsedMs) / 1000).toFixed(1)
  const timerRatio = Math.max(0, Math.min(1, 1 - aimElapsedMs / aimLimitMs))
  const score = correctCount * BASE_ACTION_POINTS
  const cleared = score >= PASSING_SCORE

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 10 }}>
      {/* Top HUD */}
      <div className="play-hud-bar" style={{ marginBottom: 0 }}>
        <MobileGameHud remaining={isPractice ? `${Math.max(0, Math.ceil((30_000 - activeElapsedMs) / 1000))}s` : `${aimRemainingSec}s`} score={score} practice={isPractice} practiceCleared={practiceCleared} />
        <div className="hud-metric">
          <CoreBotMascot
            mood={
              feedbackData || missNotice
                ? 'danger'
                : phase === 'celebrate'
                  ? cleared ? 'victory' : 'fever'
                  : 'idle'
            }
            size={36}
          />
          <span style={{ color: 'var(--text-muted)' }}>통과 기준 ({PASSING_SCORE}점)</span>
          <strong style={{ color: cleared ? 'var(--accent-clear)' : 'var(--accent-select)' }}>
            {isPractice
              ? `연습 명중 ${practiceCleared ? 1 : 0}/1`
              : cleared
                ? `✓ 통과 달성! · 정답 ${correctCount}개 (24점 만점 도전 중)`
                : `정답 ${correctCount}/5문항 (${score}/${PASSING_SCORE}점)`}
          </strong>
        </div>

        <div className="hud-metric" style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {isPractice ? '연습 남은 시간' : `문제 ${questionIdx + 1} / 12 · 남은 시간`}
          </span>
          <span
            className="mono-num"
            style={{
              fontSize: 20,
              color:
                !isPractice && Number(aimRemainingSec) <= 3.0
                  ? 'var(--accent-warn)'
                  : 'var(--text-primary)',
            }}
          >
            {isPractice
              ? `${Math.max(0, Math.ceil((30_000 - activeElapsedMs) / 1000))}s`
              : `${aimRemainingSec}s`}
          </span>
        </div>

        <div className="hud-metric" style={{ justifyContent: 'flex-end' }}>
          {!isPractice && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>점수</span>
              <span className="mono-num" style={{ fontSize: 22, color: 'var(--accent-clear)' }}>
                {score}점
              </span>
            </>
          )}
        </div>
      </div>

      {/* Prominent High-Visibility Question Banner */}
      <section
        className="shooter-question"
        aria-label="현재 출제 문제"
        style={{
          padding: '14px 18px 12px',
          background: 'linear-gradient(180deg, #16263d 0%, #101b2d 100%)',
          border: '2px solid var(--accent-select)',
          borderRadius: 12,
          boxShadow: '0 0 20px rgba(67, 231, 242, 0.16)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            marginBottom: 6,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                background: 'var(--accent-select)',
                color: '#06121c',
                fontWeight: 800,
                fontSize: 13,
              }}
            >
              {isPractice ? '연습 문제' : `Q${questionIdx + 1} / 12`}
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#bfefff' }}>
              {getQuestionInstruction(currentScheduled.item.promptKind)}
            </span>
          </div>
          <span className="shooter-key-hint" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            표적 클릭 · 숫자키 1·2·3 · ←→ + Space 발사
          </span>
        </div>

        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(7, 13, 24, 0.72)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            fontSize: 21,
            fontWeight: 800,
            lineHeight: 1.4,
            color: '#ffffff',
            letterSpacing: '-0.01em',
          }}
        >
          “{currentScheduled.item.prompt}”
        </div>

        {/* Visual Countdown Bar */}
        {!isPractice && (
          <div
            style={{
              marginTop: 9,
              height: 5,
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.1)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${timerRatio * 100}%`,
                height: '100%',
                background:
                  timerRatio <= 0.3 ? 'var(--accent-warn)' : 'var(--accent-select)',
                transition: 'width 0.08s linear',
              }}
            />
          </div>
        )}
      </section>

      {/* Unified Shooter Canvas + Feedback Overlay */}
      <div
        className="game-arena game-arena-shooter"
        data-feedback={Boolean(feedbackData)}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 300,
          background: '#080e1a',
          border: '1px solid rgba(67, 231, 242, 0.28)',
          borderRadius: 12,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {!isPractice && cleared && <PassMilestoneBanner score={score} />}
        <canvas
          ref={canvasRef}
          width={compactLayout ? 720 : 1040}
          height={330}
          onMouseMove={(e) => {
            if (phase !== 'aiming' || tabPaused || practiceCleared) return
            const rect = e.currentTarget.getBoundingClientRect()
            const normX = Math.min(0.94, Math.max(0.06, (e.clientX - rect.left) / rect.width))
            shipXRef.current = normX
            setShipX(normX)
          }}
          onClick={(e) => {
            if (tabPaused || practiceCleared) return
            if (phase === 'feedback' || phase === 'celebrate') {
              goNextQuestion()
              return
            }
            const rect = e.currentTarget.getBoundingClientRect()
            const normX = Math.min(0.94, Math.max(0.06, (e.clientX - rect.left) / rect.width))
            const lane = findHitTargetLane(normX)
            if (lane !== null) {
              snapAndFireLane(lane)
            } else {
              shipXRef.current = normX
              setShipX(normX)
              fireLaserAtX(normX)
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            flex: 1,
            display: 'block',
            cursor: phase === 'aiming' ? 'crosshair' : 'pointer',
          }}
          aria-label="가치 표적 슈팅 화면 (1, 2, 3번 표적 클릭 또는 방향키와 Space로 발사)"
        />
        {phase === 'celebrate' && (
          <div className="shooter-correct-caption">
            {currentScheduled.options[currentScheduled.correctLane].labelKo}
            <span> · {currentScheduled.options[currentScheduled.correctLane].labelEn}</span>
          </div>
        )}

        {isPractice && practiceCleared && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(11, 15, 23, 0.9)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              zIndex: 12,
            }}
          >
            <span className="cabinet-status-tag cleared" style={{ fontSize: 15 }}>
              ✓ 연습 명중 완료!
            </span>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              정답 표적을 정확히 맞혔습니다! 상단 [본게임 시작 ▶] 버튼을 눌러 12문제에 도전하세요.
            </div>
          </div>
        )}

        {phase === 'feedback' && feedbackData && (
          <div
            role="dialog"
            className="game-feedback-panel"
            aria-label="문항 정오답 해설"
            onClick={goNextQuestion}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(9, 14, 24, 0.92)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              zIndex: 12,
              cursor: 'pointer',
            }}
          >
            <div
              className="cabinet-modal-card"
              style={{ maxWidth: 620, padding: '18px 22px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ marginBottom: 10 }}>
                {feedbackData.outcome === 'correct' ? (
                  <span className="cabinet-status-tag cleared" style={{ fontSize: 14 }}>
                    ⭕ 정답 명중! (+{BASE_ACTION_POINTS}점)
                  </span>
                ) : feedbackData.outcome === 'timeout' ? (
                  <span className="sample-pill" style={{ fontSize: 14 }}>
                    ⏳ 시간 초과 (0점)
                  </span>
                ) : (
                  <span className="sample-pill" style={{ fontSize: 14 }}>
                    ❌ 오답 명중 · 내 선택: {feedbackData.chosenLabel}
                  </span>
                )}
              </div>

              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-clear)', marginBottom: 6 }}>
                정답: {feedbackData.correctLabel} · {feedbackData.correctEnglish}
              </div>
              <p className="instruction-text" style={{ margin: '0 0 16px', fontSize: 15 }}>
                {feedbackData.correctExplanation}
              </p>
              {feedbackData.chosenExplanation && (
                <p className="shooter-choice-explanation">
                  선택한 가치의 뜻 · {feedbackData.chosenExplanation}
                </p>
              )}

              <button
                type="button"
                className="btn-arcade btn-start"
                autoFocus
                onClick={goNextQuestion}
              >
                {questionIdx >= roundItems.length - 1
                  ? '12문제 완료 · 결과 확인하기 (Space / 클릭) ▶'
                  : '다음 문제 바로 가기 (Space / 클릭) ▶'}
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

      {/* Quick Target Trigger Buttons + Status Tip */}
      <div
        className="game-touch-controls shooter-target-buttons"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {currentScheduled.options.map((opt) => (
          <button
            key={opt.lane}
            type="button"
            className="btn-arcade"
            disabled={phase !== 'aiming' || practiceCleared || tabPaused}
            onClick={() => snapAndFireLane(opt.lane)}
            style={{ justifyContent: 'space-between', padding: '8px 12px' }}
          >
            <span>
              <strong style={{ color: 'var(--accent-select)' }}>{opt.lane + 1}번 발사</strong> ·{' '}
              {getTargetLabel(opt, currentScheduled.item.promptKind)}
            </span>
            <span className="mono-num" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              [{opt.lane + 1}]
            </span>
          </button>
        ))}
      </div>

      {missNotice && (
        <div className="status-alert warn" style={{ padding: '7px 12px' }}>
          <span>💡 {missNotice}</span>
        </div>
      )}
    </div>
  )
}
