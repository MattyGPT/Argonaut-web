const SVG_NS = 'http://www.w3.org/2000/svg';

const layer = (map) => {
  let el = map.querySelector('svg.fx-layer');
  if (!el) {
    el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('class', 'fx-layer');
    el.setAttribute('viewBox', '0 0 100 100');
    el.setAttribute('preserveAspectRatio', 'none');
    map.appendChild(el);
  }
  return el;
};

const endpoint = (e) => {
  if (e.hit) return { x: e.x2, y: e.y2 };
  const dx = e.x2 - e.x1;
  const dy = e.y2 - e.y1;
  const len = Math.hypot(dx, dy) || 1;
  const off = 4;
  return { x: e.x2 + (-dy / len) * off, y: e.y2 + (dx / len) * off };
};

const drawBeam = (svg, e) => {
  const to = endpoint(e);
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', e.x1);
  line.setAttribute('y1', e.y1);
  line.setAttribute('x2', to.x);
  line.setAttribute('y2', to.y);
  line.setAttribute('class', `fx-phaser${e.hit ? '' : ' miss'}`);
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(line);
  setTimeout(() => line.remove(), 420);
};

const drawTorpedo = (svg, e) => {
  const to = endpoint(e);
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('r', 0.9);
  dot.setAttribute('class', 'fx-photon');
  svg.appendChild(dot);
  const start = performance.now();
  const duration = 320;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    dot.setAttribute('cx', e.x1 + (to.x - e.x1) * t);
    dot.setAttribute('cy', e.y1 + (to.y - e.y1) * t);
    if (t < 1) requestAnimationFrame(tick);
    else {
      dot.remove();
      if (e.hit) drawExplosion(svg, { ...e, x2: to.x, y2: to.y }, true);
    }
  };
  requestAnimationFrame(tick);
};

const drawExplosion = (svg, e, small = false) => {
  const boom = document.createElementNS(SVG_NS, 'circle');
  boom.setAttribute('cx', e.x2);
  boom.setAttribute('cy', e.y2);
  boom.setAttribute('class', `fx-boom${small ? ' small' : ''}`);
  svg.appendChild(boom);
  setTimeout(() => boom.remove(), 560);
};

/** Draws beams/torpedoes/explosions for shots involving the command ship. */
export const playEffects = (events, map, playerId) => {
  if (!map || !events?.length) return;
  const relevant = events.filter((e) => e.fromId === playerId || e.toId === playerId);
  if (!relevant.length) return;
  const svg = layer(map);
  relevant.forEach((e, i) => setTimeout(() => {
    if (e.kind === 'phasers') drawBeam(svg, e);
    else if (e.kind === 'photons') drawTorpedo(svg, e);
    else if (e.kind === 'explosion') drawExplosion(svg, e);
  }, i * 160));
};
