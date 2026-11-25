import { useEffect, useState } from 'react';
import { AnimalIcon, animals } from '../../components/AnimalIcon';
import { obstacleNames, specialNames, toolNames, type Goal, type Level, type Obstacle, type Special, type Tool } from '../engine/types';
import { allGoalIds, freshId, newGoal } from './model';

export function NumberField({ label, value, onChange, min = 0, max = 999999, optional = false }: { label: string; value: number | undefined; onChange: (value: number | undefined) => void; min?: number; max?: number; optional?: boolean }) {
  return <label className="m3-editor-field">{label}<input type="number" min={min} max={max} step="1" value={value ?? ''} onChange={event => {
    if (!event.target.value) { onChange(optional ? undefined : 0); return; }
    const next = event.target.valueAsNumber;
    if (Number.isSafeInteger(next)) onChange(next);
  }} /></label>;
}

export function AnimalSelect({ label, value, palette, onChange }: { label: string; value: number; palette: number[]; onChange: (value: number) => void }) {
  const options = [...new Set([...palette, value])];
  return <label className="m3-editor-field">{label}<select value={value} onChange={e => onChange(Number(e.target.value))}>{options.map(kind => <option key={kind} value={kind}>{animals[kind]?.name ?? `未定义图案 ${kind}`}（{kind}）</option>)}</select></label>;
}

