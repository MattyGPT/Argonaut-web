import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCS, FACTIONS, SCAR } from '../game/constants.js';
import {
  cleanScars, createGame, createShip, ensureScars, getShip, internalsOf, isScarred,
  scarShip, scarsOf, shieldCapacity,
} from '../game/state.js';
import { createRng } from '../game/rng.js';
import { damageShip, ionDamage } from '../game/actions.js';
import { resolveDocking } from '../game/turns.js';
import { buyDockyard, createCampaign, dockyardOffers, fleetRecordsFrom } from '../game/campaign.js';
import { stripBattleRecordMetadata } from '../game/battle-records.js';
import {
  ARC_ANCHOR, scarArcTally, scarBackground, scarCauseWord, scarDecals, scarNote, scarSummary, scarWear, scarWearClass,
} from '../ui/scarring.js';
import { schematicHtml } from '../ui/schematic.js';
import { renderGame } from '../ui/render.js';

// render.js only touches the document inside renderGame, so the same bare element
// stub test/render.test.js uses is enough to exercise it under node --test.
const elements = new Map();
globalThis.document = {
  querySelector: (selector) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '' });
    return elements.get(selector);
  },
};
const read = (selector) => ({ innerHTML: '', textContent: '', ...elements.get(selector) });

const ZERO_ARCS = Object.freeze({ fore: 0, starboard: 0, aft: 0, port: 0 });

/** A Reimagined hull whose shields are gone, so the next volley reaches the frame. */
const exposed = (ship) => ({ ...ship, shields: 0, ...(ship.arcs ? { arcs: { ...ZERO_ARCS } } : {}) });

const reimagined = (seed) => createGame({ seed, reimagined: true });
const own = (game) => getShip(game, game.playerShipId);

/** One mark, written the way the damage paths write it. */
const struck = (ship, { cause = 'phasers', arc = 'port', amount = 3, seed = 'roll' } = {}) => (
  damageShip(exposed(ship), amount, createRng(seed), { cause, arc })
);

// --- the authoritative field ---------------------------------------------------

test('a Reimagined hull is created carrying an empty scar list, and a classic hull never gains the key', () => {
  const modern = reimagined('scar-create');
  for (const ship of modern.ships) {
    assert.ok(Array.isArray(ship.scars), `${ship.id} carries a mark list`);
    assert.deepEqual(ship.scars, [], `and it starts clean — ${ship.id}`);
  }
  const classic = createGame({ seed: 'scar-create' });
  for (const ship of classic.ships) {
    assert.ok(!Object.hasOwn(ship, 'scars'), `a classic hull never gains the key — ${ship.id}`);
  }
  // A drone is Reimagined, so it carries scarring even though it has no arcs.
  const drone = createShip({ id: 'd', name: 'D', faction: FACTIONS.FEDERATION, kind: 'drone', x: 0, y: 0, reimagined: true });
  assert.deepEqual(drone.scars, [], 'a drone carries the list too');
  assert.equal(drone.arcs, undefined, 'but still has no arcs');
});

test('a volley the shields soak whole leaves the frame unmarked; one that reaches the internals marks it', () => {
  const ship = own(reimagined('scar-gate'));
  const soaked = damageShip(ship, 1, createRng('soak'), { cause: 'phasers', arc: 'fore' });
  assert.ok(soaked.shields < ship.shields, 'the pool took it');
  assert.equal(internalsOf(soaked), internalsOf(ship), 'and nothing inside was touched');
  assert.deepEqual(soaked.scars, [], 'so a shield hit is not a wound and earns no mark');

  const reached = struck(ship, { arc: 'fore' });
  assert.ok(internalsOf(reached) < internalsOf(ship), 'this one got through');
  assert.equal(reached.scars.length, 1, 'and it marked the frame');
  assert.deepEqual(reached.scars[0], { cause: 'phasers', arc: 'fore', weight: 1 });
});

test('a mark records the arc that was actually struck, not another one', () => {
  const ship = own(reimagined('scar-arc'));
  for (const arc of ARCS) {
    const hit = struck(ship, { arc, seed: `roll-${arc}` });
    assert.equal(hit.scars.length, 1, `${arc}: one mark`);
    assert.equal(hit.scars[0].arc, arc, `${arc}: the mark names the arc the volley came in on`);
  }
});

