// Calibration sample "guard": an office floor at night. A watchman with a torch walks
// his round through the corridors around the central office. Reach the marked file
// in the north corridor without being spotted. Being spotted sends the crew back to
// the lobby and counts a fail. Two marked hiding spots: a coat niche in the east
// corridor and the dark corner of the office.
//
// Open with ?level=guard&diff=1..3 (1..3 guards, faster and sharper-eyed with each step).
// The guard system itself lives in ../mech/guard.ts.
import * as THREE from 'three';
import { Builder } from '../build';
import type { Level, LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Anchor } from '../mech/skill';
import { registerStrings, t } from '../../core/i18n';
import { createGuards, guardHooks, type GuardEvent } from '../mech/guard';
import { clampDiff, guardCount } from '../mech/guard-logic';

registerStrings(
  {
    'gdl.obj.goal': 'Reach the marked file in the north corridor without being spotted',
    'gdl.obj.hint': 'The night watchman walks his round with a torch. Stay out of his light, crouch (C), hide in the marked spots and listen for his steps',
    'gdl.obj.fails': 'Spotted so far: {n}',
    'gdl.obj.caught': 'He saw you. Back to the lobby',
    'gdl.obj.done': 'File reached unseen',
  },
  {
    'gdl.obj.goal': 'Erreicht die markierte Akte im Nordflur, ohne gesehen zu werden',
    'gdl.obj.hint': 'Der Nachtwächter geht seine Runde mit der Taschenlampe. Bleibt aus seinem Licht, duckt euch (C), versteckt euch an den markierten Stellen und hört auf seine Schritte',
    'gdl.obj.fails': 'Bisher entdeckt: {n}',
    'gdl.obj.caught': 'Er hat euch gesehen. Zurück in die Lobby',
    'gdl.obj.done': 'Akte unentdeckt erreicht',
  },
);

interface GdlState {
  fails: number;
  t0: number;
  /** bumps on every reset: each peer puts himself back in the lobby */
  reset: number;
  done: boolean;
  /** host clock of the last alert, 0 = none pending */
  caught: number;
}

const H = 3.0;
const T = 0.3; // wall thickness
// building: x -12..12, z -10.5 (north) .. 13 (south)
//   lobby       z 7..13 (spawn), door at x -1..1
//   south hall  z 2..7     east hall x 8..12     north hall z -10.5..-6     west hall x -12..-8
//   office      x -8..8, z -6..2, doors at x 3..4.4 (south) and x -4.4..-3 (north)
const GOAL = { x: 0, y: 0, z: -9.6 };
const HIDE: Anchor[] = [
  { x: 11.45, y: 0, z: 0, r: 0.85 }, // coat niche, east hall
  { x: -6.9, y: 0, z: 0.9, r: 1.0 }, // dark corner of the office
];
const LOOP: Anchor[] = [
  { x: -10, y: 0, z: 4.5 },
  { x: 10, y: 0, z: 4.5 },
  { x: 10, y: 0, z: 0, yaw: -Math.PI / 2 }, // stops and shines into the coat niche
  { x: 10, y: 0, z: -8.3 },
  { x: -10, y: 0, z: -8.3 },
];
const SPAWNS: [number, number][] = [
  [-4, 11],
  [4, 11],
  [-5.5, 10],
  [5.5, 10],
];

