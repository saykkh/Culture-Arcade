import { useSyncExternalStore } from 'react'

const compactQuery = '(max-width: 700px)'

function subscribeToLayout(onChange: () => void) {
  const query = window.matchMedia(compactQuery)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export function useCompactGameLayout() {
  return useSyncExternalStore(subscribeToLayout, () => window.matchMedia(compactQuery).matches, () => false)
}
