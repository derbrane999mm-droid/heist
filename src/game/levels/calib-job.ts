// Test level "job": a flat yard with labelled anchor posts and dummy skill games, so a whole first-person
// job (src/game/job) can be played without the real location. Start a job with ?level=job&plan=1 or from
// the console (`__nv.plan.start()`).
//
// The dummy skill games show a small card: [E] success, [Q] failure, [X] give up. Tests use
// `__nv.level.games.<id>.debugFinish(ok)`; `__nv.level.guards.fire()` makes the dummy guard raise the alarm.
import * as THREE from 'three';
import { Builder, FONT } from '../build';
import type { Level, LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Anchors, SkillGame, SkillRequest, SkillResult } from '../mech/skill';
import type { GuardSystemLike } from '../job/types';
import { registerStrings, t } from '../../core/i18n';
import { h } from '../../ui/ui';
import '../job/job.css';

registerStrings(
  {
    'jbl.obj': 'Test yard for the first-person job: start a job at any time',
    'jbl.card': 'TEST {game} · {variant} · difficulty {d}',
    'jbl.keys': '[E] success   [Q] failure   [X] give up',
  },
  {
    'jbl.obj': 'Testgelände für den Einsatz in der Ich-Perspektive: jederzeit einen Job starten',
    'jbl.card': 'TEST {game} · {variant} · Stufe {d}',
    'jbl.keys': '[E] geschafft   [Q] gepatzt   [X] aufgeben',
  },
);

/** The test yard's places (y = floor). Same keys as the real location. */
export const JOB_TEST_ANCHORS: Anchors = {
  van: { x: 0, y: 0, z: 12, yaw: 0, r: 1.6 },
  'van.driver': { x: -3, y: 0, z: 12.5, yaw: 0, r: 1 },
  'post.lookout': { x: -9, y: 0, z: 9, yaw: -0.4, r: 1.2 },
  gate: { x: 0, y: 0, z: 7, yaw: 0, r: 1.5 },
  'door.liefer': { x: -6, y: 0, z: 2, yaw: 0, r: 1.3 },
  'door.vorder': { x: 6, y: 0, z: 2, yaw: 0, r: 1.3 },
  'in.dach': { x: 0, y: 0, z: 1, yaw: 0, r: 1.3 },
  safe: { x: 0, y: 0, z: -10, yaw: 0, r: 1.3 },
  'case.0': { x: -7, y: 0, z: -8, yaw: 0, r: 1.5 },
  'lager.goods': { x: 7, y: 0, z: -8, yaw: 0, r: 1.5 },
};

/** A keyboard-driven stand-in for a real skill game (src/game/mech/skill.ts contract). */
function dummyGame(deps: LevelDeps, id: string): SkillGame {
  const el = h('div', { class: 'jb-hud jbl-card hidden' });
  el.style.top = '45%';
  document.getElementById('ui')!.append(el);
  let cur: { req: SkillRequest; done: (r: SkillResult) => void; t0: number } | null = null;
  const finish = (r: Partial<SkillResult>) => {
    const c = cur;
    if (!c) return;
    cur = null;
    el.classList.add('hidden');
    c.done({ ok: false, seconds: (performance.now() - c.t0) / 1000, noise: 0, fumbles: 0, ...r });
  };
  return {
    id,
    start(req, done) {
      cur = { req, done, t0: performance.now() };
      el.innerHTML = `<div class="jb-beat">${t('jbl.card', { game: req.game.toUpperCase(), variant: req.variant, d: req.difficulty })}</div><div class="jb-obj">${t('jbl.keys')}</div>`;
      el.classList.remove('hidden');
    },
    cancel() {
      cur = null;
      el.classList.add('hidden');
    },
    active: () => !!cur,
    update() {
      if (!cur) return;
      const inp = deps.input;
      if (inp.codePressed('KeyE')) finish({ ok: true });
      else if (inp.codePressed('KeyQ')) finish({ ok: false, fumbles: 1, noise: 2 });
      else if (inp.codePressed('KeyX')) finish({ ok: false, gaveUp: true });
    },
    debugFinish(ok) {
      finish({ ok });
    },
  };
}

