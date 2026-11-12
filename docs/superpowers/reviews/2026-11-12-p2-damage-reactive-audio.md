# Damage-reactive audio (P2)

Date: 2026-11-12. Slice **P2** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).

## What it does

`ui/sound.js` stops being a set of beeps and becomes a model of the hull the
player is flying. Four mappings, each read from a rule that already existed:

- **Incoming fleet traffic narrows as the radio is shot out.** A lowpass cutoff
  tracks surviving radio hardware, and falls silent when none is left. This is the
  slice's distinctive opportunity: the journal prose is *already* truncated in
  proportion to the same number (`abbreviateNarrative`), and the console *already*
  prints "radio at N%, traffic abbreviated". A burned-out radio now sounds
  burned-out for the same reason the text goes short, rather than merely quieter.
- **The engine hum tracks the engine sink.** Pitch follows
  `powerEffect(game, ship, 'engines')`, so overcharging the engines raises it and
  starving them drops it.
- **Ion-storm static.** Full and centred in the jamming core, half-strength and
  panned toward the eye in the outer ring — the two zones where the rules already
  penalise the hull.
- **A blow on your own hull has three distinct voices**: a live arc throwing the
  volley, a volley walking through an arc that was already gutted, and damage that
  reached the internals (duller and centred, because it is inside the hull).

Plus a shield-surplus cue on the reactor trickle, an **Audio** button in the top
bar with separate ambience/effects/alerts volumes and an effective mute, and a
panel that states every one of those cues in words.

## Design decisions worth recording

**A pure model, and a thin renderer.** `ui/audio-model.js` is new and pure: it
takes `(game, ship)` or a record and returns numbers. It imports only from
`game/`, touches no DOM and no Web Audio, holds no state and creates no RNG.
`ui/sound.js` only turns those numbers into nodes. The split is what makes the
mappings testable — **every number in this slice is pinned by `npm test`, not by
ear**, and the browser check then proves the numbers reach real audio nodes.

**`git diff game/` is empty.** No rules-layer change, which is stronger evidence
than a parity run that classic behaviour and the CALIBRATION baselines cannot have
moved. No sim run was done for the same reason; see *Verification*.

**The comms filter is the prose rule, not a parallel invention.** `commsModel`
composes reach exactly as `radioReaches` does — hardware integrity times the storm
factor — so the audio degrades where the text degrades and goes silent where the
journal drops fleet traffic (`projectJournalRecord` returns null once
`radioIntegrity` hits 0, because `radioKnown` requires `radio > 0`). A test pins
that three-way agreement directly. The browser check pins the cross-surface
number: the percentage the panel speaks equals `radioIntegrity` of the hull the
player is actually flying, and `#log-meta` agrees.

**Own-ship lines are deliberately exempt, and deliberately not voiced as comms.**
`abbreviateNarrative` keeps any entry beginning with the ship's own name — its
contract says those "reach you over the intercom, not the radio". Giving your own
lines a degraded voice would have contradicted the text, so the exemption is
mirrored by *not* filtering them, and stated in words in the panel so the silence
is not read as a bug. An early draft carried an `intercom` branch in the renderer
for this; it was dead code and was removed rather than shipped.

**Impact voices read the record batch, not the battle events.** This was the one
place the obvious seam was wrong. `arc` is *not* on the battle event:
`ui/battle-events.js` has no arc field at all, and the ordinary volley paths in
`game/turns.js` call `fireEvent(kind, actor, target, hit)` with no details. The arc
lives on the **damage record** payload, alongside `consequences.delta`. So the
voices are driven from `collectRecords` (app.js), the same raw batch L1 will use,
before any journal truncation.

Recomputing `struckArc` at sound time was the tempting alternative and would have
been wrong: events are queued 160 ms apart, and by the time one sounds the hulls
have moved, so it would have described a geometry that no longer existed. The
record describes the blow that was actually recorded.

**The arc/breached distinction falls out of `damageShip` rather than being
guessed.** `damageShip` spends the struck arc's *own* pool first, and
`arcs = { ...bled, [arc]: pool - absorbed }` means the struck arc's delta is
exactly minus what it absorbed. So `delta.arcs[struck] < 0` **is** "the arc held",
and `=== 0` with shields still moving **is** "the arc was already gutted and the
volley walked through". That is precisely the case the round-23 durability lever
exists to make costly, so it is the one worth sounding different. Verified against
real records, not assumed — see the tally below.

