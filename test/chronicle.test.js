
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { enableBattleRecords } from '../game/battle-records.js';
import { resolveComputerTurns } from '../game/turns.js';
import { reportFor } from '../ui/render.js';
import {
  CHRONICLE_ENTRY_LIMIT, CHRONICLE_VERSION, DECLASSIFIED_FRAME, casualtyLines,
  chronicleComplete, chronicleText, composeChronicle, createChronicle,
  recordChronicle, restoreChronicle,
} from '../ui/chronicle.js';

const section = (composed, id) => composed.sections.find((entry) => entry.id === id);

/** Fly a real war, feeding every raw batch through the chronicle accumulator. */
const flyWar = (seed, { reimagined = true, rounds = 80 } = {}) => {
  let game = enableBattleRecords(createGame({ seed, reimagined }), { battleId: `chron-${seed}` });
  let chronicle = createChronicle({ seed: game.seed, battleId: game.battleRecordState.battleId, rulesRevision: 'rules-test' });
  for (let i = 0; i < rounds && !game.outcome; i += 1) {
    game = resolveComputerTurns(game, { onRecords: (batch) => { chronicle = recordChronicle(chronicle, batch); } });
  }
  return { game, chronicle };
};

/** A record shaped exactly as the rules emit it (field names verified against a real war). */
const raw = (overrides = {}) => ({
  kind: 'destruction',
  battleId: 'b1',
  eventId: 'b1:e1',
  simTime: 4,
  actor: { id: 'killer', name: 'Empyreal', faction: 'Federation' },
  target: { id: 'victim', name: 'Hellhound', faction: 'Axis' },
  payload: { cause: 'phasers', status: 'destroyed' },
  knowledge: { globalTerminal: true, spectator: false, own: false, radioIntegrity: 1 },
  ...overrides,
});

test('a real war produces a chronicle whose casualty roll names real hulls and real killers', () => {
  const { game, chronicle } = flyWar('chronicle-real-war');
  assert.ok(chronicle.observed > 1000, `a real war emits a lot of records (saw ${chronicle.observed})`);
  assert.ok(chronicle.entries.length > 0, 'and terminal events reach the account');
  assert.ok(chronicle.casualties.length > 0, 'and hulls are lost');
  assert.equal(chronicleComplete(chronicle), true);

  const names = new Set(game.ships.map((ship) => ship.name));
  for (const casualty of chronicle.casualties) {
    assert.ok(['destruction', 'vacancy'].includes(casualty.kind), 'only the two declassified kinds enter the roll');
    if (casualty.hull) assert.ok(names.has(casualty.hull), `every named hull really fought: ${casualty.hull}`);
    if (casualty.attributed) {
      assert.ok(casualty.by, 'an attributed casualty names its killer');
      assert.ok(names.has(casualty.by), `and that killer really fought: ${casualty.by}`);
    }
  }
  // The point of tier D: attribution the journal would not have given during the war.
  const attributed = chronicle.casualties.filter((casualty) => casualty.attributed).length;
  assert.ok(attributed > 0, `tier D actually attributes losses (${attributed} of ${chronicle.casualties.length})`);

  const composed = composeChronicle(chronicle, { game, coda: reportFor(game, 'battle-report') });
  assert.ok(composed.sections.some((entry) => entry.id === 'coda'), 'the fleet return is attached as the coda');
  assert.ok(section(composed, 'casualties').lines.length > 0);
  // `game.outcome` is an OBJECT, so a naive String() of it once printed
  // "[object Object]" into the export. Pin the reuse of the message the rules
  // already wrote, on a fixture outcome, so this cannot regress whether or not the
  // flown war happened to finish inside the round budget.
  assert.equal(composeChronicle(chronicle, {
    game: { ...game, outcome: { kind: 'alliance-win', message: 'Bloc forces have won.' } },
  }).war.outcome, 'Bloc forces have won.', 'the outcome reuses the prose the rules wrote');
  assert.equal(composeChronicle(chronicle, { game: { ...game, outcome: { kind: 'draw' } } }).war.outcome, 'draw',
    'and falls back to a readable kind when there is no message');
  assert.equal(String(composed.war.outcome).includes('[object Object]'), false, 'never an unstringified object');
});