export function createCalibGuard(deps: LevelDeps): Level {
  const { engine, physics, mats, ui } = deps;
  const m = mats;
  const b = new Builder(engine.scene, physics, mats, engine.quality);
  const diff = clampDiff(deps.options.diff);
  let session: Session | null = null;
  const unsubs: (() => void)[] = [];

  engine.scene.background = new THREE.Color(0x020306);
  engine.scene.fog = new THREE.FogExp2(0x03050a, 0.035);

  // ======================================================================
  // Shell
  // ======================================================================
  b.box(m.floor, 24.6, 0.3, 24.1, 0, -0.15, 1.25, { tile: 3 });
  b.box(m.ceiling, 24.6, 0.3, 24.1, 0, H + 0.15, 1.25, { tile: 3 });
  const wall = (x0: number, z0: number, x1: number, z1: number, mat = m.concrete) => {
    const sx = Math.abs(x1 - x0) || T;
    const sz = Math.abs(z1 - z0) || T;
    b.box(mat, sx, H, sz, (x0 + x1) / 2, H / 2, (z0 + z1) / 2, { tile: 2 });
  };
  const lintel = (x0: number, x1: number, z: number) => b.box(m.concrete, x1 - x0, H - 2.2, T, (x0 + x1) / 2, 2.2 + (H - 2.2) / 2, z, { tile: 1 });
  // outer walls
  wall(-12.15, -10.65, 12.15, -10.65);
  wall(-12.15, 13.15, 12.15, 13.15);
  wall(-12.15, -10.65, -12.15, 13.15);
  wall(12.15, -10.65, 12.15, 13.15);
  // lobby wall with its door
  wall(-12, 7, -1, 7);
  wall(1, 7, 12, 7);
  lintel(-1, 1, 7);
  // office
  wall(-8, 2, 3, 2, m.panel);
  wall(4.4, 2, 8, 2, m.panel);
  lintel(3, 4.4, 2);
  wall(-8, -6, -4.4, -6, m.panel);
  wall(-3, -6, 8, -6, m.panel);
  lintel(-4.4, -3, -6);
  wall(-8, -6, -8, 2, m.panel);
  wall(8, -6, 8, 2, m.panel);
  // coat niche in the east hall: two short partitions from the outer wall
  wall(11, -1.05, 12, -1.05, m.panel);
  wall(11, 1.05, 12, 1.05, m.panel);
  b.box(m.steel, 0.04, 0.04, 1.9, 11.75, 1.85, 0, { collide: false });
  for (const z of [-0.6, -0.15, 0.4]) b.box(m.black, 0.12, 0.85, 0.42, 11.7, 1.35, z, { collide: false });

  // skirting along the halls (reads as an office corridor)
  b.box(m.darkMetal, 24, 0.1, 0.03, 0, 0.05, 6.83, { collide: false, shadow: false });
  b.box(m.darkMetal, 24, 0.1, 0.03, 0, 0.05, -10.48, { collide: false, shadow: false });

  // ======================================================================
  // Furniture
  // ======================================================================
  const desk = (x: number, z: number, rot = 0) => {
    b.box(m.panel, 1.6, 0.05, 0.8, x, 0.74, z, { rotY: rot, collide: false });
    b.box(m.darkMetal, 1.5, 0.72, 0.05, x, 0.36, z + (rot ? 0 : 0.35), { rotY: rot });
    b.box(m.black, 0.5, 0.32, 0.03, x, 0.95, z - 0.2, { rotY: rot, collide: false });
    b.box(m.rubber, 0.5, 0.5, 0.5, x, 0.25, z - 0.7, { rotY: rot });
  };
  desk(-2, -1.5);
  desk(1, -1.5);
  desk(-2, -4);
  desk(1, -4);
  desk(5, -3);
  // tall cabinets that shade the office corner
  for (const z of [-0.2, 0.75]) b.box(m.darkMetal, 0.6, 2.0, 0.9, -5.6, 1.0, z, { round: 0.02 });
  b.box(m.darkMetal, 2.2, 1.9, 0.5, -6.9, 0.95, -1.3, { round: 0.02 });
  // south hall: benches and a vending machine
  b.box(m.darkMetal, 2.2, 0.45, 0.5, -5, 0.225, 6.5);
  b.box(m.darkMetal, 2.2, 0.45, 0.5, 6, 0.225, 6.5);
  b.box(m.black, 0.9, 1.9, 0.8, -11.3, 0.95, 2.6);
  b.glowBox(0x7fb8ff, 0.62, 1.2, 0.02, -10.84, 1.15, 2.6, 1.4, Math.PI / 2);
  // north hall: filing cabinets, the goal file on top of one
  for (const x of [-6, -4.5, 3, 4.5, 6]) b.box(m.steel, 1.2, 1.3, 0.6, x, 0.65, -10.15, { round: 0.02 });
  b.box(m.steel, 1.4, 1.0, 0.6, 0, 0.5, -10.15, { round: 0.02 });
  b.box(m.hazard, 0.36, 0.06, 0.26, 0, 1.03, -10.1, { collide: false });
  b.glowBox(0xffb347, 0.02, 0.02, 0.26, 0.17, 1.065, -10.1, 2);
  // goal ring on the floor
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb347, emissiveIntensity: 1.6, transparent: true, opacity: 0.85 });
  b.trackGlow(ringMat);
  const ring = b.mesh(new THREE.RingGeometry(0.85, 0.95, 48).rotateX(-Math.PI / 2), ringMat, GOAL.x, 0.012, GOAL.z + 0.4);
  ring.castShadow = false;
  // hiding spots: a faint dashed outline on the floor
  const hideMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6fa8ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.55 });
  for (const hs of HIDE) {
    const r = hs.r ?? 1;
    for (let i = 0; i < 16; i += 2) {
      const geo = new THREE.RingGeometry(r - 0.04, r, 6, 1, (i / 16) * Math.PI * 2, (Math.PI * 2) / 16).rotateX(-Math.PI / 2);
      b.mesh(geo, hideMat, hs.x, 0.011, hs.z).castShadow = false;
    }
  }

  // windows in the north wall: moonlight
  for (const x of [-9, -3, 3, 9]) {
    b.glowBox(0x8fb2e8, 1.6, 1.1, 0.03, x, 1.9, -10.48, 0.55);
    b.box(m.black, 1.7, 0.06, 0.08, x, 1.32, -10.46, { collide: false });
  }
  // green exit sign above the lobby door
  b.glowBox(0x30ff8a, 0.5, 0.18, 0.03, 0, 2.55, 6.83, 3);
  b.glowBox(0x30ff8a, 0.5, 0.18, 0.03, 0, 2.55, 7.17, 3);

  // ======================================================================
  // Lights: night, mostly dark
  // ======================================================================
  b.hemisphere(0x56688a, 0x0d0c0b, 0.34);
  b.point(0x30ff8a, 2.2, 0, 2.4, 6.4, 5);
  b.point(0x30ff8a, 1.6, 0, 2.4, 7.6, 5);
  b.point(0x8fb2e8, 4, -6, 2.1, -9.6, 7);
  b.point(0x8fb2e8, 4, 6, 2.1, -9.6, 7);
  b.point(0x7fb8ff, 3, -10.4, 1.4, 2.6, 4.5);
  b.point(0xffb347, 2.4, 0, 1.6, -9.5, 3.5);
  b.point(0xc8d4ff, 6, 0, 2.7, 10.5, 9); // lobby night light
  b.point(0xffc48a, 1.5, 5, 1.3, -3, 3); // a monitor left on

  b.finalize();
  engine.captureEnvironment(new THREE.Vector3(0, 1.6, 4.5), 0.6);

  // ======================================================================
  // Guards
  // ======================================================================
  const n = guardCount(diff);
  const rot = (r: Anchor[], k: number) => r.slice(k).concat(r.slice(0, k));
  const routes = [LOOP, rot(LOOP, 3), rot(LOOP.slice().reverse(), 2)].slice(0, n);
  const guards = createGuards(deps, { routes, hide: HIDE, seed: 1 });
  const hooks = guardHooks.get(guards)!;
  const events: GuardEvent[] = [];
  let noFail = false;
  guards.onEvent((e) => {
    events.push(e);
    if (events.length > 50) events.shift();
    const s = session;
    if (!s || !s.isHost || e.type !== 'alert' || noFail) return;
    const st = s.get<GdlState>('gdl');
    if (st && !st.done && !st.caught) s.set('gdl.caught', s.hostNow());
  });

  // ======================================================================
  // Session
  // ======================================================================
  let lastReset = -1;
  const myIndex = () => {
    const s = session;
    if (!s) return 0;
    return Math.max(0, [...s.players.keys()].indexOf(s.pid));
  };
  const backToLobby = () => {
    const p = deps.player();
    if (!p) return;
    const sp = level.spawn(myIndex());
    p.teleport(sp.pos, sp.yaw);
  };
  const attach = (s: Session) => {
    session = s;
    events.length = 0;
    guards.attach(s);
    if (s.isHost) {
      if (!s.get('gdl')) s.set('gdl', { fails: 0, t0: s.hostNow(), reset: 0, done: false, caught: 0 } satisfies GdlState);
      guards.setActive(true);
    }
    lastReset = s.get<GdlState>('gdl')?.reset ?? 0;
    unsubs.push(
      s.onState((path) => {
        if (path !== '' && !path.startsWith('gdl')) return;
        const st = s.get<GdlState>('gdl');
        if (st && st.reset !== lastReset) {
          lastReset = st.reset;
          backToLobby();
        }
      }),
    );
  };
  const detach = () => {
    guards.detach();
    for (const u of unsubs) u();
    unsubs.length = 0;
    session = null;
  };

  const hostScript = (s: Session) => {
    const st = s.get<GdlState>('gdl');
    if (!st || st.done) return;
    if (st.caught && s.hostNow() - st.caught > 2500) {
      s.set('gdl', { ...st, fails: st.fails + 1, reset: st.reset + 1, caught: 0 });
      guards.setActive(false);
      guards.setActive(true);
      return;
    }
    if (st.caught) return;
    for (const pid of s.players.keys()) {
      const p = s.poseOf(pid);
      if (!p || Math.hypot(p.x - GOAL.x, p.z - (GOAL.z + 0.4)) > 1.1) continue;
      const timeMs = Math.round(s.hostNow() - st.t0);
      const stars = st.fails === 0 ? 3 : st.fails <= 2 ? 2 : 1;
      s.set('gdl.done', true);
      s.set('calib.result', { level: 'guard', diff, timeMs, fails: st.fails, stars });
      guards.setActive(false);
      ui.toast(t('gdl.obj.done'));
      break;
    }
  };

  const update = (dt: number, time: number) => {
    const s = session;
    if (s && s.isHost) hostScript(s);
    ringMat.emissiveIntensity = (1.3 + Math.sin(time * 2.2) * 0.5) * b.getPower();
    b.updateShadows(time);
    guards.update(dt, time);
  };

  const level: Level & { debug: Record<string, unknown> } = {
    spawn(index: number) {
      const [x, z] = SPAWNS[index % SPAWNS.length];
      return { pos: new THREE.Vector3(x, 0.02, z), yaw: 0 };
    },
    menuCamera(time, cam) {
      cam.position.set(-9.5 + Math.sin(time * 0.07) * 0.4, 1.7, 5.6);
      cam.lookAt(4, 1.2, 3.5);
    },
    attach,
    detach,
    update,
    objective() {
      const s = session;
      if (!s) return [];
      const st = s.get<GdlState>('gdl');
      if (!st) return [t('gdl.obj.goal')];
      if (st.done) return [t('gdl.obj.done')];
      if (st.caught) return [t('gdl.obj.caught')];
      const out = [t('gdl.obj.goal'), t('gdl.obj.hint')];
      if (st.fails) out.push(t('gdl.obj.fails', { n: st.fails }));
      return out;
    },
    redraw() {},
    // hooks for tests/guard.mjs (window.__nv.level.debug)
    debug: {
      guards,
      hooks,
      events,
      diff,
      goal: GOAL,
      hide: HIDE,
      loop: LOOP,
      state: () => guards.debugState(),
      hold: (on: boolean) => hooks.hold(on),
      place: (i: number, x: number, z: number, yaw: number) => hooks.place(i, x, z, yaw),
      noFail: (on: boolean) => (noFail = on),
    },
  };
  return level;
}
