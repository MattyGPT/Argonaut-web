# Program research findings: renderer, replay determinism, chronicle substrate

Date: 2026-11-11. Three read-only research passes commissioned at the opening of
the [presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md),
consolidated here because slices P1–P4, S1–S5 and L1–L3 all depend on them.
Every claim below was reported with a `file:line` citation against `main` at
`f1050ce`; line numbers will drift, so re-verify before editing. **One finding
invalidates an assumption the program spec was written on, and it is called out
in §2.**

## 1. Renderer architecture (feeds P1, P3, P4)

**The renderer is a pure state → HTML-string projection.** `render()`
(`ui/render.js:945`) rebuilds the whole map each frame: `shipElements` (`:1005`),
`terrainMarkup` (`:1049`), `ringsMarkup` (`:1054`), `lockMarkup` (`:1060`),
`warheadsMarkup` (`:1083`), assigned to `map.innerHTML` at `:1100`. There is **no
diffing or keyed reconciliation for the map** — the pattern exists elsewhere
(`ui/command-priorities.js:54` compares `previousMarkup` and restores focus by
`focusId`) and is the model to copy if the map ever needs it.

**Where the bytes go.** In the small operation scene, roughly 15.7 KB of HTML per
frame: terrain ~3.9 KB plus rings ~8.4 KB — **78% of the total** — against only
~1.5 KB for ships. Rings are rebuilt from scratch every frame and are identical
whenever camera, theme and ruleset are unchanged.

**The DOM is the hit-test surface.** Click → world mapping uses
`getBoundingClientRect` (`ui/input.js:164-167`, `:230-232`, `:333-336`), and the
hull context menu is positioned off the sprite's rect (`ui/input.js:203-213`,
`ui/render.js:578-589`). A canvas renderer therefore needs a coordinate-math
layer, a spatial index, and a separate accessibility tree — not just a draw call.

**Test and check coupling.** **173 assertions across 8 test files pin renderer
output as literal HTML strings** (35 in `test/render.test.js` alone). **6 of the
17 browser checks depend on map DOM structure** — `check-faction-identity`
(heaviest), `check-tow-credit`, `check-target-readiness`, `check-compact-playback`,
`check-guide`, `check-operations` — using selectors like
`#map .ship-sprite[data-ship-id]`, `.sprite-body`, `.stack-tether` and
`.ship-menu-tail`.

**Accessibility surface that any renderer change must replace.** `#map` is a
focusable scrollable region with roving arrow-key navigation
(`ui/render.js:1124-1152`). `#ship-status` is the *one* deliberate `aria-live`
polite region (`ui/render.js:1205-1210`) — a documented decision, after the whole
page was once a live region and announced the board on every keystroke.
Per-sprite screen-reader text lives in `.sprite-sr-only` (`ui/render.js:1163`,
`:304-331`). The minimap is `aria-hidden` *because* `#map` already exposes the
same information (`ui/render.js:730`). Dialog focus restoration is a contract
(`ui/input.js:50-52`). Reduced motion suppresses the glide and trail
(`ui/render.js:1014-1016`) and the sensor-card sweep (`styles.css:919`).
Separately, `ui/render.js:1170` suppresses the native tooltip for card-eligible
hulls so two readouts never overlap — a canvas rewrite must reproduce that.

**Conclusions.**

- **P1 (ship schematic) is self-contained and does not touch `#map` at all.** It
  is the cheapest large feel win available, with no renderer risk. Nothing
  blocks it.
- **P3 is achievable on the current DOM renderer.** Damage decals are per-ship
  and free, inside the existing `shipMarkup`. Impact FX is where cost lands:
  `ui/fx.js` already carries a hardcoded `MAX_EFFECTS = 400` and a 48 ms budget
  (`ui/fx.js:17`, `:32`), shared with existing beams and warheads, so new FX must
  be measured against that budget rather than assumed to fit.
- **P4 should be a partial migration, not a wholesale one.** Terrain and rings —
  78% of the bytes, zero interaction semantics, zero accessibility surface — are
  the obvious canvas candidates. Ships should stay DOM, which preserves hit
  testing, the a11y tree, and the 173 string assertions. A full migration is
  only justified if ship count forces it, and it would break DOM hit testing,
  those 173 assertions, 6 browser checks, per-sprite screen-reader text, and the
  roving focus model.
- Modules a migration would **not** touch: `ui/camera.js` (pure world ↔
  viewport), `ui/terrain-art.js` (pure geometry → markup), `ui/fx.js` (own
  `#fx-overlay` layer), `ui/contacts.js` and `ui/faction-identity.js` (pure
  data), `ui/command-priorities.js` (separate `#objectives` subtree),
  `ui/tow-preview.js` (returns data), `ui/sector.js` (own subtree).

## 2. Replay determinism (feeds S1–S5) — **assumption invalidated**

