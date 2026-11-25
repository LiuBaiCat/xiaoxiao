import type { Blocker, Goal, Level, Point, Special, Tool } from '../engine/types';

export const HISTORY_LIMIT = 80;
export const USER_PACK = 'user';
export const samePoint = (a: Point, b: Point) => a.row === b.row && a.col === b.col;
export const copyLevel = (level: Level): Level => JSON.parse(JSON.stringify(level)) as Level;
export const sameLevel = (a: Level, b: Level) => JSON.stringify(a) === JSON.stringify(b);
export const inside = (level: Level, p: Point) => p.row >= 0 && p.col >= 0 && p.row < level.height && p.col < level.width;
export const isGround = (level: Level, p: Point) => inside(level, p) && level.mask[p.row]?.[p.col] === '.';
export const sortLevels = (levels: Level[]) => [...levels].sort((a, b) => a.order - b.order || a.packId.localeCompare(b.packId) || a.id.localeCompare(b.id));

export type History = { past: Level[]; present: Level; future: Level[] };
export const startHistory = (level: Level): History => ({ past: [], present: copyLevel(level), future: [] });
export function editHistory(history: History, next: Level, checkpoint = true): History {
  if (sameLevel(history.present, next)) return history;
  return { past: checkpoint ? [...history.past, history.present].slice(-HISTORY_LIMIT) : history.past, present: next, future: [] };
}
export function undo(history: History): History {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future].slice(0, HISTORY_LIMIT) };
}
export function redo(history: History): History {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: history.future[0], future: history.future.slice(1) };
}

export type EraseLayer = 'all' | 'piece' | 'ice' | 'blocker' | 'lock' | 'rope' | 'portal' | 'spawn';
export type BrushKind = 'inspect' | 'ground' | 'hole' | 'piece' | Special | 'ice' | 'snow' | 'vine' | 'fur' | 'gift' | 'poison' | 'crystal' | 'rope' | 'portal' | 'spawn' | 'erase';
export type Brush = {
  kind: BrushKind;
  color: number;
  layers: number;
  rewardTool: Tool;
  rewardCount: number;
  crystalColors: number[];
  eraseLayer: EraseLayer;
};
export const defaultBrush: Brush = { kind: 'inspect', color: 0, layers: 1, rewardTool: 'hammer', rewardCount: 1, crystalColors: [0, 1, 2], eraseLayer: 'all' };

function eraseAt(level: Level, point: Point, layer: EraseLayer) {
  const all = layer === 'all';
  if (all || layer === 'piece') level.initialPieces = level.initialPieces.filter(p => !samePoint(p, point));
  if (all || layer === 'ice') level.ice = level.ice.filter(p => !samePoint(p, point));
  if (all || layer === 'blocker') level.blockers = level.blockers.filter(p => !samePoint(p, point));
  if (all || layer === 'lock') level.locks = level.locks.filter(p => !samePoint(p, point));
  if (all || layer === 'rope') level.ropes = level.ropes.filter(p => !samePoint(p.from, point) && !samePoint(p.to, point));
  if (all || layer === 'portal') level.portals = level.portals.filter(p => !samePoint(p.from, point) && !samePoint(p.to, point));
  if (all || layer === 'spawn') level.spawnPoints = level.spawnPoints.filter(p => !samePoint(p, point));
}

