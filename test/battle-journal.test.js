import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { applyPlayerAction } from '../game/actions.js';
import { enableBattleRecords } from '../game/battle-records.js';
import { journalCardsHtml } from '../ui/render.js';
import { createJournal, appendRecords, restoreJournal, journalView, projectJournalRecord, formatJournalEvent, JOURNAL_EVENT_LIMIT } from '../ui/battle-journal.js';

const actor = { id: 'argo', name: 'Argo', faction: 'alliance', x: 10, y: 10 };
const target = { id: 'orion', name: 'Orion', faction: 'axis', x: 12, y: 10 };
const visible = { own: false, friendly: false, visible: true, scanned: false, radioContact: false };
const hidden = { own: false, friendly: false, visible: false, scanned: false, radioContact: false };
const record = (n, kind, extra = {}) => ({
  battleId: 'battle', eventId: `battle:e${n}`, simTime: n, kind, actor, target,
  actionId: 'battle:a1', source: 'manual', payload: {},
  knowledge: { observedAt: n, observer: actor, observerActive: true, spectator: false, radioIntegrity: 1, ownAction: true, actor: { ...visible, own: true }, target: visible, globalTerminal: false },
  ...extra,
});
const own = (n, kind, payload, extra = {}) => record(n, kind, { payload, ...extra });
const knowledge = (changes) => ({ ...record(1, 'action').knowledge, ...changes });

test('confirmed destruction is prominent on a collapsed own command and survives existing save reload', () => {
  const rows = [own(1, 'action', { command: 'phasers', request: { targetId: target.id } }),
    own(2, 'weapon-resolution', { weapon: 'phasers', result: 'hit' }),
    own(3, 'destruction', { status: 'destroyed' }, { knowledge: knowledge({ globalTerminal: true }) })];
  const journal = appendRecords(createJournal('battle'), rows);
  const card = journalView(restoreJournal(JSON.parse(JSON.stringify(journal)), 'battle')).recentCommands[0];
  assert.match(card.summary, /^Orion destroyed\./);
  assert.match(card.actionSummary, /fired phasers/);
  assert.equal(card.defeats.length, 1);
  const markup = journalCardsHtml([card]);
  assert.match(markup, /data-defeat-kind="destruction">Orion destroyed\./);
  assert.ok(markup.indexOf('Orion destroyed.') < markup.indexOf('</summary>'));
  assert.deepEqual(journalView(appendRecords(journal, rows)).recentCommands[0].defeats, card.defeats);
});

test('damage or hidden outcomes never invent a defeat, while other terminal states stay distinct', () => {
  for (const result of ['hit', 'miss', 'unknown']) {
    const journal = appendRecords(createJournal('battle'), [own(1, 'action', { command: 'phasers' }), own(2, 'weapon-resolution', { weapon: 'phasers', result, consequences: { delta: { shields: -999 } } })]);
    assert.deepEqual(journalView(journal).recentCommands[0].defeats, []);
  }
  for (const [kind, label] of [['surrender', 'surrendered'], ['vacancy', 'left vacant'], ['capture', 'captured']]) {
    const journal = appendRecords(createJournal('battle'), [own(1, 'action', { command: 'phasers' }), own(2, kind, {}, { knowledge: knowledge({ globalTerminal: kind === 'surrender' }) })]);
    const card = journalView(journal).recentCommands[0];
    assert.match(card.summary, new RegExp(`Orion ${label}`));
    assert.doesNotMatch(card.summary, /destroyed/);
  }
});

test('late terminal ordnance result attaches to its original issuer after command changes', () => {
  let journal = appendRecords(createJournal('battle'), [own(1, 'action', { command: 'photons' }), own(2, 'ordnance-launch', { weapon: 'photons' }, { ordnanceId: 'torpedo' })]);
  const lateKnowledge = knowledge({ ownAction: false, actor: hidden, target: hidden, observer: { id: 'new-command' }, globalTerminal: true });
  journal = appendRecords(journal, [own(3, 'destruction', { status: 'destroyed' }, { ordnanceId: 'torpedo', simTime: 10, knowledge: lateKnowledge }), own(4, 'ordnance-impact', { weapon: 'photons', result: 'hit' }, { ordnanceId: 'torpedo', simTime: 10, knowledge: { ...lateKnowledge, globalTerminal: false } })]);
  const card = journalView(journal).recentCommands[0];
  assert.equal(card.actor.id, 'argo');
  assert.equal(card.defeats[0].target.name, 'Orion');
  assert.equal(card.events.find((event) => event.kind === 'destruction').target.x, undefined);
  assert.match(card.summary, /Orion destroyed/);
});

