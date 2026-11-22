import { describe, expect, it } from 'vitest';
import { findMove, remainingPairs } from '../engine/board';
import { levels } from '../engine/levels';
import { createGame, MATCH_BONUS_MS, transition, type GameState } from './machine';
import { decodeGame, encodeGame, loadGame, saveGame, SAVE_KEY } from './storage';

const initialDurationMs = levels[0].seconds * 1000;
const playing = (mode: 'test' | 'normal' = 'normal') => transition(createGame(1, mode), { type: 'RESUME' }, 100);
const completeNormally = (state: GameState) => {
  let time = state.anchor ?? 100;
  while (remainingPairs(state.board) > 0) {
    const move = findMove(state.board)!;
    expect(move).not.toBeNull();
    state = transition(state, { type: 'SELECT', point: move.from }, time);
    state = transition(state, { type: 'SELECT', point: move.to }, time);
    time += 400;
    state = transition(state, { type: 'TICK' }, time);
  }
  return state;
};

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
    expect(transition(game, { type: 'TICK' }, 99999).remainingMs).toBe(initialDurationMs);
  });
  it('uses elapsed time instead of counting timer callbacks', () => {
    expect(transition(playing(), { type: 'TICK' }, 2600).remainingMs).toBe(initialDurationMs - 2500);
  });
  it('settles elapsed time before adding exactly three seconds for a match', () => {
    const game = playing();
    const move = findMove(game.board)!;
    const selected = transition(game, { type: 'SELECT', point: move.from }, 1100);
    expect(selected.remainingMs).toBe(initialDurationMs - 1000);
    const matched = transition(selected, { type: 'SELECT', point: move.to }, 2600);
    expect(MATCH_BONUS_MS).toBe(3000);
    expect(matched.remainingMs).toBe(initialDurationMs - 2500 + 3000);
    expect(matched.anchor).toBe(2600);
    expect(matched.moveIndex).toBe(1);
    expect(matched.resources).toEqual(game.resources);
    expect(matched.note).toContain('消除一对，时间 +3秒');
    const extended = transition(matched, { type: 'EXTEND' }, 3100);
    expect(extended.remainingMs).toBe(matched.remainingMs - 500 + 30000);
    expect(extended.resources.extensions).toBe(2);
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
  });
});

