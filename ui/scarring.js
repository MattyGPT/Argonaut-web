/**
 * Battle scarring as a picture (P3, presentation only).
 *
 * A pure projection from the authoritative marks on `ship.scars` to the decals the
 * map draws and the words that stand in for them. It decides nothing: no rule
 * reads this module, it consumes no gameplay RNG, and it never mutates a ship.
 * Follow the `ui/schematic.js` / `ui/audio-model.js` pattern — the mapping is the
 * thing worth pinning, so it lives here where `npm test` can read it rather than
 * in a stylesheet where only a screenshot could.
 *
 * Two properties are load-bearing and both come from facts the rules already
 * recorded:
 *
 * - **A mark sits on the arc that was struck.** The sprite assets bow right and
 *   the renderer rotates them by `ship.facing`, which is the same clockwise-from-
 *   +x convention `bearingDeg` measures in. So in the UNROTATED asset frame the
 *   bow is +x (right) and `struckArc`'s clockwise order fore → starboard → aft →
 *   port maps to right → bottom → left → top. `ARC_ANCHOR` is that mapping and
 *   `test/scarring.test.js` pins it, because getting it backwards would quietly
 *   accuse the wrong flank of every hull in the fleet.
 * - **A mark's spread is its weight**, which is the count of strikes of that kind
 *   that reached the hull through that arc. A flank raked nine times burns wider
 *   and blacker than one that took a single lucky hit, which is the whole reason
 *   the list coalesces instead of collecting spots.
 *
 * Placement jitter comes from an FNV-1a hash of the hull id and the mark's slot,
 * not from any RNG stream: it is a pure function of recorded state, so the same
 * hull looks the same on every render, every reload and every machine, and no
 * authoritative stream is touched.
 */
import { SCAR } from '../game/constants.js';
import { scarsOf } from '../game/state.js';

/**
 * Where each arc sits on the unrotated sprite, as fractions of the art box.
 * The bow is the right edge because every shipped asset bows right (see the
 * `--rot` note in `styles.css`); port is up and starboard is down because the
 * field's y axis runs downward and `struckArc` walks clockwise from the bow.
 */
export const ARC_ANCHOR = Object.freeze({
  fore: Object.freeze({ x: 0.84, y: 0.5 }),
  starboard: Object.freeze({ x: 0.5, y: 0.84 }),
  aft: Object.freeze({ x: 0.16, y: 0.5 }),
  port: Object.freeze({ x: 0.5, y: 0.16 }),
});

/** An unaimed mark — ion, splash on a secondary hull, a rock — spreads over the whole frame. */
const UNAIMED = Object.freeze({ x: 0.5, y: 0.5 });

/**
 * How each kind of hit marks a frame, as the two stops of a radial decal: the
 * burned core and the scorched halo around it. Phaser fire chars the plating
 * brown-black; a warhead punches through and leaves a hotter rim; a ram or
 * shrapnel gouges bare grey metal. An ion burst never breaches the hull, so it
 * blooms pale and cold instead of biting into it — and because a pale bloom
 * cannot be multiplied into a dark hull, ion marks ride their own screen-blended
 * layer (see `scarGlow`).
 *
 * Every colour carries alpha and every stop falls off softly. The first version
 * of this used hard-stopped near-black circles, and on pixel art a hard black
 * circle does not read as a burn — it reads as a hole in the texture, which is
 * exactly the "the sprite is broken" impression a presence feature must not give.
 * Soft, translucent, warm marks darken the plating underneath (the span is
 * multiplied over it) and so read as something that happened TO the hull.
 */
const CAUSE_PAINT = Object.freeze({
  phasers: { core: 'rgba(26,13,5,.74)', rim: 'rgba(84,44,16,.42)', shape: 1 },
  photons: { core: 'rgba(12,6,2,.86)', rim: 'rgba(128,62,20,.5)', shape: 1.25 },
  spread: { core: 'rgba(16,9,4,.8)', rim: 'rgba(110,54,18,.46)', shape: 1.1 },
  collision: { core: 'rgba(30,34,38,.78)', rim: 'rgba(122,132,140,.4)', shape: 1.35 },
  shrapnel: { core: 'rgba(22,16,11,.72)', rim: 'rgba(96,74,54,.4)', shape: 0.8 },
});

/** Ion scoring: pale and cold, so the charge reads as light left on the plating. */
const ION_PAINT = Object.freeze({ core: 'rgba(207,233,255,.42)', rim: 'rgba(95,159,214,.22)', shape: 1.7 });

