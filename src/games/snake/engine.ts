import { mulberry32 } from '../../../content'

export const SNAKE_GRID_COLS = 16
export const SNAKE_GRID_ROWS = 10

export type GridDirection = 'up' | 'down' | 'left' | 'right'

export interface GridPoint {
  x: number
  y: number
}

export interface CandidateChunkOnGrid {
  id: string
  x: number
  y: number
  text: string
  isCorrect: boolean
}

export const DIRECTION_DELTAS: Record<GridDirection, GridPoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

export function isOppositeDirection(a: GridDirection, b: GridDirection): boolean {
  return (
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  )
}

export function pointKey(p: GridPoint): string {
  return `${p.x},${p.y}`
}

export function isInsideGrid(p: GridPoint): boolean {
  return p.x >= 0 && p.x < SNAKE_GRID_COLS && p.y >= 0 && p.y < SNAKE_GRID_ROWS
}

/**
 * 뱀 머리에서 목표 칸까지 몸통 및 다른 후보 칸을 밟지 않고 도달 가능한지 BFS로 확인한다.
 */
export function isTargetReachable(
  head: GridPoint,
  target: GridPoint,
  blockedKeys: ReadonlySet<string>,
): boolean {
  const targetK = pointKey(target)
  const visited = new Set<string>([pointKey(head)])
  const queue: GridPoint[] = [head]

  while (queue.length > 0) {
    const curr = queue.shift()!
    if (curr.x === target.x && curr.y === target.y) {
      return true
    }
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const next = {
        x: curr.x + DIRECTION_DELTAS[dir].x,
        y: curr.y + DIRECTION_DELTAS[dir].y,
      }
      if (!isInsideGrid(next)) continue
      const k = pointKey(next)
      if (visited.has(k)) continue
      if (k !== targetK && blockedKeys.has(k)) continue
      visited.add(k)
      queue.push(next)
    }
  }
  return false
}

/**
 * 충돌 후 안전한 중앙 행 위치에서 뱀 몸통(길이 유지, 최대 6칸으로 접어 배치)을 생성한다.
 */
export function createSafeSnakeBody(length: number): {
  body: GridPoint[]
  direction: GridDirection
} {
  const safeLen = Math.min(Math.max(3, length), 6)
  const headX = 6
  const headY = Math.floor(SNAKE_GRID_ROWS / 2)
  const body: GridPoint[] = []
  for (let i = 0; i < safeLen; i += 1) {
    body.push({ x: headX - i, y: headY })
  }
  return { body, direction: 'right' }
}

/**
 * 정답 조각 1개와 오답 조각 2개(연습 모드일 때는 정답 1개만 가능)를 격자 빈 칸에 배치하되,
 * 정답 조각까지 뱀 머리에서 실제로 이동 가능한지 BFS로 검증한다.
 */
export function spawnCandidateChunks(params: {
  snakeBody: readonly GridPoint[]
  correctText: string
  distractors: readonly string[]
  seed: number
}): CandidateChunkOnGrid[] {
  const { snakeBody, correctText, distractors, seed } = params
  const head = snakeBody[0]!
  const bodySet = new Set(snakeBody.map(pointKey))
  const rng = mulberry32(seed)

  // Candidate cells at least Manhattan distance 3 from head (fallback >= 2 if crowded)
  const collectFreeCells = (minDist: number): GridPoint[] => {
    const cells: GridPoint[] = []
    for (let y = 1; y < SNAKE_GRID_ROWS - 1; y += 1) {
      for (let x = 1; x < SNAKE_GRID_COLS - 1; x += 1) {
        const p = { x, y }
        if (bodySet.has(pointKey(p))) continue
        const dist = Math.abs(x - head.x) + Math.abs(y - head.y)
        if (dist >= minDist) {
          cells.push(p)
        }
      }
    }
    return cells
  }

  let pool = collectFreeCells(3)
  if (pool.length < 1 + distractors.length) {
    pool = collectFreeCells(1)
  }

  // Deterministic shuffle of free cells
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = pool[i]!
    pool[i] = pool[j]!
    pool[j] = tmp
  }

  // Pick a reachable cell for the correct chunk first
  let correctCell = pool.find((cell) => isTargetReachable(head, cell, bodySet)) ?? pool[0]!
  if (!correctCell) {
    correctCell = { x: SNAKE_GRID_COLS - 3, y: 2 }
  }

  const chosen: CandidateChunkOnGrid[] = [
    {
      id: 'cand-correct',
      x: correctCell.x,
      y: correctCell.y,
      text: correctText,
      isCorrect: true,
    },
  ]

  const occupied = new Set<string>([...bodySet, pointKey(correctCell)])

  for (let i = 0; i < distractors.length; i += 1) {
    const text = distractors[i]!
    // Ensure placing this distractor keeps the correct chunk reachable AND spaced out
    const cell = pool.find((candidate) => {
      const k = pointKey(candidate)
      if (occupied.has(k)) return false
      const distFromOthers = chosen.every(
        (existing) => Math.abs(existing.x - candidate.x) + Math.abs(existing.y - candidate.y) >= 3,
      )
      if (!distFromOthers) return false
      const nextBlocked = new Set<string>([...occupied, k])
      return isTargetReachable(head, correctCell, nextBlocked)
    }) ??
      pool.find((candidate) => {
        const k = pointKey(candidate)
        if (occupied.has(k)) return false
        const nextBlocked = new Set<string>([...occupied, k])
        return isTargetReachable(head, correctCell, nextBlocked)
      })

    if (cell) {
      occupied.add(pointKey(cell))
      chosen.push({
        id: `cand-dist-${i}`,
        x: cell.x,
        y: cell.y,
        text,
        isCorrect: false,
      })
    }
  }

  return chosen
}
