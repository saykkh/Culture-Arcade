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
  const allFiveLit = Boolean(me && me.requiredClearedCount === 5)

  return (
    <header
      className={`arcade-sign-header ${allFiveLit ? 'sign-all-lit' : ''}`}
      style={compact ? { padding: '5px 12px' } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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

        {me?.isSampleContent && (
          <span className="sample-pill" title={me.sampleNotice ?? undefined}>
            ▲ 샘플 콘텐츠 ({me.contentVersion})
          </span>
        )}

        {allFiveLit && (
          <span
            className="cabinet-status-tag cleared"
            style={{ fontSize: 13, padding: '3px 9px' }}
          >
            ★ 온보딩 배지 획득 · 간판 전체 점등
          </span>
        )}
      </div>

      {me && !me.beforeStartDate && !me.requiresNickname && !compact && (
        <div className="cable-board" aria-label="필수 게임 케이블 소켓 및 보너스 관제등 상태">
          {REQUIRED_GAME_ORDER.map((gid, idx) => {
            const lit = Boolean(me.litSockets[gid])
            const justLit = justLitGameId === gid
            return (
              <div
                key={gid}
                className={`socket-chip ${lit ? 'lit' : ''} ${justLit ? 'just-lit' : ''} ${
                  prefs.reduceMotion ? 'reduce-motion' : ''
                }`}
                title={`${GAME_CATALOG[gid].title}: ${lit ? '연결 완료' : '미연결'}`}
              >
                <span aria-hidden="true">{lit ? '⚡' : '○'}</span>
                <span className="mono-num">S{idx + 1}</span>
                <span>{GAME_CATALOG[gid].shortTitle}</span>
                <span style={{ fontWeight: 700 }}>{lit ? '연결 완료' : '대기'}</span>
              </div>
            )
          })}

          <div
            className={`beacon-chip ${me.controlLampLit ? 'lit' : ''}`}
            title={`보너스 관제등: ${me.controlLampLit ? '점등 완료' : '대기'}`}
          >
            <span aria-hidden="true">{me.controlLampLit ? '◉' : '◌'}</span>
            <span>관제등 {me.controlLampLit ? '점등' : '대기'}</span>
          </div>
        </div>
      )}

      <div className="header-controls">
        <button
          type="button"
          className="btn-arcade btn-compact"
          onClick={toggleBgmMuted}
          aria-pressed={!prefs.bgmMuted && !prefs.muted}
          title="배경음악(BGM) 켜기/끄기"
        >
          {prefs.bgmMuted || prefs.muted ? '🎵 BGM 꺼짐' : '🎵 BGM 켜짐'}
        </button>
        <button
          type="button"
          className="btn-arcade btn-compact"
          onClick={toggleMuted}
          aria-pressed={prefs.muted}
          title="전체 소리(배경음+효과음) 켜기/끄기"
        >
          {prefs.muted ? '🔇 전체 음소거' : '🔊 효과음 켜짐'}
        </button>
        <button
          type="button"
          className="btn-arcade btn-compact"
          onClick={toggleReduceMotion}
          aria-pressed={prefs.reduceMotion}
          title="번쩍임·화면 흔들림·전류 이동 연출 줄이기"
        >
          {prefs.reduceMotion ? '◐ 효과 줄이기 켜짐' : '✦ 기본 연출'}
        </button>

        {me && !me.beforeStartDate && !me.requiresNickname && (
          <button
            type="button"
            className="btn-arcade btn-compact"
            onClick={() => {
              playArcadeSfx('select')
              onNavigate('/leaderboard')
            }}
          >
            🏆 TOP 10
          </button>
        )}

        <button
          type="button"
          className="btn-arcade btn-compact"
          onClick={() => {
            playArcadeSfx('select')
            onNavigate('/admin')
          }}
        >
          ⚙ 운영
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
