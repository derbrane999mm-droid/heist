// The night watchman: one to three guards walk a loop of waypoints with a torch.
// The host simulates them (rules in ./guard-logic.ts); clients only draw them.
//
//   const guards = createGuards(deps, { routes, hide, walls })   // in the level factory
//   attach: guards.attach(session)   detach: guards.detach()   update: guards.update(dt, time)
//   guards.setActive(true) when the job starts (host decides; replicated as state `gd.on`)
//   guards.onEvent((e) => ...)  'suspicious' | 'alert' | 'calm', fired on every peer
//   guards.noise(x, z, r) / guards.distract(x, z): host acts directly, a client sends an intent
//
// Networking: state `gd.on` (reliable), cast `gd` at 10 Hz with absolute guard poses and the
// detection meters (unreliable, late joiners pick it up with the next packet), event `gd.ev`
// for state changes (reliable).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import './guard.css';
import type { LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Anchor } from './skill';
import { FLAG_CROUCH, FLAG_LIGHT, FLAG_MOVING } from '../player';
import { registerStrings, t, onLangChange } from '../../core/i18n';
import { h } from '../../ui/ui';
import { createSim, resetSim, step as simStep, noise as simNoise, distract as simDistract, ST_ALERT, ST_SUSPICIOUS, type Sim, type Watched, type SenseCtx } from './guard-logic';

registerStrings(
  { 'gd.hud.seen': 'Noticed', 'gd.hud.alert': 'Spotted' },
  { 'gd.hud.seen': 'Bemerkt', 'gd.hud.alert': 'Entdeckt' },
);

export interface GuardEvent {
  type: 'suspicious' | 'alert' | 'calm';
  guard: number;
  pid?: string;
  x: number;
  z: number;
}
export interface GuardSystem {
  attach(session: Session): void;
  detach(): void;
  update(dt: number, time: number): void;
  setActive(on: boolean): void;
  noise(x: number, z: number, radius: number): void;
  distract(x: number, z: number): boolean;
  onEvent(cb: (e: GuardEvent) => void): void;
  debugState(): unknown;
}
export interface GuardOptions {
  routes: Anchor[][];
  hide?: Anchor[];
  walls?: { x: number; z: number; sx: number; sz: number }[];
  speed?: number;
  eyeHeight?: number;
  seed?: number;
}

/** Test hooks (tests/guard.mjs via the calibration level). Not part of the director's API. */
export interface GuardHooks {
  /** host: stop walking and turning (senses keep working) */
  hold(on: boolean): void;
  /** host: put guard i at (x, z) looking along yaw, calm */
  place(i: number, x: number, z: number, yaw: number): void;
  sim(): Sim;
}
export const guardHooks = new WeakMap<GuardSystem, GuardHooks>();

const CAST_HZ = 10;
const INTERP_DELAY = 0.13;
const BEAM_LEN = 7;
const TORCH_TILT = 0.24;
const STRIDE = 0.72;

interface Snap {
  t: number;
  g: number[];
}
interface View {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  torch: THREE.Group;
  beam: THREE.Mesh;
  pool: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  yaw: number;
  st: number;
  mode: number;
  phase: number;
  amp: number;
  stepAcc: number;
  lx: number;
  lz: number;
  has: boolean;
}

