import { createBoard, ensurePlayable, findMove, remainingPairs } from '../engine/board';
import { applyLayout } from '../engine/layouts';
import { levels } from '../engine/levels';
import { findPath } from '../engine/rules';
import type { Board, Move, Point } from '../engine/types';

export type Phase = 'playing' | 'paused' | 'timeout' | 'won' | 'gameover';
export type Resources = { lives: number; hints: number; extensions: number };
export type GameState = {
  mode: 'normal' | 'test';
  phase: Phase;
  levelId: number;
  board: Board;
  resources: Resources;
  remainingMs: number;
  anchor: number | null;
  moveIndex: number;
  unlocked: number;
  selected: Point | null;
  hint: Move | null;
  hintUntil: number;
  animation: { board: Board; path: Point[]; until: number } | null;
  matchFeedback: { addedMs: number; until: number } | null;
  note: string;
  pauseReason: 'intro' | 'manual' | 'away' | 'restored' | 'upgraded';
  frozen: boolean;
  unlimited: boolean;
};

export type Action =
  | { type: 'TICK' | 'RESUME' | 'HINT' | 'EXTEND' | 'CONTINUE' | 'RETRY' | 'NEXT' | 'AUTO_PAIR' | 'COMPLETE' | 'EXPIRE' }
  | { type: 'SELECT'; point: Point }
  | { type: 'PAUSE'; reason?: 'manual' | 'away' }
  | { type: 'FREEZE' | 'UNLIMITED'; value: boolean };

export const MATCH_BONUS_MS = 3000;

export const baseResources = (): Resources => ({ lives: 5, hints: 3, extensions: 3 });

export function createGame(levelId = 1, mode: GameState['mode'] = 'normal', now = 0, unlocked = 1, resources = baseResources()): GameState {
  const level = levels[levelId - 1];
  return {
    mode, phase: 'paused', levelId, board: createBoard(level.rows, level.cols, level.kinds),
    resources: { ...resources }, remainingMs: level.seconds * 1000, anchor: null,
    moveIndex: 0, unlocked: mode === 'test' ? 12 : Math.max(unlocked, levelId),
    selected: null, hint: null, hintUntil: now, animation: null, matchFeedback: null,
    note: '点一下，再点相同的图案。', pauseReason: 'intro',
    frozen: mode === 'test', unlimited: mode === 'test',
  };
}

function expire(state: GameState): GameState {
  if (state.phase !== 'playing') return state;
  const lives = Math.max(0, state.resources.lives - 1);
  return {
    ...state, resources: { ...state.resources, lives }, remainingMs: 0,
    phase: lives > 0 ? 'timeout' : 'gameover', anchor: null,
    selected: null, hint: null, animation: null, matchFeedback: null, note: '休息一下，不着急。',
  };
}

export function advance(state: GameState, now: number): GameState {
  let next = state;
  if (state.animation && now >= state.animation.until) next = { ...next, animation: null };
  if (state.hint && now >= state.hintUntil) next = { ...next, hint: null };
  if (state.matchFeedback && now >= state.matchFeedback.until) next = { ...next, matchFeedback: null };
  if (state.phase !== 'playing') return next;
  const elapsed = state.anchor === null || state.frozen ? 0 : Math.max(0, now - state.anchor);
  next = { ...next, remainingMs: Math.max(0, state.remainingMs - elapsed), anchor: now };
  return next.remainingMs <= 0 ? expire(next) : next;
}

function finish(state: GameState): GameState {
  if (state.phase !== 'playing' || remainingPairs(state.board) !== 0) return state;
  return {
    ...state, phase: 'won', anchor: null, animation: null, selected: null, hint: null,
    unlocked: Math.max(state.unlocked, Math.min(12, state.levelId + 1)),
    resources: {
      lives: state.resources.lives + 1,
      hints: state.resources.hints + 2,
      extensions: state.resources.extensions + 1,
    },
    note: '真棒，这一关完成了！',
  };
}

