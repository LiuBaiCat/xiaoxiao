import { describe, expect, it } from 'vitest';
import { builtinLevels } from './registry';
import { levelKey, parsePack, validateLevel } from './schema';
import readme from './README.md?raw';
import { createGame, findMove, transition } from '../engine/game';
import { detectMatches } from '../engine/matches';

describe('builtin authoring data', () => {
  it('discovers exactly 20 independent files and sorts stable keys by order/id', () => {
    const files = import.meta.glob('./builtin/*.json', { eager: true });
    expect(Object.keys(files)).toHaveLength(20); expect(builtinLevels).toHaveLength(20);
    expect(builtinLevels.map(l => l.order)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(builtinLevels.map(levelKey)).size).toBe(20);
    expect(new Set(builtinLevels.map(l => l.seed)).size).toBe(20);
  });
  it('uses 6x6 introductions, 9-column later levels and 9-row long windows', () => {
    builtinLevels.forEach((l, i) => {
      expect(l.width).toBe(i < 2 ? 6 : 9);
      expect(l.height).toBe(i < 2 ? 6 : i < 16 ? 9 : i < 18 ? 18 : 27);
      expect(l.stages.every(s => s.rows === (i < 2 ? 6 : 9))).toBe(true);
      expect(l.scroll).toBe(i >= 16); expect(l.palette.length).toBeGreaterThanOrEqual(4); expect(l.palette.length).toBeLessThanOrEqual(6);
      expect(l.palette.every(kind => kind <= 11)).toBe(true);
      expect(l.tools).toEqual({ hammer: 2, swap: 2, shuffle: 2 });
      expect(l.moves).toBeGreaterThanOrEqual(32);
    });
  });
  it('gives each builtin level an explicit tuned star curve', () => {
    expect(builtinLevels.every(level => level.starThresholds.some(value => value !== 1000) && level.starThresholds[0] < level.starThresholds[1] && level.starThresholds[1] < level.starThresholds[2])).toBe(true);
    expect(builtinLevels[0].starThresholds).toEqual([500, 900, 1300]);
    expect(builtinLevels[1].starThresholds).toEqual([600, 1000, 1400]);
    expect(builtinLevels[19].starThresholds).toEqual([2400, 3600, 4500]);
  });
  it('actually includes all nine mechanisms, corners, a central hole and stairs', () => {
    const types = new Set<string>();
    for (const l of builtinLevels) {
      if (l.ice.length) types.add('ice'); if (l.ropes.length) types.add('rope'); if (l.portals.length) types.add('portal');
      l.blockers.forEach(p => types.add(p.blocker.type)); l.locks.forEach(p => types.add(p.type));
    }
    expect([...types].sort()).toEqual(['ice', 'snow', 'rope', 'vine', 'gift', 'portal', 'poison', 'fur', 'crystal'].sort());
    expect(builtinLevels.some(l => l.mask[0].startsWith('#'))).toBe(true);
    expect(builtinLevels.some(l => l.mask[4]?.includes('...###...'))).toBe(true);
    expect(builtinLevels.some(l => l.mask[0] === '##.......' && l.mask[2] === '#........')).toBe(true);
  });
  it.each(builtinLevels)('$order $title validates and starts without automatic matches', l => {
    const result = validateLevel(l); expect(result.errors).toEqual([]);
    expect(result.warnings.join()).not.toContain('开局三连');
    const game = createGame(l, 'normal', l.seed);
    expect(game.phase, game.note).toBe('paused');
    expect(game.board).toHaveLength(l.width * l.height);
    expect(game.turn).toBe(0); expect(game.score).toBe(0);
    expect(Object.values(game.goalProgress).every(n => n === 0)).toBe(true);
    for (let i = 0; i < l.stages.length; i++) {
      const stage = { ...game, stageIndex: i };
      expect(detectMatches(stage)).toEqual([]); expect(findMove(stage)).not.toBeNull();
    }
  });
  it.each(builtinLevels)('$order remains stable across additional seeds and legal moves', l => {
    for (const seed of [0, 1, 0xffffffff]) {
      let game = createGame(l, 'normal', seed);
      expect(game.phase, game.note).toBe('paused');
      expect(detectMatches(game)).toEqual([]);
      game = transition(game, { type: 'RESUME' });
      for (let turn = 0; turn < 4 && game.phase === 'playing'; turn++) {
        const move = findMove(game); expect(move).not.toBeNull();
        game = transition(game, { type: 'SWAP', ...move! });
        expect(game.events.some(e => e.type === 'invalid'), game.note).toBe(false);
        expect(['playing', 'won'], game.note).toContain(game.phase);
        expect(detectMatches(game)).toEqual([]);
      }
    }
  });
  it('keeps every complete README JSON example executable', () => {
    const examples = [...readme.matchAll(/```json\s*\n([\s\S]*?)```/g)];
    expect(examples.length).toBeGreaterThanOrEqual(4);
    const allKeys: string[] = [];
    examples.forEach(([, text], i) => {
      const result = parsePack(text); expect(result.errors, `README JSON block ${i + 1}`).toEqual([]);
      expect(result.levels).toHaveLength(1); allKeys.push(levelKey(result.levels[0]));
    });
    expect(new Set(allKeys).size).toBe(examples.length);
  });
});
