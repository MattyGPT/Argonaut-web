/** Optional browser regression: npm start, then set PLAYWRIGHT_MODULE to an
 * existing playwright-core install. No downloads. Evidence defaults to TEMP. */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.FACTION_OUTPUT || resolve(tmpdir(), 'argonaut-faction-navigation');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  await page.evaluate(async () => {
    const { createGame, spawnDrone, spawnEncounter } = await import('/game/state.js');
    const { createRng } = await import('/game/rng.js');
    const game = createGame({ seed: 'faction-browser', reimagined: true });
    game.terrain = [];
    const classes = ['Battle cruiser', 'Cruiser', 'Scout', 'Interceptor', 'Artillery', 'Carrier'];
    const hulls = classes.map((name) => game.ships.find((ship) => ship.faction === 'Federation' && ship.className === name));
    hulls.push(...['Axis', 'Bloc', 'Cabal'].map((name) => game.ships.find((ship) => ship.faction === name && ship.className === 'Battle cruiser')));
    hulls.push(game.ships.find((ship) => ship.className === 'Starbase'));
    hulls.forEach((ship) => { ship.x = 160; ship.y = 160; ship.facing = 0; });
    const carrier = hulls.find((ship) => ship.className === 'Carrier');
    hulls.push(spawnDrone(carrier, 1, 160, 160));
    hulls.push(spawnEncounter(game, 'neutral', 160, 160, createRng('merchant')));
    const prize = { ...hulls[6], id: 'fixture-prize', name: 'Prize Orion', faction: 'Federation', prize: { from: 'Axis', byFaction: 'Federation', turn: 2 }, x: 180, y: 160 };
    const merchantPrize = { ...hulls.at(-1), id: 'fixture-merchant-prize', name: 'Prize merchant', faction: 'Federation', neutral: false, prize: { from: 'Neutral', byFaction: 'Federation', turn: 2 }, x: 182, y: 160 };
    const vacant = { ...hulls[7], id: 'fixture-vacant', name: 'Vacant hull', status: 'vacant', x: 160, y: 160 };
    const surrendered = { ...hulls[8], id: 'fixture-surrendered', name: 'Surrendered hull', status: 'surrendered', x: 160, y: 160 };
    const wreck = { ...hulls[7], id: 'fixture-wreck', name: 'Known wreck', status: 'destroyed', x: 160, y: 160 };
    const hidden = { ...hulls[6], id: 'fixture-hidden', name: 'Hidden contact', x: 310, y: 310 };
    game.ships = [...hulls, prize, merchantPrize, vacant, surrendered, wreck, hidden];
    game.scanned = { [hidden.id]: true };
    localStorage.removeItem('argonaut-web-save-campaign-v1');
    localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game }));
    localStorage.setItem('argonaut-web-theme', 'modern');
    localStorage.setItem('argonaut-web-ship-art', 'sprites');
  });
  await page.reload();
  await page.evaluate(async () => {
    const { renderGame } = await import('/ui/render.js');
    const { createJournal } = await import('/ui/battle-journal.js');
    const game = JSON.parse(localStorage.getItem('argonaut-web-save-v1')).game;
    const journal = createJournal('faction-frozen');
    journal.events = [{ battleId: journal.battleId, eventId: 'faction-frozen:e1', sequence: 1, simTime: 1, kind: 'weapon-resolution', group: 'fleet-traffic', weapon: 'phasers', actor: { id: 'fixture-prize', name: 'Prize Orion', faction: 'Axis' }, target: { name: 'Argo', faction: 'Federation' }, result: 'miss', detail: 'confirmed' }];
    journal.nextSequence = 2;
    window.factionFixture = { game, journal, render: (zoom, art) => renderGame(game, { camera: { cx: 160, cy: 160, zoom, follow: false }, shipArt: art, journal }) };
  });
  const evidence = [];
  for (const [width, height, label] of [[1366, 768, 'desktop'], [1600, 1000, 'large'], [390, 844, 'narrow'], [800, 500, 'enlarged']]) {
    await page.setViewportSize({ width, height });
    for (const [theme, art] of [['modern', 'sprites'], ['modern', 'letters'], ['classic', 'letters']]) {
      for (const zoom of [1, 8]) {
        await page.evaluate(({ theme, art, zoom }) => { document.body.classList.toggle('classic', theme === 'classic'); window.factionFixture.render(zoom, art); }, { theme, art, zoom });
        const geometry = await page.evaluate(() => {
          const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
          const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
          const markers = [...document.querySelectorAll('#map-field .ship')].map((ship) => {
            const badge = ship.querySelector('.faction-identity');
            const badgeRect = rect(badge);
            const collisions = [...ship.querySelectorAll('.prize-pip,.tractor-pip,.distress-pip,.ship-state')].filter((pip) => intersects(badgeRect, rect(pip))).length;
            return { id: ship.dataset.shipId, hull: rect(ship), badge: badgeRect, faction: badge.querySelector('svg').dataset.faction, shape: badge.querySelector('svg').dataset.shape, collisions };
          });
          const minimap = [...document.querySelectorAll('.mini-dot')].map((dot) => ({ id: dot.dataset.shipId, rect: rect(dot), label: dot.getAttribute('aria-label') }));
          return { markers, minimap, map: rect(document.querySelector('#map')), overflow: document.documentElement.scrollWidth > innerWidth, hidden: document.querySelectorAll('[data-ship-id="fixture-hidden"]').length, merchantSrc: document.querySelector('.ship[data-ship-id="fixture-merchant-prize"] img')?.getAttribute('src') };
        });
        assert.equal(geometry.hidden, 0, 'an old scan never supplies a hidden badge');
        assert.equal(geometry.overflow, false, `${label} page fits its viewport`);
        assert.ok(geometry.markers.every((marker) => marker.badge.width >= 7 && marker.badge.height >= 9 && marker.collisions === 0), 'badges hold screen size and clear state/prize pips');
        for (const marker of geometry.markers.filter((marker) => !['fixture-prize', 'fixture-merchant-prize'].includes(marker.id))) {
          for (const r of [marker.hull, marker.badge]) assert.ok(r.x >= geometry.map.x - 1 && r.y >= geometry.map.y - 1 && r.x + r.width <= geometry.map.x + geometry.map.width + 1 && r.y + r.height <= geometry.map.y + geometry.map.height + 1, `${label} ${art} zoom ${zoom} centered dense contact stays inside map: ${marker.id}`);
        }
        for (const [faction, shape] of [['Federation', 'square'], ['Axis', 'triangle'], ['Bloc', 'diamond'], ['Cabal', 'circle'], ['Neutral', 'hollow-circle']]) assert.ok(geometry.markers.some((marker) => marker.faction === faction && marker.shape === shape));
        const prize = geometry.markers.find((marker) => marker.id === 'fixture-prize');
        assert.equal(prize.faction, 'Federation');
        assert.ok(geometry.minimap.some((dot) => dot.id === 'fixture-wreck' && /destroyed/.test(dot.label)));
        if (art === 'sprites') assert.equal(geometry.merchantSrc, 'assets/sprites/neutral/merchant.png');
        const stem = `faction-${label}-${theme}-${art}-zoom-${zoom}`;
        await page.screenshot({ path: resolve(output, `${stem}.png`), fullPage: true });
        if (label === 'desktop') {
          await page.evaluate(() => { document.body.style.filter = 'grayscale(1)'; });
          await page.screenshot({ path: resolve(output, `${stem}-grayscale.png`), fullPage: true });
          await page.evaluate(() => { document.body.style.filter = ''; });
        }
        evidence.push({ label, theme, art, zoom, ...geometry });
      }
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => document.body.classList.remove('classic'));
  const crowdChecks = await page.evaluate(async () => {
    const { renderGame } = await import('/ui/render.js');
    const source = window.factionFixture.game;
    const checks = [];
    for (const count of [2, 4, 6, 50]) {
      const game = { ...source, ships: Array.from({ length: count }, (_, index) => ({ ...source.ships[index % 6], id: index ? `crowd-${index}` : source.playerShipId, x: 160, y: 160 })) };
      const before = JSON.stringify(game);
      renderGame(game, { camera: { cx: 160, cy: 160, zoom: 8 }, shipArt: 'sprites' });
      const map = document.querySelector('#map').getBoundingClientRect();
      const markers = [...document.querySelectorAll('.ship')].map((ship) => ship.getBoundingClientRect());
      const clipped = markers.filter((r) => r.left < map.left || r.right > map.right || r.top < map.top || r.bottom > map.bottom).length;
      const overlaps = markers.reduce((n, a, index) => n + markers.slice(index + 1).filter((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top).length, 0);
      checks.push({ count, clipped, overlaps, unchanged: before === JSON.stringify(game) });
    }
    return checks;
  });
  for (const check of crowdChecks) { assert.equal(check.clipped, 0); assert.ok(check.unchanged); if (check.count <= 6) assert.equal(check.overlaps, 0); }
  await page.screenshot({ path: resolve(output, 'faction-worst-50-bounded.png'), fullPage: true });
  await page.evaluate(() => { document.body.classList.remove('classic'); window.factionFixture.render(8, 'sprites'); });
  await page.locator('.ship[data-ship-id="fixture-prize"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#ship-menu').hasAttribute('open'));
  assert.match(await page.locator('#ship-menu').innerText(), /Federation[\s\S]*battle cruiser/);
  assert.match(await page.locator('#ship-menu').innerText(), /taken from the Axis/);
  assert.ok(await page.locator('#ship-menu .faction-identity').first().isVisible());
  assert.ok(await page.locator('#ship-menu').evaluate((menu) => menu.contains(document.activeElement)), 'keyboard activation moves focus into the menu');
  await page.keyboard.press('Tab');
  assert.ok(await page.locator('#ship-menu').evaluate((menu) => menu.contains(document.activeElement)), 'Tab reaches another menu control');
  await page.screenshot({ path: resolve(output, 'faction-keyboard-target.png'), fullPage: true });
  await page.evaluate(() => window.factionFixture.render(8, 'sprites'));
  await page.locator('.ship[data-ship-id="axis-flagship"]').focus();
  const tetherCheck = await page.locator('.ship[data-ship-id="axis-flagship"]').evaluate((ship) => {
    const r = ship.getBoundingClientRect();
    const map = document.querySelector('#map').getBoundingClientRect();
    const tether = ship.querySelector('.stack-tether');
    const css = getComputedStyle(tether);
    const angle = new DOMMatrix(css.transform);
    const scale = new DOMMatrix(getComputedStyle(ship).transform).a * new DOMMatrix(getComputedStyle(document.querySelector('#map-field')).transform).a;
    const length = parseFloat(css.width) * scale;
    return { error: Math.hypot(r.x + r.width / 2 + angle.a * length - (map.x + map.width / 2), r.y + r.height / 2 + angle.b * length - (map.y + map.height / 2)), length };
  });
  assert.ok(tetherCheck.length > 10 && tetherCheck.error < 4, 'focused tether ends at the true position without hover-scale overshoot');
  const selectionChecks = await page.evaluate(async () => {
    const { renderGame } = await import('/ui/render.js');
    const { spawnDrone } = await import('/game/state.js');
    const source = window.factionFixture.game;
    const checks = [];
    for (const theme of ['modern', 'classic']) {
      const drone = spawnDrone(source.ships.find((ship) => ship.faction === 'Axis'), 8, 164, 160);
      const game = { ...source, ships: [...source.ships, drone] };
      document.body.classList.toggle('classic', theme === 'classic');
      renderGame(game, { shipArt: 'letters', contextShipId: drone.id, camera: { cx: 160, cy: 160, zoom: 8 } });
      const selected = document.querySelector(`.ship[data-ship-id="${drone.id}"]`);
      const css = getComputedStyle(selected);
      checks.push({ theme, threat: selected.classList.contains('threat'), selected: selected.classList.contains('selected'), outline: css.outlineColor, shadow: css.boxShadow });
    }
    return checks;
  });
  for (const check of selectionChecks) { assert.ok(check.threat && check.selected); assert.equal(check.outline, 'rgb(255, 93, 93)'); assert.notEqual(check.shadow, 'none'); }
  // Classic rules keep their phosphor/glyph treatment and omit the minimap.
  for (const theme of ['modern', 'classic']) {
    await page.evaluate(async (theme) => {
      const { createGame } = await import('/game/state.js');
      const { renderGame } = await import('/ui/render.js');
      document.body.classList.toggle('classic', theme === 'classic');
      renderGame(createGame({ seed: 'faction-classic-rules' }), { shipArt: 'letters' });
    }, theme);
    assert.equal(await page.locator('#minimap').isVisible(), false);
    assert.ok(await page.locator('.ship .glyph').count());
    assert.equal(await page.locator('#map-legend [data-faction="Neutral"]').count(), 0);
    await page.screenshot({ path: resolve(output, `faction-classic-rules-${theme}.png`), fullPage: true });
  }
  // A test-only module suffix observes the real app's frame path. Paused poses
  // are supplied deterministically, exercising redraw/frame reconciliation
  // without depending on AI motion, wall-clock timing or extra game commands.
  await page.route('**/app.js', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const suffix = `\nsetPaused(true);\nconst factionFrameRows = () => [...document.querySelectorAll('#map-field .ship,#map-field .wreck,#minimap .mini-dot')].map(el => ({ id: el.dataset.shipId, mini: el.classList.contains('mini-dot'), dx: el.style.getPropertyValue('--dx'), dy: el.style.getPropertyValue('--dy'), mdx: el.style.getPropertyValue('--mdx'), mdy: el.style.getPropertyValue('--mdy') }));\nwindow.factionFrameProbe = { paint: () => { redraw(); return factionFrameRows(); }, tick: (poses = {}) => { for (const [id, pose] of Object.entries(poses)) Object.assign(getShip(game,id),pose); prevPositions=null; simAccumulator=0; renderFrame(); return factionFrameRows(); } };\n`;
    await route.fulfill({ body: source + suffix, contentType: 'text/javascript' });
  });
  await page.evaluate(async () => {
    const { createGame } = await import('/game/state.js');
    const game = createGame({ seed: 'faction-moving', reimagined: true, realtime: true });
    game.terrain = []; game.autoConn = false;
    game.ships = game.ships.filter((ship) => ['fed-flagship', 'fed-carrier', 'axis-flagship', 'bloc-flagship'].includes(ship.id));
    game.ships.forEach((ship) => { ship.x = ship.id === 'bloc-flagship' ? 210 : 160; ship.y = 160; if (ship.id === 'axis-flagship') ship.status = 'destroyed'; });
    localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game }));
    localStorage.setItem('argonaut-web-theme', 'modern');
  });
  await page.reload();
  const frameChecks = await page.evaluate(() => {
    const initial = window.factionFrameProbe.paint();
    const sameFrame = window.factionFrameProbe.tick();
    const separated = window.factionFrameProbe.tick({ 'fed-carrier': { x: 170 } });
    const converged = window.factionFrameProbe.tick({ 'fed-carrier': { x: 160 } });
    return { initial, sameFrame, separated, converged };
  });
  const normalize = (rows) => rows.map((row) => ({ ...row, dx: row.dx || '0px', dy: row.dy || '0px', mdx: row.mdx || '0px', mdy: row.mdy || '0px' }));
  assert.deepEqual(normalize(frameChecks.sameFrame), normalize(frameChecks.initial), 'frame and redraw include the same stationary wreck in each fan');
  for (const row of frameChecks.separated.filter((row) => row.id === 'fed-carrier')) assert.equal(parseFloat((row.mini ? row.mdx : row.dx) || '0'), 0, 'departing contacts shed map/minimap fan offsets on the next frame');
  assert.deepEqual(normalize(frameChecks.converged), normalize(frameChecks.initial), 'converging contacts regain both fans without a full redraw');
  await page.screenshot({ path: resolve(output, 'faction-moving-frame.png'), fullPage: true });
  await page.unroute('**/app.js');
  // Actual campaign navigation exposes SVG buttons and preserves keyboard selection.
  await page.evaluate(async () => {
    const { createCampaign } = await import('/game/campaign.js');
    localStorage.setItem('argonaut-web-save-campaign-v1', JSON.stringify({ version: 1, campaign: createCampaign({ seed: 'faction-sector' }) }));
  });
  await page.reload();
  await page.locator('.sector-node').first().focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#sector-map > svg').getAttribute('aria-label'), /Sector systems/);
  assert.equal(await page.locator('#sector-map > svg').getAttribute('aria-hidden'), null);
  assert.ok(await page.locator('.sector-node.selected').count());
  assert.ok(await page.locator('.sector-allegiance svg').evaluateAll((badges) => badges.every((badge) => badge.getBoundingClientRect().width < 20)), 'sector badges keep a small explicit viewport');
  await page.screenshot({ path: resolve(output, 'faction-sector-keyboard.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'faction-evidence.json'), JSON.stringify({ evidence, crowdChecks, selectionChecks, tetherCheck, frameChecks, keyboardTarget: true, keyboardSector: true, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ layouts: evidence.length, keyboardTarget: true, keyboardSector: true, pageErrors: errors, output }, null, 2));
} finally { await browser.close(); }
