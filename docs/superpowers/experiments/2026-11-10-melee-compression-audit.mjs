// Read-only melee-compression audit. Run from the repository root:
//   node docs/superpowers/experiments/2026-11-10-melee-compression-audit.mjs [--seeds N]
// Plays headless Reimagined wars on the committed harness (player hull on the
// same autopilot, no orders — the CALIBRATION methodology) and samples the
// field once per stardate, after every captain has acted, to measure the
// SHAPE of the fight rather than its outcome: when opposing hulls first come
// within phaser reach, how many separate engagements exist, what share of the
// afloat combatants sit in one connected knot, how tightly allies pack, and
// whether the knot moves. No game files are changed and no RNG stream shifts.
import { runWar } from '../../../scripts/sim-wars.mjs';
import { distance } from '../../../game/state.js';
import { RANGES } from '../../../game/constants.js';

const seeds = Number(process.argv[process.argv.indexOf('--seeds') + 1] ?? 100);
const LINK = RANGES.phasers; // two hulls within phaser reach are "in one fight"
const MELEE_SHARE = 0.7; // one component holding this share of combatants = one big melee

const combatantsOf = (game) => game.ships.filter((ship) => ship.status === 'active' && ship.faction !== 'Neutral');

/** Connected components of hulls linked by phaser-reach proximity. */
const components = (hulls) => {
  const seen = new Set();
  const groups = [];
  for (const start of hulls) {
    if (seen.has(start.id)) continue;
    const group = [start];
    seen.add(start.id);
    for (let head = 0; head < group.length; head += 1) {
      for (const other of hulls) {
        if (seen.has(other.id) || distance(group[head], other) > LINK) continue;
        seen.add(other.id);
        group.push(other);
      }
    }
    groups.push(group);
  }
  return groups;
};

const centroid = (hulls) => ({
  x: hulls.reduce((total, ship) => total + ship.x, 0) / hulls.length,
  y: hulls.reduce((total, ship) => total + ship.y, 0) / hulls.length,
});

const spread = (hulls) => {
  const center = centroid(hulls);
  return Math.max(...hulls.map((ship) => distance(center, ship)));
};

/** Mean nearest-ally distance: how tightly each faction's wing packs. */
const packing = (hulls) => {
  const gaps = [];
  for (const faction of new Set(hulls.map((ship) => ship.faction))) {
    const wing = hulls.filter((ship) => ship.faction === faction);
    for (const ship of wing) {
      const nearest = Math.min(...wing.filter((other) => other.id !== ship.id).map((other) => distance(ship, other)), Infinity);
      if (Number.isFinite(nearest)) gaps.push(nearest);
    }
  }
  return gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
};

const sample = (game) => {
  const hulls = combatantsOf(game);
  if (hulls.length < 2) return null;
  const groups = components(hulls).filter((group) => group.length > 1);
  const fights = groups.filter((group) => new Set(group.map((ship) => ship.faction)).size > 1);
  const largest = groups.sort((a, b) => b.length - a.length)[0] ?? [];
  const bySize = fights
    .map((group) => ({ size: group.length, center: centroid(group) }))
    .sort((a, b) => b.size - a.size);
  return {
    turn: game.turn,
    hulls: hulls.length,
    fights: fights.length,
    share: largest.length ? largest.length / hulls.length : 0,
    melee: fights.length === 1 && largest.length / hulls.length >= MELEE_SHARE,
    knotRadius: largest.length ? Number(spread(largest).toFixed(1)) : null,
    fieldRadius: Number(spread(hulls).toFixed(1)),
    packing: packing(hulls),
    center: centroid(hulls),
    // Slice-1 shape metrics: whether more than one fight runs at once, and how
    // far apart the two biggest simultaneous fights stand — battles at named,
    // separate places rather than one knot.
    fights2: fights.length >= 2,
    fightSpread: bySize.length >= 2 ? Number(distance(bySize[0].center, bySize[1].center).toFixed(1)) : null,
  };
};

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0;

