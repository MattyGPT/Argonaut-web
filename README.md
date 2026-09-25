# Argonaut Web

A fresh browser remake of the 1992 DOS tactical space-war game, originally
(c) 1988, 1992 by Jim Chen. This remake uses newly written HTML, CSS, and
JavaScript; the supplied DOS manual was used only as a behavioral reference.

## Run it

From this folder:

```sh
npm start
```

Then open `http://localhost:8080`. The start script is a dependency-free Node
static server (`server.js`), so the only prerequisite is a Node runtime on
`PATH`; no packages need to be installed.

## Test it

```sh
npm test
```

## Controls

`0–9` select the original system commands. `-` hyperspaces, `=` self-destructs,
`P` passes, backtick runs autopilot, and `Escape` resigns. `Tab` also passes, but
only when no button has focus — swallowing it outright trapped keyboard users on
the first control they reached, and the command panel has twenty of them. Every
command has a button as well.

You can also **click empty space on the tactical map** to maneuver. The click
becomes an engine order toward that point, clamped to the engine ring already drawn
around your ship, so you never have to work out ΔX and ΔY by hand; `2` still opens
the coordinate prompt when you want exact numbers.

**Clicking any hull** opens a context menu that grows out of it, carrying every
command your command ship can actually perform on that hull: fire phasers, fire
photons, and lock a tractor beam inside their ranges; scan inside sensor reach;
beam crew to a friendly hull — or board a vacant one — inside transporter reach.
A command whose hardware is burnt out or whose range does not reach is simply not
offered, so every button in the menu lands. In an extended war a Federation hull's
menu also carries its standing orders and its one dockyard refit. `Escape` or a
click elsewhere on the map puts the menu away, and clicking the same hull again
toggles it; issuing a command from it spends your stardate as usual.

`-`, `=`, and `Escape` ask for confirmation first, because none of them can be
undone. Hyperspace takes no destination: you commit to the jump and emerge
wherever it takes you, your shields weakened on arrival. That makes it a way out
of a fight you are losing rather than a way to get somewhere in particular.

The original also had "hidden" information commands, kept here: `R` roll call,
`S` shot distribution, `L` alliance statistics, and `Backspace` a full map of
the war zone. In an extended war, `F` lists your fleet and its standing orders.

## The fleets

Each alliance fields a battle cruiser (flagship), three cruisers, and a scout;
the Federation starbase Xanadu fights alongside you. The rosters use the
original ship names:

- **Federation** — Xanadu, Argo, Bonhomme, Crusader, Defender, Empyreal
- **Axis** — Firebreather, Grendel, Hellhound, Iscariot, Jawbreaker
- **Bloc** — Killjoy, Laserblast, Mephisto, Notorious, Onerous
- **Cabal** — Pequod, Queen Mab, Ragnarok, Saboteur, Terrorist

A **Reimagined** war fields a bigger navy: beyond the canonical 21, fleets can
include extra hulls of the new classes — the **interceptor**,
the fastest hull afloat, a glass raider of light guns and thin shields that
wins by speed rather than by trading volleys; its opposite, the **artillery**
ship, whose six phaser banks throw the hardest volley of any warship, on two
engine units that hold the edge instead of chasing; and the **carrier**, a
slow, sturdy tender built for the prize fleet — the longest boarding arm of
any hull that moves, a starbase's tow for hauling prizes and wreck-rams,
modest guns of its own, and the biggest crew pool afloat after Xanadu to man
the prizes it takes, plus a **drone bay** that looses a one-time complement of
three fighter drones (see below). And its fleets are
**composed, not fixed**: every alliance spends a points budget (24 by default,
adjustable per alliance) on its ships of the line — you build the Federation
fleet hull by hull in the New game panel, while enemy alliances draw seeded
doctrine-flavored fleets within theirs, so the same seed replays the same war
and a new seed fields new navies. You also choose **who fights**: any two to
four alliances — the Federation always flies, and at least one enemy must —
and **Xanadu is optional**: without the starbase there is no dockyard, no
radio relay, and withdraw runs to the fleet. Prizes are won, not budgeted:
what you take exceeds your starting fleet by design.

