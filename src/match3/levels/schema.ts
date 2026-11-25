import { DEFAULT_STAR_THRESHOLDS } from '../engine/types';
import type { Blocker, Goal, Level, Point, Special, StarThresholds, Tool } from '../engine/types';

const MAX_LEVEL_BYTES = 256 * 1024;
const MAX_PACK_BYTES = 2 * 1024 * 1024;
const dangerous = new Set(['__proto__', 'prototype', 'constructor']);
const specials: Special[] = ['row', 'column', 'bomb', 'bird'];
const tools: Tool[] = ['hammer', 'swap', 'shuffle'];
const obstacles = ['ice', 'snow', 'vine', 'gift', 'poison', 'fur', 'crystal'] as const;
const bytes = (text: string) => new TextEncoder().encode(text).length;
const pointKey = (p: Point) => `${p.row},${p.col}`;

/** Only data is accepted, including when an editor calls the validator without JSON.parse. */
function dataErrors(value: unknown): string[] {
  const errors: string[] = [];
  const ancestors = new Set<object>();
  let nodes = 0;
  function visit(v: unknown, path: string, depth: number) {
    if (errors.length >= 20) return;
    if (++nodes > 50000 || depth > 32) { errors.push(`${path}: 数据过大或嵌套过深`); return; }
    if (typeof v === 'string') {
      if (v.length > MAX_LEVEL_BYTES || /[<>]|(?:https?:|ftp:|file:|data:|javascript:|vbscript:|\/\/)/i.test(v)) errors.push(`${path}: 不允许 HTML、脚本或外链`);
      return;
    }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
    if (typeof v !== 'object') { errors.push(`${path}: 必须是有限数值或纯 JSON 数据`); return; }
    if (ancestors.has(v)) { errors.push(`${path}: 不允许循环引用`); return; }
    // Bound sparse arrays before stringify (an enormous length has few own keys).
    if (Array.isArray(v) && v.length > 1440) { errors.push(`${path}: 数组过长，最多 1440 项`); return; }
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) {
      errors.push(`${path}: 必须是普通对象`); return;
    }
    ancestors.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') continue;
      if (typeof key !== 'string' || dangerous.has(key)) { errors.push(`${path}: 禁止危险键 ${String(key)}`); continue; }
      const desc = Object.getOwnPropertyDescriptor(v, key)!;
      if (!('value' in desc) || !desc.enumerable || (Array.isArray(v) && !/^(0|[1-9]\d*)$/.test(key))) { errors.push(`${path}.${key}: 不允许访问器或非 JSON 属性`); continue; }
      visit(desc.value, `${path}.${key}`, depth + 1);
    }
    ancestors.delete(v);
  }
  visit(value, 'level', 0);
  return errors;
}

export function levelKey(level: Pick<Level, 'packId' | 'id'>): string {
  return `${level.packId}/${level.id}`;
}

