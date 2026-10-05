import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTION_IDENTITIES, factionIdentity, factionText, factionBadgeHtml } from '../ui/faction-identity.js';

test('belligerents have distinct shapes, names, and the existing canonical color variables', () => {
  const identities = ['Federation', 'Axis', 'Bloc', 'Cabal'].map(factionIdentity);
  assert.equal(new Set(identities.map((identity) => identity.path)).size, 4);
  assert.deepEqual(identities.map((identity) => identity.color), ['var(--fed)', 'var(--axis)', 'var(--bloc)', 'var(--cabal)']);
  assert.deepEqual(identities.map((identity) => identity.shape), ['square', 'triangle', 'diamond', 'circle']);
  for (const identity of identities) {
    assert.ok(Object.isFrozen(identity));
    assert.ok(factionText(identity.label).endsWith(identity.label));
    assert.match(factionBadgeHtml(identity.label), new RegExp(`data-shape="${identity.shape}"`));
  }
  assert.ok(Object.isFrozen(FACTION_IDENTITIES));
});

test('neutral and ownerless identities remain distinct from an unknown snapshot', () => {
  assert.equal(factionIdentity('Neutral').shape, 'hollow-circle');
  assert.match(factionBadgeHtml('Neutral'), /class="hollow"/);
  assert.equal(factionIdentity('Unowned').label, 'Unowned');
  assert.equal(factionIdentity(undefined).label, 'Unknown');
  assert.equal(factionIdentity('<unsafe>').label, 'Unknown');
  assert.doesNotMatch(factionBadgeHtml('<unsafe>'), /<unsafe>/);
});

test('decorative map badges defer accessible names to their enclosing marker', () => {
  assert.match(factionBadgeHtml('Axis', { label: false }), /^<span class="faction-identity" aria-hidden="true"/);
  assert.doesNotMatch(factionBadgeHtml('Axis', { label: false }), /<span>Axis/);
  assert.match(factionBadgeHtml('Axis'), /<span>Axis<\/span>/);
});
