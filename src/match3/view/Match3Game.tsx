import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameChrome } from '../../components/GameChrome';
import { ChromeControls } from '../../components/GameChrome';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { createGame, transition, findMove, activeGoals } from '../engine/game';
import { starsForScore } from '../engine/board';
import type { Action, Level, MatchGame, Move, Tool } from '../engine/types';
import { toolNames } from '../engine/types';
import { builtinLevels } from '../levels/registry';
import { levelKey } from '../levels/schema';
import { isUnlocked, loadCustomLevels, loadProgress, recordGame, saveCustomLevels, saveProgress, sortedLevels, SAVE_KEY, type Progress } from '../state/storage';
import Editor from '../editor/Editor';
import { Board } from './Board';
import { animationFrames, type AnimationFrame } from './animation';
import { GoalArt, goalLabel } from './CellArt';
import './match3.css';

export default function Match3Game({ chrome, entry }: { chrome: GameChrome; entry: 'continue' | 'levels' | 'test' | 'editor' }) {
  const [loaded] = useState(loadProgress);
  const [customLoaded] = useState(loadCustomLevels);
  const [custom, setCustom] = useState(customLoaded.levels);
  const levels = sortedLevels([...builtinLevels, ...custom]);
  const [progress, setProgress] = useState(loaded.progress);
  const progressRef = useRef(progress);
  const [game, setGame] = useState<MatchGame>(() => entry === 'test' ? createGame(builtinLevels[0], 'test') : loaded.progress.game ?? createGame(builtinLevels[0]));
  const gameRef = useRef(game);
  const [warning, setWarning] = useState(customLoaded.warning);
  const [saveBlocked, setSaveBlocked] = useState(!!loaded.warning);
  const saveBlockedRef = useRef(saveBlocked);
  const [picker, setPicker] = useState(entry === 'levels');
  const [help, setHelp] = useState(false);
  const [editor, setEditor] = useState(entry === 'editor');
  const [pendingLevel, setPendingLevel] = useState<Level | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [hint, setHint] = useState<Move | null>(null);
  const [message, setMessage] = useState('');
  const [frame, setFrame] = useState<AnimationFrame | null>(null);
  const [displayedScore, setDisplayedScore] = useState(game.score);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const animationTimer = useRef<number | undefined>(undefined);
  const animationStart = useRef({ board: game.board, stageIndex: game.stageIndex, score: game.score });
  const editorOpen = useRef(entry === 'editor');
  const reducedMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const stopAnimation = useCallback(() => {
    window.clearTimeout(animationTimer.current);
    setFrame(null); setBusy(false); busyRef.current = false;
  }, []);

  function persist(next: MatchGame): boolean {
    if (next.mode !== 'normal' || saveBlockedRef.current) return next.mode !== 'normal';
    const updated = recordGame(progressRef.current, next);
    progressRef.current = updated; setProgress(updated);
    const ok = saveProgress(updated);
    if (!ok) setWarning('进度没有保存成功，可能是浏览器存储空间不足。当前仍可游玩，请不要关闭窗口。');
    return ok;
  }

  function commit(next: MatchGame) {
    animationStart.current = { board: gameRef.current.board, stageIndex: gameRef.current.stageIndex, score: gameRef.current.score };
    gameRef.current = next; setGame(next);
    setSelected(null); setHint(null); setMessage('');
    return persist(next);
  }

  function act(action: Action) {
    if (busyRef.current && action.type !== 'PAUSE') return;
    const previous = gameRef.current;
    const next = transition(previous, action);
    if (next === previous) return;
    busyRef.current = next.events.length > 0 && next.phase !== 'paused';
    commit(next);
    if (action.type === 'RESUME') chrome.sound.play('resume');
  }

  function pause(away = false): boolean {
    if (editorOpen.current) return true;
    stopAnimation(); chrome.sound.stop(); setTool(null); setSelected(null); setHint(null);
    const current = gameRef.current;
    if (current.phase === 'playing') {
      const next = { ...transition(current, { type: 'PAUSE' }), pauseReason: away ? 'away' as const : 'manual' as const, events: [] };
      return commit(next);
    }
    return current.mode === 'normal' && progressRef.current.game ? persist(current) : true;
  }

  useEffect(() => {
    chrome.registerPause(() => pause(true));
    const away = () => pause(true);
    const hidden = () => { if (document.hidden) away(); };
    window.addEventListener('blur', away);
    window.addEventListener('beforeunload', away);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      chrome.registerPause(null); window.removeEventListener('blur', away); window.removeEventListener('beforeunload', away);
      document.removeEventListener('visibilitychange', hidden); window.clearTimeout(animationTimer.current);
    };
  }, [chrome.registerPause]);

  useEffect(() => {
    stopAnimation();
    setDisplayedScore(animationStart.current.score);
    if (game.phase === 'paused') return;
    const events = animationFrames(game.events, animationStart.current.board, animationStart.current.stageIndex);
    const finish = () => {
      stopAnimation();
      setDisplayedScore(game.score);
      if (game.phase === 'won') chrome.sound.play('win');
      else if (game.phase === 'failed') chrome.sound.play('gameover');
    };
    if (!events.length || reducedMotion.current) {
      if (events.some(event => event.type === 'clear')) chrome.sound.play('match');
      finish(); return;
    }
    setBusy(true); busyRef.current = true;
    let index = 0;
    const show = () => {
      const event = events[index++];
      if (!event) { finish(); return; }
      setFrame(event);
      if (event.score !== undefined) setDisplayedScore(event.score);
      if (event.type === 'clear' || event.type === 'special') chrome.sound.play('match');
      else if (event.type === 'invalid') chrome.sound.play('failure');
      const delay = event.type === 'stage' ? 220 : event.type === 'swap' ? 100 : event.type === 'fall' || event.type === 'spawn' ? 55 : 90;
      animationTimer.current = window.setTimeout(show, delay);
    };
    show();
    return () => window.clearTimeout(animationTimer.current);
  }, [game, stopAnimation, chrome.sound]);

  const goHome = () => { pause(true); chrome.onHome(); };
  const start = (level: Level, mode = gameRef.current.mode) => {
    stopAnimation(); setTool(null); setPicker(false); setPendingLevel(null);
    const fresh = createGame(level, mode);
    if (mode !== 'normal' && gameRef.current.mode === mode) {
      fresh.unlimitedMoves = gameRef.current.unlimitedMoves;
      fresh.unlimitedTools = gameRef.current.unlimitedTools;
    }
    commit(fresh);
  };
  const retry = () => start(game.mode === 'editor' ? game.level : levels.find(level => levelKey(level) === levelKey(game.level)) ?? game.level);
  const exitTest = () => {
    stopAnimation(); chrome.sound.stop();
    if (game.mode === 'editor') { editorOpen.current = true; setEditor(true); return; }
    const normal = progressRef.current.game;
    if (normal) { gameRef.current = normal; setGame(normal); setTool(null); setSelected(null); setHint(null); }
    else chrome.onHome();
  };
  const chooseLevel = (level: Level) => {
    if (game.mode !== 'normal' || !progress.game || progress.game.phase === 'won') start(level);
    else setPendingLevel(level);
  };
  const swap = (from: number, to: number) => {
    if (gameRef.current.phase !== 'playing' || busyRef.current) return;
    act({ type: 'SWAP', from, to, free: tool === 'swap' }); setTool(null);
  };
  const cell = (at: number) => {
    if (game.phase !== 'playing' || busyRef.current) return;
    if (tool === 'hammer') { act({ type: 'HAMMER', at }); setTool(null); return; }
    const target = game.board[at];
    if (!target.piece || target.lock || target.ice) {
      setMessage(target.ice ? '这格有冰层，先通过消除或小锤子破冰。' : target.lock ? '这个动物被覆盖，不能移动。可以关联消除，或用小锤子解除。' : '请选择相邻的两只动物。');
      return;
    }
    if (selected === at) { setSelected(null); return; }
    if (selected !== null && Math.abs(Math.floor(selected / game.level.width) - Math.floor(at / game.level.width)) + Math.abs(selected % game.level.width - at % game.level.width) === 1) swap(selected, at);
    else { setSelected(at); chrome.sound.play('select'); }
  };
  const goals = activeGoals(game);
  const canPlay = game.phase === 'playing' && !busy;
  const orderedPack = levels.filter(level => level.packId === game.level.packId);
  const nextLevel = orderedPack[orderedPack.findIndex(level => levelKey(level) === levelKey(game.level)) + 1];
  const testing = game.mode !== 'normal';
  const stars = starsForScore(game.level, displayedScore);
  const title = game.mode === 'editor' ? '编辑器试关' : game.mode === 'test' ? '测试／破解模式' : '开心消消乐';

  if (editor) return <Editor levels={custom} onClose={() => { editorOpen.current = false; setEditor(false); if (gameRef.current.mode === 'editor') { if (progressRef.current.game) { gameRef.current = progressRef.current.game; setGame(progressRef.current.game); } else chrome.onHome(); } else chrome.onHome(); }}
    onChange={next => { if (!saveCustomLevels(next)) { setWarning('自定义关卡保存失败，请导出备份后释放浏览器存储空间。'); return false; } setCustom(next); return true; }}
    onPlay={level => { editorOpen.current = false; setEditor(false); stopAnimation(); setTool(null); const next = createGame(structuredClone(level), 'editor'); gameRef.current = next; setGame(next); }}/>;

  return <div className="app in-game m3-app" data-m3-mode={game.mode} data-m3-phase={game.phase} data-m3-turn={game.turn}>
    {warning && <div role="alert" className="storage-warning">{warning}</div>}
    <main className="m3-main">
      <header className="m3-top">
        <div className="m3-toolbar">
          <div className="m3-actions">
            <button className="button tool-button pause-button" disabled={game.phase !== 'playing'} onClick={() => { pause(); chrome.sound.play('pause'); }}><Icon name="pause"/><span>暂停休息</span></button>
            <button className="button tool-button home-button" onClick={goHome}><Icon name="home"/><span>首页</span></button>
            <button className="button tool-button hint-button" disabled={!canPlay} onClick={() => { const move = findMove(game); setHint(move); setMessage(move ? '亮起的相邻两格可以交换，不扣步数。' : '目前没有可以交换的一步，请尝试道具。'); chrome.sound.play('hint'); }}><Icon name="bulb"/><span>提示</span></button>
            {(['hammer', 'swap', 'shuffle'] as const).map(name => <button key={name} className={`button tool-button m3-tool-${name}`} aria-pressed={tool === name} disabled={!canPlay || (!game.unlimitedTools && game.tools[name] <= 0)} onClick={() => {
              setSelected(null); setHint(null);
              if (name === 'shuffle') { act({ type: 'SHUFFLE' }); setTool(null); }
              else { setTool(tool === name ? null : name); setMessage(name === 'hammer' ? '请点要敲的格子；再次点小锤子可取消。' : '请点相邻的两个动物；可跨绳子，不扣步数。'); }
            }}><ToolIcon tool={name}/><span>{toolNames[name]}</span><b className="button-count">{game.unlimitedTools ? '不限' : game.tools[name]}</b></button>)}
          </div>
          <div className="toolbar-settings"><ChromeControls chrome={chrome} onHelp={() => { pause(); setHelp(true); }}/></div>
        </div>
        <div className="m3-summary">
          <button className="m3-level-title" onClick={() => { pause(); setPicker(true); }} aria-label="选择消消乐关卡"><span>{title}</span><h1>{game.level.title}</h1>{game.level.stages.length > 1 && <small>区域 {game.stageIndex + 1} / {game.level.stages.length}</small>}</button>
          <div className="m3-score">
            <span>积分 <strong aria-live="off">{displayedScore}</strong></span>
            <div className="m3-star-meter" role="img" aria-label={`当前 ${displayedScore} 分，一星 ${game.level.starThresholds[0]} 分，二星 ${game.level.starThresholds[1]} 分，三星 ${game.level.starThresholds[2]} 分，已获得 ${stars} 星`}>
              <div className="m3-star-meter-fill" style={{ width: `${Math.min(100, displayedScore / game.level.starThresholds[2] * 100)}%` }} />
              {game.level.starThresholds.map((threshold, index) => <span key={index} className={`m3-star-marker${index < stars ? ' m3-star-earned' : ''}`} style={{ left: `${threshold / game.level.starThresholds[2] * 100}%` }}>★</span>)}
            </div>
          </div>
          <div className={`m3-moves ${game.movesLeft <= 5 && !game.unlimitedMoves ? 'm3-moves-low' : ''}`}><span>剩余步数</span><strong>{game.unlimitedMoves ? '不限' : game.movesLeft}</strong></div>
          <div className="m3-goals" aria-label="通关目标">{goals.map(goal => <div className={`m3-goal ${(game.goalProgress[goal.id] ?? 0) >= goal.count ? 'm3-goal-done' : ''}`} key={goal.id} title={goalLabel(goal)} aria-label={`${goalLabel(goal)}，${Math.min(game.goalProgress[goal.id] ?? 0, goal.count)}/${goal.count}`}>
            <GoalArt goal={goal}/><div><span>{goalLabel(goal)}</span><b>{Math.min(game.goalProgress[goal.id] ?? 0, goal.count)} / {goal.count}</b></div>
          </div>)}</div>
        </div>
        {testing && <details className="m3-test-panel"><summary>{game.mode === 'editor' ? '试关中' : '测试中'} · 展开测试工具</summary><div>
          <label>关卡 <select aria-label="测试关卡" value={levelKey(game.level)} onChange={event => { const level = levels.find(item => levelKey(item) === event.target.value); if (level) start(level); }}>
            {game.mode === 'editor' && <option value={levelKey(game.level)}>当前草稿 · {game.level.title}</option>}{game.mode !== 'editor' && levels.map(level => <option value={levelKey(level)} key={levelKey(level)}>{level.title}</option>)}
          </select></label>
          <label><input type="checkbox" checked={game.unlimitedMoves} onChange={event => act({ type: 'UNLIMITED_MOVES', value: event.target.checked })}/>无限步数</label>
          <label><input type="checkbox" checked={game.unlimitedTools} onChange={event => act({ type: 'UNLIMITED_TOOLS', value: event.target.checked })}/>无限道具</label>
          <button className="button" disabled={!canPlay} onClick={() => act({ type: 'AUTO' })}>自动走一步</button>
          <button className="button" onClick={retry}>重开本关</button>
          <button className="button" disabled={!canPlay} onClick={() => act({ type: 'COMPLETE' })}>一键通关</button>
          <button className="button" disabled={!canPlay} onClick={() => act({ type: 'FAIL' })}>立即失败</button>
          <button className="button" onClick={exitTest}>{game.mode === 'editor' ? '返回编辑器' : '退出测试'}</button>
        </div></details>}
      </header>
      <Board game={game} frame={frame} selected={selected} hint={hint} disabled={!canPlay} onCell={cell} onSwap={swap}/>
      <div className="m3-message" role="status" aria-live="polite">{busy ? frame?.type === 'stage' ? '这一片完成了，看看下一片。' : '正在消除，请稍等…' : message || game.note || (tool === 'hammer' ? '请点要敲的格子。' : tool === 'swap' ? '请点相邻的两个动物，自由交换不扣步。' : '交换相邻的动物，横着或竖着三个相同就能消除。')}</div>
    </main>
    {saveBlocked && <Modal title="存档未能读取" onClose={goHome}><p>{loaded.warning}</p><div className="modal-actions"><button className="button" onClick={() => {
      try { const raw = window.localStorage.getItem(SAVE_KEY); if (raw) download('消消乐存档备份.json', raw); } catch { setWarning('浏览器不允许读取存档。'); }
    }}>导出原存档</button><button className="button primary" onClick={() => { saveBlockedRef.current = false; setSaveBlocked(false); }}>确认开始新局</button><button className="button" onClick={goHome}>返回首页</button></div></Modal>}
    {game.phase === 'paused' && !picker && !help && !saveBlocked && <Modal title={game.pauseReason === 'intro' ? `${game.level.title} · 准备好了吗` : '休息一下，慢慢来'}>
      <p>{game.pauseReason === 'intro' ? `不计时间，${game.level.moves}步内完成目标即可。三个道具各有${game.level.tools.hammer}次，使用不扣步。` : '棋盘、步数和道具都已停好，准备好了再继续。'}</p>
      <div className="m3-intro-goals">{goals.map(goal => <div key={goal.id}><GoalArt goal={goal}/><span>{goalLabel(goal)} {goal.count}</span></div>)}</div>
      {testing && <p className="m3-test-note">{game.mode === 'editor' ? '草稿试关' : '测试中'}，不会改变正常进度。</p>}
      <div className="modal-actions"><button className="button primary" autoFocus onClick={() => act({ type: 'RESUME' })}>继续游戏</button><button className="button home-button" onClick={goHome}>返回首页</button>{testing && <button className="button" onClick={exitTest}>{game.mode === 'editor' ? '返回编辑器' : '退出测试'}</button>}</div>
    </Modal>}
    {(game.phase === 'won' || game.phase === 'failed') && !busy && !picker && !help && <Modal title={game.phase === 'won' ? '真棒，这一关完成了！' : '步数用完了，再试一次吧'}>
      <p>{game.phase === 'won' ? '本关得分 ' + game.score + '，获得 ' + stars + ' 颗星。' : game.note || '不用担心，没有生命限制，随时可以重新挑战。'}</p>
      {testing && <p>本次是测试／试关，不记录正常通关。</p>}
      <div className="modal-actions">{game.phase === 'won' && nextLevel && game.mode !== 'editor' && <button className="button primary" onClick={() => start(nextLevel)}>下一关</button>}
        <button className="button restart-button" onClick={retry}>重新挑战</button><button className="button home-button" onClick={goHome}>返回首页</button>{testing && <button className="button" onClick={exitTest}>{game.mode === 'editor' ? '返回编辑器' : '退出测试'}</button>}</div>
    </Modal>}
    {picker && <Modal title={testing ? '测试选关 · 全部可用' : '选择消消乐关卡'} onClose={() => setPicker(false)} className="m3-picker-modal"><div className="m3-level-picker">{levels.map(level => {
      const unlocked = testing || isUnlocked(level, levels, progress.completed);
      const best = progress.bestStars[levelKey(level)] ?? 0;
      return <button className="button" key={levelKey(level)} disabled={!unlocked} onClick={() => chooseLevel(level)}><b>{level.title}</b><span>{level.width}列 · {level.moves}步{level.scroll ? ' · 多区域' : ''}</span><small>{unlocked ? progress.completed.includes(levelKey(level)) ? '已完成' : level.packId === builtinLevels[0].packId ? '内置关卡' : '自定义关卡' : '完成前一关后开启'}</small>{unlocked && <small aria-label={`最高 ${best} 颗星`}>{'★'.repeat(best)}{'☆'.repeat(3 - best)}</small>}</button>;
    })}</div></Modal>}
    {pendingLevel && <Modal title="开始这一关？" onClose={() => setPendingLevel(null)}><p>当前消消乐局面会换成新的一局，已完成的关卡会保留。</p><div className="modal-actions"><button className="button primary" onClick={() => start(pendingLevel)}>确认开始</button><button className="button" onClick={() => setPendingLevel(null)}>取消</button></div></Modal>}
    {help && <Modal title="消消乐怎么玩" onClose={() => setHelp(false)} className="m3-help-modal"><Help/><button className="button primary" onClick={() => setHelp(false)}>知道了</button></Modal>}
  </div>;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ToolIcon({ tool }: { tool: Tool }) {
  if (tool === 'shuffle') return <Icon name="refresh"/>;
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{tool === 'hammer' ? <><path d="m14 9-9 12-3-3L12 7m-2-3 4-3 8 7-4 5Z"/></> : <><path d="M3 7h17l-4-4m5 14H4l4 4M20 7l-4 4M4 17l4-4"/></>}</svg>;
}

