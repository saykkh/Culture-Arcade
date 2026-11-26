import { GAME_CATALOG, REQUIRED_GAME_ORDER } from './rules'
import type {
  GameId,
  ParticipantProgressRecord,
  RecommendationBanner,
  RequiredGameId,
} from './types'

export function computeLobbyRecommendation(
  progressByGame: Partial<Record<GameId, ParticipantProgressRecord>>,
): RecommendationBanner {
  const clearedRequired = REQUIRED_GAME_ORDER.filter(
    (gid) => Boolean(progressByGame[gid]?.firstClearedAt),
  )
  const clearedCount = clearedRequired.length

  if (clearedCount === REQUIRED_GAME_ORDER.length) {
    return {
      targetGameId: null,
      kind: 'all_completed',
      headline: '완료 기록 보기',
      subline: '필수 5/5 완료 · 온보딩 배지와 간판 전체 점등 달성',
    }
  }

  // Find most recently started required game
  let latestGameId: RequiredGameId | null = null
  let latestStartedMs = -1
  for (const gid of REQUIRED_GAME_ORDER) {
    const startedAt = progressByGame[gid]?.lastStartedAt
    if (startedAt) {
      const ms = Date.parse(startedAt)
      if (!Number.isNaN(ms) && ms > latestStartedMs) {
        latestStartedMs = ms
        latestGameId = gid
      }
    }
  }

  if (!latestGameId) {
    return {
      targetGameId: 'typing',
      kind: 'first_visit',
      headline: '첫 판 추천 · 산성비 타자',
      subline: '모든 게임이 열려 있습니다 · 짧은 공식 표현부터 가볍게 시작해 보세요',
    }
  }

  const latestProgress = progressByGame[latestGameId]
  if (!latestProgress?.firstClearedAt) {
    const gameTitle = GAME_CATALOG[latestGameId].title
    return {
      targetGameId: latestGameId,
      kind: 'resume_uncleared',
      headline: `이어서 도전 · ${gameTitle}`,
      subline: `필수 ${clearedCount}/5 완료 · 이번 판은 처음부터 시작`,
    }
  }

  const nextUncleared =
    REQUIRED_GAME_ORDER.find((gid) => !progressByGame[gid]?.firstClearedAt) ?? 'typing'
  return {
    targetGameId: nextUncleared,
    kind: 'next_uncleared',
    headline: `다음 추천 · ${GAME_CATALOG[nextUncleared].title}`,
    subline: `필수 ${clearedCount}/5 완료 · 남은 케이블을 연결해 간판을 완성하세요`,
  }
}