test('friendly losses are explicit, names are escaped, and hidden global losses do not grant own credit', () => {
  const casualty = { ...actor, id: 'escort', name: '<b>Escort</b>' };
  const journal = appendRecords(createJournal('battle'), [own(1, 'action', { command: 'tractor' }), own(2, 'destruction', { cause: 'tractor-collision' }, { target: casualty, knowledge: knowledge({ globalTerminal: true }) })]);
  const card = journalView(journal).recentCommands[0];
  assert.equal(card.defeats[0].friendlyLoss, true);
  assert.match(card.summary, /Friendly loss:/);
  assert.match(journalCardsHtml([card]), /&lt;b&gt;Escort&lt;\/b&gt;/);
  assert.doesNotMatch(journalCardsHtml([card]), /<b>Escort/);
  const distant = appendRecords(createJournal('battle'), [record(1, 'destruction', { actionId: 'enemy-shot', knowledge: knowledge({ ownAction: false, actor: hidden, target: hidden, globalTerminal: true }), payload: { cause: 'secret-weapon' } })]);
  assert.equal(journalView(distant).recentCommands.length, 0);
  assert.equal(journalView(distant).battleDevelopments[0].defeats.length, 1);
  assert.ok(!JSON.stringify(distant).includes('secret-weapon'));
});

test('knowledge projection precedes storage and hidden outcomes contain no payload or target secrets', () => {
  const raw = own(1, 'weapon-resolution', { weapon: 'phasers', result: 'hit', damage: 77, consequences: { delta: { shields: -77, systems: { radio: -4 } }, before: { crew: 777 } }, secret: 'hidden' }, { knowledge: knowledge({ target: hidden }) });
  const journal = appendRecords(createJournal('battle'), [raw]);
  const encoded = JSON.stringify(journal);
  assert.equal(journal.events[0].result, 'unknown');
  for (const secret of ['Orion', 'orion', '777', '77', 'radio', 'hidden', 'payload', 'knowledge', 'before']) assert.ok(!encoded.includes(secret), secret);
  assert.equal(journal.events[0].target, null);
});

test('own observed hits preserve confirmed deltas, received damage, and frozen attribution', () => {
  const raw = own(1, 'weapon-resolution', { weapon: 'phasers', result: 'hit', consequences: { delta: { shields: -12, crew: -1, arcs: { fore: -8 }, systems: { radio: -1 } } } });
  const journal = appendRecords(createJournal('battle'), [raw]);
  raw.actor.name = 'Captured name';
  assert.equal(journal.events[0].actor.name, 'Argo');
  assert.match(formatJournalEvent(journal.events[0]), /12 shields lost/);
  assert.match(formatJournalEvent(journal.events[0]), /fore arc 8 damage/);
  raw.actor.name = 'Argo';
  const incoming = record(2, 'damage', { source: 'fleet-ai', actor: target, target: actor, knowledge: knowledge({ ownAction: false, radioIntegrity: 0, actor: hidden, target: { ...visible, own: true } }), payload: { consequences: { delta: { shields: -5 } } } });
  const event = projectJournalRecord(incoming);
  assert.equal(event.group, 'your-ship');
  assert.equal(event.actor, null);
  assert.equal(event.delta.shields, -5);
  assert.equal(event.detail, 'confirmed');
});

test('radio damage abbreviates fleet facts without weakening own-action results', () => {
  const allied = { ...hidden, friendly: true, radioContact: true };
  const raw = record(1, 'damage', { source: 'fleet-ai', knowledge: knowledge({ ownAction: false, actor: allied, target: allied }), payload: { consequences: { delta: { shields: -9 } } } });
  assert.equal(projectJournalRecord(raw).delta.shields, -9);
  const degraded = projectJournalRecord({ ...raw, knowledge: { ...raw.knowledge, radioIntegrity: 0.5 } });
  assert.equal(degraded.detail, 'abbreviated');
  assert.equal(degraded.delta, undefined);
  assert.equal(degraded.target.x, undefined);
  assert.match(formatJournalEvent(degraded), /abbreviated/);
  assert.equal(projectJournalRecord({ ...raw, knowledge: { ...raw.knowledge, radioIntegrity: 0 } }), null);
});

test('global terminal losses expose identity and terminal fact, never hidden killer or systems', () => {
  const event = projectJournalRecord(record(1, 'destruction', {
    knowledge: knowledge({ ownAction: false, actor: hidden, target: hidden, globalTerminal: true }),
    payload: { status: 'destroyed', consequences: { delta: { crew: -400, systems: { phasers: -9 } } } },
  }));
  assert.equal(event.group, 'battle-developments');
  assert.equal(event.actor, null);
  assert.equal(event.target.name, 'Orion');
  assert.equal(event.target.x, undefined);
  assert.equal(event.delta, undefined);
});

