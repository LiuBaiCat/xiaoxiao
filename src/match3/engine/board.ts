import type { Cell, EarnedStars, GameEvent, Goal, Level, MatchGame, Obstacle, Piece, Point, Special } from './types';

export const LIMITS = { waves: 100, autoWaves: 64, autoSpecials: 24, events: 8192, gravity: 250000, shuffle: 64, search: 200000 } as const;
export const DEFAULT_SEED = 0x6d2b79f5;
export class EngineError extends Error {}
export const indexOf = (level: Level, p: Point) => p.row * level.width + p.col;
export const pointOf = (level: Level, i: number): Point => ({ row: Math.floor(i / level.width), col: i % level.width });
export function activeIndices(game: MatchGame): number[] {
  const stage = game.level.stages[game.stageIndex];
  if (!stage) throw new EngineError('当前阶段不存在，请检查关卡。');
  return Array.from({ length: stage.rows * game.level.width }, (_, i) => stage.startRow * game.level.width + i);
}
export function isActive(game: MatchGame, i: number): boolean {
  const stage = game.level.stages[game.stageIndex];
  return Number.isInteger(i) && !!stage && i >= stage.startRow * game.level.width && i < (stage.startRow + stage.rows) * game.level.width;
}
export function neighbors(game: MatchGame, i: number): number[] {
  const { row, col } = pointOf(game.level, i);
  return [[row - 1, col], [row, col - 1], [row, col + 1], [row + 1, col]]
    .filter(([r, c]) => c >= 0 && c < game.level.width && r >= 0 && r < game.level.height)
    .map(([r, c]) => r * game.level.width + c).filter(j => isActive(game, j) && game.board[j].ground);
}
export function movable(game: MatchGame, i: number): boolean {
  const c = game.board[i];
  return isActive(game, i) && !!c?.ground && !!c.piece && c.ice === 0 && !c.blocker && !c.lock;
}
export function cloneBoard(board: Cell[]): Cell[] {
  return board.map(c => ({ ...c, piece: c.piece ? { ...c.piece } : null, lock: c.lock ? { ...c.lock } : null,
    blocker: c.blocker ? c.blocker.type === 'gift' ? { ...c.blocker, reward: { ...c.blocker.reward } }
      : c.blocker.type === 'crystal' ? { ...c.blocker, colors: [...c.blocker.colors] } : { ...c.blocker } : null }));
}
export function draftGame(game: MatchGame): MatchGame {
  return { ...game, board: cloneBoard(game.board), tools: { ...game.tools }, goalProgress: { ...game.goalProgress }, events: [], note: '' };
}
export function snapshotLevel(level: Level, seed: number): Level {
  const copy: Level = JSON.parse(JSON.stringify(level));
  copy.seed = seed;
  function freeze(value: unknown): void {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  }
  freeze(copy);
  return copy;
}
// An LCG has a full 32-bit period, including seed zero. No Math.random or ambient clock is used.
export function randomInt(game: MatchGame, size: number): number {
  if (!Number.isInteger(size) || size <= 0) throw new EngineError('随机候选为空，请检查关卡。');
  game.rng = (Math.imul(game.rng, 1664525) + 1013904223) >>> 0;
  return Math.floor((game.rng / 0x100000000) * size);
}
export function newPiece(game: MatchGame): Piece {
  return { id: game.nextId++, kind: game.level.palette[randomInt(game, game.level.palette.length)] };
}
export function event(game: MatchGame, type: GameEvent['type'], cells: number[], extra: Partial<GameEvent> = {}): void {
  if (game.events.length >= LIMITS.events) throw new EngineError('本次结算超过动画预算，操作已撤销，请重试或编辑关卡。');
  game.events.push({ ...extra, type, cells: [...new Set(cells)], board: cloneBoard(game.board), score: game.score });
}
export function activeGoals(game: MatchGame): Goal[] {
  return [...game.level.goals, ...(game.level.stages[game.stageIndex]?.goals ?? [])];
}
type Progress = { type: 'collect'; kind: number } | { type: 'clear'; obstacle: Obstacle; layers: number; objects: number }
  | { type: 'special'; special: Special } | { type: 'score'; amount: number };
export function progress(game: MatchGame, fact: Progress): void {
  for (const goal of activeGoals(game)) {
    let amount = 0;
    if (goal.type === 'collect' && fact.type === 'collect' && goal.kind === fact.kind) amount = 1;
    if (goal.type === 'clear' && fact.type === 'clear' && goal.obstacle === fact.obstacle) amount = fact[goal.unit];
    if (goal.type === 'special' && fact.type === 'special' && goal.special === fact.special) amount = 1;
    if (goal.type === 'score' && fact.type === 'score') amount = fact.amount;
    if (amount) game.goalProgress[goal.id] = (game.goalProgress[goal.id] ?? 0) + amount;
  }
}
export function addScore(game: MatchGame, amount: number): void {
  game.score += amount;
  progress(game, { type: 'score', amount });
}
export function obstacleProgress(game: MatchGame, obstacle: Obstacle, objects: number): void {
  progress(game, { type: 'clear', obstacle, layers: 1, objects });
  addScore(game, 20);
}
export const goalsMet = (game: MatchGame, goals: Goal[]) => goals.every(g => (game.goalProgress[g.id] ?? 0) >= g.count);
export function starsForScore(level: Level, score: number): 0 | EarnedStars {
  const [one, two, three] = level.starThresholds;
  return score >= three ? 3 : score >= two ? 2 : score >= one ? 1 : 0;
}
