import { ARCS, DOCKING, FACTIONS, GRID_SIZE, POWER_SINKS, PRIZE, RANGES, REFITS, STANCES, TERRAIN } from '../game/constants.js';
import { actionAvailability, canLaunchDrones, REALTIME_COOLDOWN } from '../game/actions.js';
import { scenarioFor, scenarioProgress } from '../game/scenarios.js';
import { isOperation } from '../game/operations.js';
import { cameraWindow, fieldTransform, viewportFromWorld } from './camera.js';
import { drawMove } from './fx.js';
import {
  abbreviateNarrative,
  alertLevel,
  arcFocusOf,
  arcsOf,
  crewCapacity,
  describeOrder,
  distance,
  dockedAt,
  movementCapacity,
  maintainedTowPair,
  facingOf,
  getShip,
  hasArcs,
  inRadioContact,
  isAce,
  isActive,
  isDrone,
  isNeutral,
  isSpectator,
  isTractorHeld,
  nebulaHides,
  orderFor,
  pendingOrderFor,
  powerAllocation,
  powerEffect,
  radioIntegrity,
  reactorOutput,
  sensorRange,
  stanceOf,
  struckArc,
  systemUnits,
} from '../game/state.js';

import { commandHistoryHtml } from './command-history.js';
import { isRescueTowTarget } from './tow-preview.js';
import { journalView } from './battle-journal.js';
import { updateConsole, updateScrolledContent } from './console-state.js';
import { simTimeOf } from '../game/realtime.js';
import { factionBadgeHtml, factionBadgeSvg, factionText } from './faction-identity.js';

const escapeJournal = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const journalReaders = new WeakMap();
const journalReaderHtml = new WeakMap();
const journalReaderIds = ['command-log', 'your-ship-effects', 'battle-developments-log', 'fleet-journal-log', 'journal-log'];

// These cards receive only the event-time projection. Historical names, results
// and observation times never come from the current ships or radio condition.
export const journalCardsHtml = (cards = [], region = 'history') => cards.map((card) => {
  const id = `${region}-${encodeURIComponent(card.id)}`;
  const automatic = card.source === 'automatic' || card.source === 'auto-conn';
  const summary = (card.source === 'legacy' ? card.lines?.[0] : card.actionSummary ?? card.summary) ?? card.summary ?? '';
  const defeats = (card.defeats ?? []).map((outcome) => `<span class="journal-defeat${outcome.friendlyLoss ? ' friendly-loss' : ''}" data-defeat-kind="${escapeJournal(outcome.kind)}">${escapeJournal(outcome.text)}</span>`).join('');
  // Some causal summaries already carry their current state. Avoid repeating
  // that label; state still comes exclusively from the projected card contract.
  const status = card.status === 'pending' && !summary.toLowerCase().includes('awaiting impact') ? 'Launched; awaiting impact'
    : card.status === 'unknown' && !summary.toLowerCase().includes('outcome unknown') ? 'Outcome unknown' : '';
  // Snapshot identities, including changes within a capture group, come only
  // from the already filtered records. No lookup against the live game.
  const identities = new Map();
  for (const snapshot of [card.actor, card.target, ...(card.events ?? []).flatMap((event) => [event.actor, event.target, event.launch?.actor])]) {
    if (snapshot?.name && snapshot?.faction) identities.set(`${snapshot.name}:${snapshot.faction}`, snapshot);
  }
  const identityLine = [...identities.values()].map((snapshot) => `<span>${escapeJournal(snapshot.name)} · ${factionBadgeHtml(snapshot.faction)}</span>`).join(' · ');
  const stampIdentity = [...identities.values()][0];
  return `<li id="${escapeJournal(id)}" class="journal-card" data-journal-id="${escapeJournal(card.id)}" data-journal-sequence="${card.sequence}">
    <details><summary><span class="command-stamp">Stardate ${escapeJournal(card.source === 'legacy' ? card.simTime : Math.round((card.simTime + 1) * 10) / 10)}${automatic ? ' · Automatic conn' : card.source === 'legacy' ? ` · ${escapeJournal(card.actor?.name)} · Legacy text record` : ''}${stampIdentity ? ` · ${factionBadgeHtml(stampIdentity.faction)}` : ''}</span>${defeats}<span class="journal-summary">${escapeJournal(summary)}</span>${status ? `<span class="journal-state">${status}</span>` : ''}</summary>
    ${identityLine ? `<p class="journal-identities">At event time: ${identityLine}</p>` : ''}
    ${(card.lines ?? []).map((line) => `<p>${escapeJournal(line)}</p>`).join('')}
    ${card.earlierDetailDiscarded ? '<p class="journal-note">Earlier detail discarded; this is a partial record.</p>' : ''}</details></li>`;
}).join('');

// Reconcile keyed cards to retain the actual focused summary and its expansion.
// When arrivals are inserted above a reader, anchor the first visible old card
// to the same pixel rather than merely restoring a now different scroll offset.
const updateJournalReader = (root, html) => {
  if (!root) return;
  if (journalReaderHtml.get(root) === html) return;
  journalReaderHtml.set(root, html);
  const reading = root.scrollTop > 2;
  const edge = root.getBoundingClientRect?.().top;
  const anchor = reading && edge != null ? [...root.children].find((node) => node.getBoundingClientRect().bottom > edge) : null;
  const offset = anchor ? anchor.getBoundingClientRect().top - edge : 0;
  const active = document.activeElement;
  const focusInCard = root.contains?.(active) && active !== root;
  updateConsole(root, html);
  if (anchor?.isConnected) root.scrollTop += anchor.getBoundingClientRect().top - root.getBoundingClientRect().top - offset;
  if (focusInCard && active?.isConnected && document.activeElement !== active) active.focus?.({ preventScroll: true });
};

export const renderBattleJournal = (journal) => {
  const root = document.querySelector('#battle-journal');
  if (!root || !journal) return null;
  let reader = journalReaders.get(root);
  if (!reader || reader.battleId !== journal.battleId) {
    reader = { battleId: journal.battleId, filter: 'all', seen: 0, fleetSeen: 0, announced: 0, model: null };
    journalReaders.set(root, reader);
  }
  const model = reader.journal === journal ? reader.model : journalView(journal);
  reader.journal = journal;
  reader.model = model;
  const get = (id) => document.querySelector(`#${id}`);
  const pageReading = () => (root.getBoundingClientRect?.().top ?? 0) < -2;
  const away = () => journalReaderIds.some((id) => (get(id)?.scrollTop ?? 0) > 2) || (root.scrollTop ?? 0) > 2 || pageReading();
  const fleet = get('fleet-traffic');
  const expanded = get('journal-expanded');
  const markFleetRead = () => {
    const region = get('fleet-journal-log');
    if (!fleet?.open || (region?.scrollTop ?? 0) > 2) return;
    const first = region.firstElementChild;
    if (!first?.getBoundingClientRect) return;
    const top = first.getBoundingClientRect().top;
    const bounds = region.getBoundingClientRect();
    const panel = root.getBoundingClientRect();
    if (top >= Math.max(0, bounds.top, panel.top) - 2 && top < Math.min(globalThis.window.innerHeight, bounds.bottom, panel.bottom)) journalReaders.get(root).fleetSeen = journalReaders.get(root).model.latestSequence;
  };
  const draw = () => {
    const pageAnchor = pageReading() ? [...root.querySelectorAll('[data-journal-id]')].find((node) => !node.closest('[hidden]')
      && (!node.closest('#fleet-traffic') || fleet.open) && (!node.closest('#journal-expanded') || expanded.open)
      && node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().bottom > 0 && node.getBoundingClientRect().top < globalThis.window.innerHeight) : null;
    const pageAnchorTop = pageAnchor?.getBoundingClientRect().top;
    const heldReader = journalReaderIds.map(get).find((node) => (node?.scrollTop ?? 0) > 2 && node.children);
    const held = heldReader ? [...heldReader.children].find((node) => node.getBoundingClientRect().bottom > heldReader.getBoundingClientRect().top) : null;
    const heldTop = held?.getBoundingClientRect().top;
    const current = journalReaders.get(root);
    const model = current.model;
    const commands = model.recentCommands;
    const commandIds = new Set(commands.map((card) => card.id));
    const effects = model.yourShip.filter((card) => !commandIds.has(card.id) && (!card.isOwnCommand || card.events.some((event) => event.kind === 'ordnance-impact'))).slice(0, 12);
    get('command-history').hidden = !commands.length && !effects.length;
    get('your-ship-effects').hidden = !effects.length;
    get('battle-developments').hidden = !model.battleDevelopments.length;
    get('fleet-journal-log').hidden = !model.fleetTraffic.length;
    updateJournalReader(get('command-log'), journalCardsHtml(commands, 'own'));
    updateJournalReader(get('your-ship-effects'), journalCardsHtml(effects, 'effect'));
    updateJournalReader(get('battle-developments-log'), journalCardsHtml(model.battleDevelopments.slice(0, 6), 'development'));
    if (fleet?.open || !fleet?.tagName) updateJournalReader(get('fleet-journal-log'), journalCardsHtml(model.fleetTraffic, 'fleet'));
    const all = [...model.yourShip, ...model.battleDevelopments, ...model.fleetTraffic].sort((a, b) => a.sequence < 0 && b.sequence < 0 ? a.sequence - b.sequence : b.sequence - a.sequence);
    if (expanded?.open || !expanded?.tagName) updateJournalReader(get('journal-log'), journalCardsHtml(all.filter((card) => current.filter === 'all' || card.group === current.filter), 'full'));
    get('journal-retention').textContent = model.truncated ? 'Earlier battle detail has been discarded. This journal contains the available retained records.' : 'Available retained records · newest first';
    for (const button of root.querySelectorAll?.('[data-journal-filter]') ?? []) button.setAttribute('aria-pressed', String(button.dataset.journalFilter === current.filter));
    const unread = all.flatMap((card) => card.events ?? []).filter((event) => event.sequence > current.seen).length;
    const fleetUnread = model.fleetTraffic.flatMap((card) => card.events ?? []).filter((event) => event.sequence > current.fleetSeen).length;
    get('fleet-unread').textContent = fleetUnread ? `· ${fleetUnread} unread` : '';
    get('journal-latest').hidden = !away();
    get('journal-latest').textContent = unread ? `${unread} new event${unread === 1 ? '' : 's'} · Return to latest` : 'Return to latest';
    if (held?.isConnected) root.scrollTop += held.getBoundingClientRect().top - heldTop;
    if (pageAnchor?.isConnected) globalThis.window?.scrollBy(0, pageAnchor.getBoundingClientRect().top - pageAnchorTop);
  };
  // Wire only the stable shell. Event handlers always obtain the current battle
  // reader so a new game cannot inherit the old battle's unread counter.
  if (!root.dataset?.journalWired && root.addEventListener) {
    root.dataset.journalWired = 'true';
    root.addEventListener('click', (event) => {
      const current = journalReaders.get(root);
      const filter = event.target.closest?.('[data-journal-filter]');
      if (filter) { current.filter = filter.dataset.journalFilter; get('journal-log').scrollTop = 0; draw(); }
      if (event.target.closest?.('#journal-latest')) {
        for (const id of journalReaderIds) get(id).scrollTop = 0;
        root.scrollTop = 0;
        if (pageReading()) root.scrollIntoView({ block: 'start' });
        current.seen = current.model.latestSequence;
        if (fleet.open) current.fleetSeen = current.model.latestSequence;
        draw();
      }
    });
    root.addEventListener('toggle', (event) => {
      if (event.target === fleet && fleet.open) journalReaders.get(root).fleetSeen = journalReaders.get(root).model.latestSequence;
      draw();
    }, true);
    const readPosition = (event) => {
      const current = journalReaders.get(root);
      if (!away()) current.seen = current.model.latestSequence;
      markFleetRead();
      draw();
    };
    root.addEventListener('scroll', readPosition, true);
    globalThis.window?.addEventListener('scroll', readPosition, { passive: true });
  }
  if (!away()) reader.seen = model.latestSequence;
  markFleetRead();
  draw();
  const own = model.yourShip.find((card) => card.sequence > reader.announced);
  const critical = model.battleDevelopments.find((card) => card.sequence > reader.announced);
  reader.announced = model.latestSequence;
  return critical?.summary ?? own?.summary ?? null;
};

