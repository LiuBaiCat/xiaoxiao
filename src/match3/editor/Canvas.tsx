import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { AnimalIcon, animals } from '../../components/AnimalIcon';
import { obstacleNames, specialNames, toolNames, type Level, type Point, type Tool } from '../engine/types';
import { AnimalSelect, NumberField } from './Forms';
import { samePoint, strokeLine, type Brush, type BrushKind, type EraseLayer } from './model';

const brushes: { label: string; items: [BrushKind, string][] }[] = [
  { label: '地板', items: [['inspect', '查看 / 停笔'], ['ground', '地板'], ['hole', '空洞']] },
  { label: '动物与特效', items: [['piece', '普通动物'], ['row', '横扫'], ['column', '纵扫'], ['bomb', '炸弹'], ['bird', '魔力鸟']] },
  { label: '地板层', items: [['ice', '冰层']] },
  { label: '占格障碍', items: [['snow', '雪块'], ['gift', '礼盒'], ['poison', '毒液'], ['crystal', '水晶球']] },
  { label: '动物覆盖层', items: [['vine', '藤蔓'], ['fur', '灰毛球']] },
  { label: '连接与补充', items: [['rope', '绳边'], ['portal', '传送门'], ['spawn', '补充点'], ['erase', '擦除']] },
];
const eraseLabels: Record<EraseLayer, string> = { all: '该格所有配置（保留地板）', piece: '动物与特效', ice: '冰层', blocker: '占格障碍', lock: '藤蔓 / 毛球覆盖', rope: '相连绳边', portal: '相连传送门整对', spawn: '补充点' };
const shortSpecial = { row: '横扫', column: '纵扫', bomb: '炸弹', bird: '魔力鸟' };
const atKey = (point: Point) => `${point.row},${point.col}`;

