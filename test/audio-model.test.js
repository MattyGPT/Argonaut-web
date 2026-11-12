
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, crewCapacity, getShip, ionStormZone, powerEffect, radioIntegrity, systemUnits } from '../game/state.js';
import { enableBattleRecords } from '../game/battle-records.js';
import { resolveComputerTurns } from '../game/turns.js';
import {
  AUDIO_BUSES, DEFAULT_AUDIO_SETTINGS, audioAudible, audioStateText, busGain, commsModel,
  engineHumModel, impactVoiceModel, parseAudioSettings, regenCueModel, stormStaticModel,
} from '../ui/audio-model.js';

const own = (game) => getShip(game, game.playerShipId);
const reimagined = (seed) => createGame({ seed, reimagined: true });

/** Knock out radio units the way damage would, without touching the rules layer. */
const withRadio = (ship, units) => ({ ...ship, systems: { ...ship.systems, radio: units } });

/**
 * Fly a real war and keep the raw record batch, so the impact voices below are
 * asserted against records the rules layer actually emitted rather than fixtures
 * shaped by hand. `battleId` is supplied to keep `crypto.randomUUID` out of it.
 */
const battleRecords = (seed, rounds = 40) => {
  let game = enableBattleRecords(reimagined(seed), { battleId: `audio-${seed}` });
  const records = [];
  for (let i = 0; i < rounds && !game.outcome; i += 1) {
    game = resolveComputerTurns(game, { onRecords: (batch) => records.push(...batch) });
  }
  return records;
};

/** A damage record shaped exactly as `resolvedDamage` emits it (verified against a real war). */
const damageRecord = (overrides = {}) => ({
  kind: 'damage',
  actorId: 'someone-else',
  targetId: 'fed-flagship',
  payload: {
    cause: 'phasers',
    arc: null,
    consequences: { delta: { shields: 0, crew: 0, arcs: {}, systems: {} } },
    ...overrides.payload,
  },
  ...overrides,
});

test('the comms band narrows as radio units are lost, and matches the integrity the console prints', () => {
  const game = reimagined('audio-comms');
  const ship = own(game);
  const installed = systemUnits(ship, 'radio');
  assert.ok(installed > 0, 'the command ship carries radio hardware in both rulesets');
  const at = (units) => commsModel(game, withRadio(ship, units));

  const clear = at(installed);
  assert.equal(clear.voice, 'clear');
  assert.equal(clear.integrity, 1);
  assert.equal(clear.gain, 1);

  if (installed >= 2) {
    const degraded = at(installed - 1);
    assert.equal(degraded.voice, 'degraded');
    assert.ok(degraded.cutoff < clear.cutoff, 'a lost radio unit narrows the band');
    assert.ok(degraded.gain > 0, 'a damaged radio still hears something');
    assert.ok(degraded.resonance > clear.resonance, 'and the narrowing band rings, the way a bad receiver does');
  }

  // The same number the console already shows as "radio at N%".
  assert.equal(at(1).integrity, radioIntegrity(withRadio(ship, 1)));

  const dead = at(0);
  assert.equal(dead.voice, 'blocked');
  assert.equal(dead.gain, 0, 'no surviving radio hears no fleet traffic, as the journal does');
  assert.equal(dead.integrity, 0);
});

test('the comms band is monotonic in radio integrity, so worse hardware never sounds better', () => {
  const game = reimagined('audio-monotonic');
  const ship = own(game);
  const installed = systemUnits(ship, 'radio');
  const cutoffs = Array.from({ length: installed }, (_, index) => installed - index)
    .map((units) => commsModel(game, withRadio(ship, units)).cutoff);
  assert.ok(cutoffs.length >= 2, 'the fixture needs at least two radio units to be meaningful');
  for (let i = 1; i < cutoffs.length; i += 1) {
    assert.ok(cutoffs[i] < cutoffs[i - 1], `cutoff falls as radio units are lost: ${cutoffs.join(' > ')}`);
  }
});

