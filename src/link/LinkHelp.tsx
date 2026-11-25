import { Modal } from '../components/Modal';

export function LinkHelp({ onClose, showMatch3 = false }: { onClose: () => void; showMatch3?: boolean }) {
  return <Modal title="三步就会，慢慢来" onClose={onClose}>{showMatch3 && <p className="help-note"><strong>开心消消乐：</strong>点选或拖动相邻图案交换位置，三个或更多相同图案连成横排、竖排就能消除。不限时，在规定步数内完成上方目标即可过关。<br /><strong>开心连连看：</strong>按下面三步来玩。</p>}<div className="help-steps"><div><b>1</b><span><strong>找两个相同图案</strong>动物、水果、蔬菜都可以配对。</span></div><div><b>2</b><span><strong>路通了，就能消除</strong>连线最多拐两个弯，不能穿过其他图块，可以绕棋盘外侧。</span></div><div><b>3</b><span><strong>连对了，还能补时间</strong>每对最多补3秒，只补到本关初始时长；时间已满就不再加。清空70对就过关，点错不扣生命。</span></div></div><p className="help-note">时间用完或棋盘没有可连图案时，扣1生命；死局扣除后仍有生命就自动重排，生命用完则结束。每过一关，获得1生命、2提示、1加时；加时一次增加30秒。</p><button className="button primary wide" onClick={onClose}>明白了，轻松玩</button></Modal>;
}
