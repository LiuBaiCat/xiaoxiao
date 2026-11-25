import type { Cell, GameEvent } from '../engine/types';

export type AnimationFrame = GameEvent & { stageIndex: number };

export function animationFrames(events: GameEvent[], initial: Cell[], stageIndex: number): AnimationFrame[] {
  const frames: AnimationFrame[] = [];
  let previous = initial;
  for (const event of events) {
    if (event.type === 'stage') stageIndex++;
    const frame = { ...event, stageIndex, board: event.type === 'clear' || event.type === 'obstacle' ? previous : event.board };
    previous = event.board ?? previous;
    const last = frames[frames.length - 1];
    if (last && last.type === event.type && (event.type === 'fall' || event.type === 'spawn')) {
      frames[frames.length - 1] = { ...frame, cells: [...new Set([...last.cells, ...frame.cells])] };
    } else frames.push(frame);
  }
  return frames;
}
