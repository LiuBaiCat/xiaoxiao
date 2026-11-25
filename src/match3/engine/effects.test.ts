import { describe, expect, it } from 'vitest';
import type { Special } from './types';
import { resolveWave } from './effects';
import { detectMatches } from './matches';
import { fixture } from './fixtures.test-helper';

describe('特效生成和同波保护', () => {
  it('横向四连留一个新纵扫，不立即触发；下一波能触发', () => {
    const g = fixture(['1111', '2345', '3450']);
    g.level.goals = [{ id: 'column', type: 'special', special: 'column', count: 10 }];
    resolveWave(g, { matches: detectMatches(g, { from: 1, to: 2 }) });
    expect(g.board[2].piece?.special).toBe('column');
    expect(g.board[2].piece?.id).toBe(3);
    expect(g.goalProgress.column ?? 0).toBe(0);
    resolveWave(g, { hammer: 2 });
    expect(g.board[2].piece).toBeNull(); expect(g.goalProgress.column).toBe(1);
  });
  it('旧特效仍引爆，新生成点被其他旧特效击中也保留', () => {
    const g = fixture(['1111', '2345', '3450']);
    g.board[0].piece!.special = 'column';
    g.board[1].ice = 3;
    resolveWave(g, { matches: detectMatches(g, { from: 0, to: 2 }) });
    expect(g.board[2].piece?.special).toBe('column');
    expect(g.board[1].ice).toBe(2);
    expect(g.events.filter(e => e.type === 'special')).toHaveLength(2);
  });
  it('边角炸弹为曼哈顿半径2，不清对角方块', () => {
    const g = fixture(); g.board[0].piece!.special = 'bomb';
    expect(resolveWave(g, { hammer: 0 }).removed.sort((a, b) => a - b)).toEqual([0, 1, 2, 7, 8, 14]);
    expect(g.board[16].piece).not.toBeNull();
  });
  it('横扫跨空洞与固定雪块，不沿门户折转', () => {
    const g = fixture(); g.board[21].piece!.special = 'row';
    g.board[23].ground = false; g.board[23].piece = null;
    g.board[24].piece = null; g.board[24].blocker = { type: 'snow', layers: 2 };
    g.level.portals = [{ id: 'p', from: { row: 3, col: 1 }, to: { row: 0, col: 6 } }];
    resolveWave(g, { hammer: 21 });
    expect(g.board[24].blocker).toEqual({ type: 'snow', layers: 1 });
    expect(g.board[27].piece).toBeNull(); expect(g.board[6].piece).not.toBeNull();
  });
  it('自动触发尊重冰层和覆盖；触发的特效仍可削减周围冰层', () => {
    const g = fixture(); g.board[24].piece!.special = 'bomb'; g.board[24].ice = 1;
    const before = g.score;
    resolveWave(g, { triggerSpecial: 24, suppressFrozenSpecials: true });
    expect(g.score).toBe(before);
    expect(g.board[24].piece?.special).toBe('bomb');
    g.board[24].ice = 0; g.board[24].lock = { type: 'vine', id: 99 };
    resolveWave(g, { triggerSpecial: 24, suppressFrozenSpecials: true });
    expect(g.score).toBe(before);
    g.board[24].lock = null; g.board[25].ice = 2;
    resolveWave(g, { triggerSpecial: 24, suppressFrozenSpecials: true });
    expect(g.score).toBeGreaterThan(before);
    expect(g.board[25].ice).toBe(1);
  });
});

