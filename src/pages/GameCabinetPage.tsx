import { useEffect, useRef, useState } from 'react'
import { getContentBundle } from '../../content'
import { ArcadeHeader } from '../components/ArcadeHeader'
import { ArcadeVideoBackdrop } from '../components/ArcadeVideoBackdrop'
import { CabinetArtwork } from '../components/CabinetArtwork'
import { CoreBotMascot } from '../components/CoreBotMascot'
import { GAME_CATALOG, PASSING_SCORE, REQUIRED_GAME_ORDER } from '../domain/rules'
import type {
  GameId,
  GameMode,
  GameRunEvent,
  RunEndReason,
} from '../domain/types'
import { isGameImplemented } from '../games/implemented'
import { ActiveGameSlot } from '../games/registry'
import {
  arcadeApi,
  clearPendingSubmission,
  ClientApiError,
  savePendingSubmission,
  type FinalizeRunResponse,
  type ParticipantMeResponse,
  type StartRunResponse,
} from '../lib/api'
import { useArcadePreferences } from '../lib/preferences'
import { playArcadeSfx } from '../lib/sound'

interface GameCabinetPageProps {
  gameId: GameId
  me: ParticipantMeResponse
  onRunConfirmed: (justLitGameId: string | null) => Promise<void>
  onNavigate: (path: string) => void
  onLogout: () => Promise<void>
}

type CabinetStage =
  | 'briefing'
  | 'practice'
  | 'countdown'
  | 'playing'
  | 'saving'
  | 'save_error'
  | 'result'