The **New game** panel exposes the replay seed, the regional fleet setup, the
optional tactical sound, the precision fire mode, the extended war mode, the
**Argonaut Reimagined** mode, the scenario in an extended war, and the **fleet
loadout** in a Reimagined one. Use the same seed to reproduce the opening state.

**Argonaut Reimagined** is an opt-in expansion mode, under active development, that
carries the extended war and opens the fight on a much wider 320-unit battlefield
the map becomes a pannable, zoomable viewport into (wheel or `+`/`-` to zoom, arrow
keys or the minimap to pan, `⌖` to re-center on your flagship). Weapon ranges stay
at their classic units while engine reach scales with the field, so there is real
room to screen, flank, and disengage. It also adds the **directed tractor beam**:
open an enemy's menu in range and choose **Direct tow…** to haul it toward a
coordinate or straight into another hull — a deliberate tractor-ram, for the same
pull budget as a standard tow (you choose the direction, not the distance). It also
adds **reactor power management**: every hull runs a damageable reactor whose output
is a budget you distribute across five sinks — shields, weapons, engines, sensors,
tractor — from the console power bar (free, and it persists). Each sink performs at
its calibrated level by default; overcharge one and you must starve another, so a
mauled reactor leaves you with hard choices. Surplus shield power regenerates shields
each stardate, and knocking out an enemy's reactor with a called shot shrinks
everything it can do. It also charts a **living battlefield**: each war seeds
nebulae, asteroid fields, and ion storms across the wide field, drawn as
translucent overlays on the tactical map and the minimap — faint beyond your
mapper's reach, crisp within it. A hull lurking **inside a nebula** is hidden
from an outside mapper, scanner, and radio beyond a short reveal range that
overcharged sensors pierce further. **Asteroid fields** give cover — a volley
whose shot line crosses one can splash on a rock — and a hull that *ends* a move
or a tractor tow inside one takes a seeded rock strike across its shields, which
makes towing an enemy into the rocks a deliberate weapon; passing straight
through at speed is safe. **Ion storms** jam constantly: inside the core a hull's
weapons and radio are offline for the stardate — it cannot fire or be reached,
though engines, sensors, and tractor still work, so it can flee or be towed out
— and in the storm's outer ring volleys miss more and radio reach halves, which
lets you fight at a penalty or skim a message through. Two **relay nodes** sit
mirrored off Xanadu as capturable objectives: end a stardate inside one — not
tractor-held — and your alliance holds it, every hull gaining +5 reactor budget
while it is held, enough to overcharge a sink without starving another.
Contesting darkens the node and driving the holder off frees it, and a held node
wears its alliance's ring on the map and minimap. It also fields a **prize
fleet**: every hull boarded in a Reimagined war is recorded as a prize — its
origin, the stardate taken, and its prize crew read in the fleet report, the
ship's menu, and a gold pip on the map. Any Federation hull can be ordered to
**Board…** a derelict and will sail over and beam a prize crew across on its own,
and enemy captains do the same when they have no shot to fire — a knocked-out
hull is a resource every alliance races for. A fresh prize is under-manned (its
engines and guns run at half effectiveness below a quarter of its complement)
and withdraws toward Xanadu until you dock it, crew it up, and order it into the
line; a prize whose crew dies can be retaken by anyone, including its original
alliance. It also gives the carrier a **drone bay**: flying a carrier, **Launch
drones** (`D`) spends the stardate to put a one-time complement of three
**fighter drones** on the field, any carrier can instead take the **Launch
drones** standing order (it looses the bay when an enemy closes), and enemy
carriers launch on the same trigger. Drones are fast, fragile gunboats with
nobody aboard — an interceptor's near-speed, a phaser pair, paper shields — drawn
small with a `D` glyph and named after their carrier (Lexington D1, D2, D3).
They **escort their carrier**, intercepting anything that closes on it, and when
the carrier is destroyed the wing **fights on alone**, hunting the nearest enemy
until shot down. A drone is never a prize (no crew to kill, no hull to board) and
counts for nothing in the endgame: an alliance down to drones is out of the war
and its wing goes dark with its last crewed hull. The bay is never rebuilt — not
even at the dockyard, which drones never dock at — and a captured carrier keeps
its complement, the drones flying for whoever flies her. Combat **stances**
deepen every gunfight: a hull holds one of three postures — standard, **firing**
(its own volleys land more often, but it is easier to hit), or **evasive** (harder
to hit, its own shots go wide) — a free, persistent choice like reactor power that
rides the one shared accuracy roll alongside asteroid cover and storm jam. Enemy
captains hold a stance by doctrine (Axis and Bloc fire, Cabal weaves), and any hull
beaten near destruction weaves as it breaks off; the stance shows as a colored
halo on the map and in the fleet report. And **Disengage** (`X`) is the pilot's
escape lever — a full engine burn straight away from the nearest threat, as the
turn's maneuver, pairing with evasive to break off under fire. Some hulls —
artillery and interceptors — also carry an **ion/EMP emitter** (`I`), a long-range
suppression beam that outranges the phasers and **disables rather than destroys**:
shields soak the charge first, and whatever punches through burns out subsystem
units **without killing a single crewman**. Gut a hull's engines and guns and it
**strikes its colors**, left a vacant derelict for anyone to board — so ion is a
hunter's tool that feeds the prize race instead of sending hulls to wreckage, and
the dockyard rebuilds what it burns out. The heaviest hulls — battle cruisers and
carriers — also carry **spread torpedo tubes** (`T`), a short-range area salvo: the
target you name takes the full blast and every hull near the impact takes a share
that falls off with distance. The splash is indiscriminate, so **your own wingmen
can be caught** if they are near the impact (the shooter spares only itself) — a
deliberate counter to tight formations, and a risk in a melee. A salvo that misses
splashes nothing, and enemy captains loose it only into a clean, clustered splash. Axis last stands are scaled for the wide field as well — the
self-destruct blast is smaller there, and the trigger needs a captain at 2%
shields with five enemies stacked close, so one spiteful death no longer
deletes a fleet cluster. Volleys are measured too: every Reimagined salvo
lands at a scaled fraction of its calibrated band — a balance dial, not
calibration — so wars run long enough for terrain, relay nodes, and prize work
to decide them rather than the first exchange. It
never changes how a classic or extended war plays — those keep the calibrated
100-unit field and the pull-toward-you beam. New Reimagined systems land over time;
see `docs/superpowers/specs/2026-09-17-argonaut-reimagined-roadmap.md`.

