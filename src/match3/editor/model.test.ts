import { describe, expect, it } from 'vitest';
import type { Level, Special } from '../engine/types';
import { createTemplate, validateLevel } from '../levels/schema';
import { clearBoard, connectCells, copyLevel, defaultBrush, editHistory, freshId, HISTORY_LIMIT, newGoal, paintCells, redo, resizeLevel, sameLevel, sortLevels, startHistory, strokeLine, undo, userCopy, type Brush, type BrushKind, type EraseLayer } from './model';

const at = { row: 2, col: 3 };
const paint = (level: Level, kind: BrushKind, rest: Partial<Brush> = {}) => paintCells(level, [at], { ...defaultBrush, kind, ...rest });
function layersFixture(): Level {
  let level = paint(createTemplate(), 'piece');
  level = paint(level, 'ice', { layers: 3 });
  level = paint(level, 'vine');
  level.spawnPoints = [at];
  level.ropes = [{ from: at, to: { row: 2, col: 4 } }];
  level.portals = [{ id: 'portal1', from: at, to: { row: 7, col: 3 } }];
  return level;
}

describe('visual brushes use the shared level contract', () => {
  it.each(['piece', 'row', 'column', 'bomb', 'bird'] as const)('paints %s without mutating the source and passes the real validator', kind => {
    const source = createTemplate(), before = copyLevel(source);
    const next = paint(source, kind, { color: 2 });
    expect(source).toEqual(before);
    expect(next.initialPieces).toEqual([{ ...at, kind: 2, ...(kind === 'piece' ? {} : { special: kind }) }]);
    expect(validateLevel(next).errors).toEqual([]);
  });
  it.each(['ice', 'snow', 'vine', 'fur', 'gift', 'poison', 'crystal', 'spawn'] as const)('paints and validates %s', kind => {
    const level = paint(createTemplate(), kind);
    // Explicit spawn points need a source for every gravity path.
    if (kind === 'spawn') level.spawnPoints = Array.from({ length: 9 }, (_, col) => ({ row: 0, col }));
    expect(validateLevel(level).errors).toEqual([]);
  });
  it('keeps ice, animal and a single compatible cover as separate layers', () => {
    const level = paint(paint(paint(createTemplate(), 'piece'), 'ice', { layers: 3 }), 'vine');
    const replaced = paint(level, 'fur');
    expect(replaced.initialPieces).toHaveLength(1);
    expect(replaced.ice[0].layers).toBe(3);
    expect(replaced.locks).toEqual([{ ...at, type: 'fur' }]);
    expect(validateLevel(replaced).errors).toEqual([]);
  });
  it('caps ice at 3 and snow at 5, and removes incompatible occupants', () => {
    const source = layersFixture();
    const snow = paint(source, 'snow', { layers: 9 });
    expect(snow.blockers).toEqual([{ ...at, blocker: { type: 'snow', layers: 5 } }]);
    expect(snow.initialPieces).toEqual([]);
    expect(snow.ice).toEqual([]);
    expect(snow.locks).toEqual([]);
    const ice = paint(snow, 'ice', { layers: 9 });
    expect(ice.ice[0].layers).toBe(3);
    expect(ice.blockers).toEqual([]);
  });
  it('stores gift color, reward and crystal sequence exactly', () => {
    const gift = paint(createTemplate(), 'gift', { color: 3, rewardTool: 'swap', rewardCount: 4 });
    expect(gift.blockers[0].blocker).toEqual({ type: 'gift', color: 3, reward: { tool: 'swap', count: 4 } });
    const crystal = paint(gift, 'crystal', { crystalColors: [2, 0, 3] });
    expect(crystal.blockers[0].blocker).toEqual({ type: 'crystal', colors: [2, 0, 3], index: 0 });
    expect(validateLevel(crystal).errors).toEqual([]);
  });
  it('holes remove all attached layers, ropes and entire portal pairs', () => {
    const source = layersFixture();
    const next = paint(source, 'hole');
    expect(next.mask[2][3]).toBe('#');
    for (const field of ['initialPieces', 'ice', 'locks', 'ropes', 'portals', 'spawnPoints'] as const) expect(next[field]).toEqual([]);
    expect(paint(next, 'piece').initialPieces).toEqual([]);
    expect(paint(next, 'ground').mask[2][3]).toBe('.');
    expect(source.mask[2][3]).toBe('.');
  });
  it.each([['piece', 'initialPieces'], ['ice', 'ice'], ['lock', 'locks'], ['rope', 'ropes'], ['portal', 'portals'], ['spawn', 'spawnPoints']] as const)('erases only %s', (layer, field) => {
    const source = layersFixture();
    const next = paint(source, 'erase', { eraseLayer: layer as EraseLayer });
    expect(next[field]).toEqual([]);
    for (const other of ['initialPieces', 'ice', 'locks', 'ropes', 'portals', 'spawnPoints'] as const) if (other !== field) expect(next[other]).toEqual(source[other]);
    expect(next.mask).toEqual(source.mask);
  });
  it('erases a blocker without changing the mask, and clears all without changing objectives', () => {
    const source = paint(createTemplate(), 'gift');
    expect(paint(source, 'erase', { eraseLayer: 'blocker' }).blockers).toEqual([]);
    const cleared = clearBoard(layersFixture());
    expect(cleared.mask).toEqual(createTemplate().mask);
    expect(cleared.goals).toEqual(source.goals);
    expect(cleared.stages).toEqual(source.stages);
    expect(cleared.initialPieces).toEqual([]);
    expect(cleared.ropes).toEqual([]);
  });
  it('ignores out-of-bounds paint and inactive/pair brushes', () => {
    const source = createTemplate();
    expect(paintCells(source, [{ row: 999, col: 999 }], { ...defaultBrush, kind: 'ice' })).toBe(source);
    for (const kind of ['inspect', 'rope', 'portal'] as const) expect(paint(source, kind)).toBe(source);
  });
});

