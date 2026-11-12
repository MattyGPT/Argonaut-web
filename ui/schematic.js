/**
 * The hull interior schematic: a picture of the numbers the player is already
 * managing blind.
 *
 * Everything here is a projection of authoritative state that already exists —
 * shield arcs against their undamaged split, surviving system units against the
 * class template, crew against complement, reactor output against the five sinks
 * it is distributed across. Nothing is inferred, nothing is rolled, and no
 * gameplay RNG is consumed. The module is pure: it takes the game and a hull and
 * returns markup, so it is testable without a browser.
 *
 * Honesty rule. An enemy hull's interior is not public information. What may be
 * drawn is decided by `snapshotKnowledge`, the same authority the battle journal
 * and the causal record layer use: own hull, friendly hull, a hull you have
 * scanned, or one in radio contact while visible. Anything else gets an explicit
 * "not observed" panel rather than a guess — a schematic that quietly showed an
 * unscanned enemy's crew count would be the same fabrication the service records
 * are forbidden from.
 *
 * Degradation is deliberate and visible. Drones have no directional arcs and
 * Classic hulls have neither arcs nor a reactor key, so those sections are
 * omitted with a line saying why, never drawn as zeroes — an absent system and a
 * destroyed one are different facts.
 */
import { ARCS, POWER, POWER_SINKS } from '../game/constants.js';
import {
  arcCapacities, arcFocusOf, arcsOf, crewCapacity, hasArcs, isDrone,
  powerAllocation, powerEffect, reactorOutput, stanceOf, systemUnits, templateSystems,
} from '../game/state.js';
import { snapshotKnowledge } from '../game/battle-records.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const titleCase = (value) => String(value ?? '').replace(/(^|[-\s])(\w)/g, (_, before, letter) => before + letter.toUpperCase());

/**
 * Whether the interior of this hull may be shown at all. Mirrors the journal's
 * `internalsKnown` gate: your own hull, a friendly hull, one you have scanned, or
 * one you can see while it is in radio contact. A resigned or command-lost
 * player is a spectator and sees the board as the rules already allow.
 */
export const schematicKnown = (game, ship) => {
  if (!game || !ship) return false;
  const knowledge = snapshotKnowledge(game, { target: ship });
  if (knowledge.spectator) return true;
  const seen = knowledge.target;
  if (!seen) return false;
  return Boolean(seen.own || seen.friendly || seen.scanned || (seen.visible && knowledge.radioIntegrity > 0 && seen.radioContact));
};

const bar = (label, value, capacity, key) => {
  const safeCapacity = Math.max(0, Number(capacity) || 0);
  const safeValue = Math.max(0, Math.min(Number(value) || 0, safeCapacity));
  const percent = safeCapacity > 0 ? (safeValue / safeCapacity) * 100 : 0;
  return `<div class="schematic-row" data-console-key="${key}">
      <span class="schematic-label">${escapeHtml(label)}</span>
      <span class="schematic-bar" role="img" aria-label="${escapeHtml(label)} ${safeValue} of ${safeCapacity}"><i style="width:${percent.toFixed(1)}%"></i></span>
      <span class="schematic-value">${safeValue}/${safeCapacity}</span>
    </div>`;
};

/**
 * One block per installed unit, filled while it survives. Blocks are decorative —
 * the same fact is stated in words on the container, so nothing is graphics-only.
 */
const unitBlocks = (surviving, installed, label) => {
  const blocks = Array.from({ length: Math.max(0, installed) }, (_, index) => `<i class="${index < surviving ? 'on' : ''}"></i>`).join('');
  return `<span class="schematic-units" role="img" aria-label="${escapeHtml(label)} ${surviving} of ${installed} units intact">${blocks}</span>`;
};

const arcSection = (game, ship) => {
  if (!hasArcs(game, ship)) {
    const why = isDrone(ship) ? 'A drone carries no directional shield arcs.'
      : game?.reimagined ? 'This hull has no directional shield arcs.'
        : 'Classic hulls have a single shield pool, not directional arcs.';
    return `<div class="schematic-group" data-console-key="arcs">
      <span class="schematic-legend">Shield arcs</span>
      <p class="schematic-note">${escapeHtml(why)}</p>
    </div>`;
  }
  const live = arcsOf(game, ship) ?? {};
  const capacity = arcCapacities(ship) ?? {};
  const focus = arcFocusOf(game, ship);
  const rows = ARCS.map((arc) => {
    const held = Math.max(0, Number(live[arc]) || 0);
    const total = Math.max(0, Number(capacity[arc]) || 0);
    const focused = focus === arc;
    return `<div class="schematic-row${focused ? ' focused' : ''}" data-console-key="arc-${arc}" data-arc-name="${arc}"${focused ? ' data-arc-focused="true"' : ''}>
      <span class="schematic-label">${escapeHtml(titleCase(arc))}${focused ? ' <span class="schematic-focus-mark" aria-hidden="true">&#9670;</span>' : ''}</span>
      <span class="schematic-bar" role="img" aria-label="${escapeHtml(titleCase(arc))} shield arc ${held} of ${total}${focused ? ', reinforced' : ''}"><i style="width:${total > 0 ? ((held / total) * 100).toFixed(1) : 0}%"></i></span>
      <span class="schematic-value">${held}/${total}</span>
    </div>`;
  }).join('');
  return `<div class="schematic-group" data-console-key="arcs">
    <span class="schematic-legend">Shield arcs${focus ? ` <span class="schematic-legend-note">reinforced: ${escapeHtml(titleCase(focus))}</span>` : ''}</span>
    ${rows}
  </div>`;
};

