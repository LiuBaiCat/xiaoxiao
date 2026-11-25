import { describe, expect, it } from 'vitest';
import { createGame, findMove, transition } from '../engine/game';
import { createTemplate, levelKey } from '../levels/schema';
import { decodeProgress, encodeProgress, fingerprint, isUnlocked, LEVELS_KEY, loadCustomLevels, loadProgress, recordGame, SAVE_KEY, saveCustomLevels, saveProgress, type Progress } from './storage';

const store = () => {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};
const fresh = (): Progress => ({ version: 1, completed: [], bestStars: {}, game: createGame(createTemplate(), 'normal', 20261123) });

describe('三消独立存档', () => {
  it('保存稳定关卡快照并以暂停状态恢复', () => {
    const progress = fresh();
    progress.game = transition(progress.game!, { type: 'RESUME' });
    const decoded = decodeProgress(encodeProgress(progress));
    expect(decoded.game?.phase).toBe('paused');
    expect(decoded.game?.pauseReason).toBe('restored');
    expect(decoded.game?.board).toEqual(progress.game.board);
    expect(decoded.game?.level).toEqual(progress.game.level);
    expect(decoded.game?.events).toEqual([]);
  });

  it('恢复前后继续一步得到相同的确定性结果', () => {
    let original = transition(fresh().game!, { type: 'RESUME' });
    const first = findMove(original)!;
    expect(first).not.toBeNull();
    original = transition(original, { type: 'SWAP', ...first });
    const restored = transition(decodeProgress(encodeProgress({ version: 1, game: original, completed: [], bestStars: {} })).game!, { type: 'RESUME' });
    const nextMove = findMove(original)!;
    const left = transition(original, { type: 'SWAP', ...nextMove });
    const right = transition(restored, { type: 'SWAP', ...nextMove });
    for (const field of ['board', 'rng', 'movesLeft', 'tools', 'goalProgress', 'score', 'turn', 'nextId', 'phase'] as const) expect(right[field]).toEqual(left[field]);
  });

  it('不保存动画快照，也不从事件重放道具奖励', () => {
    const progress = fresh();
    progress.game!.events = [{ type: 'clear', cells: [1, 2], board: structuredClone(progress.game!.board) }];
    progress.game!.tools.hammer = 7;
    const encoded = encodeProgress(progress);
    expect(JSON.parse(encoded).game.events).toEqual([]);
    expect(decodeProgress(encoded).game?.tools.hammer).toBe(7);
  });

  it('正常、测试、编辑器试关不会共用进度', () => {
    const progress = fresh();
    for (const mode of ['test', 'editor'] as const) {
      const trial = createGame(createTemplate(), mode);
      trial.phase = 'won';
      expect(recordGame(progress, trial)).toBe(progress);
      expect(() => encodeProgress({ ...progress, game: trial })).toThrow();
      expect(saveProgress({ ...progress, game: trial }, store())).toBe(false);
    }
  });

  it('只记录正常通关且稳定ID不重复', () => {
    const progress = fresh();
    progress.game!.phase = 'won';
    const updated = recordGame(progress, progress.game!);
    expect(updated.completed).toEqual([levelKey(progress.game!.level)]);
    expect(recordGame(updated, progress.game!).completed).toEqual(updated.completed);
  });

  it('旧存档迁移为空星级记录，通关只提升最高星级', () => {
    const progress = fresh();
    const legacy = JSON.parse(encodeProgress(progress));
    delete legacy.bestStars;
    expect(decodeProgress(JSON.stringify(legacy)).bestStars).toEqual({});
    const game = progress.game!;
    game.phase = 'won';
    game.score = game.level.starThresholds[1];
    const twoStars = recordGame(progress, game);
    expect(twoStars.bestStars[levelKey(game.level)]).toBe(2);
    game.score = 0;
    expect(recordGame(twoStars, game).bestStars[levelKey(game.level)]).toBe(2);
  });

  it('独立键不改变旧连连看与声音配置', () => {
    const storage = store();
    storage.setItem('slow-paws-link:save:v1', 'old-link');
    storage.setItem('slow-paws-link:sound:v1', 'old-sound');
    expect(saveProgress(fresh(), storage)).toBe(true);
    expect(storage.getItem('slow-paws-link:save:v1')).toBe('old-link');
    expect(storage.getItem('slow-paws-link:sound:v1')).toBe('old-sound');
    expect(storage.getItem(SAVE_KEY)).not.toBeNull();
  });

  it('修改目录定义不改变已保存的关卡快照', () => {
    const progress = fresh();
    const encoded = encodeProgress(progress);
    const previousTitle = progress.game!.level.title;
    progress.game!.level = { ...progress.game!.level, title: '新版本标题', revision: progress.game!.level.revision + 1 };
    expect(decodeProgress(encoded).game!.level.title).toBe(previousTitle);
    expect(fingerprint(progress.game!.level)).not.toBe(fingerprint(decodeProgress(encoded).game!.level));
  });

  it.each([
    ['版本', (value: any) => { value.version = 99; }],
    ['规则版本', (value: any) => { value.game.level.rulesVersion = 99; }],
    ['状态', (value: any) => { value.game.phase = 'unknown'; }],
    ['模式', (value: any) => { value.game.mode = 'test'; }],
    ['无限步数', (value: any) => { value.game.unlimitedMoves = true; }],
    ['负步数', (value: any) => { value.game.movesLeft = -1; }],
    ['随机状态', (value: any) => { value.game.rng = -1; }],
    ['棋盘尺寸', (value: any) => { value.game.board.pop(); }],
    ['重复ID', (value: any) => { value.game.board[1].piece.id = value.game.board[0].piece.id; }],
    ['颜色', (value: any) => { value.game.board[0].piece.kind = 99; }],
    ['冰层', (value: any) => { value.game.board[0].ice = 4; }],
    ['目标', (value: any) => { value.game.goalProgress = { unknown: 4 }; }],
    ['指纹', (value: any) => { value.fingerprint = 'wrong'; }],
    ['道具', (value: any) => { value.game.tools.hammer = -1; }],
  ])('拒绝损坏数据：%s', (_, mutate) => {
    const value = JSON.parse(encodeProgress(fresh()));
    mutate(value);
    expect(() => decodeProgress(JSON.stringify(value))).toThrow();
  });

  it('读取失败明确提示且不覆写原数据', () => {
    const storage = store(); storage.setItem(SAVE_KEY, '{invalid');
    const result = loadProgress(storage);
    expect(result.warning).toContain('未能读取');
    expect(result.progress.game).toBeNull();
    expect(storage.getItem(SAVE_KEY)).toBe('{invalid');
  });

  it('写入失败不假报成功', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(saveProgress(fresh(), storage)).toBe(false);
    expect(saveCustomLevels([createTemplate()], storage)).toBe(false);
  });

  it('自定义关卡单独读写，支持清空包', () => {
    const storage = store();
    const level = createTemplate();
    expect(saveCustomLevels([level], storage)).toBe(true);
    expect(loadCustomLevels(storage).levels).toEqual([level]);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
    expect(saveCustomLevels([], storage)).toBe(true);
    expect(loadCustomLevels(storage)).toEqual({ levels: [], warning: '' });
    expect(storage.getItem(LEVELS_KEY)).not.toBeNull();
  });

  it('错误自定义包不替换已有目录', () => {
    const storage = store();
    expect(saveCustomLevels([createTemplate()], storage)).toBe(true);
    const previous = storage.getItem(LEVELS_KEY);
    const level = createTemplate(); level.width = 999;
    expect(saveCustomLevels([level], storage)).toBe(false);
    expect(storage.getItem(LEVELS_KEY)).toBe(previous);
  });

  it('解锁按包、排序和稳定ID，而不是数字关号', () => {
    const first = { ...createTemplate(), id: 'spring', order: 10 };
    const second = { ...createTemplate(), id: 'autumn', order: 90 };
    const other = { ...createTemplate(), packId: 'another', id: 'first', order: 1 };
    const levels = [second, other, first];
    expect(isUnlocked(first, levels, [])).toBe(true);
    expect(isUnlocked(other, levels, [])).toBe(true);
    expect(isUnlocked(second, levels, [])).toBe(false);
    expect(isUnlocked(second, levels, [levelKey(first)])).toBe(true);
    expect(isUnlocked(second, [second, other], [])).toBe(true);
  });
});