const commands = [
  ['computer', 'Computer', '0'],
  ['shields', 'Shields', '1'],
  ['move', 'Engines', '2'],
  ['phasers', 'Phasers', '3'],
  ['photons', 'Photons', '4'],
  ['tractor', 'Tractor', '5'],
  ['scan', 'Scanner', '6'],
  ['map', 'Mapper', '7'],
  ['transport', 'Transport', '8'],
  ['radio', 'Radio', '9'],
  ['hyperspace', 'Hyperspace', '−'],
  ['self-destruct', 'Self-destruct', '='],
  ['pass', 'Pass turn', 'P'],
  ['autopilot', 'Autopilot', '`'],
  ['resign', 'Resign', 'Esc'],
  ['rollcall', 'Roll call', 'R'],
  ['shots', 'Shots', 'S'],
  ['statistics', 'Statistics', 'L'],
  ['fullmap', 'War zone', 'Bksp'],
];

/**
 * Fleet orders only exist in a Reimagined war, so the button appears only there.
 * The bay command (round 20) appears only while the conn is on a Reimagined
 * carrier whose drones are still aboard; the spread tubes (round 22c) and ion
 * emitter (round 22a) only on a hull that carries them; and Disengage (round 21)
 * in any Reimagined war — a command that could not land never gets a button.
 */
const commandList = (game, actor) => {
  let list = game.reimagined ? [...commands, ['fleet', 'Fleet orders', 'F']] : commands;
  if (canLaunchDrones(game, actor)) list = [...list, ['launch', 'Launch drones', 'D']];
  if (game.reimagined) {
    if ((actor?.systems?.spread ?? 0) > 0) list = [...list, ['spread', 'Spread', 'T']];
    if ((actor?.systems?.ion ?? 0) > 0) list = [...list, ['ion', 'Ion', 'I']];
    list = [...list, ['disengage', 'Disengage', 'X']];
  }
  return list;
};

const cap = (value) => value[0].toUpperCase() + value.slice(1);

export const commandReadiness = (game, view = {}) => {
  if (game.outcome) return game.operation ? 'Operation concluded.' : 'War concluded.';
  if (isSpectator(game)) return 'Observing — command unavailable.';
  if (view.battlePaused || game.phase !== 'player') return 'Resolving orders — command unavailable.';
  if (!game.realtime) return 'Ready — choose a command for this stardate.';
  const remaining = Math.max(0, (game.readyAt?.[game.playerShipId] ?? 0) - simTimeOf(game));
  return `${remaining > 0 ? `Command cycle: ${remaining.toFixed(1)} stardates remaining.` : 'Command cycle ready.'} Automatic conn: ${game.autoConn ? 'on' : 'off'}.`;
};

const consoleSection = (key, label, content) => content
  ? `<details class="console-section" data-console-key="${key}"><summary>${label}</summary>${content}</details>` : '';

const terminalHeading = (event) => event.kind === 'destruction' ? 'SHIP DESTROYED' : event.kind === 'surrender' ? 'SHIP SURRENDERED' : event.kind === 'battle-outcome' ? 'BATTLE COMPLETED' : 'COMMAND LOST';

const terminalDescription = (event) => {
  if (event.message) return event.message;
  const victim = `${event.shipName} · ${event.faction}`;
  if (event.kind === 'surrender') {
    return event.surrenderedTo ? `${victim} — surrendered to ${event.surrenderedTo}.` : `${victim} — surrendered.`;
  }
  if (event.attackerName) {
    const attacker = `${event.attackerName}${event.attackerFaction ? ` · ${event.attackerFaction}` : ''}`;
    return `${victim} — destroyed by ${attacker} using ${event.cause}.`;
  }
  return `${victim} — destroyed by ${event.cause}.`;
};

/**
 * Positions are fractional in a real-time war (round 31); every narrative and
 * report readout rounds them, the way the turn-based war's integer field always
 * read. The map and the sim clock keep the fractions.
 */
const coordOf = (ship) => `${Math.round(ship.x)}, ${Math.round(ship.y)}`;

// Round 33: the six hull classes the concept sheets carry a sprite for
// (assets/sprites/<alliance>/<class>.png, sliced by scripts/slice-sprites.mjs),
// keyed off the template className a live ship carries. Drones, merchants, and
// the starbase have no sheet art and keep their glyphs.
const SPRITE_SLUGS = new Map([
  ['Battle cruiser', 'battle-cruiser'],
  ['Cruiser', 'cruiser'],
  ['Scout', 'scout'],
  ['Interceptor', 'interceptor'],
  ['Artillery', 'artillery'],
  ['Carrier', 'carrier'],
  // Round 34, Gemini batch 2: Xanadu wears its commissioned starbase art.
  ['Starbase', 'starbase'],
  // Batch 2: drones swap the D disc for their faction's drone sprite, and
  // neutral merchants swap the civilian disc (wreck treatment waits on art).
  ['Drone', 'drone'],
  ['Merchant', 'merchant'],
]);

// Batch-2 drone art lands one faction at a time; a wing whose alliance has no
// drone sprite yet keeps its D disc rather than referencing a missing file.
// All four faction drones landed 2026-09-29; the gate stays as the pattern
// for any future faction-specific sprite gap.
const DRONE_SPRITE_FACTIONS = new Set(['Federation', 'Axis', 'Bloc', 'Cabal']);

export const terminalNarrative = (event) => {
  if (!event) return '';
  return `<li class="terminal-event ${event.faction ?? ''}"><strong>${terminalHeading(event)}${event.importance ? ` · ${escapeJournal(event.importance)}` : ''}</strong><span>${event.faction ? `${factionBadgeHtml(event.faction)} · ` : ''}${escapeJournal(terminalDescription(event))}</span></li>`;
};

export const terminalGroupNarrative = (group) => {
  if (!group) return '';
  if (group.members.length === 1) return `<ol>${terminalNarrative(group.members[0])}</ol>`;
  return `<p class="terminal-summary"><strong>${group.members.length} routine losses</strong> · Details below retain every event in order.</p>`;
};

const ORDER_BUTTONS = Object.freeze([
  ['focus', 'Focus with fleet'],
  ['hold', 'Hold position'],
  ['rescue', 'Rescue Sentinel'],
  ['recover', 'Recover prize'],
  ['withdraw', 'Withdraw'],
  ['escort', 'Escort…'],
  ['screen', 'Screen…'],
  ['intercept', 'Intercept…'],
  // Round 17: mustering a boarding party is a Reimagined-war order, so the button
  // only appears there (setOrder refuses it elsewhere regardless).
  ['board', 'Board…'],
  // Round 20: the bay order, Reimagined-only and carrier-only — the button grows
  // out of a carrier's menu alone, and setOrder refuses it anywhere else.
  ['launch', 'Launch drones'],
]);

/** The order buttons a war mode offers: `board` and `launch` are Reimagined-only. */
const orderButtonsFor = (game, ship) => ORDER_BUTTONS.filter(([type]) => {
  if (type === 'recover') return game.reimagined && !game.realtime && game.operation && !game.operation.result && ![game.playerShipId, game.operation.targetId, game.operation.prizeId].includes(ship.id);
  if (type === 'rescue') return game.reimagined && !game.realtime && game.operation?.primary === 'pending' && ship.id !== game.playerShipId && ship.id !== game.operation.targetId;
  if (type === 'board') return game.reimagined;
  // The bay order only appears where the rules would accept it: a Reimagined
  // carrier whose complement is still aboard.
  if (type === 'launch') return canLaunchDrones(game, ship);
  return true;
});

/** How the fleet report and the ship menu read a prize of war (round 17). */
const prizeNote = (ship) => {
  if (!ship?.prize) return '';
  const manning = ship.crew < crewCapacity(ship) * PRIZE.manningFloor ? ', under-manned' : '';
  return ` — prize of war from the ${ship.prize.from}, stardate ${ship.prize.turn}, prize crew ${ship.crew}/${crewCapacity(ship)}${manning}`;
};

/** Short labels for the four shield arcs (round 23), used across console/menu/reports. */
const ARC_LABELS = { fore: 'Fore', starboard: 'Stbd', aft: 'Aft', port: 'Port' };

const targetedCommands = new Set(['phasers', 'photons', 'spread', 'ion', 'tractor', 'scan', 'transport']);

/** Current mapper geometry only: a past scan never reveals a hidden live hull. */
export const targetGeometryKnown = (game, target) => {
  if (!target) return false;
  const actor = getShip(game, game.playerShipId);
  return isSpectator(game) || (isActive(actor) && (target.id === actor.id
    || (distance(actor, target) <= sensorRange(game, actor, 'mapper') && !nebulaHides(game, actor, target))));
};

/** Read-only public explanation; no accuracy rolls or target system inspection. */
export const targetExplanation = (game, action, view = {}) => {
  const target = getShip(game, action.targetId);
  const known = targetGeometryKnown(game, target);
  const result = actionAvailability(game, action, { targetKnown: known });
  const unavailable = view.battlePaused ? 'Resolving orders — command unavailable.' : isSpectator(game) ? 'Observing — command unavailable.' : result.reason;
  const facts = result.facts;
  const lines = view.compact ? [
    ...(facts.range != null ? [`Range ${Number(facts.range.toFixed(1))}`] : []),
    unavailable || `Ready${game.realtime && !REALTIME_COOLDOWN.has(action.type) ? ' (free command)' : ''}.`,
  ] : [
    ...(facts.distance != null ? [`Distance ${facts.distance.toFixed(1)}.`] : []),
    ...(facts.range != null ? [`Range ${Number(facts.range.toFixed(1))}.`] : []),
    ...(game.realtime && REALTIME_COOLDOWN.has(action.type) ? [facts.readiness.ready ? 'Shared command cycle ready.' : `Shared command cycle: ${facts.readiness.remaining.toFixed(1)} stardates remaining.`] : []),
    ...(game.realtime && !REALTIME_COOLDOWN.has(action.type) ? ['Free command; does not use the shared cycle.'] : []),
    ...(unavailable ? [unavailable] : ['Ready for this target.']),
  ];
  const actor = getShip(game, game.playerShipId);
  // Old saves can infer a facing using unseen hulls. Require an observed numeric
  // heading before previewing enemy geometry rather than consulting that fallback.
  if (view.arcPreview !== false && known && isActive(target) && game.reimagined && ['phasers', 'photons', 'spread'].includes(action.type)
    && hasArcs(game, target) && Number.isFinite(target.facing)) {
    const arc = struckArc(game, actor, target);
    const arcs = arcsOf(game, target);
    lines.push(`Current arc preview: ${cap(arc)}; reported shields ${arcs[arc]} at stardate ${(simTimeOf(game) + 1).toFixed(1)}. Motion can change the struck arc.`);
  }
  return { ...result, available: result.available && !view.battlePaused && !isSpectator(game), text: lines.join(view.compact ? ' · ' : ' ') };
};

