// Presentation only. Callers supply mapper-visible contacts, never hidden hulls.
// Use projected centers (including existing stack offsets), not world distance:
// zooming separates contacts while their artwork stays a fixed screen size.
export const compactContactIds = (entries, win, rect, { mode = 'adaptive', offsets = new Map(), previous = new Set() } = {}) => {
  const compact = new Set();
  if (mode === 'full' || !rect?.width || !rect?.height) return compact;
  const points = entries.map((entry) => ({
    id: entry.id,
    x: (entry.x - win.minX) / win.width * rect.width + (offsets.get(entry.id)?.dx ?? 0),
    y: (entry.y - win.minY) / win.height * rect.height + (offsets.get(entry.id)?.dy ?? 0),
  })).filter((p) => p.x >= -48 && p.y >= -48 && p.x <= rect.width + 48 && p.y <= rect.height + 48);
  if (mode === 'compact') return new Set(points.map((p) => p.id));
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const a = points[i], b = points[j];
    // Hysteresis prevents toggling every frame as ships skim the cutoff.
    const threshold = previous.has(a.id) || previous.has(b.id) ? 84 : 72;
    if (Math.hypot(a.x - b.x, a.y - b.y) < threshold) { compact.add(a.id); compact.add(b.id); }
  }
  return compact;
};

export const previousCompactContacts = (root) => new Set(
  [...(root?.querySelectorAll?.('.compact-contact[data-ship-id]') ?? [])].map((el) => el.dataset.shipId),
);

// Both live interpolation and turn playback call this with their drawn positions.
export const paintContactDensity = (entries, win, rect, options) => {
  const previous = new Set(entries.filter(({ el }) => el.classList.contains('compact-contact')).map(({ id }) => id));
  const compact = compactContactIds(entries, win, rect, { ...options, previous });
  for (const { el, id } of entries) el.classList.toggle('compact-contact', compact.has(id));
};