test('comms audio degrades exactly where the journal prose does, and blocks where it drops traffic', () => {
  const game = reimagined('audio-parity-with-text');
  const ship = own(game);
  const installed = systemUnits(ship, 'radio');
  assert.ok(installed >= 2, 'the command ship needs two radio units for a damaged-but-alive case to exist');
  // `projectJournalRecord` abbreviates a fleet line whenever radio < 1 and drops
  // it when no radio survives; the audio must not disagree with either.
  assert.equal(commsModel(game, ship).voice, 'clear', 'undamaged radio: prose whole, band open');
  assert.equal(commsModel(game, withRadio(ship, installed - 1)).voice, 'degraded', 'a unit lost: prose abbreviated, band narrowed');
  assert.equal(commsModel(game, withRadio(ship, 0)).voice, 'blocked', 'no radio: prose dropped, traffic silent');
});

test('an ion storm jams the comms and voices the static, centred in the core and panned in the ring', () => {
  const game = reimagined('audio-storm');
  const ship = own(game);
  const storm = { type: 'ion-storm', x: ship.x, y: ship.y, radius: 30 };
  const inCore = { ...game, terrain: [storm] };
  assert.equal(ionStormZone(inCore, ship), 'core', 'fixture really places the hull in the core');

  const coreComms = commsModel(inCore, ship);
  assert.equal(coreComms.voice, 'blocked', 'the core takes the radio offline, so no traffic is heard');
  assert.equal(coreComms.zone, 'core');

  const coreStatic = stormStaticModel(inCore, ship, { minX: ship.x - 100, minY: ship.y - 100, width: 200, height: 200 });
  assert.equal(coreStatic.present, true);
  assert.equal(coreStatic.gain, 1);
  assert.equal(coreStatic.pan, 0, 'inside the core there is no useful direction, so it is centred');

  // Half reach in the ring, composed the same way `radioReaches` composes it.
  const ring = { ...game, terrain: [{ ...storm, x: ship.x + 24 }] };
  assert.equal(ionStormZone(ring, ship), 'ring', 'fixture really places the hull in the ring');
  const ringComms = commsModel(ring, ship);
  assert.equal(ringComms.voice, 'degraded');
  assert.ok(ringComms.reach < commsModel(game, ship).reach, 'the ring halves reach on top of hardware');

  const eye = { ...storm, x: ship.x + 200 };
  const ringStatic = stormStaticModel({ ...game, terrain: [eye, { ...storm, x: ship.x + 24 }] }, ship,
    { minX: ship.x - 100, minY: ship.y - 100, width: 200, height: 200 });
  assert.equal(ringStatic.present, true);
  assert.equal(ringStatic.gain, 0.5);
  assert.ok(ringStatic.pan > 0, 'the eye is to the right on screen, so the static pans right');

  assert.equal(stormStaticModel(game, ship).present, false, 'open space carries no hazard the rules are not applying');
});

test('the engine hum pitch follows the engine allocation, and a classic hull stays nominal', () => {
  const game = reimagined('audio-hum');
  const ship = own(game);
  const nominal = engineHumModel(game, ship);
  assert.equal(nominal.audible, true);
  assert.equal(nominal.state, 'nominal');
  assert.equal(nominal.effect, 1);

  const allocation = { shields: 4, weapons: 6, engines: 6, sensors: 4, tractor: 2 };
  const over = engineHumModel({ ...game, power: { [ship.id]: allocation } }, ship);
  assert.equal(powerEffect({ ...game, power: { [ship.id]: allocation } }, ship, 'engines'), over.effect);
  assert.ok(over.frequency > nominal.frequency, 'overcharging the engines raises the hum');
  assert.equal(over.state, 'overcharged');

  const starved = { shields: 4, weapons: 6, engines: 2, sensors: 4, tractor: 2 };
  const low = engineHumModel({ ...game, power: { [ship.id]: starved } }, ship);
  assert.ok(low.frequency < nominal.frequency, 'starving the engines drops the hum');
  assert.equal(low.state, 'starved');

  const dead = engineHumModel(game, { ...ship, systems: { ...ship.systems, engines: 0 } });
  assert.equal(dead.audible, false, 'no engine units, no hum');
  assert.equal(dead.state, 'silent');

  const classic = createGame({ seed: 'audio-hum-classic' });
  const classicHum = engineHumModel(classic, own(classic));
  assert.equal(classicHum.effect, 1, 'powerEffect is 1 outside a Reimagined war');
  assert.equal(classicHum.frequency, nominal.frequency, 'a classic hull hums at the nominal pitch');
  assert.equal(classicHum.state, 'nominal', 'and is never called starved: there is no dial in a classic war');
  assert.equal(classicHum.share, null, 'a classic hull has no reactor key, so no share is claimed');
});