function match(state: GameState, from: Point, to: Point, now: number): GameState {
  const path = findPath(state.board, from, to);
  if (!path) return { ...state, selected: to, hint: null, note: '暂时连不上，换一对试试。点错不扣生命。' };
  const removed = state.board.map((row, r) => row.map((tile, c) =>
    (r === from.row && c === from.col) || (r === to.row && c === to.col) ? null : tile));
  const level = levels[state.levelId - 1];
  const shifted = applyLayout(removed, level.layouts[state.moveIndex % level.layouts.length]);
  const deadlocked = remainingPairs(shifted) > 0 && findMove(shifted) === null;
  const lives = state.resources.lives - (deadlocked ? 1 : 0);
  const gameover = lives === 0;
  const addedMs = Math.min(MATCH_BONUS_MS, Math.max(0, level.seconds * 1000 - state.remainingMs));
  return finish({
    ...state, board: deadlocked && !gameover ? ensurePlayable(shifted).board : shifted,
    phase: gameover ? 'gameover' : 'playing', moveIndex: state.moveIndex + 1,
    resources: { ...state.resources, lives }, remainingMs: state.remainingMs + addedMs,
    anchor: gameover ? null : state.anchor, selected: null, hint: null,
    animation: gameover ? null : { board: state.board, path, until: now + 340 },
    matchFeedback: gameover ? null : { addedMs, until: now + 3000 },
    note: gameover ? '没有可连接的图案，扣除1点生命，生命用完了。' : deadlocked ? '没有可连接的图案，扣除1点生命，已重新排列。' : '消除一对，慢慢找下一对。',
  });
}

export function transition(state: GameState, action: Action, now: number): GameState {
  const current = advance(state, now);
  if (action.type === 'TICK') return current;
  if (action.type === 'FREEZE' || action.type === 'UNLIMITED') {
    if (current.mode !== 'test') return current;
    return action.type === 'FREEZE'
      ? { ...current, frozen: action.value, anchor: current.phase === 'playing' ? now : null }
      : { ...current, unlimited: action.value };
  }
  if (action.type === 'PAUSE') {
    return current.phase === 'playing'
      ? { ...current, phase: 'paused', anchor: null, pauseReason: action.reason ?? 'manual', animation: null, matchFeedback: null, selected: null, hint: null }
      : current;
  }
  if (action.type === 'RESUME') {
    return current.phase === 'paused' ? { ...current, phase: 'playing', anchor: now } : current;
  }
  if (action.type === 'CONTINUE') {
    return current.phase === 'timeout'
      ? { ...current, phase: 'playing', remainingMs: 60000, anchor: now, note: '已补充60秒，慢慢来。' }
      : current;
  }
  if (action.type === 'RETRY') {
    if (current.phase !== 'gameover') return current;
    return { ...createGame(current.levelId, current.mode, now, current.unlocked), frozen: current.frozen, unlimited: current.unlimited };
  }
  if (action.type === 'NEXT') {
    if (current.phase !== 'won' || current.levelId >= 12) return current;
    return { ...createGame(current.levelId + 1, current.mode, now, current.unlocked, current.resources), frozen: current.frozen, unlimited: current.unlimited };
  }
  if (current.phase !== 'playing') return current;
  if (action.type === 'EXPIRE') return current.mode === 'test' ? expire(current) : current;
  if (action.type === 'COMPLETE') {
    if (current.mode !== 'test') return current;
    const level = levels[current.levelId - 1];
    return finish({ ...current, board: current.board.map(row => row.map(() => null)), moveIndex: level.rows * level.cols / 2, matchFeedback: null });
  }
  if (current.animation) return current;
  if (action.type === 'EXTEND') {
    if (!current.unlimited && current.resources.extensions === 0) return current;
    return {
      ...current, remainingMs: current.remainingMs + 30000,
      resources: { ...current.resources, extensions: current.resources.extensions - (current.unlimited ? 0 : 1) },
      note: '已增加30秒，安心找一找。',
    };
  }
  if (action.type === 'HINT' || action.type === 'AUTO_PAIR') {
    if (action.type === 'AUTO_PAIR' && current.mode !== 'test') return current;
    if (action.type === 'HINT' && (current.hint || (!current.unlimited && current.resources.hints === 0))) return current;
    const move = findMove(current.board);
    if (!move) return current;
    if (action.type === 'AUTO_PAIR') return match(current, move.from, move.to, now);
    return {
      ...current, selected: null, hint: move, hintUntil: now + 4500,
      resources: { ...current.resources, hints: current.resources.hints - (current.unlimited ? 0 : 1) },
      note: '找到了！带虚线边框的两位可以连起来。',
    };
  }
  if (action.type === 'SELECT') {
    const point = action.point;
    if (!current.board[point.row]?.[point.col]) return current;
    if (!current.selected) return { ...current, selected: point, hint: null, note: '再点一个相同的伙伴。' };
    if (current.selected.row === point.row && current.selected.col === point.col) return { ...current, selected: null };
    return match(current, current.selected, point, now);
  }
  return current;
}
