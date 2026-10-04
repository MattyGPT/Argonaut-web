/**
 * Optional browser regression check. Start npm start first, then:
 *   node scripts/check-combat-feedback.mjs
 * Requires playwright-core + installed Edge. PLAYWRIGHT_MODULE may name an
 * existing installation; no browser or runtime dependencies are downloaded.
 * --baseline measures HEAD's FX code against the same fixture for comparison.
 * Screenshots go to FEEDBACK_OUTPUT when set (otherwise no files are written).
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const baseline = process.argv.includes('--baseline');
const output = process.env.FEEDBACK_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = {};
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (baseline) {
    const body = execFileSync('git', ['show', 'HEAD:ui/fx.js'], { encoding: 'utf8' });
    await page.route('**/ui/fx.js', (route) => route.fulfill({ body, contentType: 'text/javascript' }));
  }
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');

  // Real browser layout: clustered sprites, rectangular viewport, zoom/pan,
  // a target gliding away from its historical event position, and replay.
  for (const replay of [false, true]) {
    results[replay ? 'replay' : 'live'] = await page.evaluate(async (replay) => {
      const { createGame } = await import('/game/state.js');
      const { renderGame, primeMoveMemory } = await import('/ui/render.js');
      const { makeCamera } = await import('/ui/camera.js');
      const { playEffects, replayEffects } = await import('/ui/fx.js');
      const scene = createGame({ seed: 'feedback-geometry', reimagined: true });
      const ids = ['fed-flagship', 'axis-flagship', 'bloc-flagship'];
      scene.ships = scene.ships.filter((ship) => ids.includes(ship.id)).map((ship, i) => ({
        ...ship, x: i ? 178 : 160, y: 160,
      }));
      primeMoveMemory(scene);
      renderGame(scene, { shipArt: 'sprites', camera: { ...makeCamera(320, scene.ships[0]), cx: 170, cy: 160, zoom: 3 } });
      const map = document.querySelector('#map');
      map.querySelector('svg.fx-layer')?.remove();
      const target = map.querySelector('[data-ship-id="axis-flagship"]');
      const event = { kind: 'phasers', fromId: 'fed-flagship', toId: 'axis-flagship', x1: 160, y1: 160, x2: 178, y2: 160, hit: true };
      const win = { minX: 170 - 320 / 6, minY: 160 - 320 / 6, size: 320 / 3 };
      if (replay) replayEffects([event], map, 420, win);
      else playEffects([event], map, 'fed-flagship', win);
      await new Promise((resolve) => setTimeout(resolve, 35));
      const samples = [];
      const sample = () => {
        const line = map.querySelector('.fx-phaser');
        const svg = line.ownerSVGElement;
        const point = new DOMPoint(Number(line.getAttribute('x2')), Number(line.getAttribute('y2'))).matrixTransform(svg.getScreenCTM());
        const r = target.getBoundingClientRect();
        samples.push(Math.hypot(point.x - (r.left + r.width / 2), point.y - (r.top + r.height / 2)));
      };
      sample();
      target.style.left = '58%'; // Same transition path used by turn-based glides.
      await new Promise((resolve) => {
        const start = performance.now();
        const frame = () => {
          sample();
          if (performance.now() - start < 230) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      return { samples: samples.length, maxEndpointErrorPx: Math.max(...samples), eventUnchanged: event.x2 === 178 };
    }, replay);
  }
  if (!baseline) {
    for (const mode of ['live', 'replay']) {
      assert.ok(results[mode].maxEndpointErrorPx < 2, `${mode}: endpoint misses the displayed hull`);
      assert.ok(results[mode].eventUnchanged);
    }

    // Use the actual command pipeline and autosave, with plenty of fleet traffic.
    await page.reload();
    await page.evaluate(async () => {
      const { createGame } = await import('/game/state.js');
      const game = createGame({ seed: 'feedback-commands' });
      game.ships.find((s) => s.id === 'fed-flagship').x = 40;
      game.ships.find((s) => s.id === 'fed-flagship').y = 50;
      game.ships.find((s) => s.id === 'axis-flagship').x = 50;
      game.ships.find((s) => s.id === 'axis-flagship').y = 50;
      localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game }));
    });
    await page.reload();
    await page.click('[data-command="phasers"]');
    await page.selectOption('#target-select', 'axis-flagship');
    await page.click('#target-form button[value="confirm"]');
    await page.waitForFunction(() => /Argo.*phasers/s.test(document.querySelector('#command-log').textContent));
    const first = await page.locator('#command-log').innerText();
    await page.click('[data-command="pass"]');
    await page.waitForFunction(() => document.querySelectorAll('#command-log li').length === 2);
    results.narrative = await page.evaluate(() => ({
      commands: document.querySelectorAll('#command-log li').length,
      fleetLines: document.querySelectorAll('#log > li').length,
      commandText: document.querySelector('#command-log').innerText,
      historyVisible: !document.querySelector('#command-history').hidden,
    }));
    assert.ok(results.narrative.commandText.includes(first.trim()));
    assert.ok(results.narrative.fleetLines > 20);
    await page.reload();
    assert.equal(await page.locator('#command-log li').count(), 2, 'commands survive reload');
    assert.ok(await page.locator('#log > li').count() > 20, 'reload keeps fleet history visible too');
    await page.evaluate(() => window.scrollTo(0, 0));
    if (output) await page.screenshot({ path: resolve(output, 'combat-feedback.png'), fullPage: true });

    await page.click('#theme-toggle');
    assert.equal(await page.locator('.ship .sprite').count(), 0);
    assert.equal(await page.locator('#command-log li').count(), 2);
    await page.click('#new-game');
    await page.fill('#new-seed', 'feedback-new-war');
    await page.click('#new-game-form button[value="confirm"]');
    assert.equal(await page.locator('#command-history').isVisible(), false, 'new war clears command history');

    await page.evaluate(async () => {
      const { createGame } = await import('/game/state.js');
      const game = createGame({ seed: 'feedback-realtime', realtime: true });
      game.ships = game.ships.filter((s) => ['fed-flagship', 'axis-flagship', 'fed-cruiser-1'].includes(s.id));
      game.ships.forEach((s, i) => { s.x = 160 + i * 12; s.y = 160; });
      game.terrain = [];
      localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game }));
      localStorage.setItem('argonaut-web-theme', 'modern');
    });
    await page.reload();
    await page.click('#pause-button');
    assert.equal(await page.locator('#pause-button').textContent(), 'Resume');
    await page.click('.ship[data-ship-id="axis-flagship"]');
    // Force the natural edge-case overlap, then ask the browser which element
    // actually receives the pointer. This caught the minimap stealing shots.
    results.menuOwnsOverlap = await page.evaluate(() => {
      const menu = document.querySelector('#ship-menu');
      const mini = document.querySelector('#minimap').getBoundingClientRect();
      const map = document.querySelector('#map').getBoundingClientRect();
      menu.style.left = `${mini.left - map.left}px`;
      menu.style.top = `${mini.top - map.top}px`;
      return document.elementFromPoint(mini.left + 10, mini.top + 10)?.closest('#ship-menu') === menu;
    });
    assert.ok(results.menuOwnsOverlap, 'ship menu must be above minimap');
    // Reposition through the actual camera redraw, then fire through the menu.
    await page.click('#camera-center');
    await page.click('#ship-menu [data-ship-command="phasers"]');
    await page.waitForFunction(() => /Argo.*phasers/s.test(document.querySelector('#command-log').textContent));
    const realtimeShot = await page.locator('#command-log').innerText();
    await page.click('#pause-button');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('argonaut-web-save-v1')).game.turn >= 2);
    await page.click('#pause-button');
    assert.equal(await page.locator('#command-log').innerText(), realtimeShot, 'real-time fleet phase preserves your shot');
    results.realtime = { commands: await page.locator('#command-log li').count(), paused: await page.locator('#pause-button').textContent() === 'Resume' };
    if (output) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: resolve(output, 'realtime-feedback.png'), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  results.pageErrors = errors;
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
