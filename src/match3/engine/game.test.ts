import { describe, expect, it } from 'vitest';
import { activeGoals, createGame, detectMatches, findMove, transition } from './game';
import { copy, fixture, freeze, level } from './fixtures.test-helper';
import { LIMITS } from './board';
import type { Action, MatchGame } from './types';

const move: Action = { type: 'SWAP', from: 1, to: 4 };
function ready(mode: MatchGame['mode'] = 'normal', seed = 17): MatchGame {
  return transition(createGame(level(), mode, seed), { type: 'RESUME' });
}

describe('初始化、确定性与不可变输入', () => {
  it.each([0, 1, 0xffffffff, 0x80000000, -1])('极端种子 %s 的开局无匹配且可行动，不使用配对约束', seed => {
    const l = level(5, 5), before = copy(l);
    const g = createGame(freeze(l), 'normal', seed);
    expect(g.phase, g.note).toBe('paused'); expect(g.board).toHaveLength(25);
    expect(detectMatches(g)).toEqual([]); expect(findMove(g)).not.toBeNull();
    expect(g).toEqual(createGame(l, 'normal', seed)); expect(l).toEqual(before);
    expect(Object.isFrozen(g.level)).toBe(true); expect(Object.isFrozen(g.level.stages)).toBe(true);
    expect(new Set(g.board.map(c => c.piece?.id)).size).toBe(25);
  });
  it('默认种子固定，可显式覆盖关卡种子；资源取关卡值', () => {
    const l = level(); l.tools = { hammer: 0, swap: 1, shuffle: 4 }; l.seed = 9;
    expect(createGame(l)).toEqual(createGame(l));
    expect(createGame(l).level.seed).toBe(9); expect(createGame(l, 'normal', 2).level.seed).toBe(2);
    expect(createGame(l).tools).toEqual(l.tools);
    const missingTools = copy(l); delete (missingTools as Partial<typeof l>).tools;
    expect(createGame(missingTools).tools).toEqual({ hammer: 2, swap: 2, shuffle: 2 });
  });
  it('保留预置动物/特效/障碍配置，不为开局可解而改色或移除障碍', () => {
    const l = level(); l.initialPieces = [{ row: 0, col: 0, kind: 4, special: 'bomb' }];
    l.ice = [{ row: 0, col: 0, layers: 3 }]; l.locks = [{ row: 0, col: 0, type: 'vine' }];
    l.blockers = [{ row: 3, col: 3, blocker: { type: 'snow', layers: 5 } }];
    const g = createGame(l);
    expect(g.phase, g.note).toBe('paused'); expect(g.board[0].piece).toMatchObject({ kind: 4, special: 'bomb' });
    expect(g.board[0].ice).toBe(3); expect(g.board[0].lock?.type).toBe('vine');
    expect(g.board[21].blocker).toEqual({ type: 'snow', layers: 5 }); expect(g.board[21].piece).toBeNull();
  });
  it('结构不可能或预置三连时有限终止并说明原因，不悄改预置动物', () => {
    const l = level(3, 3); l.palette = [0];
    const g = createGame(l); expect(g.phase).toBe('failed'); expect(g.note).toContain('无法生成');
    l.palette = [0, 1, 2]; l.initialPieces = [0, 1, 2].map(col => ({ row: 0, col, kind: 0 }));
    const preset = createGame(l); expect(preset.phase).toBe('failed'); expect(preset.board.slice(0, 3).map(c => c.piece?.kind)).toEqual([0, 0, 0]);
  });
  it('循环门户初始化失败而不挂起', () => {
    const l = level(); l.portals = [{ id: 'loop', from: { row: 5, col: 0 }, to: { row: 0, col: 0 } }];
    const g = createGame(l); expect(g.phase).toBe('failed'); expect(g.note).toContain('循环');
  });
  it('冻结输入执行真实交换，保存序列化后继续结果与同seed重放完全相同', () => {
    let g = ready('test', 42), replay = ready('test', 42);
    for (let turn = 0; turn < 15; turn++) {
      if (g.phase !== 'playing') break;
      const m = findMove(g)!;
      const before = copy(g);
      const next = transition(freeze(g), { type: 'SWAP', ...m });
      expect(g).toEqual(before);
      expect(next).toEqual(transition(copy(g), { type: 'SWAP', ...m }));
      replay = transition(replay, { type: 'SWAP', ...m }); expect(next).toEqual(replay);
      expect(detectMatches(next)).toEqual([]);
      expect(new Set(next.board.flatMap(c => c.piece ? [c.piece.id] : [])).size).toBe(next.board.filter(c => c.piece).length);
      g = next;
    }
    expect(g.turn).toBe(15);
  });
});

