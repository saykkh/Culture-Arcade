import type { GameId, GameMode, GameRunEvent, RunEndReason } from '../domain/types'
import { ControlRoomGame } from './control-room/ControlRoomGame'
import { PinballGame } from './pinball/PinballGame'
import { RacingGame } from './racing/RacingGame'
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
    case 'racing':
      return (
        <RacingGame
          seed={props.seed}
          mode={props.mode}
          contentVersion={props.contentVersion}
          isPractice={props.isPractice}
          onPracticeSuccess={props.onPracticeSuccess}
          onPracticeTimeUp={props.onPracticeTimeUp}
          onFinishRound={props.onFinishRound}
        />
      )
    case 'pinball':
      return (
        <PinballGame
          seed={props.seed}
          mode={props.mode}
          contentVersion={props.contentVersion}
          isPractice={props.isPractice}
          onPracticeSuccess={props.onPracticeSuccess}
          onPracticeTimeUp={props.onPracticeTimeUp}
          onFinishRound={props.onFinishRound}
        />
      )
    case 'control-room':
      return (
        <ControlRoomGame
          seed={props.seed}
          mode={props.mode}
          contentVersion={props.contentVersion}
          onFinishRound={props.onFinishRound}
        />
      )
  }
}
