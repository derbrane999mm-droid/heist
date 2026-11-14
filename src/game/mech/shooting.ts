// Shooting against security drones. One reusable mechanic for three flavours
// of gunplay (stealth that can turn loud, arcade waves, tactical fights):
//
//  - EMP pistol: first-person view model, hitscan, magazine of 12, reload.
//  - Pooled drones: `scout` (weak) and `sentinel` (front shield, weak core at
//    the back). Awareness: unaware -> suspicious -> alert, with a vision cone,
//    line of sight and hearing. Unaware drones can be disabled from behind.
//  - Attacks are telegraphed: a charge glow, then a slow visible projectile.
//  - Player health, downed state, revive by a teammate, crew wipe.
//
// Networking: the host simulates drones and projectiles and casts them at
// 15 Hz (absolute state, so late joiners and dropped packets heal themselves);
// clients interpolate. Clients report shots as intents, the host validates
// them and decides every point of damage. Without a session the simulation
// runs locally with no players, so drones patrol behind the main menu.
//
// The rules themselves (tuning, awareness, damage) live in shooting-logic.ts.
//
// Using it from a level (see levels/calib-range.ts):
//   const sh = createShooting(deps, { scouts: 12, sentinels: 2, diff, ceiling: 3.5 });  // in the factory
//   attach:  sh.attach(session)   detach: sh.detach()   update: sh.update(dt, time)
//   host:    sh.spawn({ type: 'scout', x, z, route, group }), sh.clear(), sh.killAll(), sh.shutdown()
//            sh.onWipe = () => { ...restart at the checkpoint...; sh.resetPlayers(); }
//            sh.onAlert = (group) => { ...the lane went loud... }
//   Replicated state lives under `sh.*`, intents and events are named `sh.*` too.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import './shooting.css';
import type { LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Input } from '../../core/input';
import { FLAG_CROUCH } from '../player';
import { registerStrings, t, onLangChange } from '../../core/i18n';
import { h } from '../../ui/ui';
import {
  type DroneType,
  type HitPart,
  type Tuning,
  ST_UNAWARE,
  ST_SUSPICIOUS,
  ST_ALERT,
  ST_DYING,
  ST_OFF,
  PLAYER_HP,
  REVIVE_HP,
  REVIVE_TIME,
  REVIVE_RANGE,
  TAKEDOWN_TIME,
  TAKEDOWN_RANGE,
  MAG_SIZE,
  RELOAD_TIME,
  FIRE_INTERVAL,
  AUTO_INTERVAL,
  MAX_RANGE,
  EYE_STAND,
  EYE_CROUCH,
  BODY_STAND,
  BODY_CROUCH,
  PLAYER_RADIUS,
  SCOUT_HP,
  SENTINEL_HP,
  SCOUT_RADIUS,
  SENTINEL_RADIUS,
  VIEW_HALF,
  tuning,
  projectileDamage,
  forwardX,
  forwardZ,
  viewRange,
  inViewCone,
  sightFactor,
  moveNoise,
  stepAwareness,
  canTakedown,
  resolveHit,
  regen,
  raySphere,
  segmentHitsCapsule,
  angleDelta,
  turnTowards,
  yawTo,
} from './shooting-logic';

registerStrings(
  {
    'sh.hp': 'Vitals',
    'sh.ammo': 'EMP pistol',
    'sh.reload': 'Recharging',
    'sh.aw.hidden': 'Hidden',
    'sh.aw.sus': 'Suspicious',
    'sh.aw.spotted': 'Spotted',
    'sh.down.title': 'You are down',
    'sh.down.wait': 'A crew member can get you back up: stand next to you and hold E.',
    'sh.down.by': '{name} is getting you back up',
    'sh.down.wipe': 'Whole crew down. Back to the checkpoint…',
    'sh.prompt.revive': 'Hold: get {name} back up',
    'sh.prompt.takedown': 'Hold: shut the drone down',
    'sh.toast.down': '{name} is down',
    'sh.toast.up': '{name} is back up',
  },
  {
    'sh.hp': 'Vitalwerte',
    'sh.ammo': 'EMP-Pistole',
    'sh.reload': 'Lädt auf',
    'sh.aw.hidden': 'Unentdeckt',
    'sh.aw.sus': 'Verdacht',
    'sh.aw.spotted': 'Entdeckt',
    'sh.down.title': 'Du bist am Boden',
    'sh.down.wait': 'Jemand aus der Crew kann dich aufrichten: neben dich stellen und E halten.',
    'sh.down.by': '{name} richtet dich auf',
    'sh.down.wipe': 'Die ganze Crew ist am Boden. Zurück zum Checkpoint …',
    'sh.prompt.revive': 'Halten: {name} aufrichten',
    'sh.prompt.takedown': 'Halten: Drohne abschalten',
    'sh.toast.down': '{name} ist am Boden',
    'sh.toast.up': '{name} steht wieder',
  },
);

export interface ShootingOptions {
  /** Pool sizes: the most drones of each type that can exist at once. */
  scouts: number;
  sentinels: number;
  /** Difficulty 1..3 (anything else counts as 2). */
  diff: unknown;
  /** Altitude alert drones climb to when something tall is in their way. */
  ceiling: number;
  /** Projectile pool size. */
  shots?: number;
}

export interface SpawnSpec {
  type: DroneType;
  x: number;
  z: number;
  /** Hover altitude; the default depends on the type. */
  y?: number;
  yaw?: number;
  /** Patrol waypoints (x, z), flown in a loop. */
  route?: [number, number][];
  /** Seconds to look around at each waypoint. */
  pause?: number;
  /** Idle scan amplitude in radians for drones without a route. */
  sweep?: number;
  /** Spawn already alert (waves). */
  alert?: boolean;
  /** Alarm group: a drone that goes alert calls the rest of its group. */
  group?: number;
  /** Damage multiplier for this drone's shots. */
  dmg?: number;
  /** Start altitude, for drones that fly in from a vent. */
  fromY?: number;
}

export interface DroneInfo {
  id: number;
  type: DroneType;
  x: number;
  y: number;
  z: number;
  yaw: number;
  st: number;
  hp: number;
  shield: number;
  charge: number;
  group: number;
  /** Every state this drone went through since it spawned. */
  log: number[];
}

export interface Shooting {
  readonly tun: Tuning;
  /** Levels can holster the weapon (cutscenes, safe rooms). */
  enabled: boolean;
  /** Test switch: drones neither sense, move nor attack, projectiles hang in the air. */
  frozen: boolean;
  attach(session: Session): void;
  detach(): void;
  update(dt: number, time: number): void;

  // --- simulation control: host only (or no session at all, for the menu backdrop)
  spawn(spec: SpawnSpec): number;
  /** Remove every drone and projectile at once. */
  clear(): void;
  /** Power the remaining drones down (inert husks). */
  shutdown(group?: number): void;
  /** Destroy the remaining drones. */
  killAll(group?: number): void;
  kill(id: number): void;
  alertAll(group?: number): void;
  /** Drones that still work (not dying, not disabled). */
  alive(type?: DroneType, group?: number): number;
  /** Everyone back on their feet with full health. */
  resetPlayers(): void;
  /** Damage a crew member as if hit from (sx, sz). */
  hurt(pid: string, dmg: number, sx: number, sz: number): void;
  /** The whole crew is down (after a short pause). */
  onWipe: (() => void) | null;
  onDroneDown: ((type: DroneType, silent: boolean, by: string | null) => void) | null;
  onAlert: ((group: number) => void) | null;

  // --- queries, valid on every peer
  drones(): DroneInfo[];
  shots(): number;
  hp(pid?: string): number;
  isDown(pid?: string): boolean;
  /** 0 hidden, 1 suspicious, 2 spotted, -1 nothing around. */
  awareness(): number;
  ammo(): number;
  /** Test hook: pull the trigger once, bypassing mouse input. */
  debugFire(): boolean;
}

// wire codes for hit parts
const PART_CODE: Record<HitPart, number> = { body: 1, shield: 2, core: 3 };
const CODE_PART: HitPart[] = ['body', 'body', 'shield', 'core'];

const C_UNAWARE = 0x59d8ff;
const C_SUS = 0xffa23a;
const C_ALERT = 0xff3246;
const CAST_HZ = 15;
const ALARM_RADIUS = 45;
const SHIELD_DOWN_TIME = 4;

interface Drone {
  id: number;
  type: DroneType;
  active: boolean;
  /** Bumped on every spawn, so peers can tell a reused pool slot from the same drone. */
  gen: number;
  // --- state every peer has
  x: number;
  y: number;
  z: number;
  yaw: number;
  st: number;
  hp: number;
  charge: number;
  /** 1 = up, 0..1 while it takes hits, -1 = overloaded. */
  shield: number;
  /** Takedown progress 0..1. */
  td: number;
  // --- client interpolation
  fx: number;
  fy: number;
  fz: number;
  fyaw: number;
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  k: number;
  seen: boolean;
  // --- host simulation
  baseY: number;
  vx: number;
  vz: number;
  route: [number, number][] | null;
  wp: number;
  wait: number;
  arrived: boolean;
  arriveYaw: number;
  pause: number;
  homeX: number;
  homeZ: number;
  homeYaw: number;
  sweep: number;
  ret: boolean;
  retX: number;
  retZ: number;
  group: number;
  dmgScale: number;
  see: number;
  sus: number;
  heard: boolean;
  /** Investigating a noise: go and look. */
  hunt: boolean;
  poiX: number;
  poiZ: number;
  alarm: number;
  senseAcc: number;
  target: string | null;
  hasLos: boolean;
  lastX: number;
  lastZ: number;
  aimX: number;
  aimY: number;
  aimZ: number;
  chargeT: number;
  cool: number;
  strafe: number;
  strafeT: number;
  climb: number;
  blockT: number;
  shieldHp: number;
  shieldDown: number;
  dieT: number;
  fall: number;
  restY: number;
  tdBy: string | null;
  tdT: number;
  // --- view
  obj: THREE.Group;
  glow: THREE.MeshStandardMaterial;
  /** What it can see, drawn on the floor and cut off by walls and cover. */
  fan: THREE.Mesh;
  fanLine: THREE.LineSegments;
  fanPos: THREE.BufferAttribute;
  fanT: number;
  floorY: number;
  orb: THREE.Mesh;
  rotor: THREE.Mesh | null;
  shieldMesh: THREE.Mesh | null;
  shieldMat: THREE.MeshBasicMaterial | null;
  shown: boolean;
  vGen: number;
  pSt: number;
  pCharge: number;
  flash: number;
  shieldFlash: number;
  coneK: number;
  shieldK: number;
  spin: number;
  log: number[];
}

interface Shot {
  id: number;
  active: boolean;
  gen: number;
  kind: number; // 0 scout bolt, 1 sentinel orb
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  dmg: number;
  /** Where it was fired from (for the damage direction on the HUD). */
  sx: number;
  sz: number;
  seen: boolean;
  shown: boolean;
  mesh: THREE.Mesh;
}

/** What the host knows about a crew member. */
interface PInfo {
  pid: string;
  x: number;
  y: number;
  z: number;
  crouch: boolean;
  headY: number;
  top: number;
  vx: number;
  vz: number;
  speed: number;
  wx: number;
  wz: number;
  wt: number;
  hp: number;
  sinceHurt: number;
  lastFire: number;
  down: boolean;
}

interface Spark {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const out = mergeGeometries(flat, false);
  for (const p of parts) p.dispose();
  for (const p of flat) p.dispose();
  if (!out) throw new Error('shooting: geometry merge failed');
  return out;
}

