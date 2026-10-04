/** Optional browser targeting regression. Start npm start, set PLAYWRIGHT_MODULE
 * to an existing playwright-core installation, and run this file. No downloads.
 * TARGET_OUTPUT saves screenshots of desktop, narrow and enlarged layouts.
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.TARGET_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  // The actual app uses its save/load and dispatch paths, with time paused to
  // hold one authoritative state while comparing presentation and execution.
  await page.evaluate(async () => {
    const { createGame } = await import('/game/state.js');
    const game = createGame({ seed: 'target-app', reimagined: true, realtime: true });
    game.terrain = [];
    game.autoConn = false;
    game.ships = game.ships.filter((ship) => ['fed-flagship', 'axis-flagship', 'bloc-flagship'].includes(ship.id))
      .map((ship) => ({ ...ship, x: ship.id === game.playerShipId ? 100 : ship.id === 'axis-flagship' ? 106 : 130, y: 100, facing: 180 }));
    localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game }));
    localStorage.removeItem('argonaut-web-save-campaign-v1');
    localStorage.setItem('argonaut-web-theme', 'modern');
  });
  await page.reload();
  await page.click('#pause-button');
  await page.click('.ship[data-ship-id="axis-flagship"]');
  const targetButton = page.locator('#ship-menu [data-ship-command="phasers"]');
  assert.equal(await targetButton.isEnabled(), true);
  const described = await targetButton.getAttribute('aria-describedby');
  assert.match(await page.locator(`#${described}`).innerText(), /Range 30 · Ready/);
  await targetButton.click();
  await page.waitForFunction(() => document.querySelector('[data-command="photons"]').disabled);
  assert.match(await page.locator('#command-photons-reason').innerText(), /still cycling/);
  await page.click('.ship[data-ship-id="axis-flagship"]');
  assert.equal(await page.locator('#ship-menu [data-ship-command="photons"]').isDisabled(), true);
  assert.match(await page.locator('#menu-photons-reason').innerText(), /still cycling/);
  assert.match(await page.locator('#menu-scan-reason').innerText(), /Ready \(free command\)/);
  assert.equal(await page.locator('#ship-menu [data-ship-command="scan"]').isEnabled(), true);
  const keyboardButton = page.locator('#ship-menu [data-ship-command="scan"]');
  await keyboardButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#ship-menu').hasAttribute('open'));

  // Controlled live target changes drive the same prompt/revalidation callbacks
  // as the app. A second contact makes silent substitution detectable.
  await page.evaluate(async () => {
    const { createGame } = await import('/game/state.js');
    const { applyPlayerAction, actionAvailability } = await import('/game/actions.js');
    const { targetExplanation, renderGame, updateTargetReadiness } = await import('/ui/render.js');
    const { promptForTarget, refreshTargetPrompt } = await import('/ui/input.js');
    const game = createGame({ seed: 'target-confirmation', reimagined: true, realtime: true });
    game.terrain = [];
    game.simTime = 0;
    game.ships = game.ships.map((ship) => ({ ...ship, x: ship.id === 'axis-flagship' ? 106 : 100, y: 100, facing: 180 }));
    const fixture = window.targetFixture = { game, selected: 'axis-flagship', result: undefined, action: { type: 'photons' } };
    fixture.inspect = (details) => targetExplanation(fixture.game, { ...fixture.action, ...details });
    fixture.refresh = () => refreshTargetPrompt();
    fixture.refreshMenu = () => updateTargetReadiness(fixture.game, { contextShipId: fixture.selected });
    fixture.render = (view = {}) => { renderGame(fixture.game, { contextShipId: fixture.selected, ...view }); fixture.refreshMenu(); };
    fixture.open = () => {
      fixture.result = undefined;
      fixture.before = JSON.stringify(fixture.game);
      fixture.pending = promptForTarget('Photons target', fixture.game.ships.filter((ship) => ['axis-flagship', 'bloc-flagship'].includes(ship.id)), { defaultId: fixture.selected, availability: fixture.inspect })
        .then((details) => { fixture.result = details; if (details) fixture.executed = applyPlayerAction(fixture.game, { ...fixture.action, ...details }); });
    };
    fixture.query = () => actionAvailability(fixture.game, { ...fixture.action, targetId: fixture.selected });
    fixture.open();
  });
  assert.equal(await page.locator('#target-form button[value="confirm"]').isEnabled(), true);
  assert.match(await page.locator('#target-explanation').innerText(), /Current arc preview: Fore/);
  const purity = await page.evaluate(() => { const f = window.targetFixture; f.query(); f.refresh(); return f.before === JSON.stringify(f.game); });
  assert.ok(purity, 'inspection consumes no state or RNG');
  await page.evaluate(() => {
    const f = window.targetFixture;
    f.game.ships = f.game.ships.map((ship) => ship.id === f.selected ? { ...ship, x: 121 } : ship);
    f.refresh();
  });
  assert.match(await page.locator('#target-explanation').innerText(), /out of range for photons/);
  assert.equal(await page.inputValue('#target-select'), 'axis-flagship');
  assert.equal(await page.locator('#target-form button[value="confirm"]').isDisabled(), true);
  await page.evaluate(() => document.querySelector('#target-form').requestSubmit(document.querySelector('#target-form button[value="confirm"]')));
  assert.equal(await page.locator('#target-dialog').evaluate((node) => node.open), true, 'stale confirmation does not close');
  assert.equal(await page.evaluate(() => window.targetFixture.result), undefined);
  await page.evaluate(() => {
    const f = window.targetFixture;
    f.game.ships = f.game.ships.map((ship) => ship.id === f.selected ? { ...ship, status: 'destroyed' } : ship);
    f.refresh();
  });
  assert.match(await page.locator('#target-explanation').innerText(), /no longer available/);
  assert.equal(await page.inputValue('#target-select'), 'axis-flagship');
  await page.click('#target-form button[value="cancel"]');
  assert.equal(await page.evaluate(() => window.targetFixture.result), null);

  await page.evaluate(() => {
    const f = window.targetFixture;
    f.game.ships = f.game.ships.map((ship) => ship.id === f.selected ? { ...ship, status: 'active', x: 106 } : ship);
    f.game.readyAt = { [f.game.playerShipId]: 1 };
    f.open();
  });
  assert.match(await page.locator('#target-explanation').innerText(), /Shared command cycle: 1\.0/);
  assert.equal(await page.locator('#target-form button[value="confirm"]').isDisabled(), true);
  if (output) await page.screenshot({ path: resolve(output, 'target-prompt-cooldown.png') });
  await page.evaluate(() => { window.targetFixture.game.simTime = 1; window.targetFixture.refresh(); });
  assert.equal(await page.locator('#target-form button[value="confirm"]').isEnabled(), true);
  await page.click('#target-form button[value="confirm"]');
  assert.equal(await page.evaluate(() => window.targetFixture.result.targetId), 'axis-flagship');
  assert.equal(await page.evaluate(() => window.targetFixture.executed.error), undefined);
  assert.ok(await page.evaluate(() => window.targetFixture.executed.game.ordnance.some((shot) => shot.targetId === window.targetFixture.selected)));

  await page.evaluate(() => {
    const f = window.targetFixture;
    f.game.simTime = 1;
    f.game.readyAt = { [f.game.playerShipId]: 1.4 };
    f.render();
    f.liveButton = document.querySelector('#ship-menu [data-ship-command="photons"]');
  });
  assert.match(await page.locator('#menu-command-cycle').innerText(), /0\.4 stardates remaining/);
  assert.equal(await page.locator('#ship-menu [data-ship-command="photons"]').isDisabled(), true);
  await page.evaluate(() => {
    const f = window.targetFixture;
    f.game.simTime = 1.45;
    f.game.ships = f.game.ships.map((ship) => ship.id === f.selected ? { ...ship, x: 110 } : ship);
    f.refreshMenu(); // Fractional expiry, no renderGame or boundary redraw.
  });
  assert.match(await page.locator('#menu-command-cycle').innerText(), /Shared command cycle ready/);
  assert.match(await page.locator('#menu-target-distance').innerText(), /10\.0 away/);
  assert.equal(await page.locator('#ship-menu [data-ship-command="photons"]').isEnabled(), true);
  assert.ok(await page.evaluate(() => window.targetFixture.liveButton === document.querySelector('#ship-menu [data-ship-command="photons"]')), 'fractional refresh retains the original menu control');

  const layouts = [];
  for (const [width, height, label] of [[1366, 768, 'desktop'], [1600, 1000, 'large'], [390, 844, 'narrow'], [800, 500, 'zoom-200']]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.targetFixture.render());
    const geometry = await page.locator('#ship-menu').evaluate((menu) => {
      const r = menu.getBoundingClientRect(); const map = document.querySelector('#map').getBoundingClientRect();
      const button = menu.querySelector('button:not(:disabled)'); const b = button.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, mapTop: map.top, mapBottom: map.bottom, mapLeft: map.left, mapRight: map.right, viewportWidth: innerWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, clickable: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('button') === button };
    });
    assert.ok(geometry.top >= geometry.mapTop && geometry.bottom <= geometry.mapBottom + 1, `${label} menu stays in map`);
    assert.ok(geometry.left >= geometry.mapLeft && geometry.right <= geometry.mapRight + 1, `${label} menu stays in map width`);
    assert.ok(geometry.right <= geometry.viewportWidth + 1, `${label} menu stays within viewport width: ${JSON.stringify(geometry)}`);
    assert.ok(!geometry.horizontalOverflow, `${label} has no horizontal overflow`);
    assert.ok(geometry.clickable, `${label} enabled command receives pointer`);
    const lastCommand = page.locator('#ship-menu [data-ship-command="tractor-direct"]');
    await lastCommand.scrollIntoViewIfNeeded();
    assert.ok(await lastCommand.evaluate((button) => {
      const r = button.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === button;
    }), `${label} scrolling reaches the last menu command`);
    await page.locator('#ship-menu').evaluate((menu) => { menu.scrollTop = 0; });
    layouts.push({ width, height, label, ...geometry });
    if (output) await page.screenshot({ path: resolve(output, `target-${label}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ purity, staleTargetPreserved: true, sharedCycleRechecked: true, actualAppDispatch: true, layouts, pageErrors: errors }, null, 2));
} finally { await browser.close(); }
