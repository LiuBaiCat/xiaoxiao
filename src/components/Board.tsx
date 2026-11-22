import { type CSSProperties, type KeyboardEvent } from 'react';
import { AnimalIcon, animals } from './AnimalIcon';
import type { Action, GameState } from '../game/machine';
import type { Point } from '../engine/types';

const same = (a: Point | null | undefined, b: Point) => a?.row === b.row && a.col === b.col;

export function Board({ game, dispatch }: { game: GameState; dispatch: (action: Action) => void }) {
  const displayed = game.animation?.board ?? game.board;
  const rows = displayed.length;
  const cols = displayed[0].length;
  const active = game.phase === 'playing';
  const handleArrow = (event: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => {
    const directions: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    let r = row + direction[0], c = col + direction[1];
    while (r >= 0 && r < rows && c >= 0 && c < cols) {
      if (displayed[r][c]) {
        event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-cell="${r}-${c}"]`)?.focus();
        return;
      }
      r += direction[0]; c += direction[1];
    }
  };
  return <div className="board-fit" role="region" aria-label="10行14列棋盘，完整显示">
    <div className={`board-surface ${!active ? 'board-obscured' : ''}`} style={{ '--cols': cols, '--rows': rows } as CSSProperties} aria-label="连连看棋盘">
      <div className="board-grid" aria-hidden={!active}>
        {displayed.flatMap((row, r) => row.map((tile, c) => {
          if (!tile) return null;
          const point = { row: r, col: c };
          const selected = same(game.selected, point);
          const hinted = same(game.hint?.from, point) || same(game.hint?.to, point);
          const connected = !!game.animation && (same(game.animation.path[0], point) || same(game.animation.path.at(-1), point));
          return <button key={tile.id} type="button"
            className={`tile ${selected ? 'is-selected' : ''} ${hinted ? 'is-hinted' : ''} ${connected ? 'is-connected' : ''}`}
            style={{ '--row': r, '--col': c, '--animal-bg': animals[tile.kind].background } as CSSProperties}
            data-cell={`${r}-${c}`} data-kind={tile.kind} data-testid={`tile-${tile.id}`}
            disabled={!active || !!game.animation}
            aria-label={`第${r + 1}行第${c + 1}列，${animals[tile.kind].name}${hinted ? '，提示配对' : ''}`}
            title={animals[tile.kind].name}
            aria-pressed={selected}
            onKeyDown={event => handleArrow(event, r, c)}
            onClick={() => dispatch({ type: 'SELECT', point })}>
            <AnimalIcon kind={tile.kind} />
            <span className="animal-name">{animals[tile.kind].name}</span>
            {selected && <span className="selected-mark" aria-hidden="true">✓</span>}
          </button>;
        }))}
        {game.animation && <svg className="connection-line" viewBox={`0 0 ${cols * 100} ${rows * 100}`} preserveAspectRatio="none" aria-hidden="true">
          <polyline points={game.animation.path.map(p => `${(p.col + .5) * 100},${(p.row + .5) * 100}`).join(' ')} />
        </svg>}
      </div>
    </div>
  </div>;
}
