import { loadGame, type LoadResult } from '../game/storage';
import type { GameState } from '../game/machine';

// Keep the paused normal session when the shared home unmounts this game,
// including when browser storage is unavailable. A page reload still uses the
// original LinkGame storage format and validation.
let session: LoadResult | undefined;

export function readLinkSession(): LoadResult {
  if (!session) {
    try { session = loadGame(window.localStorage); }
    catch { session = { game: null, warning: '浏览器暂不支持保存；关闭页面后进度会丢失。' }; }
  }
  return session;
}

export function rememberLinkSession(game: GameState | null, warning: string) {
  session = { game, warning };
}
