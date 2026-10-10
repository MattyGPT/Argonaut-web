import { OPERATION_SEEDS, RESCUE_BRIEFING, RESCUE_RULES, operationExtraction, operationFieldFleet, operationResultExplanation } from '../game/operations.js';

const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const names = (ships) => ships.length ? ships.map((ship) => escape(ship.name)).join(', ') : 'None';

export const operationPanelMarkup = (game) => {
  const op = game.operation;
  const result = op.result;
  const objective = result ? result.primary === 'success' ? 'Operation complete: Sentinel recovered.' : 'Operation ended: Sentinel was not recovered.'
    : op.primary === 'secured' ? 'Sentinel is safe. Bring your remaining ships home.' : op.primary === 'pending'
      ? op.elapsed >= op.deadline ? `Rescue is still possible! Bring Sentinel home before final evacuation at ${op.withdrawalDeadline}.`
        : 'Maintain tow on Sentinel and bring the pair to the beacon at 38, 160. Recover Wayfarer only if you can afford the detour.'
      : 'The rescue window is closed or Sentinel is lost. Extract the surviving fleet.';
  const recent = op.facts.filter((entry) => entry.kind === 'operation-notice').at(-1)?.message;
  const extraction = operationExtraction(game);
  const lastDeparture = !result && op.primary === 'pending' && extraction.ready.length
    && !operationFieldFleet(game).some((ship) => ship.id !== op.targetId && !extraction.ready.includes(ship))
    && !extraction.ready.some((ship) => ship.id === op.targetId);
  return `<div class="operation-heading"><h2>Rescue at the Belt <span class="mode-badge">PLAYTEST PROTOTYPE</span></h2>
    <span>Elapsed ${op.elapsed} · ${op.revision === 1 && result ? 'Previous rescue deadline' : 'On-time target'} ${op.deadline} · Final evacuation ${op.withdrawalDeadline}</span></div>
    <p class="operation-objective" role="status">${objective}</p>
    <p>Evacuated through beacon (removed from map): ${names(op.extracted)}${recent ? ` · ${escape(recent)}` : ''}</p>
    ${!result ? `<p class="operation-extraction">A maintained pair evacuates together when either ship enters the beacon. Departure happens after combat resolves. Rescue remains possible through elapsed stardate ${op.withdrawalDeadline}.</p>
      ${op.rulesUpdated ? '<p class="operation-warning">Prototype rules updated: the stardate-16 target no longer prevents a late rescue, and maintained pairs evacuate together.</p>' : ''}
      ${extraction.ready.length ? `<p>Ready to evacuate: ${names(extraction.ready)}. These ships will depart if still eligible after combat.</p>` : ''}
      ${extraction.linked.length ? `<p class="operation-warning" role="status">Linked evacuation: ${names(extraction.linked)} will leave together if the maintained tow survives combat.</p>` : ''}
      ${extraction.heldTugs.length ? `<p class="operation-warning" role="status">${names(extraction.heldTugs)} stays on station: Sentinel is still outside extraction or ineligible. Establish Maintain tow for linked evacuation, or continue single pulls until Sentinel enters the ring.</p>` : ''}
      ${op.primary === 'pending' && op.withdrawalDeadline - op.elapsed <= 3 ? `<p class="operation-warning" role="alert">${op.withdrawalDeadline - op.elapsed} turns remain to recover Sentinel and evacuate. Elapsed ${op.withdrawalDeadline} is the final departure.</p>` : ''}
      ${lastDeparture ? '<p class="operation-warning" role="status">Your last command ship is about to evacuate without Sentinel. Move it outside the ring or finish the rescue before advancing the turn; otherwise the mission will fail.</p>' : ''}` : ''}
    <details><summary>Briefing and prototype rules</summary><p>${RESCUE_BRIEFING}</p><p>${RESCUE_RULES}</p>
    <p>${(op.briefingPoints ?? []).map((point) => `${escape(point.label)}: ${point.x}, ${point.y}`).join(' · ')}. Diamond labels mark initial intelligence, not live ship positions.</p>
    <p>Select Sentinel → Maintain tow once, then use Engines or map movement toward the beacon. Tow speed is limited by engines and tractor power; the console and Engines preview show both destinations. Either linked ship entering the ring brings both home. Keep the tow attached for evacuation. Single pull toward extraction remains available for precise repositioning after releasing the maintained tow. Use Fleet orders → Withdraw for your other captains.</p>
    <p>This first build tests movement, local patrols, and manual rescue. The art pass and automated rescue orders follow playtesting.</p></details>
    ${result ? `<div class="operation-debrief"><h3>${result.primary === 'success' ? 'Sentinel recovered' : 'Rescue unsuccessful'}</h3>
      <p class="operation-result-reason">${escape(operationResultExplanation(game))}</p>
      <p>Returned: ${names(result.returned)}. Left behind: ${names(result.abandoned)}. Lost: ${names(result.lost)}.</p>
      <p>Optional prize: ${result.prizeRecovered ? 'recovered' : 'not recovered'}. Fleet survival: ${result.fleetSurvived ? 'mobile hull returned' : 'no mobile hull returned'}.</p>
      <p>Confirmed towing: ${Object.entries(op.assists).map(([id, amount]) => `${escape([...game.ships, ...op.extracted].find((ship) => ship.id === id)?.name ?? id)} ${amount.toFixed(1)} units`).join(', ') || 'None'}.</p></div>` : ''}
    <div class="operation-controls"><button class="secondary tiny" data-operation-action="overview">Overview</button>
    <button class="secondary tiny" data-operation-action="follow">Follow command</button>
    ${!result ? '<button class="secondary tiny" data-operation-action="end">End operation…</button>' : ''}
    <label>Variation <select id="operation-seed">${OPERATION_SEEDS.map((seed, i) => `<option value="${seed}"${seed === op.seed ? ' selected' : ''}>${i === 0 ? 'Reference' : `Variation ${i + 1}`}</option>`).join('')}</select></label>
    <button class="secondary tiny" data-operation-action="retry">Start variation / retry…</button>
    <button class="tiny" data-operation-action="return">Return to previous game${result ? '' : '…'}</button></div>`;
};
