/**
 * The sound layer: Web Audio rendering of the model `ui/audio-model.js` projects.
 *
 * This module owns no game knowledge. Every number it plays — the comms cutoff,
 * the hum pitch, the static pan, which impact voice to use — is handed to it by
 * the pure audio model, which reads authoritative state. That split is what makes
 * the mappings testable: `npm test` pins the numbers, and this file only turns
 * them into nodes.
 *
 * Three buses, per the V6 presentation contract: ambience, effects and alerts,
 * each with its own gain and all silenced by one effective mute. Volumes are a
 * device preference held in localStorage by `app.js`, never a save field, and a
 * change to them consumes no gameplay randomness.
 *
 * At the default settings the effects and alerts buses sit at gain 1, so the
 * volleys, hits and klaxon a player already knows are unchanged; everything new
 * (the hum, the storm bed, the comms filter, the impact voices) arrives on top of
 * a soundtrack that was not re-mixed underneath them.
 *
 * Browser activation rules are respected by building nothing until a cue is
 * actually asked for, and by resuming a suspended context on each use — the
 * context is first created in response to a click, never at load.
 */
import { AUDIO_BUSES, busGain } from './audio-model.js';

const COMMS_CLEAR_HZ = 3400;
/** Minimum gap between shield-surplus cues; the trickle lands most stardates. */
const REGEN_GAP_MS = 4000;

let context = null;
let graph = null;
let settings = { ambience: 0.6, effects: 1, alerts: 1, muted: false };
let hum = null;
let staticBed = null;
let lastRegenAt = 0;

const ctx = () => {
  if (!context && globalThis.AudioContext) context = new AudioContext();
  if (context?.state === 'suspended') context.resume().catch(() => { /* needs a gesture */ });
  return context;
};

/** Build the bus graph once, and re-apply the stored volumes to it. */
const ensureGraph = (c) => {
  if (graph) return graph;
  const buses = {};
  for (const bus of AUDIO_BUSES) {
    const gain = c.createGain();
    gain.gain.value = busGain(settings, bus);
    gain.connect(c.destination);
    buses[bus] = gain;
  }
  // One shared lowpass for everything the radio carries, so a damaged receiver
  // narrows every incoming line together rather than per-message.
  const comms = c.createBiquadFilter();
  comms.type = 'lowpass';
  comms.frequency.value = COMMS_CLEAR_HZ;
  comms.Q.value = 0.7;
  comms.connect(buses.effects);
  graph = { buses, comms };
  return graph;
};

const tearDownHum = () => {
  if (!hum) return;
  try { hum.osc.stop(); } catch { /* already stopped */ }
  hum.osc.disconnect();
  hum.gain.disconnect();
  hum = null;
};

const tearDownStatic = () => {
  if (!staticBed) return;
  try { staticBed.src.stop(); } catch { /* already stopped */ }
  staticBed.src.disconnect();
  staticBed.filter.disconnect();
  staticBed.gain.disconnect();
  staticBed.panner?.disconnect();
  staticBed = null;
};

/** Tear the continuous beds down so a muted or silent war costs no nodes. */
const tearDownAmbience = () => {
  tearDownHum();
  tearDownStatic();
};

const applySettings = () => {
  if (!graph) return;
  for (const bus of AUDIO_BUSES) graph.buses[bus].gain.value = busGain(settings, bus);
  if (!busGain(settings, 'ambience')) tearDownAmbience();
};

/** Store validated device volumes and re-apply them. Accepts a partial update. */
export const setAudioSettings = (next) => {
  settings = { ...settings, ...(next ?? {}) };
  applySettings();
  return { ...settings };
};

export const getAudioSettings = () => ({ ...settings });

/**
 * One short voice. `out` is the bus to land on (default effects); `cutoff` puts a
 * lowpass in the chain, which is how a damaged radio narrows a line.
 */
const tone = (c, { type = 'sine', from = 440, to = from, duration = 0.1, gain = 0.04, delay = 0, out = null, cutoff = null, pan = null }) => {
  const g = ensureGraph(c);
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  let node = osc;
  if (cutoff !== null) {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    node.connect(filter);
    node = filter;
  }
  node.connect(amp);
  const sink = out ?? g.buses.effects;
  if (pan !== null && c.createStereoPanner) {
    const panner = c.createStereoPanner();
    panner.pan.value = pan;
    amp.connect(panner);
    panner.connect(sink);
  } else {
    amp.connect(sink);
  }
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
};

const noiseBuffer = (c, duration, decay = true) => {
  const frames = Math.max(1, Math.floor(c.sampleRate * duration));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  // Presentation randomness only: a non-gameplay source, never an authoritative
  // stream, so no war is decided by the shape of this noise.
  for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (decay ? 1 - i / frames : 1);
  return buffer;
};