test('a skeleton-crewed prize is named for its crew, not blamed on the power dial', () => {
  const game = reimagined('audio-hum-manning');
  const ship = own(game);
  const complement = crewCapacity(ship);
  // `manningEffect` halves engines and weapons for a prize below PRIZE.manningFloor
  // of its complement. `powerEffect` folds that in, so reading the folded number
  // alone would report a crew shortage as a starved allocation.
  const prize = { ...ship, prize: true, crew: Math.max(1, Math.floor(complement * 0.1)) };
  const hum = engineHumModel(game, prize);
  assert.equal(hum.manning, 0.5, 'the fixture really is skeleton-crewed');
  assert.equal(hum.state, 'skeleton-crewed', 'not "starved" — the dial is not the problem');
  assert.equal(hum.dialled, 1, 'the allocation itself is untouched');
  assert.ok(hum.frequency < engineHumModel(game, ship).frequency,
    'and the hum still drops, because the engines really do deliver less');

  const line = audioStateText({ engine: hum }).join(' ');
  assert.match(line, /skeleton-crewed/, 'the prose uses the rules\' own word');
  assert.match(line, /transporter transfer or the dockyard/, 'and names the remedy the rules actually offer');
  assert.doesNotMatch(line, /starved/, 'it does not send the player to the power dial');
});

test('impact voices separate an arc that held, an arc already gutted, and damage that reached inside', () => {
  const arcHeld = damageRecord({
    payload: {
      cause: 'phasers', arc: 'fore',
      consequences: { delta: { shields: -23, crew: 0, arcs: { fore: -23, starboard: 0, aft: 0, port: 0 }, systems: {} } },
    },
  });
  const held = impactVoiceModel(arcHeld, 'fed-flagship');
  assert.equal(held.voice, 'arc');
  assert.equal(held.arcLoss, 23, 'the struck arc\'s own pool absorbed it');
  assert.ok(held.cutoff > 2000, 'a live arc throwing a volley is bright');

  // The same arc struck again after it was gutted: no arc delta, the pool takes it.
  const gutted = damageRecord({
    payload: {
      cause: 'phasers', arc: 'fore',
      consequences: { delta: { shields: -18, crew: 0, arcs: { fore: 0, starboard: -6, aft: -6, port: -6 }, systems: {} } },
    },
  });
  const breached = impactVoiceModel(gutted, 'fed-flagship');
  assert.equal(breached.voice, 'breached');
  assert.equal(breached.arcLoss, 0);
  assert.ok(breached.cutoff < held.cutoff, 'through a gutted arc sounds hollower than off a live one');

  const internal = damageRecord({
    payload: {
      cause: 'photons', arc: 'starboard',
      consequences: { delta: { shields: -30, crew: -2, arcs: { starboard: -10 }, systems: { radio: -1 } } },
    },
  });
  const inside = impactVoiceModel(internal, 'fed-flagship');
  assert.equal(inside.voice, 'internal', 'internals outrank the shield burn: it is the worse news');
  assert.equal(inside.crewLost, 2);
  assert.equal(inside.systemsLost, 1);
  assert.ok(inside.cutoff < breached.cutoff, 'internal damage is the dullest voice');

  // Positional damage — a classic hull, a drone, or spread splash — names no arc.
  const positional = damageRecord({
    payload: { cause: 'ion', consequences: { delta: { shields: -10, crew: 0, arcs: { fore: -3, starboard: -3, aft: -2, port: -2 }, systems: {} } } },
  });
  assert.equal(impactVoiceModel(positional, 'fed-flagship').voice, 'shield');
});

