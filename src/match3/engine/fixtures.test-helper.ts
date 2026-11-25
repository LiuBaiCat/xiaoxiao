import type { Level, MatchGame } from './types';

export function level(width = 6, height = 6): Level {
  return { schemaVersion: 1, rulesVersion: 1, packId: 'tests', id: 'fixed', order: 1, revision: 1, title: '固定测试',
    width, height, mask: Array(height).fill('.'.repeat(width)), palette: [0, 1, 2, 3, 4, 5], moves: 20,
    initialPieces: [], ice: [], blockers: [], locks: [], ropes: [], portals: [], spawnPoints: [],
    starThresholds: [1000, 2000, 3000], tools: { hammer: 2, swap: 2, shuffle: 2 }, scroll: false,
    stages: [{ id: 'one', startRow: 0, rows: height, goals: [] }], goals: [{ id: 'score', type: 'score', count: 1000000 }],
  };
}
export function fixture(rows?: string[], width = 7, height = 7): MatchGame {
  if (rows) { width = rows[0].length; height = rows.length; }
  const l = level(width, height);
  const board: MatchGame['board'] = Array.from({ length: width * height }, (_, i) => {
    const ch = rows?.[Math.floor(i / width)][i % width];
    return { ground: ch !== '#', piece: ch === '.' || ch === '#' ? null : { id: i + 1, kind: ch === undefined ? (Math.floor(i / width) * 2 + i % width) % 6 : Number(ch) },
      ice: 0, blocker: null, lock: null };
  });
  l.mask = Array.from({ length: height }, (_, r) => board.slice(r * width, (r + 1) * width).map(c => c.ground ? '.' : '#').join(''));
  return { version: 1, level: l, mode: 'normal', phase: 'playing', board, stageIndex: 0, movesLeft: 20,
    tools: { ...l.tools }, goalProgress: {}, score: 0, turn: 0, rng: 1234567, nextId: board.length + 1,
    unlimitedMoves: false, unlimitedTools: false, events: [], note: '', pauseReason: 'intro' };
}
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
