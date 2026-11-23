import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AnimalIcon, animals } from '../components/AnimalIcon';
import { createBoard, ensurePlayable, findMove, remainingPairs } from './board';
import { applyLayout, layoutNames } from './layouts';
import { levels } from './levels';
import { findGeometricPath, findPath } from './rules';
import type { Board, Layout, Point, Tile } from './types';

type KindGrid = (number | null)[][];

function fromKinds(grid: KindGrid): Board {
  let id = 0;
  return grid.map((row) => row.map((kind) => (kind === null ? null : { id: ++id, kind })));
}

function kindsOf(board: Board): KindGrid {
  return board.map((row) => row.map((tile) => tile?.kind ?? null));
}

function tilesOf(board: Board): Tile[] {
  return board.flat().filter((tile): tile is Tile => tile !== null);
}

function occupiedMask(board: Board): boolean[][] {
  return board.map((row) => row.map((tile) => tile !== null));
}

function freezeBoard(board: Board): Board {
  tilesOf(board).forEach((tile) => Object.freeze(tile));
  board.forEach((row) => Object.freeze(row));
  Object.freeze(board);
  return board;
}

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Measure spatial outcomes rather than duplicating the production ranking formula.
function spatialStats(board: Board): { adjacentEdges: number; largeComponents: number; simplePairs: number } {
  let adjacentEdges = 0;
  let largeComponents = 0;
  let simplePairs = 0;
  const visited = new Set<string>();
  board.forEach((row, r) => row.forEach((tile, c) => {
    if (tile === null) return;
    if (board[r]?.[c + 1]?.kind === tile.kind) adjacentEdges += 1;
    if (board[r + 1]?.[c]?.kind === tile.kind) adjacentEdges += 1;
    const key = `${r},${c}`;
    if (visited.has(key)) return;
    visited.add(key);
    const component: Point[] = [{ row: r, col: c }];
    for (let index = 0; index < component.length; index += 1) {
      const point = component[index]!;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const next = { row: point.row + dr!, col: point.col + dc! };
        const nextKey = `${next.row},${next.col}`;
        if (board[next.row]?.[next.col]?.kind !== tile.kind || visited.has(nextKey)) continue;
        visited.add(nextKey);
        component.push(next);
      }
    }
    if (component.length >= 3) largeComponents += 1;
    if (component.length === 2) simplePairs += 1;
  }));
  return { adjacentEdges, largeComponents, simplePairs };
}

// Reference the old single Fisher–Yates deal, with no distribution optimization.
function singleShuffle(board: Board, rng: () => number): Board {
  const tiles = tilesOf(board);
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [tiles[index], tiles[other]] = [tiles[other]!, tiles[index]!];
  }
  let index = 0;
  return board.map((row) => row.map((tile) => tile === null ? null : tiles[index++]!));
}

function unshuffledDeal(rows: number, cols: number, kinds: number): Board {
  return fromKinds(Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => Math.floor((row * cols + col) / 2) % kinds),
  ));
}

const distributionSeeds = [1, 23, 42, 73, 391, 2026, 12345, 0xdecafbad];

function expectConserved(before: Board, after: Board): void {
  expect(after.map((row) => row.length)).toEqual(before.map((row) => row.length));
  const original = new Map(tilesOf(before).map((tile) => [tile.id, tile]));
  expect(tilesOf(after).map((tile) => tile.id).sort((a, b) => a - b)).toEqual(
    [...original.keys()].sort((a, b) => a - b),
  );
  for (const tile of tilesOf(after)) expect(tile).toBe(original.get(tile.id));
}

function expectValidPath(board: Board, from: Point, to: Point, path: Point[] | null): void {
  expect(path).not.toBeNull();
  if (path === null) throw new Error('Expected a path');
  expect(path[0]).toEqual(from);
  expect(path[path.length - 1]).toEqual(to);
  expect(path.length).toBeGreaterThanOrEqual(2);
  expect(path.length).toBeLessThanOrEqual(4);
  const rows = board.length;
  const cols = board[0]!.length;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    expect(a).not.toEqual(b);
    expect(a.row === b.row || a.col === b.col).toBe(true);
    if (index > 1) {
      const previous = path[index - 2]!;
      expect(previous.row === a.row).not.toBe(a.row === b.row);
    }
    const distance = Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
    for (let step = 1; step <= distance; step += 1) {
      const row = a.row + Math.sign(b.row - a.row) * step;
      const col = a.col + Math.sign(b.col - a.col) * step;
      expect(row).toBeGreaterThanOrEqual(-1);
      expect(row).toBeLessThanOrEqual(rows);
      expect(col).toBeGreaterThanOrEqual(-1);
      expect(col).toBeLessThanOrEqual(cols);
      if (row === to.row && col === to.col) continue;
      if (row >= 0 && row < rows && col >= 0 && col < cols) {
        expect(board[row]![col]).toBeNull();
      }
    }
  }
}