function lerpAngle(a: number, b: number, k: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function createGuards(deps: LevelDeps, opts: GuardOptions): GuardSystem {
  const { engine, physics, audio } = deps;
  const routes = opts.routes.filter((r) => r.length > 0).slice(0, 3);
  const sim = createSim({
    routes: routes.map((r) => r.map((a) => ({ x: a.x, y: a.y, z: a.z, yaw: a.yaw }))),
    hide: (opts.hide ?? []).map((a) => ({ x: a.x, z: a.z, r: a.r ?? 1 })),
    walls: opts.walls ?? [],
    eyeHeight: opts.eyeHeight ?? 1.62,
    diff: deps.options.diff,
    speed: opts.speed,
  });

  // ======================================================================
  // Look: a night watchman in a dark uniform jacket and peaked cap, torch in his right hand
  // ======================================================================
  const jacketMat = new THREE.MeshStandardMaterial({ color: 0x232c3e, roughness: 0.8, metalness: 0.02, emissive: 0x0a0e16, emissiveIntensity: 1 });
  const trouserMat = new THREE.MeshStandardMaterial({ color: 0x1a1e27, roughness: 0.85, emissive: 0x07090d, emissiveIntensity: 1 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xa47a62, roughness: 0.66, emissive: 0x1a0f0a, emissiveIntensity: 1 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x1a2130, roughness: 0.6, emissive: 0x080b12, emissiveIntensity: 1 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.42, metalness: 0.1 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x24252a, roughness: 0.35, metalness: 0.75 });
  const badgeMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.9 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff0d0, emissiveIntensity: 7, roughness: 0.3 });
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xffe6bf) }, uOpacity: { value: 0.12 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying float vH;
      void main() {
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV; varying float vH;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float fall = pow(vH, 1.6) * smoothstep(0.0, 0.05, 1.0 - vH + 0.02);
        gl_FragColor = vec4(uColor * edge * fall * uOpacity, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // the lit spot on the floor: a soft radial gradient, additive
  const poolTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,236,205,1)');
    grd.addColorStop(0.45, 'rgba(255,226,185,0.45)');
    grd.addColorStop(1, 'rgba(255,220,180,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  })();
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffffff, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

  const limbGeo = (r: number, len: number) => {
    const g = new THREE.CapsuleGeometry(r, len - r * 2, 5, 12);
    g.translate(0, -len / 2, 0);
    return g;
  };
  const thighGeo = limbGeo(0.082, 0.9);
  const armGeo = limbGeo(0.064, 0.6);
  const bootGeo = new RoundedBoxGeometry(0.13, 0.1, 0.29, 2, 0.035);
  const handGeo = new THREE.SphereGeometry(0.05, 10, 8);
  const torsoGeo = new RoundedBoxGeometry(0.46, 0.58, 0.27, 3, 0.09);
  const pelvisGeo = new RoundedBoxGeometry(0.37, 0.2, 0.24, 2, 0.06);
  const beltGeo = new THREE.BoxGeometry(0.385, 0.055, 0.255);
  const collarGeo = new THREE.CylinderGeometry(0.085, 0.1, 0.07, 14);
  const neckGeo = new THREE.CylinderGeometry(0.052, 0.058, 0.1, 12);
  const headGeo = new THREE.SphereGeometry(0.105, 18, 14);
  const noseGeo = new THREE.BoxGeometry(0.03, 0.045, 0.04);
  const earGeo = new THREE.SphereGeometry(0.025, 8, 6);
  const crownGeo = new THREE.CylinderGeometry(0.125, 0.108, 0.075, 20);
  const bandGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.035, 20);
  const brimGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.012, 16, 1, false, -Math.PI / 2, Math.PI);
  const badgeGeo = new THREE.BoxGeometry(0.035, 0.03, 0.01);
  const patchGeo = new THREE.BoxGeometry(0.06, 0.04, 0.01);
  const radioGeo = new RoundedBoxGeometry(0.06, 0.12, 0.04, 1, 0.012);
  const torchGeo = new THREE.CylinderGeometry(0.024, 0.02, 0.24, 12);
  torchGeo.translate(0, 0.12, 0);
  const headLampGeo = new THREE.CylinderGeometry(0.036, 0.026, 0.06, 14);
  headLampGeo.translate(0, 0.27, 0);
  const lensGeo = new THREE.CircleGeometry(0.031, 16);
  lensGeo.rotateX(-Math.PI / 2);
  lensGeo.translate(0, 0.301, 0);
  // the light shaft: apex at the lens, opening along +y of the torch
  const beamGeo = new THREE.ConeGeometry(1.05, BEAM_LEN, 32, 1, true);
  beamGeo.rotateX(Math.PI);
  beamGeo.translate(0, BEAM_LEN / 2, 0);
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    parent.add(m);
    return m;
  };

  const views: View[] = routes.map(() => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const leg = (sx: number) => {
      const g = new THREE.Group();
      g.position.set(sx * 0.1, 0.93, 0);
      add(g, thighGeo, trouserMat, 0, 0, 0);
      add(g, bootGeo, leatherMat, 0, -0.88, -0.045);
      body.add(g);
      return g;
    };
    const legL = leg(-1);
    const legR = leg(1);
    add(body, pelvisGeo, trouserMat, 0, 0.98, 0);
    add(body, torsoGeo, jacketMat, 0, 1.25, 0);
    add(body, beltGeo, leatherMat, 0, 1.0, 0);
    add(body, collarGeo, jacketMat, 0, 1.55, 0);
    add(body, neckGeo, skinMat, 0, 1.6, 0);
    add(body, badgeGeo, badgeMat, -0.12, 1.4, -0.14, false);
    add(body, radioGeo, leatherMat, 0.13, 1.42, -0.13, false);
    const head = new THREE.Group();
    head.position.set(0, 1.64, 0);
    body.add(head);
    const skull = add(head, headGeo, skinMat, 0, 0.08, 0);
    skull.scale.set(0.92, 1.1, 1);
    add(head, noseGeo, skinMat, 0, 0.065, -0.104, false);
    for (const sx of [-1, 1]) add(head, earGeo, skinMat, sx * 0.095, 0.07, 0.005, false).scale.set(0.5, 1, 0.8);
    add(head, bandGeo, leatherMat, 0, 0.145, 0);
    add(head, crownGeo, capMat, 0, 0.19, 0.005);
    const brim = add(head, brimGeo, leatherMat, 0, 0.13, -0.075);
    brim.rotation.x = 0.16;
    add(head, patchGeo, badgeMat, 0, 0.2, -0.122, false);
    const arm = (sx: number) => {
      const g = new THREE.Group();
      g.position.set(sx * 0.29, 1.49, 0);
      add(g, armGeo, jacketMat, 0, 0, 0);
      add(g, handGeo, skinMat, 0, -0.62, 0);
      body.add(g);
      return g;
    };
    const armL = arm(-1);
    const armR = arm(1);
    armR.rotation.x = 0.95; // holds the torch out in front
    armR.rotation.z = 0.12;
    // the torch sits in the right hand, pointing ahead and a little down
    const torch = new THREE.Group();
    torch.position.set(0, -0.62, 0);
    armR.add(torch);
    add(torch, torchGeo, metalMat, 0, -0.06, 0);
    add(torch, headLampGeo, metalMat, 0, -0.06, 0);
    add(torch, lensGeo, lensMat, 0, -0.06, 0, false);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, 0.24, 0);
    beam.renderOrder = 5;
    beam.frustumCulled = false;
    torch.add(beam);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.renderOrder = 4;
    root.add(pool);
    root.visible = false;
    engine.scene.add(root);
    return { root, body, head, legL, legR, armL, armR, torch, beam, pool, x: 0, y: 0, z: 0, yaw: 0, st: 0, mode: 0, phase: 0, amp: 0, stepAcc: 0, lx: 0, lz: 0, has: false };
  });

  // ======================================================================
  // HUD: an eye with an arc that fills while you are being noticed
  // ======================================================================
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'gd-eye');
  svg.innerHTML =
    '<circle class="gd-track" cx="32" cy="32" r="27" pathLength="100"/>' +
    '<circle class="gd-fill" cx="32" cy="32" r="27" pathLength="100" transform="rotate(-90 32 32)"/>' +
    '<path class="gd-lid" d="M14 32 Q32 17 50 32 Q32 47 14 32 Z"/>' +
    '<circle class="gd-pupil" cx="32" cy="32" r="5.5"/>';
  const fillArc = svg.querySelector('.gd-fill') as SVGCircleElement;
  const label = h('span', { class: 'gd-label' });
  const hud = h('div', { class: 'gd-hud gd-hidden' }, svg as unknown as HTMLElement, label);
  {
    const uiRoot = document.getElementById('ui');
    if (uiRoot) uiRoot.insertBefore(hud, uiRoot.querySelector('.menu'));
  }
  const hudState = { shown: false, red: false, fill: -1, label: '' };
  onLangChange(() => (hudState.label = '\0'));

  // ======================================================================
  // Sound: footsteps in 3D
  // ======================================================================
  const stepPos = new THREE.Vector3();
  const footstep = (x: number, y: number, z: number, loud: number) => {
    if (!audio.ready || audio.ctx.state !== 'running') return;
    const cam = engine.camera.position;
    if ((cam.x - x) ** 2 + (cam.z - z) ** 2 > 28 * 28) return;
    const t0 = audio.ctx.currentTime;
    stepPos.set(x, y + 0.05, z);
    const out = audio.out({ pos: stepPos }, 0.9 * loud);
    const r = 0.85 + Math.random() * 0.3;
    audio.burst(out, 'lowpass', 520 * r, 0.9, t0, 0.13, 0.55);
    audio.burst(out, 'bandpass', 2400 * r, 1.4, t0 + 0.004, 0.04, 0.14);
  };

  // ======================================================================
  // Host simulation
  // ======================================================================
  let session: Session | null = null;
  const unsubs: (() => void)[] = [];
  const cbs: ((e: GuardEvent) => void)[] = [];
  let localOn = false;
  let castT = 0;
  let seq = 0;
  let lastSeq = -1;
  const snaps: Snap[] = [];
  let netMeters: Record<string, number> = {};
  let netAlert: string[] = [];

  const vO = new THREE.Vector3();
  const vD = new THREE.Vector3();
  const selfCollider = () => deps.player()?.body.collider;
  const clearRay = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, slack: number): boolean => {
    vD.set(bx - ax, by - ay, bz - az);
    const dist = vD.length();
    if (dist < 0.05) return true;
    vD.multiplyScalar(1 / dist);
    const hit = physics.raycast(vO.set(ax, ay, az), vD, dist, selfCollider());
    return hit === null || hit > dist - slack;
  };
  const ctx: SenseCtx = {
    los: (gx, gy, gz, p) => {
      const chest = p.y + (p.crouch ? 0.7 : 1.15);
      const head = p.y + (p.crouch ? 0.95 : 1.6);
      return clearRay(gx, gy, gz, p.x, head, p.z, 0.35) || clearRay(gx, gy, gz, p.x, chest, p.z, 0.35);
    },
    path: (ax, az, bx, bz, y) => clearRay(ax, y + 0.5, az, bx, y + 0.5, bz, 0.25) && clearRay(ax, y + 1.3, az, bx, y + 1.3, bz, 0.25),
  };

  interface Track {
    x: number;
    z: number;
    wx: number;
    wz: number;
    wt: number;
    speed: number;
  }
  const tracks = new Map<string, Track>();
  const watched: Watched[] = [];
  const gather = (s: Session, dt: number) => {
    watched.length = 0;
    for (const pid of s.players.keys()) {
      const pose = s.poseOf(pid);
      if (!pose) continue;
      let tr = tracks.get(pid);
      if (!tr) {
        tr = { x: pose.x, z: pose.z, wx: pose.x, wz: pose.z, wt: 0, speed: 0 };
        tracks.set(pid, tr);
      }
      tr.wt += dt;
      if (tr.wt >= 0.25) {
        const d = Math.hypot(pose.x - tr.wx, pose.z - tr.wz);
        tr.speed = d > 3 ? 0 : d / tr.wt; // a jump of 3 m is a teleport
        tr.wx = pose.x;
        tr.wz = pose.z;
        tr.wt = 0;
      }
      watched.push({
        pid,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        crouch: (pose.flags & FLAG_CROUCH) !== 0,
        moving: (pose.flags & FLAG_MOVING) !== 0,
        light: (pose.flags & FLAG_LIGHT) !== 0,
        speed: tr.speed,
      });
    }
  };

  const fire = (e: GuardEvent) => {
    for (const cb of cbs) {
      try {
        cb(e);
      } catch (err) {
        console.warn('guard event handler', err);
      }
    }
  };
  const flushEvents = (s: Session) => {
    if (!sim.events.length) return;
    for (const e of sim.events.splice(0)) s.emit('gd.ev', e);
  };

  const isOn = () => (session ? session.get<boolean>('gd.on') === true : localOn);

  const sendCast = (s: Session) => {
    const g: number[] = [];
    const p: string[] = [];
    for (const gu of sim.guards) {
      g.push(Math.round(gu.x * 100), Math.round(gu.y * 100), Math.round(gu.z * 100), Math.round(gu.yaw * 1000), gu.st, gu.mode);
      p.push(gu.st === ST_ALERT ? gu.pid : '');
    }
    const m: [string, number][] = [];
    for (const pid in sim.meters) if (sim.meters[pid] > 0) m.push([pid, Math.round(sim.meters[pid] * 100)]);
    s.cast('gd', { q: ++seq, g, p, m });
  };

  const onPacket = (d: { q: number; g: number[]; p: string[]; m: [string, number][] }) => {
    if (!d || !Array.isArray(d.g) || d.q <= lastSeq) return;
    lastSeq = d.q;
    snaps.push({ t: performance.now() / 1000, g: d.g });
    if (snaps.length > 8) snaps.shift();
    const m: Record<string, number> = {};
    for (const [pid, v] of d.m ?? []) m[pid] = v / 100;
    netMeters = m;
    netAlert = d.p ?? [];
  };

  const resetViews = () => {
    for (const v of views) v.has = false;
    snaps.length = 0;
    lastSeq = -1;
    netMeters = {};
    netAlert = [];
  };

  // ======================================================================
  // Drawing
  // ======================================================================
  const tmp = { x: 0, y: 0, z: 0, yaw: 0, st: 0, mode: 0 };
  /** Where guard i should be drawn now: the simulation on the host, interpolated snapshots on a client. */
  const target = (i: number): boolean => {
    const s = session;
    if (!s || s.isHost) {
      const g = sim.guards[i];
      tmp.x = g.x;
      tmp.y = g.y;
      tmp.z = g.z;
      tmp.yaw = g.yaw;
      tmp.st = g.st;
      tmp.mode = g.mode;
      return true;
    }
    if (!snaps.length) return false;
    const rt = performance.now() / 1000 - INTERP_DELAY;
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let k = snaps.length - 1; k >= 0; k--) {
      if (snaps[k].t <= rt) {
        a = snaps[k];
        b = snaps[Math.min(k + 1, snaps.length - 1)];
        break;
      }
    }
    const o = i * 6;
    if (a.g.length < o + 6 || b.g.length < o + 6) return false;
    const k = b.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t))) : 1;
    tmp.x = (a.g[o] + (b.g[o] - a.g[o]) * k) / 100;
    tmp.y = (a.g[o + 1] + (b.g[o + 1] - a.g[o + 1]) * k) / 100;
    tmp.z = (a.g[o + 2] + (b.g[o + 2] - a.g[o + 2]) * k) / 100;
    tmp.yaw = lerpAngle(a.g[o + 3] / 1000, b.g[o + 3] / 1000, k);
    tmp.st = b.g[o + 4];
    tmp.mode = b.g[o + 5];
    return true;
  };

  const beamDir = new THREE.Vector3();
  const lensPos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const drawGuard = (v: View, i: number, dt: number, time: number, on: boolean) => {
    if (!on || !target(i)) {
      v.root.visible = false;
      v.has = false;
      return;
    }
    v.root.visible = true;
    if (!v.has) {
      v.has = true;
      v.lx = tmp.x;
      v.lz = tmp.z;
      v.x = tmp.x;
      v.z = tmp.z;
      v.yaw = tmp.yaw;
    }
    v.x = tmp.x;
    v.y = tmp.y;
    v.z = tmp.z;
    v.yaw = tmp.yaw;
    v.st = tmp.st;
    v.mode = tmp.mode;
    const moved = Math.hypot(v.x - v.lx, v.z - v.lz);
    v.lx = v.x;
    v.lz = v.z;
    const speed = dt > 0 ? Math.min(3, moved / dt) : 0;
    v.amp += (Math.min(1, speed / 1.2) - v.amp) * (1 - Math.exp(-8 * dt));
    if (moved < 1) {
      v.phase += (moved / STRIDE) * Math.PI;
      v.stepAcc += moved;
      if (v.stepAcc >= STRIDE) {
        v.stepAcc -= STRIDE;
        footstep(v.x, v.y, v.z, 1);
      }
    }
    v.root.position.set(v.x, v.y, v.z);
    v.root.rotation.y = v.yaw;
    const sw = Math.sin(v.phase);
    const a = v.amp;
    v.legL.rotation.x = sw * 0.42 * a;
    v.legR.rotation.x = -sw * 0.42 * a;
    v.armL.rotation.x = -sw * 0.32 * a;
    v.armR.rotation.x = 0.95 + sw * 0.05 * a;
    v.body.position.y = (Math.abs(Math.cos(v.phase)) - 0.6) * 0.035 * a;
    v.body.rotation.y = sw * 0.04 * a;
    // looking around: the head leads, an idle guard breathes
    const looking = v.mode === 4 ? Math.sin(time * 1.9 + i) * 0.35 : 0;
    v.head.rotation.y += (looking - v.head.rotation.y) * (1 - Math.exp(-5 * dt));
    v.head.rotation.x = v.st === ST_SUSPICIOUS || v.st === ST_ALERT ? 0.06 : 0.12;
    // the torch points ahead and a little down whatever the arm does (+y of the torch is the beam)
    v.torch.rotation.set(-Math.PI / 2 - TORCH_TILT - v.armR.rotation.x + 0.015 * Math.sin(time * 1.3 + i), 0, -0.12);

    // the beam stops at the first wall, the floor spot only shows where the beam reaches the floor
    v.root.updateMatrixWorld(true);
    v.torch.getWorldPosition(lensPos);
    v.torch.getWorldQuaternion(quat);
    beamDir.set(0, 1, 0).applyQuaternion(quat);
    const hit = physics.raycast(lensPos, beamDir, BEAM_LEN, selfCollider());
    const len = hit === null ? BEAM_LEN : Math.max(0.3, hit);
    v.beam.scale.setScalar(len / BEAM_LEN);
    const floorT = beamDir.y < -0.02 ? (lensPos.y - v.y) / -beamDir.y : Infinity;
    if (floorT <= len + 0.2) {
      const px = lensPos.x + beamDir.x * floorT;
      const pz = lensPos.z + beamDir.z * floorT;
      // into the root's local frame
      const dx = px - v.x;
      const dz = pz - v.z;
      const c = Math.cos(-v.yaw);
      const s = Math.sin(-v.yaw);
      v.pool.position.set(dx * c - dz * s, 0.025, dx * s + dz * c);
      const r = 0.35 + floorT * 0.19;
      v.pool.scale.set(r * 2, 1, r * 3.2);
      v.pool.visible = true;
    } else v.pool.visible = false;
  };

  const drawHud = () => {
    const s = session;
    const on = isOn();
    let m = 0;
    let red = false;
    if (s && on) {
      if (s.isHost) {
        m = sim.meters[s.pid] ?? 0;
        red = sim.guards.some((g) => g.st === ST_ALERT && g.pid === s.pid);
      } else {
        m = netMeters[s.pid] ?? 0;
        red = netAlert.includes(s.pid);
      }
    }
    if (m >= 1) red = true;
    const shown = m > 0.01 || red;
    if (shown !== hudState.shown) {
      hudState.shown = shown;
      hud.classList.toggle('gd-hidden', !shown);
    }
    if (red !== hudState.red) {
      hudState.red = red;
      hud.classList.toggle('gd-red', red);
    }
    const f = red ? 100 : Math.round(m * 100);
    if (f !== hudState.fill) {
      hudState.fill = f;
      fillArc.style.strokeDashoffset = String(100 - f);
      svg.style.setProperty('--gd-open', String(0.35 + 0.65 * Math.min(1, m)));
    }
    const lab = red ? t('gd.hud.alert') : t('gd.hud.seen');
    if (lab !== hudState.label) {
      hudState.label = lab;
      label.textContent = lab;
    }
  };

  // ======================================================================
  // API
  // ======================================================================
  let lastOn = false;
  const api: GuardSystem = {
    attach(s: Session) {
      session = s;
      castT = 0;
      seq = 0;
      tracks.clear();
      resetViews();
      resetSim(sim);
      unsubs.push(
        s.onEvent((name, args) => {
          if (name === 'gd.ev' && args && typeof args.type === 'string') fire(args as GuardEvent);
        }),
        s.onCast((name, data) => {
          if (name === 'gd' && !s.isHost) onPacket(data);
        }),
      );
      if (s.isHost) {
        s.set('gd.on', localOn);
        s.handle('gd.noise', (_pid, a) => {
          if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(a.r)) return;
          api.noise(a.x, a.z, Math.min(25, Math.max(0, a.r)));
        });
        s.handle('gd.distract', (_pid, a) => {
          if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z)) return;
          api.distract(a.x, a.z);
        });
      }
      lastOn = isOn();
    },

    detach() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      if (session?.isHost) {
        session.handle('gd.noise', () => {});
        session.handle('gd.distract', () => {});
      }
      session = null;
      resetViews();
      resetSim(sim);
      for (const v of views) v.root.visible = false;
      hudState.shown = false;
      hud.classList.add('gd-hidden');
    },

    update(dt: number, time: number) {
      const s = session;
      const on = isOn();
      if (on !== lastOn) {
        lastOn = on;
        if (on && (!s || s.isHost)) resetSim(sim);
        if (!on) resetViews();
      }
      if (s && s.isHost && on) {
        gather(s, dt);
        simStep(sim, Math.min(dt, 0.1), watched, ctx);
        flushEvents(s);
        castT += dt;
        if (castT >= 1 / CAST_HZ) {
          castT = 0;
          sendCast(s);
        }
      }
      for (let i = 0; i < views.length; i++) drawGuard(views[i], i, dt, time, on);
      drawHud();
    },

    setActive(on: boolean) {
      localOn = on;
      const s = session;
      if (s && s.isHost && (s.get<boolean>('gd.on') === true) !== on) s.set('gd.on', on);
    },

    noise(x: number, z: number, radius: number) {
      const s = session;
      if (!s || !isOn()) return;
      if (!s.isHost) {
        s.intent('gd.noise', { x, z, r: radius });
        return;
      }
      simNoise(sim, x, z, radius, ctx);
      flushEvents(s);
    },

    distract(x: number, z: number): boolean {
      const s = session;
      if (!s || !isOn()) return false;
      if (!s.isHost) {
        // the host applies the cooldown; the answer here is optimistic
        s.intent('gd.distract', { x, z });
        return true;
      }
      const ok = simDistract(sim, x, z, ctx);
      flushEvents(s);
      return ok;
    },

    onEvent(cb: (e: GuardEvent) => void) {
      cbs.push(cb);
    },

    debugState() {
      const s = session;
      const host = !s || s.isHost;
      return {
        on: isOn(),
        host,
        guards: views.map((v, i) => {
          const g = sim.guards[i];
          if (host) return { x: g.x, y: g.y, z: g.z, yaw: g.yaw, st: g.st, mode: g.mode, visible: v.root.visible };
          return { x: v.x, y: v.y, z: v.z, yaw: v.yaw, st: v.st, mode: v.mode, visible: v.root.visible };
        }),
        meters: host ? { ...sim.meters } : { ...netMeters },
        me: s ? (host ? (sim.meters[s.pid] ?? 0) : (netMeters[s.pid] ?? 0)) : 0,
        cooldown: host ? Math.max(0, sim.tun.distractCooldown - (sim.t - sim.lastDistract)) : 0,
        hud: { shown: hudState.shown, red: hudState.red, label: hudState.label },
      };
    },
  };

  guardHooks.set(api, {
    hold(on: boolean) {
      sim.hold = on;
    },
    place(i: number, x: number, z: number, yaw: number) {
      const g = sim.guards[i];
      if (!g) return;
      g.x = x;
      g.z = z;
      g.yaw = yaw;
      g.st = 0;
      g.mode = 0;
      g.trail = [];
      g.legs = [];
    },
    sim: () => sim,
  });
  return api;
}
