# Der Coup (working title)

Online co-op heist game for four friends, played in the browser. Built for Mert, who owns the project and does not program: you do all technical work.

**Read `docs/HANDOVER.md` first** (current state, decisions, next steps), then `docs/ENGINE.md` (engine APIs and hard rules).

## Working with Mert

- Talk to him in German. Short and direct. One clear recommendation with the reason, then smaller alternatives.
- Small steps: build a little, show him something he can look at (local preview, picture, link), get his verdict, continue. Never build a whole block before the first example.
- For taste decisions ask a few short tap-to-answer questions. Technical decisions are yours.
- Larger answers end with a separate status block: `Erledigt` / `Offen` / `Nächster Schritt` / `Braucht deine Entscheidung`.
- Keep token use lean: cheaper models for sub-tasks that do not need the top model, parallel agents for independent parts.
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
npm run dev          # local dev server
npm run build        # type check + production build into dist/
node tests/kcc.mjs            # movement (pure Node)
node tests/plan-logic.mjs     # planning rules (pure Node)
node tests/plan.mjs           # planning round, 4 players + solo (browser)
node tests/lineup.mjs         # role voting (browser)
node tests/smoke-levels.mjs hq casino   # every level boots (browser)
node tests/e2e.mjs            # big 4-player run of the old foundation (browser)
./scripts/deploy.sh  # build and force-push dist/ to gh-pages (the public site)
```

`NV_DIST=1` in front of a browser test runs it against the production build. `tests/harness.mjs` is written for the cloud sandbox this project started in: it launches `/usr/bin/google-chrome` with software rendering and the tests were serialised with `flock /tmp/nv-browser.lock`. On a real machine, point it at the local Chrome, use the GPU, and run tests in parallel.

## Hard rules (each caused a visible bug)

- The number of lights is fixed when a level is built: create all lights at build time, change only intensity later.
- Create all materials at build time; preload textures and models before a level is built.
- Never push the player capsule into the floor.
- Host owns the world state; secrets (hidden facts, other players' offers) never go into replicated state.

## Git

`main` is the source, `gh-pages` the published site (https://derbrane999mm-droid.github.io/heist/). Commit in small steps with clear messages.
