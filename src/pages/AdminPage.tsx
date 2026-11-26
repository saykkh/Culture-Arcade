import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArcadeHeader } from '../components/ArcadeHeader'
import { DUE_STATUS_LABELS, LEARNING_STATUS_LABELS, toKstDateString } from '../domain/rules'
import type { ParticipantDueStatus, ParticipantLearningStatus } from '../domain/types'
import { arcadeApi, ClientApiError, type ParticipantMeResponse } from '../lib/api'

interface AdminPageProps {
  me: ParticipantMeResponse | null
  onNavigate: (path: string) => void
}

export function AdminPage({ me, onNavigate }: AdminPageProps) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [isSampleEnv, setIsSampleEnv] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)

  const [tab, setTab] = useState<'progress' | 'insights'>('progress')

  // Filters
  const [startFrom, setStartFrom] = useState('')
  const [startTo, setStartTo] = useState('')
  const [search, setSearch] = useState('')
  const [learningStatus, setLearningStatus] = useState<ParticipantLearningStatus | ''>('')
  const [dueStatus, setDueStatus] = useState<ParticipantDueStatus | ''>('')

  // Data
  const [progressData, setProgressData] = useState<
    Awaited<ReturnType<typeof arcadeApi.getAdminParticipants>> | null
  >(null)
  const [insightsData, setInsightsData] = useState<
    Awaited<ReturnType<typeof arcadeApi.getAdminLearningInsights>> | null
  >(null)
  const [groupByCore, setGroupByCore] = useState(false)

  // New participant registration form
  const [newRosterRef, setNewRosterRef] = useState('')
  const [newStartDate, setNewStartDate] = useState(() => toKstDateString())
  const [newDueDate, setNewDueDate] = useState('')
  const [issuedBanner, setIssuedBanner] = useState<{
    rosterRef: string
    code: string
    generation: number
  } | null>(null)
  const [opMessage, setOpMessage] = useState<string | null>(null)

  // Inline row editing modal state
  const [editingRow, setEditingRow] = useState<{
    id: string
    rosterRef: string
    canEditStartDate: boolean
    availableFromDate: string
    recommendedDueDate: string
    nickname: string
  } | null>(null)

  useEffect(() => {
    void arcadeApi
      .getAdminSession()
      .then((res) => {
        setAuthenticated(res.authenticated)
        setIsSampleEnv(res.isSampleEnvironment)
      })
      .catch(() => setAuthenticated(false))
  }, [])

  const loadProgress = useCallback(async () => {
    const res = await arcadeApi.getAdminParticipants({
      startFrom: startFrom || undefined,
      startTo: startTo || undefined,
      search: search || undefined,
      learningStatus,
      dueStatus,
    })
    setProgressData(res)
  }, [startFrom, startTo, search, learningStatus, dueStatus])

  useEffect(() => {
    if (!authenticated) return
    let active = true
    if (tab === 'progress') {
      void arcadeApi
        .getAdminParticipants({
          startFrom: startFrom || undefined,
          startTo: startTo || undefined,
          search: search || undefined,
          learningStatus,
          dueStatus,
        })
        .then((res) => {
          if (active) setProgressData(res)
        })
    } else {
      void arcadeApi.getAdminLearningInsights().then((res) => {
        if (active) setInsightsData(res)
      })
    }
    return () => {
      active = false
    }
  }, [authenticated, tab, startFrom, startTo, search, learningStatus, dueStatus])

  const handleAdminLogin = async (e: FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    try {
      await arcadeApi.loginAdmin(passwordInput)
      setAuthenticated(true)
      setPasswordInput('')
    } catch (err) {
      setAuthError(err instanceof ClientApiError ? err.message : '인증 실패')
    }
  }

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault()
    setOpMessage(null)
    try {
      const created = await arcadeApi.registerAdminParticipant({
        rosterRef: newRosterRef,
        availableFromDate: newStartDate,
        recommendedDueDate: newDueDate || null,
      })
      setIssuedBanner({
        rosterRef: created.rosterRef,
        code: created.issuedCodeOnce,
        generation: created.generation,
      })
      setNewRosterRef('')
      await loadProgress()
    } catch (err) {
      setOpMessage(err instanceof ClientApiError ? err.message : '등록 실패')
    }
  }

  const handleReissue = async (participantId: string) => {
    setOpMessage(null)
    try {
      const res = await arcadeApi.reissueAdminParticipantCode(participantId)
      setIssuedBanner({
        rosterRef: res.rosterRef,
        code: res.issuedCodeOnce,
        generation: res.generation,
      })
      await loadProgress()
    } catch (err) {
      setOpMessage(err instanceof ClientApiError ? err.message : '재발급 실패')
    }
  }

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editingRow) return
    setOpMessage(null)
    try {
      await arcadeApi.updateAdminParticipant(editingRow.id, {
        availableFromDate: editingRow.canEditStartDate
          ? editingRow.availableFromDate
          : undefined,
        recommendedDueDate: editingRow.recommendedDueDate || null,
        nickname: editingRow.nickname.trim() ? editingRow.nickname.trim() : undefined,
      })
      setEditingRow(null)
      await loadProgress()
    } catch (err) {
      setOpMessage(err instanceof ClientApiError ? err.message : '수정 실패')
    }
  }

  const buildCsvDownloadUrl = () => {
    const qs = new URLSearchParams()
    if (startFrom) qs.set('startFrom', startFrom)
    if (startTo) qs.set('startTo', startTo)
    if (search) qs.set('search', search)
    if (learningStatus) qs.set('learningStatus', learningStatus)
    if (dueStatus) qs.set('dueStatus', dueStatus)
    return `/api/admin/participants/export.csv?${qs.toString()}`
  }

  return (
    <div className="arcade-shell">
      <ArcadeHeader me={me} onNavigate={onNavigate} />

      {authenticated === false ? (
        <main className="center-card-wrap">
          <section className="cabinet-modal-card">
            <h1 style={{ marginTop: 0, fontSize: 22 }}>🔒 교육 담당자 운영 콘솔 인증</h1>
            <p className="instruction-text">
              참가자 일정·코드 발급·진도 CSV 및 전체 오답 경향 조회는 관리자 인증 후에만 제공됩니다.
            </p>
            {isSampleEnv && (
              <div className="status-alert warn" style={{ marginBottom: 12 }}>
                <span>
                  개발·Preview 환경 기본 비밀번호 안내:{' '}
                  <code className="mono-num">ARCADE_ADMIN_PASSWORD</code> 미설정 시 개발용 기본값으로 시험할 수 있습니다.
                </span>
              </div>
            )}
            <form onSubmit={(e) => void handleAdminLogin(e)} style={{ display: 'grid', gap: 12 }}>
              <input
                type="password"
                className="arcade-input"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="관리자 비밀번호 입력"
                autoFocus
              />
              {authError && (
                <div className="status-alert error">
                  <span>✕ {authError}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn-arcade btn-start">
                  관리자 로그인
                </button>
                <button
                  type="button"
                  className="btn-arcade"
                  onClick={() => onNavigate(me ? '/arcade' : '/')}
                >
                  돌아가기
                </button>
              </div>
            </form>
          </section>
        </main>
      ) : authenticated ? (
        <main style={{ display: 'grid', gap: 12 }}>
          <section className="lobby-status-bar">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className={`btn-arcade ${tab === 'progress' ? 'btn-start' : ''}`}
                onClick={() => setTab('progress')}
              >
                참가자 진도 · 일정 · CSV
              </button>
              <button
                type="button"
                className={`btn-arcade ${tab === 'insights' ? 'btn-start' : ''}`}
                onClick={() => setTab('insights')}
              >
                학습 결과 (전체 오답 경향)
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn-arcade btn-compact"
                onClick={() => onNavigate(me ? '/arcade' : '/')}
              >
                오락실 화면으로
              </button>
              <button
                type="button"
                className="btn-arcade btn-compact"
                onClick={() => {
                  void arcadeApi.logoutAdmin().then(() => setAuthenticated(false))
                }}
              >
                관리자 로그아웃
              </button>
            </div>
          </section>

          {issuedBanner && (
            <section className="status-alert clear" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>🔑 [{issuedBanner.rosterRef}] 개인 코드 발급 완료 (세대 #{issuedBanner.generation})</strong>
                <span style={{ marginLeft: 12 }}>
                  원문 코드:{' '}
                  <strong className="mono-num" style={{ fontSize: 18 }}>
                    {issuedBanner.code}
                  </strong>{' '}
                  (이 화면을 닫으면 서버에서는 다시 조회할 수 없으니 지금 배부 명단에 기록하세요.)
                </span>
              </div>
              <button
                type="button"
                className="btn-arcade btn-compact"
                onClick={() => setIssuedBanner(null)}
              >
                확인 · 닫기
              </button>
            </section>
          )}

          {opMessage && (
            <div className="status-alert warn" style={{ justifyContent: 'space-between' }}>
              <span>▲ {opMessage}</span>
              <button
                type="button"
                className="btn-arcade btn-compact"
                onClick={() => setOpMessage(null)}
              >
                닫기
              </button>
            </div>
          )}

          {tab === 'progress' && progressData && (
            <>
              {/* Pilot KPI Cards */}
              <section
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: 10,
                }}
              >
                <div className="lobby-status-bar" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>시작일 도달 대상 접속률</span>
                  <strong className="mono-num" style={{ fontSize: 20 }}>
                    {progressData.kpis.accessRatePct !== null
                      ? `${progressData.kpis.accessRatePct}%`
                      : '-'}{' '}
                    ({progressData.kpis.accessedCount}/{progressData.kpis.startedEligibleCount}명)
                  </strong>
                </div>
                <div className="lobby-status-bar" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>접속자 대비 필수 5종 완료율</span>
                  <strong className="mono-num" style={{ fontSize: 20, color: 'var(--accent-clear)' }}>
                    {progressData.kpis.completionRatePct !== null
                      ? `${progressData.kpis.completionRatePct}%`
                      : '-'}{' '}
                    ({progressData.kpis.completedCount}/{progressData.kpis.accessedCount}명)
                  </strong>
                </div>
                <div className="lobby-status-bar" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>권장일 경과 대상 기한 내 완료율</span>
                  <strong className="mono-num" style={{ fontSize: 20 }}>
                    {progressData.kpis.onTimeCompletionRatePct !== null
                      ? `${progressData.kpis.onTimeCompletionRatePct}%`
                      : '-'}{' '}
                    ({progressData.kpis.onTimeCompletedInPastDueCount}/{progressData.kpis.pastDueEligibleCount}명)
                  </strong>
                </div>
                <div className="lobby-status-bar" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>이수자 유효 플레이 시간 중위값 (목표 20분)</span>
                  <strong className="mono-num" style={{ fontSize: 20 }}>
                    {progressData.kpis.medianEffectiveDurationMs !== null
                      ? `${Math.round(progressData.kpis.medianEffectiveDurationMs / 1000)}초`
                      : '-'}
                  </strong>
                </div>
              </section>

              {/* Register Participant + Filter Bar */}
              <section className="lobby-status-bar" style={{ flexWrap: 'wrap', gap: 14 }}>
                <form
                  onSubmit={(e) => void handleRegister(e)}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
                >
                  <strong>신규 등록:</strong>
                  <input
                    type="text"
                    className="arcade-input"
                    style={{ width: 140, padding: '6px 10px', fontSize: 14 }}
                    placeholder="관리번호 (예: HR-101)"
                    value={newRosterRef}
                    onChange={(e) => setNewRosterRef(e.target.value)}
                    required
                  />
                  <label style={{ fontSize: 13 }}>
                    시작일{' '}
                    <input
                      type="date"
                      className="arcade-input"
                      style={{ width: 145, padding: '5px 8px', fontSize: 13 }}
                      value={newStartDate}
                      onChange={(e) => setNewStartDate(e.target.value)}
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    권장완료일{' '}
                    <input
                      type="date"
                      className="arcade-input"
                      style={{ width: 145, padding: '5px 8px', fontSize: 13 }}
                      value={newDueDate}
                      onChange={(e) => setNewDueDate(e.target.value)}
                    />
                  </label>
                  <button type="submit" className="btn-arcade btn-compact btn-start">
                    + 참가자 등록 및 코드 발급
                  </button>
                </form>

                <a href={buildCsvDownloadUrl()} className="btn-arcade btn-compact">
                  ⬇ 현재 필터 CSV 내보내기 (UTF-8 BOM)
                </a>
              </section>

              {/* Filters */}
              <section className="lobby-status-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
                <input
                  type="text"
                  className="arcade-input"
                  style={{ width: 190, padding: '6px 10px', fontSize: 14 }}
                  placeholder="관리번호 또는 닉네임 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <label style={{ fontSize: 13 }}>
                  시작일 범위{' '}
                  <input
                    type="date"
                    className="arcade-input"
                    style={{ width: 140, padding: '5px 8px', fontSize: 13 }}
                    value={startFrom}
                    onChange={(e) => setStartFrom(e.target.value)}
                  />{' '}
                  ~{' '}
                  <input
                    type="date"
                    className="arcade-input"
                    style={{ width: 140, padding: '5px 8px', fontSize: 13 }}
                    value={startTo}
                    onChange={(e) => setStartTo(e.target.value)}
                  />
                </label>
                <select
                  className="arcade-input"
                  style={{ width: 155, padding: '6px 8px', fontSize: 13 }}
                  value={learningStatus}
                  onChange={(e) =>
                    setLearningStatus(e.target.value as ParticipantLearningStatus | '')
                  }
                >
                  <option value="">학습 상태 전체</option>
                  {Object.entries(LEARNING_STATUS_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  className="arcade-input"
                  style={{ width: 145, padding: '6px 8px', fontSize: 13 }}
                  value={dueStatus}
                  onChange={(e) => setDueStatus(e.target.value as ParticipantDueStatus | '')}
                >
                  <option value="">기한 상태 전체</option>
                  {Object.entries(DUE_STATUS_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </section>

              {editingRow && (
                <form
                  onSubmit={(e) => void handleSaveEdit(e)}
                  className="lobby-status-bar"
                  style={{ borderColor: 'var(--accent-select)', flexWrap: 'wrap', gap: 10 }}
                >
                  <strong>[{editingRow.rosterRef}] 일정·닉네임 편집</strong>
                  <label style={{ fontSize: 13 }}>
                    닉네임{' '}
                    <input
                      type="text"
                      className="arcade-input"
                      style={{ width: 150, padding: '5px 8px', fontSize: 13 }}
                      value={editingRow.nickname}
                      onChange={(e) =>
                        setEditingRow({ ...editingRow, nickname: e.target.value })
                      }
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    시작일{' '}
                    <input
                      type="date"
                      className="arcade-input"
                      style={{ width: 145, padding: '5px 8px', fontSize: 13 }}
                      value={editingRow.availableFromDate}
                      disabled={!editingRow.canEditStartDate}
                      title={
                        !editingRow.canEditStartDate
                          ? '첫 플레이 이후에는 시작일을 변경할 수 없습니다'
                          : undefined
                      }
                      onChange={(e) =>
                        setEditingRow({ ...editingRow, availableFromDate: e.target.value })
                      }
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    권장완료일{' '}
                    <input
                      type="date"
                      className="arcade-input"
                      style={{ width: 145, padding: '5px 8px', fontSize: 13 }}
                      value={editingRow.recommendedDueDate}
                      onChange={(e) =>
                        setEditingRow({ ...editingRow, recommendedDueDate: e.target.value })
                      }
                    />
                  </label>
                  <button type="submit" className="btn-arcade btn-compact btn-start">
                    저장
                  </button>
                  <button
                    type="button"
                    className="btn-arcade btn-compact"
                    onClick={() => setEditingRow(null)}
                  >
                    취소
                  </button>
                </form>
              )}

              {/* Participant Progress Table */}
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>관리번호</th>
                      <th>닉네임</th>
                      <th>시작일 / 권장일</th>
                      <th>학습 상태</th>
                      <th>기한 상태</th>
                      <th>필수 진도</th>
                      <th>타자</th>
                      <th>뱀</th>
                      <th>슈팅</th>
                      <th>레이싱</th>
                      <th>핀볼</th>
                      <th>보너스</th>
                      <th>시도수</th>
                      <th>최초완료</th>
                      <th>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progressData.participants.map((p) => (
                      <tr key={p.id}>
                        <td className="mono-num">
                          {p.rosterRef}{' '}
                          {p.isVirtualSample && (
                            <span style={{ fontSize: 11, color: 'var(--accent-warn)' }}>[샘플]</span>
                          )}
                        </td>
                        <td>{p.nickname ?? '-'}</td>
                        <td className="mono-num" style={{ fontSize: 12 }}>
                          {p.availableFromDate} / {p.recommendedDueDate ?? '미설정'}
                        </td>
                        <td>{p.learningStatusLabel}</td>
                        <td>{p.dueStatusLabel}</td>
                        <td className="mono-num">
                          <strong>{p.requiredClearedCount}/5</strong>
                        </td>
                        {(['typing', 'snake', 'shooter', 'racing', 'pinball'] as const).map(
                          (gid) => {
                            const g = p.requiredGames[gid]
                            return (
                              <td key={gid} className="mono-num" style={{ fontSize: 12 }}>
                                {g?.cleared ? '✓' : '·'} {g?.standardBestScore ?? '-'}
                              </td>
                            )
                          },
                        )}
                        <td>{p.bonusCleared ? '◉ 완료' : '-'}</td>
                        <td className="mono-num">{p.totalFinalizedAttempts}</td>
                        <td className="mono-num" style={{ fontSize: 12 }}>
                          {p.onboardingCompletedAt
                            ? new Date(p.onboardingCompletedAt).toLocaleDateString('ko-KR')
                            : '-'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button
                              type="button"
                              className="btn-arcade btn-compact"
                              onClick={() =>
                                setEditingRow({
                                  id: p.id,
                                  rosterRef: p.rosterRef,
                                  canEditStartDate: p.canEditStartDate,
                                  availableFromDate: p.availableFromDate,
                                  recommendedDueDate: p.recommendedDueDate ?? '',
                                  nickname: p.nickname ?? '',
                                })
                              }
                            >
                              일정/닉네임
                            </button>
                            <button
                              type="button"
                              className="btn-arcade btn-compact"
                              onClick={() => void handleReissue(p.id)}
                            >
                              코드 재발급
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Retry Summary Table */}
              <details
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 10,
                  padding: '10px 14px',
                }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                  게임·모드별 첫 도전 / 클리어 전 재도전 / 클리어 후 재도전 / 배지 이후 집계 보기
                </summary>
                <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>게임</th>
                        <th>모드</th>
                        <th>첫 도전 (시도/인원)</th>
                        <th>클리어 전 재도전 (시도/인원)</th>
                        <th>클리어 후 재도전 (시도/인원)</th>
                        <th>배지 이후 재도전 (시도/인원)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {progressData.retryStats.map((row) => (
                        <tr key={`${row.gameId}-${row.mode}`}>
                          <td>{row.gameTitle}</td>
                          <td>{row.mode === 'standard' ? '정규' : '지원'}</td>
                          <td className="mono-num">
                            {row.firstAttempt.attempts}건 / {row.firstAttempt.uniqueParticipants}명
                          </td>
                          <td className="mono-num">
                            {row.retryBeforeClear.attempts}건 / {row.retryBeforeClear.uniqueParticipants}명
                          </td>
                          <td className="mono-num">
                            {row.retryAfterClear.attempts}건 / {row.retryAfterClear.uniqueParticipants}명
                          </td>
                          <td className="mono-num">
                            {row.afterBadge.attempts}건 / {row.afterBadge.uniqueParticipants}명
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}

          {tab === 'insights' && insightsData && (
            <>
              <section className="lobby-status-bar">
                <div>
                  <strong>전체 응답자 핵심가치 연결 오답 경향</strong>
                  <span style={{ marginLeft: 10, color: 'var(--text-muted)' }}>
                    콘텐츠 버전: {insightsData.contentVersion} · 응답 인원 {insightsData.sampleThreshold}명 미만 문항은 개인 식별 방지를 위해 ‘표본 부족’으로 표시됩니다.
                  </span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={groupByCore}
                    onChange={(e) => setGroupByCore(e.target.checked)}
                  />
                  핵심가치(C·O·R·E)별로 묶어 보기
                </label>
              </section>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>게임</th>
                      <th>콘텐츠 버전</th>
                      <th>연결 핵심가치</th>
                      <th>문항 / 단서</th>
                      <th>응답 인원</th>
                      <th>첫 선택 오답 인원</th>
                      <th>오답률</th>
                      <th>첫 노출 시간 초과 인원 (슈팅)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...insightsData.items]
                      .sort((a, b) =>
                        groupByCore ? a.coreCode.localeCompare(b.coreCode) : 0,
                      )
                      .map((item) => (
                        <tr key={`${item.gameId}-${item.itemId}`}>
                          <td>{item.gameTitle}</td>
                          <td className="mono-num">{item.contentVersion}</td>
                          <td>
                            <strong>{item.coreCode}</strong> · {item.coreName}
                          </td>
                          <td style={{ maxWidth: 420 }}>{item.prompt}</td>
                          <td className="mono-num">
                            {item.selectionSampleSufficient ? `${item.responderCount}명` : '표본 부족'}
                          </td>
                          <td className="mono-num">
                            {item.selectionSampleSufficient ? `${item.wrongCount}명` : '표본 부족'}
                          </td>
                          <td className="mono-num">
                            {item.selectionSampleSufficient ? `${item.wrongRatePct}%` : '표본 부족'}
                          </td>
                          <td className="mono-num">
                            {!item.hasTimeoutColumn
                              ? '-'
                              : item.timeoutSampleSufficient
                                ? `${item.firstExposureTimeoutCount}명`
                                : '표본 부족'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </main>
      ) : null}
    </div>
  )
}
