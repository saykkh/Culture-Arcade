import { useEffect, useState } from 'react'
import { PASSING_SCORE } from '../domain/rules'
import { useArcadePreferences } from '../lib/preferences'

type MascotMood = 'idle' | 'cheer' | 'fever' | 'danger' | 'crown' | 'victory' | 'retry'

interface CoreBotMascotProps {
  mood?: MascotMood
  size?: number
  speech?: string
  accentColor?: string
}

const MOOD_COLORS: Record<MascotMood, string> = {
  idle: '#43E7F2',
  cheer: '#B9F66C',
  fever: '#FF6B9E',
  danger: '#FFBD64',
  crown: '#FFD43B',
  victory: '#B9F66C',
  retry: '#FFBD64',
}

/**
 * LS전선 WAY ARCADE 공식 마스코트 캐릭터 '코어봇 (C.O.R.E.-BOT)'
 * - 로비 가이드, 브리핑 환영, 인게임 실시간 감정 리액션(평상시/응원/피버/위기/마스터왕관), 결과 축하에 등장
 */
export function CoreBotMascot({
  mood = 'idle',
  size = 58,
  speech,
  accentColor,
}: CoreBotMascotProps) {
  const { prefs } = useArcadePreferences()
  const glow = accentColor ?? MOOD_COLORS[mood]
  const celebrates = mood === 'fever' || mood === 'crown' || mood === 'victory'
  const animClass = {
    idle: 'mascot-float',
    cheer: 'mascot-float',
    fever: 'mascot-float-fast',
    danger: 'mascot-shake',
    crown: 'mascot-dance',
    victory: 'mascot-float-fast',
    retry: 'mascot-float',
  }[mood]

  return (
    <div className="corebot" data-motion={prefs.reduceMotion ? 'reduced' : undefined}>
      <div
        className={animClass}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          filter: `drop-shadow(0 0 10px ${glow}66)`,
        }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          {/* Crown on Master / Clear */}
          {mood === 'crown' && (
            <polygon
              points="28,20 36,6 50,16 64,6 72,20"
              fill="#FFD43B"
              stroke="#FFF3B0"
              strokeWidth="2"
            />
          )}

          {/* Twin Cyber Antennas */}
          <line x1="34" y1="24" x2="26" y2="11" stroke={glow} strokeWidth="3" strokeLinecap="round" />
          <circle cx="25" cy="10" r="4" fill={glow} />
          <line x1="66" y1="24" x2="74" y2="11" stroke={glow} strokeWidth="3" strokeLinecap="round" />
          <circle cx="75" cy="10" r="4" fill={glow} />

          {/* Articulated Left & Right Arms */}
          {celebrates || mood === 'cheer' || mood === 'retry' ? (
            <>
              <g className={mood === 'cheer' ? 'mascot-wave' : undefined}>
                <path d="M22,56 Q8,38 14,24" fill="none" stroke={glow} strokeWidth="6" strokeLinecap="round" />
                <circle cx="14" cy="23" r="5" fill="#F2F6FB" />
              </g>
              <path d="M78,56 Q92,38 86,24" fill="none" stroke={glow} strokeWidth="6" strokeLinecap="round" />
              <circle cx="86" cy="23" r="5" fill="#F2F6FB" />
            </>
          ) : (
            <>
              <path d="M22,56 Q10,62 15,74" fill="none" stroke={glow} strokeWidth="6" strokeLinecap="round" />
              <circle cx="15" cy="74" r="4.5" fill="#F2F6FB" />
              <path d="M78,56 Q90,62 85,74" fill="none" stroke={glow} strokeWidth="6" strokeLinecap="round" />
              <circle cx="85" cy="74" r="4.5" fill="#F2F6FB" />
            </>
          )}

          {/* Robot Head Helmet */}
          <rect
            x="22"
            y="22"
            width="56"
            height="42"
            rx="14"
            fill="#142238"
            stroke={glow}
            strokeWidth="3"
          />

          {/* LED Visor Screen */}
          <rect x="29" y="30" width="42" height="24" rx="8" fill="#070E1A" />

          {/* Expressive LED Eyes */}
          {celebrates ? (
            <path fill={glow} d="M40 33l2.5 6.5L49 42l-6.5 2.5L40 51l-2.5-6.5L31 42l6.5-2.5z M60 33l2.5 6.5L69 42l-6.5 2.5L60 51l-2.5-6.5L51 42l6.5-2.5z" />
          ) : mood === 'danger' ? (
            <>
              <text x="40" y="47" fontSize="14" fontWeight="900" textAnchor="middle" fill="#FFBD64">&gt;</text>
              <text x="60" y="47" fontSize="14" fontWeight="900" textAnchor="middle" fill="#FFBD64">&lt;</text>
              <ellipse cx="73" cy="34" rx="3" ry="5" fill="#43E7F2" />
            </>
          ) : mood === 'cheer' || mood === 'retry' ? (
            <>
              <path d="M34,44 Q40,36 46,44" fill="none" stroke="#B9F66C" strokeWidth="3.2" strokeLinecap="round" />
              <path d="M54,44 Q60,36 66,44" fill="none" stroke="#B9F66C" strokeWidth="3.2" strokeLinecap="round" />
            </>
          ) : (
            <g className="mascot-blink">
              <circle cx="40" cy="42" r="4.8" fill="#43E7F2" />
              <circle cx="60" cy="42" r="4.8" fill="#43E7F2" />
              <circle cx="41.5" cy="40.5" r="1.6" fill="#FFFFFF" />
              <circle cx="61.5" cy="40.5" r="1.6" fill="#FFFFFF" />
            </g>
          )}

          {/* Robot Torso with C·O·R·E Reactor */}
          <rect
            x="30"
            y="66"
            width="40"
            height="22"
            rx="8"
            fill="#182942"
            stroke={glow}
            strokeWidth="2.5"
          />
          <circle cx="50" cy="77" r="6.5" fill={glow} />
          <circle cx="50" cy="77" r="3" fill="#FFFFFF" />

          {/* Hover Thruster Flame underneath */}
          <polygon points="42,89 50,99 58,89" fill={glow} opacity="0.85" />

          {(mood === 'victory' || mood === 'crown') && (
            <g className="mascot-prop" transform="translate(79 1)">
              <path d="M4 4H1v5q0 4 6 4M16 4h3v5q0 4-6 4" fill="none" stroke="#FFF3B0" strokeWidth="2" />
              <path d="M4 2h12v7q0 4-5 6v4h5v3H4v-3h5v-4q-5-2-5-6z" fill="#FFD43B" stroke="#FFF3B0" />
            </g>
          )}
          {mood === 'retry' && (
            <path className="mascot-prop" d="M86 25l-3-3 5-9a6 6 0 0 1 5-9l-2 5 3 2 4-4a6 6 0 0 1-7 8z" fill="#DAE9F7" stroke="#FFBD64" />
          )}
        </svg>
      </div>

      {speech && (
        <div
          className="corebot-speech"
          style={{
            position: 'relative',
            padding: '7px 13px',
            borderRadius: '12px 12px 12px 3px',
            background: 'rgba(13, 23, 38, 0.92)',
            border: `1.5px solid ${glow}88`,
            boxShadow: `0 0 16px ${glow}24`,
            fontSize: 13.5,
            fontWeight: 700,
            color: '#F2F6FB',
            lineHeight: 1.4,
          }}
        >
          {speech}
        </div>
      )}
    </div>
  )
}

/**
 * 인게임 10점 통과 돌파 순간 상단에 슬라이드 인되는 다이내믹 네온 배너
 */
export function PassMilestoneBanner({
  score,
  scoreCanDrop = false,
}: {
  score: number
  scoreCanDrop?: boolean
}) {
  const { prefs } = useArcadePreferences()
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 1700)
    return () => window.clearTimeout(timer)
  }, [])
  if (!visible) return null
  return (
    <div className="milestone-pass-banner" data-motion={prefs.reduceMotion ? 'reduced' : undefined}>
      <span role="status">⚡ CABLE CONNECTED · {PASSING_SCORE}점 통과 기준 달성!</span>
      <span style={{ fontWeight: 600, color: '#e6ffe0' }}>
        현재 <strong>{score}점</strong> · {scoreCanDrop
          ? '장애물을 피해 점수를 지키고 최고 기록에 도전하세요!'
          : '남은 시간 동안 TOP 10에 도전하세요!'}
      </span>
    </div>
  )
}
