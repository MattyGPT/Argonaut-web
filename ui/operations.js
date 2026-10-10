import { OPERATION_SEEDS, RESCUE_BRIEFING, RESCUE_RULES } from '../game/operations.js';

const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const names = (ships) => ships.length ? ships.map((ship) => escape(ship.name)).join(', ') : 'None';

export const operationPanelMarkup = (game) => {
  const op = game.operation;
  const result = op.result;
  const recent = op.facts.filter((entry) => entry.kind === 'operation-notice').at(-1)?.message;
  return `<div class="operation-heading"><h2>Rescue at the Belt <span class="mode-badge">PLAYTEST PROTOTYPE</span></h2>
    <span>Elapsed ${op.elapsed} · Rescue by ${op.deadline} · Withdraw by ${op.withdrawalDeadline}</span></div>
    <p class="operation-objective" role="status">${op.primary === 'secured' ? 'Sentinel is safe. Bring your remaining ships home.' : op.primary === 'pending' ? 'Tow Sentinel into the extraction ring at 38, 160. Recover Wayfarer only if you can afford the detour.' : 'The rescue window is closed or Sentinel is lost. Extract the surviving fleet.'}</p>
    <p>Returned: ${names(op.extracted)}${recent ? ` · ${escape(recent)}` : ''}</p>
    <details><summary>Briefing and prototype rules</summary><p>${RESCUE_BRIEFING}</p><p>${RESCUE_RULES}</p>
    <p>${(op.briefingPoints ?? []).map((point) => `${escape(point.label)}: ${point.x}, ${point.y}`).join(' · ')}. Diamond labels mark initial intelligence, not live ship positions.</p>
    <p>Select Sentinel → Tow toward extraction. Coordinates 38, 160 are filled in. Check the predicted landing, then confirm one pull. Your ship must remain within 35 units; keep it alongside, around 20 units above or below Sentinel, and reposition between pulls. Pulling Sentinel toward your own ship can cause a collision. Use Fleet orders → Withdraw for your other captains.</p>
    <p>This first build tests movement, local patrols, and manual rescue. The art pass and automated rescue orders follow playtesting.</p></details>
    ${result ? `<div class="operation-debrief"><h3>${result.primary === 'success' ? 'Sentinel recovered' : 'Rescue unsuccessful'}</h3>
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
