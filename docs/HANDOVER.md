# Handover

State of the project on 2026-11-14, written at the end of the cloud session that built everything so far. The next block is meant to run in a local Claude Code session on Mert's Mac (M5 Pro, 64 GB), because the cloud sandbox had no GPU, two cores and could not reach the big free asset sites.

- **Play link:** https://derbrane999mm-droid.github.io/heist/
- **Repo:** https://github.com/derbrane999mm-droid/heist (`main` = source, `gh-pages` = published site)
- **Build:** 0.4.0

## What the game is now

One evening (about three hours) for four friends, online, each at home, with built-in voice chat. A crew of amateurs plans and pulls off **one big job, prepared by smaller ones**. The fun is meant to come from thinking and deciding together, not from reflexes:

1. **Lineup:** the crew votes each other into four deliberately negative roles. Internal ids are unchanged from the first version; the meaning is new.
   | id | Role | Voted as | Decides / does |
   |---|---|---|---|
   | `brain` | Der Wortführer | the one who always wants to decide | confirms the crew's choices (scouting, shopping, plan); the only one at safe and alarm panel |
   | `gambler` | Der Zocker | most reckless | sets the stake before the job; takes every all-or-nothing decision |
   | `hands` | Die Hände | worst game mechanics | locks, tools, driving |
   | `bait` | Die Vorhut | most impatient | goes in first, distracts guards or the dog |
2. **Planning round** (`src/game/plan`): stake → briefing with hidden facts → scouting (3 of 6) → shopping on a tight budget → plan (entrance, posts, targets) → the job runs in beats with decisions → accusation → debrief.
3. **Secret offers:** at two moments every player privately gets an offer that helps him and costs the crew or one other player. Nobody is told. Effects leave neutral traces.
4. **Accusation ("Verdacht"):** before the reveal each player may accuse one other player. A hit takes the accused's gain back for the crew; a miss costs the accuser.
5. **Debrief:** accusations, then all offers revealed, then the individual ranking.
6. **Unrest:** the more offers are active at once, the more goes wrong; if everyone accepts everything the job usually fails.

Mert played three versions of the planning round as a single-player web page and approved rules, tone and information density (one sentence, at most two tags, one number per choice; the rest behind "Details"). The prototype source is not in the repo; the TypeScript port in `src/game/plan/logic.ts` reproduces its simulation numbers.

## What exists in the build

- **Main menu, dialogs, HUD, lineup overlay** in the present-day look (`src/ui`). Working title "Der Coup" / "The Job" in `GAME_TITLE` (`src/ui/ui.ts`) and in `index.html`.
- **HQ** (`src/game/levels/hq.ts`, the default level): an empty rented apartment in an old building at night. Players spawn in the hallway. The planning table starts a job (`deps.plan.start()`); the lineup runs first if roles are not assigned. Its camera move is the main-menu background.
- **Planning round in the game for 1–4 players** (`host.ts`, `logic.ts`, `view.ts`, `texts.ts`, `plan.css`): host-side step machine, public state replicated, private host-to-player messages for offers and accusations, bots for empty seats, timers on the host clock. `?plan=1` starts a job right after the session starts; `window.__nv.plan` is the test hook.
- **First-person hands** (`src/game/viewmodel.ts`): gloves, flashlight in the right hand, left hand reaches on E, poses for sprinting and standing close to a wall.
- **Realistic materials and props** (`src/game/realmats.ts`, `src/game/models.ts`, `public/assets`, sources and licences in `public/assets/ASSETS.md`).
- **Casino style sample** (`?level=casino`): the look Mert approved. The casino itself is no longer part of the game (too close to GTA); keep it as a reference for material and light quality.
- **Old sci-fi content, still in the repo and reachable by URL only:** `?level=hideout` (first hub with the crew-check puzzle), `?level=hack` and `?level=range` (mechanic samples). Mert found the hacking sample dull when played alone. Remove or rework; none of it is part of the new game.
- Foundation that everything runs on: crew codes and invite links, synced players, voice chat, graphics presets, EN/DE, saved campaign.

## What is missing (in the order I would do it)

1. **The job in first person.** Right now the job itself is a sequence of decisions on the planning screen. The plan is to replace its beats, one at a time, with playable scenes in the approved look (door, guard, safe, getaway), so there is something playable after every step. This is where a local machine helps most: real GPU, live preview, free assets.
2. **Preparation jobs before the big target.** Decided structure: one big target; the preparation jobs are the crew's strategy, with more possible preparations than nights, so they must choose which information and gear to get. Attention and cash should carry over between jobs (not implemented: the next job starts fresh).
3. **The big target.** Not chosen yet. Not a casino. It stays hidden from Mert.
4. **Planning round, open points:** English texts (German only for now, English falls back to German); "Gleiches Ziel" / "Neues Ziel" / "Zurück zum Einkaufen" from the prototype are not ported; floor-plan labels are only partly language-aware; reconnect during a timer is untested; the host's browser holds all secrets (acceptable among friends, but the host can cheat with dev tools); `__nv.plan.controller.debugMachine` exposes them on the host and should not ship in the final build.
5. **Balance notes from the simulation (5,000 runs each):** careful informed crew without offers 90.8 % success (target was about 85 %); "All-in" punishes careful crews hard (26 %); accepting one offer pays for a careful player, accepting everything does not; about a quarter of accepted offers are caught by an accusation.
6. **HQ polish:** duffel bags, jackets and sleeping bags are simple shapes; the sleeping corner is dark.
7. **Other players' bodies** are still the old sci-fi avatars.
8. **Never tested with real people:** connection between two different home networks including voice; relay (TURN) fallback for strict routers (needs a free account); Safari.
9. **Spoken lines:** research in `tools/voice/`; Mert has not picked a voice.

## Decisions that are settled

- Genre and length as above; first person; realistic present-day look; serious, dry, tactical tone.
- Secret offers are revealed in the debrief (not kept secret forever).
- Roles are negative on purpose; voting stays; one role each.
- Individual ranking is shown; no extra punishment for the last place.
- Medium jump scares and chase sequences are welcome in the first-person part.
- Mert steers taste, Claude decides technology. Small steps with something to look at.

## Rejected directions (do not propose again)

A wave shooter ("a zombie mode with fewer resources"), a pure party/quiz game, the casino as target, a car workshop as HQ, long sit-down puzzles, goofy humour.

## How the work was organised

- Independent parts were built by cheaper-model agents in separate git worktrees (`style/ui`, `style/hq`, `feat/plan`, all merged) and reviewed before merging.
- Every visual change was checked on screenshots (`tests/shots-*.mjs`).
- Abandoned branches with half-built mechanics: `mech/driving`, `mech/stealth` (never committed, exist only in the old sandbox; ignore).

## First steps for a local session

1. `npm install`, `npm run dev`, open the preview: main menu over the HQ, create a crew, walk to the planning table, press E. Play one job alone with bots to see the whole loop.
2. Make `tests/harness.mjs` use the local Chrome with GPU and drop the `flock` serialisation; run `node tests/plan-logic.mjs`, `node tests/plan.mjs`, `node tests/lineup.mjs`, `node tests/smoke-levels.mjs hq casino`.
3. Ask Mert for the private notes about the four players (they are deliberately not in this repo) and for his verdict on the playable build.
4. Then start item 1 above with one scene, show it, and continue from his verdict.
