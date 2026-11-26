import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { GameMode, RacingRunEvent, RunEndReason } from '../../domain/types'
import { useArcadePreferences } from '../../lib/preferences'
import { playArcadeSfx } from '../../lib/sound'
import {
  GATE_ZONE_END_Z,
  RacingSimulation,
  type RacingStateSnapshot,
  type TunnelLane,
} from './engine'

const LazyThreeTunnelView = lazy(() => import('./ThreeTunnelView'))

export interface RacingGameProps {
  seed: number
  mode: GameMode
  contentVersion: string
  isPractice?: boolean
  onPracticeSuccess?: () => void
  onPracticeTimeUp?: () => void
  onFinishRound?: (result: {
    events: RacingRunEvent[]
    activeDurationMs: number
    endReason: RunEndReason
    renderMode: '3d' | 'simplified'
  }) => void
}

function SimplifiedTunnelCanvas({ snapshot }: { snapshot: RacingStateSnapshot }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.fillStyle = snapBg(snapshot)
    ctx.fillRect(0, 0, w, h)

    // Perspective 3-lane trapezoid
    const topLeft = w * 0.34
    const topRight = w * 0.66
    const botLeft = w * 0.14
    const botRight = w * 0.86

    ctx.fillStyle = '#111b2c'
    ctx.beginPath()
    ctx.moveTo(topLeft, 18)
    ctx.lineTo(topRight, 18)
    ctx.lineTo(botRight, h - 10)
    ctx.lineTo(botLeft, h - 10)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = snapshot.finalSectionLit ? '#B9F66C' : '#43E7F2'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(topLeft, 18)
    ctx.lineTo(botLeft, h - 10)
    ctx.moveTo(topRight, 18)
    ctx.lineTo(botRight, h - 10)
    ctx.stroke()

    // Lane dividers
    ctx.strokeStyle = 'rgba(67, 231, 242, 0.45)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([10, 10])
    for (const frac of [1 / 3, 2 / 3]) {
      const tx = topLeft + (topRight - topLeft) * frac
      const bx = botLeft + (botRight - botLeft) * frac
      ctx.beginPath()
      ctx.moveTo(tx, 18)
      ctx.lineTo(bx, h - 10)
      ctx.stroke()
    }
    ctx.setLineDash([])

    const projectLaneZ = (lane: TunnelLane, distAhead: number) => {
      const t = Math.min(1, Math.max(0, 1 - distAhead / 190))
      const leftEdge = topLeft + (botLeft - topLeft) * t
      const rightEdge = topRight + (botRight - topRight) * t
      const laneCenter = leftEdge + ((rightEdge - leftEdge) * (lane + 0.5)) / 3
      const y = 24 + (h - 58) * t
      const scale = 0.45 + 0.65 * t
      return { x: laneCenter, y, scale }
    }

    // Gate visual in simplified view
    const gateDist = GATE_ZONE_END_Z - snapshot.z
    if (!snapshot.isPractice && gateDist > 0 && gateDist < 185) {
      const leftPos = projectLaneZ(0, gateDist)
      const rightPos = projectLaneZ(2, gateDist)
      ctx.fillStyle = 'rgba(67, 231, 242, 0.22)'
      ctx.strokeStyle = '#43E7F2'
      ctx.lineWidth = 2
      ctx.strokeRect(leftPos.x - 42 * leftPos.scale, leftPos.y - 26 * leftPos.scale, 84 * leftPos.scale, 32 * leftPos.scale)
      ctx.strokeStyle = '#B9F66C'
      ctx.strokeRect(rightPos.x - 42 * rightPos.scale, rightPos.y - 26 * rightPos.scale, 84 * rightPos.scale, 32 * rightPos.scale)
    }

    // Draw visible vehicles & obstacles
    for (const ent of snapshot.entities) {
      if (ent.collided) continue
      const dist = ent.z - snapshot.z
      if (dist < -8 || dist > 185) continue
      const pos = projectLaneZ(ent.lane, Math.max(0, dist))
      const bw = 54 * pos.scale
      const bh = 28 * pos.scale
      ctx.fillStyle = ent.kind === 'vehicle' ? '#56A8FF' : '#FF6B7A'
      ctx.beginPath()
      ctx.roundRect(pos.x - bw / 2, pos.y - bh / 2, bw, bh, 5)
      ctx.fill()
      ctx.fillStyle = '#08111c'
      ctx.font = `700 ${Math.max(10, Math.round(12 * pos.scale))}px Pretendard, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(ent.kind === 'vehicle' ? '추월차량' : '장애물', pos.x, pos.y)
    }

    // Player car at bottom
    const playerPos = projectLaneZ(snapshot.lane, 6)
    ctx.fillStyle = snapshot.boosterRemainingMs > 0 ? '#B9F66C' : '#43E7F2'
    ctx.beginPath()
    ctx.roundRect(playerPos.x - 32, h - 50, 64, 34, 7)
    ctx.fill()
    ctx.fillStyle = '#07131c'
    ctx.font = '800 12px "IBM Plex Mono", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('LS WAY', playerPos.x, h - 32)
  }, [snapshot])

  return (
    <canvas
      ref={canvasRef}
      width={880}
      height={295}
      style={{ width: '100%', height: '100%', minHeight: 290, display: 'block' }}
      aria-label="간소화 터널 레이싱 화면"
    />
  )
}

function snapBg(s: RacingStateSnapshot): string {
  if (s.finalSectionLit) return '#081412'
  if (s.inGateZone) return '#0c1426'
  return '#070c16'
}

export function RacingGame({
  seed,
  mode,
  contentVersion,
  isPractice = false,
  onPracticeSuccess,
  onPracticeTimeUp,
  onFinishRound,
}: RacingGameProps) {
  const { prefs } = useArcadePreferences()
  const [sim] = useState(
    () => new RacingSimulation({ seed, mode, contentVersion, isPractice }),
  )
  const [snapshot, setSnapshot] = useState<RacingStateSnapshot>(() => sim.getSnapshot())
  const [renderMode, setRenderMode] = useState<'3d' | 'simplified'>('3d')
  const [paused, setPaused] = useState(false)
  const [pauseReason, setPauseReason] = useState<string | null>(null)
  const [practiceCleared, setPracticeCleared] = useState(false)

  const finishedRef = useRef(false)
  const renderModeRef = useRef<'3d' | 'simplified'>('3d')

  const handleWebglFallback = useCallback((reason: string) => {
    renderModeRef.current = 'simplified'
    setRenderMode('simplified')
    setPauseReason(reason)
    setPaused(true)
  }, [])

  useEffect(() => {
    const onVisChange = () => {
      if (document.hidden && !finishedRef.current) {
        setPauseReason('탭 전환으로 주행 타이머와 조작이 일시 정지되었습니다.')
        setPaused(true)
      }
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [])

  // Keyboard controls: Left/Right lane switch, Space booster
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (finishedRef.current || practiceCleared) return
      if (paused) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          setPaused(false)
          setPauseReason(null)
        }
        return
      }

      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        e.stopPropagation()
        if (sim.moveLane(-1)) {
          playArcadeSfx('select')
          setSnapshot(sim.getSnapshot())
        }
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        e.stopPropagation()
        if (sim.moveLane(1)) {
          playArcadeSfx('select')
          setSnapshot(sim.getSnapshot())
        }
      } else if (e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        if (sim.triggerBooster()) {
          playArcadeSfx('start')
          setSnapshot(sim.getSnapshot())
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paused, practiceCleared, sim])

  // Main deterministic simulation loop
  useEffect(() => {
    if (paused || practiceCleared || finishedRef.current) return
    let lastTs = performance.now()
    let rafId = 0

    const tick = (nowTs: number) => {
      if (finishedRef.current) return
      const dt = Math.min(100, Math.max(0, nowTs - lastTs))
      lastTs = nowTs

      const prevOvertakes = sim.getSnapshot().overtakeCount
      const prevCollisions = sim.getSnapshot().collisionCount
      const next = sim.step(dt)
      setSnapshot(next)

      if (next.overtakeCount > prevOvertakes) {
        playArcadeSfx('score')
      } else if (next.collisionCount > prevCollisions) {
        playArcadeSfx('wrong')
      }

      if (isPractice && next.overtakeCount >= 1) {
        finishedRef.current = true
        playArcadeSfx('clear')
        setPracticeCleared(true)
        onPracticeSuccess?.()
        return
      }

      if (next.finished && next.endReason) {
        finishedRef.current = true
        if (isPractice) {
          onPracticeTimeUp?.()
        } else {
          onFinishRound?.({
            events: sim.getEvents(),
            activeDurationMs: Math.round(next.activeDurationMs),
            endReason: next.endReason,
            renderMode: renderModeRef.current,
          })
        }
        return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [isPractice, onFinishRound, onPracticeSuccess, onPracticeTimeUp, paused, practiceCleared, sim])

  const remainSec = Math.max(
    0,
    Math.ceil((snapshot.maxDriveTimerMs - snapshot.driveTimerMs) / 1000),
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}>
      {/* HUD */}
      <div className="play-hud-bar">
        <div className="hud-metric">
          <span style={{ color: 'var(--text-muted)' }}>현재 행동</span>
          <strong
            style={{
              color: snapshot.netScore >= 1000 ? 'var(--accent-clear)' : 'var(--accent-select)',
            }}
          >
            {isPractice
              ? `첫 차량 추월 ${practiceCleared ? 1 : 0}/1`
              : `추월 ${snapshot.overtakeCount}/15대 · 충돌 ${snapshot.collisionCount}회`}
          </strong>
        </div>

        <div className="hud-metric" style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {snapshot.inGateZone ? '게이트 구간 (타이머 정지)' : '남은 주행 시간'}
          </span>
          <span className="mono-num" style={{ fontSize: 20 }}>
            {remainSec}s
          </span>
          {!isPractice && (
            <span className="mono-num" style={{ fontSize: 13, color: 'var(--accent-select)', marginLeft: 8 }}>
              부스터 {'⚡'.repeat(snapshot.boostersLeft)}{'·'.repeat(2 - snapshot.boostersLeft)} ({snapshot.boostersLeft}/2)
            </span>
          )}
        </div>

        <div className="hud-metric" style={{ justifyContent: 'flex-end', gap: 10 }}>
          {!isPractice && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>순점수</span>
              <span className="mono-num" style={{ fontSize: 20, color: 'var(--accent-clear)' }}>
                {snapshot.netScore}
              </span>
            </>
          )}
          <button
            type="button"
            className="btn-arcade btn-compact"
            onClick={() => {
              const nextMode = renderMode === '3d' ? 'simplified' : '3d'
              renderModeRef.current = nextMode
              setRenderMode(nextMode)
            }}
          >
            {renderMode === '3d' ? '간소화 화면 전환' : '3D 화면 전환'}
          </button>
        </div>
      </div>

      {/* Checkpoint / Gate Prompt Banner */}
      {(snapshot.inGateZone || snapshot.activeCheckpointBanner || snapshot.gateFeedbackBanner) && (
        <div
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            background: snapshot.inGateZone ? '#17253a' : '#131c29',
            border: `1.5px solid ${
              snapshot.inGateZone ? 'var(--accent-select)' : 'var(--border-subtle)'
            }`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <strong style={{ color: 'var(--accent-select)' }}>
              {snapshot.inGateZone
                ? '⚡ 미션·비전 식별 게이트 구간 (자동 감속 · 점수 불이익 없음): '
                : '공식 체크포인트 문구: '}
            </strong>
            <span style={{ fontSize: 15, fontWeight: 700 }}>
              “{snapshot.activeCheckpointBanner?.text ?? snapshot.plan.checkpoints[1].displayKo}”
            </span>
          </div>

          {snapshot.inGateZone ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="cabinet-status-tag recommend">
                ← 좌측 차선: {snapshot.plan.leftGateDomain === 'mission' ? '미션 게이트' : '비전 게이트'}
              </span>
              <span className="cabinet-status-tag cleared">
                우측 차선 →: {snapshot.plan.rightGateDomain === 'mission' ? '미션 게이트' : '비전 게이트'}
              </span>
            </div>
          ) : (
            snapshot.gateFeedbackBanner && (
              <span style={{ fontSize: 13, color: 'var(--accent-clear)' }}>
                {snapshot.gateFeedbackBanner}
              </span>
            )
          )}
        </div>
      )}

      {/* 3D WebGL or Shared-Engine Simplified Viewport */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 295,
          background: '#060b14',
          border: '1px solid rgba(67, 231, 242, 0.28)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {renderMode === '3d' ? (
          <Suspense fallback={<SimplifiedTunnelCanvas snapshot={snapshot} />}>
            <LazyThreeTunnelView
              snapshot={snapshot}
              reduceMotion={prefs.reduceMotion}
              onWebglError={handleWebglFallback}
            />
          </Suspense>
        ) : (
          <SimplifiedTunnelCanvas snapshot={snapshot} />
        )}

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
              padding: 16,
              zIndex: 12,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800 }}>일시 정지 · 주행 상태 보존됨</div>
            {pauseReason && (
              <div style={{ color: 'var(--accent-warn)', fontSize: 15 }}>{pauseReason}</div>
            )}
            <button
              type="button"
              className="btn-arcade btn-start"
              onClick={() => {
                setPaused(false)
                setPauseReason(null)
              }}
            >
              ▶ 계속하기
            </button>
          </div>
        )}
      </div>

      {/* Lane / Booster Tactile Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: '#131b28',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          현재 차선: <strong>{snapshot.lane === 0 ? '좌측(1차선)' : snapshot.lane === 1 ? '중앙(2차선)' : '우측(3차선)'}</strong> · 완주 진행률{' '}
          <span className="mono-num">{Math.round((snapshot.z / snapshot.courseLength) * 100)}%</span>
        </span>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn-arcade btn-compact"
            onClick={() => {
              if (sim.moveLane(-1)) setSnapshot(sim.getSnapshot())
            }}
          >
            ← 좌측 차선
          </button>
          <button
            type="button"
            className="btn-arcade btn-compact"
            disabled={snapshot.inGateZone || snapshot.boostersLeft <= 0}
            onClick={() => {
              if (sim.triggerBooster()) setSnapshot(sim.getSnapshot())
            }}
          >
            Space 부스터 ({snapshot.boostersLeft})
          </button>
          <button
            type="button"
            className="btn-arcade btn-compact"
            onClick={() => {
              if (sim.moveLane(1)) setSnapshot(sim.getSnapshot())
            }}
          >
            우측 차선 →
          </button>
        </div>
      </div>
    </div>
  )
}
