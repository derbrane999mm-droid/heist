# NULL VAULT — engine guide for contributors (human or agent)

Read this before adding a mechanic or a level. It lists the APIs you build on and the rules that keep the game smooth. The project doc "null-vault-design-and-status" holds the design; this file is about code.

## Layout

```
src/main.ts                 boot, session flow, frame loop (order below)
src/core/engine.ts          renderer, post-processing, quality presets, warmUp()
src/core/physics.ts         Rapier world, static colliders, CharacterBody
src/core/input.ts           keyboard/mouse, pointer lock, actions
src/core/audio.ts           procedural sound (no audio files)
src/core/i18n.ts            t(key), registerStrings(en, de)
src/core/settings.ts        per-player settings (localStorage)
src/core/save.ts            quest progress (host copy + mirrors)
src/net/session.ts          host-authoritative networking over WebRTC
src/net/voice.ts            voice chat mesh
src/game/build.ts           Builder: merged static geometry, lights, screens, decals
src/game/materials.ts       procedural PBR materials (MaterialLib)
src/game/player.ts          first-person controller
src/game/avatar.ts          remote players
src/game/interact.ts        "look at it, press E" interactions
src/game/lineup.ts          role voting, roleOf/holder/mayAct
src/game/plan/              the planning round (one job: stake, scouting, plan, run, debrief)
src/game/level.ts           Level + LevelDeps interfaces
src/game/levels/index.ts    level registry (name -> factory)
src/game/levels/hideout.ts  the hub: a complete worked example
src/ui/ui.ts                menus + HUD, h() DOM helper
tests/harness.mjs           headless Chrome + local signalling for tests
```

Frame order (per simulation step): `player.update` → `interactions.update` → avatars → `level.update(dt, time)` → `physics.step()` → audio listener → HUD. A level may therefore override the camera in `level.update` (it runs after the player wrote it).

## Writing a level

```ts
// src/game/levels/my-level.ts
export function createMyLevel(deps: LevelDeps): Level { ... }
// register it: one line in src/game/levels/index.ts
```

Open it directly with `?level=<name>` (plus `&diff=1..3`): menu → Create crew → you spawn in it. `deps.options` holds the URL parameters.

`LevelDeps`: `engine, physics, audio, mats, interactions, input, ui, player(): Player | null, options`.
`Level`: `spawn(i)`, `menuCamera(t, cam)`, `attach(session)`, `detach()`, `update(dt, time)`, `objective(): string[]`, `redraw()`.

- Build everything in the factory (it runs once at boot, behind the loading screen). `attach` only wires state.
- `attach(session)`: if `session.isHost`, create the level's replicated state with `session.set(...)` and register intent handlers; everyone subscribes with `onState` / `onEvent`. `detach()` must undo all of it and reset visuals.
- The world must render and animate without a session (it is the menu backdrop).

### Builder (src/game/build.ts)

`new Builder(engine.scene, physics, mats, engine.quality)` then:
- `box(mat, sx, sy, sz, x, y, z, { rotY, collide, tile, round, shadow })` static, merged, collider by default
- `cylinder(...)`, `addStatic(mat, geometry)`, `glowBox(color, ..., intensity)` emissive strip
- `mesh(geo, mat, x, y, z, parent?)` for anything that moves
- `collider(x, y, z, sx, sy, sz, rotY)` returns a collider you can `physics.setEnabled(c, bool)`
- `point(...)`, `spot(..., { shadow })`, `hemisphere(...)`, `cone(...)` fake light shaft, `dust(...)`
- `screen(w, h, x, y, z, rotY, pxPerMeter, draw)` canvas screen, `decal(...)`
- `setPower(f)` dims every light/glow/screen made through the builder; `updateShadows(time)` every frame
- `finalize()` once, after all static geometry
- After building: `engine.captureEnvironment(pos, intensity)` for reflections

Materials: `mats.floor, concrete, panel, steel, darkMetal, vault, rubber, plastic, hazard, ceiling, glass, black, glow(color, intensity)`. Text on canvases uses `FONT` / `MONO` from build.ts.

### Session (src/net/session.ts)

