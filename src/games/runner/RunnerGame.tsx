import { useCallback, useEffect, useRef, useState } from 'react'
import { PASSING_SCORE } from '../../domain/rules'
import type { CoreValueCode, GameMode, RunEndReason, RunnerRunEvent } from '../../domain/types'
import { useArcadePreferences } from '../../lib/preferences'
import { playArcadeSfx } from '../../lib/sound'
import { RunnerSimulation, type LaneIndex, type RunnerSnapshot } from './engine'

export interface RunnerGameProps {
  seed: number
  mode: GameMode
  contentVersion: string
  isPractice?: boolean
  onPracticeSuccess?: () => void
  onPracticeTimeUp?: () => void
  onFinishRound?: (result: {
    events: RunnerRunEvent[]
    activeDurationMs: number
    endReason: RunEndReason
  }) => void
}

const CORE_COLORS: Record<CoreValueCode, string> = {
  C: '#43E7F2',
  O: '#B9F66C',
  R: '#FFBD64',
  E: '#FF6B9E',
}

const CORE_TITLES: Record<CoreValueCode, string> = {
  C: '고객 최우선',
  O: '열린 협력',
  R: '원칙과 책임',
  E: '실행·전문성',
}

/**
 * 필수 #4: C.O.R.E. 부스터 런 (runner)
 * - 3트랙 전진 러닝 게임: ⚡핵심가치 발판(+2점·가속 부스터, 4종 완성 시 +4점) / 🍌바나나 껍질(−1점·미끄러짐 감속)
 * - ←/→ 트랙 변경, Space/↑ 점프로 바나나를 뛰어넘을 수 있음
 * - 10점 달성 시 통과 확정 후 트랙 완주/시간 종료까지 고득점 경쟁 지속
 */