## Mechanics notes

The remake follows the manual's rules and the behavior confirmed in the
original executable:

- Reinforcing shields (`1`) flushes engine power and needs working engines.
- Weapons can miss — yours and the enemy's alike, at the same rate — and every
  volley rolls its own damage inside a fixed band instead of hitting for the
  same number each time.
- **Battles are attritional.** Every hull carries twice the shields and crew the
  gunnery table was tuned against, so a kill takes some fourteen volleys across a
  fleet engagement rather than eight, and a war runs about twenty-five stardates
  instead of sixteen. Because subsystem damage only begins once the shields are
  down, doubling them also doubles the time a ship spends fighting intact rather
  than crippled. The guns themselves are unchanged.
- The tractor beam (`5`) locks and pulls its target toward you, and enemy beams
  pull you just as hard. A lock ends when the ship holding it dies; hyperspace
  (`-`) also shakes one off, but can burn a ship up.
- Damage that gets past your shields knocks out individual subsystems, which
  shortens the reach of your scanner (`6`), mapper (`7`), transporter (`8`), and
  radio (`9`). A ship that loses its entire crew is left vacant, and your
  transporter can take it over — command included.
- Self-destruct (`=`) destroys everything in its blast radius and sprays
  shrapnel in a wider ring; the Xanadu starbase has an especially large blast.
