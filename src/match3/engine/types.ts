export type Point = { row: number; col: number };
export type Special = 'row' | 'column' | 'bomb' | 'bird';
export type StarThresholds = [number, number, number];
export type EarnedStars = 1 | 2 | 3;
export const DEFAULT_STAR_THRESHOLDS = [1000, 2000, 3000] as const;
export type Tool = 'hammer' | 'swap' | 'shuffle';
export type Tools = Record<Tool, number>;
export type Obstacle = 'ice' | 'snow' | 'vine' | 'gift' | 'poison' | 'fur' | 'crystal';
export type Piece = { id: number; kind: number; special?: Special };
export type Blocker =
  | { type: 'snow'; layers: number }
  | { type: 'gift'; color: number; reward: { tool: Tool; count: number } }
  | { type: 'poison' }
  | { type: 'crystal'; colors: number[]; index: number };
export type Lock = { type: 'vine' | 'fur'; id: number };
export type Cell = { ground: boolean; piece: Piece | null; ice: number; blocker: Blocker | null; lock: Lock | null };
export type Goal =
  | { id: string; type: 'collect'; kind: number; count: number }
  | { id: string; type: 'clear'; obstacle: Obstacle; unit: 'layers' | 'objects'; count: number }
  | { id: string; type: 'special'; special: Special; count: number }
  | { id: string; type: 'score'; count: number };
export type Stage = { id: string; startRow: number; rows: number; goals: Goal[] };
export type Level = {
  schemaVersion: 1;
  rulesVersion: 1;
  packId: string;
  id: string;
  order: number;
  revision: number;
  title: string;
  width: number;
  height: number;
  mask: string[];
  palette: number[];
  seed?: number;
  initialPieces: (Point & { kind: number; special?: Special })[];
  ice: (Point & { layers: number })[];
  blockers: (Point & { blocker: Blocker })[];
  locks: (Point & { type: Lock['type'] })[];
  ropes: { from: Point; to: Point }[];
  portals: { id: string; from: Point; to: Point }[];
  spawnPoints: Point[];
  moves: number;
  starThresholds: StarThresholds;
  tools: Tools;
  scroll: boolean;
  stages: Stage[];
  goals: Goal[];
};
export type LevelPack = { schemaVersion: 1; levels: Level[] };
export type GameEvent = {
  type: 'swap' | 'clear' | 'fall' | 'spawn' | 'special' | 'obstacle' | 'stage' | 'shuffle' | 'invalid';
  cells: number[];
  special?: Special;
  from?: number;
  to?: number;
  board?: Cell[];
  score?: number;
};
export type MatchGame = {
  version: 1;
  level: Level;
  mode: 'normal' | 'test' | 'editor';
  phase: 'playing' | 'paused' | 'won' | 'failed';
  board: Cell[];
  stageIndex: number;
  movesLeft: number;
  tools: Tools;
  goalProgress: Record<string, number>;
  score: number;
  turn: number;
  rng: number;
  nextId: number;
  unlimitedMoves: boolean;
  unlimitedTools: boolean;
  events: GameEvent[];
  note: string;
  pauseReason: 'intro' | 'manual' | 'away' | 'restored';
};
export type Move = { from: number; to: number };
export type Action =
  | ({ type: 'SWAP'; free?: boolean } & Move)
  | { type: 'HAMMER'; at: number }
  | { type: 'SHUFFLE' | 'PAUSE' | 'RESUME' | 'AUTO' | 'COMPLETE' | 'FAIL' | 'RETRY' }
  | { type: 'UNLIMITED_MOVES' | 'UNLIMITED_TOOLS'; value: boolean };
export const specialNames: Record<Special, string> = { row: '横向特效', column: '纵向特效', bomb: '爆炸特效', bird: '魔力鸟' };
export const obstacleNames: Record<Obstacle, string> = { ice: '冰层', snow: '雪块', vine: '藤蔓', gift: '彩色礼盒', poison: '毒液', fur: '灰毛球', crystal: '水晶球' };
export const toolNames: Record<Tool, string> = { hammer: '小锤子', swap: '自由交换', shuffle: '重排' };