**A hit on your own hull is no longer sounded twice.** `showEvents` previously
played a generic weapon sound for any event touching the player. Now it excludes
`toId === playerShipId && hit`, because the record-driven impact voice covers
exactly that case and two simultaneous sounds per hit is noise, not information.
Outgoing fire and incoming misses are unchanged. This is safe because
`enableBattleRecords` is unconditional (app.js:128 for a loaded war, and at every
creation site including campaign, practice and operations), and because
`collectRecords` runs before `showEvents` on **every** path — dispatch, computer
turns, the real-time sub-tick loop, and both auto-resolve seams.

**Volumes are a device preference, never a save field.** They live in
`argonaut-web-audio-v1` in localStorage, following the `ART_KEY` precedent whose
comment says exactly this ("a localStorage setting like the theme — never game
state, never a save field"). `sound` itself stays on `game`, so the per-war
"Tactical sound" tick remains the master enable and the save envelopes are
untouched — the browser check asserts the volumes never appear in a save.

**Defaults leave the existing soundtrack alone.** Effects and alerts default to
gain 1.0, and a `GainNode` at unity is transparent, so a player who ticks Tactical
sound and never opens the panel hears the volleys, hits and klaxon exactly as
before. Only ambience defaults lower (0.6), because it is new and continuous.

**Browser activation rules are respected, and that is tested.** A context created
before a gesture is born suspended and Chrome logs a refusal, so the continuous
beds never create one themselves: they reuse an existing context or wait for the
first `pointerdown`/`keydown`, replaying the last requested state so the hum comes
up *on* the gesture rather than on the next render. One-shot cues keep their
pre-existing lazy behaviour.

**No second live region.** The guardrail is to preserve the single `#sr-status`,
and `ui/render.js` rewrites it on every `renderGame`. A competing announcer would
either be clobbered or clobber the turn announcement, so the text equivalent is a
plain readable list in the audio panel instead — and the underlying facts already
have their own text (arc damage is named in the journal, radio integrity is a
percentage on screen, the storm jam is an unavailability reason, the reactor budget
is drawn by the schematic). The check asserts there is still exactly one
`#sr-status` and that the panel is not `aria-live`.

**The surplus cue is rate-limited because it is measured to be frequent.** The
reactor trickle fires on most stardates: **2,015 `repair`/`reactor-regeneration`
records across three wars** (~672 per war). Cueing every one would be a metronome
rather than information, so it is capped at one per 4 s and routed to ambience.

**Replay and playback locks are untouched.** `collectRecords` is documented as
"consume once at authoritative seams, never from drawing, replay or loading", so
round replay and terminal presentation voice nothing — the same as before.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **1015 pass, 0 fail** (11 new in `test/audio-model.test.js`, up from 1004) |
| `node scripts/check-guide-content.mjs` | passes; **29** local links (was 28 — the new guide cross-reference), 20 illustrated references, 33 command types |
| Enforced browser suite | **16/16 pass**, 196.9 s cumulative — `check-audio` was picked up automatically by suite discovery, so the enforced suite grows from 15 to 16 of 19 |
| `check-audio` stability | **9/9 consecutive runs green** (6 before the final edit, 3 after) |
| `git diff game/` | **empty** — no rules-layer change |

No `npm run sim` was run. The guardrail ties the sim and a CALIBRATION row to
rules-layer slices; `game/` has zero diff here, so no winner share can have moved.
That is recorded rather than left implicit.

**The four impact voices were measured on real wars**, not just on fixtures. Three
full Reimagined wars, voices derived from every `damage` record the rules emitted:

| Voice | Count | Meaning |
| --- | --- | --- |
| `arc` | 419 | the struck arc's own pool absorbed it |
| `internal` | 1207 | crew or a subsystem was lost |
| `shield` | 136 | positional damage on the total pool (ion, splash, a hull without arcs) |
| `breached` | 4 | the struck arc was already gutted and the volley walked through |

`breached` being rare is the point: it is the sound of a flank that has already
been opened, and it should not be common. The Node suite asserts all four on
hand-built records shaped from a real one, and *also* runs a real war and asserts
the voices it produces — including that every `arc` voice really has
`arcLoss > 0` and every `breached` voice really has `arcLoss === 0` with the pool
behind it taking the blow. A shape-pinning assertion means a future change to the
record layer fails the test instead of silently muting the audio.

Reference numbers for the mappings, all pinned by tests:

| State | Result |
| --- | --- |
| Radio intact (flagship, 2 units) | `clear`, cutoff **3400 Hz** |
| One radio unit lost | `degraded`, cutoff **1357.23 Hz**, resonance up from 0.7 to 2.35 |
| No radio units | `blocked`, gain **0** — no nodes created at all |
| Ion storm core | comms `blocked`; static gain 1.0, pan **0** (centred — no useful direction inside it) |
| Ion storm ring | reach halved again; static gain 0.5, panned to the eye's screen position |
| Engines nominal / overcharged / starved | hum **110 / 139 / 81 Hz** |
| Classic hull | `powerEffect` is 1, so **110 Hz**, and `share` is `null` — no reactor key, so no share is claimed |

**The browser check covers what Node cannot: the Web Audio half.** It wraps the
`AudioContext` constructor and the node factories before any module loads, then
reads the created nodes back. The load-bearing assertion is that **the
`BiquadFilterNode`'s own `frequency.value` equals the cutoff the model computed
from surviving radio hardware** — for the clear band, the degraded band, and each
impact voice. A blocked receiver must create **zero** oscillators, because silence
is the point rather than a quiet sound. It also asserts a second `updateAmbience`
reuses the hum instead of stacking another oscillator, that muting builds no bed
at all, that the panel is keyboard reachable with focus returned on close, and
that a cold load of a sound-on save creates no context before the first gesture.

**That last guard was verified to fail without the fix.** Replacing the gesture
gate with an unconditional `ctx()` turns the run red with
`resuming a sound-on war opens no AudioContext before the player interacts`, and
restoring it turns it green again. It is not a vacuous assertion.

## Traps found, recorded so the next slice does not repeat them

- **`AudioParam` values are float32.** The first attempt asserted the node's
  cutoff `===` the model's cutoff. That passes for the clear band (3400 is exactly
  representable) and fails for the degraded band, because 1357.2287142747452
  cannot round-trip a double through a 32-bit float. The fix was to correct the
  test's premise with a 0.01 Hz tolerance — four orders of magnitude tighter than
  any real mismatch, since the two bands differ by ~2000 Hz — **not** to weaken
  what is being pinned. Anyone comparing an `AudioParam` against a computed double
  will hit this.