test('impact voices fire only on the player\'s own hull and only when something was actually lost', () => {
  const record = damageRecord({
    payload: { cause: 'phasers', arc: 'fore', consequences: { delta: { shields: -23, crew: 0, arcs: { fore: -23 }, systems: {} } } },
  });
  assert.equal(impactVoiceModel(record, 'someone-else'), null, 'a blow on another hull is not voiced as an impact');
  assert.equal(impactVoiceModel({ ...record, kind: 'weapon-resolution' }, 'fed-flagship'), null, 'only damage records carry a blow');
  assert.equal(impactVoiceModel(damageRecord(), 'fed-flagship'), null, 'a hit that cost nothing makes no sound');
  assert.equal(impactVoiceModel(null, 'fed-flagship'), null);
  assert.equal(impactVoiceModel(record, null), null);
});

test('real war records produce the voices, including the rare gutted-arc case', () => {
  const records = battleRecords('audio-real-voices');
  const damage = records.filter((record) => record.kind === 'damage');
  assert.ok(damage.length > 0, 'a real war emits damage records');

  const seen = new Set();
  for (const record of damage) {
    const voiced = impactVoiceModel(record, record.targetId);
    if (!voiced) continue;
    assert.ok(['arc', 'breached', 'internal', 'shield'].includes(voiced.voice), `unexpected voice ${voiced.voice}`);
    seen.add(voiced.voice);
    if (voiced.voice === 'arc') {
      assert.ok(voiced.arcLoss > 0, 'an arc voice means that arc really absorbed damage');
    }
    if (voiced.voice === 'breached') {
      assert.equal(voiced.arcLoss, 0, 'a breached voice means the named arc had nothing left');
      assert.ok(voiced.shieldLoss > 0, 'and the pool behind it took the blow');
    }
  }
  assert.ok(seen.has('arc'), 'real wars strike live arcs');
  assert.ok(seen.has('internal'), 'real wars reach the internals');

  // The record shape the model reads is pinned here, so a change to the record
  // layer fails this test instead of silently muting the audio.
  const withArc = damage.find((record) => typeof record.payload.arc === 'string');
  assert.ok(withArc, 'an aimed volley records the arc it struck');
  assert.ok(withArc.payload.consequences?.delta, 'a damage record carries its consequence deltas');

  const regen = records.filter((record) => record.kind === 'repair' && record.payload.cause === 'reactor-regeneration');
  assert.ok(regen.length > 0, 'the reactor trickle is recorded, so the surplus cue has a real trigger');
  assert.ok(regen.some((record) => regenCueModel(record, record.actorId)), 'and it voices on the hull that regenerated');
  assert.equal(regenCueModel({ ...regen[0], payload: { ...regen[0].payload, cause: 'dockyard' } }, regen[0].actorId), null,
    'dockyard repairs are not the surplus trickle');
  assert.equal(regenCueModel(regen[0], 'some-other-ship'), null, 'another hull regenerating is not your cue');
});

