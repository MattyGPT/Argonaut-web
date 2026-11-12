/**
 * The audio model: every number the sound layer plays, derived from
 * authoritative state that already exists.
 *
 * Like the hull schematic, this module is a projection, not a second rules
 * layer. It reads `radioIntegrity`, `radioStormFactor`, `powerEffect`,
 * `reactorOutput`, `powerAllocation`, `ionStormZone` and the deltas the record
 * layer already stamps onto a `damage` record, and turns them into cutoffs,
 * gains, pitches and pans. It decides nothing, consumes no gameplay RNG, and
 * never writes to game or campaign state. It is pure — no DOM, no Web Audio — so
 * every mapping here is pinned by `npm test` rather than by ear.
 *
 * The load-bearing idea is that the audio degrades for the *same reason* the
 * text does. Fleet prose is already truncated in proportion to surviving radio
 * hardware (`abbreviateNarrative`) and dropped outright when none is left, and
 * the console already prints "radio at N%, traffic abbreviated". The comms
 * filter below is that same number expressed as a lowpass cutoff, so a burned-out
 * radio sounds burned out rather than merely quieter, and a player who cannot
 * hear the difference can read it in the same words the journal uses.
 *
 * Nothing here is audio-only. `audioStateText` renders the whole model as prose
 * for the audio panel and the screen-reader live region, and every cue below has
 * a text counterpart the rules layer was already producing: arc damage is named
 * in the journal ("fore arc 12 damage"), radio integrity is a percentage on
 * screen, the ion-storm jam is an unavailability reason, and the reactor budget
 * is drawn by the schematic.
 */
import { POWER } from '../game/constants.js';
import {
  distance, ionStormZone, isActive, powerAllocation, powerEffect,
  radioIntegrity, radioStormFactor, reactorOutput, systemUnits,
} from '../game/state.js';

/** The three buses the V6 presentation contract requires separate volumes for. */
export const AUDIO_BUSES = Object.freeze(['ambience', 'effects', 'alerts']);

/**
 * Defaults keep the effects and alerts buses at exactly the loudness the game
 * has always used, so ticking "Tactical sound" without touching the audio panel
 * changes nothing audible that already existed. Ambience starts lower because it
 * is new and continuous.
 */
export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  ambience: 0.6, effects: 1, alerts: 1, muted: false,
});

/** Voice-band edges for the comms lowpass, in Hz. */
const COMMS_CLEAR_HZ = 3400;
const COMMS_FLOOR_HZ = 240;

/** Engine hum pitch range, in Hz, across the 0..overcharge engine effectiveness. */
const ENGINE_FLOOR_HZ = 52;
const ENGINE_SPAN_HZ = 58;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const unit = (value) => clamp(Number(value) || 0, 0, 1);

/**
 * Validate a stored audio preference. Device-level and deliberately NOT a save
 * field: volumes follow the theme and ship-art precedent, so they live in
 * localStorage and never enter game state or a save envelope.
 */
export const parseAudioSettings = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const settings = { ...DEFAULT_AUDIO_SETTINGS };
  for (const bus of AUDIO_BUSES) {
    if (Number.isFinite(source[bus])) settings[bus] = unit(source[bus]);
  }
  settings.muted = source.muted === true;
  return settings;
};

/** The gain a bus actually outputs, honouring the effective mute. */
export const busGain = (settings, bus) => (settings?.muted ? 0 : unit(settings?.[bus]));

/** Whether anything at all can be heard. */
export const audioAudible = (settings) => !settings?.muted && AUDIO_BUSES.some((bus) => busGain(settings, bus) > 0);

/**
 * The comms filter for incoming fleet traffic.
 *
 * `listener` is the hull doing the hearing — always the command ship, since its
 * radio hardware is what abbreviates the prose. Reach composes exactly as
 * `radioReaches` does, hardware integrity times the storm factor, so at zero the
 * voice is blocked: the audio counterpart of the journal dropping fleet traffic
 * entirely when no radio survives.
 *
 * The player's own ship's lines are deliberately not modelled here. The rules
 * layer already exempts them — `abbreviateNarrative` keeps any entry beginning
 * with the ship's own name, because those "reach you over the intercom, not the
 * radio" — so giving them a degraded voice would contradict the text.
 */
