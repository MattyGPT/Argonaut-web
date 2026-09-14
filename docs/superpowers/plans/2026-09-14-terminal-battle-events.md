# Terminal Battle Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every destroyed or surrendered ship a clear, automatically paced tactical-map and narrative event.

**Architecture:** The deterministic rules engine will append structured `destruction` and `surrender` records to its existing FX-event stream. A small UI queue will serialize only those terminal records, rendering an unabridged narrative card and a dedicated map effect for 2.5 seconds each while input is disabled. Existing ordinary shot effects and `lastRound` replay continue to use the same event array.

**Tech Stack:** Vanilla ES modules, browser DOM/SVG/CSS, Node.js built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-14-terminal-battle-events-design.md`

## Global Constraints

- Do not add dependencies or change seeded combat/rules outcomes.
- Emit a terminal event only when a hull is `destroyed` or `surrendered`; a capturable `vacant` hull is not a destruction event.
- Preserve ship name, faction, and coordinates from the transition point; include attacker fields only when attribution is truthful.
- Present terminal events one at a time for exactly 2500 ms and resume automatically.
- Do not abbreviate terminal narrative cards when the command radio is damaged.
- Keep terminal effects and their metadata in `lastRound.events` so replay can show them.
- Preserve semantic information when reduced motion is enabled; only animation is suppressed.

---

## File structure

- `game/actions.js` — creates destruction records for weapon kills, collisions, self-destructs, and hyperspace burns.
- `game/turns.js` — propagates AI terminal records and turns faction capitulation into one surrender record per hull.
- `ui/battle-events.js` — pure terminal-event filtering and serial queue, injectable for deterministic tests.
- `ui/render.js` — builds the current terminal narrative card, keeps it outside radio abbreviation, and disables commands during a queue.
- `ui/fx.js` — draws destruction and surrender SVG effects and treats terminal records as globally visible.
- `app.js` — connects action/computer/replay event arrays to the serial UI queue.
- `styles.css` — styles the high-priority cards, terminal map effects, and reduced-motion behavior.
- `test/game.test.js` — covers event attribution and engine propagation.
- `test/render.test.js` — covers the card, radio behavior, and busy command state.
- `test/battle-events.test.js` — covers terminal filtering and automatic queue order.
- `test/fx.test.js` — covers SVG classes for terminal destruction and surrender effects without a browser.

### Task 1: Emit complete destruction records from player-side rules

**Files:**
- Modify: `game/actions.js:81-97, 320-355, 371-385, 513-565`
- Modify: `test/game.test.js:1-10, 55-115`

**Interfaces:**
- Produces: `terminalEvent(kind, cause, ship, options = {})`, exported from `game/actions.js`.
- Produces: event objects shaped as `{ kind: 'destruction', shipId, shipName, faction, x, y, cause, attackerId?, attackerName?, attackerFaction? }`.
- Consumes: the existing action `events` array returned by `applyPlayerAction`, `resolveCollision`, and `detonate`.

- [ ] **Step 1: Write failing game-rule tests for destruction attribution**

  Add these tests after the existing FX-event test. Use `phaser-hit-2`, which is already known to produce a hit, and remove all of the target's shields, crew, and system units so that that hit must destroy it.

  ```js
  test('a lethal weapon hit records the victim, faction, shooter, and weapon', () => {
    const game = withShips(placedGame('phaser-hit-2'), (ship) => ship.id === 'axis-flagship'
      ? { ...ship, shields: 0, crew: 0, systems: Object.fromEntries(Object.keys(ship.systems).map((name) => [name, 0])) }
      : ship);
    const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
    const event = result.events.find((entry) => entry.kind === 'destruction');

    assert.deepEqual(event, {
      kind: 'destruction', shipId: 'axis-flagship', shipName: 'Firebreather', faction: 'Axis',
      x: 16, y: 10, cause: 'phasers',
      attackerId: 'fed-flagship', attackerName: 'Argo', attackerFaction: 'Federation',
    });
  });
  ```

  Add analogous assertions to the existing collision, self-destruct, and seeded hyperspace-burn tests: collision has `cause: 'collision'` and identifies its surviving collider; a self-destruct includes both the detonator and every active ship inside blast radius with `cause: 'self-destruct'`; the burn event has `cause: 'hyperspace'` and no `attackerId` property.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `node --test test/game.test.js`

  Expected: FAIL because no event with `kind === 'destruction'` exists for one or more tested transitions.

- [ ] **Step 3: Implement the shared event factory and wire every destruction path**

  Add the factory immediately after `fireEvent`:

  ```js
  export const terminalEvent = (kind, cause, ship, options = {}) => ({
    kind,
    shipId: ship.id,
    shipName: ship.name,
    faction: ship.faction,
    x: ship.x,
    y: ship.y,
    cause,
    ...(options.attacker ? {
      attackerId: options.attacker.id,
      attackerName: options.attacker.name,
      attackerFaction: options.attacker.faction,
    } : {}),
    ...(options.surrenderedTo ? { surrenderedTo: options.surrenderedTo } : {}),
  });
  ```

  Keep the existing `phasers`/`photons` and `explosion` records. Append `terminalEvent('destruction', type, victim, { attacker: actor })` only when the resulting victim status is exactly `destroyed`. In `oneCollision`, append a `destruction` record with `cause: 'collision'` and `attacker: survivor`. Make `detonate` collect events while mapping victims, including the actor, and return `{ game, messages, events }`; pass those events from both player self-destruct and AI self-destruct callers. Append a cause-only destruction record on the hyperspace-burn branch. Do not create a terminal record for a ship that becomes `vacant`.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `node --test test/game.test.js`

  Expected: PASS, including existing collision, self-destruct, and hyperspace behavior.

- [ ] **Step 5: Commit the rules-event slice**

  ```bash
  git add game/actions.js test/game.test.js
  git commit -m "feat: emit ship destruction events"
  ```

### Task 2: Preserve terminal events through AI turns, surrender, and replay state

**Files:**
- Modify: `game/turns.js:24-105, 181-206, 279-347`
- Modify: `test/game.test.js:250-340`

**Interfaces:**
- Consumes: `terminalEvent` from `game/actions.js`.
- Changes: `applySurrender(game)` to return `{ game, events }`, where `events` is an array of `surrender` records.
- Produces: `resolveComputerTurns(...).events` and `.lastRound.events` containing destruction and surrender records.

- [ ] **Step 1: Write failing propagation and surrender tests**

  Replace the direct `applySurrender` assertion with a destructured result, then assert one event per surrendered ship:

  ```js
  const result = applySurrender(game);
  assert.equal(result.game.outcome, null);
  assert.deepEqual(result.events.map((event) => [event.kind, event.shipId, event.faction, event.surrenderedTo]), [
    ['surrender', 'bloc-cruiser-1', 'Bloc', 'Federation'],
  ]);
  ```

  Add a computer-turn test that starts from the same collapsing Bloc setup with `phase: 'computer'`, calls `resolveComputerTurns`, and asserts that its `events` and `lastRound.events` each include the surrender record. Add an AI self-destruct setup and assert the `events` returned by `resolveComputerTurns` include its `destruction` records.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `node --test test/game.test.js`

  Expected: FAIL because `applySurrender` returns a game object rather than `{ game, events }`, and computer events omit surrender data.

- [ ] **Step 3: Return and aggregate surrender events without altering combat determinism**

  Refactor `applySurrender` so every return has the same shape. Keep the existing eligibility calculations and faction ordering, but replace the status-update branch with this event-producing form:

  ```js
  export const applySurrender = (game) => {
    if (game.outcome) return { game, events: [] };
    let next = game;
    const events = [];
    const factions = [...new Set(game.ships.map((ship) => ship.faction))];
    for (const faction of factions) {
      const active = next.ships.filter((ship) => isActive(ship) && ship.faction === faction);
      const winner = surrenderWinner(next, faction, active, factions);
      if (!winner) continue;
      for (const ship of active) {
        events.push(terminalEvent('surrender', 'surrender', ship, { surrenderedTo: winner }));
      }
      next = markFactionSurrendered(next, faction, winner);
      if (next.outcome) return { game: next, events };
    }
    return { game: next, events };
  };
  ```

  Implement the two plan-local helpers used above in `game/turns.js` rather than leaving their policy implicit:

  ```js
  const surrenderWinner = (game, faction, active, factions) => {
    if (faction === FACTIONS.FEDERATION && !game.resigned) return null;
    if (active.length === 0 || active.length > SURRENDER.maxShips) return null;
    const mine = factionStrength(game, faction);
    const opposing = factions.filter((other) => other !== faction)
      .reduce((total, other) => total + factionStrength(game, other), 0);
    if (opposing === 0 || mine > opposing * SURRENDER.strengthRatio) return null;
    return factions.filter((other) => other !== faction)
      .sort((left, right) => factionStrength(game, right) - factionStrength(game, left))[0];
  };

  const markFactionSurrendered = (game, faction, winner) => ({
    ...game,
    phase: faction === FACTIONS.FEDERATION && game.resigned ? 'ended' : game.phase,
    outcome: faction === FACTIONS.FEDERATION && game.resigned
      ? { kind: 'alliance-win', message: `The Federation has surrendered to ${winner}.` }
      : game.outcome,
    ships: game.ships.map((ship) => isActive(ship) && ship.faction === faction
      ? { ...ship, status: 'surrendered', tractorBy: null }
      : ship),
    log: faction === FACTIONS.FEDERATION && game.resigned
      ? game.log
      : [...(game.log ?? []), `${faction} has surrendered to ${winner}.  Its ships stand down.`],
  });
  ```

  When a resigned Federation capitulates, emit one surrender record for each active Federation hull and mark those hulls `surrendered` before setting the existing alliance-win outcome. In `resolveComputerTurns`, replace `game = applySurrender(game)` with a destructured result, assign `game = surrender.game`, and append `surrender.events` to the existing `events` array before constructing `lastRound`. In `resolveAiAction`, return `events: blast.events` for self-destruct actions.

- [ ] **Step 4: Run game tests and the complete suite**

  Run: `node --test test/game.test.js && npm test`

  Expected: PASS. Existing outcome, command-transfer, and replay tests remain deterministic.

- [ ] **Step 5: Commit the turn-propagation slice**

  ```bash
  git add game/turns.js test/game.test.js
  git commit -m "feat: carry terminal events through turns"
  ```

### Task 3: Build the testable terminal-event UI primitives and visuals

**Files:**
- Create: `ui/battle-events.js`
- Modify: `ui/render.js:150-186`
- Modify: `ui/fx.js:69-102`
- Modify: `styles.css:279-335, 430-470`
- Create: `test/battle-events.test.js`
- Create: `test/fx.test.js`
- Modify: `test/render.test.js:50-80`

**Interfaces:**
- Produces: `isTerminalEvent(event)` and `playTerminalEvents(events, show, wait)` from `ui/battle-events.js`.
- Produces: `terminalNarrative(event)` from `ui/render.js` for a terminal card.
- Consumes: `view.terminalEvent` and `view.battlePaused` in `renderGame`.
- Consumes: terminal event `kind`, coordinates, and faction in `playEffects` and `replayEffects`.

- [ ] **Step 1: Write failing pure-queue, render, and SVG tests**

  In `test/battle-events.test.js`, use an immediate injected delay to verify automatic ordering:

  ```js
  import { isTerminalEvent, playTerminalEvents } from '../ui/battle-events.js';

  test('plays terminal events in order and clears the current event', async () => {
    const first = { kind: 'destruction', shipName: 'Bonhomme' };
    const second = { kind: 'surrender', shipName: 'Pequod' };
    const shown = [];
    await playTerminalEvents([first, { kind: 'phasers' }, second], (event) => shown.push(event), () => Promise.resolve());
    assert.equal(isTerminalEvent(first), true);
    assert.equal(isTerminalEvent({ kind: 'photons' }), false);
    assert.deepEqual(shown, [first, second, null]);
  });
  ```

  In `test/render.test.js`, render a game with the command radio at one unit and `view.terminalEvent` equal to the Task 1 weapon event. Assert `#log.innerHTML` contains `class="terminal-event"`, the full victim, faction, attacker, and `phasers`, while ordinary log traffic remains abbreviated. Render with `battlePaused: true` and assert command buttons include `disabled`.

  In `test/fx.test.js`, provide a minimal SVG/document stub, replace `globalThis.setTimeout` with a recorder that does not invoke callbacks, call `playEffects` with a destruction and a surrender event unrelated to the player, and assert it creates `fx-terminal-destruction` and `fx-terminal-surrender` nodes.