/** Each stroke edits only the requested layer, except explicitly incompatible occupants. */
export function paintCells(source: Level, points: Point[], brush: Brush): Level {
  if (['inspect', 'rope', 'portal'].includes(brush.kind)) return source;
  const level = copyLevel(source);
  for (const point of points) {
    if (!inside(level, point)) continue;
    const { row, col } = point;
    if (brush.kind === 'ground' || brush.kind === 'hole') {
      const mask = [...level.mask[row]];
      mask[col] = brush.kind === 'ground' ? '.' : '#';
      level.mask[row] = mask.join('');
      if (brush.kind === 'hole') eraseAt(level, point, 'all');
      continue;
    }
    if (brush.kind === 'erase') { eraseAt(level, point, brush.eraseLayer); continue; }
    if (!isGround(level, point)) continue;
    if (brush.kind === 'spawn') {
      if (!level.spawnPoints.some(p => samePoint(p, point))) level.spawnPoints.push({ row, col });
    } else if (brush.kind === 'ice') {
      eraseAt(level, point, 'blocker');
      level.ice = [...level.ice.filter(p => !samePoint(p, point)), { row, col, layers: Math.max(1, Math.min(3, brush.layers)) }];
    } else if (brush.kind === 'vine' || brush.kind === 'fur') {
      eraseAt(level, point, 'blocker');
      level.locks = [...level.locks.filter(p => !samePoint(p, point)), { row, col, type: brush.kind }];
    } else if (['snow', 'gift', 'poison', 'crystal'].includes(brush.kind)) {
      eraseAt(level, point, 'piece');
      eraseAt(level, point, 'lock');
      eraseAt(level, point, 'ice');
      let blocker: Blocker;
      if (brush.kind === 'snow') blocker = { type: 'snow', layers: Math.max(1, Math.min(5, brush.layers)) };
      else if (brush.kind === 'gift') blocker = { type: 'gift', color: brush.color, reward: { tool: brush.rewardTool, count: brush.rewardCount } };
      else if (brush.kind === 'crystal') blocker = { type: 'crystal', colors: [...brush.crystalColors], index: 0 };
      else blocker = { type: 'poison' };
      level.blockers = [...level.blockers.filter(p => !samePoint(p, point)), { row, col, blocker }];
    } else {
      eraseAt(level, point, 'blocker');
      const special = brush.kind === 'piece' ? undefined : brush.kind as Special;
      level.initialPieces = [...level.initialPieces.filter(p => !samePoint(p, point)), { row, col, kind: brush.color, ...(special ? { special } : {}) }];
    }
  }
  return sameLevel(source, level) ? source : level;
}

export function connectCells(source: Level, from: Point, to: Point, kind: 'rope' | 'portal'): { level: Level; error?: string } {
  const fail = (error: string) => ({ level: source, error });
  if (!isGround(source, from) || !isGround(source, to)) return fail('连线两端都必须是地板格。');
  if (samePoint(from, to)) return fail('请选择另一个格子；取消配对可按 Esc。');
  const level = copyLevel(source);
  if (kind === 'rope') {
    if (Math.abs(from.row - to.row) + Math.abs(from.col - to.col) !== 1) return fail('绳子只能连接上下或左右相邻的两个格子。');
    const stageAt = (point: Point) => source.stages.findIndex(s => point.row >= s.startRow && point.row < s.startRow + s.rows);
    if (stageAt(from) < 0 || stageAt(from) !== stageAt(to)) return fail('绳子不能跨越阶段边界。');
    const existing = level.ropes.findIndex(r => (samePoint(r.from, from) && samePoint(r.to, to)) || (samePoint(r.from, to) && samePoint(r.to, from)));
    if (existing >= 0) level.ropes.splice(existing, 1);
    else level.ropes.push({ from: { ...from }, to: { ...to } });
  } else {
    const stageAt = (p: Point) => level.stages.findIndex(s => p.row >= s.startRow && p.row < s.startRow + s.rows);
    if (stageAt(from) < 0 || stageAt(from) !== stageAt(to)) return fail('传送门入口和出口必须属于同一个阶段。');
    if (level.portals.some(p => [p.from, p.to].some(a => samePoint(a, from) || samePoint(a, to)))) return fail('此格已有传送门。请先用“擦除 → 传送门”移除整对门。');
    let id = 1;
    while (level.portals.some(p => p.id === `portal-${id}`)) id++;
    level.portals.push({ id: `portal-${id}`, from: { ...from }, to: { ...to } });
  }
  return { level };
}

