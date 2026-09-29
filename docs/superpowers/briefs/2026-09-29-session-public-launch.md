# Session brief — Public launch plan for Argonaut Web

*Written 2026-09-29 for a fresh launch-planning session. Matt opens the
session by pointing at this file. The mission: produce a thorough,
step-by-step plan to launch this game publicly — where to host, how to
drive traffic to the game and the repo, monetization options (lower
priority), plus the pre-launch quality bar and the sequencing with owners
and checklists. The deliverable is a PLAN Matt approves; external posts,
accounts, and paid services are Matt's hands and Matt's money — the
assistant drafts, never publishes.*

## The game in one paragraph (verify against README)

Argonaut Web is a solo, from-scratch browser remake of the 1992 DOS tactical
space-war game *Argonaut* (original © Jim Chen): a turn-based (and, since
Phase 8, real-time-pausable) four-alliance fleet war with power management,
directional shields, tractor beams, prize fleets, terrain, encounters, a
sector campaign, and commissioned pixel-art ship sprites in its modern
view, alongside a byte-identical classic phosphor view. Pure client-side
HTML/CSS/JS, no build step, no server beyond static hosting; saves in
localStorage. Public history: PRs #23–#82 over ~2 weeks of daily rounds;
594 tests; a 250-seed whole-war balance harness.

## STEP ZERO — the rights posture (do this before any launch work)

The README frames the project as a **private restoration exercise** unless
the rights holder permits a public release using the Argonaut title, names,
and game expression. The game is nonetheless **already live** at
https://mattygpt.github.io/Argonaut-web/ (GitHub Pages auto-deploy on push
to main) — Matt configured that deliberately, so today's state is "public
by fact, private by note." A launch plan that drives traffic converts that
quiet tension into a visible one. The plan must open with a decision branch
Matt owns:

- **(a) Ask.** Draft a short, professional outreach to the original author
  (Jim Chen / whoever holds the 1992 copyright): what the remake is, what
  it reuses (title, names, the 1992 design's expression vs. the remake's
  original systems — the remake has widened its distance considerably:
  reimagined systems, commissioned art, original narrative), what permission
  is sought (free web release, credit line, no monetization vs. with), and
  an easy yes/no. Include a fallback offer: rename/rebrand on request.
- **(b) Rebrand pre-emptively.** A new title and renamed proper nouns
  (factions, hull names, Xanadu) that keep the systems but drop the 1992
  identity; the README note becomes clean. Cost: loses the restoration
  story, which is also the best marketing story — weigh it.
- **(c) Proceed as-is, documented.** Keep the note, keep the distance
  argument (from-scratch code, original systems and art, no copied
  assets), accept residual risk. If chosen, the plan records the reasoning
  and caps monetization ambition accordingly.

No hosting, listing, or publicity step executes before Matt picks a branch.
Everything below is written to be branch-agnostic except where marked.

## Hosting & distribution options (recommend a stack, not a single host)

1. **GitHub Pages (current canonical):** free, auto-deployed by
   `.github/workflows/deploy.yml` on push to main (runs `npm test` first).
   Keep as the source of truth and the repo's demo link. Constraints: no
   custom server logic (none needed), CI is Node 24 (the quoted test glob
   fails on Node 20), and a failed deploy job must NEVER be rerun
   (`gh run rerun --failed` duplicates the pages artifact) — recover with a
   fresh `gh workflow run`.
2. **Custom domain** (e.g. a .com/.game for the chosen title): CNAME to
   Pages (or move to Cloudflare Pages/Netlify for preview deploys + better
   cache headers). A memorable URL matters more for word-of-mouth than for
   SEO. Add the `CNAME` file or provider config via PR, never by hand on
   the host's UI, so the repo stays the source of truth.
3. **itch.io as the discovery storefront:** embed the HTML5 build (iframe
   of the Pages URL is acceptable; a zipped build is better for offline
   rating), page with screenshots/GIFs, devlog feed, and (if rights branch
   allows) pay-what-you-want. itch is where browser-game players browse;
   its tags and jam ecosystem are free traffic.