- Two ships occupying the same point collide — one is destroyed, the other
  crippled: its shields burn off and it loses half its remaining crew and
  subsystems. This applies to your moves and the autopilots', to a tractor tow
  that drags a hull into another, and to a hyperspace arrival on an occupied
  point.
- If your command ship is lost, or you resign, command shifts to another
  Federation ship and the war goes on. The conflict ends when a side is wiped
  out — or, if every survivor is stranded out of engines and past reach of
  anything, in a hopeless draw.

## Autopilot and the war without you

- Backtick runs the autopilot for your ship for one turn; it pursues, fires,
  and navigates like the enemy captains (ruthless, but clumsy — it can collide).
- Resigning (`Esc`) hands the whole Federation to the autopilot and lets you
  watch the war play out; it is final for that war. The vendetta against Captain
  Jason ends when he resigns or dies — or when you board the vendetta ship.
- Enemy fleets concentrate their fire on a shared target (formation), while the
  vendetta ship breaks formation to hunt your command ship. That is the classic
  war; an extended war gives each alliance its own doctrine instead.
- An autopilot reduced to its last ships and badly outmatched will surrender
  ("has surrendered to") rather than fight to annihilation.

## Extended war

The original gave you one hull and left the rest of the Federation to the same
autopilot as your enemies. An **extended war** — off by default, chosen in the
**New game** panel — keeps every original rule and adds an admiral's layer on
top. A classic war is untouched: the flag alone changes no ship's behavior until
you issue an order.

- Open a Federation hull's ship menu by clicking it on the tactical map (or press
  `F` for the fleet report) to give it standing orders. Orders are free — they
  cost no turn — and persist until you change them.
- **Focus with fleet** is the original behavior: concentrate on the enemy nearest
  your flagship. **Hold** keeps a ship stationary, though it still fires at
  whatever comes into range. **Withdraw** falls back toward Xanadu, or toward
  the fleet if the base has fallen, shooting on the way out. **Escort** rides
  beside a friendly hull and attacks whatever menaces it. **Screen** posts a ship
  between a ward — Xanadu, say — and the nearest threat. **Intercept** chases
  one named enemy instead of following the fleet.
- Orders travel by radio. If your command ship's radio reaches the hull, or
  Xanadu can hear both ends, the order is acknowledged at once; otherwise it
  lands one stardate late, and the narrative says so. Losing your radio — or
  Xanadu — makes you a slower admiral.
- Ordered ships navigate cleanly. The seeded drift and overshoot that makes
  unordered autopilots clumsy, and occasionally collision-prone, is left to ships
  following fleet default.
- Your own command ship obeys its order whenever the autopilot has the conn:
  backtick for a turn, or for the rest of the war after you resign.
- An order naming a destroyed ship is dropped, and that hull returns to fleet
  default rather than idling.
- Ships under orders wear a white pip on the map.
- **Xanadu is a dockyard.** Any Federation hull that ends a stardate inside the
  green ring around the base, and is not being dragged by a tractor beam,
  recovers shield power and crew. The rate is deliberately slow — a gutted
  cruiser needs a dozen quiet stardates to refit — and the base must still hold
  half its own shields to spare the resources. Burnt-out subsystems are beyond
  the dockyard, so losing your mapper stays permanent. This is what `withdraw`
  is for, and it makes screening Xanadu worth a ship.
- **The war ends with a battle report**: stardates elapsed, Federation losses,
  the top gun of any alliance, the hull that absorbed the most punishment, the
  clumsiest captain by collisions, and your own record as Captain Jason.
