import type { GameId, GameMode, GameRunEvent, RunEndReason } from '../domain/types'
import { SnakeGame } from './snake/SnakeGame'
import { TypingGame } from './typing/TypingGame'

export interface ActiveGameRenderProps {
  gameId: GameId
  seed: number
  mode: GameMode
  contentVersion: string
  isPractice: boolean
  onPracticeSuccess: () => void
  onPracticeTimeUp: () => void
  onFinishRound: (result: {
    events: GameRunEvent[]
    activeDurationMs: number
    endReason: RunEndReason
    renderMode?: '3d' | 'simplified' | 'panel-list'
  }) => void
}

export function ActiveGameSlot(props: ActiveGameRenderProps) {
  switch (props.gameId) {
    case 'typing':
      return (
        <TypingGame
          seed={props.seed}
          mode={props.mode}
          contentVersion={props.contentVersion}
          isPractice={props.isPractice}
          onPracticeSuccess={props.onPracticeSuccess}
          onPracticeTimeUp={props.onPracticeTimeUp}
          onFinishRound={props.onFinishRound}
        />
      )
    case 'snake':
      return (
        <SnakeGame
          seed={props.seed}
          mode={props.mode}
          contentVersion={props.contentVersion}
          isPractice={props.isPractice}
          onPracticeSuccess={props.onPracticeSuccess}
          onPracticeTimeUp={props.onPracticeTimeUp}
          onFinishRound={props.onFinishRound}
        />
      )
    default:
      return null
  }
}
