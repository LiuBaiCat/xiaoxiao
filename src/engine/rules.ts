import type { Board, Point } from './types';

const directions: Point[] = [
  { row: -1, col: 0 },
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
];

type SearchState = Point & {
  direction: number;
  turns: number;
  parent: number;
};

function samePoint(a: Point, b: Point): boolean {
  return a.row === b.row && a.col === b.col;
}

function hasTile(board: Board, point: Point): boolean {
  return (
    Number.isInteger(point.row) &&
    Number.isInteger(point.col) &&
    point.row >= 0 &&
    point.row < board.length &&
    point.col >= 0 &&
    point.col < (board[0]?.length ?? 0) &&
    board[point.row]?.[point.col] != null
  );
}

function reconstructPath(states: SearchState[], end: number): Point[] {
  const steps: Point[] = [];
  for (let index = end; index !== -1; index = states[index]!.parent) {
    const { row, col } = states[index]!;
    steps.push({ row, col });
  }
  steps.reverse();

  const path: Point[] = [steps[0]!];
  for (let index = 1; index < steps.length - 1; index += 1) {
    const before = steps[index - 1]!;
    const current = steps[index]!;
    const after = steps[index + 1]!;
    if (
      current.row - before.row !== after.row - current.row ||
      current.col - before.col !== after.col - current.col
    ) {
      path.push(current);
    }
  }
  path.push(steps[steps.length - 1]!);
  return path;
}

export function findGeometricPath(
  board: Board,
  from: Point,
  to: Point,
): Point[] | null {
  if (samePoint(from, to) || !hasTile(board, from) || !hasTile(board, to)) {
    return null;
  }

  const rows = board.length;
  const cols = board[0]!.length;
  const states: SearchState[] = [
    { row: from.row, col: from.col, direction: -1, turns: 0, parent: -1 },
  ];
  const visited = new Set<string>();

  for (let cursor = 0; cursor < states.length; cursor += 1) {
    const state = states[cursor]!;
    for (let direction = 0; direction < directions.length; direction += 1) {
      // A reversal cannot improve a path; turns here are right-angle bends.
      if (state.direction !== -1 && direction === (state.direction + 2) % 4) {
        continue;
      }
      const turns =
        state.turns + (state.direction !== -1 && state.direction !== direction ? 1 : 0);
      if (turns > 2) continue;

      const delta = directions[direction]!;
      const next = { row: state.row + delta.row, col: state.col + delta.col };
      if (next.row < -1 || next.row > rows || next.col < -1 || next.col > cols) {
        continue;
      }
      const isTarget = samePoint(next, to);
      const isOutside = next.row === -1 || next.row === rows || next.col === -1 || next.col === cols;
      if (!isTarget && !isOutside && board[next.row]?.[next.col] !== null) {
        continue;
      }

      // Direction AND turn budget belong to the state, not just the cell.
      const key = `${next.row},${next.col},${direction},${turns}`;
      if (visited.has(key)) continue;
      visited.add(key);
      states.push({ ...next, direction, turns, parent: cursor });
      if (isTarget) return reconstructPath(states, states.length - 1);
    }
  }
  return null;
}

export function findPath(board: Board, from: Point, to: Point): Point[] | null {
  if (!hasTile(board, from) || !hasTile(board, to)) return null;
  if (board[from.row]![from.col]!.kind !== board[to.row]![to.col]!.kind) return null;
  return findGeometricPath(board, from, to);
}