- [ ] **Step 2: Run the UI-focused tests and verify they fail**

  Run: `node --test test/battle-events.test.js test/render.test.js test/fx.test.js`

  Expected: FAIL because the queue module, terminal card, and terminal SVG classes do not yet exist.

- [ ] **Step 3: Implement the pure queue, card, and map effect**

  Create `ui/battle-events.js` with no DOM dependency:

  ```js
  export const isTerminalEvent = (event) => event?.kind === 'destruction' || event?.kind === 'surrender';

  export const playTerminalEvents = async (events, show, wait) => {
    for (const event of (events ?? []).filter(isTerminalEvent)) {
      show(event);
      await wait(event);
    }
    show(null);
  };
  ```

  In `ui/render.js`, add `terminalNarrative(event)` that returns a faction class, heading (`SHIP DESTROYED` or `SHIP SURRENDERED`), and truthful sentence such as `Bonhomme · Federation — destroyed by Firebreather · Axis using phasers.` For missing attackers, use cause-only text. Prefix this card to the normal log HTML directly, rather than passing it to `abbreviateNarrative`. Include `view.terminalEvent` in the concise status text. Add `view.battlePaused` to the command-button disabled condition.

  In `ui/fx.js`, add `drawTerminal(svg, event)`, using `event.x` and `event.y`, with class `fx-terminal-destruction` for a large explosion and `fx-terminal-surrender` for a dashed flag/halo. Extend `draw` for both kinds and make `playEffects` retain all terminal events even when neither `fromId` nor `toId` matches `playerId`. Let the effect live for the queue interval. Add matching CSS, including a `@media (prefers-reduced-motion: reduce)` block that removes animation while leaving the marker and card visible.

