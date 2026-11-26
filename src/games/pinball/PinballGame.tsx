import { useEffect, useRef, useState } from 'react'
import { PASSING_SCORE } from '../../domain/rules'
import type { GameMode, PinballRunEvent, RunEndReason } from '../../domain/types'
import { useArcadePreferences } from '../../lib/preferences'
import { playArcadeSfx } from '../../lib/sound'
import {
  PINBALL_HEIGHT,
  PINBALL_WIDTH,
  PinballSimulation,
  type PinballSnapshot,
} from './engine'

export interface PinballGameProps {
  seed: number
  mode: GameMode
  contentVersion: string
  isPractice?: boolean
  onPracticeSuccess?: () => void
  onPracticeTimeUp?: () => void
  onFinishRound?: (result: {
    events: PinballRunEvent[]
    activeDurationMs: number
    endReason: RunEndReason
  }) => void
}

export function PinballGame({
  mode,
  contentVersion,
  isPractice = false,
  onPracticeSuccess,
  onPracticeTimeUp,
  onFinishRound,
}: PinballGameProps) {
  const { prefs } = useArcadePreferences()
  const [sim] = useState(
    () => new PinballSimulation({ mode, contentVersion, isPractice }),
  )
  const [snapshot, setSnapshot] = useState<PinballSnapshot>(() => sim.getSnapshot())
  const [tabPaused, setTabPaused] = useState(false)
  const [practiceCleared, setPracticeCleared] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const finishedRef = useRef(false)

  useEffect(() => {
    const onVisChange = () => {
      if (document.hidden && !finishedRef.current) {
        sim.setFlipperPressed('left', false)
        sim.setFlipperPressed('right', false)
        setTabPaused(true)
      }
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [sim])

  // Keyboard controls: Left/A/Z = Left Flipper, Right/D/X// = Right Flipper, Space/Enter = Launch
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (finishedRef.current || practiceCleared) return
      if (tabPaused) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          setTabPaused(false)
        }
        return
      }

      if (
        e.key === 'ArrowLeft' ||
        e.key === 'a' ||
        e.key === 'A' ||
        e.key === 'z' ||
        e.key === 'Z'
      ) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) playArcadeSfx('select')
        sim.setFlipperPressed('left', true)
      } else if (
        e.key === 'ArrowRight' ||
        e.key === 'd' ||
        e.key === 'D' ||
        e.key === 'x' ||
        e.key === 'X' ||
        e.key === '/'
      ) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) playArcadeSfx('select')
        sim.setFlipperPressed('right', true)
      } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        if (sim.launchBall()) {
          playArcadeSfx('start')
          setSnapshot(sim.getSnapshot())
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'a' ||
        e.key === 'A' ||
        e.key === 'z' ||
        e.key === 'Z'
      ) {
        sim.setFlipperPressed('left', false)
      } else if (
        e.key === 'ArrowRight' ||
        e.key === 'd' ||
        e.key === 'D' ||
        e.key === 'x' ||
        e.key === 'X' ||
        e.key === '/'
      ) {
        sim.setFlipperPressed('right', false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [practiceCleared, sim, tabPaused])

  // Main fixed-step simulation loop
  useEffect(() => {
    if (tabPaused || practiceCleared || finishedRef.current) return
    let lastTs = performance.now()
    let rafId = 0

    const tick = (nowTs: number) => {
      if (finishedRef.current) return
      const dt = Math.min(100, Math.max(0, nowTs - lastTs))
      lastTs = nowTs

      const prevHits = sim.getSnapshot().validHits
      const prevSets = sim.getSnapshot().completedSets
      const next = sim.step(dt)
      setSnapshot(next)

      if (next.completedSets > prevSets) {
        playArcadeSfx('clear')
      } else if (next.validHits > prevHits) {
        playArcadeSfx('score')
      }

      if (isPractice && next.validHits >= 1) {
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
          })
        }
        return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [isPractice, onFinishRound, onPracticeSuccess, onPracticeTimeUp, practiceCleared, sim, tabPaused])

  // Render Pinball Table with Launch Chute, Center Save Post, Flippers, and 4 C.O.R.E. Bumpers
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle =
      snapshot.justCompletedSetFlash && !prefs.reduceMotion ? '#10261b' : '#090d18'
    ctx.fillRect(0, 0, PINBALL_WIDTH, PINBALL_HEIGHT)

    // Subtle neon grid backdrop inside playfield
    ctx.strokeStyle = 'rgba(67, 231, 242, 0.06)'
    ctx.lineWidth = 1
    for (let x = 60; x < 488; x += 60) {
      ctx.beginPath()
      ctx.moveTo(x, 20)
      ctx.lineTo(x, PINBALL_HEIGHT - 16)
      ctx.stroke()
    }

    // Outer Table Frame + Right Plunger Chute Divider (x = 488)
    ctx.strokeStyle = snapshot.justCompletedSetFlash ? '#B9F66C' : '#43E7F2'
    ctx.lineWidth = 3
    ctx.strokeRect(20, 20, PINBALL_WIDTH - 36, PINBALL_HEIGHT - 24)

    // Launch chute divider & curved top deflector arch
    ctx.strokeStyle = 'rgba(67, 231, 242, 0.65)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(488, 108)
    ctx.lineTo(488, PINBALL_HEIGHT - 6)
    ctx.moveTo(476, 20)
    ctx.quadraticCurveTo(522, 24, 524, 76)
    ctx.stroke()

    // Launch chute spring graphic
    ctx.fillStyle = snapshot.ballWaitingLaunch ? '#FFBD64' : '#2a3852'
    ctx.fillRect(496, PINBALL_HEIGHT - 34, 20, 24)

    // Slingshot angled side inlanes feeding onto flippers
    ctx.strokeStyle = 'rgba(242, 246, 251, 0.55)'
    ctx.lineWidth = 4.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(20, 286)
    ctx.lineTo(128, 392)
    ctx.moveTo(488, 286)
    ctx.lineTo(380, 392)
    ctx.stroke()

    // Center Energy Save Post between flippers
    ctx.fillStyle = snapshot.centerPostReady
      ? 'rgba(67, 231, 242, 0.35)'
      : 'rgba(255, 255, 255, 0.08)'
    ctx.strokeStyle = snapshot.centerPostReady ? '#43E7F2' : '#46546b'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(254, 412, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // Final-letter recommended shot guide arc
    if (snapshot.highlightedFinalLetter) {
      const target = snapshot.bumpers.find(
        (b) => b.letter === snapshot.highlightedFinalLetter,
      )
      if (target) {
        const fromFlipper =
          target.preferredFlipper === 'left' ? snapshot.leftFlipper : snapshot.rightFlipper
        const startX =
          fromFlipper.pivotX + (target.preferredFlipper === 'left' ? 48 : -48)
        const startY = fromFlipper.pivotY - 14

        ctx.strokeStyle = '#FFBD64'
        ctx.lineWidth = 3
        ctx.setLineDash([7, 6])
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.quadraticCurveTo(254, (startY + target.y) / 2 - 24, target.x, target.y)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // 4 C.O.R.E. Bumpers
    for (const bumper of snapshot.bumpers) {
      const collected = snapshot.currentSetLetters.includes(bumper.letter)
      const isFinalTarget = snapshot.highlightedFinalLetter === bumper.letter

      ctx.fillStyle = collected
        ? 'rgba(185, 246, 108, 0.28)'
        : isFinalTarget
          ? 'rgba(255, 189, 100, 0.3)'
          : '#182138'
      ctx.strokeStyle = collected
        ? '#B9F66C'
        : isFinalTarget
          ? '#FFBD64'
          : '#43E7F2'
      ctx.lineWidth = isFinalTarget ? 4 : 2.8
      ctx.beginPath()
      ctx.arc(bumper.x, bumper.y, bumper.radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = collected ? '#B9F66C' : isFinalTarget ? '#FFBD64' : '#F2F6FB'
      ctx.font = '800 19px "IBM Plex Mono", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(bumper.letter, bumper.x, bumper.y - 5)

      ctx.fillStyle = '#D7E2F0'
      ctx.font = '700 11px Pretendard, "Malgun Gothic", sans-serif'
      ctx.fillText(bumper.labelKo, bumper.x, bumper.y + 13)
    }

    // Left & Right Flippers
    const drawFlipper = (f: typeof snapshot.leftFlipper) => {
      const tipX = f.pivotX + Math.cos(f.angleRad) * f.length
      const tipY = f.pivotY + Math.sin(f.angleRad) * f.length
      ctx.strokeStyle = f.pressed ? '#B9F66C' : '#43E7F2'
      ctx.lineWidth = 13
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(f.pivotX, f.pivotY)
      ctx.lineTo(tipX, tipY)
      ctx.stroke()
    }
    drawFlipper(snapshot.leftFlipper)
    drawFlipper(snapshot.rightFlipper)

    // Glowing Silver/Cyan Ball
    ctx.fillStyle = '#FFFFFF'
    ctx.shadowColor = '#43E7F2'
    ctx.shadowBlur = prefs.reduceMotion ? 0 : 10
    ctx.beginPath()
    ctx.arc(snapshot.ballX, snapshot.ballY, snapshot.ballRadius, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }, [prefs.reduceMotion, snapshot])

  const remainSec = Math.max(
    0,
    Math.ceil((snapshot.maxDurationMs - snapshot.activeDurationMs) / 1000),
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}>
      {/* HUD */}
      <div className="play-hud-bar">
        <div className="hud-metric">
          <span style={{ color: 'var(--text-muted)' }}>통과 목표 ({PASSING_SCORE}점)</span>
          <strong
            style={{
              color: snapshot.cleared ? 'var(--accent-clear)' : 'var(--accent-select)',
            }}
          >
            {isPractice
              ? `연습 범퍼 명중 ${practiceCleared ? 1 : 0}/1`
              : snapshot.cleared
                ? `✓ 통과 달성! · 세트 ${snapshot.completedSets}개 (추가 경쟁 중)`
                : `현재 ${snapshot.score}/${PASSING_SCORE}점 · 밝힌 글자 ${snapshot.currentSetLetters.length}/4`}
          </strong>
        </div>

        <div className="hud-metric" style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>남은 시간</span>
          <span className="mono-num" style={{ fontSize: 20 }}>
            {remainSec}s
          </span>
        </div>

        <div className="hud-metric" style={{ justifyContent: 'flex-end' }}>
          {!isPractice && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>남은 공</span>
              <span className="mono-num" style={{ color: 'var(--accent-select)' }}>
                {'●'.repeat(snapshot.ballsRemaining)}{'○'.repeat(3 - snapshot.ballsRemaining)} ({snapshot.ballsRemaining}/3)
              </span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>점수</span>
              <span className="mono-num" style={{ fontSize: 22, color: 'var(--accent-clear)' }}>
                {snapshot.score}점
              </span>
            </>
          )}
        </div>
      </div>

      {snapshot.justCompletedSetFlash && (
        <div className="status-alert clear">
          <span>
            ⚡ <strong>C.O.R.E. 세트 완성! (+4점 보너스)</strong> 남은 공과 시간으로 추가 점수를 계속 쌓아 보세요!
          </span>
        </div>
      )}

      {/* Playfield + Side Guide */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          background: '#070a13',
          border: '1px solid rgba(67, 231, 242, 0.28)',
          borderRadius: 10,
          padding: 10,
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          width={PINBALL_WIDTH}
          height={PINBALL_HEIGHT}
          onClick={(e) => {
            if (snapshot.ballWaitingLaunch) {
              if (sim.launchBall()) {
                playArcadeSfx('start')
                setSnapshot(sim.getSnapshot())
              }
              return
            }
            const rect = e.currentTarget.getBoundingClientRect()
            const side = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right'
            playArcadeSfx('select')
            sim.setFlipperPressed(side, true)
            window.setTimeout(() => sim.setFlipperPressed(side, false), 220)
          }}
          style={{
            maxHeight: 420,
            width: 'auto',
            borderRadius: 8,
            display: 'block',
            cursor: 'pointer',
          }}
          aria-label="C.O.R.E. 핀볼 테이블 (좌/우 클릭으로도 플리퍼 조작 가능)"
        />

        <div style={{ maxWidth: 270, display: 'grid', gap: 10 }}>
          <div
            style={{
              padding: '12px 14px',
              background: '#131c2b',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6, color: 'var(--accent-select)' }}>
              배점 및 C·O·R·E 현황
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              범퍼 명중 <strong>+2점</strong> · 4글자 완성 <strong>+4점 보너스</strong> (10점 통과!)
            </div>
            <div style={{ display: 'grid', gap: 5, fontSize: 13 }}>
              {snapshot.bumpers.map((b) => {
                const hit = snapshot.currentSetLetters.includes(b.letter)
                const isLast = snapshot.highlightedFinalLetter === b.letter
                return (
                  <div
                    key={b.letter}
                    style={{
                      color: hit
                        ? 'var(--accent-clear)'
                        : isLast
                          ? 'var(--accent-warn)'
                          : 'var(--text-muted)',
                      fontWeight: hit || isLast ? 700 : 500,
                    }}
                  >
                    {hit ? '✓' : isLast ? '▶' : '○'} [{b.letter}] {b.labelKo}
                  </div>
                )
              })}
            </div>
          </div>

          {snapshot.ballWaitingLaunch && (
            <button
              type="button"
              className="btn-arcade btn-start"
              onClick={() => {
                if (sim.launchBall()) {
                  playArcadeSfx('start')
                  setSnapshot(sim.getSnapshot())
                }
              }}
            >
              Space · 다음 공 발사하기 ▶
            </button>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              className="btn-arcade"
              onMouseDown={() => {
                playArcadeSfx('select')
                sim.setFlipperPressed('left', true)
              }}
              onMouseUp={() => sim.setFlipperPressed('left', false)}
              onMouseLeave={() => sim.setFlipperPressed('left', false)}
            >
              ← 좌측 플리퍼
            </button>
            <button
              type="button"
              className="btn-arcade"
              onMouseDown={() => {
                playArcadeSfx('select')
                sim.setFlipperPressed('right', true)
              }}
              onMouseUp={() => sim.setFlipperPressed('right', false)}
              onMouseLeave={() => sim.setFlipperPressed('right', false)}
            >
              우측 플리퍼 →
            </button>
          </div>
        </div>

        {tabPaused && (
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
              zIndex: 12,
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
    </div>
  )
}
