# Battle scarring (P3a)

Date: 2026-11-13. The first increment of slice **P3 — persistent damage and impact
FX** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Implements Matt's ruling of 2026-11-12: **a new authoritative damage-history field,
not derived wear.**

P3 is split the way S2 was. This increment is the durable half — the field, its
recording, its persistence, its carry-over, its removal, and the picture and the
words that show it. **P3b** (arc-impact FX that show which shield arc a volley
struck, and debris that persists where a hull died) is the second, and is still
queued.

## What the player gets

A hull that has been shot at looks like it.

- Every volley that gets **past the shields** leaves a mark on the frame, on the
  arc it came in on. Phaser burns, warhead strikes, spread splash, ion scoring,
  collision gouges and shrapnel pitting each paint differently.
- The marks **stay**. Shields regenerate, the reactor tops the pool back up, a
  dockyard rebuilds burnt hardware — none of that repaints the hull. A prize taken
  in the first war of a campaign still wears the burns it was taken with in the
  fifth.
- A frame that has taken enough also **dulls** — desaturated, a shade darker — so
  a veteran reads next to its sisters at a glance, which is the only cue that
  survives a 48px sprite.
- The same facts are stated in words everywhere the picture appears: the hull's
  accessible name and tooltip say *battle-scarred*; the sensor card gives the full
  sentence; the interior schematic gains a **Frame** section listing each flank
  that was reached, what kind of fire did it, and how deep.
- Only the dockyard takes scarring off, and only while it has the hull open: a
  starbase yard works one mark out per stardate it is repairing, and a campaign
  **system overhaul** refinishes the frame as part of the rebuild.

## The field

`ship.scars` is an ordered list of `{ cause, arc?, weight }`. Three properties are
the whole design:

**A mark is earned only when a volley reaches the hull.** `scarShip` compares
`internalsOf` — crew plus live subsystem units — before and after. If the pool
soaked the strike whole, nothing inside moved and the frame stays clean. That is
what makes the record honest *and* what makes it dramatic: a fresh hull under a
probing fire stays pristine, and the scarring begins at the exact moment the fight
starts going badly.

**It is recorded at one choke point.** Every damaging path in the engine funnels
through `damageShip` (aimed volleys, spread splash, collision cripples, self-destruct
shrapnel, asteroid-arrival strikes) or `ionDamage`. The wrapper records; the six
call sites only name their `cause` and pass the `arc` they had already computed for
the shield breakdown. No call site can forget, and no new geometry is computed.

**No rule reads it.** Scarring is recorded, persisted, carried and cleaned; nothing
in the engine consults it to decide a roll, a range or an outcome. That is the
reason the sim baselines hold, and it is pinned three ways: a test runs the same
damage through two identically seeded generators against a hull with a mark list
and one without and requires the wounds to be byte-identical; the four-profile sim
diff is empty; and `scarShip` takes no RNG and no game at all.

Classic hulls never gain the key — `createShip` adds `scars: []` under the same
`reimagined` condition that adds `arcs` — so a classic hull's serialized shape stays
byte-identical and classic parity needs no branch at any call site.

### Coalescing, and the total that is deliberately not quoted

Marks coalesce by `(cause, arc)`: a flank raked by twenty phaser salvos carries one
deep phaser mark, not twenty spots. `weight` counts the strikes and caps at
`SCAR.maxWeight`; the list caps at `SCAR.maxMarks`, and once full a genuinely new
kind is dropped rather than evicting an older one. The list is a picture of the
worst of a hull's history, not a ledger of all of it.

That made an obvious sentence dangerous. `shotsTaken` looks like the honest
denominator — "36 strikes absorbed in all" — and the first version of the summary
quoted it. The browser check printed the result on a veteran hull and it read
**"3 marks on the frame; 0 strikes absorbed in all"**, because `shotsTaken` is not
one of the fields a campaign carries between battles: it restarts at zero while the
marks earned in the last war are still on the frame. Worse, `shotsTaken` is a
*rule input* — `game/turns.js` detects which hulls a spread splash caught by its
delta, and `game/practice.js` gates a drill hint on it — so carrying it to fix a
clause of prose would have been a rules change. The clause went instead. "N marks on
the frame" counts exactly the thing it counts.

## Only the dockyard removes damage

Two yards, one rule: scarring comes off only while the yard already has the hull
open.

- **In battle**, `resolveDockingRules` cleans one mark per stardate alongside the
  shields, crew and hardware it is already restoring. Deliberately *not* a line in
  the docking message: a per-hull per-stardate notice is noise, the decals show it
  happening, and the Frame section says it in words. It also cannot move a record —
  the `dockyard` branch of `recordRuleChanges` gates on shields, crew and systems,
  none of which cleaning the frame changes.