function RollingScoreNumber({ target }: { target: number }) {
  const { prefs } = useArcadePreferences()
  const [displayVal, setDisplayVal] = useState(() => (prefs.reduceMotion ? target : 0))

  useEffect(() => {
    if (prefs.reduceMotion) return
    let rafId = 0
    const startTs = performance.now()
    const duration = 620
    const step = (now: number) => {
      const p = Math.min(1, (now - startTs) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplayVal(Math.round(target * eased))
      if (p < 1) {
        rafId = window.requestAnimationFrame(step)
      }
    }
    rafId = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(rafId)
  }, [prefs.reduceMotion, target])

  return <strong style={{ color: 'var(--accent-select)' }}>{prefs.reduceMotion ? target : displayVal}</strong>
}

function formatResultFeedback(
  result: Pick<FinalizeRunResponse, 'score' | 'cleared' | 'actionSummary' | 'previousActionSummary'>,
  contentVersion: string,
): {
  achievedHeadline: string
  deltaText: string | null
  nextActionTip: string
  commentaryLines: string[]
} {
  const bundle = getContentBundle(contentVersion)
  const curr = result.actionSummary
  const prev = result.previousActionSummary

  switch (curr.kind) {
    case 'typing': {
      const prevCount = prev?.kind === 'typing' ? prev.correctCount : null
      const diff = prevCount !== null ? curr.correctCount - prevCount : null
      const achievedHeadline = result.cleared
        ? `정확한 공식 문구 ${curr.correctCount}개 연결 (${result.score}점) · 통과 및 케이블 점등!`
        : `현재 ${result.score}점 (문구 ${curr.correctCount}개) · ${Math.max(2, PASSING_SCORE - result.score)}점 더 획득하면 통과!`
      const nextActionTip = result.cleared
        ? '통과 기준(10점)을 넘겼습니다! 남은 슬롯을 빠르게 연결해 최고 48점 TOP 10 기록에 도전해 보세요.'
        : curr.missedCount >= 5
          ? '바닥에 가까운 주황색 문구부터 먼저 입력해 놓침 횟수(5개 제한)를 줄여 보세요.'
          : '문구 1개당 +2점이며 오타 감점이 없습니다. 5개(10점)만 연결하면 바로 통과됩니다!'
      return {
        achievedHeadline,
        deltaText:
          diff !== null
            ? `같은 모드 직전 기록 대비 입력 성공 ${diff >= 0 ? `+${diff}` : diff}개`
            : null,
        nextActionTip,
        commentaryLines: [
          `배점 규칙: 정확한 공식 문구 1개당 +2점 (10점 달성 시 통과 · 최대 48점 경쟁)`,
          `최대 연속 입력: ${curr.maxCombo}회 · 놓친 문구: ${curr.missedCount}개`,
          `핵심 문구 복습: "${bundle.records['mission-cable-future']?.display_ko}" / "${bundle.records['vision-global-leader']?.display_ko}"`,
        ],
      }
    }

    case 'snake': {
      const prevCount = prev?.kind === 'snake' ? prev.correctChunks : null
      const diff = prevCount !== null ? curr.correctChunks - prevCount : null
      const achievedHeadline = result.cleared
        ? `단어 조각 ${curr.correctChunks}개 · 문장 ${curr.completedSentences}개 완성 (${result.score}점) · 통과!`
        : `현재 ${result.score}점 · ${Math.max(2, PASSING_SCORE - result.score)}점 더 획득하면 통과!`
      const pairHint = curr.confusedPairs[0]
        ? `헷갈린 두 조각 다시 보기: "${curr.confusedPairs[0].chosenText}" 대신 "${curr.confusedPairs[0].expectedText}" 순서입니다.`
        : '정답 단어 조각 1개당 +2점, 문장 완성 시 +2점 보너스가 추가되어 10점이 되면 통과됩니다.'
      const completedTexts = curr.completedSentenceIds
        .map((sid) => bundle.snakeSentences.find((s) => s.id === sid))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => `${bundle.records[s.recordId]?.display_ko ?? ''} — ${s.explanation}`)
      return {
        achievedHeadline,
        deltaText:
          diff !== null
            ? `같은 모드 직전 기록 대비 수집 조각 ${diff >= 0 ? `+${diff}` : diff}개`
            : null,
        nextActionTip: result.cleared
          ? '통과 후에도 문장이 계속 순환 출제됩니다. 무충돌로 더 많은 문장을 완성해 TOP 10 기록을 경신해 보세요!'
          : pairHint,
        commentaryLines: [
          `배점 규칙: 정답 단어 조각 +2점, 문장 완성 보너스 +2점 (10점 달성 시 통과 · 연속 웨이브 경쟁)`,
          ...completedTexts,
        ],
      }
    }

    case 'shooter': {
      const prevCount = prev?.kind === 'shooter' ? prev.correctCount : null
      const diff = prevCount !== null ? curr.correctCount - prevCount : null
      const achievedHeadline = result.cleared
        ? `핵심가치 ${curr.correctCount}/12문항 정답 명중 (${result.score}점) · 통과!`
        : `현재 ${result.score}점 (${curr.correctCount}문항 정답) · ${Math.max(2, PASSING_SCORE - result.score)}점 더 획득하면 통과!`
      const nextActionTip =
        curr.timeoutCount > 0
          ? `시간 초과(${curr.timeoutCount}문항)가 있었습니다. 상단 문제를 읽고 1·2·3번 표적을 마우스로 클릭하거나 숫자키 1·2·3을 누르면 즉시 발사됩니다!`
          : '상단 문제 카드의 핵심 키워드를 보고 표적 클릭 또는 숫자키 1·2·3으로 빠르게 명중시켜 만점(24점)에 도전해 보세요!'
      return {
        achievedHeadline,
        deltaText:
          diff !== null
            ? `같은 모드 직전 기록 대비 정답 ${diff >= 0 ? `+${diff}` : diff}문항`
            : null,
        nextActionTip,
        commentaryLines: [
          `배점 규칙: 정답 명중 +2점, 오답·시간 초과 0점 (5문제=10점 달성 시 통과 · 최고 24점 경쟁)`,
          `C: ${bundle.records['core-c']?.display_ko} / O: ${bundle.records['core-o']?.display_ko}`,
          `R: ${bundle.records['core-r']?.display_ko} / E: ${bundle.records['core-e']?.display_ko}`,
        ],
      }
    }

    case 'runner': {
      const prevBoosts = prev?.kind === 'runner' ? prev.boostCount : null
      const diff = prevBoosts !== null ? curr.boostCount - prevBoosts : null
      const achievedHeadline = result.cleared
        ? `⚡핵심가치 ${curr.boostCount}회 · 특수기믹 ${curr.bonusItemCount}개 · 세트 ${curr.completedCoreSets}회 (${result.score}점) · 통과!`
        : `현재 ${result.score}점 (부스터 ${curr.boostCount}회) · ${Math.max(1, PASSING_SCORE - result.score)}점 더 획득하면 통과!`
      const nextActionTip =
        curr.stunStopCount > 0
          ? `🚧바리케이드·⚡과전류 쇼크 일시정지(${curr.stunStopCount}회)가 있었습니다! 쇼크 게이트는 옆 트랙으로 피하거나 🛡️보호실드·🔼점프대 슈퍼점프로 돌파하세요.`
          : curr.hazardHitCount > 0
            ? `감속 함정(${curr.hazardHitCount}회)을 Space 점프로 넘고, 🚀초전도 하이퍼 링(+3점·초가속)과 🛡️실드를 챙기면 점수가 훨씬 빠르게 오릅니다!`
            : 'C·O·R·E 4종 세트(+4점)와 🚀초전도 하이퍼 링(+3점)을 연속으로 이어 최고 기록에 도전해 보세요!'
      return {
        achievedHeadline,
        deltaText:
          diff !== null
            ? `같은 모드 직전 기록 대비 핵심가치 발판 ${diff >= 0 ? `+${diff}` : diff}회`
            : null,
        nextActionTip,
        commentaryLines: [
          `도움 기믹 4종: ⚡핵심가치 발판(+2점·가속, 4종 세트 +4점), 🚀하이퍼 링(+3점·195% 초가속), 🛡️절연 실드(+1점·방어 ${curr.shieldBlockedCount}회 성공), 🔼스프링 점프대(+1점·슈퍼점프)`,
          `방해 기믹 4종: 🍌바나나(−2점·감속), 🟣점착 늪(−2점·중감속), 🚧바리케이드(−2점·멈칫), ⚡과전류 쇼크(−3점·일시정지, 피격 시 미완성 세트 초기화)`,
          `핵심가치 복습: C(${bundle.records['core-c']?.display_ko}) · O(${bundle.records['core-o']?.display_ko}) · R(${bundle.records['core-r']?.display_ko}) · E(${bundle.records['core-e']?.display_ko})`,
        ],
      }
    }
  }
}