const noise = (c, { duration = 0.3, gain = 0.08, delay = 0, out = null, cutoff = null }) => {
  const g = ensureGraph(c);
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, duration);
  const amp = c.createGain();
  amp.gain.value = gain;
  let node = src;
  if (cutoff !== null) {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    node.connect(filter);
    node = filter;
  }
  node.connect(amp);
  amp.connect(out ?? g.buses.effects);
  src.start(t0);
};

export const stopAmbience = tearDownAmbience;

/**
 * Browser activation rules: a context created before the player has interacted is
 * born suspended and Chrome logs a refusal, so the continuous beds never create
 * one on their own — they wait for a gesture, or reuse a context a one-shot cue
 * already opened. The last requested state is kept so the hum comes up on that
 * first gesture rather than on the next render.
 */
let gestureSeen = false;
let gestureArmed = false;
let pendingAmbience = null;

const armGesture = () => {
  if (gestureArmed || typeof document === 'undefined') return;
  gestureArmed = true;
  const start = () => {
    gestureSeen = true;
    document.removeEventListener('pointerdown', start);
    document.removeEventListener('keydown', start);
    if (pendingAmbience) updateAmbience(pendingAmbience.enabled, pendingAmbience.params);
  };
  document.addEventListener('pointerdown', start);
  document.addEventListener('keydown', start);
};

/**
 * Keep the continuous beds matching the model. Called on the render cadence —
 * per stardate, event, command and camera change — never per animation frame, so
 * a parameter change costs at most a couple of `setTargetAtTime` calls.
 */
export const updateAmbience = (enabled, params = {}) => {
  const { engine = null, storm = null } = params;
  pendingAmbience = { enabled, params };
  if (!enabled || !busGain(settings, 'ambience')) { tearDownAmbience(); return; }
  const c = context ?? (gestureSeen ? ctx() : (armGesture(), null));
  if (!c) return;
  try {
    const g = ensureGraph(c);
    if (engine?.audible && engine.frequency > 0) {
      if (!hum) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = engine.frequency;
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(g.buses.ambience);
        osc.start();
        gain.gain.setTargetAtTime(0.022, c.currentTime, 0.4);
        hum = { osc, gain };
      } else {
        // Pitch is the allocation: overcharging the engines raises it, starving
        // them drops it. Glided rather than stepped so a dial change is smooth.
        hum.osc.frequency.setTargetAtTime(engine.frequency, c.currentTime, 0.25);
      }
    } else tearDownHum();

    if (storm?.present && storm.gain > 0) {
      if (!staticBed) {
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(c, 2, false);
        src.loop = true;
        const filter = c.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 900;
        filter.Q.value = 0.6;
        const gain = c.createGain();
        gain.gain.value = 0;
        src.connect(filter);
        filter.connect(gain);
        let panner = null;
        if (c.createStereoPanner) {
          panner = c.createStereoPanner();
          panner.pan.value = storm.pan;
          gain.connect(panner);
          panner.connect(g.buses.ambience);
        } else {
          gain.connect(g.buses.ambience);
        }
        src.start();
        gain.gain.setTargetAtTime(0.05 * storm.gain, c.currentTime, 0.5);
        staticBed = { src, filter, gain, panner };
      } else {
        staticBed.gain.gain.setTargetAtTime(0.05 * storm.gain, c.currentTime, 0.5);
        staticBed.panner?.pan.setTargetAtTime(storm.pan, c.currentTime, 0.3);
      }
    } else tearDownStatic();
  } catch {
    /* optional sound */
  }
};

/** The comms cutoff for a line, or 0 when the receiver cannot hear it at all. */
const commsCutoff = (comms) => {
  if (!comms) return null;
  if (comms.voice === 'blocked' || comms.gain <= 0) return 0;
  return comms.cutoff;
};

export const playEvent = (kind, enabled, { comms = null, out = null } = {}) => {
  if (!enabled) return;
  const c = ctx();
  if (!c) return;
  const cutoff = commsCutoff(comms);
  if (cutoff === 0) return;
  try {
    const g = ensureGraph(c);
    const sink = out ? g.buses[out] : null;
    if (kind === 'phasers') tone(c, { type: 'sawtooth', from: 900, to: 140, duration: 0.18, gain: 0.05, out: sink, cutoff });
    else if (kind === 'photons') tone(c, { type: 'square', from: 130, to: 55, duration: 0.22, gain: 0.06, out: sink, cutoff });
    else if (kind === 'spread') { tone(c, { type: 'square', from: 150, to: 60, duration: 0.2, gain: 0.05, out: sink, cutoff }); tone(c, { type: 'sine', from: 80, to: 40, duration: 0.28, gain: 0.05, delay: 0.16, out: sink, cutoff }); }
    else if (kind === 'ion') tone(c, { type: 'square', from: 1400, to: 300, duration: 0.16, gain: 0.04, out: sink, cutoff });
    else if (kind === 'explosion') { noise(c, { duration: 0.4, gain: 0.1, out: sink, cutoff }); tone(c, { type: 'sine', from: 90, to: 40, duration: 0.3, gain: 0.06, out: sink, cutoff }); }
    else if (kind === 'miss') tone(c, { type: 'sine', from: 320, to: 220, duration: 0.08, gain: 0.02, out: sink, cutoff });
    else if (kind === 'klaxon') {
      // Two alternating wails, the way a red alert sounds rather than a beep.
      tone(c, { type: 'triangle', from: 440, to: 330, duration: 0.3, gain: 0.05, out: sink ?? g.buses.alerts });
      tone(c, { type: 'triangle', from: 440, to: 330, duration: 0.3, gain: 0.05, delay: 0.36, out: sink ?? g.buses.alerts });
    } else tone(c, { type: 'sine', from: 520, duration: 0.06, gain: 0.03, out: sink, cutoff });
  } catch {
    /* optional sound */
  }
};

