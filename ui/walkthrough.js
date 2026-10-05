// Optional presentation hints only. This reducer never changes engine state.
import { actionAvailability } from '../game/actions.js';
import { getShip, isActive } from '../game/state.js';

const battleIdOf = (game) => game?.battleRecordState?.battleId ?? game?.battleId ?? null;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const terminal = new Set(['complete', 'dismissed', 'ended', 'idle']);
const confirmedKinds = new Set(['action-resolution', 'weapon-resolution', 'movement', 'course-plotted', 'shield-recovery', 'tractor-lock', 'capture', 'crew-transfer', 'drone-launch', 'ordnance-impact']);
const button = (action, label) => `<button type="button" class="secondary tiny" data-walkthrough-action="${action}">${label}</button>`;

export const createWalkthrough = (game, { dismissed = false } = {}) => ({
  version: 1, battleId: battleIdOf(game), stage: dismissed ? 'dismissed' : 'idle', dismissed,
  shipId: game?.playerShipId ?? null, actionId: null, command: null, confirmed: false,
});

/** Events describe actual UI observations; only accepted C2 records prove an
 * order. Late impacts remain linked to their accepted issuer after transfers.
 */
export const advanceWalkthrough = (state, event = {}, game) => {
  if (!state || state.battleId !== battleIdOf(game)) state = createWalkthrough(game, { dismissed: Boolean(state?.dismissed) });
  if (event.type === 'dismiss') return { ...state, stage: 'dismissed', dismissed: true };
  if (event.type === 'start' || event.type === 'restart') return {
    ...createWalkthrough(game), stage: game?.outcome || !isActive(getShip(game, game?.playerShipId)) ? 'ended'
      : game?.realtime && !event.paused ? 'pause-readiness' : 'locate',
  };
  if (terminal.has(state.stage)) return state;
  if (game?.outcome) return { ...state, stage: 'ended' };
  let next = state;
  if (game?.playerShipId !== state.shipId) {
    // An already accepted order still belongs to its original command hull.
    next = { ...state, shipId: game?.playerShipId ?? null, ...(!state.actionId ? { stage: game?.realtime && !event.paused ? 'pause-readiness' : 'locate' } : {}) };
  }
  if (event.type === 'pause' && next.stage === 'pause-readiness' && event.paused === true) return { ...next, stage: 'locate' };
  if (event.type === 'locate' && next.stage === 'locate' && event.shipId === game?.playerShipId) return { ...next, stage: 'inspect' };
  if (event.type === 'inspect' && ['locate', 'inspect'].includes(next.stage)) {
    const subject = getShip(game, event.shipId ?? game?.playerShipId);
    // The app sends this only after opening the real movement/target control.
    if (subject && subject.status !== 'destroyed') return { ...next, stage: 'order' };
  }
  if (event.type === 'records' && ['locate', 'inspect', 'order', 'result'].includes(next.stage)) {
    const records = (Array.isArray(event.records) ? event.records : []).filter((record) => record.battleId === next.battleId);
    if (!next.actionId) {
      const accepted = records.find((record) => record.kind === 'action' && record.source === 'manual' && record.knowledge?.ownAction === true && typeof record.actionId === 'string');
      if (accepted) next = { ...next, stage: 'result', actionId: accepted.actionId, command: accepted.payload?.command ?? 'order', issuerId: accepted.actorId, confirmed: false };
    }
    if (next.actionId && records.some((record) => record.actionId === next.actionId && confirmedKinds.has(record.kind))) next = { ...next, confirmed: true };
  }
  if (event.type === 'inspect-result' && next.stage === 'result' && next.confirmed && event.actionId === next.actionId) return { ...next, stage: 'complete' };
  return next;
};

export const walkthroughMarkup = (state, game, { paused = false } = {}) => {
  if (!state || state.battleId !== battleIdOf(game)) state = createWalkthrough(game, { dismissed: Boolean(state?.dismissed) });
  if (state.stage === 'idle' || state.stage === 'dismissed') return `<h2>First orders</h2><p>Optional hints help you find your ship, issue an order, and read its result.</p>${button('start', 'Start first-order hints')}`;
  const ship = getShip(game, game?.playerShipId);
  const shipName = escape(ship?.name ?? 'your current command ship');
  let text;
  let control = '';
  if (game?.outcome || state.stage === 'ended') text = 'This battle has ended. Read the battle report; you can restart the hints in another battle.';
  else if (state.stage === 'pause-readiness') {
    text = 'Pause to read the controls. Readiness uses simulation time: after a volley, its shared cycle must finish before another volley. Movement courses can be plotted while paused.';
    control = button('pause', paused ? 'Continue while paused' : 'Pause and inspect readiness');
  } else if (state.stage === 'locate') {
    text = `Find ${shipName}, your current command ship. Its marker and console identify your command.`;
    control = button('locate', 'Locate my command ship');
  } else if (state.stage === 'inspect') {
    const move = actionAvailability(game, { type: 'move', dx: 0, dy: 0 });
    text = move.available ? `Inspect Engines on ${shipName}, or select an available target. Movement works even when no enemy is in weapon range.`
      : 'Read the command console, or select a visible target and read its menu. Use a valid available order, such as Shields or Hold position; explanations beside commands show whether they can be used.';
    if (move.available) control = button('inspect', 'Inspect Engines');
  } else if (state.stage === 'order') {
    text = 'Issue any valid order using the ordinary controls. A refusal keeps this step open; an accepted order appears under Your ship in the Battle journal.';
  } else if (state.stage === 'result') {
    text = state.confirmed ? `Your ${escape(state.command)} order has a confirmed result. Find it under Your ship in the Battle journal and read what changed.`
      : `Your ${escape(state.command)} order was accepted. Wait for its confirmed result; in real time, Resume lets movement and ordnance resolve.`;
    if (state.confirmed) control = button('inspect-result', 'Inspect my latest result');
  } else text = 'First-order hints completed. Keep using Your ship in the Battle journal to compare accepted orders with their confirmed results.';
  return `<h2>First orders</h2><p>${text}</p><div class="learning-controls">${control}${button('dismiss', 'Dismiss hints')}${button('restart', 'Restart hints')}</div>`;
};