4. **Not now:** Steam (web-first game, porting cost), mobile stores (no
   touch UI — see scope decision below), paid hosting tiers (nothing needs
   a server).

Recommendation to argue: Pages canonical + custom domain + itch embed, in
that order, each behind a checklist item.

## Pre-launch quality bar (measure, don't vibe)

- **Browser matrix:** Chrome/Edge current (the playwright rig's headless
  Edge is the baseline), Firefox, Safari — manual pass each; record
  failures as issues. The rig lives in `.qwen/tmp/pw/` (playwright-core +
  measure scripts); extend it into a committed smoke test if it isn't.
- **Touch/mobile scope decision:** the game is keyboard+mouse (hotkeys,
  hover states, 1600px-ish layout). Decide explicitly: (i) desktop-only
  launch with a polite "best on desktop" notice on small screens, or (ii) a
  touch-pass round (tap-to-maneuver already exists via click; menus, pinch
  zoom, layout). Recommend (i) for launch, (ii) as a candidate round.
- **Performance:** Lighthouse pass on the deployed URL; frame pacing in a
  real-time war at 55+ hulls (the round-33 measurement pattern: rAF gap
  median/p95 on a mid-tier machine); asset weights (the sprite PNGs are
  small; the concept JPEGs must NOT ship to players — verify they are not
  referenced by the page and consider moving them out of the deployed tree
  or accepting the cost consciously).
- **First-run experience:** a new visitor lands mid-menu; the New game
  dialog, the user guide, and the legend carry the onboarding. Play-test
  the first ten minutes as a stranger: seed input, mode checkboxes
  (classic/extended/reimagined/realtime), the ship-art and classic-view
  toggles, save/resume on reload.
- **Error hygiene:** no console errors on a fresh load and a full war
  (the rig asserts this); the one known 404 (favicon) — add a favicon
  (a sprite crop makes a great one) or suppress consciously.
- **Accessibility:** hotkey list in the guide, focus states, the sr-status
  live region, prefers-reduced-motion — verify each still holds with
  sprites; record gaps as follow-ups, not launch blockers.
- **Content polish:** README badges + demo link at top; repo topics +
  social card image (Open Graph) so shares render; LICENSE file decision
  tied to the rights branch; CONTRIBUTING only if Matt wants strangers
  touching the code (recommend: not yet).

## Discovery & traffic (the publicity plan, sequenced)

Assets first (all draftable in-repo, publishable only by Matt):
- 30–60s capture video: classic view → toggle → modern sprites → real-time
  pause-and-plan → a collision-avoiding melee → a prize capture. Screen
  capture via the playwright rig or Matt's own tooling; captions, no voice.
- GIF set (5–8): the view toggle, the helm turn with sprites rotating, a
  tractor tow, a last stand, the campaign chart.
- Screenshot set: both views, campaign, legend, a crowded melee.
- A "making-of" angle is the strongest hook: *remaking a 1992 DOS game in
  the browser, pair-programmed with an AI, in 35 measured rounds* — the
  roadmap specs, CALIBRATION log, and art prompt packs are a genuine
  devlog goldmine. Plan a 3–5 post launch series (repo docs → blog/Reddit/
  HN comments), not one dump.

Channels, in expected-value order (argue with Matt):
1. **Show HN** at launch (title + demo URL + repo); the measurement
   discipline (250-seed balance harness, parity scaffolds) is HN catnip.
2. **Reddit:** r/gamedev (making-of), r/webgames & r/InternetIsBeautiful
   (play link), r/retrogaming (the 1992 lineage — only if rights branch
   (a) or (c) with care), r/incremental_games no (wrong genre).
3. **itch.io page + tags + a jam** (e.g. a browser-game jam) for storefront
   discovery.
4. **Mastodon/X devlog threads** from Matt's accounts; gamedev communities
   (TIGSource forums, gamedev.net) for the restoration story.
