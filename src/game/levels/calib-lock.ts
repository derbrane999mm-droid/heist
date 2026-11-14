// Test level "lock": one small room with a locked door. Look at the door and press E to start the lock
// picking game (src/game/mech/lock.ts). The result is shown as a toast and kept on `window.__nv.lockResult`.
//
// Open with ?level=lock&diff=1..3 [&variant=door|case] [&seed=<n>] [&limit=<seconds>].
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Builder } from '../build';
import type { Level, LevelDeps } from '../level';
import type { Session } from '../../net/session';
import { registerStrings, t } from '../../core/i18n';
import { createLockGame } from '../mech/lock';
import { toDiff, toVariant } from '../mech/lock-logic';
import type { SkillResult } from '../mech/skill';

registerStrings(
  {
    'lkl.obj': 'The door is locked: pick it',
    'lkl.obj.open': 'The door is open',
    'lkl.prompt': 'pick the lock',
    'lkl.ok': 'Lock open in {s} s, {n} slips',
    'lkl.fail': 'The lock held ({n} slips)',
    'lkl.gaveUp': 'You gave up on the lock',
  },
  {
    'lkl.obj': 'Die Tür ist verschlossen: Knack das Schloss',
    'lkl.obj.open': 'Die Tür ist offen',
    'lkl.prompt': 'Schloss knacken',
    'lkl.ok': 'Schloss offen nach {s} s, {n} Fehlversuche',
    'lkl.fail': 'Das Schloss hat gehalten ({n} Fehlversuche)',
    'lkl.gaveUp': 'Du hast das Schloss aufgegeben',
  },
);

const HX = 4;
const HZ = 4;
const H = 3;
const DOOR_W = 1.3;
const DOOR_H = 2.3;

const nvHook = () => (window as unknown as { __nv?: Record<string, unknown> }).__nv;

