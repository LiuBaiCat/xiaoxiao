import type { MatchGame, Piece } from './types';
import { activeIndices, EngineError, indexOf, LIMITS, movable, neighbors, randomInt } from './board';
import { detectMatches, findMove, matchKind } from './matches';

type Constraint = Map<number, (p: Piece) => boolean>;
const valid = (g: MatchGame) => detectMatches(g).length === 0 && findMove(g) !== null;
function makesThree(g: MatchGame, i: number): boolean {
  const kind = matchKind(g, i);
  if (kind === undefined) return false;
  const width = g.level.width;
  for (const step of [1, width]) for (let offset = -2; offset <= 0; offset++) {
    const start = i + offset * step;
    if (step === 1 && Math.floor(start / width) !== Math.floor((start + 2) / width)) continue;
    if ([start, start + step, start + 2 * step].every(j => matchKind(g, j) === kind)) return true;
  }
  return false;
}
function edgeAllowed(g: MatchGame, a: number, b: number): boolean {
  return !g.level.ropes.some(r => {
    const x = indexOf(g.level, r.from), y = indexOf(g.level, r.to);
    return a === x && b === y || a === y && b === x;
  });
}
// A legal exchange either combines specials, or moves one colour into a length-three window.
// Enumerating these witnesses makes the fallback deterministic rather than hoping more shuffles work.
function* witnesses(g: MatchGame, available: Piece[], generate: boolean): Generator<Constraint> {
  const active = new Set(activeIndices(g));
  const colors = [...g.level.palette].sort((a, b) => a - b)
    .filter(kind => generate || available.filter(p => p.kind === kind && p.special !== 'bird').length >= 3);
  const indices = [...active].filter(i => g.board[i].ground && !g.board[i].blocker && !g.board[i].lock && g.board[i].ice === 0);
  const moveable = new Set(indices);
  const hasBird = available.some(p => p.special === 'bird');
  const hasPair = available.filter(p => p.special).length >= 2;
  for (const from of indices) for (const to of neighbors(g, from)) {
    if (!moveable.has(to) || !edgeAllowed(g, from, to)) continue;
    if (hasBird) yield new Map([[from, p => p.special === 'bird']]);
    if (hasPair) yield new Map([[from, p => !!p.special], [to, p => !!p.special]]);
    for (const step of [1, g.level.width]) for (let offset = -2; offset <= 0; offset++) {
      const first = to + offset * step;
      const triple = [first, first + step, first + step * 2];
      if (triple.includes(from) || step === 1 && Math.floor(first / g.level.width) !== Math.floor((first + 2) / g.level.width)) continue;
      if (!triple.every(i => active.has(i) && g.board[i].ground && !g.board[i].blocker)) continue;
      for (const kind of colors) {
        const constraints: Constraint = new Map([[from, p => p.kind === kind && p.special !== 'bird'],
          [to, p => p.kind !== kind || p.special === 'bird']]);
        for (const i of triple) if (i !== to) constraints.set(i, p => p.kind === kind && p.special !== 'bird');
        yield constraints;
      }
    }
  }
}
type Bucket = { pieces: Piece[]; remaining: number };
function deterministic(g: MatchGame, slots: number[], original: Piece[], generate: boolean): boolean {
  const mutable = new Set(slots);
  const buckets: Bucket[] = [];
  if (generate) {
    for (const kind of [...g.level.palette].sort((a, b) => a - b)) buckets.push({ pieces: [{ id: 0, kind }], remaining: slots.length });
  } else {
    for (const piece of original) {
      let bucket = buckets.find(b => b.pieces[0].kind === piece.kind && b.pieces[0].special === piece.special);
      if (!bucket) { bucket = { pieces: [], remaining: 0 }; buckets.push(bucket); }
      bucket.pieces.push(piece); bucket.remaining++;
    }
  }
  const available = [...original, ...activeIndices(g).filter(i => !mutable.has(i)).flatMap(i => g.board[i].piece ? [g.board[i].piece!] : [])];
  let budget: number = LIMITS.search;
  const originalAt = new Map(slots.map((i, n) => [i, original[n]]));
  for (const constraints of witnesses(g, available, generate)) {
    if (--budget <= 0) break;
    if ([...constraints].some(([i, accepts]) => !mutable.has(i) && (!g.board[i].piece || !accepts(g.board[i].piece!)))) continue;
    for (const i of slots) g.board[i].piece = null;
    const order = [...slots].sort((a, b) => Number(constraints.has(b)) - Number(constraints.has(a)) || a - b);
    for (const b of buckets) b.remaining = generate ? slots.length : b.pieces.length;
    function search(depth: number): boolean {
      if (--budget <= 0) return false;
      if (depth === order.length) return valid(g);
      const i = order[depth];
      const candidates = [...buckets].sort((a, b) => b.remaining - a.remaining || a.pieces[0].kind - b.pieces[0].kind);
      for (const b of candidates) {
        if (!b.remaining) continue;
        const p = generate ? { ...b.pieces[0], id: originalAt.get(i)!.id } : b.pieces[b.remaining - 1];
        if (constraints.has(i) && !constraints.get(i)!(p)) continue;
        g.board[i].piece = p;
        if (!makesThree(g, i)) {
          b.remaining--;
          if (search(depth + 1)) return true;
          b.remaining++;
        }
        g.board[i].piece = null;
        if (budget <= 0) return false;
      }
      return false;
    }
    if (search(0)) return true;
    for (let n = 0; n < slots.length; n++) g.board[slots[n]].piece = original[n];
  }
  for (let n = 0; n < slots.length; n++) g.board[slots[n]].piece = original[n];
  return false;
}
/** Mutates a transaction draft only; never alters tiles, kinds, specials or locked animals. */
export function shuffleMovable(game: MatchGame, attempts: number = LIMITS.shuffle): boolean {
  const slots = activeIndices(game).filter(i => movable(game, i));
  const original = slots.map(i => game.board[i].piece!);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const pieces = original.slice();
    for (let n = pieces.length - 1; n > 0; n--) {
      const j = randomInt(game, n + 1);
      [pieces[n], pieces[j]] = [pieces[j], pieces[n]];
    }
    slots.forEach((i, n) => { game.board[i].piece = pieces[n]; });
    if (valid(game)) return true;
  }
  slots.forEach((i, n) => { game.board[i].piece = original[n]; });
  return deterministic(game, slots, original, false);
}
/** Fill unconfigured animals without changing any authored piece (including its special). */
export function generateStage(game: MatchGame, fixed: Set<number>): boolean {
  const slots = activeIndices(game).filter(i => game.board[i].ground && !game.board[i].blocker && !fixed.has(i));
  const pieces = slots.map(() => ({ id: game.nextId++, kind: game.level.palette[0] }));
  for (let attempt = 0; attempt < LIMITS.shuffle; attempt++) {
    for (const i of slots) game.board[i].piece = null;
    let filled = true;
    for (let n = 0; n < slots.length; n++) {
      const i = slots[n];
      const start = randomInt(game, game.level.palette.length);
      let chosen = false;
      for (let c = 0; c < game.level.palette.length; c++) {
        game.board[i].piece = { ...pieces[n], kind: game.level.palette[(start + c) % game.level.palette.length] };
        if (!makesThree(game, i)) { chosen = true; break; }
      }
      if (!chosen) { filled = false; break; }
    }
    if (filled && valid(game)) return true;
  }
  slots.forEach((i, n) => { game.board[i].piece = pieces[n]; });
  return deterministic(game, slots, pieces, true);
}