test('an unaimed strike records no arc, because claiming one would be a lie about the geometry', () => {
  const ship = own(reimagined('scar-unaimed'));
  // Splash on a secondary hull, a ram, shrapnel: positional damage with no arc.
  const hit = struck(ship, { arc: null, cause: 'collision' });
  assert.equal(hit.scars.length, 1);
  assert.ok(!Object.hasOwn(hit.scars[0], 'arc'), 'the mark carries no arc key at all');
  assert.equal(hit.scars[0].cause, 'collision');

  // An ion burst sidesteps facing entirely, so it is unaimed by construction.
  const burned = ionDamage(exposed(ship), 3, createRng('ion'));
  assert.equal(burned.scars.length, 1, 'an ion burst that reached the hardware leaves a burn');
  assert.equal(burned.scars[0].cause, 'ion');
  assert.ok(!Object.hasOwn(burned.scars[0], 'arc'), 'and it is not attributed to a flank');
});

test('marks coalesce by cause and arc, deepening rather than accumulating one node per volley', () => {
  let ship = own(reimagined('scar-coalesce'));
  for (let index = 0; index < 4; index += 1) ship = struck(ship, { cause: 'phasers', arc: 'port', amount: 1, seed: `r${index}` });
  assert.equal(ship.scars.length, 1, 'four phaser hits on the port quarter are ONE mark');
  assert.equal(ship.scars[0].weight, 4, 'four strikes deep');

  ship = struck(ship, { cause: 'photons', arc: 'port', amount: 1, seed: 'p1' });
  assert.equal(ship.scars.length, 2, 'a different weapon on the same flank is its own mark');
  ship = struck(ship, { cause: 'phasers', arc: 'aft', amount: 1, seed: 'a1' });
  assert.equal(ship.scars.length, 3, 'and so is the same weapon on a different flank');
  assert.deepEqual(ship.scars.map((mark) => `${mark.cause}:${mark.arc}:${mark.weight}`),
    ['phasers:port:4', 'photons:port:1', 'phasers:aft:1'], 'in the order the frame acquired them');
});

test('weight and the mark list are both bounded, and a saturated hull is returned unchanged', () => {
  let ship = own(reimagined('scar-caps'));
  for (let index = 0; index < SCAR.maxWeight + 6; index += 1) {
    ship = struck(ship, { cause: 'phasers', arc: 'port', amount: 1, seed: `w${index}` });
  }
  assert.equal(ship.scars[0].weight, SCAR.maxWeight, 'a mark stops deepening at the cap');

  const saturated = { ...ship, scars: Array.from({ length: SCAR.maxMarks }, (_, index) => ({ cause: `c${index}`, arc: 'fore', weight: 1 })) };
  const before = JSON.stringify(saturated.scars);
  const after = struck(saturated, { cause: 'brand-new', arc: 'aft', amount: 1 });
  assert.equal(JSON.stringify(after.scars), before, 'a full frame drops a genuinely new kind rather than evicting an older one');
  assert.equal(after.scars.length, SCAR.maxMarks);
});

test('scarring consumes no gameplay randomness and cannot move the damage lottery', () => {
  // The strongest cheap proof that recording is inert: two identically seeded
  // generators, one hull carrying a mark list and one carrying none. If scarring
  // drew even once, the internals would come out different.
  const modern = own(reimagined('scar-rng'));
  const bare = { ...modern };
  delete bare.scars;
  const withScars = damageShip(exposed(modern), 5, createRng('same'), { cause: 'phasers', arc: 'starboard' });
  const without = damageShip(exposed(bare), 5, createRng('same'), { cause: 'phasers', arc: 'starboard' });
  const { scars, ...withScarsRest } = withScars;
  assert.deepEqual(withScarsRest, without, 'the wound is identical whether or not the frame records it');
  assert.ok(scars.length >= 1, 'and the recording still happened');
  assert.ok(!Object.hasOwn(without, 'scars'), 'a hull with no list never gains one on the way through');
});

test('a classic hull comes back byte-identical from every damage path', () => {
  const classic = createGame({ seed: 'scar-classic' });
  const ship = getShip(classic, 'fed-flagship');
  for (const [cause, arc] of [['phasers', 'fore'], ['photons', null], ['collision', null], ['shrapnel', null]]) {
    const hit = damageShip(exposed(ship), 4, createRng(`c-${cause}`), { cause, arc });
    assert.ok(!Object.hasOwn(hit, 'scars'), `${cause}: no key appears on a classic hull`);
    assert.ok(internalsOf(hit) < internalsOf(ship), `${cause}: and the damage still lands`);
  }
  const burn = ionDamage(exposed(ship), 3, createRng('c-ion'));
  assert.ok(!Object.hasOwn(burn, 'scars'), 'ion leaves a classic hull byte-identical in shape too');
});