- [ ] **Step 4: Run UI tests and the complete suite**

  Run: `node --test test/battle-events.test.js test/render.test.js test/fx.test.js && npm test`

  Expected: PASS. The new tests demonstrate the queue order, unabridged card, disabled controls, and both terminal visual classes.

- [ ] **Step 5: Commit the terminal presentation primitives**

  ```bash
  git add ui/battle-events.js ui/render.js ui/fx.js styles.css test/battle-events.test.js test/fx.test.js test/render.test.js
  git commit -m "feat: render terminal battle events"
  ```

### Task 4: Connect automatic terminal pacing to actions, computer turns, spectator mode, and replay

**Files:**
- Modify: `app.js:35-106, 225-250`
- Modify: `test/render.test.js:190-205`
- Modify: `README.md:161-166, 193-219`

**Interfaces:**
- Consumes: `playTerminalEvents(events, show, wait)` from `ui/battle-events.js`.
- Consumes: `view.terminalEvent` and `view.battlePaused` from Task 3.
- Produces: a single `presentTerminalEvents(events)` app helper that resolves after all terminal events have been shown for 2500 ms each.

- [ ] **Step 1: Extend tests for replay-aware terminal visibility**

  Update the existing replay render fixture so `lastRound.events` includes a terminal destruction record and render it with `view.terminalEvent` set to that record. Assert the replay button remains visible and the log contains the terminal card. Add a second assertion that the card is absent when `terminalEvent` is null, so it cannot become stale after playback clears.

