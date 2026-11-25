import type { MatchGame, Move, Special } from './types';
import { activeIndices, indexOf, isActive, movable, neighbors, pointOf } from './board';

export type Run = { cells: number[]; direction: 'row' | 'column' };
export type Match = { cells: number[]; runs: Run[]; special?: Special; at?: number };
export function matchKind(game: MatchGame, i: number): number | undefined {
  const c = game.board[i];
  return isActive(game, i) && c?.ground && !c.blocker && c.piece && c.piece.special !== 'bird' ? c.piece.kind : undefined;
}
export function detectMatches(game: MatchGame, move?: Move): Match[] {
  const runs: Run[] = [];
  for (const i of activeIndices(game)) {
    const kind = matchKind(game, i);
    if (kind === undefined) continue;
    const { col } = pointOf(game.level, i);
    for (const direction of ['row', 'column'] as const) {
      const step = direction === 'row' ? 1 : game.level.width;
      if ((direction !== 'row' || col > 0) && matchKind(game, i - step) === kind) continue;
      const cells: number[] = [];
      for (let j = i; matchKind(game, j) === kind; j += step) {
        if (direction === 'row' && Math.floor(j / game.level.width) !== Math.floor(i / game.level.width)) break;
        cells.push(j);
      }
      if (cells.length >= 3) runs.push({ cells, direction });
    }
  }
  const groups: Match[] = [];
  for (const run of runs) {
    const overlapping = groups.filter(g => run.cells.some(i => g.cells.includes(i)));
    const cells = [...new Set([...run.cells, ...overlapping.flatMap(g => g.cells)])].sort((a, b) => a - b);
    for (const g of overlapping) groups.splice(groups.indexOf(g), 1);
    groups.push({ cells, runs: [run, ...overlapping.flatMap(g => g.runs)] });
  }
  for (const group of groups) {
    const long = group.runs.filter(r => r.cells.length >= 5);
    const intersections = group.cells.filter(i => group.runs.some(r => r.direction === 'row' && r.cells.includes(i))
      && group.runs.some(r => r.direction === 'column' && r.cells.includes(i)));
    const four = group.runs.find(r => r.cells.length === 4);
    const sweep = four && (four.direction === 'row' ? 'column' : 'row');
    group.special = long.length ? 'bird' : intersections.length ? 'bomb' : sweep;
    if (!group.special) continue;
    const eligible = (long.length ? [...new Set(long.flatMap(r => r.cells))] : group.cells)
      .filter(i => movable(game, i)).sort((a, b) => a - b);
    // Intersection cells are the meaningful centre of L/T matches; otherwise prefer the swap landing cell.
    const candidates = group.special === 'bomb' ? eligible.filter(i => intersections.includes(i)) : eligible;
    const preferred = candidates.length ? candidates : eligible;
    group.at = [move?.to, move?.from].find(i => i !== undefined && preferred.includes(i)) ?? preferred[0];
  }
  return groups.sort((a, b) => a.cells[0] - b.cells[0]);
}
export function isCombination(game: MatchGame, move: Move): boolean {
  const a = game.board[move.from]?.piece;
  const b = game.board[move.to]?.piece;
  return !!a && !!b && (!!a.special && !!b.special || a.special === 'bird' || b.special === 'bird');
}
export function swapReason(game: MatchGame, move: Move, free = false): string | null {
  if (game.board[move.from]?.ice || game.board[move.to]?.ice) return '冰层冻结了这只动物，破冰后才能交换。';
  if (!movable(game, move.from) || !movable(game, move.to)) return '只能交换当前区域中未锁定的动物。';
  if (!neighbors(game, move.from).includes(move.to)) return '只能交换正交相邻的两个动物，传送门不改变交换距离。';
  if (!free && game.level.ropes.some(r => {
    const a = indexOf(game.level, r.from), b = indexOf(game.level, r.to);
    return a === move.from && b === move.to || a === move.to && b === move.from;
  })) return '这条边有绳子，请改用自由交换或选择其他位置。';
  const a = game.board[move.from].piece!, b = game.board[move.to].piece!;
  if (!isCombination(game, move) && a.kind === b.kind && a.special === b.special) return '这两个动物相同，交换没有效果，不消耗次数。';
  return null;
}
export function swapPieces(game: MatchGame, move: Move): void {
  const a = game.board[move.from], b = game.board[move.to];
  [a.piece, b.piece] = [b.piece, a.piece];
}
export function wouldMatch(game: MatchGame, move: Move): boolean {
  if (swapReason(game, move)) return false;
  if (isCombination(game, move)) return true;
  // Use a shallow board copy: querying a hint must not mutate a game, including frozen saved games.
  const copy = { ...game, board: game.board.slice() };
  copy.board[move.from] = { ...game.board[move.from], piece: game.board[move.to].piece };
  copy.board[move.to] = { ...game.board[move.to], piece: game.board[move.from].piece };
  return detectMatches(copy).some(m => m.cells.includes(move.from) || m.cells.includes(move.to));
}
export function findMove(game: MatchGame): Move | null {
  for (const from of activeIndices(game)) {
    if (!movable(game, from)) continue;
    for (const to of neighbors(game, from)) {
      if (to <= from) continue;
      const move = { from, to };
      if (wouldMatch(game, move)) return move;
    }
  }
  return null;
}