describe('原子回合、暂停和测试隔离', () => {
  it('有效交换扣一步且全部连锁结算为稳定棋盘，事件含每阶段快照', () => {
    const g = fixture(['230', '010', '102']), before = copy(g);
    const next = transition(g, { type: 'SWAP', from: 4, to: 7 });
    expect(g).toEqual(before); expect(next.movesLeft).toBe(19); expect(next.turn).toBe(1); expect(next.score).toBeGreaterThan(0);
    expect(detectMatches(next)).toEqual([]);
    expect(next.events[0].type).toBe('swap'); expect(next.events.some(e => e.type === 'clear')).toBe(true);
    expect(next.events.some(e => e.type === 'fall')).toBe(true); expect(next.events.some(e => e.type === 'spawn')).toBe(true);
    expect(next.events.every(e => !!e.board)).toBe(true);
    const snapshot = copy(next.events[0].board); next.board[0].ice = 3; expect(next.events[0].board).toEqual(snapshot);
  });
  it('无效交换回弹不扣步/RNG，非相邻、空洞、锁定与绳子有中文提示', () => {
    const g = fixture(['012', '345', '012']);
    const next = transition(g, { type: 'SWAP', from: 0, to: 1 });
    expect(next.board).toEqual(g.board); expect(next.movesLeft).toBe(g.movesLeft); expect(next.rng).toBe(g.rng);
    expect(next.events.map(e => e.type)).toEqual(['swap', 'invalid']); expect(next.note).toContain('三连');
    expect(transition(g, { type: 'SWAP', from: 0, to: 8 }).note).toContain('相邻');
    expect(transition(g, { type: 'SWAP', from: -1, to: 0 }).note).toContain('锁定');
    expect(transition(g, { type: 'HAMMER', at: 999 }).tools).toEqual(g.tools);
  });
  it.each<Action>([move, { type: 'SWAP', from: 0, to: 1, free: true }, { type: 'HAMMER', at: 1 }, { type: 'SHUFFLE' }, { type: 'AUTO' }])('暂停中阻止操作 %s', action => {
    const g = createGame(level(), 'test'); const before = copy(g);
    const next = transition(freeze(g), action);
    expect(next.board).toEqual(g.board); expect(next.rng).toBe(g.rng); expect(next.tools).toEqual(g.tools); expect(next.turn).toBe(0);
    expect(next.phase).toBe('paused'); expect(next.note).toContain('暂停'); expect(g).toEqual(before);
  });
  it('暂停后恢复不重复结算，RESUME仅paused，正常忽略破解按钮', () => {
    const g = transition(ready(), { type: 'SWAP', ...findMove(ready())! });
    const paused = transition(g, { type: 'PAUSE' }); const resumed = transition(paused, { type: 'RESUME' });
    expect(resumed.board).toEqual(g.board); expect(resumed.score).toBe(g.score); expect(resumed.turn).toBe(g.turn); expect(resumed.events).toEqual([]);
    for (const action of [{ type: 'COMPLETE' }, { type: 'FAIL' }, { type: 'UNLIMITED_MOVES', value: true }, { type: 'UNLIMITED_TOOLS', value: true }] as Action[]) {
      expect(transition(g, action)).toBe(g);
    }
    expect(transition({ ...g, phase: 'won' }, { type: 'RESUME' }).phase).toBe('won');
    expect(transition(g, { type: 'AUTO' }).turn).toBe(g.turn);
  });
  it.each(['test', 'editor'] as const)('%s无限步只免扣数、仍计一回合；AUTO一步；测试按钮不改正常局', mode => {
    const normal = freeze(ready()), before = copy(normal), g = ready(mode);
    const next = transition(g, { type: 'AUTO' });
    expect(next.turn).toBe(1); expect(next.movesLeft).toBe(g.movesLeft); expect(next.score).toBeGreaterThan(0);
    const finite = transition(next, { type: 'UNLIMITED_MOVES', value: false });
    const finiteNext = transition(finite, { type: 'AUTO' }); expect(finiteNext.movesLeft).toBe(g.movesLeft - 1); expect(finiteNext.turn).toBe(2);
    expect(transition(g, { type: 'COMPLETE' }).phase).toBe('won'); expect(transition(g, { type: 'FAIL' }).phase).toBe('failed');
    expect(normal).toEqual(before);
  });
  it('最后一步全部连锁完成后通关优先失败，成功后不行动水晶/毛球/毒液', () => {
    const g = fixture(['01012', '10234', '23051', '34502', '45013']); g.movesLeft = 1;
    g.level.goals = [{ id: 'collect', type: 'collect', kind: 0, count: 3 }];
    g.board[24].piece = null; g.board[24].blocker = { type: 'crystal', colors: [0, 1], index: 0 };
    const next = transition(g, { type: 'SWAP', from: 1, to: 6 });
    expect(next.phase, next.note).toBe('won'); expect(next.movesLeft).toBe(0);
    expect(next.board[24].blocker).toEqual(g.board[24].blocker);
    const impossibleGoal = copy(g); impossibleGoal.level.goals[0].count = 1000;
    expect(transition(impossibleGoal, { type: 'SWAP', from: 1, to: 6 }).phase).toBe('failed');
  });
  it('预算溢出回滚整步，包括资源、RNG、计数、奖励和ID；返回稳定invalid快照', () => {
    const g = fixture(['010', '102', '230']); const before = copy(g);
    const old = LIMITS.waves; (LIMITS as { waves: number }).waves = 0;
    try {
      const next = transition(g, move);
      expect({ ...next, events: [], note: '' }).toEqual({ ...before, events: [], note: '' });
      expect(next.note).toContain('预算'); expect(next.events.map(e => e.type)).toEqual(['invalid']);
    } finally { (LIMITS as { waves: number }).waves = old; }
    const oldEvents = LIMITS.events; (LIMITS as { events: number }).events = 2;
    try {
      const next = transition(g, move); expect(next.board).toEqual(before.board); expect(next.rng).toBe(before.rng); expect(next.movesLeft).toBe(before.movesLeft);
      expect(next.note).toContain('预算');
    } finally { (LIMITS as { events: number }).events = oldEvents; }
  });
  it('全目标完成后自动触发剩余特效并计分，达到上限后保留特效并通关', () => {
    const g = fixture();
    g.level.goals = [{ id: 'snow', type: 'clear', obstacle: 'snow', unit: 'objects', count: 1 }];
    g.board[0].piece = null;
    g.board[0].blocker = { type: 'snow', layers: 1 };
    g.board[24].piece!.special = 'bomb';
    const next = transition(g, { type: 'HAMMER', at: 0 });
    expect(next.phase, next.note).toBe('won');
    expect(next.events.some(event => event.type === 'special' && event.special === 'bomb')).toBe(true);
    expect(next.score).toBeGreaterThan(g.score + 20);
    const automaticSpecials = next.events.filter(event => event.type === 'special' && event.special === 'bomb');
    expect(automaticSpecials.some(event => (event.score ?? 0) > g.score)).toBe(true);
    expect(next.events.filter(event => event.score !== undefined).map(event => event.score!).every((score, index, scores) => index === 0 || score >= scores[index - 1])).toBe(true);

    const limited = fixture();
    limited.level.goals = [{ id: 'snow', type: 'clear', obstacle: 'snow', unit: 'objects', count: 1 }];
    limited.board[0].piece = null;
    limited.board[0].blocker = { type: 'snow', layers: 1 };
    limited.board[24].piece!.special = 'bomb';
    limited.board[23].piece!.special = 'bomb';
    const oldBudget = LIMITS.autoSpecials;
    (LIMITS as { autoSpecials: number }).autoSpecials = 1;
    try {
      const capped = transition(limited, { type: 'HAMMER', at: 0 });
      expect(capped.phase).toBe('won');
      expect(capped.board.filter(cell => cell.piece?.special === 'bomb')).not.toHaveLength(0);
      expect(capped.note).toContain('达到结算上限');
    } finally { (LIMITS as { autoSpecials: number }).autoSpecials = oldBudget; }

    const waveLimited = copy(limited);
    const oldWaveBudget = LIMITS.autoWaves;
    (LIMITS as { autoWaves: number }).autoWaves = 0;
    try {
      const capped = transition(waveLimited, { type: 'HAMMER', at: 0 });
      expect(capped.phase).toBe('won');
      expect(capped.note).toContain('达到结算上限');
    } finally { (LIMITS as { autoWaves: number }).autoWaves = oldWaveBudget; }
  });
  it('不可供料门户/显式入口出错后也不留半步', () => {
    const g = fixture(['010', '102', '230']); g.level.spawnPoints = [{ row: 0, col: 0 }];
    const next = transition(g, move); expect(next.board).toEqual(g.board); expect(next.rng).toBe(g.rng); expect(next.movesLeft).toBe(g.movesLeft);
    expect(next.note).toContain('补充入口');
  });
  it('冰层动物不能普通或自由交换；锤击破冰不移动动物', () => {
    const g = fixture(['010', '102', '230']);
    g.board[1].ice = 2;
    const frozen = copy(g.board[1].piece);
    for (const free of [false, true]) {
      const next = transition(g, { type: 'SWAP', from: 1, to: 4, free });
      expect(next.board[1].piece).toEqual(frozen);
      expect(next.movesLeft).toBe(g.movesLeft);
      expect(next.note).toContain('冰层');
    }
    const chipped = transition(g, { type: 'HAMMER', at: 1 });
    expect(chipped.board[1].ice).toBe(1);
    expect(chipped.board[1].piece).toEqual(frozen);
  });
  it('RETRY用开局seed重置全部障碍、奖励资源和计数，保持暂停', () => {
    const l = level(); l.blockers = [{ row: 5, col: 5, blocker: { type: 'gift', color: 1, reward: { tool: 'hammer', count: 5 } } }];
    l.locks = [{ row: 4, col: 4, type: 'fur' }]; l.ice = [{ row: 0, col: 0, layers: 3 }];
    const initial = createGame(l, 'normal', 45);
    const used = transition(transition(initial, { type: 'RESUME' }), { type: 'HAMMER', at: 35 });
    expect(used.tools.hammer).toBe(6);
    const retry = transition(used, { type: 'RETRY' }); expect(retry).toEqual(initial); expect(retry.board[35].blocker?.type).toBe('gift');
  });
});