const COUNTDOWN_STEPS = [
  { label: 'READY?', durationMs: 560 },
  { label: '3', durationMs: 520 },
  { label: '2', durationMs: 520 },
  { label: '1', durationMs: 520 },
  { label: 'GO!', durationMs: 420 },
] as const

function CableTransfer({ gameId }: { gameId: GameId }) {
  const particleRef = useRef<HTMLSpanElement>(null)
  const { prefs } = useArcadePreferences()

  useEffect(() => {
    const particle = particleRef.current
    const cabinet = particle?.closest('.game-cabinet-shell')
    const source = cabinet?.querySelector('.result-stamp')?.getBoundingClientRect()
    const target = cabinet?.querySelector(`[data-cable-socket="${gameId}"]`)?.getBoundingClientRect()
    if (!particle || !source || !target || prefs.reduceMotion) return

    const x = source.left + source.width / 2
    const y = source.top + source.height / 2
    const dx = target.left + target.width / 2 - x
    const dy = target.top + target.height / 2 - y
    particle.style.left = `${x}px`
    particle.style.top = `${y}px`
    const motion = particle.animate([
      { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.25}px), calc(-50% + ${dy * 0.45}px)) scale(1.5)`, opacity: 1, offset: 0.38 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.3)`, opacity: 0 },
    ], { duration: 720, delay: 180, easing: 'cubic-bezier(0.24, 0.64, 0.34, 1)' })
    return () => motion.cancel()
  }, [gameId, prefs.reduceMotion])

  return <span className="cable-transfer" ref={particleRef} aria-hidden="true" />
}

