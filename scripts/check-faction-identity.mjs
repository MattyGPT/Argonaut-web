/** Optional browser regression: npm start, then set PLAYWRIGHT_MODULE to an
 * existing playwright-core install. No downloads. Evidence defaults to TEMP. */
import { launchBrowser } from './lib/browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const output = process.env.FACTION_OUTPUT || resolve(tmpdir(), 'argonaut-faction-navigation');
await mkdir(output, { recursive: true });
const { browser } = await launchBrowser();
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
  // Selection and threat cues, split by contact density. This assertion used to
  // demand the classic red ring for BOTH themes and was treated as a contract; it
  // was not one. At 9961edd the modern red came only from a source-order tie-break
  // between two equal-specificity rules (.ship.selected white at styles.css:275 vs
  // .ship.threat red at :362). The round-31 compact-contact rules (:2685, :2688,
  // :2711) now outrank both and deliberately replace the ring with a red corner
  // while keeping selection white — exactly what the V-spec at
  // docs/superpowers/specs/2026-10-06-terrain-and-command-presentation.md:107
  // requires. The fixture below renders its selected threat inside a dense zoom-8
  // stack, so it was measuring the compact case and asserting the non-compact
  // colour. See docs/superpowers/reviews/2026-11-12-faction-identity-outline-investigation.md.
  //
  // Both cases are now pinned, and the compact case asserts the red corner ALONGSIDE
  // the white outline. Asserting white alone would be the "weaken until green" move:
  // the corner is what keeps a threat affordance pinned, so dropping it would let a
  // future change remove the cue entirely and still pass.
  const selectionChecks = await page.evaluate(async () => {
    const { renderGame } = await import('/ui/render.js');
    const { spawnDrone } = await import('/game/state.js');
    const source = window.factionFixture.game;
    const measure = (node) => {
      const css = getComputedStyle(node);
      const corner = node.querySelector('.contact-threat');
      const cornerCss = corner ? getComputedStyle(corner) : null;
      return {
        threat: node.classList.contains('threat'),
        selected: node.classList.contains('selected'),
        compact: node.classList.contains('compact-contact'),
        outline: css.outlineColor,
        outlineOffset: css.outlineOffset,
        shadow: css.boxShadow,
        cornerPresent: Boolean(corner),
        cornerDisplay: cornerCss?.display ?? null,
        cornerBorderTop: cornerCss?.borderTopColor ?? null,
      };
    };
    const checks = [];
    // (a) Dense stack at zoom 8: contact density compacts the marker.
    for (const theme of ['modern', 'classic']) {
      const drone = spawnDrone(source.ships.find((ship) => ship.faction === 'Axis'), 8, 164, 160);
      const game = { ...source, ships: [...source.ships, drone] };
      document.body.classList.toggle('classic', theme === 'classic');
      renderGame(game, { shipArt: 'letters', contextShipId: drone.id, camera: { cx: 160, cy: 160, zoom: 8 } });
      checks.push({ scene: 'compact', theme, ...measure(document.querySelector(`.ship[data-ship-id="${drone.id}"]`)) });
    }
    // (b) One isolated threat, with contact density set to Full — the app's own
    // setting, which returns an empty compact set unconditionally. That defeats the
    // 72/84px hysteresis deterministically instead of depending on how many pixels
    // the camera happens to give a 25-unit separation.
    for (const theme of ['modern', 'classic']) {
      const player = source.ships.find((ship) => ship.id === source.playerShipId);
      const foe = {
        ...source.ships.find((ship) => ship.faction === 'Axis' && ship.status === 'active' && ship.systems.phasers > 0),
        id: 'fixture-isolated-threat', x: player.x + 25, y: player.y,
      };
      const game = { ...source, ships: [{ ...player }, foe] };
      document.body.classList.toggle('classic', theme === 'classic');
      renderGame(game, {
        shipArt: 'letters', contactMode: 'full', contextShipId: foe.id,
        camera: { cx: player.x + 12, cy: player.y, zoom: 2 },
      });
      checks.push({ scene: 'isolated', theme, ...measure(document.querySelector(`.ship[data-ship-id="${foe.id}"]`)) });
    }
    document.body.classList.remove('classic');
    return checks;
  });
  const cue = (scene, theme) => selectionChecks.find((check) => check.scene === scene && check.theme === theme);
  for (const check of selectionChecks) {
    assert.ok(check.threat && check.selected, `${check.scene}/${check.theme}: the fixture really selected a threat`);
    assert.notEqual(check.shadow, 'none', `${check.scene}/${check.theme}: the selected-threat halo is still drawn`);
  }
  // Isolated contact: the red ring the legend teaches, in BOTH themes.
  for (const theme of ['modern', 'classic']) {
    const check = cue('isolated', theme);
    assert.equal(check.compact, false, `isolated/${theme}: contact density really is off, so this is the non-compact contract`);
    assert.equal(check.outline, 'rgb(255, 93, 93)', `isolated/${theme}: a selected threat keeps the red ring the legend teaches`);
    assert.equal(check.outlineOffset, '2px', `isolated/${theme}: at the offset the legend's ring is drawn with`);
  }
  // Compact contact: selection stays white and the threat moves to a red corner.
  const compactModern = cue('compact', 'modern');
  assert.equal(compactModern.compact, true, 'compact/modern: the fixture really produced a dense contact');
  assert.equal(compactModern.outline, 'rgb(255, 255, 255)', 'compact/modern: selection stays white, per the V-spec');
  assert.equal(compactModern.cornerPresent, true, 'compact/modern: the threat cue moves to the corner flag rather than disappearing');
  assert.equal(compactModern.cornerDisplay, 'block', 'compact/modern: and the corner flag is actually rendered, not display:none');
  assert.equal(compactModern.cornerBorderTop, 'rgb(255, 104, 104)', 'compact/modern: the corner flag is red');
  const compactClassic = cue('compact', 'classic');
  assert.equal(compactClassic.compact, true, 'compact/classic: classic is dense too in this fixture');
  assert.equal(compactClassic.outline, 'rgb(255, 93, 93)', 'compact/classic: classic keeps its red selection outline, which outranks the compact rule');
  // Classic rules keep their phosphor/glyph treatment and omit the minimap.
  // Rendered and measured inside ONE page.evaluate: across a round-trip the app's own
  // ResizeObserver fires (renderGame unhides #terrain-toggle, which resizes #map) and
  // redraws the app's reimagined save over this fixture, so a later assertion ends up
  // measuring the wrong game. That race — not the outline colour — is what first
  // turned this check red at d613faa. The screenshot afterwards is evidence only.
  for (const theme of ['modern', 'classic']) {
    const rules = await page.evaluate(async (theme) => {
      const { createGame } = await import('/game/state.js');
      const { renderGame } = await import('/ui/render.js');
      document.body.classList.toggle('classic', theme === 'classic');
      renderGame(createGame({ seed: 'faction-classic-rules' }), { shipArt: 'letters' });
      const minimap = document.querySelector('#minimap');
      return {
        minimapHidden: minimap.hidden || getComputedStyle(minimap).display === 'none'
          || minimap.getBoundingClientRect().height === 0,
        glyphs: document.querySelectorAll('.ship .glyph').length,
        neutralLegend: document.querySelectorAll('#map-legend [data-faction="Neutral"]').length,
      };
    }, theme);
    assert.equal(rules.minimapHidden, true, `${theme} theme: a classic-rules war omits the minimap`);
    assert.ok(rules.glyphs > 0, `${theme} theme: hulls are drawn as letter glyphs`);
    assert.equal(rules.neutralLegend, 0, `${theme} theme: no Neutral entry in the legend`);
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
