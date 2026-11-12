/** Browser regression check for the hull interior schematic (slice P1).
 * Runs the whole suite with npm run check:browser, which boots server.js itself;
 * or npm start and then node this file. Browser resolution, the pinned build and
 * the BROWSER_* overrides: scripts/lib/browser.mjs.
 *
 * Every render-and-measure pair happens inside a single page.evaluate. That is
 * deliberate: resizing or re-rendering #map fires the app's ResizeObserver, whose
 * redraw replaces a privately rendered fixture with the app's own state between
 * two round-trips — the race that made check-target-readiness flaky and
 * check-battle-journal unusable. One task means no observer can interleave.
 */
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/browser.mjs';

const { browser } = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');

  // The command ship's own interior: every section present, and the numbers on
  // screen are the numbers the simulation actually holds.
  const own = await page.evaluate(async () => {
    const { createGame, getShip, arcsOf, arcCapacities, systemUnits, crewCapacity, templateSystems } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const game = createGame({ seed: 'schematic-browser', reimagined: true });
    const ship = getShip(game, game.playerShipId);
    renderGame(game, { contextShipId: ship.id, shipArt: 'sprites' });

    const menu = document.querySelector('#ship-menu');
    const panel = menu.querySelector('.schematic');
    const rowValue = (key) => menu.querySelector(`[data-console-key="${key}"] .schematic-value`)?.textContent;
    const arcRows = [...menu.querySelectorAll('[data-arc-name]')].map((row) => ({
      arc: row.dataset.arcName,
      value: row.querySelector('.schematic-value')?.textContent,
      barLabel: row.querySelector('.schematic-bar')?.getAttribute('aria-label'),
    }));
    const systemRows = [...menu.querySelectorAll('[data-system-name]')].map((row) => ({
      system: row.dataset.systemName,
      value: row.querySelector('.schematic-value')?.textContent,
      blocks: row.querySelectorAll('.schematic-units > i').length,
      lit: row.querySelectorAll('.schematic-units > i.on').length,
      label: row.querySelector('.schematic-units')?.getAttribute('aria-label'),
    }));
    return {
      known: panel?.dataset.known,
      panelLabel: panel?.getAttribute('aria-label'),
      inMenu: Boolean(panel && menu.contains(panel)),
      hasArcs: Boolean(menu.querySelector('[data-console-key="arcs"]')),
      hasSystems: Boolean(menu.querySelector('[data-console-key="systems"]')),
      hasCrew: Boolean(menu.querySelector('[data-console-key="crew"]')),
      hasReactor: Boolean(menu.querySelector('[data-console-key="reactor"]')),
      sinks: [...menu.querySelectorAll('[data-sink-name]')].map((row) => row.dataset.sinkName),
      arcRows, systemRows,
      crew: rowValue('crew'),
      expected: {
        arcs: arcsOf(game, ship), capacities: arcCapacities(ship),
        crew: `${ship.crew}/${crewCapacity(ship)}`,
        systems: Object.fromEntries(Object.entries(templateSystems(ship))
          .filter(([name]) => name !== 'reactor')
          .map(([name, installed]) => [name, `${systemUnits(ship, name)}/${installed}`])),
      },
      // The command grid must stay above the schematic, so the menu still does
      // its first job: letting the player act.
      commandsBeforeSchematic: menu.innerHTML.indexOf('menu-grid') < menu.innerHTML.indexOf('class="schematic"'),
    };
  });

  assert.equal(own.known, 'true', 'your own hull is always readable');
  assert.ok(own.inMenu, 'the schematic renders inside the ship menu');
  assert.match(own.panelLabel, /^Interior readout for /, 'the panel is named for assistive tech');
  for (const section of ['hasArcs', 'hasSystems', 'hasCrew', 'hasReactor']) {
    assert.equal(own[section], true, `${section} section is drawn for a Reimagined command ship`);
  }
  assert.deepEqual(own.sinks, ['shields', 'weapons', 'engines', 'sensors', 'tractor'], 'all five reactor sinks are shown');
  assert.ok(own.commandsBeforeSchematic, 'the command grid stays above the interior readout');

  // Arcs and systems must state the simulation's real numbers, not a plausible
  // picture of them.
  assert.equal(own.arcRows.length, 4, 'four directional arcs');
  for (const row of own.arcRows) {
    assert.equal(row.value, `${own.expected.arcs[row.arc]}/${own.expected.capacities[row.arc]}`, `${row.arc} arc matches the simulation`);
    assert.match(row.barLabel, new RegExp(`${own.expected.arcs[row.arc]} of ${own.expected.capacities[row.arc]}`), `${row.arc} bar states its values in words`);
  }
  assert.ok(own.systemRows.length >= 8, 'every carried system gets a row');
  const names = own.systemRows.map((row) => row.system);
  assert.ok(names.includes('spread'),
    'the Reimagined-only spread tubes are shown, which the raw class template omits');
  assert.ok(!names.includes('reactor'), 'the reactor is shown as a power budget, not double-listed as a subsystem');
  for (const row of own.systemRows) {
    assert.equal(row.value, own.expected.systems[row.system], `${row.system} matches the simulation`);
    assert.equal(row.blocks, Number(row.value.split('/')[1]), `${row.system} draws one block per installed unit`);
    assert.equal(row.lit, Number(row.value.split('/')[0]), `${row.system} lights one block per surviving unit`);
    assert.match(row.label, /units intact$/, `${row.system} blocks are described in words, not colour alone`);
  }
  assert.equal(own.crew, own.expected.crew, 'complement matches the simulation');

  // A hull you can see but have not scanned, and that is not talking to you, is
  // the case the knowledge gate exists for: the menu opens, because the contact
  // is real, but its interior is not yours to read. (An enemy that is not even
  // visible cannot be opened at all, so it never reaches this panel.)
  const fog = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const game = createGame({ seed: 'schematic-browser', reimagined: true });
    const observer = getShip(game, game.playerShipId);
    const target = game.ships.find((ship) => ship.faction !== observer.faction);
    // A hull close aboard is legitimately readable — it is in radio contact, so
    // the gate opens and that is correct. To reach the unreadable case the
    // observer has to lose the means: knock out the command ship's radio, which
    // leaves the contact visible on the mapper but its interior unreported. This
    // is the same rule that already truncates journal prose by surviving radio
    // units, so the schematic degrades for the same reason the text does.
    const silenced = { ...observer, systems: { ...observer.systems, radio: 0 } };
    const near = { ...target, x: observer.x + 4, y: observer.y + 4 };
    const visible = { ...game, ships: game.ships.map((entry) => (entry.id === target.id ? near : entry.id === observer.id ? silenced : entry)) };
    renderGame(visible, { contextShipId: target.id, shipArt: 'sprites' });
    const menu = document.querySelector('#ship-menu');
    const hidden = {
      opened: Boolean(menu.querySelector('h3')),
      known: menu.querySelector('.schematic')?.dataset.known,
      note: menu.querySelector('[data-console-key="schematic-unknown"]')?.textContent ?? '',
      arcs: menu.querySelectorAll('[data-arc-name]').length,
      systems: menu.querySelectorAll('[data-system-name]').length,
      sinks: menu.querySelectorAll('[data-sink-name]').length,
      crew: menu.querySelector('[data-console-key="crew"] .schematic-value')?.textContent,
      targetCrew: target.crew,
    };
    // Your own hull stays readable with the radio gone: you do not need a radio
    // to report your own damage to yourself.
    renderGame(visible, { contextShipId: observer.id, shipArt: 'sprites' });
    hidden.ownKnown = document.querySelector('#ship-menu .schematic')?.dataset.known;
    // Scanning is the documented way to earn the readout back.
    const scanned = { ...visible, scanned: { ...visible.scanned, [target.id]: true } };
    renderGame(scanned, { contextShipId: target.id, shipArt: 'sprites' });
    hidden.afterScanKnown = document.querySelector('#ship-menu .schematic')?.dataset.known;
    hidden.afterScanArcs = document.querySelectorAll('#ship-menu [data-arc-name]').length;
    return hidden;
  });

  assert.equal(fog.opened, true, 'a visible contact still opens its menu');
  assert.equal(fog.known, 'false', 'a visible contact is not readable once the radio is gone');
  assert.match(fog.note, /Interior not observed/, 'and the panel says so');
  assert.match(fog.note, /[Ss]can/, 'it names scanning as the way to earn the readout');
  assert.equal(fog.arcs, 0, 'no arc is drawn for an unread hull');
  assert.equal(fog.systems, 0, 'no system is drawn');
  assert.equal(fog.sinks, 0, 'no reactor sink is drawn');
  assert.equal(fog.crew, undefined, 'no complement is drawn');
  assert.equal(fog.ownKnown, 'true', 'your own hull stays readable with the radio gone');
  assert.equal(fog.afterScanKnown, 'true', 'scanning earns the readout back');
  assert.equal(fog.afterScanArcs, 4, 'and a scanned hull shows its arcs');

  // A destroyed system must read as destroyed, in words and not colour alone.
  const damaged = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { renderGame } = await import('/ui/render.js');
    const game = createGame({ seed: 'schematic-browser', reimagined: true });
    const ship = getShip(game, game.playerShipId);
    const hurt = { ...ship, systems: { ...ship.systems, phasers: 0, mapper: 1 } };
    renderGame({ ...game, ships: game.ships.map((entry) => (entry.id === ship.id ? hurt : entry)) }, { contextShipId: ship.id, shipArt: 'sprites' });
    const menu = document.querySelector('#ship-menu');
    const down = menu.querySelector('[data-system-name="phasers"]');
    const partial = menu.querySelector('[data-system-name="mapper"]');
    return {
      downMarked: down?.dataset.systemDown,
      downClass: down?.className.includes('down'),
      downSaysOut: Boolean(down?.querySelector('.schematic-down-mark')),
      downLit: down?.querySelectorAll('.schematic-units > i.on').length,
      partialValue: partial?.querySelector('.schematic-value')?.textContent,
      partialNotDown: partial?.className.includes('down') === false,
    };
  });
  assert.equal(damaged.downMarked, 'true', 'a destroyed system is flagged in the markup');
  assert.equal(damaged.downClass, true, 'and styled as down');
  assert.equal(damaged.downSaysOut, true, 'and says "out" in words, not by colour alone');
  assert.equal(damaged.downLit, 0, 'no unit block is lit for a destroyed system');
  assert.equal(damaged.partialValue, '1/3', 'a partly damaged system shows its real surviving count');
  assert.equal(damaged.partialNotDown, true, 'and is not marked as destroyed');

  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log('check-schematic: the hull interior renders from real state, hides what was never observed, and stays readable without colour or graphics.');
} finally {
  await browser.close();
}
