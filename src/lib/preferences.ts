import { useCallback, useSyncExternalStore } from 'react'

export interface ArcadePreferences {
  muted: boolean
  bgmMuted: boolean
  reduceMotion: boolean
}

const PREFS_STORAGE_KEY = 'ls-way-arcade:prefs:v04'

const DEFAULT_PREFS: ArcadePreferences = {
  muted: false,
  bgmMuted: false,
  reduceMotion: false,
}

let cachedPrefs: ArcadePreferences | null = null
const listeners = new Set<() => void>()

export function getArcadePreferences(): ArcadePreferences {
  if (cachedPrefs) return cachedPrefs
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY)
    if (!raw) {
      cachedPrefs = DEFAULT_PREFS
      return cachedPrefs
    }
    const parsed = JSON.parse(raw) as Partial<ArcadePreferences>
    cachedPrefs = {
      muted: Boolean(parsed.muted),
      bgmMuted: Boolean(parsed.bgmMuted),
      reduceMotion: Boolean(parsed.reduceMotion),
    }
    return cachedPrefs
  } catch {
    cachedPrefs = DEFAULT_PREFS
    return cachedPrefs
  }
}

export function updateArcadePreferences(patch: Partial<ArcadePreferences>): ArcadePreferences {
  const current = getArcadePreferences()
  const next: ArcadePreferences = { ...current, ...patch }
  cachedPrefs = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Ignore storage quota issues
    }
  }
  listeners.forEach((fn) => fn())
  return next
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useArcadePreferences() {
  const prefs = useSyncExternalStore(subscribe, getArcadePreferences, () => DEFAULT_PREFS)
  const toggleMuted = useCallback(() => {
    const nextMuted = !getArcadePreferences().muted
    updateArcadePreferences({ muted: nextMuted })
  }, [])
  const toggleBgmMuted = useCallback(() => {
    updateArcadePreferences({ bgmMuted: !getArcadePreferences().bgmMuted })
  }, [])
  const toggleReduceMotion = useCallback(() => {
    updateArcadePreferences({ reduceMotion: !getArcadePreferences().reduceMotion })
  }, [])
  return { prefs, toggleMuted, toggleBgmMuted, toggleReduceMotion }
}
