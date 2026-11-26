import { useCallback, useEffect, useState } from 'react'
import { isValidGameId } from './domain/rules'
import { arcadeApi, type ParticipantMeResponse } from './lib/api'
import { setArcadeBgmTrack } from './lib/sound'
import { AdminPage } from './pages/AdminPage'
import { ArcadeLobbyPage } from './pages/ArcadeLobbyPage'
import { CodeEntryPage } from './pages/CodeEntryPage'
import { GameCabinetPage } from './pages/GameCabinetPage'
import { LeaderboardPage } from './pages/LeaderboardPage'

function useLocationState() {
  const [loc, setLoc] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }))

  useEffect(() => {
    const onPopState = () => {
      setLoc({ pathname: window.location.pathname, search: window.location.search })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((to: string) => {
    if (window.location.pathname + window.location.search === to) return
    window.history.pushState(null, '', to)
    setLoc({ pathname: window.location.pathname, search: window.location.search })
  }, [])

  return { pathname: loc.pathname, search: loc.search, navigate }
}

export function App() {
  const { pathname, search, navigate } = useLocationState()
  const [me, setMe] = useState<ParticipantMeResponse | null>(null)
  const [booting, setBooting] = useState(true)
  const [justLitGameId, setJustLitGameId] = useState<string | null>(null)

  const refreshMe = useCallback(async () => {
    try {
      const data = await arcadeApi.getMe()
      setMe(data)
    } catch {
      setMe(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    void arcadeApi
      .getMe()
      .then((data) => {
        if (active) setMe(data)
      })
      .catch(() => {
        if (active) setMe(null)
      })
      .finally(() => {
        if (active) setBooting(false)
      })
    return () => {
      active = false
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await arcadeApi.logout().catch(() => null)
    setMe(null)
    setJustLitGameId(null)
    navigate('/')
  }, [navigate])

  // Switch arcade BGM track automatically by current screen / active game!
  useEffect(() => {
    if (booting) return
    if (pathname === '/admin') {
      setArcadeBgmTrack('none')
      return
    }
    const participantReady = Boolean(me && !me.beforeStartDate && !me.requiresNickname)
    if (!participantReady || pathname === '/') {
      setArcadeBgmTrack('landing')
      return
    }
    const gm = pathname.match(/^\/games\/([a-z0-9-]+)$/)
    if (gm && isValidGameId(gm[1]!)) {
      setArcadeBgmTrack(gm[1]!)
      return
    }
    setArcadeBgmTrack('lobby')
  }, [booting, me, pathname])

  if (booting) {
    return (
      <div className="arcade-shell">
        <div className="center-card-wrap">
          <div className="cabinet-modal-card" style={{ textAlign: 'center' }}>
            <div className="sign-brand" style={{ justifyContent: 'center', marginBottom: 8 }}>
              <span className="sign-brand-ko">LS전선</span>
              <span className="sign-brand-en">WAY ARCADE</span>
            </div>
            <div style={{ color: 'var(--text-muted)' }}>오락실 전원을 켜는 중...</div>
          </div>
        </div>
      </div>
    )
  }

  // Admin Console is independently accessible via /admin
  if (pathname === '/admin') {
    return <AdminPage me={me} onNavigate={navigate} />
  }

  // Require ready participant session for /arcade, /games/*, /leaderboard
  const participantReady = Boolean(me && !me.beforeStartDate && !me.requiresNickname)
  if (!participantReady || pathname === '/') {
    return (
      <CodeEntryPage
        me={me}
        onAuthenticated={refreshMe}
        onNavigate={navigate}
        onLogout={handleLogout}
      />
    )
  }

  if (pathname === '/leaderboard') {
    const qs = new URLSearchParams(search)
    return (
      <LeaderboardPage
        me={me!}
        initialGameId={qs.get('game')}
        onNavigate={navigate}
        onLogout={handleLogout}
      />
    )
  }

  const gameMatch = pathname.match(/^\/games\/([a-z0-9-]+)$/)
  if (gameMatch && isValidGameId(gameMatch[1]!)) {
    return (
      <GameCabinetPage
        key={gameMatch[1]!}
        gameId={gameMatch[1]!}
        me={me!}
        onRunConfirmed={async (litId) => {
          if (litId) setJustLitGameId(litId)
          await refreshMe()
        }}
        onNavigate={navigate}
        onLogout={handleLogout}
      />
    )
  }

  return (
    <ArcadeLobbyPage
      key={`${me!.participantId}:${me!.recommendation.targetGameId ?? 'all'}`}
      me={me!}
      justLitGameId={justLitGameId}
      onRefreshMe={refreshMe}
      onNavigate={navigate}
      onLogout={handleLogout}
    />
  )
}

export default App