describe('结算、变形和竞态', () => {
  it.each(levels.map(level => level.id))('completes level %i through 70 real matches and gives one reward', id => {
    const started = transition(createGame(id, 'normal'), { type: 'RESUME' }, 100);
    expect(started.board.flat()).toHaveLength(140);
    expect(remainingPairs(started.board)).toBe(70);
    const won = completeNormally(started);
    expect(won.phase).toBe('won');
    expect(remainingPairs(won.board)).toBe(0);
    expect(won.resources).toEqual({ lives: 6, hints: 5, extensions: 4 });
    expect(won.moveIndex).toBe(levels[id - 1].rows * levels[id - 1].cols / 2);
    expect(won.moveIndex).toBe(70);
    expect(won.remainingMs).toBe(levels[id - 1].seconds * 1000 + 70 * MATCH_BONUS_MS - 69 * 400);
    expect(transition(won, { type: 'COMPLETE' }, 99999).resources).toEqual(won.resources);
    expect(transition(won, { type: 'TICK' }, 999999).resources).toEqual(won.resources);
  });
  it('carries resources to the next level', () => {
    const next = transition(completeNormally(playing()), { type: 'NEXT' }, 30000);
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
    expect(matched.remainingMs).toBe(initialDurationMs + MATCH_BONUS_MS);
    const repeated = transition(matched, { type: 'SELECT', point: move.to }, 101);
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
    const paused = transition(matched, { type: 'PAUSE', reason: 'away' }, 110);
    expect(paused.animation).toBeNull();
    expect(transition(paused, { type: 'TICK' }, 10000).phase).toBe('paused');
    expect(remainingPairs(paused.board)).toBe(69);
  });
  it('keeps both the match bonus and free shuffle information in the note', () => {
    const board = [[2, 2], [0, 1], [1, 0]].map((row, r) => row.map((kind, c) => ({ id: r * 2 + c + 1, kind })));
    let game: GameState = { ...playing(), board };
    game = transition(game, { type: 'SELECT', point: { row: 0, col: 0 } }, 100);
    game = transition(game, { type: 'SELECT', point: { row: 0, col: 1 } }, 100);
    expect(game.remainingMs).toBe(initialDurationMs + MATCH_BONUS_MS);
    expect(game.moveIndex).toBe(1);
    expect(game.note).toContain('消除一对，时间 +3秒');
    expect(game.note).toContain('免费重新排列');
    expect(findMove(game.board)).not.toBeNull();
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
  it('a final match before the deadline wins immediately', () => {
    let game: GameState = { ...playing(), remainingMs: 1, board: [[{ id: 1, kind: 0 }, { id: 2, kind: 0 }]] };
    game = transition(game, { type: 'SELECT', point: { row: 0, col: 0 } }, 100);
    game = transition(game, { type: 'SELECT', point: { row: 0, col: 1 } }, 100);
    expect(game.phase).toBe('won');
    expect(game.remainingMs).toBe(1 + MATCH_BONUS_MS);
    expect(game.moveIndex).toBe(1);
    expect(game.note).toContain('消除一对，时间 +3秒');
    const later = transition(game, { type: 'TICK' }, 999);
    expect(later.resources.lives).toBe(6);
    expect(later.remainingMs).toBe(game.remainingMs);
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
  it('adds bonuses for frozen AUTO_PAIR matches, including the final pair, without duplicate rewards', () => {
    const board = [[0, 0, 1, 1]].map(row => row.map((kind, col) => ({ id: col + 1, kind })));
    const game: GameState = { ...playing('test'), board };
    const matched = transition(game, { type: 'AUTO_PAIR' }, 10000);
    expect(matched.remainingMs).toBe(initialDurationMs + MATCH_BONUS_MS);
    expect(matched.moveIndex).toBe(1);
    const repeated = transition(matched, { type: 'AUTO_PAIR' }, 10001);
    expect(repeated.remainingMs).toBe(matched.remainingMs);
    expect(repeated.moveIndex).toBe(1);
    const settled = transition(repeated, { type: 'TICK' }, 10400);
    expect(settled.remainingMs).toBe(matched.remainingMs);
    const won = transition(settled, { type: 'AUTO_PAIR' }, 20000);
    expect(won.phase).toBe('won');
    expect(won.moveIndex).toBe(2);
    expect(won.remainingMs).toBe(initialDurationMs + 2 * MATCH_BONUS_MS);
    expect(won.note).toContain('消除一对，时间 +3秒');
    expect(transition(won, { type: 'AUTO_PAIR' }, 21000)).toEqual(won);
  });
  it.each([true, false])('test COMPLETE grants no match bonus with frozen=%s', frozen => {
    const game = { ...playing('test'), frozen };
    const completed = transition(game, { type: 'COMPLETE' }, 1100);
    expect(completed.phase).toBe('won');
    expect(completed.remainingMs).toBe(initialDurationMs - (frozen ? 0 : 1000));
    expect(completed.note).not.toContain('时间 +3秒');
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
    expect(game.remainingMs).toBe(initialDurationMs + MATCH_BONUS_MS);
    expect(game.animation?.path.length).toBeGreaterThanOrEqual(2);
    game = transition(game, { type: 'COMPLETE' }, 5100);
    expect(game.phase).toBe('won');
    expect(game.remainingMs).toBe(initialDurationMs + MATCH_BONUS_MS);
    expect(game.resources).toEqual({ lives: 6, hints: 4, extensions: 4 });
    expect(transition(game, { type: 'COMPLETE' }, 5101).resources).toEqual(game.resources);
  });
});

describe('存档边界', () => {
  it('restores active play paused and strips transient animation / selection', () => {
    const game = transition(playing(), { type: 'SELECT', point: { row: 0, col: 0 } }, 1100);
    const restored = decodeGame(encodeGame(game)!)!;
    expect(restored.phase).toBe('paused');
    expect(restored.pauseReason).toBe('restored');
    expect(restored.anchor).toBeNull();
    expect(restored.selected).toBeNull();
    expect(restored.animation).toBeNull();
    expect(restored.board).toEqual(game.board);
    expect(restored.remainingMs).toBe(initialDurationMs - 1000);
  });
  it('preserves completion and its reward without paying again after reload', () => {
    const won = completeNormally(playing());
    const restored = decodeGame(encodeGame(won)!)!;
    expect(restored.phase).toBe('won');
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
