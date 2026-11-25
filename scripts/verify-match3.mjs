import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const dev = 'http://127.0.0.1:5173/';
const offline = new URL('../dist/index.html', import.meta.url).href;
const replays = JSON.parse(await readFile(new URL('../src/match3/levels/winning-replays.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const keys = { save: 'slow-paws-match3:save:v1', levels: 'slow-paws-match3:levels:v1', draft: 'slow-paws-match3:editor:v1' };
const app = page => page.locator('.m3-app');
const board = page => page.getByRole('grid', { name: /消消乐棋盘/ });
const cell = (page, index) => board(page).locator(`[data-m3-index="${index}"]`);
const dialog = page => page.locator('dialog[open]').last();
const button = (target, name) => target.getByRole('button', { name, exact: typeof name === 'string' });
const card = (page, game = 'match3') => page.locator(`[data-game-card="${game}"]`);
const read = (page, key = 'save') => page.evaluate(key => localStorage.getItem(key), keys[key]);
const saved = async page => JSON.parse(await read(page));
const phase = (page, value) => expect(app(page)).toHaveAttribute('data-m3-phase', value);
const turn = (page, value) => expect(app(page)).toHaveAttribute('data-m3-turn', String(value));
const moves = (page, value) => expect(page.locator('.m3-moves strong')).toHaveText(String(value));
const resume = page => button(dialog(page), '继续游戏').click();
const screenshot = (page, name) => page.screenshot({ path: `artifacts/match3-${name}.png`, fullPage: true });

async function open(url = dev, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const external = [];
  if (url === offline) page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await page.goto(url);
  return { context, page, external };
}

async function clickSwap(page, from, to) {
  await cell(page, from).click();
  await cell(page, to).click();
}

async function testMode(page) {
  await button(page, '测试／破解模式').click();
  await button(dialog(page), '测试消消乐').click();
  await expect(app(page)).toHaveAttribute('data-m3-mode', 'test');
  await expect(page.locator('.m3-test-panel')).not.toHaveAttribute('open', '');
  await resume(page);
  await page.getByText('测试中 · 展开测试工具', { exact: true }).click();
}

async function entryAndInput(page) {
  await expect(card(page, 'link')).toHaveText(/开心连连看/);
  await expect(card(page)).toHaveText(/开心消消乐/);
  await screenshot(page, 'home');
  await button(card(page), '选择关卡').click();
  await expect(dialog(page).locator('.m3-level-picker button')).toHaveCount(20);
  await expect(dialog(page).locator('.m3-level-picker button:enabled')).toHaveCount(1);
  await expect(dialog(page).locator('.m3-level-picker button').first().getByLabel(/最高 0 颗星/)).toBeVisible();
  await button(dialog(page), '关闭弹窗').click();
  await phase(page, 'paused');
  await resume(page);
  const opening = (await saved(page)).game;
  const invalid = await page.evaluate(async game => {
    const { wouldMatch } = await import('/src/match3/engine/matches.ts');
    const width = game.level.width;
    const from = game.board.findIndex((cell, at) =>
      at % width < width - 1 && cell.piece.kind !== game.board[at + 1].piece.kind
      && !wouldMatch(game, { from: at, to: at + 1 }));
    return [from, from + 1];
  }, opening);
  expect(invalid[0]).toBeGreaterThanOrEqual(0);
  await clickSwap(page, ...invalid);
  await expect(page.getByRole('status')).toContainText('不扣步数');
  await turn(page, 0);
  expect((await saved(page)).game.board).toEqual(opening.board);
  await button(page, '提示').click();
  await expect(board(page).locator('.m3-hint')).toHaveCount(2);
  await moves(page, opening.movesLeft);

  const [first, second, third] = replays[0].actions;
  await clickSwap(page, ...first);
  await turn(page, 1);
  const from = await cell(page, second[0]).boundingBox();
  const to = await cell(page, second[1]).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 4 });
  await page.mouse.up();
  await turn(page, 2);

  await button(page, '暂停休息').click();
  await phase(page, 'paused');
  await expect(board(page)).toBeHidden();
  expect(await page.locator('.m3-board').evaluate(grid => [...grid.querySelectorAll('.m3-cell')].every(item => item.disabled))).toBe(true);
  await expect(button(dialog(page), '继续游戏')).toBeFocused();
  const paused = await read(page);
  await screenshot(page, 'paused');
  await page.clock.runFor(1000);
  expect(await read(page)).toBe(paused);
  await resume(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await phase(page, 'paused');
  expect((await saved(page)).game.pauseReason).toBe('away');
  await page.reload();
  await button(card(page), '继续游戏').click();
  await phase(page, 'paused');
  await resume(page);
  await turn(page, 2);
  await cell(page, third[0]).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, third[1])).toBeFocused();
  await page.keyboard.press('Space');
  await phase(page, 'won');
  await expect(dialog(page)).toContainText('这一关完成了');
}

