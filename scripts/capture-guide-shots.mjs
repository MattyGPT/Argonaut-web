/** npm start; PLAYWRIGHT_MODULE may point to an existing playwright-core installation. */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { GUIDE_SCENES, stageGuideScene } from './guide-scenes.mjs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')); }
catch { throw new Error('Use an installed playwright-core package via PLAYWRIGHT_MODULE; no browser dependency is installed by this script.'); }
const output = resolve(process.env.GUIDE_OUTPUT || 'assets/guide');
const selected = process.env.GUIDE_SCENES?.split(',');
const scenes = GUIDE_SCENES.filter((scene) => !selected || selected.includes(scene.file));
assert.ok(scenes.length, 'No guide scenes selected');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const assets = [];
async function ready(page) {
  await page.waitForFunction(() => typeof window.__guideCaptureSnapshot === 'function' && !window.__guideCaptureSnapshot().playback);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].filter((image) => image.getClientRects().length).map((image) => image.decode().catch(() => {}))); await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); });
}
async function open(page, selector) {
  const target = page.locator(selector);
  if (!await target.evaluate((element) => element.open)) await target.locator(':scope > summary').click();
}
try {
  for (const scene of scenes) {
    const context = await browser.newContext({ viewport: scene.viewport, deviceScaleFactor: scene.scale, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // Read-only observation plus the real Pause button before the first animation frame.
      await page.route('**/app.js', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: await response.text() + '\nif (game?.realtime && !view.paused) document.querySelector("#pause-button").click();\nwindow.__guideCaptureSnapshot = () => ({seed:game?.seed,phase:game?.phase,simTime:game?.simTime,paused:view.paused,playback:playbackLocked(),theme,art:shipArtPref,practice:game?.practice,campaign:Boolean(campaign),campaignSeed:campaign?.seed,currentNode:campaign?.currentNode,options:game?Object.fromEntries(["reimagined","precision","realtime","regional","sound","scenario"].map(key=>[key,game[key]])):null});\n' });
      });
      await page.goto(process.env.GAME_URL || 'http://localhost:8080');
      await ready(page);
      const facts = await page.evaluate(stageGuideScene, scene);
      await page.reload();
      await ready(page);
      switch (scene.interaction) {
        case 'console': await open(page, 'details[data-console-key="systems"]'); break;
        case 'power': await open(page, 'details[data-console-key="power"]'); break;
        case 'chooser': await page.locator('#new-game').click(); await page.locator('#ruleset').selectOption('reimagined'); await page.locator('#new-seed').fill(scene.seed); break;
        case 'enemy-menu': await page.locator('.ship[data-ship-id="axis-flagship"]').click(); break;
        case 'friendly-menu':
          await page.locator('.ship[data-ship-id="fed-cruiser-1"]').click();
          await page.locator('#ship-menu .menu-sub').filter({ hasText: 'Standing orders' }).evaluate((element) => { element.parentElement.scrollTop = element.offsetTop - 12; });
          break;
        case 'precision':
          await page.locator('[data-command="phasers"]').click();
          await page.locator('#target-select').selectOption('axis-flagship');
          await page.locator('#focus-select').selectOption('engines');
          await page.locator('#phaser-power').evaluate((input) => { input.value = '50'; input.dispatchEvent(new Event('input', { bubbles: true })); });
          break;
        case 'journal':
          for (const detail of await page.locator('#command-history details').all()) if (!await detail.evaluate((element) => element.open)) await detail.locator(':scope > summary').click();
          break;
        case 'debrief': await open(page, '.engagement-debrief'); break;
        case 'veteran': await open(page, `#service-${facts.veteranId}`); break;
        case 'dockyard': await open(page, '#sector-dockyard'); break;
        case 'practice':
          for (const detail of await page.locator('#practice-panel details').all()) if (!await detail.evaluate((element) => element.open)) await detail.locator(':scope > summary').click();
          break;
        case 'report': await open(page, 'details[data-console-key="systems"]'); await page.locator('[data-command="rollcall"]').click(); break;
      }
      await ready(page);
      const selector = scene.selector === 'veteran' ? `#service-${facts.veteranId}` : scene.selector;
      const target = selector ? page.locator(selector) : page.locator('body');
      if (scene.expected) assert.match(await target.innerText(), new RegExp(scene.expected, 'i'), scene.file);
      const path = resolve(output, scene.file);
      if (scene.crop) {
        const boxes = await Promise.all(scene.crop.map((selector) => page.locator(selector).boundingBox()));
        const x = Math.min(...boxes.map((box) => box.x)); const y = Math.min(...boxes.map((box) => box.y));
        await page.screenshot({ path, animations: 'disabled', clip: { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y } });
      } else if (selector) await target.screenshot({ path, animations: 'disabled' });
      else await page.screenshot({ path, animations: 'disabled' });
      assert.deepEqual(errors, [], scene.file);
      const observed = await page.evaluate(() => window.__guideCaptureSnapshot());
      if (scene.options.realtime) assert.equal(observed.paused, true, scene.file);
      const png = await readFile(path);
      assets.push({ ...scene, width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), facts, observed });
      console.log(`${scene.file}: ${assets.at(-1).width}x${assets.at(-1).height}, ${png.length} bytes`);
    } finally { await context.close(); }
  }
  let previous = [];
  if (selected) try { previous = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8')).assets.filter((asset) => !assets.some((current) => current.file === asset.file)); } catch {}
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ version: 1, sceneVersion: 2, browser: 'Microsoft Edge via optional Playwright', url: process.env.GAME_URL || 'http://localhost:8080', scale: 1, reducedMotion: 'reduce', assets: [...previous, ...assets] }, null, 2) + '\n');
} finally { await browser.close(); }
