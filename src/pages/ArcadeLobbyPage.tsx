import { useEffect, useRef, useState } from 'react'
import { ArcadeHeader } from '../components/ArcadeHeader'
import { ArcadeVideoBackdrop } from '../components/ArcadeVideoBackdrop'
import { CabinetArtwork } from '../components/CabinetArtwork'
import { CoreBotMascot } from '../components/CoreBotMascot'
import { ALL_GAME_IDS, GAME_CATALOG, REQUIRED_GAME_ORDER } from '../domain/rules'
import type { GameId } from '../domain/types'
import {
  arcadeApi,
  clearPendingSubmission,
  loadPendingSubmission,
  type ParticipantMeResponse,
  type PendingRunSubmission,
} from '../lib/api'
import { useArcadePreferences } from '../lib/preferences'
import { playArcadeSfx } from '../lib/sound'

interface ArcadeLobbyPageProps {
  me: ParticipantMeResponse
  justLitGameId: string | null
  onRefreshMe: () => Promise<void>
  onNavigate: (path: string) => void
  onLogout: () => Promise<void>
}

function MasterConfettiCanvas() {
  const { prefs } = useArcadePreferences()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (prefs.reduceMotion) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = 640
    const h = 420
    const colors = ['#43E7F2', '#B9F66C', '#FFBD64', '#FF6B9E', '#A78BFA']
    const pieces = Array.from({ length: 64 }, (_, i) => ({
      x: w / 2 + (((i * 37) % 160) - 80),
      y: h * 0.35 + (((i * 23) % 60) - 30),
      vx: (((i * 53) % 200) - 100) * 1.9,
      vy: -140 - ((i * 41) % 180),
      rot: (i * 0.5) % Math.PI,
      vrot: ((i % 7) - 3) * 2.5,
      size: 5 + (i % 5) * 1.6,
      color: colors[i % colors.length]!,
    }))

    let lastTs = performance.now()
    let rafId = 0

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - lastTs) / 1000))
      lastTs = now
      ctx.clearRect(0, 0, w, h)

      for (const p of pieces) {
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += 260 * dt
        p.rot += p.vrot * dt
        if (p.y > h + 20) {
          p.y = -10
          p.x = ((p.x + w) % w)
          p.vy = 60 + (Math.abs(p.vx) % 80)
        }

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65)
        ctx.restore()
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [prefs.reduceMotion])

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={420}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  )
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
  // Auto-open Master Badge Celebration Modal right when 4/4 is freshly lit!
  const [showBadgeModal, setShowBadgeModal] = useState(() =>
    Boolean(me.badgeEarned && justLitGameId),
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Escape' && showBadgeModal) {
        e.preventDefault()
        setShowBadgeModal(false)
        return
      }

      if (showBadgeModal) return

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
        setSelectedIndex((prev) => (prev + 2) % ALL_GAME_IDS.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        playArcadeSfx('select')
        setSelectedIndex((prev) => (prev - 2 + ALL_GAME_IDS.length) % ALL_GAME_IDS.length)
      } else if (e.key === 'Enter' && tag !== 'BUTTON') {
        e.preventDefault()
        const targetId = ALL_GAME_IDS[selectedIndex]!
        playArcadeSfx('start')
        onNavigate(`/games/${targetId}`)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIndex, onNavigate, showBadgeModal])

  const selectedGameId = ALL_GAME_IDS[selectedIndex]!
  const selectedMeta = GAME_CATALOG[selectedGameId]

  const totalBestScore = me.games.reduce(
    (sum, g) => sum + Math.max(g.standardBestScore ?? 0, g.assistedBestScore ?? 0),
    0,
  )

  const handleRetryPending = async () => {
    if (!pendingRetry) return
    setRetryingPending(true)
    setPendingError(null)
    try {
      await arcadeApi.submitRunResult(pendingRetry.runId, {
        events: pendingRetry.events,
        activeDurationMs: pendingRetry.activeDurationMs,
        endReason: pendingRetry.endReason,
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
    <div className="arcade-shell has-backdrop" style={{ position: 'relative', overflow: 'hidden' }}>
      <ArcadeVideoBackdrop intensity="vivid" />

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', flex: 1, gap: 10 }}>
        <ArcadeHeader
          me={me}
          justLitGameId={justLitGameId}
          onNavigate={onNavigate}
          onLogout={() => void onLogout()}
        />

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

        {/* Lobby Hero Status Strip */}
        <section
          className="lobby-status-bar"
          style={{
            background: 'rgba(24, 33, 48, 0.86)',
            backdropFilter: 'blur(12px)',
            borderColor: me.badgeEarned ? 'rgba(185, 246, 108, 0.5)' : 'rgba(67, 231, 242, 0.25)',
          }}
          aria-label="개인 진도 및 다음 행동 안내"
        >
          <div className="lobby-recommendation">
            <CoreBotMascot
              mood={
                me.badgeEarned
                  ? 'crown'
                  : me.requiredClearedCount >= 2
                    ? 'fever'
                    : 'cheer'
              }
              size={48}
            />
            <div>
              <span className="lobby-rec-headline">{me.recommendation.headline}</span>
              <span className="lobby-rec-subline" style={{ marginLeft: 10 }}>
                {me.recommendation.subline}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span>
              플레이어: <strong>{me.nickname}</strong>
            </span>
            <span>
              케이블 점등:{' '}
              <strong className="mono-num" style={{ color: 'var(--accent-clear)' }}>
                {me.requiredClearedCount}/{REQUIRED_GAME_ORDER.length}
              </strong>
            </span>
            <span>
              합산 최고점:{' '}
              <strong className="mono-num" style={{ color: 'var(--accent-select)' }}>
                {totalBestScore}점
              </strong>
            </span>
            {me.recommendedDueDate && (
              <span>
                권장 완료일:{' '}
                <strong className="mono-num">{me.recommendedDueDate}</strong>
              </span>
            )}
            {me.badgeEarned ? (
              <button
                type="button"
                className="btn-arcade btn-compact btn-clear-cta"
                onClick={() => {
                  playArcadeSfx('clear')
                  setShowBadgeModal(true)
                }}
              >
                ★ 마스터 인증서 보기
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
                  추천 스테이지 START ▶
                </button>
              )
            )}
          </div>
        </section>

        {/* 2x2 Illuminated Arcade Bezel Cabinet Grid */}
        <main className="lobby-grid" aria-label="4종 오락기 선택 (방향키 이동, 클릭 또는 Enter 입장)">
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
            const bestScore = Math.max(prog?.standardBestScore ?? 0, prog?.assistedBestScore ?? 0)

            return (
              <div
                key={gid}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                className={`cabinet-card ${isSelected ? 'selected' : ''} ${
                  isCleared ? 'cleared-cabinet' : ''
                }`}
                style={{
                  background: isSelected
                    ? `linear-gradient(180deg, rgba(25, 37, 56, 0.95) 0%, rgba(15, 22, 35, 0.96) 100%)`
                    : `linear-gradient(180deg, rgba(22, 30, 44, 0.88) 0%, rgba(14, 20, 31, 0.92) 100%)`,
                  borderColor: isSelected
                    ? meta.accentColor
                    : isCleared
                      ? 'rgba(185, 246, 108, 0.55)'
                      : 'rgba(242, 246, 251, 0.15)',
                  boxShadow: isSelected
                    ? `0 0 24px ${meta.accentColor}38, inset 0 0 18px ${meta.accentColor}14`
                    : undefined,
                  padding: '13px 16px',
                }}
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
                {/* Cabinet Marquee Header */}
                <div className="cabinet-top-row">
                  <span
                    style={{
                      padding: '3px 9px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 800,
                      background: `${meta.accentColor}22`,
                      color: meta.accentColor,
                      border: `1px solid ${meta.accentColor}66`,
                    }}
                  >
                    STAGE 0{meta.socketIndex + 1}
                  </span>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {isFirstRecommend && (
                      <span className="cabinet-status-tag recommend">★ 첫 판 추천</span>
                    )}
                    {isNextRecommend && !isFirstRecommend && (
                      <span className="cabinet-status-tag recommend">▶ 다음 추천</span>
                    )}
                    {isCleared ? (
                      <span className="cabinet-status-tag cleared">
                        ⚡ 케이블 연결 완료
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 12,
                          padding: '2px 8px',
                          borderRadius: 5,
                          background: 'rgba(255,255,255,0.06)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        목표 10점 통과
                      </span>
                    )}
                  </div>
                </div>

                {/* Full-Bleed Live 60fps Demo Monitor Artwork (Zero black side margins!) */}
                <div
                  className="cabinet-scene-preview crt-scanline-frame"
                  style={{
                    flex: 1,
                    minHeight: 138,
                    margin: '8px 0',
                    borderColor: `${meta.accentColor}66`,
                    boxShadow: `inset 0 0 22px rgba(0, 0, 0, 0.55), 0 0 14px ${meta.accentColor}1f`,
                  }}
                >
                  <CabinetArtwork gameId={gid} />
                </div>

                {/* Cabinet Title, Tagline, Personal Best & Start Trigger */}
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 19, fontWeight: 800, color: '#ffffff' }}>
                      {meta.title}
                    </span>
                    <span className="mono-num" style={{ fontSize: 12.5, color: bestScore > 0 ? meta.accentColor : 'var(--text-muted)' }}>
                      {prog?.finalizedAttemptCount
                        ? `내 최고 ${bestScore}점 (정규 ${prog.standardBestScore ?? '-'}점)`
                        : '첫 도전 대기'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 13.5, color: '#c4d3e8', lineHeight: 1.35 }}>
                      {meta.cardTagline}
                    </span>
                    <button
                      type="button"
                      className={`btn-arcade btn-compact ${isSelected ? 'btn-start' : ''}`}
                      style={{ flexShrink: 0, padding: '6px 13px' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        playArcadeSfx('start')
                        onNavigate(`/games/${gid}`)
                      }}
                    >
                      {isCleared ? '기록 경신 ▶' : 'START ▶'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </main>

        {/* Sleek Single-Line Arcade Control Strip (zero redundant clutter!) */}
        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            padding: '8px 16px',
            borderRadius: 9,
            background: 'rgba(18, 25, 38, 0.84)',
            border: '1px solid rgba(67, 231, 242, 0.24)',
            fontSize: 13,
          }}
        >
          <div>
            <strong style={{ color: selectedMeta.accentColor }}>
              [STAGE 0{selectedMeta.socketIndex + 1} · {selectedMeta.title}]
            </strong>{' '}
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
              🕹️ {selectedMeta.controlsLabel} · ⏱ {selectedMeta.expectedDurationLabel}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              방향키(←→↑↓) 기기 이동 · Enter 즉시 입장
            </span>
            <button
              type="button"
              className="btn-arcade btn-compact"
              onClick={() => {
                playArcadeSfx('select')
                onNavigate('/leaderboard')
              }}
            >
              👑 4종 종합 랭킹 보기
            </button>
          </div>
        </footer>
      </div>

      {/* 4/4 Master Completion Climax Celebration Modal! */}
      {showBadgeModal && me.badgeEarned && (
        <div
          role="dialog"
          aria-label="LS전선 Way 오락실 마스터 인증 배지"
          onClick={() => setShowBadgeModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(6, 10, 18, 0.88)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
            zIndex: 50,
          }}
        >
          <div
            className="cabinet-modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              overflow: 'hidden',
              maxWidth: 620,
              textAlign: 'center',
              border: '2px solid var(--accent-clear)',
              boxShadow: '0 0 42px rgba(185, 246, 108, 0.35)',
              padding: '28px 30px',
            }}
          >
            <MasterConfettiCanvas />

            <div style={{ position: 'relative', zIndex: 2 }}>
              <span
                className="cabinet-status-tag cleared"
                style={{ fontSize: 13, padding: '4px 12px', display: 'inline-block', marginBottom: 10 }}
              >
                ★ ALL 4 CABLES CONNECTED · ONBOARDING COMPLETED ★
              </span>

              <h2 style={{ margin: '4px 0 8px', fontSize: 28, fontWeight: 900, color: '#ffffff' }}>
                🏆 LS전선 WAY MASTER 인증
              </h2>
              <p style={{ margin: '0 0 18px', fontSize: 15, color: '#cfe0f5' }}>
                축하합니다, <strong style={{ color: 'var(--accent-select)' }}>{me.nickname}</strong>님!
                4종 핵심 스테이지의 전력 케이블을 모두 연결하여 간판 전체가 점등되었습니다.
              </p>

              {/* Engraved Digital Certificate Card */}
              <div
                style={{
                  padding: '16px 18px',
                  borderRadius: 12,
                  background: 'rgba(10, 16, 28, 0.9)',
                  border: '1px solid rgba(67, 231, 242, 0.4)',
                  marginBottom: 20,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 8,
                }}
              >
                {REQUIRED_GAME_ORDER.map((gid) => {
                  const g = me.games.find((item) => item.gameId === gid)
                  const best = Math.max(g?.standardBestScore ?? 0, g?.assistedBestScore ?? 0)
                  return (
                    <div
                      key={gid}
                      style={{
                        padding: '8px 6px',
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.04)',
                        border: `1px solid ${GAME_CATALOG[gid].accentColor}55`,
                      }}
                    >
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        {GAME_CATALOG[gid].shortTitle}
                      </div>
                      <div
                        className="mono-num"
                        style={{
                          fontSize: 18,
                          fontWeight: 800,
                          color: GAME_CATALOG[gid].accentColor,
                          marginTop: 2,
                        }}
                      >
                        {best}점
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={{ marginBottom: 18, fontSize: 16 }}>
                4종 합산 최고 스코어:{' '}
                <strong className="mono-num" style={{ fontSize: 24, color: 'var(--accent-clear)' }}>
                  {totalBestScore}점
                </strong>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-arcade btn-clear-cta"
                  onClick={() => {
                    setShowBadgeModal(false)
                    onNavigate('/leaderboard')
                  }}
                >
                  👑 종합 랭킹 명예의 전당 보기 ▶
                </button>
                <button
                  type="button"
                  className="btn-arcade"
                  onClick={() => setShowBadgeModal(false)}
                >
                  오락실에서 고득점 재도전 (Esc)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