async function replayLevels(page) {
  const initialObstacles = new Set();
  let advanced = 0;
  for (const [index, replay] of replays.entries()) {
    if (index === 0) continue; // The first replay uses mouse, drag and keyboard in entryAndInput.
    await button(dialog(page), '下一关').click();
    await resume(page);
    const opening = (await saved(page)).game;
    expect(`${opening.level.packId}/${opening.level.id}`).toBe(replay.key);
    expect(opening.level.seed).toBe(replay.seed);
    for (const item of await board(page).locator('[data-obstacle]').evaluateAll(cells => cells.map(cell => cell.dataset.obstacle))) initialObstacles.add(item);
    if (await board(page).locator('[data-ice]:not([data-ice="0"])').count()) initialObstacles.add('ice');
    if (await board(page).locator('.m3-edges g').count()) initialObstacles.add('rope');
    if (await board(page).locator('.m3-portal').count()) initialObstacles.add('portal');
    if ([2, 8, 11, 14, 16, 19].includes(index)) await screenshot(page, `level-${index + 1}`);
    let stage = 0;
    for (const action of replay.actions) {
      if (action[0] === 'hammer') {
        await button(page, /^小锤子/).click();
        await cell(page, action[1]).click();
      } else if (action[0] === 'shuffle') {
        await button(page, /^重排/).click();
      } else {
        await clickSwap(page, ...action);
      }
      const current = (await saved(page)).game;
      if (current.stageIndex !== stage) {
        advanced += current.stageIndex - stage;
        stage = current.stageIndex;
        await expect(board(page)).toHaveAccessibleName(`消消乐棋盘，第${stage + 1}区域`);
        if (index === 16) await screenshot(page, 'second-stage');
      }
    }
    await phase(page, 'won');
    const result = await saved(page);
    expect(result.game.turn).toBe(replay.turns);
    expect(result.game.movesLeft).toBe(opening.movesLeft - replay.turns);
    expect(result.completed).toEqual(replays.slice(0, index + 1).map(item => item.key));
  }
  expect([...initialObstacles].sort()).toEqual(['crystal', 'fur', 'gift', 'ice', 'poison', 'portal', 'rope', 'snow', 'vine']);
  expect(advanced).toBe(6);
}

async function isolation(page) {
  const normal = await read(page);
  await button(dialog(page), '返回首页').click();
  await testMode(page);
  await expect(page.getByLabel('测试关卡').locator('option')).toHaveCount(20);
  await screenshot(page, 'test-tools');
  await moves(page, '不限');
  await button(page, '自动走一步').click();
  await turn(page, 1);
  await moves(page, '不限');
  await page.getByLabel('无限步数').uncheck();
  await moves(page, 32);
  await button(page, '自动走一步').click();
  await turn(page, 2);
  await moves(page, 31);
  await button(page, /^小锤子/).click();
  await cell(page, 0).click();
  await expect(button(page, /^小锤子/)).toHaveText(/不限/);
  await page.getByLabel('无限道具').uncheck();
  await expect(button(page, /^小锤子/)).toHaveText(/2/);
  await button(page, /^小锤子/).click();
  await cell(page, 0).click();
  await expect(button(page, /^小锤子/)).toHaveText(/1/);
  await moves(page, 31);
  await button(page, '重开本关').click();
  await resume(page);
  await turn(page, 0);
  await page.getByLabel('测试关卡').selectOption(replays.at(-1).key);
  await resume(page);
  await button(page, '立即失败').click();
  await phase(page, 'failed');
  await button(dialog(page), '重新挑战').click();
  await resume(page);
  await button(page, '一键通关').click();
  await phase(page, 'won');
  expect(await read(page)).toBe(normal);

  await button(dialog(page), '退出测试').click();
  await expect(app(page)).toHaveAttribute('data-m3-mode', 'normal');
  expect(await read(page)).toBe(normal);
  await button(dialog(page), '返回首页').click();
  await testMode(page);
  await button(page, '自动走一步').click();
  await page.reload();
  await expect(card(page)).toBeVisible();
  expect(await read(page)).toBe(normal);
}

