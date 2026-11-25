import { describe, expect, it } from 'vitest';
import { applyGravity, gravityGraph } from './gravity';
import { fixture, copy } from './fixtures.test-helper';

describe('下落、分隔补充与门户DAG', () => {
  it('普通动物和特效下落，冰上动物固定，ID唯一并返回fall/spawn快照', () => {
    const g = fixture(['012', '345', '.12']);
    g.board[4].piece!.special = 'bomb'; g.board[4].ice = 2;
    const id = g.board[3].piece!.id;
    const frozen = copy(g.board[4].piece);
    applyGravity(g);
    expect(g.board[4].piece).toEqual(frozen);
    expect(g.board[6].piece).toEqual({ id, kind: 3 });
    expect(g.board[4].ice).toBe(2); expect(g.board[6].ice).toBe(0);
    expect(new Set(g.board.map(c => c.piece?.id)).size).toBe(9);
    expect(g.events.some(e => e.type === 'fall' && e.from === 3 && e.to === 6)).toBe(true);
    expect(g.events.some(e => e.type === 'spawn')).toBe(true);
    expect(g.events.every(e => e.board?.length === 9)).toBe(true);
  });
  it('空洞和固定障碍分隔自动补充通路，锁定动物不下落', () => {
    const g = fixture(['012', '#45', '.12', '.34']);
    g.board[4].piece = null; g.board[4].blocker = { type: 'snow', layers: 1 };
    g.board[2].lock = { type: 'vine', id: 90 }; g.board[5].piece = null;
    const lockPiece = copy(g.board[2].piece);
    applyGravity(g);
    expect(g.board[3].piece).toBeNull(); expect(g.board[4].piece).toBeNull();
    expect(g.board[6].piece).not.toBeNull(); expect(g.board[9].piece).not.toBeNull();
    expect(g.board[2].piece).toEqual(lockPiece); expect(g.board[5].piece).not.toBeNull();
    g.board[4].blocker = null; applyGravity(g);
    expect(g.board[4].piece).not.toBeNull(); expect(g.board[1].piece).not.toBeNull();
  });
  it('门户出边覆盖普通向下，出口继续下落，传送保留特效和ID', () => {
    const g = fixture(['0#.', '1#.', '2#.']);
    g.level.portals = [{ id: 'p', from: { row: 1, col: 0 }, to: { row: 0, col: 2 } }];
    g.board[3].piece!.special = 'column'; const original = copy(g.board[3].piece), bottom = copy(g.board[6].piece);
    const graph = gravityGraph(g);
    expect(graph.next.get(3)).toBe(2); expect(graph.previous.has(6)).toBe(false);
    applyGravity(g);
    expect(g.board[8].piece).toEqual(original); expect(g.board[6].piece).toEqual(bottom);
    expect(g.events.some(e => e.type === 'fall' && e.from === 3 && e.to === 2)).toBe(true);
  });
  it('门户出口阻塞时入口等待；固定障碍消失后通路恢复供料', () => {
    const g = fixture(['0#1', '2#3', '4#5']);
    g.level.portals = [{ id: 'p', from: { row: 1, col: 0 }, to: { row: 0, col: 2 } }];
    g.board[2].piece = null; g.board[2].blocker = { type: 'snow', layers: 1 };
    const incoming = copy(g.board[3].piece);
    applyGravity(g); expect(g.board[3].piece).toEqual(incoming);
    g.board[2].blocker = null; applyGravity(g);
    expect(g.board[2].piece).toEqual(incoming);
  });
  it('显式入口不凭空制造新来源，入口恢复后能继续供料', () => {
    const g = fixture(['0#1', '2#3', '.#4']);
    g.level.spawnPoints = [{ row: 0, col: 2 }];
    expect(() => applyGravity(g)).toThrow('没有补充入口');
    g.level.spawnPoints.push({ row: 0, col: 0 }); applyGravity(g);
    expect(g.board.filter(c => c.ground).every(c => c.piece)).toBe(true);
  });
  it('冰上动物固定；动物消除后空冰格仍可由上方补充', () => {
    const g = fixture(['012', '345', '012']);
    g.board[4].ice = 2;
    g.board[4].piece = null;
    applyGravity(g);
    expect(g.board[4].ice).toBe(2);
    expect(g.board[4].piece).not.toBeNull();
  });
  it('循环、自环、歧义入边与跨段门明确拒绝', () => {
    const cycle = fixture(['012', '345', '012']);
    cycle.level.portals = [{ id: 'p', from: { row: 2, col: 0 }, to: { row: 0, col: 0 } }];
    expect(() => gravityGraph(cycle)).toThrow('循环');
    cycle.level.portals[0].from = { row: 0, col: 0 };
    expect(() => gravityGraph(cycle)).toThrow('循环');
    cycle.level.portals = [{ id: 'p', from: { row: 0, col: 0 }, to: { row: 1, col: 2 } }];
    expect(() => gravityGraph(cycle)).toThrow('多个入边');
    cycle.level.stages = [{ id: 'a', startRow: 0, rows: 1, goals: [] }, { id: 'b', startRow: 1, rows: 2, goals: [] }];
    expect(() => gravityGraph(cycle)).toThrow('同一阶段');
  });
  it('仅活动段参与下落与生成，未来段及已通过段逐字段不变', () => {
    const g = fixture(undefined, 4, 9);
    g.level.stages = [0, 1, 2].map(i => ({ id: String(i), startRow: i * 3, rows: 3, goals: [] }));
    g.stageIndex = 1; const before = copy(g.board);
    g.board[16].piece = null; applyGravity(g);
    expect(g.board.slice(0, 12)).toEqual(before.slice(0, 12)); expect(g.board.slice(24)).toEqual(before.slice(24));
  });
});
