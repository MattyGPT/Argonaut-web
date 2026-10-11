import { RANGES } from '../game/constants.js';
import { distance, getShip, inRadioContact, isActive, isTractorHeld, nebulaHides, powerEffect, sensorRange, systemUnits } from '../game/state.js';
import { isOperation, operationExtraction, operationFieldFleet } from '../game/operations.js';
import { scenarioFor } from '../game/scenarios.js';
import { practiceProgress } from '../game/practice.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const commandVisible = (game, ship) => {
  const actor = getShip(game, game.playerShipId);
  return Boolean(isActive(actor) && ship && (ship.id === actor.id
    || distance(actor, ship) <= sensorRange(game, actor, 'mapper') && !nebulaHides(game, actor, ship)));
};
const labels = { hold: 'Hold position', focus: 'Concentrate with fleet', withdraw: 'Withdraw', rescue: 'Rescue Sentinel', recover: 'Recover prize', escort: 'Escort', screen: 'Screen', intercept: 'Intercept', board: 'Board', launch: 'Launch drones' };
export const commandOrderLabel = (game, order) => {
  if (!order) return isOperation(game) ? 'hold and defend (operation default)' : 'concentrate with the fleet';
  if (order.type === 'withdraw') return isOperation(game) ? 'Withdraw to extraction beacon' : 'Withdraw toward friendly dockyard or fleet';
  if (['rescue', 'recover'].includes(order.type)) return labels[order.type];
  const target = getShip(game, order.targetId);
  return `${labels[order.type] ?? 'Fleet order'}${order.targetId ? ` — ${commandVisible(game, target) ? target.name : 'target outside current mapper view'}` : ''}`;
};

/** Intent and reported progress are different facts. Never run an AI decision
 * query in the renderer or infer completion from proximity to a destination. */
export const commandOrderStatus = (game, ship) => {
  const standing = game.orders?.[ship.id], pending = game.pendingOrders?.[ship.id];
  const report = standing?.type === 'rescue' ? game.operation?.rescueReports?.[ship.id]
    : standing?.type === 'recover' ? game.operation?.recoveryReports?.[ship.id] : null;
  const visible = commandVisible(game, ship);
  const target = getShip(game, standing?.targetId);
  const targetChanged = commandVisible(game, target) && (standing?.type === 'board' ? target.status !== 'vacant'
    : ['escort', 'screen', 'intercept'].includes(standing?.type) && (!isActive(target)
      || (standing.type === 'intercept' ? target.faction === ship.faction : target.faction !== ship.faction)));
  let phase = standing ? 'Standing' : 'Default', reason = standing ? 'Order accepted; completion is not confirmed.' : isOperation(game) ? 'No explicit order; operation captains hold and defend until assigned.' : 'No explicit order; the captain follows the fleet doctrine.';
  if (game.outcome && (!report || !['completed', 'failed', 'cancelled', 'ended'].includes(report.phase))) { phase = 'Ended'; reason = 'Battle concluded; no further execution.'; }
  else if (report) { phase = `Reported ${report.phase}`; reason = `${report.reason} Reported at elapsed ${report.elapsed}.`; }
  else if (!visible) { phase = 'Unconfirmed'; reason = 'Outside current mapper view; current condition and execution are not confirmed.'; }
  else if (!isActive(ship)) { phase = 'Unavailable'; reason = 'This hull is no longer active.'; }
  else if (ship.id === game.playerShipId) { phase = 'Command ship'; reason = 'Standing orders apply when automatic conn or autopilot is directing this hull; manual commands remain yours.'; }
  else if (targetChanged) { phase = 'Review target'; reason = 'The visible target changed status or allegiance; review and replace this standing order.'; }
  else if (standing?.type === 'hold') { phase = 'Holding'; reason = 'Hold position remains active; the captain may still defend the ship.'; }
  else if (standing && ['withdraw', 'escort', 'screen', 'intercept', 'board'].includes(standing.type)
    && (isTractorHeld(game, ship) || systemUnits(ship, 'engines') <= 0 || powerEffect(game, ship, 'engines') <= 0)) {
    phase = 'Movement limited'; reason = isTractorHeld(game, ship) ? 'Held by a tractor beam; movement is blocked. Other actions may still be possible.' : 'Working, powered engines are needed to move. Other actions may still be possible.';
  }
  return {
    id: ship.id, name: ship.name, phase, reason,
    standing: commandOrderLabel(game, standing),
    pending: pending ? commandOrderLabel(game, pending) : null,
    pendingExplanation: game.outcome ? 'Undelivered when the battle ended; no further execution.' : 'In radio transit; scheduled for the next stardate delivery. The standing order continues until delivery.',
    destination: ['rescue', 'recover', 'withdraw'].includes(standing?.type) && isOperation(game)
      ? `Extraction beacon ${game.operation.exit.x}, ${game.operation.exit.y}` : null,
  };
};

