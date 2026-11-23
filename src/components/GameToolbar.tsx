import type { ReactNode } from 'react';
import type { Action, GameState } from '../game/machine';
import { Icon } from './Icon';

export function GameToolbar({ game, dispatch, onHome, children }: { game: GameState; dispatch: (action: Action) => void; onHome: () => void; children: ReactNode }) {
  const blocked = game.phase !== 'playing' || !!game.animation;
  return <div className="game-toolbar" role="toolbar" aria-label="游戏操作">
    <div className="tool-actions">
      <button className="button tool-button hint-button" aria-label={`提示一下，剩余${game.unlimited ? '无限' : game.resources.hints}次`} disabled={blocked || !!game.hint || (!game.unlimited && game.resources.hints === 0)} onClick={() => dispatch({ type: 'HINT' })}>
        <Icon name="bulb" /><span className="full-label">提示一下</span><span className="short-label">提示</span><span className="button-count">{game.unlimited ? '∞' : game.resources.hints}</span>
      </button>
      <button className="button tool-button extend-button" aria-label={`加时 30秒，剩余${game.unlimited ? '无限' : game.resources.extensions}次`} disabled={blocked || (!game.unlimited && game.resources.extensions === 0)} onClick={() => dispatch({ type: 'EXTEND' })}>
        <Icon name="clock" /><span className="full-label">加时 30秒</span><span className="short-label">+30秒</span><span className="button-count">{game.unlimited ? '∞' : game.resources.extensions}</span>
      </button>
      <button className="button tool-button pause-button" aria-label="暂停休息" disabled={game.phase !== 'playing'} onClick={() => dispatch({ type: 'PAUSE' })}>
        <Icon name="pause" /><span className="full-label">暂停休息</span><span className="short-label">暂停</span>
      </button>
      <button className="button tool-button home-button" aria-label="返回首页" onClick={onHome}><Icon name="home" /><span className="full-label">返回首页</span><span className="short-label">首页</span></button>
    </div>
    <div className="toolbar-settings">{children}</div>
  </div>;
}
