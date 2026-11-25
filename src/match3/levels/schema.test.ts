import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Cell, Goal, Level, Point } from '../engine/types';
import { createTemplate, levelKey, parsePack, validateLevel } from './schema';

const check = (edit: (level: Level) => void) => { const level = createTemplate(); edit(level); return validateLevel(level); };
const bad = (edit: (level: Level) => void, pattern?: RegExp) => {
  const result = check(edit); expect(result.level).toBeUndefined(); expect(result.errors.length).toBeGreaterThan(0);
  if (pattern) expect(result.errors.join('\n')).toMatch(pattern);
};
const clear = (id: string, obstacle: Extract<Goal, { type: 'clear' }>['obstacle'], count: number, unit: 'layers' | 'objects' = 'objects'): Goal => ({ id, type: 'clear', obstacle, count, unit });
const twoStages = (l: Level) => {
  l.height = 18; l.mask = Array(18).fill('.........'); l.scroll = true;
  l.stages = [{ id: 'first', startRow: 0, rows: 9, goals: [{ id: 'first-goal', type: 'collect', kind: 0, count: 3 }] }, { id: 'second', startRow: 9, rows: 9, goals: [] }];
};

describe('shared config contract and defaults', () => {
  it('uses Point coordinates in config and flat Cell runtime data', () => {
    expectTypeOf<Point>().toEqualTypeOf<{ row: number; col: number }>();
    expectTypeOf<Level['initialPieces'][number]>().toMatchTypeOf<Point>();
    expectTypeOf<Cell>().toEqualTypeOf<{ ground: boolean; piece: import('../engine/types').Piece | null; ice: number; blocker: import('../engine/types').Blocker | null; lock: import('../engine/types').Lock | null }>();
  });
  it('creates a fresh valid empty 9x9 stage1 with default tools, seed and moves', () => {
    const l = createTemplate(); expect(validateLevel(l).errors).toEqual([]);
    expect(l.width).toBe(9); expect(l.height).toBe(9); expect(l.mask).toEqual(Array(9).fill('.........'));
    expect(l.stages).toEqual([{ id: 'stage1', startRow: 0, rows: 9, goals: [] }]);
    expect(l.moves).toBe(32); expect(l.tools).toEqual({ hammer: 2, swap: 2, shuffle: 2 });
    expect(l.seed).toBeGreaterThanOrEqual(0); expect(l.seed).toBeLessThanOrEqual(0xffffffff);
    expect([l.initialPieces, l.ice, l.blockers, l.locks, l.ropes, l.portals, l.spawnPoints].every(a => a.length === 0)).toBe(true);
    l.mask[0] = '#########'; expect(createTemplate().mask[0]).toBe('.........');
    expect(levelKey(l)).toBe('custom/new-level');
  });
  it('uses legacy star defaults and requires three strictly increasing safe thresholds', () => {
    const legacy = JSON.parse(JSON.stringify(createTemplate()));
    delete legacy.starThresholds;
    expect(validateLevel(legacy).level?.starThresholds).toEqual([1000, 2000, 3000]);
    for (const thresholds of [[1, 1, 2], [1, 2, 2], [-1, 2, 3], [1, 2, Number.MAX_SAFE_INTEGER + 1]]) {
      expect(validateLevel({ ...createTemplate(), starThresholds: thresholds }).level).toBeUndefined();
    }
    const valid = validateLevel({ ...createTemplate(), starThresholds: [0, 1, 2] });
    expect(valid.errors).toEqual([]); expect(valid.level?.starThresholds).toEqual([0, 1, 2]);
  });
  it('returns independent validated data', () => {
    const l = createTemplate(); const result = validateLevel(l); l.tools.hammer = 0;
    expect(result.level?.tools.hammer).toBe(2);
  });
  it('supports all size extremes and optional seed', () => {
    for (const [width, height] of [[3, 3], [12, 60]]) {
      const l = createTemplate(); l.width = width; l.height = height; l.mask = Array(height).fill('.'.repeat(width));
      l.scroll = height > 10; l.stages = Array.from({ length: height > 10 ? 6 : 1 }, (_, i) => ({ id: `s${i}`, startRow: i * 10, rows: height > 10 ? 10 : height, goals: [{ id: `g${i}`, type: 'score' as const, count: 10 }] }));
      delete l.seed; expect(validateLevel(l).errors).toEqual([]);
    }
  });
});

