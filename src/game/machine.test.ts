import { describe, expect, it, vi } from 'vitest';
import { findMove, remainingPairs } from '../engine/board';
import { applyLayout } from '../engine/layouts';
import { levels } from '../engine/levels';
import type { Board } from '../engine/types';
import { createGame, MATCH_BONUS_MS, transition, type GameState } from './machine';
import { decodeGame, encodeGame, loadGame, saveGame, SAVE_KEY } from './storage';

const initialDurationMs = levels[0].seconds * 1000;
const playing = (mode: 'test' | 'normal' = 'normal') => transition(createGame(1, mode), { type: 'RESUME' }, 100);
const first = { row: 0, col: 0 };
const second = { row: 0, col: 1 };
const deadlockGame = (lives: number, mode: GameState['mode'] = 'normal'): GameState => ({
  ...playing(mode),
  board: [[2, 2], [0, 1], [1, 0]].map((row, r) => row.map((kind, c) => ({ id: r * 2 + c + 1, kind }))),
  resources: { lives, hints: 2, extensions: 1 },
  remainingMs: initialDurationMs - 10000,
});
const matchFirstPair = (game: GameState, now = 100) => game.mode === 'test'
  ? transition(game, { type: 'AUTO_PAIR' }, now)
  : transition(transition(game, { type: 'SELECT', point: first }, now), { type: 'SELECT', point: second }, now);
const finalPair = (game: GameState): GameState => {
  const board: Board = game.board.map(row => row.map(() => null));
  board[0][0] = { id: 1, kind: 0 };
  board[0][1] = { id: 2, kind: 0 };
  return { ...game, board, moveIndex: 69 };
};
const completeNormally = (state: GameState) => {
  const initialLives = state.resources.lives;
  let deadlocks = 0;
  let time = state.anchor ?? 100;
  while (state.phase === 'playing' && remainingPairs(state.board) > 0) {
    const move = findMove(state.board)!;
    expect(move).not.toBeNull();
    // Predict loss from the post-layout board, before the machine can shuffle it.
    const removed = state.board.map((row, r) => row.map((tile, c) =>
      (r === move.from.row && c === move.from.col) || (r === move.to.row && c === move.to.col) ? null : tile));
    const level = levels[state.levelId - 1];
    const shifted = applyLayout(removed, level.layouts[state.moveIndex % level.layouts.length]);
    const cleared = remainingPairs(shifted) === 0;
    if (!cleared && findMove(shifted) === null) deadlocks += 1;
    const expectedLives = initialLives - deadlocks + (cleared ? 1 : 0);
    const previousMoveIndex = state.moveIndex;
    state = transition(state, { type: 'SELECT', point: move.from }, time);
    state = transition(state, { type: 'SELECT', point: move.to }, time);
    expect(state.moveIndex).toBe(previousMoveIndex + 1);
    expect(state.resources.lives).toBe(expectedLives);
    expect(state.phase).toBe(cleared ? 'won' : expectedLives === 0 ? 'gameover' : 'playing');
    time += 400;
    state = transition(state, { type: 'TICK' }, time);
    expect(state.resources.lives).toBe(expectedLives);
  }
  return { game: state, deadlocks };
};

