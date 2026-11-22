import { levels } from '../engine/levels';
import type { Action, GameState } from '../game/machine';
import { Icon } from './Icon';

export function TestPanel({ game, dispatch, onLevel, onExit }: { game: GameState; dispatch: (action: Action) => void; onLevel: (id: number) => void; onExit: () => void }) {
  const blocked = game.phase !== 'playing';
  return <details className="test-panel">
    <summary aria-label="测试工具"><Icon name="settings" size={18} />测试模式 · 展开工具<span>不影响正常存档</span></summary>
    <div className="test-controls">
      <label className="level-select">关卡<select value={game.levelId} onChange={e => onLevel(Number(e.target.value))} aria-label="测试关卡">{levels.map(level => <option key={level.id} value={level.id}>{level.id}. {level.name}</option>)}</select></label>
      <label className="toggle-label"><input type="checkbox" checked={game.frozen} onChange={e => dispatch({ type: 'FREEZE', value: e.target.checked })} />冻结时间</label>
      <label className="toggle-label"><input type="checkbox" checked={game.unlimited} onChange={e => dispatch({ type: 'UNLIMITED', value: e.target.checked })} />无限道具</label>
      <button className="button small" disabled={blocked || !!game.animation} onClick={() => dispatch({ type: 'AUTO_PAIR' })}>消除一对</button>
      <button className="button small" disabled={blocked} onClick={() => dispatch({ type: 'COMPLETE' })}>一键通关</button>
      <button className="button small" disabled={blocked} onClick={() => dispatch({ type: 'EXPIRE' })}>立即超时</button>
      <button className="button small" onClick={onExit}>退出测试</button>
    </div>
  </details>;
}
