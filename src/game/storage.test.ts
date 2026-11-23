import { describe, expect, it } from 'vitest';
import { createBoard, findMove, remainingPairs } from '../engine/board';
import { levels } from '../engine/levels';
import type { Board } from '../engine/types';
import { createGame, MATCH_BONUS_MS, transition, type GameState } from './machine';
import { decodeGame, encodeGame } from './storage';

function legacySave() {
  return {
    version: 1, phase: 'playing', levelId: 1, board: createBoard(4, 6, 4),
    resources: { lives: 7, hints: 5, extensions: 2 }, remainingMs: 120000,
    moveIndex: 0, unlocked: 6,
  };
}

function deadlockFixture(lives: number): GameState {
  const game = transition(createGame(), { type: 'RESUME' }, 100);
  const board: Board = game.board.map(row => row.map(() => null));
  [[2, 2], [0, 1], [1, 0]].forEach((row, r) => row.forEach((kind, c) => {
    board[r][c] = { id: r * 2 + c + 1, kind };
  }));
  return { ...game, board, moveIndex: 67, remainingMs: 60000, unlocked: 8, resources: { lives, hints: 0, extensions: 2 } };
}

function gameoverSave() {
  const game = deadlockFixture(0);
  return {
    version: 2, phase: 'gameover', levelId: game.levelId,
    board: game.board.map((row, r) => row.map(tile => r === 0 ? null : tile)),
    resources: game.resources, remainingMs: 63000, moveIndex: 68, unlocked: game.unlocked,
  };
}

