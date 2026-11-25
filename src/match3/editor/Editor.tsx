import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import type { Level, Point } from '../engine/types';
import { builtinLevels } from '../levels/registry';
import { createTemplate, levelKey, validateLevel } from '../levels/schema';
import { BrushPanel, Canvas } from './Canvas';
import { Properties } from './Forms';
import { clearBoard, connectCells, copyLevel, defaultBrush, editHistory, paintCells, redo, resizeLevel, sameLevel, sortLevels, startHistory, undo, userCopy, type Brush, type BrushKind, type History } from './model';
import { changedFields, commitCollection, downloadJson, encodeExport, importConflicts, LEVEL_LIMIT, loadDraft, mergeImport, prepareTrial, readImport, saveDraft, type DraftBundle, type ImportChoice } from './transfers';
import './editor.css';

export type EditorProps = { levels: Level[]; onClose: () => void; onPlay: (level: Level) => void; onChange: (levels: Level[]) => boolean };
type Workspace = { selected: string; histories: Map<string, History> };
type Dialog = { kind: 'confirm'; title: string; message: string; action: () => void; label?: string } | { kind: 'import'; levels: Level[]; choices: Record<string, ImportChoice> };
// Survives an editor-play unmount even when the browser rejects localStorage writes.
// This is draft data only, never a normal-game or test-mode session.
let memoryDraft: DraftBundle | undefined;
const isBuiltin = (level: Level) => level.packId === 'builtin' || level.packId.startsWith('builtin-') || builtinLevels.some(b => b.packId === level.packId);
const bundleOf = (workspace: Workspace): DraftBundle => ({ version: 1, selected: workspace.selected, levels: [...workspace.histories.values()].map(h => h.present) });

function initialWorkspace(levels: Level[]): { workspace: Workspace; error?: string; recovered: boolean } {
  let result: ReturnType<typeof loadDraft>;
  try { result = loadDraft(window.localStorage); } catch { result = { error: '浏览器不允许访问草稿存储。编辑只保留在本次窗口，请导出备份。' }; }
  const bundle = memoryDraft ?? result.bundle;
  const histories = new Map((bundle?.levels ?? []).filter(l => !isBuiltin(l)).map(level => [levelKey(level), startHistory(level)]));
  const all = [...levels, ...builtinLevels];
  let selected = bundle?.selected ?? levelKey(all[0] ?? createTemplate());
  if (!histories.has(selected)) {
    const chosen = all.find(l => levelKey(l) === selected) ?? all[0];
    const level = chosen ?? userCopy(createTemplate(), []);
    selected = levelKey(level);
    histories.set(selected, startHistory(level));
  }
  return { workspace: { selected, histories }, error: result.error, recovered: !!bundle };
}

