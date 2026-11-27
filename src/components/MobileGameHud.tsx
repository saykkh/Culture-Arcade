import type { ReactNode } from 'react'
import { PASSING_SCORE } from '../domain/rules'

export function MobileGameHud({
  remaining,
  score,
  practice,
  practiceCleared,
  detail,
}: {
  remaining: string
  score: number
  practice: boolean
  practiceCleared?: boolean
  detail?: ReactNode
}) {
  const cleared = score >= PASSING_SCORE
  return (
    <div className="mobile-game-hud">
      <span>남은 시간 <strong className="mono-num">{remaining}</strong></span>
      <span>점수 <strong className="mono-num">{score}점</strong></span>
      <span className={cleared || practiceCleared ? 'mobile-game-clear' : undefined}>
        {practice ? (practiceCleared ? '✓ 연습 성공' : '연습 중') : cleared ? '⚡ 통과권' : `목표 ${PASSING_SCORE}점`}
      </span>
      {detail && <span className="mobile-game-detail">{detail}</span>}
    </div>
  )
}
