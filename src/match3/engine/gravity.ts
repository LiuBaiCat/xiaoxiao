import type { MatchGame } from './types';
import { activeIndices, EngineError, event, indexOf, isActive, LIMITS, newPiece } from './board';

export type GravityGraph = { order: number[]; next: Map<number, number>; previous: Map<number, number> };
/** Structural graph includes temporarily blocked cells, so clearing a blocker restores its original route. */
export function gravityGraph(game: MatchGame): GravityGraph {
  const nodes = activeIndices(game).filter(i => game.board[i].ground);
  const exits = new Map<number, number>();
  for (const portal of game.level.portals) {
    const from = indexOf(game.level, portal.from), to = indexOf(game.level, portal.to);
    if (!isActive(game, from) && !isActive(game, to)) continue;
    if (!isActive(game, from) || !isActive(game, to) || !game.board[from]?.ground || !game.board[to]?.ground || exits.has(from)) {
      throw new EngineError('传送门必须在同一阶段的地板上，且入口不能重复。');
    }
    exits.set(from, to);
  }
  const next = new Map<number, number>(), previous = new Map<number, number>();
  for (const i of nodes) {
    const below = i + game.level.width;
    const to = exits.get(i) ?? (isActive(game, below) && game.board[below].ground ? below : undefined);
    if (to === undefined) continue;
    if (previous.has(to)) throw new EngineError('下落通路有多个入边，请调整传送门出口。');
    next.set(i, to); previous.set(to, i);
  }
  const order: number[] = [];
  const queue = nodes.filter(i => !previous.has(i));
  for (let p = 0; p < queue.length; p++) {
    const i = queue[p]; order.push(i);
    const to = next.get(i);
    if (to !== undefined) queue.push(to);
  }
  if (order.length !== nodes.length) throw new EngineError('传送门与下落路径构成循环，请编辑关卡。');
  return { order, next, previous };
}
/** Settles a transaction draft; locked or frozen pieces and all floor metadata never move. */
export function applyGravity(game: MatchGame): void {
  const graph = gravityGraph(game);
  const available = (i: number) => {
    const cell = game.board[i];
    return !cell.blocker && !cell.lock && (cell.ice === 0 || !cell.piece);
  };
  const nodes = graph.order.filter(available);
  const next = new Map([...graph.next].filter(([a, b]) => game.board[a].ice === 0 && available(a) && available(b)));
  const incoming = new Set(next.values());
  const sources = game.level.spawnPoints.map(p => indexOf(game.level, p));
  const explicitRoots = sources.filter(i => isActive(game, i) && available(i));
  const iceRoots = nodes.filter(i => {
    const previous = graph.previous.get(i);
    return previous !== undefined && game.board[previous].ice > 0 && !!game.board[previous].piece && !incoming.has(i);
  });
  const roots = [...new Set(sources.length ? [...explicitRoots, ...iceRoots] : nodes.filter(i => !incoming.has(i)))];
  let budget: number = LIMITS.gravity;
  for (;;) {
    let changed = false;
    const falls: { from: number; to: number }[] = [];
    for (let n = nodes.length - 1; n >= 0; n--) {
      if (--budget < 0) throw new EngineError('下落补充超过预算，操作已撤销，请检查入口与传送门。');
      const from = nodes[n], to = next.get(from);
      if (to === undefined || !game.board[from].piece || game.board[to].piece) continue;
      game.board[to].piece = game.board[from].piece;
      game.board[from].piece = null;
      falls.push({ from, to }); changed = true;
    }
    if (falls.length) {
      // Individual endpoints plus a common phase snapshot support both portal and ordinary fall animation.
      for (const fall of falls) event(game, 'fall', [fall.from, fall.to], fall);
    }
    const spawned: number[] = [];
    for (const i of roots) {
      if (game.board[i].piece) continue;
      game.board[i].piece = newPiece(game); spawned.push(i); changed = true;
    }
    if (spawned.length) event(game, 'spawn', spawned);
    if (!changed) break;
  }
  // Explicit sources really are explicit: silently inventing sources would hide an invalid authored layout.
  if (nodes.some(i => !game.board[i].piece)) throw new EngineError('当前下落通路没有补充入口，操作已撤销，请检查 spawnPoints。');
}
