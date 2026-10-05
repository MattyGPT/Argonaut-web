# C5 faction recognition — 2026-10-05

Based on merged PR #91 (`900dcf3`). This is presentation work across Classic
and Reimagined; no engine rule, RNG, visibility predicate, or commissioned
sprite asset changes.

One shared identity mapping supplies square Federation, triangle Axis,
diamond Bloc, circle Cabal, hollow-circle Neutral, and hollow-square Unowned
badges. Names remain available alongside shapes and colors. Unknown historical
identity is labelled Unknown rather than silently implying an unowned system.
Map, minimap, legends, target choices, reports, journal details, and sector
ownership use the same mapping. Captures immediately show current allegiance;
journal details use only already filtered, frozen event snapshots. Captured
merchants retain the existing neutral merchant image because faction-specific
merchant assets do not exist.

Vacant and surrendered hulls carry separate V/S marks, wrecks retain their
own presentation, and command/selection/threat remain separate from allegiance.
Sector node types retain their existing shapes with allegiance beside them.
The previously hidden interactive sector SVG and minimap contact descriptions
are exposed as labelled groups for assistive technology.

## Stack placement and limits

Badges made tight clusters harder to read, revealing that existing stack
offsets incorrectly grew with camera zoom. Decluttering now uses bounded
screen-space spacing shared by boundary paint and flight interpolation,
including stationary wrecks. Dotted tethers indicate actual map positions.
Minimap offsets update during movement and are capped at 24 pixels. None of
these offsets enters authoritative coordinates or range calculations.

Map fan radius is capped at 160 pixels and reduced for smaller viewports.
Centered 2-, 4-, and 6-hull sprite clusters remain separate in the browser;
the 50-hull stress fixture stays bounded but still contains overlapping
markers. This is not a claim that arbitrary fleets fit without overlap or
that a cluster beside a viewport edge is fully visible. Pan/zoom and the
target selector remain available. No sprite recoloring is included.

## Verification

- Full suite: 743 passing tests. Focused coverage includes current capture
  allegiance, frozen journal identities, hidden-contact exclusion, faction
  asset paths, sector ownership, stable fan placement and mechanical purity.
- `scripts/check-faction-identity.mjs` checks 24 combinations of viewport,
  art/theme, and zoom; captures grayscale examples; exercises actual keyboard
  target menus and sector navigation; and measures bounded dense clusters.
  Additional Classic-rules fixtures, combined threat/selection checks,
  focused tether endpoints, and instrumented actual-app frame updates verify
  moving clusters clear/rejoin correctly without dropping stationary wrecks.
- `scripts/check-combat-feedback.mjs` verifies live/replay beam alignment,
  retained command history, overlapping target menu ownership, and real-time
  command behavior. Maximum measured beam endpoint error is below 0.00005 px.
- Complete 250-seed simulation reports for Classic, turn-based Reimagined,
  and real-time Reimagined exactly match PR #91. Engine content diff is empty.
- Independent review covers frozen-data boundaries, capture semantics,
  accessibility, interpolation consistency, selection/threat separation,
  and tether geometry. Final browser evidence is retained under the local
  temporary `argonaut-faction-navigation` directory, outside deployed assets.

The README and in-game guide explain the new cues. Final guide screenshot
replacement remains in G5 after the remaining presentation work is stable.
The separate [F3 experiment](2026-10-05-navigation-experiment.md) was rejected;
its inactive patch does not change this delivery's gameplay baseline.
