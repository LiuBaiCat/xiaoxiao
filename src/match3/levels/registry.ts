/// <reference types="vite/client" />
import type { Level } from '../engine/types';
import { levelKey, validateLevel } from './schema';

// Eager JSON imports are bundled into the offline HTML; never fetch at runtime.
const modules = import.meta.glob<unknown>('./builtin/*.json', { eager: true, import: 'default' });
const keys = new Set<string>();
export const builtinLevels: Level[] = Object.entries(modules).map(([file, value]) => {
  const result = validateLevel(value);
  if (!result.level) throw new Error(`内置关卡 ${file} 无效：\n${result.errors.join('\n')}`);
  const key = levelKey(result.level);
  if (keys.has(key)) throw new Error(`内置关卡 packId/id 重复：${key}`);
  keys.add(key);
  return result.level;
}).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || (a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0));