describe('strict unknown data', () => {
  it.each([null, false, 1, 'level', [], undefined, NaN, Infinity])('rejects non-level %s without throwing', v => {
    expect(validateLevel(v).level).toBeUndefined(); expect(validateLevel(v).errors.length).toBeGreaterThan(0);
  });
  it.each(['schemaVersion', 'rulesVersion', 'width', 'height', 'moves', 'revision', 'order', 'seed'])('rejects non-finite/fractional numbers in %s', field => {
    for (const value of [NaN, Infinity, -Infinity, 1.5, '3']) {
      const l = { ...createTemplate(), [field]: value }; expect(validateLevel(l).level).toBeUndefined();
    }
  });
  it('rejects missing and unknown fields and variant-only fields', () => {
    const l = createTemplate(); const { tools: _tools, ...missing } = l;
    expect(validateLevel(missing).errors.join()).toContain('tools');
    expect(validateLevel({ ...l, script: 'run' }).errors.join()).toContain('未知字段');
    expect(validateLevel({ ...l, blockers: [{ row: 1, col: 1, blocker: { type: 'poison', layers: 1 } }] }).errors.join()).toContain('未知字段');
    expect(validateLevel({ ...l, goals: [{ id: 's', type: 'score', count: 1, kind: 0 }] }).errors.join()).toContain('未知字段');
  });
  it('rejects all dangerous keys recursively, markup, external resources and reserved IDs', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const l = JSON.parse(JSON.stringify(createTemplate()));
      l.tools = JSON.parse(`{"hammer":2,"swap":2,"shuffle":2,"${key}":{}}`);
      expect(validateLevel(l).errors.join()).toContain('危险键');
      expect(validateLevel({ ...createTemplate(), id: key }).level).toBeUndefined();
    }
    for (const title of ['<img src=x onerror=alert(1)>', 'javascript:alert(1)', 'https://example.com/a', 'data:text/html,test', '//host/img']) expect(validateLevel({ ...createTemplate(), title }).level).toBeUndefined();
  });
  it('does not execute getters, permits no symbols/prototypes/cycles/functions', () => {
    const getter = { ...createTemplate() }; let called = false;
    Object.defineProperty(getter, 'title', { enumerable: true, get() { called = true; return 'title'; } });
    expect(validateLevel(getter).level).toBeUndefined(); expect(called).toBe(false);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const v of [cyclic, new Date(), { ...createTemplate(), [Symbol('x')]: 1 }, { ...createTemplate(), title: () => 1 }]) expect(validateLevel(v).level).toBeUndefined();
  });
  it('enforces dimensions, lengths, strings and numeric limits', () => {
    for (const width of [2, 13]) bad(l => { l.width = width; });
    for (const height of [2, 61]) bad(l => { l.height = height; });
    bad(l => { l.seed = -1; }); bad(l => { l.seed = 0x100000000; });
    bad(l => { l.moves = 0; }); bad(l => { l.tools.hammer = -1; }); bad(l => { l.revision = 0; });
    bad(l => { l.title = ' '; }); bad(l => { l.title = 'a'.repeat(81); }); bad(l => { l.id = 'a/b'; });
    bad(l => { l.mask.pop(); }); bad(l => { l.mask[0] = '........'; }); bad(l => { l.mask[0] = 'xxxxxxxxx'; });
    expect(validateLevel({ ...createTemplate(), scroll: 1 }).level).toBeUndefined();
  });
  it('requires palette 3..8 unique kinds in 0..27 and present animal/goal colors', () => {
    for (const palette of [[0, 1], [0, 1, 1], [0, 1, 28], [0, 1, -1], Array.from({ length: 9 }, (_, i) => i)]) bad(l => { l.palette = palette; });
    bad(l => { l.initialPieces = [{ row: 0, col: 0, kind: 27 }]; });
    bad(l => { l.goals = [{ id: 'outside', type: 'collect', kind: 27, count: 3 }]; });
    expect(validateLevel({ ...createTemplate(), initialPieces: [{ row: 0, col: 0, kind: 0, special: 'laser' }] }).level).toBeUndefined();
  });
});