/** Required fields are never silently defaulted on import; createTemplate supplies defaults. */
export function validateLevel(value: unknown): { level?: Level; errors: string[]; warnings: string[] } {
  const errors = dataErrors(value);
  const warnings: string[] = [];
  if (errors.length) return { errors, warnings };
  if (bytes(JSON.stringify(value)) > MAX_LEVEL_BYTES) return { errors: ['level: 单关不能超过 256 KiB'], warnings };
  const error = (p: string, message: string) => { errors.push(`${p}: ${message}`); };
  function object(v: unknown, p: string, keys: string[]): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { error(p, '必须是对象'); return {}; }
    const obj = v as Record<string, unknown>;
    for (const key of Object.keys(obj)) if (!keys.includes(key)) error(`${p}.${key}`, '未知字段');
    return obj;
  }
  function integer(v: unknown, p: string, min: number, max: number): number {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) { error(p, `必须是 ${min}..${max} 的有限整数`); return min; }
    return v;
  }
  function text(v: unknown, p: string, id = false): string {
    if (typeof v !== 'string' || !v.trim() || v.length > (id ? 64 : 80) || (id && (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) || dangerous.has(v)))) {
      error(p, id ? '标识须为 1..64 位字母数字、点、下划线或短横线，且以字母数字开头' : '须为 1..80 字符纯文本'); return 'invalid';
    }
    return v;
  }
  function enumeration<T extends string>(v: unknown, p: string, options: readonly T[]): T {
    if (typeof v !== 'string' || !options.includes(v as T)) { error(p, `必须是 ${options.join(' / ')}`); return options[0]; }
    return v as T;
  }
  function array(v: unknown, p: string, max: number): unknown[] {
    if (!Array.isArray(v) || v.length > max) { error(p, `须为数组，最多 ${max} 项`); return []; }
    // Sparse arrays are not JSON arrays and would otherwise skip map validation.
    return Array.from(v);
  }
  const o = object(value, 'level', ['schemaVersion', 'rulesVersion', 'packId', 'id', 'order', 'revision', 'title', 'width', 'height', 'mask', 'palette', 'seed', 'initialPieces', 'ice', 'blockers', 'locks', 'ropes', 'portals', 'spawnPoints', 'moves', 'starThresholds', 'tools', 'scroll', 'stages', 'goals']);
  integer(o.schemaVersion, 'schemaVersion', 1, 1);
  integer(o.rulesVersion, 'rulesVersion', 1, 1);
  const width = integer(o.width, 'width', 3, 12);
  const height = integer(o.height, 'height', 3, 60);
  const area = width * height;
  const mask = array(o.mask, 'mask', 60).map((v, i) => {
    if (typeof v !== 'string' || v.length !== width || !/^[.#]+$/.test(v)) { error(`mask[${i}]`, `须为 ${width} 个 '.'(地板) 或 '#'(空洞)`); return '#'.repeat(width); }
    return v;
  });
  if (mask.length !== height) error('mask', '行数必须等于 height');
  const palette = array(o.palette, 'palette', 8).map((v, i) => integer(v, `palette[${i}]`, 0, 27));
  if (palette.length < 3 || new Set(palette).size !== palette.length) error('palette', '须为 3..8 个不重复的动物 kind');
  const kind = (v: unknown, p: string) => {
    const n = integer(v, p, 0, 27);
    if (!palette.includes(n)) error(p, '动物必须在 palette 中');
    return n;
  };
  function point(v: unknown, p: string, extra: string[] = []): [Point, Record<string, unknown>] {
    const obj = object(v, p, ['row', 'col', ...extra]);
    const result = { row: integer(obj.row, `${p}.row`, 0, height - 1), col: integer(obj.col, `${p}.col`, 0, width - 1) };
    if (mask[result.row]?.[result.col] !== '.') error(p, '坐标必须位于可玩地板');
    return [result, obj];
  }
  function uniquePoints<T extends Point>(values: T[], p: string): T[] {
    const seen = new Set<string>();
    values.forEach(v => { const key = pointKey(v); if (seen.has(key)) error(p, `坐标 (${key}) 重复`); seen.add(key); });
    return values;
  }
  const initialPieces = uniquePoints(array(o.initialPieces, 'initialPieces', area).map((v, i) => {
    const p = `initialPieces[${i}]`; const [at, obj] = point(v, p, ['kind', 'special']);
    return { ...at, kind: kind(obj.kind, `${p}.kind`), ...(obj.special === undefined ? {} : { special: enumeration(obj.special, `${p}.special`, specials) }) };
  }), 'initialPieces');
  const ice = uniquePoints(array(o.ice, 'ice', area).map((v, i) => {
    const p = `ice[${i}]`; const [at, obj] = point(v, p, ['layers']);
    return { ...at, layers: integer(obj.layers, `${p}.layers`, 1, 3) };
  }), 'ice');
  const blockers = uniquePoints(array(o.blockers, 'blockers', area).map((v, i) => {
    const p = `blockers[${i}]`; const [at, obj] = point(v, p, ['blocker']);
    const b = object(obj.blocker, `${p}.blocker`, ['type', 'layers', 'color', 'reward', 'colors', 'index']);
    const type = enumeration(b.type, `${p}.blocker.type`, ['snow', 'gift', 'poison', 'crystal'] as const);
    const allowed = { snow: ['type', 'layers'], gift: ['type', 'color', 'reward'], poison: ['type'], crystal: ['type', 'colors', 'index'] }[type];
    object(b, `${p}.blocker`, allowed);
    let blocker: Blocker;
    if (type === 'snow') blocker = { type, layers: integer(b.layers, `${p}.blocker.layers`, 1, 5) };
    else if (type === 'gift') {
      const r = object(b.reward, `${p}.blocker.reward`, ['tool', 'count']);
      blocker = { type, color: kind(b.color, `${p}.blocker.color`), reward: { tool: enumeration(r.tool, `${p}.blocker.reward.tool`, tools), count: integer(r.count, `${p}.blocker.reward.count`, 1, 99) } };
    } else if (type === 'crystal') {
      const colors = array(b.colors, `${p}.blocker.colors`, 8).map((v, j) => kind(v, `${p}.blocker.colors[${j}]`));
      if (!colors.length || new Set(colors).size !== colors.length) error(`${p}.blocker.colors`, '须为 1..8 个不同的 palette 颜色');
      blocker = { type, colors, index: integer(b.index, `${p}.blocker.index`, 0, Math.max(0, colors.length - 1)) };
    } else blocker = { type };
    return { ...at, blocker };
  }), 'blockers');
  const locks = uniquePoints(array(o.locks, 'locks', area).map((v, i) => {
    const p = `locks[${i}]`; const [at, obj] = point(v, p, ['type']);
    return { ...at, type: enumeration(obj.type, `${p}.type`, ['vine', 'fur'] as const) };
  }), 'locks');
  const ropes = array(o.ropes, 'ropes', area * 2).map((v, i) => {
    const p = `ropes[${i}]`; const obj = object(v, p, ['from', 'to']);
    return { from: point(obj.from, `${p}.from`)[0], to: point(obj.to, `${p}.to`)[0] };
  });
  const portals = array(o.portals, 'portals', area).map((v, i) => {
    const p = `portals[${i}]`; const obj = object(v, p, ['id', 'from', 'to']);
    return { id: text(obj.id, `${p}.id`, true), from: point(obj.from, `${p}.from`)[0], to: point(obj.to, `${p}.to`)[0] };
  });
  const spawnPoints = uniquePoints(array(o.spawnPoints, 'spawnPoints', area).map((v, i) => point(v, `spawnPoints[${i}]`)[0]), 'spawnPoints');
  const thresholdValues = o.starThresholds === undefined ? DEFAULT_STAR_THRESHOLDS : array(o.starThresholds, 'starThresholds', 3).map((v, i) => integer(v, `starThresholds[${i}]`, 0, Number.MAX_SAFE_INTEGER));
  if (thresholdValues.length !== 3) error('starThresholds', '须提供一星、二星、三星三个分数门槛');
  if (thresholdValues.some((value, i) => i > 0 && value <= thresholdValues[i - 1])) error('starThresholds', '三个分数门槛必须严格递增');
  const starThresholds: StarThresholds = [thresholdValues[0], thresholdValues[1], thresholdValues[2]];
  const goalIds = new Set<string>();
  function goals(v: unknown, p: string): Goal[] {
    return array(v, p, 64).map((entry, i) => {
      const path = `${p}[${i}]`; const g = object(entry, path, ['id', 'type', 'kind', 'obstacle', 'unit', 'special', 'count']);
      const id = text(g.id, `${path}.id`, true);
      if (goalIds.has(id)) error(`${path}.id`, '全局和所有阶段的目标 id 不得重复');
      goalIds.add(id);
      const type = enumeration(g.type, `${path}.type`, ['collect', 'clear', 'special', 'score'] as const);
      object(g, path, ['id', 'type', 'count', ...{ collect: ['kind'], clear: ['obstacle', 'unit'], special: ['special'], score: [] }[type]]);
      const count = integer(g.count, `${path}.count`, 1, type === 'score' ? 1000000000 : 1000000);
      if (type === 'collect') return { id, type, count, kind: kind(g.kind, `${path}.kind`) };
      if (type === 'clear') return { id, type, count, obstacle: enumeration(g.obstacle, `${path}.obstacle`, obstacles), unit: enumeration(g.unit, `${path}.unit`, ['layers', 'objects'] as const) };
      if (type === 'special') return { id, type, count, special: enumeration(g.special, `${path}.special`, specials) };
      return { id, type, count };
    });
  }
  const globalGoals = goals(o.goals, 'goals');
  const stageIds = new Set<string>();
  const stages = array(o.stages, 'stages', 60).map((v, i) => {
    const p = `stages[${i}]`; const s = object(v, p, ['id', 'startRow', 'rows', 'goals']);
    const id = text(s.id, `${p}.id`, true);
    if (stageIds.has(id)) error(`${p}.id`, '阶段 id 重复'); stageIds.add(id);
    return { id, startRow: integer(s.startRow, `${p}.startRow`, 0, height - 1), rows: integer(s.rows, `${p}.rows`, 1, 10), goals: goals(s.goals, `${p}.goals`) };
  });
  const t = object(o.tools, 'tools', tools);
  if (typeof o.scroll !== 'boolean') error('scroll', '须为布尔值');
  const level: Level = {
    schemaVersion: 1, rulesVersion: 1,
    packId: text(o.packId, 'packId', true), id: text(o.id, 'id', true),
    order: integer(o.order, 'order', 0, 1000000), revision: integer(o.revision, 'revision', 1, 1000000), title: text(o.title, 'title'),
    width, height, mask, palette,
    ...(o.seed === undefined ? {} : { seed: integer(o.seed, 'seed', 0, 0xffffffff) }),
    initialPieces, ice, blockers, locks, ropes, portals, spawnPoints,
    moves: integer(o.moves, 'moves', 1, 10000),
    starThresholds,
    tools: { hammer: integer(t.hammer, 'tools.hammer', 0, 999), swap: integer(t.swap, 'tools.swap', 0, 999), shuffle: integer(t.shuffle, 'tools.shuffle', 0, 999) },
    scroll: o.scroll === true, stages, goals: globalGoals,
  };
  if (errors.length) return { errors, warnings };

  let nextRow = 0;
  stages.forEach((s, i) => {
    if (s.startRow !== nextRow) error(`stages[${i}]`, '阶段须按行连续、不重叠，从第 0 行覆盖整图');
    nextRow = s.startRow + s.rows;
    if (!s.goals.length && !(i === stages.length - 1 && globalGoals.length)) error(`stages[${i}].goals`, '每段需要目标，仅末段可由全局目标完成');
    if (!mask.slice(s.startRow, nextRow).some(row => row.includes('.'))) error(`stages[${i}]`, '阶段不能全为空洞');
  });
  if (!stages.length || nextRow !== height) error('stages', '阶段须完整覆盖 height');
  if (!level.scroll && stages.length !== 1) error('scroll', 'false 时必须恰好 1 段');
  const stageOf = (p: Point) => stages.findIndex(s => p.row >= s.startRow && p.row < s.startRow + s.rows);
  const blocked = new Set(blockers.map(pointKey));
  for (const [name, entries] of [['initialPieces', initialPieces], ['ice', ice], ['locks', locks]] as const) {
    for (const p of entries) if (blocked.has(pointKey(p))) error(name, `(${pointKey(p)}) 不可与占格 blocker 叠加`);
  }
  const ropeKeys = new Set<string>();
  ropes.forEach((r, i) => {
    if (Math.abs(r.from.row - r.to.row) + Math.abs(r.from.col - r.to.col) !== 1) error(`ropes[${i}]`, '绳边两端必须正交相邻');
    if (stageOf(r.from) !== stageOf(r.to)) error(`ropes[${i}]`, '绳子不可跨段');
    const key = [pointKey(r.from), pointKey(r.to)].sort().join('/');
    if (ropeKeys.has(key)) error(`ropes[${i}]`, '绳边重复（包含反向）'); ropeKeys.add(key);
  });
  const portalIds = new Set<string>();
  const exits = new Map<string, string>();
  portals.forEach((p, i) => {
    if (portalIds.has(p.id)) error(`portals[${i}].id`, '门户 id 重复'); portalIds.add(p.id);
    if (pointKey(p.from) === pointKey(p.to)) error(`portals[${i}]`, '入口不能等于出口');
    if (stageOf(p.from) !== stageOf(p.to)) error(`portals[${i}]`, '门户不可跨段');
    if (exits.has(pointKey(p.from))) error(`portals[${i}].from`, '一个入口只能有一个出口');
    exits.set(pointKey(p.from), pointKey(p.to));
  });
  // A portal replaces the normal downward edge at its entrance. Inspect the
  // eventual floor graph too, not just today's blockers, which can be removed.
  const edges = new Map<string, string>();
  const floors: string[] = [];
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    if (mask[row][col] !== '.') continue;
    const p = { row, col }; const key = pointKey(p); floors.push(key);
    const below = { row: row + 1, col };
    if (exits.has(key)) edges.set(key, exits.get(key)!);
    else if (mask[row + 1]?.[col] === '.' && stageOf(p) === stageOf(below)) edges.set(key, pointKey(below));
  }
  const incoming = new Map<string, string>();
  edges.forEach((to, from) => {
    if (incoming.has(to)) error('portals', `(${to}) 存在歧义入边：${incoming.get(to)} 与 ${from}`);
    incoming.set(to, from);
  });
  const visited = new Set<string>();
  for (const start of floors) {
    const path = new Set<string>(); let at: string | undefined = start;
    while (at !== undefined && !visited.has(at)) {
      if (path.has(at)) { error('portals', `普通下落与门户形成循环 (${at})`); break; }
      path.add(at); at = edges.get(at);
    }
    path.forEach(p => visited.add(p));
  }
  if (spawnPoints.length) {
    const unavailable = new Set([...blocked, ...locks.map(pointKey)]);
    for (const [label, omitted] of [['障碍清除后', new Set<string>()], ['初始障碍/锁定截断后', unavailable]] as const) {
      const reached = new Set<string>();
      for (const source of spawnPoints) {
        let at: string | undefined = pointKey(source);
        while (at !== undefined && !reached.has(at) && !omitted.has(at)) { reached.add(at); at = edges.get(at); }
      }
      const missing = floors.filter(p => !omitted.has(p) && !reached.has(p));
      if (missing.length) error('spawnPoints', `${label}有不可供料地板，如 (${missing[0]})；可用 [] 自动生成各通路入口`);
    }
  }
  function checkGoals(list: Goal[], start: number, end: number, path: string) {
    const inside = (p: Point) => p.row >= start && p.row < end;
    list.forEach(g => {
      if (g.type !== 'clear') return;
      let maximum = 0;
      if (g.obstacle === 'ice') maximum = ice.filter(inside).reduce((sum, item) => sum + (g.unit === 'layers' ? item.layers : 1), 0);
      else if (g.obstacle === 'vine' || g.obstacle === 'fur') maximum = locks.filter(p => inside(p) && p.type === g.obstacle).length;
      else maximum = blockers.filter(p => inside(p) && p.blocker.type === g.obstacle).reduce((sum, p) => sum + (g.unit === 'layers' && p.blocker.type === 'snow' ? p.blocker.layers : 1), 0);
      if (g.obstacle === 'poison' && maximum > 0) {
        warnings.push(`${path}.${g.id}: 毒液会扩张，目标 ${g.count} 的可达性需实际试关，不能由初始数量证明`);
      } else if (g.count > maximum) error(`${path}.${g.id}`, `目标 ${g.count} 超过本范围可清${g.unit === 'layers' ? '层数' : '实体数'} ${maximum}`);
    });
  }
  checkGoals(globalGoals, 0, height, 'goals');
  stages.forEach((s, i) => checkGoals(s.goals, s.startRow, s.startRow + s.rows, `stages[${i}].goals`));
  if (locks.some(p => p.type === 'fur') || blockers.some(p => p.blocker.type === 'crystal')) warnings.push('动态毛球/水晶球的可达性需要试关；结构校验不证明必胜');
  if (portals.length || spawnPoints.length || mask.some(row => row.includes('#'))) warnings.push('异形/门户/显式供料已通过静态检查，仍需试关检查可操作性');
  const presets = new Map(initialPieces.filter(p => p.special !== 'bird').map(p => [pointKey(p), p.kind]));
  if (initialPieces.some(p => [[0, 1], [1, 0]].some(([dr, dc]) => presets.has(pointKey(p)) && [1, 2].every(n => stageOf(p) === stageOf({ row: p.row + dr * n, col: p.col + dc * n }) && presets.get(`${p.row + dr * n},${p.col + dc * n}`) === p.kind)))) warnings.push('initialPieces 含开局三连；请勿用预置自动消除代替教学操作，并检查引擎开局修复结果');
  warnings.push('结构合法不代表关卡必胜；请用固定种子及真实操作试关');
  return errors.length ? { errors, warnings } : { level, errors, warnings };
}

