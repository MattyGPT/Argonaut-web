/** Browser regression check for arc-impact FX and wreck debris (slice P3b).
 * Runs the whole suite with npm run check:browser, which boots server.js itself;
 * or npm start and then node this file. Browser resolution, the pinned build and
 * the BROWSER_* overrides: scripts/lib/browser.mjs.
 *
 * What needs a real browser here: the flare is SVG geometry in a viewBox that
 * tracks the camera, offset in SCREEN pixels against hulls that are a constant
 * screen size — none of which exists in Node. And the debris field is a masked
 * background on a wreck element whose box only a layout engine can report.
 *
 * Every render-and-measure pair happens inside a single page.evaluate: resizing or
 * re-rendering #map fires the app's ResizeObserver, whose redraw replaces a
 * privately rendered fixture with the app's own state between two round-trips.
 *
 * This check goes one step further and replaces app.js with an empty module.
 * Unlike the other fixture checks it MUST await inside the page — playEffects
 * staggers its non-terminal draws through setTimeout, and a flare's lifetime has
 * to be observed over real milliseconds — and every await is a window in which
 * the live app's own loop redraws its own war over the fixture. index.html still
 * supplies the DOM skeleton renderGame and playEffects write into; nothing else
 * about the app is under test here.
 */
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/browser.mjs';

