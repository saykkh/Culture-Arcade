import { getArcadePreferences } from './preferences'

export type ArcadeSfxName =
  | 'select'
  | 'start'
  | 'score'
  | 'clear'
  | 'wrong'
  | 'boost'
  | 'slip'
  | 'jump'
  | 'stun'
  | 'shield'

export type ArcadeBgmTrack =
  | 'none'
  | 'landing'
  | 'lobby'
  | 'typing'
  | 'snake'
  | 'shooter'
  | 'runner'

interface TrackPattern {
  bpm: number
  leadWave: OscillatorType
  bassWave: OscillatorType
  leadGain: number
  bassGain: number
  // MIDI note numbers (0 = rest) for 16 steps
  leadNotes: readonly number[]
  bassNotes: readonly number[]
  hihatPattern: readonly number[]
}

const TRACK_PATTERNS: Record<Exclude<ArcadeBgmTrack, 'none'>, TrackPattern> = {
  // Bright welcoming 8-bit attract-mode arcade theme on Landing page
  landing: {
    bpm: 132,
    leadWave: 'square',
    bassWave: 'triangle',
    leadGain: 0.028,
    bassGain: 0.045,
    leadNotes: [72, 76, 79, 84, 79, 76, 72, 0, 74, 77, 81, 86, 84, 79, 76, 74],
    bassNotes: [48, 0, 48, 55, 53, 0, 53, 60, 50, 0, 50, 57, 55, 0, 43, 47],
    hihatPattern: [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
  },
  // Funky neon arcade lounge groove in Lobby & Leaderboard
  lobby: {
    bpm: 122,
    leadWave: 'triangle',
    bassWave: 'triangle',
    leadGain: 0.032,
    bassGain: 0.048,
    leadNotes: [76, 0, 79, 81, 79, 76, 72, 74, 76, 0, 84, 83, 79, 76, 74, 0],
    bassNotes: [45, 45, 0, 52, 48, 48, 0, 55, 53, 53, 0, 60, 55, 0, 50, 52],
    hihatPattern: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
  },
  // Focused rhythmic cyber-rain synth pulse for Acid Rain Typing
  typing: {
    bpm: 128,
    leadWave: 'sine',
    bassWave: 'triangle',
    leadGain: 0.03,
    bassGain: 0.044,
    leadNotes: [79, 76, 72, 76, 81, 77, 72, 77, 83, 79, 74, 79, 84, 79, 76, 72],
    bassNotes: [48, 48, 60, 48, 53, 53, 65, 53, 55, 55, 67, 55, 48, 55, 60, 55],
    hihatPattern: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  // Playful bouncy chiptune hop for Word Snake
  snake: {
    bpm: 136,
    leadWave: 'square',
    bassWave: 'triangle',
    leadGain: 0.025,
    bassGain: 0.046,
    leadNotes: [72, 0, 76, 0, 79, 81, 79, 0, 77, 0, 74, 0, 76, 79, 72, 0],
    bassNotes: [48, 55, 52, 55, 48, 55, 52, 55, 50, 57, 53, 57, 48, 55, 48, 0],
    hihatPattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0],
  },
  // Heroic galactic space-shooter arpeggio for Value Target Shooter
  shooter: {
    bpm: 138,
    leadWave: 'sawtooth',
    bassWave: 'square',
    leadGain: 0.022,
    bassGain: 0.034,
    leadNotes: [69, 76, 81, 76, 72, 79, 84, 79, 74, 81, 86, 81, 76, 83, 88, 83],
    bassNotes: [45, 45, 45, 57, 48, 48, 48, 60, 50, 50, 50, 62, 52, 52, 40, 52],
    hihatPattern: [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
  },
  // Energetic 146 BPM Mario-Kart / Sonic style turbo dash theme for C.O.R.E. Booster Run!
  runner: {
    bpm: 146,
    leadWave: 'square',
    bassWave: 'triangle',
    leadGain: 0.027,
    bassGain: 0.048,
    leadNotes: [76, 79, 84, 88, 86, 84, 79, 0, 77, 81, 86, 89, 88, 84, 79, 76],
    bassNotes: [48, 60, 48, 60, 52, 64, 52, 64, 53, 65, 53, 65, 55, 67, 43, 55],
    hihatPattern: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  },
}

let audioCtx: AudioContext | null = null
let userInteracted = false
let desiredBgmTrack: ArcadeBgmTrack = 'none'
let bgmTimerId: number | null = null
let bgmStepIndex = 0
let noiseBuffer: AudioBuffer | null = null

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    audioCtx = new Ctor()
  }
  return audioCtx
}

function ensureNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer
  const length = Math.floor(ctx.sampleRate * 0.05)
  const buf = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1
  }
  noiseBuffer = buf
  return buf
}

function stopBgmTimer(): void {
  if (bgmTimerId !== null && typeof window !== 'undefined') {
    window.clearInterval(bgmTimerId)
    bgmTimerId = null
  }
}