- **Each alliance fights its own way.** In the original every autopilot ran the
  same doctrine. In an extended war: **Axis** swarms the nearest hull and refuses
  to give ground, refits late, and — only as a last stand when all but destroyed
  (2% shields) with at least five enemy ships, more enemies than friends, stacked
  inside its blast — detonates rather than be destroyed (the vendetta captain never
  does, and keeps hunting);
  **Bloc** works the phaser edge, backs off anything that closes to point-blank,
  never tractors, and executes the weakest hull it can actually hit; **Cabal**
  fights with its fleet but spends a tractor beam whenever it can smash you into
  another enemy; **Federation** keeps the original's concentration and adds the
  damage discipline the enemy captains never had.
- **Enemy captains look after themselves now.** They flush engines into shields
  and withdraw when mauled, so a fleet you have hurt can slip away instead of
  fighting to the last point of shield. The vendetta ship is exempt: it still
  comes for Captain Jason through any amount of fire.
- Doctrine applies only to hulls you have not ordered — your orders always
  outrank your own captains' instincts.
- **Every hull has a captain, and you have to earn their names.** A new extended
  war tells you that a captain — by name — has sworn to hunt you down, but not
  which ship they command. Scanning a hull reveals who captains it, so finding
  your hunter means getting inside scanner range of the enemy fleet. That is what
  makes the scanner worth its hardware.
- **Aces and a deepening vendetta.** Two credited kills make a captain an ace, and
  a scanned ace wears a ★ on the map. Every third kill the vendetta captain scores
  makes its volleys against your command ship bite 25% harder, so ignoring that
  hull gets worse the longer you leave it alive.
- **Replay the round.** The button in the battle narrative header plays the last
  computer phase back on the map — every alliance's beams, torpedoes, and kills,
  not just the ones that touched you — with that round's narrative beside it.
  Terminal markers and unabridged ship-loss or surrender cards replay from the
  same stored events, even through a damaged radio. Commands stay locked until
  the final replay effect or card completes. Twenty autopilot decisions no
  longer arrive as one wall of text.
- **Three ways to fight.** The New game panel picks a scenario, and the mission
  panel carries its brief and live progress:
  - *Cease hostilities* — the original objective. Destroy the opposing fleets
    before they destroy Federation command.
  - *Hold Xanadu* — the base must still be standing at stardate 30. Lose it and
    the war is lost, whatever else survives. On autopilot, screening the base with
    your whole fleet holds it about 20 wars in 60; leaving the fleet to its own
    doctrine holds only 11. The dockyard is what makes it possible.
  - *Hunt the hunter* — the captain hunting you is named at the outset; their hull
    is not. Scan the enemy fleet to identify them, then end them. If the war kills
    your hunter before you have identified them, you lose: you never learned who
    was coming for you. It is a race, and the scanner is the whole game.

  Wiping out an alliance still wins outright under any scenario.
- **The dockyard rebuilds hardware.** A hull inside the ring recovers shield power,
  transferred crew, and one unit of its most-damaged subsystem each stardate — so a
  burnt-out mapper is a wound now, not a permanent amputation.
- **One refit per hull per war.** While docked, a Federation hull may take a single
  refit from the order panel: an extra photon bay, an overcharged phaser bank, a
  tuned drive, or deeper sensors. Refits add system units, never hull capacity.

## Precision fire

**Precision fire** — off by default, chosen in the **New game** panel, available
in any war — gives your phaser volleys two dials in the firing prompt:

- **Called system.** Name a subsystem instead of standard targeting. A called
  volley deals 40% of the rolled damage, spends all of it on that system, takes
  no crew, and checks fire once the system is dead. Shields absorb it first as
  ever, so the play is to strip shields with standard fire and then operate: a
  couple of called volleys burn out a hull's engines or guns and leave it
  intact, crew alive.
- **Phaser power.** A 0–100 slider on every phaser volley, defaulting to full.
  Output already scales with your live phaser units, so the dial is a fraction
  of what your banks can currently put out. Its use is the finishing blow: a
  throttled volley never carries the overkill that shatters a hull, so a
  measured finish leaves a boardable prize instead of wreckage.

