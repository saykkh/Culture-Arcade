import { useEffect, useState } from 'react'
import { ArcadeHeader } from '../components/ArcadeHeader'
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

export function LeaderboardPage({
  me,
  initialGameId,
  onNavigate,
  onLogout,
}: LeaderboardPageProps) {
  const defaultTab: RequiredGameId =
    initialGameId && isRequiredGameId(initialGameId) ? initialGameId : 'typing'
  const [activeTab, setActiveTab] = useState<RequiredGameId>(defaultTab)
  const [loadedBoard, setLoadedBoard] = useState<{
    tab: RequiredGameId
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

  return (
    <div className="arcade-shell">
      <ArcadeHeader me={me} onNavigate={onNavigate} onLogout={() => void onLogout()} />

      <section className="lobby-status-bar">
        <div>
          <strong style={{ fontSize: 18 }}>🏆 정규 모드 TOP 10 랭킹 보드</strong>
          <span style={{ marginLeft: 12, color: 'var(--text-muted)' }}>
            동일 콘텐츠·규칙 버전({me.contentVersion} / {me.ruleVersion}) 기준 · 기본 속도 최고점 집계
          </span>
        </div>
        <button type="button" className="btn-arcade" onClick={() => onNavigate('/arcade')}>
          ← 오락실 로비로 복귀
        </button>
      </section>

      {/* 5 Required Game Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="tablist">
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
              {GAME_CATALOG[gid].title}
            </button>
          )
        })}
      </div>

      {board && (
        <div style={{ display: 'grid', gap: 10 }}>
          {/* My Standing Banner */}
          {board.myStanding ? (
            <div className="status-alert clear" style={{ justifyContent: 'space-between' }}>
              <span>
                내 정규 최고 기록: <strong>{board.myStanding.nickname}</strong> · 전체{' '}
                <strong className="mono-num">{board.myStanding.rank}위</strong> /{' '}
                <span className="mono-num">{board.totalRankedCount}명</span>
              </span>
              <strong className="mono-num" style={{ fontSize: 18 }}>
                {board.myStanding.score}점
              </strong>
            </div>
          ) : (
            <div className="status-alert warn" style={{ justifyContent: 'space-between' }}>
              <span>
                ℹ {board.noStandardScoreNotice}
                {board.assistedBestScore !== null
                  ? ` (내 여유롭게 도전 최고점: ${board.assistedBestScore}점)`
                  : ''}
              </span>
              <button
                type="button"
                className="btn-arcade btn-compact btn-start"
                onClick={() => onNavigate(`/games/${activeTab}`)}
              >
                기본 속도로 도전하기 ▶
              </button>
            </div>
          )}

          {/* TOP 10 Table */}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>순위</th>
                  <th>닉네임</th>
                  <th>정규 최고점</th>
                  <th>클리어 여부</th>
                  <th>달성 시각</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>
                      랭킹을 불러오는 중...
                    </td>
                  </tr>
                ) : board.top10.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      아직 등록된 정규 모드 기록이 없습니다. 첫 번째 1위에 도전해 보세요!
                    </td>
                  </tr>
                ) : (
                  board.top10.map((row) => (
                    <tr
                      key={`${row.rank}-${row.nickname}`}
                      style={
                        row.isMe
                          ? { background: 'rgba(67, 231, 242, 0.12)', fontWeight: 700 }
                          : undefined
                      }
                    >
                      <td className="mono-num">#{row.rank}</td>
                      <td>
                        {row.nickname} {row.isMe ? '(나)' : ''}
                      </td>
                      <td className="mono-num" style={{ color: 'var(--accent-clear)' }}>
                        {row.score}점
                      </td>
                      <td>{row.cleared ? '✓ 클리어' : '미클리어 기록'}</td>
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
  )
}
