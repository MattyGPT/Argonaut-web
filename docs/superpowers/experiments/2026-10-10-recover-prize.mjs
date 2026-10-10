// Run from repository root: node docs/superpowers/experiments/2026-10-10-recover-prize.mjs
import { createOperationGame } from '../../../game/operations.js';
import { applyPlayerAction, maneuverTo } from '../../../game/actions.js';
import { resolveComputerTurns } from '../../../game/turns.js';

const runs = [];
for (const captain of ['op-scout', 'op-escort']) for (let seed = 1; seed <= 30; seed++) {
  let game = createOperationGame({ seed: `rescue-${seed}`, battleId: `recovery:rescue-${seed}` });
  const issue = (action) => {
    const result = applyPlayerAction(game, action);
    if (result.game === game) throw new Error(result.messages.join(' '));
    game = result.game.phase === 'computer' ? resolveComputerTurns(result.game) : result.game;
  };
  issue({ type: 'orders', shipId: captain === 'op-scout' ? 'op-escort' : 'op-scout', order: { type: 'rescue' } });
  issue({ type: 'orders', shipId: captain, order: { type: 'recover' } });
  let prizeAt = null, capturedAt = null, captainAt = null;
  for (let boundary = 0; boundary < 22 && !game.operation.result; boundary++) {
    issue(game.operation.primary === 'secured' && prizeAt !== null ? { type: 'move', ...maneuverTo(game, 38, 160) } : { type: 'pass' });
    if (game.prizesTaken.Federation && capturedAt === null) capturedAt = game.operation.elapsed;
    if (game.operation.extracted.some((s) => s.id === game.operation.prizeId) && prizeAt === null) prizeAt = game.operation.elapsed;
    if (game.operation.extracted.some((s) => s.id === captain) && captainAt === null) captainAt = game.operation.elapsed;
  }
  runs.push({ seed: `rescue-${seed}`, captain, capturedAt, captainAt, prizeAt, rescuedAt: game.operation.rescuedAt ?? null,
    result: game.operation.result, prizeCrew: game.operation.extracted.find((s) => s.id === game.operation.prizeId)?.crew ?? null,
    report: game.operation.recoveryReports?.[captain] });
}
const range = (rows, key) => { const values = rows.map((r) => r[key]).filter(Number.isFinite); return values.length ? [Math.min(...values), Math.max(...values)] : null; };
const summary = ['op-scout', 'op-escort'].map((captain) => {
  const rows = runs.filter((r) => r.captain === captain);
  return { captain, runs: rows.length, bothRecovered: rows.filter((r) => r.result?.primary === 'success' && r.result.prizeRecovered).length,
    capturedAt: range(rows, 'capturedAt'), captainAt: range(rows, 'captainAt'), prizeAt: range(rows, 'prizeAt'), rescuedAt: range(rows, 'rescuedAt'),
    prizeCrew: range(rows, 'prizeCrew'), lost: rows.reduce((n, r) => n + (r.result?.lost.length ?? 0), 0), capped: rows.filter((r) => !r.result).length };
});
console.log(JSON.stringify({ summary, runs }, null, 2));