/** Paint a whole geometry with one grey level (for additive vertex-colour materials). */
function tinted(geo: THREE.BufferGeometry, v: number): THREE.BufferGeometry {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3).fill(v);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export function createShooting(deps: LevelDeps, opts: ShootingOptions): Shooting {
  const { engine, physics, audio, ui, interactions } = deps;
  const tun = tuning(opts.diff);
  const root = new THREE.Group();
  root.name = 'shooting';
  engine.scene.add(root);

  let session: Session | null = null;
  const unsubs: (() => void)[] = [];
  // replicated maps, re-read only when they change (not once per frame)
  type RevMap = Record<string, { by: string; at: number }>;
  const NONE: Record<string, never> = {};
  let downView: Record<string, number> = NONE;
  let revView: RevMap = NONE;

  // LevelDeps carries no input object (yet): use it if a later engine version
  // adds one, otherwise the instance main.ts exposes.
  let inputRef: Input | null = null;
  const getInput = (): Input | null => (inputRef ??= ((deps as unknown as { input?: Input }).input ?? ((window as any).__nv?.input as Input | undefined) ?? null));

  const selfCollider = () => deps.player()?.body.collider;

  // scratch vectors (no allocations per frame)
  const vO = new THREE.Vector3();
  const vD = new THREE.Vector3();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const vSnd = new THREE.Vector3();
  const DOWN = new THREE.Vector3(0, -1, 0);

  // ======================================================================
  // Materials and geometry (all created here, once)
  // ======================================================================
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x252a32, roughness: 0.36, metalness: 0.6, envMapIntensity: 1.3 });
  const armourMat = new THREE.MeshStandardMaterial({ color: 0x30363f, roughness: 0.42, metalness: 0.7, envMapIntensity: 1.2 });
  const rotorMat = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.5, metalness: 0.4 });
  const additive = (r: number, g: number, b: number, vertexColors = false) =>
    new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, vertexColors, fog: false });
  // vision footprint on the floor: a faint fill plus a crisp outline, cyan while unaware, amber while suspicious
  const fanMats = [additive(0.006, 0.042, 0.052, true), additive(0.11, 0.048, 0.005, true)];
  for (const fm of fanMats) {
    fm.polygonOffset = true;
    fm.polygonOffsetFactor = -2;
  }
  const lineMat = (r: number, g: number, b: number) => new THREE.LineBasicMaterial({ color: new THREE.Color(r, g, b), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const fanLineMats = [lineMat(0.1, 0.62, 0.7), lineMat(1.5, 0.7, 0.1)];
  const chargeMat = additive(3.2, 0.7, 0.5, true);
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff8a2a, emissiveIntensity: 4.5, roughness: 0.4 });
  const boltMat = additive(3.4, 0.75, 0.4, true);
  const orbMat = additive(3.2, 0.3, 0.9, true);
  const tracerMat = additive(0.7, 2.6, 2.4);
  const sparkMats = [additive(0.8, 2.6, 2.4), additive(3.0, 1.2, 0.4), additive(0.5, 1.5, 3.0)];
  const beaconMat = additive(2.2, 0.25, 0.3);

  const scoutBody = merged([
    new THREE.SphereGeometry(0.2, 20, 14).scale(1.1, 0.62, 1.4),
    new THREE.TorusGeometry(0.34, 0.028, 8, 32).rotateX(Math.PI / 2),
    new THREE.BoxGeometry(0.68, 0.018, 0.05),
    new THREE.BoxGeometry(0.05, 0.018, 0.68),
    new THREE.CylinderGeometry(0.03, 0.045, 0.2, 10).rotateX(Math.PI / 2).translate(0, -0.1, -0.2),
    new THREE.BoxGeometry(0.016, 0.13, 0.16).translate(0, 0.12, 0.2),
  ]);
  const scoutGlow = merged([
    new THREE.SphereGeometry(0.095, 14, 10).scale(1, 0.7, 0.6).translate(0, 0.02, -0.262),
    new THREE.TorusGeometry(0.2, 0.016, 6, 28).rotateX(Math.PI / 2).scale(1.12, 1, 1.42),
    new THREE.TorusGeometry(0.34, 0.011, 6, 40).rotateX(Math.PI / 2).translate(0, 0.03, 0),
    new THREE.CylinderGeometry(0.075, 0.075, 0.012, 14).translate(0, -0.126, 0),
  ]);
  const rotorGeo = merged([new THREE.BoxGeometry(0.62, 0.006, 0.04), new THREE.BoxGeometry(0.04, 0.006, 0.62)]);
  const sentBody = merged([
    new RoundedBoxGeometry(0.8, 0.44, 1.0, 3, 0.07),
    new RoundedBoxGeometry(0.56, 0.12, 0.66, 2, 0.04).translate(0, 0.27, 0.02),
    new THREE.CylinderGeometry(0.17, 0.14, 0.46, 16).translate(0.58, 0, 0.05),
    new THREE.CylinderGeometry(0.17, 0.14, 0.46, 16).translate(-0.58, 0, 0.05),
    new THREE.BoxGeometry(0.2, 0.08, 0.3).translate(0.44, 0.02, 0.05),
    new THREE.BoxGeometry(0.2, 0.08, 0.3).translate(-0.44, 0.02, 0.05),
    new THREE.CylinderGeometry(0.06, 0.085, 0.46, 12).rotateX(Math.PI / 2).translate(0, -0.17, -0.62),
    new THREE.BoxGeometry(0.06, 0.06, 0.34).translate(0.36, 0.1, -0.6),
    new THREE.BoxGeometry(0.06, 0.06, 0.34).translate(-0.36, 0.1, -0.6),
    new THREE.BoxGeometry(0.5, 0.05, 0.1).translate(0, 0.21, 0.52),
    new THREE.BoxGeometry(0.5, 0.05, 0.1).translate(0, -0.17, 0.52),
    new THREE.BoxGeometry(0.05, 0.4, 0.1).translate(0.25, 0.02, 0.52),
    new THREE.BoxGeometry(0.05, 0.4, 0.1).translate(-0.25, 0.02, 0.52),
  ]);
  const sentGlow = merged([
    new THREE.BoxGeometry(0.4, 0.04, 0.02).translate(0, 0.09, -0.505),
    new THREE.TorusGeometry(0.15, 0.016, 6, 20).rotateX(Math.PI / 2).translate(0.58, -0.235, 0.05),
    new THREE.TorusGeometry(0.15, 0.016, 6, 20).rotateX(Math.PI / 2).translate(-0.58, -0.235, 0.05),
    new THREE.BoxGeometry(0.012, 0.03, 0.6).translate(0.405, 0.12, 0),
    new THREE.BoxGeometry(0.012, 0.03, 0.6).translate(-0.405, 0.12, 0),
  ]);
  const sentCore = new THREE.SphereGeometry(0.16, 16, 12).translate(0, 0.02, 0.5);
  const SHIELD_Z = -0.82;
  const SHIELD_R = 0.9;
  const shieldGeo = merged([tinted(new THREE.CircleGeometry(SHIELD_R - 0.04, 6), 0.16), tinted(new THREE.RingGeometry(SHIELD_R - 0.07, SHIELD_R, 6), 1), tinted(new THREE.RingGeometry(0.4, 0.43, 6), 0.5)]).translate(0, 0, SHIELD_Z);
  // vision footprint: a fan of FAN_SEG slices, each slice a near part (where it also sees
  // someone crouching) and a far part; the rim distances are re-measured with rays
  const FAN_SEG = 20;
  const FAN_VERTS = 1 + 2 * (FAN_SEG + 1);
  const fanIndex: number[] = [];
  for (let i = 0; i < FAN_SEG; i++) {
    const m0 = 1 + 2 * i;
    fanIndex.push(0, m0, m0 + 2, m0, m0 + 1, m0 + 3, m0, m0 + 3, m0 + 2);
  }
  const fanColor = new Float32Array(FAN_VERTS * 3);
  fanColor.fill(1, 0, 3);
  for (let i = 0; i <= FAN_SEG; i++) {
    fanColor.fill(0.62, 3 + i * 6, 6 + i * 6);
    fanColor.fill(0.22, 6 + i * 6, 9 + i * 6);
  }
  // outline: both sides, the far rim, and the arc where crouching stops helping
  const fanLineIndex: number[] = [0, 2, 0, 2 + 2 * FAN_SEG];
  for (let i = 0; i < FAN_SEG; i++) {
    const m0 = 1 + 2 * i;
    fanLineIndex.push(m0 + 1, m0 + 3, m0, m0 + 2);
  }
  const fanSphere = new THREE.Sphere(new THREE.Vector3(), tun.viewDist + 1);
  // projectiles: a white-hot core inside a dim halo (vertex colours scale the additive colour)
  const orbGeo = merged([tinted(new THREE.IcosahedronGeometry(0.5, 1), 1), tinted(new THREE.IcosahedronGeometry(1, 1), 0.2)]);
  const boltGeo = merged([tinted(new THREE.SphereGeometry(0.04, 8, 6).scale(1, 1, 6), 1), tinted(new THREE.SphereGeometry(0.11, 10, 8).scale(1, 1, 3), 0.15)]);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const sparkGeo = new THREE.IcosahedronGeometry(1, 0);
  const beaconGeo = merged([new THREE.TorusGeometry(0.55, 0.035, 6, 36).rotateX(Math.PI / 2).translate(0, 0.04, 0), new THREE.CylinderGeometry(0.018, 0.018, 2.4, 6).translate(0, 1.2, 0)]);

  // ======================================================================
  // Pools
  // ======================================================================
  const MUZZLE: Record<DroneType, [number, number]> = { scout: [-0.1, 0.3], sentinel: [-0.17, 0.88] }; // (y, forward)

  const makeDrone = (id: number, type: DroneType): Drone => {
    const obj = new THREE.Group();
    obj.rotation.order = 'YXZ';
    obj.position.set(0, -60 - id, 0);
    const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C_UNAWARE, emissiveIntensity: 2.4, roughness: 0.5, metalness: 0 });
    const body = new THREE.Mesh(type === 'scout' ? scoutBody : sentBody, type === 'scout' ? hullMat : armourMat);
    body.castShadow = true;
    obj.add(body, new THREE.Mesh(type === 'scout' ? scoutGlow : sentGlow, glow));
    const fanGeo = new THREE.BufferGeometry();
    const fanPos = new THREE.BufferAttribute(new Float32Array(FAN_VERTS * 3), 3);
    fanPos.setUsage(THREE.DynamicDrawUsage);
    fanGeo.setAttribute('position', fanPos);
    fanGeo.setAttribute('color', new THREE.BufferAttribute(fanColor, 3));
    fanGeo.setIndex(fanIndex);
    fanGeo.boundingSphere = fanSphere;
    const fan = new THREE.Mesh(fanGeo, fanMats[0]);
    fan.renderOrder = 3;
    fan.position.set(0, -62 - id, 0);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', fanPos); // same vertices as the fill
    lineGeo.setIndex(fanLineIndex);
    lineGeo.boundingSphere = fanSphere;
    const fanLine = new THREE.LineSegments(lineGeo, fanLineMats[0]);
    fanLine.renderOrder = 4;
    fanLine.position.copy(fan.position);
    root.add(fan, fanLine);
    const orb = new THREE.Mesh(orbGeo, chargeMat);
    orb.position.set(0, MUZZLE[type][0], -MUZZLE[type][1]);
    orb.scale.setScalar(0.0001);
    obj.add(orb);
    let rotor: THREE.Mesh | null = null;
    let shieldMesh: THREE.Mesh | null = null;
    let shieldMat: THREE.MeshBasicMaterial | null = null;
    if (type === 'scout') {
      rotor = new THREE.Mesh(rotorGeo, rotorMat);
      rotor.position.y = 0.04;
      obj.add(rotor);
    } else {
      obj.add(new THREE.Mesh(sentCore, coreMat));
      shieldMat = additive(0.2, 0.75, 1.5, true);
      shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
      shieldMesh.renderOrder = 5;
      obj.add(shieldMesh);
    }
    root.add(obj);
    return {
      id, type, active: false, gen: 0,
      x: 0, y: 0, z: 0, yaw: 0, st: ST_UNAWARE, hp: 0, charge: 0, shield: 1, td: 0,
      fx: 0, fy: 0, fz: 0, fyaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, k: 1, seen: false,
      baseY: 0, vx: 0, vz: 0, route: null, wp: 0, wait: 0, arrived: false, arriveYaw: 0, pause: 0,
      homeX: 0, homeZ: 0, homeYaw: 0, sweep: 0, ret: false, retX: 0, retZ: 0, group: 0, dmgScale: 1,
      see: 0, sus: 0, heard: false, hunt: false, poiX: 0, poiZ: 0, alarm: 0, senseAcc: 0,
      target: null, hasLos: false, lastX: 0, lastZ: 0, aimX: 0, aimY: 0, aimZ: 0, chargeT: -1, cool: 0,
      strafe: 1, strafeT: 0, climb: 0, blockT: 0, shieldHp: 0, shieldDown: 0, dieT: 0, fall: 0, restY: 0.25, tdBy: null, tdT: 0,
      obj, glow, fan, fanLine, fanPos, fanT: 0, floorY: Infinity, orb, rotor, shieldMesh, shieldMat,
      shown: false, vGen: -1, pSt: ST_UNAWARE, pCharge: 0, flash: 0, shieldFlash: 0, coneK: 1, shieldK: 1, spin: 0, log: [],
    };
  };

  const drones: Drone[] = [];
  for (let i = 0; i < opts.scouts; i++) drones.push(makeDrone(drones.length, 'scout'));
  for (let i = 0; i < opts.sentinels; i++) drones.push(makeDrone(drones.length, 'sentinel'));

  const shots: Shot[] = [];
  for (let i = 0; i < (opts.shots ?? 28); i++) {
    const mesh = new THREE.Mesh(boltGeo, boltMat);
    mesh.position.set(0, -70, 0);
    root.add(mesh);
    shots.push({ id: i, active: false, gen: 0, kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, dmg: 0, sx: 0, sz: 0, seen: false, shown: false, mesh });
  }

  const sparks: Spark[] = [];
  for (let i = 0; i < 40; i++) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMats[0]);
    mesh.position.set(0, -72, 0);
    root.add(mesh);
    sparks.push({ mesh, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 0.1 });
  }
  let sparkNext = 0;
  const spark = (x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, mat: number) => {
    const s = sparks[sparkNext];
    sparkNext = (sparkNext + 1) % sparks.length;
    s.mesh.material = sparkMats[mat];
    s.mesh.position.set(x, y, z);
    s.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    s.life = s.max = life;
    s.vx = vx;
    s.vy = vy;
    s.vz = vz;
    s.size = size;
  };
  const burstFx = (x: number, y: number, z: number, n: number, speed: number, size: number, mat: number) => {
    spark(x, y, z, 0, 0, 0, size * 2.2, 0.12, mat);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 1.6 - 0.5;
      const sp = speed * (0.5 + Math.random() * 0.7);
      spark(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, size * (0.5 + Math.random() * 0.6), 0.25 + Math.random() * 0.3, mat);
    }
  };

  const tracers: Tracer[] = [];
  for (let i = 0; i < 8; i++) {
    const mesh = new THREE.Mesh(boxGeo, tracerMat);
    mesh.position.set(0, -74, 0);
    root.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;
  const tracer = (a: THREE.Vector3, b: THREE.Vector3) => {
    const tr = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % tracers.length;
    const len = a.distanceTo(b);
    if (len < 0.3) return;
    tr.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    tr.mesh.lookAt(b);
    tr.mesh.scale.set(0.022, 0.022, len);
    tr.life = 0.085;
  };

  // one marker per crew member who is down
  const beacons: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(beaconGeo, beaconMat);
    mesh.position.set(0, -76, 0);
    root.add(mesh);
    beacons.push(mesh);
  }

  // ======================================================================
  // EMP pistol (view model on the camera)
  // ======================================================================
  const gun = new THREE.Group();
  const GUN_REST = new THREE.Vector3(0.21, -0.215, -0.5);
  const GUN_AWAY = new THREE.Vector3(0, 0, 60); // behind the camera: never drawn
  gun.position.copy(GUN_AWAY);
  engine.camera.add(gun);
  // a touch of self-illumination: the view model must read in rooms that are almost dark
  const gunBodyMat = new THREE.MeshStandardMaterial({ color: 0x343a44, roughness: 0.38, metalness: 0.65, envMapIntensity: 1.5, emissive: 0x1a2028, emissiveIntensity: 1 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.7, metalness: 0.15, emissive: 0x08090c, emissiveIntensity: 1 });
  const gunGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x35e6d0, emissiveIntensity: 1.2, roughness: 0.5 });
  gun.add(
    new THREE.Mesh(
      merged([
        new RoundedBoxGeometry(0.05, 0.062, 0.3, 2, 0.012).translate(0, 0.03, -0.05),
        new THREE.BoxGeometry(0.04, 0.036, 0.2).translate(0, -0.012, -0.1),
        new THREE.CylinderGeometry(0.014, 0.019, 0.06, 12).rotateX(Math.PI / 2).translate(0, 0.03, -0.225),
        new RoundedBoxGeometry(0.042, 0.135, 0.056, 2, 0.012).rotateX(0.24).translate(0, -0.075, 0.07),
        new THREE.BoxGeometry(0.012, 0.012, 0.085).translate(0, -0.052, -0.005),
        new THREE.BoxGeometry(0.012, 0.03, 0.012).translate(0, -0.04, -0.045),
        new THREE.BoxGeometry(0.012, 0.014, 0.012).translate(0.015, 0.068, 0.085),
        new THREE.BoxGeometry(0.012, 0.014, 0.012).translate(-0.015, 0.068, 0.085),
        new THREE.BoxGeometry(0.008, 0.012, 0.012).translate(0, 0.066, -0.185),
      ]),
      gunBodyMat,
    ),
    new THREE.Mesh(
      merged([
        new THREE.BoxGeometry(0.053, 0.008, 0.1).translate(0, 0.036, -0.01),
        new THREE.BoxGeometry(0.053, 0.005, 0.045).translate(0, 0.02, -0.13),
        new THREE.BoxGeometry(0.006, 0.003, 0.15).translate(0, 0.0622, -0.07),
        new THREE.TorusGeometry(0.019, 0.0035, 6, 16).translate(0, 0.03, -0.252),
      ]),
      gunGlow,
    ),
    new THREE.Mesh(
      merged([
        new RoundedBoxGeometry(0.075, 0.1, 0.09, 2, 0.025).rotateX(0.24).translate(0.002, -0.088, 0.078),
        new THREE.CylinderGeometry(0.04, 0.052, 0.5, 12).rotateX(-1.05).rotateZ(-0.22).translate(0.05, -0.2, 0.3),
      ]),
      gloveMat,
    ),
  );
  const flashMat = additive(1.6, 4.5, 4.2);
  const flash = new THREE.Mesh(
    merged([new THREE.IcosahedronGeometry(0.03, 1), new THREE.BoxGeometry(0.24, 0.012, 0.012), new THREE.BoxGeometry(0.012, 0.24, 0.012), new THREE.BoxGeometry(0.012, 0.012, 0.3)]),
    flashMat,
  );
  flash.position.set(0, 0.03, -0.28);
  flash.scale.setScalar(0.0001);
  gun.add(flash);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.27);
  gun.add(muzzle);
  // The single light of this mechanic: created now, only its intensity ever changes.
  const muzzleLight = new THREE.PointLight(0x9ff4ff, 0, 7, 1.8);
  muzzleLight.position.set(0.2, -0.14, -0.75);
  engine.camera.add(muzzleLight);

  let ammo = MAG_SIZE;
  let reloadT = 0;
  let sinceShot = 1;
  let heat = 0;
  let kick = 0;
  let gunKick = 0;
  let flashT = 0;
  let lower = 0;
  let autoReload = 0;
  let downK = 0;
  let wasDown = false;
  let froze = false;
  let shake = 0;
  let swayX = 0;
  let lastYaw = 0;

  // ======================================================================
  // HUD
  // ======================================================================
  const hpFill = h('i');
  const hpNum = h('b', {}, '100');
  const hpLabel = h('span', {}, t('sh.hp'));
  const hpBox = h('div', { class: 'sh-health' }, h('div', { class: 'sh-row' }, hpLabel, hpNum), h('div', { class: 'sh-bar' }, hpFill));
  const ammoLabel = h('span', {}, t('sh.ammo'));
  const ammoNum = h('span', { class: 'sh-count' });
  const pips: HTMLElement[] = [];
  for (let i = 0; i < MAG_SIZE; i++) pips.push(h('i'));
  const ammoBox = h('div', { class: 'sh-ammo' }, h('div', { class: 'sh-row' }, ammoLabel, ammoNum), h('div', { class: 'sh-pips' }, ...pips));
  const awareText = h('span');
  const awareBox = h('div', { class: 'sh-aware hidden' }, h('i', { class: 'sh-eye' }), awareText);
  const hitEl = h('div', { class: 'sh-hit' }, h('i'), h('i'), h('i'), h('i'));
  const dirEls = [h('div', { class: 'sh-dir' }, h('i')), h('div', { class: 'sh-dir' }, h('i'))];
  const promptText = h('span');
  const promptFill = h('i');
  const promptBox = h('div', { class: 'sh-prompt hidden' }, h('div', { class: 'sh-line' }, h('span', { class: 'keycap' }, 'E'), promptText), h('div', { class: 'sh-prog' }, promptFill));
  const downText = h('p');
  const downFill = h('i');
  const downProg = h('div', { class: 'sh-prog hidden' }, downFill);
  const downTitle = h('h2', {}, t('sh.down.title'));
  const downBox = h('div', { class: 'sh-down hidden' }, downTitle, downText, downProg);
  const vig = h('div', { class: 'sh-vig' });
  const hud = h('div', { class: 'sh-hud hidden' }, vig, downBox, ...dirEls, hitEl, awareBox, hpBox, ammoBox, promptBox);
  {
    const uiRoot = document.getElementById('ui');
    // below the menus, above the base HUD
    if (uiRoot) uiRoot.insertBefore(hud, uiRoot.querySelector('.menu'));
  }
  const hudState = { hp: -1, ammo: -1, reload: false, aware: -2, prompt: '', prog: -1, down: '', downProg: -2, vig: -1, low: false };
  const dirs = [
    { x: 0, z: 0, life: 0 },
    { x: 0, z: 0, life: 0 },
  ];
  let dirNext = 0;
  let hurtFlash = 0;
  let wiping = false;
  /** Forget what the HUD shows, so the next frame writes everything again. */
  const resetHud = () => {
    hudState.hp = hudState.ammo = hudState.prog = hudState.vig = -3;
    hudState.aware = hudState.downProg = -3;
    hudState.prompt = hudState.down = '\0';
    hudState.reload = hudState.low = false;
    hpBox.classList.remove('low');
    for (const el of dirEls) el.style.opacity = '0';
    for (const d of dirs) d.life = 0;
  };
  const refreshTexts = () => {
    hpLabel.textContent = t('sh.hp');
    ammoLabel.textContent = t('sh.ammo');
    downTitle.textContent = t('sh.down.title');
    hudState.aware = -2;
    hudState.prompt = '\0';
    hudState.down = '\0';
    hudState.ammo = -1;
  };
  onLangChange(refreshTexts);

  const hitMarker = (kind: 'body' | 'shield' | 'core' | 'kill') => {
    hitEl.className = 'sh-hit ' + kind;
    void hitEl.offsetWidth; // restart the animation
    hitEl.classList.add('on');
  };

  // ======================================================================
  // Sound (all synthesised through the public AudioEngine helpers)
  // ======================================================================
  const audible = () => audio.ready && audio.ctx.state === 'running';
  let sndBudget = 10;
  /** Positional one-shots are rate-limited: a dozen drones must not flood the mixer. */
  const posOut = (x: number, y: number, z: number, vol: number, important = false): GainNode | null => {
    if (!audible()) return null;
    if (sndBudget < 1 && !important) return null;
    sndBudget -= 1;
    return audio.out({ pos: vSnd.set(x, y, z) }, vol);
  };
  const now = () => audio.ctx.currentTime + 0.001;
  const sndShot = (o: GainNode | null) => {
    if (!o) return;
    const tt = now();
    audio.tone(o, 'square', 1700, 230, tt, 0.085, 0.45);
    audio.tone(o, 'sine', 210, 55, tt, 0.13, 0.9);
    audio.burst(o, 'highpass', 2800, 0.8, tt, 0.045, 0.6);
  };
  const sndDry = () => {
    if (!audible()) return;
    const o = audio.out(undefined, 0.12);
    audio.tone(o, 'square', 240, 200, now(), 0.03, 0.6);
  };
  const sndReload = () => {
    if (!audible()) return;
    const o = audio.out(undefined, 0.16);
    const tt = now();
    audio.burst(o, 'highpass', 3200, 0.8, tt, 0.02, 0.8);
    audio.tone(o, 'sine', 260, 1150, tt + 0.12, RELOAD_TIME - 0.3, 0.5, 0.2);
    audio.burst(o, 'bandpass', 1800, 3, tt + RELOAD_TIME - 0.12, 0.05, 0.9);
    audio.tone(o, 'triangle', 1320, 1320, tt + RELOAD_TIME - 0.1, 0.09, 0.6);
  };
  const sndCharge = (d: Drone) => {
    const heavy = d.type === 'sentinel';
    const o = posOut(d.x, d.y, d.z, heavy ? 0.5 : 0.3);
    if (!o) return;
    const dur = heavy ? tun.chargeSentinel : tun.chargeScout;
    audio.tone(o, 'sawtooth', heavy ? 110 : 320, heavy ? 520 : 1500, now(), dur, 0.5, dur * 0.8);
  };
  const sndDroneFire = (s: Shot) => {
    const o = posOut(s.x, s.y, s.z, s.kind === 1 ? 0.7 : 0.4);
    if (!o) return;
    const tt = now();
    if (s.kind === 1) {
      audio.tone(o, 'sine', 160, 38, tt, 0.4, 1);
      audio.tone(o, 'sawtooth', 420, 90, tt, 0.25, 0.4);
      audio.burst(o, 'lowpass', 700, 0.8, tt, 0.18, 0.8);
    } else {
      audio.tone(o, 'sawtooth', 1250, 320, tt, 0.12, 0.5);
      audio.burst(o, 'bandpass', 2100, 2, tt, 0.05, 0.5);
    }
  };
  const sndImpact = (x: number, y: number, z: number, big: boolean) => {
    const o = posOut(x, y, z, big ? 0.5 : 0.28);
    if (!o) return;
    const tt = now();
    audio.burst(o, 'lowpass', big ? 500 : 1400, 0.8, tt, big ? 0.22 : 0.08, 0.9);
    if (big) audio.tone(o, 'sine', 90, 40, tt, 0.25, 0.8);
  };
  const sndSus = (d: Drone) => {
    const o = posOut(d.x, d.y, d.z, 0.45, true);
    if (!o) return;
    const tt = now();
    audio.tone(o, 'sine', 620, 860, tt, 0.12, 0.7);
    audio.tone(o, 'sine', 860, 980, tt + 0.13, 0.14, 0.6);
  };
  const sndAlert = (d: Drone) => {
    const o = posOut(d.x, d.y, d.z, 0.55, true);
    if (!o) return;
    const tt = now();
    for (let i = 0; i < 3; i++) audio.tone(o, 'square', i % 2 ? 740 : 990, i % 2 ? 740 : 990, tt + i * 0.11, 0.09, 0.5);
  };
  const sndSpotted = () => {
    if (!audible()) return;
    const o = audio.out(undefined, 0.2);
    const tt = now();
    audio.tone(o, 'sawtooth', 196, 190, tt, 0.5, 0.5, 0.01);
    audio.tone(o, 'sawtooth', 277, 270, tt, 0.5, 0.4, 0.01);
    audio.tone(o, 'sine', 55, 40, tt, 0.6, 0.9);
  };
  const sndDeath = (d: Drone) => {
    const o = posOut(d.x, d.y, d.z, d.type === 'sentinel' ? 0.9 : 0.6, true);
    if (!o) return;
    const tt = now();
    audio.burst(o, 'lowpass', 2200, 0.7, tt, 0.3, 1, 0.002, 200);
    audio.tone(o, 'sawtooth', 600, 50, tt, 0.4, 0.5);
    audio.tone(o, 'sine', 120, 35, tt, 0.35, 0.9);
  };
  const sndPowerDown = (d: Drone) => {
    const o = posOut(d.x, d.y, d.z, 0.3, true);
    if (!o) return;
    audio.tone(o, 'sawtooth', 380, 45, now(), 0.7, 0.4, 0.02);
  };
  const sndShieldHit = (d: Drone) => {
    const o = posOut(d.x, d.y, d.z, 0.4);
    if (!o) return;
    const tt = now();
    audio.tone(o, 'triangle', 2100, 1500, tt, 0.12, 0.6);
    audio.burst(o, 'bandpass', 3400, 6, tt, 0.08, 0.5);
  };
  const sndShieldBreak = (d: Drone) => {
    const o = posOut(d.x, d.y, d.z, 0.6, true);
    if (!o) return;
    const tt = now();
    audio.tone(o, 'sawtooth', 1800, 140, tt, 0.45, 0.6);
    audio.burst(o, 'highpass', 2500, 0.8, tt, 0.25, 0.8);
  };
  const sndHurt = (heavy: boolean) => {
    if (!audible()) return;
    const o = audio.out(undefined, heavy ? 0.45 : 0.28);
    const tt = now();
    audio.burst(o, 'lowpass', 600, 0.8, tt, 0.16, 1);
    audio.tone(o, 'sine', 130, 48, tt, 0.22, 0.9);
    audio.tone(o, 'square', 900, 300, tt, 0.06, 0.25);
  };
  const sndDown = () => {
    if (!audible()) return;
    const o = audio.out(undefined, 0.4);
    const tt = now();
    audio.tone(o, 'sawtooth', 220, 40, tt, 1.1, 0.5, 0.02);
    audio.tone(o, 'sine', 80, 30, tt, 1.2, 0.9);
  };

  // one soft hum that sits on the nearest working drone
  let hum: { gain: GainNode; pan: PannerNode; oscs: OscillatorNode[] } | null = null;
  let humT = 0;
  const startHum = () => {
    if (hum || !audio.ready) return;
    const c = audio.ctx;
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 460;
    const oscs: OscillatorNode[] = [];
    for (const [f, type, a] of [
      [92, 'sawtooth', 0.5],
      [138.6, 'sawtooth', 0.3],
      [184.9, 'triangle', 0.3],
    ] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = a;
      o.connect(g).connect(lp);
      o.start();
      oscs.push(o);
    }
    const pan = audio.makePanner(undefined, 2.5, 1.4);
    lp.connect(gain).connect(pan).connect(audio.sfxBus);
    hum = { gain, pan, oscs };
  };
  const stopHum = () => {
    if (!hum) return;
    const c = audio.ctx;
    hum.gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.1);
    for (const o of hum.oscs) o.stop(c.currentTime + 0.5);
    hum = null;
  };

  // ======================================================================
  // Host simulation
  // ======================================================================
  const pmap = new Map<string, PInfo>();
  const plist: PInfo[] = [];
  let downMap: Record<string, number> = {};
  let revMap: Record<string, { by: string; at: number }> = {};
  let wipeT = -1;
  let castT = 0;
  let seq = 0;
  const pk = { s: 0, d: [] as number[], p: [] as number[], h: [] as (string | number)[] };

  const simulating = () => !session || session.isHost;

  /** Clear line of sight between two points (static world only). */
  const clearLine = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean => {
    vD.set(bx - ax, by - ay, bz - az);
    const dist = vD.length();
    if (dist < 0.05) return true;
    vD.multiplyScalar(1 / dist);
    const hit = physics.raycast(vO.set(ax, ay, az), vD, dist, selfCollider());
    return hit === null || hit > dist - 0.3;
  };

  const gatherPlayers = (dt: number) => {
    plist.length = 0;
    const s = session;
    if (!s) return;
    for (const pid of s.players.keys()) {
      const pose = s.poseOf(pid);
      if (!pose) continue;
      let p = pmap.get(pid);
      if (!p) {
        p = { pid, x: pose.x, y: pose.y, z: pose.z, crouch: false, headY: 0, top: 0, vx: 0, vz: 0, speed: 0, wx: pose.x, wz: pose.z, wt: 0, hp: PLAYER_HP, sinceHurt: 99, lastFire: 0, down: !!downMap[pid] };
        pmap.set(pid, p);
      }
      p.x = pose.x;
      p.y = pose.y;
      p.z = pose.z;
      p.crouch = (pose.flags & FLAG_CROUCH) !== 0;
      p.headY = pose.y + (p.crouch ? EYE_CROUCH : EYE_STAND) - 0.08;
      p.top = pose.y + (p.crouch ? BODY_CROUCH : BODY_STAND);
      // velocity over a short window: remote poses only arrive 20 times a second
      p.wt += dt;
      if (p.wt >= 0.2) {
        const ddx = p.x - p.wx;
        const ddz = p.z - p.wz;
        if (Math.hypot(ddx, ddz) > 3) p.vx = p.vz = 0; // teleport
        else {
          p.vx = ddx / p.wt;
          p.vz = ddz / p.wt;
        }
        p.speed = Math.hypot(p.vx, p.vz);
        p.wx = p.x;
        p.wz = p.z;
        p.wt = 0;
      }
      plist.push(p);
    }
    if (pmap.size > plist.length) {
      for (const pid of [...pmap.keys()]) {
        if (s.players.has(pid)) continue;
        pmap.delete(pid);
        if (downMap[pid]) {
          downMap = { ...downMap };
          delete downMap[pid];
          s.set('sh.down', downMap);
        }
        if (revMap[pid]) {
          revMap = { ...revMap };
          delete revMap[pid];
          s.set('sh.rev', revMap);
        }
      }
    }
  };

  const nearestPlayer = (d: Drone): PInfo | null => {
    let best: PInfo | null = null;
    let bd = Infinity;
    for (const p of plist) {
      if (p.down) continue;
      const dd = (p.x - d.x) ** 2 + (p.z - d.z) ** 2;
      // stick with the current target unless someone is clearly closer
      const w = p.pid === d.target ? dd * 0.6 : dd;
      if (w < bd) {
        bd = w;
        best = p;
      }
    }
    return best;
  };

  const becomeAlert = (d: Drone, target: string | null) => {
    if (d.st > ST_ALERT) return;
    const was = d.st;
    d.st = ST_ALERT;
    d.alarm = 0;
    d.tdBy = null;
    d.td = 0;
    d.ret = false;
    // whoever raised the alarm also says where: head there, not to some stale spot
    const tp = (target ? pmap.get(target) : undefined) ?? nearestPlayer(d);
    if (tp) {
      d.target = tp.pid;
      d.lastX = tp.x;
      d.lastZ = tp.z;
    }
    if (was !== ST_ALERT) {
      d.cool = (0.4 + Math.random() * 0.8) * (0.3 + tun.spotTime); // slower to open fire on low difficulty
      d.chargeT = -1;
      d.strafe = Math.random() < 0.5 ? -1 : 1;
      d.strafeT = 1 + Math.random() * 2;
      // call the rest of the group
      for (const o of drones) {
        if (o === d || !o.active || o.group !== d.group || o.st >= ST_ALERT || o.alarm > 0) continue;
        if ((o.x - d.x) ** 2 + (o.z - d.z) ** 2 > ALARM_RADIUS * ALARM_RADIUS) continue;
        o.alarm = 0.5 + Math.random() * 0.9;
      }
      api.onAlert?.(d.group);
    }
  };

  const floorBelow = (d: Drone): number => {
    const hit = physics.raycast(vO.set(d.x, d.y, d.z), DOWN, 12, selfCollider());
    return hit === null ? 0 : d.y - hit;
  };

  const killDrone = (d: Drone, by: string | null) => {
    if (!d.active || d.st >= ST_DYING) return;
    d.st = ST_DYING;
    d.dieT = 0.85;
    d.fall = 0;
    d.restY = floorBelow(d) + 0.2;
    d.charge = 0;
    d.chargeT = -1;
    d.td = 0;
    d.tdBy = null;
    api.onDroneDown?.(d.type, false, by);
  };

  const disableDrone = (d: Drone, by: string | null, silent: boolean) => {
    if (!d.active || d.st >= ST_DYING) return;
    d.st = ST_OFF;
    d.fall = 0;
    d.restY = floorBelow(d) + (d.type === 'scout' ? 0.16 : 0.26);
    d.charge = 0;
    d.chargeT = -1;
    d.td = 0;
    d.tdBy = null;
    d.shield = -1;
    api.onDroneDown?.(d.type, silent, by);
  };

  /** A noise at (x, z): drones within `radius` come and look. */
  const makeNoise = (x: number, z: number, radius: number) => {
    const r2n = radius * radius;
    for (const d of drones) {
      if (!d.active || d.st >= ST_ALERT) continue;
      if ((d.x - x) ** 2 + (d.z - z) ** 2 > r2n) continue;
      d.heard = true;
      d.hunt = true;
      d.poiX = x;
      d.poiZ = z;
    }
  };

  const sense = (d: Drone, sdt: number) => {
    if (d.st < ST_ALERT) {
      let visible = false;
      let best = 0;
      let seen: PInfo | null = null;
      let noise = d.heard;
      d.heard = false;
      for (const p of plist) {
        if (p.down) continue;
        const dx = p.x - d.x;
        const dz = p.z - d.z;
        const dy = p.headY - d.y;
        const range = viewRange(tun, p.crouch);
        if (inViewCone(dx, dy, dz, d.yaw, range) && clearLine(d.x, d.y, d.z, p.x, p.headY, p.z)) {
          visible = true;
          const f = sightFactor(Math.hypot(dx, dy, dz), range, p.crouch);
          if (f > best) {
            best = f;
            seen = p;
          }
        } else {
          const r = moveNoise(p.speed, p.crouch, tun);
          if (r > 0 && dx * dx + dz * dz < r * r) {
            noise = true;
            d.hunt = true;
            d.poiX = p.x;
            d.poiZ = p.z;
          }
        }
      }
      if (seen) {
        d.poiX = seen.x;
        d.poiZ = seen.z;
        d.hunt = false;
        d.target = seen.pid;
      }
      const before = d.st;
      stepAwareness(d, visible, best, noise, sdt, tun);
      if (before === ST_UNAWARE && d.st === ST_SUSPICIOUS) {
        d.ret = true;
        d.retX = d.x;
        d.retZ = d.z;
      }
      if (d.st === ST_ALERT) {
        d.st = before; // becomeAlert does the transition and the alarm
        becomeAlert(d, seen ? seen.pid : null);
      }
    }
    if (d.st === ST_ALERT) {
      const p = nearestPlayer(d);
      d.target = p ? p.pid : null;
      d.hasLos = !!p && clearLine(d.x, d.y, d.z, p.x, p.headY - 0.2, p.z);
      if (p && d.hasLos) {
        d.lastX = p.x;
        d.lastZ = p.z;
      }
    }
  };

  const freeShot = (): Shot | null => {
    for (const s of shots) if (!s.active) return s;
    return null;
  };

  const fireShot = (d: Drone) => {
    const s = freeShot();
    if (!s) return;
    const [my, mf] = MUZZLE[d.type];
    const fxx = forwardX(d.yaw);
    const fzz = forwardZ(d.yaw);
    const ox = d.x + fxx * mf;
    const oy = d.y + my;
    const oz = d.z + fzz * mf;
    const kind = d.type === 'sentinel' ? 1 : 0;
    const speed = kind === 1 ? tun.orbSpeed : tun.boltSpeed;
    const p = d.target ? pmap.get(d.target) : undefined;
    if (p && !p.down && d.hasLos) {
      // lead a moving target by a random share of the perfect lead: dodging works, standing still does not
      const flight = Math.hypot(p.x - ox, p.z - oz) / speed;
      const lead = Math.random() * tun.lead * flight;
      d.aimX = p.x + p.vx * lead;
      d.aimZ = p.z + p.vz * lead;
      d.aimY = p.y + (p.crouch ? 0.62 : 1.12);
    }
    let dx = d.aimX - ox;
    let dy = d.aimY - oy;
    let dz = d.aimZ - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    // a drone cannot shoot behind itself: whoever gets around a sentinel is safe from it
    const flat = Math.hypot(dx, dz) || 1;
    if ((dx * fxx + dz * fzz) / flat < 0.55) return;
    s.active = true;
    s.gen = (s.gen + 1) % 1000;
    s.kind = kind;
    s.x = ox;
    s.y = oy;
    s.z = oz;
    s.vx = dx * speed;
    s.vy = dy * speed;
    s.vz = dz * speed;
    s.life = 4.5;
    s.dmg = projectileDamage(kind, tun, d.dmgScale);
    s.sx = d.x;
    s.sz = d.z;
    sndDroneFire(s);
  };

  const endShot = (s: Shot, hitPlayer: boolean) => {
    s.active = false;
    burstFx(s.x, s.y, s.z, s.kind === 1 ? 7 : 3, s.kind === 1 ? 4 : 2.5, s.kind === 1 ? 0.14 : 0.07, 1);
    if (!hitPlayer) sndImpact(s.x, s.y, s.z, s.kind === 1);
  };

  const stepShots = (dt: number) => {
    for (const s of shots) {
      if (!s.active) continue;
      const speed = Math.hypot(s.vx, s.vy, s.vz);
      const step = speed * dt;
      vD.set(s.vx / speed, s.vy / speed, s.vz / speed);
      const wall = physics.raycast(vO.set(s.x, s.y, s.z), vD, step + 0.05, selfCollider());
      const travel = wall !== null ? Math.min(wall, step) : step;
      const nx = s.x + vD.x * travel;
      const ny = s.y + vD.y * travel;
      const nz = s.z + vD.z * travel;
      const rad = PLAYER_RADIUS + (s.kind === 1 ? 0.2 : 0.09);
      let victim: PInfo | null = null;
      for (const p of plist) {
        if (p.down) continue;
        if (segmentHitsCapsule(s.x, s.y, s.z, nx, ny, nz, p.x, p.y + 0.25, p.top - 0.15, p.z, rad)) {
          victim = p;
          break;
        }
      }
      s.x = nx;
      s.y = ny;
      s.z = nz;
      s.life -= dt;
      if (victim) {
        hurt(victim.pid, s.dmg, s.sx, s.sz);
        endShot(s, true);
      } else if (wall !== null || s.life <= 0) endShot(s, false);
    }
  };

  const hurt = (pid: string, dmg: number, sx: number, sz: number) => {
    const s = session;
    const p = pmap.get(pid);
    if (!s || !s.isHost || !p || p.down || dmg <= 0) return;
    p.hp = Math.max(0, p.hp - dmg);
    p.sinceHurt = 0;
    s.emit('sh.dmg', { p: pid, d: Math.round(dmg), x: r2(sx), z: r2(sz) });
    if (p.hp <= 0) {
      p.down = true;
      downMap = { ...downMap, [pid]: s.hostNow() };
      s.set('sh.down', downMap);
      s.emit('sh.downed', { p: pid });
      // whoever was helping someone up has to stop
      let changed = false;
      const next = { ...revMap };
      for (const k of Object.keys(next)) {
        if (next[k].by === pid) {
          delete next[k];
          changed = true;
        }
      }
      if (changed) {
        revMap = next;
        s.set('sh.rev', revMap);
      }
      for (const d of drones) if (d.tdBy === pid) d.tdBy = null;
    }
  };

  const stepPlayers = (dt: number) => {
    const s = session;
    if (!s) return;
    let allDown = plist.length > 0;
    for (const p of plist) {
      p.sinceHurt += dt;
      if (!p.down) {
        p.hp = regen(p.hp, p.sinceHurt, dt);
        allDown = false;
      }
    }
    // revives in progress
    const hostNow = s.hostNow();
    for (const target in revMap) {
      const r = revMap[target];
      const a = pmap.get(r.by);
      const b = pmap.get(target);
      const ok = !!a && !!b && !a.down && b.down && Math.hypot(a.x - b.x, a.z - b.z) <= REVIVE_RANGE + 1.2;
      if (!ok) {
        revMap = { ...revMap };
        delete revMap[target];
        s.set('sh.rev', revMap);
      } else if (hostNow - r.at >= REVIVE_TIME * 1000) {
        b!.down = false;
        b!.hp = REVIVE_HP;
        b!.sinceHurt = 0;
        revMap = { ...revMap };
        delete revMap[target];
        downMap = { ...downMap };
        delete downMap[target];
        s.set('sh.rev', revMap);
        s.set('sh.down', downMap);
        s.emit('sh.up', { p: target, by: r.by });
      }
    }
    // the whole crew is down: short pause, then the level decides what happens
    if (allDown) {
      if (wipeT < 0) {
        wipeT = 1.8;
        s.emit('sh.wipe');
      }
      wipeT -= dt;
      if (wipeT <= 0) {
        wipeT = -1;
        if (api.onWipe) api.onWipe();
        else api.resetPlayers();
      }
    } else wipeT = -1;
  };

  const stepTakedown = (d: Drone, dt: number) => {
    const p = d.tdBy ? pmap.get(d.tdBy) : undefined;
    // loose re-check: still close and not in front of it
    const ok = !!p && !p.down && d.st === ST_UNAWARE && Math.hypot(p.x - d.x, p.z - d.z) <= TAKEDOWN_RANGE + 0.8;
    if (!ok) {
      d.tdBy = null;
      d.tdT = 0;
      d.td = 0;
      return;
    }
    d.tdT += dt;
    d.td = clamp01(d.tdT / TAKEDOWN_TIME);
    if (d.tdT >= TAKEDOWN_TIME) disableDrone(d, d.tdBy, true);
  };

  let chargingNow = 0;

  const think = (d: Drone, dt: number, time: number) => {
    if (d.st === ST_DYING) {
      d.dieT -= dt;
      d.fall += 9 * dt;
      d.y = Math.max(d.restY, d.y - d.fall * dt);
      if (d.dieT <= 0) d.active = false;
      return;
    }
    if (d.st === ST_OFF) {
      if (d.y > d.restY) {
        d.fall += 5 * dt;
        d.y = Math.max(d.restY, d.y - d.fall * dt);
      }
      return;
    }
    if (api.frozen) return;
    if (d.tdBy) {
      // being shut down: jammed in place
      stepTakedown(d, dt);
      return;
    }
    if (d.shieldDown > 0) {
      d.shieldDown -= dt;
      if (d.shieldDown <= 0) {
        d.shieldHp = tun.shieldHits;
        d.shield = 1;
      }
    }
    if (d.alarm > 0 && d.st < ST_ALERT) {
      d.alarm -= dt;
      if (d.alarm <= 0) becomeAlert(d, null);
    }
    d.senseAcc += dt;
    if (d.senseAcc >= 0.1) {
      sense(d, d.senseAcc);
      d.senseAcc = 0;
    }

    const scout = d.type === 'scout';
    let wantX = 0;
    let wantZ = 0;
    let wantYaw = d.yaw;
    let turn = (scout ? 2.4 : 0.9) * tun.speed;
    let checkWalls = false;

    if (d.st === ST_UNAWARE) {
      const patrol = (scout ? 1.25 : 0.8) * tun.speed;
      let gx = d.homeX;
      let gz = d.homeZ;
      if (d.ret) {
        gx = d.retX;
        gz = d.retZ;
      } else if (d.route) {
        gx = d.route[d.wp][0];
        gz = d.route[d.wp][1];
      }
      const dx = gx - d.x;
      const dz = gz - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.2) {
        if (d.ret) d.ret = false;
        else if (d.route) {
          if (!d.arrived) {
            d.arrived = true;
            d.wait = d.pause;
            d.arriveYaw = d.yaw;
          }
          d.wait -= dt;
          // look left and right before moving on
          wantYaw = d.arriveYaw + Math.sin((d.pause - d.wait) * 2.2) * 0.65;
          if (d.wait <= 0) {
            d.wp = (d.wp + 1) % d.route.length;
            d.arrived = false;
          }
        } else wantYaw = d.homeYaw + Math.sin(time * 0.45 + d.id * 1.3) * d.sweep;
      } else {
        wantYaw = yawTo(dx, dz);
        // turn first, then go
        const align = Math.max(0, Math.cos(angleDelta(d.yaw, wantYaw)));
        const sp = Math.min(patrol, dist * 3) * align * align;
        wantX = (dx / dist) * sp;
        wantZ = (dz / dist) * sp;
      }
    } else if (d.st === ST_SUSPICIOUS) {
      const dx = d.poiX - d.x;
      const dz = d.poiZ - d.z;
      const dist = Math.hypot(dx, dz);
      turn = (scout ? 3.4 : 1.3) * tun.speed;
      if (dist > 0.3) wantYaw = yawTo(dx, dz);
      if (d.hunt && dist > 3.5) {
        const sp = (scout ? 1.0 : 0.6) * tun.speed;
        wantX = (dx / dist) * sp;
        wantZ = (dz / dist) * sp;
        checkWalls = true;
      }
    } else {
      // ---- alert: keep the target in a band, strafe, attack
      const p = d.target ? pmap.get(d.target) : undefined;
      turn = (scout ? 4.6 : 1.0) * tun.speed;
      const charging = d.chargeT >= 0;
      if (p && !p.down) {
        const dx = p.x - d.x;
        const dz = p.z - d.z;
        const dist = Math.hypot(dx, dz) || 0.001;
        const speed = (scout ? 3.1 : 1.25) * tun.speed * (charging ? (scout ? 0.35 : 0) : 1);
        if (d.hasLos) {
          wantYaw = yawTo(dx, dz);
          const want = scout ? 7 : 8.5;
          const radial = dist > want + 2 ? 1 : dist < want - 2.5 ? -1 : 0;
          const tang = scout ? d.strafe * 0.8 : 0;
          wantX = ((dx / dist) * radial + (-dz / dist) * tang) * speed;
          wantZ = ((dz / dist) * radial + (dx / dist) * tang) * speed;
        } else {
          // go where it was last seen; once there, home in on it
          let hx = d.lastX - d.x;
          let hz = d.lastZ - d.z;
          let hd = Math.hypot(hx, hz);
          if (hd < 1.5) {
            d.lastX = p.x;
            d.lastZ = p.z;
            hx = d.lastX - d.x;
            hz = d.lastZ - d.z;
            hd = Math.hypot(hx, hz);
          }
          if (hd > 0.5) {
            wantX = (hx / hd) * speed;
            wantZ = (hz / hd) * speed;
            wantYaw = yawTo(hx, hz);
          }
        }
        checkWalls = true;
        d.strafeT -= dt;
        if (d.strafeT <= 0) {
          d.strafe = -d.strafe;
          d.strafeT = 1.5 + Math.random() * 2.5;
        }
        // attack
        if (charging) {
          d.chargeT += dt;
          const total = scout ? tun.chargeScout : tun.chargeSentinel;
          d.charge = clamp01(d.chargeT / total);
          if (d.hasLos) {
            d.aimX = p.x;
            d.aimY = p.y + (p.crouch ? 0.62 : 1.12);
            d.aimZ = p.z;
          }
          if (d.chargeT >= total) {
            fireShot(d);
            d.chargeT = -1;
            d.charge = 0;
            d.cool = (scout ? tun.gapScout : tun.gapSentinel) * (0.8 + Math.random() * 0.5);
          }
        } else {
          d.cool -= dt;
          const cap = tun.tokens + Math.max(0, plist.length - 1);
          if (d.cool <= 0 && d.hasLos && dist < 18 && chargingNow < cap && Math.abs(angleDelta(d.yaw, wantYaw)) < 0.45) {
            d.chargeT = 0;
            d.charge = 0.01;
            d.aimX = p.x;
            d.aimY = p.y + (p.crouch ? 0.62 : 1.12);
            d.aimZ = p.z;
            chargingNow++;
          }
        }
      } else if (charging) {
        d.chargeT = -1;
        d.charge = 0;
      }
    }

    // ---- move
    const k = 1 - Math.exp(-4.5 * dt);
    d.vx += (wantX - d.vx) * k;
    d.vz += (wantZ - d.vz) * k;
    const sp = Math.hypot(d.vx, d.vz);
    if (checkWalls && sp > 0.05) {
      const radius = scout ? SCOUT_RADIUS : SENTINEL_RADIUS;
      vD.set(d.vx / sp, 0, d.vz / sp);
      const hit = physics.raycast(vO.set(d.x, d.y, d.z), vD, radius + 0.45 + sp * dt, selfCollider());
      if (hit !== null) {
        // something in the way: stop, try the other direction, and go over it if it is low enough
        d.vx *= 0.1;
        d.vz *= 0.1;
        if (d.blockT <= 0) {
          d.strafe = -d.strafe;
          d.strafeT = 1.5 + Math.random() * 2;
          d.blockT = 0.9;
        }
        if (d.st === ST_ALERT) d.climb = 1.4;
      }
    }
    if (d.blockT > 0) d.blockT -= dt;
    d.x += d.vx * dt;
    d.z += d.vz * dt;
    // separation: drones never stack inside each other
    if (d.st === ST_ALERT) {
      for (const o of drones) {
        if (o.id <= d.id || !o.active || o.st !== ST_ALERT) continue;
        const ox = o.x - d.x;
        const oz = o.z - d.z;
        const od = Math.hypot(ox, oz);
        if (od < 1.3 && od > 0.001 && Math.abs(o.y - d.y) < 0.9) {
          const push = ((1.3 - od) / od) * 0.5;
          d.x -= ox * push;
          d.z -= oz * push;
          o.x += ox * push;
          o.z += oz * push;
        }
      }
    }
    // altitude: climb over tall things, come back down when the way is clear
    let targetY = d.baseY;
    if (d.climb > 0) {
      d.climb -= dt;
      targetY = opts.ceiling;
    } else if (d.y > d.baseY + 0.15) {
      const below = physics.raycast(vO.set(d.x, d.y, d.z), DOWN, d.y - d.baseY + 0.5, selfCollider());
      if (below !== null) targetY = d.y; // still above an obstacle
    }
    const dy = targetY - d.y;
    d.y += Math.sign(dy) * Math.min(Math.abs(dy), 2 * dt);
    d.yaw = turnTowards(d.yaw, wantYaw, turn * dt);
  };

  const simulate = (dt: number, time: number) => {
    gatherPlayers(dt);
    chargingNow = 0;
    for (const d of drones) if (d.active && d.chargeT >= 0) chargingNow++;
    for (const d of drones) if (d.active) think(d, dt, time);
    if (!api.frozen) stepShots(dt);
    if (session) stepPlayers(dt);
  };

  const sendCast = (s: Session) => {
    pk.s = ++seq;
    pk.d.length = 0;
    pk.p.length = 0;
    pk.h.length = 0;
    for (const d of drones) {
      if (!d.active) continue;
      pk.d.push(d.id, d.gen, r2(d.x), r2(d.y), r2(d.z), r2(d.yaw), d.st, d.hp, r2(d.charge), r2(d.shield), r2(d.td), d.group);
    }
    for (const sh of shots) {
      if (!sh.active) continue;
      pk.p.push(sh.id, sh.gen, sh.kind, r2(sh.x), r2(sh.y), r2(sh.z), r2(sh.vx), r2(sh.vy), r2(sh.vz));
    }
    for (const p of plist) pk.h.push(p.pid, Math.round(p.hp));
    s.cast('sh', pk);
  };

  // ---------------------------------------------------------------- host intents
  const installHost = (s: Session) => {
    downMap = {};
    revMap = {};
    s.set('sh', { down: downMap, rev: revMap });

    // one message per trigger pull: the noise, and the hit if there was one
    s.handle('sh.fire', (pid, a) => {
      const p = pmap.get(pid);
      const pose = s.poseOf(pid);
      if (!p || !pose || p.down) return;
      const tNow = s.hostNow();
      if (tNow - p.lastFire < FIRE_INTERVAL * 1000 * 0.55) return; // faster than the weapon can fire
      p.lastFire = tNow;
      makeNoise(pose.x, pose.z, tun.hearShot);
      const eyeY = pose.y + (p.crouch ? EYE_CROUCH : EYE_STAND);
      let e: [number, number, number] | null = null;
      if (Array.isArray(a?.e) && a.e.length === 3 && a.e.every(isNum) && Math.hypot(a.e[0] - pose.x, a.e[1] - eyeY, a.e[2] - pose.z) <= MAX_RANGE + 6) e = [a.e[0], a.e[1], a.e[2]];
      let hitId = -1;
      let code = 0;
      let killed = false;
      const id = a?.id;
      if (Number.isInteger(id) && id >= 0 && id < drones.length) {
        const d = drones[id];
        const dx = pose.x - d.x;
        const dz = pose.z - d.z;
        const dist = Math.hypot(dx, eyeY - d.y, dz);
        if (d.active && d.st <= ST_ALERT && dist <= MAX_RANGE + 6) {
          const flat = Math.hypot(dx, dz) || 1;
          const front = (dx * forwardX(d.yaw) + dz * forwardZ(d.yaw)) / flat;
          const claimed: HitPart = a?.part === 'core' || a?.part === 'shield' ? a.part : 'body';
          const res = resolveHit(d.type, claimed, d.type === 'sentinel' && d.shieldDown <= 0, front);
          hitId = d.id;
          code = PART_CODE[res.part];
          if (res.part === 'shield') {
            d.shieldHp -= 1;
            d.shield = clamp01(d.shieldHp / tun.shieldHits);
            if (d.shieldHp <= 0) {
              // overload: no shield for a while, and the shot it was charging fizzles
              d.shieldDown = SHIELD_DOWN_TIME;
              d.shield = -1;
              d.chargeT = -1;
              d.charge = 0;
              d.cool = Math.max(d.cool, 1.6);
            }
          } else {
            d.hp -= res.dmg;
            if (d.hp <= 0) {
              d.hp = 0;
              killed = true;
              killDrone(d, pid);
            }
          }
          if (!killed) {
            d.poiX = pose.x;
            d.poiZ = pose.z;
            d.lastX = pose.x;
            d.lastZ = pose.z;
            becomeAlert(d, pid);
          }
        }
      }
      s.emit('sh.shot', { p: pid, e, id: hitId, r: code, k: killed });
    });

    s.handle('sh.td', (pid, a) => {
      const p = pmap.get(pid);
      const id = a?.id;
      if (!p || p.down || !Number.isInteger(id) || id < 0 || id >= drones.length) return;
      const d = drones[id];
      if (!a?.on) {
        if (d.tdBy === pid) {
          d.tdBy = null;
          d.tdT = 0;
          d.td = 0;
        }
        return;
      }
      if (!d.active || d.tdBy) return;
      if (!canTakedown(d.st, p.x - d.x, p.z - d.z, d.yaw, TAKEDOWN_RANGE + 0.5)) return;
      if (Math.abs(p.y + 1 - d.y) > 2.2) return;
      d.tdBy = pid;
      d.tdT = 0;
      d.vx = d.vz = 0;
    });

    s.handle('sh.rev', (pid, a) => {
      const target = String(a?.t ?? '');
      const me = pmap.get(pid);
      const other = pmap.get(target);
      if (!me || !other || target === pid) return;
      if (!a?.on) {
        if (revMap[target]?.by === pid) {
          revMap = { ...revMap };
          delete revMap[target];
          s.set('sh.rev', revMap);
        }
        return;
      }
      if (me.down || !other.down || revMap[target]) return;
      if (Math.hypot(me.x - other.x, me.z - other.z) > REVIVE_RANGE + 1.2) return;
      revMap = { ...revMap, [target]: { by: pid, at: s.hostNow() } };
      s.set('sh.rev', revMap);
    });
  };

  // ======================================================================
  // Client: packets in, interpolation
  // ======================================================================
  let lastSeq = 0;
  let lastPacketAt = 0;
  let netInterval = 1 / CAST_HZ;
  const hpView = new Map<string, number>();
  const D_STRIDE = 12;
  const S_STRIDE = 9;

  const onPacket = (data: any) => {
    if (!data || !Array.isArray(data.d) || !Array.isArray(data.p) || !isNum(data.s)) return;
    if (data.s <= lastSeq && lastSeq - data.s < 600) return; // late or duplicate
    lastSeq = data.s;
    const t1 = performance.now();
    if (lastPacketAt > 0) {
      const gap = Math.min(0.3, Math.max(0.04, (t1 - lastPacketAt) / 1000));
      netInterval += (gap - netInterval) * 0.2;
    }
    lastPacketAt = t1;

    for (const d of drones) d.seen = false;
    const a = data.d as number[];
    for (let i = 0; i + D_STRIDE <= a.length; i += D_STRIDE) {
      const d = drones[a[i]];
      if (!d) continue;
      const fresh = !d.active || d.gen !== a[i + 1];
      d.active = true;
      d.seen = true;
      d.gen = a[i + 1];
      if (fresh) {
        d.x = d.fx = d.tx = a[i + 2];
        d.y = d.fy = d.ty = a[i + 3];
        d.z = d.fz = d.tz = a[i + 4];
        d.yaw = d.fyaw = d.tyaw = a[i + 5];
        d.k = 1;
      } else {
        d.fx = d.x;
        d.fy = d.y;
        d.fz = d.z;
        d.fyaw = d.yaw;
        d.tx = a[i + 2];
        d.ty = a[i + 3];
        d.tz = a[i + 4];
        d.tyaw = a[i + 5];
        d.k = 0;
      }
      d.st = a[i + 6];
      d.hp = a[i + 7];
      d.charge = a[i + 8];
      d.shield = a[i + 9];
      d.td = a[i + 10];
      d.group = a[i + 11];
    }
    for (const d of drones) if (d.active && !d.seen) d.active = false;

    for (const s of shots) s.seen = false;
    const b = data.p as number[];
    for (let i = 0; i + S_STRIDE <= b.length; i += S_STRIDE) {
      const s = shots[b[i]];
      if (!s) continue;
      const fresh = !s.active || s.gen !== b[i + 1];
      s.seen = true;
      s.kind = b[i + 2];
      s.vx = b[i + 6];
      s.vy = b[i + 7];
      s.vz = b[i + 8];
      if (fresh) {
        if (s.active) endShot(s, false);
        s.active = true;
        s.gen = b[i + 1];
        s.x = b[i + 3];
        s.y = b[i + 4];
        s.z = b[i + 5];
        sndDroneFire(s);
      } else {
        // dead reckoning between packets; pull halfway to the host's position
        s.x += (b[i + 3] - s.x) * 0.5;
        s.y += (b[i + 4] - s.y) * 0.5;
        s.z += (b[i + 5] - s.z) * 0.5;
      }
    }
    for (const s of shots) if (s.active && !s.seen) endShot(s, false);

    if (Array.isArray(data.h)) {
      for (let i = 0; i + 1 < data.h.length; i += 2) hpView.set(String(data.h[i]), Number(data.h[i + 1]));
    }
  };

  const interpolate = (dt: number) => {
    const step = dt / netInterval;
    for (const d of drones) {
      if (!d.active || d.k >= 1) continue;
      d.k = Math.min(1, d.k + step);
      d.x = d.fx + (d.tx - d.fx) * d.k;
      d.y = d.fy + (d.ty - d.fy) * d.k;
      d.z = d.fz + (d.tz - d.fz) * d.k;
      d.yaw = d.fyaw + angleDelta(d.fyaw, d.tyaw) * d.k;
    }
    for (const s of shots) {
      if (!s.active) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
    }
  };

  // ======================================================================
  // View: drones, projectiles, effects (every peer)
  // ======================================================================
  /** Re-measure a drone's vision footprint: one ray per slice, at crouch height. */
  const measureFan = (d: Drone) => {
    const below = physics.raycast(vO.set(d.x, d.y, d.z), DOWN, 9, selfCollider());
    if (below !== null) d.floorY = Math.min(d.floorY, d.y - below); // lowest surface seen: hovering over a crate does not lift the footprint
    if (d.floorY === Infinity) d.floorY = d.y - 1.75;
    const arr = d.fanPos.array as Float32Array;
    const range = tun.viewDist;
    const self = selfCollider();
    vO.set(d.x, d.floorY + 0.9, d.z);
    for (let i = 0; i <= FAN_SEG; i++) {
      const a = -VIEW_HALF + (i / FAN_SEG) * 2 * VIEW_HALF;
      vD.set(-Math.sin(d.yaw + a), 0, -Math.cos(d.yaw + a));
      const hit = physics.raycast(vO, vD, range, self);
      const far = hit === null ? range : hit;
      const mid = Math.min(far, range * 0.62);
      const lx = -Math.sin(a);
      const lz = -Math.cos(a);
      const o = 3 + i * 6;
      arr[o] = lx * mid;
      arr[o + 2] = lz * mid;
      arr[o + 3] = lx * far;
      arr[o + 5] = lz * far;
    }
    d.fanPos.needsUpdate = true;
  };

  const viewDrone = (d: Drone, dt: number, time: number) => {
    if (!d.active) {
      if (d.shown) {
        d.shown = false;
        d.obj.position.set(0, -60 - d.id, 0);
        d.fan.position.set(0, -62 - d.id, 0);
        d.fanLine.position.copy(d.fan.position);
      }
      return;
    }
    if (d.vGen !== d.gen || !d.shown) {
      d.floorY = Infinity;
      d.fanT = 0;
      // a new drone in this pool slot
      d.vGen = d.gen;
      d.shown = true;
      d.pSt = d.st;
      d.pCharge = d.charge;
      d.flash = 0;
      d.shieldFlash = 0;
      d.coneK = d.st <= ST_SUSPICIOUS ? 1 : 0;
      d.shieldK = d.shield >= 0 ? 1 : 0;
      d.log = [];
      d.glow.emissive.setHex(d.st === ST_ALERT ? C_ALERT : d.st === ST_SUSPICIOUS ? C_SUS : C_UNAWARE);
      d.obj.rotation.set(0, d.yaw, 0);
    }
    const dead = d.st === ST_DYING;
    const off = d.st === ST_OFF;

    if (d.st !== d.pSt) {
      if (d.st === ST_SUSPICIOUS && d.pSt === ST_UNAWARE) sndSus(d);
      else if (d.st === ST_ALERT) sndAlert(d);
      else if (dead) {
        sndDeath(d);
        burstFx(d.x, d.y, d.z, d.type === 'sentinel' ? 16 : 9, d.type === 'sentinel' ? 6 : 4.5, d.type === 'sentinel' ? 0.16 : 0.1, 1);
        burstFx(d.x, d.y, d.z, 4, 2.5, 0.1, 2);
      } else if (off) sndPowerDown(d);
      d.glow.emissive.setHex(d.st === ST_ALERT ? C_ALERT : d.st === ST_SUSPICIOUS ? C_SUS : C_UNAWARE);
      d.log.push(d.st);
      d.pSt = d.st;
    }
    if (d.charge > 0 && d.pCharge <= 0) sndCharge(d);
    d.pCharge = d.charge;

    const bob = dead || off ? 0 : Math.sin(time * 2.1 + d.id * 1.7) * 0.045;
    d.obj.position.set(d.x, d.y + bob, d.z);
    const rot = d.obj.rotation;
    if (dead) {
      rot.x += dt * 7;
      rot.z += dt * 5;
    } else if (off) {
      rot.y = d.yaw;
      rot.x += (0.22 - rot.x) * Math.min(1, dt * 4);
      rot.z += (0.3 - rot.z) * Math.min(1, dt * 4);
    } else {
      const jam = d.td > 0 ? (Math.random() - 0.5) * 0.12 : 0;
      rot.y = d.yaw;
      rot.x = Math.sin(time * 1.3 + d.id) * 0.03 + jam;
      rot.z = Math.sin(time * 1.7 + d.id * 2.2) * 0.04 + jam;
    }

    // glow: state colour, brighter while charging, white when hit
    if (d.flash > 0) d.flash -= dt;
    let glow = d.st === ST_ALERT ? 4.2 + d.charge * 8 : d.st === ST_SUSPICIOUS ? 3.2 + Math.sin(time * 14) * 1.4 : 2.6;
    if (d.td > 0) glow *= 0.25 + Math.random() * 0.9;
    if (d.flash > 0) glow += 9;
    if (dead) glow = Math.random() < 0.5 ? 6 : 0.3;
    if (off) glow = 0;
    d.glow.emissiveIntensity = glow;

    // charge orb at the emitter
    const orbScale = d.charge > 0 && !dead && !off ? (d.type === 'sentinel' ? 0.05 + d.charge * 0.2 : 0.03 + d.charge * 0.1) * (0.9 + Math.random() * 0.2) : 0.0001;
    d.orb.scale.setScalar(orbScale);

    // what it sees, shown only while it does not know where you are
    const coneTarget = d.st <= ST_SUSPICIOUS && d.td <= 0 ? 1 : 0;
    d.coneK += (coneTarget - d.coneK) * Math.min(1, dt * 8);
    if (d.coneK > 0.02) {
      d.fanT -= dt;
      if (d.fanT <= 0) {
        d.fanT = 0.05;
        measureFan(d);
      }
      const sus = d.st === ST_SUSPICIOUS ? 1 : 0;
      d.fan.material = fanMats[sus];
      d.fanLine.material = fanLineMats[sus];
      d.fan.position.set(d.x, d.floorY + 0.035, d.z);
      d.fan.rotation.y = d.yaw;
      d.fan.scale.setScalar(Math.max(0.0001, d.coneK));
      d.fanLine.position.set(d.x, d.floorY + 0.045, d.z);
      d.fanLine.rotation.y = d.yaw;
      d.fanLine.scale.copy(d.fan.scale);
    } else if (d.fan.position.y > -60) {
      d.fan.position.set(0, -62 - d.id, 0);
      d.fanLine.position.copy(d.fan.position);
    }

    if (d.rotor) {
      d.spin += dt * (off ? 0 : dead ? 8 : 38);
      d.rotor.rotation.y = d.spin;
    }
    if (d.shieldMesh && d.shieldMat) {
      if (d.shieldFlash > 0) d.shieldFlash -= dt;
      const up = d.shield >= 0 && !dead && !off;
      d.shieldK += ((up ? 1 : 0) - d.shieldK) * Math.min(1, dt * (up ? 3 : 14));
      d.shieldMesh.scale.setScalar(Math.max(0.0001, d.shieldK));
      const weak = up ? 0.45 + 0.55 * d.shield : 1;
      const f = (0.75 + Math.sin(time * 5 + d.id) * 0.12) * weak + (d.shieldFlash > 0 ? 3 : 0);
      d.shieldMat.color.setRGB(0.2 * f, 0.75 * f, 1.5 * f);
    }
  };

  const viewShots = (time: number) => {
    for (const s of shots) {
      if (!s.active) {
        if (s.shown) {
          s.shown = false;
          s.mesh.position.set(0, -70, 0);
        }
        continue;
      }
      if (!s.shown) {
        s.shown = true;
        s.mesh.geometry = s.kind === 1 ? orbGeo : boltGeo;
        s.mesh.material = s.kind === 1 ? orbMat : boltMat;
      }
      s.mesh.position.set(s.x, s.y, s.z);
      if (s.kind === 1) {
        s.mesh.scale.setScalar(0.2 + Math.sin(time * 30 + s.id) * 0.035);
        s.mesh.rotation.set(time * 5, time * 3, 0);
      } else {
        s.mesh.scale.setScalar(1);
        s.mesh.lookAt(vA.set(s.x + s.vx, s.y + s.vy, s.z + s.vz));
      }
    }
  };

  const viewFx = (dt: number) => {
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.position.set(0, -72, 0);
        continue;
      }
      s.vy -= 6 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.scale.setScalar(s.size * (s.life / s.max));
    }
    for (const tr of tracers) {
      if (tr.life <= 0) continue;
      tr.life -= dt;
      if (tr.life <= 0) tr.mesh.position.set(0, -74, 0);
      else {
        const w = 0.022 * (tr.life / 0.085);
        tr.mesh.scale.x = w;
        tr.mesh.scale.y = w;
      }
    }
  };

  const viewBeacons = (time: number) => {
    const s = session;
    let n = 0;
    if (s) {
      for (const pid in downView) {
        if (pid === s.pid || n >= beacons.length) continue;
        const pose = s.poseOf(pid);
        if (!pose) continue;
        const b = beacons[n++];
        b.position.set(pose.x, pose.y + 0.02, pose.z);
        const k = 1 + Math.sin(time * 5) * 0.12;
        b.scale.set(k, 1, k);
      }
    }
    for (let i = n; i < beacons.length; i++) if (beacons[i].position.y > -70) beacons[i].position.set(0, -76, 0);
  };

  // ======================================================================
  // Local player: weapon, holds (takedown / revive), camera, HUD
  // ======================================================================
  const isDown = (pid?: string): boolean => {
    const s = session;
    if (!s) return false;
    return !!downView[pid ?? s.pid];
  };
  const hpOf = (pid?: string): number => {
    const s = session;
    if (!s) return PLAYER_HP;
    const id = pid ?? s.pid;
    if (s.isHost) return pmap.get(id)?.hp ?? PLAYER_HP;
    return hpView.get(id) ?? PLAYER_HP;
  };

  /** Ray against one drone, in its own frame. Returns the distance or -1 and sets `hitPart`. */
  let hitPart: HitPart = 'body';
  const rayDrone = (d: Drone, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number => {
    const pos = d.obj.position;
    if (d.type === 'scout') {
      hitPart = 'body';
      return raySphere(ox, oy, oz, dx, dy, dz, pos.x, pos.y, pos.z, SCOUT_RADIUS);
    }
    // into the sentinel's frame (it only ever yaws for hit purposes)
    const c = Math.cos(d.yaw);
    const s = Math.sin(d.yaw);
    const rx = ox - pos.x;
    const rz = oz - pos.z;
    const lx = rx * c - rz * s;
    const lz = rx * s + rz * c;
    const ly = oy - pos.y;
    const ldx = dx * c - dz * s;
    const ldz = dx * s + dz * c;
    let best = -1;
    hitPart = 'body';
    const body = raySphere(lx, ly, lz, ldx, dy, ldz, 0, 0, 0, SENTINEL_RADIUS);
    if (body >= 0) best = body;
    const core = raySphere(lx, ly, lz, ldx, dy, ldz, 0, 0.02, 0.56, 0.27);
    if (core >= 0 && (best < 0 || core < best)) {
      best = core;
      hitPart = 'core';
    }
    if (d.shield >= 0 && lz < SHIELD_Z && ldz > 1e-4) {
      const tt = (SHIELD_Z - lz) / ldz;
      const hx = lx + ldx * tt;
      const hy = ly + dy * tt;
      if (hx * hx + hy * hy <= SHIELD_R * SHIELD_R && (best < 0 || tt < best)) {
        best = tt;
        hitPart = 'shield';
      }
    }
    return best;
  };

  const startReload = () => {
    if (reloadT > 0 || ammo >= MAG_SIZE) return;
    reloadT = RELOAD_TIME;
    autoReload = 0;
    sndReload();
  };

  /** One trigger pull of the local player. */
  const fire = (): boolean => {
    const s = session;
    const player = deps.player();
    if (!s || !player || ammo <= 0 || reloadT > 0) return false;
    ammo--;
    sinceShot = 0;
    const cam = engine.camera;
    cam.getWorldPosition(vA);
    cam.getWorldDirection(vB);
    // spread: a small cone that opens up with rapid fire
    const spread = 0.004 + heat * 0.02;
    if (spread > 0) {
      vC.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * spread);
      vB.add(vC).normalize();
    }
    heat = Math.min(1, heat + 0.22);

    let bestT = MAX_RANGE;
    let bestId = -1;
    let bestPart: HitPart = 'body';
    for (const d of drones) {
      if (!d.active || d.st > ST_ALERT) continue;
      const tt = rayDrone(d, vA.x, vA.y, vA.z, vB.x, vB.y, vB.z);
      if (tt >= 0 && tt < bestT) {
        bestT = tt;
        bestId = d.id;
        bestPart = hitPart;
      }
    }
    const wall = physics.raycast(vA, vB, bestT, player.body.collider);
    if (wall !== null && wall < bestT) {
      bestT = wall;
      bestId = -1;
    }
    const hitSomething = bestId >= 0 || wall !== null;
    vC.copy(vB).multiplyScalar(bestT).add(vA); // end point
    muzzle.getWorldPosition(vB);
    tracer(vB, vC);
    if (hitSomething) burstFx(vC.x, vC.y, vC.z, bestId >= 0 ? 4 : 3, 2.2, 0.05, bestId >= 0 && bestPart === 'shield' ? 2 : 0);
    flashT = 0.06;
    kick += 0.02;
    gunKick = 1;
    if (audible()) sndShot(audio.out(undefined, 0.3));
    if (bestId >= 0) hitMarker(bestPart);
    s.intent('sh.fire', { e: [r2(vC.x), r2(vC.y), r2(vC.z)], id: bestId, part: bestPart });
    if (ammo === 0) autoReload = 0.35;
    return true;
  };

  // --- holds
  let holdKind: '' | 'td' | 'rev' = '';
  let holdId = '';
  const holdStop = () => {
    if (!holdKind) return;
    if (holdKind === 'td') session?.intent('sh.td', { id: Number(holdId), on: false });
    else session?.intent('sh.rev', { t: holdId, on: false });
    holdKind = '';
    holdId = '';
  };

  const setPrompt = (text: string, prog: number) => {
    if (text !== hudState.prompt) {
      hudState.prompt = text;
      promptBox.classList.toggle('hidden', !text);
      promptText.textContent = text;
    }
    const p = Math.round(clamp01(prog) * 50) / 50;
    if (p !== hudState.prog) {
      hudState.prog = p;
      promptFill.style.transform = `scaleX(${p})`;
    }
  };

  const localPlayer = (dt: number, time: number) => {
    const s = session;
    const player = deps.player();
    if (!s || !player) {
      gun.position.copy(GUN_AWAY);
      muzzleLight.intensity = 0;
      return;
    }
    const input = getInput();
    const cam = engine.camera;
    const me = s.pid;
    const down = isDown(me);

    if (down !== wasDown) {
      wasDown = down;
      if (down) {
        player.frozen = true;
        froze = true;
        holdStop();
        reloadT = 0;
        sndDown();
      } else if (froze) {
        player.frozen = false;
        froze = false;
        ammo = MAG_SIZE;
      }
    }
    // on the floor: camera low and tilted
    downK += ((down ? 1 : 0) - downK) * (1 - Math.exp(-5 * dt));
    if (downK > 0.002) {
      cam.position.y += (player.position.y + 0.42 - cam.position.y) * downK;
      cam.rotation.z += 0.5 * downK;
      cam.rotation.x += 0.12 * downK;
    }
    // recoil and hit shake are added on top of what the player controller wrote
    kick *= Math.exp(-11 * dt);
    shake *= Math.exp(-7 * dt);
    cam.rotation.x += kick + (Math.random() - 0.5) * shake * 0.04;
    cam.rotation.y += (Math.random() - 0.5) * shake * 0.04;

    // ---- weapon
    sinceShot += dt;
    heat = Math.max(0, heat - dt * 1.6);
    const armed = api.enabled && !down && !player.frozen;
    if (reloadT > 0) {
      reloadT -= dt;
      if (reloadT <= 0) {
        reloadT = 0;
        ammo = MAG_SIZE;
      }
    }
    if (autoReload > 0) {
      autoReload -= dt;
      if (autoReload <= 0 && ammo === 0) startReload();
    }
    if (armed && input) {
      if (input.codePressed('KeyR')) startReload();
      // a click on something usable is a "use", not a shot
      const pressed = input.firePressed() && !interactions.focused;
      const held = input.fireHeld() && !interactions.focused;
      if (reloadT <= 0 && ((pressed && sinceShot >= FIRE_INTERVAL) || (held && sinceShot >= AUTO_INTERVAL))) {
        if (ammo > 0) fire();
        else if (pressed) {
          sndDry();
          startReload();
        }
      }
    }

    // ---- view model
    if (armed) {
      const blocked = physics.raycast(player.eye, player.forward, 0.85, player.body.collider);
      lower += ((blocked !== null ? 1 : 0) - lower) * (1 - Math.exp(-10 * dt));
      gunKick *= Math.exp(-14 * dt);
      const yawRate = angleDelta(lastYaw, player.yaw) / Math.max(dt, 1e-3);
      swayX += (Math.max(-1, Math.min(1, yawRate * 0.12)) - swayX) * (1 - Math.exp(-8 * dt));
      const rk = reloadT > 0 ? Math.sin(Math.PI * (1 - reloadT / RELOAD_TIME)) : 0;
      gun.position.set(GUN_REST.x + swayX * 0.012, GUN_REST.y - rk * 0.09 - lower * 0.1 + Math.sin(time * 1.7) * 0.0025, GUN_REST.z + gunKick * 0.045 + lower * 0.1);
      gun.rotation.set(gunKick * 0.16 - rk * 0.75 - lower * 0.7, swayX * 0.05, rk * 0.35);
      gunGlow.emissiveIntensity = reloadT > 0 ? 0.3 + 1.5 * (1 - reloadT / RELOAD_TIME) : ammo === 0 ? 0.15 : 0.7 + 0.8 * (ammo / MAG_SIZE);
    } else gun.position.copy(GUN_AWAY);
    lastYaw = player.yaw;
    if (flashT > 0) {
      flashT -= dt;
      const f = Math.max(0, flashT / 0.06);
      flash.scale.setScalar(0.0001 + f * (0.8 + Math.random() * 0.5));
      flash.rotation.z = Math.random() * 6;
      muzzleLight.intensity = 9 * f;
    } else if (muzzleLight.intensity !== 0) {
      muzzleLight.intensity = 0;
      flash.scale.setScalar(0.0001);
    }

    // ---- hold E: get a crew member up, or shut an unaware drone down from behind
    let candKind: '' | 'td' | 'rev' = '';
    let candId = '';
    let promptT = '';
    let prog = 0;
    if (!down && !player.frozen && api.enabled) {
      const pos = player.position;
      let bd = REVIVE_RANGE;
      for (const pid in downView) {
        if (pid === me) continue;
        const pose = s.poseOf(pid);
        if (!pose) continue;
        const by = revView[pid]?.by;
        if (by && by !== me) continue; // someone is already on it
        const dist = Math.hypot(pose.x - pos.x, pose.z - pos.z);
        if (dist < bd) {
          bd = dist;
          candKind = 'rev';
          candId = pid;
        }
      }
      if (candKind === 'rev') {
        promptT = t('sh.prompt.revive', { name: s.players.get(candId)?.name ?? '?' });
        const r = revView[candId];
        if (r && r.by === me) prog = (s.hostNow() - r.at) / (REVIVE_TIME * 1000);
      } else {
        let best = TAKEDOWN_RANGE;
        for (const d of drones) {
          if (!d.active || d.st !== ST_UNAWARE) continue;
          if (Math.abs(pos.y + 1 - d.y) > 2) continue;
          const dx = pos.x - d.x;
          const dz = pos.z - d.z;
          if (!canTakedown(d.st, dx, dz, d.yaw)) continue;
          const dist = Math.hypot(dx, dz);
          if (dist < best) {
            best = dist;
            candKind = 'td';
            candId = String(d.id);
            prog = d.td;
          }
        }
        if (candKind === 'td') promptT = t('sh.prompt.takedown');
      }
    }
    const wantHold = !!candKind && !!input && input.held('use');
    if (holdKind && (!wantHold || candKind !== holdKind || candId !== holdId)) holdStop();
    if (wantHold && !holdKind) {
      holdKind = candKind;
      holdId = candId;
      if (candKind === 'td') s.intent('sh.td', { id: Number(candId), on: true });
      else s.intent('sh.rev', { t: candId, on: true });
    }
    setPrompt(promptT, holdKind ? prog : 0);

    // ---- HUD
    const hp = Math.round(hpOf(me));
    if (hp !== hudState.hp) {
      hudState.hp = hp;
      hpNum.textContent = String(hp);
      hpFill.style.transform = `scaleX(${clamp01(hp / PLAYER_HP)})`;
      const low = hp <= 35;
      if (low !== hudState.low) {
        hudState.low = low;
        hpBox.classList.toggle('low', low);
      }
    }
    const reloading = reloadT > 0;
    if (ammo !== hudState.ammo || reloading !== hudState.reload) {
      hudState.ammo = ammo;
      hudState.reload = reloading;
      ammoNum.replaceChildren(reloading ? t('sh.reload') : String(ammo), h('small', {}, reloading ? '' : ' / ' + MAG_SIZE));
      for (let i = 0; i < pips.length; i++) pips[i].className = i < ammo ? '' : 'off';
      ammoBox.classList.toggle('empty', ammo === 0 && !reloading);
      ammoBox.classList.toggle('reload', reloading);
    }
    const aw = down ? -1 : api.awareness();
    if (aw !== hudState.aware) {
      if (aw === 2 && hudState.aware >= 0 && hudState.aware < 2) sndSpotted();
      hudState.aware = aw;
      awareBox.className = 'sh-aware' + (aw < 0 ? ' hidden' : ' s' + aw);
      awareText.textContent = aw === 2 ? t('sh.aw.spotted') : aw === 1 ? t('sh.aw.sus') : t('sh.aw.hidden');
    }
    // downed overlay
    let downKey = '';
    let dProg = -1;
    if (down) {
      const r = revView[me];
      if (wiping) downKey = t('sh.down.wipe');
      else if (r) {
        downKey = t('sh.down.by', { name: s.players.get(r.by)?.name ?? '?' });
        dProg = Math.round(clamp01((s.hostNow() - r.at) / (REVIVE_TIME * 1000)) * 50) / 50;
      } else downKey = s.players.size > 1 ? t('sh.down.wait') : t('sh.down.wipe');
    }
    if (downKey !== hudState.down) {
      hudState.down = downKey;
      downBox.classList.toggle('hidden', !downKey);
      downText.textContent = downKey;
    }
    if (dProg !== hudState.downProg) {
      hudState.downProg = dProg;
      downProg.classList.toggle('hidden', dProg < 0);
      downFill.style.transform = `scaleX(${Math.max(0, dProg)})`;
    }
    // damage vignette and direction markers
    if (hurtFlash > 0) hurtFlash = Math.max(0, hurtFlash - dt * 2.2);
    const v = Math.round(Math.min(1, (hp < 40 ? ((40 - hp) / 40) * 0.7 : 0) + hurtFlash * 0.8) * 25) / 25;
    if (v !== hudState.vig) {
      hudState.vig = v;
      vig.style.opacity = String(v);
    }
    for (let i = 0; i < dirs.length; i++) {
      const dd = dirs[i];
      if (dd.life <= 0) continue;
      dd.life -= dt;
      const el = dirEls[i];
      if (dd.life <= 0) {
        el.style.opacity = '0';
        continue;
      }
      // angle of the source relative to where I look, clockwise on screen
      const ang = Math.atan2(dd.x - player.position.x, -(dd.z - player.position.z)) + player.yaw;
      el.style.opacity = String(Math.min(1, dd.life * 1.6));
      el.style.transform = `rotate(${ang.toFixed(3)}rad)`;
    }
  };

  // ======================================================================
  // Events (every peer)
  // ======================================================================
  const onEvent = (name: string, a: any) => {
    const s = session;
    if (!s) return;
    switch (name) {
      case 'sh.shot': {
        const mine = a.p === s.pid;
        const d = a.id >= 0 ? drones[a.id] : undefined;
        if (!mine) {
          const pose = s.poseOf(a.p);
          if (pose) {
            const crouch = (pose.flags & FLAG_CROUCH) !== 0;
            // roughly where their pistol is
            vA.set(pose.x + Math.cos(pose.yaw) * 0.2 + forwardX(pose.yaw) * 0.4, pose.y + (crouch ? 0.8 : 1.36), pose.z - Math.sin(pose.yaw) * 0.2 + forwardZ(pose.yaw) * 0.4);
            if (a.e) {
              vB.set(a.e[0], a.e[1], a.e[2]);
              tracer(vA, vB);
              burstFx(vB.x, vB.y, vB.z, 3, 2.2, 0.05, a.r === 2 ? 2 : 0);
            }
            sndShot(posOut(vA.x, vA.y, vA.z, 0.7));
          }
        }
        if (d && d.active) {
          d.flash = 0.09;
          if (a.r === 2) {
            d.shieldFlash = 0.18;
            if (d.shield < 0 || (s.isHost && d.shieldDown > 0)) sndShieldBreak(d);
            else sndShieldHit(d);
          }
        }
        if (mine && a.id >= 0) {
          // the host's verdict replaces the optimistic marker
          hitMarker(a.k ? 'kill' : CODE_PART[a.r] ?? 'body');
          if (a.k) audio.play('tick', { vol: 0.9, rate: 0.7 });
        }
        break;
      }
      case 'sh.dmg': {
        if (a.p !== s.pid) break;
        hurtFlash = 1;
        shake = Math.min(1.6, shake + a.d / 22);
        const slot = dirs[dirNext];
        dirNext = (dirNext + 1) % dirs.length;
        slot.x = a.x;
        slot.z = a.z;
        slot.life = 1.3;
        sndHurt(a.d >= 25);
        break;
      }
      case 'sh.downed':
        if (a.p !== s.pid) ui.toast(t('sh.toast.down', { name: s.players.get(a.p)?.name ?? '?' }), 'warn');
        break;
      case 'sh.up':
        if (a.p !== s.pid) ui.toast(t('sh.toast.up', { name: s.players.get(a.p)?.name ?? '?' }));
        audio.play('ok', { vol: 0.7 });
        break;
      case 'sh.wipe':
        wiping = true;
        break;
      case 'sh.reset':
        wiping = false;
        ammo = MAG_SIZE;
        reloadT = 0;
        break;
    }
  };

  // ======================================================================
  // API
  // ======================================================================
  const api: Shooting = {
    tun,
    enabled: true,
    frozen: false,
    onWipe: null,
    onDroneDown: null,
    onAlert: null,

    attach(s: Session) {
      session = s;
      api.clear();
      pmap.clear();
      hpView.clear();
      downMap = {};
      revMap = {};
      wipeT = -1;
      lastSeq = 0;
      lastPacketAt = 0;
      seq = 0;
      castT = 0;
      ammo = MAG_SIZE;
      reloadT = 0;
      wasDown = false;
      froze = false;
      downK = 0;
      wiping = false;
      hurtFlash = 0;
      holdKind = '';
      resetHud();
      const readState = () => {
        downView = s.get<Record<string, number>>('sh.down') ?? NONE;
        revView = s.get<RevMap>('sh.rev') ?? NONE;
      };
      unsubs.push(
        s.onState((path) => {
          if (path === '' || path.startsWith('sh')) readState();
        }),
      );
      if (s.isHost) installHost(s);
      readState();
      unsubs.push(
        s.onEvent(onEvent),
        s.onCast((name, data) => {
          if (name === 'sh' && !s.isHost) onPacket(data);
        }),
      );
      hud.classList.remove('hidden');
      startHum();
    },

    detach() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      const player = deps.player();
      if (player && froze) player.frozen = false;
      froze = false;
      session = null;
      downView = NONE;
      revView = NONE;
      api.clear();
      pmap.clear();
      plist.length = 0;
      hud.classList.add('hidden');
      gun.position.copy(GUN_AWAY);
      muzzleLight.intensity = 0;
      stopHum();
    },

    update(dt: number, time: number) {
      const s = session;
      sndBudget = Math.min(10, sndBudget + dt * 14);
      if (simulating()) simulate(dt, time);
      else interpolate(dt);
      if (s && s.isHost) {
        castT += dt;
        if (castT >= 1 / CAST_HZ) {
          castT = 0;
          sendCast(s);
        }
      }
      for (const d of drones) viewDrone(d, dt, time);
      viewShots(time);
      viewFx(dt);
      viewBeacons(time);
      coreMat.emissiveIntensity = 3.6 + Math.sin(time * 6) * 1.2;
      localPlayer(dt, time);

      // the hum follows the nearest working drone
      if (hum) {
        humT -= dt;
        if (humT <= 0) {
          humT = 0.12;
          const cam = engine.camera.position;
          let best: Drone | null = null;
          let bd = Infinity;
          for (const d of drones) {
            if (!d.active || d.st >= ST_DYING) continue;
            const dd = (d.x - cam.x) ** 2 + (d.y - cam.y) ** 2 + (d.z - cam.z) ** 2;
            if (dd < bd) {
              bd = dd;
              best = d;
            }
          }
          const c = audio.ctx;
          if (best && s) {
            hum.pan.positionX.setTargetAtTime(best.x, c.currentTime, 0.08);
            hum.pan.positionY.setTargetAtTime(best.y, c.currentTime, 0.08);
            hum.pan.positionZ.setTargetAtTime(best.z, c.currentTime, 0.08);
            hum.gain.gain.setTargetAtTime(best.type === 'sentinel' ? 0.16 : 0.1, c.currentTime, 0.2);
          } else hum.gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.2);
        }
      }
    },

    spawn(spec: SpawnSpec): number {
      if (!simulating()) return -1;
      // a free pool slot, or failing that a husk nobody will miss
      const d = drones.find((x) => !x.active && x.type === spec.type) ?? drones.find((x) => x.active && x.st === ST_OFF && x.type === spec.type);
      if (!d) return -1;
      const scout = spec.type === 'scout';
      d.active = true;
      d.gen = (d.gen + 1) % 1000;
      d.x = spec.x;
      d.z = spec.z;
      d.baseY = spec.y ?? (scout ? 1.75 : 1.6);
      d.y = spec.fromY ?? d.baseY;
      d.yaw = spec.yaw ?? 0;
      d.st = spec.alert ? ST_ALERT : ST_UNAWARE;
      d.hp = scout ? SCOUT_HP : SENTINEL_HP;
      d.charge = 0;
      d.shield = scout ? -1 : 1;
      d.shieldHp = tun.shieldHits;
      d.shieldDown = 0;
      d.td = 0;
      d.tdBy = null;
      d.tdT = 0;
      d.vx = d.vz = 0;
      d.route = spec.route && spec.route.length ? spec.route : null;
      d.wp = 0;
      d.wait = 0;
      d.arrived = false;
      d.pause = spec.pause ?? 1.6;
      d.homeX = spec.x;
      d.homeZ = spec.z;
      d.homeYaw = d.yaw;
      d.sweep = spec.sweep ?? 0;
      d.ret = false;
      d.group = spec.group ?? 0;
      d.dmgScale = spec.dmg ?? 1;
      d.see = 0;
      d.sus = 0;
      d.heard = false;
      d.hunt = false;
      d.alarm = 0;
      d.senseAcc = (d.id % 5) * 0.02; // spread the sensing over several frames
      d.target = null;
      d.hasLos = false;
      d.lastX = spec.x;
      d.lastZ = spec.z;
      d.aimX = spec.x;
      d.aimY = 1;
      d.aimZ = spec.z;
      d.chargeT = -1;
      d.cool = spec.alert ? 1.2 + Math.random() * 1.6 : 0;
      d.strafe = Math.random() < 0.5 ? -1 : 1;
      d.strafeT = 1 + Math.random() * 2;
      d.climb = 0;
      d.blockT = 0;
      d.dieT = 0;
      d.fall = 0;
      return d.id;
    },

    clear() {
      if (!simulating()) {
        // a client only forgets what it has been shown
        for (const d of drones) d.active = false;
        for (const s of shots) s.active = false;
        return;
      }
      for (const d of drones) {
        d.active = false;
        d.tdBy = null;
      }
      for (const s of shots) s.active = false;
    },

    shutdown(group?: number) {
      if (!simulating()) return;
      for (const d of drones) if (d.active && (group === undefined || d.group === group)) disableDrone(d, null, false);
    },

    killAll(group?: number) {
      if (!simulating()) return;
      for (const d of drones) if (d.active && d.st === ST_OFF && (group === undefined || d.group === group)) d.active = false;
      for (const d of drones) if (d.active && (group === undefined || d.group === group)) killDrone(d, null);
    },

    kill(id: number) {
      if (simulating() && drones[id]) killDrone(drones[id], null);
    },

    alertAll(group?: number) {
      if (!simulating()) return;
      for (const d of drones) if (d.active && d.st < ST_ALERT && (group === undefined || d.group === group)) becomeAlert(d, null);
    },

    alive(type?: DroneType, group?: number) {
      let n = 0;
      for (const d of drones) if (d.active && d.st <= ST_ALERT && (!type || d.type === type) && (group === undefined || d.group === group)) n++;
      return n;
    },

    resetPlayers() {
      const s = session;
      if (!s || !s.isHost) return;
      for (const p of pmap.values()) {
        p.hp = PLAYER_HP;
        p.down = false;
        p.sinceHurt = 99;
      }
      downMap = {};
      revMap = {};
      wipeT = -1;
      s.set('sh.down', downMap);
      s.set('sh.rev', revMap);
      s.emit('sh.reset');
    },

    hurt,

    drones() {
      const out: DroneInfo[] = [];
      for (const d of drones) {
        if (!d.active) continue;
        out.push({ id: d.id, type: d.type, x: d.x, y: d.y, z: d.z, yaw: d.yaw, st: d.st, hp: d.hp, shield: d.shield, charge: d.charge, group: d.group, log: d.log.slice() });
      }
      return out;
    },

    shots() {
      let n = 0;
      for (const s of shots) if (s.active) n++;
      return n;
    },

    hp: hpOf,
    isDown,

    awareness() {
      let top = -1;
      for (const d of drones) {
        if (!d.active || d.st > ST_ALERT) continue;
        if (d.st > top) top = d.st;
      }
      return top;
    },

    ammo: () => ammo,

    debugFire() {
      if (sinceShot < FIRE_INTERVAL) return false;
      engine.camera.updateMatrixWorld();
      return fire();
    },
  };

  return api;
}