export function createCalibLock(deps: LevelDeps): Level {
  const { engine, physics, mats, interactions, ui } = deps;
  const m = mats;
  const b = new Builder(engine.scene, physics, mats, engine.quality);
  const diff = toDiff(deps.options.diff);
  const variant = toVariant(deps.options.variant);
  const seedN = Number(deps.options.seed);
  const seed = deps.options.seed !== undefined && deps.options.seed !== '' && Number.isFinite(seedN) ? seedN >>> 0 : 4711;
  const limit = Math.max(0, Number(deps.options.limit) || 0);

  engine.scene.background = new THREE.Color(0x050505);
  engine.scene.fog = new THREE.FogExp2(0x0a0908, 0.04);

  // room: x -4..4, z -4 (north, the door) .. 4 (south, spawn)
  b.box(m.floor, HX * 2 + 0.8, 0.3, HZ * 2 + 0.8, 0, -0.15, 0, { tile: 3 });
  b.box(m.ceiling, HX * 2 + 0.8, 0.3, HZ * 2 + 0.8, 0, H + 0.15, 0, { tile: 3 });
  b.box(m.concrete, HX * 2 + 0.8, H, 0.4, 0, H / 2, HZ + 0.2, { tile: 3 });
  b.box(m.concrete, HX * 2 + 0.8, H, 0.4, 0, H / 2, -HZ - 0.2, { tile: 3 });
  b.box(m.concrete, 0.4, H, HZ * 2 + 0.8, HX + 0.2, H / 2, 0, { tile: 3 });
  b.box(m.concrete, 0.4, H, HZ * 2 + 0.8, -HX - 0.2, H / 2, 0, { tile: 3 });
  // door frame and the glow behind the leaf once it is open
  b.box(m.steel, 0.12, DOOR_H + 0.12, 0.16, -DOOR_W / 2 - 0.06, (DOOR_H + 0.12) / 2, -HZ + 0.08, { collide: false });
  b.box(m.steel, 0.12, DOOR_H + 0.12, 0.16, DOOR_W / 2 + 0.06, (DOOR_H + 0.12) / 2, -HZ + 0.08, { collide: false });
  b.box(m.steel, DOOR_W + 0.24, 0.12, 0.16, 0, DOOR_H + 0.06, -HZ + 0.08, { collide: false });
  const openGlow = m.glow(0x6fbf73, 0);
  b.box(openGlow, DOOR_W - 0.1, DOOR_H - 0.1, 0.02, 0, DOOR_H / 2, -HZ + 0.01, { collide: false, shadow: false });
  // a crate and a bench so the room is not empty
  b.box(m.panel, 1.1, 0.9, 0.8, -2.6, 0.45, 1.2, { tile: 1.5, round: 0.03 });
  b.box(m.darkMetal, 2.2, 0.08, 0.6, 2.4, 0.9, -3.5, { tile: 1.5 });
  b.box(m.steel, 0.08, 0.9, 0.5, 1.4, 0.45, -3.5);
  b.box(m.steel, 0.08, 0.9, 0.5, 3.4, 0.45, -3.5);

  // the door leaf (moves) with its lock plate
  const leaf = b.mesh(new RoundedBoxGeometry(DOOR_W, DOOR_H, 0.08, 3, 0.02), m.darkMetal, 0, DOOR_H / 2, -HZ + 0.1);
  const plate = b.mesh(new RoundedBoxGeometry(0.16, 0.3, 0.05, 3, 0.015), m.steel, 0.46, -0.1, 0.06, leaf);
  b.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 16), m.black, 0.46, -0.1, 0.09, leaf).rotation.x = Math.PI / 2;
  void plate;

  b.hemisphere(0x9a9487, 0x14110d, 0.3);
  b.spot(0xffe3b0, 120, 0, H - 0.1, 0.5, 0, 0, -3, { angle: 0.8, penumbra: 0.8, distance: 9, shadow: true });
  b.point(0xe9b63a, 8, 0, 2.5, -2.8, 6);
  b.finalize();
  engine.captureEnvironment(new THREE.Vector3(0, 1.6, 0), 0.9);

  // ---------------------------------------------------------------- the game
  const lock = createLockGame(deps);
  let opened = false;
  let openAmt = 0;
  let session: Session | null = null;

  const finished = (r: SkillResult) => {
    const dbg = { ...r, diff, variant, seed };
    const nv = nvHook();
    if (nv) nv.lockResult = dbg;
    if (r.gaveUp) ui.toast(t('lkl.gaveUp'), 'warn');
    else if (r.ok) ui.toast(t('lkl.ok', { s: r.seconds.toFixed(1), n: r.fumbles }));
    else ui.toast(t('lkl.fail', { n: r.fumbles }), 'warn');
    if (r.ok) opened = true;
  };

  interactions.add({
    id: 'lock.door',
    object: leaf,
    range: 3.2,
    prompt: () => (opened || lock.active() || !deps.player() ? null : t('lkl.prompt')),
    onUse: () => {
      if (opened || lock.active() || !deps.player()) return;
      const nv = nvHook();
      if (nv) delete nv.lockResult;
      lock.start({ game: 'lock', variant, difficulty: diff, seed, tools: [], timeLimit: limit }, finished);
    },
  });

  const level: Level & { lock: unknown } = {
    spawn() {
      return { pos: new THREE.Vector3(0, 0.02, 2.6), yaw: 0 };
    },
    menuCamera(time, cam) {
      cam.position.set(Math.sin(time * 0.1) * 0.6, 1.65, 2.8);
      cam.lookAt(0, 1.3, -4);
    },
    attach(s: Session) {
      session = s;
    },
    detach() {
      lock.cancel();
      session = null;
    },
    update(dt, time) {
      b.updateShadows(time);
      lock.update(dt, time);
      const target = opened ? 1 : 0;
      openAmt += Math.sign(target - openAmt) * Math.min(Math.abs(target - openAmt), dt * 0.8);
      leaf.position.y = DOOR_H / 2 + openAmt * (DOOR_H - 0.1);
      openGlow.emissiveIntensity = openAmt * 1.5;
      void session;
    },
    objective() {
      return [t(opened ? 'lkl.obj.open' : 'lkl.obj')];
    },
    redraw() {},
    /** Test hooks (`window.__nv.level.lock`): the game itself and its debug helpers. */
    lock,
  };
  return level;
}