const menuCommands = (game, actor, ship) => {
  if (ship.id === actor?.id) return [];
  const commands = [['phasers', 'Fire phasers'], ['photons', 'Fire photons'], ['tractor', 'Tractor beam'], ['scan', 'Scan']];
  if (game.reimagined && systemUnits(actor, 'spread') > 0) commands.splice(2, 0, ['spread', 'Fire spread']);
  if (game.reimagined && systemUnits(actor, 'ion') > 0) commands.splice(2, 0, ['ion', 'Fire ion']);
  if (!isDrone(ship)) commands.push(['transport', ship.status === 'vacant' ? 'Board ship' : isNeutral(ship) ? 'Seize merchant' : 'Transport crew']);
  if (game.reimagined && isActive(ship) && (ship.faction !== actor?.faction || ship.encounter?.type === 'distress')) commands.push(['tractor-direct', 'Direct tow…']);
  const pair = maintainedTowPair(game);
  if (pair?.target.id === ship.id) return [['tow-release', 'Release tow'], ...commands];
  if (game.reimagined && isActive(ship) && ship.faction === actor?.faction && !isDrone(ship)) {
    const towing = [['tow-start', 'Maintain tow']];
    if (isRescueTowTarget(game, ship.id)) return [...towing, ['tractor-direct', 'Single pull toward extraction…'], ...commands.filter(([type]) => !['tractor', 'tractor-direct'].includes(type))];
    return [...towing, ...commands];
  }
  return commands;
};

/** Refresh stable reasons as real-time motion and the shared cycle advance. */
export const updateTargetReadiness = (game, view = {}) => {
  const actor = getShip(game, game.playerShipId);
  if (view.contextShipId) {
    const target = getShip(game, view.contextShipId);
    if (!target || target.status === 'destroyed' || !targetGeometryKnown(game, target)) {
      document.querySelector('#ship-menu')?.removeAttribute?.('open');
    } else {
      const range = document.querySelector('#menu-target-distance');
      if (range) range.textContent = target.id === actor?.id ? 'your command ship' : `${distance(actor, target).toFixed(1)} away`;
    }
  }
  const cycle = document.querySelector('#menu-command-cycle');
  if (cycle && game.realtime) {
    const remaining = Math.max(0, (game.readyAt?.[actor?.id] ?? 0) - simTimeOf(game));
    cycle.textContent = remaining > 0 ? `Shared command cycle: ${remaining.toFixed(1)} stardates remaining. Scans are free.` : 'Shared command cycle ready. Scans are free.';
  }
  for (const button of document.querySelectorAll?.('[data-ship-command]') ?? []) {
    const type = button.dataset.shipCommand === 'tractor-direct' ? 'tractor' : button.dataset.shipCommand;
    const result = targetExplanation(game, { type, targetId: button.dataset.shipTarget, ...(type === 'transport' ? { amount: 1 } : {}) }, { ...view, arcPreview: false, compact: true });
    button.disabled = !result.available;
    const reason = document.getElementById?.(button.getAttribute('aria-describedby'));
    if (reason) reason.textContent = result.text;
  }
  for (const button of document.querySelectorAll?.('[data-command]') ?? []) {
    if (!targetedCommands.has(button.dataset.command)) continue;
    const result = actionAvailability(game, { type: button.dataset.command });
    const unavailable = !result.available && !result.requiresTarget;
    button.disabled = unavailable || Boolean(view.battlePaused) || isSpectator(game);
    const reason = document.getElementById?.(`command-${button.dataset.command}-reason`);
    if (reason) {
      reason.textContent = view.battlePaused ? 'Resolving orders — command unavailable.' : isSpectator(game) ? 'Observing — command unavailable.' : unavailable ? result.reason : '';
      reason.hidden = !reason.textContent;
    }
  }
};

/**
 * The one-line arc breakdown the console, menus, and reports read (round 23):
 * "F 60 · S 50 · A 40 · P 50". Null for a hull that does not fight with arcs, so
 * a Classic display never grows the line.
 */
const arcReadout = (game, ship) => {
  const arcs = arcsOf(game, ship);
  if (!arcs) return null;
  return ARCS.map((arc) => `${arc[0].toUpperCase()} ${arcs[arc]}`).join(' · ');
};

/**
 * The context menu that grows out of a clicked hull: what your command ship can
 * actually do to it, plus — in a Reimagined war — the standing orders and dockyard
 * refits a Federation hull can be given. Disabled commands explain their current
 * hardware, target, range or readiness restriction beside the control.
 */
const shipMenu = (game, actor, ship) => {
  const disabled = game.phase !== 'player' ? ' disabled' : '';
  const own = ship.id === actor?.id;
  const captain = game.reimagined && game.scanned?.[ship.id] ? ship.captain : null;
  const remaining = Math.max(0, (game.readyAt?.[actor?.id] ?? 0) - simTimeOf(game));
  const lines = [
    `${factionBadgeHtml(ship.faction)} ${ship.className.toLowerCase()} · ${ship.status}`,
    `<span id="menu-target-distance">${own ? 'your command ship' : `${distance(actor, ship).toFixed(1)} away`}</span> · shields ${ship.shields} · crew ${ship.crew} · reported stardate ${(simTimeOf(game) + 1).toFixed(1)}`,
    ...(game.realtime ? [`<span id="menu-command-cycle">${remaining > 0 ? `Shared command cycle: ${remaining.toFixed(1)} stardates remaining. Scans are free.` : 'Shared command cycle ready. Scans are free.'}</span>`] : []),
    ...(captain ? [`Captain ${captain}${isAce(ship) ? ` · an ace, ${ship.kills} kills` : ''}`] : []),
    // A drone has nobody aboard (round 20): the menu says so plainly instead of
    // reading an absent captain.
    ...(isDrone(ship) ? [`Unmanned fighter drone of the ${getShip(game, ship.droneOf)?.name ?? 'fleet'} · no crew, never boarded`] : []),
    // An enemy's combat stance is readable intel in a Reimagined war (round 21) —
    // it tells you how hard it is to hit and how sharp its own guns are. Your own
    // hulls show their stance as the selector below instead. A neutral merchant
    // (round 24) holds no stance — it is a civilian, not a combatant.
    ...(game.reimagined && isActive(ship) && ship.faction !== actor?.faction && !isNeutral(ship)
      ? [`Combat stance: ${stanceOf(game, ship)}.`]
      : []),
    // Round 24: encounter hulls tell you what they are in plain words.
    ...(isNeutral(ship)
      ? ['An unarmed neutral merchant — it will run from warships, and a transporter party can seize it whole.']
      : []),
    ...(ship.encounter?.type === 'distress' && isActive(ship) && systemUnits(ship, 'engines') === 0
      ? [game.operation ? 'Broadcasting distress: engines gone — maintain tow and reach the beacon at 38, 160. Aim for elapsed 16; final evacuation is 22.' : 'Broadcasting distress: engines gone — tow it home to Xanadu and the dockyard will return it to the fight.']
      : []),
    // Directional shields (round 23): the arc breakdown and heading are readable
    // combat intel on any hull — which arc you would hit, and which way its bow
    // points. Empty line for a drone or outside a Reimagined war.
    ...(game.reimagined && isActive(ship) && arcReadout(game, ship)
      ? [`Shield arcs: ${arcReadout(game, ship)} · heading ${Math.round(facingOf(game, ship))}°.`]
      : []),
    ...(game.reimagined && isActive(ship) && hasArcs(game, ship) && Number.isFinite(ship.facing) && !own
      ? [`Current arc preview: ${cap(struckArc(game, actor, ship))}; shields reported at stardate ${(simTimeOf(game) + 1).toFixed(1)}. Motion can change the struck arc.`] : []),
    // A prize of your alliance tells its story in the menu (round 17); the record
    // only exists in a Reimagined war, so no mode check is needed here.
    ...(ship.prize && ship.faction === actor?.faction
      ? [`Prize of war — taken from the ${ship.prize.from} at stardate ${ship.prize.turn}; prize crew ${ship.crew}/${crewCapacity(ship)}${ship.crew < crewCapacity(ship) * PRIZE.manningFloor ? ' — under-manned, engines and guns degraded' : ''}`]
      : []),
  ];
  const commands = menuCommands(game, actor, ship)
    .map(([type, label]) => {
      const result = targetExplanation(game, { type: type === 'tractor-direct' ? 'tractor' : type, targetId: ship.id, ...(type === 'transport' ? { amount: 1 } : {}) }, { arcPreview: false, compact: true });
      const id = `menu-${type}-reason`;
      return `<div class="command-control" data-console-key="menu-${type}"><button data-ship-command="${type}" data-ship-target="${ship.id}" aria-describedby="${id}"${!result.available ? ' disabled' : ''}>${label}</button><span id="${id}" class="action-explanation">${escapeJournal(result.text)}</span></div>`;
    })
    .join('');
  let orders = '';
  const canOrder = game.reimagined && game.phase === 'player' && isActive(ship) && ship.faction === actor?.faction;
  if (canOrder) {
    const standing = orderFor(game, ship.id);
    const pending = pendingOrderFor(game, ship.id);
    const contact = own || inRadioContact(game, actor, ship);
    const orderLines = [
      `Standing orders: ${describeOrder(game, pending ?? standing)}.`,
      pending
        ? 'An order is still travelling to this hull.'
        : (contact ? null : 'Out of radio contact — orders arrive one stardate late.'),
      ...(own ? ['Your own hull obeys these orders whenever the autopilot has the conn.'] : []),
      ...(game.operation && !own && ship.id !== game.operation.targetId ? ['Recover prize commits up to 10 crew (leaving at least one aboard), then both ships withdraw independently. Capture alone is not recovery.', 'Rescue Sentinel uses balanced reactor power if this hull has no manual allocation; existing power settings are preserved.'] : []),
    ].filter(Boolean);
    const buttons = orderButtonsFor(game, ship)
      .map(([type, label]) => `<button data-order="${type}" data-order-ship="${ship.id}"${standing?.type === type ? ' class="current"' : ''}${disabled}>${label}</button>`)
      .join('');
    const docked = dockedAt(game, ship);
    const refitTaken = game.refits?.[ship.id];
    const refitGrid = docked && !refitTaken
      ? `<p class="menu-sub">One refit at ${docked.name}, once per war:</p><div class="order-grid">${Object.entries(REFITS).filter(([id]) => id !== 'reactor' || game.reimagined).map(([id, refit]) => `<button data-refit="${id}" data-refit-ship="${ship.id}"${disabled}>${refit.label}</button>`).join('')}</div>`
      : '';
    orders = `<p class="menu-sub">${orderLines.join(' ')}</p><div class="order-grid">${buttons}</div>${refitGrid}`;
  }
  // Combat stance (round 21, Reimagined): a free, persistent per-hull choice like
  // power and orders. Firing sharpens this hull's guns but leaves it easier to hit;
  // evasive does the reverse. Only your Federation hulls take the order.
  let stanceBlock = '';
  const canStance = game.reimagined && game.phase === 'player' && isActive(ship) && ship.faction === actor?.faction;
  if (canStance) {
    const current = stanceOf(game, ship);
    const stanceButtons = STANCES
      .map((stance) => `<button data-ship-stance="${stance}" data-stance-ship="${ship.id}"${current === stance ? ' class="current"' : ''}${disabled}>${cap(stance)}</button>`)
      .join('');
    stanceBlock = `<p class="menu-sub">Combat stance — firing is accurate but exposed; evasive is hard to hit but wild:</p><div class="order-grid stance-grid">${stanceButtons}</div>`;
  }
  // Directional shields (round 23, Reimagined): the helm turn and the shield-focus
  // selector are free, persistent per-hull settings exactly like the stance — only
  // your Federation hulls take them, and a drone has neither arcs nor a heading.
  let helmBlock = '';
  if (canStance && hasArcs(game, ship)) {
    const heading = Math.round(facingOf(game, ship));
    const focus = arcFocusOf(game, ship);
    const turnButtons = [['-45', '↺ 45°'], ['45', '↻ 45°']]
      .map(([delta, label]) => `<button data-ship-facing="${delta}" data-facing-ship="${ship.id}"${disabled}>${label}</button>`)
      .join('');
    const focusButtons = [[null, 'Auto'], ...ARCS.map((arc) => [arc, ARC_LABELS[arc]])]
      .map(([arc, label]) => `<button data-ship-arc-focus="${arc ?? ''}" data-arc-focus-ship="${ship.id}"${focus === arc ? ' class="current"' : ''}${disabled}>${label}</button>`)
      .join('');
    helmBlock = `<p class="menu-sub">Helm — heading ${heading}°; turning is free, and any burn sets the heading anyway:</p><div class="order-grid stance-grid">${turnButtons}</div>`
      + `<p class="menu-sub">Shield focus — recovery refills this arc first:</p><div class="order-grid stance-grid">${focusButtons}</div>`;
  }
  const note = commands || orders
    ? ''
    : `<p class="menu-sub">${own ? 'Your command ship — open another hull to act on it.' : 'Nothing can reach this hull.'}</p>`;
  return `<h3>${ship.name}</h3><ul class="menu-info">${lines.map((line) => `<li>${line}</li>`).join('')}</ul>${commands ? `<div class="menu-grid">${commands}</div>` : ''}${orders}${stanceBlock}${helmBlock}${note}`;
};

