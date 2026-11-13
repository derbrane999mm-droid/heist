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

`LevelDeps`: `engine, physics, audio, mats, interactions, ui, player(): Player | null, options`.
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
`player.frozen = true` stops movement and look (cutscenes, vehicles, mini-game overlays). To carry the player with a vehicle, teleport the body every frame and set the camera in `level.update`.
Roles: `mayAct(session, 'brain' | 'gambler' | 'hands' | 'bait')` is true if I hold the role or nobody present does.

### UI, text, sound

- HUD pieces of a mechanic are their own DOM under `#ui`, built with `h()` from ui.ts, with their own CSS file imported by the module. Do not edit ui.ts or styles.css for a mechanic.
- All player-facing text goes through `t(key)`. Modules add strings with `registerStrings(en, de)` at import time: both languages, same keys. `ui.say(key)` shows a subtitle, `ui.toast(text)`.
- Sound: `audio.play(name, { pos, vol, rate })` for built-ins. For new sounds use the public synth helpers `audio.out(opts, vol)`, `audio.tone(dest, type, f0, f1, t0, dur, peak)`, `audio.burst(dest, filterType, freq, q, t0, dur, peak)` with `audio.ctx.currentTime`. Check `audio.ready` first.

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
- The test machine has no GPU and two cores: software rendering runs at a few frames per second. Keep browser runs short, never run two at once, and allow generous timeouts.
- Look at your level: `node tests/shots.mjs medium` style screenshots into `test-out/`, then open the PNG.