describe('所有加强组合及对称顺序', () => {
  const types: Special[] = ['row', 'column', 'bomb'];
  for (const a of types) for (const b of types) {
    it(`${a} + ${b} 使用落点中心的加强范围`, () => {
      const g = fixture(); const from = 23, to = 24;
      g.board[from].piece!.special = a; g.board[to].piece!.special = b;
      const removed = resolveWave(g, { combo: { from, to } }).removed;
      const lines = [a, b].filter(s => s !== 'bomb').length;
      const expected = g.board.map((_, i) => i).filter(i => {
        const dr = Math.abs(Math.floor(i / 7) - 3), dc = Math.abs(i % 7 - 3);
        return lines === 2 ? dr === 0 || dc === 0 : lines === 1 ? dr <= 1 || dc <= 1 : dr <= 2 && dc <= 2;
      });
      expect(new Set(removed)).toEqual(new Set(expected));
    });
  }
  for (const special of [undefined, 'row', 'column', 'bomb', 'bird'] as const) for (const reverse of [false, true]) {
    it(`鸟 + ${special ?? '普通'} ${reverse ? '反向' : '正向'}`, () => {
      const g = fixture();
      for (const c of g.board) c.piece!.kind = 2;
      const birdAt = reverse ? 24 : 23, partnerAt = reverse ? 23 : 24;
      g.board[birdAt].piece!.special = 'bird';
      g.board[partnerAt].piece!.kind = 1;
      if (special) g.board[partnerAt].piece!.special = special;
      g.board[8].piece!.kind = 1;
      resolveWave(g, { combo: { from: 23, to: 24 } });
      if (special === 'bird') expect(g.board.every(c => !c.piece)).toBe(true);
      else {
        expect(g.board[8].piece).toBeNull(); expect(g.board[partnerAt].piece).toBeNull();
        if (!special) expect(g.board.filter(c => !c.piece)).toHaveLength(3);
        if (special === 'row') { expect(g.board[7].piece).toBeNull(); expect(g.board[0].piece).not.toBeNull(); }
        if (special === 'column') { expect(g.board[1].piece).toBeNull(); expect(g.board[0].piece).not.toBeNull(); }
        if (special === 'bomb') { expect(g.board[0].piece).toBeNull(); expect(g.board[48].piece).not.toBeNull(); }
      }
    });
  }
  it('鸟复制覆盖旧特效而非触发旧方向，锁定动物只解锁一次', () => {
    const g = fixture(); for (const c of g.board) c.piece!.kind = 2;
    g.board[23].piece!.special = 'bird';
    g.board[24].piece = { id: 25, kind: 1, special: 'row' };
    g.board[8].piece = { id: 9, kind: 1, special: 'column' };
    g.board[10].piece = { id: 11, kind: 1, special: 'bomb' };
    g.board[10].lock = { type: 'vine', id: 99 };
    resolveWave(g, { combo: { from: 23, to: 24 } });
    expect(g.board[1].piece).not.toBeNull();
    expect(g.board[10].piece?.special).toBe('bomb'); expect(g.board[10].lock).toBeNull();
    expect(g.events.filter(e => e.type === 'special').map(e => e.special)).toEqual(['bird', 'row', 'row']);
  });
  it('鸟被动触发选择最多颜色，同数按颜色编号', () => {
    const g = fixture(['201', '012', '120']);
    g.board[4].piece!.special = 'bird';
    // After excluding the bird: kind 0 has three, kind 2 has three, kind 1 has two.
    resolveWave(g, { hammer: 4 });
    expect([1, 3, 8].every(i => !g.board[i].piece)).toBe(true);
    expect(g.board[0].piece).not.toBeNull();
  });
});

