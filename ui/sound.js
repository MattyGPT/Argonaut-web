let context = null;

const ctx = () => {
  if (!context && window.AudioContext) context = new AudioContext();
  if (context?.state === 'suspended') context.resume();
  return context;
};

const tone = (c, { type = 'sine', from = 440, to = from, duration = 0.1, gain = 0.04, delay = 0 }) => {
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
};

const noise = (c, { duration = 0.3, gain = 0.08, delay = 0 }) => {
  const t0 = c.currentTime + delay;
  const frames = Math.max(1, Math.floor(c.sampleRate * duration));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(c.destination);
  src.start(t0);
};

export const playEvent = (kind, enabled) => {
  if (!enabled) return;
  const c = ctx();
  if (!c) return;
  try {
    if (kind === 'phasers') tone(c, { type: 'sawtooth', from: 900, to: 140, duration: 0.18, gain: 0.05 });
    else if (kind === 'photons') tone(c, { type: 'square', from: 130, to: 55, duration: 0.22, gain: 0.06 });
    else if (kind === 'explosion') { noise(c, { duration: 0.4, gain: 0.1 }); tone(c, { type: 'sine', from: 90, to: 40, duration: 0.3, gain: 0.06 }); }
    else if (kind === 'miss') tone(c, { type: 'sine', from: 320, to: 220, duration: 0.08, gain: 0.02 });
    else tone(c, { type: 'sine', from: 520, duration: 0.06, gain: 0.03 });
  } catch {
    /* optional sound */
  }
};

export const playEffect = (kind, enabled) => playEvent(kind === 'hit' ? 'explosion' : kind, enabled);
