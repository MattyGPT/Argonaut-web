/** Optional Edge regression. npm start, then PLAYWRIGHT_MODULE=<existing
 * playwright-core> node scripts/check-combat-console.mjs. No dependencies are
 * installed. CONSOLE_OUTPUT optionally saves desktop, narrow, and 200% layouts.
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.CONSOLE_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  const fixture = async (mode) => {
    await page.evaluate(async (mode) => {
      const { createGame } = await import('/game/state.js');
      const game = createGame({ seed: 'console-check', reimagined: mode !== 'classic', realtime: mode === 'realtime' });
      game.ships = game.ships.filter((ship) => ['fed-flagship', 'fed-cruiser-1', 'axis-flagship'].includes(ship.id));
      game.ships.forEach((ship, i) => { ship.x = (mode === 'classic' ? 40 : 100) + i * 12; ship.y = mode === 'classic' ? 50 : 100; });
      Object.assign(game.ships.find((ship) => ship.id === 'fed-cruiser-1'), { crew: 0, status: 'vacant' });
      game.terrain = [];
      game.log = Array.from({ length: 120 }, (_, i) => `Fleet traffic ${i}: routine maneuver report.`);
      const entries = Array.from({ length: 12 }, (_, i) => ({ turn: i + 1, shipName: 'Argo', messages: [`Your command ${i + 1}: phasers fired at Firebreather.`, 'Confirmed immediate result.'] }));
      localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game, commandHistory: { seed: game.seed, entries } }));
      localStorage.removeItem('argonaut-web-save-campaign-v1');
      localStorage.setItem('argonaut-web-theme', 'modern');
      localStorage.removeItem('argonaut-web-console-sections');
    }, mode);
    await page.reload();
    if (mode === 'realtime') await page.click('#pause-button');
  };
  const geometry = async (mode, width, height) => {
    const measured = await page.evaluate(() => {
      const rect = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height }; };
      const controls = [...document.querySelectorAll('.console-primary button')].map((node) => {
        const r = node.getBoundingClientRect();
        return { command: node.dataset.command, ...rect(node), receivesPointer: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === node };
      });
      return { controls, map: rect(document.querySelector('#map')), newest: rect(document.querySelector('#command-log li')), readiness: rect(document.querySelector('#command-readiness')), time: document.querySelector('#time-controls').hidden ? null : rect(document.querySelector('#time-controls')), pageHeight: document.documentElement.scrollHeight, viewport: innerHeight };
    });
    for (const control of [...measured.controls, measured.map, measured.newest, measured.readiness, ...(measured.time ? [measured.time] : [])]) {
      assert.ok(control.left >= 0 && control.right <= width + 1 && control.top >= 0 && control.bottom <= height + 1, `${mode} ${width}x${height}: ${JSON.stringify(control)} outside viewport`);
    }
    assert.ok(measured.map.height > 200, 'map remains useful');
    assert.ok(measured.controls.every((control) => control.receivesPointer), 'every primary control wins pointer hit testing');
    assert.ok(measured.pageHeight <= height + 1, `${mode}: desktop page scrolls (${measured.pageHeight})`);
    results.push({ mode, width, height, ...measured });
  };
  for (const [width, height] of [[1366, 768], [1600, 1000]]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['classic', 'reimagined', 'realtime']) {
      await fixture(mode);
      await geometry(mode, width, height);
      if (output) await page.screenshot({ path: resolve(output, `console-${mode}-${width}x${height}.png`) });
      await page.click('#theme-toggle');
      await geometry(`${mode}-classic-view`, width, height);
      if (output && mode === 'realtime') await page.screenshot({ path: resolve(output, `console-classic-view-${width}x${height}.png`) });
    }
  }

  await fixture('realtime');
  const stanceSummary = page.locator('details[data-console-key="stance"] summary');
  await stanceSummary.focus();
  const summaryBefore = await page.locator('#pause-button').innerText();
  const turnBeforeTab = await page.locator('#turn-readout').innerText();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#turn-readout').innerText(), turnBeforeTab, 'Tab from summary traverses without passing');
  await stanceSummary.focus();
  await page.keyboard.press('Space');
  assert.ok(await page.locator('details[data-console-key="stance"]').evaluate((node) => node.open), 'Space opens a native summary');
  assert.equal(await page.locator('#pause-button').innerText(), summaryBefore, 'Space on a summary preserves time pause');
  await page.keyboard.press('Space');
  // Hit-test the natural minimap interception regression with explicit overlap.
  await page.click('.ship[data-ship-id="axis-flagship"]');
  const ownsOverlap = await page.evaluate(() => {
    const menu = document.querySelector('#ship-menu');
    const mini = document.querySelector('#minimap').getBoundingClientRect();
    const map = document.querySelector('#map').getBoundingClientRect();
    menu.style.left = `${mini.left - map.left}px`; menu.style.top = `${mini.top - map.top}px`;
    return document.elementFromPoint(mini.left + 10, mini.top + 10)?.closest('#ship-menu') === menu;
  });
  assert.ok(ownsOverlap, 'ship menu wins hit testing over minimap');
  await page.keyboard.press('Escape');

  await page.locator('details[data-console-key="power"] summary').click();
  await page.locator('details[data-console-key="systems"] summary').click();
  const focused = page.locator('[data-power-sink="weapons"][data-power-delta="-1"]');
  await focused.focus();
  await page.evaluate(() => {
    window.consoleControl = document.activeElement;
    const region = document.querySelector('.console-secondary');
    region.scrollTop = 100;
    window.consoleScroll = region.scrollTop;
  });
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('details')?.dataset.consoleKey), 'power', 'keyboard traversal reaches secondary controls');
  await focused.focus();
  await page.click('#pause-button');
  await focused.focus();
  await page.evaluate(() => {
    const region = document.querySelector('.console-secondary');
    region.scrollTop = 100;
    window.consoleScroll = region.scrollTop;
  });
  const beforeTurn = await page.evaluate(() => Number(document.querySelector('#turn-readout').textContent.match(/[\d.]+/)[0]));
  await page.waitForFunction((turn) => Number(document.querySelector('#turn-readout').textContent.match(/[\d.]+/)[0]) >= Math.floor(turn) + 1, beforeTurn, { timeout: 10000 });
  const live = await page.evaluate(() => ({ sameNode: window.consoleControl === document.activeElement, expanded: document.querySelector('details[data-console-key="power"]').open, scroll: document.querySelector('.console-secondary').scrollTop, expectedScroll: window.consoleScroll }));
  assert.ok(live.sameNode, 'live redraw retains the same focused DOM control');
  assert.ok(live.expanded, 'focused section stays expanded');
  assert.equal(live.scroll, live.expectedScroll, 'secondary reader scroll stays put');

  // The existing command dialog owns pending values while the real simulation
  // crosses a boundary. No action is issued until its existing confirm path.
  await page.click('[data-command="move"]');
  await page.fill('#first-coordinate', '17');
  await page.fill('#second-coordinate', '-8');
  await page.locator('#first-coordinate').focus();
  const pendingTurn = await page.evaluate(() => Number(document.querySelector('#turn-readout').textContent.match(/[\d.]+/)[0]));
  await page.waitForFunction((turn) => Number(document.querySelector('#turn-readout').textContent.match(/[\d.]+/)[0]) >= Math.floor(turn) + 1, pendingTurn, { timeout: 10000 });
  assert.equal(await page.inputValue('#first-coordinate'), '17');
  assert.equal(await page.inputValue('#second-coordinate'), '-8');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'first-coordinate', 'pending edit retains focus');
  await page.keyboard.press('Escape');
  await page.click('#pause-button');
  await page.reload();
  assert.ok(await page.locator('details[data-console-key="power"]').evaluate((node) => node.open), 'expansion preference survives reload');
  await page.click('#pause-button');

  // Changing conn through the supported menu immediately changes identity.
  await page.click('.ship[data-ship-id="fed-cruiser-1"]');
  await page.click('#ship-menu [data-ship-command="transport"]');
  await page.fill('#crew-amount', '1');
  await page.check('#transfer-command');
  await page.click('#target-form button[value="confirm"]');
  await page.waitForFunction(() => document.querySelector('.command-identity').textContent.includes('Bonhomme'));
  assert.ok((await page.locator('.command-identity').innerText()).includes('Bonhomme'), 'issuing ship updates');

  for (const [width, height, label] of [[390, 844, 'narrow'], [800, 500, 'zoom-200']]) {
    await page.setViewportSize({ width, height });
    const stacked = await page.evaluate(() => {
      const console = document.querySelector('#console').getBoundingClientRect();
      const map = document.querySelector('.map-panel').getBoundingClientRect();
      return { consoleAfterMap: console.top >= map.bottom, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, secondaryOverflow: getComputedStyle(document.querySelector('.console-secondary')).overflowY, logPosition: getComputedStyle(document.querySelector('#log')).position, historyBounded: document.querySelector('#command-log').scrollHeight > document.querySelector('#command-log').clientHeight };
    });
    assert.ok(stacked.consoleAfterMap, 'enlarged or narrow view stacks naturally');
    assert.ok(!stacked.horizontalOverflow, `${label}: horizontal overflow`);
    assert.equal(stacked.secondaryOverflow, 'visible');
    assert.equal(stacked.logPosition, 'static');
    assert.ok(!stacked.historyBounded, 'enlarged history uses natural page scrolling');
    if (output) {
      // CSS viewport halves at 200% desktop browser zoom. Device scale 2 makes
      // the exported image the equivalent 1600x1000 physical pixel layout.
      if (label === 'zoom-200') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
      }
      await page.screenshot({ path: resolve(output, `console-${label}.png`), fullPage: true });
    }
    results.push({ label, width, height, ...stacked });
  }
  assert.deepEqual(errors, []);
  const layouts = results.map((layout) => layout.mode ? {
    mode: layout.mode, width: layout.width, height: layout.height,
    mapHeight: layout.map.height, lastPrimaryBottom: Math.max(...layout.controls.map((control) => control.bottom)),
    newestCommandBottom: layout.newest.bottom, pageHeight: layout.pageHeight,
  } : layout);
  console.log(JSON.stringify({ layouts, ownsOverlap, live, pageErrors: errors }, null, 2));
} finally { await browser.close(); }
