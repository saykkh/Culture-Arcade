import { useEffect, useRef, useState } from 'react'
import { getContentBundle } from '../../content'
import { ArcadeHeader } from '../components/ArcadeHeader'
import { GAME_CATALOG } from '../domain/rules'
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
  | 'playing'
  | 'saving'
  | 'save_error'
  | 'result'

function formatResultFeedback(
  result: FinalizeRunResponse,
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
        : `현재 ${result.score}점 (문구 ${curr.correctCount}개) · ${Math.max(2, 10 - result.score)}점 더 획득하면 통과`
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
        : `현재 ${result.score}점 · ${Math.max(2, 10 - result.score)}점 더 획득하면 통과`
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
        : `현재 ${result.score}점 (${curr.correctCount}문항 정답) · ${Math.max(2, 10 - result.score)}점 더 획득하면 통과`
      const nextActionTip =
        curr.timeoutCount > 0
          ? `시간 초과(${curr.timeoutCount}문항)가 있었습니다. 읽기 화면에서 정답 표적을 먼저 고른 뒤 조준 시작을 눌러 보세요.`
          : '마우스 이동·클릭 또는 방향키·Space로 조준할 수 있습니다. 5문항(10점) 이상 맞히면 통과되며 12문항 만점(24점)에 도전할 수 있습니다!'
      return {
        achievedHeadline,
        deltaText:
          diff !== null
            ? `같은 모드 직전 기록 대비 정답 ${diff >= 0 ? `+${diff}` : diff}문항`
            : null,
        nextActionTip,
        commentaryLines: [
          `배점 규칙: 정답 명중 +2점, 오답·시간 초과 0점 (10점 달성 시 통과 · 최고 24점 경쟁)`,
          `C: ${bundle.records['core-c']?.display_ko} / O: ${bundle.records['core-o']?.display_ko}`,
          `R: ${bundle.records['core-r']?.display_ko} / E: ${bundle.records['core-e']?.display_ko}`,
        ],
      }
    }

    case 'racing': {
      const prevCount = prev?.kind === 'racing' ? prev.overtakeCount : null
      const diff = prevCount !== null ? curr.overtakeCount - prevCount : null
      const achievedHeadline = result.cleared
        ? `정상 추월 ${curr.overtakeCount}대 · 종료 순점수 ${result.score}점으로 통과!`
        : `종료 순점수 ${result.score}점 · ${Math.max(1, 10 - result.score)}점 더 확보하면 통과`
      const cpLines = curr.checkpointRecordIds.map(
        (rid, idx) => `체크포인트 ${idx + 1}: ${bundle.records[rid]?.display_ko ?? rid}`,
      )
      return {
        achievedHeadline,
        deltaText:
          diff !== null
            ? `같은 모드 직전 기록 대비 정상 추월 ${diff >= 0 ? `+${diff}` : diff}대`
            : null,
        nextActionTip:
          curr.collisionCount > 0
            ? `충돌 ${curr.collisionCount}회(회당 −1점)가 있었습니다. 빈 차선으로 미리 이동해 추월(+2점)해 보세요.`
            : '정상 추월 1대당 +2점입니다. 직선 구간 부스터 2회를 활용해 최고 40점에 도전해 보세요!',
        commentaryLines: [
          `배점 규칙: 정상 추월 +2점, 차량·장애물 충돌 −1점, 게이트 0점 (순점수 10점 이상 통과 · 최고 40점)`,
          `게이트 선택 결과: ${curr.gateCorrect ? '정답 게이트 통과 (조명 점등)' : '정답 표지 확인 완료'}`,
          ...cpLines,
        ],
      }
    }

    case 'pinball': {
      const prevSets = prev?.kind === 'pinball' ? prev.completedSets : null
      const diff = prevSets !== null ? curr.completedSets - prevSets : null
      const missing = (['C', 'O', 'R', 'E'] as const).filter(
        (c) => !curr.everCollectedLetters.includes(c),
      )
      const achievedHeadline = result.cleared
        ? `유효 명중 ${curr.validHits}회 · C·O·R·E ${curr.completedSets}세트 (${result.score}점) · 통과!`
        : `현재 ${result.score}점 · ${Math.max(2, 10 - result.score)}점 더 획득하면 통과 (남은 글자: ${missing.join(', ') || '없음'})`
      return {
        achievedHeadline,
        deltaText:
          diff !== null
            ? `같은 모드 직전 기록 대비 완성 세트 ${diff >= 0 ? `+${diff}` : diff}세트`
            : null,
        nextActionTip: result.cleared
          ? 'C·O·R·E 4글자 세트를 반복 완성할 때마다 +4점 보너스가 추가되어 고득점 경쟁에 유리합니다!'
          : '좌·우 방향키(또는 화면 좌·우 클릭)로 플리퍼를 튕겨 상단 범퍼(+2점)와 C·O·R·E 세트 보너스(+4점)를 노려 보세요.',
        commentaryLines: [
          `배점 규칙: 유효 범퍼 명중 +2점, C·O·R·E 4글자 세트 완성 보너스 +4점 (10점 달성 시 통과)`,
          `C(${bundle.records['core-c']?.display_ko}) · O(${bundle.records['core-o']?.display_ko}) · R(${bundle.records['core-r']?.display_ko}) · E(${bundle.records['core-e']?.display_ko})`,
        ],
      }
    }

    case 'control-room': {
      return {
        achievedHeadline: result.cleared
          ? `C·O·R·E 관제 패널 4개 복구 및 출구 작동 완료 (${result.score}점) · 관제등 점등!`
          : `패널 ${curr.restoredPanels}/4 복구 (${result.score}점) · 네 패널 복구 후 출구를 작동하면 완료됩니다`,
        deltaText: null,
        nextActionTip: result.cleared
          ? '오락실 로비 상단의 보너스 관제등이 영구 점등되었습니다!'
          : '3D 벽면의 [C]·[O]·[R]·[E] 표지판 또는 우측 패널 목록을 눌러 단서와 맞는 패널을 복구하세요.',
        commentaryLines: bundle.controlRoomStages.map(
          (st) => `${st.correctPanelCode} (${st.deviceName}): ${bundle.records[st.recordId]?.explanation ?? ''}`,
        ),
      }
    }
  }
}

