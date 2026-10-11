import { GRID_SIZE, REALTIME, SPREAD } from '../game/constants.js';
import { isTerminalEvent } from './battle-events.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TERMINAL_EFFECT_MS = 2500;

/** The whole field, as a camera window — what a classic war always draws into. */
const FULL_FIELD = { minX: 0, minY: 0, size: GRID_SIZE };

export const updateEffectsCamera = (map, win) => {
  map?.querySelector?.('svg.fx-layer')?.setAttribute('viewBox', `${win.minX} ${win.minY} ${win.width ?? win.size} ${win.height ?? win.size}`);
};

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
  el.setAttribute('viewBox', `${win.minX} ${win.minY} ${win.width ?? win.size} ${win.height ?? win.size}`);
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

/**
 * Beam anchors belong to the displayed hull, including its glide/interpolation
 * and stack offset. Event coordinates remain the fallback for off-screen or
 * missing hulls; never change the event itself or the combat calculation.
 * preserveAspectRatio="none" makes this screen-to-SVG mapping exact even on
 * a rectangular map, while the live SVG box also accounts for camera/shake.
 */
const displayedPoint = (map, svg, id, fallback) => {
  const hull = [...(map?.querySelectorAll?.('.ship[data-ship-id], .wreck[data-ship-id]') ?? [])]
    .find((el) => el.dataset.shipId === id);
  const rect = hull?.getBoundingClientRect?.();
  const box = svg.getBoundingClientRect?.();
  if (!rect?.width || !rect.height || !box?.width || !box.height) return fallback;
  const [x, y, width, height] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  return {
    x: x + ((rect.left + rect.width / 2 - box.left) / box.width) * width,
    y: y + ((rect.top + rect.height / 2 - box.top) / box.height) * height,
  };
};

const drawBeam = (svg, e, map) => {
  if (e.historical) {
    const [, , width, height] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    const box = svg.getBoundingClientRect?.();
    const sx = width / (box?.width || 800);
    const sy = height / (box?.height || 800);
    for (const [x, y, name, role] of [[e.x1, e.y1, e.actorName ?? 'Shooter', 'origin'], [e.x2, e.y2, e.targetName ?? 'Target', e.hit ? 'target' : 'aim']]) {
    const marker = document.createElementNS(SVG_NS, 'ellipse');
    marker.setAttribute('class', 'fx-historical-position');
    marker.setAttribute('cx', x);
    marker.setAttribute('cy', y);
    marker.setAttribute('rx', 4 * sx);
    marker.setAttribute('ry', 4 * sy);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'fx-historical-label');
    label.setAttribute('x', 6);
    label.setAttribute('y', -5);
    label.setAttribute('transform', `translate(${x} ${y}) scale(${sx} ${sy})`);
    label.setAttribute('font-size', 12);
    label.textContent = `${name} · recorded ${role}`;
    svg.appendChild(marker);
    svg.appendChild(label);
    setTimeout(() => { marker.remove(); label.remove(); }, 420);
    }
  }
  const line = document.createElementNS(SVG_NS, 'line');
  // Ion/EMP (round 22a) draws as its own arc-colored beam; phasers keep theirs.
  const beam = e.kind === 'ion' ? 'fx-ion' : 'fx-phaser';
  line.setAttribute('class', `${beam}${e.focus ? ' focused' : ''}${e.hit ? '' : ' miss'}`);
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(line);
  setTimeout(() => line.remove(), 420);
  const flash = e.hit ? drawImpact(svg, { x: e.x2, y: e.y2 }) : null;
  const started = performance.now();
  const anchor = () => {
    const from = e.historical ? { x: e.x1, y: e.y1 } : displayedPoint(map, svg, e.fromId, { x: e.x1, y: e.y1 });
    const target = e.historical ? { x: e.x2, y: e.y2 } : displayedPoint(map, svg, e.toId, { x: e.x2, y: e.y2 });
    const to = endpoint({ ...e, x1: from.x, y1: from.y, x2: target.x, y2: target.y });
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y);
    line.setAttribute('x2', to.x);
    line.setAttribute('y2', to.y);
    if (flash) {
      flash.setAttribute('cx', to.x);
      flash.setAttribute('cy', to.y);
    }
    if (line.isConnected !== false && performance.now() - started < 420
      && typeof requestAnimationFrame === 'function') requestAnimationFrame(anchor);
  };
  anchor();
};

