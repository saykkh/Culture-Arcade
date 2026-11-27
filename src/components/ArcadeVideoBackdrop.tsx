import { useEffect, useRef } from 'react'
import { useArcadePreferences } from '../lib/preferences'

interface ArcadeVideoBackdropProps {
  intensity?: 'vivid' | 'ambient'
}

interface PulseOrb {
  cableIdx: number
  progress: number
  speed: number
  color: string
  size: number
}

interface FloatingParticle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  alpha: number
  label?: string
}

const NEON_PALETTE = ['#43E7F2', '#B9F66C', '#FFBD64', '#FF6B9E', '#A78BFA'] as const
const CORE_LETTERS = ['C', 'O', 'R', 'E'] as const

/**
 * 실시간 60fps 사이버 광케이블·에너지 그리드 시네마틱 배경 비디오 캔버스
 * - 랜딩 페이지에서는 'vivid' 모드로 화려한 3D 신스웨이브 전력망 + 광케이블 전류 펄스 + 홀로그램 입자 연출
 * - 로비/랭킹에서는 'ambient' 모드로 가독성을 해치지 않는 은은한 아케이드 무드 조명 제공
 * - '효과 줄이기(reduceMotion)' 활성화 시 정적 네온 그라디언트로 자동 전환
 */
export function ArcadeVideoBackdrop({ intensity = 'vivid' }: ArcadeVideoBackdropProps) {
  const { prefs } = useArcadePreferences()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = window.innerWidth
    let height = window.innerHeight
    const syncSize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width
      canvas.height = height
    }
    syncSize()
    window.addEventListener('resize', syncSize)

    const isVivid = intensity === 'vivid'
    const pulses: PulseOrb[] = Array.from({ length: isVivid ? 18 : 8 }, (_, i) => ({
      cableIdx: i % 6,
      progress: (i * 0.17) % 1,
      speed: 0.16 + (i % 5) * 0.045,
      color: NEON_PALETTE[i % NEON_PALETTE.length]!,
      size: isVivid ? 4 + (i % 3) * 1.8 : 3,
    }))

    const particles: FloatingParticle[] = Array.from({ length: isVivid ? 34 : 14 }, (_, i) => ({
      x: ((i * 197) % 1000) / 1000,
      y: ((i * 313) % 1000) / 1000,
      vx: (((i % 7) - 3) * 0.006),
      vy: -0.015 - (i % 5) * 0.006,
      radius: isVivid ? 2 + (i % 4) * 1.5 : 1.8,
      color: NEON_PALETTE[i % NEON_PALETTE.length]!,
      alpha: isVivid ? 0.22 + (i % 4) * 0.1 : 0.14,
      label: isVivid && i < 8 ? CORE_LETTERS[i % 4] : undefined,
    }))

    let rafId = 0
    let lastTs = performance.now()
    let timeSec = 0

    const drawFrame = (dtSec: number) => {
      timeSec += dtSec
      const horizonY = height * (isVivid ? 0.46 : 0.52)

      // 1) Deep Space-Navy Synthwave Sky
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height)
      bgGrad.addColorStop(0, '#050811')
      bgGrad.addColorStop(0.46, isVivid ? '#0d1830' : '#0a1120')
      bgGrad.addColorStop(1, '#060912')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, width, height)

      // 2) Pulsing Dual Aurora Nebulas
      const nebulaAlpha = isVivid ? 0.24 : 0.1
      const neb1X = width * (0.28 + Math.sin(timeSec * 0.35) * 0.08)
      const neb1 = ctx.createRadialGradient(neb1X, horizonY * 0.72, 10, neb1X, horizonY * 0.72, width * 0.42)
      neb1.addColorStop(0, `rgba(67, 231, 242, ${nebulaAlpha})`)
      neb1.addColorStop(0.5, `rgba(167, 139, 250, ${nebulaAlpha * 0.45})`)
      neb1.addColorStop(1, 'rgba(5, 8, 17, 0)')
      ctx.fillStyle = neb1
      ctx.fillRect(0, 0, width, height)

      const neb2X = width * (0.74 + Math.cos(timeSec * 0.28) * 0.07)
      const neb2 = ctx.createRadialGradient(neb2X, horizonY * 0.85, 10, neb2X, horizonY * 0.85, width * 0.38)
      neb2.addColorStop(0, `rgba(255, 107, 158, ${nebulaAlpha * 0.85})`)
      neb2.addColorStop(0.55, `rgba(185, 246, 108, ${nebulaAlpha * 0.32})`)
      neb2.addColorStop(1, 'rgba(5, 8, 17, 0)')
      ctx.fillStyle = neb2
      ctx.fillRect(0, 0, width, height)

      // 3) Perspective Scrolling 3D Cyber Energy Grid Floor
      const gridAlpha = isVivid ? 0.24 : 0.09
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, horizonY, width, height - horizonY)
      ctx.clip()

      // Radial perspective rays from vanishing point
      const vanishX = width * 0.5
      ctx.strokeStyle = `rgba(67, 231, 242, ${gridAlpha})`
      ctx.lineWidth = 1.2
      const rayCount = 18
      for (let i = -rayCount; i <= rayCount; i += 1) {
        const bottomX = vanishX + i * (width * 0.13)
        ctx.beginPath()
        ctx.moveTo(vanishX, horizonY)
        ctx.lineTo(bottomX, height)
        ctx.stroke()
      }

      // Scrolling horizontal perspective bars
      const scrollPhase = (timeSec * (isVivid ? 0.55 : 0.22)) % 1
      for (let row = 0; row < 14; row += 1) {
        const norm = (row + scrollPhase) / 14
        const curved = Math.pow(norm, 2.15)
        const y = horizonY + curved * (height - horizonY)
        const rowAlpha = gridAlpha * (0.25 + curved * 0.95)
        ctx.strokeStyle = `rgba(67, 231, 242, ${rowAlpha})`
        ctx.lineWidth = 1 + curved * 1.4
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }
      ctx.restore()

      // Glowing Horizon Laser Line
      const horizonGlow = ctx.createLinearGradient(0, horizonY - 3, 0, horizonY + 12)
      horizonGlow.addColorStop(0, 'rgba(67, 231, 242, 0)')
      horizonGlow.addColorStop(0.35, isVivid ? 'rgba(67, 231, 242, 0.65)' : 'rgba(67, 231, 242, 0.25)')
      horizonGlow.addColorStop(1, 'rgba(67, 231, 242, 0)')
      ctx.fillStyle = horizonGlow
      ctx.fillRect(0, horizonY - 4, width, 16)

      // 4) Sweeping High-Voltage Optical Cable Curves + Travelling Energy Pulses
      const getCablePoint = (cableIdx: number, t: number) => {
        const side = cableIdx % 2 === 0 ? -1 : 1
        const tier = Math.floor(cableIdx / 2) // 0, 1, 2
        const startX = side < 0 ? -40 : width + 40
        const startY = height * (0.16 + tier * 0.24)
        const ctrl1X = width * (0.5 + side * (0.28 - tier * 0.05))
        const ctrl1Y = height * (0.22 + Math.sin(timeSec * 0.5 + cableIdx) * 0.05)
        const endX = width * 0.5 + side * (30 + tier * 45)
        const endY = horizonY

        const u = 1 - t
        const x = u * u * startX + 2 * u * t * ctrl1X + t * t * endX
        const y = u * u * startY + 2 * u * t * ctrl1Y + t * t * endY
        return { x, y }
      }

      for (let c = 0; c < 6; c += 1) {
        const color = NEON_PALETTE[c % NEON_PALETTE.length]!
        ctx.strokeStyle = isVivid ? `${color}36` : `${color}18`
        ctx.lineWidth = isVivid ? 2.2 : 1.4
        ctx.beginPath()
        for (let step = 0; step <= 24; step += 1) {
          const pt = getCablePoint(c, step / 24)
          if (step === 0) ctx.moveTo(pt.x, pt.y)
          else ctx.lineTo(pt.x, pt.y)
        }
        ctx.stroke()
      }

      // Draw glowing energy packets racing along the cables!
      for (const p of pulses) {
        p.progress = (p.progress + dtSec * p.speed) % 1
        const pt = getCablePoint(p.cableIdx, p.progress)
        const tailPt = getCablePoint(p.cableIdx, Math.max(0, p.progress - 0.05))

        ctx.save()
        ctx.strokeStyle = p.color
        ctx.shadowColor = p.color
        ctx.shadowBlur = isVivid ? 14 : 6
        ctx.lineWidth = p.size
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(tailPt.x, tailPt.y)
        ctx.lineTo(pt.x, pt.y)
        ctx.stroke()
        ctx.restore()
      }

      // 5) Floating Hologram Particles & C·O·R·E Glyphs
      for (const part of particles) {
        part.x = (part.x + part.vx * dtSec + 1) % 1
        part.y = (part.y + part.vy * dtSec + 1) % 1
        const px = part.x * width
        const py = part.y * height

        ctx.save()
        ctx.globalAlpha = part.alpha
        if (part.label) {
          ctx.fillStyle = part.color
          ctx.font = '800 14px "Paperlogy", sans-serif'
          ctx.fillText(part.label, px, py)
        } else {
          ctx.fillStyle = part.color
          ctx.beginPath()
          ctx.arc(px, py, part.radius, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }
    }

    if (prefs.reduceMotion) {
      drawFrame(0)
      return () => window.removeEventListener('resize', syncSize)
    }

    const loop = (now: number) => {
      const dtSec = Math.min(0.08, Math.max(0, (now - lastTs) / 1000))
      lastTs = now
      if (!document.hidden) {
        drawFrame(dtSec)
      }
      rafId = window.requestAnimationFrame(loop)
    }

    rafId = window.requestAnimationFrame(loop)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', syncSize)
    }
  }, [intensity, prefs.reduceMotion])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}
