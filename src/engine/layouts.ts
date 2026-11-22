import type { Board, Layout, Tile } from './types';

export const layoutNames: Record<Layout, string> = {
  still: '保持原位',
  down: '向下靠拢',
  up: '向上靠拢',
  left: '向左靠拢',
  right: '向右靠拢',
  splitVertical: '上下分离',
  splitHorizontal: '左右分离',
  centerHorizontal: '左右聚拢',
  centerVertical: '上下聚拢',
};

type Line = (Tile | null)[];
type Packing = 'start' | 'end' | 'split' | 'center';

function compact(line: Line, towardEnd: boolean): Line {
  const tiles = line.filter((tile): tile is Tile => tile !== null);
  const spaces: Line = Array<null>(line.length - tiles.length).fill(null);
  return towardEnd ? [...spaces, ...tiles] : [...tiles, ...spaces];
}

function arrange(line: Line, packing: Packing): Line {
  if (packing === 'start' || packing === 'end') {
    return compact(line, packing === 'end');
  }
  // The fixed midpoint prevents tiles from crossing between halves.
  const midpoint = Math.floor(line.length / 2);
  return [
    ...compact(line.slice(0, midpoint), packing === 'center'),
    ...compact(line.slice(midpoint), packing === 'split'),
  ];
}

export function applyLayout(board: Board, layout: Layout): Board {
  if (layout === 'still') return board.map((row) => row.slice());

  const horizontal =
    layout === 'left' ||
    layout === 'right' ||
    layout === 'splitHorizontal' ||
    layout === 'centerHorizontal';
  const packing: Packing =
    layout === 'left' || layout === 'up'
      ? 'start'
      : layout === 'right' || layout === 'down'
        ? 'end'
        : layout === 'splitHorizontal' || layout === 'splitVertical'
          ? 'split'
          : 'center';

  if (horizontal) return board.map((row) => arrange(row, packing));

  const result = board.map((row) => row.slice());
  for (let col = 0; col < (board[0]?.length ?? 0); col += 1) {
    const packed = arrange(board.map((row) => row[col]!), packing);
    for (let row = 0; row < board.length; row += 1) {
      result[row]![col] = packed[row]!;
    }
  }
  return result;
}