export function GameCabinetPage({
  gameId,
  me,
  onRunConfirmed,
  onNavigate,
  onLogout,
}: GameCabinetPageProps) {
  const meta = GAME_CATALOG[gameId]
  const implemented = isGameImplemented(gameId)
  const isBonus = meta.category === 'bonus'

  const [selectedMode, setSelectedMode] = useState<GameMode>('standard')
  const [stage, setStage] = useState<CabinetStage>('briefing')
  const [practiceStatus, setPracticeStatus] = useState<'active' | 'cleared' | 'time_up'>('active')
  const [practiceRunKey, setPracticeRunKey] = useState(1)

  const [activeRun, setActiveRun] = useState<StartRunResponse | null>(null)
  const [pendingPayload, setPendingPayload] = useState<{
    events: GameRunEvent[]
    activeDurationMs: number
    endReason: RunEndReason
    renderMode?: '3d' | 'simplified' | 'panel-list'
  } | null>(null)
  const [finalResult, setFinalResult] = useState<FinalizeRunResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [deadlineWarning, setDeadlineWarning] = useState<string | null>(null)
  const [showAssistHelp, setShowAssistHelp] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const monitorRef = useRef<HTMLDivElement | null>(null)
  const startRealBtnRef = useRef<HTMLButtonElement | null>(null)

  // Track fullscreen changes without resetting ongoing game state!
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Check 20-minute server submission deadline periodically & on tab return
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

  // Esc returns to lobby from briefing/result (while not inside input)
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
      // Ignore fullscreen denial in restricted browsers
    }
  }

  const startPractice = () => {
    playArcadeSfx('select')
    setPracticeStatus('active')
    setPracticeRunKey((k) => k + 1)
    setStage('practice')
  }

  const launchServerRun = async (overrideMode?: GameMode) => {
    const modeToUse = overrideMode ?? selectedMode
    if (overrideMode) setSelectedMode(overrideMode)
    setErrorMsg(null)
    setShowAssistHelp(false)
    try {
      playArcadeSfx('start')
      const started = await arcadeApi.startRun(gameId, modeToUse)
      setActiveRun(started)
      setFinalResult(null)
      setPendingPayload(null)
      setStage('playing')
    } catch (err) {
      playArcadeSfx('wrong')
      setErrorMsg(
        err instanceof ClientApiError ? err.message : '게임 시작 요청에 실패했습니다.',
      )
    }
  }

  const submitResultToServer = async (
    run: StartRunResponse,
    payload: {
      events: GameRunEvent[]
      activeDurationMs: number
      endReason: RunEndReason
      renderMode?: '3d' | 'simplified' | 'panel-list'
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
  const isCompactMonitor = stage === 'playing' || stage === 'practice'

  return (
    <div className="arcade-shell">
      <ArcadeHeader
        me={me}
        compact={isCompactMonitor}
        onNavigate={onNavigate}
        onLogout={() => void onLogout()}
      />

      <main className="play-cabinet-wrapper">
        <div className="play-monitor-frame" ref={monitorRef}>
          {/* Top Monitor Bezel Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={`cabinet-badge-type ${isBonus ? 'bonus' : ''}`}>
                {isBonus ? '보너스 관제실' : `필수 #${(meta.socketIndex ?? 0) + 1}`}
              </span>
              <strong style={{ fontSize: 18 }}>{meta.title}</strong>
              {stage === 'playing' && activeRun && (
                <span className="sample-pill" style={{ borderColor: 'var(--accent-select)', color: 'var(--accent-select)', background: 'rgba(67,231,242,0.1)' }}>
                  {activeRun.mode === 'assisted' ? '여유롭게 도전 중' : '기본 속도 도전 중'}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                {stage === 'playing' ? '중단하고 로비로 (기존 기록 유지)' : '← 오락실 로비'}
              </button>
            </div>
          </div>

          {deadlineWarning && (
            <div className="status-alert warn" style={{ marginBottom: 8 }}>
              <span>⏳ {deadlineWarning}</span>
            </div>
          )}

          {/* Unimplemented placeholder for games scheduled in later stages */}
          {!implemented ? (
            <div className="center-card-wrap" style={{ flexDirection: 'column', gap: 14 }}>
              <div className="cabinet-modal-card" style={{ textAlign: 'center' }}>
                <span className="sample-pill">개발 단계 준비 중</span>
                <h2 style={{ margin: '12px 0 8px' }}>{meta.title} · 준비 중</h2>
                <p className="instruction-text">
                  이 기기는 현재 개발 단계에서 순차 구현 중입니다. 먼저 추천 기기에서 케이블을 연결해 보세요!
                </p>
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
            /* 1) Pre-Game Briefing & Mode Selection */
            <div className="center-card-wrap">
              <div className="cabinet-modal-card" style={{ maxWidth: 680 }}>
                <h1 style={{ margin: '0 0 10px', fontSize: 24 }}>{meta.title}</h1>
                <div style={{ display: 'grid', gap: 8, marginBottom: 16 }} className="instruction-text">
                  <div>
                    <strong style={{ color: 'var(--accent-select)' }}>클리어 목표:</strong>{' '}
                    {meta.clearConditionLabel}
                  </div>
                  <div>
                    <strong style={{ color: 'var(--accent-select)' }}>예상 시간 · 조작:</strong>{' '}
                    {meta.expectedDurationLabel} · {meta.controlsLabel}
                  </div>
                  {gameProg && (
                    <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                      내 현재 기록:{' '}
                      {isBonus
                        ? gameProg.cleared
                          ? '보너스 완료됨'
                          : '미도전'
                        : `기본 최고 ${gameProg.standardBestScore ?? '-'}점 / 여유 최고 ${
                            gameProg.assistedBestScore ?? '-'
                          }점 (${gameProg.cleared ? '클리어 완료' : '미클리어'})`}
                    </div>
                  )}
                </div>

                {/* First-run open choice between Standard and Assisted modes for all 5 required games */}
                {!isBonus && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>
                      도전 속도 선택 (첫 판부터 자유 선택 가능 · 동일 배지 인정)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <button
                        type="button"
                        className="btn-arcade"
                        aria-pressed={selectedMode === 'standard'}
                        style={{
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          padding: '12px 14px',
                          borderColor:
                            selectedMode === 'standard' ? 'var(--accent-select)' : undefined,
                          background:
                            selectedMode === 'standard'
                              ? 'rgba(67, 231, 242, 0.14)'
                              : undefined,
                        }}
                        onClick={() => {
                          playArcadeSfx('select')
                          setSelectedMode('standard')
                        }}
                      >
                        <strong>⚡ 기본 속도 (정규 모드)</strong>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'left' }}>
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
                          padding: '12px 14px',
                          borderColor:
                            selectedMode === 'assisted' ? 'var(--accent-clear)' : undefined,
                          background:
                            selectedMode === 'assisted'
                              ? 'rgba(185, 246, 108, 0.12)'
                              : undefined,
                        }}
                        onClick={() => {
                          playArcadeSfx('select')
                          setSelectedMode('assisted')
                        }}
                      >
                        <strong>🌿 여유롭게 도전 (지원 모드)</strong>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'left' }}>
                          {meta.assistedDiffLabel}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {errorMsg && (
                  <div className="status-alert error" style={{ marginBottom: 12 }}>
                    <span>✕ {errorMsg}</span>
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
                  {!isBonus && (
                    <button
                      type="button"
                      className="btn-arcade"
                      onClick={startPractice}
                    >
                      30초 짧은 연습 해보기
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-arcade btn-start"
                    style={{ fontSize: 16, padding: '10px 20px' }}
                    onClick={() => void launchServerRun()}
                  >
                    {isBonus ? '관제실 입장 ▶' : '연습 건너뛰고 본게임 START ▶'}
                  </button>
                </div>
              </div>
            </div>
          ) : stage === 'practice' ? (
            /* 2) Optional 30-second single-goal Practice (excluded from server stats) */
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 10 }}>
              <div
                className="status-alert"
                style={{
                  justifyContent: 'space-between',
                  background: '#162232',
                  border: '1px solid var(--accent-select)',
                }}
              >
                <div>
                  <strong>[연습 모드 · 기록 미반영]</strong> 목표: {meta.practiceGoalLabel}
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
            /* 3) Official Server-Issued Game Round */
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
            /* 4) Saving state BEFORE lighting cable or confirming completion */
            <div className="center-card-wrap">
              <div className="cabinet-modal-card" style={{ textAlign: 'center' }}>
                <h2 style={{ marginTop: 0 }}>⏳ 결과 저장 중...</h2>
                <p className="instruction-text">
                  서버에서 점수와 클리어 판정을 확정하고 있습니다. 확정 전에는 케이블 점등이 반영되지 않습니다.
                </p>
              </div>
            </div>
          ) : stage === 'save_error' ? (
            /* 5) Transient error retry */
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
            /* 6) Confirmed Result Screen: ① Action achieved ② One next-round tip ③ Primary buttons ④ Expandable commentary */
            (() => {
              const fb = formatResultFeedback(finalResult, me.contentVersion)
              const isFifthCompletion =
                finalResult.newlyEarnedBadge ||
                (finalResult.cleared && finalResult.requiredClearedCount === 5 && !isBonus)
              const nextRecommendedId = finalResult.recommendation.targetGameId

              return (
                <div className="center-card-wrap">
                  <section className="cabinet-modal-card" style={{ maxWidth: 680 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span
                        className={`cabinet-status-tag ${finalResult.cleared ? 'cleared' : ''}`}
                        style={
                          !finalResult.cleared
                            ? { background: 'rgba(255,189,100,0.18)', color: 'var(--accent-warn)' }
                            : undefined
                        }
                      >
                        {finalResult.cleared ? '✓ 서버 확정 · 클리어 달성' : '▲ 서버 확정 · 미클리어'}
                      </span>
                      <span className="mono-num" style={{ fontSize: 18 }}>
                        이번 점수 <strong style={{ color: 'var(--accent-select)' }}>{finalResult.score}</strong>점 · 내 최고{' '}
                        <strong>{finalResult.personalBestScore}</strong>점
                      </span>
                    </div>

                    {/* ① 이번에 해낸 행동 */}
                    <h2 style={{ margin: '6px 0 8px', fontSize: 22 }}>{fb.achievedHeadline}</h2>
                    {fb.deltaText && (
                      <div style={{ fontSize: 14, color: 'var(--accent-select)', marginBottom: 8 }}>
                        ↕ {fb.deltaText}
                      </div>
                    )}

                    {/* ② 다음 판에서 바꿀 행동 한 가지 */}
                    <div
                      style={{
                        padding: '11px 14px',
                        borderRadius: 8,
                        background: '#131b28',
                        border: '1px solid var(--border-subtle)',
                        marginBottom: 16,
                      }}
                      className="instruction-text"
                    >
                      <strong style={{ color: 'var(--accent-warn)' }}>다음 판 핵심 팁:</strong>{' '}
                      {fb.nextActionTip}
                    </div>

                    {/* 조작 도움 one-click panel on unclear */}
                    {showAssistHelp && !isBonus && (
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

                    {/* ③ 주요 버튼 */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                      {finalResult.cleared ? (
                        isFifthCompletion ? (
                          <button
                            type="button"
                            className="btn-arcade btn-clear-cta"
                            onClick={() => onNavigate('/arcade')}
                          >
                            ★ 완성된 간판 보기
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
                          {!isBonus && (
                            <button
                              type="button"
                              className="btn-arcade"
                              onClick={() => setShowAssistHelp((v) => !v)}
                            >
                              조작 도움 보기
                            </button>
                          )}
                        </>
                      )}

                      {finalResult.cleared && (
                        <button
                          type="button"
                          className="btn-arcade"
                          onClick={() => void launchServerRun()}
                        >
                          다시 도전
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn-arcade"
                        onClick={() => onNavigate('/arcade')}
                      >
                        점등된 로비에서 기기 고르기
                      </button>

                      {!isBonus && (
                        <button
                          type="button"
                          className="btn-arcade"
                          onClick={() => onNavigate(`/leaderboard?game=${gameId}`)}
                        >
                          🏆 TOP 10 열기
                        </button>
                      )}
                    </div>

                    {/* ④ 펼쳐 볼 수 있는 점수·배점·학습 해설 */}
                    <details
                      style={{
                        background: '#111722',
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

          {/* Consistent Edge Key Guide Footer */}
          <div className="hud-key-footer">
            <span>조작 안내: {meta.controlsLabel}</span>
            <span>탭 전환 시 자동 일시 정지 · Esc 로비 복귀(대기/결과 화면)</span>
          </div>
        </div>
      </main>
    </div>
  )
}
