import type { GameId, GameMode, GameRunEvent, RunEndReason } from '../domain/types'
import { RunnerGame } from './runner/RunnerGame'
import { ShooterGame } from './shooter/ShooterGame'
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
    case 'shooter':
      return (
        <ShooterGame
          seed={props.seed}
          mode={props.mode}
          contentVersion={props.contentVersion}
          isPractice={props.isPractice}
          onPracticeSuccess={props.onPracticeSuccess}
          onPracticeTimeUp={props.onPracticeTimeUp}
          onFinishRound={props.onFinishRound}
        />
      )
    case 'runner':
      return (
        <RunnerGame
          seed={props.seed}
          mode={props.mode}
          contentVersion={props.contentVersion}
          isPractice={props.isPractice}
          onPracticeSuccess={props.onPracticeSuccess}
          onPracticeTimeUp={props.onPracticeTimeUp}
          onFinishRound={props.onFinishRound}
        />
      )
  }
}