describe('道具不扣步、不推进环境', () => {
  it('自由交换允许不三连及跨绳，但相同动物/不相邻/锁定/用完不损耗', () => {
    const g = ready(); const m = { from: 0, to: 1 };
    g.board[0].piece!.kind = 0; g.board[1].piece!.kind = 1;
    // A fixed bird pair makes a legal move available after an arbitrary free exchange, without touching it.
    g.board[34].piece!.special = 'bird'; g.board[35].piece!.special = 'bird';
    const before = copy(g.board); const next = transition(g, { type: 'SWAP', ...m, free: true });
    expect(next.tools.swap).toBe(1); expect(next.movesLeft).toBe(g.movesLeft); expect(next.turn).toBe(0);
    const identical = fixture(['012', '345', '012']); identical.board[1].piece!.kind = 0;
    expect(transition(identical, { type: 'SWAP', ...m, free: true }).tools.swap).toBe(2);
    expect(transition(g, { type: 'SWAP', from: 0, to: 35, free: true }).tools.swap).toBe(2);
    const exhausted = { ...g, tools: { ...g.tools, swap: 0 } };
    expect(transition(exhausted, { type: 'SWAP', ...m, free: true }).board).toEqual(before);
    const rope = fixture(['010', '102', '230']); rope.level.ropes = [{ from: { row: 0, col: 1 }, to: { row: 1, col: 1 } }];
    expect(transition(rope, move).movesLeft).toBe(20);
    expect(transition(rope, { ...move, type: 'SWAP', free: true }).tools.swap).toBe(1);
    rope.board[4].lock = { type: 'vine', id: 100 };
    expect(transition(rope, { type: 'SWAP', from: 1, to: 4, free: true }).tools.swap).toBe(2);
  });
  it.each<Action>([{ type: 'HAMMER', at: 0 }, { type: 'SHUFFLE' }, { type: 'SWAP', from: 0, to: 1, free: true }])('%s 不推进水晶、毛球或毒液，不扣步', action => {
    const g = ready();
    g.board[35].piece = null; g.board[35].blocker = { type: 'crystal', colors: [99, 98], index: 0 };
    g.board[30].lock = { type: 'fur', id: 1000 }; g.board[0].ice = 2;
    const next = transition(g, action);
    expect(next.movesLeft).toBe(g.movesLeft); expect(next.turn).toBe(0);
    expect(next.board[35].blocker).toEqual(g.board[35].blocker); expect(next.board[30].lock).toEqual(g.board[30].lock);
  });
  it('无限道具不绕过锁定/无效位置，正常模式不能通过伪造标记免扣资源', () => {
    const g = ready('test'); g.board[0].lock = { type: 'vine', id: 1000 };
    expect(transition(g, { type: 'SWAP', from: 0, to: 1, free: true }).board).toEqual(g.board);
    const next = transition(g, { type: 'HAMMER', at: 0 }); expect(next.tools.hammer).toBe(2);
    const normal = { ...g, mode: 'normal' as const };
    expect(transition(normal, { type: 'HAMMER', at: 0 }).tools.hammer).toBe(1);
  });
  it('有效普通无限步回合仍然将水晶变色一次，不随连锁重复行动', () => {
    const g = ready('test'); g.board[35].piece = null; g.board[35].blocker = { type: 'crystal', colors: [99, 98, 97], index: 0 };
    const next = transition(g, { type: 'SWAP', ...findMove(g)! });
    expect(next.board[35].blocker).toEqual({ type: 'crystal', colors: [99, 98, 97], index: 1 });
    expect(next.movesLeft).toBe(20); expect(next.turn).toBe(1);
  });
});

