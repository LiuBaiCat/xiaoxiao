import { describe, expect, it } from 'vitest';
import { advanceEnvironment, poisonedOut } from './environment';
import { fixture, copy } from './fixtures.test-helper';

describe('回合末动态障碍', () => {
  it('多个毒源总共只扩张一个，吞噬特效不引爆、不损冰、不计收集', () => {
    const g = fixture(['0#1', '2#3', '4#5']);
    for (const i of [0, 2]) { g.board[i].piece = null; g.board[i].blocker = { type: 'poison' }; }
    for (const i of [3, 5]) { g.board[i].piece!.special = 'bomb'; g.board[i].ice = 3; }
    advanceEnvironment(g, false);
    expect(g.board.filter(c => c.blocker?.type === 'poison')).toHaveLength(3);
    expect(g.board[3].ice).toBe(3); expect(g.board[5].ice).toBe(3);
    expect(g.events.filter(e => e.type === 'special')).toEqual([]); expect(g.score).toBe(0); expect(g.goalProgress).toEqual({});
  });
  it('本回合任一波清除毒液就不扩张，且无候选时不扩张', () => {
    const g = fixture(); g.board[24].piece = null; g.board[24].blocker = { type: 'poison' };
    const before = copy(g.board); advanceEnvironment(g, true); expect(g.board).toEqual(before);
    for (const i of [17, 23, 25, 31]) g.board[i].lock = { type: 'vine', id: i + 100 };
    advanceEnvironment(g, false); expect(g.board.filter(c => c.blocker?.type === 'poison')).toHaveLength(1);
  });
  it('毛球不重叠、不重复跳跃、不钻进其他毛球本次刚空出的位置', () => {
    const g = fixture(['#####', '#012#', '#####']);
    g.board[6].lock = { type: 'fur', id: 100 }; g.board[8].lock = { type: 'fur', id: 101 };
    advanceEnvironment(g, true);
    expect(g.board[7].lock).toEqual({ type: 'fur', id: 100 }); expect(g.board[8].lock).toEqual({ type: 'fur', id: 101 });
    expect(g.board[6].lock).toBeNull(); expect(g.board[6].piece?.kind).toBe(0);
    expect(g.board.filter(c => c.lock?.type === 'fur')).toHaveLength(2);
  });
  it('水晶按自身序列变色一格，不随机改变动物', () => {
    const g = fixture(); g.board[24].piece = null; g.board[24].blocker = { type: 'crystal', colors: [2, 5, 1], index: 2 };
    const pieces = copy(g.board.map(c => c.piece)), rng = g.rng;
    advanceEnvironment(g, true);
    expect(g.board[24].blocker).toEqual({ type: 'crystal', colors: [2, 5, 1], index: 0 });
    expect(g.board.map(c => c.piece)).toEqual(pieces); expect(g.rng).toBe(rng);
  });
  it('毒液占满可承载动物的格子判失败，固定雪块不算候选', () => {
    const g = fixture(['0#1', '###', '2#3']);
    for (const c of g.board) if (c.ground) { c.piece = null; c.blocker = { type: 'poison' }; }
    g.board[0].blocker = { type: 'snow', layers: 2 };
    expect(poisonedOut(g)).toBe(true); g.board[8].blocker = null; expect(poisonedOut(g)).toBe(false);
  });
});
