import { useCallback, useEffect, useRef, useState } from 'react';
import { levels } from './engine/levels';
import { layoutNames } from './engine/layouts';
import { createGame, MATCH_BONUS_MS, transition, type Action, type GameState } from './game/machine';
import { encodeGame, loadGame, saveGame, type LoadResult } from './game/storage';
import { AnimalIcon } from './components/AnimalIcon';
import { Board } from './components/Board';
import { GameToolbar } from './components/GameToolbar';
import { GameDialogs } from './components/GameDialogs';
import { TestPanel } from './components/TestPanel';
import { Icon } from './components/Icon';
import { Modal } from './components/Modal';
import { SoundControls } from './components/SoundControls';
import { loadSoundPreferences, saveSoundPreferences, SoundPlayer, soundForTransition, type SoundPreferences } from './game/audio';

function readSaved(): LoadResult {
  try { return loadGame(window.localStorage); }
  catch { return { game: null, warning: '浏览器暂不支持保存；关闭页面后进度会丢失。' }; }
}

export default function App() {
  const [loaded] = useState(readSaved);
  const [normal, setNormal] = useState<GameState | null>(loaded.game);
  const [test, setTest] = useState<GameState | null>(null);
  const [view, setView] = useState<'home' | 'game'>('home');
  const [help, setHelp] = useState(false);
  const [levelPicker, setLevelPicker] = useState(false);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const autoFullscreenPending = useRef(!document.fullscreenElement);
  const [exitStage, setExitStage] = useState<'confirm' | 'blocked' | null>(null);
  const [exitSaved, setExitSaved] = useState(true);
  const [confirmLevel, setConfirmLevel] = useState<number | null>(null);
  const [warning, setWarning] = useState(loaded.warning);
  const [soundPreferences, setSoundPreferences] = useState(() => loadSoundPreferences());
  const [sound] = useState(() => new SoundPlayer(soundPreferences));
  const testing = test !== null;
  const game = test ?? normal;
  const dispatch = useCallback((action: Action) => {
    const update = (previous: GameState | null) => previous ? transition(previous, action, performance.now()) : null;
    if (testing) setTest(update); else setNormal(update);
  }, [testing]);
  const encoded = normal ? encodeGame(normal) : null;
  const previousSoundState = useRef(game);
  const changeSoundPreferences = (preferences: SoundPreferences) => {
    sound.configure(preferences);
    setSoundPreferences(preferences);
    saveSoundPreferences(preferences);
  };

  useEffect(() => {
    const previous = previousSoundState.current;
    previousSoundState.current = game;
    if (!previous || !game) return;
    const cue = soundForTransition(previous, game);
    if (cue) sound.play(cue);
  }, [game, sound]);
  useEffect(() => () => sound.dispose(), [sound]);
  useEffect(() => {
    const changed = () => {
      setFullscreen(!!document.fullscreenElement);
      if (document.fullscreenElement) autoFullscreenPending.current = false;
    };
    document.addEventListener('fullscreenchange', changed);
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const toggleFullscreen = async () => {
    autoFullscreenPending.current = false;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setWarning('浏览器未允许全屏，可按 F11 放大游戏窗口。'); }
  };

  useEffect(() => {
    if (!normal) return;
    try {
      if (!saveGame(window.localStorage, normal)) setWarning('浏览器无法保存进度，请不要关闭页面。');
    } catch { setWarning('浏览器无法保存进度，请不要关闭页面。'); }
  }, [encoded]);

  useEffect(() => {
    if (view !== 'game') return;
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
  }, [dispatch, view, sound]);

  const home = () => {
    dispatch({ type: 'PAUSE' });
    if (testing) setTest(null);
    setView('home');
  };
  const startNormal = (id: number) => {
    if (id > (normal?.unlocked ?? 1)) return;
    setNormal(createGame(id, 'normal', performance.now(), normal?.unlocked ?? 1));
    setConfirmLevel(null);
    setWarning(w => w.startsWith('旧存档') ? '' : w);
    setView('game');
  };
  const openLevel = (id: number) => {
    setLevelPicker(false);
    if (id === normal?.levelId) { setView('game'); return; }
    if (normal) setConfirmLevel(id); else startNormal(id);
  };
  const startTest = () => {
    setNormal(previous => previous ? transition(previous, { type: 'PAUSE' }, performance.now()) : null);
    setTest(createGame(1, 'test', performance.now()));
    setView('game');
  };
  const exitTest = () => { setTest(null); setView(normal ? 'game' : 'home'); };
  const requestExit = () => {
    autoFullscreenPending.current = false;
    const now = performance.now();
    const pausedNormal = normal ? transition(normal, { type: 'PAUSE' }, now) : null;
    setNormal(pausedNormal);
    if (test) setTest(transition(test, { type: 'PAUSE' }, now));
    let saved = true;
    if (pausedNormal) {
      try { saved = saveGame(window.localStorage, pausedNormal); }
      catch { saved = false; }
    }
    setExitSaved(saved);
    sound.stop();
    setHelp(false);
    setLevelPicker(false);
    setConfirmLevel(null);
    setExitStage('confirm');
  };
  const closeGame = () => {
    sound.stop();
    setExitStage('blocked');
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    window.close();
  };
  const seconds = Math.ceil((game?.remainingMs ?? 0) / 1000);
  const currentLevel = game ? levels[game.levelId - 1] : levels[0];
  const timePercent = Math.min(100, (game?.remainingMs ?? 0) / (currentLevel.seconds * 1000) * 100);
  const totalPairs = currentLevel.rows * currentLevel.cols / 2;
  const matchFeedback = game?.matchFeedback;
  const bonusFeedback = matchFeedback && <span key={game.moveIndex} className={`time-bonus${matchFeedback.addedMs === 0 ? ' time-bonus-full' : ''}`} role="status" data-testid="match-feedback">{matchFeedback.addedMs === MATCH_BONUS_MS ? '+3秒' : matchFeedback.addedMs > 0 ? '已补满' : '时间已满'}</span>;
  const fullscreenButton = document.fullscreenEnabled && <button className="text-button fullscreen-button" data-skip-auto-fullscreen aria-label={fullscreen ? '退出全屏' : '全屏显示'} onClick={toggleFullscreen}><Icon name="fullscreen" size={22} /><span className="full-label">{fullscreen ? '退出全屏' : '全屏'}</span><span className="short-label">{fullscreen ? '窗口' : '全屏'}</span></button>;
  const closeButton = <button className="text-button close-game" data-skip-auto-fullscreen aria-label="关闭游戏" onClick={requestExit}><Icon name="close" size={22} /><span className="full-label">关闭游戏</span><span className="short-label">关闭</span></button>;

  return <div className={`app ${view === 'game' ? 'in-game' : ''}`} onClickCapture={event => {
    const button = (event.target as Element).closest('button');
    if (!button || button.disabled) return;
    sound.unlock();
    if (autoFullscreenPending.current && document.fullscreenEnabled && !button.hasAttribute('data-skip-auto-fullscreen')) {
      autoFullscreenPending.current = false;
      if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {
        setWarning('浏览器未允许全屏，可按 F11 放大游戏窗口。');
      });
    }
    if (!button.classList.contains('tile') && !button.closest('[data-audio-control]')) sound.play('click');
  }}>
    {view === 'home' && <header className="site-header">
      <div className="brand"><span className="brand-mark"><Icon name="paw" size={28} /></span><span>慢慢连</span></div>
      <div className="header-right"><SoundControls preferences={soundPreferences} onChange={changeSoundPreferences} onPreview={() => sound.play('match')} /><button className="text-button help-button" onClick={() => setHelp(true)}><Icon name="help" />怎么玩</button><button className="text-button test-entry" onClick={startTest}>测试／破解模式</button>{fullscreenButton}{closeButton}</div>
    </header>}
    {warning && <div className="storage-warning" role="status">{warning}</div>}
    {view === 'home' ? <main className="home-main">
      <section className="home-card" aria-labelledby="home-title">
        <div className="home-icons" aria-hidden="true">{[0, 12, 21].map(kind => <span key={kind}><AnimalIcon kind={kind} /></span>)}</div>
        <h1 id="home-title">开心连连看</h1>
        <p className="home-rule">点两个相同图案，连起来就消除。</p>
        <button className="button primary start-button" onClick={() => normal ? setView('game') : startNormal(1)}><Icon name="play" size={30} />{normal ? '继续游戏' : '开始游戏'}</button>
        <div className="home-secondary"><button className="button home-button" onClick={() => setLevelPicker(true)}>选择关卡</button>{normal && <button className="button restart-button" onClick={() => setConfirmLevel(1)}>重新开始</button>}</div>
        <p className="save-caption">{normal ? `已保存第 ${normal.levelId} 关，随时可以接着玩。` : '点错不扣生命，慢慢找就好。'}</p>
        <button className="text-button exit-game" data-skip-auto-fullscreen onClick={requestExit}>退出游戏</button>
      </section>
    </main> : game && <main className="game-main">
      <div className="game-top">
        <GameToolbar game={game} dispatch={dispatch} onHome={home}>
          <SoundControls preferences={soundPreferences} onChange={changeSoundPreferences} onPreview={() => sound.play('match')} />
          <button className="text-button help-button" aria-label="怎么玩" onClick={() => { dispatch({ type: 'PAUSE' }); setHelp(true); }}><Icon name="help" size={22} /><span className="full-label">怎么玩</span><span className="short-label">玩法</span></button>
          {fullscreenButton}
          {closeButton}
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
      {!help && !exitStage && <GameDialogs game={game} dispatch={dispatch} onHome={home} onExit={requestExit} bonusFeedback={bonusFeedback} />}
    </main>}
    {levelPicker && <Modal title="选择关卡" onClose={() => setLevelPicker(false)}><div className="level-grid">{levels.map(level => {
      const unlocked = level.id <= (normal?.unlocked ?? 1);
      return <button key={level.id} className={`level-card ${level.id === (normal?.levelId ?? 1) ? 'current' : ''}`} disabled={!unlocked} onClick={() => openLevel(level.id)} aria-label={`第${level.id}关 ${level.name}${!unlocked ? '，待解锁' : ''}`}><strong>第 {level.id} 关</strong><span>{level.name}</span>{!unlocked && <Icon name="lock" size={18} />}</button>;
    })}</div><p className="level-help">过一关，就会解锁下一关。</p></Modal>}
    {help && <Modal title="三步就会，慢慢来" onClose={() => setHelp(false)}><div className="help-steps"><div><b>1</b><span><strong>找两个相同图案</strong>动物、水果、蔬菜都可以配对。</span></div><div><b>2</b><span><strong>路通了，就能消除</strong>连线最多拐两个弯，不能穿过其他图块，可以绕棋盘外侧。</span></div><div><b>3</b><span><strong>连对了，还能补时间</strong>每对最多补3秒，只补到本关初始时长；时间已满就不再加。清空70对就过关，点错不扣生命。</span></div></div><p className="help-note">时间用完或棋盘没有可连图案时，扣1生命；死局扣除后仍有生命就自动重排，生命用完则结束。每过一关，获得1生命、2提示、1加时；加时一次增加30秒。</p><button className="button primary wide" onClick={() => setHelp(false)}>明白了，轻松玩</button></Modal>}
    {confirmLevel !== null && <Modal title="开启一段新旅程？" onClose={() => setConfirmLevel(null)}><p>将从第 {confirmLevel} 关重新排列，生命、提示和加时重置为5、3、3。当前这一局会被替换，已解锁关卡仍保留。</p><button className="button restart-button wide" onClick={() => startNormal(confirmLevel)}>确定，开始新的一局</button><button className="text-button modal-secondary" onClick={() => setConfirmLevel(null)}>保留当前进度</button></Modal>}
    {exitStage && <Modal title={exitStage === 'confirm' ? '要退出游戏吗？' : '可以关闭这个页面了'} onClose={() => setExitStage(null)}>
      <p>{normal ? exitSaved ? '正常游戏进度已保存，下次打开可以接着玩。' : '这次没能保存进度，关闭页面后本次进度会丢失。' : '当前没有需要保存的正常游戏进度。'}{testing && <><br />测试模式的进度不会保存。</>}</p>
      {exitStage === 'blocked' && <p className="exit-instructions">浏览器未关闭此页。请按 <strong>Ctrl + W</strong>，或点击浏览器标签页上的关闭按钮。</p>}
      {exitStage === 'confirm' && <button className="button wide exit-game" data-skip-auto-fullscreen onClick={closeGame}>确定退出</button>}
      <button className={`button wide${exitStage === 'blocked' ? ' primary' : ' modal-secondary'}`} data-skip-auto-fullscreen onClick={() => setExitStage(null)}>{exitStage === 'confirm' ? '暂不退出' : '返回游戏'}</button>
    </Modal>}
  </div>;
}
