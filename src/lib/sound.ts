import { getArcadePreferences } from './preferences'

export type ArcadeSfxName = 'select' | 'start' | 'score' | 'clear' | 'wrong'

let audioCtx: AudioContext | null = null
let userInteracted = false

if (typeof window !== 'undefined') {
  const unlock = () => {
    userInteracted = true
    if (audioCtx && audioCtx.state === 'suspended') {
      void audioCtx.resume()
    }
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock, { passive: true })
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || !userInteracted) return null
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    audioCtx = new Ctor()
  }
  return audioCtx
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startOffsetSec: number,
  durationSec: number,
  type: OscillatorType = 'triangle',
  gainPeak: number = 0.08,
): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffsetSec)
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + startOffsetSec)
  gain.gain.exponentialRampToValueAtTime(gainPeak, ctx.currentTime + startOffsetSec + 0.012)
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    ctx.currentTime + startOffsetSec + durationSec,
  )
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(ctx.currentTime + startOffsetSec)
  osc.stop(ctx.currentTime + startOffsetSec + durationSec + 0.01)
}

export function playArcadeSfx(name: ArcadeSfxName): void {
  if (getArcadePreferences().muted) return
  const ctx = getAudioContext()
  if (!ctx) return

  switch (name) {
    case 'select':
      playTone(ctx, 520, 0, 0.055, 'sine', 0.05)
      break
    case 'start':
      playTone(ctx, 440, 0, 0.07, 'triangle', 0.08)
      playTone(ctx, 660, 0.065, 0.11, 'triangle', 0.09)
      break
    case 'score':
      playTone(ctx, 698, 0, 0.06, 'triangle', 0.075)
      playTone(ctx, 932, 0.05, 0.08, 'triangle', 0.075)
      break
    case 'clear':
      playTone(ctx, 523.25, 0, 0.08, 'triangle', 0.09)
      playTone(ctx, 659.25, 0.08, 0.08, 'triangle', 0.09)
      playTone(ctx, 783.99, 0.16, 0.09, 'triangle', 0.09)
      playTone(ctx, 1046.5, 0.25, 0.2, 'triangle', 0.1)
      break
    case 'wrong':
      playTone(ctx, 220, 0, 0.11, 'sawtooth', 0.045)
      break
  }
}
