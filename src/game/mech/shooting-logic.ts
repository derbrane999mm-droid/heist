// Pure rules of the shooting mechanic: tuning per difficulty, awareness,
// damage, wave scheduling and the small geometry tests. No three.js, no DOM,
// no session: everything here runs in plain Node (see tests/shooting-logic.mjs).

export type DroneType = 'scout' | 'sentinel';
export type HitPart = 'body' | 'core' | 'shield';

/** Drone states as sent over the wire. */
export const ST_UNAWARE = 0;
export const ST_SUSPICIOUS = 1;
export const ST_ALERT = 2;
export const ST_DYING = 3;
/** Disabled by a silent takedown: an inert husk on the floor. */
export const ST_OFF = 4;

export const PLAYER_HP = 100;
export const REGEN_DELAY = 4; // seconds without damage before health comes back
export const REGEN_RATE = 22; // hp per second
export const REVIVE_HP = 45;
export const REVIVE_TIME = 2; // seconds of holding E
export const TAKEDOWN_TIME = 1;
export const TAKEDOWN_RANGE = 2.3;
export const REVIVE_RANGE = 2.6;
export const MAG_SIZE = 12;
export const RELOAD_TIME = 1.25;
export const FIRE_INTERVAL = 0.16; // fastest follow-up shot when clicking
export const AUTO_INTERVAL = 0.3; // repeat rate while the trigger is held
export const MAX_RANGE = 60;

export const EYE_STAND = 1.64;
export const EYE_CROUCH = 0.98;
export const BODY_STAND = 1.78;
export const BODY_CROUCH = 1.1;
export const PLAYER_RADIUS = 0.32;

export const SCOUT_HP = 2;
export const SENTINEL_HP = 8;
export const SCOUT_RADIUS = 0.4;
export const SENTINEL_RADIUS = 0.62;
/** Vision cone half-angles in radians. */
export const VIEW_HALF = 0.66;
export const VIEW_HALF_V = 0.7;

export interface Tuning {
  diff: number;
  /** Damage multiplier for everything that hits a player. */
  dmg: number;
  /** Drone movement and turn-rate multiplier. */
  speed: number;
  viewDist: number;
  /** Seconds of sight it takes a suspicious drone to raise the alarm. */
  spotTime: number;
  /** Seconds a drone keeps investigating after it lost the trail. */
  susTime: number;
  chargeScout: number;
  chargeSentinel: number;
  /** Seconds between two attacks of the same drone. */
  gapScout: number;
  gapSentinel: number;
  boltSpeed: number;
  orbSpeed: number;
  /** How far a drone may lead a moving target (0 = aims where you stand, 1 = perfect lead). */
  lead: number;
  /** Drones allowed to charge at the same time, per crew member. */
  tokens: number;
  /** Shots the sentinel's shield absorbs before it overloads. */
  shieldHits: number;
  hearShot: number;
  hearSprint: number;
  hearWalk: number;
}

const TUNING: Record<number, Tuning> = {
  1: { diff: 1, dmg: 0.7, speed: 0.85, viewDist: 11, spotTime: 1.35, susTime: 2.4, chargeScout: 0.75, chargeSentinel: 1.0, gapScout: 2.9, gapSentinel: 3.9, boltSpeed: 10, orbSpeed: 7, lead: 0.45, tokens: 2, shieldHits: 4, hearShot: 13, hearSprint: 6, hearWalk: 2.2 },
  2: { diff: 2, dmg: 1, speed: 1, viewDist: 13, spotTime: 1.0, susTime: 2.0, chargeScout: 0.6, chargeSentinel: 0.85, gapScout: 2.2, gapSentinel: 3.1, boltSpeed: 12, orbSpeed: 8, lead: 0.8, tokens: 3, shieldHits: 5, hearShot: 16, hearSprint: 7.5, hearWalk: 2.8 },
  3: { diff: 3, dmg: 1.35, speed: 1.15, viewDist: 15, spotTime: 0.7, susTime: 2.0, chargeScout: 0.6, chargeSentinel: 0.75, gapScout: 1.7, gapSentinel: 2.5, boltSpeed: 14, orbSpeed: 9.5, lead: 1, tokens: 4, shieldHits: 6, hearShot: 19, hearSprint: 9, hearWalk: 3.4 },
};