test('every tier is stated on its own surface, so the split reads as a chain of command', () => {
  const { game, chronicle } = flyWar('chronicle-tiers', { rounds: 40 });
  const composed = composeChronicle(chronicle, { game, coda: reportFor(game, 'battle-report') });
  const basis = section(composed, 'basis');
  assert.ok(basis.lines.some((line) => line.includes('filtered to what the flagship could see or hear')),
    'the filtered basis of the account is stated');
  assert.ok(basis.lines.some((line) => line.includes('declassified')), 'and so is the declassification');
  assert.equal(section(composed, 'casualties').frame, DECLASSIFIED_FRAME, 'the casualty roll carries its frame');
  assert.match(DECLASSIFIED_FRAME, /after the fighting/, 'the frame says when the attribution became available');
  assert.match(section(composed, 'coda').frame, /not a sensor report/, 'the coda says it is a fleet return');
  assert.match(section(composed, 'coda').frame, /not filtered/, 'and that it is not filtered');
});

test('declassification is limited to terminal loss, and never invents an attribution', () => {
  let chronicle = createChronicle({ seed: 's', battleId: 'b' });
  chronicle = recordChronicle(chronicle, [raw()]);
  const attributed = casualtyLines(chronicle);
  assert.equal(attributed.length, 1);
  assert.match(attributed[0], /Hellhound \(Axis\) was destroyed — phasers, by Empyreal \(Federation\)\./);

  // No actor in the returns: reported as a gap, never filled in.
  chronicle = recordChronicle(chronicle, [raw({ eventId: 'b1:e2', actor: null, target: { id: 'v2', name: 'Firebreather', faction: 'Bloc' } })]);
  assert.match(casualtyLines(chronicle)[1], /Firebreather \(Bloc\) was destroyed\. Not attributed in the returns\./);
  assert.equal(chronicle.casualties[1].attributed, false);

  // A vacancy is worded as a vacancy, not a destruction — different fact, different verb.
  chronicle = recordChronicle(createChronicle({ seed: 's', battleId: 'b' }), [raw({ kind: 'vacancy', payload: { cause: 'disabled', status: 'vacant' } })]);
  assert.match(casualtyLines(chronicle)[0], /was left vacant — disabled, by Empyreal/);

  // Kinds outside the ruling are not declassified, even when the raw record has an actor.
  const other = recordChronicle(createChronicle({ seed: 's', battleId: 'b' }), [raw({ kind: 'damage' })]);
  assert.equal(other.casualties.length, 0, 'a damage record never enters the casualty roll');
});

test('a colors-strike is never attributed to a hull, because the record does not carry one', () => {
  // Verified against real records: surrender has actor null in 0 of 39 cases, and its
  // surrenderedTo names a FACTION. So the roll may not name a hull that forced it.
  let chronicle = createChronicle({ seed: 's', battleId: 'b' });
  chronicle = recordChronicle(chronicle, [raw({
    kind: 'surrender', actor: null,
    target: { id: 'v3', name: 'Argo', faction: 'Federation' },
    payload: { cause: 'faction-capitulation', surrenderedTo: 'Axis' },
  })]);
  assert.equal(chronicle.casualties.length, 0, 'a surrender is not a destruction or a vacancy, so it is not declassified');
  const lines = chronicle.entries.map((entry) => entry.line).join(' ');
  assert.equal(/by [A-Z]/.test(lines), false, 'no hull is named as having forced the colours');
});

test('the account is gated by the journal\'s own projection, and terminal facts are observable by construction', () => {
  // A record with no knowledge stamp is not narrated at all: projectJournalRecord
  // returns null, so the chronicle cannot claim it. It is still counted as seen.
  const unstamped = raw({ kind: 'damage', knowledge: undefined });
  const chronicle = recordChronicle(createChronicle({ seed: 's', battleId: 'b' }), [unstamped]);
  assert.equal(chronicle.entries.length, 0, 'an unstamped record is not narrated');
  assert.equal(chronicle.observed, 1, 'but it is counted');

  // Every globalTerminal record IS observable — the journal's `observable` test
  // includes `terminal` — so a terminal-only account has no gaps to apologise for.
  // That is why no "unobserved" counter is shipped: it could never move, and an
  // always-zero field would imply a gap the rules do not allow.
  const terminal = recordChronicle(createChronicle({ seed: 's', battleId: 'b' }), [raw()]);
  assert.equal(terminal.entries.length, 1, 'a terminal record always reaches the account');
  assert.equal(terminal.unobserved, undefined, 'and no dead counter is carried for it');
});

test('growth is bounded and a truncated chronicle admits it', () => {
  let chronicle = createChronicle({ seed: 's', battleId: 'b' });
  const batch = Array.from({ length: CHRONICLE_ENTRY_LIMIT + 40 }, (_, index) => raw({ eventId: `b1:e${index}` }));
  chronicle = recordChronicle(chronicle, batch);
  assert.equal(chronicle.entries.length, CHRONICLE_ENTRY_LIMIT);
  assert.equal(chronicle.dropped, 40);
  assert.equal(chronicleComplete(chronicle), false);
  const composed = composeChronicle(chronicle, {});
  assert.equal(composed.complete, false);
  assert.ok(section(composed, 'account').notes.some((note) => note.includes('begins partway through the war')),
    'a truncated account says it is truncated instead of looking complete');
  assert.match(chronicleText(composed), /this account is incomplete/i, 'and so does the exported text');
});

