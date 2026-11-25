import { AnimalIcon, animals } from '../../components/AnimalIcon';
import type { Cell, Goal, Obstacle, Special } from '../engine/types';
import { obstacleNames, specialNames } from '../engine/types';

export function SpecialArt({ special }: { special: Special }) {
  return <svg className={`m3-special m3-special-${special}`} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {special === 'row' && <><path d="M5 32h54M14 23l-9 9 9 9m36-18 9 9-9 9" stroke="#fff" strokeWidth="8"/><path d="M5 32h54M14 23l-9 9 9 9m36-18 9 9-9 9"/></>}
    {special === 'column' && <><path d="M32 5v54M23 14l9-9 9 9M23 50l9 9 9-9" stroke="#fff" strokeWidth="8"/><path d="M32 5v54M23 14l9-9 9 9M23 50l9 9 9-9"/></>}
    {special === 'bomb' && <><path d="m32 5 7 15 17-3-8 16 12 11-18 1-10 15-6-16-19-2 13-12-7-16 17 4Z" fill="#fff4b1" stroke="#996014"/><circle cx="33" cy="34" r="10" fill="#d18a37" stroke="#80502a"/></>}
    {special === 'bird' && <><path d="M12 38Q5 17 25 20L32 8l7 12q21-3 13 19l-8 13H20Z" fill="#9b7ccc" stroke="#584177"/><path d="m23 51-8 9m26-9 8 9m-33-32-10-7m42 7 10-7" stroke="#4d769d"/><circle cx="24" cy="31" r="4" fill="#fff" stroke="none"/><circle cx="40" cy="31" r="4" fill="#fff" stroke="none"/><path d="m27 39 5 6 5-6Z" fill="#f8d27a" stroke="#97693a"/><path d="m21 10 2-6m20 6-2-6M8 45l-5 2m53-2 5 2" stroke="#c29b40"/></>}
  </svg>;
}

export function ObstacleArt({ type, color = 0 }: { type: Obstacle; color?: number }) {
  return <svg className={`m3-obstacle m3-obstacle-${type}`} viewBox="0 0 64 64" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type === 'ice' && <><path d="m12 5 40 3 7 43-15 10-39-9Z" fill="#d5f0fb77" stroke="#5487ab"/><path d="m8 19 10-5 5 5m31 22-9 9-8-3M20 53l5-7m22-34-9 11" stroke="#74aec9"/></>}
    {type === 'snow' && <><rect x="7" y="9" width="50" height="48" rx="10" fill="#dae9ed" stroke="#668397"/><path d="M7 25q8 7 16 0t16 0 18 0V15Q53 6 44 10 32 2 23 10 10 5 7 16Z" fill="#fff" stroke="#8097a2"/><path d="M17 39h30m-28 9h26" stroke="#9ab6c3"/></>}
    {type === 'vine' && <><path d="M5 6q30 19 7 48m47-49Q32 32 52 59M4 33q28 26 55 0" stroke="#466b32" strokeWidth="5"/><path d="M9 14 21 7 23 19ZM8 44l12 2-8 10m33-37 10-9 3 13M39 46l7 12-11-1" fill="#85a95a" stroke="#466b32"/></>}
    {type === 'gift' && <><rect x="10" y="23" width="44" height="35" rx="4" fill={animals[color].color} stroke="#805c42"/><rect x="6" y="16" width="52" height="13" rx="4" fill={animals[color].background} stroke="#805c42"/><path d="M28 17Q7-6 13 9q2 10 19 8 17 2 19-8 6-15-19 8m0 1v39" stroke="#fff1bb" strokeWidth="6"/><path d="M32 19v38" stroke="#805c42" strokeWidth="2"/></>}
    {type === 'poison' && <><path d="M8 27Q7 11 23 15q9-18 19-2 21-5 16 18 9 20-12 25-14 10-27 0Q0 58 6 42-2 33 8 27Z" fill="#9488b5" stroke="#665584"/><circle cx="21" cy="30" r="5" fill="#c9bfdb" stroke="#756094"/><circle cx="43" cy="22" r="3" fill="#e5dfec"/><path d="m29 43 12-12m-12 0 12 12" stroke="#4b3b66"/></>}
    {type === 'fur' && <><path d="m7 25-3-7 10-1 2-10 9 5 8-9 7 9 12-4 1 11 10 5-7 9 4 13-12 2-5 13-12-7-11 6-4-12-12-4 7-10Z" fill="#aeb4b8ee" stroke="#626e76"/><circle cx="23" cy="29" r="4" fill="#fff" stroke="#5c6870"/><circle cx="40" cy="29" r="4" fill="#fff" stroke="#5c6870"/><path d="M25 44q8-7 14 0M13 22l6 4m29-4-4 4" stroke="#5c6870"/></>}
    {type === 'crystal' && <><path d="m20 5 24 0 16 23-11 29-32 0L4 28Z" fill={animals[color].background} stroke="#6885a4"/><path d="m20 5-5 22 10 29m19-51 7 22-11 29M4 28h56M20 5l12 23L44 5M17 57l15-29 17 29" stroke="#a4b4cd"/><circle cx="32" cy="29" r="15" fill={animals[color].color} stroke="#6885a4"/></>}
  </svg>;
}

