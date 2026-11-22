import { Icon } from './Icon';
import type { SoundPreferences } from '../game/audio';

export function SoundControls({ preferences, onChange, onPreview }: {
  preferences: SoundPreferences;
  onChange: (preferences: SoundPreferences) => void;
  onPreview: () => void;
}) {
  const quiet = preferences.muted || preferences.volume === 0;
  return <div className="sound-controls" data-audio-control>
    <button className="text-button sound-toggle" aria-label={quiet ? '开启音效' : '关闭音效'} aria-pressed={!quiet} onClick={() => {
      onChange({ muted: !quiet, volume: preferences.volume || 0.45 });
      if (quiet) onPreview();
    }}><Icon name={quiet ? 'muted' : 'volume'} size={22} /><span>{quiet ? '音效关' : '音效开'}</span></button>
    <details className="volume-settings">
      <summary aria-label="调节音量">音量 {Math.round(preferences.volume * 100)}%</summary>
      <div className="volume-popover">
        <label htmlFor="sound-volume">音量 <strong>{Math.round(preferences.volume * 100)}%</strong></label>
        <input id="sound-volume" aria-label="音效音量" type="range" min="0" max="100" step="5" value={Math.round(preferences.volume * 100)}
          onChange={event => onChange({ ...preferences, volume: Number(event.target.value) / 100 })} />
        <button className="button small" onClick={onPreview} disabled={quiet}><Icon name="play" size={18} />试听音效</button>
        <small>温和短音，不播放背景音乐</small>
      </div>
    </details>
  </div>;
}