describe('死局扣命存档', () => {
  it.each([2, 1])('persists a real deadlock match with %i lives without charging on repeated reloads', lives => {
    const before = deadlockFixture(lives);
    expect(before.board).toHaveLength(10);
    expect(before.board.every(row => row.length === 14)).toBe(true);
    expect(remainingPairs(before.board)).toBe(3);
    const restoredBefore = decodeGame(encodeGame(before)!)!;
    expect(restoredBefore.resources).toEqual(before.resources);
    expect(restoredBefore.moveIndex).toBe(67);
    const resumed = transition(restoredBefore, { type: 'RESUME' }, 100);
    const selected = transition(resumed, { type: 'SELECT', point: { row: 0, col: 0 } }, 100);
    const matched = transition(selected, { type: 'SELECT', point: { row: 0, col: 1 } }, 1100);
    const expectedResources = { lives: lives - 1, hints: 0, extensions: 2 };
    expect(matched.phase).toBe(lives === 1 ? 'gameover' : 'playing');
    expect(matched.resources).toEqual(expectedResources);
    expect(matched.remainingMs).toBe(before.remainingMs - 1000 + MATCH_BONUS_MS);
    expect(matched.moveIndex).toBe(68);
    expect(remainingPairs(matched.board)).toBe(2);
    if (lives === 1) {
      expect(matched.board).toEqual(gameoverSave().board);
      expect(findMove(matched.board)).toBeNull();
    } else {
      expect(findMove(matched.board)).not.toBeNull();
    }
    let game = matched;
    for (let refresh = 0; refresh < 3; refresh += 1) {
      const encoded = encodeGame(game)!;
      expect(JSON.parse(encoded).remainingMs).toBe(matched.remainingMs);
      const restored = decodeGame(encoded)!;
      expect(restored).not.toBeNull();
      expect(restored.phase).toBe(lives === 1 ? 'gameover' : 'paused');
      expect(restored.board).toEqual(matched.board);
      expect(restored.moveIndex).toBe(68);
      expect(restored.resources).toEqual(expectedResources);
      expect(restored.remainingMs).toBe(matched.remainingMs);
      expect(restored.unlocked).toBe(8);
      expect(restored.anchor).toBeNull();
      expect(restored.animation).toBeNull();
      expect(restored.matchFeedback).toBeNull();
      expect(restored.selected).toBeNull();
      expect(restored.hint).toBeNull();
      expect(transition(restored, { type: 'TICK' }, 999999)).toEqual(restored);
      game = transition(restored, { type: 'RESUME' }, 1000000);
      for (const action of [
        { type: 'SELECT', point: { row: 0, col: 0 } },
        { type: 'SELECT', point: { row: 0, col: 1 } },
        { type: 'CONTINUE' }, { type: 'TICK' },
      ] as const) {
        game = transition(game, action, 1000000);
        expect(game.resources).toEqual(expectedResources);
        expect(game.board).toEqual(matched.board);
        expect(game.moveIndex).toBe(68);
        expect(game.remainingMs).toBe(matched.remainingMs);
      }
      expect(game.phase).toBe(lives === 1 ? 'gameover' : 'playing');
    }
    if (lives === 1) {
      const retried = transition(game, { type: 'RETRY' }, 1000001);
      expect(retried.phase).toBe('paused');
      expect(retried.resources).toEqual({ lives: 5, hints: 3, extensions: 3 });
      expect(retried.unlocked).toBe(8);
      expect(retried.remainingMs).toBe(levels[0].seconds * 1000);
      expect(retried.moveIndex).toBe(0);
      expect(remainingPairs(retried.board)).toBe(70);
      expect(decodeGame(encodeGame(retried)!)?.resources).toEqual(retried.resources);
    }
  });
  it.each([0, 1000, 63000, levels[0].seconds * 1000 + 30000])('accepts gameover with %i ms and zero lives on a nonempty board', remainingMs => {
    const saved = { ...gameoverSave(), remainingMs };
    const restored = decodeGame(JSON.stringify(saved))!;
    expect(restored).not.toBeNull();
    expect(restored.phase).toBe('gameover');
    expect(restored.resources).toEqual(saved.resources);
    expect(restored.remainingMs).toBe(remainingMs);
    expect(restored.board).toEqual(saved.board);
    expect(transition(restored, { type: 'TICK' }, 999999)).toEqual(restored);
  });
  it('still rejects gameover when lives remain', () => {
    const saved = gameoverSave();
    saved.resources.lives = 1;
    expect(decodeGame(JSON.stringify(saved))).toBeNull();
  });
  it.each([0, 63000])('still rejects an empty gameover board with %i ms', remainingMs => {
    const saved = gameoverSave();
    saved.board = saved.board.map(row => row.map(() => null));
    saved.moveIndex = 70;
    saved.remainingMs = remainingMs;
    expect(decodeGame(JSON.stringify(saved))).toBeNull();
  });
  it.each([0, 1, 63000])('requires timeout time to stay zero, not %i ms', remainingMs => {
    const saved = { ...gameoverSave(), phase: 'timeout', remainingMs, resources: { lives: 1, hints: 0, extensions: 2 } };
    const restored = decodeGame(JSON.stringify(saved));
    if (remainingMs === 0) {
      expect(restored?.phase).toBe('timeout');
      expect(restored?.remainingMs).toBe(0);
      expect(restored?.resources).toEqual(saved.resources);
    } else {
      expect(restored).toBeNull();
    }
  });
});

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
  it('preserves saved time above the current level budget', () => {
    const game = { ...transition(createGame(6), { type: 'RESUME' }, 100), remainingMs: 900000 };
    const restored = decodeGame(encodeGame(game)!)!;
    expect(restored.remainingMs).toBe(900000);
    expect(restored.remainingMs).toBeGreaterThan(levels[5].seconds * 1000);
    expect(restored.board).toEqual(game.board);
    expect(restored.resources).toEqual(game.resources);
    expect(restored.unlocked).toBe(game.unlocked);
    expect(restored.phase).toBe('paused');
    expect(transition(restored, { type: 'RESUME' }, 10000).remainingMs).toBe(900000);
  });
  it('does not reinterpret a broken modern save as a legacy board', () => {
    expect(decodeGame(JSON.stringify({ ...legacySave(), version: 2 }))).toBeNull();
    const modern = transition(createGame(), { type: 'RESUME' }, 0);
    const restored = decodeGame(encodeGame(modern)!)!;
    expect(restored.pauseReason).toBe('restored');
    expect(restored.board).toEqual(modern.board);
  });
});
