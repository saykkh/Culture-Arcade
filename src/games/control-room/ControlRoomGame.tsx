import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { ControlRoomRunEvent, CoreValueCode, GameMode, RunEndReason } from '../../domain/types'
import { playArcadeSfx } from '../../lib/sound'
import { ControlRoomSimulation, type ControlRoomSnapshot } from './engine'
import type { ControlRoomTarget } from './ThreeControlRoomView'

const LazyThreeControlRoomView = lazy(() => import('./ThreeControlRoomView'))

export interface ControlRoomGameProps {
  seed: number
  mode: GameMode
  contentVersion: string
  onFinishRound?: (result: {
    events: ControlRoomRunEvent[]
    activeDurationMs: number
    endReason: RunEndReason
    renderMode: '3d' | 'panel-list'
  }) => void
}

/**
 * 3D C.O.R.E. 관제실 탈출 (control-room · 보너스 게임)
 * - 저폴리곤 3D 관제실 + 동기화된 '패널 목록' 동시/전환 제공
 * - 패널 목록 표시 순서(PRD 3.6): ① 복구된 장치 ② 새로 읽을 단서 ③ 현재 선택 가능한 패널 ④ 출구 상태
 * - 4개 장치 순서 복구 후 출구 직접 작동 시 최초 보너스 완료 저장 및 로비 관제등 점등
 */