describe('pair connections and resize', () => {
  it('requires adjacent rope cells, handles reverse duplicates as toggles', () => {
    const source = createTemplate(), to = { row: 2, col: 4 };
    expect(connectCells(source, at, { row: 3, col: 4 }, 'rope').error).toContain('相邻');
    const connected = connectCells(source, at, to, 'rope').level;
    expect(connected.ropes).toEqual([{ from: at, to }]);
    expect(validateLevel(connected).errors).toEqual([]);
    expect(connectCells(connected, to, at, 'rope').level.ropes).toEqual([]);
  });
  it('supports directed portal pairs with stable IDs and rejects self/occupied endpoints', () => {
    const source = createTemplate(), from = { row: 8, col: 0 }, to = { row: 0, col: 1 };
    const result = connectCells(source, from, to, 'portal');
    expect(result.error).toBeUndefined();
    expect(result.level.portals).toEqual([{ id: 'portal-1', from, to }]);
    expect(validateLevel(result.level).errors).toEqual([]);
    expect(connectCells(source, from, from, 'portal').error).toBeTruthy();
    expect(connectCells(result.level, to, at, 'portal').error).toContain('已有');
  });
  it('rejects connections to holes and across stage boundaries', () => {
    const source = createTemplate();
    source.stages = [{ id: 'a', startRow: 0, rows: 3, goals: [] }, { id: 'b', startRow: 3, rows: 6, goals: [] }];
    for (const kind of ['rope', 'portal'] as const) expect(connectCells(source, at, { row: 3, col: 3 }, kind).error).toContain('阶段');
    const hole = paint(source, 'hole');
    expect(connectCells(hole, at, { row: 2, col: 4 }, 'rope').error).toContain('地板');
  });
  it('preserves in-range configuration and only drops the outside endpoint connections', () => {
    const source = layersFixture();
    source.initialPieces.push({ row: 8, col: 8, kind: 1 });
    source.mask[8] = '........#';
    const result = resizeLevel(source, 5, 5);
    expect(result.removed).toBe(3);
    expect(result.level.width).toBe(5);
    expect(result.level.mask).toEqual(Array(5).fill('.....'));
    expect(result.level.initialPieces).toEqual([{ ...at, kind: 0 }]);
    expect(result.level.ice).toEqual(source.ice);
    expect(result.level.ropes).toEqual(source.ropes);
    expect(result.level.portals).toEqual([]);
    expect(result.level.stages[0].rows).toBe(5);
    expect(source.width).toBe(9);
    expect(source.portals).toHaveLength(1);
  });
  it('expands a scrolling level without reordering existing stage goals', () => {
    const source = createTemplate(); source.scroll = true; source.stages[0].goals = [newGoal('score', 's1', source.palette)];
    const grown = resizeLevel(source, 10, 27).level;
    expect(grown.stages.map(s => [s.startRow, s.rows])).toEqual([[0, 9], [9, 9], [18, 9]]);
    expect(grown.stages[0].goals).toEqual(source.stages[0].goals);
    const shrunk = resizeLevel(grown, 9, 10);
    expect(shrunk.level.stages.map(s => [s.startRow, s.rows])).toEqual([[0, 9], [9, 1]]);
    expect(shrunk.removed).toBeGreaterThan(0);
  });
});

