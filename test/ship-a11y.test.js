import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip, sensorRange } from '../game/state.js';
import { launchDrones } from '../game/actions.js';
import { renderGame } from '../ui/render.js';
import { factionText } from '../ui/faction-identity.js';

// Same bare element stub the other render tests use: render.js only touches the
// document inside renderGame, and the stub never parses HTML, so every assertion
// below reads the emitted markup as a string.
const elements = new Map();
globalThis.document = {
  querySelector: (selector) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '' });
    return elements.get(selector);
  },
};

const read = (selector) => ({ innerHTML: '', textContent: '', ...elements.get(selector) });

/** Two hulls parked inside each other's sensors, on an empty field, so which
 * markers a hull wears never depends on the seed's terrain or starting range. */
const fieldGame = (seed, options = {}) => {
  const game = createGame({ seed, ...options });
  game.terrain = [];
  Object.assign(getShip(game, 'fed-flagship'), { x: 10, y: 10 });
  Object.assign(getShip(game, 'axis-flagship'), { x: 15, y: 10 });
  return game;
};

const renderField = (game, view = {}) => {
  elements.clear();
  renderGame(game, view);
  return read('#map-field').innerHTML;
};

/** The opening tag of whatever node the map drew for one hull — a <button> when
 * the hull is alive, a <span class="wreck"> once it is not. */