const { browser } = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export {};' }));
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');

  // An aimed hit that names an arc must flare on the quarter that took it: the
  // flare's centre has to lie on the shooter's side of the target hull, at the
  // plating's edge rather than at its centre or somewhere arbitrary.
  // playEffects staggers non-terminal draws through setTimeout, so the measure
  // has to await a beat; with app.js stubbed out nothing can redraw over the
  // fixture while it does.
  const flare = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const { playEffects } = await import('/ui/fx.js');
    const game = createGame({ seed: 'arc-impact-browser', reimagined: true });
    const own = getShip(game, game.playerShipId);
    const foe = game.ships.find((ship) => ship.faction !== own.faction && ship.status === 'active');
    const near = { ...foe, x: own.x + 20, y: own.y + 7 };
    const staged = { ...game, ships: game.ships.map((ship) => (ship.id === foe.id ? near : ship)) };
    const map = document.querySelector('#map');
    const win = { minX: own.x - 45, minY: own.y - 45, width: 90, height: 90 };
    renderGame(staged, { shipArt: 'sprites' });
    const presentAtRender = Boolean(document.querySelector(`.ship[data-ship-id="${foe.id}"]`));

    const centre = (id) => {
      const rect = document.querySelector(`.ship[data-ship-id="${id}"], .wreck[data-ship-id="${id}"]`)?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    };
    const measure = async (event) => {
      map.querySelector('svg.fx-layer')?.remove();
      playEffects([event], map, own.id, win);
      // playEffects staggers non-terminal draws through setTimeout, so the flare
      // exists a beat later, not synchronously.
      await new Promise((resolve) => setTimeout(resolve, 60));
      const path = map.querySelector('.fx-arcflare');
      const ring = map.querySelector('.fx-impact');
      const mid = (el) => {
        const box = el.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      };
      if (!path) return { found: false, ring: ring ? mid(ring) : null };
      return {
        found: true,
        klass: path.getAttribute('class'),
        flare: mid(path),
        ring: ring ? mid(ring) : null,
      };
    };
    const aimed = await measure({ kind: 'phasers', fromId: own.id, toId: foe.id, x1: own.x, y1: own.y, x2: near.x, y2: near.y, hit: true, arc: 'port' });
    const unaimed = await measure({ kind: 'ion', fromId: own.id, toId: foe.id, x1: own.x, y1: own.y, x2: near.x, y2: near.y, hit: true });
    const missed = await measure({ kind: 'phasers', fromId: own.id, toId: foe.id, x1: own.x, y1: own.y, x2: near.x, y2: near.y, hit: false, arc: 'port' });
    return {
      aimed, unaimed, missed,
      shooter: centre(own.id),
      target: centre(foe.id),
      presentAfterRender: presentAtRender,
      presentAfterMeasures: Boolean(document.querySelector(`.ship[data-ship-id="${foe.id}"]`)),
      shipCount: document.querySelectorAll('.ship').length,
      // The flare must not outlive its beat, or a long war accumulates bows of light.
      lifetime: await new Promise((resolve) => setTimeout(() => resolve(map.querySelectorAll('.fx-arcflare').length), 700)),
    };
  });

  assert.equal(flare.aimed.found, true, 'an aimed hit that names an arc throws a flare');
  assert.match(flare.aimed.klass, /fx-arcflare fx-arcflare-phasers/, 'coloured for the weapon that landed');
  assert.equal(flare.unaimed.found, false, 'ion reaches the frame without favouring a side, so it flares none');
  assert.equal(flare.missed.found, false, 'and a miss struck nothing, so nothing flares');
  assert.equal(flare.lifetime, 0, 'the flare removes itself once its beat is over');

  // The flare sits on the quarter that took the volley: on the shooter's side of
  // the target's centre, at the plating's edge rather than at the centre.
  assert.ok(flare.target && flare.shooter,
    `both hulls measurable (after render ${flare.presentAfterRender}, after measures ${flare.presentAfterMeasures}, ships ${flare.shipCount})`);
  const toward = { x: flare.shooter.x - flare.target.x, y: flare.shooter.y - flare.target.y };
  const offset = { x: flare.aimed.ring.x - flare.target.x, y: flare.aimed.ring.y - flare.target.y };
  const dot = toward.x * offset.x + toward.y * offset.y;
  assert.ok(dot > 0, 'the impact ring is on the shooter\'s side of the hull it struck');
  const distance = Math.hypot(offset.x, offset.y);
  assert.ok(distance > 8 && distance < 26,
    `and it sits at the plating's edge, ${distance.toFixed(1)}px out from the hull centre rather than dead centre`);
  // The flare is a bow, so its bounding box centres beyond its own radius: expect
  // it further out than the ring, on the same side, and say why in the bound.
  const flareOffset = { x: flare.aimed.flare.x - flare.target.x, y: flare.aimed.flare.y - flare.target.y };
  assert.ok(toward.x * flareOffset.x + toward.y * flareOffset.y > 0, 'the flare bows on the same quarter');
  const flareDistance = Math.hypot(flareOffset.x, flareOffset.y);
  assert.ok(flareDistance > distance && flareDistance < 46,
    `the flare bows outside the plating (${flareDistance.toFixed(1)}px, beyond the ring's ${distance.toFixed(1)}px)`);

  // A destroyed hull lies in a debris field for the rest of the engagement, and
  // the field is part of the wreck element so it cannot outlive the war.
  const debris = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const draw = (art, contactMode) => {
      const game = createGame({ seed: 'debris-browser', reimagined: true });
      const own = getShip(game, game.playerShipId);
      const doomed = game.ships.find((ship) => ship.faction !== own.faction);
      const wreck = { ...doomed, status: 'destroyed', x: own.x + 6, y: own.y + 4 };
      renderGame({ ...game, ships: game.ships.map((ship) => (ship.id === doomed.id ? wreck : ship)) }, { shipArt: art, contactMode });
      const el = document.querySelector(`.wreck[data-ship-id="${doomed.id}"] .debris`);
      if (!el) return { found: false };
      const wreckBox = el.closest('.wreck').getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return {
        found: true,
        layers: getComputedStyle(el).backgroundImage.split('radial-gradient').length - 1,
        hidden: getComputedStyle(el).display === 'none',
        overshoot: Math.round((wreckBox.width - box.width) / -2),
        ariaHidden: el.getAttribute('aria-hidden'),
        label: el.closest('.wreck').getAttribute('aria-label'),
      };
    };
    return {
      sprites: draw('sprites', 'full'),
      compact: draw('sprites', 'compact'),
      letters: draw('letters', 'full'),
    };
  });
  assert.equal(debris.sprites.found, true, 'a wreck lies in its debris field under sprite art');
  assert.equal(debris.sprites.layers, 10, 'halo, shards and embers, on one span');
  assert.equal(debris.sprites.hidden, false, 'drawn at full density');
  assert.ok(debris.sprites.overshoot <= 6, `the field barely overshoots the hulk (${debris.sprites.overshoot}px), so it cannot read as dirt on a neighbour`);
  assert.equal(debris.sprites.ariaHidden, 'true', 'and it is decoration: the wreck\'s name already says destroyed');
  assert.match(debris.sprites.label, /destroyed wreck$/, 'the words for a wreck are unchanged by the picture');
  assert.equal(debris.compact.hidden, true, 'at compact density the hulk shrinks to a marker, and the field goes with the art');
  assert.equal(debris.letters.found, false, 'letters have no hulk to lie in, so no field is drawn');

  // The flare is motion, so reduced motion collapses it the same way every other
  // impact effect is collapsed — suppressed in feel, not in fact.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const { playEffects } = await import('/ui/fx.js');
    const game = createGame({ seed: 'arc-impact-reduced', reimagined: true });
    const own = getShip(game, game.playerShipId);
    const foe = game.ships.find((ship) => ship.faction !== own.faction && ship.status === 'active');
    const near = { ...foe, x: own.x + 20, y: own.y + 7 };
    renderGame({ ...game, ships: game.ships.map((ship) => (ship.id === foe.id ? near : ship)) }, { shipArt: 'sprites' });
    const map = document.querySelector('#map');
    map.querySelector('svg.fx-layer')?.remove();
    playEffects([{ kind: 'phasers', fromId: own.id, toId: foe.id, x1: own.x, y1: own.y, x2: near.x, y2: near.y, hit: true, arc: 'port' }],
      map, own.id, { minX: own.x - 45, minY: own.y - 45, width: 90, height: 90 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const path = map.querySelector('.fx-arcflare');
    return path ? getComputedStyle(path).animationDuration : null;
  });
  assert.equal(reduced, '0.01s', 'under prefers-reduced-motion the flare collapses with every other impact effect');

  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log('check-arc-impact: an aimed volley flares on the quarter that took it, ion and misses flare nowhere, and a wreck lies in a debris field that outlives the round but not the war.');
} finally {
  await browser.close();
}
