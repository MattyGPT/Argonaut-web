/** Browser regression check for battle scarring (slice P3).
 * Runs the whole suite with npm run check:browser, which boots server.js itself;
 * or npm start and then node this file. Browser resolution, the pinned build and
 * the BROWSER_* overrides: scripts/lib/browser.mjs.
 *
 * Every render-and-measure pair happens inside a single page.evaluate. That is
 * deliberate: resizing or re-rendering #map fires the app's ResizeObserver, whose
 * redraw replaces a privately rendered fixture with the app's own state between
 * two round-trips — the race that made check-target-readiness flaky and
 * check-battle-journal unusable. One task means no observer can interleave.
 *
 * What this check exists to prove, and why each part needs a real browser:
 *  - the decal overlay lands on the SPRITE's box, not the button's, and carries
 *    the same rotation — geometry no Node test can measure;
 *  - the mask is the sprite's own alpha, so a burn is clipped to the silhouette
 *    instead of floating in space beside it;
 *  - compact density drops the decals with the art it has nothing to sit on;
 *  - the words survive in every surface that has to carry them, and the graphics
 *    are never the only copy;
 *  - painting a beaten fleet costs nothing measurable, because the decals are
 *    static background layers and the frame loop never touches them.
 */
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/browser.mjs';

const { browser } = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');

  // A fleet that has been through something: the command ship raked on two
  // flanks, a clean sister alongside it as the control, and an enemy that has
  // taken ion fire (unaimed, so it must not be attributed to a flank).
  const geometry = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const game = createGame({ seed: 'scarring-browser', reimagined: true });
    const own = getShip(game, game.playerShipId);
    const sister = game.ships.find((ship) => ship.id !== own.id && ship.faction === own.faction);
    const foe = game.ships.find((ship) => ship.faction !== own.faction && ship.status === 'active');
    const beaten = { ...own, scars: [
      { cause: 'phasers', arc: 'port', weight: 7 },
      { cause: 'photons', arc: 'aft', weight: 4 },
    ] };
    // Close aboard, so the enemy is actually on the mapper: a fresh war's foes
    // start outside sensor reach and an invisible hull is not drawn at all.
    const ionized = { ...foe, x: own.x + 8, y: own.y + 5, scars: [{ cause: 'ion', weight: 4 }] };
    const staged = { ...game, ships: game.ships.map((ship) => {
      if (ship.id === own.id) return beaten;
      if (ship.id === foe.id) return ionized;
      return ship;
    }) };
    renderGame(staged, { shipArt: 'sprites', contextShipId: own.id });

    const box = (selector, root = document) => {
      const el = root.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    };
    const hull = document.querySelector(`.ship[data-ship-id="${own.id}"]`);
    const overlay = hull?.querySelector('.scarring');
    const style = overlay ? getComputedStyle(overlay) : null;
    const spriteStyle = hull ? getComputedStyle(hull.querySelector('.sprite')) : null;
    const clean = document.querySelector(`.ship[data-ship-id="${sister.id}"]`);
    const ion = document.querySelector(`.ship[data-ship-id="${foe.id}"] .scarring`);
    return {
      sisterWasClean: sister.scars.length === 0,
      foundHull: Boolean(hull),
      foundOverlay: Boolean(overlay),
      layers: style ? style.backgroundImage.split('radial-gradient').length - 1 : 0,
      // The overlay must cover the art exactly. inset:1px matches .has-sprite's
      // padding, which is the box the sprite fills; if these diverge the decals
      // are painted somewhere they are not wanted.
      overlayBox: box('.scarring', hull),
      spriteBox: box('.sprite', hull),
      overlayTransform: style?.transform,
      spriteTransform: spriteStyle?.transform,
      maskImage: style?.maskImage ?? style?.webkitMaskImage ?? '',
      maskSize: style?.maskSize ?? style?.webkitMaskSize ?? '',
      pointerEvents: style?.pointerEvents,
      position: style?.position,
      ariaHidden: overlay?.getAttribute('aria-hidden'),
      ariaLabel: hull?.getAttribute('aria-label'),
      title: hull?.getAttribute('title'),
      // The mask URL has to be the SAME asset the img is showing, or the decals
      // are clipped to some other hull's silhouette.
      hullArt: overlay?.style.getPropertyValue('--hull-art') ?? '',
      spriteSrc: hull?.querySelector('.sprite')?.getAttribute('src') ?? '',
      cleanHasOverlay: Boolean(clean?.querySelector('.scarring')),
      cleanLabel: clean?.getAttribute('aria-label') ?? '',
      cleanClass: clean?.className ?? '',
      beatenClass: hull?.className ?? '',
      beatenSpriteFilter: hull ? getComputedStyle(hull.querySelector('.sprite')).filter : '',
      ionOverlay: Boolean(ion),
      ionLayers: ion ? getComputedStyle(ion).backgroundImage.split('radial-gradient').length - 1 : 0,
      // The decals must not be reachable by keyboard or announce themselves: they
      // are decoration, and the accessible name already carries the fact.
      overlayTabbable: overlay ? overlay.matches('button, [href], input, [tabindex]:not([tabindex="-1"])') : null,
    };
  });

  assert.equal(geometry.foundHull, true, 'the scarred command ship is on the field');
  assert.equal(geometry.sisterWasClean, true, 'the control hull really is unmarked');
  assert.equal(geometry.foundOverlay, true, 'a beaten hull wears a decal overlay');
  assert.equal(geometry.layers, 2, 'both marks are painted, as layers on ONE span rather than two nodes');
  assert.equal(geometry.ionLayers, 1, 'and the ion-burned enemy wears its single unaimed burn on the same span');
  assert.match(geometry.beatenClass, /battle-worn/, 'a hull deep enough in marks also dulls, so a veteran reads across a fleet');
  assert.match(geometry.beatenSpriteFilter, /saturate/, 'the dulling is a filter on the art, not a recolour of the faction ring');
  assert.ok(!/battle-worn/.test(geometry.cleanClass), 'and an unmarked sister stays bright beside it');
  assert.equal(geometry.ariaHidden, 'true', 'the overlay is hidden from assistive tech');
  assert.equal(geometry.overlayTabbable, false, 'and is not keyboard-reachable — it is decoration');
  assert.equal(geometry.pointerEvents, 'none', 'it never steals a click from the hull button');
  assert.equal(geometry.position, 'absolute', 'it is out of flow, so it cannot resize the hull');

  // Overlay and sprite must be the same box, to within a pixel of rounding.
  for (const edge of ['left', 'top', 'width', 'height']) {
    assert.ok(Math.abs(geometry.overlayBox[edge] - geometry.spriteBox[edge]) <= 1,
      `the overlay's ${edge} matches the sprite's (${geometry.overlayBox[edge]} vs ${geometry.spriteBox[edge]})`);
  }
  assert.equal(geometry.overlayTransform, geometry.spriteTransform,
    'the decals rotate with the hull, because a scar is painted on the frame');

  // The mask is what keeps a burn from floating in space beside the silhouette.
  assert.ok(geometry.maskImage.includes('url('), `the overlay is masked (${geometry.maskImage})`);
  assert.ok(geometry.maskImage.includes(geometry.spriteSrc) || geometry.hullArt.includes(geometry.spriteSrc),
    `and the mask is the sprite's own alpha (${geometry.hullArt} vs ${geometry.spriteSrc})`);
  assert.match(geometry.maskSize, /^100% 100%/, 'the mask is stretched to the art box');

  // A mask whose image 404s renders UNCLIPPED, which is the failure mode that
  // would put burns floating in space beside the hull — so prove the source
  // actually decodes, not merely that the property is set. This probe is its own
  // evaluate on purpose: awaiting inside the geometry task above would yield to
  // the event loop and let the app's ResizeObserver redraw its own game over the
  // fixture mid-measurement, which is exactly the race this suite exists to avoid.
  const mask = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const game = createGame({ seed: 'scarring-browser', reimagined: true });
    const own = getShip(game, game.playerShipId);
    renderGame({ ...game, ships: game.ships.map((ship) => (ship.id === own.id
      ? { ...ship, scars: [{ cause: 'phasers', arc: 'port', weight: 5 }] } : ship)) }, { shipArt: 'sprites' });
    const overlay = document.querySelector('.ship .scarring');
    const url = (overlay?.style.getPropertyValue('--hull-art') || '').replace(/^url\((?:"|')?/, '').replace(/(?:"|')?\)$/, '');
    const spriteSrc = overlay?.closest('.ship')?.querySelector('.sprite')?.getAttribute('src') ?? '';
    const loads = await new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve(probe.naturalWidth > 0 && probe.naturalHeight > 0);
      probe.onerror = () => resolve(false);
      probe.src = url;
    });
    return { url, spriteSrc, loads };
  });
  assert.equal(mask.loads, true, `the mask source decodes (${mask.url})`);
  assert.equal(mask.url.replace(/^url\(/, '').replace(/\)$/, ''), mask.spriteSrc,
    'and it is the very asset the hull is drawn with');

  // The words: a picture of damage that nothing says in words would be a
  // graphics-only channel, which this project does not ship.
  assert.match(geometry.ariaLabel, / — battle-scarred/, 'the accessible name says so');
  assert.match(geometry.title, / — battle-scarred/, 'and so does the tooltip');
  assert.ok(!geometry.cleanLabel.includes('battle-scarred'), 'an unmarked hull claims nothing');
  assert.equal(geometry.cleanHasOverlay, false, 'and wears no overlay');

  // Compact density drops the art for a letter disc, so the decals go with it.
  const compact = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const game = createGame({ seed: 'scarring-compact', reimagined: true });
    const own = getShip(game, game.playerShipId);
    const beaten = { ...own, scars: [{ cause: 'phasers', arc: 'port', weight: 5 }] };
    const staged = { ...game, ships: game.ships.map((ship) => (ship.id === own.id ? beaten : ship)) };
    renderGame(staged, { shipArt: 'sprites', contactMode: 'compact' });
    const hull = document.querySelector(`.ship[data-ship-id="${own.id}"]`);
    const overlay = hull?.querySelector('.scarring');
    return {
      isCompact: Boolean(hull?.classList.contains('compact-contact')),
      display: overlay ? getComputedStyle(overlay).display : null,
      spriteDisplay: hull ? getComputedStyle(hull.querySelector('.sprite')).display : null,
      label: hull?.getAttribute('aria-label') ?? '',
    };
  });
  assert.equal(compact.isCompact, true, 'the fixture really is at compact density');
  assert.equal(compact.display, 'none', 'the decals are dropped when the art is');
  assert.equal(compact.spriteDisplay, 'none', 'alongside the sprite they sit on');
  assert.match(compact.label, / — battle-scarred/, 'but the words stay — the fact is not an art setting');

  // The sensor card is the sentence behind another hull's decals.
  const card = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame, updateSensorCard } = await import('/ui/render.js');
    const game = createGame({ seed: 'scarring-card', reimagined: true });
    const own = getShip(game, game.playerShipId);
    const foe = game.ships.find((ship) => ship.faction !== own.faction && ship.status === 'active');
    const beaten = { ...foe, x: own.x + 6, y: own.y, scars: [
      { cause: 'phasers', arc: 'starboard', weight: 6 },
      { cause: 'photons', arc: 'starboard', weight: 3 },
      { cause: 'collision', weight: 1 },
    ] };
    const staged = { ...game, ships: game.ships.map((ship) => (ship.id === foe.id ? beaten : ship)) };
    renderGame(staged, { shipArt: 'sprites', hoverShipId: foe.id });
    updateSensorCard(staged, { hoverShipId: foe.id });
    const text = document.querySelector('#sensor-card')?.textContent ?? '';
    return { text, marks: beaten.scars.length, shotsTaken: beaten.shotsTaken };
  });
  assert.match(card.text, /Battle scarring — 3 marks on the frame/,
    'the card states the scarring in words');
  assert.match(card.text, /worst on the starboard quarter/,
    'and names the flank that took the most, which is the fact the decals show');
  assert.match(card.text, /phaser burns, warhead strikes, and more/,
    'naming the kinds of fire, summarised past the second');
  assert.ok(!/strikes absorbed/.test(card.text),
    'and never quoting shotsTaken — a campaign does not carry it, so on a veteran hull it would contradict the marks beside it');

  // The Interior panel is the word equivalent for the player's OWN hull, which the
  // sensor card deliberately does not cover.
  const panel = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const game = createGame({ seed: 'scarring-panel', reimagined: true });
    const own = getShip(game, game.playerShipId);
    const beaten = { ...own, scars: [
      { cause: 'phasers', arc: 'port', weight: 7 },
      { cause: 'photons', arc: 'aft', weight: 2 },
      { cause: 'ion', weight: 1 },
    ] };
    renderGame({ ...game, ships: game.ships.map((ship) => (ship.id === own.id ? beaten : ship)) },
      { shipArt: 'sprites', contextShipId: own.id });
    const menu = document.querySelector('#ship-menu');
    const frame = menu?.querySelector('[data-console-key="frame"]');
    return {
      found: Boolean(frame),
      marks: frame?.dataset.scarMarks,
      rows: [...(frame?.querySelectorAll('.schematic-row') ?? [])].map((row) => ({
        key: row.dataset.consoleKey,
        label: row.querySelector('.schematic-label')?.textContent,
        detail: row.querySelector('.schematic-frame')?.textContent,
        depth: row.querySelector('.schematic-value')?.textContent,
      })),
      legend: frame?.querySelector('.schematic-legend')?.textContent ?? '',
      // A clean hull must still get the section, saying so plainly.
      cleanNote: (() => {
        renderGame(game, { shipArt: 'sprites', contextShipId: own.id });
        return document.querySelector('#ship-menu [data-console-key="frame-clean"]')?.textContent ?? '';
      })(),
    };
  });
  assert.equal(panel.found, true, 'the Interior panel gains a Frame section');
  assert.equal(panel.marks, '3', 'stating how many marks the frame carries');
  assert.deepEqual(panel.rows.map((row) => row.key), ['frame-port', 'frame-aft', 'frame-unaimed'],
    'one row per flank that was reached, heaviest first, with unaimed damage as its own category');
  assert.equal(panel.rows[0].label, 'Port', 'named in words');
  assert.match(panel.rows[0].detail, /phaser burns ×7/, 'with the kind of fire and how deep');
  assert.equal(panel.rows[0].depth, '7');
  assert.equal(panel.rows[2].label, 'Unaimed', 'ion damage is not attributed to a flank it did not come from');
  assert.match(panel.legend, /Battle scarring — 3 marks on the frame/, 'and the legend carries the whole sentence');
  assert.match(panel.cleanNote, /^No battle scarring on the frame\.$/, 'a clean hull is told so, and nothing more is claimed');

  // Painting a beaten fleet must not cost the frame loop anything: the decals are
  // static background layers, and nothing in the animation path touches them.
  const cost = await page.evaluate(async () => {
    const { createGame } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const marks = (id) => [
      { cause: 'phasers', arc: 'port', weight: 9 }, { cause: 'phasers', arc: 'aft', weight: 6 },
      { cause: 'photons', arc: 'starboard', weight: 4 }, { cause: 'ion', weight: 3 },
      { cause: 'collision', arc: 'fore', weight: 2 }, { cause: 'shrapnel', weight: 1 },
    ];
    const build = (scarred) => {
      const game = createGame({ seed: 'scarring-cost', reimagined: true });
      return { ...game, ships: game.ships.map((ship, index) => (scarred && index % 2 === 0
        ? { ...ship, scars: marks(ship.id), shotsTaken: 40 } : ship)) };
    };
    const time = (game) => {
      renderGame(game, { shipArt: 'sprites' }); // warm the layout and the image cache
      const samples = [];
      for (let run = 0; run < 12; run += 1) {
        const started = performance.now();
        renderGame(game, { shipArt: 'sprites' });
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      return { min: samples[0], p50: samples[6], p95: samples[11] };
    };
    // CI runs this suite four checks wide, so an absolute millisecond bound is not
    // a valid instrument here: it measured +7.1ms of p95 delta on a contended
    // runner and -2.2ms on an idle one for the same code. Contention only ever
    // ADDS time, so the quietest sample of each fleet is the one that measures the
    // decals rather than the runner; and interleaving the two fleets round by round
    // stops a burst of neighbour noise landing on one and not the other.
    const cleanGame = build(false);
    const beatenGame = build(true);
    const clean = [];
    const beaten = [];
    for (let round = 0; round < 4; round += 1) {
      clean.push(time(cleanGame));
      beaten.push(time(beatenGame));
    }
    const best = (rows, key) => Math.min(...rows.map((row) => row[key]));
    return {
      clean: { min: best(clean, 'min'), p50: best(clean, 'p50'), p95: best(clean, 'p95') },
      beaten: {
        min: best(beaten, 'min'), p50: best(beaten, 'p50'), p95: best(beaten, 'p95'),
        overlays: document.querySelectorAll('.ship .scarring').length,
      },
      hulls: document.querySelectorAll('.ship').length,
    };
  });
  assert.ok(cost.beaten.overlays > 0, 'the cost scene really does paint decals');
  assert.ok(cost.beaten.overlays <= cost.hulls, 'and never more than one per hull');
  const minDelta = cost.beaten.min - cost.clean.min;
  assert.ok(minDelta < 2,
    `painting ${cost.beaten.overlays} scarred hulls adds under 2ms to the quietest redraw of ${cost.hulls} hulls (measured ${minDelta.toFixed(2)}ms, clean ${cost.clean.min.toFixed(2)}ms, scarred ${cost.beaten.min.toFixed(2)}ms)`);
  assert.ok(cost.beaten.min < 50, `and a scarred fleet's redraw stays sane even at its quietest (${cost.beaten.min.toFixed(2)}ms)`);

  // Reduced motion has nothing to suppress, and that is worth pinning: if a
  // future slice animates the decals it must not do so unconditionally.
  const motion = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const game = createGame({ seed: 'scarring-motion', reimagined: true });
    const own = getShip(game, game.playerShipId);
    renderGame({ ...game, ships: game.ships.map((ship) => (ship.id === own.id
      ? { ...ship, scars: [{ cause: 'phasers', arc: 'port', weight: 9 }] } : ship)) },
    { shipArt: 'sprites' });
    const style = getComputedStyle(document.querySelector('.ship .scarring'));
    return { animation: style.animationName, transition: style.transitionProperty };
  });
  assert.match(motion.animation, /^none$/, 'the decals are static paint — nothing to animate, so nothing to suppress');
  assert.match(motion.transition, /^(none|all)$/, 'and they do not transition');

  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log(`check-scarring: ${cost.beaten.overlays} scarred hulls paint masked decals on the flank that was struck, for ${minDelta >= 0 ? '+' : ''}${minDelta.toFixed(2)}ms on the quietest redraw of ${cost.hulls} hulls (clean ${cost.clean.min.toFixed(2)}ms, scarred ${cost.beaten.min.toFixed(2)}ms; p95 ${cost.clean.p95.toFixed(2)}ms vs ${cost.beaten.p95.toFixed(2)}ms), and every one of them is also stated in words.`);
} finally {
  await browser.close();
}