test('a historical scan alone cannot grant a new location or outcome', () => {
  const event = projectJournalRecord(own(1, 'ordnance-impact', { weapon: 'photons', result: 'hit', point: { x: 999, y: 999 } }, { ordnanceId: 'torpedo', knowledge: knowledge({ target: { ...hidden, scanned: true } }) }));
  assert.equal(event.result, 'unknown');
  assert.equal(event.target, null);
  assert.equal(event.point, undefined);
});

test('delayed own ordnance retains original issuer after capture/transfer and uses impact time', () => {
  let journal = appendRecords(createJournal('battle'), [own(1, 'action', { command: 'photons', request: { targetId: 'orion' } }), own(2, 'ordnance-launch', { weapon: 'photons' }, { ordnanceId: 'torpedo' })]);
  assert.equal(journalView(journal).recentCommands[0].status, 'pending');
  journal = appendRecords(journal, [own(3, 'ordnance-impact', { weapon: 'photons', result: 'hit' }, { simTime: 19.25, ordnanceId: 'torpedo', knowledge: knowledge({ ownAction: false, actor: hidden, target: hidden, observer: { id: 'new-command' } }) })]);
  const card = journalView(journal).recentCommands[0];
  assert.equal(card.status, 'unknown');
  assert.equal(card.actor.name, 'Argo');
  assert.equal(card.events.at(-1).issuingShipId, 'argo');
  assert.equal(card.events.at(-1).simTime, 19.25);
  assert.match(card.lines.at(-1), /20.25.*outcome unknown/);
  assert.equal(Object.keys(journal.pending).length, 0);
  assert.equal(card.events.filter((event) => event.kind === 'action').length, 1);
});

test('record replay, duplicate batches and reloaded streams are idempotent by event ID', () => {
  const rows = [own(1, 'action', { command: 'phasers' }), own(2, 'weapon-resolution', { weapon: 'phasers', result: 'miss' })];
  const journal = appendRecords(createJournal('battle'), [rows[1], rows[0], rows[0]]);
  assert.equal(journal.events.length, 2);
  assert.strictEqual(appendRecords(journal, rows), journal);
  const restored = restoreJournal(JSON.parse(JSON.stringify(journal)), 'battle');
  assert.deepEqual(restored, journal);
  assert.strictEqual(appendRecords(restored, rows), restored);
  assert.equal(appendRecords(restored, [own(3, 'action', { command: 'pass' }, { battleId: 'other' })]), restored);
  assert.equal(journalView(restored).latestSequence, 2);
});

test('same seed new battle cannot inherit journal and legacy cards remain unlinked text', () => {
  const legacy = [{ turn: 4, shipId: 'stale-id', shipName: 'Old Argo', messages: ['Old order resolved.'] }];
  const journal = restoreJournal(null, 'battle', legacy);
  const card = journalView(journal).recentCommands[0];
  assert.equal(card.source, 'legacy');
  assert.equal(card.actor.id, undefined);
  assert.deepEqual(card.events, []);
  assert.equal(card.lines[0], legacy[0].messages[0]);
  assert.deepEqual(restoreJournal(journal, 'new-battle').events, []);
  assert.equal(journalView(restoreJournal(journal, 'new-battle')).recentCommands.length, 0);
});

test('retention evicts completed causal groups together and keeps only twelve recent commands', () => {
  const rows = Array.from({ length: 260 }, (_, i) => [
    own(i * 2 + 1, 'action', { command: 'phasers' }, { actionId: `battle:a${i + 1}` }),
    own(i * 2 + 2, 'weapon-resolution', { weapon: 'phasers', result: 'miss' }, { actionId: `battle:a${i + 1}` }),
  ]).flat();
  const journal = appendRecords(createJournal('battle'), rows);
  assert.equal(journal.events.length, JOURNAL_EVENT_LIMIT);
  assert.equal(journal.truncated, 20);
  assert.equal(journalView(journal).recentCommands.length, 12);
  assert.equal(journal.events[0].kind, 'action');
  assert.ok(journalView(journal).yourShip.every((card) => card.events.length === 2));
});