export function clampDiff(raw: unknown): number {
  const n = Math.round(Number(raw));
  return n === 1 || n === 3 ? n : 2;
}

export function tuning(diff: unknown): Tuning {
  return TUNING[clampDiff(diff)];
}

export const BOLT_DAMAGE = 10;
export const ORB_DAMAGE = 40;

export function projectileDamage(kind: number, tun: Tuning, scale = 1): number {
  return Math.max(1, Math.round((kind === 1 ? ORB_DAMAGE : BOLT_DAMAGE) * tun.dmg * scale));
}

// ---------------------------------------------------------------------------
// Senses
// ---------------------------------------------------------------------------

/** Forward vector convention of the whole game: yaw 0 looks down -z. */
export function forwardX(yaw: number) {
  return -Math.sin(yaw);
}
export function forwardZ(yaw: number) {
  return -Math.cos(yaw);
}

/** A crouched player is harder to make out at a distance. */
export function viewRange(tun: Tuning, crouched: boolean): number {
  return crouched ? tun.viewDist * 0.62 : tun.viewDist;
}

/**
 * Is the point (dx, dy, dz), relative to a drone looking along `yaw`, inside
 * its vision cone? Geometry only: the caller still has to check line of sight.
 */
export function inViewCone(dx: number, dy: number, dz: number, yaw: number, range: number, half = VIEW_HALF, halfV = VIEW_HALF_V): boolean {
  const flat = Math.hypot(dx, dz);
  const dist = Math.hypot(flat, dy);
  if (dist > range) return false;
  if (dist < 0.9) return true; // bumping into it
  if (Math.abs(Math.atan2(dy, flat)) > halfV) return false;
  if (flat < 1e-4) return true;
  const dot = (dx * forwardX(yaw) + dz * forwardZ(yaw)) / flat;
  return dot >= Math.cos(half);
}

/** How quickly sight turns into certainty: close and upright is fast. */
export function sightFactor(dist: number, range: number, crouched: boolean): number {
  const near = 1 - Math.min(1, Math.max(0, dist / Math.max(range, 0.01)));
  return (0.7 + 1.8 * near * near) * (crouched ? 0.6 : 1);
}

/** Radius in which a moving player is heard. Crouch-walking is silent. */
export function moveNoise(speed: number, crouched: boolean, tun: Tuning): number {
  if (crouched || speed < 1.2) return 0;
  return speed > 4.6 ? tun.hearSprint : tun.hearWalk;
}

export interface Awareness {
  st: number;
  /** Accumulated sight, seconds (weighted). */
  see: number;
  /** Time left investigating. */
  sus: number;
}

/**
 * One awareness step for one drone. `visible` = a player is in the cone with a
 * clear line of sight, `factor` = sightFactor of the best visible player,
 * `noise` = it heard something this step. Mutates and returns the new state.
 */
export function stepAwareness(a: Awareness, visible: boolean, factor: number, noise: boolean, dt: number, tun: Tuning): number {
  if (a.st === ST_UNAWARE) {
    if (visible || noise) {
      a.st = ST_SUSPICIOUS;
      a.see = 0;
      a.sus = tun.susTime;
    }
  } else if (a.st === ST_SUSPICIOUS) {
    if (visible) {
      a.see += dt * factor;
      a.sus = tun.susTime;
      if (a.see >= tun.spotTime) a.st = ST_ALERT;
    } else {
      a.see = Math.max(0, a.see - dt * 0.5);
      if (noise) a.sus = tun.susTime;
      else {
        a.sus -= dt;
        if (a.sus <= 0) {
          a.st = ST_UNAWARE;
          a.see = 0;
        }
      }
    }
  }
  return a.st;
}

