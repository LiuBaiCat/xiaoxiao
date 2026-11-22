import { describe, expect, it } from 'vitest';
import { createBoard, remainingPairs } from '../engine/board';
import { levels } from '../engine/levels';
import { createGame, transition } from './machine';
import { decodeGame, encodeGame } from './storage';

function legacySave() {
  return {
    version: 1, phase: 'playing', levelId: 1, board: createBoard(4, 6, 4),
    resources: { lives: 7, hints: 5, extensions: 2 }, remainingMs: 120000,
    moveIndex: 0, unlocked: 6,
  };
}

describe('10行14列存档升级', () => {
  it('restarts an old board without losing resources or unlocked levels', () => {
    const restored = decodeGame(JSON.stringify(legacySave()))!;
    expect(restored.board).toHaveLength(10);
    expect(restored.board.every(row => row.length === 14)).toBe(true);
    expect(remainingPairs(restored.board)).toBe(70);
    expect(restored.remainingMs).toBe(levels[0].seconds * 1000);
    expect(restored.phase).toBe('paused');
    expect(restored.pauseReason).toBe('upgraded');
    expect(restored.resources).toEqual({ lives: 7, hints: 5, extensions: 2 });
    expect(restored.unlocked).toBe(6);
    expect(JSON.parse(encodeGame(restored)!).version).toBe(2);
  });
  it('does not re-award a previously completed level', () => {
    const saved = legacySave();
    const won = { ...saved, phase: 'won', board: saved.board.map(row => row.map(() => null)), moveIndex: 12 };
    const restored = decodeGame(JSON.stringify(won))!;
    expect(restored.phase).toBe('won');
    expect(restored.moveIndex).toBe(70);
    expect(restored.resources).toEqual(saved.resources);
    expect(transition(restored, { type: 'TICK' }, 1000).resources).toEqual(saved.resources);
    expect(decodeGame(encodeGame(restored)!)?.phase).toBe('won');
  });
  it('keeps exhausted lives exhausted until an explicit retry', () => {
    const saved = legacySave();
    const restored = decodeGame(JSON.stringify({ ...saved, phase: 'gameover', remainingMs: 0, resources: { ...saved.resources, lives: 0 } }))!;
    expect(restored.phase).toBe('gameover');
    expect(restored.resources.lives).toBe(0);
    expect(transition(restored, { type: 'RETRY' }, 0).resources.lives).toBe(5);
  });
  it('does not reinterpret a broken modern save as a legacy board', () => {
    expect(decodeGame(JSON.stringify({ ...legacySave(), version: 2 }))).toBeNull();
    const modern = transition(createGame(), { type: 'RESUME' }, 0);
    const restored = decodeGame(encodeGame(modern)!)!;
    expect(restored.pauseReason).toBe('restored');
    expect(restored.board).toEqual(modern.board);
  });
});