/**
 * Parks the menu beside the hull it grew from, flipping to the other side near a
 * map edge and clamping so it never leaves the map or covers its own ship. The
 * tail keeps pointing at the hull's row once the box has been clamped.
 */
const placeShipMenu = (menu, map, ship, win) => {
  const rect = map?.getBoundingClientRect?.();
  if (!rect?.width || !rect?.height) return;
  menu.style.maxHeight = `${Math.max(100, rect.height - 8)}px`;
  const visibleWidth = Math.min(rect.width, (globalThis.window?.innerWidth ?? rect.right) - rect.left);
  // Absolute shrink-to-fit width changes when left changes near a clipped
  // narrow map. Fix the preferred width before measuring/clamping its position.
  menu.style.width = '16rem';
  menu.style.maxWidth = `${Math.max(100, visibleWidth - 8)}px`;
  const at = viewportFromWorld(ship.x, ship.y, win);
  const px = at.vx * rect.width;
  const py = at.vy * rect.height;
  const gap = 16;
  let side = 'right';
  let left = px + gap;
  if (left + menu.offsetWidth > visibleWidth - 4) {
    side = 'left';
    left = px - gap - menu.offsetWidth;
  }
  left = Math.max(4, Math.min(left, visibleWidth - menu.offsetWidth - 4));
  const top = Math.max(4, Math.min(py - menu.offsetHeight / 2, rect.height - menu.offsetHeight - 4));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.dataset.side = side;
  menu.style.setProperty('--tail-y', `${Math.max(10, Math.min(py - top, menu.offsetHeight - 10))}px`);
};

/**
 * Ships glide from where they were last drawn to where they are now, and leave a
 * fading trail, so the computer phase reads as movement rather than teleporting.
 * The map is rebuilt from an HTML string every render, so the animation is started
 * by hand: park each hull at its remembered position, then step it to the new one.
 */
let moveMemory = { seed: null, positions: new Map() };

const animateMoves = (map, game, win) => {
  if (!map?.querySelectorAll) return;
  const grid = win?.gridSize ?? game.gridSize ?? GRID_SIZE;
  if (moveMemory.seed !== game.seed) moveMemory = { seed: game.seed, positions: new Map() };
  // Round 31: in a real-time war the flight IS the motion — the frame loop
  // positions hulls at live fractional coordinates every rAF. The park-and-
  // glide here would fight it (and a boundary-to-boundary trail line would
  // scribble over the flight), so just keep the memory current and let the
  // sim clock draw.
  if (game.realtime) {
    map.querySelectorAll('.ship[data-ship-id]').forEach((button) => {
      const ship = getShip(game, button.dataset.shipId);
      if (ship) moveMemory.positions.set(ship.id, { x: ship.x, y: ship.y });
    });
    return;
  }
  map.querySelectorAll('.ship[data-ship-id]').forEach((button) => {
    const ship = getShip(game, button.dataset.shipId);
    if (!ship) return;
    const previous = moveMemory.positions.get(ship.id);
    moveMemory.positions.set(ship.id, { x: ship.x, y: ship.y });
    if (!previous || (previous.x === ship.x && previous.y === ship.y)) return;
    drawMove(map, previous, ship, win);
    button.style.left = `${(previous.x / grid) * 100}%`;
    button.style.top = `${(previous.y / grid) * 100}%`;
    // Two frames: the old position has to be committed before the transition target.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      button.style.left = `${(ship.x / grid) * 100}%`;
      button.style.top = `${(ship.y / grid) * 100}%`;
    }));
  });
};

/**
 * Real-time movement (Phase 8, round 30): after a trajectory playback the hull
 * buttons already stand on their boundary positions, flown there frame by frame
 * off the core's sub-ticks. Prime the glide memory with those positions so the
 * next render reads "no move" instead of replaying the stardate as a CSS glide.
 */
export const primeMoveMemory = (game) => {
  if (!game?.ships) return;
  if (moveMemory.seed !== game.seed) moveMemory = { seed: game.seed, positions: new Map() };
  for (const ship of game.ships) moveMemory.positions.set(ship.id, { x: ship.x, y: ship.y });
};

/**
 * Stack declutter (play-test retune 27c, widened in the readability pass):
 * hulls standing within 2 units of each other — a wing riding over its
 * carrier, a prize mid-withdraw, a converged melee — draw as one
 * indistinguishable blob and only the topmost can be clicked. Entries cluster
 * (union-find, deterministic) and fan onto a screen-space ring so each glyph
 * is seen and clicked; presentation only — positions, beams, ranges, and
 * every rule read the true coordinates. The real-time flight playback (Phase
 * 8, round 30) runs the same ring per frame, so hulls crossing in flight stay
 * legible instead of stacking into a blob mid-burn.
 */
export const fanOutOffsets = (entries, { spacing = 36, maxRadius = 160 } = {}) => {
  const parent = new Map(entries.map((entry) => [entry.id, entry.id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    for (let cursor = id; parent.get(cursor) !== root; cursor = parent.get(cursor)) parent.set(cursor, root);
    return root;
  };
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (distance(entries[i], entries[j]) < 2) parent.set(find(entries[i].id), find(entries[j].id));
    }
  }
  const groups = new Map();
  for (const entry of entries) {
    const root = find(entry.id);
    const group = groups.get(root);
    if (group) group.push(entry.id);
    else groups.set(root, [entry.id]);
  }
  const offsets = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Adjacent markers need room for their hull and left-edge identity badge.
    // The chord sets actual screen-space separation, independent of zoom.
    const radius = Math.min(maxRadius, spacing / (2 * Math.sin(Math.PI / group.length)) + 2);
    [...group].sort().forEach((id, index) => {
      const angle = (index * 2 * Math.PI) / group.length;
      offsets.set(id, {
        dx: Math.round(Math.cos(angle) * radius),
        dy: Math.round(Math.sin(angle) * radius),
      });
    });
  }
  return offsets;
};

/** Shared by paint and live/replay flight. Leave a hull-width margin around a
 * centered cluster; very large fleets may still overlap inside this bound. */
export const markerFanOptions = (shipArt, map = document.querySelector('#map')) => ({
  spacing: shipArt === 'sprites' ? 80 : 36,
  maxRadius: Math.max(20, Math.min(160, (map?.clientWidth ?? 416) / 2 - 48, (map?.clientHeight ?? 416) / 2 - 48)),
});

/**
 * The minimap: the whole war zone in miniature, with the hulls the mapper can see and
 * a rectangle for the camera's current window. Dragging it (wired in app.js) re-centers
 * the view; once the field is wider than the screen it is the only whole-war picture,
 * so it stands in for the Backspace report's sense of the battlefield. Hidden in a
 * Classic war, where the whole field already fits on screen.
 */