/** A takedown needs the player close and in the rear arc of an unaware drone. */
export function canTakedown(st: number, dx: number, dz: number, droneYaw: number, range = TAKEDOWN_RANGE): boolean {
  if (st !== ST_UNAWARE) return false;
  const flat = Math.hypot(dx, dz);
  if (flat > range) return false;
  if (flat < 1e-3) return true;
  // (dx, dz) points from the drone to the player
  const front = (dx * forwardX(droneYaw) + dz * forwardZ(droneYaw)) / flat;
  return front < -0.2;
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

export interface HitResult {
  part: HitPart;
  dmg: number;
}

/**
 * What a reported hit really does. `front` is the cosine between the drone's
 * facing and the direction to the shooter (1 = shooter dead ahead). The host
 * does not trust the part a client claims: a core hit needs the shooter behind
 * the drone, and a raised shield covers the whole front.
 */
export function resolveHit(type: DroneType, claimed: HitPart, shieldUp: boolean, front: number): HitResult {
  if (type === 'scout') return { part: 'body', dmg: 1 };
  if (shieldUp && (claimed === 'shield' || front > 0.3)) return { part: 'shield', dmg: 0 };
  if (claimed === 'core' && front < 0.15) return { part: 'core', dmg: 4 };
  // an overloaded shield leaves the armour exposed
  return { part: 'body', dmg: shieldUp ? 1 : 2 };
}

/** Player health after `dt` seconds; `sinceHurt` is the time since the last hit. */
export function regen(hp: number, sinceHurt: number, dt: number): number {
  if (hp <= 0 || hp >= PLAYER_HP || sinceHurt < REGEN_DELAY) return hp;
  return Math.min(PLAYER_HP, hp + REGEN_RATE * dt);
}

// ---------------------------------------------------------------------------
// Waves (arcade stage)
// ---------------------------------------------------------------------------

export interface WavePlan {
  /** Seconds between waves. */
  gap: number;
  /** Drones alive at the same time. */
  cap: number;
  /** Seconds the crew has to hold. */
  holdMs: number;
}

export function wavePlan(diff: number, players: number): WavePlan {
  const p = Math.max(1, Math.min(4, players));
  const d = clampDiff(diff);
  return {
    gap: [7.5, 6.5, 5.5][d - 1],
    cap: Math.min(12, [3, 4, 5][d - 1] + (p - 1) * 2),
    holdMs: [50000, 60000, 70000][d - 1],
  };
}

/** Drones in wave number `wave` (0-based): starts small and ramps up. */
export function waveSize(wave: number, diff: number, players: number): number {
  const p = Math.max(1, Math.min(4, players));
  const d = clampDiff(diff);
  const base = [2, 2, 3][d - 1] + Math.floor((p - 1) * 0.75);
  return Math.min(base + Math.floor(wave / 2), base + 3);
}

/** How many to spawn right now, given the wave size and what is still flying. */
export function spawnCount(size: number, alive: number, cap: number): number {
  return Math.max(0, Math.min(size, cap - alive));
}

export function stars(fails: number, timeMs: number, parMs: number): number {
  if (fails === 0 && timeMs <= parMs) return 3;
  if (fails <= 2) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Distance along a ray (unit direction) to a sphere, or -1. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  const t0 = tca - thc;
  if (t0 >= 0) return t0;
  return tca + thc >= 0 ? 0 : -1; // origin inside the sphere
}

/**
 * Does the segment a→b pass within `r` of the vertical segment from
 * (px, y0, pz) to (px, y1, pz)? Used for projectiles against a standing or
 * crouching player.
 */
export function segmentHitsCapsule(ax: number, ay: number, az: number, bx: number, by: number, bz: number, px: number, y0: number, y1: number, pz: number, r: number): boolean {
  // closest points of two segments, specialised for a vertical second segment
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vy = y1 - y0;
  const wx = ax - px;
  const wy = ay - y0;
  const wz = az - pz;
  const a = ux * ux + uy * uy + uz * uz;
  const b = uy * vy;
  const c = vy * vy;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vy * wy;
  const den = a * c - b * b;
  let s = den > 1e-9 ? (b * e - c * d) / den : 0;
  s = Math.max(0, Math.min(1, s));
  let tt = c > 1e-9 ? (b * s + e) / c : 0;
  tt = Math.max(0, Math.min(1, tt));
  // re-clamp s for the clamped t
  if (a > 1e-9) s = Math.max(0, Math.min(1, (b * tt - d) / a));
  const qx = wx + ux * s;
  const qy = wy + uy * s - vy * tt;
  const qz = wz + uz * s;
  return qx * qx + qy * qy + qz * qz <= r * r;
}

export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turn `from` towards `to` by at most `maxStep` radians. */
export function turnTowards(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/** Yaw that makes something at the origin face the point (dx, dz). */
export function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}