- **"One oscillator" failed because the app was already right.** The hum assertion
  initially read 0 instead of 1: the app is flying a live sound-on war, so it had
  *already* built the bed and the second call correctly reused it. The tempting
  fix was to loosen the count; the correct one was to tear down first to measure a
  cold start, then call again and assert the count stays at 1 — which turned a
  confusing failure into a node-leak guard that did not exist before.
- **Negating a zero delta yields `-0`.** `-(delta.arcs[arc] || 0)` returns `-0`
  when the arc was untouched, and `assert.equal` distinguishes `-0` from `0`. Fixed
  in the model by flooring losses at zero, which is also the semantically right
  answer: a record that *restored* an arc is not a blow.
- **`arc` is on the record, not the event.** Recorded above, but worth repeating as
  a trap: `grep arc ui/battle-events.js` returns nothing, and reading
  `game/turns.js` shows `fireEvent` called without details on the ordinary volley
  paths. The data was there all along, one layer over.

## Not done here

- **No screenshot in the illustrated guide.** The guide prose describes the panel
  and every cue, but `assets/guide/` was not re-captured — every guide PNG is
  hash-verified in CI via `assets/guide/manifest.json`, so re-capturing is a
  separate deliberate act. This is the same follow-up P1 left open, and the two
  should probably be captured together.
- **Fleet traffic chirps are rate-limited to one per 900 ms**, not voiced per
  message. A busy battle therefore does not chirp for every record. Voicing each
  one would need a decision about what a player is meant to learn from the count.
- **The comms filter is one transition behind the text.** `collectRecords` runs
  before `game` is reassigned, so the state available at the seam is the pre-state
  for that batch: a radio knocked out by this very resolution is still heard
  clearly, and the next traffic is not. The journal has no such lag because each
  record carries its own stamped `knowledge.radioIntegrity`. Fixing it properly
  would mean voicing after the state update, which decouples the cue from the
  record batch that justifies it — not obviously a better trade for one beat of
  lag on one filter. Recorded rather than papered over.
- **No per-hull spatialisation beyond the storm.** Impact voices on your own hull
  are centred by design (it is your hull), but incoming fire from other hulls is
  not panned by world position. The events carry coordinates, so this is
  achievable; it was left out because the honest listener position for a fleet
  action is not obvious.
- **No Classic-mode browser check.** The model demonstrably degrades correctly in
  Classic (unity `powerEffect`, `null` share, no arcs so the positional `shield`
  voice), and that is pinned in Node, but the browser check flies a Reimagined war
  because that is where the reactor and arcs exist.
- **The three quarantined checks were left alone**, per the standing decision. The
  enforced suite is 16 of 19.
