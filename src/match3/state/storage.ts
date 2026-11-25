import { starsForScore } from '../engine/board';
import type { Cell, Level, MatchGame } from '../engine/types';
import { levelKey, parsePack, validateLevel } from '../levels/schema';

export const SAVE_KEY = 'slow-paws-match3:save:v1';
export const LEVELS_KEY = 'slow-paws-match3:levels:v1';
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export type Progress = { version: 1; game: MatchGame | null; completed: string[]; bestStars: Record<string, 0 | 1 | 2 | 3> };
const emptyProgress = (): Progress => ({ version: 1, game: null, completed: [], bestStars: {} });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = 1_000_000_000): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const toolsValid = (value: unknown) => object(value) && ['hammer', 'swap', 'shuffle'].every(key => integer(value[key]));

export function fingerprint(level: Level): string {
  let hash = 2166136261;
  const canonical = JSON.stringify(level, (_key, value) => object(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  for (const char of canonical) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

function readGame(value: unknown): MatchGame {
  if (!object(value) || value.version !== 1 || value.mode !== 'normal') throw new Error('不支持此存档的规则版本或会话类型');
  const result = validateLevel(value.level);
  if (!result.level) throw new Error('存档中的关卡配置无效');
  const level = result.level;
  if (!['playing', 'paused', 'won', 'failed'].includes(String(value.phase)) || !integer(value.stageIndex, 0, level.stages.length - 1)
    || !integer(value.movesLeft) || !toolsValid(value.tools) || !integer(value.score) || !integer(value.turn)
    || !integer(value.rng, 0, 0xffffffff) || !integer(value.nextId, 1) || value.unlimitedMoves !== false || value.unlimitedTools !== false)
    throw new Error('存档中的回合或资源数据无效');
  if (!Array.isArray(value.board) || value.board.length !== level.width * level.height) throw new Error('存档棋盘尺寸不符');
  const pieceIds = new Set<number>();
  const lockIds = new Set<number>();
  for (let at = 0; at < value.board.length; at++) {
    const cell: unknown = value.board[at];
    if (!object(cell) || cell.ground !== (level.mask[Math.floor(at / level.width)][at % level.width] === '.') || !integer(cell.ice, 0, 3)) throw new Error('存档格子数据无效');
    if (!cell.ground && (cell.piece !== null || cell.blocker !== null || cell.lock !== null || cell.ice !== 0)) throw new Error('空洞中不能保存动物或障碍');
    if (cell.piece !== null) {
      if (!object(cell.piece) || !integer(cell.piece.id, 1, value.nextId - 1) || pieceIds.has(cell.piece.id)
        || !integer(cell.piece.kind, 0, 27) || !level.palette.includes(cell.piece.kind)
        || (cell.piece.special !== undefined && !['row', 'column', 'bomb', 'bird'].includes(String(cell.piece.special)))) throw new Error('存档动物数据无效');
      pieceIds.add(cell.piece.id);
    }
    if (cell.blocker !== null) {
      const blocker = cell.blocker;
      if (!object(blocker) || cell.piece !== null || cell.lock !== null || (cell.ice !== 0 && blocker.type !== 'poison')) throw new Error('存档障碍叠层无效');
      switch (blocker.type) {
        case 'snow': if (!integer(blocker.layers, 1, 5)) throw new Error('雪块层数无效'); break;
        case 'poison': break;
        case 'gift':
          if (!integer(blocker.color, 0, 27) || !level.palette.includes(blocker.color) || !object(blocker.reward)
            || !['hammer', 'swap', 'shuffle'].includes(String(blocker.reward.tool)) || !integer(blocker.reward.count, 1, 99)) throw new Error('礼盒数据无效');
          break;
        case 'crystal':
          if (!Array.isArray(blocker.colors) || blocker.colors.length < 1 || blocker.colors.length > 28
            || !blocker.colors.every(kind => integer(kind, 0, 27) && level.palette.includes(kind))
            || !integer(blocker.index, 0, blocker.colors.length - 1)) throw new Error('水晶球数据无效');
          break;
        default: throw new Error('未知障碍类型');
      }
    }
    if (cell.lock !== null) {
      if (!object(cell.lock) || !['vine', 'fur'].includes(String(cell.lock.type)) || !integer(cell.lock.id, 1, value.nextId - 1)
        || lockIds.has(cell.lock.id) || !cell.piece || cell.blocker) throw new Error('覆盖物数据无效');
      lockIds.add(cell.lock.id);
    }
  }
  const goalIds = new Set([...level.goals, ...level.stages.flatMap(stage => stage.goals)].map(goal => goal.id));
  if (!object(value.goalProgress) || !Object.entries(value.goalProgress).every(([key, count]) => goalIds.has(key) && integer(count))) throw new Error('存档目标计数无效');
  return {
    version: 1, level, mode: 'normal', phase: value.phase === 'playing' || value.phase === 'paused' ? 'paused' : value.phase as 'won' | 'failed',
    board: value.board as Cell[], stageIndex: value.stageIndex, movesLeft: value.movesLeft,
    tools: value.tools as MatchGame['tools'], goalProgress: value.goalProgress as Record<string, number>,
    score: value.score, turn: value.turn, rng: value.rng, nextId: value.nextId,
    unlimitedMoves: false, unlimitedTools: false, events: [], note: '', pauseReason: 'restored',
  };
}

export function encodeProgress(progress: Progress): string {
  if (progress.game && progress.game.mode !== 'normal') throw new Error('测试或试关不能写入正常存档');
  return JSON.stringify({ ...progress, game: progress.game ? { ...progress.game, events: [], note: '' } : null, fingerprint: progress.game ? fingerprint(progress.game.level) : null });
}

export function decodeProgress(raw: string): Progress {
  if (raw.length > 4 * 1024 * 1024) throw new Error('存档超过大小限制');
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.version !== 1 || !Array.isArray(value.completed) || value.completed.length > 10000
    || !value.completed.every(key => typeof key === 'string' && key.length <= 200 && /^[\w-]+\/[\w-]+$/.test(key))) throw new Error('存档版本或解锁记录无效');
  if (value.bestStars !== undefined && (!object(value.bestStars) || !Object.entries(value.bestStars).every(([key, stars]) => /^[\w-]+\/[\w-]+$/.test(key) && integer(stars, 0, 3)))) throw new Error('星级记录无效');
  const bestStars = object(value.bestStars) ? Object.fromEntries(Object.entries(value.bestStars).map(([key, stars]) => [key, stars as 0 | 1 | 2 | 3])) : {};
  if (value.game === null) return { version: 1, game: null, completed: [...new Set(value.completed)], bestStars };
  const legacyFingerprint = object(value.game) && object(value.game.level) ? fingerprint(value.game.level as unknown as Level) : '';
  const game = readGame(value.game);
  if (value.fingerprint !== fingerprint(game.level) && value.fingerprint !== legacyFingerprint) throw new Error('存档关卡快照校验失败');
  return { version: 1, game, completed: [...new Set(value.completed)], bestStars };
}

export function loadProgress(storage?: Pick<Storage, 'getItem'>): { progress: Progress; warning: string } {
  try {
    const raw = (storage ?? window.localStorage).getItem(SAVE_KEY);
    return { progress: raw ? decodeProgress(raw) : emptyProgress(), warning: '' };
  } catch (error) {
    return { progress: emptyProgress(), warning: `消消乐存档未能读取：${error instanceof Error ? error.message : '存储不可用'}。原数据未被修改，请先导出备份或确认开始新局。` };
  }
}

export function saveProgress(progress: Progress, storage?: StoragePort): boolean {
  try { (storage ?? window.localStorage).setItem(SAVE_KEY, encodeProgress(progress)); return true; } catch { return false; }
}

export function loadCustomLevels(storage?: Pick<Storage, 'getItem'>): { levels: Level[]; warning: string } {
  try {
    const raw = (storage ?? window.localStorage).getItem(LEVELS_KEY);
    if (!raw) return { levels: [], warning: '' };
    const result = parsePack(raw);
    return result.errors.length ? { levels: [], warning: `自定义关卡读取失败：${result.errors[0]}` } : { levels: result.levels, warning: '' };
  } catch { return { levels: [], warning: '自定义关卡存储不可用；内置关卡仍可游玩。' }; }
}

export function saveCustomLevels(levels: Level[], storage?: StoragePort): boolean {
  const raw = JSON.stringify({ schemaVersion: 1, levels });
  if (levels.length && parsePack(raw).errors.length) return false;
  try { (storage ?? window.localStorage).setItem(LEVELS_KEY, levels.length ? raw : ''); return true; } catch { return false; }
}

export function sortedLevels(levels: Level[]): Level[] {
  return [...levels].sort((a, b) => a.packId.localeCompare(b.packId) || a.order - b.order || a.id.localeCompare(b.id));
}

export function isUnlocked(level: Level, levels: Level[], completed: string[]): boolean {
  const pack = sortedLevels(levels.filter(candidate => candidate.packId === level.packId));
  const index = pack.findIndex(candidate => levelKey(candidate) === levelKey(level));
  return index === 0 || completed.includes(levelKey(level)) || (index > 0 && completed.includes(levelKey(pack[index - 1])));
}

export function recordGame(progress: Progress, game: MatchGame): Progress {
  if (game.mode !== 'normal') return progress;
  const completed = game.phase === 'won' ? [...new Set([...progress.completed, levelKey(game.level)])] : progress.completed;
  const key = levelKey(game.level);
  const bestStars = { ...progress.bestStars };
  if (game.phase === 'won') {
    const earned = starsForScore(game.level, game.score);
    if (earned > 0) bestStars[key] = Math.max(bestStars[key] ?? 0, earned) as 1 | 2 | 3;
  }
  return { version: 1, game, completed, bestStars };
}