export function CellArt({ cell }: { cell: Cell }) {
  const blocker = cell.blocker;
  return <>
    {cell.piece && (cell.piece.special === 'bird' ? <SpecialArt special="bird"/> : <AnimalIcon kind={cell.piece.kind}/>)}
    {cell.piece?.special && cell.piece.special !== 'bird' && <SpecialArt special={cell.piece.special}/>}
    {blocker && <ObstacleArt type={blocker.type} color={blocker.type === 'gift' ? blocker.color : blocker.type === 'crystal' ? blocker.colors[blocker.index] : 0}/>}
    {(blocker?.type === 'gift' || blocker?.type === 'crystal') && <span className="m3-color-mark"><AnimalIcon kind={blocker.type === 'gift' ? blocker.color : blocker.colors[blocker.index]}/></span>}
    {cell.ice > 0 && <><ObstacleArt type="ice"/><span className="m3-layer m3-ice-count">{cell.ice}</span></>}
    {blocker?.type === 'snow' && <span className="m3-layer">{blocker.layers}</span>}
    {cell.lock && <ObstacleArt type={cell.lock.type}/>}
  </>;
}

export function describeCell(cell: Cell): string {
  if (!cell.ground) return '空洞';
  return [cell.piece && (cell.piece.special === 'bird' ? '魔力鸟' : animals[cell.piece.kind].name),
    cell.piece?.special && cell.piece.special !== 'bird' && specialNames[cell.piece.special],
    cell.ice > 0 && `${cell.ice}层冰`, cell.lock && obstacleNames[cell.lock.type],
    cell.blocker && (cell.blocker.type === 'snow' ? `${cell.blocker.layers}层雪块` : cell.blocker.type === 'gift' ? `${animals[cell.blocker.color].name}礼盒` : cell.blocker.type === 'crystal' ? `${animals[cell.blocker.colors[cell.blocker.index]].name}水晶球` : '毒液')].filter(Boolean).join('，') || '空格';
}

export function goalLabel(goal: Goal): string {
  if (goal.type === 'collect') return `收集${animals[goal.kind].name}`;
  if (goal.type === 'clear') return `清除${obstacleNames[goal.obstacle]}${goal.unit === 'layers' ? '层数' : '个数'}`;
  if (goal.type === 'special') return `触发${specialNames[goal.special]}`;
  return '获得分数';
}

export function GoalArt({ goal }: { goal: Goal }) {
  if (goal.type === 'collect') return <AnimalIcon kind={goal.kind}/>;
  if (goal.type === 'clear') return <ObstacleArt type={goal.obstacle}/>;
  if (goal.type === 'special') return <SpecialArt special={goal.special}/>;
  return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="m32 5 8 17 19 2-14 13 4 20-17-9-17 9 4-20L5 24l19-2Z" fill="#e2be65" stroke="#8b7038" strokeWidth="3"/></svg>;
}
