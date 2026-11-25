import type { Goal, Level, Point } from '../engine/types';
import { levelKey, parsePack, validateLevel } from '../levels/schema';
import { copyLevel, freshId, sortLevels } from './model';

export const DRAFT_KEY = 'slow-paws-match3:editor:v1';
export const FILE_LIMIT = 256 * 1024;
export const PACK_LIMIT = 2 * 1024 * 1024;
export const LEVEL_LIMIT = 200;
export const byteSize = (text: string) => new TextEncoder().encode(text).byteLength;
export type ImportFile = { name: string; size: number; text: () => Promise<string> };
export type ImportChoice = 'overwrite' | 'copy';
export type ImportConflict = { key: string; existing: Level; incoming: Level };

function importedPackId(packId: string): string {
  // A stable, bounded namespace keeps all built-in packs separate from user originals.
  let hash = 2166136261;
  for (const char of packId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `user-import-${(hash >>> 0).toString(16)}`;
}
export function normalizeImported(level: Level, builtin: Level[]): Level {
  const result = copyLevel(level);
  if (result.packId === 'builtin' || result.packId.startsWith('builtin-') || builtin.some(l => l.packId === result.packId)) result.packId = importedPackId(result.packId);
  return result;
}

/** Read and validate every file before returning any candidate for publication. */
export async function readImport(files: ImportFile[], builtin: Level[]): Promise<{ levels: Level[]; errors: string[] }> {
  const errors: string[] = [];
  if (!files.length) return { levels: [], errors: ['没有选择文件。'] };
  if (files.length > LEVEL_LIMIT) return { levels: [], errors: ['一次最多选择 200 个文件。'] };
  if (files.reduce((sum, file) => sum + file.size, 0) > PACK_LIMIT) return { levels: [], errors: ['本次导入合计不能超过 2 MiB。'] };
  for (const file of files) if (file.size > FILE_LIMIT) errors.push(`${file.name}：单个文件不能超过 256 KiB。`);
  if (errors.length) return { levels: [], errors };
  const levels: Level[] = [];
  const keys = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      totalBytes += byteSize(text);
      if (byteSize(text) > FILE_LIMIT || totalBytes > PACK_LIMIT) { errors.push(`${file.name}：文件或本次导入体积超限。`); continue; }
      const result = parsePack(text);
      if (result.errors.length) { errors.push(...result.errors.map(error => `${file.name}：${error}`)); continue; }
      for (const original of result.levels) {
        const level = normalizeImported(original, builtin);
        const key = levelKey(level);
        if (keys.has(key)) { errors.push(`${file.name}：本批文件包含重复关卡 ${key}，请先去掉重复文件。`); continue; }
        keys.add(key);
        if (byteSize(JSON.stringify(level)) > FILE_LIMIT) errors.push(`${file.name}：${level.title} 单关超过 256 KiB。`);
        const checked = validateLevel(level);
        errors.push(...checked.errors.map(error => `${file.name}：${error}`));
        levels.push(level);
      }
    } catch { errors.push(`${file.name}：读取或解析失败，未导入任何关卡。`); }
  }
  if (levels.length > LEVEL_LIMIT) errors.push('一次最多导入 200 关。');
  return { levels: errors.length ? [] : levels, errors };
}

export function importConflicts(incoming: Level[], existing: Level[]): ImportConflict[] {
  const byKey = new Map(existing.map(level => [levelKey(level), level]));
  return incoming.flatMap(level => {
    const previous = byKey.get(levelKey(level));
    return previous ? [{ key: levelKey(level), existing: previous, incoming: level }] : [];
  });
}

