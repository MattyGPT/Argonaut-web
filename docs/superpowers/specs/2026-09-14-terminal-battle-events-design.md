# Terminal battle events

## Purpose

Make every ship destruction and surrender a deliberate, visible battle event. A player must be able to identify the lost or surrendering ship, its faction, the credited attacker when there is one, and the method of loss before combat continues automatically.

## Chosen approach

Keep the deterministic rules engine and its existing round/replay model. The engine emits structured terminal events in addition to narrative text. The UI serializes those events into short, automatic presentations after a battle action or computer round resolves. This provides an understandable pace without converting the rules engine into an asynchronous simulator.

## Terminal-event contract

Every terminal event preserves the state at the time it happened:

- `kind`: `destruction` or `surrender`.
- `shipId`, `shipName`, `faction`, `x`, and `y`: the affected hull and its map location.
- `cause`: `phasers`, `photons`, `collision`, `self-destruct`, `hyperspace`, or `surrender`.
- `attackerId`, `attackerName`, and `attackerFaction` when another ship receives credit.
- `surrenderedTo` for surrender events.

Weapon kills credit the shooter. Collision events identify the surviving collider as the involved opponent but describe the result as a collision rather than a weapon kill. A self-destruct event identifies the detonating ship for every victim; the detonator's own event says it self-destructed. Hyperspace burns have no attacker. A faction capitulation emits one surrender event per hull, all naming the faction that accepted the surrender.

## Rules-engine changes

`game/actions.js` and `game/turns.js` will create terminal events wherever a hull becomes destroyed or surrendered:

- weapon damage that changes an active ship to another state;
- collisions, including tractor and hyperspace-arrival collisions;
- self-destruct blast victims and the detonator;
- hyperspace burns;
- the existing faction-surrender transition.

Terminal events travel with ordinary FX events through player actions, the autopilot, computer turns, and `lastRound`. Existing log messages and game-state rules stay compatible; the terminal event data augments them rather than asking the UI to infer meaning from prose.

## Presentation and pacing

`app.js` queues terminal events after an action or computer round. It disables further commands while that queue plays, presents one event for about 2.5 seconds, then advances automatically. Ordinary beams and impacts remain lightweight; every terminal event receives the dedicated pause.

The current presentation is placed in view state and rendered by `ui/render.js` as a high-contrast, faction-coloured card in the battle narrative. It names the outcome, ship, faction, credited attacker if any, and cause. This content is never abbreviated by damaged-radio narrative filtering.

`ui/fx.js` draws a large explosion for destruction and a distinct surrender marker for a surrender at the stored coordinates. Effects are shown for all terminal events, even if neither hull is the player command ship. The replay button reuses the same event data and terminal FX so the round replay is complete.

`styles.css` supplies the prominent card, map overlay, faction treatments, and a reduced-motion variant. Under `prefers-reduced-motion`, the card and marker remain visible for the same readable interval but do not animate. The concise screen-reader status announces the current terminal event.

## Failure and interaction behavior

An empty event list does nothing. Missing optional attacker data yields a truthful cause-only presentation. Repeated terminal events remain separate queue entries, including multiple ships lost in a single blast, so no loss is collapsed into a summary. Queuing never mutates game rules or replay data. Input remains ignored while playback runs, preventing a player action from racing a pending loss presentation.

## Verification

Automated tests will verify:

- structured attribution for weapon kills, collision, self-destruct, and hyperspace loss;
- one surrender event per surrendered hull with the accepting faction;
- terminal events survive computer resolution and are retained in `lastRound`;
- terminal narrative rendering is prominent and unabridged even with a damaged radio;
- replay and map FX receive terminal events, while reduced-motion behavior preserves semantic information.

The complete Node test suite remains green after the change.
