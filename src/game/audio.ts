import type { GameState } from './machine';

export type SoundName = 'click' | 'select' | 'match' | 'failure' | 'win' | 'gameover' | 'timeout' | 'hint' | 'extend' | 'pause' | 'resume' | 'warning';
export type SoundPreferences = { muted: boolean; volume: number };
export type Tone = { frequency: number; offset: number; duration: number; gain: number; type: OscillatorType };
export const SOUND_KEY = 'slow-paws-link:sound:v1';
const notes = (frequencies: number[], spacing = 0.11, duration = 0.18, gain = 0.18): Tone[] =>
  frequencies.map((frequency, index) => ({ frequency, offset: index * spacing, duration, gain, type: 'sine' }));

export const soundCues: Record<SoundName, Tone[]> = {
  click: notes([660], 0, 0.065, 0.12),
  select: notes([587.33], 0, 0.11, 0.18),
  match: notes([523.25, 659.25, 783.99], 0.075, 0.18),
  failure: notes([293.66, 246.94], 0.13, 0.17, 0.15),
  win: notes([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5], 0.13, 0.3, 0.19),
  gameover: notes([392, 329.63, 261.63], 0.19, 0.32, 0.17),
  timeout: notes([349.23, 293.66, 349.23], 0.15, 0.18, 0.16),
  hint: notes([739.99, 987.77], 0.12, 0.2, 0.17),
  extend: notes([440, 554.37, 659.25], 0.1, 0.22, 0.17),
  pause: notes([440, 349.23], 0.09, 0.13, 0.12),
  resume: notes([349.23, 440], 0.09, 0.13, 0.12),
  warning: notes([440, 440], 0.25, 0.13, 0.13),
};

export function soundForTransition(previous: GameState, next: GameState): SoundName | null {
  if (previous.mode !== next.mode || previous.levelId !== next.levelId) return null;
  if (next.phase !== previous.phase) {
    if (next.phase === 'won') return 'win';
    if (next.phase === 'gameover') return 'gameover';
    if (next.phase === 'timeout') return 'timeout';
    if (next.phase === 'playing') return 'resume';
    if (next.phase === 'paused' && next.pauseReason === 'manual') return 'pause';
  }
  if (next.phase !== 'playing') return null;
  if (next.moveIndex > previous.moveIndex) return 'match';
  if (next.remainingMs - previous.remainingMs > 29000) return 'extend';
  if (next.hint && next.hint !== previous.hint) return 'hint';
  if (next.selected !== previous.selected) {
    if (previous.selected && next.selected) return 'failure';
    if (next.selected) return 'select';
    if (previous.selected) return 'click';
  }
  if (!next.frozen && previous.remainingMs > 30000 && next.remainingMs <= 30000) return 'warning';
  return null;
}

export function loadSoundPreferences(storage?: Pick<Storage, 'getItem'>): SoundPreferences {
  const fallback = { muted: false, volume: 0.45 };
  try {
    const raw = (storage ?? window.localStorage).getItem(SOUND_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    return typeof saved?.muted === 'boolean' && typeof saved.volume === 'number' && Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 1
      ? { muted: saved.muted, volume: saved.volume } : fallback;
  } catch { return fallback; }
}

export function saveSoundPreferences(preferences: SoundPreferences): void {
  try { window.localStorage.setItem(SOUND_KEY, JSON.stringify(preferences)); } catch { /* Sound still works without storage. */ }
}

export class SoundPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Set<{ oscillator: OscillatorNode; envelope: GainNode }>();

  constructor(private preferences: SoundPreferences, private createContext = () => new AudioContext()) {}

  configure(preferences: SoundPreferences): void {
    this.preferences = preferences;
    if (preferences.muted || preferences.volume === 0) this.stop();
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(preferences.muted ? 0 : preferences.volume, this.context.currentTime);
    }
  }

  unlock(): boolean {
    if (this.preferences.muted || this.preferences.volume === 0) return false;
    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = this.createContext();
        this.master = this.context.createGain();
        this.master.gain.setValueAtTime(this.preferences.volume, this.context.currentTime);
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
      return true;
    } catch { return false; }
  }

  play(name: SoundName): void {
    if (!this.unlock()) return;
    const context = this.context!;
    for (const tone of soundCues[name]) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const voice = { oscillator, envelope };
      const start = context.currentTime + 0.008 + tone.offset;
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(tone.gain, start + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
      envelope.gain.setValueAtTime(0, start + tone.duration + 0.01);
      oscillator.connect(envelope);
      envelope.connect(this.master!);
      this.voices.add(voice);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        this.voices.delete(voice);
      };
      oscillator.start(start);
      oscillator.stop(start + tone.duration + 0.02);
    }
  }

  stop(): void {
    for (const voice of this.voices) {
      voice.oscillator.onended = null;
      try { voice.oscillator.stop(); } catch { /* An ended voice needs only disconnecting. */ }
      voice.oscillator.disconnect();
      voice.envelope.disconnect();
    }
    this.voices.clear();
  }

  dispose(): void {
    this.stop();
    this.master?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
  }
}