The host owns the world. Clients ask; the host decides and replicates.
- `session.isHost`, `session.pid`, `session.players` (Map pid → `{ pid, name, color, host }`)
- `session.set(path, value)` host only, replicated (reliable). `session.get(path)`, `session.onState((path, value) => …)` (path `''` = full snapshot for late joiners)
- `session.intent(name, args)` from anyone → `session.handle(name, (pid, args) => …)` runs on the host. Always validate in the handler.
- `session.emit(name, args)` host → everyone, one-shot (reliable): `session.onEvent(fn)`. Existing events: `sfx { n, p?, r? }`, `say { k }`.
- `session.cast(name, data)` host → clients, unreliable and unordered, for fast-changing data (enemy positions at 10–20 Hz): `session.onCast(fn)`. Send absolute state; packets may drop.
- `session.poseOf(pid)` latest pose of any crew member (`x, y, z` feet, `yaw`, `pitch`, `flags`), available on every peer.
- `session.hostNow()` shared clock in ms: use it for anything timed.
- Late join and rejoin must work: derive visuals from state, not from events alone.

### Interactions

```ts
interactions.add({ id, object, range, prompt: () => string | null, locked: () => string | null,
                   hold, onUse, onHoldStart, onHoldEnd, onFocus });
```
`prompt` null = not usable. `locked` returning text shows that text and blocks use. Tests trigger with `__nv.interactions.debugUse(id, hold?)`.

### Player

`player.position` (feet), `player.eye`, `player.forward`, `player.yaw/pitch`, `player.teleport(pos, yaw?)`, `player.body.collider`.
Input beyond the bound actions: `input.codePressed(code)`, `input.codeHeld(code)`, `input.firePressed()`, `input.fireHeld()` (left mouse). Mini-game overlays are keyboard-driven while the pointer stays locked (no mouse cursor).
`player.frozen = true` stops movement and look (cutscenes, vehicles, mini-game overlays). To carry the player with a vehicle, teleport the body every frame and set the camera in `level.update`.
Roles: `mayAct(session, 'brain' | 'gambler' | 'hands' | 'bait')` is true if I hold the role or nobody present does.

### UI, text, sound

- HUD pieces of a mechanic are their own DOM under `#ui`, built with `h()` from ui.ts, with their own CSS file imported by the module. Do not edit ui.ts or styles.css for a mechanic.
- All player-facing text goes through `t(key)`. Modules add strings with `registerStrings(en, de)` at import time: both languages, same keys. `ui.say(key)` shows a subtitle, `ui.toast(text)`.
- Sound: `audio.play(name, { pos, vol, rate })` for built-ins. For new sounds use the public synth helpers `audio.out(opts, vol)`, `audio.tone(dest, type, f0, f1, t0, dur, peak)`, `audio.burst(dest, filterType, freq, q, t0, dur, peak)` with `audio.ctx.currentTime`. Check `audio.ready` first.

## The planning round (src/game/plan)

One job against the "Auktionshaus Varga", ported from the approved single-player prototype. Rules, texts and look are fixed; change them only with the owner.

