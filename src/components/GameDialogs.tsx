import type { ReactNode } from 'react';
import { levels } from '../engine/levels';
import type { Action, GameState } from '../game/machine';
import { AnimalIcon } from './AnimalIcon';
import { Icon } from './Icon';
import { Modal } from './Modal';

export function GameDialogs({ game, dispatch, onHome, onExit, bonusFeedback }: { game: GameState; dispatch: (action: Action) => void; onHome: () => void; onExit: () => void; bonusFeedback: ReactNode }) {
  if (game.phase === 'playing') return null;
  const level = levels[game.levelId - 1];
  if (game.phase === 'paused') {
    const intro = game.pauseReason === 'intro';
    return <Modal key={`pause-${game.levelId}`} title={intro ? `第 ${level.id} 关 · ${level.name}` : '休息一下，时间停住了'}>
      <div className="modal-animal"><AnimalIcon kind={intro ? (level.id - 1) % 12 : 4} /></div>
      <p>{intro ? level.description : game.pauseReason === 'upgraded' ? '棋盘已升级为10行14列，本关重新开始。原有生命、道具及解锁关卡都已保留。' : game.pauseReason === 'away' ? '您刚才离开了页面，已自动暂停。' : game.pauseReason === 'restored' ? '上次的进度都在，准备好再继续。' : '伸伸手，看看远处，回来再慢慢找。'}</p>
      {intro && <div className="intro-facts"><span>{level.rows}行 × {level.cols}列</span><span>{level.rows * level.cols / 2} 对伙伴</span><span>{Math.floor(level.seconds / 60)}分{level.seconds % 60 ? `${level.seconds % 60}秒` : '钟'}</span><span>{level.kinds} 种图案</span><span>点错不扣生命</span></div>}
      <button className="button primary wide" onClick={() => dispatch({ type: 'RESUME' })}><Icon name="play" />{intro ? '开始这一关' : '继续游戏'}</button>
      <div className="modal-actions"><button className="text-button modal-secondary home-button" onClick={onHome}>先回首页</button><button className="text-button modal-secondary exit-game" data-skip-auto-fullscreen onClick={onExit}>退出游戏</button></div>
    </Modal>;
  }
  if (game.phase === 'won') return <Modal key={`won-${game.levelId}`} title={game.levelId === 12 ? '十二关，全都完成啦！' : '真棒，又过了一关！'}>
    <div className="win-badge"><Icon name="cup" size={48} /></div>
    <div className="win-feedback">{bonusFeedback}</div>
    <p>{game.levelId === 12 ? '每一对相遇，都值得开心。记得休息一下。' : `第 ${level.id} 关「${level.name}」完成，收下这份小奖励。`}</p>
    <div className="rewards"><span><Icon name="heart" />生命 <b>+1</b></span><span><Icon name="bulb" />提示 <b>+2</b></span><span><Icon name="clock" />加时 <b>+1</b></span></div>
    {game.levelId < 12 ? <button className="button primary wide" onClick={() => dispatch({ type: 'NEXT' })}>出发，下一关<Icon name="arrow" /></button> : <button className="button primary wide" onClick={onHome}>回到首页<Icon name="home" /></button>}
    <div className="modal-actions">{game.levelId < 12 && <button className="text-button modal-secondary home-button" onClick={onHome}>先休息，进度已保留</button>}<button className="text-button modal-secondary exit-game" data-skip-auto-fullscreen onClick={onExit}>退出游戏</button></div>
  </Modal>;
  if (game.phase === 'timeout') return <Modal title="没关系，再给自己一点时间">
    <div className="modal-symbol"><Icon name="clock" size={48} /></div>
    <p>这一轮时间到了，扣除1点生命。<br />还剩 <strong>{game.resources.lives}</strong> 点生命，继续可获得60秒。</p>
    <button className="button primary wide" onClick={() => dispatch({ type: 'CONTINUE' })}>补充60秒，继续找<Icon name="arrow" /></button>
    <div className="modal-actions"><button className="text-button modal-secondary home-button" onClick={onHome}>先休息一下</button><button className="text-button modal-secondary exit-game" data-skip-auto-fullscreen onClick={onExit}>退出游戏</button></div>
  </Modal>;
  return <Modal title="休息一下，再来一次">
    <div className="modal-animal"><AnimalIcon kind={2} /></div>
    <p>{game.remainingMs > 0 && <>棋盘没有可连接的图案，扣除了最后1点生命。<br /></>}生命用完了，已经解锁的关卡不会丢失。<br />重试本关将重新排列，并补充5生命、3提示和3加时。</p>
    <button className="button restart-button wide" onClick={() => dispatch({ type: 'RETRY' })}><Icon name="refresh" />重新挑战这一关</button>
    <div className="modal-actions"><button className="text-button modal-secondary home-button" onClick={onHome}>返回首页</button><button className="text-button modal-secondary exit-game" data-skip-auto-fullscreen onClick={onExit}>退出游戏</button></div>
  </Modal>;
}