export const commsModel = (game, listener) => {
  const integrity = unit(radioIntegrity(listener));
  const stormFactor = radioStormFactor(game, listener);
  const reach = integrity * stormFactor;
  const zone = ionStormZone(game, listener);
  const jammed = reach <= 0;
  return {
    voice: jammed ? 'blocked' : reach >= 1 ? 'clear' : 'degraded',
    // A power curve, so the first lost radio unit is audibly a narrowing band
    // rather than a change you have to strain for.
    cutoff: COMMS_FLOOR_HZ + (COMMS_CLEAR_HZ - COMMS_FLOOR_HZ) * reach ** 1.5,
    resonance: 0.7 + 3.3 * (1 - reach),
    gain: jammed ? 0 : 1,
    integrity, reach, zone, jammed,
  };
};

/**
 * The engine hum, from how hard the engine sink is actually being driven.
 *
 * Pitch tracks `powerEffect(game, ship, 'engines')` — the authoritative
 * allocated/need multiplier, clamped to the overcharge ceiling — so routing
 * surplus to the engines raises it and starving them drops it. That function
 * returns 1 outside a Reimagined war, so a classic hull hums at the nominal
 * pitch and classic presentation is unchanged. `share` is the sink's fraction of
 * the live reactor budget, reported in words rather than pitched, because a hull
 * with no reactor key has no meaningful share to hear.
 */
export const engineHumModel = (game, ship) => {
  const running = Boolean(ship) && isActive(ship) && systemUnits(ship, 'engines') > 0;
  const effect = clamp(powerEffect(game, ship, 'engines'), 0, POWER.overcharge);
  const budget = reactorOutput(ship, game);
  const allocated = powerAllocation(game, ship).engines ?? 0;
  return {
    audible: running,
    frequency: ENGINE_FLOOR_HZ + ENGINE_SPAN_HZ * effect,
    effect,
    share: budget > 0 ? allocated / budget : null,
    budget,
    allocated,
    state: !running ? 'silent' : effect > 1 ? 'overcharged' : effect < 1 ? 'starved' : 'nominal',
  };
};

/** The storm a hull is inside, found with the same predicate the rules use. */
const containingStorm = (game, point) => (game?.terrain ?? [])
  .find((feature) => feature.type === 'ion-storm' && distance(point, feature) <= feature.radius) ?? null;

/**
 * Ion-storm static: a bed that tells you where the eye of the storm is and how
 * deep in the jam you are.
 *
 * Only the storm the rules are already penalising is voiced, so the audio can
 * never claim a hazard that costs nothing. In the core the jam is total — weapons
 * and radio are offline — and the static is centred and full, because there is no
 * useful direction left to point at. In the ring the fight continues at a penalty
 * and the storm is directional, so it pans to where the eye sits on screen; that
 * is the case where "which way is out" is a real question. In open space there is
 * no static at all.
 *
 * `win` is the camera window the FX layer already uses, so left and right in the
 * ears match left and right on the map.
 */
export const stormStaticModel = (game, listener, win = null) => {
  const zone = ionStormZone(game, listener);
  if (!zone || !listener) return { present: false, zone: null, pan: 0, gain: 0, radius: null };
  const storm = containingStorm(game, listener);
  const span = win && win.width > 0 ? win.width : null;
  const pan = storm && span ? clamp((2 * (storm.x - win.minX)) / span - 1, -1, 1) : 0;
  return {
    present: true,
    zone,
    // Centred in the core: the hull is inside it, so a direction would be a lie.
    pan: zone === 'core' ? 0 : pan,
    gain: zone === 'core' ? 1 : 0.5,
    radius: storm?.radius ?? null,
  };
};

/**
 * The voice an incoming `damage` record on the player's own hull gets.
 *
 * Read from the deltas the record layer already froze, never re-derived from
 * live state, so the sound describes the hit that was actually recorded. The
 * distinction comes straight out of `damageShip`: an aimed volley spends the
 * struck arc's OWN pool first, and that arc's delta is exactly minus what it
 * absorbed. So a negative delta on the named arc means the arc held; a zero delta
 * with the shields still moving means the arc was already gutted and the volley
 * walked straight through it into the pool and the internals — the case the
 * durability lever exists to make costly, and the one worth sounding different.
 *
 * Internal damage takes precedence because it is the worst news in the record:
 * a subsystem knocked out or crew lost outranks a shield burn.
 */
