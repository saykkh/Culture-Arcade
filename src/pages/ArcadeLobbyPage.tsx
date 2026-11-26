import { useEffect, useState } from 'react'
import { ArcadeHeader } from '../components/ArcadeHeader'
import { CabinetArtwork } from '../components/CabinetArtwork'
import { ALL_GAME_IDS, GAME_CATALOG } from '../domain/rules'
import type { GameId } from '../domain/types'
import {
  arcadeApi,
  clearPendingSubmission,
  loadPendingSubmission,
  type ParticipantMeResponse,
  type PendingRunSubmission,
} from '../lib/api'
import { playArcadeSfx } from '../lib/sound'

interface ArcadeLobbyPageProps {
  me: ParticipantMeResponse
  justLitGameId: string | null
  onRefreshMe: () => Promise<void>
  onNavigate: (path: string) => void
  onLogout: () => Promise<void>
}

export function ArcadeLobbyPage({
  me,
  justLitGameId,
  onRefreshMe,
  onNavigate,
  onLogout,
}: ArcadeLobbyPageProps) {
  const initialFocus: GameId = me.recommendation.targetGameId ?? 'typing'
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = ALL_GAME_IDS.indexOf(initialFocus)
    return idx >= 0 ? idx : 0
  })
  const [pendingRetry, setPendingRetry] = useState<PendingRunSubmission | null>(() =>
    loadPendingSubmission(me.participantId),
  )
  const [retryingPending, setRetryingPending] = useState(false)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [showBadgeSummary, setShowBadgeSummary] = useState(false)

  // Keyboard navigation across 3 cols x 2 rows
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Escape' && showBadgeSummary) {
        e.preventDefault()
        setShowBadgeSummary(false)
        return
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault()
        playArcadeSfx('select')
        setSelectedIndex((prev) => (prev + 1) % ALL_GAME_IDS.length)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        playArcadeSfx('select')
        setSelectedIndex((prev) => (prev - 1 + ALL_GAME_IDS.length) % ALL_GAME_IDS.length)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        playArcadeSfx('select')
        setSelectedIndex((prev) => (prev + 3) % ALL_GAME_IDS.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        playArcadeSfx('select')
        setSelectedIndex((prev) => (prev - 3 + ALL_GAME_IDS.length) % ALL_GAME_IDS.length)
      } else if (e.key === 'Enter' && tag !== 'BUTTON') {
        e.preventDefault()
        const targetId = ALL_GAME_IDS[selectedIndex]!
        playArcadeSfx('start')
        onNavigate(`/games/${targetId}`)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIndex, onNavigate, showBadgeSummary])

  const selectedGameId = ALL_GAME_IDS[selectedIndex]!
  const selectedMeta = GAME_CATALOG[selectedGameId]
  const selectedProg = me.games.find((g) => g.gameId === selectedGameId)

  const handleRetryPending = async () => {
    if (!pendingRetry) return
    setRetryingPending(true)
    setPendingError(null)
    try {
      await arcadeApi.submitRunResult(pendingRetry.runId, {
        events: pendingRetry.events,
        activeDurationMs: pendingRetry.activeDurationMs,
        endReason: pendingRetry.endReason,
        renderMode: pendingRetry.renderMode,
      })
      clearPendingSubmission()
      setPendingRetry(null)
      playArcadeSfx('clear')
      await onRefreshMe()
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : '재저장에 실패했습니다.')
    } finally {
      setRetryingPending(false)
    }
  }

  return (
    <div className="arcade-shell">
      <ArcadeHeader
        me={me}
        justLitGameId={justLitGameId}
        onNavigate={onNavigate}
        onLogout={() => void onLogout()}
      />

      {/* Pending unconfirmed submission recovery banner */}
      {pendingRetry && (
        <div className="status-alert warn" style={{ justifyContent: 'space-between' }}>
          <span>
            ▲ 직전 <strong>{GAME_CATALOG[pendingRetry.gameId].title}</strong> 결과 저장이 아직 서버에 확정되지 않았습니다.
            {pendingError ? ` (${pendingError})` : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-arcade btn-compact btn-start"
              disabled={retryingPending}
              onClick={() => void handleRetryPending()}
            >
              {retryingPending ? '저장 중...' : '다시 저장'}
            </button>
            <button
              type="button"
              className="btn-arcade btn-compact"
              onClick={() => {
                clearPendingSubmission()
                setPendingRetry(null)
              }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Lobby Status Strip: Progress, Due Date, Next Action */}
      <section className="lobby-status-bar" aria-label="개인 진도 및 다음 행동 안내">
        <div className="lobby-recommendation">
          <div>
            <span className="lobby-rec-headline">{me.recommendation.headline}</span>
            <span className="lobby-rec-subline" style={{ marginLeft: 10 }}>
              {me.recommendation.subline}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span>
            참가자: <strong>{me.nickname}</strong>
          </span>
          <span>
            필수 진도:{' '}
            <strong className="mono-num" style={{ color: 'var(--accent-clear)' }}>
              {me.requiredClearedCount}/5
            </strong>
          </span>
          {me.recommendedDueDate && (
            <span>
              권장 완료일:{' '}
              <strong className="mono-num">{me.recommendedDueDate}</strong>
            </span>
          )}
          {me.recommendation.kind === 'all_completed' ? (
            <button
              type="button"
              className="btn-arcade btn-compact btn-clear-cta"
              onClick={() => setShowBadgeSummary((v) => !v)}
            >
              ★ 완료 기록 보기
            </button>
          ) : (
            me.recommendation.targetGameId && (
              <button
                type="button"
                className="btn-arcade btn-compact btn-start"
                onClick={() => {
                  playArcadeSfx('start')
                  onNavigate(`/games/${me.recommendation.targetGameId}`)
                }}
              >
                추천 기기 바로 입장 ▶
              </button>
            )
          )}
        </div>
      </section>

      {showBadgeSummary && me.badgeEarned && (
        <section className="status-alert clear" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong>★ LS전선 WAY ARCADE 온보딩 배지 지급 완료</strong> · 필수 5종 케이블이 모두 연결되었습니다! 원하는 기기에 다시 도전해 정규 모드 TOP 10 기록을 경신하거나 보너스 관제실을 탐색해 보세요.
          </div>
          <button
            type="button"
            className="btn-arcade btn-compact"
            onClick={() => setShowBadgeSummary(false)}
          >
            닫기 (Esc)
          </button>
        </section>
      )}

      {/* 3x2 Electronic Arcade Cabinet Grid */}
      <main className="lobby-grid" aria-label="오락기 선택 (방향키 이동, Enter 입장)">
        {ALL_GAME_IDS.map((gid, index) => {
          const meta = GAME_CATALOG[gid]
          const prog = me.games.find((g) => g.gameId === gid)
          const isSelected = index === selectedIndex
          const isCleared = Boolean(prog?.cleared)
          const isFirstRecommend =
            me.recommendation.kind === 'first_visit' && gid === 'typing'
          const isNextRecommend =
            me.recommendation.kind !== 'first_visit' &&
            me.recommendation.targetGameId === gid

          return (
            <div
              key={gid}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              className={`cabinet-card ${isSelected ? 'selected' : ''} ${
                isCleared ? 'cleared-cabinet' : ''
              }`}
              onClick={() => {
                if (isSelected) {
                  playArcadeSfx('start')
                  onNavigate(`/games/${gid}`)
                } else {
                  playArcadeSfx('select')
                  setSelectedIndex(index)
                }
              }}
              onDoubleClick={() => {
                playArcadeSfx('start')
                onNavigate(`/games/${gid}`)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  playArcadeSfx('start')
                  onNavigate(`/games/${gid}`)
                }
              }}
            >
              {/* Unselected cabinets strictly display ONLY name, scene, required/bonus, and completion status */}
              <div className="cabinet-top-row">
                <span className={`cabinet-badge-type ${meta.category === 'bonus' ? 'bonus' : ''}`}>
                  {meta.category === 'required' ? `필수 #${(meta.socketIndex ?? 0) + 1}` : '보너스'}
                </span>

                <div style={{ display: 'flex', gap: 6 }}>
                  {isFirstRecommend && (
                    <span className="cabinet-status-tag recommend">★ 첫 판 추천</span>
                  )}
                  {isNextRecommend && !isFirstRecommend && (
                    <span className="cabinet-status-tag recommend">▶ 다음 추천</span>
                  )}
                  {isCleared && (
                    <span className="cabinet-status-tag cleared">
                      ✓ {meta.category === 'bonus' ? '관제등 완료' : '케이블 연결됨'}
                    </span>
                  )}
                </div>
              </div>

              <div className="cabinet-scene-preview">
                <CabinetArtwork gameId={gid} />
              </div>

              <div className="cabinet-bottom-row">
                <span className="cabinet-title">{meta.title}</span>
                {isSelected && (
                  <button
                    type="button"
                    className="btn-arcade btn-compact btn-start"
                    onClick={(e) => {
                      e.stopPropagation()
                      playArcadeSfx('start')
                      onNavigate(`/games/${gid}`)
                    }}
                  >
                    START ▶
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </main>

      {/* Shared Detail Panel for Selected Cabinet */}
      <footer className="lobby-detail-panel" aria-live="polite">
        <div className="detail-specs">
          <strong style={{ fontSize: 16, color: 'var(--accent-select)' }}>
            [{selectedMeta.title}]
          </strong>
          <div className="detail-spec-item">
            <span className="detail-spec-label">예상·조작·목표:</span>
            <span>{selectedMeta.summaryLine}</span>
          </div>
          <div className="detail-spec-item">
            <span className="detail-spec-label">개인 기록:</span>
            {selectedMeta.category === 'bonus' ? (
              <span className="mono-num">
                {selectedProg?.cleared ? '보너스 탈출 완료' : '미완료'}
              </span>
            ) : (
              <span className="mono-num">
                기본 최고 {selectedProg?.standardBestScore ?? '-'}점 · 여유 최고{' '}
                {selectedProg?.assistedBestScore ?? '-'}점 · 확정 {selectedProg?.finalizedAttemptCount ?? 0}회
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            방향키(←→↑↓) 선택 · Enter 입장
          </span>
          <button
            type="button"
            className="btn-arcade btn-start"
            onClick={() => {
              playArcadeSfx('start')
              onNavigate(`/games/${selectedGameId}`)
            }}
          >
            {selectedMeta.title} 입장 ▶
          </button>
        </div>
      </footer>
    </div>
  )
}