export function BrushPanel({ level, brush, readonly, onChange, onChoose }: { level: Level; brush: Brush; readonly: boolean; onChange: (brush: Brush) => void; onChoose: (kind: BrushKind) => void }) {
  const [sequenceColor, setSequenceColor] = useState(level.palette[0] ?? 0);
  return <fieldset disabled={readonly} className="m3-editor-brushes"><legend>画笔 · 先选画笔，再点格或拖动</legend>
    {brushes.map(group => <div className="m3-editor-brush-group" key={group.label}><span>{group.label}</span><div>{group.items.map(([kind, label]) => <button type="button" key={kind} aria-pressed={brush.kind === kind} onClick={() => onChoose(kind)}>{label}</button>)}</div></div>)}
    <div className="m3-editor-brush-options">
      {['piece', 'row', 'column', 'bomb', 'gift'].includes(brush.kind) && <AnimalSelect label={brush.kind === 'gift' ? '礼盒指定颜色 / 图案' : '动物图案'} palette={level.palette} value={brush.color} onChange={color => onChange({ ...brush, color })} />}
      {['ice', 'snow'].includes(brush.kind) && <label className="m3-editor-field">{brush.kind === 'ice' ? '冰层（1—3）' : '雪块（1—5）'}<select value={Math.min(brush.layers, brush.kind === 'ice' ? 3 : 5)} onChange={e => onChange({ ...brush, layers: Number(e.target.value) })}>{Array.from({ length: brush.kind === 'ice' ? 3 : 5 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} 层</option>)}</select></label>}
      {brush.kind === 'gift' && <><label className="m3-editor-field">礼盒奖励道具<select value={brush.rewardTool} onChange={e => onChange({ ...brush, rewardTool: e.target.value as Tool })}>{Object.entries(toolNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><NumberField label="奖励次数" value={brush.rewardCount} min={1} max={99} onChange={v => onChange({ ...brush, rewardCount: v ?? 0 })} /></>}
      {brush.kind === 'crystal' && <div className="m3-editor-sequence"><p>水晶球循环顺序（第一项为初始颜色）</p><ol>{brush.crystalColors.map((color, index) => <li key={index}>{animals[color]?.name ?? color}<button type="button" aria-label={`删除序列第${index + 1}项`} onClick={() => onChange({ ...brush, crystalColors: brush.crystalColors.filter((_, i) => i !== index) })}>移除</button></li>)}</ol><AnimalSelect label="追加颜色" value={sequenceColor} palette={level.palette} onChange={setSequenceColor} /><button type="button" disabled={brush.crystalColors.length >= 8 || brush.crystalColors.includes(sequenceColor)} onClick={() => onChange({ ...brush, crystalColors: [...brush.crystalColors, sequenceColor] })}>添加到序列末尾</button></div>}
      {brush.kind === 'erase' && <label className="m3-editor-field">只擦除哪一层<select value={brush.eraseLayer} onChange={e => onChange({ ...brush, eraseLayer: e.target.value as EraseLayer })}>{Object.entries(eraseLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    </div>
    <p className="m3-editor-small">地板 → 冰层 → 动物 / 占格障碍 → 覆盖层。放占格障碍会替换动物、冰层及覆盖；放动物、冰层或覆盖会移除该格占格障碍。空洞删除该格所有层和关联连接。绳边重复连线可删除；门户先点入口，再点出口。</p>
  </fieldset>;
}

export function describeCell(level: Level, point: Point): string[] {
  const details = [`第${point.row + 1}行第${point.col + 1}列`, level.mask[point.row]?.[point.col] === '#' ? '空洞' : '地板'];
  const piece = level.initialPieces.find(p => samePoint(p, point));
  const ice = level.ice.find(p => samePoint(p, point));
  const blocker = level.blockers.find(p => samePoint(p, point))?.blocker;
  const lock = level.locks.find(p => samePoint(p, point));
  if (piece) details.push(piece.special === 'bird' ? '魔力鸟' : `${animals[piece.kind]?.name ?? `图案${piece.kind}`}${piece.special ? ` · ${specialNames[piece.special]}` : ''}`);
  if (ice) details.push(`冰层 ${ice.layers} 层`);
  if (blocker) {
    if (blocker.type === 'snow') details.push(`雪块 ${blocker.layers} 层`);
    else if (blocker.type === 'gift') details.push(`礼盒：${animals[blocker.color]?.name ?? blocker.color}；奖励${toolNames[blocker.reward.tool]} ${blocker.reward.count} 次`);
    else if (blocker.type === 'crystal') details.push(`水晶球：${blocker.colors.map(k => animals[k]?.name ?? k).join(' → ')}；当前第${blocker.index + 1}项`);
    else details.push('毒液');
  }
  if (lock) details.push(obstacleNames[lock.type]);
  for (const portal of level.portals) {
    if (samePoint(portal.from, point)) details.push(`${portal.id} 入口 → 第${portal.to.row + 1}行第${portal.to.col + 1}列`);
    if (samePoint(portal.to, point)) details.push(`${portal.id} 出口 ← 第${portal.from.row + 1}行第${portal.from.col + 1}列`);
  }
  for (const rope of level.ropes) {
    const other = samePoint(rope.from, point) ? rope.to : samePoint(rope.to, point) ? rope.from : undefined;
    if (other) details.push(`绳边连至第${other.row + 1}行第${other.col + 1}列`);
  }
  if (level.spawnPoints.some(p => samePoint(p, point))) details.push('补充入口');
  if (!piece && !blocker && level.mask[point.row]?.[point.col] === '.') details.push('开局自动补动物');
  return details;
}

export function Canvas({ level, readonly, brush, pair, onPaint, onPair, onCancelPair }: { level: Level; readonly: boolean; brush: Brush; pair: Point | null; onPaint: (points: Point[], checkpoint: boolean) => boolean; onPair: (point: Point) => void; onCancelPair: () => void }) {
  const [size, setSize] = useState(64);
  const [selected, setSelected] = useState<Point>({ row: 0, col: 0 });
  useEffect(() => { setSelected(previous => ({ row: Math.min(previous.row, level.height - 1), col: Math.min(previous.col, level.width - 1) })); }, [level.width, level.height]);
  const [showConnections, setShowConnections] = useState(true);
  const [showLayers, setShowLayers] = useState(true);
  const stroke = useRef<{ last: Point; visited: Set<string>; changed: boolean } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const isPair = brush.kind === 'rope' || brush.kind === 'portal';
  const pieces = new Map(level.initialPieces.map(p => [atKey(p), p]));
  const ice = new Map(level.ice.map(p => [atKey(p), p.layers]));
  const blockers = new Map(level.blockers.map(p => [atKey(p), p.blocker]));
  const locks = new Map(level.locks.map(p => [atKey(p), p.type]));
  const spawns = new Set(level.spawnPoints.map(atKey));
  const portals = new Map<string, string[]>();
  const ropeSides = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, value: string) => map.set(key, [...(map.get(key) ?? []), value]);
  level.portals.forEach((p, i) => { add(portals, atKey(p.from), `门${i + 1}入`); add(portals, atKey(p.to), `门${i + 1}出`); });
  level.ropes.forEach(({ from, to }) => {
    if (from.row === to.row) { add(ropeSides, atKey(from), from.col < to.col ? 'right' : 'left'); add(ropeSides, atKey(to), from.col < to.col ? 'left' : 'right'); }
    else { add(ropeSides, atKey(from), from.row < to.row ? 'bottom' : 'top'); add(ropeSides, atKey(to), from.row < to.row ? 'top' : 'bottom'); }
  });
  const paint = (point: Point, first: boolean) => {
    setSelected(point);
    if (readonly || brush.kind === 'inspect') return;
    if (isPair) { if (first) onPair(point); return; }
    const current = stroke.current;
    const points = (current && !first ? strokeLine(current.last, point) : [point]).filter(p => !current?.visited.has(atKey(p)));
    if (points.length) {
      // A no-op (including already-painted cells) must not consume the undo checkpoint.
      const changed = onPaint(points, !current?.changed);
      if (current) { if (changed) current.changed = true; points.forEach(p => current.visited.add(atKey(p))); }
    }
    if (current) current.last = point;
  };
  const pointFromPointer = (event: PointerEvent): Point | null => {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('[data-editor-cell]');
    if (!target || !grid.current?.contains(target)) return null;
    return { row: Number(target.dataset.row), col: Number(target.dataset.col) };
  };
  const finish = () => { stroke.current = null; };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, point: Point) => {
    if (event.key === 'Escape') { onCancelPair(); return; }
    const directions: Record<string, Point> = { ArrowUp: { row: -1, col: 0 }, ArrowDown: { row: 1, col: 0 }, ArrowLeft: { row: 0, col: -1 }, ArrowRight: { row: 0, col: 1 } };
    const delta = directions[event.key];
    if (!delta) return;
    event.preventDefault();
    const row = Math.max(0, Math.min(level.height - 1, point.row + delta.row));
    const col = Math.max(0, Math.min(level.width - 1, point.col + delta.col));
    grid.current?.querySelector<HTMLButtonElement>(`[data-row="${row}"][data-col="${col}"]`)?.focus();
    setSelected({ row, col });
  };
  return <section className="m3-editor-canvas" aria-label="可视化画布">
    <div className="m3-editor-canvas-toolbar"><h2>画布 {level.width} × {level.height}</h2><label>格子大小 <input aria-label="画布格子大小" type="range" min={52} max={88} step={4} value={size} onChange={e => setSize(Number(e.target.value))} /></label><span>{size}px</span>
      <label className="m3-editor-check"><input type="checkbox" checked={showLayers} onChange={e => setShowLayers(e.target.checked)} />显示障碍层</label><label className="m3-editor-check"><input type="checkbox" checked={showConnections} onChange={e => setShowConnections(e.target.checked)} />显示绳 / 门 / 补充点</label>
    </div>
    <p className="m3-editor-small">点选或拖画；方向键移动焦点，空格 / Enter 落笔。空白地板会自动补动物。棕色粗边为绳子，虚线分隔为阶段边界。</p>
    {pair && <p className="m3-editor-pair" role="status">已选{brush.kind === 'portal' ? '入口' : '第一格'}：第{pair.row + 1}行第{pair.col + 1}列，请点{brush.kind === 'portal' ? '出口' : '相邻格'}。<button type="button" onClick={onCancelPair}>取消配对（Esc）</button></p>}
    <div className="m3-editor-grid-scroll"><div ref={grid} role="grid" aria-label="关卡编辑网格" aria-readonly={readonly} aria-rowcount={level.height} aria-colcount={level.width} className="m3-editor-grid" style={{ '--m3-editor-cell-size': `${size}px`, gridTemplateColumns: `34px repeat(${level.width}, ${size}px)` } as CSSProperties}
      onPointerMove={event => { if (!stroke.current || isPair) return; const point = pointFromPointer(event); if (point) paint(point, false); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <div role="row" className="m3-editor-grid-row"><span /><span className="m3-editor-column-label" style={{ gridColumn: `span ${level.width}` }}>列 → {Array.from({ length: level.width }, (_, i) => <span key={i} style={{ left: i * (size + 4) }}>{i + 1}</span>)}</span></div>
      {Array.from({ length: level.height }, (_, row) => <div role="row" className="m3-editor-grid-row" key={row}>
        <span className="m3-editor-row-label" title={`第${row + 1}行`}>{level.stages.some(s => s.startRow === row) ? <strong>段<br /></strong> : null}{row + 1}</span>
        {Array.from({ length: level.width }, (_, col) => {
          const point = { row, col }, key = atKey(point), piece = pieces.get(key), blocker = blockers.get(key), lock = locks.get(key);
          const isHole = level.mask[row]?.[col] === '#';
          const color = blocker?.type === 'gift' ? blocker.color : blocker?.type === 'crystal' ? blocker.colors[blocker.index] : piece?.kind;
          const label = describeCell(level, point).join('；');
          return <button type="button" role="gridcell" aria-label={label} aria-selected={samePoint(selected, point)} title={label} key={col} data-editor-cell="true" data-row={row} data-col={col} tabIndex={samePoint(selected, point) ? 0 : -1}
            className={`m3-editor-cell${isHole ? ' m3-editor-hole' : ''}${pair && samePoint(pair, point) ? ' m3-editor-pair-cell' : ''}${level.stages.some(s => s.startRow === row && row > 0) ? ' m3-editor-stage-start' : ''}${showLayers && ice.has(key) ? ' m3-editor-icy' : ''}`}
            onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); grid.current?.setPointerCapture(event.pointerId); stroke.current = { last: point, visited: new Set(), changed: false }; paint(point, true); }}
            onClick={event => { if (event.detail === 0) { finish(); paint(point, true); } }} onKeyDown={event => keyboard(event, point)}>
            {!isHole && !blocker && color !== undefined && animals[color] && <AnimalIcon kind={color} />}
            {!isHole && !piece && !blocker && <span className="m3-editor-auto">自动</span>}
            {piece?.special && <span className="m3-editor-special">{shortSpecial[piece.special]}</span>}
            {showLayers && blocker && <span className={`m3-editor-blocker m3-editor-blocker-${blocker.type}`}>
              {(blocker.type === 'gift' || blocker.type === 'crystal') && color !== undefined && animals[color] && <AnimalIcon kind={color} />}
              <span>{blocker.type === 'snow' ? `雪 ${blocker.layers}` : blocker.type === 'gift' ? '礼盒' : blocker.type === 'crystal' ? '水晶' : '毒液'}</span>
            </span>}
            {showLayers && ice.has(key) && <span className="m3-editor-ice-badge">冰{ice.get(key)}</span>}
            {showLayers && lock && <span className={`m3-editor-lock m3-editor-lock-${lock}`}>{lock === 'vine' ? '藤' : '毛'}</span>}
            {showConnections && spawns.has(key) && <span className="m3-editor-spawn">补↓</span>}
            {showConnections && portals.has(key) && <span className="m3-editor-portal">{portals.get(key)!.join(' / ')}</span>}
            {showConnections && ropeSides.get(key)?.map(side => <span key={side} className={`m3-editor-rope m3-editor-rope-${side}`} />)}
          </button>;
        })}
      </div>)}
    </div></div>
    <div className="m3-editor-cell-details" aria-live="polite"><strong>选中格各层</strong><span>{describeCell(level, selected).join(' · ')}</span></div>
  </section>;
}
