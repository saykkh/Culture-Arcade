import { mulberry32 } from '../../../content/index.js'

export const SNAKE_GRID_COLS = 20
export const SNAKE_GRID_ROWS = 12

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
  badgeIndex: number
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

export function createSafeSnakeBody(length: number): {
  body: GridPoint[]
  direction: GridDirection
} {
  const safeLen = Math.min(Math.max(3, length), 7)
  const headX = 8
  const headY = Math.floor(SNAKE_GRID_ROWS / 2)
  const body: GridPoint[] = []
  for (let i = 0; i < safeLen; i += 1) {
    body.push({ x: headX - i, y: headY })
  }
  return { body, direction: 'right' }
}

/**
 * 넓은 20x12 격자에서 단어 캡슐이 벽이나 서로에게 답답하게 붙지 않도록
 * 여백(x: 2..17, y: 1..10)과 후보 간 거리(>= 5칸)를 두고 BFS 도달성을 보장해 배치한다.
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

  const collectFreeCells = (minDistFromHead: number, padX: number): GridPoint[] => {
    const cells: GridPoint[] = []
    for (let y = 1; y < SNAKE_GRID_ROWS - 1; y += 1) {
      for (let x = padX; x < SNAKE_GRID_COLS - padX; x += 1) {
        const p = { x, y }
        if (bodySet.has(pointKey(p))) continue
        if (Math.abs(x - head.x) + Math.abs(y - head.y) >= minDistFromHead) {
          cells.push(p)
        }
      }
    }
    return cells
  }

  let pool = collectFreeCells(4, 2)
  if (pool.length < 1 + distractors.length) {
    pool = collectFreeCells(2, 1)
  }

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = pool[i]!
    pool[i] = pool[j]!
    pool[j] = tmp
  }

  let correctCell = pool.find((cell) => isTargetReachable(head, cell, bodySet)) ?? pool[0]!
  if (!correctCell) {
    correctCell = { x: SNAKE_GRID_COLS - 4, y: 3 }
  }

  const rawItems: Array<{ x: number; y: number; text: string; isCorrect: boolean; id: string }> = [
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
    const cell =
      pool.find((candidate) => {
        const k = pointKey(candidate)
        if (occupied.has(k)) return false
        const wellSpaced = rawItems.every(
          (existing) =>
            Math.abs(existing.x - candidate.x) >= 4 ||
            Math.abs(existing.y - candidate.y) >= 3,
        )
        if (!wellSpaced) return false
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
      rawItems.push({
        id: `cand-dist-${i}`,
        x: cell.x,
        y: cell.y,
        text,
        isCorrect: false,
      })
    }
  }

  // Sort left-to-right for visual badge numbering ① ② ③ so badge number never leaks which is correct!
  rawItems.sort((a, b) => a.x - b.x || a.y - b.y)
  return rawItems.map((item, idx) => ({
    ...item,
    badgeIndex: idx + 1,
  }))
}
