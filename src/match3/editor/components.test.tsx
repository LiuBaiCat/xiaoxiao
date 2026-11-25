import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTemplate, levelKey } from '../levels/schema';
import { BrushPanel, Canvas, describeCell } from './Canvas';
import Editor from './Editor';
import { Properties } from './Forms';
import { defaultBrush } from './model';
import { DRAFT_KEY } from './transfers';

vi.mock('../levels/registry', async () => {
  const { createTemplate } = await import('../levels/schema');
  return { builtinLevels: [{ ...createTemplate(), packId: 'builtin', id: 'builtin-one', title: '内置第一关' }] };
});
const noop = () => {};
beforeEach(() => { vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: vi.fn() } }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('editor component structure and affordances', () => {
  it('renders readonly builtins, real grid controls and the agreed management actions', () => {
    const html = renderToStaticMarkup(<Editor levels={[]} onClose={noop} onPlay={noop} onChange={() => true} />);
    expect(html).toContain('内置第一关'); expect(html).toContain('当前是内置只读关卡');
    expect(html).toContain('aria-readonly="true"');
    expect(html.match(/role="gridcell"/g)).toHaveLength(81);
    expect(html).toMatch(/disabled=""[^>]*>发布到用户关卡/);
    for (const label of ['新建 9×9', '复制 / 另存', '导入 JSON', '导出当前 JSON', '独立试关', '撤销', '重做', '校验报告']) expect(html).toContain(label);
    expect(html).not.toContain('<textarea');
  });
  it('renders the passed user collection as editable without mingling builtins', () => {
    const level = { ...createTemplate(), packId: 'user', id: 'u1', title: '我的第一关' };
    const html = renderToStaticMarkup(<Editor levels={[level]} onClose={noop} onPlay={noop} onChange={() => true} />);
    expect(html).toContain('我的第一关'); expect(html).toContain('内置第一关');
    expect(html).toContain('aria-readonly="false"');
    expect(html).toContain('当前关卡与已发布版本一致');
    expect(html).toContain('删除 我的第一关');
  });
  it('restores invalid drafts for visual repair, escapes titles and disables trial/publication', () => {
    const level = { ...createTemplate(), packId: 'user', title: '<img src=x onerror=alert(1)>', moves: 0 };
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => key === DRAFT_KEY ? JSON.stringify({ version: 1, selected: levelKey(level), levels: [level] }) : null } });
    const html = renderToStaticMarkup(<Editor levels={[]} onClose={noop} onPlay={noop} onChange={() => true} />);
    expect(html).toContain('已恢复独立编辑草稿');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toMatch(/disabled=""[^>]*>发布到用户关卡/);
    const trialButton = html.match(/<button[^>]*>[^]*?独立试关<\/button>/)?.[0] ?? '';
    expect(trialButton).toContain('disabled=""');
    expect(html).toContain('不能发布或试关');
  });
  it('surfaces corrupt draft reads instead of silently replacing them', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '{broken' } });
    const html = renderToStaticMarkup(<Editor levels={[]} onClose={noop} onPlay={noop} onChange={() => true} />);
    expect(html).toContain('原草稿未覆盖'); expect(html).toContain('允许重建草稿存储'); expect(html).toContain('导出全部用户草稿备份');
  });
  it('uses large addressable cells with distinct visual and readable layer labels', () => {
    const level = createTemplate();
    level.initialPieces = [{ row: 0, col: 0, kind: 1, special: 'bomb' }];
    level.ice = [{ row: 0, col: 0, layers: 3 }];
    level.locks = [{ row: 0, col: 0, type: 'fur' }];
    level.ropes = [{ from: { row: 0, col: 0 }, to: { row: 0, col: 1 } }];
    level.portals = [{ id: 'door', from: { row: 8, col: 0 }, to: { row: 0, col: 1 } }];
    const html = renderToStaticMarkup(<Canvas level={level} readonly={false} brush={defaultBrush} pair={null} onPaint={() => true} onPair={noop} onCancelPair={noop} />);
    expect(html).toContain('--m3-editor-cell-size:64px');
    expect(html).toContain('第1行第1列'); expect(html).toContain('m3-editor-ice-badge'); expect(html).toContain('m3-editor-lock-fur'); expect(html).toContain('m3-editor-rope-right');
    expect(html).toContain('门1入'); expect(html).toContain('门1出');
    expect(describeCell(level, { row: 0, col: 0 }).join(' ')).toContain('冰层 3 层');
    expect(describeCell(level, { row: 0, col: 0 }).join(' ')).toContain('灰毛球');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });
  it('exposes every brush with real per-brush settings rather than a JSON textarea', () => {
    const level = createTemplate();
    const gift = renderToStaticMarkup(<BrushPanel level={level} brush={{ ...defaultBrush, kind: 'gift' }} readonly={false} onChange={noop} onChoose={noop} />);
    for (const label of ['普通动物', '横扫', '纵扫', '炸弹', '魔力鸟', '冰层', '雪块', '礼盒', '毒液', '水晶球', '藤蔓', '灰毛球', '绳边', '传送门', '补充点', '擦除', '礼盒指定颜色', '奖励次数']) expect(gift).toContain(label);
    expect(gift).toContain('aria-pressed="true"');
    const crystal = renderToStaticMarkup(<BrushPanel level={level} brush={{ ...defaultBrush, kind: 'crystal' }} readonly={false} onChange={noop} onChoose={noop} />);
    expect(crystal).toContain('水晶球循环顺序'); expect(crystal).toContain('删除序列第1项');
    const eraser = renderToStaticMarkup(<BrushPanel level={level} brush={{ ...defaultBrush, kind: 'erase' }} readonly={false} onChange={noop} onChoose={noop} />);
    expect(eraser).toContain('只擦除哪一层'); expect(eraser).toContain('相连传送门整对');
  });
  it('renders all structured properties and goal types, with one-based stage input labels', () => {
    const level = createTemplate();
    level.goals = [{ id: 'c', type: 'clear', obstacle: 'snow', unit: 'layers', count: 3 }, { id: 's', type: 'special', special: 'bird', count: 1 }];
    const html = renderToStaticMarkup(<Properties level={level} readonly={false} onChange={noop} onResize={noop} />);
    for (const label of ['关卡名称', '列数（3—12）', '总行数（3—60）', '应用尺寸', '初始步数', '小锤子次数', '自由交换次数', '重排次数', '随机种子', '起始行（第几行）', '本段行数', '分段向下滚动', '收集动物', '清除障碍', '触发特效', '获得分数', '减掉的层数', '彻底清掉的对象数']) expect(html).toContain(label);
    expect(html).not.toContain('<textarea');
  });
});