function Help() {
  return <div className="m3-help-content">
    <p><b>先点一只，再点相邻的一只。</b>也可以短拖交换，或用方向键移动、空格/回车选择。横竖三个相同就能消除，没消成不扣步。只限步数，不计时间；提示也不扣步。</p>
    <h3>凑得多，效果更好</h3><p>横向4连变纵扫，纵向4连变横扫；L/T形变炸弹，炸中心及周围12格；直线5连变魔力鸟。全关目标完成后，未被冻结或覆盖的特效会自动连锁使用。</p>
    <p>两条直线交换清一行一列；直线＋炸弹清三行三列；两个炸弹清5×5。魔力鸟＋普通动物清同色；魔力鸟＋特效把同色未锁定动物变成同样特效再引爆；双鸟命中当前区域全部格子。</p>
    <h3>三个免费道具</h3><p>小锤子先去覆盖、敲一层冰雪，否则消除动物（也会引爆特效）。自由交换可换相邻动物，即使不成三连也可以，能跨绳子但不能动藤蔓/毛球。重排只移动没被锁住的动物。道具不扣步、不推进动态障碍；重试会重置道具。</p>
    <h3>认识九种障碍</h3><ul>
      <li><b>冰层：</b>1—3层，冻结上面的动物，不能交换、下落或重排；消除动物会减冰，小锤子敲冰时保留动物。</li>
      <li><b>雪块：</b>1—5层，旁边消除或被特效命中减一层。</li>
      <li><b>绳子：</b>横在公共边上，不能普通交换跨过；自由交换道具可以。</li>
      <li><b>藤蔓：</b>动物不能动，但能参加匹配；特效单独命中先去覆盖，不穿透引爆动物。</li>
      <li><b>礼盒：</b>旁边同图案消除或同色特效可以打开，得到盒内道具；锤子也能打开。</li>
      <li><b>传送门：</b>标着同一数字的入口/出口相连，只在下落时传送，出口堵住就等待。</li>
      <li><b>毒液：</b>旁边消除、特效或锤子可清。普通一步没清毒液时，它会扩张一次，吞掉旁边一只未锁动物。</li>
      <li><b>灰毛球：</b>盖住的动物不能动；匹配可一起消除，特效先去覆盖。每次有效普通回合后跳到旁边动物。</li>
      <li><b>水晶球：</b>旁边同图案消除，或特效/锤子可清；有效普通回合结束后改变自身图案。</li>
    </ul><p>同一波特效最多伤障碍一层，下一次下落连锁能再伤一层。整关目标完成后，未被冻结或覆盖的特效会自动连锁使用。长棋盘完成当前区域目标才自动向下；特效不会提前击中未展开区域。暂停或切换窗口时，一切停止。</p>
    <p>测试／破解模式与编辑器试关不写正常成绩。关卡管理可以画新关卡、导入和导出JSON；导出是下载文件，不会自动改项目目录。</p>
  </div>;
}