- `logic.ts` (no DOM, no imports): the prototype's rules (`newGame`, `doScout`, `buy`, `runJob` generator, `settle`, `accuse`, same random-number order, so `tests/plan-logic.mjs` reproduces the prototype's balance exactly) and `PlanMachine`, the host-side step machine for 1-4 humans. The machine owns everything; `pub()` is the only replicated view (no hidden facts, no offers before the debrief), `priv(role)` is one player's private view (his offer, his tip, his accusation). Seats without a human are played by bots after a short delay; every phase has a deadline and a default.
- `host.ts` (`PlanController`): runs the machine on the host, replicates `pub()` as state `plan`, sends `priv` with `session.sendTo(pid, 'plan.priv', …)` (host to one player only; `session.onPrivate` on the receiver). Players answer with the intent `plan.act`, which only the host sees. `start()` runs the lineup first if a crew of 2+ has no roles; a solo player is the Wortführer.
- `view.ts` + `plan.css`: the overlay. Frees the pointer, freezes the player, keeps push-to-talk working (`talkHeld()`), shows who decides and the timer.
- `texts.ts`: every plan text, keyed. The logic emits `{ k, p }` (key + parameters; `{ r: role }` = that seat's name, `{ e: n }` = money), each client renders in its own language. German only for now; English falls back to German. Not part of i18n.ts.

The preparation steps share one layout (approved by Mert, 2026-11-14: "everything at one glance", minutes in one place only, little text per screen):
- Left, above the floor plan, in every preparation phase: the "Überblick" card (`ov-*`). Rows Alarm, Wache, Tresor, Polizei, each with what the crew knows and a status pill, plus one time bar (how long the plan takes against the window until the guard comes). The host computes it: `overview(S, tools, planFixed)` in `logic.ts`, replicated as `pub().overview`, from `S.known` only. During shopping it judges the shared basket, in the plan step also entrance, posts and targets. Minutes appear in the time bar and nowhere else.
- Right: only what matters for the step, as compact rows; details in a one-line hover info in a fixed footer that also holds the confirm button. Scouting (`sct-*`): six rows, "klärt: …", rows a selected scout will clear show "wird geklärt". Shopping (`shp-*`): "Das fehlt euch noch" (tools that answer open rows, `toolAdvice`), the basket, and one button for the full grouped list. Plan (`pln-*`): entrance, posts, targets, and "Hinweise" for what the Überblick does not show.
- New screens follow the same rule: say in plain words what a choice does, never add a number that the time bar already carries.

Who decides: stake = Zocker (`gambler`); scouting, shopping, entrance and targets = shared board, everyone toggles, the Wortführer (`brain`) confirms; posts = each player his own (the Wortführer also sets bots'); job decisions = the role named in the rules; secret offers and accusations = every human privately, applied only when all answered or the timer ran out.

Starting a job: `deps.plan?.start()` from a level (LevelDeps.plan), `?plan=1` (host starts right after the session starts), or `window.__nv.plan.start()`. `plan.running()` is true until the debrief. Tests: `window.__nvPlanTimes = { board: 90000, … }` shortens or lengthens the phase timers, `window.__nvPlanSeed` fixes the job. The host stores `missions['plan.varga'] = { stars, best }` in the campaign save at the debrief.

Development helper: `?plan=1&to=<brief|scout|facts|shop|plan>[&seed=<n>]` (`PlanController.devJump`) clicks a solo job through to that step with 60-minute timers.

Tests: `node tests/plan-logic.mjs` (rules, balance, privacy of the public view), `node tests/plan.mjs` (4 players + solo), `tests/shots-plan.mjs` (screenshots).

## Rules (each one exists because breaking it caused a visible bug)

1. **Lights are fixed at build time.** Never add, remove, hide or toggle `castShadow` on a light while playing: the light count is baked into every shader, a change recompiles all of them (long hitch). Create every light up front with intensity 0 and change the intensity. Budget per level: 2 shadow spots, about 10 point/spot lights. Use emissive + bloom for the rest.
2. **No new materials or geometries types at runtime.** Create them in the factory so `engine.warmUp()` compiles them behind the loading screen. Pool anything spawned repeatedly (projectiles, sparks, enemies).
3. **Never push the player capsule into the floor** and never move the player with anything but `CharacterBody.move` / `teleport`. See tests/kcc.mjs.
4. **Stairs are ramps** for collision. Step-shaped colliders make movement jerky.
5. **No allocations in per-frame code** where avoidable (reuse vectors).
6. **Host-authoritative, always validated.** A client may only send intents.
7. **Solo must work.** Every challenge is finishable alone (for testing), and with 2–4.
8. **Scares never soft-lock**, timers always have a recovery path.
9. Static geometry goes through the Builder so it merges into a few draw calls.

## Testing

- `npx tsc --noEmit` must be clean, `npm run build` must succeed.
- Browser tests: copy the pattern in tests/lineup.mjs. `startServers({ port, sigPort })` (use your own ports), `openPlayer(env, { name, quality: 'low', width: 420, height: 240, renderSkip: 12, extra: '&level=<name>' })`, then drive the game through `window.__nv` (`start(code)`, `tp(x, y, z, yaw, pitch)`, `input.debugSet(code, down)`, `interactions.debugUse(id)`, `session`, `player`, `level`).
- The harness launches Playwright's headless shell with the real GPU (see CLAUDE.md for the one-time install and for `NV_CHROME`, `NV_SOFTWARE`, `NV_HEADED`). Every test player gets microphone permission: without it the browser offers peer connections only the default route, and test players on one machine cannot reach each other when that route is a VPN. Tests may run in parallel as long as each uses its own ports, also while someone edits `src/`: the test server has no file watcher and no hot reload, so a test always runs the code as it was when its pages loaded. After waiting for a state change on the host, wait for the page you check as well: on a fast machine a client has not redrawn yet.
- Look at your level: `node tests/shots.mjs medium` style screenshots into `test-out/`, then open the PNG.

## Calibration samples (`calib-*` levels)

Throwaway challenges Mert rates to set the difficulty baseline. Conventions:
- Difficulty comes from `deps.options.diff` (`'1' | '2' | '3'`, default 2).
- Failure sends the crew back to the last checkpoint and counts a fail. No hard game-over.
- On completion the host sets `session.set('calib.result', { level, diff, timeMs, fails, stars })` (stars 1–3) and the level shows a short end card.