export function clearBoard(source: Level): Level {
  return { ...copyLevel(source), mask: Array.from({ length: source.height }, () => '.'.repeat(source.width)), initialPieces: [], ice: [], blockers: [], locks: [], ropes: [], portals: [], spawnPoints: [] };
}

export function resizeLevel(source: Level, width: number, height: number): { level: Level; removed: number } {
  const level = copyLevel(source);
  const fits = (p: Point) => p.row >= 0 && p.row < height && p.col >= 0 && p.col < width;
  let removed = 0;
  const keep = <T extends Point>(items: T[]) => { const result = items.filter(fits); removed += items.length - result.length; return result; };
  level.initialPieces = keep(level.initialPieces);
  level.ice = keep(level.ice);
  level.blockers = keep(level.blockers);
  level.locks = keep(level.locks);
  level.spawnPoints = keep(level.spawnPoints);
  level.ropes = level.ropes.filter(p => { const valid = fits(p.from) && fits(p.to); if (!valid) removed++; return valid; });
  level.portals = level.portals.filter(p => { const valid = fits(p.from) && fits(p.to); if (!valid) removed++; return valid; });
  source.mask.forEach((row, r) => [...row].forEach((cell, c) => { if (cell === '#' && (r >= height || c >= width)) removed++; }));
  level.width = width;
  level.height = height;
  level.mask = Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => source.mask[r]?.[c] ?? '.').join(''));
  level.stages = level.stages.filter(stage => { if (stage.startRow < height) return true; removed += 1 + stage.goals.length; return false; }).map(stage => ({ ...stage, rows: Math.min(stage.rows, height - stage.startRow) }));
  if (source.height !== height && level.stages.length) {
    const last = level.stages.at(-1)!;
    if (last.startRow + last.rows === source.height && height > source.height) {
      if (!level.scroll) last.rows = height - last.startRow;
      else {
        let row = source.height;
        while (row < height) {
          const rows = Math.min(9, height - row);
          const id = freshId('stage', level.stages.map(s => s.id));
          level.stages.push({ id, startRow: row, rows, goals: [] });
          row += rows;
        }
      }
    }
  }
  return { level, removed };
}

export function freshId(base: string, ids: string[]): string {
  const prefix = base.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'level';
  let id = prefix, suffix = 2;
  while (ids.includes(id)) id = `${prefix}-${suffix++}`;
  return id;
}
export function userCopy(source: Level, existing: Level[], title = `${source.title}（副本）`): Level {
  return { ...copyLevel(source), packId: USER_PACK, id: freshId(source.id, existing.filter(l => l.packId === USER_PACK).map(l => l.id)), title: title.slice(0, 80), revision: 1, order: Math.max(0, ...existing.map(l => l.order)) + 1 };
}
export function allGoalIds(level: Level): string[] { return [...level.goals, ...level.stages.flatMap(s => s.goals)].map(g => g.id); }
export function newGoal(type: Goal['type'], id: string, palette: number[]): Goal {
  const count = type === 'score' ? 1000 : 10;
  if (type === 'collect') return { id, type, count, kind: palette[0] ?? 0 };
  if (type === 'clear') return { id, type, count, obstacle: 'ice', unit: 'layers' };
  if (type === 'special') return { id, type, count, special: 'row' };
  return { id, type, count };
}

/** Fill skipped cells when a fast pointer movement crosses several grid cells. */
export function strokeLine(from: Point, to: Point): Point[] {
  const steps = Math.max(Math.abs(to.row - from.row), Math.abs(to.col - from.col));
  return Array.from({ length: steps || 1 }, (_, i) => ({ row: Math.round(from.row + (to.row - from.row) * (i + 1) / (steps || 1)), col: Math.round(from.col + (to.col - from.col) * (i + 1) / (steps || 1)) }));
}
