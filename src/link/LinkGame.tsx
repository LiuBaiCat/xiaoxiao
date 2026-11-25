import { useCallback, useEffect, useRef, useState } from 'react';
import { levels } from '../engine/levels';
import { layoutNames } from '../engine/layouts';
import { createGame, MATCH_BONUS_MS, transition, type Action, type GameState } from '../game/machine';
import { encodeGame, saveGame } from '../game/storage';
import { Board } from '../components/Board';
import { GameToolbar } from '../components/GameToolbar';
import { GameDialogs } from '../components/GameDialogs';
import { TestPanel } from '../components/TestPanel';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { ChromeControls, type GameChrome } from '../components/GameChrome';
import { soundForTransition } from '../game/audio';
import { LinkHelp } from './LinkHelp';
import { readLinkSession, rememberLinkSession } from './session';

export default function LinkGame({ chrome, entry }: { chrome: GameChrome; entry: 'continue' | 'levels' | 'test' }) {
  const [loaded] = useState(readLinkSession);
  const [normal, setNormal] = useState<GameState | null>(() => loaded.game ?? (entry === 'continue' ? createGame(1, 'normal', performance.now()) : null));
  const [test, setTest] = useState<GameState | null>(() => entry === 'test' ? createGame(1, 'test', performance.now()) : null);
  const [showGame, setShowGame] = useState(entry !== 'levels');
  const [help, setHelp] = useState(false);
  const [levelPicker, setLevelPicker] = useState(entry === 'levels');
  const [confirmLevel, setConfirmLevel] = useState<number | null>(null);
  const [warning, setWarning] = useState(entry === 'continue' && !loaded.game && loaded.warning.startsWith('旧存档') ? '' : loaded.warning);
  const { sound, registerPause } = chrome;
  const testing = test !== null;
  const game = test ?? normal;
  const normalRef = useRef(normal);
  const testRef = useRef(test);
  normalRef.current = normal;
  testRef.current = test;
  const dispatch = useCallback((action: Action) => {
    const update = (previous: GameState | null) => previous ? transition(previous, action, performance.now()) : null;
    if (testing) setTest(update); else setNormal(update);
  }, [testing]);
  const encoded = normal ? encodeGame(normal) : null;
  const lastSaved = useRef(loaded.game ? encodeGame(loaded.game) : null);
  const previousSoundState = useRef(game);

  useEffect(() => {
    const previous = previousSoundState.current;
    previousSoundState.current = game;
    if (!previous || !game) return;
    const cue = soundForTransition(previous, game);
    if (cue) sound.play(cue);
  }, [game, sound]);

  useEffect(() => { rememberLinkSession(normal, warning); }, [normal, warning]);
  useEffect(() => {
    // Merely opening the level picker or test mode must not replace a save.
    if (!normal || encoded === lastSaved.current) return;
    try {
      if (saveGame(window.localStorage, normal)) lastSaved.current = encoded;
      else setWarning('浏览器无法保存进度，请不要关闭页面。');
    } catch { setWarning('浏览器无法保存进度，请不要关闭页面。'); }
  }, [encoded, normal]);

  const pauseAndSave = useCallback(() => {
    if (!showGame) return !normalRef.current || !warning.startsWith('浏览器无法保存');
    const now = performance.now();
    const pausedNormal = normalRef.current ? transition(normalRef.current, { type: 'PAUSE' }, now) : null;
    normalRef.current = pausedNormal;
    setNormal(pausedNormal);
    if (testRef.current) {
      const pausedTest = transition(testRef.current, { type: 'PAUSE' }, now);
      testRef.current = pausedTest;
      setTest(pausedTest);
    }
    sound.stop();
    setHelp(false);
    let saved = true;
    if (pausedNormal) {
      try { saved = saveGame(window.localStorage, pausedNormal); }
      catch { saved = false; }
      if (saved) lastSaved.current = encodeGame(pausedNormal);
    }
    const nextWarning = saved ? warning : '浏览器无法保存进度，请不要关闭页面。';
    if (!saved) setWarning(nextWarning);
    rememberLinkSession(pausedNormal, nextWarning);
    return saved;
  }, [showGame, sound, warning]);

  useEffect(() => {
    registerPause(pauseAndSave);
    return () => registerPause(null);
  }, [pauseAndSave, registerPause]);

  useEffect(() => {
    if (!showGame) return;
    const timer = window.setInterval(() => dispatch({ type: 'TICK' }), 150);
    const pause = () => { sound.stop(); dispatch({ type: 'PAUSE', reason: 'away' }); };
    const visibility = () => { if (document.hidden) pause(); };
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [dispatch, showGame, sound]);

  const startNormal = (id: number) => {
    if (id > (normal?.unlocked ?? 1)) return;
    setNormal(createGame(id, 'normal', performance.now(), normal?.unlocked ?? 1));
    setConfirmLevel(null);
    setWarning(w => w.startsWith('旧存档') ? '' : w);
    setShowGame(true);
  };
  const openLevel = (id: number) => {
    setLevelPicker(false);
    if (id === normal?.levelId) { setShowGame(true); return; }
    if (normal) setConfirmLevel(id); else startNormal(id);
  };
  const exitTest = () => {
    setTest(null);
    if (!normal) chrome.onHome();
  };
  const seconds = Math.ceil((game?.remainingMs ?? 0) / 1000);
  const currentLevel = game ? levels[game.levelId - 1] : levels[0];
  const timePercent = Math.min(100, (game?.remainingMs ?? 0) / (currentLevel.seconds * 1000) * 100);
  const totalPairs = currentLevel.rows * currentLevel.cols / 2;
  const matchFeedback = game?.matchFeedback;
  const bonusFeedback = matchFeedback && <span key={game.moveIndex} className={`time-bonus${matchFeedback.addedMs === 0 ? ' time-bonus-full' : ''}`} role="status" data-testid="match-feedback">{matchFeedback.addedMs === MATCH_BONUS_MS ? '+3秒' : matchFeedback.addedMs > 0 ? '已补满' : '时间已满'}</span>;

  return <>
    {warning && <div className="storage-warning link-warning" role="status">{warning}</div>}
    {showGame && game ? <main className="game-main">
      <div className="game-top">
        <GameToolbar game={game} dispatch={dispatch} onHome={chrome.onHome}>
          <ChromeControls chrome={chrome} onHelp={() => { dispatch({ type: 'PAUSE' }); setHelp(true); }} />
        </GameToolbar>
        {testing && <TestPanel game={game} dispatch={dispatch} onExit={exitTest} onLevel={id => setTest(previous => ({ ...createGame(id, 'test', performance.now()), frozen: previous?.frozen ?? true, unlimited: previous?.unlimited ?? true }))} />}
        <div className="game-stats">
          <div className="level-title"><span className="level-pill">第 {game.levelId} 关</span><h1>{currentLevel.name}</h1><span className="layout-label">{layoutNames[currentLevel.layouts[game.moveIndex % currentLevel.layouts.length]]}</span></div>
          <div className={`time-stat${seconds <= 30 ? ' time-low' : ''}`}><Icon name="clock" size={24} /><div className="time-meter"><div className="time-track"><div className="time-progress" role="progressbar" aria-label={game.frozen ? '时间冻结' : '剩余时间'} aria-valuemin={0} aria-valuemax={Math.max(currentLevel.seconds, seconds)} aria-valuenow={seconds} aria-valuetext={`还剩${seconds}秒${game.frozen ? '，时间冻结' : ''}`}><span className="time-fill" style={{ width: `${timePercent}%` }}>{matchFeedback && matchFeedback.addedMs > 0 && <span key={game.moveIndex} className="time-surge" aria-hidden="true" />}</span></div>{game.phase === 'playing' && bonusFeedback}</div><span className="timer-caption">{game.frozen ? '冻结 ' : '还剩 '}<span data-testid="timer">{seconds}秒</span></span></div></div>
          <div className="progress-stat"><span className="stat-label">已消除</span><strong data-testid="pair-count">{game.moveIndex}<span> / {totalPairs} 对</span></strong></div>
          <div className="life-stat"><span className="heart-symbol"><Icon name="heart" size={24} /></span><span className="stat-label">生命</span><strong data-testid="lives">{game.resources.lives}</strong></div>
        </div>
      </div>
      <div className="game-board-wrap"><Board game={game} dispatch={dispatch} /></div>
      <div className="game-message" aria-live="polite">{game.note}</div>
      {!help && <GameDialogs game={game} dispatch={dispatch} onHome={chrome.onHome} onExit={chrome.onExit} bonusFeedback={bonusFeedback} />}
    </main> : <main className="link-selection"><h1>开心连连看</h1><p>选一关，慢慢找伙伴。</p><button className="button home-button" onClick={chrome.onHome}><Icon name="home" />返回首页</button></main>}
    {levelPicker && <Modal title="选择关卡" onClose={chrome.onHome}><div className="level-grid">{levels.map(level => {
      const unlocked = level.id <= (normal?.unlocked ?? 1);
      return <button key={level.id} className={`level-card ${level.id === (normal?.levelId ?? 1) ? 'current' : ''}`} disabled={!unlocked} onClick={() => openLevel(level.id)} aria-label={`第${level.id}关 ${level.name}${!unlocked ? '，待解锁' : ''}`}><strong>第 {level.id} 关</strong><span>{level.name}</span>{!unlocked && <Icon name="lock" size={18} />}</button>;
    })}</div><p className="level-help">过一关，就会解锁下一关。</p>{normal && <button className="button restart-button modal-secondary" onClick={() => { setLevelPicker(false); setConfirmLevel(1); }}>重新开始</button>}</Modal>}
    {help && <LinkHelp onClose={() => setHelp(false)} />}
    {confirmLevel !== null && <Modal title="开启一段新旅程？" onClose={chrome.onHome}><p>将从第 {confirmLevel} 关重新排列，生命、提示和加时重置为5、3、3。当前这一局会被替换，已解锁关卡仍保留。</p><button className="button restart-button wide" onClick={() => startNormal(confirmLevel)}>确定，开始新的一局</button><button className="text-button modal-secondary" onClick={chrome.onHome}>保留当前进度</button></Modal>}
  </>;
}
