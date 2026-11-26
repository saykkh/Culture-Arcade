import { useEffect, useState, type FormEvent } from 'react'
import { ArcadeHeader } from '../components/ArcadeHeader'
import { formatParticipantCode } from '../domain/rules'
import { arcadeApi, ClientApiError, type ParticipantMeResponse } from '../lib/api'
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
  const [codeInput, setCodeInput] = useState('')
  const [nicknameInput, setNicknameInput] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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

  // If already fully authenticated and ready, enter lobby automatically
  useEffect(() => {
    if (me && !me.beforeStartDate && !me.requiresNickname) {
      onNavigate('/arcade')
    }
  }, [me, onNavigate])

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

  return (
    <div className="arcade-shell">
      <ArcadeHeader me={me} onNavigate={onNavigate} onLogout={me ? onLogout : undefined} />

      <main className="center-card-wrap">
        {/* 1) Before personal start date screen */}
        {me && me.beforeStartDate ? (
          <section className="cabinet-modal-card" aria-labelledby="prestart-heading">
            <h1 id="prestart-heading" style={{ marginTop: 0, fontSize: 22 }}>
              ⏳ 개인 플레이 시작일 전입니다
            </h1>
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
          /* 2) First-time nickname setup */
          <section className="cabinet-modal-card" aria-labelledby="nickname-heading">
            <h1 id="nickname-heading" style={{ marginTop: 0, fontSize: 22 }}>
              🎮 오락실 표시 닉네임 설정
            </h1>
            <p className="instruction-text">
              랭킹 보드와 오락실 간판에 표시할 별칭을 정해 주세요.{' '}
              <strong>실명 대신 개성 있는 별칭 사용을 권장합니다.</strong> (2~16자, 한글·영문·숫자·공백·밑줄 허용)
            </p>
            <form onSubmit={(e) => void handleNicknameSubmit(e)} style={{ display: 'grid', gap: 12 }}>
              <input
                type="text"
                className="arcade-input"
                value={nicknameInput}
                onChange={(e) => setNicknameInput(e.target.value)}
                placeholder="예: 케이블마스터_01"
                maxLength={16}
                autoFocus
                aria-label="표시 닉네임"
              />
              {errorMsg && (
                <div className="status-alert error" role="alert">
                  <span>✕ {errorMsg}</span>
                </div>
              )}
              <button type="submit" className="btn-arcade btn-start" disabled={busy}>
                {busy ? '설정 중...' : '닉네임 확정 후 오락실 입장 ▶'}
              </button>
            </form>
          </section>
        ) : (
          /* 3) Personal code login */
          <section className="cabinet-modal-card" aria-labelledby="code-heading">
            <div style={{ marginBottom: 8 }}>
              <span className="cabinet-badge-type">신규입사자 상시 개인 플레이</span>
            </div>
            <h1 id="code-heading" style={{ margin: '4px 0 8px', fontSize: 24 }}>
              LS전선 Way 오락실 입장
            </h1>
            <p className="instruction-text" style={{ marginTop: 0 }}>
              안내받은 12자리 <strong>개인 코드</strong>를 입력해 입장하세요. 다른 PC에서도 같은 코드로 진도와 점등한 케이블을 이어갈 수 있습니다.
            </p>

            <form onSubmit={(e) => void handleCodeSubmit(e)} style={{ display: 'grid', gap: 12 }}>
              <label htmlFor="personal-code-input" style={{ fontWeight: 700, fontSize: 14 }}>
                개인 코드 (XXXX-XXXX-XXXX)
              </label>
              <input
                id="personal-code-input"
                type="text"
                className="arcade-input mono-num"
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
                className="btn-arcade btn-start"
                disabled={busy || codeInput.trim().length < 4}
                style={{ fontSize: 16, padding: '11px 16px' }}
              >
                {busy ? '코드 확인 중...' : 'INSERT CODE · 오락실 입장 ▶'}
              </button>
            </form>

            {sampleInfo?.isSampleEnvironment && sampleInfo.virtualSamples.length > 0 && (
              <div
                style={{
                  marginTop: 18,
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: '#131a26',
                  border: '1px dashed rgba(255, 189, 100, 0.45)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-warn)', marginBottom: 8 }}>
                  ▲ {sampleInfo.sampleNotice}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {sampleInfo.virtualSamples.map((sample) => (
                    <button
                      key={sample.rosterRef}
                      type="button"
                      className="btn-arcade btn-compact"
                      onClick={() => {
                        playArcadeSfx('select')
                        setCodeInput(formatParticipantCode(sample.code))
                      }}
                    >
                      <span className="mono-num">{sample.code}</span>
                      <span style={{ color: 'var(--text-muted)' }}>({sample.description})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