**The recording seam already exists and is exactly one place.** `withBattleAction`
is called for the player at a single site: `app.js:838-846`, inside
`executeAction`, wrapping the pure reducer `runAction(game, action) → {game,
messages}`. `game/ai.js` never calls it — captains consume no actions — so the
seam separates player commands from captain decisions cleanly, which is what S1
needs.

**Real time is the hard part.** A manual command occupies the conn for
`commandCycleStardates` (default 1); that shared command cycle is the
serialization mechanism. A replay must record the simulation time and re-apply
through the same cycle, not merely replay the action list in order.

**Exact replay is NOT achievable today.** The authoritative path contains
`Math.random()`:

- `game/realtime.js:129` — hyperspace arrival
- `game/realtime.js:182` — drone intercept
- `game/turns.js:335` — vendetta hunt target
- plus roughly eight further `Math.random()` sites in `game/`

`crypto.randomUUID()` supplies battle IDs (`game/battle-records.js:22`). By
contrast `ui/sound.js`'s `Math.random()` noise buffer is presentation-only and
correctly outside the authoritative path.

This contradicts the README's claim that *"Matching seeds, options, and orders
at the same simulation times reproduce a real-time run."* That holds for the
paths the harness exercises, but not universally, because these sites are not
seeded. **Track S must therefore begin with a determinism slice — replacing
these `Math.random()` calls with seeded sub-streams — before S1 records anything,
or every replay built on top will be approximate and untestable.** The program
spec anticipated exactly this contingency ("If exact replay is not achievable
without rules-layer changes, Track S is re-scoped before S1 is written"); this is
that re-scope, and it is a rules-layer change carrying the full measurement
discipline, not a presentation-only gate.

The existing per-round playback (`roundPlayback`, `replayEffects`, the `replay`
action at `app.js:922`) is a **visual re-animation of an already-resolved round**,
not a state replay. S2 is new machinery, not an extension of it.

## 3. Chronicle substrate (feeds L1–L3)

**44 distinct record kinds** are emitted through `emitBattleRecord`. Only **9**
are `globalTerminal` — broadcast regardless of what the observer could see:
`destruction`, `surrender`, `colors-struck`, `battle-outcome`, `command-loss`,
`command-transfer`, `ace`, `hull-extracted`, `operation-resolved`. Four further
`operation-*` kinds are gated on `game.operation` existing.

**In an ordinary (non-operation) war, only 7 kinds reach the player
unconditionally**: `destruction`, `surrender`, `colors-struck`, `ace`,
`command-loss`, `command-transfer`, `battle-outcome`. Everything else is filtered
by `snapshotKnowledge` (`game/battle-records.js:60-88`) on `own`, `friendly`,
`visible` (mapper range plus nebula hiding), `scanned`, `radioContact` and
`radioIntegrity`. That filter is the honesty boundary a chronicle must respect.

**The hook point is a design decision, not a lookup.** At war's end no records
exist: `app.js:1337-1342` consumes the only batch and discards it. Two coherent
options:

- **(A) Accumulate in `app.js`** as a presentation artifact. Zero rules-layer
  change, honest per-event filtering at emit time. Lost if the tab closes
  mid-war.
- **(B) Retain bounded in state.** Survives reload, but must be bounded and must
  be kept out of save parity.

`finishBattleResolution` (`game/battle-records.js:96-105`) is the existing narrow
boundary where batches surface, and is the right accumulation point for either
option. **Recommendation: option A, plus one new emission inside the
already-instrumented `creditTowCollision`** (`game/battle-records.js:146-154`).
That function already attributes a tow-ram kill internally and nothing emits it —
so the single most vivid thing that can happen in a war (a hull towed into the
rocks) is currently unattributable. One emission, inside existing instrumentation,
makes L1 substantially better without touching the rules layer.

**Memorable moments (L2), split by what exists today.** Detectable from current
records: last-stand self-destruct, tow-ram (with the one new emission above),
ace threshold crossing (`recordAceCrossing` already emits it), a hull striking
its colors, a prize taken and later recaptured, a self-destruct blast, command
loss, and the war outcome. **Requiring new instrumentation:** relay-node control
transitions, a hyperspace escape, collision *pairs* (only a per-hull `collisions`
counter exists), and a drone wing orphaned by its carrier's destruction (no
record is emitted at all).

**Persistence bounds.** `game/service-records.js` caps detailed history at
`MAX_SERVICE_ENTRIES = 100` (`:9`), evicting oldest-first but retaining every
entry marked `milestone: true`, with lifetime counts kept regardless.
`shipConsequences` (`game/battle-records.js:42-58`) is a pure before/after diff
primitive and is never persisted.

**Reuse, do not duplicate.** The battle journal, the terminal-events machinery in
`ui/battle-events.js`, and the radio-damage truncation in `game/actions.js:787-798`
already produce the register a chronicle wants. The chronicle should compose
those sentences rather than invent a second voice.
