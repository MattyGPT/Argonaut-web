# Arc-impact FX and wreck debris (P3b)

Date: 2026-11-13. The second increment of slice **P3 — persistent damage and impact
FX** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md),
completing it. Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Builds directly on [P3a](2026-11-13-p3a-battle-scarring.md), which put the durable
half on the hull; this is the moment-of-impact half.

## What the player gets

- When an **aimed** volley lands, the shield arc that threw it flares: a bow of
  light just outside the plating on the quarter that took the hit, coloured for the
  weapon — phaser warm, warhead white-hot, spread pale gold, ion cold. The impact
  ring also moves off dead centre to the struck edge, so a raked flank is visible
  *as it happens* and not only afterwards in the scarring.
- Ion and spread splash flare **nowhere**, because they reach the frame without
  favouring a side, and a miss flares nowhere because nothing was struck. A flare
  on a direction the rules never used would be a claim the fight did not make.
- A destroyed hull leaves a **debris field** where it fell — charred fragments, a
  scorch halo, embers still holding their heat — for the rest of the engagement.

## The arc arrives on the event

`struckArc` was already computed at every site that resolves an aimed hit, for the
shield breakdown; the fire events simply did not carry it. Four call sites now pass
it in the details bag `fireEvent` already spreads: the player's aimed volley, the
autopilot's, the real-time warhead detonation, and the spread salvo's **primary**
hit (its splash on secondary hulls is positional and stays unaimed). Ion events stay
arc-less by construction.

The field is a presentation payload on a transient event: it is not stored in
`game`, not recorded, not replayed, and no rule reads it. The four-profile sim diff
against the P3a baseline is byte-identical, which is the proof that adding it moved
nothing.

## Geometry: screen pixels, not world units

Hulls are a constant **screen** size — a 3rem sprite — whatever the camera zoom,
while the FX layer is drawn in world units through a viewBox that tracks the camera.
A world-unit offset would therefore crawl across the hull as the player zooms. So
`screenScale` derives world-units-per-pixel from the live viewBox against the live
box, `struckPoint` computes the direction from target back to shooter **in screen
space** (the physical fact of which side was struck — the same fact `struckArc`
buckets into a name), offsets by a pixel constant, and converts back per axis
because the map's projection is not square. The flare is an SVG arc of the same
screen-constant radius, spanning the ~71° the arc covers, drawn once per volley.

## Debris has no lifetime to manage

The tempting shape for debris is a timed effect like every other FX, and that is
exactly the shape that leaks: the fx layer is only torn down when playback finishes
or the playback mode changes, so a timed scatter would need a new clear on every
path that starts a war. Instead the field is **part of the wreck element** — a
masked-free overlay span carrying ten background layers — which the renderer
rebuilds on every redraw, follows through every camera move, and a new war simply
does not contain. There is nothing to forget to clear.

Positions come from the same FNV-1a hash as P3a's decals, so a given hull always
sheds the same field on every render and every machine, with no RNG stream touched.
Every shard sits inside an overlay that overshoots the hulk by a tenth of its box:
debris that drifted far enough to reach a neighbour would read as dirt on that
neighbour's hull rather than as this one's wreckage. At compact density the hulk
shrinks to a marker and the field goes with the art; under Letters there is no hulk
to lie in, so none is drawn.

## Words, and why the flare needs none of its own

The guardrail is that nothing is graphics-only. The flare is transient emphasis of a
fact that already has three durable word-forms: the journal line narrating the
volley, the arc readout on the sensor card, and P3a's **Frame** section, which keeps
per-arc scarring in words for the rest of the war. The debris field's fact — that a
hull was destroyed here — is carried by the wreck's accessible name ("destroyed
wreck") and by the journal's destruction line; the field itself is `aria-hidden`
decoration on top of a `role="img"` element whose label is unchanged by the picture.

## The check, and why it stubs the app

`check-arc-impact` is the only check in the suite that replaces `app.js` with an
empty module, and the header says why. Unlike the other fixture checks it **must**
await inside the page: `playEffects` staggers its non-terminal draws through
`setTimeout`, and a flare's 420 ms lifetime has to be observed over real
milliseconds. Every await is a window in which the live app's own loop redraws its
own war over the private fixture — measured, not theorised: with the app live, the
target hull's element intermittently vanished between the draw and the measurement.
`index.html` still supplies the DOM skeleton `renderGame` and `playEffects` write
into; nothing else about the app is under test here.

What it pins: an aimed hit that names an arc throws a flare, coloured for the
weapon; ion and misses throw none; the impact ring lands on the shooter's side of
the target's centre at the plating's edge (8–26 px), and the flare bows beyond it on
the same side (the flare is a bow, so its bounding box centres past its own radius —
the bound says so rather than pretending otherwise); the flare removes itself once
its beat is over; the debris field is ten layers on one span, barely overshoots the
hulk, is hidden at compact density and absent under Letters; and under
`prefers-reduced-motion` the flare collapses to `.01s` exactly as every other impact
effect does — suppressed in feel, not in fact.

## Verification

- `npm test`: **1102/1102** (was 1097; `test/arc-impact.test.js` adds 5 — the arc on
  the event for an aimed hit, its absence on misses and ion, the spread primary's
  arc, and the debris field's determinism and bounds).
- Enforced browser suite: **24 of 26 discovered**, the new `check-arc-impact` among
  them; the two pre-existing quarantined checks untouched.
- `node scripts/check-guide-content.mjs`: green with the new guide and README prose.
- Four-profile sim parity against the P3a baseline (`origin/main` at the P3a merge):
  **byte-identical**, so no CALIBRATION row moves.
- `scripts/check-record-parity.mjs`: green — the arc lives on transient events,
  which neither the game state nor the records contain.

## P3 is complete

With P3a and P3b together, every gate the delivery plan set for slice 8 is met: the
authoritative damage-history field Matt ruled for; decals and their word
equivalents; arc-impact FX; persistent debris; a before/after frame measurement on
the renderer (`check-scarring`, deltas within noise); and reduced-motion respected
by both increments. Track P now has only **P4** left, gated on a production-cadence
frame measurement that has never been taken.