export const impactVoiceModel = (record, ownShipId) => {
  if (record?.kind !== 'damage' || !ownShipId) return null;
  if (record.targetId !== ownShipId) return null;
  const payload = record.payload ?? {};
  const delta = payload.consequences?.delta ?? {};
  const arc = typeof payload.arc === 'string' ? payload.arc : null;
  // Losses are the negation of a signed delta, floored at zero: a record that
  // restored an arc or refilled shields is not a blow, and negating a zero delta
  // would otherwise hand back a `-0` that compares unequal to `0`.
  const loss = (value) => Math.max(0, -(Number(value) || 0));
  const arcLoss = arc ? loss(delta.arcs?.[arc]) : 0;
  const shieldLoss = loss(delta.shields);
  const systemsLost = Object.values(delta.systems ?? {}).filter((value) => Number(value) < 0).length;
  const crewLost = loss(delta.crew);
  const internal = systemsLost > 0 || crewLost > 0;
  if (!internal && arcLoss <= 0 && shieldLoss <= 0) return null;
  const voice = internal ? 'internal'
    : arc && arcLoss > 0 ? 'arc'
      : arc ? 'breached'
        : 'shield';
  return {
    voice,
    arc,
    arcLoss,
    shieldLoss,
    systemsLost,
    crewLost,
    internal,
    cause: typeof payload.cause === 'string' ? payload.cause : null,
    // Internal damage is duller and closer: a low band, no stereo spread, because
    // it is happening inside the hull the player is standing in.
    cutoff: voice === 'internal' ? 700 : voice === 'arc' ? 2600 : 1500,
  };
};

/**
 * The shield-surplus cue: the reactor trickle that refills a focused arc when
 * surplus is routed to the shield sink. Read from the `repair` record the rules
 * layer already emits for `reactor-regeneration`, so the cue fires only when
 * shields genuinely came back, and only on the player's own hull.
 */
export const regenCueModel = (record, ownShipId) => {
  if (record?.kind !== 'repair' || record.actorId !== ownShipId) return null;
  const payload = record.payload ?? {};
  if (payload.cause !== 'reactor-regeneration') return null;
  const shields = Number(payload.shields) || 0;
  if (shields <= 0) return null;
  return { voice: 'regen', shields };
};

/** One line of prose per audible subsystem, for the panel and the live region. */
export const audioStateText = ({ comms, engine, storm, settings } = {}) => {
  const lines = [];
  if (settings) {
    lines.push(settings.muted
      ? 'Audio muted.'
      : `Volume — ambience ${Math.round(busGain(settings, 'ambience') * 100)}%, effects ${Math.round(busGain(settings, 'effects') * 100)}%, alerts ${Math.round(busGain(settings, 'alerts') * 100)}%.`);
  }
  if (!comms && !engine && !storm) {
    if (settings) lines.push('No battle is open, so there is no hull for the sound to describe.');
    return lines;
  }
  if (comms) {
    const percent = Math.round(comms.integrity * 100);
    if (comms.voice === 'blocked') {
      lines.push(comms.zone === 'core'
        ? 'Fleet traffic: silent — the ion storm core jams the radio.'
        : `Fleet traffic: silent — no working radio (${percent}% intact).`);
    } else if (comms.voice === 'degraded') {
      lines.push(`Fleet traffic: band-limited to ${Math.round(comms.cutoff)} Hz — radio at ${percent}%${comms.zone === 'ring' ? ', halved again by the ion storm ring' : ''}, reports abbreviated.`);
    } else {
      lines.push(`Fleet traffic: clear — radio ${percent}% intact.`);
    }
    lines.push('Your own ship\'s lines reach you over the intercom and stay clear.');
  }
  if (engine) {
    if (!engine.audible) lines.push('Engine hum: silent — no working engine units.');
    else if (engine.share === null) lines.push(`Engine hum: ${engine.frequency.toFixed(0)} Hz, nominal allocation.`);
    else lines.push(`Engine hum: ${engine.frequency.toFixed(0)} Hz — engines ${engine.state}, ${Math.round(engine.share * 100)}% of the reactor budget.`);
  }
  if (storm) {
    if (!storm.present) lines.push('Ion storm static: none — open space.');
    else if (storm.zone === 'core') lines.push('Ion storm static: full jam, centred — weapons and radio offline.');
    else lines.push(`Ion storm static: half jam, panned ${storm.pan < -0.15 ? 'to port' : storm.pan > 0.15 ? 'to starboard' : 'ahead'}.`);
  }
  return lines;
};