/** A short ring where a phaser landed, so hits read as impacts and not just lines. */
const drawImpact = (svg, at) => {
  const flash = document.createElementNS(SVG_NS, 'circle');
  flash.setAttribute('cx', at.x);
  flash.setAttribute('cy', at.y);
  flash.setAttribute('class', 'fx-impact');
  svg.appendChild(flash);
  setTimeout(() => flash.remove(), 340);
  return flash;
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

/** The splash ring a spread salvo draws at its impact, sized to the real radius. */
const drawSplash = (svg, at) => {
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', at.x);
  ring.setAttribute('cy', at.y);
  ring.setAttribute('r', SPREAD.splashRadius);
  ring.setAttribute('class', 'fx-splash');
  ring.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(ring);
  setTimeout(() => ring.remove(), 500);
};

/**
 * Spread torpedoes (round 22c): a torpedo run to the impact, then — on a hit — an
 * expanding splash ring showing the area the salvo caught (the primary plus every
 * hull inside `SPREAD.splashRadius`).
 */
const drawSpread = (svg, e) => {
  const to = endpoint(e);
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('r', 0.9);
  dot.setAttribute('class', 'fx-spread');
  svg.appendChild(dot);
  const start = performance.now();
  const duration = 300;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    dot.setAttribute('cx', e.x1 + (to.x - e.x1) * t);
    dot.setAttribute('cy', e.y1 + (to.y - e.y1) * t);
    if (t < 1) requestAnimationFrame(tick);
    else {
      dot.remove();
      if (e.hit) {
        drawSplash(svg, to);
        drawExplosion(svg, { ...e, x2: to.x, y2: to.y }, true);
      }
    }
  };
  requestAnimationFrame(tick);
};

const drawTerminal = (svg, event) => {
  const marker = document.createElementNS(SVG_NS, event.kind === 'destruction' ? 'circle' : 'g');
  marker.setAttribute('class', `fx-terminal-${event.kind}${event.faction ? ` ${event.faction}` : ''}`);
  marker.style?.setProperty('--terminal-duration', `${event.presentationDuration ?? TERMINAL_EFFECT_MS}ms`);
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
  setTimeout(() => marker.remove(), event.presentationDuration ?? TERMINAL_EFFECT_MS);
};

const draw = (svg, e, map) => {
  if (e.kind === 'phasers' || e.kind === 'ion') drawBeam(svg, e, map);
  else if (e.kind === 'photons') drawTorpedo(svg, e);
  else if (e.kind === 'spread') drawSpread(svg, e);
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
    if (isTerminalEvent(e)) draw(svg, e, map);
    else setTimeout(() => draw(svg, e, map), i * 160);
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
 * Round 32: a real-time round's events carry `simTime` stamps, and a stamped
 * timeline replays on the war clock — the gaps between volleys are the real
 * gaps (clamped to stay watchable). Unstamped events keep the fixed step.
 */
export const replayEffects = (events, map, stepMs = 420, win = FULL_FIELD) => {
  if (!map || !events?.length) return 0;
  const svg = layer(map, win);
  svg.innerHTML = '';
  if (!events.every((e) => e.simTime != null)) {
    events.forEach((e, i) => setTimeout(() => draw(svg, e, map), i * stepMs));
    return events.length * stepMs;
  }
  let at = 0;
  events.forEach((e, i) => {
    if (i > 0) {
      at += Math.max(60, Math.min(2400, (e.simTime - events[i - 1].simTime) * REALTIME.msPerStardate));
    }
    const fire = at;
    setTimeout(() => draw(svg, e, map), fire);
  });
  return at + stepMs;
};