- **In a campaign**, a paid **system overhaul** refinishes the frame, because an
  overhaul strips the frame open and rebuilds every burnt unit anyway. Shield repair
  and crew replenishment leave the marks where they are. A new "refinish" credit
  sink was considered and rejected: pricing a cosmetic field would quietly reprice
  the campaign economy around it, which is a balance change wearing a presentation
  costume.

A hull the yard has nothing to repair keeps every mark it came in with. Scarring
surviving a top-up is the point.

## Carry-over, saves, and the migration that claims nothing

`fleetRecordsFrom` copies the marks mark-by-mark (never sharing an array with the
battle they came out of); `createVeteranFleet` puts them back through `scarsOf`, the
same clamp every other reader uses, so a record from an older save — or a
hand-edited one — cannot smuggle a malformed or unbounded list onto a fresh hull. A
commissioned hull arrives clean; a captured prize arrives wearing what it was taken
with.

The save envelope is a wholesale JSON of the game with no per-field schema, so
scarring rides along for free and **no save-format change was needed**. The one gap
is a war saved *before* the field existed: its hulls have no `scars` key, and
`scarShip` deliberately leaves such a hull byte-identical rather than inventing
history for it. Without a migration, a player mid-war when this lands would never
see a mark for the rest of that war, so `ensureScars` adopts an **empty** list at the
single point every resume path converges on (`app.js`). Empty, because claiming
anything about what the hull already survived would be fabrication. `RULES_REVISION`
is deliberately *not* bumped: the rules did not change, and raising it would tell the
player their save was revised by a rules change that did not happen.

`stripBattleRecordMetadata` gained **no** entry, against the delivery plan's
expectation. The plan listed it as a budget item; measurement says otherwise. The
projection strips record-keeping metadata so a recorded war and a plain one can be
compared, and scarring is neither — it is produced identically by both runs because
it is produced by the damage paths, not by the record layer. Stripping it would
*weaken* the parity assertion by hiding a field the two runs must agree on. The
campaign parity script agrees.

## The picture

One overlay `<span class="scarring">` per hull carries **all** of its marks as
stacked `radial-gradient` background layers, not one node per mark: a hull raked
across four arcs by three weapons still costs the field a single element, on a map
that already carries one button per hull and rebuilds that string on every boundary.
Three properties do the work:

- **Masked to the sprite's own alpha** (`mask-image: var(--hull-art)`), so a burn is
  clipped to the silhouette and never floats in space beside the hull. The check
  proves the mask source actually *decodes*, because a 404 mask renders unclipped —
  the failure mode that would look like soot in vacuum.
- **Rotated by the same `--rot` as the sprite**, because a scar is painted on the
  frame and swings with it as the hull turns.
- **Positioned by the arc that was struck.** The assets bow right and the renderer
  rotates them clockwise in a y-down field — the same convention `bearingDeg`
  measures in and the same order `struckArc` walks — so in the unrotated asset frame
  fore is right, starboard bottom, aft left, port top. `ARC_ANCHOR` is that mapping
  and a test pins it, because getting it backwards would quietly accuse the wrong
  flank of every hull in the fleet. Jitter is an FNV-1a hash of hull id and mark
  slot: a pure function of recorded state, so the same hull looks the same on every
  render, reload and machine, and no authoritative stream is touched.

At gameplay scale a 48px sprite cannot show individual burns, which is why the
second, coarser cue exists: past `SCAR.worn` total weight the hull's art dulls
(`saturate`/`brightness` on the sprite), and past `SCAR.wornHeavy` further. That is
the cue a player sees across a fleet; the decals are what they see when they look.

### Two paint failures, found by looking

Both were invisible to every geometric assertion and obvious in a screenshot.

1. **Hard-stopped near-black circles read as holes in the texture**, not as burns.
   On pixel art a crisp black disc says "the sprite is broken", which is the exact
   impression a presence feature must not give. The paint became translucent, warm
   and soft-falloff: marks shade the plating rather than punching it.
2. **A multiply/screen pass defeated the alpha mask.** It looked richer in
   isolation; in the fleet it put pale ion blooms floating outside the silhouette.
   Blend modes went, and ion scoring is now a pale translucent bloom on the same
   span as everything else.

A third failure was caught by reading the emitted string rather than by looking: a
double percent-conversion placed every decal at roughly **6500%** of the art box —
i.e. nowhere — while every geometric test still passed, because the tests measured
the decal *objects*, not the CSS they became. `test/scarring.test.js` now asserts
that every percentage in the emitted value sits inside the art box.

## The words

Nothing here is graphics-only:

- The map's accessible name and tooltip carry `— battle-scarred`, one word, placed
  with the stance and heading notes so a fleet can be tabbed through without a
  recital.