test('pending launch survives card eviction and reload without retaining raw events', () => {
  let journal = appendRecords(createJournal('battle'), [own(1, 'action', { command: 'photons' }), own(2, 'ordnance-launch', { weapon: 'photons', secret: 'never save' }, { ordnanceId: 'torpedo' })]);
  journal = appendRecords(journal, Array.from({ length: 501 }, (_, i) => own(i + 3, 'action', { command: 'pass' }, { actionId: `battle:a${i + 2}` })));
  assert.equal(journal.events.some((event) => event.actionId === 'battle:a1'), false);
  assert.equal(journal.pending.torpedo.actor.name, 'Argo');
  assert.equal(JSON.stringify(journal.pending).includes('never save'), false);
  journal = restoreJournal(JSON.parse(JSON.stringify(journal)), 'battle');
  journal = appendRecords(journal, [own(504, 'ordnance-impact', { weapon: 'photons', result: 'hit' }, { ordnanceId: 'torpedo', knowledge: knowledge({ ownAction: false, actor: hidden, target: hidden }) })]);
  const card = journalView(journal).yourShip[0];
  assert.equal(card.earlierDetailDiscarded, true);
  assert.equal(card.actor.name, 'Argo');
  assert.equal(card.status, 'unknown');
  assert.equal(card.simTime, 1);
  assert.equal(Object.keys(journal.pending).length, 0);
  assert.ok(journal.events.length <= 500);
});

test('restore ignores unrestricted fields and journal formatting has no live state dependency', () => {
  const journal = appendRecords(createJournal('battle'), [own(1, 'action', { command: 'phasers' })]);
  journal.events[0].payload = { secret: 'never persist' };
  journal.events[0].knowledge = { observer: { secret: 'never persist' } };
  const clean = restoreJournal(journal, 'battle');
  assert.equal(JSON.stringify(clean).includes('never persist'), false);
  assert.match(journalView(clean).recentCommands[0].summary, /Argo.*phasers accepted/);
});

test('actual accepted engine records project without mutating engine state', () => {
  let game = enableBattleRecords(createGame({ seed: 'journal-engine' }), { battleId: 'battle' });
  const player = getShip(game, game.playerShipId);
  const enemy = game.ships.find((ship) => ship.faction !== player.faction && ship.status === 'active');
  game = { ...game, terrain: [], ships: game.ships.map((ship) => ship.id === player.id ? { ...ship, x: 10, y: 10 } : ship.id === enemy.id ? { ...ship, x: 12, y: 10 } : ship) };
  const outcome = applyPlayerAction(game, { type: 'phasers', targetId: enemy.id });
  assert.ok(outcome.records.length > 1);
  const before = JSON.stringify(outcome.game);
  const journal = appendRecords(createJournal('battle'), outcome.records);
  assert.equal(JSON.stringify(outcome.game), before);
  assert.equal(journalView(journal).recentCommands.length, 1);
  assert.ok(journal.events.some((event) => event.kind === 'weapon-resolution'));
  assert.equal(JSON.stringify(journal).includes('knowledge'), false);
});

test('routine fleet flood cannot evict the latest own commands', () => {
  let journal = appendRecords(createJournal('battle'), [own(1, 'action', { command: 'phasers' }), own(2, 'weapon-resolution', { weapon: 'phasers', result: 'hit' })]);
  journal = appendRecords(journal, Array.from({ length: 700 }, (_, i) => record(i + 3, 'action', {
    actionId: `battle:a${i + 2}`, source: 'fleet-ai', payload: { command: 'pass' },
    knowledge: knowledge({ ownAction: false, actor: visible }),
  })));
  assert.equal(journal.events.length, 500);
  assert.equal(journalView(journal).recentCommands[0].command, 'phasers');
  assert.match(journalView(journal).recentCommands[0].lines[0], /hit/);
});

test('oversized own causal group retains bounded command summary with explicit missing detail', () => {
  const rows = [own(1, 'action', { command: 'spread' }), ...Array.from({ length: 501 }, (_, i) => own(i + 2, 'damage', { consequences: { delta: { shields: -1 } } }))];
  const journal = appendRecords(createJournal('battle'), rows);
  assert.ok(journal.events.length <= 500);
  assert.equal(journal.ownCommands.length, 1);
  const card = journalView(journal).recentCommands[0];
  assert.equal(card.command, 'spread');
  assert.equal(card.earlierDetailDiscarded, true);
  assert.match(card.lines[0], /discarded/);
  assert.deepEqual(restoreJournal(JSON.parse(JSON.stringify(journal)), 'battle'), journal);
});

