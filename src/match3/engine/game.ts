import type { Action, Level, MatchGame, Move, Tool } from './types';
import { activeIndices, DEFAULT_SEED, draftGame, EngineError, event, goalsMet, indexOf, isActive, LIMITS, snapshotLevel } from './board';
import { detectMatches, findMove, isCombination, swapPieces, swapReason } from './matches';
import { generateStage, shuffleMovable } from './shuffle';
import { applyGravity, gravityGraph } from './gravity';
import { resolveWave, type Wave } from './effects';
import { advanceEnvironment, poisonedOut } from './environment';

export { activeGoals } from './board';
export { detectMatches, findMove } from './matches';
export { applyGravity, gravityGraph } from './gravity';

export function createGame(level: Level, mode: MatchGame['mode'] = 'normal', seed?: number): MatchGame {
  const initialSeed = (seed ?? level.seed ?? DEFAULT_SEED) >>> 0;
  const copy = snapshotLevel(level, initialSeed);
  const game: MatchGame = {
    version: 1, level: copy, mode, phase: 'paused', board: [], stageIndex: 0, movesLeft: copy.moves,
    tools: { hammer: copy.tools?.hammer ?? 2, swap: copy.tools?.swap ?? 2, shuffle: copy.tools?.shuffle ?? 2 }, goalProgress: {}, score: 0, turn: 0,
    rng: initialSeed, nextId: 1, unlimitedMoves: mode !== 'normal', unlimitedTools: mode !== 'normal',
    events: [], note: '准备好了，请点击继续游戏。', pauseReason: 'intro',
  };
  try {
    if (!copy.stages.length || !copy.palette.length || copy.mask.length !== copy.height || copy.mask.some(row => row.length !== copy.width)) {
      throw new EngineError('关卡尺寸、阶段或动物种类不完整，请先校验关卡。');
    }
    game.board = Array.from({ length: copy.width * copy.height }, (_, i) => ({
      ground: copy.mask[Math.floor(i / copy.width)][i % copy.width] === '.', piece: null, ice: 0, blocker: null, lock: null,
    }));
    const at = (p: { row: number; col: number }) => {
      const i = indexOf(copy, p);
      if (p.row < 0 || p.row >= copy.height || p.col < 0 || p.col >= copy.width || !game.board[i]?.ground) throw new EngineError('障碍或动物不在合法地板上，请先校验关卡。');
      return i;
    };
    for (const entry of copy.ice) game.board[at(entry)].ice = entry.layers;
    for (const entry of copy.blockers) game.board[at(entry)].blocker = JSON.parse(JSON.stringify(entry.blocker));
    for (const entry of copy.locks) game.board[at(entry)].lock = { type: entry.type, id: game.nextId++ };
    const fixed = new Set<number>();
    for (const entry of copy.initialPieces) {
      const i = at(entry);
      if (game.board[i].blocker) throw new EngineError('固定障碍不能与动物重叠。');
      game.board[i].piece = { id: game.nextId++, kind: entry.kind, ...(entry.special ? { special: entry.special } : {}) };
      fixed.add(i);
    }
    for (const goal of [...copy.goals, ...copy.stages.flatMap(s => s.goals)]) game.goalProgress[goal.id] = 0;
    for (let stage = 0; stage < copy.stages.length; stage++) {
      game.stageIndex = stage;
      gravityGraph(game);
      if (!generateStage(game, fixed)) throw new EngineError(`第${stage + 1}段无法生成无匹配且可行动的棋盘；请调整布局、绳子或预置动物。`);
    }
    game.stageIndex = 0;
  } catch (error) {
    game.stageIndex = 0;
    game.phase = 'failed'; game.note = error instanceof EngineError ? error.message : '关卡初始化失败，请先检查关卡配置。';
  }
  return game;
}
function invalid(game: MatchGame, note: string, move?: Move): MatchGame {
  const copy = draftGame(game);
  if (move) { swapPieces(copy, move); event(copy, 'swap', [move.from, move.to], move); swapPieces(copy, move); }
  event(copy, 'invalid', move ? [move.from, move.to] : []);
  copy.note = note;
  return copy;
}
function useTool(game: MatchGame, tool: Tool): void {
  if (game.mode !== 'normal' && game.unlimitedTools) return;
  if (game.tools[tool] <= 0) throw new EngineError('这个道具本关已用完，不消耗步数。');
  game.tools[tool]--;
}
/** Empty final-stage goals do not bypass global goals; passed stages remain frozen and cannot earn more credit. */
function finishGoals(game: MatchGame): boolean {
  let advanced = false;
  while (goalsMet(game, game.level.stages[game.stageIndex].goals)) {
    if (game.stageIndex === game.level.stages.length - 1) {
      return advanced;
    }
    game.stageIndex++;
    event(game, 'stage', activeIndices(game));
    advanced = true;
    game.note = '本段目标完成，进入下一段。';
  }
  return advanced;
}
function allGoalsMet(game: MatchGame): boolean {
  return goalsMet(game, game.level.goals) && game.level.stages.every(stage => goalsMet(game, stage.goals));
}
function ensureMove(game: MatchGame): void {
  if (findMove(game)) return;
  if (shuffleMovable(game)) {
    event(game, 'shuffle', activeIndices(game));
    game.note = '暂时没有可交换的组合，已免费重排可移动动物。';
  } else {
    game.phase = 'failed'; game.note = '当前布局没有合法行动，保留动物与障碍也无法重排，请重试或编辑关卡。';
  }
}
type RoundAction = Extract<Action, { type: 'SWAP' | 'HAMMER' }> | { type: 'SHUFFLE' };
const isWon = (game: MatchGame) => game.phase === 'won';
function transact(game: MatchGame, action: RoundAction): MatchGame {
  const next = draftGame(game);
  const ordinary = action.type === 'SWAP' && !action.free;
  let waves = 0, autoWaves = 0, specialTriggers = 0, poisonCleared = false, autoResolving = false, autoBudgetReached = false;
  function wave(input: Wave): boolean {
    if (autoResolving) {
      if (autoWaves >= LIMITS.autoWaves) { autoBudgetReached = true; return false; }
      autoWaves++;
    } else if (++waves > LIMITS.waves) {
      throw new EngineError('连锁超过结算预算，整次操作已撤销，请重试或编辑关卡。');
    }
    const result = resolveWave(next, autoResolving ? { ...input, specialBudget: LIMITS.autoSpecials - specialTriggers } : input);
    specialTriggers += result.triggeredSpecials;
    poisonCleared = poisonCleared || result.poisonCleared;
    if (autoResolving && specialTriggers >= LIMITS.autoSpecials) autoBudgetReached = true;
    return true;
  }
  function settle(firstMove?: Move): void {
    applyGravity(next);
    let matches = detectMatches(next, firstMove);
    while (matches.length && !autoBudgetReached) {
      if (!wave({ matches })) break;
      applyGravity(next); matches = detectMatches(next);
    }
  }
  function autoSpecials(): void {
    autoResolving = true;
    for (;;) {
      const at = activeIndices(next).find(i => {
        const cell = next.board[i];
        return !!cell.piece?.special && cell.ice === 0 && !cell.lock && !cell.blocker;
      });
      if (at === undefined) { autoResolving = false; return; }
      if (specialTriggers >= LIMITS.autoSpecials || autoWaves >= LIMITS.autoWaves) {
        autoBudgetReached = true; autoResolving = false; return;
      }
      if (!wave({ triggerSpecial: at, suppressFrozenSpecials: true })) {
        autoResolving = false; return;
      }
      settle();
      if (autoBudgetReached) { autoResolving = false; return; }
    }
  }
  try {
    if (ordinary && next.movesLeft <= 0 && !(next.mode !== 'normal' && next.unlimitedMoves)) return invalid(game, '剩余步数已用完，请重新挑战。');
    if (action.type === 'SWAP') {
      const reason = swapReason(next, action, action.free);
      if (reason) return invalid(game, reason);
      const combination = isCombination(next, action);
      swapPieces(next, action);
      const matches = combination ? [] : detectMatches(next, action);
      if (!action.free && !combination && !matches.some(m => m.cells.includes(action.from) || m.cells.includes(action.to))) {
        return invalid(game, '这次交换不能形成三连，已换回，不扣步数。', action);
      }
      if (action.free) useTool(next, 'swap');
      else {
        next.turn++;
        if (!(next.mode !== 'normal' && next.unlimitedMoves)) next.movesLeft--;
      }
      event(next, 'swap', [action.from, action.to], { from: action.from, to: action.to });
      if (combination) wave({ combo: action });
      else if (matches.length) wave({ matches });
      settle();
    } else if (action.type === 'HAMMER') {
      const c = next.board[action.at];
      if (!isActive(next, action.at) || !c?.ground || !(c.piece || c.lock || c.ice || c.blocker)) return invalid(game, '请在当前区域选择有动物或障碍的地板。');
      useTool(next, 'hammer'); wave({ hammer: action.at }); settle();
    } else {
      useTool(next, 'shuffle');
      if (!shuffleMovable(next)) return invalid(game, '保留动物、特效和锁定物后无法得到可行动的重排，不消耗道具。');
      event(next, 'shuffle', activeIndices(next));
    }
    const advanced = finishGoals(next);
    if (allGoalsMet(next)) {
      autoSpecials();
      finishGoals(next);
      next.phase = 'won'; next.note = autoBudgetReached ? '自动特效已达到结算上限，剩余特效保留，本关完成！' : '目标全部完成，特效结算后过关了！';
      return next;
    }
    if (ordinary && !advanced) {
      advanceEnvironment(next, poisonCleared);
      if (poisonedOut(next)) {
        next.phase = 'failed'; next.note = '毒液占满了所有可承载动物的地板，请重新挑战。'; return next;
      }
      settle();
      finishGoals(next);
      if (allGoalsMet(next)) {
        autoSpecials();
        finishGoals(next);
        next.phase = 'won'; next.note = autoBudgetReached ? '自动特效已达到结算上限，剩余特效保留，本关完成！' : '目标全部完成，特效结算后过关了！';
        return next;
      }
    }
    if (next.movesLeft <= 0 && !(next.mode !== 'normal' && next.unlimitedMoves)) {
      next.phase = 'failed'; next.note = '步数用完了，目标尚未全部完成，可以免费重试。';
    } else ensureMove(next);
    return next;
  } catch (error) {
    return invalid(game, error instanceof EngineError ? error.message : '本次结算遇到异常，整次操作已撤销，请重试或编辑关卡。');
  }
}
export function transition(game: MatchGame, action: Action): MatchGame {
  if (action.type === 'RETRY') {
    const fresh = createGame(game.level, game.mode, game.level.seed);
    if (game.mode !== 'normal') { fresh.unlimitedMoves = game.unlimitedMoves; fresh.unlimitedTools = game.unlimitedTools; }
    return fresh;
  }
  if (action.type === 'PAUSE') {
    if (game.phase !== 'playing') return game;
    return { ...game, events: [], phase: 'paused', pauseReason: 'manual', note: '已暂停，休息好后再继续。' };
  }
  if (action.type === 'RESUME') {
    return game.phase === 'paused' ? { ...game, phase: 'playing', events: [], note: '' } : game;
  }
  if (action.type === 'UNLIMITED_MOVES' || action.type === 'UNLIMITED_TOOLS') {
    if (game.mode === 'normal') return game;
    return { ...game, events: [], [action.type === 'UNLIMITED_MOVES' ? 'unlimitedMoves' : 'unlimitedTools']: action.value };
  }
  if (action.type === 'COMPLETE' || action.type === 'FAIL') {
    if (game.mode === 'normal') return game;
    return { ...game, events: [], phase: action.type === 'COMPLETE' ? 'won' : 'failed', note: action.type === 'COMPLETE' ? '测试通关，不影响正常进度。' : '测试失败，不影响正常进度。' };
  }
  if (game.phase !== 'playing') return invalid(game, game.phase === 'paused' ? '游戏已暂停，请先继续游戏。' : '本局已结束，请重新挑战。');
  if (action.type === 'AUTO') {
    if (game.mode === 'normal') return invalid(game, '自动走一步仅供测试或编辑器试关使用。');
    const move = findMove(game);
    if (!move) return invalid(game, '当前没有合法的普通交换，请重排或重新挑战。');
    return transact(game, { type: 'SWAP', ...move });
  }
  if (action.type === 'SWAP' || action.type === 'HAMMER') return transact(game, action);
  if (action.type === 'SHUFFLE') return transact(game, { type: 'SHUFFLE' });
  return invalid(game, '无法识别这个操作。');
}
