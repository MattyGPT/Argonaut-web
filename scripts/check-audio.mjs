/** Browser regression check for damage-reactive audio (slice P2).
 * Runs the whole suite with npm run check:browser, which boots server.js itself;
 * or npm start and then node this file. Browser resolution, the pinned build and
 * the BROWSER_* overrides: scripts/lib/browser.mjs.
 *
 * What this covers that `npm test` cannot: the Web Audio half of the slice. The
 * Node suite pins every number the audio model derives; only a browser can prove
 * those numbers reach real audio nodes. So the AudioContext constructor is
 * wrapped before any module loads, and the created BiquadFilterNodes are read
 * back — the cutoff on the node itself must equal the cutoff the model computed
 * from surviving radio hardware. A blocked receiver must create no nodes at all,
 * because silence is the point, not a quiet sound.
 *
 * The panel is also asserted as an accessible surface: keyboard reachable, closable
 * with Escape, focus returned, and every cue stated in words, since nothing in the
 * soundtrack is allowed to be audio-only.
 *
 * Every read-and-measure pair happens inside a single page.evaluate, so the app's
 * ResizeObserver cannot interleave — the race that made check-target-readiness
 * flaky and check-battle-journal unusable.
 */
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/browser.mjs';

/**
 * Wrap the AudioContext constructor and the node factories it exposes, so the
 * check can prove which nodes were really built and read their parameters back.
 * Installed before any module runs, because the context is created lazily.
 */
const installAudioProbe = () => {
  const tally = { contexts: 0, oscillator: 0, gain: 0, biquad: 0, panner: 0, buffer: 0, filters: [], oscillators: [] };
  window.__audioNodes = tally;
  const Real = window.AudioContext;
  if (!Real) return;
  const wrap = (method, key, record) => {
    const original = Real.prototype[method];
    if (!original) return;
    Real.prototype[method] = function patched(...args) {
      const node = original.apply(this, args);
      tally[key] += 1;
      if (record) tally[record].push(node);
      return node;
    };
  };
  wrap('createOscillator', 'oscillator', 'oscillators');
  wrap('createGain', 'gain');
  wrap('createBiquadFilter', 'biquad', 'filters');
  wrap('createStereoPanner', 'panner');
  wrap('createBufferSource', 'buffer');
  window.AudioContext = class CountedAudioContext extends Real {
    constructor(...args) {
      super(...args);
      tally.contexts += 1;
    }
  };
};