const wars = [];
for (let index = 0; index < seeds; index += 1) {
  const frames = [];
  let heldPrev = null;
  let transitions = 0;
  let flips = 0;
  let strats = null;
  runWar(index, {
    mode: 'reimagined',
    onState: (game) => {
      const held = game.held ?? {};
      if (heldPrev) {
        for (const [id, faction] of Object.entries(held)) {
          if (heldPrev[id] !== faction) {
            transitions += 1;
            if (heldPrev[id] && heldPrev[id] !== faction) flips += 1;
          }
        }
        for (const id of Object.keys(heldPrev)) if (!(id in held)) transitions += 1;
      }
      heldPrev = held;
      strats = strats ?? game.strategies;
      if (frames.length && frames[frames.length - 1].turn === game.turn) return;
      const frame = sample(game);
      if (frame) frames.push(frame);
    },
  });
  const contact = frames.findIndex((frame) => frame.fights > 0);
  if (contact < 0) continue;
  const engaged = frames.slice(contact);
  const meleeFrames = engaged.filter((frame) => frame.melee);
  const drift = meleeFrames.slice(1).map((frame, i) => distance(frame.center, meleeFrames[i].center));
  wars.push({
    turns: frames[frames.length - 1].turn,
    firstContact: frames[contact].turn,
    contactShare: engaged.length / frames.length,
    meleeShareOfContact: meleeFrames.length / engaged.length,
    meanLargestShare: mean(engaged.map((frame) => frame.share)),
    meanFights: mean(engaged.map((frame) => frame.fights)),
    meanKnotRadius: mean(meleeFrames.map((frame) => frame.knotRadius).filter((v) => v !== null)),
    meanPacking: mean(engaged.map((frame) => frame.packing).filter((v) => v !== null)),
    openingRadius: frames[0].fieldRadius,
    contactRadius: mean(engaged.map((frame) => frame.fieldRadius)),
    meleeDriftPerStardate: mean(drift),
    concurrentFightShare: mean(engaged.map((frame) => (frame.fights2 ? 1 : 0))),
    meanFightSpread: mean(engaged.map((frame) => frame.fightSpread).filter((v) => v !== null)),
    hasRelays: Object.values(strats ?? {}).includes('relays'),
    relayTransitions: transitions,
    relayFlips: flips,
  });
}

const report = {
  scope: `Headless Reimagined wars, sim-0..sim-${seeds - 1}, default fleets, no orders. One sample per stardate after every captain acted. Hulls linked at <= phaser range (${LINK}) form a component; one cross-faction component holding >= ${MELEE_SHARE} of afloat combatants counts as a single melee.`,
  seeds: wars.length,
  firstContact: {
    median: quantile(wars.map((w) => w.firstContact), 0.5),
    p90: quantile(wars.map((w) => w.firstContact), 0.9),
    byStardate2: wars.filter((w) => w.firstContact <= 2).length,
    byStardate3: wars.filter((w) => w.firstContact <= 3).length,
  },
  contactShareOfWar: Number(mean(wars.map((w) => w.contactShare)).toFixed(2)),
  singleMelee: {
    meanShareOfContactStardates: Number(mean(wars.map((w) => w.meleeShareOfContact)).toFixed(2)),
    warsMostlyOneMelee: wars.filter((w) => w.meleeShareOfContact >= 0.8).length,
    meanLargestComponentShare: Number(mean(wars.map((w) => w.meanLargestShare)).toFixed(2)),
    meanConcurrentFights: Number(mean(wars.map((w) => w.meanFights)).toFixed(1)),
  },
  separateFights: {
    warsWithConcurrentFights: wars.filter((w) => w.concurrentFightShare > 0).length,
    meanShareOfEngagedStardates: Number(mean(wars.map((w) => w.concurrentFightShare)).toFixed(2)),
    meanSpreadBetweenTwoBiggest: Number(mean(wars.filter((w) => w.concurrentFightShare > 0).map((w) => w.meanFightSpread)).toFixed(1)),
  },
  relayContest: {
    relaysWars: wars.filter((w) => w.hasRelays).length,
    warsWithHolderFlip: wars.filter((w) => w.hasRelays && w.relayFlips > 0).length,
    warsWithTwoPlusTransitions: wars.filter((w) => w.hasRelays && w.relayTransitions >= 2).length,
  },
  geometry: {
    openingFieldRadius: Number(mean(wars.map((w) => w.openingRadius)).toFixed(1)),
    contactFieldRadius: Number(mean(wars.map((w) => w.contactRadius)).toFixed(1)),
    meanKnotRadius: Number(mean(wars.map((w) => w.meanKnotRadius).filter((v) => Number.isFinite(v))).toFixed(1)),
    meanNearestAllyGap: Number(mean(wars.map((w) => w.meanPacking).filter((v) => Number.isFinite(v))).toFixed(1)),
    meleeCentroidDriftPerStardate: Number(mean(wars.map((w) => w.meleeDriftPerStardate)).toFixed(1)),
  },
  warLengthMedian: quantile(wars.map((w) => w.turns), 0.5),
};
console.log(JSON.stringify(report, null, 2));
