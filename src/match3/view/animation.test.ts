import { describe, expect, it } from 'vitest';
import { fixture } from '../engine/fixtures.test-helper';
import { animationFrames } from './animation';

describe('动画帧批次', () => {
  it('合并连续下落与补充事件，保留各自最新棋盘快照', () => {
    const game = fixture();
    const first = structuredClone(game.board);
    const second = structuredClone(game.board);
    const frames = animationFrames([
      { type: 'fall', cells: [1], from: 1, to: 8, board: first },
      { type: 'fall', cells: [2], from: 2, to: 9, board: second },
      { type: 'spawn', cells: [0], board: first },
      { type: 'spawn', cells: [7], board: second },
    ], game.board, 0);
    expect(frames.map(frame => frame.type)).toEqual(['fall', 'spawn']);
    expect(frames[0].cells).toEqual([1, 2]);
    expect(frames[0].board).toEqual(second);
    expect(frames[1].cells).toEqual([0, 7]);
    expect(frames[1].board).toEqual(second);
  });

  it('只合并相邻同类事件，保留清除和阶段顺序', () => {
    const game = fixture();
    const events = [
      { type: 'fall' as const, cells: [1], board: game.board },
      { type: 'clear' as const, cells: [1], board: game.board },
      { type: 'fall' as const, cells: [2], board: game.board },
      { type: 'stage' as const, cells: [], board: game.board },
    ];
    expect(animationFrames(events, game.board, 0).map(frame => [frame.type, frame.stageIndex]))
      .toEqual([['fall', 0], ['clear', 0], ['fall', 0], ['stage', 1]]);
  });
});