test('mapper sightings expose no unscanned third-party internal damage', () => {
  const raw = record(1, 'damage', { source: 'fleet-ai', knowledge: knowledge({ ownAction: false, actor: visible }), payload: { crewDamage: 9, consequences: { delta: { shields: -4, crew: -9, systems: { radio: -7 } } } } });
  const event = projectJournalRecord(raw);
  assert.equal(event.delta.shields, -4);
  assert.equal(event.delta.crew, undefined);
  assert.equal(event.delta.systems, undefined);
  assert.equal(event.crewDamage, undefined);
  const scanned = projectJournalRecord({ ...raw, knowledge: { ...raw.knowledge, target: { ...visible, scanned: true } } });
  assert.equal(scanned.delta.crew, -9);
});

test('transient lost command does not turn engine mapper fallback into journal omniscience', () => {
  const raw = record(1, 'weapon-resolution', { knowledge: knowledge({ ownAction: false, observerActive: false, actor: visible, target: visible }), payload: { weapon: 'phasers', result: 'hit' } });
  assert.equal(projectJournalRecord(raw), null);
  assert.equal(projectJournalRecord({ ...raw, knowledge: { ...raw.knowledge, spectator: true } }).result, 'hit');
});

test('late old ordnance remains accessible without displacing the latest twelve issued commands', () => {
  let journal = appendRecords(createJournal('battle'), [own(1, 'action', { command: 'photons' }), own(2, 'ordnance-launch', { weapon: 'photons' }, { ordnanceId: 'torpedo' })]);
  journal = appendRecords(journal, Array.from({ length: 13 }, (_, i) => own(i + 3, 'action', { command: 'pass' }, { actionId: `battle:a${i + 2}` })));
  const before = journalView(journal).recentCommands.map((card) => card.id);
  journal = appendRecords(journal, [own(16, 'ordnance-impact', { weapon: 'photons', result: 'hit' }, { ordnanceId: 'torpedo' })]);
  const view = journalView(journal);
  assert.deepEqual(view.recentCommands.map((card) => card.id), before);
  assert.equal(view.yourShip[0].command, 'photons');
  assert.equal(view.yourShip[0].status, 'resolved');
  assert.equal(view.yourShip[0].events.at(-1).simTime, 16);
  assert.ok(!view.recentCommands.includes(view.yourShip[0]));
});

test('incoming enemy action is an own-ship effect, never an issued own command', () => {
  const journal = appendRecords(createJournal('battle'), [record(1, 'action', {
    actor: target, target: actor, source: 'fleet-ai', payload: { command: 'phasers' },
    knowledge: knowledge({ ownAction: false, actor: visible, target: { ...visible, own: true } }),
  })]);
  const view = journalView(journal);
  assert.equal(view.recentCommands.length, 0);
  assert.equal(view.yourShip.length, 1);
  assert.equal(view.yourShip[0].isOwnCommand, false);
});

test('an incoming command-ship destruction is labeled a friendly loss, not a credited defeat', () => {
  const journal = appendRecords(createJournal('battle'), [record(1, 'destruction', {
    actor: target, target: actor, source: 'fleet-ai', payload: { status: 'destroyed' },
    knowledge: knowledge({ ownAction: false, globalTerminal: true, actor: visible, target: { ...visible, own: true } }),
  })]);
  const view = journalView(journal);
  assert.equal(view.recentCommands.length, 0);
  assert.match(view.yourShip[0].defeats[0].text, /^Friendly loss: Argo destroyed/);
});

test('delayed facts retain launcher attribution without restamping launch coordinates as a fresh sighting', () => {
  let journal = appendRecords(createJournal('battle'), [own(1, 'action', { command: 'photons' }), own(2, 'ordnance-launch', { weapon: 'photons' }, { ordnanceId: 'torpedo' })]);
  // The launcher moved and was captured; raw actor still attributes the old
  // alliance launch at (10,10), while current event knowledge sees its new hull.
  journal = appendRecords(journal, [own(3, 'ordnance-impact', { weapon: 'photons', result: 'hit' }, {
    ordnanceId: 'torpedo', knowledge: knowledge({ ownAction: false, actor: visible, observer: { id: 'new-command' } }),
  }), own(4, 'damage', { consequences: { delta: { shields: -8 } } }, {
    ordnanceId: 'torpedo', knowledge: knowledge({ ownAction: false, actor: visible, observer: { id: 'new-command' } }),
  })]);
  for (const event of journal.events.slice(-2)) {
    assert.equal(event.actor.name, 'Argo');
    assert.equal(event.actor.faction, 'alliance');
    assert.equal(event.actor.x, undefined);
    assert.equal(event.actor.y, undefined);
    assert.equal(event.target.x, 12, 'target position is the actual event snapshot');
  }
  assert.equal(journal.events[1].actor.x, 10, 'launch retains its correctly timed sighting');
  assert.deepEqual(restoreJournal(JSON.parse(JSON.stringify(journal)), 'battle'), journal);
});