// This independent oracle enumerates segments instead of search states.
function geometricOracle(board: Board, from: Point, to: Point): boolean {
  const rows = board.length;
  const cols = board[0]!.length;
  const open = (row: number, col: number): boolean => {
    if ((row === from.row && col === from.col) || (row === to.row && col === to.col)) return true;
    if (row === -1 || row === rows || col === -1 || col === cols) return true;
    return board[row]![col] === null;
  };
  const clear = (a: Point, b: Point): boolean => {
    if (a.row !== b.row && a.col !== b.col) return false;
    const distance = Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
    for (let step = 0; step <= distance; step += 1) {
      if (!open(a.row + Math.sign(b.row - a.row) * step, a.col + Math.sign(b.col - a.col) * step)) {
        return false;
      }
    }
    return true;
  };
  for (let row = -1; row <= rows; row += 1) {
    const a = { row, col: from.col };
    const b = { row, col: to.col };
    if (clear(from, a) && clear(a, b) && clear(b, to)) return true;
  }
  for (let col = -1; col <= cols; col += 1) {
    const a = { row: from.row, col };
    const b = { row: to.row, col };
    if (clear(from, a) && clear(a, b) && clear(b, to)) return true;
  }
  return false;
}

const deadlock: KindGrid = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [2, 3, 0, 1],
  [6, 7, 4, 5],
];

function paddedDeadlock(): Board {
  return fromKinds([
    Array<null>(6).fill(null),
    ...deadlock.map((row) => [null, ...row, null]),
    Array<null>(6).fill(null),
  ]);
}