export function GameCabinetPage({
  gameId,
  me,
  onRunConfirmed,
  onNavigate,
  onLogout,
}: GameCabinetPageProps) {
  const { prefs } = useArcadePreferences()
  const meta = GAME_CATALOG[gameId]
  const implemented = isGameImplemented(gameId)

  const [selectedMode, setSelectedMode] = useState<GameMode>('standard')
  const [stage, setStage] = useState<CabinetStage>('briefing')
  const [countdownIdx, setCountdownIdx] = useState(0)
  const [launching, setLaunching] = useState(false)
  const [practiceStatus, setPracticeStatus] = useState<'active' | 'cleared' | 'time_up'>('active')
  const [practiceRunKey, setPracticeRunKey] = useState(1)

  const [activeRun, setActiveRun] = useState<StartRunResponse | null>(null)
  const [pendingPayload, setPendingPayload] = useState<{
    events: GameRunEvent[]
    activeDurationMs: number
    endReason: RunEndReason
  } | null>(null)
  const [finalResult, setFinalResult] = useState<FinalizeRunResponse | null>(null)
  const [previousBest, setPreviousBest] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [deadlineWarning, setDeadlineWarning] = useState<string | null>(null)
  const [showAssistHelp, setShowAssistHelp] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [compactTyping, setCompactTyping] = useState(false)

  const monitorRef = useRef<HTMLDivElement | null>(null)
  const startRealBtnRef = useRef<HTMLButtonElement | null>(null)
  const launchInFlightRef = useRef(false)

  useEffect(() => {
    if (gameId !== 'typing') return
    const viewport = window.visualViewport
    const syncLayout = () => setCompactTyping(window.innerWidth <= 700 && (viewport?.height ?? window.innerHeight) <= 520)
    syncLayout()
    viewport?.addEventListener('resize', syncLayout)
    window.addEventListener('resize', syncLayout)
    return () => {
      viewport?.removeEventListener('resize', syncLayout)
      window.removeEventListener('resize', syncLayout)
    }
  }, [gameId])

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  useEffect(() => {
    if (stage !== 'countdown') return
    if (prefs.reduceMotion) {
      const skipTimer = window.setTimeout(() => setStage('playing'), 0)
      return () => window.clearTimeout(skipTimer)
    }
    const step = COUNTDOWN_STEPS[countdownIdx]!
    if (countdownIdx > 0) playArcadeSfx(step.label === 'GO!' ? 'go' : 'countdown')
    const timer = window.setTimeout(() => {
      if (step.label === 'GO!') setStage('playing')
      else setCountdownIdx(countdownIdx + 1)
    }, step.durationMs)
    return () => window.clearTimeout(timer)
  }, [countdownIdx, prefs.reduceMotion, stage])

  useEffect(() => {
    if (!activeRun || stage === 'result' || stage === 'briefing') {
      return
    }
    const checkDeadline = () => {
      const remainMs = Date.parse(activeRun.expiresAt) - Date.now()
      if (remainMs <= 0) {
        setDeadlineWarning('서버 제출 기한(시작 후 20분)이 지났습니다. 새 판으로 다시 시작해 주세요.')
      } else if (remainMs <= 3 * 60 * 1000) {
        setDeadlineWarning(
          `서버 제출 기한이 ${Math.ceil(remainMs / 60000)}분 남았습니다. 완료 후 바로 결과를 저장해 주세요.`,
        )
      } else {
        setDeadlineWarning(null)
      }
    }
    const initTimer = window.setTimeout(checkDeadline, 0)
    const id = window.setInterval(checkDeadline, 15_000)
    document.addEventListener('visibilitychange', checkDeadline)
    return () => {
      window.clearTimeout(initTimer)
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', checkDeadline)
    }
  }, [activeRun, stage])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape' && (stage === 'briefing' || stage === 'result')) {
        e.preventDefault()
        onNavigate('/arcade')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stage, onNavigate])

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && monitorRef.current) {
        await monitorRef.current.requestFullscreen()
      } else if (document.fullscreenElement) {
        await document.exitFullscreen()
      }
    } catch {
      // Ignore fullscreen denial
    }
  }

  const startPractice = () => {
    playArcadeSfx('select')
    setPracticeStatus('active')
    setPracticeRunKey((k) => k + 1)
    setStage('practice')
  }

  const launchServerRun = async (overrideMode?: GameMode) => {
    if (launchInFlightRef.current) return
    launchInFlightRef.current = true
    setLaunching(true)
    const modeToUse = overrideMode ?? selectedMode
    if (overrideMode) setSelectedMode(overrideMode)
    setErrorMsg(null)
    setShowAssistHelp(false)
    try {
      playArcadeSfx('start')
      const started = await arcadeApi.startRun(gameId, modeToUse)
      setPreviousBest(modeToUse === 'assisted' ? gameProg?.assistedBestScore ?? null : gameProg?.standardBestScore ?? null)
      setActiveRun(started)
      setFinalResult(null)
      setPendingPayload(null)
      if (prefs.reduceMotion) {
        setStage('playing')
      } else {
        setCountdownIdx(0)
        setStage('countdown')
      }
    } catch (err) {
      playArcadeSfx('wrong')
      setErrorMsg(
        err instanceof ClientApiError ? err.message : '게임 시작 요청에 실패했습니다.',
      )
    } finally {
      launchInFlightRef.current = false
      setLaunching(false)
    }
  }

  const submitResultToServer = async (
    run: StartRunResponse,
    payload: {
      events: GameRunEvent[]
      activeDurationMs: number
      endReason: RunEndReason
    },
  ) => {
    setStage('saving')
    setErrorMsg(null)
    setPendingPayload(payload)
    savePendingSubmission({
      participantId: me.participantId,
      runId: run.runId,
      gameId: run.gameId,
      mode: run.mode,
      expiresAt: run.expiresAt,
      ...payload,
    })

    try {
      const confirmed = await arcadeApi.submitRunResult(run.runId, payload)
      clearPendingSubmission()
      setFinalResult(confirmed)
      setStage('result')
      if (confirmed.cleared) {
        playArcadeSfx('clear')
      } else {
        playArcadeSfx('select')
      }
      await onRunConfirmed(confirmed.newlyLitSocket ? confirmed.gameId : null)
    } catch (err) {
      playArcadeSfx('wrong')
      setStage('save_error')
      setErrorMsg(
        err instanceof ClientApiError
          ? err.message
          : '결과 저장 중 일시 오류가 발생했습니다. 다시 저장을 눌러 주세요.',
      )
    }
  }

  const gameProg = me.games.find((g) => g.gameId === gameId)
  const latestAttempt = gameProg?.latestAttempt
  const briefingTip = stage === 'briefing' && latestAttempt
    ? formatResultFeedback({ ...latestAttempt, previousActionSummary: null }, me.contentVersion).nextActionTip
    : null
  const firstVisit = !gameProg?.finalizedAttemptCount
  const isCompactMonitor = stage === 'playing' || stage === 'practice' || stage === 'countdown'
  const showLiveStageBackdrop = stage === 'briefing' || stage === 'countdown' || stage === 'result'

  return (
    <div
      className="arcade-shell has-backdrop game-cabinet-shell"
      data-stage={stage}
      data-compact-typing={compactTyping && (stage === 'playing' || stage === 'practice') ? 'true' : undefined}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      <ArcadeVideoBackdrop intensity="vivid" />
      {stage === 'result' && finalResult?.newlyLitSocket && <CableTransfer gameId={finalResult.gameId} />}

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}>
        <ArcadeHeader
          me={me}
          compact={isCompactMonitor}
          justLitGameId={stage === 'result' && finalResult?.newlyLitSocket ? finalResult.gameId : undefined}
          onNavigate={onNavigate}
          onLogout={() => void onLogout()}
        />

        <main className="play-cabinet-wrapper">
          <div
            className="play-monitor-frame"
            ref={monitorRef}
            style={{
              position: 'relative',
              overflow: 'hidden',
              borderColor: `${meta.accentColor}88`,
              boxShadow: `0 0 32px ${meta.accentColor}22`,
            }}
          >
            {/* Full-Bleed Live Animated Stage Demo Backdrop during Briefing / Countdown / Result! */}
            {showLiveStageBackdrop && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 0,
                  opacity: stage === 'result' ? 0.48 : 0.8,
                  pointerEvents: 'none',
                }}
              >
                <CabinetArtwork gameId={gameId} />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                      'linear-gradient(180deg, rgba(8,13,24,0.36), rgba(8,13,24,0.12) 36%, rgba(8,13,24,0.18) 76%, rgba(8,13,24,0.52))',
                  }}
                />
              </div>
            )}

            <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', flex: 1 }}>
              {/* Top Monitor Bezel Bar */}
              <div
                className="game-monitor-toolbar"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                  gap: 10,
                }}
              >
                <div className="game-monitor-title">
                  <span
                    className="cabinet-badge-type"
                    style={{
                      background: `${meta.accentColor}24`,
                      color: meta.accentColor,
                      border: `1px solid ${meta.accentColor}66`,
                    }}
                  >
                    STAGE 0{meta.socketIndex + 1}
                  </span>
                  <strong style={{ fontSize: 18 }}>{meta.title}</strong>
                  {stage === 'playing' && activeRun && (
                    <span
                      className="sample-pill game-monitor-mode"
                      style={{
                        borderColor: 'var(--accent-select)',
                        color: 'var(--accent-select)',
                        background: 'rgba(67,231,242,0.1)',
                      }}
                    >
                      {activeRun.mode === 'assisted' ? '여유롭게 도전 중' : '기본 속도 도전 중'}
                    </span>
                  )}
                </div>

                <div className="game-monitor-actions">
                  <button
                    type="button"
                    className="btn-arcade btn-compact"
                    onClick={() => void toggleFullscreen()}
                  >
                    {isFullscreen ? '전체 화면 해제' : '⛶ 전체 화면'}
                  </button>
                  <button
                    type="button"
                    className="btn-arcade btn-compact"
                    onClick={() => onNavigate('/arcade')}
                  >
                    {stage === 'playing' ? '중단하고 로비로' : '← 오락실 로비'}
                  </button>
                </div>
              </div>

              {deadlineWarning && (
                <div className="status-alert warn" style={{ marginBottom: 8 }}>
                  <span>⏳ {deadlineWarning}</span>
                </div>
              )}

              {!implemented ? (
                <div className="center-card-wrap" style={{ flexDirection: 'column', gap: 14 }}>
                  <div className="cabinet-modal-card" style={{ textAlign: 'center' }}>
                    <span className="sample-pill">개발 단계 준비 중</span>
                    <h2 style={{ margin: '12px 0 8px' }}>{meta.title} · 준비 중</h2>
                    <button
                      type="button"
                      className="btn-arcade btn-start"
                      onClick={() => onNavigate('/arcade')}
                    >
                      오락실 로비로 돌아가기
                    </button>
                  </div>
                </div>
              ) : stage === 'briefing' ? (
                /* 1) Dynamic Stage Intro Briefing with Mascot + Live Stage Backdrop */
                <div className="center-card-wrap game-briefing">
                  <div
                    className="cabinet-modal-card"
                    style={{
                      maxWidth: 740,
                      background: 'rgba(15, 24, 39, 0.85)',
                      backdropFilter: 'blur(16px)',
                      borderColor: `${meta.accentColor}88`,
                      boxShadow: `0 20px 48px rgba(0,0,0,0.65), 0 0 28px ${meta.accentColor}26`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        flexWrap: 'wrap',
                        marginBottom: 12,
                      }}
                    >
                      <CoreBotMascot
                        mood={gameProg?.cleared ? 'crown' : 'cheer'}
                        size={56}
                        accentColor={meta.accentColor}
                        speech={
                          briefingTip ?? (firstVisit ? '처음이라면 연습에서 조작을 한 번 해보세요.' : '바로 도전해 이전 기록을 넘겨보세요.')
                        }
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                      <h1 style={{ margin: 0, fontSize: 26, color: '#ffffff' }}>{meta.title}</h1>
                      {gameProg && (
                        <span className="mono-num" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                          내 최고: 기본 {gameProg.standardBestScore ?? '-'}점 · 여유{' '}
                          {gameProg.assistedBestScore ?? '-'}점 ({gameProg.cleared ? '⚡통과됨' : '미통과'})
                        </span>
                      )}
                    </div>

                    <div className="game-briefing-overview" style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
                      <div
                        style={{
                          padding: '12px 14px',
                          borderRadius: 9,
                          background: 'rgba(11, 18, 30, 0.86)',
                          border: `1px solid ${meta.accentColor}55`,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 800, color: meta.accentColor, marginBottom: 3 }}>
                          🎯 1. 무엇을 하는 게임인가요?
                        </div>
                        <div style={{ fontSize: 15.5, fontWeight: 700 }}>{meta.howToPlayOneLine}</div>
                      </div>

                      <div className="game-briefing-rules" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div
                          style={{
                            padding: '11px 14px',
                            borderRadius: 9,
                            background: 'rgba(11, 18, 30, 0.86)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent-warn)', marginBottom: 3 }}>
                            🕹️ 2. 조작 방법 · 시간
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{meta.controlsLabel}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
                            소요 시간: {meta.expectedDurationLabel}
                          </div>
                        </div>

                        <div
                          style={{
                            padding: '11px 14px',
                            borderRadius: 9,
                            background: 'rgba(11, 18, 30, 0.86)',
                            border: '1px solid rgba(185, 246, 108, 0.35)',
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent-clear)', marginBottom: 3 }}>
                            🏆 3. 통과 기준 & 보너스 타임
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>
                            {gameId === 'runner'
                              ? `최종 점수 ${PASSING_SCORE}점 이상이면 통과`
                              : `${PASSING_SCORE}점에 도달하면 통과 (기본 +2점)`}
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
                            {gameId === 'runner'
                              ? '장애물 감점에 주의하며 점수를 지키세요.'
                              : '통과 후에도 끝까지 점수를 쌓아 TOP 10에 도전하세요!'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13.5 }}>
                        도전 속도 선택 (두 모드 모두 10점 달성 시 동일하게 케이블·배지 인정)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <button
                          type="button"
                          className="btn-arcade"
                          aria-pressed={selectedMode === 'standard'}
                          style={{
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            padding: '11px 14px',
                            borderColor:
                              selectedMode === 'standard' ? 'var(--accent-select)' : undefined,
                            background:
                              selectedMode === 'standard'
                                ? 'rgba(67, 231, 242, 0.16)'
                                : 'rgba(15, 22, 35, 0.8)',
                          }}
                          onClick={() => {
                            playArcadeSfx('select')
                            setSelectedMode('standard')
                          }}
                        >
                          <strong>⚡ 기본 속도 (정규 모드)</strong>
                          <span style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'left' }}>
                            기본 타이머·속도 · 정규 최고점 TOP 10 랭킹 반영
                          </span>
                        </button>

                        <button
                          type="button"
                          className="btn-arcade"
                          aria-pressed={selectedMode === 'assisted'}
                          style={{
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            padding: '11px 14px',
                            borderColor:
                              selectedMode === 'assisted' ? 'var(--accent-clear)' : undefined,
                            background:
                              selectedMode === 'assisted'
                                ? 'rgba(185, 246, 108, 0.14)'
                                : 'rgba(15, 22, 35, 0.8)',
                          }}
                          onClick={() => {
                            playArcadeSfx('select')
                            setSelectedMode('assisted')
                          }}
                        >
                          <strong>🌿 여유롭게 도전 (지원 모드)</strong>
                          <span style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'left' }}>
                            {meta.assistedDiffLabel}
                          </span>
                        </button>
                      </div>
                    </div>

                    {errorMsg && (
                      <div className="status-alert error" style={{ marginBottom: 12 }}>
                        <span>✕ {errorMsg}</span>
                      </div>
                    )}

                    <div className="game-briefing-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className={`btn-arcade ${firstVisit ? 'btn-start' : ''}`}
                        onClick={startPractice}
                      >
                        {firstVisit ? '조작 한 번 연습하기' : '30초 연습'}
                      </button>
                      <button
                        type="button"
                        className={`btn-arcade ${firstVisit ? '' : 'btn-start landing-cta-pulse'}`}
                        style={{ fontSize: 16.5, padding: '11px 24px' }}
                        disabled={launching}
                        onClick={() => void launchServerRun()}
                      >
                        {launching ? '불러오는 중…' : '⚡ 본게임 바로 START ▶'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : stage === 'countdown' ? (
                /* Arcade 3 · 2 · 1 · GO! Launch Screen */
                <div
                  className="center-card-wrap"
                  style={{ flexDirection: 'column', gap: 14 }}
                >
                  <CoreBotMascot
                    mood="fever"
                    size={76}
                    accentColor={meta.accentColor}
                  />
                  <div style={{ fontSize: 16, fontWeight: 800, color: meta.accentColor, letterSpacing: '0.1em' }}>
                    STAGE 0{meta.socketIndex + 1} · {meta.title}
                  </div>
                  <div key={countdownIdx} className="countdown-zoom-digit" aria-hidden="true">
                    {COUNTDOWN_STEPS[countdownIdx]!.label}
                  </div>
                  <button type="button" className="btn-arcade btn-compact" onClick={() => setStage('playing')}>
                    카운트다운 건너뛰기
                  </button>
                </div>
              ) : stage === 'practice' ? (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 10 }}>
                  <div
                    className="status-alert game-practice-banner"
                    style={{
                      justifyContent: 'space-between',
                      background: '#162232',
                      border: '1px solid var(--accent-select)',
                    }}
                  >
                    <div>
                      <strong>연습 · 기록 미반영</strong>
                      <span className="game-practice-goal"> · 목표 {meta.practiceGoalLabel}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {practiceStatus === 'time_up' && (
                        <button
                          type="button"
                          className="btn-arcade btn-compact"
                          onClick={startPractice}
                        >
                          다시 연습
                        </button>
                      )}
                      <button
                        ref={startRealBtnRef}
                        type="button"
                        className="btn-arcade btn-compact btn-start"
                        disabled={launching}
                        onClick={() => void launchServerRun()}
                      >
                        {practiceStatus === 'active' ? '연습 건너뛰기 · 본게임 시작 ▶' : '본게임 시작 ▶'}
                      </button>
                    </div>
                  </div>

                  <ActiveGameSlot
                    key={practiceRunKey}
                    gameId={gameId}
                    seed={202611 + practiceRunKey}
                    mode={selectedMode}
                    contentVersion={me.contentVersion}
                    isPractice={true}
                    onPracticeSuccess={() => {
                      setPracticeStatus('cleared')
                      window.setTimeout(() => startRealBtnRef.current?.focus(), 40)
                    }}
                    onPracticeTimeUp={() => {
                      setPracticeStatus('time_up')
                      window.setTimeout(() => startRealBtnRef.current?.focus(), 40)
                    }}
                    onFinishRound={() => {}}
                  />
                </div>
              ) : stage === 'playing' && activeRun ? (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <ActiveGameSlot
                    gameId={gameId}
                    seed={activeRun.seed}
                    mode={activeRun.mode}
                    contentVersion={activeRun.contentVersion}
                    isPractice={false}
                    onPracticeSuccess={() => {}}
                    onPracticeTimeUp={() => {}}
                    onFinishRound={(payload) => {
                      void submitResultToServer(activeRun, payload)
                    }}
                  />
                </div>
              ) : stage === 'saving' ? (
                <div className="center-card-wrap">
                  <div className="cabinet-modal-card" style={{ textAlign: 'center' }}>
                    <CoreBotMascot mood="fever" size={64} />
                    <h2 style={{ marginTop: 10 }}>⏳ 결과 저장 중...</h2>
                    <p className="instruction-text">
                      서버에서 점수와 통과 판정을 확정하고 있습니다.
                    </p>
                  </div>
                </div>
              ) : stage === 'save_error' ? (
                <div className="center-card-wrap">
                  <div className="cabinet-modal-card">
                    <h2 style={{ marginTop: 0, color: 'var(--accent-warn)' }}>
                      ▲ 결과 저장 대기 중
                    </h2>
                    <p className="instruction-text">{errorMsg}</p>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        type="button"
                        className="btn-arcade btn-start"
                        onClick={() => {
                          if (activeRun && pendingPayload) {
                            void submitResultToServer(activeRun, pendingPayload)
                          }
                        }}
                      >
                        다시 저장 시도
                      </button>
                      <button
                        type="button"
                        className="btn-arcade"
                        onClick={() => onNavigate('/arcade')}
                      >
                        로비로 이동 (대기 제출 유지)
                      </button>
                    </div>
                  </div>
                </div>
              ) : finalResult ? (
                (() => {
                  const fb = formatResultFeedback(finalResult, me.contentVersion)
                  const isAllFourCompleted =
                    finalResult.newlyEarnedBadge ||
                    (finalResult.cleared &&
                      finalResult.requiredClearedCount === REQUIRED_GAME_ORDER.length)
                  const nextRecommendedId = finalResult.recommendation.targetGameId
                  const personalBestIncrease = previousBest !== null ? finalResult.score - previousBest : 0

                  return (
                    <div className="center-card-wrap">
                      <section
                        className="cabinet-modal-card"
                        style={{
                          maxWidth: 700,
                          background: 'rgba(20, 29, 44, 0.92)',
                          backdropFilter: 'blur(16px)',
                          borderColor: finalResult.cleared ? 'var(--accent-clear)' : 'var(--accent-warn)',
                        }}
                      >
                        {personalBestIncrease > 0 ? (
                          <p className="result-leading-tip result-best-increase">개인 최고 +{personalBestIncrease}점</p>
                        ) : (
                          <p className="result-leading-tip">{fb.nextActionTip}</p>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                          <CoreBotMascot
                            mood={
                              isAllFourCompleted
                                ? 'crown'
                                : finalResult.cleared
                                  ? 'victory'
                                  : 'retry'
                            }
                            size={58}
                            speech={
                              isAllFourCompleted
                                ? '대단해요! 4종 케이블을 모두 연결해 마스터 배지를 달성했습니다!'
                                : finalResult.cleared
                                  ? '통과 성공! 멋진 실력이에요!'
                                  : '아깝네요! 방금 감을 잡았으니 한 번 더 도전해 볼까요?'
                            }
                          />
                          <span aria-hidden="true" className={`result-stamp ${finalResult.cleared ? 'is-clear' : ''}`}>
                            {finalResult.cleared ? 'CLEAR!' : 'RETRY!'}
                          </span>
                          <span className="mono-num" style={{ fontSize: 20 }}>
                            이번 점수 <RollingScoreNumber target={finalResult.score} />점 · 내 최고{' '}
                            <strong>{finalResult.personalBestScore}</strong>점
                          </span>
                        </div>

                        <h2 style={{ margin: '6px 0 8px', fontSize: 22 }}>{fb.achievedHeadline}</h2>
                        {fb.deltaText && (
                          <div style={{ fontSize: 14, color: 'var(--accent-select)', marginBottom: 8 }}>
                            ↕ {fb.deltaText}
                          </div>
                        )}

                        {personalBestIncrease > 0 && <div
                          style={{
                            padding: '11px 14px',
                            borderRadius: 8,
                            background: 'rgba(13, 21, 34, 0.9)',
                            border: '1px solid var(--border-subtle)',
                            marginBottom: 16,
                          }}
                          className="instruction-text"
                        >
                          <strong style={{ color: 'var(--accent-warn)' }}>다음 판 핵심 팁:</strong>{' '}
                          {fb.nextActionTip}
                        </div>}

                        {showAssistHelp && (
                          <div className="status-alert clear" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
                            <span>
                              <strong>여유롭게 도전 안내:</strong> {meta.assistedDiffLabel}
                            </span>
                            <button
                              type="button"
                              className="btn-arcade btn-compact btn-clear-cta"
                              onClick={() => void launchServerRun('assisted')}
                            >
                              여유롭게 도전으로 바로 시작 ▶
                            </button>
                          </div>
                        )}

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                          {finalResult.cleared ? (
                            isAllFourCompleted ? (
                              <button
                                type="button"
                                className="btn-arcade btn-clear-cta"
                                onClick={() => onNavigate('/arcade')}
                              >
                                ★ 완성된 4종 마스터 인증서 보기 ▶
                              </button>
                            ) : nextRecommendedId ? (
                              <button
                                type="button"
                                className="btn-arcade btn-clear-cta"
                                onClick={() => onNavigate(`/games/${nextRecommendedId}`)}
                              >
                                다음 게임 · {GAME_CATALOG[nextRecommendedId].title} ▶
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-arcade btn-clear-cta"
                                onClick={() => onNavigate('/arcade')}
                              >
                                오락실 로비로 이동 ▶
                              </button>
                            )
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn-arcade btn-start"
                                onClick={() => void launchServerRun()}
                              >
                                다시 도전 ▶
                              </button>
                              <button
                                type="button"
                                className="btn-arcade"
                                onClick={() => setShowAssistHelp((v) => !v)}
                              >
                                여유 모드로 도움받기
                              </button>
                            </>
                          )}

                          {finalResult.cleared && (
                            <button
                              type="button"
                              className="btn-arcade"
                              onClick={() => void launchServerRun()}
                            >
                              고득점 재도전
                            </button>
                          )}

                          <button
                            type="button"
                            className="btn-arcade"
                            onClick={() => onNavigate('/arcade')}
                          >
                            오락실 로비로
                          </button>

                          <button
                            type="button"
                            className="btn-arcade"
                            onClick={() => onNavigate(`/leaderboard?game=${gameId}`)}
                          >
                            🏆 TOP 10 열기
                          </button>
                        </div>

                        <details
                          style={{
                            background: 'rgba(11, 17, 28, 0.88)',
                            borderRadius: 8,
                            padding: '9px 12px',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                            점수·배점 및 공식 문구 학습 해설 펼쳐 보기
                          </summary>
                          <ul style={{ margin: '10px 0 4px', paddingLeft: 18, display: 'grid', gap: 6 }}>
                            {fb.commentaryLines.map((line, i) => (
                              <li key={i} style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                                {line}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </section>
                    </div>
                  )
                })()
              ) : null}

              <div className="hud-key-footer">
                <span>조작 안내: {meta.controlsLabel}</span>
                <span>탭 전환 시 자동 일시 정지 · Esc 로비 복귀(대기/결과 화면)</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
