import { afterAll, describe, expect, it } from 'vitest';
import type { Action, Level, MatchGame } from '../engine/types';
import { activeGoals, createGame, transition } from '../engine/game';
import { wouldMatch } from '../engine/matches';
import { builtinLevels } from './registry';
import { levelKey } from './schema';
import saved from './winning-replays.json';

type Encoded = [number, number] | ['hammer', number] | ['shuffle'];
type Replay = { key: string; revision: number; seed: number; turns: number; actions: Encoded[] };
const decode = (a: Encoded): Action => a[0] === 'hammer' ? { type: 'HAMMER', at: a[1] }
  : a[0] === 'shuffle' ? { type: 'SHUFFLE' } : { type: 'SWAP', from: a[0], to: a[1] };
const start = (level: Level, seed: number) => transition(createGame(level, 'normal', seed), { type: 'RESUME' });

/** Offline authoring aid only: bounded one-ply search over real engine transitions.
 * No COMPLETE, AUTO, infinite resources, board edits or progress edits are used.
 * Persist the resulting route once; normal tests replay the committed route only.
 */
function solve(level: Level): Replay {
  const seed = level.seed!;
  let game = start(level, seed);
  if (game.phase !== 'playing') throw new Error(`${level.id}: ${game.note}`);
  const actions: Encoded[] = [];
  let evaluations = 0;
  function value(g: MatchGame): number {
    if (g.phase === 'won') return 1e9;
    if (g.phase === 'failed') return -1e9;
    const goals = activeGoals(g);
    let result = g.stageIndex * 100000;
    for (const goal of goals) {
      const ratio = Math.min(1, (g.goalProgress[goal.id] ?? 0) / goal.count);
      result += ratio * (goal.type === 'clear' || goal.type === 'special' ? 6000 : 2000);
    }
    const s = g.level.stages[g.stageIndex];
    const active = g.board.slice(s.startRow * g.level.width, (s.startRow + s.rows) * g.level.width);
    result -= active.filter(c => c.blocker?.type === 'poison').length * 90;
    result += active.filter(c => c.piece?.special && !c.lock).reduce((sum, c) => sum + (c.piece?.special === 'bird' ? 70 : 25), 0);
    result += g.tools.hammer * 160 + g.tools.shuffle * 10 + g.tools.swap * 10;
    result += Math.min(g.score, 100000) * 0.002;
    // Partial damage to multi-layer object goals should also improve a position.
    for (const c of active) {
      if (goals.some(goal => goal.type === 'clear' && goal.obstacle === 'ice' && (g.goalProgress[goal.id] ?? 0) < goal.count)) result -= c.ice * 40;
      if (c.blocker?.type === 'snow' && goals.some(goal => goal.type === 'clear' && goal.obstacle === 'snow' && (g.goalProgress[goal.id] ?? 0) < goal.count)) result -= c.blocker.layers * 40;
    }
    return result;
  }
  while (game.phase === 'playing' && actions.length < level.moves + 30 && evaluations < 12000) {
    const stage = level.stages[game.stageIndex];
    const begin = stage.startRow * level.width, end = (stage.startRow + stage.rows) * level.width;
    const candidates: Encoded[] = [];
    for (let from = begin; from < end; from++) {
      for (const to of [from + 1, from + level.width]) {
        if (to >= end || (to === from + 1 && to % level.width === 0)) continue;
        if (wouldMatch(game, { from, to })) candidates.push([from, to]);
      }
    }
    if (game.tools.hammer > 0) for (let at = begin; at < end; at++) {
      const cell = game.board[at];
      if (cell.ice || cell.lock || cell.blocker || cell.piece?.special) candidates.push(['hammer', at]);
    }
    if (game.tools.shuffle > 0) candidates.push(['shuffle']);
    let best: { state: MatchGame; action: Encoded; value: number } | undefined;
    for (const action of candidates) {
      if (++evaluations > 12000) break;
      const state = transition(game, decode(action));
      if (state.events.some(e => e.type === 'invalid')) continue;
      const score = value(state);
      if (!best || score > best.value) best = { state, action, value: score };
    }
    if (!best) break;
    game = { ...best.state, events: [] }; actions.push(best.action);
  }
  if (game.phase !== 'won') throw new Error(`${levelKey(level)} 未找到胜利路线：${game.phase}, 段${game.stageIndex}, 剩余${game.movesLeft}, ${JSON.stringify(game.goalProgress)}, ${game.note}`);
  return { key: levelKey(level), revision: level.revision, seed, turns: game.turn, actions };
}

// Keep authoring-only Node interfaces local: the browser project does not need
// @types/node or a tsconfig change just to regenerate this optional fixture.
const processModule = 'node:process';
const environment: { env: Record<string, string | undefined> } = await import(processModule);
if (environment.env.M3_GENERATE_REPLAYS === '1') {
  describe('explicit authoring: generate golden winning routes', () => {
    const records: Replay[] = [];
    it.each(builtinLevels)('$order $title solves within bounded search', level => {
      records.push(solve(level));
    }, 120000);
    afterAll(async () => {
      // Never overwrite valid evidence with a partially successful generation.
      expect(records).toHaveLength(builtinLevels.length);
      const fsModule = 'node:fs';
      const fs: { writeFileSync(path: URL, content: string): void } = await import(fsModule);
      fs.writeFileSync(new URL('./winning-replays.json', import.meta.url), JSON.stringify(records, null, 2) + '\n');
    });
  });
} else {
  describe('fixed-seed real-action victory replays', () => {
    const records = saved as Replay[];
    it('contains exactly one current-revision route per builtin level', () => {
      expect(records.map(r => r.key)).toEqual(builtinLevels.map(levelKey));
      records.forEach(r => {
        const level = builtinLevels.find(l => levelKey(l) === r.key)!;
        expect(r.revision).toBe(level.revision); expect(r.seed).toBe(level.seed);
        expect(r.actions.length).toBeGreaterThan(0);
      });
    });
    it.each(builtinLevels)('$order $title wins normally without COMPLETE', level => {
      const record = records.find(r => r.key === levelKey(level)); expect(record).toBeDefined();
      let game = start(level, record!.seed);
      let second = start(level, record!.seed);
      for (const encoded of record!.actions) {
        expect(game.phase).toBe('playing');
        const action = decode(encoded);
        expect(['SWAP', 'HAMMER', 'SHUFFLE']).toContain(action.type);
        game = transition(game, action); second = transition(second, action);
        expect(game.events.some(e => e.type === 'invalid'), game.note).toBe(false);
        expect(game.unlimitedMoves).toBe(false); expect(game.unlimitedTools).toBe(false);
      }
      expect(game.phase, game.note).toBe('won'); expect(game.turn).toBe(record!.turns);
      expect(game.movesLeft).toBeGreaterThanOrEqual(0);
      expect(game).toEqual(second);
      for (const goal of [...level.goals, ...level.stages.flatMap(s => s.goals)]) expect(game.goalProgress[goal.id], goal.id).toBeGreaterThanOrEqual(goal.count);
    }, 30000);
  });
}
