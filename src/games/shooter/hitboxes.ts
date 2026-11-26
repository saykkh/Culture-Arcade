export interface TargetHitbox {
  lane: 0 | 1 | 2
  centerX: number
  minX: number
  maxX: number
}

export const TARGET_HITBOXES: readonly TargetHitbox[] = [
  { lane: 0, centerX: 0.18, minX: 0.06, maxX: 0.30 },
  { lane: 1, centerX: 0.50, minX: 0.38, maxX: 0.62 },
  { lane: 2, centerX: 0.82, minX: 0.70, maxX: 0.94 },
] as const

export function findHitTargetLane(shipX: number): 0 | 1 | 2 | null {
  for (const box of TARGET_HITBOXES) {
    if (shipX >= box.minX && shipX <= box.maxX) {
      return box.lane
    }
  }
  return null
}