/** No mutation and no partial output on a missing decision, invalid level or size limit. */
export function mergeImport(existing: Level[], incoming: Level[], choices: Record<string, ImportChoice>, reserved: Level[] = existing): { levels: Level[]; imported: Level[]; errors: string[] } {
  const occupied = [...existing, ...reserved, ...incoming];
  const conflicts = new Set(importConflicts(incoming, [...existing, ...reserved]).map(c => c.key));
  const result = existing.map(copyLevel);
  const imported: Level[] = [];
  const errors: string[] = [];
  for (const original of incoming) {
    const key = levelKey(original);
    if (conflicts.has(key) && !choices[key]) { errors.push(`${key} 尚未选择覆盖或另存。`); continue; }
    const level = copyLevel(original);
    if (conflicts.has(key) && choices[key] === 'copy') {
      level.id = freshId(`${level.id}-copy`, occupied.filter(l => l.packId === level.packId).map(l => l.id));
      level.title = `${level.title.slice(0, 74)}（导入副本）`;
      level.order = Math.max(0, ...occupied.map(l => l.order)) + 1;
      occupied.push(level);
    }
    const validation = validateLevel(level);
    errors.push(...validation.errors.map(e => `${level.title}：${e}`));
    const index = result.findIndex(l => levelKey(l) === levelKey(level));
    if (index < 0) result.push(level); else result[index] = level;
    imported.push(level);
  }
  if (result.length > LEVEL_LIMIT) errors.push('用户关卡集合最多 200 关，请先导出备份并删除不用的关卡。');
  if (byteSize(JSON.stringify({ schemaVersion: 1, levels: result })) > PACK_LIMIT) errors.push('合并后的用户关卡包超过 2 MiB。');
  return errors.length ? { levels: [], imported: [], errors } : { levels: sortLevels(result), imported, errors: [] };
}

export function commitCollection(next: Level[], builtin: Level[], onChange: (levels: Level[]) => boolean): string[] {
  const errors: string[] = [];
  if (next.some(l => l.packId === 'builtin' || l.packId.startsWith('builtin-') || builtin.some(b => b.packId === l.packId))) errors.push('内置包是只读的，不能提交到用户关卡集合。请先另存。');
  if (next.length > LEVEL_LIMIT) errors.push('用户关卡集合最多 200 关。');
  if (new Set(next.map(levelKey)).size !== next.length) errors.push('用户集合含重复的稳定标识，未保存。');
  for (const item of next) {
    errors.push(...validateLevel(item).errors.map(error => `${item.title}：${error}`));
    if (byteSize(JSON.stringify(item)) > FILE_LIMIT) errors.push(`${item.title}：单关超过 256 KiB。`);
  }
  if (byteSize(JSON.stringify({ schemaVersion: 1, levels: next })) > PACK_LIMIT) errors.push('用户关卡包超过 2 MiB。');
  if (errors.length) return errors;
  try {
    if (!onChange(next.map(copyLevel))) return ['父页面保存用户关卡失败（可能存储空间不足）。未确认发布成功，草稿仍保留，请导出备份。'];
  } catch { return ['父页面保存用户关卡时发生错误。草稿仍保留，请导出备份。']; }
  return [];
}

export function prepareTrial(level: Level): { level?: Level; errors: string[] } {
  const result = validateLevel(level);
  return result.errors.length ? { errors: ['草稿存在错误，禁止试关。', ...result.errors] } : { level: copyLevel(result.level ?? level), errors: [] };
}

