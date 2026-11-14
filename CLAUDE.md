# Der Coup (working title)

Online co-op heist game for four friends, played in the browser. Built for Mert, who owns the project and does not program: you do all technical work.

**Read `docs/HANDOVER.md` first** (current state, decisions, next steps), then `docs/ENGINE.md` (engine APIs and hard rules).

## Working with Mert

- Talk to him in German. Short and direct. One clear recommendation with the reason, then smaller alternatives.
- Small steps: build a little, show him something he can look at (local preview, picture, link), get his verdict, continue. Never build a whole block before the first example.
- For taste decisions ask a few short tap-to-answer questions. Technical decisions are yours.
- Larger answers end with a separate status block: `Erledigt` / `Offen` / `Nächster Schritt` / `Braucht deine Entscheidung`.
- Keep token use lean (Mert's rule, 2026-11-14): the top model steers, decides and reviews. Building and testing go to cheaper models (Sonnet, Opus) as agents, in parallel wherever parts are independent. Do not run everything in one line on the top model, and get help when stuck.
- Check that a new approach works before building on it.
- Be honest about limits. He measures against big commercial games; say plainly what this game can and cannot be.

## Spoiler rule

Mert plays too, and the game is a surprise for the other three. Do not show or tell him: puzzle solutions, hidden facts of a target, the full list of secret offers, the lineup questions, or what happens in missions. He knows three sample offers (Tempo/"Schritt", "Ein Tipp für dich", "Sündenbock") and the four roles. Give spoiler-free reports and verify hidden content with simulated players.

## Privacy

Repo and site are public. First names only (Mert, Erdem, Marc, Fabian). No descriptions of the friends' character or skill in code, docs or commit messages; Mert passes those to a session directly.

## Tone of the game

Serious, dry, tactical. No goofy jokes. Realistic, present-day look. Not a copy of GTA heists: no casino, no garage, no planning-board cliché.

## Commands

```
npm install
npx playwright-core install chromium-headless-shell   # once per machine: the browser the tests run in
npm run dev          # local dev server
npm run build        # type check + production build into dist/
node tests/kcc.mjs            # movement (pure Node)
node tests/plan-logic.mjs     # planning rules (pure Node)
node tests/plan.mjs           # planning round, 4 players + solo (browser)
node tests/shots-prep.mjs     # one screenshot per preparation step (--size 1440x900 --size 1280x720)
node tests/lineup.mjs         # role voting (browser)
node tests/smoke-levels.mjs hq casino   # every level boots (browser)
node tests/e2e.mjs            # big 4-player run of the old foundation (browser)
./scripts/deploy.sh  # build and force-push dist/ to gh-pages (the public site)
```

`NV_DIST=1` in front of a browser test runs it against the production build. The tests run in Playwright's headless shell with the real GPU, never in the installed Chrome (started headless, it made macOS jump to the desktop with Mert's Chrome windows on every run). They may run in parallel (each has its own ports) and keep running while source files are edited (the test server does not watch files or hot-reload). `NV_HEADED=1` shows the windows (uses the installed browser), `NV_CHROME=<path>` picks a browser, `NV_SOFTWARE=1` forces software rendering. Known gap: the two voice-mesh checks of `tests/e2e.mjs` fail in the headless shell (not investigated yet).

## Showing Mert a change

The dev server reloads his page on every file edit and throws him back to the main menu, so show him a frozen build instead: `npx vite build --outDir dist-review`, then the preview config `heist-review` (http://localhost:4173, `.claude/launch.json`). `?plan=1&to=<brief|scout|facts|shop|plan>` jumps a solo job straight to that preparation step with 60-minute timers (`&seed=<n>` fixes the job). Look at the screenshots yourself before he sees anything.

## Hard rules (each caused a visible bug)

- The number of lights is fixed when a level is built: create all lights at build time, change only intensity later.
- Create all materials at build time; preload textures and models before a level is built.
- Never push the player capsule into the floor.
- Host owns the world state; secrets (hidden facts, other players' offers) never go into replicated state.

## Git

`main` is the source, `gh-pages` the published site (https://derbrane999mm-droid.github.io/heist/). Commit in small steps with clear messages.
