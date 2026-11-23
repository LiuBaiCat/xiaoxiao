import { describe, expect, it, vi } from 'vitest';
import { findMove } from '../engine/board';
import { createGame, transition } from './machine';
import { loadSoundPreferences, SoundPlayer, soundCues, soundForTransition, type SoundName } from './audio';

const started = () => transition(createGame(1, 'test'), { type: 'RESUME' }, 0);
function fakeAudio() {
  const oscillators: any[] = [];
  const gains: any[] = [];
  const context = {
    state: 'suspended', currentTime: 10, destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
    createGain: vi.fn(() => {
      const node = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(node); return node;
    }),
    createOscillator: vi.fn(() => {
      const node = { type: '', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
      oscillators.push(node); return node;
    }),
  };
  return { context, oscillators, gains, factory: () => context as unknown as AudioContext };
}

describe('声音对应真实游戏结果', () => {
  it('selects a tile, rejects a pair and deselects with distinct cues', () => {
    const game = started();
    const first = { row: 0, col: 0 };
    const other = game.board.flatMap((row, r) => row.map((tile, c) => ({ tile, point: { row: r, col: c } }))).find(item => item.tile!.kind !== game.board[0][0]!.kind)!.point;
    const selected = transition(game, { type: 'SELECT', point: first }, 0);
    expect(soundForTransition(game, selected)).toBe('select');
    expect(soundForTransition(selected, transition(selected, { type: 'SELECT', point: other }, 0))).toBe('failure');
    expect(soundForTransition(selected, transition(selected, { type: 'SELECT', point: first }, 0))).toBe('click');
  });
  it('plays match only once, not on animation or clock updates', () => {
    const before = started();
    const matched = transition(before, { type: 'AUTO_PAIR' }, 0);
    expect(soundForTransition(before, matched)).toBe('match');
    expect(soundForTransition(matched, transition(matched, { type: 'TICK' }, 600))).toBeNull();
  });
  it.each((['normal', 'test'] as const).flatMap(mode => [2, 1].map(lives => ({ mode, lives }))))('prioritizes deadlock life loss over a match in $mode mode with $lives lives', ({ mode, lives }) => {
    const game = {
      ...transition(createGame(1, mode), { type: 'RESUME' }, 0),
      board: [[2, 2], [0, 1], [1, 0]].map((row, r) => row.map((kind, c) => ({ id: r * 2 + c + 1, kind }))),
      resources: { lives, hints: 3, extensions: 3 },
    };
    const before = mode === 'normal' ? transition(game, { type: 'SELECT', point: { row: 0, col: 0 } }, 0) : game;
    const matched = transition(before, mode === 'normal'
      ? { type: 'SELECT', point: { row: 0, col: 1 } }
      : { type: 'AUTO_PAIR' }, 0);
    expect(matched.moveIndex).toBe(before.moveIndex + 1);
    expect(matched.resources.lives).toBe(lives - 1);
    expect(matched.phase).toBe(lives === 1 ? 'gameover' : 'playing');
    const cue = lives === 1 ? 'gameover' : 'failure';
    expect(soundForTransition(before, matched)).toBe(cue);
    expect(soundForTransition(before, { ...matched, note: '' })).toBe(cue);
    const repeated = transition(matched, { type: 'SELECT', point: { row: 0, col: 1 } }, 1);
    expect(soundForTransition(matched, repeated)).toBeNull();
    const settled = transition(repeated, { type: 'TICK' }, 600);
    expect(soundForTransition(repeated, settled)).toBeNull();
    expect(settled.resources.lives).toBe(lives - 1);
  });
  it('recognizes a playing life decrease independently of move index or note', () => {
    const before = started();
    const after = { ...before, resources: { ...before.resources, lives: before.resources.lives - 1 }, note: '' };
    expect(soundForTransition(before, after)).toBe('failure');
    expect(soundForTransition(after, { ...after, resources: { ...after.resources } })).toBeNull();
  });
  it('plays win, timeout and gameover as different cues', () => {
    const before = started();
    expect(soundForTransition(before, transition(before, { type: 'COMPLETE' }, 0))).toBe('win');
    expect(soundForTransition(before, transition(before, { type: 'EXPIRE' }, 0))).toBe('timeout');
    const lastLife = { ...before, resources: { ...before.resources, lives: 1 } };
    expect(soundForTransition(lastLife, transition(lastLife, { type: 'EXPIRE' }, 0))).toBe('gameover');
  });
  it('gives the last real pair a win cue rather than a duplicate match cue', () => {
    const before = { ...started(), board: [[{ id: 1, kind: 0 }, { id: 2, kind: 0 }]] };
    const move = findMove(before.board)!;
    const selected = transition(before, { type: 'SELECT', point: move.from }, 0);
    expect(soundForTransition(selected, transition(selected, { type: 'SELECT', point: move.to }, 0))).toBe('win');
  });
  it('supports unlimited hints and time extensions without relying on resource deductions', () => {
    const before = started();
    expect(soundForTransition(before, transition(before, { type: 'HINT' }, 0))).toBe('hint');
    expect(soundForTransition(before, transition(before, { type: 'EXTEND' }, 0))).toBe('extend');
  });
  it('does not sound on blocked items or repeated hints', () => {
    const before = started();
    const hint = transition(before, { type: 'HINT' }, 0);
    expect(soundForTransition(hint, transition(hint, { type: 'HINT' }, 10))).toBeNull();
    const empty = { ...before, unlimited: false, resources: { ...before.resources, extensions: 0 } };
    expect(soundForTransition(empty, transition(empty, { type: 'EXTEND' }, 10))).toBeNull();
  });
  it('sounds on manual pause/resume but stays quiet when the tab loses focus', () => {
    const before = started();
    const paused = transition(before, { type: 'PAUSE' }, 0);
    expect(soundForTransition(before, paused)).toBe('pause');
    expect(soundForTransition(paused, transition(paused, { type: 'RESUME' }, 100))).toBe('resume');
    expect(soundForTransition(before, transition(before, { type: 'PAUSE', reason: 'away' }, 0))).toBeNull();
  });
  it('warns only when crossing thirty seconds and ignores mode changes', () => {
    const before = { ...started(), frozen: false, remainingMs: 31000 };
    const after = transition(before, { type: 'TICK' }, 1100);
    expect(soundForTransition(before, after)).toBe('warning');
    expect(soundForTransition(after, transition(after, { type: 'TICK' }, 1500))).toBeNull();
    expect(soundForTransition(before, createGame(2, 'test'))).toBeNull();
    expect(soundForTransition(before, createGame(1, 'normal'))).toBeNull();
  });
});

describe('离线合成与静音', () => {
  it.each(Object.keys(soundCues) as SoundName[])('%s uses short finite tones with bounded amplitude', cue => {
    const audio = fakeAudio();
    const player = new SoundPlayer({ muted: false, volume: 0.45 }, audio.factory);
    player.play(cue);
    expect(audio.context.resume).toHaveBeenCalledOnce();
    expect(audio.oscillators).toHaveLength(soundCues[cue].length);
    soundCues[cue].forEach((tone, i) => {
      expect(tone.frequency).toBeGreaterThan(200);
      expect(tone.frequency).toBeLessThan(1200);
      expect(tone.duration).toBeLessThan(0.5);
      expect(tone.gain).toBeLessThanOrEqual(0.2);
      expect(audio.oscillators[i].start).toHaveBeenCalledOnce();
      expect(audio.oscillators[i].stop).toHaveBeenCalledOnce();
      expect(audio.oscillators[i].frequency.setValueAtTime).toHaveBeenCalledWith(tone.frequency, 10.008 + tone.offset);
    });
  });
  it('does not create an audio context when muted or at zero volume', () => {
    const factory = vi.fn();
    const player = new SoundPlayer({ muted: true, volume: 0.45 }, factory);
    player.play('win');
    player.configure({ muted: false, volume: 0 });
    player.play('click');
    expect(factory).not.toHaveBeenCalled();
  });
  it('immediately cancels all scheduled notes when muted', () => {
    const audio = fakeAudio();
    const player = new SoundPlayer({ muted: false, volume: 0.45 }, audio.factory);
    player.play('win');
    player.configure({ muted: true, volume: 0.45 });
    for (const oscillator of audio.oscillators) {
      expect(oscillator.stop).toHaveBeenCalledTimes(2);
      expect(oscillator.disconnect).toHaveBeenCalledOnce();
    }
    expect(audio.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 10);
    player.play('match');
    expect(audio.oscillators).toHaveLength(soundCues.win.length);
    player.configure({ muted: false, volume: 0.2 });
    player.play('click');
    expect(audio.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0.2, 10);
    expect(audio.oscillators).toHaveLength(soundCues.win.length + 1);
  });
  it('releases completed voices and closes the context', () => {
    const audio = fakeAudio();
    const player = new SoundPlayer({ muted: false, volume: 0.45 }, audio.factory);
    player.play('click');
    audio.oscillators[0].onended();
    player.stop();
    expect(audio.oscillators[0].stop).toHaveBeenCalledOnce();
    player.dispose();
    expect(audio.context.close).toHaveBeenCalledOnce();
  });
  it('unsupported audio does not interrupt gameplay', () => {
    const player = new SoundPlayer({ muted: false, volume: 0.45 }, () => { throw new Error('Unavailable'); });
    expect(() => player.play('match')).not.toThrow();
  });
  it.each(['null', '{}', 'not json', '{"muted":false,"volume":-1}', '{"muted":true,"volume":2}'])('safely handles bad preferences %s', raw => {
    expect(loadSoundPreferences({ getItem: () => raw })).toEqual({ muted: false, volume: 0.45 });
  });
  it('loads preferences or falls back when storage is denied', () => {
    expect(loadSoundPreferences({ getItem: () => '{"muted":true,"volume":0.2}' })).toEqual({ muted: true, volume: 0.2 });
    expect(loadSoundPreferences({ getItem: () => { throw new Error('Denied'); } }).muted).toBe(false);
  });
});