export function RunnerGame({
  seed,
  mode,
  contentVersion,
  isPractice = false,
  onPracticeSuccess,
  onPracticeTimeUp,
  onFinishRound,
}: RunnerGameProps) {
  const { prefs } = useArcadePreferences()

  const [snap, setSnap] = useState<RunnerSnapshot>(() =>
    new RunnerSimulation({ seed, mode, contentVersion, isPractice }).getSnapshot(),
  )
  const [tabPaused, setTabPaused] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const simRef = useRef<RunnerSimulation | null>(null)
  const finishedOnceRef = useRef(false)

  const getSim = useCallback(() => {
    if (!simRef.current) {
      simRef.current = new RunnerSimulation({ seed, mode, contentVersion, isPractice })
    }
    return simRef.current
  }, [contentVersion, isPractice, mode, seed])

  const emitFinish = useCallback(
    (reason: RunEndReason) => {
      if (finishedOnceRef.current) return
      finishedOnceRef.current = true
      const sim = getSim()
      if (isPractice) {
        onPracticeTimeUp?.()
        return
      }
      onFinishRound?.({
        events: sim.getEvents(),
        activeDurationMs: sim.getActiveDurationMs(),
        endReason: reason,
      })
    },
    [getSim, isPractice, onFinishRound, onPracticeTimeUp],
  )

  useEffect(() => {
    const onVis = () => {
      if (document.hidden && !finishedOnceRef.current) {
        setTabPaused(true)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const handleSwitchLane = useCallback(
    (delta: -1 | 1) => {
      if (tabPaused || finishedOnceRef.current) return
      const sim = getSim()
      if (sim.switchLane(delta)) {
        playArcadeSfx('select')
        setSnap(sim.getSnapshot())
      }
    },
    [getSim, tabPaused],
  )

  const handleJump = useCallback(() => {
    if (tabPaused || finishedOnceRef.current) return
    const sim = getSim()
    if (sim.triggerJump()) {
      playArcadeSfx('jump')
      setSnap(sim.getSnapshot())
    }
  }, [getSim, tabPaused])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (tabPaused || finishedOnceRef.current) return
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        e.stopPropagation()
        handleSwitchLane(-1)
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        e.stopPropagation()
        handleSwitchLane(1)
      } else if (
        e.key === ' ' ||
        e.key === 'ArrowUp' ||
        e.key === 'w' ||
        e.key === 'W'
      ) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) {
          handleJump()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleJump, handleSwitchLane, tabPaused])

  // Main simulation RAF loop
  useEffect(() => {
    if (tabPaused || finishedOnceRef.current) return
    const sim = getSim()
    let lastTs = performance.now()
    let rafId = 0

    const tick = (nowTs: number) => {
      if (finishedOnceRef.current) return
      const dt = Math.min(90, Math.max(0, nowTs - lastTs))
      lastTs = nowTs

      const effects = sim.step(dt)
      const nextSnap = sim.getSnapshot()
      setSnap(nextSnap)

      if (effects.completedCoreSet) {
        playArcadeSfx('clear')
      } else if (effects.boostedLetter) {
        playArcadeSfx('boost')
      } else if (effects.slippedBanana) {
        playArcadeSfx('slip')
      } else if (effects.jumpedBanana) {
        playArcadeSfx('score')
      }

      if (effects.practiceJustCleared) {
        playArcadeSfx('clear')
        onPracticeSuccess?.()
        return
      }

      if (effects.finishedReason) {
        emitFinish(effects.finishedReason)
        return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [emitFinish, getSim, onPracticeSuccess, tabPaused])

  // Render perspective 3-lane arcade track + boosters + bananas + runner character
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    const horizonY = 86
    const playerY = h - 54
    const visibleRangeZ = 340

    // Sky & Cyber Horizon Backdrop
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY)
    skyGrad.addColorStop(0, '#070b14')
    skyGrad.addColorStop(1, snap.boostRemainMs > 0 ? '#12283d' : '#0f1728')
    ctx.fillStyle = skyGrad
    ctx.fillRect(0, 0, w, horizonY)

    // Energy Sun / Core Emblem at horizon
    ctx.save()
    const pulseR = snap.boostRemainMs > 0 && !prefs.reduceMotion ? 56 : 44
    const sunGrad = ctx.createRadialGradient(w / 2, horizonY, 6, w / 2, horizonY, pulseR * 2)
    sunGrad.addColorStop(0, 'rgba(67, 231, 242, 0.42)')
    sunGrad.addColorStop(0.5, 'rgba(255, 107, 158, 0.16)')
    sunGrad.addColorStop(1, 'rgba(7, 11, 20, 0)')
    ctx.fillStyle = sunGrad
    ctx.fillRect(w / 2 - 140, 0, 280, horizonY + 10)
    ctx.restore()

    // Floor Deck
    const floorGrad = ctx.createLinearGradient(0, horizonY, 0, h)
    floorGrad.addColorStop(0, '#0a101c')
    floorGrad.addColorStop(1, '#080c15')
    ctx.fillStyle = floorGrad
    ctx.fillRect(0, horizonY, w, h - horizonY)

    // Perspective projection helper: relZ in [0 (at player), visibleRangeZ (at horizon)]
    const topTrackHalfW = w * 0.11
    const bottomTrackHalfW = w * 0.43
    const projectPoint = (laneOffsetFromCenter: number, relZ: number) => {
      const clamped = Math.max(-35, Math.min(visibleRangeZ, relZ))
      const norm = clamped / visibleRangeZ // 0 near player -> 1 at horizon
      // Non-linear perspective curve so near objects feel fast and readable
      const depthCurve = 1 - Math.pow(1 - Math.max(0, norm), 1.65)
      const y =
        clamped < 0
          ? playerY - (clamped / 40) * 32
          : playerY - depthCurve * (playerY - horizonY)
      const halfW =
        bottomTrackHalfW + (topTrackHalfW - bottomTrackHalfW) * Math.max(0, depthCurve)
      const scale = halfW / bottomTrackHalfW
      const x = w / 2 + laneOffsetFromCenter * (halfW * 0.66)
      return { x, y, scale, halfW }
    }

    // Track Road Polygon
    const topL = w / 2 - topTrackHalfW
    const topR = w / 2 + topTrackHalfW
    const botL = w / 2 - bottomTrackHalfW * 1.08
    const botR = w / 2 + bottomTrackHalfW * 1.08

    const roadGrad = ctx.createLinearGradient(0, horizonY, 0, h)
    roadGrad.addColorStop(0, '#121d30')
    roadGrad.addColorStop(1, '#16243b')
    ctx.fillStyle = roadGrad
    ctx.beginPath()
    ctx.moveTo(topL, horizonY)
    ctx.lineTo(topR, horizonY)
    ctx.lineTo(botR, h)
    ctx.lineTo(botL, h)
    ctx.closePath()
    ctx.fill()

    // Glowing Side Cable Rails
    ctx.strokeStyle =
      snap.boostRemainMs > 0
        ? '#B9F66C'
        : snap.slipRemainMs > 0
          ? '#FFBD64'
          : '#43E7F2'
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.moveTo(topL, horizonY)
    ctx.lineTo(botL, h)
    ctx.moveTo(topR, horizonY)
    ctx.lineTo(botR, h)
    ctx.stroke()

    // 2 Inner Lane Dividers (separating lanes 0 | 1 | 2)
    ctx.strokeStyle = 'rgba(242, 246, 251, 0.22)'
    ctx.lineWidth = 2
    ctx.setLineDash([14, 12])
    for (const div of [-0.36, 0.36]) {
      ctx.beginPath()
      ctx.moveTo(w / 2 + topTrackHalfW * div, horizonY)
      ctx.lineTo(w / 2 + bottomTrackHalfW * 1.08 * div, h)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // Scrolling transverse grid lines for vivid speed sensation
    const stripeSpacing = 38
    const firstStripeZ =
      Math.ceil(snap.distance / stripeSpacing) * stripeSpacing - snap.distance
    ctx.strokeStyle = 'rgba(67, 231, 242, 0.11)'
    ctx.lineWidth = 1.2
    for (let rz = firstStripeZ; rz < visibleRangeZ; rz += stripeSpacing) {
      if (rz < 0) continue
      const p = projectPoint(0, rz)
      ctx.beginPath()
      ctx.moveTo(w / 2 - p.halfW, p.y)
      ctx.lineTo(w / 2 + p.halfW, p.y)
      ctx.stroke()
    }

    // Speed lines on screen edges during Turbo Boost!
    if (snap.boostRemainMs > 0 && !prefs.reduceMotion) {
      ctx.strokeStyle = 'rgba(185, 246, 108, 0.42)'
      ctx.lineWidth = 2.5
      for (let i = 0; i < 8; i += 1) {
        const side = i % 2 === 0 ? -1 : 1
        const yOff = 110 + ((i * 41 + Math.floor(snap.distance * 2.2)) % (h - 130))
        ctx.beginPath()
        ctx.moveTo(w / 2 + side * (w * 0.44), yOff)
        ctx.lineTo(w / 2 + side * (w * 0.49), yOff + 26)
        ctx.stroke()
      }
    }

    // Draw visible track entities from far (horizon) to near (player)
    const visibleEntities = snap.entities.filter((ent) => {
      const rz = ent.z - snap.distance
      return rz >= -22 && rz <= visibleRangeZ
    })

    for (let i = visibleEntities.length - 1; i >= 0; i -= 1) {
      const ent = visibleEntities[i]!
      const rz = ent.z - snap.distance
      const laneOffset = ent.lane - 1 // -1, 0, +1
      const proj = projectPoint(laneOffset, rz)
      const s = Math.max(0.24, proj.scale)

      if (ent.kind === 'booster') {
        if (ent.triggered) continue
        const color = CORE_COLORS[ent.letter]
        const padW = 190 * s
        const padH = 44 * s

        // Neon Booster Pad Base
        ctx.save()
        ctx.fillStyle = 'rgba(12, 24, 38, 0.94)'
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(1.8, 3.2 * s)
        ctx.beginPath()
        ctx.roundRect(proj.x - padW / 2, proj.y - padH / 2, padW, padH, Math.max(4, 10 * s))
        ctx.fill()
        ctx.stroke()

        // Inner chevron / glow strip
        ctx.fillStyle = `${color}28`
        ctx.beginPath()
        ctx.roundRect(
          proj.x - padW * 0.45,
          proj.y - padH * 0.38,
          padW * 0.9,
          padH * 0.76,
          Math.max(3, 7 * s),
        )
        ctx.fill()

        // Core Value Text right on the booster pad
        ctx.fillStyle = color
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const fontPx = Math.max(10, Math.round(17 * s))
        ctx.font = `800 ${fontPx}px Pretendard, "Malgun Gothic", sans-serif`
        ctx.fillText(`⚡[${ent.letter}] ${ent.shortLabel}`, proj.x, proj.y)
        ctx.restore()
      } else {
        if (ent.triggered) continue
        // Vivid Banana Peel Hazard
        const bw = 96 * s
        const bh = 42 * s
        ctx.save()

        // Hazard warning floor ring
        ctx.fillStyle = 'rgba(255, 196, 36, 0.2)'
        ctx.strokeStyle = '#FFD43B'
        ctx.lineWidth = Math.max(1.5, 2.5 * s)
        ctx.beginPath()
        ctx.ellipse(proj.x, proj.y + 4 * s, bw * 0.52, bh * 0.46, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        // Stylized bright yellow banana peel petals
        ctx.fillStyle = '#FFE047'
        ctx.strokeStyle = '#8C5800'
        ctx.lineWidth = Math.max(1, 1.8 * s)
        for (const angle of [-0.65, 0, 0.65]) {
          ctx.save()
          ctx.translate(proj.x, proj.y - 2 * s)
          ctx.rotate(angle)
          ctx.beginPath()
          ctx.ellipse(0, 4 * s, 9 * s, 18 * s, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
        // Banana stem tip
        ctx.fillStyle = '#6B4200'
        ctx.beginPath()
        ctx.arc(proj.x, proj.y - 14 * s, Math.max(2, 4 * s), 0, Math.PI * 2)
        ctx.fill()

        if (s >= 0.42) {
          const tagPx = Math.max(10, Math.round(13 * s))
          ctx.font = `800 ${tagPx}px Pretendard, "Malgun Gothic", sans-serif`
          ctx.textAlign = 'center'
          ctx.fillStyle = '#FFE047'
          ctx.fillText('🍌 바나나 감속', proj.x, proj.y - 26 * s)
        }
        ctx.restore()
      }
    }

    // Draw Runner Character at near-camera position
    const playerProj = projectPoint(snap.visualLane - 1, 0)
    const jumpLiftPx = snap.jumpHeight * 76
    const runnerX = playerProj.x
    const runnerGroundY = playerProj.y
    const runnerBodyY = runnerGroundY - jumpLiftPx

    // Ground shadow shrinks slightly while jumping
    ctx.fillStyle = 'rgba(0, 0, 0, 0.52)'
    ctx.beginPath()
    ctx.ellipse(
      runnerX,
      runnerGroundY + 12,
      28 * (1 - snap.jumpHeight * 0.35),
      9 * (1 - snap.jumpHeight * 0.35),
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()

    ctx.save()
    ctx.translate(runnerX, runnerBodyY)
    if (snap.slipRemainMs > 0 && !prefs.reduceMotion) {
      // Wobble tilt when slipping on banana!
      ctx.rotate(Math.sin(snap.elapsedMs * 0.032) * 0.38)
    }

    // Turbo Booster Flame Trail
    if (snap.boostRemainMs > 0) {
      ctx.fillStyle = '#FF6B9E'
      ctx.beginPath()
      ctx.moveTo(-14, 10)
      ctx.lineTo(0, 34 + (prefs.reduceMotion ? 0 : (snap.elapsedMs % 120) * 0.1))
      ctx.lineTo(14, 10)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#B9F66C'
      ctx.beginPath()
      ctx.moveTo(-8, 10)
      ctx.lineTo(0, 24)
      ctx.lineTo(8, 10)
      ctx.closePath()
      ctx.fill()
    }

    // Animated Stride Legs
    const stride = snap.jumpHeight > 0.1 ? 0.5 : Math.sin(snap.distance * 0.22)
    ctx.strokeStyle = '#9ADCF8'
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-9, 2)
    ctx.lineTo(-12 - stride * 5, 14)
    ctx.moveTo(9, 2)
    ctx.lineTo(12 + stride * 5, 14)
    ctx.stroke()

    // Runner Suit Torso (LS Cable Neon Suit)
    ctx.fillStyle =
      snap.slipRemainMs > 0
        ? '#FFBD64'
        : snap.boostRemainMs > 0
          ? '#B9F66C'
          : '#43E7F2'
    ctx.strokeStyle = '#07121E'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.roundRect(-20, -28, 40, 32, 10)
    ctx.fill()
    ctx.stroke()

    // Helmet / Head
    ctx.fillStyle = '#F2F6FB'
    ctx.beginPath()
    ctx.arc(0, -38, 13, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // Visor Band
    ctx.fillStyle = '#0D1E33'
    ctx.fillRect(-9, -42, 18, 6)

    // Back Jersey Label
    ctx.fillStyle = '#08131E'
    ctx.font = '800 11px "IBM Plex Mono", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('CORE', 0, -12)

    if (snap.slipRemainMs > 0) {
      ctx.font = '700 15px sans-serif'
      ctx.fillStyle = '#FFE047'
      ctx.fillText('🍌미끄덩!', 0, -60)
    } else if (snap.jumpHeight > 0.25) {
      ctx.font = '800 13px Pretendard, sans-serif'
      ctx.fillStyle = '#43E7F2'
      ctx.fillText('JUMP!', 0, -58)
    }

    ctx.restore()
  }, [prefs.reduceMotion, snap])

  const remainSec = Math.ceil(snap.remainingMs / 1000)
  const progressPct = Math.min(100, Math.round((snap.distance / snap.trackLength) * 100))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}>
      {/* Top HUD */}
      <div className="play-hud-bar">
        <div className="hud-metric" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span style={{ color: 'var(--text-muted)' }}>통과 기준 ({PASSING_SCORE}점)</span>
          <strong
            style={{
              color: snap.cleared ? 'var(--accent-clear)' : 'var(--accent-select)',
            }}
          >
            {isPractice
              ? `연습 발판 ${snap.practiceCleared ? 1 : 0}/1`
              : snap.cleared
                ? `✓ 통과 달성! · 고득점 질주 중 (부스터 ${snap.boostCount}회)`
                : `${snap.score} / ${PASSING_SCORE}점`}
          </strong>

          {/* C·O·R·E 4-letter set gauge */}
          {!isPractice && (
            <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              {(['C', 'O', 'R', 'E'] as const).map((code) => {
                const on = snap.currentSetLetters.includes(code)
                return (
                  <span
                    key={code}
                    title={`${code}: ${CORE_TITLES[code]} (4개 모으면 +4점 슈퍼부스터)`}
                    style={{
                      padding: '2px 7px',
                      borderRadius: 5,
                      fontSize: 12,
                      fontWeight: 800,
                      background: on ? `${CORE_COLORS[code]}2E` : '#0f1623',
                      color: on ? CORE_COLORS[code] : 'var(--text-muted)',
                      border: `1px solid ${on ? CORE_COLORS[code] : 'rgba(255,255,255,0.14)'}`,
                    }}
                  >
                    {code}
                  </span>
                )
              })}
              {snap.completedCoreSets > 0 && (
                <span style={{ fontSize: 12, color: 'var(--accent-clear)', fontWeight: 700 }}>
                  ×{snap.completedCoreSets}세트
                </span>
              )}
            </div>
          )}
        </div>

        <div className="hud-metric" style={{ justifyContent: 'center', gap: 12 }}>
          <span
            style={{
              padding: '3px 9px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 800,
              background:
                snap.boostRemainMs > 0
                  ? 'rgba(185, 246, 108, 0.18)'
                  : snap.slipRemainMs > 0
                    ? 'rgba(255, 189, 100, 0.2)'
                    : 'rgba(67, 231, 242, 0.12)',
              color:
                snap.boostRemainMs > 0
                  ? 'var(--accent-clear)'
                  : snap.slipRemainMs > 0
                    ? 'var(--accent-warn)'
                    : 'var(--accent-select)',
            }}
          >
            {snap.boostRemainMs > 0
              ? '🔥 155% 부스터 질주!'
              : snap.slipRemainMs > 0
                ? '🍌 52% 바나나 감속'
                : '⚡ 100% 정속 주행'}
          </span>
          <span className="mono-num" style={{ fontSize: 20 }}>
            {remainSec}s
          </span>
          {!isPractice && (
            <span className="mono-num" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              ({progressPct}%)
            </span>
          )}
        </div>

        <div className="hud-metric" style={{ justifyContent: 'flex-end' }}>
          {!isPractice && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>점수</span>
              <span className="mono-num" style={{ fontSize: 22, color: 'var(--accent-clear)' }}>
                {snap.score}점
              </span>
            </>
          )}
        </div>
      </div>

      {/* Live Status Banner */}
      <div
        style={{
          padding: '8px 14px',
          borderRadius: 8,
          background:
            snap.statusBanner.tone === 'super' || snap.statusBanner.tone === 'boost'
              ? 'rgba(185, 246, 108, 0.12)'
              : snap.statusBanner.tone === 'slip'
                ? 'rgba(255, 189, 100, 0.15)'
                : '#131c2b',
          border: `1px solid ${
            snap.statusBanner.tone === 'super' || snap.statusBanner.tone === 'boost'
              ? 'rgba(185, 246, 108, 0.45)'
              : snap.statusBanner.tone === 'slip'
                ? 'var(--accent-warn)'
                : 'rgba(67, 231, 242, 0.28)'
          }`,
          fontWeight: 700,
          fontSize: 14,
          color:
            snap.statusBanner.tone === 'slip'
              ? 'var(--accent-warn)'
              : snap.statusBanner.tone === 'super' || snap.statusBanner.tone === 'boost'
                ? 'var(--accent-clear)'
                : 'var(--text-primary)',
        }}
      >
        {snap.statusBanner.text}
      </div>

      {/* Perspective 3-Lane Runner Canvas */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 330,
          background: '#080c15',
          border: '1px solid rgba(67, 231, 242, 0.3)',
          borderRadius: 10,
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <canvas
          ref={canvasRef}
          width={1040}
          height={390}
          onClick={(e) => {
            if (tabPaused || finishedOnceRef.current) return
            const rect = e.currentTarget.getBoundingClientRect()
            const normX = (e.clientX - rect.left) / rect.width
            const normY = (e.clientY - rect.top) / rect.height
            if (normY < 0.45) {
              handleJump()
              return
            }
            const clickedLane: LaneIndex = normX < 0.36 ? 0 : normX > 0.64 ? 2 : 1
            const sim = getSim()
            if (clickedLane === sim.getSnapshot().lane) {
              handleJump()
            } else if (sim.setLane(clickedLane)) {
              playArcadeSfx('select')
              setSnap(sim.getSnapshot())
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            cursor: 'pointer',
          }}
          aria-label="C.O.R.E. 부스터 런 3트랙 달리기 화면"
        />

        {isPractice && snap.practiceCleared && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(11, 15, 23, 0.88)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              zIndex: 12,
            }}
          >
            <span className="cabinet-status-tag cleared" style={{ fontSize: 15 }}>
              ✓ 연습 목표 달성!
            </span>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              ⚡ 핵심가치 부스터 발판을 성공적으로 밟았습니다! 상단 [본게임 시작 ▶]으로 출발하세요.
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
              ▶ 계속 달리기
            </button>
          </div>
        )}
      </div>

      {/* Tactile Arcade Footboard Buttons (Keyboard + Mouse/Touch friendly) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.2fr 1fr',
          gap: 8,
        }}
      >
        <button
          type="button"
          className="btn-arcade"
          onClick={() => handleSwitchLane(-1)}
          disabled={tabPaused || snap.finished}
        >
          ◀ 왼쪽 트랙 (← / A)
        </button>
        <button
          type="button"
          className="btn-arcade btn-start"
          onClick={handleJump}
          disabled={tabPaused || snap.finished}
        >
          🦘 점프로 바나나 넘기 (Space / ↑)
        </button>
        <button
          type="button"
          className="btn-arcade"
          onClick={() => handleSwitchLane(1)}
          disabled={tabPaused || snap.finished}
        >
          오른쪽 트랙 (→ / D) ▶
        </button>
      </div>
    </div>
  )
}
