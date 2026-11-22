export type Tile = { id: number; kind: number };

export type Board = (Tile | null)[][];

export type Point = { row: number; col: number };

export type Layout =
  | 'still'
  | 'down'
  | 'up'
  | 'left'
  | 'right'
  | 'splitVertical'
  | 'splitHorizontal'
  | 'centerHorizontal'
  | 'centerVertical';

export type Move = { from: Point; to: Point; path: Point[] };

export type Level = {
  id: number;
  name: string;
  description: string;
  rows: number;
  cols: number;
  kinds: number;
  seconds: number;
  layouts: Layout[];
};
