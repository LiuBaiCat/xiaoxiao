import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Cell, MatchGame, Move } from '../engine/types';
import { CellArt, describeCell } from './CellArt';
import type { AnimationFrame } from './animation';

export function Board({ game, frame, selected, hint, disabled, onCell, onSwap }: {
  game: MatchGame; frame: AnimationFrame | null; selected: number | null; hint: Move | null; disabled: boolean;
  onCell: (at: number) => void; onSwap: (from: number, to: number) => void;
}) {
  const { level } = game;
  const stageIndex = frame?.stageIndex ?? game.stageIndex;
  const stage = level.stages[stageIndex];
  const board: Cell[] = frame?.board ?? game.board;
  const start = stage.startRow * level.width;
  const count = stage.rows * level.width;
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ at: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [focused, setFocused] = useState(start);
  useEffect(() => { setFocused(start + board.slice(start, start + count).findIndex(cell => cell.ground)); }, [start, count, level.id]);
  const paused = game.phase === 'paused';

  function key(event: KeyboardEvent<HTMLDivElement>) {
    const offsets: Record<string, number> = { ArrowUp: -level.width, ArrowDown: level.width, ArrowLeft: -1, ArrowRight: 1 };
    const offset = offsets[event.key];
    if (!offset || disabled) return;
    event.preventDefault();
    let next = focused + offset;
    while (next >= start && next < start + count && (Math.abs(offset) !== 1 || Math.floor(next / level.width) === Math.floor(focused / level.width))) {
      if (board[next].ground) {
        setFocused(next);
        root.current?.querySelector<HTMLButtonElement>(`[data-m3-index="${next}"]`)?.focus();
        break;
      }
      next += offset;
    }
  }

  return <div className={`m3-board-space ${paused ? 'm3-board-paused' : ''}`}>
    <div ref={root} className={`m3-board${frame?.type === 'stage' ? ' m3-board-enter' : ''}`} role="grid" aria-label={`消消乐棋盘，第${stageIndex + 1}区域`} aria-busy={!!frame} onKeyDown={key}
      style={{ '--m3-cols': level.width, '--m3-rows': stage.rows } as CSSProperties}>
      {Array.from({ length: stage.rows }, (_, localRow) => <div role="row" className="m3-board-row" key={localRow}>
        {Array.from({ length: level.width }, (_, col) => {
          const at = (stage.startRow + localRow) * level.width + col;
          const cell = board[at];
          const affected = frame?.cells.includes(at);
          const portals = level.portals.flatMap((portal, index) => [
            ...(portal.from.row * level.width + portal.from.col === at ? [{ id: index + 1, end: '入口' }] : []),
            ...(portal.to.row * level.width + portal.to.col === at ? [{ id: index + 1, end: '出口' }] : []),
          ]);
          return <button key={at} type="button" role="gridcell" data-m3-index={at} data-piece-id={cell.piece?.id} data-kind={cell.piece?.kind} data-special={cell.piece?.special} data-obstacle={cell.blocker?.type ?? cell.lock?.type} data-ice={cell.ice}
            className={`m3-cell ${!cell.ground ? 'm3-hole' : ''} ${selected === at ? 'm3-selected' : ''} ${hint?.from === at || hint?.to === at ? 'm3-hint' : ''} ${affected ? `m3-event-${frame!.type}` : ''}`}
            disabled={disabled || !cell.ground} tabIndex={focused === at ? 0 : -1} aria-selected={selected === at}
            aria-label={`第${stage.startRow + localRow + 1}行第${col + 1}列，${paused ? '已暂停' : describeCell(cell)}${portals.map(portal => `，${portal.id}号传送门${portal.end}`).join('')}`}
            style={cell.piece && cell.piece.special !== 'bird' ? { '--m3-kind': cell.piece.kind } as CSSProperties : undefined}
            onFocus={() => setFocused(at)} onClick={() => { if (!suppressClick.current) onCell(at); }}
            onPointerDown={event => { if (!disabled) { drag.current = { at, x: event.clientX, y: event.clientY }; suppressClick.current = false; event.currentTarget.setPointerCapture(event.pointerId); } }}
            onPointerCancel={() => { drag.current = null; }}
            onPointerUp={event => {
              const origin = drag.current; drag.current = null;
              if (!origin || disabled) return;
              const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
              if (Math.hypot(dx, dy) < 12) return;
              suppressClick.current = true;
              window.setTimeout(() => { suppressClick.current = false; }, 0);
              const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-m3-index]');
              const to = target && Number(target.dataset.m3Index) !== origin.at ? Number(target.dataset.m3Index) : origin.at + (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * level.width);
              onSwap(origin.at, to);
            }}>
            {cell.ground && !paused && <><CellArt cell={cell}/>{portals.map(portal => <span className={`m3-portal m3-portal-${portal.end === '入口' ? 'in' : 'out'}`} key={`${portal.id}-${portal.end}`}>{portal.id}{portal.end === '入口' ? '入' : '出'}</span>)}</>}
          </button>;
        })}
      </div>)}
      {!paused && <svg className="m3-edges" viewBox={`0 0 ${level.width * 100} ${stage.rows * 100}`} aria-hidden="true">
        {level.ropes.filter(rope => rope.from.row >= stage.startRow && rope.to.row < stage.startRow + stage.rows).map((rope, index) => {
          const row = Math.min(rope.from.row, rope.to.row) - stage.startRow;
          const col = Math.min(rope.from.col, rope.to.col);
          const horizontal = rope.from.row === rope.to.row;
          const x1 = horizontal ? (col + 1) * 100 : col * 100 + 5;
          const y1 = horizontal ? row * 100 + 5 : (row + 1) * 100;
          return <g key={index}><path d={`M${x1} ${y1} ${horizontal ? `v90` : `h90`}`} stroke="#775932" strokeWidth="9"/><path d={`M${x1} ${y1} ${horizontal ? `v90` : `h90`}`} stroke="#efd5a3" strokeWidth="4" strokeDasharray="6 8"/></g>;
        })}
      </svg>}
    </div>
  </div>;
}