export function createCalibJob(deps: LevelDeps): Level {
  const { engine, physics, mats: m } = deps;
  const b = new Builder(engine.scene, physics, m, engine.quality);
  engine.scene.background = new THREE.Color(0x0b0d10);
  engine.scene.fog = new THREE.FogExp2(0x0b0d10, 0.025);

  b.box(m.floor, 40, 0.3, 40, 0, -0.15, 0, { tile: 4 });
  // a low "building" outline between the doors and the targets
  b.box(m.concrete, 26, 3, 0.4, 0, 1.5, 0, { tile: 3 });
  const doorGap = (x: number) => b.box(m.darkMetal, 0.2, 3, 0.5, x, 1.5, 0.05, { collide: false });
  doorGap(-7.2);
  doorGap(-4.8);
  doorGap(4.8);
  doorGap(7.2);
  // doors that slide up when the director opens them; the wall around them has gaps
  const doors: Record<string, { mesh: THREE.Mesh; col: unknown; open: boolean; amt: number }> = {};
  for (const [id, x] of [['liefer', -6], ['vorder', 6]] as const) {
    const mesh = b.mesh(new THREE.BoxGeometry(2.2, 2.6, 0.2), m.steel, x, 1.3, 0.3);
    doors[id] = { mesh, col: b.collider(x, 1.3, 0.3, 2.2, 2.6, 0.2, 0), open: false, amt: 0 };
  }
  // labelled posts at every anchor
  const signs: (() => void)[] = [];
  for (const [key, a] of Object.entries(JOB_TEST_ANCHORS)) {
    b.box(m.steel, 0.08, 2.2, 0.08, a.x + 0.9, 1.1, a.z, { collide: false });
    b.glowBox(0xf2d27a, 0.6, 0.02, 0.6, a.x, 0.02, a.z, 1.2);
    const sc = b.screen(1.4, 0.35, a.x + 0.9, 2.4, a.z + 0.06, 0, 160, (c, w, hh) => {
      c.fillStyle = '#111';
      c.fillRect(0, 0, w, hh);
      c.fillStyle = '#f2d27a';
      c.font = `600 ${Math.round(hh * 0.55)}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(key.toUpperCase(), w / 2, hh / 2);
    });
    signs.push(() => sc.redraw());
  }
  b.hemisphere(0xb6c0cc, 0x1a1712, 0.9);
  b.point(0xffe3b0, 30, 0, 6, 6, 30);
  b.point(0xffe3b0, 30, 0, 6, -8, 30);
  b.finalize();
  for (const s of signs) s();
  engine.captureEnvironment(new THREE.Vector3(0, 1.6, 6), 0.8);

  const games: Record<string, SkillGame> = { lock: dummyGame(deps, 'lock'), safe: dummyGame(deps, 'safe') };
  let guardsOn = false;
  const guards: GuardSystemLike & { fire(): void } = {
    onAlert: null,
    activate(v: boolean) {
      guardsOn = v;
    },
    fire() {
      if (guardsOn) guards.onAlert?.();
    },
  };
  const unregister = deps.plan?.registerStage?.({
    anchors: JOB_TEST_ANCHORS,
    games,
    guards,
    openDoor(id, open) {
      const d = doors[id];
      if (d) d.open = open;
    },
  });
  void unregister;

  let session: Session | null = null;
  const level: Level & Record<string, unknown> = {
    spawn(i) {
      return { pos: new THREE.Vector3(-1.5 + i, 0.02, 15), yaw: 0 };
    },
    menuCamera(time, cam) {
      cam.position.set(Math.sin(time * 0.1) * 3, 4, 18);
      cam.lookAt(0, 1, 0);
    },
    attach(s) {
      session = s;
    },
    detach() {
      session = null;
      for (const d of Object.values(doors)) d.open = false;
    },
    update(dt, time) {
      for (const d of Object.values(doors)) {
        const target = d.open ? 1 : 0;
        if (d.amt === target) continue;
        d.amt += Math.sign(target - d.amt) * Math.min(Math.abs(target - d.amt), dt * 1.2);
        d.mesh.position.y = 1.3 + d.amt * 2.4;
        physics.setEnabled(d.col as never, d.amt < 0.5);
      }
      b.updateShadows(time);
      void session;
    },
    objective() {
      return deps.plan?.running() ? [] : [t('jbl.obj')];
    },
    redraw() {
      for (const s of signs) s();
    },
    /** test hooks */
    games,
    guards,
    doors: () => Object.fromEntries(Object.entries(doors).map(([k, d]) => [k, d.open])),
  };
  return level;
}