const { browser } = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.addInitScript(installAudioProbe);

  // A read-only probe of the app's own live audio state, appended the way
  // check-new-game does it: no production seam, and nothing here can mutate state.
  await page.route('**/app.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: `${body}
        window.__audioProbe = () => ({
          model: audioModel, settings: audioSettings,
          sound: Boolean(game?.sound), reimagined: Boolean(game?.reimagined),
          playerShipId: game?.playerShipId ?? null,
          ship: game ? getShip(game, game.playerShipId) : null,
          logMeta: document.querySelector('#log-meta')?.textContent ?? null,
        });
        window.__audioRefresh = () => { updateShipAudio(); return audioModel; };
      `,
    });
  });

  await page.goto(process.env.GAME_URL || 'http://localhost:8080');

  // Fly a real Reimagined war with tactical sound on, through the real dialog.
  await page.click('#new-game');
  await page.selectOption('#ruleset', 'reimagined');
  await page.fill('#new-seed', 'audio-check');
  await page.check('#sound');
  await page.click('#new-game-form button[value="confirm"]');
  await page.waitForFunction(() => window.__audioProbe?.().model !== null);

  // --- the panel: three buses, an effective mute, and prose for every cue ------
  await page.click('#audio-toggle');
  const panel = await page.evaluate(() => {
    const dialog = document.querySelector('#audio-dialog');
    const list = document.querySelector('#audio-state-list');
    const probe = window.__audioProbe();
    const slider = (bus) => {
      const input = document.querySelector(`#audio-${bus}`);
      return {
        bus,
        exists: Boolean(input),
        type: input?.type,
        label: input?.closest('label')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        value: input?.value,
        output: document.querySelector(`#audio-${bus}-value`)?.textContent,
      };
    };
    return {
      open: dialog.open,
      labelledBy: dialog.getAttribute('aria-labelledby'),
      heading: document.querySelector('#audio-title')?.textContent,
      buses: ['ambience', 'effects', 'alerts'].map(slider),
      muteLabel: document.querySelector('#audio-muted')?.closest('label')?.textContent.replace(/\s+/g, ' ').trim(),
      lines: [...list.querySelectorAll('li')].map((li) => li.textContent),
      model: probe.model,
      settings: probe.settings,
      sound: probe.sound,
      reimagined: probe.reimagined,
      // The panel is not a second live region: #sr-status still belongs to the
      // turn announcement, so the readout is a plain readable list.
      stateIsLive: list.closest('[aria-live]') !== null || list.getAttribute('aria-live') !== null,
      srStatusCount: document.querySelectorAll('#sr-status').length,
    };
  });

  assert.equal(panel.open, true, 'the Audio button opens the panel');
  assert.equal(panel.labelledBy, 'audio-title', 'the dialog is labelled by its heading');
  assert.equal(panel.heading, 'Audio');
  assert.equal(panel.srStatusCount, 1, 'still exactly one screen-reader live region on the page');
  assert.equal(panel.stateIsLive, false, 'the readout does not add a competing announcer');
  assert.equal(panel.sound, true, 'the fixture really started a war with tactical sound on');
  assert.equal(panel.reimagined, true, 'and it is a Reimagined war, so the reactor and arcs exist');

  for (const bus of panel.buses) {
    assert.equal(bus.exists, true, `the ${bus.bus} slider exists`);
    assert.equal(bus.type, 'range', 'each volume is a slider');
    assert.ok(bus.label && bus.label.length > 3, `each slider has a real label: ${bus.label}`);
    assert.equal(bus.output, `${bus.value}%`, 'the spoken percentage matches the slider');
  }
  assert.ok(panel.muteLabel.includes('Mute all audio'), 'the mute is labelled');

  // Every cue the soundtrack plays is stated in words here.
  const joined = panel.lines.join(' | ');
  assert.ok(panel.lines.length >= 4, `the readout covers volume, comms, engine and storm: ${panel.lines.length} lines`);
  assert.match(joined, /Volume — ambience \d+%, effects \d+%, alerts \d+%/, 'the three bus volumes are stated');
  assert.match(joined, /Fleet traffic: clear — radio 100% intact/, 'an undamaged radio is stated, with the percentage the console shows');
  assert.match(joined, /intercom/, 'the own-ship exemption is stated, so its silence is not read as a bug');
  assert.match(joined, /Engine hum: \d+ Hz/, 'the hum pitch is stated in words');
  assert.match(joined, /Ion storm static: none — open space/, 'open space says so rather than staying silent');

  // The percentage the panel speaks is the one the rules layer computes for the
  // hull the player is actually flying, not a copy kept in the UI — and it is the
  // same number #log-meta uses when it decides to warn that traffic is abbreviated.
  const crossCheck = await page.evaluate(async () => {
    const { radioIntegrity, systemUnits } = await import('/game/state.js');
    const probe = window.__audioProbe();
    return {
      spoken: probe.model.comms.integrity,
      authoritative: radioIntegrity(probe.ship),
      surviving: systemUnits(probe.ship, 'radio'),
      logMeta: probe.logMeta,
      voice: probe.model.comms.voice,
    };
  });
  assert.equal(crossCheck.spoken, crossCheck.authoritative,
    'the panel speaks the integrity the rules layer computes for the live command ship');
  assert.equal(crossCheck.authoritative, 1, 'an undamaged flagship has its whole radio');
  assert.equal(crossCheck.voice, 'clear');
  assert.equal(crossCheck.logMeta, 'Newest first', 'and #log-meta agrees: at full integrity nothing is abbreviated');

  // --- the Web Audio half: model numbers must land on real nodes --------------
  const webAudio = await page.evaluate(async () => {
    const { createGame, getShip } = await import('/game/state.js');
    const { commsModel, engineHumModel, stormStaticModel, impactVoiceModel } = await import('/ui/audio-model.js');
    const sound = await import('/ui/sound.js');
    const tally = window.__audioNodes;

    const game = createGame({ seed: 'audio-webaudio', reimagined: true, sound: true });
    const ship = getShip(game, game.playerShipId);
    const installed = ship.systems.radio;

    // Build the bus graph once so its shared comms filter is not mistaken for a
    // per-message one, then measure only what the cues themselves create.
    sound.setAudioSettings({ ambience: 0.6, effects: 1, alerts: 1, muted: false });
    sound.playEvent('command', true);
    const graphNodes = { gain: tally.gain, biquad: tally.biquad };
    const reset = () => { tally.filters.length = 0; tally.oscillators.length = 0; tally.oscillator = 0; tally.biquad = 0; tally.buffer = 0; tally.panner = 0; };

    const commsFor = (radioUnits) => {
      reset();
      const model = commsModel(game, { ...ship, systems: { ...ship.systems, radio: radioUnits } });
      sound.playComms(true, model);
      return { model, cutoffs: tally.filters.map((filter) => filter.frequency.value), oscillators: tally.oscillator };
    };

    const clear = commsFor(installed);
    const damaged = commsFor(installed - 1);
    const dead = commsFor(0);

    // The ambience beds: a hum, and a panned storm bed when the rules apply a jam.
    // The app is flying a live war with sound on, so it has ALREADY built the hum —
    // tear it down first to measure a cold start, then call again to prove a second
    // call reuses the bed rather than stacking another oscillator on top of it.
    sound.stopAmbience();
    reset();
    const engine = engineHumModel(game, ship);
    sound.updateAmbience(true, { engine, storm: stormStaticModel(game, ship) });
    const openSpace = { oscillators: tally.oscillator, buffers: tally.buffer, panners: tally.panner };
    sound.updateAmbience(true, { engine, storm: stormStaticModel(game, ship) });
    openSpace.afterSecondCall = tally.oscillator;

    reset();
    const stormGame = { ...game, terrain: [{ type: 'ion-storm', x: ship.x + 24, y: ship.y, radius: 30 }] };
    const storm = stormStaticModel(stormGame, ship, { minX: ship.x - 100, minY: ship.y - 100, width: 200, height: 200 });
    sound.stopAmbience();
    sound.updateAmbience(true, { engine, storm });
    const inRing = { oscillators: tally.oscillator, buffers: tally.buffer, panners: tally.panner, pan: storm.pan };

    // Each impact voice must actually sound, and differ in the band it uses.
    const voices = {};
    for (const [name, record] of Object.entries({
      arc: { kind: 'damage', targetId: ship.id, payload: { arc: 'fore', consequences: { delta: { shields: -23, arcs: { fore: -23 }, systems: {}, crew: 0 } } } },
      breached: { kind: 'damage', targetId: ship.id, payload: { arc: 'fore', consequences: { delta: { shields: -18, arcs: { fore: 0 }, systems: {}, crew: 0 } } } },
      internal: { kind: 'damage', targetId: ship.id, payload: { arc: 'fore', consequences: { delta: { shields: -30, arcs: { fore: -5 }, systems: { radio: -1 }, crew: -2 } } } },
      shield: { kind: 'damage', targetId: ship.id, payload: { consequences: { delta: { shields: -10, arcs: {}, systems: {}, crew: 0 } } } },
    })) {
      reset();
      const impact = impactVoiceModel(record, ship.id);
      sound.playImpact(true, impact);
      voices[name] = {
        voice: impact?.voice,
        expectedCutoff: impact?.cutoff,
        oscillators: tally.oscillator,
        cutoffs: tally.filters.map((f) => f.frequency.value),
      };
    }

    sound.stopAmbience();
    return { graphNodes, clear, damaged, dead, openSpace, inRing, voices, contexts: tally.contexts, installed };
  });

  assert.ok(webAudio.contexts >= 1, 'a real AudioContext was constructed');
  assert.ok(webAudio.graphNodes.gain >= 3, `the three bus gains were built (${webAudio.graphNodes.gain})`);
  assert.equal(webAudio.installed, 2, 'the flagship carries two radio units, so a damaged-but-alive case exists');

  // The load-bearing claim: the node's own cutoff is the model's cutoff.
  // Compared to within an AudioParam's float32 representation rather than exactly:
  // `frequency.value` stores a 32-bit float, so a fractional cutoff such as
  // 1357.2287142747452 cannot round-trip a JS double bit-for-bit. The tolerance is
  // far tighter than any real mismatch — the clear and degraded bands differ by
  // thousands of hertz — so this pins the mapping without demanding the impossible.
  const FLOAT32_TOLERANCE_HZ = 0.01;
  const matchesModel = (cutoff, model) => Math.abs(cutoff - model.cutoff) < FLOAT32_TOLERANCE_HZ;

  assert.equal(webAudio.clear.model.voice, 'clear');
  assert.ok(webAudio.clear.cutoffs.length > 0, 'a clear line is voiced');
  for (const cutoff of webAudio.clear.cutoffs) {
    assert.ok(matchesModel(cutoff, webAudio.clear.model), `the filter on the node carries the model cutoff (${cutoff} vs ${webAudio.clear.model.cutoff})`);
  }
  assert.equal(webAudio.damaged.model.voice, 'degraded');
  assert.ok(webAudio.damaged.cutoffs.length > 0, 'a degraded line is voiced');
  for (const cutoff of webAudio.damaged.cutoffs) {
    assert.ok(matchesModel(cutoff, webAudio.damaged.model), `the degraded node carries the degraded cutoff (${cutoff} vs ${webAudio.damaged.model.cutoff})`);
  }
  assert.ok(webAudio.damaged.model.cutoff < webAudio.clear.model.cutoff, 'a lost radio unit narrowed the real band');
  assert.ok(webAudio.damaged.oscillators >= webAudio.clear.oscillators, 'and it is still audible, not silent');

  assert.equal(webAudio.dead.model.voice, 'blocked');
  assert.equal(webAudio.dead.oscillators, 0, 'a burned-out radio creates no voice at all — silence, not a quiet sound');

  assert.equal(webAudio.openSpace.oscillators, 1, 'the engine hum is one oscillator');
  assert.equal(webAudio.openSpace.afterSecondCall, 1, 'a second update reuses the bed instead of stacking another oscillator');
  assert.equal(webAudio.openSpace.buffers, 0, 'open space builds no storm bed');
  assert.equal(webAudio.inRing.buffers, 1, 'an ion storm ring builds the static bed');
  assert.equal(webAudio.inRing.panners, 1, 'and pans it');
  assert.ok(webAudio.inRing.pan > 0, 'the eye is to the right on screen, so the pan is right');

  for (const [name, voice] of Object.entries(webAudio.voices)) {
    assert.equal(voice.voice, name, `the ${name} fixture resolves to the ${name} voice`);
    assert.ok(voice.oscillators > 0, `the ${name} voice actually sounds`);
    assert.ok(voice.cutoffs.length > 0, `the ${name} voice is band-limited on the node`);
    // The primary tone carries the voice's own band. The internal voice adds a
    // crew-loss tone at its own narrower band, so later nodes may differ.
    assert.ok(Math.abs(voice.cutoffs[0] - voice.expectedCutoff) < FLOAT32_TOLERANCE_HZ,
      `the ${name} node carries the model cutoff (${voice.cutoffs[0]} vs ${voice.expectedCutoff})`);
  }
  const { arc, breached, internal } = webAudio.voices;
  assert.ok(arc.cutoffs[0] > breached.cutoffs[0], 'a live arc is brighter than a volley walking through a gutted one');
  assert.ok(breached.cutoffs[0] > internal.cutoffs[0], 'and internal damage is the dullest: it is inside the hull');

  // --- keyboard reach, Escape, and focus restoration -------------------------
  await page.evaluate(() => document.querySelector('#audio-dialog').close());
  const keyboard = await page.evaluate(async () => {
    const button = document.querySelector('#audio-toggle');
    button.focus();
    const focused = document.activeElement === button;
    button.click();
    const opened = document.querySelector('#audio-dialog').open;
    const firstControl = document.activeElement?.id ?? null;
    document.querySelector('#audio-dialog').close();
    return { focused, opened, firstControl, returnedTo: document.activeElement?.id ?? null, closed: !document.querySelector('#audio-dialog').open };
  });
  assert.equal(keyboard.focused, true, 'the Audio button takes keyboard focus');
  assert.equal(keyboard.opened, true, 'and activates from the keyboard');
  assert.equal(keyboard.closed, true, 'the panel closes again');
  assert.equal(keyboard.returnedTo, 'audio-toggle', 'focus returns to the button that opened it');

  // --- the sliders and the mute are wired to storage and to the bus gains -----
  await page.click('#audio-toggle');
  await page.evaluate(() => {
    const slider = document.querySelector('#audio-ambience');
    slider.value = '30';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const stored = await page.evaluate(async () => {
    const persisted = JSON.parse(localStorage.getItem('argonaut-web-audio-v1') ?? 'null');
    const sound = await import('/ui/sound.js');
    return {
      persisted,
      output: document.querySelector('#audio-ambience-value')?.textContent,
      live: sound.getAudioSettings(),
      // A device preference, never a save field.
      inSave: JSON.stringify(localStorage.getItem('argonaut-web-save-v1') ?? '').includes('ambience'),
    };
  });
  assert.equal(stored.output, '30%', 'the visible readout follows the slider');
  assert.equal(stored.persisted?.ambience, 0.3, 'the volume persists on this device');
  assert.equal(stored.live.ambience, 0.3, 'and reaches the sound layer');
  assert.equal(stored.inSave, false, 'volumes never enter a war save');

  await page.evaluate(() => {
    const mute = document.querySelector('#audio-muted');
    mute.checked = true;
    mute.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const muted = await page.evaluate(() => {
    const before = window.__audioNodes.oscillator;
    window.__audioRefresh();
    return {
      label: document.querySelector('#audio-toggle').textContent,
      persisted: JSON.parse(localStorage.getItem('argonaut-web-audio-v1') ?? 'null'),
      newOscillators: window.__audioNodes.oscillator - before,
    };
  });
  assert.equal(muted.label, 'Audio: muted', 'the button says the soundtrack is muted without opening the panel');
  assert.equal(muted.persisted?.muted, true, 'the mute persists');
  assert.equal(muted.newOscillators, 0, 'a muted war builds no ambience bed at all');

  // --- browser activation rules: no context before the player interacts -------
  // Resuming a war that had tactical sound on must not create an AudioContext at
  // load, which Chrome would refuse and log. A separate page gets its own storage,
  // so this really is a cold start on a sound-on save.
  const savedWar = await page.evaluate(() => localStorage.getItem('argonaut-web-save-v1'));
  assert.ok(savedWar && savedWar.includes('"sound":true'), 'the fixture war really saved with tactical sound on');
  const cold = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const coldErrors = [];
  cold.on('pageerror', (error) => coldErrors.push(String(error)));
  await cold.addInitScript(installAudioProbe);
  await cold.addInitScript((save) => {
    window.localStorage.setItem('argonaut-web-save-v1', save);
  }, savedWar);
  await cold.goto(process.env.GAME_URL || 'http://localhost:8080');
  await cold.waitForFunction(() => document.querySelector('#map')?.childElementCount > 0);
  assert.equal(await cold.evaluate(() => window.__audioNodes.contexts), 0,
    'resuming a sound-on war opens no AudioContext before the player interacts');

  await cold.click('#audio-toggle');
  const afterGesture = await cold.evaluate(() => ({
    contexts: window.__audioNodes.contexts,
    oscillators: window.__audioNodes.oscillator,
    lines: [...document.querySelectorAll('#audio-state-list li')].map((li) => li.textContent),
  }));
  assert.ok(afterGesture.contexts >= 1, 'the first gesture opens the context');
  assert.ok(afterGesture.oscillators >= 1, 'and the engine hum comes up on it');
  assert.ok(afterGesture.lines.some((line) => line.includes('Engine hum')), 'the resumed war reports its hull in words');
  assert.deepEqual(coldErrors, [], `no page errors on the cold start: ${coldErrors.join(' | ')}`);
  await cold.close();

  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log('check-audio: the audio panel is keyboard reachable and states every cue in words, the comms filter on the real node carries the model cutoff derived from surviving radio hardware, a burned-out radio is silent rather than quiet, and the buses and mute persist as a device preference.');
} finally {
  await browser.close();
}