export const playEffect = (kind, enabled, options) => playEvent(kind === 'hit' ? 'explosion' : kind, enabled, options);

/**
 * A radio chirp for incoming fleet traffic, run through the comms filter so the
 * receiver's condition is audible. Deliberately unlike the weapons cues: this is
 * a voice band, not an effect. The player's own ship's lines are not voiced here
 * — the rules already exempt them from radio damage, and they carry their own
 * weapon and impact cues.
 */
export const playComms = (enabled, comms) => {
  if (!enabled) return;
  const cutoff = commsCutoff(comms);
  if (cutoff === 0) return;
  const c = ctx();
  if (!c) return;
  try {
    tone(c, { type: 'square', from: 1200, to: 900, duration: 0.05, gain: 0.02, cutoff });
    tone(c, { type: 'sine', from: 700, to: 520, duration: 0.09, gain: 0.022, delay: 0.06, cutoff });
    // Static in the gap, louder the worse the receiver — the same integrity
    // number that shortened the sentence makes the hiss between the words.
    if (comms && comms.voice === 'degraded') noise(c, { duration: 0.14, gain: 0.03 * (1 - comms.reach), delay: 0.02, cutoff });
  } catch {
    /* optional sound */
  }
};

/**
 * The voice for a blow landed on the player's own hull. Arc-struck shields, a
 * volley walking through an already-gutted arc, and internal damage are three
 * different facts and sound like three different things; internal damage is
 * duller and centred, because it is happening inside the hull you are in.
 */
export const playImpact = (enabled, impact) => {
  if (!enabled || !impact) return;
  const c = ctx();
  if (!c) return;
  try {
    if (impact.voice === 'arc') {
      // A live arc throwing the volley: bright, with a short shimmer.
      tone(c, { type: 'triangle', from: 1800, to: 900, duration: 0.14, gain: 0.05, cutoff: impact.cutoff });
      noise(c, { duration: 0.16, gain: 0.05, cutoff: impact.cutoff });
    } else if (impact.voice === 'breached') {
      // The arc was already gone, so the volley walked through: hollower, and the
      // shield pool taking it sounds thinner than an arc doing its job.
      tone(c, { type: 'sine', from: 420, to: 180, duration: 0.26, gain: 0.055, cutoff: impact.cutoff });
      noise(c, { duration: 0.3, gain: 0.045, cutoff: impact.cutoff });
    } else if (impact.voice === 'internal') {
      // Dull and close: a low thud with almost no top end, and no stereo spread.
      tone(c, { type: 'sine', from: 120, to: 48, duration: 0.34, gain: 0.075, cutoff: impact.cutoff });
      noise(c, { duration: 0.22, gain: 0.05, cutoff: impact.cutoff });
      if (impact.crewLost > 0) tone(c, { type: 'triangle', from: 300, to: 200, duration: 0.4, gain: 0.03, delay: 0.1, cutoff: 900 });
    } else {
      // Positional damage on the total pool — a classic war, a drone, or splash.
      tone(c, { type: 'sine', from: 600, to: 260, duration: 0.18, gain: 0.05, cutoff: impact.cutoff });
      noise(c, { duration: 0.2, gain: 0.045, cutoff: impact.cutoff });
    }
  } catch {
    /* optional sound */
  }
};

/**
 * The shield-surplus trickle, rate-limited: the rules restore a little shield
 * power on most stardates, and cueing every one would be a metronome rather than
 * information. Ambience bus, so the ambience volume governs it.
 */
export const playRegen = (enabled, cue, now = Date.now()) => {
  if (!enabled || !cue || !busGain(settings, 'ambience')) return;
  if (now - lastRegenAt < REGEN_GAP_MS) return;
  lastRegenAt = now;
  const c = ctx();
  if (!c) return;
  try {
    const g = ensureGraph(c);
    tone(c, { type: 'sine', from: 520, to: 780, duration: 0.22, gain: 0.02, out: g.buses.ambience });
  } catch {
    /* optional sound */
  }
};
