/**
 * The war chronicle: an honest account of a finished war, worth keeping.
 *
 * This lives in `ui/` and not `game/` even though the delivery plan said
 * `game/chronicle.js`. The plan also said to gate every entry with the same
 * predicate the journal uses, "ideally by calling `projectJournalRecord` itself" —
 * and that function lives in `ui/battle-journal.js`. No module under `game/` imports
 * from `ui/` anywhere in this codebase, so honouring the reuse requirement decides
 * the location. Reusing the projection matters more than the directory: it is what
 * stops the chronicle and the journal from drifting into two accounts of one war.
 *
 * Like the schematic and the audio model, this is a pure projection — no DOM, no
 * state, no randomness, and nothing written back to `game` or `campaign`. Keeping
 * the draft off authoritative state is deliberate: it means
 * `stripBattleRecordMetadata` is untouched, so the record-parity assertions and the
 * 1,000-war baseline digest cannot move.
 *
 * ## The honesty tier, stated
 *
 * Matt ruled tier D on 2026-11-12. The chronicle therefore runs two tiers and SAYS
 * which is which on every surface, because an unstated split reads as inconsistency
 * while a stated one reads as a chain of command reporting up:
 *
 *  - **The account is filtered.** Each line comes from `projectJournalRecord`, the
 *    same authority the battle journal uses, so the chronicle can claim no more than
 *    the flagship could see or hear. Where that gate closes, the journal's own
 *    vocabulary is reused verbatim rather than a new euphemism being invented.
 *  - **The casualty roll is declassified, and labelled.** For `destruction` and
 *    `vacancy` only, the killer and the weapon are taken from the RAW record at
 *    war's end — facts the journal would not name during the war. The section says
 *    it was compiled from the fleet's returns after the fighting, which is true and
 *    is the whole justification: no surviving hull learns anything new about itself.
 *
 * One thing no tier can do: a `surrender` record carries **no `actor` at all**
 * (measured 0 of 416), so a hull that struck its colours can never be attributed to
 * whoever forced it. The casualty roll says the attribution is not in the returns
 * rather than guessing.
 */
import { formatJournalEvent, projectJournalRecord } from './battle-journal.js';

export const CHRONICLE_VERSION = 1;

/**
 * The terminal spine of a war is bounded by fleet size — a hull is destroyed,
 * captured or vacated once — so this ceiling is headroom rather than a working
 * limit. Overflow drops the OLDEST entries and counts them, so a truncated
 * chronicle never silently claims to cover the whole war.
 */
export const CHRONICLE_ENTRY_LIMIT = 400;

/** The only kinds the tier-D ruling declassifies. */
export const DECLASSIFIED_KINDS = Object.freeze(['destruction', 'vacancy']);

/** The label the ruling requires: it says where the attribution came from. */
export const DECLASSIFIED_FRAME = 'Compiled from the fleet\'s returns after the fighting; these attributions were not known to the flagship during the war.';

export const createChronicle = ({ seed = null, battleId = null, rulesRevision = null } = {}) => ({
  version: CHRONICLE_VERSION,
  seed,
  battleId,
  rulesRevision,
  entries: [],
  casualties: [],
  observed: 0,
  dropped: 0,
});

const nameOf = (snapshot) => (typeof snapshot?.name === 'string' && snapshot.name) || null;

/**
 * Consume a raw record batch — the complete, frozen, knowledge-stamped records,
 * before any journal truncation. Called from its own hook rather than from
 * `collectRecords`, because that seam also drives the P2 audio and feeding it a
 * campaign engagement's records would play impact audio for a fight the player is
 * not in.
 */
