import { GAME_CATALOG, REQUIRED_GAME_ORDER } from './rules.js'
import type {
  GameId,
  ParticipantProgressRecord,
  RecommendationBanner,
  RequiredGameId,
} from './types.js'

export function computeLobbyRecommendation(
  progressByGame: Partial<Record<GameId, ParticipantProgressRecord>>,
): RecommendationBanner {
  const totalRequired = REQUIRED_GAME_ORDER.length
  const clearedRequired = REQUIRED_GAME_ORDER.filter(
    (gid) => Boolean(progressByGame[gid]?.firstClearedAt),
  )
  const clearedCount = clearedRequired.length

  if (clearedCount === totalRequired) {
    return {
      targetGameId: null,
      kind: 'all_completed',
      headline: '완료 기록 보기',
      subline: `필수 ${totalRequired}/${totalRequired} 완료 · 온보딩 배지와 간판 전체 점등 달성!`,
    }
  }

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
      subline: '4종 오락기가 모두 열려 있습니다 · 각 게임에서 10점 이상 달성하면 통과됩니다!',
    }
  }

  const latestProgress = progressByGame[latestGameId]
  if (!latestProgress?.firstClearedAt) {
    const gameTitle = GAME_CATALOG[latestGameId].title
    return {
      targetGameId: latestGameId,
      kind: 'resume_uncleared',
      headline: `이어서 도전 · ${gameTitle}`,
      subline: `필수 ${clearedCount}/${totalRequired} 완료 · 이번 판은 처음부터 시작 (10점 달성 시 통과)`,
    }
  }

  const nextUncleared =
    REQUIRED_GAME_ORDER.find((gid) => !progressByGame[gid]?.firstClearedAt) ?? 'typing'
  return {
    targetGameId: nextUncleared,
    kind: 'next_uncleared',
    headline: `다음 추천 · ${GAME_CATALOG[nextUncleared].title}`,
    subline: `필수 ${clearedCount}/${totalRequired} 완료 · 남은 케이블을 연결해 간판을 완성하세요!`,
  }
}