/** Atomic import: one error anywhere means no returned levels. Twenty is not a cap. */
export function parsePack(text: string): { levels: Level[]; errors: string[] } {
  if (typeof text !== 'string' || bytes(text) > MAX_PACK_BYTES) return { levels: [], errors: ['单包不能超过 2 MiB'] };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { levels: [], errors: ['JSON 语法错误：请检查引号、逗号和括号'] }; }
  let entries: unknown[];
  if (Array.isArray(value)) entries = value;
  else if (value && typeof value === 'object' && Object.hasOwn(value, 'levels')) {
    const pack = value as Record<string, unknown>;
    const keys = Object.keys(pack);
    if (pack.schemaVersion !== 1 || keys.some(k => !['schemaVersion', 'levels'].includes(k)) || !Array.isArray(pack.levels)) return { levels: [], errors: ['关卡包只允许 {schemaVersion:1,levels:[...]}'] };
    entries = pack.levels;
  } else entries = [value];
  if (!entries.length || entries.length > 200) return { levels: [], errors: ['每包须为 1..200 关'] };
  const levels: Level[] = []; const errors: string[] = []; const keys = new Set<string>();
  entries.forEach((entry, i) => {
    const result = validateLevel(entry);
    errors.push(...result.errors.map(e => `关卡[${i}]: ${e}`));
    if (result.level) {
      const key = levelKey(result.level);
      if (keys.has(key)) errors.push(`关卡[${i}]: packId/id 重复 ${key}`);
      keys.add(key); levels.push(result.level);
    }
  });
  return { levels: errors.length ? [] : levels, errors };
}

export function createTemplate(): Level {
  return {
    schemaVersion: 1, rulesVersion: 1, packId: 'custom', id: 'new-level', order: 1, revision: 1, title: '新的动物乐园',
    width: 9, height: 9, mask: Array.from({ length: 9 }, () => '.........'), palette: [0, 1, 2, 3], seed: 20261123,
    initialPieces: [], ice: [], blockers: [], locks: [], ropes: [], portals: [], spawnPoints: [],
    moves: 32, starThresholds: [...DEFAULT_STAR_THRESHOLDS], tools: { hammer: 2, swap: 2, shuffle: 2 }, scroll: false,
    stages: [{ id: 'stage1', startRow: 0, rows: 9, goals: [] }],
    goals: [{ id: 'collect-cat', type: 'collect', kind: 0, count: 18 }],
  };
}
