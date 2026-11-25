import type { MatchGame } from './types';
import { activeIndices, cloneBoard, event, neighbors, randomInt } from './board';

/** Exactly one environmental tick for an effective ordinary turn, never for tools or each cascade. */
export function advanceEnvironment(game: MatchGame, poisonCleared: boolean): void {
  const active = activeIndices(game);
  const start = cloneBoard(game.board);
  const reserved = new Set<number>();
  const changed: number[] = [];
  // Targets use the pre-tick occupancy; a fur cannot move twice or follow another fur into a vacated cell.
  for (const i of active) {
    if (start[i].lock?.type !== 'fur') continue;
    const candidates = neighbors(game, i).filter(j => start[j].piece && !start[j].lock && !start[j].blocker && !reserved.has(j));
    if (!candidates.length) continue;
    const to = candidates[randomInt(game, candidates.length)];
    game.board[to].lock = game.board[i].lock;
    game.board[i].lock = null;
    reserved.add(to); changed.push(i, to);
  }
  for (const i of active) {
    const blocker = game.board[i].blocker;
    if (blocker?.type !== 'crystal') continue;
    game.board[i].blocker = { ...blocker, index: (blocker.index + 1) % blocker.colors.length };
    changed.push(i);
  }
  if (!poisonCleared) {
    const candidates = [...new Set(active.filter(i => game.board[i].blocker?.type === 'poison')
      .flatMap(i => neighbors(game, i)).filter(i => game.board[i].piece && !game.board[i].lock && !game.board[i].blocker))].sort((a, b) => a - b);
    if (candidates.length) {
      const to = candidates[randomInt(game, candidates.length)];
      // Swallowing is not elimination: no collect credit, explosion, ice damage or adjacent damage.
      game.board[to].piece = null;
      game.board[to].blocker = { type: 'poison' };
      changed.push(to);
    }
  }
  if (changed.length) event(game, 'obstacle', changed);
}
export function poisonedOut(game: MatchGame): boolean {
  const cells = activeIndices(game).map(i => game.board[i]).filter(c => c.ground && (!c.blocker || c.blocker.type === 'poison'));
  return cells.length > 0 && cells.every(c => c.blocker?.type === 'poison');
}
