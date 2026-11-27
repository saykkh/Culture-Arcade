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
 * STAGE #4: C.O.R.E. 부스터 런 — 8종 아케이드 기믹 확장판 (페이퍼로지 폰트 전용)
 * [도움 장치 4종] ⚡핵심가치 발판(+2·가속) · 🚀초전도 하이퍼링(+3·195% 초가속) · 🛡️절연 실드(+1·1회방어) · 🔼스프링 점프대(+1·슈퍼점프)
 * [방해 장치 4종] 🍌바나나(−1·미끄러짐) · 🟣점착 타르 늪(−1·35% 중감속) · 🚧바리케이드(−1·멈칫 정지) · ⚡과전류 쇼크(−2·0.7초 일시정지)
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
  const vfxPopupsRef = useRef<
    Array<{
      text: string
      color: string
      lane: number
      ageMs: number
      ttlMs: number
    }>
  >([])
  const vfxSparksRef = useRef<
    Array<{
      lane: number
      dx: number
      dy: number
      vx: number
      vy: number
      color: string
      ageMs: number
      ttlMs: number
    }>
  >([])

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
    if (sim.triggerJump(false)) {
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

  // Simulation loop
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

      // Advance VFX popups & sparks
      vfxPopupsRef.current = vfxPopupsRef.current
        .map((p) => ({ ...p, ageMs: p.ageMs + dt }))
        .filter((p) => p.ageMs < p.ttlMs)
      vfxSparksRef.current = vfxSparksRef.current
        .map((s) => ({
          ...s,
          dx: s.dx + s.vx * (dt / 1000),
          dy: s.dy + s.vy * (dt / 1000),
          vy: s.vy + 280 * (dt / 1000),
          ageMs: s.ageMs + dt,
        }))
        .filter((s) => s.ageMs < s.ttlMs)

      const spawnHitVfx = (text: string, color: string) => {
        vfxPopupsRef.current.push({
          text,
          color,
          lane: nextSnap.visualLane,
          ageMs: 0,
          ttlMs: 880,
        })
        if (!prefs.reduceMotion) {
          for (let k = 0; k < 10; k += 1) {
            const ang = (Math.PI * 2 * k) / 10
            vfxSparksRef.current.push({
              lane: nextSnap.visualLane,
              dx: 0,
              dy: -24,
              vx: Math.cos(ang) * (70 + (k % 3) * 35),
              vy: Math.sin(ang) * 70 - 95,
              color,
              ageMs: 0,
              ttlMs: 520,
            })
          }
        }
      }

      if (effects.completedCoreSet) {
        playArcadeSfx('clear')
        spawnHitVfx('★ CORE 완성 +6!', '#B9F66C')
      } else if (effects.collectedBonus === 'hyper_ring') {
        playArcadeSfx('boost')
        spawnHitVfx('🚀 HYPER +3!', '#FF6B9E')
      } else if (effects.collectedBonus === 'shield') {
        playArcadeSfx('shield')
        spawnHitVfx('🛡️ 실드 장착 +1!', '#43E7F2')
      } else if (effects.shieldBlocked) {
        playArcadeSfx('shield')
        spawnHitVfx('🛡️ 실드 완벽 방어!', '#43E7F2')
      } else if (effects.collectedBonus === 'jump_ramp') {
        playArcadeSfx('jump')
        spawnHitVfx('🔼 슈퍼점프 +1!', '#C9FA87')
      } else if (effects.boostedLetter) {
        playArcadeSfx('boost')
        spawnHitVfx(
          `⚡[${effects.boostedLetter}] +2점!`,
          CORE_COLORS[effects.boostedLetter],
        )
      } else if (effects.stunnedBy === 'emp_shock') {
        playArcadeSfx('stun')
        spawnHitVfx('⚡감전 정지 −3', '#FF6B7A')
      } else if (effects.stunnedBy === 'barricade') {
        playArcadeSfx('stun')
        spawnHitVfx('🚧충돌 정지 −2', '#FFBD64')
      } else if (effects.slippedOrSludged === 'sludge') {
        playArcadeSfx('slip')
        spawnHitVfx('🟣점착 감속 −2', '#D8B4FE')
      } else if (effects.slippedOrSludged === 'banana') {
        playArcadeSfx('slip')
        spawnHitVfx('🍌미끄덩 −2', '#FFE047')
      } else if (effects.jumpedHazard) {
        playArcadeSfx('score')
        spawnHitVfx('🦘 나이스 점프!', '#43E7F2')
      }

      setSnap(nextSnap)

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
  }, [emitFinish, getSim, onPracticeSuccess, prefs.reduceMotion, tabPaused])

  // Render 3-Lane Track + All 8 Distinct Devices + Runner Character
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    const horizonY = 82
    const playerY = h - 54
    const visibleRangeZ = 345

    // Sky Backdrop
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY)
    skyGrad.addColorStop(0, '#070b14')
    skyGrad.addColorStop(
      1,
      snap.hyperRemainMs > 0
        ? '#26143b'
        : snap.boostRemainMs > 0
          ? '#12283d'
          : snap.stunRemainMs > 0
            ? '#2c1218'
            : '#0f1728',
    )
    ctx.fillStyle = skyGrad
    ctx.fillRect(0, 0, w, horizonY)

    // Horizon Energy Core
    ctx.save()
    const pulseR = snap.hyperRemainMs > 0 || snap.boostRemainMs > 0 ? 58 : 44
    const sunGrad = ctx.createRadialGradient(w / 2, horizonY, 6, w / 2, horizonY, pulseR * 2.1)
    sunGrad.addColorStop(0, snap.hyperRemainMs > 0 ? 'rgba(255,107,158,0.52)' : 'rgba(67,231,242,0.42)')
    sunGrad.addColorStop(0.5, 'rgba(167,139,250,0.18)')
    sunGrad.addColorStop(1, 'rgba(7,11,20,0)')
    ctx.fillStyle = sunGrad
    ctx.fillRect(w / 2 - 160, 0, 320, horizonY + 12)
    ctx.restore()

    // Floor Deck
    ctx.fillStyle = '#090e19'
    ctx.fillRect(0, horizonY, w, h - horizonY)

    const topTrackHalfW = w * 0.11
    const bottomTrackHalfW = w * 0.43
    const projectPoint = (laneOffsetFromCenter: number, relZ: number) => {
      const clamped = Math.max(-35, Math.min(visibleRangeZ, relZ))
      const norm = clamped / visibleRangeZ
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

    // Road Polygon
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

    // Side Cable Rails
    ctx.strokeStyle =
      snap.stunRemainMs > 0
        ? '#FF6B7A'
        : snap.hyperRemainMs > 0
          ? '#FF6B9E'
          : snap.boostRemainMs > 0
            ? '#B9F66C'
            : snap.sludgeRemainMs > 0
              ? '#A78BFA'
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

    // Lane Dividers
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

    // Scrolling transverse grid lines
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

    // Speed lines during Boost / Hyper Boost
    if ((snap.boostRemainMs > 0 || snap.hyperRemainMs > 0) && !prefs.reduceMotion) {
      ctx.strokeStyle =
        snap.hyperRemainMs > 0 ? 'rgba(255, 107, 158, 0.58)' : 'rgba(185, 246, 108, 0.44)'
      ctx.lineWidth = snap.hyperRemainMs > 0 ? 3.2 : 2.4
      for (let i = 0; i < 10; i += 1) {
        const side = i % 2 === 0 ? -1 : 1
        const yOff = 100 + ((i * 39 + Math.floor(snap.distance * 2.6)) % (h - 120))
        ctx.beginPath()
        ctx.moveTo(w / 2 + side * (w * 0.43), yOff)
        ctx.lineTo(w / 2 + side * (w * 0.49), yOff + 28)
        ctx.stroke()
      }
    }

    // Draw visible entities from far to near
    const visibleEntities = snap.entities.filter((ent) => {
      const rz = ent.z - snap.distance
      return rz >= -22 && rz <= visibleRangeZ
    })

    for (let i = visibleEntities.length - 1; i >= 0; i -= 1) {
      const ent = visibleEntities[i]!
      const rz = ent.z - snap.distance
      const proj = projectPoint(ent.lane - 1, rz)
      const s = Math.max(0.24, proj.scale)

      if (ent.kind === 'booster') {
        if (ent.triggered) continue
        const color = CORE_COLORS[ent.letter]
        const padW = 190 * s
        const padH = 42 * s

        ctx.save()
        ctx.fillStyle = 'rgba(12, 24, 38, 0.94)'
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(1.8, 3.2 * s)
        ctx.beginPath()
        ctx.roundRect(proj.x - padW / 2, proj.y - padH / 2, padW, padH, Math.max(4, 10 * s))
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = `${color}28`
        ctx.beginPath()
        ctx.roundRect(
          proj.x - padW * 0.45,
          proj.y - padH * 0.36,
          padW * 0.9,
          padH * 0.72,
          Math.max(3, 7 * s),
        )
        ctx.fill()

        ctx.fillStyle = color
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `800 ${Math.max(10, Math.round(16 * s))}px "Paperlogy", sans-serif`
        ctx.fillText(`⚡[${ent.letter}] ${ent.shortLabel}`, proj.x, proj.y)
        ctx.restore()
      } else if (ent.kind === 'bonus') {
        if (ent.triggered) continue
        ctx.save()
        if (ent.bonusKind === 'hyper_ring') {
          // 1) 🚀 Superconducting Hyper Ring Arch
          const r = 34 * s
          ctx.strokeStyle = '#FF6B9E'
          ctx.lineWidth = Math.max(2.5, 6 * s)
          ctx.beginPath()
          ctx.arc(proj.x, proj.y - 16 * s, r, 0, Math.PI * 2)
          ctx.stroke()

          ctx.strokeStyle = '#43E7F2'
          ctx.lineWidth = Math.max(1.5, 3 * s)
          ctx.beginPath()
          ctx.arc(proj.x, proj.y - 16 * s, r * 0.72, 0, Math.PI * 2)
          ctx.stroke()

          if (s >= 0.36) {
            ctx.fillStyle = '#FF9EC2'
            ctx.textAlign = 'center'
            ctx.font = `800 ${Math.max(10, Math.round(14 * s))}px "Paperlogy", sans-serif`
            ctx.fillText('🚀하이퍼링 +3', proj.x, proj.y - 56 * s)
          }
        } else if (ent.bonusKind === 'shield') {
          // 2) 🛡️ Insulation Shield Orb
          const r = 24 * s
          ctx.fillStyle = 'rgba(67, 231, 242, 0.25)'
          ctx.strokeStyle = '#43E7F2'
          ctx.lineWidth = Math.max(2, 3.5 * s)
          ctx.beginPath()
          ctx.arc(proj.x, proj.y - 14 * s, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = '#E8FCFF'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.font = `800 ${Math.max(11, Math.round(18 * s))}px "Paperlogy", sans-serif`
          ctx.fillText('🛡️', proj.x, proj.y - 14 * s)

          if (s >= 0.38) {
            ctx.fillStyle = '#43E7F2'
            ctx.font = `800 ${Math.max(10, Math.round(13 * s))}px "Paperlogy", sans-serif`
            ctx.fillText('보호실드', proj.x, proj.y - 44 * s)
          }
        } else if (ent.bonusKind === 'jump_ramp') {
          // 3) 🔼 Spring Jump Pad
          const rw = 118 * s
          const rh = 34 * s
          ctx.fillStyle = '#1E3418'
          ctx.strokeStyle = '#B9F66C'
          ctx.lineWidth = Math.max(2, 3.2 * s)
          ctx.beginPath()
          ctx.moveTo(proj.x - rw / 2, proj.y + rh / 2)
          ctx.lineTo(proj.x - rw * 0.36, proj.y - rh / 2)
          ctx.lineTo(proj.x + rw * 0.36, proj.y - rh / 2)
          ctx.lineTo(proj.x + rw / 2, proj.y + rh / 2)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = '#B9F66C'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.font = `800 ${Math.max(10, Math.round(14 * s))}px "Paperlogy", sans-serif`
          ctx.fillText('🔼점프대', proj.x, proj.y)
        }
        ctx.restore()
      } else {
        if (ent.triggered || ent.blockedByShield) continue
        ctx.save()

        if (ent.hazardKind === 'banana') {
          // 5) 🍌 Banana Peel
          const bw = 90 * s
          const bh = 38 * s
          ctx.fillStyle = 'rgba(255, 196, 36, 0.2)'
          ctx.strokeStyle = '#FFD43B'
          ctx.lineWidth = Math.max(1.5, 2.4 * s)
          ctx.beginPath()
          ctx.ellipse(proj.x, proj.y + 4 * s, bw * 0.5, bh * 0.45, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = '#FFE047'
          ctx.strokeStyle = '#8C5800'
          ctx.lineWidth = Math.max(1, 1.6 * s)
          for (const angle of [-0.65, 0, 0.65]) {
            ctx.save()
            ctx.translate(proj.x, proj.y - 2 * s)
            ctx.rotate(angle)
            ctx.beginPath()
            ctx.ellipse(0, 4 * s, 8 * s, 16 * s, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.restore()
          }

          if (s >= 0.4) {
            ctx.font = `800 ${Math.max(10, Math.round(13 * s))}px "Paperlogy", sans-serif`
            ctx.textAlign = 'center'
            ctx.fillStyle = '#FFE047'
            ctx.fillText('🍌바나나', proj.x, proj.y - 25 * s)
          }
        } else if (ent.hazardKind === 'sludge') {
          // 6) 🟣 Sticky Tar Puddle (Heavy Slowdown)
          const sw = 152 * s
          const sh = 42 * s
          ctx.fillStyle = 'rgba(130, 62, 219, 0.62)'
          ctx.strokeStyle = '#C084FC'
          ctx.lineWidth = Math.max(1.8, 2.8 * s)
          ctx.beginPath()
          ctx.ellipse(proj.x, proj.y + 2 * s, sw * 0.5, sh * 0.45, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()

          // Bubbles inside tar puddle
          ctx.fillStyle = '#E9D5FF'
          ctx.beginPath()
          ctx.arc(proj.x - 22 * s, proj.y, Math.max(2, 5 * s), 0, Math.PI * 2)
          ctx.arc(proj.x + 20 * s, proj.y + 3 * s, Math.max(2, 4 * s), 0, Math.PI * 2)
          ctx.fill()

          if (s >= 0.38) {
            ctx.font = `800 ${Math.max(10, Math.round(13 * s))}px "Paperlogy", sans-serif`
            ctx.textAlign = 'center'
            ctx.fillStyle = '#E9D5FF'
            ctx.fillText('🟣점착늪(중감속)', proj.x, proj.y - 22 * s)
          }
        } else if (ent.hazardKind === 'barricade') {
          // 7) 🚧 Work Barricade (Brief Collision Stop, Jumpable!)
          const cw = 142 * s
          const ch = 44 * s
          ctx.fillStyle = '#2B2110'
          ctx.strokeStyle = '#FFBD64'
          ctx.lineWidth = Math.max(2, 3 * s)
          ctx.beginPath()
          ctx.roundRect(proj.x - cw / 2, proj.y - ch, cw, ch, Math.max(3, 6 * s))
          ctx.fill()
          ctx.stroke()

          // Warning hazard stripes
          ctx.fillStyle = '#FFBD64'
          for (const off of [-0.3, 0, 0.3]) {
            ctx.fillRect(proj.x + cw * off - 8 * s, proj.y - ch + 5 * s, 14 * s, ch - 10 * s)
          }

          if (s >= 0.36) {
            ctx.font = `800 ${Math.max(10, Math.round(13 * s))}px "Paperlogy", sans-serif`
            ctx.textAlign = 'center'
            ctx.fillStyle = '#FFD89B'
            ctx.fillText('🚧바리케이드(점프!)', proj.x, proj.y - ch - 10 * s)
          }
        } else if (ent.hazardKind === 'emp_shock') {
          // 8) ⚡ Overcurrent Shock Gate (0.7s Full Stop! Tall pylon gate)
          const gw = 148 * s
          const gh = 68 * s
          const leftPylon = proj.x - gw / 2
          const rightPylon = proj.x + gw / 2

          // Side pylons
          ctx.fillStyle = '#38121A'
          ctx.strokeStyle = '#FF6B7A'
          ctx.lineWidth = Math.max(2, 3 * s)
          ctx.fillRect(leftPylon, proj.y - gh, 14 * s, gh)
          ctx.strokeRect(leftPylon, proj.y - gh, 14 * s, gh)
          ctx.fillRect(rightPylon - 14 * s, proj.y - gh, 14 * s, gh)
          ctx.strokeRect(rightPylon - 14 * s, proj.y - gh, 14 * s, gh)

          // Crackling electric arcs between pylons
          ctx.strokeStyle = '#FF8593'
          ctx.lineWidth = Math.max(2, 3.2 * s)
          for (const hFrac of [0.35, 0.72]) {
            const arcY = proj.y - gh * hFrac
            ctx.beginPath()
            ctx.moveTo(leftPylon + 14 * s, arcY)
            ctx.lineTo(proj.x - 18 * s, arcY - 6 * s)
            ctx.lineTo(proj.x + 18 * s, arcY + 6 * s)
            ctx.lineTo(rightPylon - 14 * s, arcY)
            ctx.stroke()
          }

          if (s >= 0.35) {
            ctx.font = `800 ${Math.max(10, Math.round(13 * s))}px "Paperlogy", sans-serif`
            ctx.textAlign = 'center'
            ctx.fillStyle = '#FF9AA5'
            ctx.fillText('⚡감전쇼크(정지주의!)', proj.x, proj.y - gh - 10 * s)
          }
        }

        ctx.restore()
      }
    }

    // Draw Runner Character
    const playerProj = projectPoint(snap.visualLane - 1, 0)
    const jumpLiftPx = snap.jumpHeight * 74
    const runnerX = playerProj.x
    const runnerGroundY = playerProj.y
    const runnerBodyY = runnerGroundY - jumpLiftPx

    ctx.fillStyle = 'rgba(0, 0, 0, 0.52)'
    ctx.beginPath()
    ctx.ellipse(
      runnerX,
      runnerGroundY + 12,
      Math.max(10, 28 * (1 - Math.min(0.65, snap.jumpHeight * 0.35))),
      Math.max(4, 9 * (1 - Math.min(0.65, snap.jumpHeight * 0.35))),
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()

    ctx.save()
    ctx.translate(runnerX, runnerBodyY)
    if ((snap.slipRemainMs > 0 || snap.stunRemainMs > 0) && !prefs.reduceMotion) {
      ctx.rotate(Math.sin(snap.elapsedMs * 0.045) * 0.36)
    }

    // Active Shield Bubble Aura around Runner!
    if (snap.hasShield) {
      ctx.strokeStyle = '#43E7F2'
      ctx.fillStyle = 'rgba(67, 231, 242, 0.16)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(0, -18, 38, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // Booster / Hyper Flame Trail
    if (snap.boostRemainMs > 0 || snap.hyperRemainMs > 0) {
      ctx.fillStyle = snap.hyperRemainMs > 0 ? '#FF6B9E' : '#B9F66C'
      ctx.beginPath()
      ctx.moveTo(-15, 10)
      ctx.lineTo(0, (snap.hyperRemainMs > 0 ? 44 : 32) + (prefs.reduceMotion ? 0 : (snap.elapsedMs % 100) * 0.12))
      ctx.lineTo(15, 10)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#43E7F2'
      ctx.beginPath()
      ctx.moveTo(-8, 10)
      ctx.lineTo(0, 24)
      ctx.lineTo(8, 10)
      ctx.closePath()
      ctx.fill()
    }

    // Stride Legs
    const stride =
      snap.stunRemainMs > 0
        ? 0
        : snap.jumpHeight > 0.1
          ? 0.55
          : Math.sin(snap.distance * 0.24)
    ctx.strokeStyle = '#9ADCF8'
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-9, 2)
    ctx.lineTo(-12 - stride * 5, 14)
    ctx.moveTo(9, 2)
    ctx.lineTo(12 + stride * 5, 14)
    ctx.stroke()

    // Runner Suit Torso
    ctx.fillStyle =
      snap.stunRemainMs > 0
        ? '#FF6B7A'
        : snap.sludgeRemainMs > 0
          ? '#A78BFA'
          : snap.slipRemainMs > 0
            ? '#FFBD64'
            : snap.hyperRemainMs > 0
              ? '#FF6B9E'
              : snap.boostRemainMs > 0
                ? '#B9F66C'
                : '#43E7F2'
    ctx.strokeStyle = '#07121E'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.roundRect(-20, -28, 40, 32, 10)
    ctx.fill()
    ctx.stroke()

    // Helmet
    ctx.fillStyle = '#F2F6FB'
    ctx.beginPath()
    ctx.arc(0, -38, 13, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#0D1E33'
    ctx.fillRect(-9, -42, 18, 6)

    ctx.fillStyle = '#08131E'
    ctx.font = '800 11px "Paperlogy", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('CORE', 0, -12)

    // Overhead status callout
    ctx.font = '800 14px "Paperlogy", sans-serif'
    if (snap.stunRemainMs > 0) {
      ctx.fillStyle = '#FF9AA5'
      ctx.fillText('⚡정지!', 0, -60)
    } else if (snap.sludgeRemainMs > 0) {
      ctx.fillStyle = '#E9D5FF'
      ctx.fillText('🟣끈적감속!', 0, -60)
    } else if (snap.slipRemainMs > 0) {
      ctx.fillStyle = '#FFE047'
      ctx.fillText('🍌미끄덩!', 0, -60)
    } else if (snap.isSuperJump && snap.jumpHeight > 0.3) {
      ctx.fillStyle = '#B9F66C'
      ctx.fillText('🔼슈퍼점프!', 0, -60)
    } else if (snap.jumpHeight > 0.25) {
      ctx.fillStyle = '#43E7F2'
      ctx.fillText('JUMP!', 0, -58)
    }

    ctx.restore()

    // Draw Burst Sparks & Floating Score/Status Popups!
    for (const sp of vfxSparksRef.current) {
      const spProj = projectPoint(sp.lane - 1, 0)
      const alpha = Math.max(0, 1 - sp.ageMs / sp.ttlMs)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = sp.color
      ctx.beginPath()
      ctx.arc(spProj.x + sp.dx, spProj.y + sp.dy, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    for (const pop of vfxPopupsRef.current) {
      const popProj = projectPoint(pop.lane - 1, 0)
      const prog = pop.ageMs / pop.ttlMs
      const alpha = prog < 0.7 ? 1 : Math.max(0, (1 - prog) / 0.3)
      const liftY = popProj.y - 76 - prog * 48
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.font = '900 19px "Paperlogy", sans-serif'
      ctx.textAlign = 'center'
      ctx.strokeStyle = '#050a14'
      ctx.lineWidth = 4.5
      ctx.strokeText(pop.text, popProj.x, liftY)
      ctx.fillStyle = pop.color
      ctx.fillText(pop.text, popProj.x, liftY)
      ctx.restore()
    }
  }, [prefs.reduceMotion, snap])

  const remainSec = Math.ceil(snap.remainingMs / 1000)
  const progressPct = Math.min(100, Math.round((snap.distance / snap.trackLength) * 100))
  const speedPct = Math.round(snap.speedMultiplier * 100)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 7 }}>
      {/* Top HUD */}
      <div className="play-hud-bar" style={{ marginBottom: 0 }}>
        <div className="hud-metric" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span style={{ color: 'var(--text-muted)' }}>통과 ({PASSING_SCORE}점)</span>
          <strong
            style={{
              color: snap.cleared ? 'var(--accent-clear)' : 'var(--accent-select)',
            }}
          >
            {isPractice
              ? `연습 목표 ${snap.practiceCleared ? 1 : 0}/1`
              : snap.cleared
                ? `✓ 통과 달성! · 고득점 질주 중`
                : `${snap.score} / ${PASSING_SCORE}점`}
          </strong>

          {!isPractice && (
            <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              {(['C', 'O', 'R', 'E'] as const).map((code) => {
                const on = snap.currentSetLetters.includes(code)
                return (
                  <span
                    key={code}
                    title={`${code}: ${CORE_TITLES[code]} (4개 모으면 +4점 세트보너스)`}
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
              {snap.hasShield && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    background: 'rgba(67, 231, 242, 0.2)',
                    color: '#43E7F2',
                    border: '1px solid #43E7F2',
                  }}
                >
                  🛡️실드 ON
                </span>
              )}
            </div>
          )}
        </div>

        <div className="hud-metric" style={{ justifyContent: 'center', gap: 10 }}>
          <span
            style={{
              padding: '3px 9px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 800,
              background:
                snap.stunRemainMs > 0
                  ? 'rgba(255, 107, 122, 0.22)'
                  : snap.hyperRemainMs > 0
                    ? 'rgba(255, 107, 158, 0.22)'
                    : snap.boostRemainMs > 0
                      ? 'rgba(185, 246, 108, 0.18)'
                      : snap.sludgeRemainMs > 0 || snap.slipRemainMs > 0
                        ? 'rgba(255, 189, 100, 0.2)'
                        : 'rgba(67, 231, 242, 0.12)',
              color:
                snap.stunRemainMs > 0
                  ? '#FF9AA5'
                  : snap.hyperRemainMs > 0
                    ? '#FF9EC2'
                    : snap.boostRemainMs > 0
                      ? 'var(--accent-clear)'
                      : snap.sludgeRemainMs > 0 || snap.slipRemainMs > 0
                        ? 'var(--accent-warn)'
                        : 'var(--accent-select)',
            }}
          >
            {snap.stunRemainMs > 0
              ? '⚡ 0% 일시 정지!'
              : snap.hyperRemainMs > 0
                ? `🚀 ${speedPct}% 하이퍼 질주!`
                : snap.boostRemainMs > 0
                  ? `🔥 ${speedPct}% 부스터!`
                  : snap.sludgeRemainMs > 0
                    ? `🟣 ${speedPct}% 점착 중감속`
                    : snap.slipRemainMs > 0
                      ? `🍌 ${speedPct}% 미끄러짐`
                      : `⚡ ${speedPct}% 주행`}
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

      {/* Compact 8-Device Quick Legend Strip */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: '5px 10px',
          borderRadius: 7,
          background: '#101826',
          border: '1px solid rgba(255,255,255,0.1)',
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ color: '#B9F66C', fontWeight: 700 }}>⚡핵심가치(+2·가속)</span>
          <span style={{ color: '#FF9EC2', fontWeight: 700 }}>🚀하이퍼링(+3·초가속)</span>
          <span style={{ color: '#43E7F2', fontWeight: 700 }}>🛡️보호실드(+1·1회방어)</span>
          <span style={{ color: '#C9FA87', fontWeight: 700 }}>🔼점프대(+1·슈퍼점프)</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ color: '#FFE047' }}>🍌바나나(감속)</span>
          <span style={{ color: '#D8B4FE' }}>🟣점착늪(중감속)</span>
          <span style={{ color: '#FFBD64' }}>🚧바리케이드(멈칫·점프!)</span>
          <span style={{ color: '#FF9AA5' }}>⚡감전쇼크(일시정지·회피!)</span>
        </div>
      </div>

      {/* Live Status Callout */}
      <div
        style={{
          padding: '7px 13px',
          borderRadius: 8,
          background:
            snap.statusBanner.tone === 'super' || snap.statusBanner.tone === 'boost'
              ? 'rgba(185, 246, 108, 0.12)'
              : snap.statusBanner.tone === 'stun'
                ? 'rgba(255, 107, 122, 0.16)'
                : snap.statusBanner.tone === 'slip'
                  ? 'rgba(255, 189, 100, 0.15)'
                  : '#131c2b',
          border: `1px solid ${
            snap.statusBanner.tone === 'super' || snap.statusBanner.tone === 'boost'
              ? 'rgba(185, 246, 108, 0.45)'
              : snap.statusBanner.tone === 'stun'
                ? 'var(--accent-danger)'
                : snap.statusBanner.tone === 'slip'
                  ? 'var(--accent-warn)'
                  : 'rgba(67, 231, 242, 0.28)'
          }`,
          fontWeight: 700,
          fontSize: 13.5,
          color:
            snap.statusBanner.tone === 'stun'
              ? '#FF9AA5'
              : snap.statusBanner.tone === 'slip'
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
          minHeight: 320,
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
          height={375}
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
          aria-label="C.O.R.E. 부스터 런 8종 기믹 트랙 화면"
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
              부스터 장치를 성공적으로 작동했습니다! 상단 [본게임 시작 ▶]으로 다양한 기믹 트랙에 도전하세요.
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

      {/* Tactile Arcade Controls */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.25fr 1fr',
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
          🦘 점프로 장애물 넘기 (Space / ↑)
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
