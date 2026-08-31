# Calibration notebook

The supplied DOS executable remains the reference for behavior not fixed by
the manual. This browser remake has intentionally chosen transparent, seeded
rules rather than attempting to reproduce its machine-level random sequence.

| Scenario | DOS reference behavior from manual | Web scenario | Current implementation |
| --- | --- | --- | --- |
| Fleet roster | A battle cruiser, three cruisers, and scout per fleet; Xanadu participates | Any seed | 21 ships: five ships for each alliance plus Xanadu |
| Ship names | The manual names every ship; the binary's glyph table confirms the roster | Any seed | Canonical names assigned by class and initial (Argo=A, Pequod=P, Xanadu=X, wreck=+) |
| Hidden reports | Roll call (R), shot distribution (S), alliance statistics (L), full war-zone map (Bksp) | Press each key | All four implemented; statistics include shots for/against, credited kills, and chances of victory |
| Victory wording | Distinct proclamations for triumph, mastery, draw, and annihilation | End the war each way | Canonical sentences attached to each outcome |
| Engine limit | A ship moves no more total units than available engines | Use `2`, enter a displacement | Capacity is 10 × working engine units; vector distance is enforced |
| Weapon range | Phasers 30; photons 10 | Select `3` or `4`, select target | Euclidean range is enforced before the shot resolves |
| Shield flush | Reinforcing shields flushes engine power | Use `1` | Requires working engines; gains 5 shields per engine unit ("Engines flushed for N units") |
| Weapon accuracy | Shots can miss ("Missed!", "just missed") | Fire repeatedly | Seeded 12% miss chance per shot; a miss still expends the volley |
| Tractor pull | Draws the target toward you and prevents movement | Use `5` on a target | Locks movement and pulls the target 5 units per tractor unit toward you |
| Hyperspace | A new position damages shields; a jump can go wrong | Use `-`, enter coordinates | Seeded 10% chance to burn up; otherwise relocates and loses 12% of shield capacity (min 5) |
| Self-destruct | Nearby ships explode; a wider ring takes shrapnel | Use `=` near other ships | Blast radius 20 (starbase 40) destroys; a +15 shrapnel ring damages shields |
| Collisions | Ships that collide destroy one and cripple the other | Move onto a ship; autopilot navigation | Seeded: one ship destroyed, the other heavily damaged; applies to player and AI moves |
| Death in battle | "You're dead. The war will continue without you." | Lose your command ship | Command shifts to the strongest remaining Federation ship; the war continues |
| Resignation | "Resign command and let the autopilot continue the war" | Press `Esc` | Command shifts and the Federation runs on autopilot; you watch the war resolve (spectator mode) |
| Visual map | Mapper shows your surroundings; ships identified by initial | Watch the map | Fog of war by mapper range; initials in circles; dashed phaser/photon/engine rings; red outline marks enemies that can reach you; `Backspace` reveals the whole zone |
| Condition | Alert level shown on the command panel | Watch the panel | DISTRESS / YELLOW / GREEN by shield strength |
| Autopilot | "`" runs the ship for one turn; autopilots are ruthless but clumsy | Press backtick | Autopilot pursues/fires/navigates with seeded drift, so it can collide |
| Formation | Fleets concentrate fire; suicide missions and tight packs collide | Watch an alliance engage | Non-vendetta ships focus the enemy nearest their flagship |
| Vendetta | One enemy ship hunts Captain Jason until he resigns or dies | Watch the vendetta ship | It breaks formation to target the command ship; ends on resign/death |
| Surrender | The autopilot may surrender if conditions collapse | Reduce a fleet to its last ships | A fleet down to 2 ships at <=15% of opposing strength capitulates |

Future calibration should record a DOS input sequence and visible output beside
the same web seed/action pair, then tune only the values needed to preserve the
old tactical feel. The source does not claim byte-for-byte fidelity.