const renderMinimap = (game, win, isVisible, view = {}) => {
  const minimap = document.querySelector('#minimap');
  const controls = document.querySelector('#camera-controls');
  const show = Boolean(game.reimagined);
  if (controls) controls.hidden = !show;
  if (!minimap) return;
  minimap.hidden = !show;
  if (!show) { minimap.innerHTML = ''; return; }
  const grid = win.gridSize;
  const frac = (value) => (value / grid) * 100;
  // Terrain is known geography, so the minimap draws every feature regardless of
  // mapper reach — the wide field stays navigable by terrain at a glance. The
  // faint-beyond/crisp-within mapper fade applies to the tactical map only.
  const terrain = (game.terrain ?? [])
    .map((feature) => {
      // A held relay wears its holder's faction colors on the minimap too (round 16).
      const holder = feature.type === 'relay' ? game.held?.[feature.id] ?? null : null;
      return `<span class="mini-terrain ${feature.type}${holder ? ` ${holder}` : ''}" style="--mx:${frac(feature.x)};--my:${frac(feature.y)};--mr:${frac(feature.radius)}" aria-hidden="true"></span>`;
    })
    .join('');
  const miniOffsets = fanOutOffsets(game.ships.filter(isVisible), { spacing: 12, maxRadius: 24 });
  const dots = game.ships
    .filter(isVisible)
    .map((ship) => `<span class="mini-dot ${ship.faction}${ship.id === game.playerShipId ? ' you' : ''} ${ship.status}${ship.id === view.contextShipId ? ' selected' : ''}" data-ship-id="${ship.id}" style="--mx:${frac(ship.x)};--my:${frac(ship.y)};--mdx:${miniOffsets.get(ship.id)?.dx ?? 0}px;--mdy:${miniOffsets.get(ship.id)?.dy ?? 0}px" role="img" aria-label="${escapeJournal(ship.name)}, ${factionText(ship.faction)}, ${ship.status}${ship.id === game.playerShipId ? ', command ship' : ''}${ship.id === view.contextShipId ? ', selected' : ''}">${ship.status === 'destroyed' ? '<span class="mini-wreck" aria-hidden="true">×</span>' : factionBadgeSvg(ship.faction)}</span>`)
    .join('');
  const viewport = `<span class="mini-view" style="--vx:${frac(win.minX)};--vy:${frac(win.minY)};--vw:${frac(win.size)}"></span>`;
  minimap.innerHTML = terrain + dots + viewport;
};

/**
 * The reactor power bar, Reimagined only: one row per sink showing its allocation, a
 * live effectiveness multiplier, and −/+ pips that nudge it. Setting power is a free
 * action, so the bar stays interactive during the player's turn and greys out while
 * a round resolves or the war is spectated. The + pip disables once the reactor budget
 * is fully spent; a nudge past it is refused by the rules rather than stealing from
 * another sink.
 */
const powerBar = (game, actor, view) => {
  if (!game.reimagined || !actor || game.outcome || isSpectator(game)) return '';
  // The budget shown includes any relay-node bonus the Federation holds (round 16).
  const budget = reactorOutput(actor, game);
  const allocation = powerAllocation(game, actor);
  const spent = POWER_SINKS.reduce((sum, sink) => sum + (allocation[sink] ?? 0), 0);
  const locked = game.phase !== 'player' || view.battlePaused ? ' disabled' : '';
  const rows = POWER_SINKS.map((sink) => {
    const value = allocation[sink] ?? 0;
    const eff = powerEffect(game, actor, sink);
    return `<div class="power-row">`
      + `<span class="power-label">${cap(sink)}</span>`
      + `<button class="power-step" data-power-sink="${sink}" data-power-delta="-1"${value <= 0 || locked ? ' disabled' : ''} aria-label="Less ${sink} power">&minus;</button>`
      + `<span class="power-value">${value}</span>`
      + `<button class="power-step" data-power-sink="${sink}" data-power-delta="1"${spent >= budget || locked ? ' disabled' : ''} aria-label="More ${sink} power">+</button>`
      + `<span class="power-eff">${eff.toFixed(2)}&times;</span>`
      + `</div>`;
  }).join('');
  return `<div class="power-bar">`
    + `<div class="power-head"><span>Reactor power</span><span>${spent} / ${budget}</span></div>`
    + rows
    + `</div>`;
};

/**
 * The combat-stance selector, Reimagined only (round 21): three buttons — standard,
 * firing, evasive — with the current one lit. Setting a stance is a free action, so
 * like the power bar it stays live during the player's turn and greys out while a
 * round resolves or the war is spectated. This sets the command ship's stance; other
 * Federation hulls take theirs from their own menus.
 */
const stanceBar = (game, actor, view) => {
  if (!game.reimagined || !actor || game.outcome || isSpectator(game)) return '';
  const current = stanceOf(game, actor);
  const locked = game.phase !== 'player' || view.battlePaused ? ' disabled' : '';
  const buttons = STANCES
    .map((stance) => `<button class="stance-btn ${stance}" data-stance="${stance}"${current === stance ? ' aria-pressed="true"' : ''}${locked}>${cap(stance)}</button>`)
    .join('');
  return `<div class="stance-bar">`
    + `<div class="power-head"><span>Combat stance</span><span class="stance-now ${current}">${current}</span></div>`
    + `<div class="stance-grid">${buttons}</div>`
    + `</div>`;
};

/**
 * The helm control, Reimagined only (round 23): turn the command ship 45° to
 * port or starboard without spending the stardate — how a hull holding a gun
 * line keeps its reinforced fore arc on the fight. The heading readout doubles
 * as the arc key: F/S/A/P around the bow. Inert on a drone's conn (no heading)
 * and outside a Reimagined war.
 */
const helmBar = (game, actor, view) => {
  if (!game.reimagined || !actor || game.outcome || isSpectator(game) || !hasArcs(game, actor)) return '';
  const locked = game.phase !== 'player' || view.battlePaused ? ' disabled' : '';
  const heading = Math.round(facingOf(game, actor));
  const focus = arcFocusOf(game, actor);
  const turnButtons = [['-45', '↺ 45°'], ['45', '↻ 45°']]
    .map(([delta, label]) => `<button class="stance-btn" data-facing-turn="${delta}"${locked}>${label}</button>`)
    .join('');
  const focusButtons = [[null, 'Auto'], ...ARCS.map((arc) => [arc, ARC_LABELS[arc]])]
    .map(([arc, label]) => `<button class="stance-btn arc-btn" data-arc-focus="${arc ?? ''}"${focus === arc ? ' aria-pressed="true"' : ''}${locked}>${label}</button>`)
    .join('');
  return `<div class="stance-bar helm-bar">`
    + `<div class="power-head"><span>Helm</span><span class="heading-now">heading ${heading}°</span></div>`
    + `<div class="stance-grid helm-grid">${turnButtons}</div>`
    + `<div class="power-head"><span>Shield focus</span><span class="heading-now">${focus ? ARC_LABELS[focus] : 'auto (weakest)'}</span></div>`
    + `<div class="stance-grid arc-grid">${focusButtons}</div>`
    + `</div>`;
};

/** One legend entry: a color chip (optionally carrying a glyph) and its label. */
const legendEntry = (swatch, label, content = '') => `<span class="legend-entry"><span class="legend-swatch ${swatch}" aria-hidden="true">${content}</span>${label}</span>`;

/**
 * The map legend (play-test balance pass): a full color key for everything the
 * tactical display draws, filtered by war mode — alliance colors, range rings,
 * threats, and wrecks always; orders, aces, dockyards, terrain, and prizes in
 * Reimagined. The
 * living battlefield used to be unreadable without memorizing the guide; now
 * every color on the map appears here, and the chips mirror the real thing
 * (rings dashed, pips glowing, terrain translucent).
 */
const renderMapLegend = (game, shipArt) => {
  const legend = document.querySelector('#map-legend');
  if (!legend) return;
  // Under sprite art the legend chips mirror what the field actually draws:
  // the wreck, drone, and merchant icons become their sprites, and the bow
  // cue reads as the hull's facing rather than the needle spoke.
  const spritesOn = shipArt === 'sprites';
  const legendImg = (src) => `<img src="${src}" alt="">`;
  const factions = ['Federation', 'Axis', 'Bloc', 'Cabal', ...(game.reimagined ? ['Neutral'] : [])].map((name) => factionBadgeHtml(name)).join('');
  const entries = [
    legendEntry('ring-phasers', 'phaser ring'),
    legendEntry('ring-photons', 'photon ring'),
    legendEntry('ring-engines', 'engine ring'),
    legendEntry('threat', 'can reach you'),
    legendEntry('pip-tractor', 'tractor-held'),
    legendEntry('lock-tractor', 'tractor beam'),
    legendEntry('wreck', 'wreck', spritesOn ? legendImg('assets/sprites/neutral/wreck.png') : '+'),
    legendEntry('state-vacant', 'vacant', 'V'),
    legendEntry('state-surrendered', 'surrendered', 'S'),
    legendEntry('state-selected', 'selected'),
    ...(game.reimagined ? [
      legendEntry('pip-order', 'under orders'),
      legendEntry('star-ace', 'scanned ace', '★'),
      legendEntry('ring-dock', 'dockyard'),
      legendEntry('terrain-nebula', 'nebula'),
      legendEntry('terrain-asteroids', 'asteroids'),
      legendEntry('terrain-ion', 'ion storm'),
      legendEntry('terrain-relay', 'relay node'),
      legendEntry('pip-prize', 'prize of war'),
      legendEntry('drone-glyph', 'fighter drone', spritesOn ? legendImg('assets/sprites/federation/drone.png') : 'D'),
      legendEntry('stance-firing', 'firing stance'),
      legendEntry('stance-evasive', 'evasive stance'),
      legendEntry('heading-glyph', spritesOn ? 'heading (hull faces its bow)' : 'heading (bow)', spritesOn ? '➤' : '▲'),
      legendEntry('neutral-glyph', 'neutral merchant', spritesOn ? legendImg('assets/sprites/neutral/merchant.png') : 'M'),
      legendEntry('pip-distress', 'distress call'),
    ] : []),
  ].join('');
  legend.innerHTML = factions + entries + '<span class="legend-note" id="legend-note"></span>';
  // Set through the element rather than into the markup so the note stays a live
  // node (and the screen-reader/legend tests read it the same way as before).
  document.querySelector('#legend-note').textContent = game.reimagined
    ? 'click a ship for its commands · click empty space to maneuver · terrain fades beyond mapper reach'
    : 'click a ship for its commands · click empty space to maneuver';
};