function GoalFields({ goals, palette, ids, onChange }: { goals: Goal[]; palette: number[]; ids: string[]; onChange: (goals: Goal[]) => void }) {
  const update = (index: number, goal: Goal) => onChange(goals.map((g, i) => i === index ? goal : g));
  return <div className="m3-editor-goals">{goals.map((goal, index) => <fieldset className="m3-editor-goal" key={goal.id}>
    <legend>目标 {index + 1}</legend>
    <label className="m3-editor-field">目标类型<select value={goal.type} onChange={e => update(index, { ...newGoal(e.target.value as Goal['type'], goal.id, palette), count: goal.count })}>
      <option value="collect">收集动物</option><option value="clear">清除障碍</option><option value="special">触发特效</option><option value="score">获得分数</option>
    </select></label>
    {goal.type === 'collect' && <AnimalSelect label="收集图案" value={goal.kind} palette={palette} onChange={kind => update(index, { ...goal, kind })} />}
    {goal.type === 'clear' && <>
      <label className="m3-editor-field">障碍<select value={goal.obstacle} onChange={e => { const obstacle = e.target.value as Obstacle; update(index, { ...goal, obstacle, unit: ['ice', 'snow'].includes(obstacle) ? goal.unit : 'objects' }); }}>{Object.entries(obstacleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="m3-editor-field">统计方式<select value={goal.unit} onChange={e => update(index, { ...goal, unit: e.target.value as 'layers' | 'objects' })}><option value="objects">彻底清掉的对象数</option>{['ice', 'snow'].includes(goal.obstacle) && <option value="layers">减掉的层数</option>}</select></label>
    </>}
    {goal.type === 'special' && <label className="m3-editor-field">特效<select value={goal.special} onChange={e => update(index, { ...goal, special: e.target.value as Special })}>{Object.entries(specialNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    <NumberField label={goal.type === 'score' ? '所需分数' : '所需数量'} value={goal.count} min={1} onChange={count => update(index, { ...goal, count: count ?? 0 })} />
    <button type="button" className="m3-editor-danger" onClick={() => onChange(goals.filter((_, i) => i !== index))}>删除目标 {index + 1}</button>
  </fieldset>)}
    <button type="button" disabled={goals.length >= 64} onClick={() => onChange([...goals, newGoal('collect', freshId('goal', ids), palette)])}>＋ 添加目标</button>
  </div>;
}

export function Properties({ level, readonly, onChange, onResize }: { level: Level; readonly: boolean; onChange: (level: Level) => void; onResize: (width: number, height: number) => void }) {
  const [width, setWidth] = useState(level.width);
  const [height, setHeight] = useState(level.height);
  useEffect(() => { setWidth(level.width); setHeight(level.height); }, [level.width, level.height, level.packId, level.id]);
  const ids = allGoalIds(level);
  const validSize = Number.isInteger(width) && width >= 3 && width <= 12 && Number.isInteger(height) && height >= 3 && height <= 60;
  return <aside className="m3-editor-panel m3-editor-properties" aria-label="关卡属性">
    <h2>关卡属性</h2>
    <fieldset disabled={readonly} className="m3-editor-property-fields">
      <label className="m3-editor-field">关卡名称<input value={level.title} maxLength={80} onChange={e => onChange({ ...level, title: e.target.value })} /></label>
      <p className="m3-editor-small m3-editor-key">稳定标识：{level.packId} / {level.id}<br />修订 {level.revision} · 发布时自动递增</p>
      <div className="m3-editor-two"><NumberField label="排序值" value={level.order} onChange={order => onChange({ ...level, order: order ?? 0 })} /><NumberField label="初始步数" value={level.moves} min={1} max={9999} onChange={moves => onChange({ ...level, moves: moves ?? 0 })} /></div>
      <fieldset className="m3-editor-goal"><legend>星级分数</legend>
        <div className="m3-editor-three">{level.starThresholds.map((threshold, index) => <NumberField key={index} label={(index + 1) + ' 星分数'} value={threshold} min={0} max={Number.MAX_SAFE_INTEGER} onChange={value => {
          const next = [...level.starThresholds] as Level['starThresholds'];
          next[index] = value ?? 0;
          onChange({ ...level, starThresholds: next });
        }} />)}</div>
        <p className="m3-editor-small">门槛须从一星到三星递增或相等。</p>
      </fieldset>
      <details open><summary>画布尺寸</summary>
        <div className="m3-editor-two"><NumberField label="列数（3—12）" value={width} min={3} max={12} onChange={v => setWidth(v ?? 0)} /><NumberField label="总行数（3—60）" value={height} min={3} max={60} onChange={v => setHeight(v ?? 0)} /></div>
        <button type="button" disabled={!validSize || (width === level.width && height === level.height)} onClick={() => onResize(width, height)}>应用尺寸</button>
        <p className="m3-editor-small">新建默认为 9×9；保留范围内配置。裁掉内容会先确认，可撤销。</p>
      </details>
      <details open><summary>动物种类（建议 4—6 种）</summary>
        <div className="m3-editor-palette">{animals.map((animal, kind) => <label key={kind} title={`${animal.name}（${kind}）`}>
          <input type="checkbox" checked={level.palette.includes(kind)} onChange={e => onChange({ ...level, palette: e.target.checked ? [...level.palette, kind].sort((a, b) => a - b) : level.palette.filter(k => k !== kind) })} /><AnimalIcon kind={kind} /><span>{animal.name}</span>
        </label>)}</div>
        <p className="m3-editor-small">移除种类不会偷偷更改预置动物、礼盒或目标；请根据校验提示修正。</p>
      </details>
      <details><summary>道具与复现种子</summary>
        {(Object.keys(toolNames) as Tool[]).map(tool => <NumberField key={tool} label={`${toolNames[tool]}次数`} value={level.tools[tool]} max={999} onChange={value => onChange({ ...level, tools: { ...level.tools, [tool]: value ?? 0 } })} />)}
        <NumberField label="随机种子（留空则随机）" value={level.seed} optional min={0} max={4294967295} onChange={seed => { const next = { ...level }; if (seed === undefined) delete next.seed; else next.seed = seed; onChange(next); }} />
      </details>
      <details open><summary>整关目标（全部完成）</summary><GoalFields goals={level.goals} palette={level.palette} ids={ids} onChange={goals => onChange({ ...level, goals })} /></details>
      <details open><summary>滚动与阶段目标</summary>
        <label className="m3-editor-check"><input type="checkbox" checked={level.scroll} onChange={e => onChange({ ...level, scroll: e.target.checked })} />分段向下滚动</label>
        <p className="m3-editor-small">每段最多 10 行，连续且不重叠地覆盖整张画布。界面行号从 1 开始，JSON 坐标从 0 开始。新段目标需手动填写。</p>
        {level.stages.map((stage, index) => <fieldset className="m3-editor-stage" key={stage.id}><legend>阶段 {index + 1}</legend>
          <div className="m3-editor-two"><NumberField label="起始行（第几行）" value={stage.startRow + 1} min={1} max={60} onChange={v => onChange({ ...level, stages: level.stages.map((s, i) => i === index ? { ...s, startRow: (v ?? 1) - 1 } : s) })} /><NumberField label="本段行数" value={stage.rows} min={1} max={10} onChange={v => onChange({ ...level, stages: level.stages.map((s, i) => i === index ? { ...s, rows: v ?? 0 } : s) })} /></div>
          <GoalFields goals={stage.goals} palette={level.palette} ids={ids} onChange={goals => onChange({ ...level, stages: level.stages.map((s, i) => i === index ? { ...s, goals } : s) })} />
          <button type="button" className="m3-editor-danger" onClick={() => onChange({ ...level, stages: level.stages.filter((_, i) => i !== index) })}>删除阶段 {index + 1}</button>
        </fieldset>)}
        <button type="button" disabled={level.stages.length >= 60} onClick={() => { const startRow = Math.max(0, ...level.stages.map(s => s.startRow + s.rows)); onChange({ ...level, stages: [...level.stages, { id: freshId('stage', level.stages.map(s => s.id)), startRow, rows: Math.max(1, Math.min(9, level.height - startRow)), goals: [] }] }); }}>＋ 添加阶段</button>
      </details>
    </fieldset>
  </aside>;
}
