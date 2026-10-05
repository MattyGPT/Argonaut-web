/** Presentation identities only. Callers supply current allegiance or a frozen
 * event-time snapshot; this module never reads ships or reveals contacts. */
export const FACTION_IDENTITIES = Object.freeze(Object.fromEntries([
  ['Federation', 'square', '■', 'var(--fed)', 'M2 2H10V10H2Z'],
  ['Axis', 'triangle', '▲', 'var(--axis)', 'M6 1L11 11H1Z'],
  ['Bloc', 'diamond', '◆', 'var(--bloc)', 'M6 1L11 6L6 11L1 6Z'],
  ['Cabal', 'circle', '●', 'var(--cabal)', 'M6 1A5 5 0 1 1 6 11A5 5 0 1 1 6 1Z'],
  ['Neutral', 'hollow-circle', '○', '#b8c4cc', 'M6 1A5 5 0 1 1 6 11A5 5 0 1 1 6 1Z'],
  ['Unowned', 'hollow-square', '□', '#9fb6c6', 'M2 2H10V10H2Z'],
  ['Unknown', 'hollow-square', '?', '#9fb6c6', 'M2 2H10V10H2Z'],
].map(([label, shape, glyph, color, path]) => [label, Object.freeze({ label, shape, glyph, color, path })])));

export const factionIdentity = (value) => FACTION_IDENTITIES[value] ?? FACTION_IDENTITIES.Unknown;
export const factionText = (value) => {
  const identity = factionIdentity(value);
  return `${identity.glyph} ${identity.label}`;
};

/** Reusable in HTML and SVG charts; the accessible name is supplied by the
 * surrounding label/button. Shapes stay recognizable with color disabled. */
export const factionBadgeSvg = (value) => {
  const identity = factionIdentity(value);
  return `<svg class="faction-symbol" data-faction="${identity.label}" data-shape="${identity.shape}" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false" style="--faction-color:${identity.color}"><path d="${identity.path}"${identity.shape.startsWith('hollow') ? ' class="hollow"' : ''}></path></svg>`;
};

export const factionBadgeHtml = (value, { label = true } = {}) => {
  const identity = factionIdentity(value);
  return `<span class="faction-identity"${label ? '' : ' aria-hidden="true"'} style="--faction-color:${identity.color}">${factionBadgeSvg(value)}${label ? `<span>${identity.label}</span>` : ''}</span>`;
};
