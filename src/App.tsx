import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimalIcon } from './components/AnimalIcon';
import { ChromeControls, type GameChrome } from './components/GameChrome';
import { Icon } from './components/Icon';
import { Modal } from './components/Modal';
import { loadSoundPreferences, saveSoundPreferences, SoundPlayer, type SoundPreferences } from './game/audio';
import LinkGame from './link/LinkGame';
import { LinkHelp } from './link/LinkHelp';
import { readLinkSession } from './link/session';
import Match3Game from './match3/view/Match3Game';

type Route = { game: 'link'; entry: 'continue' | 'levels' | 'test' } | { game: 'match3'; entry: 'continue' | 'levels' | 'test' | 'editor' } | null;

function readMatchSummary() {
  try {
    const raw = window.localStorage.getItem('slow-paws-match3:save:v1');
    const saved = raw ? JSON.parse(raw) : null;
    if (saved?.version !== 1) return { hasSave: false, completed: 0 };
    return {
      hasSave: !!saved.game && typeof saved.game === 'object' && !Array.isArray(saved.game) && saved.game.mode !== 'test',
      completed: Array.isArray(saved.completed) ? new Set(saved.completed.filter((id: unknown) => typeof id === 'string')).size : 0,
    };
  } catch { return { hasSave: false, completed: 0 }; }
}

