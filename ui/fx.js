import { GRID_SIZE } from '../game/constants.js';
import { isTerminalEvent } from './battle-events.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TERMINAL_EFFECT_MS = 2500;

/** The whole field, as a camera window — what a classic war always draws into. */
const FULL_FIELD = { minX: 0, minY: 0, size: GRID_SIZE };

const layer = (map, win = FULL_FIELD) => {
  let el = map.querySelector('svg.fx-layer');
  if (!el) {
    el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('class', 'fx-layer');
    el.setAttribute('preserveAspectRatio', 'none');
    map.appendChild(el);
  }
  // FX are drawn in world units, so the layer's viewBox is the camera window: beams,
  // trails, and bursts land on their hulls whether the view shows the whole field or
  // is zoomed into one corner of a wide Reimagined war.
  el.setAttribute('viewBox', `${win.minX} ${win.minY} ${win.size} ${win.size}`);
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
  // Ion/EMP (round 22a) draws as its own arc-colored beam; phasers keep theirs.
  const beam = e.kind === 'ion' ? 'fx-ion' : 'fx-phaser';
  line.setAttribute('class', `${beam}${e.focus ? ' focused' : ''}${e.hit ? '' : ' miss'}`);
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(line);
  setTimeout(() => line.remove(), 420);
  if (e.hit) drawImpact(svg, to);
};

/** A short ring where a phaser landed, so hits read as impacts and not just lines. */
const drawImpact = (svg, at) => {
  const flash = document.createElementNS(SVG_NS, 'circle');
  flash.setAttribute('cx', at.x);
  flash.setAttribute('cy', at.y);
  flash.setAttribute('class', 'fx-impact');
  svg.appendChild(flash);
  setTimeout(() => flash.remove(), 340);
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

const drawTerminal = (svg, event) => {
  const marker = document.createElementNS(SVG_NS, event.kind === 'destruction' ? 'circle' : 'g');
  marker.setAttribute('class', `fx-terminal-${event.kind}${event.faction ? ` ${event.faction}` : ''}`);
  if (event.kind === 'destruction') {
    marker.setAttribute('cx', event.x);
    marker.setAttribute('cy', event.y);
    marker.setAttribute('r', 1);
    marker.setAttribute('vector-effect', 'non-scaling-stroke');
  } else {
    const halo = document.createElementNS(SVG_NS, 'circle');
    halo.setAttribute('cx', event.x);
    halo.setAttribute('cy', event.y);
    halo.setAttribute('r', 3);
    halo.setAttribute('vector-effect', 'non-scaling-stroke');
    const flag = document.createElementNS(SVG_NS, 'path');
    flag.setAttribute('d', `M ${event.x} ${event.y + 3} V ${event.y - 3} L ${event.x + 3} ${event.y - 2} L ${event.x} ${event.y - 1}`);
    flag.setAttribute('vector-effect', 'non-scaling-stroke');
    marker.appendChild(halo);
    marker.appendChild(flag);
  }
  svg.appendChild(marker);
  setTimeout(() => marker.remove(), TERMINAL_EFFECT_MS);
};

const draw = (svg, e) => {
  if (e.kind === 'phasers' || e.kind === 'ion') drawBeam(svg, e);
  else if (e.kind === 'photons') drawTorpedo(svg, e);
  else if (e.kind === 'explosion') drawExplosion(svg, e);
  else if (isTerminalEvent(e)) drawTerminal(svg, e);
};

/** Draws beams/torpedoes/explosions for shots involving the command ship. */
export const playEffects = (events, map, playerId, win = FULL_FIELD) => {
  if (!map || !events?.length) return;
  const relevant = events.filter((e) => isTerminalEvent(e) || e.fromId === playerId || e.toId === playerId);
  if (!relevant.length) return;
  const svg = layer(map, win);
  relevant.forEach((e, i) => {
    if (isTerminalEvent(e)) draw(svg, e);
    else setTimeout(() => draw(svg, e), i * 160);
  });
};

/**
 * A fading dashed line from where a hull was to where it is now, so a repositioning
 * stays legible after the ship has finished gliding.
 */
export const drawMove = (map, from, to, win = FULL_FIELD) => {
  if (!map) return;
  const svg = layer(map, win);
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', from.x);
  line.setAttribute('y1', from.y);
  line.setAttribute('x2', to.x);
  line.setAttribute('y2', to.y);
  line.setAttribute('class', 'fx-move');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(line);
  setTimeout(() => line.remove(), 900);
};

/**
 * Replays a whole round: every ship's volleys, not only the ones that touched you,
 * paced slowly enough to follow. Returns how long the replay runs, in milliseconds.
 */
export const replayEffects = (events, map, stepMs = 420, win = FULL_FIELD) => {
  if (!map || !events?.length) return 0;
  const svg = layer(map, win);
  svg.innerHTML = '';
  events.forEach((e, i) => setTimeout(() => draw(svg, e), i * stepMs));
  return events.length * stepMs;
};
