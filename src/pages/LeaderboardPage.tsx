import { useEffect, useState } from 'react'
import { ArcadeHeader } from '../components/ArcadeHeader'
import { ArcadeVideoBackdrop } from '../components/ArcadeVideoBackdrop'
import { GAME_CATALOG, isRequiredGameId, REQUIRED_GAME_ORDER } from '../domain/rules'
import type { RequiredGameId } from '../domain/types'
import { arcadeApi, type ParticipantMeResponse } from '../lib/api'
import { playArcadeSfx } from '../lib/sound'

interface LeaderboardPageProps {
  me: ParticipantMeResponse
  initialGameId?: string | null
  onNavigate: (path: string) => void
  onLogout: () => Promise<void>
}

type LeaderboardTab = 'total' | RequiredGameId

const PODIUM_STYLES = [
  { medal: '🥇 1ST CHAMPION', color: '#FFD43B', bg: 'rgba(255, 212, 59, 0.14)' },
  { medal: '🥈 2ND RUNNER-UP', color: '#DCE6F2', bg: 'rgba(220, 230, 242, 0.1)' },
  { medal: '🥉 3RD PLACE', color: '#FF9F68', bg: 'rgba(255, 159, 104, 0.12)' },
] as const

export function LeaderboardPage({
  me,
  initialGameId,
  onNavigate,
  onLogout,
}: LeaderboardPageProps) {
  const defaultTab: LeaderboardTab =
    initialGameId && isRequiredGameId(initialGameId) ? initialGameId : 'total'
  const [activeTab, setActiveTab] = useState<LeaderboardTab>(defaultTab)
  const [loadedBoard, setLoadedBoard] = useState<{
    tab: LeaderboardTab
    data: Awaited<ReturnType<typeof arcadeApi.getLeaderboard>>
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void arcadeApi.getLeaderboard(activeTab).then((res) => {
      if (!cancelled) {
        setLoadedBoard({ tab: activeTab, data: res })
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeTab])

  const loading = !loadedBoard || loadedBoard.tab !== activeTab
  const board = loadedBoard?.data ?? null
  const podiumTop3 = board ? board.top10.slice(0, 3) : []

  return (
    <div className="arcade-shell has-backdrop" style={{ position: 'relative', overflow: 'hidden' }}>
      <ArcadeVideoBackdrop intensity="vivid" />

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', flex: 1, gap: 10 }}>
        <ArcadeHeader me={me} onNavigate={onNavigate} onLogout={() => void onLogout()} />

        <section
          className="lobby-status-bar"
          style={{ background: 'rgba(24, 33, 48, 0.86)', backdropFilter: 'blur(12px)' }}
        >
          <div>
            <strong style={{ fontSize: 19 }}>🏆 HALL OF FAME · 명예의 전당 TOP 10</strong>
            <span style={{ marginLeft: 12, color: 'var(--text-muted)' }}>
              동일 버전({me.contentVersion} / {me.ruleVersion}) 기준 · 정규 모드(기본 속도) 최고점 집계
            </span>
          </div>
          <button type="button" className="btn-arcade" onClick={() => onNavigate('/arcade')}>
            ← 오락실 로비로 복귀
          </button>
        </section>

        {/* Grand Prix Total Tab + 4 Stage Tabs */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'total'}
            className={`btn-arcade ${activeTab === 'total' ? 'btn-clear-cta' : ''}`}
            onClick={() => {
              playArcadeSfx('select')
              setActiveTab('total')
            }}
          >
            👑 4종 종합 (GRAND PRIX)
          </button>

          {REQUIRED_GAME_ORDER.map((gid) => {
            const selected = gid === activeTab
            return (
              <button
                key={gid}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`btn-arcade ${selected ? 'btn-start' : ''}`}
                onClick={() => {
                  playArcadeSfx('select')
                  setActiveTab(gid)
                }}
              >
                0{GAME_CATALOG[gid].socketIndex + 1} · {GAME_CATALOG[gid].title}
              </button>
            )
          })}
        </div>

        {board && (
          <div style={{ display: 'grid', gap: 12 }}>
            {/* My Standing Banner */}
            {board.myStanding ? (
              <div className="status-alert clear" style={{ justifyContent: 'space-between' }}>
                <span>
                  내 정규 최고 순위: <strong>{board.myStanding.nickname}</strong> · 전체{' '}
                  <strong className="mono-num">{board.myStanding.rank}위</strong> /{' '}
                  <span className="mono-num">{board.totalRankedCount}명</span>
                </span>
                <strong className="mono-num" style={{ fontSize: 20 }}>
                  {board.myStanding.score}점
                </strong>
              </div>
            ) : (
              <div className="status-alert warn" style={{ justifyContent: 'space-between' }}>
                <span>
                  ℹ {board.noStandardScoreNotice}
                  {board.assistedBestScore !== null
                    ? ` (내 여유 모드 최고점: ${board.assistedBestScore}점)`
                    : ''}
                </span>
                <button
                  type="button"
                  className="btn-arcade btn-compact btn-start"
                  onClick={() =>
                    onNavigate(
                      activeTab === 'total'
                        ? `/games/${me.recommendation.targetGameId ?? 'typing'}`
                        : `/games/${activeTab}`,
                    )
                  }
                >
                  기본 속도로 도전하기 ▶
                </button>
              </div>
            )}

            {/* Top 3 Neon Podium Showcase! */}
            {!loading && podiumTop3.length > 0 && (
              <section className="podium-grid" aria-label="상위 1~3위 시상대">
                {podiumTop3.map((entry, idx) => {
                  const st = PODIUM_STYLES[idx]!
                  return (
                    <div
                      key={`${entry.rank}-${entry.nickname}`}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 12,
                        background: st.bg,
                        border: `1.8px solid ${st.color}`,
                        boxShadow: `0 0 22px ${st.color}22`,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: st.color }}>
                          {st.medal}
                        </span>
                        {entry.cleared && (
                          <span className="cabinet-status-tag cleared" style={{ fontSize: 11 }}>
                            {activeTab === 'total' ? '★ 4종 완주' : '✓ 통과'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#ffffff' }}>
                        {entry.nickname} {entry.isMe ? '(나)' : ''}
                      </div>
                      <div className="mono-num" style={{ fontSize: 24, fontWeight: 900, color: st.color }}>
                        {entry.score}점
                      </div>
                    </div>
                  )
                })}
              </section>
            )}

            {/* Full TOP 10 Scoreboard */}
            <div className="admin-table-wrap" style={{ background: 'rgba(22, 30, 44, 0.88)', backdropFilter: 'blur(10px)' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>순위</th>
                    <th>플레이어 닉네임</th>
                    <th>{activeTab === 'total' ? '4종 정규 합산 점수' : '정규 최고점'}</th>
                    <th>{activeTab === 'total' ? '4종 완주 여부' : '통과 여부'}</th>
                    <th>달성 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>
                        전광판 기록을 불러오는 중...
                      </td>
                    </tr>
                  ) : board.top10.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                        아직 등록된 정규 모드 기록이 없습니다. 첫 번째 챔피언에 도전해 보세요!
                      </td>
                    </tr>
                  ) : (
                    board.top10.map((row) => (
                      <tr
                        key={`${row.rank}-${row.nickname}`}
                        style={
                          row.isMe
                            ? { background: 'rgba(67, 231, 242, 0.14)', fontWeight: 700 }
                            : undefined
                        }
                      >
                        <td className="mono-num">
                          {row.rank === 1 ? '🥇 #1' : row.rank === 2 ? '🥈 #2' : row.rank === 3 ? '🥉 #3' : `#${row.rank}`}
                        </td>
                        <td>
                          {row.nickname} {row.isMe ? '(나)' : ''}
                        </td>
                        <td className="mono-num" style={{ color: 'var(--accent-clear)', fontSize: 15 }}>
                          {row.score}점
                        </td>
                        <td>
                          {row.cleared
                            ? activeTab === 'total'
                              ? '★ 4/4 마스터'
                              : '✓ 통과'
                            : activeTab === 'total'
                              ? '도전 진행 중'
                              : '미통과 기록'}
                        </td>
                        <td className="mono-num" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {new Date(row.achievedAt).toLocaleString('ko-KR')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
