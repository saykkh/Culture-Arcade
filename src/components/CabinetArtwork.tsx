import { useEffect, useRef } from 'react'
import type { GameId } from '../domain/types'
import { useArcadePreferences } from '../lib/preferences'

/**
 * 로비 2x2 캐비닛 및 브리핑 대기 화면에 쓰이는 100% 풀블리드 60fps 실시간 미니 데모 스크린
 * - 기존 고정 비율 정지 SVG로 인해 생기던 좌우 검은 여백을 완전히 제거하고,
 *   각 게임의 캐릭터·배경·레이저·이펙트가 실제로 살아서 움직이는 Attract-Mode 데모를 렌더링합니다.
 */
export function CabinetArtwork({ gameId }: { gameId: GameId }) {
  const { prefs } = useArcadePreferences()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 640
    let h = 160
    let rafId = 0
    let lastTs = performance.now()
    let t = 0

    const drawScene = (dt: number) => {
      t += dt

      if (gameId === 'typing') {
        // 1) Cyber City Skyline + Digital Rain + Bot Shooting Laser at Falling Words
        const bg = ctx.createLinearGradient(0, 0, 0, h)
        bg.addColorStop(0, '#060c18')
        bg.addColorStop(0.72, '#0d1e34')
        bg.addColorStop(1, '#10283d')
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)

        // Two layers of city buildings with staggered window lights.
        ctx.fillStyle = '#11263d'
        for (let i = 0; i * 34 < w; i += 1) {
          const bh = 20 + ((i * 37) % 72)
          ctx.fillRect(i * 34, h - 26 - bh, 28, bh)
        }
        for (let i = 0; i * 44 < w; i += 1) {
          const bx = i * 44
          const bh = 28 + ((i * 29) % 48)
          ctx.fillStyle = '#172f4a'
          ctx.fillRect(bx, h - 26 - bh, 36, bh)
          for (let row = 6; row < bh - 6; row += 9) {
            ctx.fillStyle = Math.sin(t * 1.3 + i + row) > 0 ? '#2E7087' : '#244861'
            ctx.fillRect(bx + 6, h - 26 - bh + row, 8, 3)
            ctx.fillRect(bx + 20, h - 26 - bh + row, 8, 3)
          }
        }

        // Falling matrix rain streaks
        ctx.strokeStyle = 'rgba(67, 231, 242, 0.25)'
        ctx.lineWidth = 1.5
        for (let r = 0; r < 18; r += 1) {
          const rx = ((r * 41 + 17) % w)
          const ry = ((t * (95 + (r % 4) * 28) + r * 33) % (h - 20))
          ctx.beginPath()
          ctx.moveTo(rx, ry)
          ctx.lineTo(rx, ry + 14)
          ctx.stroke()
        }

        // 4 Animated Falling Phrase Capsules across full width
        const words = [
          { text: '고객 최우선', x: w * 0.16, speed: 34, offset: 0, color: '#43E7F2' },
          { text: '함께하여 더 큰 가치', x: w * 0.42, speed: 42, offset: 48, color: '#B9F66C' },
          { text: '원칙과 책임', x: w * 0.68, speed: 36, offset: 95, color: '#43E7F2' },
          { text: '실행과 전문성', x: w * 0.87, speed: 39, offset: 22, color: '#FFBD64' },
        ]
        const activeTargetIdx = Math.floor(t * 1.4) % words.length

        words.forEach((wd, idx) => {
          const wy = 18 + ((t * wd.speed + wd.offset) % (h - 68))
          const isTargeted = idx === activeTargetIdx
          ctx.font = '800 13px "Paperlogy", sans-serif'
          const pw = Math.min(w * 0.23, ctx.measureText(wd.text).width + 24)
          ctx.fillStyle = isTargeted ? 'rgba(20, 48, 40, 0.95)' : 'rgba(13, 25, 42, 0.92)'
          ctx.strokeStyle = isTargeted ? '#B9F66C' : wd.color
          ctx.lineWidth = isTargeted ? 2.4 : 1.5
          ctx.beginPath()
          ctx.roundRect(wd.x - pw / 2, wy - 13, pw, 26, 7)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = isTargeted ? '#B9F66C' : '#F2F6FB'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(wd.text, wd.x, wy, pw - 12)

          // Periodic laser beam & spark burst on targeted word!
          if (isTargeted && (t * 1.4) % 1 > 0.55) {
            ctx.save()
            ctx.strokeStyle = '#B9F66C'
            ctx.shadowColor = '#B9F66C'
            ctx.shadowBlur = 12
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.moveTo(w * 0.5, h - 18)
            ctx.lineTo(wd.x, wy + 10)
            ctx.stroke()
            ctx.beginPath()
            ctx.arc(wd.x, wy + 6, 12, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
          }
        })

        // Bottom Superconducting Console & Cyber Turret Bot
        ctx.fillStyle = '#0c1829'
        ctx.fillRect(0, h - 24, w, 24)
        ctx.strokeStyle = '#43E7F2'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(0, h - 24)
        ctx.lineTo(w, h - 24)
        ctx.stroke()

        ctx.fillStyle = '#43E7F2'
        ctx.beginPath()
        ctx.roundRect(w * 0.5 - 20, h - 37, 40, 24, 8)
        ctx.fill()
        ctx.fillStyle = '#102238'
        ctx.fillRect(w * 0.5 - 14, h - 32, 28, 10)
        ctx.fillStyle = '#B9F66C'
        ctx.fillRect(w * 0.5 - 10, h - 28, 6, 3)
        ctx.fillRect(w * 0.5 + 4, h - 28, 6, 3)
      } else if (gameId === 'snake') {
        // 2) Living Circuit-Board Reactor + Articulated Mecha-Dragon + Pulsing Word Orbs
        const bg = ctx.createLinearGradient(0, 0, w, h)
        bg.addColorStop(0, '#060f16')
        bg.addColorStop(1, '#0c1b26')
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)

        // Circuit grid + animated current pulses
        ctx.strokeStyle = 'rgba(185, 246, 108, 0.11)'
        ctx.lineWidth = 1
        for (let gx = 40; gx < w; gx += 48) {
          ctx.beginPath()
          ctx.moveTo(gx, 0)
          ctx.lineTo(gx, h)
          ctx.stroke()
        }
        for (let gy = 28; gy < h; gy += 34) {
          ctx.beginPath()
          ctx.moveTo(0, gy)
          ctx.lineTo(w, gy)
          ctx.stroke()
        }

        // Animated circuit current sparks
        ctx.fillStyle = '#43E7F2'
        for (let p = 0; p < 6; p += 1) {
          const px = ((t * 120 + p * 110) % w)
          const py = 28 + (p % 3) * 34
          ctx.fillRect(px, py - 1.5, 16, 3)
        }
        ctx.strokeStyle = '#38BBC250'
        for (let x = 20; x < w; x += 86) {
          const y = h * ((x % 3) * 0.3 + 0.14)
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + 22, y)
          ctx.lineTo(x + 38, y + 16)
          ctx.lineTo(x + 61, y + 16)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(x, y, 3, 0, Math.PI * 2)
          ctx.stroke()
        }

        // Slithering Mecha-Cable Dragon across the wide screen
        const cycle = (t % 5) / 5
        const headX = w * (0.32 + cycle * 0.52)
        const headY = h * 0.54 + Math.sin(cycle * Math.PI * 2) * h * 0.17

        ctx.save()
        ctx.strokeStyle = '#89E051'
        ctx.shadowColor = '#B9F66C'
        ctx.shadowBlur = 12
        ctx.globalAlpha = Math.min(1, cycle * 14, (1 - cycle) * 15)
        ctx.lineWidth = 18
        ctx.lineCap = 'round'
        ctx.beginPath()
        for (let seg = 0; seg <= 9; seg += 1) {
          const sx = headX - seg * 16
          const sy = h * 0.54 + Math.sin(cycle * Math.PI * 2 - seg * 0.3) * h * 0.17
          if (seg === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        }
        ctx.stroke()

        ctx.shadowBlur = 0
        for (let seg = 1; seg <= 9; seg += 1) {
          const sx = headX - seg * 16
          const sy = h * 0.54 + Math.sin(cycle * Math.PI * 2 - seg * 0.3) * h * 0.17
          ctx.fillStyle = seg % 2 ? '#C5FF8B' : '#61DCD7'
          ctx.beginPath()
          ctx.arc(sx, sy, 4.5, 0, Math.PI * 2)
          ctx.fill()
        }

        // Dragon horns, visor, and jaw
        ctx.fillStyle = '#43E7F2'
        ctx.beginPath()
        ctx.moveTo(headX - 10, headY - 6)
        ctx.lineTo(headX - 20, headY - 21)
        ctx.lineTo(headX + 4, headY - 10)
        ctx.fill()
        ctx.beginPath()
        ctx.roundRect(headX - 12, headY - 13, 28, 26, 9)
        ctx.fill()
        ctx.fillStyle = '#061019'
        ctx.beginPath()
        ctx.arc(headX + 8, headY - 5, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillRect(headX + 5, headY + 4, 13, cycle > 0.88 ? 5 : 2)
        ctx.restore()

        // Bobbing Holographic Word Capsules ahead
        const orbs = [
          { label: '1. 함께하여', x: w * 0.78, y: h * 0.36, c: '#B9F66C' },
          { label: '2. 더 큰 가치를', x: w * 0.83, y: h * 0.7, c: '#43E7F2' },
        ]
        orbs.forEach((orb, index) => {
          const oy = orb.y + Math.sin(t * 3.5 + orb.x) * 4
          if (index === 1 && cycle >= 0.88) {
            ctx.save()
            ctx.globalAlpha = (1 - cycle) / 0.12
            ctx.strokeStyle = orb.c
            ctx.beginPath()
            ctx.arc(orb.x - 30, h * 0.49, 12 + (cycle - 0.88) * 190, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
            return
          }
          ctx.strokeStyle = orb.c
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(orb.x - 54, oy, 9, 0, Math.PI * 2)
          ctx.stroke()

          ctx.fillStyle = 'rgba(12, 26, 36, 0.92)'
          ctx.beginPath()
          ctx.roundRect(orb.x - 38, oy - 13, 108, 26, 999)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = '#F2F6FB'
          ctx.font = '800 12.5px "Paperlogy", sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(orb.label, orb.x + 16, oy)
        })
      } else if (gameId === 'shooter') {
        // 3) Warp-Speed Starfield + 3 Hovering Drone Shields + Banking Twin-Wing Starfighter
        const bg = ctx.createLinearGradient(0, 0, 0, h)
        bg.addColorStop(0, '#050814')
        bg.addColorStop(1, '#121b34')
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)

        const nebulaX = w * (0.5 + Math.sin(t * 0.42) * 0.16)
        const nebula = ctx.createRadialGradient(nebulaX, h * 0.6, 0, nebulaX, h * 0.6, w * 0.62)
        nebula.addColorStop(0, '#734CB852')
        nebula.addColorStop(0.45, '#365EA941')
        nebula.addColorStop(1, '#0B122900')
        ctx.fillStyle = nebula
        ctx.fillRect(0, 0, w, h)

        ctx.fillStyle = '#9ADCF8'
        for (let s = 0; s < 28; s += 1) {
          const sx = (s * 59 + 13) % w
          const sy = (t * (70 + (s % 5) * 35) + s * 29) % h
          ctx.fillRect(sx, sy, 2, 5 + (s % 3) * 3)
        }

        const shipX = w * (0.5 + Math.sin(t * 1.8) * 0.3)
        const targets = [
          { x: w * 0.2, label: '[C] 고객 최우선', c: '#43E7F2' },
          { x: w * 0.5, label: '[O] 열린 협력', c: '#B9F66C' },
          { x: w * 0.8, label: '[R] 원칙과 책임', c: '#FFBD64' },
        ]

        targets.forEach((tg) => {
          const bobY = h * 0.23 + Math.sin(t * 3 + tg.x) * 4
          const podW = Math.min(148, w * 0.25)
          const locked = Math.abs(shipX - tg.x) < 52
          ctx.fillStyle = locked ? '#1a2f48' : '#101a2c'
          ctx.strokeStyle = tg.c
          ctx.lineWidth = locked ? 3 : 1.8
          ctx.beginPath()
          ctx.roundRect(tg.x - podW / 2, bobY - 18, podW, 38, 10)
          ctx.fill()
          ctx.stroke()
          ctx.save()
          ctx.translate(tg.x, bobY)
          ctx.rotate(Math.sin(t * 1.8 + tg.x) * 0.24)
          ctx.strokeStyle = `${tg.c}66`
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.ellipse(0, 0, podW * 0.56, 24, 0, Math.PI * 0.2, Math.PI * 0.92)
          ctx.stroke()
          ctx.restore()
          ctx.fillStyle = tg.c
          for (const side of [-1, 1]) {
            const thrusterX = tg.x + side * podW * 0.32
            ctx.beginPath()
            ctx.moveTo(thrusterX - 3, bobY + 19)
            ctx.lineTo(thrusterX, bobY + 24 + Math.sin(t * 18 + side) * 3)
            ctx.lineTo(thrusterX + 3, bobY + 19)
            ctx.fill()
          }

          ctx.fillStyle = locked ? tg.c : '#F2F6FB'
          ctx.font = '800 13.5px "Paperlogy", sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(tg.label, tg.x, bobY + 1, podW - 12)

          if (locked && (t * 3) % 1 > 0.45) {
            ctx.save()
            ctx.strokeStyle = '#B9F66C'
            ctx.shadowColor = '#B9F66C'
            ctx.shadowBlur = 14
            ctx.lineWidth = 4
            ctx.beginPath()
            ctx.moveTo(shipX, h - 30)
            ctx.lineTo(tg.x, bobY + 20)
            ctx.stroke()
            ctx.restore()
          }
        })

        // Twin-Wing Starfighter
        ctx.save()
        ctx.translate(shipX, h - 22)
        ctx.rotate(Math.cos(t * 1.8) * 0.18)
        ctx.fillStyle = '#FF6B9E'
        ctx.beginPath()
        ctx.moveTo(-6, 10)
        ctx.lineTo(0, 22)
        ctx.lineTo(6, 10)
        ctx.fill()

        ctx.fillStyle = '#43E7F2'
        ctx.beginPath()
        ctx.moveTo(0, -18)
        ctx.lineTo(-24, 10)
        ctx.lineTo(-22, -1)
        ctx.lineTo(-7, 6)
        ctx.lineTo(7, 6)
        ctx.lineTo(22, -1)
        ctx.lineTo(24, 10)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#123456'
        ctx.beginPath()
        ctx.ellipse(0, -1, 4, 8, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      } else if (gameId === 'runner') {
        // 4) 3D Neon City Highway + Gantry Arches + Caped Hoverboard Runner + Hyper Ring
        const sky = ctx.createLinearGradient(0, 0, 0, h * 0.42)
        sky.addColorStop(0, '#09071a')
        sky.addColorStop(1, '#291544')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h * 0.42)

        const hz = h * 0.42
        ctx.fillStyle = '#090f1d'
        ctx.fillRect(0, hz, w, h - hz)

        // Neon City Skyscrapers on Left & Right Horizon
        for (let b = 0; b < 7; b += 1) {
          const leftX = b * 28 + 10
          const rightX = w - b * 28 - 34
          const bh = 22 + ((b * 19) % 34)
          ctx.fillStyle = '#151e38'
          ctx.strokeStyle = b % 2 === 0 ? 'rgba(67,231,242,0.4)' : 'rgba(255,107,158,0.4)'
          ctx.lineWidth = 1
          ctx.fillRect(leftX, hz - bh, 22, bh)
          ctx.strokeRect(leftX, hz - bh, 22, bh)
          ctx.fillRect(rightX, hz - bh, 22, bh)
          ctx.strokeRect(rightX, hz - bh, 22, bh)
          ctx.fillStyle = b % 2 === 0 ? '#26607A' : '#593656'
          for (let row = 6; row < bh; row += 9) {
            ctx.fillRect(leftX + 5, hz - bh + row, 12, 2)
            ctx.fillRect(rightX + 5, hz - bh + row, 12, 2)
          }
        }

        // 3D Perspective Highway
        ctx.fillStyle = '#132038'
        ctx.beginPath()
        ctx.moveTo(w * 0.4, hz)
        ctx.lineTo(w * 0.6, hz)
        ctx.lineTo(w * 0.88, h)
        ctx.lineTo(w * 0.12, h)
        ctx.closePath()
        ctx.fill()

        ctx.strokeStyle = '#FF6B9E'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(w * 0.4, hz)
        ctx.lineTo(w * 0.12, h)
        ctx.moveTo(w * 0.6, hz)
        ctx.lineTo(w * 0.88, h)
        ctx.stroke()

        // Scrolling perspective road stripes
        const phase = (t * 2.2) % 1
        ctx.strokeStyle = 'rgba(67, 231, 242, 0.35)'
        ctx.lineWidth = 1.5
        for (let r = 0; r < 5; r += 1) {
          const p = Math.pow((r + phase) / 5, 1.8)
          const ry = hz + p * (h - hz)
          const hw = w * (0.1 + p * 0.28)
          ctx.beginPath()
          ctx.moveTo(w * 0.5 - hw, ry)
          ctx.lineTo(w * 0.5 + hw, ry)
          ctx.stroke()
        }

        // The obstacle reaches the runner first, followed by the hyper ring.
        const obstacle = (t * 0.6 + 0.38) % 1
        const ring = (t * 0.6 + 0.02) % 1
        const runnerX = w * 0.5
        const laneDepth = (progress: number) => hz + progress * (h - hz - 5)

        const gantryDepth = (t * 0.55) % 1
        const gantryY = laneDepth(gantryDepth)
        const gantryHalf = w * (0.1 + gantryDepth * 0.28)
        const gantryHeight = 12 + gantryDepth * 55
        ctx.strokeStyle = 'rgba(67, 231, 242, 0.55)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(runnerX - gantryHalf, gantryY)
        ctx.lineTo(runnerX - gantryHalf * 0.85, gantryY - gantryHeight)
        ctx.lineTo(runnerX + gantryHalf * 0.85, gantryY - gantryHeight)
        ctx.lineTo(runnerX + gantryHalf, gantryY)
        ctx.stroke()

        ctx.strokeStyle = '#FF6B9E'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.ellipse(runnerX, laneDepth(ring) - 9, 7 + ring * 31, 8 + ring * 30, 0, 0, Math.PI * 2)
        ctx.stroke()

        ctx.textAlign = 'center'
        ctx.fillStyle = '#FFE047'
        ctx.font = `${Math.round(8 + obstacle * 17)}px "Paperlogy", sans-serif`
        ctx.fillText('🍌', runnerX, laneDepth(obstacle))

        // Caped Hoverboard Runner hopping dynamically!
        const jumpProgress = Math.max(0, (obstacle - 0.45) / 0.55)
        const jumpOffset = Math.sin(jumpProgress * Math.PI) * 27
        const ry = h - 22 - jumpOffset

        // Flowing Neon Cape
        ctx.fillStyle = '#FF6B9E'
        ctx.beginPath()
        ctx.moveTo(runnerX - 10, ry - 18)
        ctx.lineTo(runnerX + 10, ry - 18)
        ctx.lineTo(runnerX + 16 + Math.sin(t * 9) * 5, ry + 6)
        ctx.lineTo(runnerX - 16 + Math.sin(t * 9) * 5, ry + 6)
        ctx.closePath()
        ctx.fill()

        // Hoverboard + Helmet
        ctx.fillStyle = '#721E62'
        ctx.beginPath()
        ctx.moveTo(runnerX - 11, ry + 9)
        ctx.lineTo(runnerX, ry + 16 + Math.sin(t * 19) * 3)
        ctx.lineTo(runnerX + 11, ry + 9)
        ctx.fill()
        ctx.fillStyle = '#43E7F2'
        ctx.beginPath()
        ctx.ellipse(runnerX, ry + 8, 18, 5, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#F2F6FB'
        ctx.beginPath()
        ctx.arc(runnerX, ry - 24, 9, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#182748'
        ctx.beginPath()
        ctx.roundRect(runnerX - 7, ry - 28, 14, 6, 3)
        ctx.fill()
      }
    }

    const syncSize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      if (!width || !height) return
      const density = Math.min(window.devicePixelRatio, 2)
      canvas.width = Math.round(width * density)
      canvas.height = Math.round(height * density)
      w = Math.max(480, Math.round(160 * (width / height)))
      h = Math.max(160, Math.min(420, Math.round(w * (height / width))))
      ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0)
      drawScene(0)
    }

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs) / 1000)
      lastTs = now
      if (!document.hidden) {
        drawScene(dt)
      }
      rafId = window.requestAnimationFrame(loop)
    }

    t = 0.55
    syncSize()
    const resizeObserver = new ResizeObserver(syncSize)
    resizeObserver.observe(canvas)
    if (!prefs.reduceMotion) rafId = window.requestAnimationFrame(loop)
    return () => {
      window.cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
    }
  }, [gameId, prefs.reduceMotion])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    />
  )
}