describe('coordinates, overlays and obstacle fields', () => {
  it('requires integer ground coordinates, unique per layer', () => {
    for (const [row, col] of [[-1, 0], [9, 0], [0, 9], [0.5, 0]]) bad(l => { l.ice = [{ row, col, layers: 1 }]; });
    bad(l => { l.mask[0] = '#........'; l.ice = [{ row: 0, col: 0, layers: 1 }]; });
    for (const field of ['initialPieces', 'ice', 'blockers', 'locks', 'spawnPoints'] as const) {
      const item = { initialPieces: { row: 1, col: 1, kind: 0 }, ice: { row: 1, col: 1, layers: 1 }, blockers: { row: 1, col: 1, blocker: { type: 'poison' } }, locks: { row: 1, col: 1, type: 'fur' }, spawnPoints: { row: 1, col: 1 } }[field];
      expect(validateLevel({ ...createTemplate(), [field]: [item, item] }).errors.join()).toContain('重复');
    }
  });
  it('accepts ice + piece + one lock, including an auto-filled lock', () => {
    expect(check(l => {
      l.ice = [{ row: 2, col: 2, layers: 3 }]; l.locks = [{ row: 2, col: 2, type: 'vine' }];
      l.initialPieces = [{ row: 2, col: 2, kind: 0, special: 'bomb' }];
    }).errors).toEqual([]);
    expect(check(l => { l.locks = [{ row: 2, col: 2, type: 'fur' }]; }).errors).toEqual([]);
  });
  it('rejects blockers overlapping animals, ice or locks and mutually exclusive locks', () => {
    for (const overlap of ['piece', 'ice', 'lock']) bad(l => {
      l.blockers = [{ row: 2, col: 2, blocker: { type: 'poison' } }];
      if (overlap === 'piece') l.initialPieces = [{ row: 2, col: 2, kind: 0 }];
      if (overlap === 'ice') l.ice = [{ row: 2, col: 2, layers: 1 }];
      if (overlap === 'lock') l.locks = [{ row: 2, col: 2, type: 'vine' }];
    }, /叠加/);
    bad(l => { l.locks = [{ row: 1, col: 1, type: 'vine' }, { row: 1, col: 1, type: 'fur' }]; });
  });
  it('checks snow 1..5 and ice 1..3', () => {
    for (const layers of [0, 4]) bad(l => { l.ice = [{ row: 1, col: 1, layers }]; });
    for (const layers of [0, 6]) bad(l => { l.blockers = [{ row: 1, col: 1, blocker: { type: 'snow', layers } }]; });
    expect(check(l => { l.blockers = [{ row: 1, col: 1, blocker: { type: 'snow', layers: 5 } }]; }).errors).toEqual([]);
  });
  it('validates gift colors/tool/count and crystal sequence/index', () => {
    const l = createTemplate();
    for (const blocker of [
      { type: 'gift', color: 27, reward: { tool: 'hammer', count: 1 } },
      { type: 'gift', color: 0, reward: { tool: 'money', count: 1 } },
      { type: 'gift', color: 0, reward: { tool: 'hammer', count: 0 } },
      { type: 'gift', color: 0, reward: { tool: 'hammer', count: 100 } },
      { type: 'crystal', colors: [], index: 0 }, { type: 'crystal', colors: [0, 0], index: 0 },
      { type: 'crystal', colors: [0, 27], index: 0 }, { type: 'crystal', colors: [0, 1], index: 2 },
      { type: 'crystal', colors: [0, 1], index: -1 }, { type: 'rock' },
    ]) expect(validateLevel({ ...l, blockers: [{ row: 1, col: 1, blocker }] }).level).toBeUndefined();
    expect(check(l => { l.blockers = [{ row: 1, col: 1, blocker: { type: 'crystal', colors: [0], index: 0 } }]; }).errors).toEqual([]);
  });
});