export default function Editor({ levels, onClose, onPlay, onChange }: EditorProps) {
  const [initial] = useState(() => initialWorkspace(levels));
  const [workspace, setWorkspace] = useState(initial.workspace);
  const workspaceRef = useRef(workspace);
  const [brush, setBrush] = useState<Brush>(defaultBrush);
  const [pair, setPair] = useState<Point | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState(initial.recovered ? '已恢复独立编辑草稿。未发布的修改不会影响正式关卡或旧存档。' : '修改先存草稿；点击“发布到用户关卡”后才会交给父页面保存。');
  const [errors, setErrors] = useState<string[]>([]);
  const [storageError, setStorageError] = useState(initial.error);
  const [storageBlocked, setStorageBlocked] = useState(!!initial.error);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = workspace.histories.get(workspace.selected)!;
  const level = current.present;
  const readonly = isBuiltin(level);
  const published = levels.find(l => levelKey(l) === workspace.selected);
  const dirty = !readonly && (!published || !sameLevel(level, published));
  const report = useMemo(() => validateLevel(level), [level]);
  const users = useMemo(() => {
    const map = new Map(levels.filter(l => !isBuiltin(l)).map(l => [levelKey(l), l]));
    for (const [key, history] of workspace.histories) if (!isBuiltin(history.present)) map.set(key, history.present);
    return sortLevels([...map.values()]);
  }, [levels, workspace]);

  function updateWorkspace(update: (previous: Workspace) => Workspace) {
    const next = update(workspaceRef.current);
    workspaceRef.current = next;
    setWorkspace(next);
  }
  function persist(force = false): boolean {
    const bundle = bundleOf(workspaceRef.current);
    memoryDraft = bundle;
    if (storageBlocked && !force) return false;
    let error: string | undefined;
    try { error = saveDraft(window.localStorage, bundle); } catch { error = '草稿保存失败：浏览器不允许访问存储。请导出备份，勿关闭页面。'; }
    setStorageError(error);
    return !error;
  }
  useEffect(() => { persist(); }, [workspace, storageBlocked]);
  useEffect(() => {
    if (!level.palette.length) return;
    setBrush(previous => {
      const color = level.palette.includes(previous.color) ? previous.color : level.palette[0];
      const colors = previous.crystalColors.filter(kind => level.palette.includes(kind));
      return { ...previous, color, crystalColors: colors.length ? colors : [color] };
    });
  }, [workspace.selected, level.palette.join(',')]);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPair(null);
      if (dialog || readonly || !(event.ctrlKey || event.metaKey) || event.altKey || (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable="true"]'))) return;
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
        event.preventDefault();
        historyStep(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
      }
    };
    const onUnload = (event: BeforeUnloadEvent) => { if (storageError || storageBlocked) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); };
  }, [dialog, readonly, storageError, storageBlocked]);

  function change(next: Level, checkpoint = true) {
    if (readonly) return;
    updateWorkspace(previous => {
      const histories = new Map(previous.histories);
      histories.set(previous.selected, editHistory(histories.get(previous.selected)!, next, checkpoint));
      return { ...previous, histories };
    });
  }
  function historyStep(direction: 'undo' | 'redo') {
    setPair(null);
    updateWorkspace(previous => {
      const histories = new Map(previous.histories);
      histories.set(previous.selected, (direction === 'undo' ? undo : redo)(histories.get(previous.selected)!));
      return { ...previous, histories };
    });
  }
  function select(next: Level) {
    setPair(null); setErrors([]);
    updateWorkspace(previous => {
      const selected = levelKey(next), histories = new Map(previous.histories);
      if (!histories.has(selected)) histories.set(selected, startHistory(next));
      return { selected, histories };
    });
  }
  function addDraft(source: Level, template = false) {
    if (users.length >= LEVEL_LIMIT) { setErrors(['用户关卡和新建草稿合计最多 200 关，请先备份并删除不用的关卡。']); return; }
    const next = userCopy(source, users, template ? '我的新关卡' : `${source.title}（副本）`);
    select(next);
    setNotice(template ? '已创建 9×9 模板草稿，设置完成后请校验并发布。' : '已另存为用户草稿；原关卡和旧存档不变。');
  }
  function commitUsers(next: Level[]): boolean {
    const failures = commitCollection(next, builtinLevels, onChange);
    setErrors(failures);
    return !failures.length;
  }
  function publish() {
    if (readonly) return;
    const checked = validateLevel(level);
    if (checked.errors.length) { setErrors(['草稿尚未通过校验，不能发布。', ...checked.errors]); return; }
    const next = copyLevel(checked.level ?? level);
    next.revision = published ? Math.max(published.revision, next.revision) + 1 : Math.max(1, next.revision);
    const collection = levels.filter(l => levelKey(l) !== levelKey(next));
    if (!commitUsers(sortLevels([...collection, next]))) return;
    change(next);
    setNotice('已发布到用户关卡。正在继续的旧存档保留原快照，重开关卡才使用新版本。');
  }
  function confirm(title: string, message: string, action: () => void, label = '确认') { setDialog({ kind: 'confirm', title, message, action, label }); }
  function remove(selected: Level) {
    confirm('删除用户关卡？', `将删除“${selected.title}”及其编辑草稿。已有游戏存档快照不会被替换。此操作不能通过画布撤销，请先导出备份。`, () => {
      const key = levelKey(selected);
      if (levels.some(l => levelKey(l) === key) && !commitUsers(levels.filter(l => levelKey(l) !== key))) return;
      updateWorkspace(previous => {
        const histories = new Map(previous.histories);
        histories.delete(key);
        let selectedKey = previous.selected;
        if (selectedKey === key) {
          const fallback = users.find(l => levelKey(l) !== key) ?? builtinLevels[0] ?? userCopy(createTemplate(), []);
          selectedKey = levelKey(fallback);
          if (!histories.has(selectedKey)) histories.set(selectedKey, startHistory(fallback));
        }
        return { selected: selectedKey, histories };
      });
      setNotice('已删除用户关卡；旧游戏存档未改动。');
    }, '确认删除');
  }
  function move(selected: Level, direction: -1 | 1) {
    const order = [...users], index = order.findIndex(l => levelKey(l) === levelKey(selected)), target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    const ordered = order.map((l, i) => ({ ...l, order: i + 1 }));
    const orderMap = new Map(ordered.map(l => [levelKey(l), l.order]));
    const next = sortLevels(levels.map(l => ({ ...l, order: orderMap.get(levelKey(l)) ?? l.order })));
    if (levels.length && !commitUsers(next)) return;
    updateWorkspace(previous => {
      const histories = new Map(previous.histories);
      for (const item of ordered) {
        const old = histories.get(levelKey(item));
        if (old) histories.set(levelKey(item), editHistory(old, { ...old.present, order: item.order }));
      }
      return { ...previous, histories };
    });
    setNotice('已调整用户关卡顺序；未发布草稿的内容仍需单独发布。');
  }
  function chooseBrush(kind: BrushKind) {
    const apply = () => { setPair(null); setBrush(previous => ({ ...previous, kind, layers: kind === 'ice' ? Math.min(previous.layers, 3) : previous.layers })); };
    if (kind === 'erase') confirm('启用擦除画笔？', '请选择要擦除的层，再点击或拖过格子。默认擦除该格所有配置、相连绳边及整对传送门，保留地板。一次拖画可整笔撤销。', apply, '启用擦除');
    else if (kind === 'hole') confirm('启用空洞画笔？', '涂为空洞会删除格内各层、相连绳边及整对传送门。可以撤销。', apply, '启用空洞');
    else apply();
  }
  function paint(points: Point[], checkpoint: boolean): boolean {
    const source = workspaceRef.current.histories.get(workspaceRef.current.selected)!.present;
    const next = paintCells(source, points, brush);
    if (sameLevel(source, next)) return false;
    change(next, checkpoint);
    return true;
  }
  function connect(point: Point) {
    if (!pair) { setPair(point); return; }
    if (brush.kind !== 'rope' && brush.kind !== 'portal') return;
    const result = connectCells(level, pair, point, brush.kind);
    if (result.error) { setErrors([result.error]); return; }
    change(result.level); setPair(null); setErrors([]);
  }
  function resize(width: number, height: number) {
    const result = resizeLevel(level, width, height);
    const apply = () => { change(result.level); setPair(null); setNotice('画布尺寸已调整。请检查阶段范围和目标，校验提示会同步更新。'); };
    if (result.removed) confirm('裁掉越界配置？', `调整为 ${width}×${height} 将移除 ${result.removed} 项越界配置（包括关联连接、空洞、阶段或目标）。范围内内容保留，可撤销。`, apply, '确认调整尺寸');
    else apply();
  }
  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setBusy(true); setErrors([]);
    try {
      const result = await readImport(files, builtinLevels);
      if (result.errors.length) setErrors(result.errors);
      else setDialog({ kind: 'import', levels: result.levels, choices: {} });
    } finally { setBusy(false); }
  }
  function completeImport() {
    if (dialog?.kind !== 'import') return;
    const result = mergeImport(levels, dialog.levels, dialog.choices, users);
    if (result.errors.length) { setErrors(result.errors); setDialog(null); return; }
    if (!commitUsers(result.levels)) { setDialog(null); return; }
    updateWorkspace(previous => {
      const histories = new Map(previous.histories);
      result.imported.forEach(item => histories.set(levelKey(item), startHistory(item)));
      return { selected: result.imported[0] ? levelKey(result.imported[0]) : previous.selected, histories };
    });
    setPair(null); setDialog(null);
    setNotice(`已原子导入 ${result.imported.length} 关到用户集合。内置包自动改用独立用户包；原内置关与旧存档快照不变。`);
  }
  function exportData(items: Level[], single: boolean, filename: string) {
    try { downloadJson(filename, encodeExport(items, single)); setNotice('已发起 JSON 下载。请在浏览器下载记录中确认；下载不会改写项目源文件。未通过校验的草稿可备份，但不能直接发布或试关。'); }
    catch { setErrors(['下载失败，浏览器未允许创建下载文件。草稿仍保留，请检查浏览器设置后重试。']); }
  }
  function play() {
    const trial = prepareTrial(level);
    if (!trial.level) { setErrors(trial.errors); return; }
    persist();
    // A detached copy is the only data passed to the parent editor-session entry.
    onPlay(trial.level);
  }
  const conflicts = dialog?.kind === 'import' ? importConflicts(dialog.levels, users) : [];

  return <main className="m3-editor-root">
    <header className="m3-editor-header"><div><h1><Icon name="settings" />消消乐 · 可视化编辑器</h1><p>独立草稿 / 用户关卡 · 不改动正常游戏进度</p></div><div className="m3-editor-actions">
      <button type="button" onClick={() => { if (persist()) onClose(); else confirm('草稿尚未写入浏览器', '当前草稿仅保留在本次窗口内。关闭或刷新可能丢失，请先导出备份。仍要返回？', onClose, '仍然返回'); }}><Icon name="home" />返回</button>
      <button type="button" onClick={() => { if (persist()) setNotice('草稿已独立保存，允许暂时存在校验错误；未发布到正式关卡。'); }}>暂存草稿</button>
      <button type="button" className="m3-editor-primary" disabled={readonly || !dirty || !!report.errors.length} onClick={publish}>发布到用户关卡</button>
      <button type="button" disabled={!!report.errors.length} onClick={play}><Icon name="play" />独立试关</button>
    </div></header>
    <div className="m3-editor-notices" aria-live="polite"><p role="status">{notice}</p><p className={dirty ? 'm3-editor-unsaved' : 'm3-editor-small'}>{readonly ? '当前是内置只读关卡。点击“复制 / 另存”才能编辑。' : dirty ? '有未发布修改：自动保存为编辑草稿，不影响已发布用户关卡。' : '当前关卡与已发布版本一致。'}</p>
      {storageError && <div role="alert" className="m3-editor-error"><p>{storageError}</p>{storageBlocked && <button type="button" onClick={() => confirm('重建独立草稿存储？', '将用当前内存草稿覆盖无法读取的旧编辑草稿。不会改动用户关卡集合或游戏存档。', () => { setStorageBlocked(false); persist(true); }, '允许重建草稿')}>允许重建草稿存储</button>}<button type="button" onClick={() => exportData(users, false, 'match3-drafts-backup.json')}>导出全部用户草稿备份</button></div>}
      {!!errors.length && <div role="alert" className="m3-editor-error"><strong>操作未完成</strong><ul>{errors.map((error, i) => <li key={i}>{error}</li>)}</ul><button type="button" onClick={() => setErrors([])}>收起提示</button></div>}
    </div>
    <div className="m3-editor-layout">
      <aside className="m3-editor-panel m3-editor-library" aria-label="关卡列表"><h2>关卡目录</h2>
        <button type="button" className="m3-editor-primary" onClick={() => addDraft(createTemplate(), true)}>＋ 新建 9×9 关卡</button>
        <button type="button" onClick={() => addDraft(level)}>复制 / 另存当前关</button>
        <details open><summary>用户关卡（{users.length}）</summary><ol className="m3-editor-level-list">{users.map((item, index) => {
          const key = levelKey(item), saved = levels.find(l => levelKey(l) === key), modified = !saved || !sameLevel(saved, item);
          return <li key={key} className={key === workspace.selected ? 'm3-editor-current' : ''}><button type="button" className="m3-editor-level-title" aria-current={key === workspace.selected ? 'true' : undefined} onClick={() => select(item)}><span>{item.order}. {item.title || '（未命名）'}</span><small>{modified ? '未发布草稿' : '已发布'} · {item.width}×{item.height}</small></button><div className="m3-editor-list-actions"><button type="button" aria-label={`上移 ${item.title}`} disabled={index === 0} onClick={() => move(item, -1)}>上移</button><button type="button" aria-label={`下移 ${item.title}`} disabled={index === users.length - 1} onClick={() => move(item, 1)}>下移</button><button type="button" aria-label={`删除 ${item.title}`} className="m3-editor-danger" onClick={() => remove(item)}>删除</button></div></li>;
        })}</ol>{!users.length && <p className="m3-editor-small">暂无用户关卡。可以新建、复制内置关或导入。</p>}</details>
        <details open><summary>内置关卡 · 只读（{builtinLevels.length}）</summary><ol className="m3-editor-level-list">{sortLevels(builtinLevels).map(item => <li key={levelKey(item)} className={levelKey(item) === workspace.selected ? 'm3-editor-current' : ''}><button type="button" className="m3-editor-level-title" aria-current={levelKey(item) === workspace.selected ? 'true' : undefined} onClick={() => select(item)}><span><Icon name="lock" size={16} /> {item.order}. {item.title}</span><small>{item.width}×{item.height} · 内置只读</small></button></li>)}</ol></details>
        <section className="m3-editor-transfers"><h3>导入 / 导出 JSON</h3><input ref={fileInput} type="file" accept=".json,application/json" multiple className="m3-editor-file-input" aria-label="选择关卡 JSON 文件（可多选）" onChange={importFiles} disabled={busy} /><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? '正在校验全部文件…' : '导入 JSON（可多选）'}</button><button type="button" onClick={() => exportData([level], true, `${level.id}.json`)}>导出当前 JSON</button><button type="button" disabled={!levels.length} onClick={() => exportData(sortLevels(levels), false, 'match3-user-pack.json')}>导出已发布整包</button><p className="m3-editor-small">每个文件 ≤256 KiB；本次合计 / 用户包 ≤2 MiB，最多 200 关。先全部校验，再一次合并。覆盖前会明确确认，旧存档保持不变。</p></section>
      </aside>
      <section className="m3-editor-workbench" aria-label="关卡绘制区">
        <div className="m3-editor-actions m3-editor-edit-actions"><button type="button" disabled={readonly || !current.past.length} onClick={() => historyStep('undo')}>撤销（{current.past.length} / 80）</button><button type="button" disabled={readonly || !current.future.length} onClick={() => historyStep('redo')}>重做（{current.future.length}）</button><button type="button" onClick={() => { setPair(null); setBrush(previous => ({ ...previous, kind: 'inspect' })); }}>清除画笔 / 停笔</button><button type="button" className="m3-editor-danger" disabled={readonly} onClick={() => confirm('清空整张画布？', '所有格子恢复地板，移除动物、障碍、覆盖、绳边、传送门和补充点。名称、目标与阶段不变。可撤销。', () => { change(clearBoard(level)); setPair(null); }, '确认清空')}>清空画布</button></div>
        <BrushPanel level={level} brush={brush} readonly={readonly} onChoose={chooseBrush} onChange={setBrush} />
        <Canvas key={workspace.selected} level={level} brush={brush} readonly={readonly} pair={pair} onPaint={paint} onPair={connect} onCancelPair={() => setPair(null)} />
        <section className="m3-editor-validation" aria-label="关卡校验报告"><h2>校验报告</h2><p>{report.errors.length ? `${report.errors.length} 项错误：可以暂存 / 导出草稿，但不能发布或试关。` : '结构校验通过，可以发布或独立试关。'}</p>{!!report.errors.length && <ul className="m3-editor-error">{report.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}{!!report.warnings.length && <><h3>警告 / 可达性提示</h3><ul>{report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></>}<p className="m3-editor-small">结构合法不保证一定可通关。试关结果由独立编辑器会话展示，不是“测试 / 破解模式”，不会解锁正式关卡。</p></section>
      </section>
      <Properties level={level} readonly={readonly} onChange={change} onResize={resize} />
    </div>
    {dialog?.kind === 'confirm' && <Modal title={dialog.title} onClose={() => setDialog(null)} className="m3-editor-modal"><p>{dialog.message}</p><div className="m3-editor-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button type="button" className="m3-editor-primary" onClick={() => { const action = dialog.action; setDialog(null); action(); }}>{dialog.label}</button></div></Modal>}
    {dialog?.kind === 'import' && <Modal title={`确认导入 ${dialog.levels.length} 关`} onClose={() => setDialog(null)} className="m3-editor-modal m3-editor-import-modal"><p>已全部校验。内置来源已转为独立用户包，旧存档和内置关不变。取消不会修改任何关卡。</p>{!conflicts.length && <p>没有同标识冲突，将新增到用户集合。</p>}
      <div className="m3-editor-import-preview">{dialog.levels.map(item => <p key={levelKey(item)}>{item.title} · {item.width}×{item.height} · {item.moves} 步 <small>{levelKey(item)}</small></p>)}</div>
      {conflicts.map(conflict => <fieldset key={conflict.key} className="m3-editor-conflict"><legend>同标识冲突：{conflict.key}</legend><div className="m3-editor-compare"><div><strong>当前（含未发布草稿）</strong><p>{conflict.existing.title}</p><p>修订 {conflict.existing.revision} / {conflict.existing.width}×{conflict.existing.height} / {conflict.existing.moves} 步</p></div><div><strong>即将导入</strong><p>{conflict.incoming.title}</p><p>修订 {conflict.incoming.revision} / {conflict.incoming.width}×{conflict.incoming.height} / {conflict.incoming.moves} 步</p></div></div><p>差异字段：{changedFields(conflict.existing, conflict.incoming).join('、') || '内容相同（仍需确认）'}</p><label className="m3-editor-field">处理方式<select value={dialog.choices[conflict.key] ?? ''} onChange={event => { const choice = event.target.value as ImportChoice; setDialog({ ...dialog, choices: { ...dialog.choices, [conflict.key]: choice } }); }}><option value="">请选择，不会自动覆盖</option><option value="overwrite">覆盖当前关卡及草稿（稳定 ID 不变）</option><option value="copy">另存新 ID（保留当前关卡及草稿）</option></select></label></fieldset>)}
      <div className="m3-editor-actions"><button type="button" onClick={() => setDialog(null)}>取消整次导入</button><button type="button" className="m3-editor-primary" disabled={conflicts.some(c => !dialog.choices[c.key])} onClick={completeImport}>确认原子导入</button></div>
    </Modal>}
  </main>;
}