const FALLBACK_PAINT = Object.freeze({ core: 'rgba(20,11,5,.72)', rim: 'rgba(70,42,18,.4)', shape: 1 });

/** How far a mark may wander from its arc's anchor, as a fraction of the art box. */
const JITTER = 0.17;
/** Decal radius at weight 1 and per further strike, as a percentage of the art box. */
const BASE_RADIUS = 4.4;
const RADIUS_PER_WEIGHT = 0.55;
const MAX_RADIUS = 11;

/**
 * Total depth of everything on the frame: the sum of every mark's weight. This is
 * the number the whole-hull "battle-worn" treatment keys off, because at gameplay
 * scale a 48px sprite cannot show individual burns — what a player can see at a
 * glance is that a hull looks duller and dirtier than its sisters.
 */
export const scarWear = (ship) => scarsOf(ship).reduce((total, mark) => total + mark.weight, 0);

/**
 * The class a hull wears when its frame has taken enough to show at arm's length.
 * Two steps, so a hull that has been through one bad exchange reads differently
 * from one that has been through a war. Empty for a hull that is clean or only
 * lightly marked: a scratch is not a reputation.
 */
export const scarWearClass = (ship) => {
  const wear = scarWear(ship);
  if (wear >= SCAR.wornHeavy) return ' battle-worn-heavy';
  if (wear >= SCAR.worn) return ' battle-worn';
  return '';
};

/** FNV-1a over a short string. Pure, stable across runs and machines, no RNG. */
const hash = (text) => {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
};

/** A stable 0..1 draw out of one slice of a hash, so one seed yields several independent ones. */
const frac = (seed, shift) => ((seed >>> shift) % 1000) / 1000;

/** Keeps a jittered mark on the frame: a bow burn may reach the stem, not past it. */
const onFrame = (value) => Math.min(0.98, Math.max(0.02, value));

const percent = (value) => `${Math.round(value * 1000) / 10}%`;

/**
 * One decal per mark, in the order the frame acquired them. Each carries its
 * position and radii as fractions of the art box plus the paint for its cause, so
 * the caller can build a stylesheet string, measure it, or assert on it without
 * any of those depending on the others. Radii are drawn independently so a mark
 * reads as a blotch stretched along the plating rather than a stamped circle.
 */
export const scarDecals = (ship) => scarsOf(ship).slice(0, SCAR.maxMarks).map((mark, index) => {
  const glow = mark.cause === 'ion';
  const paint = glow ? ION_PAINT : CAUSE_PAINT[mark.cause] ?? FALLBACK_PAINT;
  const anchor = mark.arc ? ARC_ANCHOR[mark.arc] ?? UNAIMED : UNAIMED;
  const seed = hash(`${ship?.id ?? 'hull'}#${index}#${mark.cause}#${mark.arc ?? 'unaimed'}`);
  const radius = Math.min(MAX_RADIUS, (BASE_RADIUS + (mark.weight - 1) * RADIUS_PER_WEIGHT) * paint.shape);
  return {
    cause: mark.cause,
    arc: mark.arc ?? null,
    weight: mark.weight,
    glow,
    x: onFrame(anchor.x + (frac(seed, 0) - 0.5) * 2 * JITTER),
    y: onFrame(anchor.y + (frac(seed, 10) - 0.5) * 2 * JITTER),
    radiusX: (radius / 100) * (0.84 + frac(seed, 20) * 0.36),
    radiusY: (radius / 100) * (0.84 + frac(seed, 22) * 0.36),
    core: paint.core,
    rim: paint.rim,
  };
});

/** One radial layer per decal, with a soft falloff so a mark shades the plating rather than punching it. */
const layer = (decal) => `radial-gradient(${percent(decal.radiusX)} ${percent(decal.radiusY)} at ${percent(decal.x)} ${percent(decal.y)},${decal.core} 0 34%,${decal.rim} 52% 74%,rgba(0,0,0,0) 96%)`;

/**
 * The `background-image` for the decal overlay: every mark on the frame as layers
 * on a single span. Multiple layers on one span rather than one node per mark: a
 * hull raked across four arcs by three weapons would otherwise add a dozen
 * elements to a field that already carries one per hull, and the renderer rebuilds
 * this string on every boundary. Empty when the frame is clean, so nothing is
 * emitted at all for an untouched hull — the common case early in a war.
 *
 * Plain source-over paint, deliberately. A multiply/screen pass looked richer in
 * isolation but defeated the alpha mask in practice — the pale ion blooms escaped
 * the silhouette and floated in space beside the hull, which is worse than being
 * subtle. Translucent warm colours over the art read as scorch without needing the
 * compositor to cooperate.
 */
