import type { GameId } from '../domain/types'

export const IMPLEMENTED_GAME_IDS: ReadonlySet<GameId> = new Set<GameId>(['typing'])

export function isGameImplemented(gameId: GameId): boolean {
  return IMPLEMENTED_GAME_IDS.has(gameId)
}
