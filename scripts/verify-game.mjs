import { chromium, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

function watchAudio() {
  const NativeAudioContext = window.AudioContext;
  window.__audioProbe = { notes: [], masters: [], contexts: [] };
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) { super(...args); this.gainCount = 0; window.__audioProbe.contexts.push(this); }
    createOscillator() {
      const node = super.createOscillator();
      const start = node.start.bind(node);
      const setFrequency = node.frequency.setValueAtTime.bind(node.frequency);
      let frequency = node.frequency.value;
      node.frequency.setValueAtTime = (value, time) => { frequency = value; return setFrequency(value, time); };
      node.start = time => { window.__audioProbe.notes.push(Math.round(frequency * 100) / 100); start(time); };
      return node;
    }
    createGain() {
      const node = super.createGain();
      if (this.gainCount++ === 0) {
        const set = node.gain.setValueAtTime.bind(node.gain);
        node.gain.setValueAtTime = (value, time) => { window.__audioProbe.masters.push(value); return set(value, time); };
      }
      return node;
    }
  };
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
await context.addInitScript(watchAudio);
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const click = name => page.getByRole('button', { name, exact: true }).click();
const timerSeconds = async () => {
  return Number.parseInt(await page.getByTestId('timer').innerText(), 10);
};
const screenshot = name => page.screenshot({ path: `artifacts/${name}.png`, fullPage: true });
const nextFrame = () => page.clock.runFor(650);
const expectSound = async (frequencies, target = page) => {
  await expect.poll(() => target.evaluate(length => window.__audioProbe.notes.slice(-length), frequencies.length)).toEqual(frequencies);
};
const expectFullBoard = async () => {
  await expect(page.locator('.tile')).toHaveCount(140);
  expect(await page.locator('.board-surface').evaluate(surface => [Number(surface.style.getPropertyValue('--rows')), Number(surface.style.getPropertyValue('--cols'))])).toEqual([10, 14]);
};
const expectBoardFits = async target => {
  const fit = await target.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const area = document.querySelector('.game-board-wrap').getBoundingClientRect();
    const tiles = [...document.querySelectorAll('.tile')];
    const outside = tiles.filter(tile => {
      const r = tile.getBoundingClientRect();
      return r.width <= 0 || r.height <= 0 || r.left < -1 || r.top < area.top - 1 || r.right > viewport.width + 1 || r.bottom > viewport.height + 1 || r.bottom > area.bottom + 1;
    }).map(tile => tile.dataset.cell);
    const covered = tiles.filter(tile => {
      const r = tile.getBoundingClientRect();
      return !tile.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }).map(tile => tile.dataset.cell);
    const misplacedControls = [...document.querySelectorAll('.game-main button:not(.tile), .game-main summary')].filter(control => {
      if (control.closest('details:not([open])') && control.tagName !== 'SUMMARY') return false;
      const r = control.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.top < -1 || r.left < -1 || r.right > viewport.width + 1 || r.bottom > area.top + 1);
    }).map(control => control.textContent);
    return { outside, covered, misplacedControls, overflowX: document.documentElement.scrollWidth - viewport.width, overflowY: document.documentElement.scrollHeight - viewport.height, tileSize: tiles[0]?.getBoundingClientRect().width ?? 0 };
  });
  expect(fit.outside, JSON.stringify(fit)).toEqual([]);
  expect(fit.covered, JSON.stringify(fit)).toEqual([]);
  expect(fit.misplacedControls, JSON.stringify(fit)).toEqual([]);
  expect(fit.overflowX).toBeLessThanOrEqual(1);
  expect(fit.overflowY).toBeLessThanOrEqual(1);
  return fit.tileSize;
};
const expectExitCancel = async () => {
  const title = await page.getByRole('dialog').getByRole('heading').innerText();
  await page.getByRole('dialog').getByRole('button', { name: '退出游戏', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toContainText('要退出游戏吗');
  await click('暂不退出');
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText(title);
};
const setTestTools = async open => {
  if ((await page.locator('.test-panel').getAttribute('open') !== null) !== open) await page.getByLabel('测试工具', { exact: true }).click();
};
const selectTestLevel = async id => {
  await setTestTools(true);
  if (await page.getByLabel('测试关卡', { exact: true }).inputValue() === String(id)) return;
  await page.getByLabel('测试关卡', { exact: true }).selectOption(String(id));
  await click('开始这一关');
};
const actualPair = async () => {
  const move = await page.evaluate(async () => {
    const { findMove } = await import('/src/engine/board.ts');
    const surface = document.querySelector('.board-surface');
    const rows = Number(surface.style.getPropertyValue('--rows'));
    const cols = Number(surface.style.getPropertyValue('--cols'));
    const board = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (const tile of document.querySelectorAll('.tile')) {
      const [row, col] = tile.dataset.cell.split('-').map(Number);
      board[row][col] = { id: Number(tile.dataset.testid.replace('tile-', '')), kind: Number(tile.dataset.kind) };
    }
    return findMove(board);
  });
  expect(move).not.toBeNull();
  await page.locator(`[data-cell="${move.from.row}-${move.from.col}"]`).click();
  await page.locator(`[data-cell="${move.to.row}-${move.to.col}"]`).click();
  await nextFrame();
};

try {
  await page.clock.install({ time: new Date('2026-11-22T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-22T00:00:01Z'));
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.getByRole('heading', { name: '开心连连看' })).toBeVisible();
  const renderedSounds = await page.evaluate(async () => {
    const { SoundPlayer, soundCues } = await import('/src/game/audio.ts');
    const results = [];
    for (const name of Object.keys(soundCues)) {
      const audio = new OfflineAudioContext(1, 88200, 44100);
      const player = new SoundPlayer({ muted: false, volume: 0.45 }, () => audio);
      player.play(name);
      const buffer = await audio.startRendering();
      const samples = buffer.getChannelData(0);
      let peak = 0, tailPeak = 0;
      for (let i = 0; i < samples.length; i++) {
        peak = Math.max(peak, Math.abs(samples[i]));
        if (i >= samples.length - 4410) tailPeak = Math.max(tailPeak, Math.abs(samples[i]));
      }
      results.push({ name, peak, tailPeak });
      player.stop();
    }
    return results;
  });
  expect(renderedSounds).toHaveLength(12);
  for (const sound of renderedSounds) {
    expect(sound.peak, `${sound.name} produces an audible waveform`).toBeGreaterThan(0.01);
    expect(sound.peak, `${sound.name} stays below clipping`).toBeLessThan(0.3);
    expect(sound.tailPeak, `${sound.name} finishes cleanly`).toBeLessThan(0.00001);
  }
  await screenshot('home-1280');
  await expect(page.locator('.level-card')).toHaveCount(0);
  await click('选择关卡');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.locator('.level-card')).toHaveCount(12);
  await expect(page.locator('.level-card:disabled')).toHaveCount(11);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await screenshot('home-1920');
  await page.setViewportSize({ width: 1280, height: 720 });
  await click('怎么玩');
  await expect(page.getByRole('dialog')).toContainText('最多拐两个弯');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__audioProbe.contexts[0]?.state)).toBe('running');
  expect(await page.evaluate(() => window.__audioProbe.notes)).toContain(660);
  await click('关闭音效');
  const mutedCount = await page.evaluate(() => window.__audioProbe.notes.length);
  await click('怎么玩');
  await click('明白了，轻松玩');
  expect(await page.evaluate(() => window.__audioProbe.notes.length)).toBe(mutedCount);
  expect(await page.evaluate(() => window.__audioProbe.masters.at(-1))).toBe(0);
  await click('开启音效');
  await page.getByLabel('调节音量', { exact: true }).click();
  await page.getByRole('slider', { name: '音效音量' }).focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('slider', { name: '音效音量' })).toHaveValue('20');
  await click('试听音效');
  expect(await page.evaluate(() => window.__audioProbe.masters.at(-1))).toBe(0.2);
  await page.getByLabel('调节音量', { exact: true }).click();
  await click('开始游戏');
  await expect(page.getByRole('dialog')).toContainText('初次见面');
  await expectExitCancel();
  await click('开始这一关');
  await expectFullBoard();
  await expect(page.getByTestId('lives')).toHaveText('5');
  await expectSound([349.23, 440]);
  await screenshot('game-1280');
  await expectBoardFits(page);
  const timeProgress = page.getByRole('progressbar', { name: '剩余时间', exact: true });
  await expect(timeProgress).toHaveAttribute('aria-valuenow', String(await timerSeconds()));
  const initialFill = await page.locator('.time-fill').evaluate(fill => Number.parseFloat(fill.style.width));
  await page.clock.runFor(60000);
  const elapsedFill = await page.locator('.time-fill').evaluate(fill => Number.parseFloat(fill.style.width));
  expect(elapsedFill).toBeLessThan(initialFill - 5);
  await expect(timeProgress).toHaveAttribute('aria-valuetext', `还剩${await timerSeconds()}秒`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await page.locator('.time-fill').evaluate(fill => getComputedStyle(fill).transitionDuration)).toBe('0.15s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const kinds = await page.locator('.tile').evaluateAll(tiles => {
    const counts = new Map();
    for (const tile of tiles) counts.set(tile.dataset.kind, (counts.get(tile.dataset.kind) ?? 0) + 1);
    return [...counts.values()];
  });
  expect(kinds).toHaveLength(18);
  expect(Math.max(...kinds)).toBeLessThanOrEqual(8);
  const different = await page.locator('.tile').evaluateAll(tiles => {
    const first = tiles[0];
    const second = tiles.find(tile => tile.dataset.kind !== first.dataset.kind);
    return [first.dataset.cell, second.dataset.cell];
  });
  await page.locator(`[data-cell="${different[0]}"]`).click();
  await expect.poll(() => page.evaluate(() => window.__audioProbe.notes.at(-1))).toBe(587.33);
  await page.locator(`[data-cell="${different[1]}"]`).click();
  await expect.poll(() => page.evaluate(() => window.__audioProbe.notes.slice(-2))).toEqual([293.66, 246.94]);
  await expect(page.getByTestId('lives')).toHaveText('5');
  await expect(page.locator('.game-message')).toContainText('点错不扣生命');
  await page.getByRole('button', { name: /提示一下/ }).click();
  await expect(page.locator('.is-hinted')).toHaveCount(2);
  await expectSound([739.99, 987.77]);
  await expect(page.getByRole('button', { name: /提示一下/ })).toBeDisabled();
  const hintPair = await page.locator('.is-hinted').evaluateAll(tiles => tiles.map(tile => tile.dataset.cell));
  expect(hintPair).toHaveLength(2);
  const beforeMatch = await timerSeconds();
  const beforeMatchFill = await page.locator('.time-fill').evaluate(fill => Number.parseFloat(fill.style.width));
  for (const cell of hintPair) await page.locator(`[data-cell="${cell}"]`).click();
  await nextFrame();
  await expect(page.locator('.tile')).toHaveCount(138);
  await expectSound([523.25, 659.25, 783.99]);
  expect(await timerSeconds()).toBeGreaterThanOrEqual(beforeMatch + 2);
  expect(await timerSeconds()).toBeLessThanOrEqual(beforeMatch + 3);
  await expect(page.locator('.game-message')).toContainText('时间 +3秒');
  const matchedFill = await page.locator('.time-fill').evaluate(fill => Number.parseFloat(fill.style.width));
  expect(matchedFill).toBeGreaterThan(beforeMatchFill);
  const beforeExtend = await timerSeconds();
  await page.getByRole('button', { name: /加时 30秒/ }).click();
  expect(await timerSeconds()).toBeGreaterThanOrEqual(beforeExtend + 29);
  await expectSound([440, 554.37, 659.25]);
  expect(await page.locator('.time-fill').evaluate(fill => Number.parseFloat(fill.style.width))).toBeGreaterThan(matchedFill + 2);
  await screenshot('time-progress');
  await click('暂停休息');
  await expectSound([440, 349.23]);
  await expectExitCancel();
  const pausedTime = await timerSeconds();
  const pausedFill = await page.locator('.time-fill').getAttribute('style');
  await page.clock.runFor(10000);
  expect(await timerSeconds()).toBe(pausedTime);
  await expect(page.locator('.time-fill')).toHaveAttribute('style', pausedFill);
  await expect(page.locator('.board-grid')).not.toBeVisible();
  await click('继续游戏');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('dialog')).toContainText('自动暂停');
  await click('继续游戏');
  await page.reload();
  await click('继续游戏');
  await expect(page.getByRole('dialog')).toContainText('上次的进度都在');
  await expect(page.getByLabel('调节音量', { exact: true })).toContainText('20%');
  expect(await page.evaluate(() => window.__audioProbe.masters.at(-1))).toBe(0.2);
  await click('继续游戏');
  await expect(page.locator('.tile')).toHaveCount(138);
  for (let pair = 0; pair < 69; pair++) await actualPair();
  await expect(page.getByRole('dialog')).toContainText('真棒，又过了一关');
  await expectSound([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5]);
  await expectExitCancel();
  await expect(page.getByTestId('lives')).toHaveText('6');
  await expect(page.getByRole('button', { name: /提示一下/ })).toContainText('4');
  await expect(page.getByRole('button', { name: /加时 30秒/ })).toContainText('3');
  await page.reload();
  await click('继续游戏');
  await expect(page.getByTestId('lives')).toHaveText('6');
  await click('出发，下一关');
  await click('开始这一关');
  await expect(page.locator('.level-title')).toContainText('小小伙伴');
  await actualPair();
  await click('返回首页');
  const normalSave = await page.evaluate(() => localStorage.getItem('slow-paws-link:save:v1'));
  await click('测试／破解模式');
  await click('开始这一关');
  await setTestTools(true);
  await expect(page.getByLabel('冻结时间')).toBeChecked();
  await expect(page.getByLabel('无限道具')).toBeChecked();
  const frozenTime = await timerSeconds();
  const frozenFill = await page.locator('.time-fill').getAttribute('style');
  await page.clock.runFor(10000);
  expect(await timerSeconds()).toBe(frozenTime);
  await expect(page.getByRole('progressbar', { name: '时间冻结', exact: true })).toHaveAttribute('aria-valuenow', String(frozenTime));
  await expect(page.locator('.time-fill')).toHaveAttribute('style', frozenFill);
  await page.getByLabel('冻结时间').uncheck();
  await page.clock.runFor(2000);
  expect(await timerSeconds()).toBeLessThan(frozenTime);
  await page.getByLabel('冻结时间').check();
  await page.getByRole('button', { name: /提示一下/ }).click();
  await expect(page.getByRole('button', { name: /提示一下/ })).toContainText('∞');
  await click('消除一对');
  await nextFrame();
  await expect(page.locator('.tile')).toHaveCount(138);
  for (let id = 2; id <= 12; id++) {
    await selectTestLevel(id);
    await expectFullBoard();
    const count = await page.locator('.tile').count();
    const beforeAutoPair = await timerSeconds();
    await click('消除一对');
    await nextFrame();
    await expect(page.locator('.tile')).toHaveCount(count - 2);
    expect(await timerSeconds()).toBe(beforeAutoPair + 3);
    await setTestTools(false);
    await expectBoardFits(page);
    if (id === 6) await screenshot('test-split-1280');
    if (id === 12) {
      const kindCount = await page.locator('.tile').evaluateAll(tiles => new Set(tiles.map(tile => tile.dataset.kind)).size);
      expect(kindCount).toBe(28);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await expectBoardFits(page);
      await screenshot('game-1920');
      await page.setViewportSize({ width: 640, height: 360 });
      await expectBoardFits(page);
      await screenshot('zoom-200');
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await setTestTools(true);
    await click('一键通关');
    await expect(page.getByRole('dialog')).toContainText(id === 12 ? '十二关，全都完成啦' : '真棒，又过了一关');
    if (id === 12) await click('回到首页');
    else {
      await click('出发，下一关');
      await click('开始这一关');
    }
  }
  await click('测试／破解模式');
  await click('开始这一关');
  await setTestTools(true);
  for (let lives = 4; lives >= 0; lives--) {
    await click('立即超时');
    await expect(page.getByTestId('lives')).toHaveText(String(lives));
    await expectSound(lives > 0 ? [349.23, 293.66, 349.23] : [392, 329.63, 261.63]);
    await expect(page.getByRole('progressbar', { includeHidden: true })).toHaveAttribute('aria-valuenow', '0');
    await expect(page.locator('.time-fill')).toHaveAttribute('style', 'width: 0%;');
    if (lives === 4 || lives === 0) await expectExitCancel();
    if (lives > 0) {
      await click('补充60秒，继续找');
      expect(await timerSeconds()).toBe(60);
    }
  }
  await expect(page.getByRole('dialog')).toContainText('生命用完了');
  await click('重新挑战这一关');
  await click('开始这一关');
  await expect(page.getByTestId('lives')).toHaveText('5');
  await click('退出测试');
  await expect(page.getByRole('dialog')).toContainText('休息一下');
  expect(await page.evaluate(() => localStorage.getItem('slow-paws-link:save:v1'))).toBe(normalSave);
  await click('继续游戏');
  await expect(page.locator('.level-title')).toContainText('小小伙伴');
  await expect(page.getByTestId('lives')).toHaveText('6');
  const firstTile = page.locator('.tile').first();
  await firstTile.focus();
  await page.keyboard.press('Enter');
  await expect(firstTile).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(firstTile).not.toBeFocused();
  await click('关闭音效');
  await page.reload();
  await expect(page.getByRole('button', { name: '开启音效', exact: true })).toBeVisible();
  await expect(page.getByLabel('调节音量', { exact: true })).toContainText('20%');
  await click('怎么玩');
  expect(await page.evaluate(() => window.__audioProbe.notes)).toEqual([]);
  await context.close();

  const fitResults = [];
  for (const [width, height] of [[1280, 720], [1366, 768], [1920, 1080]]) {
    for (const zoom of [1, 1.25, 1.5, 2]) {
      const fitContext = await browser.newContext({ viewport: { width: Math.round(width / zoom), height: Math.round(height / zoom) }, deviceScaleFactor: zoom, reducedMotion: 'reduce', offline: true });
      const fitPage = await fitContext.newPage();
      fitPage.on('pageerror', error => errors.push(error.message));
      await fitPage.goto(pathToFileURL(path.resolve('dist/index.html')).href);
      await fitPage.getByRole('button', { name: '开始游戏', exact: true }).click();
      await fitPage.getByRole('button', { name: '开始这一关', exact: true }).click();
      await expect(fitPage.locator('.tile')).toHaveCount(140);
      const tilePixels = await expectBoardFits(fitPage) * zoom;
      expect(tilePixels, `${width}×${height} at ${zoom * 100}%`).toBeGreaterThanOrEqual(40);
      fitResults.push({ width, height, zoom, tilePixels: Math.round(tilePixels) });
      await fitPage.screenshot({ path: `artifacts/fit-${width}x${height}-${zoom * 100}.png` });
      if (width === 1280 && zoom === 1) {
        await expect.poll(() => fitPage.evaluate(() => !!document.fullscreenElement)).toBe(true);
        await fitPage.getByRole('button', { name: '退出全屏', exact: true }).click();
        await expect.poll(() => fitPage.evaluate(() => !!document.fullscreenElement)).toBe(false);
        await fitPage.getByRole('button', { name: '关闭音效', exact: true }).click();
        expect(await fitPage.evaluate(() => !!document.fullscreenElement)).toBe(false);
        await fitPage.getByRole('button', { name: '全屏显示', exact: true }).click();
        await expect.poll(() => fitPage.evaluate(() => !!document.fullscreenElement)).toBe(true);
      }
      await fitContext.close();
    }
  }
  console.log('Full-board layout at equivalent browser zoom/device pixels:', JSON.stringify(fitResults));

  const offlineContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, offline: true });
  await offlineContext.addInitScript(watchAudio);
  const offline = await offlineContext.newPage();
  offline.on('pageerror', error => errors.push(error.message));
  const networkRequests = [];
  offline.on('request', request => { if (/^https?:/.test(request.url())) networkRequests.push(request.url()); });
  await offline.goto(pathToFileURL(path.resolve('dist/index.html')).href);
  await expect(offline.getByRole('heading', { name: '开心连连看' })).toBeVisible();
  await offline.getByRole('button', { name: '开始游戏', exact: true }).click();
  await offline.getByRole('button', { name: '开始这一关', exact: true }).click();
  await expect(offline.locator('.tile')).toHaveCount(140);
  await offline.getByRole('button', { name: /提示一下/ }).click();
  await expect(offline.locator('.is-hinted')).toHaveCount(2);
  await expectSound([739.99, 987.77], offline);
  await expect.poll(() => offline.evaluate(() => window.__audioProbe.contexts[0]?.state)).toBe('running');
  await offline.screenshot({ path: 'artifacts/offline-game.png', fullPage: true });
  await offline.reload();
  await offline.getByRole('button', { name: '继续游戏', exact: true }).click();
  await expect(offline.getByRole('dialog')).toContainText('上次的进度都在');
  expect(networkRequests).toEqual([]);
  await offlineContext.close();

  const closeContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, offline: true, reducedMotion: 'reduce' });
  await closeContext.addInitScript(() => {
    window.__fullscreenRequests = 0;
    const requestFullscreen = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (...args) {
      window.__fullscreenRequests++;
      return requestFullscreen.apply(this, args);
    };
    const close = window.close;
    window.close = () => {
      window.__savedAtClose = JSON.parse(localStorage.getItem('slow-paws-link:save:v1'));
      close.call(window);
    };
  });
  const closing = await closeContext.newPage();
  closing.on('pageerror', error => errors.push(error.message));
  await closing.clock.install({ time: new Date('2026-11-22T00:00:00Z') });
  await closing.clock.pauseAt(new Date('2026-11-22T00:00:01Z'));
  await closing.goto(pathToFileURL(path.resolve('dist/index.html')).href);
  await expect.poll(() => closing.evaluate(() => window.__fullscreenRequests)).toBe(1);
  await closing.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect.poll(() => closing.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await closing.getByRole('button', { name: '开始这一关', exact: true }).click();
  await closing.clock.fastForward(540000);
  await expect(closing.getByTestId('timer')).toHaveText('540秒');
  await expect(closing.locator('.time-fill')).toHaveAttribute('style', 'width: 50%;');
  await closing.screenshot({ path: 'artifacts/countdown-half.png', fullPage: true });
  await closing.clock.fastForward(520000);
  await expect(closing.locator('.time-stat')).toHaveClass(/time-low/);
  await closing.getByRole('button', { name: /加时 30秒/ }).click();
  await expect(closing.getByTestId('timer')).toHaveText('50秒');
  await expect(closing.locator('.time-stat')).not.toHaveClass(/time-low/);
  await closing.getByRole('button', { name: '关闭游戏', exact: true }).click();
  await expect(closing.getByRole('dialog')).toHaveCount(1);
  await expect(closing.getByRole('dialog')).toContainText('进度已保存');
  const exitTime = await closing.getByTestId('timer').innerText();
  await closing.clock.runFor(10000);
  await expect(closing.getByTestId('timer')).toHaveText(exitTime);
  const savedOnExit = await closing.evaluate(() => JSON.parse(localStorage.getItem('slow-paws-link:save:v1')));
  expect(savedOnExit.phase).toBe('paused');
  expect(savedOnExit.remainingMs).toBe(Number.parseInt(exitTime, 10) * 1000);
  await closing.getByRole('button', { name: '暂不退出', exact: true }).click();
  await expect(closing.getByRole('dialog')).toContainText('休息一下，时间停住了');
  await closing.getByRole('dialog').getByRole('button', { name: '退出游戏', exact: true }).click();
  await closing.evaluate(() => history.pushState({}, '', '#close-check'));
  await closing.getByRole('button', { name: '确定退出', exact: true }).click();
  await expect(closing.getByRole('dialog')).toContainText('Ctrl + W');
  await expect.poll(() => closing.evaluate(() => !!document.fullscreenElement)).toBe(false);
  expect(await closing.evaluate(() => window.__savedAtClose)).toEqual(savedOnExit);
  await closing.screenshot({ path: 'artifacts/exit-fallback.png', fullPage: true });
  await closing.getByRole('button', { name: '返回游戏', exact: true }).click();
  await expect(closing.getByRole('dialog')).toContainText('休息一下，时间停住了');
  await closing.getByRole('button', { name: '继续游戏', exact: true }).click();
  expect(await closing.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await closing.reload();
  await closing.getByRole('button', { name: '继续游戏', exact: true }).click();
  await expect(closing.getByRole('dialog')).toContainText('上次的进度都在');
  await expect(closing.getByTestId('timer')).toHaveText(exitTime);
  await closing.getByRole('button', { name: '先回首页', exact: true }).click();
  const isolatedSave = await closing.evaluate(() => localStorage.getItem('slow-paws-link:save:v1'));
  await closing.getByRole('button', { name: '测试／破解模式', exact: true }).click();
  await closing.getByRole('dialog').getByRole('button', { name: '退出游戏', exact: true }).click();
  await expect(closing.getByRole('dialog')).toContainText('测试模式的进度不会保存');
  expect(await closing.evaluate(() => localStorage.getItem('slow-paws-link:save:v1'))).toBe(isolatedSave);
  await closing.getByRole('button', { name: '暂不退出', exact: true }).click();
  await closing.getByRole('button', { name: '先回首页', exact: true }).click();
  await closing.getByRole('button', { name: '退出游戏', exact: true }).click();
  await expect(closing.getByRole('dialog')).toContainText('要退出游戏吗');
  await closing.keyboard.press('Escape');
  await expect(closing.getByRole('dialog')).toHaveCount(0);
  const popupReady = closing.waitForEvent('popup');
  await closing.evaluate(() => window.open(location.href, '_blank'));
  const popup = await popupReady;
  await popup.getByRole('button', { name: '关闭游戏', exact: true }).click();
  const popupClosed = popup.waitForEvent('close');
  await popup.getByRole('button', { name: '确定退出', exact: true }).click();
  await popupClosed;
  expect(popup.isClosed()).toBe(true);
  expect(closing.isClosed()).toBe(false);
  await closeContext.close();

  const deniedContext = await browser.newContext();
  await deniedContext.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    Object.defineProperty(window, 'AudioContext', { value: undefined });
    window.__fullscreenRequests = 0;
    Element.prototype.requestFullscreen = () => {
      window.__fullscreenRequests++;
      return Promise.reject(new DOMException('denied', 'NotAllowedError'));
    };
  });
  const denied = await deniedContext.newPage();
  await denied.goto('http://127.0.0.1:5173/');
  await expect(denied.getByRole('status')).toContainText('不支持保存');
  await denied.getByRole('button', { name: '开始游戏', exact: true }).click();
  await denied.getByRole('button', { name: '开始这一关', exact: true }).click();
  await expect(denied.locator('.tile')).toHaveCount(140);
  expect(await denied.evaluate(() => !!document.fullscreenElement)).toBe(false);
  expect(await denied.evaluate(() => window.__fullscreenRequests)).toBe(2);
  await denied.getByRole('button', { name: '全屏显示', exact: true }).click();
  await expect(denied.getByRole('status')).toContainText('F11');
  await denied.getByRole('button', { name: '关闭游戏', exact: true }).click();
  await expect(denied.getByRole('dialog')).toContainText('这次没能保存进度');
  await expect(denied.getByRole('dialog')).not.toContainText('进度已保存');
  await denied.getByRole('button', { name: '暂不退出', exact: true }).click();
  await denied.getByRole('button', { name: '继续游戏', exact: true }).click();
  expect(await denied.evaluate(() => window.__fullscreenRequests)).toBe(3);
  await deniedContext.close();
  expect(errors).toEqual([]);
  console.log('Browser verification passed: full 10×14 boards at 12 resolution/zoom combinations, top controls, simplified home/level picker, 18–28 patterns, +3s per pair, smooth countdown progress, automatic/manual/denied fullscreen, exit cancellation and saved progress, native blocked-tab fallback and successful popup closure, sound/mute/volume, full gameplay, rewards, 12 levels, test isolation, timeout, keyboard, offline HTML/audio, unavailable storage/audio.');
} catch (error) {
  if (!page.isClosed()) {
    await page.screenshot({ path: 'artifacts/browser-failure.png', fullPage: true }).catch(() => {});
    console.error(await page.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
}