export function ControlRoomGame({
  contentVersion,
  onFinishRound,
}: ControlRoomGameProps) {
  const [sim] = useState(() => new ControlRoomSimulation(contentVersion))
  const [snapshot, setSnapshot] = useState<ControlRoomSnapshot>(() => sim.getSnapshot())
  const [viewMode, setViewMode] = useState<'3d' | 'panel-list'>('3d')
  const [paused, setPaused] = useState(false)
  const [pauseMessage, setPauseMessage] = useState<string | null>(null)

  const finishedRef = useRef(false)
  const usedPanelListRef = useRef(false)

  useEffect(() => {
    const onVisChange = () => {
      if (document.hidden && !finishedRef.current) {
        setPauseMessage('탭 전환으로 탐색 시간이 일시 정지되었습니다.')
        setPaused(true)
      }
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [])

  // Active exploration timer (pauses on tab hide or pointer-lock release!)
  useEffect(() => {
    if (paused || finishedRef.current) return
    let lastTs = performance.now()
    const id = window.setInterval(() => {
      const nowTs = performance.now()
      sim.advanceTime(nowTs - lastTs)
      lastTs = nowTs
    }, 100)
    return () => window.clearInterval(id)
  }, [paused, sim])

  const completeExitIfReady = useCallback(() => {
    if (finishedRef.current) return
    const ok = sim.activateExit()
    const next = sim.getSnapshot()
    setSnapshot(next)
    if (!ok) {
      playArcadeSfx('wrong')
      return
    }
    finishedRef.current = true
    playArcadeSfx('clear')
    onFinishRound?.({
      events: sim.getEvents(),
      activeDurationMs: Math.max(1000, Math.round(next.activeDurationMs)),
      endReason: 'exit_activated',
      renderMode: viewMode === 'panel-list' || usedPanelListRef.current ? 'panel-list' : '3d',
    })
  }, [onFinishRound, sim, viewMode])

  const handlePanelChoice = useCallback(
    (code: CoreValueCode, fromPanelList: boolean) => {
      if (finishedRef.current) return
      if (fromPanelList) {
        usedPanelListRef.current = true
      }
      const res = sim.selectPanel(code)
      setSnapshot(res.snapshot)
      playArcadeSfx(res.correct ? 'score' : 'wrong')
    },
    [sim],
  )

  const handle3dInteract = useCallback(
    (target: ControlRoomTarget) => {
      if (target.kind === 'clue') {
        playArcadeSfx('select')
        setSnapshot(sim.inspectActiveClue())
      } else if (target.kind === 'panel') {
        handlePanelChoice(target.code, false)
      } else {
        completeExitIfReady()
      }
    },
    [completeExitIfReady, handlePanelChoice, sim],
  )

  const handlePointerLockReleased = useCallback(() => {
    if (finishedRef.current) return
    setPauseMessage('3D 카메라 잠금이 해제되어 타이머와 이동이 일시 정지되었습니다.')
    setPaused(true)
  }, [])

  const handleWebglError = useCallback((reason: string) => {
    usedPanelListRef.current = true
    setViewMode('panel-list')
    setPauseMessage(reason)
    setPaused(true)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}>
      {/* HUD */}
      <div className="play-hud-bar">
        <div className="hud-metric">
          <span style={{ color: 'var(--text-muted)' }}>보너스 탐색 진행</span>
          <strong
            style={{
              color: snapshot.exitPowerRestored ? 'var(--accent-clear)' : 'var(--accent-select)',
            }}
          >
            복구된 패널 {snapshot.restoredDevices.length}/4 · 출구{' '}
            {snapshot.exitPowerRestored ? '전원 복구됨' : '전원 대기'}
          </strong>
        </div>

        <div className="hud-metric" style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>자유 탐색 모드 (제출 기한 20분 내)</span>
        </div>

        <div className="hud-metric" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-arcade btn-compact"
            onClick={() => {
              const nextMode = viewMode === '3d' ? 'panel-list' : '3d'
              if (nextMode === 'panel-list') usedPanelListRef.current = true
              setViewMode(nextMode)
            }}
          >
            {viewMode === '3d' ? '패널 목록 단독 화면으로 보기' : '3D 관제실 + 패널 목록 함께 보기'}
          </button>
        </div>
      </div>

      {/* Live Clue / Feedback Banner */}
      <div
        className={`status-alert ${
          snapshot.lastFeedback.tone === 'correct'
            ? 'clear'
            : snapshot.lastFeedback.tone === 'hint'
              ? 'warn'
              : ''
        }`}
        style={
          snapshot.lastFeedback.tone === 'info'
            ? { background: '#141e2e', border: '1px solid var(--accent-select)' }
            : undefined
        }
      >
        <div>
          <strong>{snapshot.lastFeedback.title}:</strong> {snapshot.lastFeedback.detail}
        </div>
      </div>

      {/* Main Split Workspace: 3D Low-Poly Room + Synchronized Panel List */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          display: 'grid',
          gridTemplateColumns: viewMode === '3d' ? '1.35fr 1fr' : '1fr',
          gap: 10,
          minHeight: 340,
        }}
      >
        {viewMode === '3d' && (
          <div
            style={{
              borderRadius: 10,
              overflow: 'hidden',
              border: '1px solid rgba(67, 231, 242, 0.28)',
              background: '#090d16',
            }}
          >
            <Suspense
              fallback={
                <div className="center-card-wrap" style={{ color: 'var(--text-muted)' }}>
                  3D 관제실을 불러오는 중...
                </div>
              }
            >
              <LazyThreeControlRoomView
                snapshot={snapshot}
                paused={paused}
                onInteractTarget={handle3dInteract}
                onPointerLockReleased={handlePointerLockReleased}
                onWebglError={handleWebglError}
              />
            </Suspense>
          </div>
        )}

        {/* Accessible Synchronized Panel List (Ordered strictly per PRD 3.6: 1. 복구된 장치 -> 2. 새로 읽을 단서 -> 3. 선택 가능한 패널 -> 4. 출구 상태) */}
        <aside
          aria-label="관제실 패널 목록"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
            padding: '12px 14px',
            background: '#131b28',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
          }}
        >
          <div style={{ fontWeight: 800, color: 'var(--accent-select)', fontSize: 15 }}>
            📋 관제실 패널 목록 (카메라 이동 없이 동일하게 진행 가능)
          </div>

          {/* 1. 복구된 장치 */}
          <div style={{ fontSize: 13 }}>
            <div style={{ color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>
              1. 복구된 장치 ({snapshot.restoredDevices.length}/4)
            </div>
            {snapshot.restoredDevices.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>아직 복구된 장치가 없습니다.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {snapshot.restoredDevices.map((d) => (
                  <span key={d.stageIndex} className="cabinet-status-tag cleared">
                    ✓ [{d.panelCode}] {d.deviceName}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 2. 새로 읽을 단서 */}
          <div
            style={{
              padding: '8px 10px',
              background: '#0e141f',
              borderRadius: 7,
              border: '1px solid rgba(67, 231, 242, 0.25)',
              fontSize: 13,
            }}
          >
            <div style={{ color: 'var(--accent-select)', fontWeight: 700, marginBottom: 3 }}>
              2. 새로 읽을 단서
            </div>
            <div>
              {snapshot.activeStageConfig
                ? snapshot.activeStageConfig.cluePrompt
                : '네 가지 단서를 모두 해결했습니다! 아래 4번 출구 장치를 작동하세요.'}
            </div>
          </div>

          {/* 3. 현재 선택 가능한 패널 */}
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 5 }}>
              3. 현재 선택 가능한 C·O·R·E 패널
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {sim.panelOptions.map((opt) => {
                const alreadyRestored = snapshot.restoredDevices.some(
                  (d) => d.panelCode === opt.code,
                )
                return (
                  <button
                    key={opt.code}
                    type="button"
                    className="btn-arcade btn-compact"
                    disabled={paused || alreadyRestored || snapshot.exitPowerRestored}
                    onClick={() => handlePanelChoice(opt.code, true)}
                    style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  >
                    <span>
                      {alreadyRestored ? '✓' : '▣'} <strong>[{opt.code}]</strong> {opt.labelKo.split('(')[0]!.trim()}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 4. 출구 상태 */}
          <div style={{ marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6 }}>
              4. 관제실 출구 상태:{' '}
              <span
                style={{
                  color: snapshot.exitPowerRestored ? 'var(--accent-clear)' : 'var(--accent-warn)',
                }}
              >
                {snapshot.exitPowerRestored ? '주 전원 복구됨 (개방 가능)' : '전원 차단됨 (4개 패널 복구 필요)'}
              </span>
            </div>
            <button
              type="button"
              className={`btn-arcade ${snapshot.exitPowerRestored ? 'btn-clear-cta' : ''}`}
              style={{ width: '100%' }}
              disabled={paused || !snapshot.exitPowerRestored}
              onClick={completeExitIfReady}
            >
              {snapshot.exitPowerRestored
                ? '★ 관제실 출구 직접 작동하기 (관제등 점등) ▶'
                : '패널 4개 복구 후 출구 작동 가능'}
            </button>
          </div>
        </aside>

        {/* Pause Overlay (Tab Hidden or Pointer Lock Released) */}
        {paused && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(11, 15, 23, 0.9)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 18,
              zIndex: 15,
              borderRadius: 10,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800 }}>일시 정지 · 탐색 상태 보존됨</div>
            {pauseMessage && (
              <div style={{ color: 'var(--accent-warn)', fontSize: 15 }}>{pauseMessage}</div>
            )}
            <button
              type="button"
              className="btn-arcade btn-start"
              onClick={() => {
                setPaused(false)
                setPauseMessage(null)
              }}
            >
              ▶ 계속하기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