export function encodeExport(levels: Level[], single = false): string {
  return JSON.stringify(single ? levels[0] : { schemaVersion: 1, levels }, null, 2);
}
export function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Give the browser a task to consume the download URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export type DraftBundle = { version: 1; selected: string; levels: Level[] };
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 1000;
const point = (value: unknown): value is Point & Record<string, unknown> => object(value) && integer(value.row) && integer(value.col);
const list = (value: unknown, check: (item: unknown) => boolean, max = 720): boolean => Array.isArray(value) && value.length <= max && value.every(check);
const special = (value: unknown) => ['row', 'column', 'bomb', 'bird'].includes(String(value));
function goal(value: unknown): value is Goal {
  if (!object(value) || !text(value.id) || !integer(value.count)) return false;
  return value.type === 'score' || (value.type === 'collect' && integer(value.kind)) || (value.type === 'special' && special(value.special)) || (value.type === 'clear' && ['ice', 'snow', 'vine', 'fur', 'gift', 'poison', 'crystal'].includes(String(value.obstacle)) && ['layers', 'objects'].includes(String(value.unit)));
}
/** Structural guard, intentionally NOT the publishing validator: incomplete goals etc. are valid drafts. */
export function isDraftLevel(value: unknown): value is Level {
  if (!object(value) || value.schemaVersion !== 1 || value.rulesVersion !== 1) return false;
  if (![value.packId, value.id, value.title].every(text) || ![value.order, value.revision, value.moves].every(integer)) return false;
  if (!integer(value.width) || value.width < 3 || value.width > 12 || !integer(value.height) || value.height < 3 || value.height > 60) return false;
  if (!Array.isArray(value.mask) || value.mask.length !== value.height || !value.mask.every(row => typeof row === 'string' && row.length === value.width && /^[.#]+$/.test(row))) return false;
  if (!list(value.palette, integer, 28) || (value.seed !== undefined && !integer(value.seed)) || typeof value.scroll !== 'boolean') return false;
  if (value.starThresholds !== undefined && (!Array.isArray(value.starThresholds) || !list(value.starThresholds, integer, 3) || value.starThresholds.length !== 3)) return false;
  if (!object(value.tools) || ![value.tools.hammer, value.tools.swap, value.tools.shuffle].every(integer)) return false;
  if (!list(value.initialPieces, v => point(v) && object(v) && integer(v.kind) && (v.special === undefined || special(v.special)))) return false;
  if (!list(value.ice, v => point(v) && object(v) && integer(v.layers))) return false;
  if (!list(value.locks, v => point(v) && object(v) && ['vine', 'fur'].includes(String(v.type)))) return false;
  if (!list(value.blockers, v => {
    if (!point(v) || !object(v) || !object(v.blocker)) return false;
    const b = v.blocker;
    return b.type === 'poison' || (b.type === 'snow' && integer(b.layers)) || (b.type === 'gift' && integer(b.color) && object(b.reward) && ['hammer', 'swap', 'shuffle'].includes(String(b.reward.tool)) && integer(b.reward.count)) || (b.type === 'crystal' && list(b.colors, integer, 100) && integer(b.index));
  })) return false;
  if (!list(value.spawnPoints, point) || !list(value.ropes, v => object(v) && point(v.from) && point(v.to), 1440)) return false;
  if (!list(value.portals, v => object(v) && text(v.id) && point(v.from) && point(v.to))) return false;
  return list(value.goals, goal, 200) && list(value.stages, v => object(v) && text(v.id) && integer(v.startRow) && integer(v.rows) && list(v.goals, goal, 200), 60);
}
export function loadDraft(storage: StoragePort): { bundle?: DraftBundle; error?: string } {
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return {};
    if (byteSize(raw) > 4 * PACK_LIMIT) throw new Error('size');
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || !text(value.selected) || !list(value.levels, isDraftLevel, 240)) throw new Error('shape');
    const levels = value.levels as Level[];
    if (new Set(levels.map(levelKey)).size !== levels.length) throw new Error('duplicate');
    return { bundle: { version: 1, selected: value.selected, levels } };
  } catch { return { error: '无法读取编辑草稿（格式不兼容、损坏或浏览器禁用存储）。原草稿未覆盖；可继续编辑并导出备份。' }; }
}
export function saveDraft(storage: StoragePort, bundle: DraftBundle): string | undefined {
  try {
    const raw = JSON.stringify(bundle);
    if (byteSize(raw) > 4 * PACK_LIMIT) return '草稿超过 8 MiB，未写入浏览器。请导出备份并减少草稿数量。';
    storage.setItem(DRAFT_KEY, raw);
  } catch { return '草稿保存失败（空间不足或浏览器禁用存储）。当前编辑仍在内存中，请立即导出备份，勿关闭页面。'; }
}

export function changedFields(previous: Level, next: Level): string[] {
  const names: Record<string, string> = { title: '名称', revision: '修订', order: '排序', width: '宽度', height: '高度', moves: '步数', starThresholds: '星级分数', tools: '道具', palette: '动物种类', mask: '地板形状', seed: '种子', initialPieces: '预置动物/特效', ice: '冰层', blockers: '占格障碍', locks: '覆盖层', ropes: '绳边', portals: '传送门', spawnPoints: '补充点', scroll: '滚动规则', stages: '阶段', goals: '目标' };
  return Object.keys(names).filter(key => JSON.stringify(previous[key as keyof Level]) !== JSON.stringify(next[key as keyof Level])).map(key => names[key]);
}