export const commandOrderLines = (game, ship) => {
  const status = commandOrderStatus(game, ship);
  return [`Standing orders: ${status.standing}.`,
    ...(status.pending ? [`Pending replacement: ${status.pending}. ${status.pendingExplanation}`] : []),
    `${status.phase}: ${status.reason}`, ...(status.destination ? [`Destination: ${status.destination}.`] : [])];
};

export const commandPriorities = (game) => {
  if (!game?.reimagined) return null;
  const actor = getShip(game, game.playerShipId), op = isOperation(game) ? game.operation : null;
  const practice = practiceProgress(game), scenario = scenarioFor(game);
  let objective = scenario.brief;
  if (practice) objective = `${practice.title}: ${practice.objective}`;
  else if (op) objective = op.result ? (op.result.primary === 'success' ? 'Sentinel recovered. Review returned, abandoned and lost hulls in the debrief.' : 'Rescue unsuccessful. Review the debrief before retrying.')
    : `${op.primary === 'secured' ? 'Sentinel is safe; evacuate the remaining fleet.' : op.primary === 'pending' ? 'Recover Sentinel; Wayfarer is optional.' : 'Sentinel cannot be recovered; evacuate survivors.'} Beacon ${op.exit.x}, ${op.exit.y}. Elapsed ${op.elapsed} · on-time target ${op.deadline} · final evacuation ${op.withdrawalDeadline}.`;
  else if (scenario.id === 'defend-xanadu') objective = `Keep Xanadu standing through stardate ${scenario.stardates}. Current stardate ${game.turn}.`;
  else if (scenario.id === 'hunt-the-vendetta') {
    const target = getShip(game, game.objectiveShipId);
    objective = target && game.scanned?.[target.id] ? `Hunter identified: ${target.name}. End that hull to complete the hunt.` : 'Scan enemy captains to identify your hunter before ending that hull.';
  }
  if (game.outcome && !op) objective = game.outcome.message ?? 'Battle concluded.';
  // Pending intent is a command the player already sent, even out of contact.
  // It does not authorize reading that hull's current condition. Operation
  // reports are public broadcasts; extracted hulls are departure snapshots.
  const subjects = [...game.ships, ...(op?.extracted ?? [])].filter((ship) => {
    const hasOrder = game.orders?.[ship.id] || game.pendingOrders?.[ship.id];
    const report = op?.rescueReports?.[ship.id] || op?.recoveryReports?.[ship.id];
    return hasOrder && (game.pendingOrders?.[ship.id] || report || ship.faction === actor?.faction && (commandVisible(game, ship) || isActive(actor) && isActive(ship) && inRadioContact(game, actor, ship)));
  });
  const orders = subjects.map((ship) => commandOrderStatus(game, ship)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const notices = [];
  const add = (id, rank, text) => notices.push({ id, rank, text });
  if (!game.outcome && !op?.result) {
    if (op) {
      const extraction = operationExtraction(game);
      const lastDeparture = op.primary === 'pending' && extraction.ready.length
        && !operationFieldFleet(game).some((ship) => ship.id !== op.targetId && !extraction.ready.includes(ship))
        && !extraction.ready.some((ship) => ship.id === op.targetId);
      if (lastDeparture) add('last-departure', 0, 'Last command ship is ready to leave without Sentinel. Move outside the beacon or finish the rescue before advancing.');
      if (op.withdrawalDeadline - op.elapsed <= 3) add('final-evacuation', 1, `${Math.max(0, op.withdrawalDeadline - op.elapsed)} turns to final evacuation. Ships left behind will not return.`);
      else if (op.primary === 'pending' && op.elapsed >= op.deadline) add('late-rescue', 4, 'On-time target missed; late rescue is still possible before final evacuation.');
      if (extraction.linked.length) add('linked-exit', 3, 'Maintained pair ready: both ships evacuate after combat if their tow remains valid.');
      else if (extraction.heldTugs.length) add('held-exit', 3, 'Tug stays on station: Sentinel is not eligible to evacuate. Maintain tow for linked extraction or continue single pulls.');
      else if (extraction.ready.length && !lastDeparture) add('ready-exit', 4, `${extraction.ready.length} ${extraction.ready.length === 1 ? 'ship' : 'ships'} ready to evacuate after combat, if still eligible.`);
      // Show the authored announcement, never the spawned hull's hidden state.
      const arrival = op.facts.filter((fact) => fact.kind === 'operation-notice').at(-1);
      if (arrival) add('arrival', 7, arrival.message);
    }
    if (isActive(actor) && isTractorHeld(game, actor)) add('command-held', 2, 'Command ship is tractor-held. Resolve the hold before planning movement.');
    const blocked = orders.filter((order) => ['Reported blocked', 'Reported failed', 'Movement limited', 'Review target'].includes(order.phase));
    if (blocked.length) add('order-blockers', 5, `${blocked.length} fleet ${blocked.length === 1 ? 'order needs' : 'orders need'} attention. Open Fleet order status for the recorded reason.`);
    const hostiles = isActive(actor) ? game.ships.filter((ship) => commandVisible(game, ship) && isActive(ship) && !ship.neutral && ship.faction !== actor.faction
      && (systemUnits(ship, 'phasers') > 0 && distance(ship, actor) <= RANGES.phasers || systemUnits(ship, 'photons') > 0 && distance(ship, actor) <= RANGES.photons)) : [];
    if (hostiles.length) add('visible-threats', 6, `${hostiles.length} visible ${hostiles.length === 1 ? 'hostile' : 'hostiles'} within phaser or photon reach. This is range, not a predicted attack.`);
    const pending = orders.filter((order) => order.pending);
    if (pending.length) add('radio-pending', 8, `${pending.length} order ${pending.length === 1 ? 'replacement' : 'replacements'} in radio transit; standing orders continue until delivery.`);
  }
  notices.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  return { objective, notices: notices.slice(0, 3), additional: notices.slice(3), orders };
};

export const commandPrioritiesMarkup = (model) => {
  if (!model) return '';
  const notices = (items) => items.map((notice) => `<li data-console-key="priority-${notice.id}">${escape(notice.text)}</li>`).join('');
  return `<p class="priority-objective"><strong>Objective</strong> ${escape(model.objective)}</p>
    ${model.notices.length ? `<ul class="priority-notices">${notices(model.notices)}</ul>` : ''}
    <details data-console-key="fleet-order-status"><summary>Fleet order status (${model.orders.length})${model.additional.length ? ` · ${model.additional.length} more ${model.additional.length === 1 ? 'notice' : 'notices'}` : ''}</summary>
      ${model.additional.length ? `<ul>${notices(model.additional)}</ul>` : ''}
      <p class="priority-note">Radio-delayed replacements leave the standing order in force until delivery. Progress reports show when they were recorded.</p>
      <ul class="priority-orders">${model.orders.map((order) => `<li data-console-key="order-${escape(order.id)}"><strong>${escape(order.name)} — ${escape(order.phase)}</strong>
        <span>Standing: ${escape(order.standing)}.</span>${order.pending ? `<span class="priority-pending">Pending replacement: ${escape(order.pending)}. ${escape(order.pendingExplanation)}</span>` : ''}
        <span>${escape(order.reason)}</span>${order.destination ? `<span>Destination: ${escape(order.destination)}.</span>` : ''}</li>`).join('') || '<li>No explicit fleet orders currently reported. Use Fleet orders or a friendly ship’s menu to assign one.</li>'}</ul>
    </details>`;
};
