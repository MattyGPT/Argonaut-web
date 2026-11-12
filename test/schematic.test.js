import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, arcsOf, arcCapacities, systemUnits, crewCapacity, reactorOutput, powerAllocation, getShip } from '../game/state.js';
import { schematicHtml, schematicKnown } from '../ui/schematic.js';

const own = (game) => getShip(game, game.playerShipId);
const enemy = (game) => game.ships.find((ship) => ship.faction !== own(game).faction);

test('the command ship schematic shows its real arcs, systems, complement and reactor', () => {
  const game = createGame({ seed: 'schematic-own', reimagined: true });
  const ship = own(game);
  const html = schematicHtml(game, ship);

  assert.match(html, /data-console-key="schematic"/);
  assert.match(html, /data-known="true"/, 'your own hull is always readable');

  const arcs = arcsOf(game, ship);
  const capacity = arcCapacities(ship);
  for (const arc of Object.keys(capacity)) {
    assert.match(html, new RegExp(`data-console-key="arc-${arc}"`), `${arc} arc is drawn`);
    assert.ok(html.includes(`>${arcs[arc]}/${capacity[arc]}</span>`), `${arc} shows its live and undamaged values`);
  }

  for (const [system, installed] of Object.entries(ship.systems)) {
    if (system === 'reactor') continue; // drawn as the power budget, not as a subsystem row
    assert.match(html, new RegExp(`data-console-key="system-${system}"`), `${system} row is drawn`);
    assert.ok(html.includes(`>${systemUnits(ship, system)}/${installed}</span>`), `${system} shows surviving against installed`);
  }
  assert.doesNotMatch(html, /data-console-key="system-reactor"/, 'the reactor is not double-listed as a subsystem');

  assert.ok(html.includes(`>${ship.crew}/${crewCapacity(ship)}</span>`), 'complement shows crew against capacity');
  assert.ok(html.includes(`data-console-key="reactor"`), 'reactor section is drawn in a Reimagined war');
  assert.ok(html.includes(`${reactorOutput(ship, game)} points from ${systemUnits(ship, 'reactor')} units`),
    'the reactor legend states the real budget and the units producing it');
  const allocation = powerAllocation(game, ship);
  assert.ok(html.includes(`>${allocation.engines}/`), 'a sink shows what is actually allocated to it');
});

