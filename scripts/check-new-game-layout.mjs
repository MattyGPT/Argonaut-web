/** Optional Edge geometry/interaction check. Uses an isolated browser context.
 * NEW_GAME_OUTPUT saves screenshots; PLAYWRIGHT_MODULE selects playwright-core.
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const output = process.env.NEW_GAME_OUTPUT;
if (output) await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  for (const [width, height] of [[1366, 768], [1600, 1000], [390, 844], [800, 500]]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['classic', 'reimagined']) {
      await page.click('#new-game');
      await page.selectOption('#ruleset', mode);
      const seed = `setup-${width}-${mode}`;
      await page.fill('#new-seed', seed);
      const measure = () => page.evaluate(() => {
        const dialog = document.querySelector('#new-game-dialog');
        const button = dialog.querySelector('button[value="confirm"]');
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        const visible = [...dialog.querySelectorAll('*')].filter(node => node.getClientRects().length);
        return {
          dialogWidth: dialog.getBoundingClientRect().width,
          visible: box.top >= 0 && box.bottom <= innerHeight && button.contains(hit),
          horizontal: visible.filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 2).map(node => node.id || node.className),
          scrollers: [dialog, ...visible].filter(node => node.scrollHeight > node.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(node).overflowY)).map(node => node.id || node.className),
        };
      });
      const before = await measure();
      assert.ok(before.visible, `${width}/${mode}: Begin is visible and clickable before scrolling`);
      assert.deepEqual(before.horizontal, [], `${width}/${mode}: no horizontal clipping`);
      assert.ok(before.scrollers.length <= 1 && before.scrollers.every(name => name === 'new-game-content'), `${width}/${mode}: one scrolling area, ${before.scrollers}`);
      if (mode === 'reimagined' && width >= 1100) assert.ok(before.dialogWidth > 1000, 'wide desktop setup');
      if (output) await page.screenshot({ path: resolve(output, `${mode}-${width}x${height}-top.png`) });
      await page.locator('.new-game-content').evaluate(node => { node.scrollTop = node.scrollHeight; });
      assert.ok((await measure()).visible, 'Begin stays visible after scrolling');
      if (output) await page.screenshot({ path: resolve(output, `${mode}-${width}x${height}.png`) });
      // Begin must work without moving either scrolling surface to its end.
      await page.locator('.new-game-content').evaluate(node => { node.scrollTop = 0; });
      await page.click('#new-game-form button[value="confirm"]');
      assert.equal(await page.locator('#new-game-dialog').evaluate(node => node.open), false);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('argonaut-web-save-v1')));
      assert.equal(saved.game.seed, seed);
      assert.equal(Boolean(saved.game.reimagined), mode === 'reimagined');
      console.log(JSON.stringify({ width, height, mode, ...before }));
    }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