function tripleLayoutGame(): GameState {
  const game = createGame(3);
  const board: Board = game.board.map(row => row.map(() => null));
  // Removing kind 2 lets 'down' align three previously separated kind-0 tiles.
  const placements = [
    { row: 0, col: 0, kind: 2 }, { row: 0, col: 1, kind: 2 },
    { row: 1, col: 0, kind: 0 }, { row: 2, col: 1, kind: 0 },
    { row: 3, col: 2, kind: 0 }, { row: 4, col: 6, kind: 0 },
    { row: 5, col: 4, kind: 1 }, { row: 6, col: 5, kind: 1 },
  ];
  placements.forEach(({ row, col, kind }, index) => { board[row][col] = { id: index + 1, kind }; });
  return {
    ...game, board, phase: 'playing', anchor: 100, moveIndex: 66, remainingMs: 60000,
    resources: { lives: 1, hints: 2, extensions: 1 },
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('计时与资源', () => {
  it('starts with 5 / 3 / 3 and an explicit introduction pause', () => {
    const game = createGame();
    expect(game.resources).toEqual({ lives: 5, hints: 3, extensions: 3 });
    expect(game.phase).toBe('paused');
    expect(game.note).toBe('点一下，再点相同的图案。');
    expect(game.matchFeedback).toBeNull();
    expect(transition(game, { type: 'TICK' }, 99999).remainingMs).toBe(initialDurationMs);
  });
  it.each(levels.map(level => level.id))('does not charge for initial generation or resume on level %i', id => {
    for (const mode of ['normal', 'test'] as const) {
      const game = createGame(id, mode);
      expect(game.resources).toEqual({ lives: 5, hints: 3, extensions: 3 });
      expect(findMove(game.board)).not.toBeNull();
      expect(transition(game, { type: 'TICK' }, 999999).resources).toEqual(game.resources);
      const resumed = transition(game, { type: 'RESUME' }, 1000000);
      expect(resumed.resources).toEqual(game.resources);
      expect(resumed.moveIndex).toBe(0);
      expect(resumed.board).toEqual(game.board);
    }
  });
  it('uses elapsed time instead of counting timer callbacks', () => {
    expect(transition(playing(), { type: 'TICK' }, 2600).remainingMs).toBe(initialDurationMs - 2500);
  });
  it('settles elapsed time before filling only the missing time for a match', () => {
    const game = playing();
    const move = findMove(game.board)!;
    const selected = transition(game, { type: 'SELECT', point: move.from }, 1100);
    expect(selected.remainingMs).toBe(initialDurationMs - 1000);
    const matched = transition(selected, { type: 'SELECT', point: move.to }, 2600);
    expect(MATCH_BONUS_MS).toBe(3000);
    expect(matched.remainingMs).toBe(initialDurationMs);
    expect(matched.matchFeedback).toEqual({ addedMs: 2500, until: 5600 });
    expect(matched.anchor).toBe(2600);
    expect(matched.moveIndex).toBe(1);
    expect(matched.resources).toEqual(game.resources);
    expect(matched.note).toContain('消除一对');
    expect(matched.note).not.toContain('时间 +3秒');
    const extended = transition(matched, { type: 'EXTEND' }, 3100);
    expect(extended.remainingMs).toBe(matched.remainingMs - 500 + 30000);
    expect(extended.resources.extensions).toBe(2);
  });
  it.each([
    { missingMs: 0, addedMs: 0 },
    { missingMs: 1000, addedMs: 1000 },
    { missingMs: 3000, addedMs: 3000 },
    { missingMs: 10000, addedMs: 3000 },
    { missingMs: -30000, addedMs: 0 },
  ])('caps the match bonus at $addedMs ms with $missingMs ms missing', ({ missingMs, addedMs }) => {
    const game = { ...playing(), remainingMs: initialDurationMs - missingMs };
    const move = findMove(game.board)!;
    const selected = transition(game, { type: 'SELECT', point: move.from }, 100);
    const matched = transition(selected, { type: 'SELECT', point: move.to }, 100);
    expect(matched.remainingMs).toBe(game.remainingMs + addedMs);
    expect(matched.matchFeedback).toEqual({ addedMs, until: 3100 });
    expect(matched.moveIndex).toBe(1);
  });
  it('does not truncate manually extended time or add a match bonus above the budget', () => {
    const extended = transition(playing(), { type: 'EXTEND' }, 100);
    const move = findMove(extended.board)!;
    const selected = transition(extended, { type: 'SELECT', point: move.from }, 1100);
    const matched = transition(selected, { type: 'SELECT', point: move.to }, 1600);
    expect(matched.remainingMs).toBe(initialDurationMs + 30000 - 1500);
    expect(matched.matchFeedback).toEqual({ addedMs: 0, until: 4600 });
    expect(matched.resources.extensions).toBe(2);
  });
  it('pauses without charging time away and resumes with a new anchor', () => {
    let game = transition(playing(), { type: 'PAUSE', reason: 'away' }, 1100);
    expect(game.remainingMs).toBe(initialDurationMs - 1000);
    game = transition(game, { type: 'TICK' }, 999999);
    expect(game.remainingMs).toBe(initialDurationMs - 1000);
    game = transition(game, { type: 'RESUME' }, 1000000);
    expect(transition(game, { type: 'TICK' }, 1001000).remainingMs).toBe(initialDurationMs - 2000);
  });
  it('only deducts one life on timeout and does not spend extensions', () => {
    let game = transition({ ...playing(), remainingMs: 1000 }, { type: 'TICK' }, 2100);
    expect(game.phase).toBe('timeout');
    expect(game.remainingMs).toBe(0);
    expect(game.resources).toEqual({ lives: 4, hints: 3, extensions: 3 });
    game = transition(game, { type: 'TICK' }, 4000);
    expect(game.resources.lives).toBe(4);
    game = transition(game, { type: 'CONTINUE' }, 5000);
    expect(game.remainingMs).toBe(60000);
    expect(game.phase).toBe('playing');
  });
  it('zero lives allows restarting with base resources while keeping unlocks', () => {
    let game = { ...playing(), remainingMs: 1000, unlocked: 8, resources: { lives: 1, hints: 0, extensions: 0 } };
    game = transition(game, { type: 'TICK' }, 1100);
    expect(game.phase).toBe('gameover');
    expect(game.remainingMs).toBe(0);
    expect(transition(game, { type: 'CONTINUE' }, 1200).phase).toBe('gameover');
    game = transition(game, { type: 'RETRY' }, 2000);
    expect(game.resources).toEqual({ lives: 5, hints: 3, extensions: 3 });
    expect(game.remainingMs).toBe(initialDurationMs);
    expect(game.unlocked).toBe(8);
    expect(game.phase).toBe('paused');
  });
  it('adds 30 seconds and spends exactly one extension', () => {
    const game = transition(playing(), { type: 'EXTEND' }, 1100);
    expect(game.remainingMs).toBe(initialDurationMs + 30000 - 1000);
    expect(game.resources.extensions).toBe(2);
  });
  it('cannot use exhausted or paused items', () => {
    let game = { ...playing(), resources: { lives: 5, hints: 0, extensions: 0 } };
    game = transition(game, { type: 'EXTEND' }, 100);
    expect(game.remainingMs).toBe(initialDurationMs);
    expect(transition(game, { type: 'HINT' }, 100).hint).toBeNull();
    const paused = createGame();
    expect(transition(paused, { type: 'HINT' }, 100).resources.hints).toBe(3);
  });
  it('valid hints spend one item and expire without affecting moves', () => {
    const game = transition(playing(), { type: 'HINT' }, 100);
    expect(game.hint).not.toBeNull();
    expect(game.resources.hints).toBe(2);
    expect(game.moveIndex).toBe(0);
    expect(game.remainingMs).toBe(initialDurationMs);
    const expired = transition(game, { type: 'TICK' }, 4700);
    expect(expired.hint).toBeNull();
    expect(expired.remainingMs).toBe(initialDurationMs - 4600);
  });
  it('does not spend another hint while the current hint is visible', () => {
    const hinted = transition(playing(), { type: 'HINT' }, 100);
    const repeated = transition(hinted, { type: 'HINT' }, 110);
    expect(repeated.resources.hints).toBe(2);
    expect(repeated.hint).toEqual(hinted.hint);
  });
  it('wrong pairs and same-cell clicks cost no lives and only settle elapsed time', () => {
    let game = playing();
    const board = game.board;
    const from = { row: 0, col: 0 };
    const different = game.board.flatMap((row, r) => row.map((tile, c) => ({ tile, point: { row: r, col: c } }))).find(item => item.tile!.kind !== game.board[0][0]!.kind)!;
    game = transition(game, { type: 'SELECT', point: from }, 600);
    expect(game.remainingMs).toBe(initialDurationMs - 500);
    game = transition(game, { type: 'SELECT', point: from }, 700);
    expect(game.selected).toBeNull();
    expect(game.remainingMs).toBe(initialDurationMs - 600);
    game = transition(game, { type: 'SELECT', point: from }, 1100);
    game = transition(game, { type: 'SELECT', point: different.point }, 1600);
    expect(game.resources.lives).toBe(5);
    expect(game.moveIndex).toBe(0);
    expect(game.board).toEqual(board);
    expect(game.remainingMs).toBe(initialDurationMs - 1500);
    expect(game.matchFeedback).toBeNull();
  });
});

describe('消除后的死局扣命', () => {
  const cases = (['normal', 'test'] as const).flatMap(mode => [2, 1].flatMap(lives =>
    [0, 1000, 10000, -30000].map(missingMs => ({ mode, lives, missingMs }))));
  it.each(cases)('$mode with $lives lives and $missingMs ms missing loses exactly one life and keeps the capped bonus', ({ mode, lives, missingMs }) => {
    const before = deadlockGame(lives, mode);
    const deadBoard = before.board.map((row, r) => row.map(tile => r === 0 ? null : tile));
    expect(findMove(deadBoard)).toBeNull();
    expect(remainingPairs(deadBoard)).toBe(2);
    const game: GameState = {
      ...before, remainingMs: initialDurationMs - missingMs,
      hint: findMove(before.board), hintUntil: 10000,
      matchFeedback: { addedMs: 500, until: 10000 },
    };
    const selected = mode === 'normal' ? transition(game, { type: 'SELECT', point: first }, 600) : game;
    const matched = transition(selected, mode === 'normal' ? { type: 'SELECT', point: second } : { type: 'AUTO_PAIR' }, 1100);
    const settledMs = game.remainingMs - (mode === 'normal' ? 1000 : 0);
    const addedMs = Math.min(MATCH_BONUS_MS, Math.max(0, initialDurationMs - settledMs));
    expect(matched.remainingMs).toBe(settledMs + addedMs);
    expect(matched.moveIndex).toBe(game.moveIndex + 1);
    expect(matched.resources).toEqual({ lives: lives - 1, hints: 2, extensions: 1 });
    expect(matched.unlocked).toBe(game.unlocked);
    expect(matched.selected).toBeNull();
    expect(matched.hint).toBeNull();
    expect(matched.note).toContain('生命');
    expect(matched.note).not.toContain('免费');
    expect(matched.frozen).toBe(mode === 'test');
    expect(matched.unlimited).toBe(mode === 'test');
    if (lives === 2) {
      expect(matched.phase).toBe('playing');
      expect(matched.anchor).toBe(1100);
      expect(matched.note).toContain('重新排列');
      expect(matched.matchFeedback).toEqual({ addedMs, until: 4100 });
      expect(matched.animation?.board).toEqual(before.board);
      expect(findMove(matched.board)).not.toBeNull();
      expect(matched.board).not.toEqual(deadBoard);
      expect(matched.board.flat().filter(tile => tile !== null).sort((a, b) => a.id - b.id))
        .toEqual(deadBoard.flat().filter(tile => tile !== null).sort((a, b) => a.id - b.id));
      expect(matched.board.map(row => row.map(tile => tile === null))).toEqual(deadBoard.map(row => row.map(tile => tile === null)));
    } else {
      expect(matched.phase).toBe('gameover');
      expect(matched.anchor).toBeNull();
      expect(matched.animation).toBeNull();
      expect(matched.matchFeedback).toBeNull();
      expect(matched.note).toContain('用完');
      expect(matched.board).toEqual(deadBoard);
      expect(findMove(matched.board)).toBeNull();
      for (const action of [
        { type: 'SELECT', point: second }, { type: 'AUTO_PAIR' }, { type: 'TICK' },
        { type: 'RESUME' }, { type: 'CONTINUE' }, { type: 'PAUSE' },
        { type: 'HINT' }, { type: 'EXTEND' }, { type: 'COMPLETE' }, { type: 'EXPIRE' },
      ] as const) {
        expect(transition(matched, action, 999999)).toEqual(matched);
      }
      const retried = transition(matched, { type: 'RETRY' }, 1000000);
      expect(retried.resources).toEqual({ lives: 5, hints: 3, extensions: 3 });
      expect(retried.unlocked).toBe(matched.unlocked);
      expect(retried.remainingMs).toBe(initialDurationMs);
      expect(retried.phase).toBe('paused');
      expect(retried.moveIndex).toBe(0);
      expect(remainingPairs(retried.board)).toBe(70);
    }
  });
  it.each([
    { levelId: 4, kinds: [[2, 2], [0, null], [1, 1], [null, 0]], losesLife: true },
    { levelId: 5, kinds: [[2, 2], [0, 1], [1, 0], [null, null]], losesLife: false },
  ])('evaluates deadlock after level $levelId layout, not before it', ({ levelId, kinds, losesLife }) => {
    const board = kinds.map((row, r) => row.map((kind, c) => kind === null ? null : { id: r * 2 + c + 1, kind }));
    const before = { ...deadlockGame(1), levelId, unlocked: levelId, board, remainingMs: 60000 };
    const removed = board.map((row, r) => row.map(tile => r === 0 ? null : tile));
    const shifted = applyLayout(removed, levels[levelId - 1].layouts[0]);
    expect(findMove(removed) === null).toBe(!losesLife);
    expect(findMove(shifted) === null).toBe(losesLife);
    const matched = matchFirstPair(before);
    expect(matched.resources).toEqual({ ...before.resources, lives: losesLife ? 0 : 1 });
    expect(matched.phase).toBe(losesLife ? 'gameover' : 'playing');
    expect(matched.board).toEqual(shifted);
    expect(matched.moveIndex).toBe(1);
    expect(matched.remainingMs).toBe(60000 + MATCH_BONUS_MS);
  });
  it.each(['normal', 'test'] as const)('does not charge again for duplicate inputs, ticks or pause/resume in %s mode', mode => {
    const matched = matchFirstPair(deadlockGame(2, mode));
    expect(matched.resources.lives).toBe(1);
    let game = matched;
    for (const [now, action] of [
      [101, { type: 'SELECT', point: first }],
      [102, { type: 'SELECT', point: second }],
      [103, { type: 'AUTO_PAIR' }],
      [200, { type: 'TICK' }],
      [500, { type: 'TICK' }],
    ] as const) {
      game = transition(game, action, now);
      expect(game.resources).toEqual(matched.resources);
      expect(game.board).toEqual(matched.board);
      expect(game.moveIndex).toBe(1);
      expect(game.phase).toBe('playing');
    }
    expect(game.animation).toBeNull();
    expect(game.remainingMs).toBe(matched.remainingMs - (mode === 'normal' ? 400 : 0));
    const paused = transition(game, { type: 'PAUSE' }, 600);
    expect(paused.phase).toBe('paused');
    expect(paused.matchFeedback).toBeNull();
    expect(transition(paused, { type: 'TICK' }, 999999)).toEqual(paused);
    const resumed = transition(paused, { type: 'RESUME' }, 1000000);
    expect(resumed.phase).toBe('playing');
    expect(resumed.anchor).toBe(1000000);
    expect(resumed.remainingMs).toBe(paused.remainingMs);
    const later = transition(resumed, { type: 'TICK' }, 1000100);
    expect(later.remainingMs).toBe(paused.remainingMs - (mode === 'normal' ? 100 : 0));
    expect(later.resources).toEqual(matched.resources);
    expect(later.board).toEqual(matched.board);
    expect(later.moveIndex).toBe(1);
  });
  it('does not charge a life for an unconnectable same-kind pair even on a dead board', () => {
    const before = deadlockGame(2);
    const game = { ...before, board: before.board.map((row, r) => row.map(tile => r === 0 ? null : tile)) };
    expect(findMove(game.board)).toBeNull();
    const selected = transition(game, { type: 'SELECT', point: { row: 1, col: 0 } }, 100);
    const rejected = transition(selected, { type: 'SELECT', point: { row: 2, col: 1 } }, 200);
    expect(rejected.phase).toBe('playing');
    expect(rejected.resources).toEqual(game.resources);
    expect(rejected.board).toEqual(game.board);
    expect(rejected.moveIndex).toBe(0);
    expect(rejected.remainingMs).toBe(game.remainingMs - 100);
    expect(rejected.animation).toBeNull();
    expect(rejected.matchFeedback).toBeNull();
  });
  it.each([1, 2])('awards the bonus for a deadlock match one millisecond before timeout with %i lives', lives => {
    for (const mode of ['normal', 'test'] as const) {
      const before = { ...deadlockGame(lives, mode), frozen: false, remainingMs: 1000, selected: first };
      const matched = transition(before, mode === 'normal' ? { type: 'SELECT', point: second } : { type: 'AUTO_PAIR' }, 1099);
      expect(matched.phase).toBe(lives === 1 ? 'gameover' : 'playing');
      expect(matched.resources).toEqual({ ...before.resources, lives: lives - 1 });
      expect(matched.remainingMs).toBe(1 + MATCH_BONUS_MS);
      expect(matched.moveIndex).toBe(1);
      expect(remainingPairs(matched.board)).toBe(2);
      const ticked = transition(matched, { type: 'TICK' }, 1100);
      expect(ticked.resources).toEqual(matched.resources);
      expect(ticked.phase).toBe(matched.phase);
      expect(ticked.remainingMs).toBe(matched.remainingMs - (lives === 1 ? 0 : 1));
    }
  });
  it.each([1, 2])('checks timeout before a would-be deadlock match with %i lives', lives => {
    for (const mode of ['normal', 'test'] as const) {
      const game = { ...deadlockGame(lives, mode), frozen: false, remainingMs: 1000, selected: first };
      const action = mode === 'normal' ? { type: 'SELECT' as const, point: second } : { type: 'AUTO_PAIR' as const };
      let expired = transition(game, action, 1100);
      expect(expired.phase).toBe(lives === 1 ? 'gameover' : 'timeout');
      expect(expired.remainingMs).toBe(0);
      expect(expired.resources).toEqual({ ...game.resources, lives: lives - 1 });
      expect(expired.board).toEqual(game.board);
      expect(expired.moveIndex).toBe(0);
      expect(expired.animation).toBeNull();
      expect(expired.matchFeedback).toBeNull();
      for (const repeated of [action, { type: 'TICK' }, { type: 'EXTEND' }, { type: 'EXPIRE' }] as const) {
        expired = transition(expired, repeated, 2000);
        expect(expired.resources.lives).toBe(lives - 1);
        expect(expired.remainingMs).toBe(0);
        expect(expired.board).toEqual(game.board);
        expect(expired.moveIndex).toBe(0);
      }
    }
  });
});

describe('结算、变形和竞态', () => {
  it('正常消除后的下落形成同类三连但仍有解时，精确保留布局而不重排或扣命', () => {
    const before = tripleLayoutGame();
    const removed = before.board.map((row, r) => row.map((tile, c) => r === 0 && c < 2 ? null : tile));
    const shifted = applyLayout(removed, levels[before.levelId - 1].layouts[0]);
    expect(shifted.slice(0, 9).flat().every(tile => tile === null)).toBe(true);
    expect(shifted[9].map(tile => tile?.id ?? null)).toEqual([
      3, 4, 5, null, 7, 8, 6, null, null, null, null, null, null, null,
    ]);
    expect(shifted[9].slice(0, 3).map(tile => tile!.kind)).toEqual([0, 0, 0]);
    expect(findMove(shifted)).not.toBeNull();
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const matched = matchFirstPair(before);
      expect(matched.board).toEqual(shifted);
      matched.board.forEach((row, r) => row.forEach((tile, c) => expect(tile).toBe(shifted[r][c])));
      expect(matched.phase).toBe('playing');
      expect(matched.moveIndex).toBe(67);
      expect(matched.resources).toEqual(before.resources);
      expect(remainingPairs(matched.board)).toBe(3);
      expect(matched.note).not.toContain('重新排列');
      expect(matched.animation?.board).toBe(before.board);
      expect(transition(matched, { type: 'TICK' }, 500).board).toBe(matched.board);
      expect(rng).not.toHaveBeenCalled();
      expect(before.board[0].slice(0, 2).map(tile => tile!.id)).toEqual([1, 2]);
    } finally {
      rng.mockRestore();
    }
  });
  it.each(levels.map(level => level.id))('completes level %i through 70 real matches and gives one reward', id => {
    const started = transition(createGame(id, 'normal', 0, id, { lives: 70, hints: 3, extensions: 3 }), { type: 'RESUME' }, 100);
    expect(started.board.flat()).toHaveLength(140);
    expect(remainingPairs(started.board)).toBe(70);
    const { game: won, deadlocks } = completeNormally(started);
    expect(won.phase).toBe('won');
    expect(remainingPairs(won.board)).toBe(0);
    expect(won.resources).toEqual({ lives: started.resources.lives - deadlocks + 1, hints: 5, extensions: 4 });
    expect(won.moveIndex).toBe(levels[id - 1].rows * levels[id - 1].cols / 2);
    expect(won.moveIndex).toBe(70);
    expect(won.remainingMs).toBe(levels[id - 1].seconds * 1000);
    expect(won.matchFeedback?.addedMs).toBe(400);
    expect(transition(won, { type: 'COMPLETE' }, 99999).resources).toEqual(won.resources);
    expect(transition(won, { type: 'TICK' }, 999999).resources).toEqual(won.resources);
  });
  it('carries resources to the next level', () => {
    const next = transition(matchFirstPair(finalPair(playing())), { type: 'NEXT' }, 30000);
    expect(next.levelId).toBe(2);
    expect(next.resources).toEqual({ lives: 6, hints: 5, extensions: 4 });
    expect(next.phase).toBe('paused');
  });
  it('commits a match before its animation and blocks duplicated input', () => {
    const game = playing();
    const move = findMove(game.board)!;
    const selected = transition(game, { type: 'SELECT', point: move.from }, 100);
    const matched = transition(selected, { type: 'SELECT', point: move.to }, 100);
    expect(remainingPairs(matched.board)).toBe(69);
    expect(matched.animation).not.toBeNull();
    expect(matched.remainingMs).toBe(initialDurationMs);
    expect(matched.matchFeedback).toEqual({ addedMs: 0, until: 3100 });
    const repeated = transition(matched, { type: 'SELECT', point: move.to }, 101);
    expect(repeated.matchFeedback).toBe(matched.matchFeedback);
    expect(repeated.moveIndex).toBe(1);
    expect(repeated.remainingMs).toBe(matched.remainingMs - 1);
    const animating = transition(repeated, { type: 'TICK' }, 200);
    expect(animating.animation).not.toBeNull();
    expect(animating.remainingMs).toBe(matched.remainingMs - 100);
    const settled = transition(animating, { type: 'TICK' }, 500);
    expect(settled.animation).toBeNull();
    expect(settled.moveIndex).toBe(1);
    expect(settled.remainingMs).toBe(matched.remainingMs - 400);
    const emptyClick = transition(settled, { type: 'SELECT', point: move.to }, 600);
    expect(emptyClick.selected).toBeNull();
    expect(emptyClick.moveIndex).toBe(1);
    expect(emptyClick.remainingMs).toBe(matched.remainingMs - 500);
    expect(emptyClick.matchFeedback).toBe(matched.matchFeedback);
    const paused = transition(matched, { type: 'PAUSE', reason: 'away' }, 110);
    expect(paused.animation).toBeNull();
    expect(paused.matchFeedback).toBeNull();
    expect(transition(paused, { type: 'TICK' }, 10000).phase).toBe('paused');
    expect(remainingPairs(paused.board)).toBe(69);
  });
  it.each(['normal', 'test'] as const)('charges each predicted deadlock during a complete %s game', mode => {
    const game = deadlockGame(70, mode);
    const { game: won, deadlocks } = completeNormally(game);
    expect(deadlocks).toBe(1);
    expect(won.phase).toBe('won');
    expect(won.resources).toEqual({ lives: 70 - deadlocks + 1, hints: 4, extensions: 2 });
  });
  it('stops the completion loop at gameover instead of seeking another move', () => {
    const { game, deadlocks } = completeNormally(deadlockGame(1));
    expect(deadlocks).toBe(1);
    expect(game.phase).toBe('gameover');
    expect(game.resources.lives).toBe(0);
    expect(remainingPairs(game.board)).toBe(2);
    expect(game.moveIndex).toBe(1);
  });
  it.each(['SELECT', 'AUTO_PAIR'] as const)('does not resurrect a final pair attempted via %s at the timeout boundary', type => {
    const game: GameState = {
      ...playing(type === 'AUTO_PAIR' ? 'test' : 'normal'), frozen: false, remainingMs: 1000,
      board: [[{ id: 1, kind: 0 }, { id: 2, kind: 0 }]], selected: { row: 0, col: 0 },
    };
    const expired = transition(game, type === 'SELECT' ? { type, point: { row: 0, col: 1 } } : { type }, 1100);
    expect(expired.phase).toBe('timeout');
    expect(expired.remainingMs).toBe(0);
    expect(expired.moveIndex).toBe(0);
    expect(expired.board).toEqual(game.board);
    expect(expired.resources).toEqual({ lives: 4, hints: 3, extensions: 3 });
    expect(expired.animation).toBeNull();
    expect(expired.matchFeedback).toBeNull();
  });
  it('timeout wins over a click or extension arriving exactly at zero', () => {
    const game = { ...playing(), remainingMs: 1000 };
    const beforeDeadline = transition(game, { type: 'TICK' }, 1099);
    expect(beforeDeadline.phase).toBe('playing');
    expect(beforeDeadline.remainingMs).toBe(1);
    const extended = transition(game, { type: 'EXTEND' }, 1100);
    expect(extended.phase).toBe('timeout');
    expect(extended.remainingMs).toBe(0);
    expect(extended.resources.extensions).toBe(3);
    const clicked = transition(game, { type: 'SELECT', point: { row: 0, col: 0 } }, 1100);
    expect(clicked.phase).toBe('timeout');
    expect(clicked.remainingMs).toBe(0);
    expect(clicked.selected).toBeNull();
  });
  it.each([1, 2])('a final match with %i lives wins without a deadlock deduction just before the deadline', lives => {
    const before = finalPair({ ...playing(), remainingMs: 1, resources: { lives, hints: 0, extensions: 0 } });
    const game = matchFirstPair(before);
    expect(game.phase).toBe('won');
    expect(remainingPairs(game.board)).toBe(0);
    expect(findMove(game.board)).toBeNull();
    expect(game.resources).toEqual({ lives: lives + 1, hints: 2, extensions: 1 });
    expect(game.unlocked).toBe(2);
    expect(game.remainingMs).toBe(1 + MATCH_BONUS_MS);
    expect(game.moveIndex).toBe(70);
    expect(game.note).toBe('真棒，这一关完成了！');
    expect(game.matchFeedback).toEqual({ addedMs: MATCH_BONUS_MS, until: 3100 });
    const later = transition(game, { type: 'TICK' }, 3099);
    expect(later.matchFeedback).toBe(game.matchFeedback);
    expect(later.resources.lives).toBe(lives + 1);
    expect(later.remainingMs).toBe(game.remainingMs);
    const expired = transition(later, { type: 'TICK' }, 3100);
    expect(expired.phase).toBe('won');
    expect(expired.matchFeedback).toBeNull();
    expect(expired.remainingMs).toBe(game.remainingMs);
    expect(expired.resources).toEqual(game.resources);
  });
});

describe('短暂配对反馈', () => {
  it.each([true, false])('expires exactly after 3000ms without clicks or items refreshing it (frozen=%s)', frozen => {
    const matched = transition({ ...playing('test'), frozen }, { type: 'AUTO_PAIR' }, 100);
    const from = findMove(matched.board)!.from;
    const kind = matched.board[from.row][from.col]!.kind;
    const different = matched.board.flatMap((row, r) => row.map((tile, c) => ({ tile, point: { row: r, col: c } })))
      .find(item => item.tile && item.tile.kind !== kind)!.point;
    let game = matched;
    const inputs = [
      [500, { type: 'TICK' }],
      [600, { type: 'HINT' }],
      [700, { type: 'EXTEND' }],
      [800, { type: 'SELECT', point: from }],
      [900, { type: 'SELECT', point: from }],
      [1000, { type: 'SELECT', point: from }],
      [1100, { type: 'SELECT', point: different }],
    ] as const;
    for (const [now, action] of inputs) {
      game = transition(game, action, now);
      expect(game.moveIndex).toBe(1);
      expect(game.matchFeedback).toBe(matched.matchFeedback);
    }
    game = transition(game, { type: 'TICK' }, 3099);
    expect(game.matchFeedback).toEqual({ addedMs: 0, until: 3100 });
    game = transition(game, { type: 'TICK' }, 3100);
    expect(game.matchFeedback).toBeNull();
    expect(transition(game, { type: 'TICK' }, 4000).matchFeedback).toBeNull();
  });
  it('refreshes feedback and its move index on the next successful match even at full time', () => {
    const first = transition(playing('test'), { type: 'AUTO_PAIR' }, 100);
    const second = transition(first, { type: 'AUTO_PAIR' }, 500);
    expect(second.moveIndex).toBe(first.moveIndex + 1);
    expect(second.remainingMs).toBe(initialDurationMs);
    expect(second.matchFeedback).not.toBe(first.matchFeedback);
    expect(second.matchFeedback).toEqual({ addedMs: 0, until: 3500 });
    expect(transition(second, { type: 'TICK' }, 3100).matchFeedback).toBe(second.matchFeedback);
    expect(transition(second, { type: 'TICK' }, 3500).matchFeedback).toBeNull();
  });
  it.each(['manual', 'away'] as const)('clears feedback on a %s pause and does not restore it on resume', reason => {
    const matched = transition(playing('test'), { type: 'AUTO_PAIR' }, 100);
    const paused = transition(matched, { type: 'PAUSE', reason }, 200);
    expect(paused.matchFeedback).toBeNull();
    expect(transition(paused, { type: 'RESUME' }, 300).matchFeedback).toBeNull();
  });
  it.each([1, 2])('clears feedback when time expires with %i lives left', lives => {
    const matched = transition(playing('test'), { type: 'AUTO_PAIR' }, 100);
    const game = { ...matched, frozen: false, remainingMs: 100, resources: { ...matched.resources, lives } };
    const expired = transition(game, { type: 'TICK' }, 200);
    expect(expired.phase).toBe(lives === 1 ? 'gameover' : 'timeout');
    expect(expired.matchFeedback).toBeNull();
    expect(expired.remainingMs).toBe(0);
  });
});

describe('独立测试模式', () => {
  it('rejects all testing events in a normal game', () => {
    const game = playing();
    for (const type of ['AUTO_PAIR', 'COMPLETE', 'EXPIRE'] as const) expect(transition(game, { type }, 100)).toEqual(game);
    expect(transition(game, { type: 'FREEZE', value: true }, 100).frozen).toBe(false);
    expect(transition(game, { type: 'UNLIMITED', value: true }, 100).unlimited).toBe(false);
  });
  it('unlocks all levels and freezes time without giving infinite lives', () => {
    let game = playing('test');
    expect(game.unlocked).toBe(12);
    expect(transition(game, { type: 'TICK' }, initialDurationMs + 100).remainingMs).toBe(initialDurationMs);
    game = transition(game, { type: 'EXPIRE' }, initialDurationMs + 100);
    expect(game.phase).toBe('timeout');
    expect(game.resources.lives).toBe(4);
  });
  it('freeze toggle does not retroactively charge frozen time', () => {
    const thawAt = initialDurationMs + 100;
    let game = transition(playing('test'), { type: 'FREEZE', value: false }, thawAt);
    expect(game.remainingMs).toBe(initialDurationMs);
    game = transition(game, { type: 'TICK' }, thawAt + 1000);
    expect(game.remainingMs).toBe(initialDurationMs - 1000);
    game = transition(game, { type: 'FREEZE', value: true }, thawAt + 2000);
    expect(game.remainingMs).toBe(initialDurationMs - 2000);
    expect(transition(game, { type: 'TICK' }, thawAt + 99000).remainingMs).toBe(initialDurationMs - 2000);
  });
  it.each([0, 1000, 10000])('caps frozen AUTO_PAIR bonuses with %i ms missing, including the final pair', missingMs => {
    const board = [[0, 0, 1, 1]].map(row => row.map((kind, col) => ({ id: col + 1, kind })));
    const game: GameState = { ...playing('test'), board, remainingMs: initialDurationMs - missingMs };
    const addedMs = Math.min(MATCH_BONUS_MS, missingMs);
    const matched = transition(game, { type: 'AUTO_PAIR' }, 10000);
    expect(matched.remainingMs).toBe(game.remainingMs + addedMs);
    expect(matched.matchFeedback).toEqual({ addedMs, until: 13000 });
    expect(matched.moveIndex).toBe(1);
    const repeated = transition(matched, { type: 'AUTO_PAIR' }, 10001);
    expect(repeated.remainingMs).toBe(matched.remainingMs);
    expect(repeated.matchFeedback).toBe(matched.matchFeedback);
    expect(repeated.moveIndex).toBe(1);
    const settled = transition(repeated, { type: 'TICK' }, 10400);
    expect(settled.remainingMs).toBe(matched.remainingMs);
    expect(settled.matchFeedback).toBe(matched.matchFeedback);
    const finalAddedMs = Math.min(MATCH_BONUS_MS, missingMs - addedMs);
    const won = transition(settled, { type: 'AUTO_PAIR' }, 20000);
    expect(won.phase).toBe('won');
    expect(won.moveIndex).toBe(2);
    expect(won.remainingMs).toBe(matched.remainingMs + finalAddedMs);
    expect(won.matchFeedback).toEqual({ addedMs: finalAddedMs, until: 23000 });
    expect(won.note).toBe('真棒，这一关完成了！');
    expect(transition(won, { type: 'AUTO_PAIR' }, 21000)).toEqual(won);
    expect(transition(won, { type: 'TICK' }, 23000).matchFeedback).toBeNull();
  });
  it.each([true, false])('test COMPLETE grants no match bonus with frozen=%s', frozen => {
    const game = { ...playing('test'), frozen };
    const completed = transition(game, { type: 'COMPLETE' }, 1100);
    expect(completed.phase).toBe('won');
    expect(completed.remainingMs).toBe(initialDurationMs - (frozen ? 0 : 1000));
    expect(completed.note).not.toContain('时间 +3秒');
    expect(completed.matchFeedback).toBeNull();
  });
  it('COMPLETE clears feedback even during a real match animation without another bonus', () => {
    const matched = transition({ ...playing('test'), remainingMs: initialDurationMs - 10000 }, { type: 'AUTO_PAIR' }, 100);
    expect(matched.matchFeedback).toEqual({ addedMs: MATCH_BONUS_MS, until: 3100 });
    expect(matched.animation).not.toBeNull();
    const completed = transition(matched, { type: 'COMPLETE' }, 101);
    expect(completed.phase).toBe('won');
    expect(completed.remainingMs).toBe(matched.remainingMs);
    expect(completed.matchFeedback).toBeNull();
    expect(completed.animation).toBeNull();
    expect(completed.note).toBe('真棒，这一关完成了！');
    expect(transition(completed, { type: 'COMPLETE' }, 102).resources).toEqual(completed.resources);
  });
  it('can disable unlimited items and uses the shared match and settlement flow', () => {
    let game = transition(playing('test'), { type: 'HINT' }, 100);
    expect(game.resources.hints).toBe(3);
    game = transition(game, { type: 'TICK' }, 4700);
    game = transition(game, { type: 'UNLIMITED', value: false }, 4700);
    game = transition(game, { type: 'HINT' }, 4700);
    expect(game.resources.hints).toBe(2);
    game = transition(game, { type: 'AUTO_PAIR' }, 4700);
    expect(game.moveIndex).toBe(1);
    expect(game.remainingMs).toBe(initialDurationMs);
    expect(game.animation?.path.length).toBeGreaterThanOrEqual(2);
    game = transition(game, { type: 'COMPLETE' }, 5100);
    expect(game.phase).toBe('won');
    expect(game.remainingMs).toBe(initialDurationMs);
    expect(game.resources).toEqual({ lives: 6, hints: 4, extensions: 4 });
    expect(transition(game, { type: 'COMPLETE' }, 5101).resources).toEqual(game.resources);
  });
});

describe('存档边界', () => {
  it('当前版本存档的同类三连、空格和 ID 在读取及恢复游玩时保持原位', () => {
    const matched = matchFirstPair(tripleLayoutGame());
    expect(matched.board[9].slice(0, 3).map(tile => tile!.kind)).toEqual([0, 0, 0]);
    const storage = memoryStorage();
    expect(saveGame(storage, matched)).toBe(true);
    const raw = storage.values.get(SAVE_KEY)!;
    expect(JSON.parse(raw).version).toBe(2);
    expect(JSON.parse(raw).board).toEqual(matched.board);
    const loaded = loadGame(storage);
    expect(loaded.warning).toBe('');
    expect(loaded.game).not.toBeNull();
    const restored = loaded.game!;
    expect(restored.phase).toBe('paused');
    expect(restored.pauseReason).toBe('restored');
    expect(restored.board).toEqual(matched.board);
    expect(restored.moveIndex).toBe(67);
    expect(restored.remainingMs).toBe(matched.remainingMs);
    expect(restored.resources).toEqual(matched.resources);
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const resumed = transition(restored, { type: 'RESUME' }, 10000);
      expect(resumed.phase).toBe('playing');
      expect(resumed.board).toBe(restored.board);
      expect(resumed.board).toEqual(matched.board);
      expect(resumed.resources).toEqual(matched.resources);
      expect(resumed.moveIndex).toBe(matched.moveIndex);
      expect(findMove(resumed.board)).not.toBeNull();
      expect(rng).not.toHaveBeenCalled();
    } finally {
      rng.mockRestore();
    }
    expect(storage.values.get(SAVE_KEY)).toBe(raw);
  });
  it('restores active play paused and strips transient animation / selection', () => {
    const game = transition(playing(), { type: 'SELECT', point: { row: 0, col: 0 } }, 1100);
    const restored = decodeGame(encodeGame(game)!)!;
    expect(restored.phase).toBe('paused');
    expect(restored.pauseReason).toBe('restored');
    expect(restored.anchor).toBeNull();
    expect(restored.selected).toBeNull();
    expect(restored.animation).toBeNull();
    expect(restored.matchFeedback).toBeNull();
    expect(restored.board).toEqual(game.board);
    expect(restored.remainingMs).toBe(initialDurationMs - 1000);
  });
  it('never saves or restores match feedback from active play', () => {
    const game = playing();
    const move = findMove(game.board)!;
    const selected = transition(game, { type: 'SELECT', point: move.from }, 4100);
    const matched = transition(selected, { type: 'SELECT', point: move.to }, 4100);
    expect(matched.matchFeedback).toEqual({ addedMs: MATCH_BONUS_MS, until: 7100 });
    const encoded = encodeGame(matched)!;
    const saved = JSON.parse(encoded);
    expect(saved).not.toHaveProperty('matchFeedback');
    const restored = decodeGame(encoded)!;
    expect(restored.matchFeedback).toBeNull();
    expect(restored.remainingMs).toBe(matched.remainingMs);
    expect(restored.moveIndex).toBe(matched.moveIndex);
    expect(restored.board).toEqual(matched.board);
    expect(decodeGame(JSON.stringify({ ...saved, matchFeedback: matched.matchFeedback }))?.matchFeedback).toBeNull();
  });
  it('preserves above-budget saved time without granting further match bonuses', () => {
    const saved = encodeGame({ ...playing(), remainingMs: initialDurationMs + 60000 })!;
    const game = transition(decodeGame(saved)!, { type: 'RESUME' }, 10000);
    const move = findMove(game.board)!;
    const selected = transition(game, { type: 'SELECT', point: move.from }, 11000);
    const matched = transition(selected, { type: 'SELECT', point: move.to }, 12000);
    expect(matched.remainingMs).toBe(initialDurationMs + 58000);
    expect(matched.matchFeedback).toEqual({ addedMs: 0, until: 15000 });
  });
  it('preserves completion and its reward without paying again or restoring feedback after reload', () => {
    const won = matchFirstPair(finalPair(playing()));
    expect(won.matchFeedback).not.toBeNull();
    const encoded = encodeGame(won)!;
    expect(JSON.parse(encoded)).not.toHaveProperty('matchFeedback');
    const restored = decodeGame(encoded)!;
    expect(restored.phase).toBe('won');
    expect(restored.matchFeedback).toBeNull();
    expect(transition(restored, { type: 'TICK' }, 900000).resources.lives).toBe(6);
  });
  it('preserves timeout and gameover rather than allowing free resumes', () => {
    const timeout = transition({ ...playing(), remainingMs: 1000 }, { type: 'TICK' }, 1100);
    expect(timeout.phase).toBe('timeout');
    expect(timeout.remainingMs).toBe(0);
    expect(decodeGame(encodeGame(timeout)!)?.phase).toBe('timeout');
    const gameover = transition({ ...playing(), remainingMs: 1000, resources: { lives: 1, hints: 0, extensions: 0 } }, { type: 'TICK' }, 1100);
    expect(gameover.phase).toBe('gameover');
    expect(gameover.remainingMs).toBe(0);
    expect(decodeGame(encodeGame(gameover)!)?.phase).toBe('gameover');
  });
  it('never writes test games to normal storage', () => {
    const storage = memoryStorage();
    saveGame(storage, playing());
    const before = storage.values.get(SAVE_KEY);
    const test = transition(playing('test'), { type: 'COMPLETE' }, 100);
    expect(encodeGame(test)).toBeNull();
    expect(saveGame(storage, test)).toBe(true);
    expect(storage.values.get(SAVE_KEY)).toBe(before);
    expect(loadGame(storage).game?.mode).toBe('normal');
  });
  it('survives unavailable storage', () => {
    const unavailable = { getItem: () => { throw new Error('unavailable'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadGame(unavailable).warning).not.toBe('');
    expect(saveGame(unavailable, playing())).toBe(false);
  });
  it.each(['bad-json', 'null', '{}', '{"version":999}'])('rejects malformed input %s', raw => {
    expect(decodeGame(raw)).toBeNull();
  });
  it.each([
    (saved: any) => { saved.resources.lives = -1; },
    (saved: any) => { saved.remainingMs = 'forever'; },
    (saved: any) => { saved.board[0][0].kind = levels[saved.levelId - 1].kinds; },
    (saved: any) => { saved.board[0][1].id = saved.board[0][0].id; },
    (saved: any) => { saved.board[0][0] = null; },
    (saved: any) => { saved.board.pop(); },
    (saved: any) => { saved.phase = 'won'; },
    (saved: any) => { saved.phase = 'timeout'; },
    (saved: any) => { saved.moveIndex = 500; },
    (saved: any) => { saved.resources.lives = 0; },
  ])('validates all restored board and state invariants', corrupt => {
    const saved = JSON.parse(encodeGame(playing())!);
    corrupt(saved);
    expect(decodeGame(JSON.stringify(saved))).toBeNull();
  });
});