test('a knocked-out system is marked down and a starved sink is flagged', () => {
  const game = createGame({ seed: 'schematic-damage', reimagined: true });
  const ship = { ...own(game), systems: { ...own(game).systems, phasers: 0 } };
  const html = schematicHtml(game, ship);
  assert.match(html, /data-console-key="system-phasers"[^>]*data-system-down="true"/);
  assert.match(html, /class="schematic-row down"/);
  assert.match(html, /schematic-down-mark">out</, 'a dead system says so in words, not only in colour');
});

test('an unobserved enemy hull reveals nothing, and says why', () => {
  const game = createGame({ seed: 'schematic-fog', reimagined: true });
  const target = enemy(game);
  assert.equal(schematicKnown(game, target), false, 'a distant unscanned enemy is not readable');

  const html = schematicHtml(game, target);
  assert.match(html, /data-known="false"/);
  assert.match(html, /Interior not observed/);
  assert.doesNotMatch(html, /data-console-key="arc-/, 'no arc is drawn for an unread hull');
  assert.doesNotMatch(html, /data-console-key="system-/, 'no system is drawn');
  assert.doesNotMatch(html, new RegExp(`${target.crew}/`), 'the crew count is not leaked');
  assert.doesNotMatch(html, /data-console-key="reactor"/, 'no reactor is drawn');

  // Scanning is the documented way to earn the readout.
  const scanned = { ...game, scanned: { ...game.scanned, [target.id]: true } };
  assert.equal(schematicKnown(scanned, target), true);
  assert.match(schematicHtml(scanned, target), /data-known="true"/);
});

test('hulls with no arcs or no reactor say so instead of drawing empty bars', () => {
  const reimagined = createGame({ seed: 'schematic-drone', reimagined: true });
  const friendly = own(reimagined).faction;
  const drone = { id: 'drone-x', name: 'Wing 1', className: 'Drone', faction: friendly, status: 'active', crew: 0, shields: 0, systems: { engines: 1 } };
  // The drone has to be a real hull in the field for the knowledge gate to treat
  // it as friendly; a detached object is not observable by construction.
  const droneGame = { ...reimagined, ships: [...reimagined.ships, drone] };
  const droneHtml = schematicHtml(droneGame, drone);
  assert.match(droneHtml, /data-console-key="arcs"/);
  assert.doesNotMatch(droneHtml, /data-console-key="arc-fore"/, 'a drone has no arc rows');
  assert.match(droneHtml, /A drone carries no directional shield arcs\./);

  const classic = createGame({ seed: 'schematic-classic' });
  const classicHtml = schematicHtml(classic, own(classic));
  assert.doesNotMatch(classicHtml, /data-console-key="arc-fore"/, 'Classic has a single shield pool');
  assert.match(classicHtml, /Classic hulls have a single shield pool/);
  assert.match(classicHtml, /no power to distribute/, 'Classic draws no sink bars');
  assert.doesNotMatch(classicHtml, /data-console-key="sink-/, 'and invents no reactor for a Classic hull');
  assert.match(classicHtml, /data-console-key="system-/, 'systems and crew still render under Classic rules');
});

test('every bar is labelled in words, so nothing is graphics-only', () => {
  const game = createGame({ seed: 'schematic-a11y', reimagined: true });
  const html = schematicHtml(game, own(game));
  const bars = html.match(/<span class="schematic-bar"[^>]*>/g) ?? [];
  assert.ok(bars.length > 0, 'the schematic draws bars');
  for (const bar of bars) {
    assert.match(bar, /role="img"/, 'each bar exposes itself as an image');
    // Two phrasings are legitimate: a capacity bar says "60 of 60", a reactor
    // sink says "4 allocated against 4 needed". Both state the numbers in words.
    assert.match(bar, /aria-label="[^"]*(\d+ of \d+|\d+ allocated against \d+ needed)/, 'each bar states its values in words');
  }
  const unitGroups = html.match(/<span class="schematic-units"[^>]*>/g) ?? [];
  assert.ok(unitGroups.length > 0, 'the schematic draws unit blocks');
  for (const group of unitGroups) {
    assert.match(group, /role="img"/);
    assert.match(group, /aria-label="[^"]+\d+ of \d+ units intact"/);
  }
  assert.match(html, /<section class="schematic"[^>]*aria-label="Interior readout for /, 'the panel itself is named');
  // The numeric text is present beside every bar, so the same fact survives
  // without the graphics at all.
  assert.ok((html.match(/class="schematic-value"/g) ?? []).length >= bars.length + unitGroups.length);
});

test('the schematic is a pure read: no mutation, no gameplay RNG, no invention', () => {
  const game = createGame({ seed: 'schematic-pure', reimagined: true });
  const ship = own(game);
  const before = JSON.stringify(game);
  const stepBefore = game.randomStep;

  const first = schematicHtml(game, ship);
  const second = schematicHtml(game, ship);

  assert.equal(first, second, 'the same state renders identically');
  assert.equal(JSON.stringify(game), before, 'rendering mutates nothing');
  assert.equal(game.randomStep, stepBefore, 'rendering consumes no gameplay RNG');
});

test('a hull name cannot break out of the markup', () => {
  const game = createGame({ seed: 'schematic-escape', reimagined: true });
  const ship = { ...own(game), name: '<img src=x onerror="alert(1)">' };
  const html = schematicHtml(game, ship);
  assert.doesNotMatch(html, /<img src=x/, 'the raw tag is escaped');
  assert.match(html, /&lt;img src=x/, 'and shown as text');
});

test('the reinforced arc is identified, matching the helm control', () => {
  const game = createGame({ seed: 'schematic-focus', reimagined: true });
  const ship = own(game);
  const focused = { ...game, arcFocus: { ...game.arcFocus, [ship.id]: 'port' } };
  const html = schematicHtml(focused, ship);
  assert.match(html, /data-console-key="arc-port"[^>]*data-arc-focused="true"/);
  assert.match(html, /reinforced: Port/, 'the legend names the reinforced arc in words');
});