describe('stages and goal reachability bounds', () => {
  it('allows no globals if all stages have local goals; permits last stage globals', () => {
    expect(check(l => { l.stages[0].goals = l.goals; l.goals = []; }).errors).toEqual([]);
    expect(check(twoStages).errors).toEqual([]);
    bad(l => { l.goals = []; });
    bad(l => { twoStages(l); l.stages[0].goals = []; });
  });
  it('rejects gaps, overlaps, >10 rows, incomplete cover, duplicate IDs and non-scroll multi-stage', () => {
    bad(l => { twoStages(l); l.stages[1].startRow = 10; });
    bad(l => { twoStages(l); l.stages[1].startRow = 8; });
    bad(l => { l.stages[0].rows = 11; }); bad(l => { l.stages[0].rows = 8; });
    bad(l => { twoStages(l); l.stages[1].id = l.stages[0].id; });
    bad(l => { twoStages(l); l.scroll = false; });
    bad(l => { l.mask = Array(9).fill('#########'); });
  });
  it('requires goal ids unique globally, including between stages', () => {
    bad(l => { l.stages[0].goals = [...l.goals]; }, /不得重复/);
    bad(l => { twoStages(l); l.stages[1].goals = [...l.stages[0].goals]; });
    bad(l => { l.goals[0].count = 0; });
    expect(validateLevel({ ...createTemplate(), goals: [{ id: 'rope', type: 'clear', obstacle: 'rope', unit: 'objects', count: 1 }] }).level).toBeUndefined();
  });
  it('bounds objects vs layers in the correct stage and supports shared global event counts', () => {
    expect(check(l => { l.ice = [{ row: 1, col: 1, layers: 3 }]; l.goals = [clear('layers', 'ice', 3, 'layers'), clear('objects', 'ice', 1)]; }).errors).toEqual([]);
    bad(l => { l.ice = [{ row: 1, col: 1, layers: 3 }]; l.goals = [clear('objects', 'ice', 2)]; });
    bad(l => { l.blockers = [{ row: 1, col: 1, blocker: { type: 'snow', layers: 5 } }]; l.goals = [clear('layers', 'snow', 6, 'layers')]; });
    bad(l => { twoStages(l); l.ice = [{ row: 10, col: 1, layers: 1 }]; l.stages[0].goals = [clear('early', 'ice', 1)]; });
    for (const obstacle of ['vine', 'fur', 'gift', 'crystal', 'poison'] as const) bad(l => { l.goals = [clear('missing', obstacle, 1)]; });
  });
  it('warns rather than falsely bounding growing poison by its initial count', () => {
    const result = check(l => { l.blockers = [{ row: 4, col: 4, blocker: { type: 'poison' } }]; l.goals = [clear('poison', 'poison', 20)]; });
    expect(result.errors).toEqual([]); expect(result.warnings.join()).toContain('可达性');
  });
});