export default function App() {
  const [route, setRoute] = useState<Route>(null);
  const [help, setHelp] = useState(false);
  const [testChooser, setTestChooser] = useState(false);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const autoFullscreenPending = useRef(!document.fullscreenElement);
  const [fullscreenWarning, setFullscreenWarning] = useState('');
  const [saveWarning, setSaveWarning] = useState('');
  const [exitStage, setExitStage] = useState<'confirm' | 'blocked' | null>(null);
  const [exitSaved, setExitSaved] = useState(true);
  const [exitHasNormal, setExitHasNormal] = useState(false);
  const lastPauseSaved = useRef(true);
  const pauseActive = useRef<(() => boolean) | null>(null);
  const [preferences, setPreferences] = useState(() => loadSoundPreferences());
  const [sound] = useState(() => new SoundPlayer(preferences));
  const link = readLinkSession();
  const match3 = readMatchSummary();
  const warning = fullscreenWarning || saveWarning || (!route ? link.warning : '');

  const onPreferences = useCallback((next: SoundPreferences) => {
    sound.configure(next);
    setPreferences(next);
    saveSoundPreferences(next);
  }, [sound]);
  const registerPause = useCallback((pauseAndSave: (() => boolean) | null) => { pauseActive.current = pauseAndSave; }, []);
  const pauseAndSave = useCallback(() => {
    try { if (pauseActive.current) lastPauseSaved.current = pauseActive.current(); }
    catch { lastPauseSaved.current = false; }
    sound.stop();
    setSaveWarning(lastPauseSaved.current ? '' : '浏览器无法保存进度，请不要关闭页面。');
    return lastPauseSaved.current;
  }, [sound]);
  const onHome = useCallback(() => {
    pauseAndSave();
    setRoute(null);
  }, [pauseAndSave]);
  const onExit = useCallback(() => {
    autoFullscreenPending.current = false;
    setExitSaved(pauseAndSave());
    setExitHasNormal(!!readLinkSession().game || readMatchSummary().hasSave || route?.entry === 'continue');
    setHelp(false);
    setTestChooser(false);
    setExitStage('confirm');
  }, [pauseAndSave, route]);

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
  const onFullscreen = async () => {
    autoFullscreenPending.current = false;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setFullscreenWarning('浏览器未允许全屏，可按 F11 放大游戏窗口。'); }
  };
  const closeGame = () => {
    sound.stop();
    setExitStage('blocked');
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    window.close();
  };
  const enter = (next: Exclude<Route, null>) => {
    setHelp(false);
    setTestChooser(false);
    setRoute(next);
  };
  const chrome: GameChrome = { sound, preferences, onPreferences, fullscreen, onFullscreen, onExit, onHome, registerPause };

  return <div className={`app${route ? ' in-game' : ''}${warning ? ' has-shell-warning' : ''}`} onClickCapture={event => {
    const button = (event.target as Element).closest('button');
    if (!button || button.disabled) return;
    sound.unlock();
    if (autoFullscreenPending.current && document.fullscreenEnabled && !button.hasAttribute('data-skip-auto-fullscreen')) {
      autoFullscreenPending.current = false;
      if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {
        setFullscreenWarning('浏览器未允许全屏，可按 F11 放大游戏窗口。');
      });
    }
    if (!button.classList.contains('tile') && !button.closest('[data-audio-control], [role="grid"], [data-game-board]')) sound.play('click');
  }}>
    {!route && <header className="site-header">
      <div className="brand"><span className="brand-mark"><Icon name="paw" size={28} /></span><span>慢慢玩</span></div>
      <div className="header-right"><ChromeControls chrome={chrome} onHelp={() => setHelp(true)} /></div>
    </header>}
    {warning && <div className="storage-warning" role="status">{warning}</div>}
    {!route ? <main className="home-main shared-home">
      <div className="home-intro"><h1>选个喜欢的，开心玩一会儿</h1><p>大图案，慢慢来。两款游戏的进度分别保存。</p></div>
      <div className="home-games">
        <section className="home-card game-card link-card" aria-labelledby="link-home-title" data-game-card="link">
          <div className="home-icons" aria-hidden="true">{[0, 12, 21].map(kind => <span key={kind}><AnimalIcon kind={kind} /></span>)}</div>
          <h2 id="link-home-title">开心连连看</h2>
          <p className="home-rule">点两个相同图案，连起来就消除。</p>
          <button className="button primary start-button" onClick={() => enter({ game: 'link', entry: 'continue' })}><Icon name="play" size={30} />{link.game ? '继续游戏' : '开始游戏'}</button>
          <div className="home-secondary"><button className="button home-button" onClick={() => enter({ game: 'link', entry: 'levels' })}>选择关卡</button></div>
          <p className="save-caption">{link.game ? `已保存第 ${link.game.levelId} 关 · 已解锁 ${link.game.unlocked} / 12 关` : '12关 · 点错不扣生命'}</p>
        </section>
        <section className="home-card game-card match-card" aria-labelledby="match-home-title" data-game-card="match3">
          <div className="home-icons match-home-icons" aria-hidden="true">{[12, 12, 12].map((kind, index) => <span key={index}><AnimalIcon kind={kind} /></span>)}</div>
          <h2 id="match-home-title">开心消消乐</h2>
          <p className="home-rule">交换相邻图案，三个相同就消除。</p>
          <button className="button primary start-button" onClick={() => enter({ game: 'match3', entry: 'continue' })}><Icon name="play" size={30} />{match3.hasSave ? '继续游戏' : '开始游戏'}</button>
          <div className="home-secondary"><button className="button home-button" onClick={() => enter({ game: 'match3', entry: 'levels' })}>选择关卡</button></div>
          <p className="save-caption">{match3.hasSave ? '进度已保存 · ' : ''}{match3.completed ? `已完成 ${match3.completed} 关 · 不限时` : '20关 · 不限时'}</p>
        </section>
      </div>
      <nav className="home-utilities" aria-label="更多功能">
        <button className="text-button" onClick={() => enter({ game: 'match3', entry: 'editor' })}><Icon name="settings" size={22} />关卡管理</button>
        <button className="text-button test-entry" onClick={() => setTestChooser(true)}>测试／破解模式</button>
        <button className="text-button exit-game" data-skip-auto-fullscreen onClick={onExit}>退出游戏</button>
      </nav>
    </main> : <div className="game-view" aria-hidden={exitStage ? true : undefined} inert={!!exitStage}>
      {route.game === 'link' ? <LinkGame chrome={chrome} entry={route.entry} /> : <Match3Game chrome={chrome} entry={route.entry} />}
    </div>}
    {help && <LinkHelp showMatch3 onClose={() => setHelp(false)} />}
    {testChooser && <Modal title="选择测试游戏" onClose={() => setTestChooser(false)}>
      <p>测试不会替换正常游戏进度。</p>
      <div className="test-game-choices"><button className="button primary wide" onClick={() => enter({ game: 'link', entry: 'test' })}>测试连连看</button><button className="button wide" onClick={() => enter({ game: 'match3', entry: 'test' })}>测试消消乐</button></div>
    </Modal>}
    {exitStage && <Modal title={exitStage === 'confirm' ? '要退出游戏吗？' : '可以关闭这个页面了'} onClose={() => setExitStage(null)}>
      <p>{!exitSaved ? '这次没能保存进度，关闭页面后本次进度会丢失。' : exitHasNormal ? '正常游戏进度已保存，下次打开可以接着玩。' : '当前没有需要保存的正常游戏进度。'}{route?.entry === 'test' && <><br />测试模式的进度不会保存。</>}</p>
      {exitStage === 'blocked' && <p className="exit-instructions">浏览器未关闭此页。请按 <strong>Ctrl + W</strong>，或点击浏览器标签页上的关闭按钮。</p>}
      {exitStage === 'confirm' && <button className="button wide exit-game" data-skip-auto-fullscreen onClick={closeGame}>确定退出</button>}
      <button className={`button wide${exitStage === 'blocked' ? ' primary' : ' modal-secondary'}`} data-skip-auto-fullscreen onClick={() => setExitStage(null)}>{exitStage === 'confirm' ? '暂不退出' : '返回游戏'}</button>
    </Modal>}
  </div>;
}
