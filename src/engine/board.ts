import { findGeometricPath, findPath } from './rules';
import type { Board, Move, Point, Tile } from './types';

function shuffle(tiles: Tile[], rng: () => number): Tile[] {
  const result = tiles.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function placeTiles(board: Board, positions: Point[], tiles: Tile[]): Board {
  const result = board.map((row) => row.slice());
  positions.forEach(({ row, col }, index) => {
    result[row]![col] = tiles[index]!;
  });
  return result;
}

export function createBoard(
  rows: number,
  cols: number,
  kinds: number,
  rng: () => number = Math.random,
): Board {
  const size = rows * cols;
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(cols) ||
    rows <= 0 ||
    cols <= 0 ||
    !Number.isSafeInteger(size) ||
    size % 2 !== 0 ||
    !Number.isInteger(kinds) ||
    kinds <= 0 ||
    kinds > size / 2
  ) {
    throw new RangeError('棋盘须为正整数行列、偶数格，图案种类须在 1 到总格数的一半之间。');
  }

  const tiles: Tile[] = [];
  for (let pair = 0; pair < size / 2; pair += 1) {
    const kind = pair % kinds;
    tiles.push({ id: pair * 2 + 1, kind }, { id: pair * 2 + 2, kind });
  }
  const randomized = shuffle(tiles, rng);
  const board: Board = Array.from({ length: rows }, (_, row) =>
    randomized.slice(row * cols, (row + 1) * cols),
  );
  return ensurePlayable(board, rng).board;
}

export function findMove(board: Board): Move | null {
  const byKind = new Map<number, Point[]>();
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row]!.length; col += 1) {
      const tile = board[row]![col];
      if (tile == null) continue;
      const to = { row, col };
      const previous = byKind.get(tile.kind) ?? [];
      for (const from of previous) {
        const path = findPath(board, from, to);
        if (path !== null) return { from, to, path };
      }
      previous.push(to);
      byKind.set(tile.kind, previous);
    }
  }
  return null;
}

export function ensurePlayable(
  board: Board,
  rng: () => number = Math.random,
): { board: Board; shuffled: boolean } {
  if (findMove(board) !== null) return { board, shuffled: false };

  const positions: Point[] = [];
  const tiles: Tile[] = [];
  const seenKinds = new Set<number>();
  let pairedKind: number | undefined;
  board.forEach((row, rowIndex) => {
    row.forEach((tile, col) => {
      if (tile === null) return;
      positions.push({ row: rowIndex, col });
      tiles.push(tile);
      if (pairedKind === undefined && seenKinds.has(tile.kind)) pairedKind = tile.kind;
      seenKinds.add(tile.kind);
    });
  });

  if (pairedKind === undefined) return { board, shuffled: false };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = placeTiles(board, positions, shuffle(tiles, rng));
    if (findMove(candidate) !== null) return { board: candidate, shuffled: true };
  }

  // Swapping whole tiles preserves counts and empty cells without relying on RNG.
  for (let first = 0; first < positions.length; first += 1) {
    for (let second = first + 1; second < positions.length; second += 1) {
      if (findGeometricPath(board, positions[first]!, positions[second]!) === null) {
        continue;
      }
      const arranged = tiles.slice();
      const firstSource = arranged.findIndex((tile) => tile.kind === pairedKind);
      [arranged[first], arranged[firstSource]] = [arranged[firstSource]!, arranged[first]!];
      const secondSource = arranged.findIndex(
        (tile, index) => tile.kind === pairedKind && index !== first,
      );
      [arranged[second], arranged[secondSource]] = [arranged[secondSource]!, arranged[second]!];
      return { board: placeTiles(board, positions, arranged), shuffled: true };
    }
  }

  return { board, shuffled: false };
}

export function remainingPairs(board: Board): number {
  let count = 0;
  for (const row of board) {
    for (const tile of row) {
      if (tile !== null) count += 1;
    }
  }
  return count / 2;
}
