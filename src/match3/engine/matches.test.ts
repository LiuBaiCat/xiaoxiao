import { describe, expect, it } from 'vitest';
import { detectMatches, findMove, swapReason } from './matches';
import { fixture, freeze } from './fixtures.test-helper';

describe('三消匹配及提示', () => {
  it('只有横竖连续三格，斜线不匹配，空洞及鸟截断', () => {
    expect(detectMatches(fixture(['012', '201', '120']))).toEqual([]);
    expect(detectMatches(fixture(['111', '234', '345']))[0].cells).toEqual([0, 1, 2]);
    expect(detectMatches(fixture(['123', '145', '102']))[0].cells).toEqual([0, 3, 6]);
    const g = fixture(['11111', '23450', '34502']);
    g.board[2].piece!.special = 'bird';
    expect(detectMatches(g)).toEqual([]);
    g.board[2].piece = null; g.board[2].ground = false;
    expect(detectMatches(g)).toEqual([]);
  });
  it.each([
    [['1111', '2345', '3450'], 'column'],
    [['123', '145', '102', '134'], 'row'],
    [['11111', '23450', '34502'], 'bird'],
    [['111111', '234501', '345023'], 'bird'],
    [['01234', '51112', '03145', '04123', '52340'], 'bomb'],
    [['11123', '23145', '45102', '02345', '34501'], 'bomb'],
  ] as const)('检测直线及L/T生成：%s', (rows, special) => {
    const matches = detectMatches(fixture([...rows]));
    expect(matches).toHaveLength(1); expect(matches[0].special).toBe(special);
  });
  it('共享交点合并一组且五连优先，不合并不相交的同色组', () => {
    const g = fixture(['22122', '33133', '11111', '44544', '55055']);
    const m = detectMatches(g);
    expect(m).toHaveLength(1); expect(m[0].special).toBe('bird'); expect(m[0].cells).toHaveLength(7);
    expect(detectMatches(fixture(['11123', '23450', '11102']))).toHaveLength(2);
  });
  it('生成点优先落点、起点、行列序；L/T优先交点；锁定点不可生成', () => {
    const g = fixture(['1111', '2345', '3450']);
    expect(detectMatches(g, { from: 1, to: 2 })[0].at).toBe(2);
    g.board[2].lock = { type: 'vine', id: 99 };
    expect(detectMatches(g, { from: 1, to: 2 })[0].at).toBe(1);
    expect(detectMatches(g)[0].at).toBe(0);
    const lt = fixture(['11123', '23145', '45102', '02345', '34501']);
    expect(detectMatches(lt, { from: 0, to: 1 })[0].at).toBe(2);
    for (const i of [0, 1, 2, 7, 12]) lt.board[i].lock = { type: 'fur', id: i + 100 };
    expect(detectMatches(lt)[0].at).toBeUndefined();
  });
  it('提示为纯查询，绳阻普通交换但不阻自由交换，锁定都不能移动', () => {
    const g = fixture(['010', '102', '230']);
    expect(findMove(freeze(g))).toEqual({ from: 1, to: 4 });
    const r = fixture(['010', '102', '230']);
    r.level.ropes = [{ from: { row: 0, col: 1 }, to: { row: 1, col: 1 } }];
    expect(swapReason(r, { from: 1, to: 4 })).toContain('绳子');
    expect(swapReason(r, { from: 1, to: 4 }, true)).toBeNull();
    r.board[4].lock = { type: 'vine', id: 50 };
    expect(swapReason(r, { from: 1, to: 4 }, true)).toContain('锁定');
  });
});