test('scarShip is pure: it never mutates the hull or the mark list it was handed', () => {
  const ship = own(reimagined('scar-pure'));
  const frozenMarks = ship.scars;
  const hit = struck(ship, { arc: 'aft' });
  assert.deepEqual(ship.scars, [], 'the original hull is untouched');
  assert.equal(frozenMarks.length, 0, 'and its mark list was not appended to in place');
  assert.notEqual(hit.scars, frozenMarks, 'the new hull carries a new array');
  assert.equal(scarShip(null, ship, {}), null, 'a missing hull is tolerated');
  assert.equal(scarShip(hit, null, {}), hit, 'so is a missing before-snapshot');
});

test('scarsOf clamps a corrupt or hand-edited mark list instead of trusting it', () => {
  assert.deepEqual(scarsOf(undefined), []);
  assert.deepEqual(scarsOf({}), [], 'a hull with no list at all reads as clean');
  assert.deepEqual(scarsOf({ scars: 'port' }), [], 'a non-array reads as clean');
  assert.deepEqual(scarsOf({ scars: [null, 7, 'x', {}, { cause: 42 }] }), [], 'junk entries are dropped');
  const clamped = scarsOf({
    scars: [
      { cause: 'phasers', arc: 'port', weight: 999 },
      { cause: 'photons', arc: 'somewhere', weight: 0 },
      { cause: 'ion', weight: -3 },
      { cause: 'collision', arc: 'fore', weight: 2.4 },
    ],
  });
  assert.deepEqual(clamped, [
    { cause: 'phasers', arc: 'port', weight: SCAR.maxWeight },
    { cause: 'photons', weight: 1 },
    { cause: 'ion', weight: 1 },
    { cause: 'collision', arc: 'fore', weight: 2 },
  ], 'weight is clamped and rounded, and an arc that is not an arc is dropped');
  const overflow = scarsOf({ scars: Array.from({ length: SCAR.maxMarks + 40 }, (_, index) => ({ cause: `c${index}`, weight: 1 })) });
  assert.equal(overflow.length, SCAR.maxMarks, 'an over-long list is cut to the bound a reader may assume');
  assert.equal(isScarred({ scars: [] }), false);
  assert.equal(isScarred({}), false);
});

test('cleanScars removes the oldest marks first and is a no-op on a clean frame', () => {
  const ship = { id: 'h', scars: [{ cause: 'phasers', arc: 'port', weight: 2 }, { cause: 'photons', arc: 'aft', weight: 1 }, { cause: 'ion', weight: 3 }] };
  assert.deepEqual(cleanScars(ship).scars, ship.scars.slice(1), 'one mark a stardate, oldest first');
  assert.deepEqual(cleanScars(ship, 2).scars, ship.scars.slice(2));
  assert.deepEqual(cleanScars(ship, 99).scars, [], 'and it stops at empty rather than going negative');
  assert.equal(cleanScars(ship, 0), ship, 'zero removes nothing and returns the same object');
  assert.deepEqual(cleanScars({ id: 'h' }).scars, undefined, 'a hull with no list is returned as it came');
  assert.deepEqual(cleanScars({ id: 'h', scars: [] }), { id: 'h', scars: [] }, 'so is a clean one');
});

test('ensureScars adopts an empty list for a restored war and never invents history', () => {
  const legacy = reimagined('scar-legacy');
  const stripped = { ...legacy, ships: legacy.ships.map(({ scars, ...rest }) => rest) };
  assert.ok(stripped.ships.every((ship) => !Object.hasOwn(ship, 'scars')), 'a pre-scarring save has no key');
  const adopted = ensureScars(stripped);
  assert.ok(adopted.ships.every((ship) => Array.isArray(ship.scars) && ship.scars.length === 0),
    'every hull gains an EMPTY list — nothing is claimed about what it already survived');
  assert.equal(ensureScars(adopted), adopted, 'and it is idempotent, returning the same object');
  const classic = createGame({ seed: 'scar-legacy' });
  assert.equal(ensureScars(classic), classic, 'a classic war is left alone');
  assert.equal(ensureScars(null), null, 'a missing game is tolerated');
});

// --- the dockyard is the only thing that removes a mark -------------------------

test('the starbase yard works one mark out per stardate while it has the hull open', () => {
  const base = reimagined('scar-yard');
  const marked = { ...own(base), x: 54, y: 50, shields: 10, crew: 30, scars: [
    { cause: 'phasers', arc: 'port', weight: 3 },
    { cause: 'photons', arc: 'aft', weight: 1 },
    { cause: 'ion', weight: 2 },
  ] };
  // Park the yard where the fixture expects it, as test/game.test.js's fleetWar does.
  const staged = { ...base, ships: base.ships.map((ship) => {
    if (ship.id === marked.id) return marked;
    return ship.id === 'xanadu' ? { ...ship, x: 50, y: 50 } : ship;
  }) };
  assert.ok(getShip(staged, 'xanadu'), 'the yard is on the field for this seed');

  const { game: after, messages } = resolveDocking(staged);
  const tended = getShip(after, marked.id);
  assert.ok(tended.shields > marked.shields, 'the yard really is repairing this hull');
  assert.deepEqual(tended.scars, marked.scars.slice(1), 'and it takes the oldest mark with it');
  assert.ok(messages.some((line) => /docks at Xanadu: shields \+\d+/.test(line)), 'the repair is still announced');
  assert.ok(!messages.some((line) => /scarr/i.test(line)),
    'but the frame work adds no line of its own — the decals show it and the readout says it');

  const { game: next } = resolveDocking(after);
  assert.deepEqual(getShip(next, marked.id).scars, marked.scars.slice(2), 'one mark a stardate, not all at once');
});

