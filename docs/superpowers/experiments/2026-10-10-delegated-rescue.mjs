// Run from repository root: node docs/superpowers/experiments/2026-10-10-delegated-rescue.mjs
import { createOperationGame } from '../../../game/operations.js';
import { applyPlayerAction, maneuverTo } from '../../../game/actions.js';
import { resolveComputerTurns } from '../../../game/turns.js';

const runs = [];
for (const tug of ['op-escort', 'op-scout']) for (let seed = 1; seed <= 30; seed++) {
  let game = createOperationGame({ seed: `rescue-${seed}`, battleId: `delegation:rescue-${seed}` });
  const issue = (action) => {
    const result = applyPlayerAction(game, action);
    if (result.game === game) throw new Error(result.messages.join(' '));
    game = result.game.phase === 'computer' ? resolveComputerTurns(result.game) : result.game;
  };
  issue({ type: 'orders', shipId: tug, order: { type: 'rescue' } });
  for (let boundary = 0; boundary < 22 && !game.operation.result; boundary++) {
    issue(game.operation.primary === 'pending' ? { type: 'pass' } : { type: 'move', ...maneuverTo(game, 38, 160) });
  }
  runs.push({ seed: `rescue-${seed}`, tug, rescuedAt: game.operation.rescuedAt ?? null,
    result: game.operation.result, sentinelCrew: game.operation.extracted.find((s) => s.id === game.operation.targetId)?.crew ?? null,
    report: game.operation.rescueReports?.[tug] });
}
const range = (rows, read) => { const values = rows.map(read).filter(Number.isFinite); return values.length ? [Math.min(...values), Math.max(...values)] : null; };
const summary = ['op-escort', 'op-scout'].map((tug) => {
  const rows = runs.filter((r) => r.tug === tug);
  return { tug, runs: rows.length, rescued: rows.filter((r) => r.result?.primary === 'success').length,
    rescueElapsed: range(rows, (r) => r.rescuedAt), finalElapsed: range(rows, (r) => r.result?.elapsed),
    sentinelCrew: range(rows, (r) => r.sentinelCrew), lost: rows.reduce((n, r) => n + (r.result?.lost.length ?? 0), 0),
    capped: rows.filter((r) => !r.result).length };
});
console.log(JSON.stringify({ summary, runs }, null, 2));
