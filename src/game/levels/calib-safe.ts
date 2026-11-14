// Test level "safe": a small room with a safe. Look at it, press E: the safe game opens.
// Open with ?level=safe&variant=mech|elek|drill&diff=1..3 (optional &seed=<n>, &limit=<seconds>).
// The last result is shown as a toast and kept in `window.__nv.level.safe.result()` for the tests.
import * as THREE from 'three';
import { Builder } from '../build';
import type { Level, LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { SkillResult } from '../mech/skill';
import { createSafeGame } from '../mech/safe';
import * as L from '../mech/safe-logic';
import { t, registerStrings } from '../../core/i18n';

registerStrings(
  {
    'sfl.prompt': 'open the safe',
    'sfl.obj': 'Open the safe',
    'sfl.res.ok': 'Safe open after {s} s. Noise {n}, slips {f}.',
    'sfl.res.fail': 'Failed after {s} s. Noise {n}, slips {f}.',
    'sfl.res.gaveup': 'You walked away from the safe.',
  },
  {
    'sfl.prompt': 'den Tresor öffnen',
    'sfl.obj': 'Öffne den Tresor',
    'sfl.res.ok': 'Tresor offen nach {s} s. Lärm {n}, Patzer {f}.',
    'sfl.res.fail': 'Gescheitert nach {s} s. Lärm {n}, Patzer {f}.',
    'sfl.res.gaveup': 'Du hast den Tresor stehen lassen.',
  },
);

const HX = 4;
const HZ = 4;
const H = 3;

export function createCalibSafe(deps: LevelDeps): Level {
  const { engine, physics, mats, interactions, ui } = deps;
  const m = mats;
  const b = new Builder(engine.scene, physics, mats, engine.quality);
  const variant = L.toVariant(deps.options.variant);
  const diff = L.toDiff(deps.options.diff);
  const seedOpt = Number(deps.options.seed);
  const seed = deps.options.seed !== undefined && deps.options.seed !== '' && Number.isFinite(seedOpt) ? seedOpt >>> 0 : 1234;
  const limit = Math.max(0, Number(deps.options.limit) || 0);
  const game = createSafeGame(deps);
  let session: Session | null = null;
  let result: SkillResult | null = null;
  let runs = 0;

  engine.scene.background = new THREE.Color(0x050505);

  // room
  b.box(m.floor, HX * 2 + 0.8, 0.3, HZ * 2 + 0.8, 0, -0.15, 0, { tile: 3 });
  b.box(m.ceiling, HX * 2 + 0.8, 0.3, HZ * 2 + 0.8, 0, H + 0.15, 0, { tile: 3 });
  b.box(m.concrete, HX * 2 + 0.8, H, 0.4, 0, H / 2, HZ + 0.2, { tile: 3 });
  b.box(m.concrete, HX * 2 + 0.8, H, 0.4, 0, H / 2, -HZ - 0.2, { tile: 3 });
  b.box(m.concrete, 0.4, H, HZ * 2 + 0.8, HX + 0.2, H / 2, 0, { tile: 3 });
  b.box(m.concrete, 0.4, H, HZ * 2 + 0.8, -HX - 0.2, H / 2, 0, { tile: 3 });
  b.box(m.panel, HX * 2, 1.1, 0.06, 0, 0.55, -HZ + 0.03, { tile: 2, collide: false });

  // the safe: body (static), door (aimed at), handle, dial and keypad
  const SZ = -HZ + 0.6;
  b.box(m.vault, 1.1, 1.5, 0.9, 0, 0.75, SZ, { tile: 1, round: 0.03 });
  b.box(m.darkMetal, 1.18, 0.08, 0.98, 0, 1.54, SZ, { tile: 1, round: 0.02, collide: false });
  const door = b.mesh(new THREE.BoxGeometry(0.94, 1.3, 0.06), m.steel, 0, 0.78, SZ + 0.47);
  b.mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 28).rotateX(Math.PI / 2), m.black, -0.18, 0.95, SZ + 0.52);
  b.mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 28).rotateX(Math.PI / 2), m.darkMetal, -0.18, 0.95, SZ + 0.55);
  b.mesh(new THREE.BoxGeometry(0.22, 0.34, 0.04), m.black, 0.22, 1.0, SZ + 0.51);
  b.glowBox(0x6fbf73, 0.18, 0.04, 0.012, 0.22, 1.12, SZ + 0.535, 2.4);
  b.mesh(new THREE.BoxGeometry(0.06, 0.34, 0.07), m.darkMetal, 0.3, 0.5, SZ + 0.52);
  b.mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 14).rotateZ(Math.PI / 2), m.darkMetal, 0.2, 0.5, SZ + 0.56);
  b.box(m.panel, 1.3, 0.08, 1.1, 0, 0.04, SZ, { tile: 1, collide: false });
  // a table with a bag, so the room is not bare
  b.box(m.darkMetal, 1.2, 0.05, 0.6, -2.6, 0.78, -2.5, { tile: 1 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(m.darkMetal, 0.05, 0.76, 0.05, -2.6 + sx * 0.52, 0.38, -2.5 + sz * 0.24, { tile: 1, collide: false });
  b.box(m.rubber, 0.5, 0.3, 0.32, -2.5, 0.98, -2.5, { round: 0.05, collide: false });

  b.hemisphere(0x8fa0b8, 0x15110d, 0.35);
  b.spot(0xe8f0ff, 170, 0, H - 0.1, 0, 0, 0.8, -HZ + 0.8, { angle: 0.75, penumbra: 0.8, distance: 10, shadow: true });
  b.point(0xffa23a, 8, -2.6, 1.6, -2.5, 5);
  b.point(0xcfe6ff, 7, 0, 2.6, -1.2, 6);
  b.finalize();
  engine.captureEnvironment(new THREE.Vector3(0, 1.7, 0), 1.0);

  const busy = () => game.active();
  interactions.add({
    id: 'safe',
    object: door,
    range: 2.6,
    prompt: () => (busy() ? null : t('sfl.prompt')),
    onUse: () => {
      if (busy()) return;
      game.start({ game: 'safe', variant, difficulty: diff, seed: seed + runs, tools: [], timeLimit: limit }, (r) => {
        result = r;
        runs++;
        ui.toast(r.gaveUp ? t('sfl.res.gaveup') : t(r.ok ? 'sfl.res.ok' : 'sfl.res.fail', { s: r.seconds.toFixed(1), n: r.noise, f: r.fumbles }), r.ok ? '' : 'warn');
      });
    },
  });

  const level: Level & { safe: unknown } = {
    spawn() {
      return { pos: new THREE.Vector3(0, 0.02, 1.6), yaw: 0 };
    },
    menuCamera(time, cam) {
      cam.position.set(Math.sin(time * 0.1) * 0.5, 1.6, 2.2);
      cam.lookAt(0, 0.9, -HZ + 0.6);
    },
    attach(s) {
      session = s;
    },
    detach() {
      game.cancel();
      session = null;
    },
    update(dt, time) {
      b.updateShadows(time);
      game.update(dt, time);
    },
    objective: () => (session ? [t('sfl.obj')] : []),
    redraw() {},
    /** Test hooks (`window.__nv.level.safe`). */
    safe: {
      game,
      logic: L,
      variant,
      diff,
      result: () => result,
      runs: () => runs,
    },
  };
  return level;
}