test('a hull the yard has nothing to repair keeps every mark it came in with', () => {
  const base = reimagined('scar-yard-idle');
  const pristine = { ...own(base), x: 54, y: 50, scars: [{ cause: 'phasers', arc: 'port', weight: 1 }] };
  const staged = { ...base, ships: base.ships.map((ship) => (ship.id === pristine.id ? pristine : ship)) };
  assert.equal(pristine.shields, shieldCapacity(pristine), 'this hull is at full shields');
  const { game: after } = resolveDocking(staged);
  assert.deepEqual(getShip(after, pristine.id).scars, pristine.scars,
    'scarring survives a top-up: only the yard doing actual work takes it off');
});

test('a campaign overhaul refinishes the frame, and no other purchase does', () => {
  const build = (kind) => {
    const campaign = createCampaign({ seed: 'scar-overhaul' });
    const record = campaign.fleet[0];
    const hurt = { ...record, shields: 12, crew: 9, systems: { ...record.systems, engines: 1 },
      scars: [{ cause: 'phasers', arc: 'port', weight: 4 }, { cause: 'photons', arc: 'aft', weight: 2 }] };
    const funded = { ...campaign, fleet: campaign.fleet.map((entry) => (entry.id === record.id ? hurt : entry)), credits: 999 };
    const offer = dockyardOffers(funded).find((entry) => entry.recordId === record.id && entry.kind === kind);
    return offer ? { record: buyDockyard(funded, offer.id).fleet.find((entry) => entry.id === record.id), offer } : { record: null, offer: null };
  };

  const overhaul = build('systems');
  assert.ok(overhaul.offer, 'an overhaul is on offer for a hull with burnt units');
  assert.ok(!Object.hasOwn(overhaul.record, 'scars'), 'the frame comes out of an overhaul clean');
  assert.ok(overhaul.record.systems.engines > 1, 'and the rebuild it was bought for still happened');

  for (const kind of ['shields', 'crew']) {
    const bought = build(kind);
    if (!bought.offer) continue;
    assert.equal(bought.record.scars.length, 2, `${kind}: a top-up leaves the scarring alone`);
  }
});

// --- campaign carry-over --------------------------------------------------------

test('battle scarring carries out of a war and back into the next one', () => {
  const game = reimagined('scar-carry');
  const hull = { ...own(game), shotsTaken: 9, scars: [
    { cause: 'phasers', arc: 'port', weight: 5 },
    { cause: 'collision', weight: 1 },
  ] };
  const flown = { ...game, ships: game.ships.map((ship) => (ship.id === hull.id ? hull : ship)) };
  const records = fleetRecordsFrom(flown);
  const carried = records.find((record) => record.id === hull.id);
  assert.deepEqual(carried.scars, hull.scars, 'the record carries every mark');
  assert.notEqual(carried.scars, hull.scars, 'as a copy, so the two fleets never share one array');
  assert.notEqual(carried.scars[0], hull.scars[0], 'mark by mark, not by reference');

  const next = createGame({
    seed: 'scar-carry:battle:next',
    reimagined: true,
    loadout: { factions: [FACTIONS.FEDERATION, FACTIONS.AXIS], budgets: { [FACTIONS.AXIS]: 10 }, veterans: records, xanadu: false },
  });
  const reflown = next.ships.find((ship) => ship.id === hull.id);
  assert.deepEqual(reflown.scars, hull.scars, 'and it fields the next battle wearing the same burns');
});