describe('全局与阶段目标', () => {
  it('activeGoals同时返回全局及当前段，阶段进度不偷计未来段；跨段不扣额外步', () => {
    const g = fixture(['010', '102', '230', '010', '102', '230']);
    g.level.scroll = true;
    g.level.goals = [{ id: 'global', type: 'collect', kind: 0, count: 6 }];
    g.level.stages = [0, 1].map(i => ({ id: `stage${i}`, startRow: i * 3, rows: 3, goals: [{ id: `local${i}`, type: 'collect', kind: 0, count: 3 }] }));
    expect(activeGoals(g).map(x => x.id)).toEqual(['global', 'local0']);
    const hidden = copy(g.board.slice(9)); const next = transition(g, move);
    expect(next.stageIndex, next.note).toBe(1); expect(next.board.slice(9)).toEqual(hidden);
    expect(next.goalProgress.global).toBeGreaterThanOrEqual(3); expect(next.goalProgress.local0).toBeGreaterThanOrEqual(3);
    expect(next.goalProgress.local1 ?? 0).toBe(0); expect(next.movesLeft).toBe(19);
    expect(next.events.some(e => e.type === 'stage')).toBe(true);
    const oldStage = copy(next.board.slice(0, 9));
    const final = transition(next, { type: 'SWAP', from: 10, to: 13 });
    expect(final.phase, final.note).toBe('won'); expect(final.board.slice(0, 9)).toEqual(oldStage);
    expect(final.goalProgress.local0).toBe(next.goalProgress.local0); expect(final.goalProgress.local1).toBeGreaterThanOrEqual(3);
  });
  it('最后段目标完成但全局未完成仍继续，不能用本段计数替代历史全局', () => {
    const g = fixture(['010', '102', '230']);
    g.level.goals = [{ id: 'global', type: 'collect', kind: 0, count: 10000 }];
    g.level.stages[0].goals = [{ id: 'local', type: 'collect', kind: 0, count: 3 }];
    const next = transition(g, move); expect(next.phase).not.toBe('won'); expect(next.goalProgress.local).toBeGreaterThanOrEqual(3);
    expect(next.goalProgress.global).toBe(next.goalProgress.local);
  });
  it('鸟全屏及普通交换绝不影响隐藏段，跨段交换明确无效', () => {
    const g = fixture(undefined, 5, 6);
    g.level.stages = [0, 1].map(i => ({ id: `s${i}`, startRow: i * 3, rows: 3, goals: [{ id: `s${i}`, type: 'score', count: 99999 }] }));
    g.board[6].piece!.special = 'bird'; g.board[7].piece!.special = 'bird';
    const hidden = copy(g.board.slice(15));
    expect(transition(g, { type: 'SWAP', from: 10, to: 15 }).board).toEqual(g.board);
    const next = transition(g, { type: 'SWAP', from: 6, to: 7 }); expect(next.board.slice(15)).toEqual(hidden);
  });
});