describe('九类障碍的直接命中与相邻消除', () => {
  it.each(['vine', 'fur'] as const)('%s 底下匹配清动物和覆盖；直接命中只解锁且不引爆', type => {
    const g = fixture(['111', '234', '345']);
    g.board[1].lock = { type, id: 90 }; g.board[1].piece!.special = 'column';
    resolveWave(g, { hammer: 1 });
    expect(g.board[1].piece?.special).toBe('column'); expect(g.board[1].lock).toBeNull(); expect(g.board[4].piece).not.toBeNull();
    g.board[1].lock = { type, id: 91 };
    resolveWave(g, { matches: detectMatches(g) });
    expect(g.board[1].piece).toBeNull(); expect(g.board[1].lock).toBeNull(); expect(g.board[4].piece).toBeNull();
  });
  it('同波多条特效不重复触发、不重复解锁、不重复减雪/冰层；下一波可再损伤', () => {
    const g = fixture(); g.board[23].piece!.special = 'row'; g.board[24].piece!.special = 'bomb';
    g.board[17].piece = { id: 18, kind: 1, special: 'bomb' }; g.board[17].lock = { type: 'fur', id: 100 };
    g.board[25].piece = null; g.board[25].blocker = { type: 'snow', layers: 3 };
    g.board[22].ice = 3;
    resolveWave(g, { combo: { from: 23, to: 24 } });
    expect(g.board[17].piece?.special).toBe('bomb'); expect(g.board[17].lock).toBeNull();
    expect(g.board[25].blocker).toEqual({ type: 'snow', layers: 2 }); expect(g.board[22].ice).toBe(2);
    resolveWave(g, { hammer: 25 }); expect(g.board[25].blocker).toEqual({ type: 'snow', layers: 1 });
  });
  it('锤子按覆盖、冰、固定障碍、动物顺序；冰不随动物移动', () => {
    const g = fixture(); g.board[24].ice = 2; g.board[24].lock = { type: 'vine', id: 100 }; g.board[24].piece!.special = 'bomb';
    resolveWave(g, { hammer: 24 }); expect(g.board[24].ice).toBe(2); expect(g.board[24].lock).toBeNull();
    resolveWave(g, { hammer: 24 }); expect(g.board[24].ice).toBe(1); expect(g.board[24].piece?.special).toBe('bomb');
    resolveWave(g, { hammer: 24 }); expect(g.board[24].ice).toBe(0); expect(g.board[24].piece?.special).toBe('bomb');
    resolveWave(g, { hammer: 24 }); expect(g.board[24].piece).toBeNull();
  });
  it('礼盒仅同色相邻/直接颜色、双鸟或锤击打开，奖励每盒只发一次', () => {
    const g = fixture(); g.board[24].piece = null;
    g.board[24].blocker = { type: 'gift', color: 1, reward: { tool: 'hammer', count: 3 } };
    g.board[23].piece!.kind = 2;
    resolveWave(g, { hammer: 23 }); expect(g.board[24].blocker?.type).toBe('gift');
    g.board[17].piece!.kind = 1;
    resolveWave(g, { hammer: 17 }); expect(g.board[24].blocker).toBeNull(); expect(g.tools.hammer).toBe(5);
    resolveWave(g, { hammer: 24 }); expect(g.tools.hammer).toBe(5);
  });
  it('异色直线不会打开礼盒，锤击不限制颜色', () => {
    const g = fixture(); g.board[21].piece = { id: 22, kind: 2, special: 'row' }; g.board[24].piece = null;
    g.board[24].blocker = { type: 'gift', color: 99, reward: { tool: 'swap', count: 2 } };
    resolveWave(g, { hammer: 21 }); expect(g.board[24].blocker?.type).toBe('gift');
    resolveWave(g, { hammer: 24 }); expect(g.tools.swap).toBe(4);
  });
  it('双鸟命中空格上的全部礼盒；锁定特效不穿透', () => {
    const g = fixture(); g.board[23].piece!.special = 'bird'; g.board[24].piece!.special = 'bird';
    g.board[0].piece = null; g.board[0].blocker = { type: 'gift', color: 99, reward: { tool: 'shuffle', count: 1 } };
    g.board[1].lock = { type: 'vine', id: 100 }; g.board[1].piece!.special = 'bomb';
    resolveWave(g, { combo: { from: 23, to: 24 } });
    expect(g.tools.shuffle).toBe(3); expect(g.board[0].blocker).toBeNull(); expect(g.board[1].piece?.special).toBe('bomb');
  });
  it('雪/毒邻接不要求颜色，水晶邻接要求当前颜色；水晶直接命中不要求颜色', () => {
    const g = fixture();
    for (const i of [17, 23, 25, 31]) g.board[i].piece = null;
    g.board[17].blocker = { type: 'snow', layers: 2 }; g.board[23].blocker = { type: 'poison' };
    g.board[25].blocker = { type: 'crystal', colors: [99, 1], index: 0 };
    g.board[31].blocker = { type: 'crystal', colors: [1, 99], index: 0 };
    g.board[24].piece!.kind = 1;
    expect(resolveWave(g, { hammer: 24 }).poisonCleared).toBe(true);
    expect(g.board[17].blocker).toEqual({ type: 'snow', layers: 1 }); expect(g.board[23].blocker).toBeNull();
    expect(g.board[25].blocker?.type).toBe('crystal'); expect(g.board[31].blocker).toBeNull();
    resolveWave(g, { hammer: 25 }); expect(g.board[25].blocker).toBeNull();
  });
  it('层数与实体数分别计数，冰仅动物真正消除时扣层', () => {
    const g = fixture(['1111', '2345', '3450']);
    g.level.goals = [
      { id: 'layers', type: 'clear', obstacle: 'ice', unit: 'layers', count: 10 },
      { id: 'objects', type: 'clear', obstacle: 'ice', unit: 'objects', count: 10 },
      { id: 'collect', type: 'collect', kind: 1, count: 10 },
    ];
    g.board[0].ice = 2; g.board[1].ice = 1; g.board[2].ice = 3;
    resolveWave(g, { matches: detectMatches(g, { from: 1, to: 2 }) });
    expect(g.goalProgress).toEqual({ layers: 3, objects: 1, collect: 3 }); expect(g.board[2].ice).toBe(2);
  });
});