test('volumes are clamped device preferences with an effective mute, and defaults leave existing effects untouched', () => {
  assert.deepEqual(AUDIO_BUSES, ['ambience', 'effects', 'alerts'], 'the three buses the V6 contract names');

  const parsed = parseAudioSettings({ ambience: 2, effects: -1, alerts: 'loud', muted: 'yes' });
  assert.equal(parsed.ambience, 1, 'over-range is clamped');
  assert.equal(parsed.effects, 0, 'under-range is clamped');
  assert.equal(parsed.alerts, DEFAULT_AUDIO_SETTINGS.alerts, 'a non-number keeps the default');
  assert.equal(parsed.muted, false, 'only a real true mutes');
  assert.deepEqual(parseAudioSettings(null), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(parseAudioSettings(undefined), DEFAULT_AUDIO_SETTINGS);

  assert.equal(busGain(DEFAULT_AUDIO_SETTINGS, 'effects'), 1, 'effects default to unity, so today\'s soundtrack is unchanged');
  assert.equal(busGain(DEFAULT_AUDIO_SETTINGS, 'alerts'), 1, 'alerts default to unity, so the klaxon is unchanged');
  assert.equal(audioAudible(DEFAULT_AUDIO_SETTINGS), true);

  const muted = { ...DEFAULT_AUDIO_SETTINGS, muted: true };
  for (const bus of AUDIO_BUSES) assert.equal(busGain(muted, bus), 0, `mute silences the ${bus} bus`);
  assert.equal(audioAudible(muted), false, 'the mute is effective');
  assert.equal(audioAudible({ ambience: 0, effects: 0, alerts: 0, muted: false }), false, 'all three at zero is also silence');
});

test('every cue has a word equivalent, and nothing is announced that the rules do not support', () => {
  const game = reimagined('audio-text');
  const ship = own(game);
  const settings = DEFAULT_AUDIO_SETTINGS;

  const clear = audioStateText({ comms: commsModel(game, ship), engine: engineHumModel(game, ship), storm: stormStaticModel(game, ship), settings });
  assert.ok(clear.some((line) => line.includes('Fleet traffic: clear')), 'clear comms are stated');
  assert.ok(clear.some((line) => line.includes('radio 100% intact')), 'and the percentage the console shows is the one spoken');
  assert.ok(clear.some((line) => line.includes('intercom')), 'the own-ship exemption is stated, so silence is not mistaken for a bug');
  assert.ok(clear.some((line) => line.includes('Ion storm static: none')), 'open space says so rather than staying quiet');

  const blocked = audioStateText({ comms: commsModel(game, withRadio(ship, 0)), settings });
  assert.ok(blocked.some((line) => line.includes('silent') && line.includes('no working radio')), 'a dead radio is stated as silence, with the reason');

  const storm = { ...game, terrain: [{ type: 'ion-storm', x: ship.x, y: ship.y, radius: 30 }] };
  const jammed = audioStateText({ comms: commsModel(storm, ship), storm: stormStaticModel(storm, ship), settings });
  assert.ok(jammed.some((line) => line.includes('ion storm core jams the radio')), 'the jam is attributed to the storm, not to damage');
  assert.ok(jammed.some((line) => line.includes('weapons and radio offline')), 'and states the rule the player is already told');

  assert.equal(audioStateText({ settings }).length, 2, 'with no battle open the panel still reports volume and says why there is nothing else');
  assert.ok(audioStateText({ settings: { ...settings, muted: true } }).some((line) => line.includes('Audio muted.')));
  assert.deepEqual(audioStateText(), [], 'an empty model makes no claim at all');
});

test('projecting the audio model consumes no gameplay randomness and changes no state', () => {
  const game = reimagined('audio-no-rng');
  const ship = own(game);
  const before = JSON.stringify(game);
  const stepBefore = game.randomStep;

  commsModel(game, ship);
  engineHumModel(game, ship);
  stormStaticModel(game, ship, { minX: 0, minY: 0, width: 320, height: 320 });
  for (const record of battleRecords('audio-no-rng-battle').slice(0, 60)) {
    impactVoiceModel(record, record.targetId);
    regenCueModel(record, record.actorId);
  }
  audioStateText({ comms: commsModel(game, ship), engine: engineHumModel(game, ship), settings: DEFAULT_AUDIO_SETTINGS });

  assert.equal(game.randomStep, stepBefore, 'the seeded counter did not move');
  assert.equal(JSON.stringify(game), before, 'no authoritative field was written');
});