describe('rope and gravity graph', () => {
  const portal = (from: Point, to: Point, id = 'gate') => ({ id, from, to });
  it('checks rope adjacency, duplicate reverse edges and stage boundaries', () => {
    bad(l => { l.ropes = [{ from: { row: 1, col: 1 }, to: { row: 2, col: 2 } }]; });
    bad(l => { const from = { row: 1, col: 1 }, to = { row: 1, col: 2 }; l.ropes = [{ from, to }, { from: to, to: from }]; });
    bad(l => { twoStages(l); l.ropes = [{ from: { row: 8, col: 1 }, to: { row: 9, col: 1 } }]; });
  });
  it('accepts a valid portal and rejects self/cross-stage/duplicate id or entrance', () => {
    expect(check(l => { l.portals = [portal({ row: 8, col: 1 }, { row: 0, col: 7 })]; }).errors).toEqual([]);
    bad(l => { l.portals = [portal({ row: 1, col: 1 }, { row: 1, col: 1 })]; });
    bad(l => { twoStages(l); l.portals = [portal({ row: 8, col: 1 }, { row: 9, col: 7 })]; });
    bad(l => { l.portals = [portal({ row: 8, col: 1 }, { row: 0, col: 7 }), portal({ row: 8, col: 2 }, { row: 0, col: 6 })]; });
    bad(l => { l.portals = [portal({ row: 8, col: 1 }, { row: 0, col: 7 }), portal({ row: 8, col: 1 }, { row: 0, col: 6 }, 'other')]; });
  });
  it('rejects ordinary-plus-portal cycles and multiple incoming paths even when blocked now', () => {
    bad(l => { l.portals = [portal({ row: 8, col: 1 }, { row: 0, col: 1 })]; }, /循环/);
    bad(l => { l.portals = [portal({ row: 8, col: 1 }, { row: 3, col: 7 })]; }, /歧义入边/);
    bad(l => { l.blockers = [{ row: 2, col: 7, blocker: { type: 'snow', layers: 1 } }]; l.portals = [portal({ row: 8, col: 1 }, { row: 3, col: 7 })]; }, /歧义入边/);
    bad(l => { l.portals = [portal({ row: 8, col: 1 }, { row: 0, col: 7 }), portal({ row: 8, col: 2 }, { row: 0, col: 7 }, 'other')]; }, /歧义入边/);
  });
  it('treats [] as automatic sources and nonempty points as explicit complete supply', () => {
    expect(check(l => { l.mask[4] = '....#....'; }).errors).toEqual([]);
    expect(check(l => { l.spawnPoints = Array.from({ length: 9 }, (_, col) => ({ row: 0, col })); }).errors).toEqual([]);
    bad(l => { l.spawnPoints = [{ row: 0, col: 0 }]; }, /不可供料/);
    bad(l => { l.spawnPoints = Array.from({ length: 9 }, (_, col) => ({ row: 0, col })); l.mask[4] = '....#....'; }, /不可供料/);
    bad(l => { l.spawnPoints = Array.from({ length: 9 }, (_, col) => ({ row: 0, col })); l.blockers = [{ row: 3, col: 3, blocker: { type: 'snow', layers: 1 } }]; }, /截断后/);
    expect(check(l => { l.spawnPoints = [...Array.from({ length: 9 }, (_, col) => ({ row: 0, col })), { row: 4, col: 3 }]; l.blockers = [{ row: 3, col: 3, blocker: { type: 'snow', layers: 1 } }]; }).errors).toEqual([]);
  });
});

describe('atomic packs and quotas', () => {
  it('accepts single, wrapped and bare arrays', () => {
    const l = createTemplate();
    for (const v of [l, [l], { schemaVersion: 1, levels: [l] }]) expect(parsePack(JSON.stringify(v))).toEqual({ levels: [l], errors: [] });
  });
  it('accepts 21 and 200 levels, rejects 201, empty packs and duplicate stable keys', () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ ...createTemplate(), id: `level-${i}` }));
    for (const n of [21, 200]) expect(parsePack(JSON.stringify(many.slice(0, n))).levels.length).toBe(n);
    for (const v of [many, [], [many[0], many[0]]]) { const r = parsePack(JSON.stringify(v)); expect(r.levels).toEqual([]); expect(r.errors.length).toBeGreaterThan(0); }
    expect(parsePack(JSON.stringify([many[0], { ...many[0], packId: 'other' }])).levels).toHaveLength(2);
  });
  it('never partially imports malformed data or unknown pack fields', () => {
    for (const text of ['{', 'null', JSON.stringify([createTemplate(), { invalid: true }]), JSON.stringify({ schemaVersion: 2, levels: [createTemplate()] }), JSON.stringify({ schemaVersion: 1, levels: [createTemplate()], url: 'bad' })]) {
      const r = parsePack(text); expect(r.levels).toEqual([]); expect(r.errors.length).toBeGreaterThan(0);
    }
  });
  it('enforces byte quotas and depth budget before expensive work', () => {
    expect(parsePack(' '.repeat(2 * 1024 * 1024 + 1)).errors.join()).toContain('2 MiB');
    expect(validateLevel({ ...createTemplate(), title: '中'.repeat(100000) }).errors.join()).toContain('256 KiB');
    let deep: unknown = 1; for (let i = 0; i < 40; i++) deep = { x: deep };
    expect(validateLevel(deep).errors.join()).toContain('嵌套过深');
    const enormous = new Array(0xffffffff);
    expect(validateLevel(enormous).errors.join()).toContain('数组过长');
    expect(validateLevel({ ...createTemplate(), ice: new Array(3) }).level).toBeUndefined();
  });
});