- The sensor card states the full sentence for any hull it can read. It is **not**
  gated on the sweep, unlike the captain's name: the decals are painted on every
  hull the map draws, so gating the words behind a scan the picture never waited for
  would leave the graphic carrying information the text withholds.
- The interior schematic's **Frame** section is the word equivalent for the player's
  *own* hull, which the sensor card deliberately excludes: one row per flank that was
  reached, heaviest first, naming the kind of fire and its depth, with **Unaimed** as
  a real category rather than a gap (ion, splash on a secondary hull and rams reach
  the frame without favouring a side). A clean frame says "No battle scarring on the
  frame." and nothing more — "never hit" would be false for a hull the shields
  protected or the yard refinished.
- Under Letters artwork there is no paint to mark, so no overlay is emitted — but
  the words stay, because the fact is not an art setting. A classic war has neither:
  its hulls carry no mark list at all.
- Every string that reaches markup from a mark is escaped; a cause name can arrive
  off a save, and a save is a boundary. The test feeds `<img src=x onerror=...>`
  through a tampered save and requires it to arrive as inert text.

## Cost

The decals are static background layers: nothing in the rAF path touches them, they
do not animate, and `prefers-reduced-motion` therefore has nothing to suppress —
which the check pins, so a future slice that animates them cannot do so
unconditionally. `check-scarring` measures a `renderGame` redraw over a fleet with
half its hulls carrying six marks each against the same fleet clean, and requires
the p95 delta under 6 ms. Two runs on this box gave **−0.50 ms** and **−2.20 ms**
(the latter clean 8.70 ms p95 vs scarred 6.50 ms) — i.e. the scarred fleet redraws
within noise of the clean one, in both directions, so the decals cost nothing the
renderer was not already spending rebuilding the field. A negative delta is noise,
not a saving; the claim is only that the marks are free.

## Verification

- `npm test`: **1097/1097** (was 1066; `test/scarring.test.js` adds 31).
- Enforced browser suite: **23 of 25 discovered**, the new `check-scarring` among
  them; the two pre-existing quarantined checks untouched.
- `node scripts/check-guide-content.mjs`: green with the new guide prose.
- Four-profile sim parity (`npm run sim` = classic + reimagined, and
  `npm run sim -- --mode realtime`) against a clean `origin/main` worktree:
  **byte-identical**, so no CALIBRATION row moves and none is claimed.
- `scripts/check-record-parity.mjs` (250 seeds × classic/reimagined/realtime, with
  full per-resolution `deepEqual` of the stripped recorded state against the plain
  one): **green**, 175,951 / 1,100,782 / 1,034,852 records compared. This is the
  strongest evidence for the no-strip decision: the marks are inside the compared
  state and the recorded and plain runs agree on them exactly.
- Campaign parity: `scripts/check-campaign-record-parity.mjs` compares the current
  tree's campaign module against a **baseline tree's**, so a slice that adds ship
  state can never pass it as written — the old code has no `scars` key at all. Run
  with the intended field excluded from the comparison (same script, strip augmented
  to drop `scars`, `--baseline-dir` at a clean `origin/main` worktree): **green over
  8 campaign seeds and 73 complete tactical resolutions** — muster, battle entry,
  every round's full tactical state including `randomStep`, finalization, the
  dockyard transaction, defensive setup and abandonment, and headless auto-resolve
  all byte-identical to `origin/main` apart from the new field. That is the claim
  this slice actually makes: campaign mechanics unchanged, one new field added.
  The deviation from the delivery plan's "`stripBattleRecordMetadata` gains an
  entry" budget item is recorded here and in the plan: stripping the field in the
  shared function would have weakened the single-war parity above, which is the
  check that can see a record-layer bug altering a mark.
- `git diff game/` is **not** empty this slice, by design: the field is authoritative
  state. That is why the sim and parity discipline above was run rather than waived.

## What this slice deliberately left

- **Arc-impact FX** — a shield flare on the arc a volley struck, and debris that
  persists where a hull died. That is P3b; the events do not yet carry the arc, and
  adding it to the fire event payload is P3b's first move.
- **A paid refinish offer** in the campaign dockyard (see above).
- **Scarring in the service record / chronicle prose.** `fleetSnapshot`'s field list
  was left alone on purpose: it is observational campaign metadata, and putting
  presentation-facing marks in it would grow every roster snapshot for no reader.
  L3 ("service records as consequence") is the slice that may want "this hull came
  home scarred", and it should make that call with the field already in place.
- **A guide screenshot.** The guide prose is added without an illustration; the
  hash-verified capture manifest makes adding one a separate, mechanical follow-up,
  as it was for P1 and P2.
