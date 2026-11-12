import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The stack tether is the dotted leader from a fanned-out hull back to its true
// position. Its width is compensated for the 1.22x enlargement a hull gets on
// hover or keyboard focus, so the compensation is only correct while that
// enlargement actually happens. A crowded hull is deliberately NOT enlarged —
// a bigger marker would only cover its neighbours — and that exception once
// shorted the tether by 18% with no test to catch it. This parses the stylesheet
// so the pairing cannot drift apart again without a browser.
const css = readFileSync(join(import.meta.dirname, '..', 'styles.css'), 'utf8');

const ruleFor = (selector) => {
  const index = css.indexOf(selector);
  assert.ok(index >= 0, `stylesheet has a rule for ${selector}`);
  const body = css.slice(css.indexOf('{', index) + 1, css.indexOf('}', index));
  return body.replace(/\s+/g, ' ').trim();
};

const transformOf = (selector) => {
  const match = ruleFor(selector).match(/transform:[^;]+;/);
  assert.ok(match, `${selector} sets a transform`);
  return match[0];
};

const tetherWidthOf = (selector) => {
  const match = ruleFor(selector).match(/width:[^;]+;/);
  assert.ok(match, `${selector} sets a tether width`);
  return match[0];
};

test('a hovered or focused hull is enlarged, and its tether is shortened to match', () => {
  const scale = transformOf('.ship:hover, .ship:focus-visible {');
  assert.match(scale, /1\.22/, 'the generic hover/focus rule enlarges the hull by 1.22');
  const width = tetherWidthOf('.ship:hover .stack-tether, .ship:focus-visible .stack-tether {');
  assert.match(width, /\/\s*1\.22/, 'the generic tether is divided by the same 1.22');
});

test('a crowded hull is not enlarged, and its tether is not shortened either', () => {
  const selector = '.ship.compact-contact:hover, .ship.compact-contact:focus-visible {';
  const scale = transformOf(selector);
  assert.doesNotMatch(scale, /1\.22/, 'a compact contact keeps its unscaled size on hover and focus');

  // This is the rule whose absence let the tether fall 18% short of the hull.
  const counterpart = '.ship.compact-contact:hover .stack-tether, .ship.compact-contact:focus-visible .stack-tether {';
  const width = tetherWidthOf(counterpart);
  assert.doesNotMatch(width, /\/\s*1\.22/, 'the compact-contact tether is not divided by a scale that is never applied');
  assert.match(width, /hypot\(/, 'it still spans the actual fan offset');

  // The counterpart has to outrank the generic rule or it does nothing.
  const specificity = (text) => (text.split('{')[0].match(/\.[a-z-]+|:hover|:focus-visible/g) ?? []).length;
  assert.ok(specificity(counterpart) > specificity('.ship:hover .stack-tether, .ship:focus-visible .stack-tether {'),
    'the compact-contact tether rule outranks the generic one');
});

test('every tether-shortening rule has a matching scale, and vice versa', () => {
  // Guard the invariant in both directions: a rule that divides the tether by a
  // factor must belong to a hover/focus state that scales by the same factor.
  const shortened = [...css.matchAll(/([^{}]+)\{[^}]*width:[^}]*\/\s*1\.22[^}]*\}/g)]
    .map((match) => match[1].trim());
  assert.ok(shortened.length >= 1, 'the generic compensation rule is present');
  for (const selector of shortened) {
    assert.match(selector, /\.stack-tether/, `${selector} shortens a tether`);
    assert.doesNotMatch(selector, /compact-contact/,
      'a compact contact must never shorten its tether, because it is never enlarged');
  }
});
