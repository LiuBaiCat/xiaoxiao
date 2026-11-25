import type { MatchGame, Move, Special } from './types';
import type { Match } from './matches';
import { activeIndices, addScore, cloneBoard, event, isActive, neighbors, obstacleProgress, pointOf, progress } from './board';

type Hit = { matched: boolean; colors: Set<number>; all: boolean; force: boolean };
export type Wave = { matches?: Match[]; combo?: Move; hammer?: number; triggerSpecial?: number; suppressFrozenSpecials?: boolean; specialBudget?: number };
export type WaveResult = { poisonCleared: boolean; removed: number[]; triggeredSpecials: number };
/** Resolve a single simultaneous wave. All decisions about locks and old effects use its immutable starting board. */
export function resolveWave(game: MatchGame, wave: Wave): WaveResult {
  const before = cloneBoard(game.board);
  const active = activeIndices(game);
  const hits = new Map<number, Hit>();
  const overrides = new Map<number, Special>();
  const triggered = new Set<number>();
  const creations = new Map<number, Special>();
  const iceOnly = new Set<number>();
  const pending: number[] = [];
  function hit(i: number, colors: number[] | null = [], matched = false, force = false): void {
    if (!isActive(game, i) || !before[i].ground) return;
    let value = hits.get(i);
    if (!value) { value = { matched: false, colors: new Set(), all: false, force: false }; hits.set(i, value); pending.push(i); }
    const wasMatched = value.matched;
    value.matched ||= matched; value.all ||= colors === null; value.force ||= force;
    colors?.forEach(c => value!.colors.add(c));
    if (matched && !wasMatched) pending.push(i);
  }
  function recordSpecial(i: number, special: Special): void {
    progress(game, { type: 'special', special }); addScore(game, 50);
    event(game, 'special', [i], { special });
  }
  function largestColor(): number | undefined {
    const counts = new Map<number, number>();
    for (const i of active) {
      const p = before[i].piece;
      if (p && p.special !== 'bird') counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  }
  function colorHit(kind: number | undefined): void {
    if (kind === undefined) return;
    for (const i of active) if (before[i].piece?.kind === kind && before[i].piece?.special !== 'bird') hit(i, [kind]);
  }
  function area(at: number, shape: Special | 'three-lines' | 'square' | 'cross', colors: number[] | null): void {
    if (shape === 'bird') { colorHit(largestColor()); return; }
    const centre = pointOf(game.level, at);
    for (const i of active) {
      const p = pointOf(game.level, i), dr = Math.abs(p.row - centre.row), dc = Math.abs(p.col - centre.col);
      const selected = shape === 'row' ? dr === 0 : shape === 'column' ? dc === 0 : shape === 'bomb' ? dr + dc <= 2
        : shape === 'three-lines' ? dr <= 1 || dc <= 1 : shape === 'square' ? dr <= 2 && dc <= 2 : dr === 0 || dc === 0;
      if (selected) hit(i, colors);
    }
  }
  for (const match of wave.matches ?? []) {
    if (match.special && match.at !== undefined) creations.set(match.at, match.special);
    for (const i of match.cells) hit(i, before[i].piece?.special === 'bird' ? [] : [before[i].piece!.kind], true);
  }
  if (wave.hammer !== undefined) {
    const i = wave.hammer, c = before[i];
    if (c.lock) hit(i);
    else if (c.ice > 0) iceOnly.add(i);
    else hit(i, c.piece && c.piece.special !== 'bird' ? [c.piece.kind] : [], false, true);
  }
  if (wave.triggerSpecial !== undefined) {
    const i = wave.triggerSpecial;
    const special = before[i]?.piece?.special;
    if (!special || before[i].ice > 0 || before[i].lock || before[i].blocker) return { poisonCleared: false, removed: [], triggeredSpecials: 0 };
    if (wave.specialBudget !== undefined && wave.specialBudget < 1) return { poisonCleared: false, removed: [], triggeredSpecials: 0 };
    triggered.add(i); recordSpecial(i, special); hit(i);
    area(i, special, before[i].piece && special !== 'bird' ? [before[i].piece.kind] : []);
  }
  if (wave.combo) {
    const { from, to } = wave.combo;
    const a = before[from].piece!, b = before[to].piece!;
    const birdAt = a.special === 'bird' ? from : b.special === 'bird' ? to : undefined;
    if (a.special === 'bird' && b.special === 'bird') {
      for (const i of [from, to]) { triggered.add(i); recordSpecial(i, 'bird'); }
      for (const i of active) hit(i, null);
    } else if (birdAt !== undefined) {
      const partnerAt = birdAt === from ? to : from;
      const partner = before[partnerAt].piece!;
      triggered.add(birdAt); recordSpecial(birdAt, 'bird'); hit(birdAt, [partner.kind]);
      if (partner.special) {
        for (const i of active) {
          const p = before[i].piece;
          if (!p || p.special === 'bird' || p.kind !== partner.kind) continue;
          if (!before[i].lock) {
            // Replacing an old special suppresses its previous effect, not merely its picture.
            overrides.set(i, partner.special);
            game.board[i].piece = { ...p, special: partner.special };
          }
          hit(i, [partner.kind]);
        }
      } else colorHit(partner.kind);
      hit(partnerAt, [partner.kind]);
    } else {
      const colors = [a.kind, b.kind];
      for (const i of [from, to]) {
        triggered.add(i); recordSpecial(i, before[i].piece!.special!); hit(i, colors);
      }
      const lines = [a.special, b.special].filter(s => s === 'row' || s === 'column').length;
      area(to, lines === 2 ? 'cross' : lines === 1 ? 'three-lines' : 'square', colors);
    }
  }
  // Expand old effects before applying any damage: overlapping rays cannot penetrate a lock in the same wave.
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const i = pending[cursor], c = before[i], h = hits.get(i)!;
    const special = overrides.get(i) ?? c.piece?.special;
    if (!special || triggered.has(i) || c.lock && !h.matched || wave.suppressFrozenSpecials && c.ice > 0) continue;
    if (wave.specialBudget !== undefined && triggered.size >= wave.specialBudget) {
      hits.delete(i);
      continue;
    }
    triggered.add(i); recordSpecial(i, special);
    area(i, special, c.piece ? [c.piece.kind] : []);
  }
  const removed: number[] = [], obstacleCells = new Set<number>();
  let poisonCleared = false;
  for (const [i, h] of hits) {
    const old = before[i], cell = game.board[i];
    if (old.lock) {
      cell.lock = null; obstacleCells.add(i); obstacleProgress(game, old.lock.type, 1);
      if (!h.matched) continue;
    }
    if (!old.piece || creations.has(i)) continue;
    cell.piece = null; removed.push(i);
    if (old.piece.special !== 'bird') progress(game, { type: 'collect', kind: old.piece.kind });
    addScore(game, 10);
    if (old.ice > 0) { cell.ice--; obstacleCells.add(i); obstacleProgress(game, 'ice', Number(cell.ice === 0)); }
  }
  for (const i of iceOnly) {
    game.board[i].ice--; obstacleCells.add(i); obstacleProgress(game, 'ice', Number(game.board[i].ice === 0));
  }
  const adjacent = new Map<number, Set<number>>();
  for (const i of removed) for (const j of neighbors(game, i)) {
    if (!adjacent.has(j)) adjacent.set(j, new Set());
    const p = before[i].piece!;
    if (p.special !== 'bird') adjacent.get(j)!.add(p.kind);
  }
  for (const i of active) {
    const blocker = before[i].blocker;
    if (!blocker) continue;
    const direct = hits.get(i), near = adjacent.get(i);
    let damage = false;
    if (blocker.type === 'gift') damage = !!(direct?.force || direct?.all || direct?.colors.has(blocker.color) || near?.has(blocker.color));
    else if (blocker.type === 'crystal') damage = !!direct || !!near?.has(blocker.colors[blocker.index]);
    else damage = !!direct || !!near;
    if (!damage) continue;
    obstacleCells.add(i);
    if (blocker.type === 'snow' && blocker.layers > 1) {
      game.board[i].blocker = { type: 'snow', layers: blocker.layers - 1 };
      obstacleProgress(game, 'snow', 0);
    } else {
      game.board[i].blocker = null;
      obstacleProgress(game, blocker.type, 1);
      if (blocker.type === 'poison') poisonCleared = true;
      if (blocker.type === 'gift') game.tools[blocker.reward.tool] += blocker.reward.count;
    }
  }
  for (const [i, special] of creations) {
    game.board[i].piece = { ...before[i].piece!, special };
  }
  if (removed.length) event(game, 'clear', removed);
  if (obstacleCells.size) event(game, 'obstacle', [...obstacleCells]);
  // Creation is an animation event, but goals count triggering, not manufacturing, an effect.
  for (const [i, special] of creations) event(game, 'special', [i], { special });
  return { poisonCleared, removed, triggeredSpecials: triggered.size };
}
