import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Objective strip shipped full-bleed in PR #105 because .learning-panel was
// the only top-level block without a centered max-width, and nothing caught it:
// the 18 Playwright checks cannot run from a clean checkout. This locks the
// coupling in the one automated layer that exists, so restyling either rule
// fails here instead of in a screenshot.
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `styles.css must define a base rule for ${selector}`);
  return match[1];
};

test('teaching panels share the game grid centered horizontal geometry', () => {
  const grid = rule('#game-root');
  const panels = rule('.learning-panel');
  const maxWidth = /max-width:\s*([^;]+);/.exec(grid)?.[1]?.trim();
  assert.ok(maxWidth, '#game-root must declare a max-width');
  // #game-root pads its content by 1.4rem per side, so the panels subtract
  // twice that to land their borders on the journal and console edges.
  assert.match(panels, new RegExp(`width:\\s*min\\(100% - 2\\.8rem, ${maxWidth} - 2\\.8rem\\)`),
    'the panels must derive their width from the same centered box as the game grid');
  assert.match(panels, /margin:[^;]*auto/, 'the panels must center instead of running to the window edge');
});

test('the narrow-screen override keeps the panels centered', () => {
  const narrow = css.match(/@media \(max-width: 700px\) \{ \.learning-panel \{([^}]*)\}/)?.[1];
  assert.ok(narrow, 'the 700px override for .learning-panel must exist');
  assert.match(narrow, /margin:[^;]*auto/);
});

// The desktop console used to size itself from the viewport alone —
// `height: calc(100dvh - 6.2rem)` — which silently assumed the topbar is 6.2rem
// tall and is the only block above the grid. The Objective strip every
// Reimagined war shows (#command-priorities, unhidden by renderGame) is a second
// in-flow block, and it pushed the whole console 119px below the fold: 1114px of
// page at 1600x1000 while the check's scroll budget allowed 1000. The layout now
// takes the space left above it instead; this locks that coupling so restyling
// either rule fails here rather than in a screenshot.
test('the desktop console fills the space left above it, not a hardcoded topbar height', () => {
  const desktop = css.match(/@media \(min-width: 1101px\) and \(min-height: 620px\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(desktop, 'the desktop layout media query must exist');
  assert.doesNotMatch(desktop, /#game-root \{[^}]*height:\s*calc\(/,
    '#game-root must not derive its height from the viewport; it must take the space left above it');
  assert.match(desktop, /body \{[^}]*display: flex;[^}]*flex-direction: column/,
    'the page must stack its blocks in a column so the grid can take the remainder');
  assert.match(desktop, /#game-root \{[^}]*flex:\s*1 1 0/,
    '#game-root must grow into the space the topbar and any panel above it leave');
  assert.match(desktop, /\.topbar, \.campaign-bar, #game-root, #sector-root \{ width: 100%; \}/,
    'a flex item with an auto cross-axis margin is not stretched, so the centered blocks keep their width explicitly');
  assert.match(desktop, /#game-root:has\(#terrain-toggle:not\(\[hidden\]\)\) \{ min-height: 760px; \}/,
    'the deliberate isotropic minimum must still beat the fill on short desktops');
});

test('the teaching modes keep the grid content-sized instead of filling the viewport', () => {
  for (const mode of ['practicing', 'learning']) {
    const body = css.match(new RegExp(`body\\.${mode} #game-root \\{([^}]*)\\}`))?.[1];
    assert.ok(body, `body.${mode} #game-root must exist`);
    assert.match(body, /flex:\s*0 0 auto/, `body.${mode} #game-root must opt out of filling the viewport`);
  }
});