export const recordChronicle = (chronicle, rawRecords) => {
  if (!chronicle || !Array.isArray(rawRecords) || !rawRecords.length) return chronicle;
  const entries = [...chronicle.entries];
  const casualties = [...chronicle.casualties];
  let { observed, dropped } = chronicle;

  for (const raw of rawRecords) {
    if (!raw || typeof raw.kind !== 'string') continue;
    observed += 1;
    const terminal = raw.knowledge?.globalTerminal === true;

    // The casualty roll is built from the RAW record, which is the only place the
    // killer survives when the flagship never saw the shot.
    if (DECLASSIFIED_KINDS.includes(raw.kind)) {
      casualties.push({
        kind: raw.kind,
        hull: nameOf(raw.target),
        faction: typeof raw.target?.faction === 'string' ? raw.target.faction : null,
        cause: typeof raw.payload?.cause === 'string' ? raw.payload.cause : null,
        weapon: typeof raw.payload?.weapon === 'string' ? raw.payload.weapon : null,
        by: nameOf(raw.actor),
        byFaction: typeof raw.actor?.faction === 'string' ? raw.actor.faction : null,
        // False when the returns simply do not name anyone. A `surrender` is the
        // standing example: it carries no `actor` at all (measured 0 of 39 in one
        // war), so the hull that forced a colors-strike is never knowable — though
        // its `payload.surrenderedTo` does name the winning FACTION, which is why
        // that case is worded as a faction and never as a hull.
        attributed: Boolean(nameOf(raw.actor)),
      });
    }

    if (!terminal) continue;
    const event = projectJournalRecord(raw);
    // A terminal record whose projection is null cannot happen: the journal's own
    // `observable` test includes `terminal`, so every globalTerminal record is
    // observable by construction. That is why this account carries no "unobserved"
    // counter — an always-zero field would be dead weight implying a gap that the
    // rules do not allow. It is kept as a guard, not as a statistic.
    if (!event) continue;
    entries.push({ seq: entries.length + dropped + 1, kind: raw.kind, line: formatJournalEvent(event) });
  }

  const overflow = entries.length - CHRONICLE_ENTRY_LIMIT;
  const kept = overflow > 0 ? entries.slice(overflow) : entries;
  return {
    ...chronicle,
    entries: kept,
    casualties,
    observed,
    dropped: dropped + (overflow > 0 ? overflow : 0),
  };
};

/** True when the account still reaches back to the opening of the war. */
export const chronicleComplete = (chronicle) => Boolean(chronicle) && chronicle.dropped === 0;

const label = (value) => (typeof value === 'string' && value ? value.replace(/[-_]/g, ' ') : null);

/**
 * One line per casualty. Every clause traces to a field on the record, and every
 * gap uses the project's existing vocabulary rather than a new euphemism.
 */
export const casualtyLines = (chronicle) => (chronicle?.casualties ?? []).map((entry) => {
  const hull = entry.hull ?? 'An unrecorded hull';
  const who = `${hull}${entry.faction ? ` (${label(entry.faction)})` : ''}`;
  const fate = entry.kind === 'vacancy' ? 'was left vacant' : 'was destroyed';
  if (!entry.attributed) {
    return `${who} ${fate}. Not attributed in the returns.`;
  }
  // `destruction` and `vacancy` payloads carry `cause` (the weapon or reason) and no
  // separate `weapon` field — verified against real records, so the fallback is the
  // normal path rather than an exotic one.
  const weapon = label(entry.weapon ?? entry.cause);
  return `${who} ${fate} — ${weapon ? `${weapon}, ` : ''}by ${entry.by}${entry.byFaction ? ` (${label(entry.byFaction)})` : ''}.`;
});

/**
 * The composed chronicle. Returns structure rather than a string so the UI can
 * render it accessibly and the tests can assert each section separately.
 *
 * `coda` is the `{ title, lines }` object returned by
 * `reportFor(game, 'battle-report')`, passed in by the caller so this module stays
 * free of `ui/render.js`.
 */
