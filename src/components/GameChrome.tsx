import type { SoundPlayer, SoundPreferences } from '../game/audio';
import { SoundControls } from './SoundControls';
import { Icon } from './Icon';

export type GameChrome = {
  sound: SoundPlayer;
  preferences: SoundPreferences;
  onPreferences: (preferences: SoundPreferences) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  onExit: () => void;
  onHome: () => void;
  registerPause: (pauseAndSave: (() => boolean) | null) => void;
};

export function ChromeControls({ chrome, onHelp }: { chrome: GameChrome; onHelp: () => void }) {
  return <>
    <SoundControls preferences={chrome.preferences} onChange={chrome.onPreferences} onPreview={() => chrome.sound.play('match')} />
    <button className="text-button help-button" aria-label="怎么玩" onClick={onHelp}><Icon name="help" size={22} /><span className="full-label">怎么玩</span><span className="short-label">玩法</span></button>
    {document.fullscreenEnabled && <button className="text-button fullscreen-button" data-skip-auto-fullscreen aria-label={chrome.fullscreen ? '退出全屏' : '全屏显示'} onClick={chrome.onFullscreen}><Icon name="fullscreen" size={22} /><span className="full-label">{chrome.fullscreen ? '退出全屏' : '全屏'}</span><span className="short-label">{chrome.fullscreen ? '窗口' : '全屏'}</span></button>}
    <button className="text-button close-game" data-skip-auto-fullscreen aria-label="关闭游戏" onClick={chrome.onExit}><Icon name="close" size={22} /><span className="full-label">关闭游戏</span><span className="short-label">关闭</span></button>
  </>;
}