const systemSection = (game, ship) => {
  // templateSystems is the game's own notion of a hull's complement: the class
  // template plus the Reimagined-only reactor, ion and spread tubes. Deriving the
  // nominal counts from it rather than from the raw template means the schematic
  // cannot drift when a new carried system is added, and a Classic hull still
  // gets exactly the template's list.
  const nominal = templateSystems(ship) ?? ship?.systems ?? {};
  // Reactor units are deliberately not listed here: they get their own section
  // below, shown as the power budget they produce. Listing them twice would
  // invite the reading that a reactor unit is a subsystem you can lose
  // independently of that budget, which is not how reactorOutput works.
  const names = Object.keys(nominal).filter((system) => system !== 'reactor');
  if (!names.length) return '';
  const rows = names.map((system) => {
    const installed = Math.max(0, Number(nominal[system]) || 0);
    const surviving = systemUnits(ship, system);
    const down = surviving <= 0;
    return `<div class="schematic-row${down ? ' down' : ''}" data-console-key="system-${system}" data-system-name="${escapeHtml(system)}"${down ? ' data-system-down="true"' : ''}>
      <span class="schematic-label">${escapeHtml(titleCase(system))}${down ? ' <span class="schematic-down-mark">out</span>' : ''}</span>
      ${unitBlocks(surviving, installed, titleCase(system))}
      <span class="schematic-value">${surviving}/${installed}</span>
    </div>`;
  }).join('');
  return `<div class="schematic-group" data-console-key="systems">
    <span class="schematic-legend">Systems</span>
    ${rows}
  </div>`;
};

const crewSection = (game, ship) => {
  const complement = Math.max(0, Number(crewCapacity(ship)) || 0);
  const aboard = Math.max(0, Number(ship?.crew) || 0);
  return `<div class="schematic-group" data-console-key="crew">
    <span class="schematic-legend">Complement</span>
    ${bar('Crew', aboard, complement, 'crew')}
  </div>`;
};

const reactorSection = (game, ship) => {
  // Reactor distribution is a Reimagined rule; a Classic hull has no sink bars to
  // draw, and drawing empty ones would imply a system it does not have.
  if (!game?.reimagined) {
    return `<div class="schematic-group" data-console-key="reactor">
      <span class="schematic-legend">Reactor</span>
      <p class="schematic-note">Classic hulls run every system at full effect; there is no power to distribute.</p>
    </div>`;
  }
  const output = Math.max(0, Number(reactorOutput(ship, game)) || 0);
  const allocation = powerAllocation(game, ship) ?? {};
  const reactorUnits = systemUnits(ship, 'reactor');
  const rows = POWER_SINKS.map((sink) => {
    const given = Math.max(0, Number(allocation[sink]) || 0);
    const need = Math.max(0, Number(POWER.need?.[sink]) || 0);
    const effect = Number(powerEffect(game, ship, sink)) || 0;
    const starved = need > 0 && given < need;
    const over = need > 0 && given > need;
    return `<div class="schematic-row${starved ? ' starved' : ''}${over ? ' over' : ''}" data-console-key="sink-${sink}" data-sink-name="${escapeHtml(sink)}">
      <span class="schematic-label">${escapeHtml(titleCase(sink))}</span>
      <span class="schematic-bar" role="img" aria-label="${escapeHtml(titleCase(sink))} power ${given} allocated against ${need} needed, ${effect.toFixed(2)} times effect"><i style="width:${need > 0 ? Math.min(100, (given / need) * 100).toFixed(1) : 0}%"></i></span>
      <span class="schematic-value">${given}/${need} &middot; ${effect.toFixed(2)}&times;</span>
    </div>`;
  }).join('');
  return `<div class="schematic-group" data-console-key="reactor">
    <span class="schematic-legend">Reactor <span class="schematic-legend-note">${output} points from ${reactorUnits} unit${reactorUnits === 1 ? '' : 's'}</span></span>
    ${rows}
  </div>`;
};

/**
 * The full interior panel for one hull. Returns an empty string when there is
 * nothing to draw, so callers can concatenate it unconditionally.
 */
export const schematicHtml = (game, ship) => {
  if (!game || !ship) return '';
  const name = escapeHtml(ship.name ?? ship.id ?? 'Hull');
  const status = escapeHtml(titleCase(ship.status ?? 'active'));
  const stance = escapeHtml(titleCase(stanceOf(game, ship) ?? ''));

  if (!schematicKnown(game, ship)) {
    return `<section class="schematic" data-console-key="schematic" data-known="false" aria-label="Interior readout for ${name}">
      <h4 class="schematic-title">Interior &mdash; ${name}</h4>
      <p class="schematic-note" data-console-key="schematic-unknown">Interior not observed. Scan the hull, or bring it into radio contact while it is on the mapper, to read its arcs, systems, and complement.</p>
    </section>`;
  }

  return `<section class="schematic" data-console-key="schematic" data-known="true" aria-label="Interior readout for ${name}">
    <h4 class="schematic-title">Interior &mdash; ${name} <span class="schematic-title-note">${escapeHtml(ship.className ?? '')}${stance ? ` &middot; ${stance}` : ''} &middot; ${status}</span></h4>
    ${arcSection(game, ship)}
    ${systemSection(game, ship)}
    ${crewSection(game, ship)}
    ${reactorSection(game, ship)}
  </section>`;
};