async function editor(page) {
  const normal = await read(page);
  await button(page, '关卡管理').click();
  await button(page, '＋ 新建 9×9 关卡').click();
  await page.getByLabel('关卡名称').fill('浏览器试验关');
  await page.getByLabel('1 星分数').fill('1200');
  await page.getByLabel('2 星分数').fill('2400');
  await page.getByLabel('3 星分数').fill('3600');
  await page.getByLabel('列数（3—12）').fill('8');
  await button(page, '应用尺寸').click();
  const grid = page.getByRole('grid', { name: '关卡编辑网格' });
  const square = (row, col) => grid.locator(`[data-row="${row}"][data-col="${col}"]`);
  await expect(grid).toHaveAttribute('aria-colcount', '8');
  await button(page, '空洞').click();
  await button(dialog(page), '启用空洞').click();
  await square(0, 0).click();
  await expect(square(0, 0)).toHaveAccessibleName(/空洞/);
  await button(page, /撤销/).click();
  await expect(square(0, 0)).not.toHaveAccessibleName(/空洞/);
  await button(page, /重做/).click();
  await expect(square(0, 0)).toHaveAccessibleName(/空洞/);
  await button(page, '冰层').click();
  await square(1, 2).click();
  await button(page, '绳边').click();
  await square(1, 0).click();
  await square(1, 1).click();
  await button(page, '传送门').click();
  await square(4, 7).click();
  await square(0, 6).click();
  await page.getByLabel('分段向下滚动').check();
  await page.getByLabel('本段行数').fill('5');
  await button(page, '＋ 添加阶段').click();
  const stage = page.getByRole('group', { name: '阶段 1', exact: true });
  await button(stage, '＋ 添加目标').click();
  await stage.getByLabel(/数量/).fill('3');
  await button(page, '暂存草稿').click();
  const draft = JSON.parse(await read(page, 'draft')).levels.find(level => level.title === '浏览器试验关');
  expect(draft).toMatchObject({ width: 8, scroll: true, ice: [{ row: 1, col: 2 }], ropes: [{ from: { row: 1, col: 0 }, to: { row: 1, col: 1 } }], portals: [{ from: { row: 4, col: 7 }, to: { row: 0, col: 6 } }] });
  expect(draft.stages.map(stage => stage.rows)).toEqual([5, 4]);
  expect(draft.stages[0].goals[0].count).toBe(3);
  await page.reload();
  expect(await read(page)).toBe(normal);
  await button(page, '关卡管理').click();
  await expect(page.getByLabel('关卡名称')).toHaveValue(draft.title);
  await screenshot(page, 'editor');
  await button(page, '发布到用户关卡').click();
  await expect(page.getByRole('status')).toContainText('已发布');
  const published = await read(page, 'levels');
  await page.getByLabel('初始步数').fill('45');
  await button(page, '独立试关').click();
  await expect(app(page)).toHaveAttribute('data-m3-mode', 'editor');
  await expect(dialog(page)).toContainText('45步');
  await resume(page);
  await page.getByText('试关中 · 展开测试工具', { exact: true }).click();
  await button(page, '自动走一步').click();
  await turn(page, 1);
  await button(page, '重开本关').click();
  await expect(dialog(page)).toContainText('45步');
  await button(dialog(page), '返回编辑器').click();
  expect(await read(page)).toBe(normal);
  expect(await read(page, 'levels')).toBe(published);
  await expect(page.getByLabel('初始步数')).toHaveValue('45');

  const [download] = await Promise.all([page.waitForEvent('download'), button(page, '导出当前 JSON').click()]);
  const file = await download.path();
  const exported = JSON.parse(await readFile(file, 'utf8'));
  expect(exported).toMatchObject({ title: draft.title, moves: 45, starThresholds: [1200, 2400, 3600] });
  const upload = page.getByLabel('选择关卡 JSON 文件（可多选）');
  const send = (name, contents) => upload.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(contents) });
  await send('invalid.json', '{"width":10000}');
  await expect(page.getByRole('alert')).toContainText('操作未完成');
  expect(await read(page, 'levels')).toBe(published);
  await send('round-trip.json', JSON.stringify(exported));
  await expect(dialog(page)).toContainText('同标识冲突');
  await expect(button(dialog(page), '确认原子导入')).toBeDisabled();
  await button(dialog(page), '取消整次导入').click();
  expect(await read(page, 'levels')).toBe(published);
  await send('round-trip.json', JSON.stringify(exported));
  await dialog(page).getByLabel('处理方式').selectOption('copy');
  await button(dialog(page), '确认原子导入').click();
  await expect(page.getByRole('status')).toContainText('已原子导入 1 关');
  const imported = JSON.parse(await read(page, 'levels')).levels;
  expect(imported).toHaveLength(2);
  expect(imported.map(level => level.moves).sort()).toEqual([45, draft.moves].sort());
  expect(await read(page)).toBe(normal);
}