export const scarBackground = (ship) => scarDecals(ship).map(layer).join(',');

/**
 * The per-arc tally, heaviest first, for the words that stand in for the decals.
 * Weight sums, so an arc burned nine times outranks three arcs touched once —
 * which is what "heaviest" has to mean for the sentence to be true. Each entry
 * also carries its marks broken out by cause, so a readout can say what kind of
 * fire did it rather than only how much.
 *
 * `arc` is null for unaimed damage — an ion burst, splash on a secondary hull, a
 * ram — which is a real category rather than a gap: those strikes reached the
 * frame without favouring a flank, and saying so is the honest reading.
 */
export const scarArcTally = (ship) => {
  const byArc = new Map();
  for (const mark of scarsOf(ship)) {
    const arc = mark.arc ?? null;
    const entry = byArc.get(arc) ?? { arc, weight: 0, kinds: [] };
    entry.weight += mark.weight;
    const kind = entry.kinds.find((each) => each.cause === mark.cause);
    if (kind) kind.weight += mark.weight;
    else entry.kinds.push({ cause: mark.cause, weight: mark.weight });
    byArc.set(arc, entry);
  }
  return [...byArc.values()]
    .map((entry) => ({ ...entry, kinds: entry.kinds.sort((a, b) => b.weight - a.weight || a.cause.localeCompare(b.cause)) }))
    .sort((a, b) => b.weight - a.weight || String(a.arc).localeCompare(String(b.arc)));
};

const CAUSE_WORD = Object.freeze({
  phasers: 'phaser burns',
  photons: 'warhead strikes',
  spread: 'spread splash',
  ion: 'ion scoring',
  collision: 'collision gouges',
  shrapnel: 'shrapnel pitting',
});

/** What a cause is called in prose, falling back to the recorded word rather than inventing one. */
export const scarCauseWord = (cause) => CAUSE_WORD[cause] ?? `${cause} marks`;

const ARC_WORD = Object.freeze({ fore: 'bow', starboard: 'starboard quarter', aft: 'aft', port: 'port quarter' });

/**
 * The sentence equivalent of the decals, for the sensor card and the accessible
 * name. It states only what the marks record — how many, what kind, and which
 * flank is worst — and it deliberately does NOT quote `shotsTaken` for a total.
 *
 * That omission is load-bearing, and was found the hard way. `shotsTaken` looks
 * like the honest denominator ("the shields soaked more than what marked you"),
 * but it is a rule input — `game/turns.js` detects which hulls a spread splash
 * caught by its delta, and `game/practice.js` gates a drill hint on it — and it is
 * NOT one of the fields a campaign carries between battles. So on any veteran hull
 * it restarts at zero while the marks it earned in the last war are still on the
 * frame, and a sentence quoting it would print "3 marks on the frame; 0 strikes
 * absorbed in all" — a flat self-contradiction, on the page, in a feature whose
 * whole premise is that the marks outlive the counter. Carrying the counter would
 * be a rules change for a clause of prose, so the clause goes instead. "N marks on
 * the frame" is already a precise count of the thing it counts.
 *
 * Null when the hull is clean, so an untouched ship gains no line at all.
 */
export const scarSummary = (ship) => {
  const marks = scarsOf(ship);
  if (!marks.length) return null;
  const kinds = [...new Set(marks.map((mark) => mark.cause))];
  const named = kinds.slice(0, 2).map(scarCauseWord).join(kinds.length > 2 ? ', ' : ' and ');
  const heaviest = scarArcTally(ship)[0];
  const worst = heaviest?.arc ? ARC_WORD[heaviest.arc] ?? heaviest.arc : null;
  return `Battle scarring — ${marks.length} mark${marks.length === 1 ? '' : 's'} on the frame`
    + ` (${kinds.length > 2 ? `${named}, and more` : named})`
    + `${worst ? `, worst on the ${worst}` : ''}.`;
};

/**
 * The short clause the map's accessible name and tooltip carry. Deliberately one
 * word: the label already runs to a dozen fields, and a screen-reader user
 * tabbing a fleet needs "scarred" to be heard, not recited.
 */
export const scarNote = (ship) => (scarsOf(ship).length ? ' — battle-scarred' : '');