test('a record from an older campaign save fields a clean hull rather than a broken one', () => {
  const campaign = createCampaign({ seed: 'scar-legacy-carry' });
  const legacy = campaign.fleet.map(({ scars, ...record }) => record);
  assert.ok(legacy.every((record) => !Object.hasOwn(record, 'scars')));
  const next = createGame({
    seed: 'scar-legacy-carry:battle:1',
    reimagined: true,
    loadout: { factions: [FACTIONS.FEDERATION, FACTIONS.AXIS], budgets: { [FACTIONS.AXIS]: 10 }, veterans: legacy, xanadu: false },
  });
  assert.ok(next.ships.every((ship) => Array.isArray(ship.scars)), 'every carried hull still has a list');
  const corrupt = [{ ...legacy[0], scars: 'port' }];
  const hostile = createGame({
    seed: 'scar-legacy-carry:battle:2',
    reimagined: true,
    loadout: { factions: [FACTIONS.FEDERATION, FACTIONS.AXIS], budgets: { [FACTIONS.AXIS]: 10 }, veterans: corrupt, xanadu: false },
  });
  assert.deepEqual(hostile.ships.find((ship) => ship.id === corrupt[0].id).scars, [],
    'a malformed carried list is clamped to clean rather than trusted');
});

test('scarring is not stripped by the parity projection, so a recorded war and a plain one must agree on it', () => {
  const marks = [{ cause: 'phasers', arc: 'port', weight: 2 }];
  const ship = { id: 'h', shields: 10, scars: marks };
  const kept = stripBattleRecordMetadata({ ships: [ship], battleRecordState: { battleId: 'b' } });
  assert.deepEqual(kept.ships[0].scars, marks, 'the marks survive the projection');
  assert.equal(kept.battleRecordState, undefined, 'while the record metadata does not');
});

// --- the projection: geometry, determinism, honesty ------------------------------

test('the arc anchors put the bow right, the stern left, port up and starboard down', () => {
  // Load-bearing. The sprite assets bow right and the renderer rotates them by
  // ship.facing through CSS, which is clockwise in a y-down field — the same
  // convention bearingDeg measures in and the same order struckArc walks. Reverse
  // any of these and every hull in the fleet is quietly accused on the wrong flank.
  assert.ok(ARC_ANCHOR.fore.x > 0.5 && ARC_ANCHOR.fore.y === 0.5, 'fore is the right edge, amidships');
  assert.ok(ARC_ANCHOR.aft.x < 0.5 && ARC_ANCHOR.aft.y === 0.5, 'aft is the left edge, amidships');
  assert.ok(ARC_ANCHOR.port.y < 0.5 && ARC_ANCHOR.port.x === 0.5, 'port is the top, because the field y axis runs downward');
  assert.ok(ARC_ANCHOR.starboard.y > 0.5 && ARC_ANCHOR.starboard.x === 0.5, 'starboard is the bottom');
  assert.deepEqual(Object.keys(ARC_ANCHOR).sort(), [...ARCS].sort(), 'exactly the four arcs the rules define');
});

test('one decal per mark, on its own arc, growing with the depth of the burn', () => {
  const hull = { id: 'fed-flagship', scars: [{ cause: 'phasers', arc: 'port', weight: 1 }] };
  const [light] = scarDecals(hull);
  assert.ok(Math.abs(light.y - ARC_ANCHOR.port.y) <= 0.18, 'a port mark sits toward the top of the art');
  assert.ok(Math.abs(light.x - ARC_ANCHOR.port.x) <= 0.18, 'and amidships, within the jitter');
  assert.equal(light.weight, 1);

  const deep = scarDecals({ id: 'fed-flagship', scars: [{ cause: 'phasers', arc: 'port', weight: SCAR.maxWeight }] })[0];
  assert.ok(deep.radiusX > light.radiusX * 1.5, `a burned-out flank spreads wider than a single hit (${deep.radiusX} vs ${light.radiusX})`);
  assert.ok(deep.radiusX <= 0.14, 'and still stops short of swallowing the whole hull');

  const four = scarDecals({ id: 'h', scars: ARCS.map((arc) => ({ cause: 'phasers', arc, weight: 1 })) });
  assert.equal(four.length, 4, 'four arcs, four decals');
  // Each decal must sit nearer its own flank's anchor than any other's, which is
  // the property that actually matters: a rounding bucket would pass on a mark
  // that drifted halfway across the hull.
  for (const decal of four) {
    const distanceTo = (anchor) => Math.hypot(decal.x - anchor.x, decal.y - anchor.y);
    const own = ARC_ANCHOR[decal.arc];
    for (const other of ARCS.filter((arc) => arc !== decal.arc)) {
      assert.ok(distanceTo(own) < distanceTo(ARC_ANCHOR[other]),
        `${decal.arc} is nearer its own anchor than ${other}'s`);
    }
  }
});

