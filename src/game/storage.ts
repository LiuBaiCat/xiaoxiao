import { levels } from '../engine/levels';
import type { Board } from '../engine/types';
import { createGame, type GameState, type Phase } from './machine';

export const SAVE_KEY = 'slow-paws-link:save:v1';
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export type LoadResult = { game: GameState | null; warning: string };

export function encodeGame(state: GameState): string | null {
  if (state.mode !== 'normal') return null;
  return JSON.stringify({
    version: 2, phase: state.phase, levelId: state.levelId, board: state.board,
    resources: state.resources, remainingMs: Math.ceil(state.remainingMs / 1000) * 1000,
    moveIndex: state.moveIndex, unlocked: state.unlocked,
  });
}

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function decodeGame(raw: string): GameState | null {
  try {
    const saved = JSON.parse(raw);
    if (!saved || ![1, 2].includes(saved.version) || !isCount(saved.levelId) || saved.levelId < 1 || saved.levelId > 12) return null;
    const level = levels[saved.levelId - 1];
    const legacy = saved.version === 1;
    const rows = legacy ? (saved.levelId <= 4 ? 4 : 6) : level.rows;
    const cols = legacy ? [6, 6, 8, 8, 8, 8, 8, 8, 10, 10, 10, 10][saved.levelId - 1] : level.cols;
    if (!isCount(saved.unlocked) || saved.unlocked < saved.levelId || saved.unlocked > 12) return null;
    if (!isCount(saved.moveIndex) || saved.moveIndex > rows * cols / 2) return null;
    if (!isCount(saved.remainingMs) || saved.remainingMs > Number.MAX_SAFE_INTEGER - 30000) return null;
    if (!saved.resources || !['lives', 'hints', 'extensions'].every(key => isCount(saved.resources[key]))) return null;
    const phases: Phase[] = ['playing', 'paused', 'timeout', 'won', 'gameover'];
    if (!phases.includes(saved.phase)) return null;
    if (!Array.isArray(saved.board) || saved.board.length !== rows) return null;
    const ids = new Set<number>();
    const counts = Array.from({ length: level.kinds }, () => 0);
    for (const row of saved.board) {
      if (!Array.isArray(row) || row.length !== cols) return null;
      for (const tile of row) {
        if (tile === null) continue;
        if (!tile || !isCount(tile.id) || ids.has(tile.id) || !isCount(tile.kind) || tile.kind >= level.kinds) return null;
        ids.add(tile.id);
        counts[tile.kind]++;
      }
    }
    if (counts.some(count => count % 2 !== 0)) return null;
    if (ids.size !== rows * cols - saved.moveIndex * 2) return null;
    if ((saved.phase === 'won') !== (ids.size === 0)) return null;
    if (saved.phase === 'gameover' ? saved.resources.lives !== 0 : saved.resources.lives === 0) return null;
    if (['playing', 'paused', 'won'].includes(saved.phase) && saved.remainingMs === 0) return null;
    if (['timeout', 'gameover'].includes(saved.phase) && saved.remainingMs !== 0) return null;
    const resources = { lives: saved.resources.lives, hints: saved.resources.hints, extensions: saved.resources.extensions };
    const base = createGame(saved.levelId, 'normal', 0, saved.unlocked, resources);
    if (legacy) {
      const upgraded = { ...base, pauseReason: 'upgraded' as const, note: '棋盘已升级为10行14列。本关重新排列，资源和已解锁关卡都保留。' };
      if (saved.phase === 'won') return { ...upgraded, phase: 'won', board: base.board.map(row => row.map(() => null)), moveIndex: level.rows * level.cols / 2 };
      if (saved.phase === 'gameover') return { ...upgraded, phase: 'gameover', remainingMs: 0 };
      return upgraded;
    }
    return {
      ...base, phase: saved.phase === 'playing' ? 'paused' : saved.phase,
      board: (saved.board as Board).map(row => row.map(tile => tile ? { id: tile.id, kind: tile.kind } : null)),
      resources: { lives: saved.resources.lives, hints: saved.resources.hints, extensions: saved.resources.extensions },
      remainingMs: saved.remainingMs, moveIndex: saved.moveIndex,
      pauseReason: 'restored', note: '进度已保存，准备好后再继续。',
    };
  } catch {
    return null;
  }
}

export function loadGame(storage: StoragePort): LoadResult {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (raw === null) return { game: null, warning: '' };
    const game = decodeGame(raw);
    return { game, warning: game ? '' : '旧存档无法读取，可以重新开始。' };
  } catch {
    return { game: null, warning: '浏览器暂不支持保存；仍可游玩，但关闭后进度会丢失。' };
  }
}

export function saveGame(storage: StoragePort, game: GameState): boolean {
  const encoded = encodeGame(game);
  if (encoded === null) return true;
  try {
    storage.setItem(SAVE_KEY, encoded);
    return true;
  } catch {
    return false;
  }
}
