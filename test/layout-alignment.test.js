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