test('decal placement is a pure function of recorded state — no RNG, no drift between renders', () => {
  const hull = { id: 'fed-cruiser-1', shotsTaken: 11, scars: [
    { cause: 'phasers', arc: 'port', weight: 5 },
    { cause: 'photons', arc: 'aft', weight: 2 },
    { cause: 'ion', weight: 3 },
    { cause: 'collision', arc: 'starboard', weight: 1 },
  ] };
  const first = scarDecals(hull);
  assert.deepEqual(scarDecals(hull), first, 'the same hull projects identically every time');
  assert.deepEqual(scarDecals({ ...hull }), first, 'and a copy of it does too');
  assert.notDeepEqual(scarDecals({ ...hull, id: 'fed-cruiser-2' }), first,
    'a different hull gets different jitter, so a fleet does not wear one stamped pattern');
  assert.equal(scarBackground(hull).split('radial-gradient(').length - 1, 4,
    'one background layer per mark, on a single overlay span');
  // Regression guard for the bug this test suite caught by reading the emitted
  // string: a double percent-conversion put every decal at 6500% of the art box,
  // i.e. nowhere. Every number in the value must be a sane percentage.
  for (const value of scarBackground(hull).match(/[\d.]+%/g).map((text) => Number(text.slice(0, -1)))) {
    assert.ok(value >= 0 && value <= 100, `every percentage in the decal string sits inside the art box (saw ${value}%)`);
  }
  assert.ok(scarDecals(hull).find((decal) => decal.cause === 'ion').glow,
    'an ion decal is flagged, so the projection knows which paint it wanted');

  const game = reimagined('scar-no-rng');
  const step = game.randomStep;
  const snapshot = JSON.stringify(game);
  for (const ship of game.ships) {
    scarDecals({ ...ship, scars: [{ cause: 'phasers', arc: 'port', weight: 3 }] });
    scarBackground(ship);
    scarSummary(ship);
    scarArcTally(ship);
    scarNote(ship);
  }
  assert.equal(game.randomStep, step, 'the projection consumed no authoritative randomness');
  assert.equal(JSON.stringify(game), snapshot, 'and changed no authoritative state');
});

test('a clean hull projects nothing at all', () => {
  for (const hull of [{ id: 'h', scars: [] }, { id: 'h' }, { id: 'h', scars: [] }, null, undefined]) {
    assert.deepEqual(scarDecals(hull), []);
    assert.equal(scarBackground(hull), '', 'no empty background string reaches the stylesheet');
    assert.equal(scarSummary(hull), null, 'and a clean frame earns no line anywhere');
    assert.equal(scarNote(hull), '');
  }
});

test('the tally groups unaimed damage as its own category and sorts by depth, not by mark count', () => {
  const hull = { id: 'h', scars: [
    { cause: 'phasers', arc: 'port', weight: 9 },
    { cause: 'photons', arc: 'port', weight: 2 },
    { cause: 'phasers', arc: 'aft', weight: 1 },
    { cause: 'ion', weight: 4 },
  ] };
  const tally = scarArcTally(hull);
  assert.deepEqual(tally.map((entry) => entry.arc), ['port', null, 'aft'], 'heaviest flank first, unaimed in its place');
  assert.equal(tally[0].weight, 11, 'port sums BOTH kinds — one deep burn outranks three light ones');
  assert.deepEqual(tally[0].kinds, [{ cause: 'phasers', weight: 9 }, { cause: 'photons', weight: 2 }], 'deepest kind first');
  assert.equal(tally[1].arc, null, 'ion is unaimed and stays that way');
});

test('the summary states only what the marks record and never claims to be the whole history', () => {
  const hull = { id: 'h', shotsTaken: 36, scars: [
    { cause: 'phasers', arc: 'port', weight: 9 },
    { cause: 'photons', arc: 'aft', weight: 1 },
  ] };
  const line = scarSummary(hull);
  assert.match(line, /^Battle scarring — 2 marks on the frame \(phaser burns and warhead strikes\), worst on the port quarter\.$/);
  assert.ok(!/absorbed|in all|shotsTaken/.test(line),
    'it counts MARKS, never strikes: shotsTaken is a rule input and a campaign does not carry it, so quoting it would print "3 marks; 0 strikes absorbed" on any veteran hull');
  assert.ok(!/never|all of|every|complete/.test(line), 'and makes no claim of exhaustiveness');

  const many = scarSummary({ id: 'h', shotsTaken: 9, scars: [
    { cause: 'phasers', arc: 'port', weight: 1 }, { cause: 'photons', arc: 'aft', weight: 1 }, { cause: 'ion', weight: 1 },
  ] });
  assert.match(many, /\(phaser burns, warhead strikes, and more\)/, 'a third kind is summarised rather than listed');

  const one = scarSummary({ id: 'h', shotsTaken: 1, scars: [{ cause: 'collision', weight: 1 }] });
  assert.match(one, /^Battle scarring — 1 mark on the frame \(collision gouges\)\.$/,
    'an unaimed mark names no flank rather than guessing one, and the count reads as singular');
  assert.ok(!/worst on the/.test(one), 'no worst flank is claimed when nothing was aimed');

  assert.equal(scarCauseWord('phasers'), 'phaser burns');
  assert.equal(scarCauseWord('weird-cause'), 'weird-cause marks', 'an unknown cause falls back to the recorded word, never an invented one');
});

