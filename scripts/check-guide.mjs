/**
 * Optional real-browser guide check. Run npm start first, then:
 *   node scripts/check-guide.mjs
 * Uses installed Edge and optional playwright-core (PLAYWRIGHT_MODULE may name
 * an existing installation). GAME_URL defaults to http://localhost:8080.
 * No packages are installed. The context is isolated from the player's saves.
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { REALTIME } from '../game/constants.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.GUIDE_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Test-only, read-only instrumentation sees the actual module-owned clock.
  // Saves update at event boundaries; they cannot prove the live loop stopped.
  await page.route('**/app.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      window.__guideSnapshot = () => ({
        simTime: game?.simTime ?? null, turn: game?.turn ?? null,
        paused: Boolean(view.paused), accumulator: simAccumulator,
        help: help.active, playback: playbackLocked(), sector: sectorMode(),
        game: JSON.stringify(game),
      });
    ` });
  });
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  const fixture = async (kind) => {
    await page.evaluate(async (kind) => {
      localStorage.clear();
      const { createGame } = await import('/game/state.js');
      if (kind === 'sector') {
        const { createCampaign } = await import('/game/campaign.js');
        localStorage.setItem('argonaut-web-save-campaign-v1', JSON.stringify({ version: 1, campaign: createCampaign({ seed: 'guide-sector' }) }));
      } else {
        const game = createGame({ seed: `guide-${kind}`, reimagined: true, realtime: kind !== 'turn-based' && kind !== 'replay' });
        if (kind === 'completed') game.outcome = { kind: 'victory', winner: 'Federation', message: 'Fixture battle completed.' };
        if (kind === 'replay') game.lastRound = { events: [{ kind: 'destruction', shipId: game.playerShipId, shipName: 'Guide fixture', faction: 'Federation', cause: 'fixture' }], entries: [] };
        localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game }));
      }
    }, kind);
    await page.reload();
    await page.waitForFunction(() => typeof window.__guideSnapshot === 'function');
  };
  const snapshot = () => page.evaluate(() => window.__guideSnapshot());
  const open = () => page.evaluate(() => {
    document.querySelector('#user-guide').click();
    return window.__guideSnapshot();
  });
  const close = async () => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#guide-dialog').open && !window.__guideSnapshot().help);
  };

  await fixture('realtime');
  await page.waitForFunction(() => window.__guideSnapshot().simTime > 0);
  const before = await open();
  assert.equal(before.help, true);
  assert.equal(await page.locator('#help-pause-status').textContent(), 'Paused for help');
  // Exercise gameplay keys from guide prose; Space on the Close button is
  // legitimate native activation and would intentionally dismiss the guide.
  await page.locator('#guide-commands').evaluate((section) => { section.tabIndex = -1; section.focus(); });
  await page.keyboard.press('3');
  await page.keyboard.press('p');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  const helpIntervalMs = REALTIME.msPerStardate * 2;
  await page.waitForTimeout(helpIntervalMs);
  const during = await snapshot();
  assert.equal(during.help, true, 'help remains open for the entire interval');
  assert.equal(during.simTime, before.simTime, 'actual sim time stays fixed through long help interval');
  assert.equal(during.game, before.game, 'help and command shortcuts do not mutate game state');
  assert.equal(during.accumulator, 0);
  await close();
  const after = await snapshot();
  assert.equal(after.simTime, before.simTime);
  assert.equal(after.paused, true);
  assert.equal(await page.locator('#pause-button').textContent(), 'Resume');
  assert.equal(await page.locator('#pause-button').isEnabled(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'user-guide');
  assert.equal(await page.locator('#confirm-dialog').evaluate((dialog) => dialog.open), false, 'Escape never resigns');
  const firstResumed = await page.evaluate(async () => {
    document.querySelector('#pause-button').click();
    return await new Promise((resolve) => requestAnimationFrame(() => resolve(window.__guideSnapshot())));
  });
  assert.equal(firstResumed.simTime, before.simTime, 'first resumed frame cannot consume help elapsed time');
  assert.equal(firstResumed.accumulator, 0);
  await page.waitForFunction((time) => window.__guideSnapshot().simTime > time, before.simTime);
  const resumed = await snapshot();
  assert.ok(resumed.simTime - before.simTime <= 0.25, 'resume begins with ordinary fixed ticks');
  await page.click('#pause-button');
  await open();
  await close();
  assert.equal((await snapshot()).paused, true, 'already paused remains paused');

  // A contextual link inside another modal preserves that modal and its focus.
  await page.click('#new-game');
  const contextControl = page.locator('#new-game-dialog [data-guide-section], #new-game-dialog a[href^="#guide-"]').first();
  const contextAnchor = (await contextControl.getAttribute('data-guide-section') || (await contextControl.getAttribute('href')).slice(1));
  await contextControl.click();
  assert.equal(await page.evaluate(() => document.activeElement.id), contextAnchor.replace(/^#/, ''));
  await close();
  assert.equal(await contextControl.evaluate((control) => document.activeElement === control), true);
  assert.equal(await page.locator('#new-game-dialog').evaluate((dialog) => dialog.open), true);
  await page.click('#new-game-form button[value="cancel"]');

  for (const kind of ['turn-based', 'completed', 'sector']) {
    await fixture(kind);
    const start = await open();
    await page.keyboard.press('p');
    await page.keyboard.press('3');
    await close();
    const finish = await snapshot();
    assert.equal(finish.game, start.game, `${kind} help keeps battle state fixed`);
    assert.equal(finish.paused, false, `${kind} does not acquire a real-time user pause`);
    assert.equal(finish.sector, kind === 'sector');
  }

  await fixture('replay');
  await page.evaluate(() => document.querySelector('[data-command="replay"]').click());
  await page.waitForFunction(() => window.__guideSnapshot().playback);
  await open();
  assert.equal(await page.locator('#guide-dialog').evaluate((dialog) => dialog.open), false, 'playback retains its guide-opening block');
  assert.equal((await snapshot()).playback, true);
  await page.waitForFunction(() => !window.__guideSnapshot().playback);
  await open();
  await close();
  // Reference navigation must remain usable with enlarged/narrow layouts and
  // unavailable illustrations. Reading help never changes the game ruleset.
  await page.route('**/assets/guide/**', (route) => route.abort());
  await page.locator('#guide-dialog img').evaluateAll((images) => images.forEach((image) => { image.removeAttribute('src'); }));
  const layouts = [];
  for (const [width, height, label] of [[1366, 768, 'desktop'], [390, 844, 'narrow'], [800, 500, 'zoom-200-equivalent']]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open();
    await page.locator('.guide-nav a[href="#guide-first-orders"]').click();
    const measured = await page.locator('#guide-dialog').evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: dialog.clientWidth, contentWidth: dialog.scrollWidth,
        bodyWidth: dialog.querySelector('.guide-body').clientWidth,
        bodyContentWidth: dialog.querySelector('.guide-body').scrollWidth };
    });
    assert.ok(measured.left >= 0 && measured.right <= width + 1 && measured.top >= 0 && measured.bottom <= height + 1, label + ': guide stays within viewport');
    assert.ok(measured.contentWidth <= measured.width + 1, label + ': guide has no horizontal clipping');
    assert.ok(measured.bodyContentWidth <= measured.bodyWidth + 1, label + ': guide prose has no horizontal clipping');
    if (output) await page.screenshot({ path: resolve(output, 'guide-' + label + '.png') });
    await page.locator('.guide-nav a[href="#guide-realtime"]').click();
    assert.ok(await page.locator('#guide-realtime').isVisible());
    await close();
    layouts.push({ label, width, height });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ layouts, helpIntervalMs, beforeSimTime: before.simTime, duringSimTime: during.simTime, afterSimTime: after.simTime, firstResumedSimTime: firstResumed.simTime, nextSimTime: resumed.simTime, checks: 'running, already paused, close/reopen, shortcuts, Escape, focus, contextual nested dialog, turn based, completed, sector, playback lock' }, null, 2));
} finally {
  await browser.close();
}
