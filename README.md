# Argonaut Web

A fresh browser remake of the 1992 DOS tactical space-war game. It uses newly
written HTML, CSS, and JavaScript; the supplied DOS manual was used only as a
behavioral reference.

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
`Tab` passes, backtick runs autopilot, and `Escape` resigns. Buttons provide
the same controls.

The original also had "hidden" information commands, kept here: `R` roll call,
`S` shot distribution, `L` alliance statistics, and `Backspace` a full map of
the war zone.

## The fleets

Each alliance fields a battle cruiser (flagship), three cruisers, and a scout;
the Federation starbase Xanadu fights alongside you. The rosters use the
original ship names:

- **Federation** — Xanadu, Argo, Bonhomme, Crusader, Defender, Empyreal
- **Axis** — Firebreather, Grendel, Hellhound, Iscariot, Jawbreaker
- **Bloc** — Killjoy, Laserblast, Mephisto, Notorious, Onerous
- **Cabal** — Pequod, Queen Mab, Ragnarok, Saboteur, Terrorist

The **New game** panel exposes the replay seed, the regional fleet setup, and
the optional tactical sound. Use the same seed to reproduce the opening state.

## Mechanics notes

The remake follows the manual's rules and the behavior confirmed in the
original executable:

- Reinforcing shields (`1`) flushes engine power and needs working engines.
- Weapons can miss; the tractor beam (`5`) locks and pulls its target toward
  you; hyperspace (`-`) can burn a ship up.
- Self-destruct (`=`) destroys everything in its blast radius and sprays
  shrapnel in a wider ring; the Xanadu starbase has an especially large blast.
- Two ships occupying the same point collide — one is destroyed, the other
  crippled. This applies to your moves as well as the autopilots'.
- If your command ship is lost, or you resign, command shifts to another
  Federation ship and the war goes on. The conflict ends only when a side is
  wiped out.

## Autopilot and the war without you

- Backtick runs the autopilot for your ship for one turn; it pursues, fires,
  and navigates like the enemy captains (ruthless, but clumsy — it can collide).
- Resigning (`Esc`) hands the whole Federation to the autopilot and lets you
  watch the war play out. The vendetta against Captain Jason ends when he
  resigns or dies.
- Enemy fleets concentrate their fire on a shared target (formation), while the
  vendetta ship breaks formation to hunt your command ship.
- An autopilot reduced to its last ships and badly outmatched will surrender
  ("has surrendered to") rather than fight to annihilation.

## The tactical display

- Each ship is drawn as a circle bearing its initial (A=Argo, X=Xanadu,
  +=wreck), colored by alliance.
- Dashed rings around your ship show phaser (red), photon (yellow), and engine
  (cyan) reach. Enemies that can reach you are outlined in red.
- The visual map is limited by your mapper (fog of war). `Backspace` shows the
  whole war zone; `7` lists exact local positions.
- Weapon and tractor prompts preselect the nearest sensible target; confirm or
  pick another.
- The battle narrative keeps a scrolling, newest-first log of your actions and
  the autopilots'.
- Phaser fire draws a beam, photon torpedoes a traveling spark, and kills a
  burst — for shots you fire and shots fired at you.

## Quality of life

- **Save/resume** — the war autosaves to your browser (localStorage) after every
  action and resumes where you left off when you reload. `New game` starts fresh.
- **Classic view** — the top-bar toggle switches to a black phosphor CRT theme
  with scanlines; your choice persists.
- **Sound** — enable tactical sound in `New game` for distinct phaser, photon,
  explosion, and miss effects (WebAudio, no assets).

## Rights note

The original manual declares copyright and shareware terms. This is a private
restoration exercise unless the original rights holder grants permission for a
public release using the Argonaut title, story, names, and other game
expression. The program does not include the original `.COM`, screenshots, or
other original game assets.