describe('history, copies and editable goals', () => {
  it('undoes a drag as one action, and branches discard redo', () => {
    const start = createTemplate();
    let history = startHistory(start);
    history = editHistory(history, paintCells(history.present, [at], { ...defaultBrush, kind: 'ice' }));
    history = editHistory(history, paintCells(history.present, [{ row: 2, col: 4 }], { ...defaultBrush, kind: 'ice' }), false);
    expect(history.past).toHaveLength(1);
    expect(history.present.ice).toHaveLength(2);
    const undone = undo(history);
    expect(undone.present).toEqual(start);
    expect(redo(undone).present).toEqual(history.present);
    expect(editHistory(undone, { ...start, title: '新分支' }).future).toEqual([]);
    expect(editHistory(history, copyLevel(history.present))).toBe(history);
  });
  it('bounds history to 80 states and does not mutate previous snapshots', () => {
    const source = createTemplate(); let history = startHistory(source);
    for (let i = 0; i < 130; i++) history = editHistory(history, { ...history.present, moves: i + 1 });
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(source.moves).toBe(32);
    const empty = startHistory(source);
    expect(undo(empty)).toBe(empty); expect(redo(empty)).toBe(empty);
  });
  it('copies builtins into user namespace without editing the source or reusing IDs', () => {
    const builtin = { ...createTemplate(), packId: 'builtin' };
    const first = userCopy(builtin, []), second = userCopy(builtin, [first]);
    expect(first.packId).toBe('user'); expect(second.id).not.toBe(first.id);
    first.mask[0] = '#########';
    expect(builtin.mask[0]).toBe('.........');
    expect(first.revision).toBe(1);
    expect(sortLevels([second, first]).map(l => l.id)).toEqual([first.id, second.id]);
    expect(freshId('g', ['g', 'g-2'])).toBe('g-3');
  });
  it.each(['collect', 'clear', 'special', 'score'] as const)('creates structured %s goals with stable IDs', type => {
    const goal = newGoal(type, 'target', [3, 2, 1]);
    expect(goal.id).toBe('target'); expect(goal.type).toBe(type); expect(goal.count).toBeGreaterThan(0);
    if (goal.type === 'collect') expect(goal.kind).toBe(3);
    if (goal.type === 'clear') expect(goal.unit).toBe('layers');
    if (goal.type === 'special') expect(goal.special).toEqual('row' satisfies Special);
  });
  it('interpolates fast drag movements and compares detached copies', () => {
    expect(strokeLine({ row: 0, col: 0 }, { row: 0, col: 4 })).toEqual([1, 2, 3, 4].map(col => ({ row: 0, col })));
    expect(strokeLine(at, at)).toEqual([at]);
    expect(sameLevel(createTemplate(), copyLevel(createTemplate()))).toBe(true);
  });
});
