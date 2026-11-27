import { Fragment } from 'react'
import { GAME_CATALOG, REQUIRED_GAME_ORDER } from '../domain/rules'
import type { ParticipantMeResponse } from '../lib/api'
import { useArcadePreferences } from '../lib/preferences'
import { playArcadeSfx } from '../lib/sound'

interface ArcadeHeaderProps {
  me: ParticipantMeResponse | null
  justLitGameId?: string | null
  compact?: boolean
  onNavigate: (path: string) => void
  onLogout?: () => void
}

export function ArcadeHeader({
  me,
  justLitGameId,
  compact = false,
  onNavigate,
  onLogout,
}: ArcadeHeaderProps) {
  const { prefs, toggleMuted, toggleBgmMuted, toggleReduceMotion } = useArcadePreferences()
  const allFourLit = Boolean(
    me && me.requiredClearedCount === REQUIRED_GAME_ORDER.length,
  )

  return (
    <header
      className={`arcade-sign-header ${allFourLit ? 'sign-all-lit' : ''}`}
      style={compact ? { padding: '5px 14px' } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div
          className="sign-brand"
          role="banner"
          style={{ cursor: me ? 'pointer' : 'default' }}
          onClick={() => {
            if (me && !me.beforeStartDate && !me.requiresNickname) {
              playArcadeSfx('select')
              onNavigate('/arcade')
            }
          }}
        >
          <span className="sign-brand-ko">LS전선</span>
          <span className="sign-brand-en">WAY ARCADE</span>
        </div>

        {me?.isSampleContent && !compact && (
          <span className="sample-pill" title={me.sampleNotice ?? undefined}>
            샘플 {me.contentVersion}
          </span>
        )}

        {allFourLit && (
          <span
            className="cabinet-status-tag cleared"
            style={{ fontSize: 12.5, padding: '3px 9px' }}
          >
            ★ 4/4 마스터 배지 점등
          </span>
        )}
      </div>

      {/* Connected Neon Power Cable Progress Board */}
      {me && !me.beforeStartDate && !me.requiresNickname && !compact && (
        <div className="cable-board" aria-label="4종 게임 전력 케이블 연결 상태">
          {REQUIRED_GAME_ORDER.map((gid, idx) => {
            const lit = Boolean(me.litSockets[gid])
            const prevLit = idx > 0 && Boolean(me.litSockets[REQUIRED_GAME_ORDER[idx - 1]!])
            const wireActive = lit && prevLit
            const justLit = justLitGameId === gid
            return (
              <Fragment key={gid}>
                {idx > 0 && (
                  <span
                    aria-hidden="true"
                    className={`cable-connector-wire ${wireActive ? 'lit' : ''}`}
                  />
                )}
                <button
                  type="button"
                  data-cable-socket={gid}
                  onClick={() => {
                    playArcadeSfx('select')
                    onNavigate(`/games/${gid}`)
                  }}
                  className={`socket-chip ${lit ? 'lit' : ''} ${justLit ? 'just-lit' : ''} ${
                    prefs.reduceMotion ? 'reduce-motion' : ''
                  }`}
                  style={{ cursor: 'pointer' }}
                  title={`${GAME_CATALOG[gid].title}: ${lit ? '통과 완료 (클릭해 이동)' : '미연결 (클릭해 입장)'}`}
                >
                  <span aria-hidden="true">{lit ? '⚡' : '○'}</span>
                  <span className="mono-num">S{idx + 1}</span>
                  <span>{GAME_CATALOG[gid].shortTitle}</span>
                </button>
              </Fragment>
            )
          })}
        </div>
      )}

      {/* Sleek Compact Audio/Motion Pill Group + Primary Nav */}
      <div className="header-controls">
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 4px',
            borderRadius: 8,
            background: 'rgba(11, 15, 23, 0.72)',
            border: '1px solid rgba(242, 246, 251, 0.14)',
          }}
        >
          <button
            type="button"
            className="header-mini-toggle"
            onClick={toggleBgmMuted}
            aria-pressed={!prefs.bgmMuted && !prefs.muted}
            title="배경음악(BGM) 켜기/끄기"
          >
            {prefs.bgmMuted || prefs.muted ? '🎵꺼짐' : '🎵BGM'}
          </button>
          <button
            type="button"
            className="header-mini-toggle"
            onClick={toggleMuted}
            aria-pressed={prefs.muted}
            title="전체 소리(배경음+효과음) 음소거"
          >
            {prefs.muted ? '🔇음소거' : '🔊효과음'}
          </button>
          <button
            type="button"
            className="header-mini-toggle"
            onClick={toggleReduceMotion}
            aria-label="효과 줄이기"
            aria-pressed={prefs.reduceMotion}
            title="배경 애니메이션 및 번쩍임 줄이기"
          >
            {prefs.reduceMotion ? '◐절전연출' : '✦화려한연출'}
          </button>
        </div>

        {me && !me.beforeStartDate && !me.requiresNickname && (
          <button
            type="button"
            className="btn-arcade btn-compact"
            onClick={() => {
              playArcadeSfx('select')
              onNavigate('/leaderboard')
            }}
          >
            🏆 랭킹
          </button>
        )}

        <button
          type="button"
          className="btn-arcade btn-compact"
          title="교육 담당자 운영 콘솔"
          onClick={() => {
            playArcadeSfx('select')
            onNavigate('/admin')
          }}
        >
          ⚙
        </button>

        {me && onLogout && (
          <button
            type="button"
            className="btn-arcade btn-compact"
            onClick={onLogout}
          >
            로그아웃
          </button>
        )}
      </div>
    </header>
  )
}