describe('连线路径', () => {
  it.each([
    { name: '横向直线', grid: [[0, null, null, 0]], from: { row: 0, col: 0 }, to: { row: 0, col: 3 } },
    { name: '纵向直线', grid: [[0], [null], [0]], from: { row: 0, col: 0 }, to: { row: 2, col: 0 } },
    { name: '相邻两格', grid: [[0, 0]], from: { row: 0, col: 0 }, to: { row: 0, col: 1 } },
  ])('$name只返回两个端点', ({ grid, from, to }) => {
    const board = freezeBoard(fromKinds(grid));
    expect(findPath(board, from, to)).toEqual([from, to]);
  });

  it('返回压缩的一拐路径', () => {
    const board = freezeBoard(fromKinds([[0, null], [9, 0]]));
    const from = { row: 0, col: 0 };
    const to = { row: 1, col: 1 };
    const path = findPath(board, from, to);
    expect(path).toEqual([from, { row: 0, col: 1 }, to]);
    expectValidPath(board, from, to, path);
  });

  it('可沿内部通道走两拐且不穿牌', () => {
    const board = fromKinds([
      [9, 9, 9, 9, 9],
      [9, 0, null, 9, 9],
      [9, 9, null, 9, 9],
      [9, 9, null, 0, 9],
      [9, 9, 9, 9, 9],
    ]);
    const from = { row: 1, col: 1 };
    const to = { row: 3, col: 3 };
    const path = findPath(board, from, to);
    expect(path).toEqual([from, { row: 1, col: 2 }, { row: 3, col: 2 }, to]);
    expectValidPath(board, from, to, path);
  });

  it.each([
    { name: '上', grid: [[0, 9, 0], [9, 9, 9]], from: { row: 0, col: 0 }, to: { row: 0, col: 2 }, corners: [{ row: -1, col: 0 }, { row: -1, col: 2 }] },
    { name: '下', grid: [[9, 9, 9], [0, 9, 0]], from: { row: 1, col: 0 }, to: { row: 1, col: 2 }, corners: [{ row: 2, col: 0 }, { row: 2, col: 2 }] },
    { name: '左', grid: [[0, 9], [9, 9], [0, 9]], from: { row: 0, col: 0 }, to: { row: 2, col: 0 }, corners: [{ row: 0, col: -1 }, { row: 2, col: -1 }] },
    { name: '右', grid: [[9, 0], [9, 9], [9, 0]], from: { row: 0, col: 1 }, to: { row: 2, col: 1 }, corners: [{ row: 0, col: 2 }, { row: 2, col: 2 }] },
  ])('可借助$name外边界两拐连接', ({ grid, from, to, corners }) => {
    const board = freezeBoard(fromKinds(grid));
    const path = findPath(board, from, to);
    expect(path).toEqual([from, ...corners, to]);
    expectValidPath(board, from, to, path);
    expectValidPath(board, to, from, findPath(board, to, from));
  });

  it('唯一通道需要三拐时拒绝连接', () => {
    const board = fromKinds([
      [9, 9, 9, 9, 9],
      [9, 0, null, 9, 9],
      [9, 9, null, null, 9],
      [9, 9, 9, 0, 9],
      [9, 9, 9, 9, 9],
    ]);
    expect(findPath(board, { row: 1, col: 1 }, { row: 3, col: 3 })).toBeNull();
    expect(findGeometricPath(board, { row: 1, col: 1 }, { row: 3, col: 3 })).toBeNull();
  });

  it('拒绝穿过封闭的牌墙', () => {
    const board = fromKinds([[9, 9, 9, 9, 9], [9, 0, 9, 0, 9], [9, 9, 9, 9, 9]]);
    expect(findPath(board, { row: 1, col: 1 }, { row: 1, col: 3 })).toBeNull();
  });

  it.each([
    { name: '同格', from: { row: 0, col: 0 }, to: { row: 0, col: 0 } },
    { name: '目标为空', from: { row: 0, col: 0 }, to: { row: 0, col: 1 } },
    { name: '起点为空', from: { row: 0, col: 1 }, to: { row: 0, col: 0 } },
    { name: '负数坐标', from: { row: -1, col: 0 }, to: { row: 0, col: 0 } },
    { name: '行越界', from: { row: 0, col: 0 }, to: { row: 1, col: 0 } },
    { name: '列越界', from: { row: 0, col: 0 }, to: { row: 0, col: 4 } },
    { name: '小数坐标', from: { row: 0, col: 0.5 }, to: { row: 0, col: 0 } },
  ])('拒绝$name端点', ({ from, to }) => {
    const board = fromKinds([[0, null, 0, 1]]);
    expect(findPath(board, from, to)).toBeNull();
    expect(findGeometricPath(board, from, to)).toBeNull();
  });

  it('不同类只允许几何连线，正常消除连线拒绝', () => {
    const board = freezeBoard(fromKinds([[0, null, 1]]));
    const from = { row: 0, col: 0 };
    const to = { row: 0, col: 2 };
    expect(findPath(board, from, to)).toBeNull();
    expect(findGeometricPath(board, from, to)).toEqual([from, to]);
  });

  it('空棋盘没有路径', () => {
    expect(findPath([], { row: 0, col: 0 }, { row: 0, col: 1 })).toBeNull();
    expect(findGeometricPath([[]], { row: 0, col: 0 }, { row: 0, col: 1 })).toBeNull();
  });

  it('穷举 4608 个三乘三棋盘，与独立几何枚举一致，防止合并方向或拐弯状态', () => {
    for (let first = 0; first < 9; first += 1) {
      for (let second = first + 1; second < 9; second += 1) {
        const others = Array.from({ length: 9 }, (_, index) => index).filter(
          (index) => index !== first && index !== second,
        );
        for (let mask = 0; mask < 128; mask += 1) {
          const grid: KindGrid = Array.from({ length: 3 }, () => Array<null>(3).fill(null));
          for (const index of [first, second]) grid[Math.floor(index / 3)]![index % 3] = 0;
          others.forEach((index, bit) => {
            if ((mask & (1 << bit)) !== 0) grid[Math.floor(index / 3)]![index % 3] = 1;
          });
          const board = fromKinds(grid);
          const from = { row: Math.floor(first / 3), col: first % 3 };
          const to = { row: Math.floor(second / 3), col: second % 3 };
          const expected = geometricOracle(board, from, to);
          expect(findPath(board, from, to) !== null).toBe(expected);
          expect(findPath(board, to, from) !== null).toBe(expected);
        }
      }
    }
  }, 15000);

  it('较大稀疏棋盘的路径满足两拐、边界和阻挡约束', () => {
    const rng = seededRng(2026);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const grid: KindGrid = Array.from({ length: 5 }, () =>
        Array.from({ length: 6 }, () => (rng() < 0.4 ? 1 : null)),
      );
      const from = { row: Math.floor(rng() * 5), col: Math.floor(rng() * 6) };
      const to = { row: (from.row + 1 + Math.floor(rng() * 4)) % 5, col: Math.floor(rng() * 6) };
      grid[from.row]![from.col] = 0;
      grid[to.row]![to.col] = 0;
      const board = freezeBoard(fromKinds(grid));
      const path = findPath(board, from, to);
      expect(path !== null).toBe(geometricOracle(board, from, to));
      if (path !== null) expectValidPath(board, from, to, path);
    }
  });
});