- [ ] **Step 2: Run the render test and verify the new assertion fails**

  Run: `node --test test/render.test.js`

  Expected: FAIL until the Task 3 rendering contract is wired through app-facing replay state.

- [ ] **Step 3: Serialize presentation in app control flow**

  Import `playTerminalEvents` and define the app-local timing and presenter:

  ```js
  const TERMINAL_EVENT_MS = 2500;
  let presentingTerminalEvents = false;

  const presentTerminalEvents = async (events) => {
    presentingTerminalEvents = true;
    await playTerminalEvents(events, (terminalEvent) => {
      view = { ...view, terminalEvent, battlePaused: Boolean(terminalEvent) };
      refresh();
    }, () => new Promise((resolve) => setTimeout(resolve, TERMINAL_EVENT_MS)));
    presentingTerminalEvents = false;
  };
  ```

  At the top of `dispatch`, return when either `spectating` or `presentingTerminalEvents` is true. Make `runComputer` async: resolve the round, call ordinary `showEvents`, await `presentTerminalEvents(game.events)`, then leave the state ready for the player. In the player, autopilot, spectator, and replay paths, call `showEvents` first and await `presentTerminalEvents` before starting a following computer phase or scheduling the next spectator tick. In replay, preserve `view.entries = round.entries` while replaying terminal cards; do not mutate `lastRound` or game rules.

- [ ] **Step 4: Run the complete suite and perform a browser acceptance pass**

  Run: `npm test`

  Expected: PASS.

  Then run `npm start`, begin a seeded war that produces a kill or trigger self-destruct, and verify all of the following in the browser:

  1. The map shows the terminal explosion or surrender marker at the stored location.
  2. The narrative card identifies affected ship, faction, cause, and credited attacker when applicable.
  3. The next event starts only after about 2.5 seconds; no click is required.
  4. Commands cannot be issued during a card, then re-enable when the queue finishes.
  5. Replay repeats terminal effects/cards and damaged radio does not shorten the card.
  6. DevTools reduced-motion emulation removes animation but retains card/marker information.

- [ ] **Step 5: Document and commit the integrated feature**

  Add a README note beside replay and impact juice explaining that ship losses and surrenders are automatically paced, faction-labelled terminal events with map and narrative emphasis. Then commit:

  ```bash
  git add app.js test/render.test.js README.md
  git commit -m "feat: pace battle around terminal events"
  ```

## Final verification

- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Run `npm test` and record the passing result.
- [ ] Review `git status --short` and confirm only intentional feature changes remain.
- [ ] Compare the implementation against `docs/superpowers/specs/2026-09-14-terminal-battle-events-design.md`: all destruction paths, all surrendered hulls, map effects, unabridged narrative cards, automatic 2500 ms pacing, replay, reduced motion, and accessibility must be covered.