test('the map clause is one word, so a fleet can be tabbed through without a recital', () => {
  assert.equal(scarNote({ id: 'h', scars: [{ cause: 'phasers', arc: 'port', weight: 9 }] }), ' — battle-scarred');
  assert.equal(scarNote({ id: 'h', scars: [] }), '');
});

// --- the renderer ---------------------------------------------------------------

const scarredWar = (seed) => {
  const game = reimagined(seed);
  const hull = { ...own(game), scars: [
    { cause: 'phasers', arc: 'port', weight: 6 },
    { cause: 'photons', arc: 'aft', weight: 2 },
  ] };
  return { ...game, ships: game.ships.map((ship) => (ship.id === hull.id ? hull : ship)) };
};

test('a scarred hull wears exactly one masked decal overlay under sprite art', () => {
  elements.clear();
  const game = scarredWar('scar-render');
  renderGame(game, { shipArt: 'sprites', contextShipId: game.playerShipId });
  const field = read('#map-field').innerHTML;
  const overlays = field.match(/class="scarring"/g) ?? [];
  assert.equal(overlays.length, 1, 'one overlay span on the one scarred hull, not one per mark');
  assert.match(field, /class="scarring" aria-hidden="true" style="--hull-art:url\(assets\/sprites\/federation\/[^)]+\.png\);background-image:radial-gradient\(/,
    'the overlay carries the mask and the decals, and is hidden from assistive tech');
  const layers = (field.match(/radial-gradient\(/g) ?? []).length;
  assert.equal(layers, 2, 'both marks are painted as stacked layers on that one span');
  assert.match(field, /aria-label="[^"]* — battle-scarred/, 'the accessible name says so in words');
  assert.match(field, /title="[^"]* — battle-scarred/, 'and so does the tooltip');
});

test('the decals need sprite art, but the words do not — and a classic war has neither', () => {
  // Letters art has no hull to paint on, so no overlay is emitted. The FACT is not
  // an art setting, though: a Reimagined hull carries its marks either way, so the
  // accessible name still says so. Withholding the words because the pictures were
  // turned off would hide a real fact from the one surface that never depended on
  // the setting. A classic war is different in kind — its hulls have no mark list
  // at all, so there is nothing to paint and nothing to say.
  for (const [label, game, view, expectWords] of [
    ['clean hull', reimagined('scar-render-clean'), { shipArt: 'sprites' }, false],
    ['letters art', scarredWar('scar-render-letters'), { shipArt: 'letters' }, true],
    ['classic war', createGame({ seed: 'scar-render-classic' }), { shipArt: 'sprites' }, false],
  ]) {
    elements.clear();
    renderGame(game, view);
    const field = read('#map-field').innerHTML;
    assert.ok(!field.includes('class="scarring"'), `${label}: no decal overlay`);
    assert.ok(!field.includes('--hull-art'), `${label}: and no mask variable`);
    assert.equal(field.includes('battle-scarred'), expectWords,
      `${label}: the accessible name ${expectWords ? 'still carries' : 'makes no'} the claim`);
  }
});

test('a hostile cause name from a tampered save reaches the page as inert text', () => {
  const hostile = { id: 'fed-flagship', name: 'Bonhomme', className: 'Battle Cruiser', faction: FACTIONS.FEDERATION,
    status: 'active', shotsTaken: 1, scars: [{ cause: '<img src=x onerror=alert(1)>', arc: 'port', weight: 1 }] };
  const game = { ...reimagined('scar-escape'), ships: reimagined('scar-escape').ships.map((ship) => (ship.id === hostile.id ? { ...ship, ...hostile } : ship)) };
  const html = schematicHtml(game, getShip(game, 'fed-flagship'));
  assert.ok(!html.includes('<img src=x'), 'the raw tag never reaches the markup');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; marks/, 'it arrives escaped, as words');
  assert.ok(!/<script/i.test(html));
});