export const renderGame = (game, view = {}) => {
  const extracted = game.operation?.extracted.find((ship) => ship.id === game.playerShipId);
  const actor = getShip(game, game.playerShipId) ?? (extracted ? { ...extracted, status: 'extracted' } : undefined);
  const map = document.querySelector('#map-field');
  const consoleRoot = document.querySelector('#console');
  const report = document.querySelector('#report');
  const log = document.querySelector('#log');

  document.querySelector('#seed-readout').textContent = `SEED ${game.seed}`;
  document.querySelector('#turn-readout').textContent = `Stardate ${game.turn}`;
  // Hull coordinates and ranges are absolute map units; the field is drawn as a
  // percentage of `game.gridSize`, which is wider in a Reimagined war.
  const grid = game.gridSize ?? GRID_SIZE;
  const pct = (value) => (value / grid) * 100;
  // A Reimagined field is wider than the screen, so the map is a camera window into
  // it. A classic war's window is the whole field at zoom 1, which projects exactly
  // as it did before the camera existed.
  const win = cameraWindow(grid, view.camera);
  document.querySelector('#mode-readout').textContent = game.operation ? 'REIMAGINED OPERATION' : game.reimagined
    ? (scenarioFor(game).id === 'annihilation' ? 'REIMAGINED WAR' : `REIMAGINED · ${scenarioFor(game).title.toUpperCase()}`)
    : '';
  renderMapLegend(game, view.shipArt);

  const actorActive = Boolean(actor) && actor.status === 'active';
  const mapperRange = actorActive ? sensorRange(game, actor, 'mapper') : Infinity;
  // Fog of war, plus the nebula rule (15b): a hull inside a nebula is unseen from
  // outside beyond the short reveal range, however wide the mapper reaches.
  const isVisible = (ship) => !actorActive || ship.id === actor.id
    || (distance(ship, actor) <= mapperRange && !nebulaHides(game, actor, ship));
  // Tractor-lock readout (play-test fix, 2026-09-25): a held hull always knows
  // it — the beam is physical — but WHO holds it is sensor intel: named when the
  // holder is inside mapper reach and not nebula-hidden, else "an unseen hull".
  // This is what makes an invisible lock from a nebula camp read as a situation
  // instead of a maneuver refusal with no cause.
  const heldBy = actorActive && isTractorHeld(game, actor) ? getShip(game, actor.tractorBy) : null;
  const heldByName = heldBy ? (isVisible(heldBy) ? heldBy.name : 'an unseen hull') : null;
  document.querySelector('#mapper-readout').textContent = actorActive
    ? (Number.isFinite(mapperRange) && mapperRange > 0 ? `Mapper ${mapperRange}` : 'Mapper blacked out')
    : '';

  const threats = new Set();
  if (actorActive) {
    for (const ship of game.ships) {
      if (ship.status !== 'active' || ship.faction === actor.faction) continue;
      const range = distance(ship, actor);
      if ((range <= RANGES.phasers && ship.systems.phasers > 0) || (range <= RANGES.photons && ship.systems.photons > 0)) threats.add(ship.id);
    }
  }

  const rings = [];
  if (actorActive) {
    if (actor.systems.phasers > 0) rings.push({ r: RANGES.phasers, kind: 'phasers', x: actor.x, y: actor.y });
    if (actor.systems.photons > 0) rings.push({ r: RANGES.photons, kind: 'photons', x: actor.x, y: actor.y });
    const engineReach = movementCapacity(game, actor);
    if (engineReach > 0) rings.push({ r: engineReach, kind: 'engines', x: actor.x, y: actor.y });
  }
  // In a Reimagined war the dockyard at Xanadu repairs anything inside its ring.
  const xanadu = getShip(game, 'xanadu');
  if (game.reimagined && xanadu?.status === 'active' && xanadu.faction === actor?.faction) {
    rings.push({ r: DOCKING.range, kind: 'dock', x: xanadu.x, y: xanadu.y });
  }
  const ringHtml = rings.map(({ r, kind, x, y }) => `<div class="range-ring ${kind}" style="--x:${pct(x)};--y:${pct(y)};--d:${pct(2 * r)}%" aria-hidden="true"></div>`).join('');

  // Terrain (Reimagined only) draws on the world layer beneath ships and range
  // rings, as translucent faction-neutral blobs that pan and zoom with the camera.
  // It is known geography: a feature the mapper can reach at all renders crisp;
  // beyond mapper range it fades to TERRAIN.faintOpacity — you can always route by
  // the field's shape, but the mapper and the sensors sink sharpen the picture.
  const terrainHtml = (game.terrain ?? []).map((feature) => {
    const crisp = !actorActive || distance(actor, feature) <= mapperRange + feature.radius;
    const label = feature.type.replace('-', ' ');
    // A held relay node wears its holder's colors as a ring (round 16); ownership
    // is public knowledge — every alliance can see who holds the objectives.
    const holder = feature.type === 'relay' ? game.held?.[feature.id] ?? null : null;
    const title = holder ? `${label} — held by the ${holder}` : label;
    return `<div class="terrain ${feature.type}${holder ? ` ${holder}` : ''}" style="--x:${pct(feature.x)};--y:${pct(feature.y)};--d:${pct(2 * feature.radius)}%;--o:${crisp ? 1 : TERRAIN.faintOpacity}" title="${title}" aria-hidden="true"></div>`;
  }).join('');

  // Stack declutter (play-test retune 27c, widened in the readability pass):
  // hulls ending a stardate on top of each other — a wing riding over its
  // carrier, a prize mid-withdraw, a converged melee standing 1 unit apart —
  // drew as one indistinguishable blob and only the topmost could be clicked.
  // `fanOutOffsets` clusters hulls within 2 units (union-find, deterministic)
  // and fans them onto a screen-space ring so each glyph is seen and clicked;
  // presentation only — positions, beams, ranges, and every rule read the true
  // coordinates. The real-time flight playback reuses it per frame.
  const stackOffsets = fanOutOffsets(game.ships.filter(isVisible), markerFanOptions(view.shipArt));
  const stackStyle = (ship) => {
    const offset = stackOffsets.get(ship.id);
    return offset ? `;--dx:${offset.dx}px;--dy:${offset.dy}px` : '';
  };

  const shipHtml = game.ships.filter(isVisible).map((ship) => {
    if (ship.status === 'destroyed') {
      // Round 34: under sprite art the wreck is the commissioned hulk, snapped
      // spine and all, desaturated by CSS; letters and classic keep the '+'.
      const wreckMark = view.shipArt === 'sprites'
        ? '<img class="wreck-sprite" src="assets/sprites/neutral/wreck.png" alt="" aria-hidden="true">'
        : '+';
      return `<span class="wreck ${ship.faction}" data-ship-id="${ship.id}" style="--x:${pct(ship.x)};--y:${pct(ship.y)}${stackStyle(ship)}" title="${escapeJournal(ship.name)}: destroyed · ${factionText(ship.faction)}" role="img" aria-label="${escapeJournal(ship.name)}, ${factionText(ship.faction)}, destroyed wreck">${wreckMark}<span class="stack-tether" aria-hidden="true"></span>${factionBadgeHtml(ship.faction, { label: false })}</span>`;
    }
    const threat = threats.has(ship.id) ? ' threat' : '';
    const standing = orderFor(game, ship.id) ?? pendingOrderFor(game, ship.id);
    const duty = standing && standing.type !== 'focus' ? describeOrder(game, standing) : null;
    // A captain's name is intelligence: scanning reveals it, which is how you work
    // out which hull has sworn to hunt you.
    const captain = game.reimagined && game.scanned?.[ship.id] ? ship.captain : null;
    const ace = captain && isAce(ship) ? ' ace' : '';
    // A hull taken as a prize wears a gold pip (round 17), opposite the white
    // under-orders pip; the capture was narrated, so this is public knowledge.
    const prize = ship.prize ? ' prize' : '';
    // A drone wears 'D' rather than its name's initial (round 20): the wing is
    // named after its carrier ("Lexington D1"), and the carrier's own glyph must
    // stay unique to itself.
    const glyph = isDrone(ship) ? 'D' : ship.name[0];
    const drone = isDrone(ship) ? ' drone' : '';
    // Round 33: ships of the line wear Matt's pixel-art sprites in the modern
    // view when the art setting says so; drones, merchants, and the starbase
    // keep their letters until round 34 decides their treatments. The sprite
    // replaces the disc+letter only — every marker below still stacks on the
    // button. Classic never asks for sprites (app.js passes 'letters').
    const spriteSlug = SPRITE_SLUGS.get(ship.className);
    const spriteFaction = ship.className === 'Merchant' ? 'Neutral' : ship.faction;
    const droneWaitsForArt = ship.className === 'Drone' && !DRONE_SPRITE_FACTIONS.has(spriteFaction);
    const useSprite = view.shipArt === 'sprites' && Boolean(spriteSlug) && !droneWaitsForArt;
    // A non-standard combat stance wears a marker (round 21): a firing hull glows
    // hot, an evasive hull runs cold. It changes how your volleys land, so like the
    // threat ring it is public combat intel, not hidden state.
    const stance = game.reimagined && isActive(ship) ? stanceOf(game, ship) : 'standard';
    const stanceClass = stance === 'standard' ? '' : ` stance-${stance}`;
    const stanceNote = stance === 'standard' ? '' : ` — ${stance} stance`;
    // Directional shields (round 23): a hull that fights with arcs wears a heading
    // needle pointing where its bow faces, so which arc an exchange would strike
    // is readable off the map. Public combat intel, like the threat outline.
    const heading = game.reimagined && isActive(ship) && hasArcs(game, ship) ? Math.round(facingOf(game, ship)) : null;
    // Round 34: a sprite IS the heading marker — the hull art rotates to face
    // (--rot, refreshed per frame in realtime by app.js), so the needle spoke
    // only stacks on glyph buttons, where a letter needs it to show its bow.
    const headingHtml = heading === null || useSprite ? '' : `<span class="heading-glyph" style="--heading:${heading}deg" aria-hidden="true"></span>`;
    const rotStyle = heading === null || !useSprite ? '' : `;--rot:${heading}deg`;
    const headingNote = heading === null ? '' : ` — heading ${heading}°`;
    // A hull broadcasting distress (round 24) wears a marker: the call is public,
    // and the rescue is the point.
    const distress = ship.encounter?.type === 'distress' && isActive(ship) && systemUnits(ship, 'engines') === 0;
    const distressClass = distress ? ' distress' : '';
    const distressNote = distress ? ' — broadcasting distress' : '';
    // A held hull wears a cyan pip (play-test fix, 2026-09-25): the lock is the
    // victim's own sensation, so the pip never leaks where the holder is.
    const held = isTractorHeld(game, ship);
    const heldClass = held ? ' held' : '';
    const heldNote = held ? ' — held by a tractor beam' : '';
    const selected = ship.id === view.contextShipId;
    const command = ship.id === game.playerShipId;
    const statusMark = ['vacant', 'surrendered'].includes(ship.status) ? `<span class="ship-state" aria-hidden="true">${ship.status === 'vacant' ? 'V' : 'S'}</span>` : '';
    return `<button class="ship ${ship.faction} ${ship.status}${threat}${duty ? ' has-order' : ''}${ace}${prize}${drone}${stanceClass}${distressClass}${heldClass}${useSprite ? ' has-sprite' : ''}${selected ? ' selected' : ''}${command ? ' command-ship' : ''}" style="--x:${pct(ship.x)};--y:${pct(ship.y)}${stackStyle(ship)}${rotStyle}" data-ship-id="${ship.id}" title="${ship.name}: ${ship.status} · ${factionText(ship.faction)}${captain ? ` — Captain ${captain}` : ''}${duty ? ` — ${duty}` : ''}${ship.prize ? ' — prize of war' : ''}${stanceNote}${headingNote}${distressNote}${heldNote}" aria-label="${ship.name}, ${ship.faction}, ${ship.status}${selected ? ', selected' : ''}${command ? ', command ship' : ''}${captain ? `, Captain ${captain}` : ''}${duty ? `, orders ${duty}` : ''}${ship.prize ? ', prize of war' : ''}${stanceNote}${headingNote}${distressNote}${heldNote}"${view.battlePaused ? ' disabled' : ''}>${headingHtml}${useSprite ? `<img class="sprite" src="assets/sprites/${spriteFaction.toLowerCase()}/${SPRITE_SLUGS.get(ship.className)}.png" alt="" aria-hidden="true" draggable="false">` : `<span class="glyph">${glyph}</span>`}<span class="stack-tether" aria-hidden="true"></span>${factionBadgeHtml(ship.faction, { label: false })}${statusMark}${ship.prize ? '<span class="prize-pip" aria-hidden="true"></span>' : ''}${distress ? '<span class="distress-pip" aria-hidden="true"></span>' : ''}${held ? '<span class="tractor-pip" aria-hidden="true"></span>' : ''}</button>`;
  }).join('');
  // Tractor lock lines (Matt's call, 2026-09-25): the beam is physical. A held
  // hull you can see draws its lock back to the source even when a nebula hides
  // the hull casting it — position, not identity: the console still says "an
  // unseen hull" until sensors name the caster, and the hidden hull's glyph
  // stays undrawn. Under the ship layer so glyphs sit on the beam's ends.
  const lockLines = [];
  for (const ship of game.ships) {
    if (!ship.tractorBy || !isVisible(ship)) continue;
    const holder = getShip(game, ship.tractorBy);
    if (!holder || holder.status !== 'active') continue;
    lockLines.push(`<line class="tractor-lock" vector-effect="non-scaling-stroke" x1="${pct(holder.x)}" y1="${pct(holder.y)}" x2="${pct(ship.x)}" y2="${pct(ship.y)}"></line>`);
  }
  const lockHtml = lockLines.length
    ? `<svg class="lock-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lockLines.join('')}</svg>`
    : '';
  // Warheads in flight (round 32): ballistic photon and spread runs draw as hot
  // dots on the field — the state is the timeline, and the frame loop rides them
  // between renders, so a salvo is something you can see coming and burn out of.
  const warheadHtml = (game.ordnance ?? []).map((warhead) => `<span class="warhead ${warhead.kind}" data-ordnance-id="${warhead.id}" style="--x:${pct(warhead.x)};--y:${pct(warhead.y)}" aria-hidden="true"></span>`).join('');
  map.innerHTML = terrainHtml + ringHtml + lockHtml + shipHtml + warheadHtml;
  // Slide and scale the world layer so the camera window fills the viewport. The
  // test stub has no `style`, so guard it; the projection is identity at zoom 1.
  if (map.style) {
    map.style.transform = fieldTransform(win);
    // Counter-scale for hull glyphs (Matt's play-test idea, 2026-09-25): the
    // world layer scales by the zoom, so without this a ship's disc and letter
    // grow with it and a zoomed-in melee still reads as blobs. Exposing 1/zoom
    // lets the glyphs hold a steady SCREEN size while their positions spread —
    // zooming in separates hulls instead of enlarging them. Identity at zoom 1,
    // so a classic war draws exactly as before.
    map.style.setProperty('--invzoom', String(1 / (win.zoom || 1)));
  }
  animateMoves(map, game, win);
  renderMinimap(game, win, isVisible, view);

  // The context menu lives over the map field, beside the hull it grew from. It is
  // gone whenever that hull is gone, hidden by fog, or the war is not taking orders.
  const contextShip = view.contextShipId ? getShip(game, view.contextShipId) : null;
  const menuShip = contextShip && contextShip.status !== 'destroyed' && isVisible(contextShip)
    && !game.outcome && !isSpectator(game) && !view.battlePaused
    ? contextShip
    : null;
  const menu = document.querySelector('#ship-menu');
  if (menu) {
    const wasOpen = menu.hasAttribute?.('open');
    updateConsole(menu, menuShip ? shipMenu(game, actor, menuShip) : '');
    if (menuShip) {
      menu.setAttribute?.('open', '');
      placeShipMenu(menu, document.querySelector('#map'), menuShip, win);
      if (!wasOpen) {
        menu.querySelector?.('button:not(:disabled)')?.focus?.({ preventScroll: true });
        menu.scrollTop = 0;
      }
    } else {
      menu.removeAttribute?.('open');
    }
  }

  const condition = alertLevel(actor);
  const towPair = maintainedTowPair(game);
  const availableCommands = commandList(game, actor);
  const primary = new Set(['move', 'phasers', 'photons', 'spread', 'ion', 'pass', 'autopilot']);
  const button = ([type, label, key]) => {
    const result = targetedCommands.has(type) || (towPair && ['autopilot', 'hyperspace', 'disengage'].includes(type)) ? actionAvailability(game, { type }) : null;
    const reason = view.battlePaused ? 'Resolving orders — command unavailable.' : isSpectator(game) ? 'Observing — command unavailable.' : result && !result.available && !result.requiresTarget ? result.reasonCode === 'tow-attached' ? 'Release tow first.' : result.reason : '';
    const disabled = game.phase !== 'player' || game.outcome || isSpectator(game) || view.battlePaused || Boolean(reason);
    const id = `command-${type}-reason`;
    return `<div class="command-control" data-console-key="command-${type}"><button data-command="${type}" ${disabled ? 'disabled' : ''}${result ? ` aria-describedby="${id}"` : ''}>${game.realtime && type === 'pass' ? 'Hold position' : game.realtime && type === 'autopilot' ? 'Automatic conn' : label}<kbd>${key}</kbd></button>${result ? `<span id="${id}" class="action-explanation"${reason ? '' : ' hidden'}>${escapeJournal(reason)}</span>` : ''}</div>`;
  };
  const gridOf = (list) => `<div class="command-grid">${list.map(button).join('')}</div>`;
  const releaseReady = actionAvailability(game, { type: 'tow-release' }).available && !view.battlePaused;
  const towStatus = towPair ? `<div class="maintained-tow-status" data-console-key="tow-status"><div class="tow-status-heading"><b>Towing ${escapeJournal(towPair.target.name)}</b><button data-command="tow-release"${releaseReady ? '' : ' disabled'}>Release tow</button></div>
    <p>Speed ${Number(movementCapacity(game, actor).toFixed(1))} units/stardate · separation ${Number(distance(towPair.tug, towPair.target).toFixed(1))}. Move normally to carry both ships. ${isOperation(game) ? 'Enter the beacon with either ship to evacuate together. Keep the tow attached.' : 'Release for dockyard repairs.'}</p>
    <p id="tow-move-preview" class="dialog-note">Hover over the map or use Engines to preview both destinations.</p>
    ${game.towNotice ? `<p>${escapeJournal(game.towNotice)}</p>` : ''}</div>`
    : game.reimagined && game.towNotice ? `<p class="maintained-tow-status" data-console-key="tow-status">${escapeJournal(game.towNotice)}</p>` : '';
  updateConsole(consoleRoot, `
    <div class="panel-title" data-console-key="title"><span>Command console</span><span class="alert-${condition.toLowerCase()}">Condition: ${condition}</span></div>
    <div class="status" data-console-key="status">
      <div class="status-row command-identity"><span>Command</span><b>${actor.name} ${factionBadgeHtml(actor.faction)}</b></div>
      <div class="status-row"><span>Location</span><b>${coordOf(actor)}</b></div>
      <div class="status-row"><span>Shields</span><b>${actor.shields}</b></div>
      <div class="status-row"><span>Crew</span><b>${actor.crew}</b></div>
      <div class="status-row"><span>Status</span><b>${actor.status}</b></div>
      ${heldByName ? `<div class="status-row"><span>Tractor lock</span><b class="held-now">held by ${heldByName}</b></div>` : ''}
    </div>
    <p id="command-readiness" class="console-readiness">${commandReadiness(game, view)}</p>
    <div class="console-primary" data-console-key="primary" role="group" aria-label="Movement and weapons">${gridOf(availableCommands.filter(([type]) => primary.has(type)))}</div>
    <div class="console-secondary" data-console-key="secondary" role="region" aria-label="Additional command controls" tabindex="0">
      ${towStatus}
      ${consoleSection('systems', 'Systems and commands', `<div class="system-grid">${Object.entries(actor.systems).map(([name, amount]) => `<span>${cap(name)} <b>${amount}</b></span>`).join('')}</div>${gridOf(availableCommands.filter(([type]) => !primary.has(type) && type !== 'fleet'))}`)}
      ${consoleSection('power', 'Reactor power', powerBar(game, actor, view))}
      ${consoleSection('helm', 'Helm and shield focus', `${helmBar(game, actor, view)}${arcReadout(game, actor) ? `<div class="status-row arc-status"><span>Shield arcs</span><b class="arc-readout">${arcReadout(game, actor)}</b></div>` : ''}`)}
      ${consoleSection('stance', 'Combat stance', stanceBar(game, actor, view))}
      ${consoleSection('fleet', 'Fleet orders', game.reimagined ? gridOf(availableCommands.filter(([type]) => type === 'fleet')) : '')}
    </div>
    ${game.commandLost
      ? '<p class="console-note">Federation command is lost. The remaining alliances fight on, and you watch the war from here.</p>'
      : ''}
    ${view.precision && (view.precision.power !== 100 || view.precision.focus)
      ? `<p class="console-note">Phasers set to ${view.precision.power}% power${view.precision.focus ? `, called to ${view.precision.focus}` : ''}.</p>`
      : ''}`);

  const activeReport = view.report ?? {
    title: scenarioFor(game).title,
    lines: [scenarioFor(game).brief, ...scenarioProgress(game)],
  };
  updateScrolledContent(report, `<h2>${activeReport.title}</h2><ul>${activeReport.lines.map((line) => `<li>${line}</li>`).join('')}</ul>`);

  const entries = view.entries?.length
    ? view.entries
    : game.log?.length ? game.log : ['Tactical systems online. Choose a command.'];
  const integrity = radioIntegrity(actor);
  const narrated = abbreviateNarrative(entries, integrity, actor.name);
  const commandHistory = document.querySelector('#command-history');
  const commandLog = document.querySelector('#command-log');
  const journalAnnouncement = renderBattleJournal(view.journal);
  const historical = document.querySelector('#journal-history-status');
  if (historical) historical.hidden = !view.journalHistorical;
  const playback = document.querySelector('#terminal-playback');
  if (playback) playback.hidden = !view.terminalDetails?.length && !view.terminalGroup;
  const currentTerminal = document.querySelector('#terminal-current');
  if (currentTerminal) currentTerminal.innerHTML = terminalGroupNarrative(view.terminalGroup);
  const members = document.querySelector('#terminal-members-list');
  if (members) updateScrolledContent(members, (view.terminalDetails ?? []).map(terminalNarrative).join(''));
  const finish = document.querySelector('#finish-playback');
  if (finish) finish.disabled = !view.playbackActive;
  const preference = document.querySelector('#playback-mode');
  if (preference) preference.disabled = Boolean(view.playbackLocked);
  if (!view.journal && commandHistory && commandLog) {
    commandHistory.hidden = !view.commandHistory?.length;
    updateScrolledContent(commandLog, commandHistoryHtml(view.commandHistory));
  }
  updateScrolledContent(log, (view.terminalGroup ? '' : terminalNarrative(view.terminalEvent)) + narrated.slice().reverse().map((entry) => `<li>${entry}</li>`).join(''));
  document.querySelector('#log-meta').textContent = integrity >= 1
    ? 'Newest first'
    : `Newest first · radio at ${Math.round(integrity * 100)}%, traffic abbreviated`;
  const replay = document.querySelector('#replay-round');
  if (replay) replay.hidden = !(game.lastRound?.events?.length > 0);

  // One concise status region instead of a live region around the whole page. The
  // map, console, report, and narrative all re-render every turn, so announcing all
  // of it flooded a screen reader with the entire board on every keystroke.
  const status = document.querySelector('#sr-status');
  if (status) {
    const announcement = view.journal ? [
      view.terminalGroup?.kind === 'critical' ? terminalDescription(view.terminalGroup.members[0]) : null,
      game.outcome?.message ?? null,
      view.report?.title ?? null,
      journalAnnouncement,
    ].filter(Boolean).join(' ') : [
      game.outcome?.message ?? null,
      view.report?.title ?? null,
      view.terminalEvent ? `${terminalHeading(view.terminalEvent)}. ${terminalDescription(view.terminalEvent)}` : null,
      `Condition ${condition}.`,
      `${actor.name} at ${coordOf(actor)}; shields ${actor.shields}, crew ${actor.crew}.`,
      narrated[narrated.length - 1] ?? null,
    ].filter(Boolean).join(' ');
    // Do not repeatedly announce unchanged history or routine fleet arrivals.
    if (announcement && status.textContent !== announcement) status.textContent = announcement;
  }

  if (game.outcome) {
    const section = (part) => `<h2>${part.title}</h2><ul>${part.lines.map((line) => `<li>${line}</li>`).join('')}</ul>`;
    report.innerHTML = `<h2>${game.operation ? 'Operation concluded' : 'War concluded'}</h2><ul><li>${game.outcome.message ?? game.outcome.kind.replace('-', ' ')}</li></ul>`
      + section(reportFor(game, 'battle-report'))
      + section(reportFor(game, 'rollcall'))
      + `<ul><li>Begin a new war to continue.</li></ul>`;
  }
};