5. **Newsletters/digests:** Gamedev.js, JavaScript Weekly (submit),
   browser-game curators (free web games lists).
6. **GitHub-native:** topics, trending relies on stars — the HN/Reddit
   spikes are what feed it; pin the demo in the About sidebar.
7. **Web-game portals** (CrazyGames, Poki, Newgrounds): real traffic, real
   requirements (ad SDKs, exclusivity clauses, revenue share) — evaluate
   only after the rights branch and monetization decision; Newgrounds
   (no-ad, community) fits the ethos better than ad-gated portals.

Cadence: launch burst (HN + Reddit + itch + Mastodon same day), then the
devlog series weekly for a month, then a "one month of numbers" post. Every
external word is Matt's voice; the assistant drafts.

## Monetization (lower priority — think through, don't build yet)

Sequence after the rights branch; some branches cap this at zero.
- **Donations:** GitHub Sponsors + Ko-fi link in README/itch page; zero
  infrastructure, zero rights exposure beyond the project's existence.
- **itch pay-what-you-want** with a $0 floor: signals goodwill, captures
  the small fraction who pay; requires rights comfort with "selling."
- **Ads:** NOT recommended on the canonical site (kills the aesthetic and
  the HN story); portal ad-SDK builds are a separate SKU if a portal deal
  ever pencils.
- **Premium/DLC:** no — the game is client-side and forkable; there is no
  enforceable paywall, and pretending otherwise wastes trust.
- **Indirect value (the honest one):** the repo as portfolio/audience —
  speaking, writing, consulting leads. Measure it in stars/follows, not
  dollars, and say so in the plan.

## Analytics & feedback loop

- Privacy-light page analytics only if Matt wants numbers: self-hosted
  Plausible or GoatCounter snippet (no cookies banner drama); else itch's
  built-in stats + GitHub traffic graphs suffice. Decide, don't drift.
- Feedback channels: GitHub Discussions (enable) for bug reports and
  balance arguments; itch comments for player feel; a standing "play-test
  backlog" section in BACKLOG.md where launch feedback lands as candidate
  rounds (the round-34/35 play-test loop is the model).

## Launch sequence (checklist with gates)

1. Rights branch decision (Matt) — GATE.
2. Title/branding final (per branch); README/LICENSE/OG-card updated via PR.
3. Quality bar green (matrix, perf, first-run, favicon, console clean).
4. Custom domain live (if chosen) + itch page drafted with assets.
5. Launch assets final (video, GIFs, screenshots, devlog post 1).
6. Launch day: Pages deploy verified, itch published, HN + Reddit +
   Mastodon + devlog 1 — Matt publishes, assistant on standby for fixes.
7. Week 1: triage Discussions/itch comments into issues; hotfix rounds
   through the normal branch→PR→merge flow (never direct to main, even
   under launch pressure).
8. Week 2–4: devlog series; "one month of numbers" post; feed the play-test
   backlog; propose the next content round from real-player feedback.

Success metrics (pick three, write them down pre-launch): e.g. HN front
page or ≥200 points; ≥1k itch plays in month one; ≥100 repo stars in week
one; ≥10 substantive balance discussions. Numbers without a decision
attached are vanity; each metric should map to a next action.

## Guardrails for this session

- Draft everything in-repo (docs, copy, captions, outreach email) under
  `docs/superpowers/specs/<date>-public-launch-plan.md` + a
  `launch/` folder for copy assets if useful; commit via branch → PR.
- No account creation, no purchases, no external posts, no uploads to
  third-party tools by the assistant — Matt's hands, Matt's money.
- No secrets in the repo (analytics keys, domain registrar creds).
- Keep the game's guardrails intact during any launch-fix rounds:
  reimagined-gating, parity scaffolds, digit-for-digit harness, play-test
  gate on balance changes.
- Verify state first: `git status`, `npm test` (594), `npm run sim`
  baselines (see the roadmap-review brief for the current numbers),
  localhost:8080 via `node server.js` if down.
