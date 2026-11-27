import { useEffect, useState, type FormEvent } from 'react'
import { ArcadeHeader } from '../components/ArcadeHeader'
import { ArcadeVideoBackdrop } from '../components/ArcadeVideoBackdrop'
import { CabinetArtwork } from '../components/CabinetArtwork'
import { CoreBotMascot } from '../components/CoreBotMascot'
import { formatParticipantCode, GAME_CATALOG, REQUIRED_GAME_ORDER } from '../domain/rules'
import { arcadeApi, ClientApiError, type ParticipantMeResponse } from '../lib/api'
import { useArcadePreferences } from '../lib/preferences'
import { playArcadeSfx } from '../lib/sound'

interface CodeEntryPageProps {
  me: ParticipantMeResponse | null
  onAuthenticated: () => Promise<void>
  onNavigate: (path: string) => void
  onLogout: () => Promise<void>
}

export function CodeEntryPage({
  me,
  onAuthenticated,
  onNavigate,
  onLogout,
}: CodeEntryPageProps) {
  const { prefs } = useArcadePreferences()
  const [codeInput, setCodeInput] = useState('')
  const [nicknameInput, setNicknameInput] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showcaseIdx, setShowcaseIdx] = useState(0)
  const [sampleInfo, setSampleInfo] = useState<{
    isSampleEnvironment: boolean
    sampleNotice: string | null
    virtualSamples: Array<{ rosterRef: string; code: string; description: string }>
  } | null>(null)

  useEffect(() => {
    void arcadeApi
      .getSampleInfo()
      .then(setSampleInfo)
      .catch(() => null)
  }, [])

  useEffect(() => {
    if (me && !me.beforeStartDate && !me.requiresNickname) {
      onNavigate('/arcade')
    }
  }, [me, onNavigate])

  // Auto-cycle Attract Mode game showcase every 3.2 seconds
  useEffect(() => {
    if (prefs.reduceMotion) return
    const id = window.setInterval(() => {
      setShowcaseIdx((prev) => (prev + 1) % REQUIRED_GAME_ORDER.length)
    }, 3200)
    return () => window.clearInterval(id)
  }, [prefs.reduceMotion])

  const handleCodeSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setBusy(true)
    try {
      playArcadeSfx('start')
      const res = await arcadeApi.loginWithCode(codeInput)
      await onAuthenticated()
      if (!res.beforeStartDate && !res.requiresNickname) {
        onNavigate('/arcade')
      }
    } catch (err) {
      playArcadeSfx('wrong')
      setErrorMsg(
        err instanceof ClientApiError ? err.message : '개인 코드 확인 중 오류가 발생했습니다.',
      )
    } finally {
      setBusy(false)
    }
  }

  const handleNicknameSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setBusy(true)
    try {
      await arcadeApi.setNickname(nicknameInput)
      playArcadeSfx('clear')
      await onAuthenticated()
      onNavigate('/arcade')
    } catch (err) {
      playArcadeSfx('wrong')
      setErrorMsg(
        err instanceof ClientApiError ? err.message : '닉네임 설정 중 오류가 발생했습니다.',
      )
    } finally {
      setBusy(false)
    }
  }

  const featuredGameId = REQUIRED_GAME_ORDER[showcaseIdx]!
  const featuredMeta = GAME_CATALOG[featuredGameId]

  return (
    <div className="arcade-shell has-backdrop" style={{ position: 'relative', overflow: 'hidden' }}>
      <ArcadeVideoBackdrop intensity="vivid" />

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', flex: 1, gap: 12 }}>
        <ArcadeHeader me={me} onNavigate={onNavigate} onLogout={me ? onLogout : undefined} />

        {/* Scrolling Attract Marquee Ribbon */}
        <div className="attract-marquee-strip" aria-hidden="true">
          <div className={`attract-marquee-track ${prefs.reduceMotion ? 'paused' : ''}`}>
            <span>⚡ CONNECT THE SUSTAINABLE FUTURE · LS전선 WAY ARCADE</span>
            <span>★ STAGE 01 산성비 타자</span>
            <span>★ STAGE 02 단어 먹는 뱀</span>
            <span>★ STAGE 03 가치 표적 슈팅</span>
            <span>★ STAGE 04 C.O.R.E. 부스터 런</span>
            <span>🏆 10점 즉시 통과 · 4종 케이블 연결 시 마스터 배지 획득!</span>
            <span>⚡ CONNECT THE SUSTAINABLE FUTURE · LS전선 WAY ARCADE</span>
            <span>★ STAGE 01 산성비 타자</span>
            <span>★ STAGE 02 단어 먹는 뱀</span>
            <span>★ STAGE 03 가치 표적 슈팅</span>
            <span>★ STAGE 04 C.O.R.E. 부스터 런</span>
          </div>
        </div>

        <main className="landing-attract-grid">
          {/* Left Column: Flashy Arcade Hero & Live 4-Game Attract Showcase */}
          <section className="landing-hero-pane" aria-label="LS전선 Way 오락실 소개 및 4종 게임 프리뷰">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <CoreBotMascot
                mood="fever"
                size={56}
                accentColor={featuredMeta.accentColor}
                speech="오락실에 오신 걸 환영해요! 12자리 코드로 바로 출발해 볼까요?"
              />
            </div>

            <h1 className="landing-neon-title">
              LS전선 <span className="landing-neon-gradient">WAY ARCADE</span>
            </h1>
            <p className="landing-hero-desc">
              미션 · 비전 · 핵심가치(<strong>C·O·R·E</strong>) · 경영철학을 지루한 문서 대신{' '}
              <strong style={{ color: 'var(--accent-clear)' }}>4종의 네온 오락기</strong>로 즐겁게 익히고,
              전력 케이블 4개를 모두 점등해 마스터 배지와 <strong>TOP 10 명예의 전당</strong>에 도전하세요!
            </p>

            {/* Quick Rule Highlights */}
            <div className="landing-rule-chips">
              <div className="landing-rule-chip">
                <span style={{ fontSize: 18 }}>⚡</span>
                <div>
                  <strong>기본 +2점 · 10점 통과</strong>
                  <span>빠르게 통과하고 고득점 경쟁</span>
                </div>
              </div>
              <div className="landing-rule-chip">
                <span style={{ fontSize: 18 }}>🔌</span>
                <div>
                  <strong>4종 케이블 점등</strong>
                  <span>완주 즉시 마스터 인증 배지</span>
                </div>
              </div>
              <div className="landing-rule-chip">
                <span style={{ fontSize: 18 }}>🎵</span>
                <div>
                  <strong>전용 아케이드 BGM</strong>
                  <span>스테이지별 맞춤 사운드트랙</span>
                </div>
              </div>
            </div>

            {/* Auto-Cycling Live Stage Preview Card */}
            <div
              className="landing-showcase-card"
              style={{
                borderColor: featuredMeta.accentColor,
                boxShadow: `0 0 28px ${featuredMeta.accentColor}28, inset 0 0 20px ${featuredMeta.accentColor}12`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    background: `${featuredMeta.accentColor}24`,
                    color: featuredMeta.accentColor,
                    border: `1px solid ${featuredMeta.accentColor}`,
                  }}
                >
                  STAGE 0{featuredMeta.socketIndex + 1} PREVIEW
                </span>

                <div style={{ display: 'flex', gap: 6 }}>
                  {REQUIRED_GAME_ORDER.map((gid, idx) => {
                    const active = idx === showcaseIdx
                    const c = GAME_CATALOG[gid].accentColor
                    return (
                      <button
                        key={gid}
                        type="button"
                        onClick={() => {
                          playArcadeSfx('select')
                          setShowcaseIdx(idx)
                        }}
                        style={{
                          padding: '3px 9px',
                          borderRadius: 999,
                          border: `1px solid ${active ? c : 'rgba(255,255,255,0.18)'}`,
                          background: active ? `${c}28` : 'rgba(11,15,23,0.7)',
                          color: active ? c : 'var(--text-muted)',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        0{idx + 1} {GAME_CATALOG[gid].shortTitle}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 14, alignItems: 'center' }}>
                <div
                  style={{
                    position: 'relative',
                    height: 92,
                    borderRadius: 9,
                    overflow: 'hidden',
                    border: `1px solid ${featuredMeta.accentColor}66`,
                    background: '#080d18',
                  }}
                >
                  <CabinetArtwork gameId={featuredGameId} />
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', marginBottom: 4 }}>
                    {featuredMeta.title}
                  </div>
                  <div style={{ fontSize: 14, color: '#d5e3f7', lineHeight: 1.45, marginBottom: 6 }}>
                    {featuredMeta.cardTagline}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    🕹️ {featuredMeta.controlsLabel}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Right Column: Glowing Coin-Slot Entry Terminal */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {me && me.beforeStartDate ? (
              <section className="cabinet-modal-card landing-terminal-card" aria-labelledby="prestart-heading">
                <h2 id="prestart-heading" style={{ marginTop: 0, fontSize: 22 }}>
                  ⏳ 개인 플레이 시작일 전입니다
                </h2>
                <p className="instruction-text">
                  본인의 오락실 입장 및 게임 플레이 시작일은{' '}
                  <strong className="mono-num" style={{ color: 'var(--accent-select)' }}>
                    {me.availableFromDate}
                  </strong>{' '}
                  (한국 시간 00:00 기준)입니다.
                </p>
                <div className="status-alert warn" style={{ marginBottom: 18 }}>
                  <span>시작일 이후 같은 개인 코드로 다시 접속하면 바로 입장할 수 있습니다.</span>
                </div>
                <button type="button" className="btn-arcade" onClick={() => void onLogout()}>
                  다른 코드로 접속하기
                </button>
              </section>
            ) : me && me.requiresNickname ? (
              <section className="cabinet-modal-card landing-terminal-card" aria-labelledby="nickname-heading">
                <div style={{ marginBottom: 8 }}>
                  <span className="cabinet-badge-type">PLAYER REGISTRATION</span>
                </div>
                <h2 id="nickname-heading" style={{ marginTop: 0, fontSize: 24 }}>
                  🎮 플레이어 닉네임 등록
                </h2>
                <p className="instruction-text">
                  오락실 전광판과 마스터 인증 배지에 각인할 별칭을 입력해 주세요.{' '}
                  <strong>실명 대신 개성 있는 아케이드 별칭을 권장합니다!</strong> (2~16자)
                </p>
                <form onSubmit={(e) => void handleNicknameSubmit(e)} style={{ display: 'grid', gap: 12 }}>
                  <input
                    type="text"
                    className="arcade-input"
                    value={nicknameInput}
                    onChange={(e) => setNicknameInput(e.target.value)}
                    placeholder="예: 초전도러너_01"
                    maxLength={16}
                    autoFocus
                    aria-label="표시 닉네임"
                  />
                  {errorMsg && (
                    <div className="status-alert error" role="alert">
                      <span>✕ {errorMsg}</span>
                    </div>
                  )}
                  <button type="submit" className="btn-arcade btn-start" style={{ padding: '12px 18px', fontSize: 16 }} disabled={busy}>
                    {busy ? '등록 중...' : '닉네임 확정 · 오락실 START ▶'}
                  </button>
                </form>
              </section>
            ) : (
              <section className="cabinet-modal-card landing-terminal-card" aria-labelledby="code-heading">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span className="cabinet-badge-type">INSERT PERSONAL CODE</span>
                  <span style={{ fontSize: 12, color: 'var(--accent-clear)', fontWeight: 700 }}>
                    ● READY TO PLAY
                  </span>
                </div>
                <h2 id="code-heading" style={{ margin: '0 0 8px', fontSize: 25, fontWeight: 800 }}>
                  오락실 입장 코드 투입
                </h2>
                <p style={{ margin: '0 0 16px', fontSize: 14.5, color: '#c4d3e8', lineHeight: 1.5 }}>
                  안내받은 12자리 <strong>개인 코드</strong>를 입력하세요. 다른 PC에서도 같은 코드로 점등한 케이블과 최고 기록을 이어갈 수 있습니다.
                </p>

                <form onSubmit={(e) => void handleCodeSubmit(e)} style={{ display: 'grid', gap: 12 }}>
                  <label htmlFor="personal-code-input" style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--accent-select)' }}>
                    12자리 입장 코드 (XXXX-XXXX-XXXX)
                  </label>
                  <input
                    id="personal-code-input"
                    type="text"
                    className="arcade-input mono-num"
                    style={{
                      fontSize: 20,
                      letterSpacing: '0.08em',
                      textAlign: 'center',
                      fontWeight: 800,
                      padding: '13px 16px',
                    }}
                    value={codeInput}
                    onChange={(e) => {
                      const cleaned = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
                      const parts = cleaned.match(/.{1,4}/g) ?? []
                      setCodeInput(parts.join('-'))
                    }}
                    placeholder="XXXX-XXXX-XXXX"
                    autoComplete="off"
                    autoFocus
                  />

                  {errorMsg && (
                    <div className="status-alert error" role="alert">
                      <span>✕ {errorMsg}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn-arcade btn-start landing-cta-pulse"
                    disabled={busy || codeInput.trim().length < 4}
                    style={{ fontSize: 17, padding: '13px 18px' }}
                  >
                    {busy ? '코드 확인 중...' : '⚡ INSERT CODE · 오락실 입장 ▶'}
                  </button>
                </form>

                {sampleInfo?.isSampleEnvironment && sampleInfo.virtualSamples.length > 0 && (
                  <div
                    style={{
                      marginTop: 18,
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: 'rgba(13, 21, 35, 0.85)',
                      border: '1px dashed rgba(255, 189, 100, 0.5)',
                    }}
                  >
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-warn)', marginBottom: 8 }}>
                      🎫 원클릭 체험 티켓 (클릭 시 코드가 자동 입력됩니다)
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {sampleInfo.virtualSamples.map((sample) => (
                        <button
                          key={sample.rosterRef}
                          type="button"
                          className="btn-arcade btn-compact"
                          style={{ justifyContent: 'space-between', padding: '7px 11px' }}
                          onClick={() => {
                            playArcadeSfx('select')
                            setCodeInput(formatParticipantCode(sample.code))
                          }}
                        >
                          <span className="mono-num" style={{ color: 'var(--accent-select)', fontWeight: 800 }}>
                            {sample.code}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {sample.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>🔊 화면 클릭 시 신나는 오락실 BGM이 재생됩니다</span>
                  <button
                    type="button"
                    onClick={() => onNavigate('/admin')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      padding: 0,
                      fontSize: 12,
                    }}
                  >
                    운영자 콘솔
                  </button>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