const statusLabel = (ship) => {
  if (ship.status === 'active') return 'Active';
  if (ship.status === 'vacant') return 'Vacant';
  if (ship.status === 'surrendered') return 'Surrendered';
  return 'Dead';
};

const ratio = (forCount, against) => {
  if (!against) return forCount ? 'inf' : '1.00';
  return (forCount / against).toFixed(2);
};

const strength = (ships) => ships
  .filter((ship) => ship.status === 'active')
  .reduce((total, ship) => total + ship.shields + ship.crew, 0);

const dispersion = (ships) => {
  const active = ships.filter((ship) => ship.status === 'active');
  if (active.length < 2) return 0;
  const cx = active.reduce((total, ship) => total + ship.x, 0) / active.length;
  const cy = active.reduce((total, ship) => total + ship.y, 0) / active.length;
  return active.reduce((total, ship) => total + Math.hypot(ship.x - cx, ship.y - cy), 0) / active.length;
};

export const reportFor = (game, type) => {
  if (type === 'rollcall') {
    const command = getShip(game, game.playerShipId);
    return {
      title: `Roll call, Stardate ${game.turn}`,
      // The original's roll call is a Ship / Alliance / Location / Distance / Status /
      // Course table; Course is the one column the remake does not track.
      lines: game.ships.map((ship) => {
        const range = command ? distance(command, ship).toFixed(1) : '?';
        return `${ship.name} — ${factionText(ship.faction)} ${ship.className} at ${coordOf(ship)}, ${range} away; ${statusLabel(ship)}; shields ${ship.shields}; crew ${ship.crew}.`;
      }),
    };
  }
  if (type === 'statistics') {
    // A neutral merchant is not a belligerent (round 24): it gets no alliance
    // block and no "chances of victory" — seized hulls count for their captor.
    const rows = Object.groupBy(game.ships.filter((ship) => !isNeutral(ship)), (ship) => ship.faction);
    const totalStrength = Object.values(rows).reduce((total, ships) => total + strength(ships), 0) || 1;
    return {
      title: 'Alliance statistics',
      lines: Object.entries(rows).map(([faction, ships]) => {
        const active = ships.filter((ship) => ship.status === 'active');
        const forCount = ships.reduce((total, ship) => total + ship.shotsFired, 0);
        const against = ships.reduce((total, ship) => total + ship.shotsTaken, 0);
        const kills = ships.reduce((total, ship) => total + ship.kills, 0);
        const survivors = ships.reduce((total, ship) => total + ship.crew, 0);
        const chances = Math.round((strength(ships) / totalStrength) * 100);
        return [
          `${factionText(faction)}:`,
          `  Ships/rating/survivors: ${active.length} ships, rating ${strength(ships)}, ${survivors} crew.`,
          `  Dispersion factor: ${dispersion(ships).toFixed(1)}.`,
          `  Shots for/against: ${forCount} / ${against}.  Ratio = ${ratio(forCount, against)}.`,
          `  Credited kills: ${kills}.  Chances of victory: ${chances}%.`,
        ];
      }).flat(),
    };
  }
  if (type === 'shots') {
    const lines = game.ships
      .filter((ship) => ship.shotsFired || ship.shotsTaken)
      .map((ship) => `${ship.name}: fired ${ship.shotsFired}, absorbed ${ship.shotsTaken}.  Ratio = ${ratio(ship.shotsFired, ship.shotsTaken)}.`);
    return {
      title: 'Shot distribution',
      lines: lines.length ? lines : ['No shots recorded.'],
    };
  }
  if (type === 'fleet') {
    const command = getShip(game, game.playerShipId);
    const lines = game.ships
      .filter((ship) => ship.faction === command?.faction && ship.status !== 'destroyed')
      .map((ship) => {
        const travelling = pendingOrderFor(game, ship.id);
        const standing = travelling ?? orderFor(game, ship.id);
        const reached = ship.id === command?.id || inRadioContact(game, command, ship);
        const mark = travelling ? ' (order in transit)' : reached ? '' : ' (out of contact)';
        // The fleet report reads each hull's combat stance in a Reimagined war
        // (round 21), so you can see your dispositions at a glance.
        const stanceNote = game.reimagined && isActive(ship) ? `, ${stanceOf(game, ship)} stance` : '';
        // Round 23: the report also reads each hull's heading and arc breakdown,
        // so a worn flank is visible fleet-wide without opening every menu.
        const arcNote = game.reimagined && isActive(ship) && hasArcs(game, ship)
          ? `, bow ${Math.round(facingOf(game, ship))}°, arcs ${arcReadout(game, ship)}`
          : '';
        return `${ship.name}${prizeNote(ship)} — ${describeOrder(game, standing)}${stanceNote}${arcNote}${mark}; condition ${alertLevel(ship)} at ${coordOf(ship)}.`;
      });
    return {
      title: `Fleet orders, Stardate ${game.turn}`,
      lines: [...lines, 'Select a Federation ship on the tactical map to change its orders.'],
    };
  }
  if (type === 'battle-report') {
    // Evacuated operation hulls remain survivors and keep their earned records.
    const roster = [...game.ships, ...(game.reimagined ? game.operation?.extracted ?? [] : [])];
    const survivors = roster.filter((ship) => ship.status !== 'destroyed');
    const command = roster.find((ship) => ship.id === game.playerShipId);
    const commandCaptain = game.reimagined ? command?.captain : 'Jason';
    const federation = roster.filter((ship) => ship.faction === FACTIONS.FEDERATION);
    const losses = federation.filter((ship) => ship.status === 'destroyed').length;
    const best = (list, pick) => list.reduce((top, ship) => (!top || pick(ship) > pick(top) ? ship : top), null);
    const towCredits = game.reimagined ? game.battleRecordState?.towCollisionCredits ?? [] : [];
    const towKills = (ship) => towCredits.filter((credit) => credit.actor.id === ship.id).length;
    const creditedKills = (ship) => (ship.kills ?? 0) + towKills(ship);
    const topGun = best(roster, creditedKills);
    const topGunIdentity = topGun?.kills ? topGun : towCredits.find((credit) => credit.actor.id === topGun?.id)?.actor ?? topGun;
    const punished = best(survivors, (ship) => ship.shotsTaken);
    const clumsy = best(roster, (ship) => ship.collisions ?? 0);
    // A drone has no captain to credit (round 20): the hull form reads for it,
    // so the report never names "Captain undefined".
    const gunner = topGun && creditedKills(topGun)
      ? `Top gun: ${game.reimagined && topGunIdentity.captain ? `Captain ${topGunIdentity.captain} of the ${topGunIdentity.name}` : `${topGunIdentity.name} of the ${topGunIdentity.faction}`}, ${creditedKills(topGun)} credited kills${towKills(topGun) ? ` (${towKills(topGun)} from direct tow collisions)` : ''}.`
      : 'No ship scored a kill.';
    const towActors = [...new Map(towCredits.map((credit) => [credit.actor.id, credit.actor])).values()];
    const ownTowKills = towCredits.filter((credit) => ['manual', 'auto-conn'].includes(credit.source) && credit.actor.id === credit.issuingShipId).length;
    // Prizes (round 17): taken counts every capture your side ever made (the
    // cumulative ledger — the per-ship record only remembers the last one), and
    // lost counts those hulls no longer flying your colors: retaken or destroyed.
    // A dark prize still in your allegiance is not lost — it can be re-manned.
    // Absent without the ledger, so a Classic report is unchanged.
    const prizesTaken = game.prizesTaken?.[FACTIONS.FEDERATION] ?? 0;
    const prizesHeld = roster.filter((ship) => ship.prize?.byFaction === FACTIONS.FEDERATION
      && ship.faction === FACTIONS.FEDERATION && ship.status !== 'destroyed').length;
    return {
      title: 'Battle report',
      lines: [
        `Stardates elapsed: ${game.turn}.`,
        `Federation losses: ${losses} of ${federation.length} hulls.`,
        prizesTaken ? `Prizes: ${prizesTaken} taken, ${prizesTaken - prizesHeld} lost.` : null,
        gunner,
        ...towActors.map((actor) => `Direct tow collision credit: ${actor.captain ? `Captain ${actor.captain} of the ${actor.name}` : actor.name}, ${towKills(actor)} enemy hull${towKills(actor) === 1 ? '' : 's'} destroyed.`),
        ownTowKills ? `Your direct tow collision kills across command ships: ${ownTowKills}.` : null,
        towCredits.length ? 'Tow collision credit is included in this report; ace and vendetta tallies count weapon kills.' : null,
        punished?.shotsTaken ? `Heaviest punishment taken: ${punished.name} absorbed ${punished.shotsTaken} volleys.` : null,
        clumsy?.collisions ? `Most collisions: ${clumsy.name} with ${clumsy.collisions}.` : null,
        command
          ? `Your record, ${commandCaptain ? `Captain ${commandCaptain} of the ${command.name}` : command.name}: ${creditedKills(command)} kills${towKills(command) ? ` (${towKills(command)} from direct tow collisions)` : ''} from ${command.shotsFired} volleys fired, ${command.shotsTaken} absorbed.`
          : null,
      ].filter(Boolean),
    };
  }
  const survivors = game.ships.filter((ship) => ship.status !== 'destroyed');
  return {
    title: 'War zone map',
    lines: survivors.map((ship) => `${ship.name} (${factionText(ship.faction)}) — ${statusLabel(ship)} at ${coordOf(ship)}.`),
  };
};