test('a hull whose frame has taken enough to matter dulls at a glance, in two steps', () => {
  assert.equal(scarWear({ id: 'h', scars: [] }), 0);
  assert.equal(scarWear({ id: 'h', scars: [{ cause: 'phasers', arc: 'port', weight: 4 }, { cause: 'ion', weight: 3 }] }), 7);
  assert.equal(scarWearClass({ id: 'h', scars: [{ cause: 'phasers', arc: 'port', weight: 9 }] }), '',
    'a scratch is not a reputation: one bad hit does not dull the hull');
  // A single mark caps at SCAR.maxWeight, so crossing the threshold takes more
  // than one kind of fire — which is the point: the dulling is a career, not a hit.
  assert.equal(scarWearClass({ id: 'h', scars: [{ cause: 'phasers', arc: 'port', weight: 9 }, { cause: 'ion', weight: 1 }] }), ' battle-worn');
  assert.equal(scarWearClass({ id: 'h', scars: [{ cause: 'phasers', arc: 'port', weight: 9 }, { cause: 'photons', arc: 'aft', weight: 9 }, { cause: 'ion', weight: 4 }] }), ' battle-worn-heavy');
  assert.equal(scarWearClass({ id: 'h' }), '', 'and a hull with no list at all is untouched');

  elements.clear();
  const game = reimagined('scar-worn');
  const hull = { ...own(game), scars: [{ cause: 'phasers', arc: 'port', weight: 9 }, { cause: 'photons', arc: 'aft', weight: 9 }, { cause: 'ion', weight: 6 }] };
  renderGame({ ...game, ships: game.ships.map((ship) => (ship.id === hull.id ? hull : ship)) }, { shipArt: 'sprites' });
  const field = read('#map-field').innerHTML;
  const buttonClass = /<button class="([^"]*)"[^>]*data-ship-id="fed-flagship"/.exec(field)?.[1] ?? '';
  assert.match(buttonClass, /(^| )battle-worn-heavy( |$)/, 'the beaten hull wears the heavy step on the map');
  const sisterClass = /<button class="([^"]*)"[^>]*data-ship-id="fed-interceptor"/.exec(field)?.[1] ?? '';
  assert.ok(!/battle-worn/.test(sisterClass), 'while an unmarked sister stays bright beside it');
});

test('the Interior panel is the word equivalent of the decals, flank by flank', () => {
  const game = scarredWar('scar-schematic');
  const html = schematicHtml(game, own(game));
  assert.match(html, /data-console-key="frame"/, 'the Frame section is drawn');
  assert.match(html, /data-scar-marks="2"/, 'and says how many marks the frame carries');
  assert.match(html, /data-console-key="frame-port"/, 'one row per flank that was reached');
  assert.match(html, /data-console-key="frame-aft"/);
  assert.match(html, />Port<\/span>/, 'named in words');
  assert.match(html, /phaser burns ×6/, 'with the kind of fire and how deep');
  assert.match(html, /Battle scarring — 2 marks on the frame/, 'and the whole sentence in the legend');
  assert.ok(html.indexOf('data-console-key="frame-port"') < html.indexOf('data-console-key="frame-aft"'),
    'heaviest flank first, matching the tally');

  const clean = schematicHtml(reimagined('scar-schematic-clean'), own(reimagined('scar-schematic-clean')));
  assert.match(clean, /data-console-key="frame-clean"/, 'a clean frame says so');
  assert.match(clean, /No battle scarring on the frame\./);
  assert.ok(!/never been hit|unharmed|pristine/.test(clean), 'and claims nothing beyond the absence of marks');

  const classic = createGame({ seed: 'scar-schematic-classic' });
  const classicHtml = schematicHtml(classic, own(classic));
  assert.ok(!classicHtml.includes('data-console-key="frame"'),
    'a Classic hull gets no Frame section at all: it has no mark record, and "no scarring" would imply one that is empty');

  const unaimed = schematicHtml(
    { ...game, ships: game.ships.map((ship) => (ship.id === own(game).id ? { ...ship, scars: [{ cause: 'ion', weight: 3 }] } : ship)) },
    { ...own(game), scars: [{ cause: 'ion', weight: 3 }] },
  );
  assert.match(unaimed, /data-console-key="frame-unaimed"/, 'unaimed damage gets its own row');
  assert.match(unaimed, />Unaimed<\/span>/, 'rather than being dropped or attributed to a flank');
});

test('an unobserved hull gets no scarring readout either', () => {
  const game = reimagined('scar-unknown');
  const foe = game.ships.find((ship) => ship.faction !== own(game).faction);
  const scarred = { ...foe, scars: [{ cause: 'phasers', arc: 'port', weight: 4 }] };
  const staged = { ...game, ships: game.ships.map((ship) => (ship.id === foe.id ? scarred : ship)) };
  const html = schematicHtml(staged, scarred);
  assert.match(html, /data-known="false"/, 'the interior gate still applies');
  assert.ok(!html.includes('data-console-key="frame-port"'), 'so the frame is not read out through it');
  assert.ok(!html.includes('phaser burns'), 'and no mark is described that the sensors could not resolve');
});