function scheduleBgmStep(): void {
  if (desiredBgmTrack === 'none') {
    stopBgmTimer()
    return
  }
  const prefs = getArcadePreferences()
  if (prefs.muted || prefs.bgmMuted || (typeof document !== 'undefined' && document.hidden)) {
    return
  }
  if (!userInteracted) return

  const ctx = getAudioContext()
  if (!ctx || ctx.state !== 'running') return

  const pat = TRACK_PATTERNS[desiredBgmTrack]
  const stepSec = 60 / pat.bpm / 4 // 16th-note step
  const idx = bgmStepIndex % 16
  bgmStepIndex = (bgmStepIndex + 1) % 16

  const leadMidi = pat.leadNotes[idx] ?? 0
  if (leadMidi > 0) {
    playTone(ctx, midiToFreq(leadMidi), 0, stepSec * 0.82, pat.leadWave, pat.leadGain)
  }

  const bassMidi = pat.bassNotes[idx] ?? 0
  if (bassMidi > 0) {
    playTone(ctx, midiToFreq(bassMidi), 0, stepSec * 0.9, pat.bassWave, pat.bassGain)
  }

  if (pat.hihatPattern[idx]) {
    const src = ctx.createBufferSource()
    src.buffer = ensureNoiseBuffer(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.setValueAtTime(6500, ctx.currentTime)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.012, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.032)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    src.start(ctx.currentTime)
    src.stop(ctx.currentTime + 0.035)
  }
}

function restartBgmLoop(): void {
  stopBgmTimer()
  if (typeof window === 'undefined' || desiredBgmTrack === 'none') return
  const pat = TRACK_PATTERNS[desiredBgmTrack]
  const stepMs = Math.round((60 / pat.bpm / 4) * 1000)
  bgmStepIndex = 0
  bgmTimerId = window.setInterval(scheduleBgmStep, stepMs)
}

export function setArcadeBgmTrack(track: ArcadeBgmTrack): void {
  if (desiredBgmTrack === track && bgmTimerId !== null) return
  desiredBgmTrack = track
  if (track === 'none') {
    stopBgmTimer()
    return
  }
  // Attempt eager start if browser already allows audio
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'running') {
    userInteracted = true
  }
  restartBgmLoop()
}

export function refreshArcadeAudioState(): void {
  const prefs = getArcadePreferences()
  if (prefs.muted || prefs.bgmMuted || desiredBgmTrack === 'none') {
    return
  }
  if (bgmTimerId === null) {
    restartBgmLoop()
  }
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    userInteracted = true
    const ctx = getAudioContext()
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().then(() => {
        if (desiredBgmTrack !== 'none' && bgmTimerId === null) {
          restartBgmLoop()
        }
      })
    } else if (desiredBgmTrack !== 'none' && bgmTimerId === null) {
      restartBgmLoop()
    }
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock, { passive: true })
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
  gain.gain.exponentialRampToValueAtTime(gainPeak, ctx.currentTime + startOffsetSec + 0.01)
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    ctx.currentTime + startOffsetSec + durationSec,
  )
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(ctx.currentTime + startOffsetSec)
  osc.stop(ctx.currentTime + startOffsetSec + durationSec + 0.012)
}

export function playArcadeSfx(name: ArcadeSfxName): void {
  if (getArcadePreferences().muted) return
  if (!userInteracted) return
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    void ctx.resume()
  }

  switch (name) {
    case 'select':
      playTone(ctx, 560, 0, 0.055, 'sine', 0.055)
      break
    case 'start':
      playTone(ctx, 440, 0, 0.07, 'triangle', 0.085)
      playTone(ctx, 660, 0.065, 0.11, 'triangle', 0.095)
      break
    case 'score':
      playTone(ctx, 740, 0, 0.055, 'triangle', 0.085)
      playTone(ctx, 987.77, 0.05, 0.085, 'triangle', 0.085)
      break
    case 'clear':
      playTone(ctx, 523.25, 0, 0.08, 'triangle', 0.095)
      playTone(ctx, 659.25, 0.08, 0.08, 'triangle', 0.095)
      playTone(ctx, 783.99, 0.16, 0.09, 'triangle', 0.095)
      playTone(ctx, 1046.5, 0.25, 0.22, 'triangle', 0.105)
      break
    case 'wrong':
      playTone(ctx, 210, 0, 0.12, 'sawtooth', 0.05)
      break
    case 'boost':
      playTone(ctx, 587.33, 0, 0.06, 'square', 0.075)
      playTone(ctx, 880, 0.05, 0.07, 'square', 0.08)
      playTone(ctx, 1174.66, 0.1, 0.12, 'triangle', 0.09)
      break
    case 'slip':
      playTone(ctx, 420, 0, 0.06, 'sawtooth', 0.06)
      playTone(ctx, 290, 0.055, 0.07, 'sawtooth', 0.06)
      playTone(ctx, 185, 0.11, 0.11, 'sawtooth', 0.06)
      break
    case 'jump':
      playTone(ctx, 360, 0, 0.05, 'triangle', 0.07)
      playTone(ctx, 560, 0.04, 0.08, 'triangle', 0.075)
      break
    case 'stun':
      playTone(ctx, 165, 0, 0.09, 'square', 0.075)
      playTone(ctx, 120, 0.08, 0.14, 'sawtooth', 0.075)
      break
    case 'shield':
      playTone(ctx, 660, 0, 0.06, 'sine', 0.08)
      playTone(ctx, 990, 0.05, 0.1, 'triangle', 0.085)
      break
  }
}
