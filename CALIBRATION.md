# Calibration notebook

The supplied DOS executable remains the reference for behavior not fixed by
the manual. This browser remake has intentionally chosen transparent, seeded
rules rather than attempting to reproduce its machine-level random sequence.

| Scenario | DOS reference behavior from manual | Web scenario | Current implementation |
| --- | --- | --- | --- |
| Fleet roster | A battle cruiser, three cruisers, and scout per fleet; Xanadu participates | Any seed | 21 ships: five ships for each alliance plus Xanadu |
| Starbase | Xanadu is heavily armored and armed but unable to move; it cannot hyperspace | Take command of Xanadu and order a move or a jump | 0 engine units, so `2` and `-` are both refused and no autopilot will navigate it; its self-destruct blast is doubled instead |
| Ship names | The manual names every ship; the binary's glyph table confirms the roster | Any seed | Canonical names assigned by class and initial (Argo=A, Pequod=P, Xanadu=X, wreck=+) |
| Hidden reports | Roll call (R), shot distribution (S), alliance statistics (L), full war-zone map (Bksp) | Press each key | All four implemented; statistics include shots for/against, credited kills, and chances of victory |
| Victory wording | Distinct proclamations for triumph, mastery, draw, and annihilation | End the war each way | Canonical sentences attached to each outcome |
| Engine limit | A ship moves no more total units than available engines | Use `2`, enter a displacement | Capacity is 10 × working engine units; vector distance is enforced |
| Weapon range | Phasers 30; photons 10; tractor 35 | Select `3`, `4`, or `5`, then a target | Euclidean range is enforced before the shot resolves. All three limits live in one shared `RANGES` table read by the player commands, the autopilots, and the map overlay |
| Shield flush | Reinforcing shields flushes engine power | Use `1` | Requires working engines; gains 5 shields per engine unit ("Engines flushed for N units") |
| Weapon accuracy | Shots can miss ("Missed!", "just missed") | Fire repeatedly | Seeded 12% miss chance per shot; a miss still expends the volley |
| Weapon damage | Phasers 0.20 to 2.00, photons 0.20 to 3.00 off the target's shields | Fire the same weapon repeatedly | Rolled per volley from the seeded RNG inside a symmetric band around the rescaled per-unit value: phasers 12 + 4 per unit at ±25%, photons 24 + 9 per unit at ±26.7%. Those spreads hold the manual's ratio of (max − min) to (max + min), 0.818 for phasers and 0.875 for photons, so average damage and war length are unchanged. Player and autopilot volleys share one `weaponDamage` roll |
| System damage | Scanner, transporter, and radio reach all depend on undamaged units, so damage has to be tracked per system | Take a ship below its shields and keep firing | Once shields are gone each further point removes one random live subsystem unit or crew member; a ship whose crew reaches zero is left `vacant` and can be taken over |
| Tractor pull | Draws the target toward you and prevents movement | Use `5` on a target; then let an enemy beam catch you | Locks movement and pulls the target 5 units per tractor unit toward you. Autopilot beams call the same `tractorLock` helper and refuse targets past 35, so an enemy pull moves you exactly as far as yours moves it. A lock binds only while its caster is still active, so destroying the ship holding you frees you |
| Scanner | Maximum range 10 × undamaged scanner units | Use `6` on a target, then damage your scanner | Reach is recomputed from surviving units every turn; a scan past it is refused, and 0 units disables the command outright |
| Mapper | The map shows your surroundings "to the extent your ship's mapper is functioning" | Use `7`; damage the mapper | Fog of war and the local report both use 20 × surviving mapper units (the manual states no mapper formula); at 0 units the readout says "Mapper blacked out" |
| Transporter | Maximum range 10 × undamaged transporter units; reinforce a friendly ship or take over an empty one, and you may transfer your command | Use `8` on a friendly hull, then on a `vacant` one | Range enforced per surviving unit; crew reinforcement, capture of a vacant hull (which changes its allegiance), and the "Transfer command" option are all implemented |
| Radio | Maximum range 25 × active radio units; reports the location and condition of allied ships | Use `9` | Contacts within range answer with their alert level, distance, shields, crew, and status; at 0 units the command is refused |
| Hyperspace | A new position damages shields; a jump can go wrong | Use `-`, enter coordinates | Seeded 10% chance to burn up; otherwise relocates and loses 12% of shield capacity (min 5) |
| Self-destruct | Nearby ships explode; a wider ring takes shrapnel | Use `=` near other ships | Blast radius 20 (starbase 40) destroys; a +15 shrapnel ring damages shields |
| Collisions | Ships that collide destroy one and cripple the other | Move onto a ship; autopilot navigation | Seeded: one ship destroyed, the other heavily damaged; applies to player and AI moves |
| Death in battle | "You're dead. The war will continue without you." | Lose your command ship | Command shifts to the strongest remaining Federation ship; the war continues |
| Resignation | "Resign command and let the autopilot continue the war" | Press `Esc` | Command shifts and the Federation runs on autopilot; you watch the war resolve (spectator mode) |
| Visual map | Mapper shows your surroundings; ships identified by initial | Watch the map | Fog of war by mapper range; initials in circles; dashed phaser/photon/engine rings; red outline marks enemies that can reach you; `Backspace` reveals the whole zone |
| Condition | Alert level shown on the command panel: red, yellow, green | Watch the panel; damage a starbase and a scout by the same fraction | RED below 25% and YELLOW below 55% of the ship's own shield capacity, so every class reads alike at equal damage. This replaces fixed 25/55 point thresholds, which read a starbase as GREEN at 30% and a scout as distressed at 55%, and renames the old "DISTRESS" label |
| Stardate | The command panel displays the stardate | Watch the map header; press `R` | Shown as "Stardate N" in the map header and in the roll call title, advancing one per completed round |
| Battle narrative | The bottom of the screen carries reports and a scrolling narrative, "which may be abbreviated if your radio is damaged" | Damage your radio, then watch the log | Each entry is truncated to the surviving fraction of radio units; your own ship's lines stay whole, since those reach you over the intercom rather than the radio, and the panel header states the degradation |
| Autopilot | "`" runs the ship for one turn; autopilots are ruthless but clumsy | Press backtick | Autopilot pursues/fires/navigates with seeded drift, so it can collide |
| Formation | Fleets concentrate fire; suicide missions and tight packs collide | Watch an alliance engage | Non-vendetta ships focus the enemy nearest their flagship |
| Vendetta | One enemy ship hunts Captain Jason until he resigns or dies | Watch the vendetta ship | It breaks formation to target the command ship; ends on resign/death |
| Surrender | The autopilot may surrender if conditions collapse | Reduce a fleet to its last ships | A fleet down to 2 ships at <=15% of opposing strength capitulates |

Future calibration should record a DOS input sequence and visible output beside
the same web seed/action pair, then tune only the values needed to preserve the
old tactical feel. The source does not claim byte-for-byte fidelity.