describe('动物与果蔬图案', () => {
  it('保留原有十二种动物的 ID，并依次追加十六种果蔬', () => {
    expect(animals.map(({ name }) => name)).toEqual([
      '小猫', '小狗', '兔子', '小鱼', '乌龟', '小鸭',
      '大象', '熊猫', '蝴蝶', '螃蟹', '蜗牛', '章鱼',
      '苹果', '香蕉', '葡萄', '西瓜', '草莓', '菠萝', '梨子', '樱桃',
      '橙子', '胡萝卜', '玉米', '茄子', '西兰花', '蘑菇', '南瓜', '甜椒',
    ]);
  });

  it('全部 28 种图案都有唯一中文名称、配色和可渲染的独立 SVG', () => {
    expect(animals).toHaveLength(28);
    expect(new Set(animals.map(({ name }) => name)).size).toBe(28);
    const drawings = animals.map(({ name, color, background }, kind) => {
      expect(name).toMatch(/^[\u4e00-\u9fff]+$/);
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(background).toMatch(/^#[0-9a-f]{6}$/i);
      const markup = renderToStaticMarkup(createElement(AnimalIcon, { kind }));
      expect(markup).toContain('<svg');
      expect(markup).toContain('viewBox="0 0 64 64"');
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toMatch(/<(path|circle|ellipse)\b/);
      expect(markup).not.toMatch(/<(image|use)\b/);
      // Ignore palette differences so sharing one drawing cannot pass as distinct icons.
      return markup.replace(/#[0-9a-f]{6}/gi, '#000000');
    });
    expect(new Set(drawings).size).toBe(28);
  });
});

describe('独立空间统计', () => {
  it.each<{ name: string; grid: KindGrid; edges: number; large: number; pairs: number }>([
    { name: '直线三连', grid: [[0, 0, 0]], edges: 2, large: 1, pairs: 0 },
    { name: 'L 型三连', grid: [[0, 0], [0, null]], edges: 2, large: 1, pairs: 0 },
    { name: '四格方块', grid: [[0, 0], [0, 0]], edges: 4, large: 1, pairs: 0 },
    { name: '两个不同类双牌', grid: [[0, 0, 1, 1]], edges: 2, large: 0, pairs: 2 },
    { name: '空位隔开的同类双牌', grid: [[0, 0, null, 0, 0]], edges: 2, large: 0, pairs: 2 },
    { name: '对角不相邻', grid: [[0, null], [null, 0]], edges: 0, large: 0, pairs: 0 },
  ])('$name 按四向连通分量和无向边统计', ({ grid, edges, large, pairs }) => {
    expect(spatialStats(fromKinds(grid))).toEqual({ adjacentEdges: edges, largeComponents: large, simplePairs: pairs });
  });
});

describe('关卡与初始棋盘', () => {
  it('严格符合十二关尺寸、种类、时限与变形顺序合同', () => {
    expect(levels.map((level) => level.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(levels.map(({ rows, cols }) => [rows, cols])).toEqual([
      [10, 14], [10, 14], [10, 14], [10, 14], [10, 14], [10, 14],
      [10, 14], [10, 14], [10, 14], [10, 14], [10, 14], [10, 14],
    ]);
    expect(levels.map((level) => level.kinds)).toEqual([18, 19, 20, 21, 22, 23, 24, 24, 25, 26, 27, 28]);
    expect(levels.map((level) => level.seconds)).toEqual([360, 345, 330, 320, 310, 300, 290, 280, 270, 260, 250, 240]);
    expect(levels.map((level) => level.layouts)).toEqual([
      ['still'], ['still'], ['down'], ['up'], ['splitVertical'], ['splitHorizontal'],
      ['centerHorizontal'], ['centerVertical'], ['splitVertical', 'splitHorizontal'],
      ['up', 'right', 'down', 'left'],
      ['centerHorizontal', 'splitHorizontal', 'centerVertical', 'splitVertical'],
      ['down', 'splitVertical', 'splitHorizontal', 'centerHorizontal', 'up', 'centerVertical'],
    ]);
    for (const level of levels) {
      expect(level.name).toMatch(/[\u4e00-\u9fff]/);
      expect(level.description).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it.each(levels)('第 $id 关初始 140 格 70 对、唯一 id、均衡配对种类及可玩性', (level) => {
    for (const rng of [seededRng(1), seededRng(23), seededRng(2026), () => 0, () => 0.999999]) {
      const board = createBoard(level.rows, level.cols, level.kinds, rng);
      const tiles = tilesOf(board);
      expect(board).toHaveLength(level.rows);
      expect(board.every((row) => row.length === level.cols)).toBe(true);
      expect(board.flat()).toHaveLength(140);
      expect(tiles).toHaveLength(level.rows * level.cols);
      expect(tiles).toHaveLength(140);
      expect(new Set(tiles.map((tile) => tile.id)).size).toBe(tiles.length);
      expect([...new Set(tiles.map((tile) => tile.kind))].sort((a, b) => a - b)).toEqual(
        Array.from({ length: level.kinds }, (_, kind) => kind),
      );
      for (let kind = 0; kind < level.kinds; kind += 1) {
        const count = tiles.filter((tile) => tile.kind === kind).length;
        expect(count).toBeGreaterThanOrEqual(2);
        expect(count % 2).toBe(0);
        // The opening 18 kinds have at most 8 tiles; levels 7–12 have at most 6.
        expect(count).toBeLessThanOrEqual(level.id >= 7 ? 6 : 8);
      }
      expect(remainingPairs(board)).toBe(level.rows * level.cols / 2);
      expect(remainingPairs(board)).toBe(70);
      const move = findMove(freezeBoard(board));
      expect(move).not.toBeNull();
      expectValidPath(board, move!.from, move!.to, move!.path);
    }
  });

  it('八个固定种子覆盖十二关，相较单次洗牌显著减少相邻边和三枚以上连通块', () => {
    const totals = {
      baseline: { adjacentEdges: 0, largeComponents: 0, simplePairs: 0 },
      optimized: { adjacentEdges: 0, largeComponents: 0, simplePairs: 0 },
    };
    for (const seed of distributionSeeds) {
      for (const level of levels) {
        const baseline = singleShuffle(unshuffledDeal(level.rows, level.cols, level.kinds), seededRng(seed));
        const rng = vi.fn(seededRng(seed));
        const optimized = createBoard(level.rows, level.cols, level.kinds, rng);
        const before = spatialStats(baseline);
        const after = spatialStats(optimized);
        for (const key of ['adjacentEdges', 'largeComponents', 'simplePairs'] as const) {
          totals.baseline[key] += before[key];
          totals.optimized[key] += after[key];
        }
        expect(rng.mock.calls.length).toBeGreaterThanOrEqual(139);
        expect(rng.mock.calls.length).toBeLessThanOrEqual(20 * 139);
        expect(rng.mock.calls.length % 139).toBe(0);
        expect(tilesOf(optimized).sort((a, b) => a.id - b.id)).toEqual(
          tilesOf(baseline).sort((a, b) => a.id - b.id),
        );
        expect(new Set(tilesOf(optimized).map((tile) => tile.id)).size).toBe(140);
        const move = findMove(optimized);
        expect(move).not.toBeNull();
        expectValidPath(optimized, move!.from, move!.to, move!.path);
      }
    }
    console.info('开局空间统计（8 种子 × 12 关）', totals);
    // Aggregate margins, not a promise of an optimal or cluster-free individual deal.
    expect(totals.baseline.largeComponents).toBeGreaterThan(0);
    expect(totals.optimized.adjacentEdges).toBeLessThan(totals.baseline.adjacentEdges * 0.7);
    expect(totals.optimized.largeComponents).toBeLessThan(totals.baseline.largeComponents * 0.4);
    expect(totals.optimized.adjacentEdges).toBeGreaterThan(0);
    expect(totals.optimized.simplePairs).toBeGreaterThan(0);
  });

  it.each([
    { kinds: 1, value: 0 }, { kinds: 1, value: 0.999999 },
    { kinds: 2, value: 0 }, { kinds: 2, value: 0.999999 },
  ])('$kinds 种图案配合常量 RNG $value 时只尽力改善，并在二十次内结束', ({ kinds, value }) => {
    const rng = vi.fn(() => value);
    const board = createBoard(4, 4, kinds, rng);
    expect(rng).toHaveBeenCalledTimes(20 * 15);
    expect(tilesOf(board).sort((a, b) => a.id - b.id)).toEqual(tilesOf(unshuffledDeal(4, 4, kinds)));
    expect(new Set(tilesOf(board).map((tile) => tile.id)).size).toBe(16);
    expect(spatialStats(board).largeComponents).toBeGreaterThan(0);
    const move = findMove(board);
    expect(move).not.toBeNull();
    expectValidPath(board, move!.from, move!.to, move!.path);
  });

  it('支持默认 RNG、相同种子可复现和最小棋盘', () => {
    expect(findMove(createBoard(4, 6, 4))).not.toBeNull();
    expect(createBoard(6, 10, 12, seededRng(18))).toEqual(createBoard(6, 10, 12, seededRng(18)));
    expect(kindsOf(createBoard(1, 2, 1, () => 0))).toEqual([[0, 0]]);
    expect(kindsOf(createBoard(2, 1, 1, () => 0))).toEqual([[0], [0]]);
  });

  it.each([
    [0, 4, 1], [-2, 4, 1], [1.5, 4, 1], [2, 0, 1], [2, 1.5, 1],
    [3, 3, 1], [2, 2, 0], [2, 2, 3], [2, 2, 1.5], [Infinity, 2, 1],
  ])('不可能满足配对合同的参数 (%s, %s, %s) 抛出 RangeError', (rows, cols, kinds) => {
    expect(() => createBoard(rows, cols, kinds, () => 0)).toThrow(RangeError);
  });
});

describe('提示与有限次洗牌', () => {
  it('findMove 返回同类端点和真实压缩路径，且跳过不通的对子', () => {
    const board = freezeBoard(fromKinds([[0, 1, null], [1, 0, null], [2, null, 2]]));
    const move = findMove(board);
    expect(move).not.toBeNull();
    expect(board[move!.from.row]![move!.from.col]!.kind).toBe(2);
    expect(board[move!.to.row]![move!.to.col]!.kind).toBe(2);
    expectValidPath(board, move!.from, move!.to, move!.path);
  });

  it('有解时返回原棋盘且不调用 RNG', () => {
    const board = freezeBoard(fromKinds([[0, null, 0], [1, 1, null]]));
    const rng = vi.fn(() => 0);
    const result = ensurePlayable(board, rng);
    expect(result.board).toBe(board);
    expect(result.shuffled).toBe(false);
    expect(rng).not.toHaveBeenCalled();
  });

  it.each<{ name: string; grid: KindGrid }>([
    { name: '直线三连', grid: [[0, 0, 0, null, 0]] },
    { name: 'L 型三连', grid: [[0, 0, null], [0, null, 0]] },
    { name: '四格方块', grid: [[0, 0], [0, 0]] },
  ])('已有合法配对的$name 不为改善分布而重排', ({ grid }) => {
    const board = freezeBoard(fromKinds(grid));
    expect(spatialStats(board).largeComponents).toBe(1);
    expect(findMove(board)).not.toBeNull();
    const rng = vi.fn(seededRng(2026));
    const result = ensurePlayable(board, rng);
    expect(result.board).toBe(board);
    expect(result.shuffled).toBe(false);
    expect(rng).not.toHaveBeenCalled();
  });

  it('固定种子死局重排优于第一次可玩洗牌，同时保留空位、Tile 对象和 ID', () => {
    // Each border has four distinct kinds and there are no adjacent matches.
    const board = freezeBoard(fromKinds([
      Array<null>(6).fill(null),
      [null, 0, 1, 2, 3, null],
      [null, 1, 2, 3, 0, null],
      [null, 2, 3, 0, 1, null],
      [null, 3, 0, 1, 2, null],
      Array<null>(6).fill(null),
    ]));
    expect(findMove(board)).toBeNull();
    const totals = {
      baseline: { adjacentEdges: 0, largeComponents: 0, simplePairs: 0 },
      optimized: { adjacentEdges: 0, largeComponents: 0, simplePairs: 0 },
    };
    for (const seed of distributionSeeds) {
      const baselineRng = seededRng(seed);
      let firstPlayable: Board | undefined;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = singleShuffle(board, baselineRng);
        if (findMove(candidate) !== null) {
          firstPlayable = candidate;
          break;
        }
      }
      expect(firstPlayable).toBeDefined();
      const rng = vi.fn(seededRng(seed));
      const result = ensurePlayable(board, rng);
      expect(result.shuffled).toBe(true);
      expect(result.board).not.toBe(board);
      expect(rng.mock.calls.length).toBeGreaterThanOrEqual(15);
      expect(rng.mock.calls.length).toBeLessThanOrEqual(20 * 15);
      expect(rng.mock.calls.length % 15).toBe(0);
      expect(occupiedMask(result.board)).toEqual(occupiedMask(board));
      expectConserved(board, result.board);
      expect(remainingPairs(result.board)).toBe(8);
      const move = findMove(result.board);
      expect(move).not.toBeNull();
      expectValidPath(result.board, move!.from, move!.to, move!.path);
      const before = spatialStats(firstPlayable!);
      const after = spatialStats(result.board);
      for (const key of ['adjacentEdges', 'largeComponents', 'simplePairs'] as const) {
        totals.baseline[key] += before[key];
        totals.optimized[key] += after[key];
      }
    }
    console.info('死局空间统计（8 种子）', totals);
    expect(totals.baseline.largeComponents).toBeGreaterThan(0);
    expect(totals.optimized.adjacentEdges).toBeLessThan(totals.baseline.adjacentEdges * 0.7);
    expect(totals.optimized.largeComponents).toBeLessThan(totals.baseline.largeComponents * 0.4);
    expect(totals.optimized.simplePairs).toBeGreaterThan(0);
  });

  it('非空死局首个可玩候选仅有两组相邻双牌时立即停止，保留空格和每枚 Tile', () => {
    const board = freezeBoard(fromKinds([
      [null, null, null, null],
      [null, 0, 1, null],
      [null, 1, 0, null],
      [null, null, null, null],
    ]));
    expect(findMove(board)).toBeNull();
    const rng = vi.fn(() => 0);
    const result = ensurePlayable(board, rng);
    expect(result.shuffled).toBe(true);
    expect(result.board).not.toBe(board);
    expect(rng).toHaveBeenCalledTimes(3);
    expect(findMove(result.board)).not.toBeNull();
    expect(occupiedMask(result.board)).toEqual(occupiedMask(board));
    expectConserved(board, result.board);
  });

  it.each(['full', 'padded'] as const)('%s 死局在常数 0 RNG 的二十次失败后确定性兜底', (shape) => {
    const board = freezeBoard(shape === 'full' ? fromKinds(deadlock) : paddedDeadlock());
    expect(remainingPairs(board)).toBe(8);
    expect(findMove(board)).toBeNull();
    // Constant-zero shuffles remain deadlocked, forcing the deterministic fallback.
    const rotated = tilesOf(board);
    rotated.push(rotated.shift()!);
    let index = 0;
    const failedCandidate = board.map((row) => row.map((tile) => tile === null ? null : rotated[index++]!));
    expect(findMove(failedCandidate)).toBeNull();

    const rng = vi.fn(() => 0);
    const result = ensurePlayable(board, rng);
    expect(rng).toHaveBeenCalledTimes(20 * (16 - 1));
    expect(result.shuffled).toBe(true);
    expect(result.board).not.toBe(board);
    expect(occupiedMask(result.board)).toEqual(occupiedMask(board));
    expectConserved(board, result.board);
    expect(remainingPairs(result.board)).toBe(8);
    const move = findMove(result.board);
    expect(move).not.toBeNull();
    expectValidPath(result.board, move!.from, move!.to, move!.path);
    expect(ensurePlayable(board, () => 0).board).toEqual(result.board);
  });

  it('不改变顺序的 RNG 也能结束并保留完整图块', () => {
    const board = freezeBoard(paddedDeadlock());
    const rng = vi.fn(() => 0.999999);
    const result = ensurePlayable(board, rng);
    expect(rng).toHaveBeenCalledTimes(300);
    expect(result.shuffled).toBe(true);
    expect(findMove(result.board)).not.toBeNull();
    expectConserved(board, result.board);
  });

  it.each<{ board: Board }>([
    { board: [] },
    { board: [[]] },
    { board: [[null, null]] },
    { board: fromKinds([[0]]) },
    { board: fromKinds([[0, 1]]) },
  ])('没有同类对子时原样返回而不空转 %#', ({ board }) => {
    freezeBoard(board);
    const rng = vi.fn(() => 0);
    expect(findMove(board)).toBeNull();
    const result = ensurePlayable(board, rng);
    expect(result).toEqual({ board, shuffled: false });
    expect(result.board).toBe(board);
    expect(rng).not.toHaveBeenCalled();
  });

  it('remainingPairs 统计真实剩余牌而不是棋盘格数', () => {
    expect(remainingPairs([])).toBe(0);
    expect(remainingPairs(fromKinds([[null, null]]))).toBe(0);
    expect(remainingPairs(fromKinds([[0, null, 1], [null, 0, 1]]))).toBe(2);
  });
});

const layoutGrid: KindGrid = [
  [1, null, 2, 3, null, 4],
  [null, 5, 6, null, 7, 8],
  [9, 10, null, 11, 12, null],
  [13, null, 14, null, 15, 16],
];

const layoutExpectations: Record<Layout, KindGrid> = {
  still: layoutGrid,
  down: [
    [null, null, null, null, null, null],
    [1, null, 2, null, 7, 4],
    [9, 5, 6, 3, 12, 8],
    [13, 10, 14, 11, 15, 16],
  ],
  up: [
    [1, 5, 2, 3, 7, 4],
    [9, 10, 6, 11, 12, 8],
    [13, null, 14, null, 15, 16],
    [null, null, null, null, null, null],
  ],
  left: [
    [1, 2, 3, 4, null, null], [5, 6, 7, 8, null, null],
    [9, 10, 11, 12, null, null], [13, 14, 15, 16, null, null],
  ],
  right: [
    [null, null, 1, 2, 3, 4], [null, null, 5, 6, 7, 8],
    [null, null, 9, 10, 11, 12], [null, null, 13, 14, 15, 16],
  ],
  splitVertical: [
    [1, 5, 2, 3, 7, 4],
    [null, null, 6, null, null, 8],
    [9, null, null, null, 12, null],
    [13, 10, 14, 11, 15, 16],
  ],
  splitHorizontal: [
    [1, 2, null, null, 3, 4], [5, 6, null, null, 7, 8],
    [9, 10, null, null, 11, 12], [13, 14, null, null, 15, 16],
  ],
  centerHorizontal: [
    [null, 1, 2, 3, 4, null], [null, 5, 6, 7, 8, null],
    [null, 9, 10, 11, 12, null], [null, 13, 14, 15, 16, null],
  ],
  centerVertical: [
    [null, null, 2, null, null, 4],
    [1, 5, 6, 3, 7, 8],
    [9, 10, 14, 11, 12, 16],
    [13, null, null, null, 15, null],
  ],
};
const allLayouts = Object.keys(layoutExpectations) as Layout[];

describe('稳定棋盘变形', () => {
  it.each(allLayouts)('%s 的准确矩阵、Tile 守恒、输入不变性及幂等性', (layout) => {
    const board = freezeBoard(fromKinds(layoutGrid));
    const result = applyLayout(board, layout);
    expect(kindsOf(result)).toEqual(layoutExpectations[layout]);
    expectConserved(board, result);
    expect(kindsOf(board)).toEqual(layoutGrid);
    expect(result).not.toBe(board);
    result.forEach((row, index) => expect(row).not.toBe(board[index]));
    expect(applyLayout(result, layout)).toEqual(result);
  });

  it.each(allLayouts)('%s 在多种稀疏矩阵中守恒且不跨行列或固定中线', (layout) => {
    const rng = seededRng(392);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const rows = 1 + Math.floor(rng() * 7);
      const cols = 1 + Math.floor(rng() * 7);
      const board = freezeBoard(fromKinds(Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => rng() < 0.5 ? null : Math.floor(rng() * 5)),
      )));
      const result = applyLayout(board, layout);
      expectConserved(board, result);
      const horizontal = ['still', 'left', 'right', 'splitHorizontal', 'centerHorizontal'].includes(layout);
      const lines = (value: Board): Board => horizontal
        ? value
        : Array.from({ length: cols }, (_, col) => value.map((row) => row[col]!));
      const divided = layout.startsWith('split') || layout.startsWith('center');
      const before = lines(board);
      const after = lines(result);
      before.forEach((line, index) => {
        const ranges = divided ? [[0, Math.floor(line.length / 2)], [Math.floor(line.length / 2), line.length]] : [[0, line.length]];
        for (const [start, end] of ranges) {
          expect(after[index]!.slice(start, end).filter((tile) => tile !== null)).toEqual(
            line.slice(start, end).filter((tile) => tile !== null),
          );
        }
      });
      expect(applyLayout(result, layout)).toEqual(result);
    }
  });

  it.each([
    { layout: 'splitHorizontal' as const, expected: [1, null, null, null, null, 2, 3] },
    { layout: 'centerHorizontal' as const, expected: [null, null, 1, 2, 3, null, null] },
  ])('$layout 对奇数长度仍使用固定中线，较大半部在后', ({ layout, expected }) => {
    const grid: KindGrid = [[null, 1, null, 2, null, 3, null]];
    expect(kindsOf(applyLayout(fromKinds(grid), layout))).toEqual([expected]);
    const vertical = layout === 'splitHorizontal' ? 'splitVertical' : 'centerVertical';
    const column = fromKinds(grid[0]!.map((kind) => [kind]));
    expect(kindsOf(applyLayout(column, vertical))).toEqual(expected.map((kind) => [kind]));
  });

  it('中线一侧完全为空时不从另一半借牌填补', () => {
    const board = fromKinds([[null, null, null, 1, null, 2]]);
    expect(kindsOf(applyLayout(board, 'centerHorizontal'))).toEqual([[null, null, null, 1, 2, null]]);
    expect(kindsOf(applyLayout(board, 'splitHorizontal'))).toEqual([[null, null, null, null, 1, 2]]);
  });

  it.each(allLayouts)('%s 支持空棋盘、全空格和单行单列', (layout) => {
    for (const board of [[], [[], []], [[null, null], [null, null]]] as Board[]) {
      expect(applyLayout(freezeBoard(board), layout)).toEqual(board);
    }
    for (const board of [fromKinds([[1, null, 2, null]]), fromKinds([[1], [null], [2], [null]])]) {
      expectConserved(freezeBoard(board), applyLayout(board, layout));
    }
  });

  it('每种变形都有中文名称', () => {
    expect(Object.keys(layoutNames).sort()).toEqual([...allLayouts].sort());
    for (const name of Object.values(layoutNames)) expect(name).toMatch(/[\u4e00-\u9fff]/);
  });
});

describe('完整关卡流程', () => {
  it.each(levels)('第 $id 关可反复消除、按序变形和重排直至清空', (level) => {
    let board = createBoard(level.rows, level.cols, level.kinds, seededRng(level.id));
    const initialPairs = remainingPairs(board);
    expect(initialPairs).toBe(70);
    for (let step = 0; step < initialPairs; step += 1) {
      const move = findMove(freezeBoard(board));
      expect(move).not.toBeNull();
      expect(board[move!.from.row]![move!.from.col]!.kind).toBe(board[move!.to.row]![move!.to.col]!.kind);
      const cleared = board.map((row) => row.slice());
      cleared[move!.from.row]![move!.from.col] = null;
      cleared[move!.to.row]![move!.to.col] = null;
      const layout = level.layouts[step % level.layouts.length]!;
      const shifted = applyLayout(freezeBoard(cleared), layout);
      expectConserved(cleared, shifted);
      board = ensurePlayable(freezeBoard(shifted), () => 0).board;
      expectConserved(shifted, board);
      expect(occupiedMask(board)).toEqual(occupiedMask(shifted));
      expect(remainingPairs(board)).toBe(initialPairs - step - 1);
    }
    expect(tilesOf(board)).toHaveLength(0);
    expect(findMove(board)).toBeNull();
    expect(ensurePlayable(board, () => 0)).toEqual({ board, shuffled: false });
  });
});