async function offlineLayout() {
  const sizes = [];
  for (const [width, height] of [[1280, 720], [1366, 768], [1920, 1080]]) {
    for (const zoom of [1, 1.25, 1.5, 2]) {
      const { context, page, external } = await open(offline, {
        offline: true, viewport: { width: Math.round(width / zoom), height: Math.round(height / zoom) }, deviceScaleFactor: zoom,
      });
      try {
        await testMode(page);
        await page.getByLabel('测试关卡').selectOption(replays.at(-1).key);
        await resume(page);
        await page.getByText('测试中 · 展开测试工具', { exact: true }).click();
        await expect(board(page).getByRole('row')).toHaveCount(9);
        await expect(board(page).getByRole('gridcell')).toHaveCount(81);
        const fit = await page.evaluate(() => {
          const grid = document.querySelector('.m3-board');
          const bounds = grid.getBoundingClientRect();
          const playable = [...grid.querySelectorAll('.m3-cell:not(.m3-hole)')];
          const overlap = playable.some(cell => {
            const box = cell.getBoundingClientRect();
            return !cell.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          });
          return {
            overlap, size: playable[0].getBoundingClientRect().width,
            top: bounds.top - document.querySelector('.m3-top').getBoundingClientRect().bottom,
            bottom: innerHeight - bounds.bottom,
            overflow: document.documentElement.scrollWidth - innerWidth,
          };
        });
        expect(fit.overlap, JSON.stringify(fit)).toBe(false);
        expect(fit.top).toBeGreaterThanOrEqual(0);
        expect(fit.bottom).toBeGreaterThanOrEqual(0);
        expect(fit.overflow).toBeLessThanOrEqual(1);
        expect(fit.size * zoom).toBeGreaterThanOrEqual(30);
        sizes.push(Math.round(fit.size * zoom));
        await screenshot(page, `fit-${width}x${height}-${zoom * 100}`);
        if (width === 1280 && zoom === 1) {
          await button(page, '首页').click();
          await button(card(page), '开始游戏').click();
          await resume(page);
          await clickSwap(page, ...replays[0].actions[0]);
          await turn(page, 1);
          await page.reload();
          await button(card(page), '继续游戏').click();
          await phase(page, 'paused');
          await turn(page, 1);
          await button(dialog(page), '返回首页').click();
          await button(card(page, 'link'), '开始游戏').click();
          await expect(page.locator('.tile')).toHaveCount(140);
        }
        expect(external).toEqual([]);
      } finally {
        await context.close();
      }
    }
  }
  console.log('12 个等效缩放下的三消格宽（设备像素）', sizes);
}

let current;
try {
  ({ page: current } = await open());
  await entryAndInput(current);
  await isolation(current);
  await button(card(current), '继续游戏').click();
  await replayLevels(current);
  await button(dialog(current), '返回首页').click();
  await editor(current);
  await offlineLayout();
  expect(errors).toEqual([]);
  console.log('消消乐浏览器回归通过：20 关真实操作、九类障碍、游戏与编辑器隔离、离线双游戏及缩放。');
} catch (error) {
  if (current) await screenshot(current, 'failure').catch(() => {});
  throw error;
} finally {
  await browser.close();
}
