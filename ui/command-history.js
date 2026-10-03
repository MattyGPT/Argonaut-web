// A bounded bridge record, owned by the UI and saved beside the simulation.
// Fleet traffic, radio damage, and a change of command cannot overwrite it.
export const COMMAND_HISTORY_LIMIT = 12;

export const rememberCommand = (history, game, type, outcome) => {
  if (outcome.game === game || !outcome.messages?.length) return history ?? [];
  const ship = game.ships.find((entry) => entry.id === game.playerShipId);
  return [...(history ?? []), {
    turn: game.turn,
    shipId: ship?.id,
    shipName: ship?.name ?? 'Command',
    type,
    messages: [...outcome.messages],
  }].slice(-COMMAND_HISTORY_LIMIT);
};

export const restoreCommandHistory = (saved, seed) => {
  if (!seed || saved?.seed !== seed || !Array.isArray(saved.entries)) return [];
  return saved.entries.filter((entry) => Number.isFinite(entry?.turn)
    && typeof entry.shipName === 'string'
    && Array.isArray(entry.messages) && entry.messages.every((line) => typeof line === 'string'))
    .slice(-COMMAND_HISTORY_LIMIT);
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export const commandHistoryHtml = (history = []) => history.slice().reverse().map((entry) => `
  <li><span class="command-stamp">Stardate ${escapeHtml(entry.turn)} · ${escapeHtml(entry.shipName)}</span>
  ${entry.messages.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</li>`).join('');