const hullNode = (field, id) => field.match(new RegExp(`<(?:button|span)[^>]*data-ship-id="${id}"[^>]*>`))[0];
const hullLabel = (field, id) => hullNode(field, id).match(/ aria-label="([^"]*)"/)[1];
const hullTitle = (field, id) => hullNode(field, id).match(/ title="([^"]*)"/)?.[1] ?? null;
const drawnHullIds = (field) => [...new Set([...field.matchAll(/data-ship-id="([^"]+)"/g)].map((m) => m[1]))];
/** The minimap draws each hull as a dot rather than a control, so it gets its own reader. */
const hullDotLabel = (minimap, id) => minimap
  .match(new RegExp(`<span class="mini-dot[^>]*data-ship-id="${id}"[^>]*>`))[0]
  .match(/ aria-label="([^"]*)"/)[1];

/** Stages one hull wearing every marker the map can put on it at once. */
const everythingGame = (seed) => {
  const game = fieldGame(seed, { reimagined: true });
  const foe = getShip(game, 'axis-flagship');
  Object.assign(foe, {
    x: 14,
    y: 10,
    facing: 137,
    prize: { from: 'Federation', byFaction: 'Axis', turn: 2 },
    encounter: { type: 'distress' },
    tractorBy: 'fed-flagship',
  });
  foe.systems.engines = 0;
  game.orders = { ...(game.orders ?? {}), [foe.id]: { type: 'intercept', targetId: 'fed-flagship' } };
  game.scanned = { ...(game.scanned ?? {}), [foe.id]: true };
  game.stances = { ...(game.stances ?? {}), [foe.id]: 'evasive' };
  return game;
};

test('every hull the map draws is a button with a composed accessible name; a wreck is the one documented exception', () => {
  const game = fieldGame('a11y-role', { reimagined: true });
  Object.assign(getShip(game, 'axis-flagship'), { x: 14, y: 10 });
  // Stage a hulk inside mapper reach so both branches of the marker are exercised.
  const hulk = game.ships.find((ship) => !['fed-flagship', 'axis-flagship'].includes(ship.id));
  Object.assign(hulk, { x: 13, y: 11, status: 'destroyed' });
  const field = renderField(game);
  const ids = drawnHullIds(field);
  assert.ok(ids.includes('fed-flagship') && ids.includes('axis-flagship'), 'the fixture stages a field with hulls on it');
  assert.ok(ids.includes(hulk.id), 'and a wreck beside them');

  let buttons = 0;
  let wrecks = 0;
  for (const id of ids) {
    const ship = getShip(game, id);
    assert.ok(ship, `${id} is drawn from a real hull`);
    const node = hullNode(field, id);
    if (ship.status === 'destroyed') {
      wrecks += 1;
      assert.ok(node.startsWith('<span class="wreck '), 'a hulk is not actionable, so it is not a button');
      assert.match(node, /role="img"/, 'and it still gets an explicit role rather than a bare span');
      assert.ok(node.includes(`aria-label="${ship.name}, ${factionText(ship.faction)}, destroyed wreck"`), node);
      assert.ok(!/Captain|orders|stance|heading/.test(node), 'a hulk reports nothing a wreck cannot know');
      continue;
    }
    buttons += 1;
    assert.ok(node.startsWith('<button class="ship '), `${id} is a real <button>, not a div wearing a click handler`);
    assert.doesNotMatch(node, /role=/, 'a button keeps its native role; an override could only lose the activation semantics');
    assert.doesNotMatch(node, /aria-hidden="true"/, 'a hull you can act on is never hidden from assistive technology');
    assert.doesNotMatch(node, /aria-label=""/, 'no hull is left without an accessible name');
    assert.ok(hullLabel(field, id).startsWith(`${ship.name}, ${ship.faction}, ${ship.status}`),
      `${id}: the name leads with identity and allegiance, got "${hullLabel(field, id)}"`);
  }
  assert.equal((field.match(/<button class="ship /g) ?? []).length, buttons, 'exactly one button per living hull drawn');
  assert.equal(wrecks, 1, 'and one wreck node, not a button in disguise');
});

test('a hull the mapper cannot reach is not drawn at all, so no accessible name is invented for it', () => {
  const game = fieldGame('a11y-unseen', { reimagined: true });
  const unseen = getShip(game, 'axis-flagship');
  Object.assign(unseen, { x: 300, y: 300 });
  // An old scan is not current sight: it must not buy the hull a place on the map.
  game.scanned = { [unseen.id]: true };
  const field = renderField(game, { contextShipId: unseen.id });
  assert.ok(!field.includes(`data-ship-id="${unseen.id}"`), 'no marker for an unseen hull');
  assert.ok(!field.includes(unseen.name), 'and its name reaches no accessible surface in the field');
  assert.ok(!read('#minimap').innerHTML.includes(unseen.name), 'the minimap agrees');
});

test('the accessible name lists identity, then standing, then combat intel, in a fixed order', () => {
  const game = everythingGame('a11y-order');
  const foe = getShip(game, 'axis-flagship');
  const field = renderField(game, { contextShipId: foe.id });
  const label = hullLabel(field, foe.id);

  // Identity triple is the contract: name, allegiance, status, comma separated,
  // leading. Pinned exactly, because a minimal hull gaining an extra field is a
  // change to what every screen-reader user hears first.
  assert.equal(label.indexOf(`${foe.name}, ${foe.faction}, ${foe.status}`), 0, label);

  // The optional tail is pinned by relative order rather than by exact string, so
  // dropping or reordering a field fails while adding a new one does not.
  const ordered = [
    ', selected',
    ', Captain ',
    ', orders ',
    ', prize of war',
    ' stance',
    ' — heading ',
    ' — broadcasting distress',
    ' — held by a tractor beam',
  ];
  let previous = 0;
  for (const part of ordered) {
    const at = label.indexOf(part);
    assert.ok(at >= 0, `"${part}" is present in ${label}`);
    assert.ok(at > previous, `"${part}" still follows everything before it in ${label}`);
    previous = at;
  }

  // Head fields are comma separated; the combat-intel tail switches to em dashes.
  assert.ok(label.includes(', Captain '), 'the captain joins the comma-separated head');
  assert.ok(label.includes(' — evasive stance — heading 137°'), 'the tail is em-dash separated');

  // The floor: a hull with nothing to report says exactly three things. A Classic
  // hull is the fixture, because stance, heading and captaincy are all Reimagined
  // facts, so nothing optional can be lurking.
  const plain = createGame({ seed: 'a11y-minimal' });
  const plainField = renderField(plain);
  const plainId = drawnHullIds(plainField).find((id) => id !== plain.playerShipId);
  const plainShip = getShip(plain, plainId);
  assert.equal(hullLabel(plainField, plainId), `${plainShip.name}, ${plainShip.faction}, ${plainShip.status}`,
    'a hull with nothing to report adds nothing');
});

test('the tooltip may be surrendered to the sensor card, but the accessible name never is', () => {
  const game = fieldGame('a11y-title-split', { reimagined: true });
  const actor = getShip(game, 'fed-flagship');
  const foe = getShip(game, 'axis-flagship');

  // Inside scanner reach and unselected, the card covers the hull, so the native
  // tooltip is dropped to keep two readouts from landing on top of each other.
  const covered = renderField(game, { hoverShipId: foe.id });
  assert.equal(hullTitle(covered, foe.id), null, 'the card replaces the tooltip');
  assert.ok(hullLabel(covered, foe.id).startsWith(`${foe.name}, ${foe.faction}, ${foe.status}`),
    'and the accessible name survives losing the tooltip — it is not derived from title');

  // Your own hull is never a card target, so it keeps both surfaces.
  assert.ok(hullTitle(covered, actor.id), 'the command ship keeps its tooltip');
  const ownLabel = hullLabel(covered, actor.id);
  const ownTitle = hullTitle(covered, actor.id);
  assert.ok(ownTitle.startsWith(`${actor.name}: ${actor.status} · ${factionText(actor.faction)}`), ownTitle);
  assert.ok(!ownLabel.includes(factionText(actor.faction)),
    'the tooltip carries the faction glyph, the accessible name carries the bare word');
  assert.ok(ownLabel.startsWith(`${actor.name}, ${actor.faction}, `), ownLabel);

  // Beyond scanner reach but still on the mapper, the tooltip comes back.
  Object.assign(foe, { x: actor.x + sensorRange(game, actor, 'scanner') + 1, y: actor.y });
  const reached = renderField(game);
  assert.ok(hullTitle(reached, foe.id), 'a contact the card cannot cover keeps the native tooltip');
  assert.ok(hullLabel(reached, foe.id).startsWith(`${foe.name}, `), 'and still has its accessible name');

  // Selecting a hull suppresses the card, which hands the tooltip back.
  const selected = renderField(fieldGame('a11y-title-split', { reimagined: true }), { contextShipId: 'axis-flagship' });
  assert.ok(hullTitle(selected, 'axis-flagship'), 'the selected hull is not a card target, so its tooltip returns');

  // A paused battle disables the button; disabling must not silence it.
  const paused = renderField(fieldGame('a11y-title-split', { reimagined: true }), { battlePaused: true });
  for (const id of drawnHullIds(paused)) {
    const node = hullNode(paused, id);
    if (!node.startsWith('<button')) continue;
    assert.match(node, / disabled>/, `${id} is inert while a resolution owns the field`);
    assert.ok(hullLabel(paused, id).length > 0, `${id} is still named while disabled`);
  }
});

test('every decorative marker inside a hull button is hidden from assistive technology', () => {
  const game = everythingGame('a11y-hidden');
  const foe = getShip(game, 'axis-flagship');
  const field = renderField(game, { contextShipId: foe.id, shipArt: 'sprites' });
  const button = field.match(new RegExp(`<button[^>]*data-ship-id="${foe.id}"[\\s\\S]*?</button>`))[0];
  const inner = button.slice(button.indexOf('>') + 1, button.lastIndexOf('</button>'));

  // The button's aria-label wins over its contents, so this is belt and braces:
  // if the label is ever dropped, nothing decorative should be left to be read.
  // The one exception is the letter glyph, which is the hull's initial and is the
  // only text a fallback accessible name could honestly use.
  const offenders = [...inner.matchAll(/<(?:span|img|svg)[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => !tag.includes('class="glyph"') && !tag.includes('aria-hidden="true"'));
  assert.deepEqual(offenders, [], 'every pip, badge, needle and sprite is aria-hidden');

  assert.match(inner, /class="faction-identity" aria-hidden="true"/,
    'the badge inside a hull is decorative: the accessible name already says the allegiance');
  assert.match(inner, /<img class="sprite"[^>]*alt=""[^>]*aria-hidden="true"/,
    'the sprite is both alt-less and aria-hidden, so it is not announced twice');
  assert.match(inner, /class="prize-pip" aria-hidden="true"/);
  assert.match(inner, /class="distress-pip" aria-hidden="true"/);
  assert.match(inner, /class="tractor-pip" aria-hidden="true"/);
  assert.match(inner, /class="heading-glyph"[^>]*aria-hidden="true"/, 'the needle is drawn, the heading is spoken');
});

test('selection and command are separate facts in the accessible name, and neither reaches the tooltip', () => {
  const game = fieldGame('a11y-selected', { reimagined: true });
  const actor = getShip(game, 'fed-flagship');
  const foe = getShip(game, 'axis-flagship');

  const idle = renderField(game);
  assert.ok(hullLabel(idle, actor.id).includes(', command ship'), 'your hull is always named as the command ship');
  assert.ok(!hullLabel(idle, actor.id).includes('selected'), 'and is not "selected" until you select it');
  assert.ok(!hullLabel(idle, foe.id).includes(', command ship'), 'an enemy is never your command ship');
  assert.ok(!hullLabel(idle, foe.id).includes('selected'));

  const picked = renderField(game, { contextShipId: foe.id });
  assert.ok(hullLabel(picked, foe.id).includes(', selected'), 'selection is spoken');
  assert.ok(!hullLabel(picked, foe.id).includes(', command ship'), 'selecting an enemy does not make it yours');
  assert.ok(!hullLabel(picked, actor.id).includes(', selected'), 'selection moved off your hull');
  assert.ok(hullLabel(picked, actor.id).includes(', command ship'), 'command did not move');

  // Your own hull can carry both, and the order is fixed: selected then command.
  const both = renderField(game, { contextShipId: actor.id });
  assert.ok(hullLabel(both, actor.id).includes(', selected, command ship'), hullLabel(both, actor.id));

  // Neither fact is a property of the hull, so neither belongs in the tooltip.
  for (const [field, id] of [[picked, foe.id], [both, actor.id]]) {
    const title = hullTitle(field, id);
    assert.ok(title, 'the selected hull keeps its tooltip');
    assert.ok(!title.includes('selected') && !title.includes('command ship'),
      `the tooltip describes the hull, not the cursor: ${title}`);
  }
});

test('a hull you have not identified keeps its captain out of every accessible name', () => {
  const game = fieldGame('a11y-captain', { reimagined: true });
  const foe = getShip(game, 'axis-flagship');
  Object.assign(foe, { x: 14, y: 10, kills: 5 });

  const unscanned = renderField(game);
  assert.ok(!hullLabel(unscanned, foe.id).includes('Captain'),
    'who captains an unscanned hull is intelligence, not map furniture');
  assert.ok(!hullNode(unscanned, foe.id).includes(' ace'), 'and the ace star is earned the same way');
  assert.ok(hullLabel(unscanned, foe.id).startsWith(`${foe.name}, ${foe.faction}, ${foe.status}`),
    'what you can see is still said plainly');

  game.scanned = { [foe.id]: true };
  const identified = renderField(game);
  assert.ok(hullLabel(identified, foe.id).includes(`, Captain ${foe.captain}`),
    'the sweep earns the name in the accessible name too, not only in the card');
  assert.match(hullNode(identified, foe.id), / ace/, 'and the ace marker follows the identification');

  // The gate is Reimagined-only, matching the sensor card's own rule.
  const classic = fieldGame('a11y-captain-classic');
  const classicFoe = getShip(classic, 'axis-flagship');
  classic.scanned = { [classicFoe.id]: true };
  assert.ok(!hullLabel(renderField(classic), classicFoe.id).includes('Captain'),
    'a classic war never names a captain on the map, scanned or not');

  // A hulk cannot be scanned, so it never reports who was aboard.
  const wrecked = fieldGame('a11y-captain-wreck', { reimagined: true });
  Object.assign(getShip(wrecked, 'axis-flagship'), { x: 14, y: 10, status: 'destroyed' });
  wrecked.scanned = { 'axis-flagship': true };
  const hulk = renderField(wrecked);
  assert.ok(hullNode(hulk, 'axis-flagship').startsWith('<span class="wreck '));
  assert.ok(!hullLabel(hulk, 'axis-flagship').includes('Captain'), 'the dead are named in the journal, not on the map');
});

test('a held hull says it is held without naming a holder the sensors cannot see', () => {
  const game = fieldGame('a11y-held', { reimagined: true });
  const foe = getShip(game, 'axis-flagship');
  const holder = getShip(game, 'bloc-flagship');
  Object.assign(foe, { x: 12, y: 10, tractorBy: holder.id });
  Object.assign(holder, { x: 300, y: 300 });

  const field = renderField(game);
  const label = hullLabel(field, foe.id);
  assert.ok(label.includes(' — held by a tractor beam'), label);
  assert.ok(!label.includes(holder.name), 'the holder is unseen, so its name stays out of the accessible name');
  assert.ok(!field.includes(`data-ship-id="${holder.id}"`), 'the holder is not drawn either');
  assert.match(field, /class="tractor-lock"/, 'the beam itself is physical, so the lock line is still drawn');
});

test('a drone is named as its carrier\'s wing and never as a crewed hull', () => {
  const staged = fieldGame('a11y-drone', { reimagined: true });
  Object.assign(getShip(staged, 'fed-flagship'), { x: 100, y: 100 });
  Object.assign(getShip(staged, 'fed-carrier'), { x: 104, y: 100 });
  const game = launchDrones(staged, getShip(staged, 'fed-carrier')).game;
  const wing = game.ships.find((ship) => ship.droneOf);
  game.scanned = { ...(game.scanned ?? {}), [wing.id]: true };

  const field = renderField(game);
  const carrier = getShip(game, wing.droneOf);
  assert.equal(hullLabel(field, wing.id), `${wing.name}, ${wing.faction}, ${wing.status}`,
    'the wing is named after its carrier and reports nothing a drone cannot know');
  assert.ok(wing.name.startsWith(`${carrier.name} D`), wing.name);
  assert.match(hullNode(field, wing.id), / drone/, 'the marker still says drone visually');
  assert.ok(!hullLabel(field, wing.id).includes('Captain'),
    'a scanned drone is unmanned: the card gates the captain on !isDrone and the map must not fabricate a crew');
});

test('the minimap names each hull too, as an image rather than a control', () => {
  const game = fieldGame('a11y-minimap', { reimagined: true });
  Object.assign(getShip(game, 'axis-flagship'), { x: 12, y: 10, status: 'destroyed' });
  elements.clear();
  renderGame(game, { contextShipId: 'fed-flagship' });
  const minimap = read('#minimap').innerHTML;
  const actor = getShip(game, 'fed-flagship');
  const dot = minimap.match(/<span class="mini-dot[^>]*data-ship-id="fed-flagship"[\s\S]*?<\/span>/)[0];

  assert.match(dot, /role="img"/, 'a minimap dot is read, not activated');
  assert.doesNotMatch(dot, /<button/);
  assert.ok(dot.includes(`aria-label="${actor.name}, ${factionText(actor.faction)}, ${actor.status}, command ship, selected"`), dot);

  const hulk = minimap.match(/<span class="mini-dot[^>]*data-ship-id="axis-flagship"[\s\S]*?<\/span>/)[0];
  const wreck = getShip(game, 'axis-flagship');
  assert.ok(hulk.includes(`aria-label="${wreck.name}, ${factionText(wreck.faction)}, destroyed"`), hulk);
  assert.match(hulk, /class="mini-wreck" aria-hidden="true"/, 'the × is decorative; the label already says destroyed');

  // Every dot the minimap draws is named, and no dot is hidden from the tree.
  for (const each of minimap.matchAll(/<span class="mini-dot[^>]*data-ship-id="([^"]+)"[^>]*>/g)) {
    assert.match(each[0], /role="img" aria-label="[^"]+"/, `${each[1]} is named`);
    assert.doesNotMatch(each[0], /aria-hidden="true"/, `${each[1]} is not hidden`);
    assert.ok(hullDotLabel(minimap, each[1]).startsWith(`${getShip(game, each[1]).name}, `),
      `${each[1]} is named after its own hull`);
  }
});

test('the map name and the menu interior agree on what is known about a partially-known hull', () => {
  const game = fieldGame('a11y-interior', { reimagined: true });
  const actor = getShip(game, 'fed-flagship');
  const foe = getShip(game, 'axis-flagship');
  // Park the hull inside mapper reach but past the radio: the map draws it, the
  // schematic may not read it. Derived from the ranges so the fixture cannot
  // silently stop staging the gap it is testing.
  const radio = sensorRange(game, actor, 'radio');
  const mapper = sensorRange(game, actor, 'mapper');
  assert.ok(mapper > radio + 1, 'the fixture stages a hull the mapper draws and the radio cannot reach');
  Object.assign(foe, { x: actor.x + mapper - 1, y: actor.y });

  elements.clear();
  renderGame(game, { contextShipId: foe.id });
  const menu = read('#ship-menu').innerHTML;
  const field = read('#map-field').innerHTML;
  assert.match(menu, /data-known="false"/, 'the schematic refuses to draw an unobserved interior');
  assert.match(menu, /Interior not observed/, 'and says so in words instead of inventing numbers');
  assert.doesNotMatch(menu, /schematic-bar/, 'no fabricated bars to be read aloud');
  assert.doesNotMatch(menu, /data-console-key="arc-/, 'no arc is spoken for an unread hull');
  assert.ok(!hullLabel(field, foe.id).includes('Captain'), 'the map label agrees: no captain is known');
  assert.ok(hullLabel(field, foe.id).startsWith(`${foe.name}, ${foe.faction}, ${foe.status}`),
    'while what IS known — that a hull of this allegiance is out there — is still named on the map');

  game.scanned = { [foe.id]: true };
  elements.clear();
  renderGame(game, { contextShipId: foe.id });
  assert.match(read('#ship-menu').innerHTML, /data-known="true"/, 'the scan opens the interior');
  assert.ok(hullLabel(read('#map-field').innerHTML, foe.id).includes(`, Captain ${foe.captain}`),
    'and both surfaces learn the captain at the same moment');
});

test('the accessible name is escaped, so a quote in a name cannot truncate it', () => {
  // The wreck marker and every minimap dot already escaped the hull name; the living
  // hull's button did not, so a name containing a double quote closed the attribute
  // early and the accessible name silently became everything before the quote — with
  // the rest parsing as bogus attributes. No shipped name pool contains one (verified
  // across CAPTAIN_NAMES, ENCOUNTERS.names and SHIP_NAMES), so this was latent rather
  // than live; it is pinned now so content, a save file or a user-supplied name cannot
  // quietly reopen it.
  const game = fieldGame('a11y-escape', { reimagined: true });
  const ship = getShip(game, 'fed-flagship');
  ship.name = 'Kobayashi "Quote" Maru';
  ship.captain = 'O<Brien>&Co';
  game.scanned = { [ship.id]: true };

  const field = renderField(game);
  // hullLabel reads up to the first unescaped quote, so before the fix this returned
  // 'Kobayashi ' and the assertion below could not have been written at all.
  const label = hullLabel(field, 'fed-flagship');
  assert.ok(label.startsWith('Kobayashi &quot;Quote&quot; Maru, '),
    `the full name reaches the accessible name, escaped: ${label}`);
  assert.ok(label.includes('Captain O&lt;Brien&gt;&amp;Co'),
    `and so does the captain: ${label}`);
  assert.equal(field.includes('"Quote"'), false, 'no raw quote reaches the markup to close the attribute');
  assert.equal(field.includes('<Brien>'), false, 'and no raw angle bracket becomes an element');

  // The rest of the label still reads correctly, so escaping did not disturb the
  // composition the tests above pin.
  assert.ok(label.includes(`, ${ship.faction}, ${ship.status}`), 'identity triple intact after the escaped name');
});