A hull with crew left but no engines, phasers, or photons strikes its colors at
stardate end — crew away in escape pods, hull left adrift for your transporter
to board — so disabling becomes a capture path that kills no one. Your command
ship never surrenders while you have the conn, and a starbase is exempt: a base
with burnt-out guns is a fortress, not a derelict.

The enemy still fires standard volleys, and a war with the flag off plays
exactly as calibrated — the dials are ignored on arrival there. A non-default
setting is carried on the console (`Phasers set to 60% power, called to
engines.`), and a called shot draws as a thinner, coherent beam, live and in
the round replay.

## The tactical display

- Ships glide between stardates instead of teleporting, and leave a fading dashed
  trail, so you can watch the computer phase reposition the fleets. Both are
  suppressed under `prefers-reduced-motion`.
- Each ship is drawn as a circle bearing its initial (A=Argo, X=Xanadu,
  +=wreck), colored by alliance.
- Dashed rings around your ship show phaser (red), photon (yellow), and engine
  (cyan) reach. Enemies that can reach you are outlined in red.
- The visual map is limited by your mapper (fog of war). `Backspace` shows the
  whole war zone; `7` lists exact local positions.
- Clicking a hull opens its context menu beside it, flipping sides and clamping at
  the map edge so it stays on the map, with a tail that keeps pointing at the hull.
- Weapon and tractor prompts preselect the nearest sensible target; confirm or
  pick another.
- The battle narrative keeps a scrolling, newest-first log of your actions and
  the autopilots'. A damaged radio abbreviates what comes back — the panel
  header reports how much traffic you are still receiving — while your own
  ship's lines stay intact.
- Condition reads RED, YELLOW, or GREEN against your own shield capacity, so a
  scout and a starbase are judged by the same standard.
- Phaser fire draws a beam, photon torpedoes a traveling spark, and kills a
  burst — for shots you fire and shots fired at you.

## Quality of life

- **User guide** — the top-bar button opens an illustrated in-game guide: how the
  war works, the tactical map, every command and key, combat mechanics, the
  extended war and precision fire, the comforts, and the game's provenance,
  maintainer, and where to reach out. Its screenshots are regenerated with
  `npm install --no-save puppeteer-core` followed by
  `node scripts/capture-guide-shots.mjs` against a running `npm start`.
- **Save/resume** — the war autosaves to your browser (localStorage) after every
  action and resumes where you left off when you reload. `New game` starts fresh.
- **Classic view** — the top-bar toggle switches to a black phosphor CRT theme
  with scanlines; your choice persists.
- **Sound** — enable tactical sound in `New game` for distinct phaser, photon,
  explosion, and miss effects (WebAudio, no assets). A klaxon sounds on the
  transition into RED alert, not continuously while you sit there.
- **Impact juice** — phaser hits flash where they land and the map shakes when a
  volley lands on your command ship. Both are suppressed under
  `prefers-reduced-motion`, and nothing in the rules reads them.
- **Terminal events** — every ship loss and surrender receives an automatically
  paced, faction-labelled map marker and unabridged narrative card for 2.5
  seconds, then combat resumes without a click.
- **Screen readers** — the page is no longer one big live region, which announced
  the entire board on every keystroke. A single concise status line reports your
  condition, position, and the newest narrative entry instead.
- **A bounded narrative** — the game keeps the last 400 entries rather than every
  line ever printed, so a long war cannot outgrow browser storage and quietly stop
  autosaving.

## Rights note

The original manual declares copyright and shareware terms. This is a private
restoration exercise unless the original rights holder grants permission for a
public release using the Argonaut title, story, names, and other game
expression. The program does not include the original `.COM`, screenshots, or
other original game assets.

Captain names, fleet orders, alliance doctrines, the Xanadu dockyard, the
scenarios, and the extended-war narrative are original to this remake — the manual
names every ship but only one person, Captain Jason.