test('a chronicle belongs to one war and is rejected rather than repaired', () => {
  const { chronicle } = flyWar('chronicle-restore', { rounds: 25 });
  const identity = { seed: chronicle.seed, battleId: chronicle.battleId, rulesRevision: chronicle.rulesRevision };
  const stored = JSON.parse(JSON.stringify(chronicle));
  const restored = restoreChronicle(stored, identity);
  assert.deepEqual(restored.casualties, chronicle.casualties, 'a round-trip preserves the roll exactly');
  assert.equal(restored.observed, chronicle.observed);
  assert.equal(restoreChronicle(stored, { ...identity, seed: 'another-war' }).entries.length, 0);
  assert.equal(restoreChronicle(stored, { ...identity, battleId: 'another-battle' }).casualties.length, 0);
  assert.equal(restoreChronicle({ ...stored, version: CHRONICLE_VERSION + 1 }, identity).entries.length, 0);
  assert.equal(restoreChronicle(null, identity).entries.length, 0);
  // A spliced-in kind the ruling does not declassify is rejected whole, not dropped.
  const tampered = { ...stored, casualties: [...stored.casualties, { kind: 'rescue', hull: 'Invented', attributed: true }] };
  assert.equal(restoreChronicle(tampered, identity).casualties.length, 0, 'an invented casualty cannot be smuggled in');
});

test('composing a chronicle changes no authoritative state and consumes no gameplay randomness', () => {
  const { game, chronicle } = flyWar('chronicle-no-rng', { rounds: 25 });
  const before = JSON.stringify(game);
  const stepBefore = game.randomStep;
  composeChronicle(chronicle, { game, coda: reportFor(game, 'battle-report') });
  casualtyLines(chronicle);
  chronicleText(composeChronicle(chronicle, { game }));
  assert.equal(game.randomStep, stepBefore, 'the seeded counter did not move');
  assert.equal(JSON.stringify(game), before, 'no authoritative field was written');
});

test('the export is plain text a player can keep, and every section is in it', () => {
  const { game, chronicle } = flyWar('chronicle-export', { rounds: 40 });
  const composed = composeChronicle(chronicle, { game, coda: reportFor(game, 'battle-report') });
  const text = chronicleText(composed);
  assert.match(text, /^ARGONAUT — WAR CHRONICLE/);
  assert.match(text, /War seed: chronicle-export/);
  assert.match(text, /Ruleset: Reimagined/);
  assert.match(text, /THE ACCOUNT/);
  assert.match(text, /CASUALTIES, COMPILED FROM THE FLEET'S RETURNS/);
  // The coda reuses reportFor's own title verbatim rather than renaming it.
  assert.match(text, /BATTLE REPORT/);
  assert.match(text, /consolidated fleet return, not a sensor report/, 'and its label says what it is');
  assert.match(text, /ON WHAT THIS ACCOUNT IS BASED/);
  assert.equal(text.includes('[object Object]'), false, 'nothing unstringified reaches the artifact');
  // A Classic war is in scope but spare by design; it must still produce an account.
  const classic = flyWar('chronicle-classic', { reimagined: false, rounds: 40 });
  const classicText = chronicleText(composeChronicle(classic.chronicle, { game: classic.game, coda: reportFor(classic.game, 'battle-report') }));
  assert.match(classicText, /Ruleset: Classic/);
  assert.match(classicText, /CASUALTIES/, 'a classic war still gets a casualty roll');
});

test('an empty chronicle still composes, and says so rather than inventing a war', () => {
  const composed = composeChronicle(createChronicle({ seed: 'x', battleId: 'y' }), {});
  assert.deepEqual(section(composed, 'account').lines, []);
  assert.deepEqual(section(composed, 'casualties').lines, ['No hull was recorded lost.']);
  assert.equal(composed.sections.some((entry) => entry.id === 'coda'), false, 'no coda is fabricated when none is supplied');
  assert.equal(composed.war.ruleset, 'Classic', 'an absent game reads as the default ruleset rather than crashing');
  assert.equal(recordChronicle(createChronicle({}), null).entries.length, 0);
  assert.equal(composeChronicle(null, {}).sections.length > 0, true, 'a null chronicle still composes safely');
});