export const composeChronicle = (chronicle, { game = null, coda = null } = {}) => {
  const complete = chronicleComplete(chronicle);
  const sections = [];

  sections.push({
    id: 'basis',
    heading: 'On what this account is based',
    lines: [
      'The narrative below is filtered to what the flagship could see or hear, using the same rule the battle journal uses.',
      `The casualty roll is declassified: ${DECLASSIFIED_FRAME}`,
      'The fleet return at the foot is reproduced as issued and is not filtered.',
    ],
  });

  sections.push({
    id: 'account',
    heading: 'The account',
    lines: (chronicle?.entries ?? []).map((entry) => entry.line),
    notes: [
      // `!chronicle` is also "not complete", but there is nothing to report having
      // dropped, so the note is suppressed rather than dereferencing null.
      ...(complete || !chronicle ? [] : [`${chronicle.dropped} earlier entries exceeded the chronicle's limit and are not reproduced; this account begins partway through the war.`]),
    ],
  });

  const casualties = casualtyLines(chronicle);
  sections.push({
    id: 'casualties',
    heading: 'Casualties, compiled from the fleet\'s returns',
    frame: DECLASSIFIED_FRAME,
    lines: casualties.length ? casualties : ['No hull was recorded lost.'],
  });

  // `coda` is `reportFor(game, 'battle-report')`, which returns `{ title, lines }`.
  // It is reused verbatim and deliberately NOT filtered, because it has been an
  // omniscient fleet return since round 21: filtering it would regress a shipped
  // surface, and leaving it unlabelled is what would make a filtered chronicle look
  // broken. So it is labelled.
  if (Array.isArray(coda?.lines) && coda.lines.length) {
    sections.push({
      id: 'coda',
      heading: typeof coda.title === 'string' && coda.title ? coda.title : 'Fleet return',
      frame: 'Reproduced as issued. This is a consolidated fleet return, not a sensor report, and is not filtered to the flagship.',
      lines: coda.lines,
    });
  }

  return {
    war: {
      seed: chronicle?.seed ?? game?.seed ?? null,
      battleId: chronicle?.battleId ?? null,
      rulesRevision: chronicle?.rulesRevision ?? null,
      ruleset: game?.reimagined ? 'Reimagined' : 'Classic',
      stardate: game?.turn ?? null,
      // The outcome is an object; its `message` is prose the rules already wrote for
      // the player, so it is reused rather than re-worded here.
      outcome: typeof game?.outcome?.message === 'string' ? game.outcome.message
        : typeof game?.outcome?.kind === 'string' ? label(game.outcome.kind)
          : game?.outcome ? String(game.outcome) : null,
    },
    observed: chronicle?.observed ?? 0,
    complete,
    sections,
  };
};

/** Plain text for export — the artifact a player actually keeps. */
export const chronicleText = (composed) => {
  if (!composed) return '';
  const head = [
    'ARGONAUT — WAR CHRONICLE',
    composed.war.seed ? `War seed: ${composed.war.seed}` : null,
    `Ruleset: ${composed.war.ruleset}`,
    composed.war.stardate ? `Stardate reached: ${composed.war.stardate}` : null,
    composed.war.outcome ? `Outcome: ${composed.war.outcome}` : null,
    composed.complete ? null : 'Note: this account is incomplete; earlier entries exceeded its limit.',
  ].filter(Boolean);
  const body = composed.sections.map((section) => [
    '',
    section.heading.toUpperCase(),
    ...(section.frame ? [section.frame] : []),
    ...section.lines,
    ...(section.notes ?? []),
  ].join('\n'));
  return [...head, ...body].join('\n');
};

const validCasualty = (entry) => Boolean(entry) && typeof entry === 'object'
  && DECLASSIFIED_KINDS.includes(entry.kind)
  && (entry.hull === null || typeof entry.hull === 'string')
  && typeof entry.attributed === 'boolean';

const validEntry = (entry) => Boolean(entry) && typeof entry === 'object'
  && typeof entry.kind === 'string' && typeof entry.line === 'string'
  && Number.isSafeInteger(entry.seq) && entry.seq >= 1;

/**
 * Restore a stored chronicle, or start a fresh one. Rejected whole — never merged or
 * partially repaired — unless the version and the war it belongs to both match,
 * because a chronicle spliced from two wars would be a confident fabrication.
 */
export const restoreChronicle = (saved, { seed = null, battleId = null, rulesRevision = null } = {}) => {
  const fresh = createChronicle({ seed, battleId, rulesRevision });
  if (!saved || typeof saved !== 'object') return fresh;
  if (saved.version !== CHRONICLE_VERSION) return fresh;
  if (saved.seed !== seed || saved.battleId !== battleId) return fresh;
  if (!Array.isArray(saved.entries) || !Array.isArray(saved.casualties)) return fresh;
  if (!saved.entries.every(validEntry) || !saved.casualties.every(validCasualty)) return fresh;
  const count = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);
  return {
    ...fresh,
    entries: saved.entries.map((entry) => ({ ...entry })),
    casualties: saved.casualties.map((entry) => ({ ...entry })),
    observed: count(saved.observed),
    dropped: count(saved.dropped),
  };
};
