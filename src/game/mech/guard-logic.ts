// Pure rules of the night watchman (src/game/mech/guard.ts): route following,
// vision, hearing, detection meters and the state machine. No three.js, no DOM,
// no session: everything here runs in plain Node (see tests/guard-logic.mjs).
//
// Conventions: yaw 0 looks down -z (same as the player), y is the floor height.

export const ST_PATROL = 0;
export const ST_SUSPICIOUS = 1;
export const ST_ALERT = 2;

/** What the guard is doing with his feet right now. */
export const M_WALK = 0; // following the route
export const M_PAUSE = 1; // standing at a waypoint, looking along its yaw
export const M_TURN = 2; // just noticed something: stops and turns towards it
export const M_GO = 3; // walking to the spot
export const M_LOOK = 4; // looking around at the spot
export const M_BACK = 5; // walking back to where he left the route
export const M_STARE = 6; // sees someone: stands and stares

export interface Pt {
  x: number;
  z: number;
}
export interface RoutePt {
  x: number;
  y: number;
  z: number;
  /** Stop here for a moment and look this way. */
  yaw?: number;
}
export interface WallBox {
  x: number;
  z: number;
  sx: number;
  sz: number;
}
export interface HideSpot {
  x: number;
  z: number;
  r?: number;
}

/** A crew member as the guards perceive him. */
export interface Watched {
  pid: string;
  x: number;
  y: number;
  z: number;
  crouch: boolean;
  /** moving at all (the pose's moving flag) */
  moving: boolean;
  /** his flashlight is on */
  light: boolean;
  /** horizontal speed in m/s (for footstep noise); 0 if unknown */
  speed: number;
}

export interface GuardTuning {
  speed: number;
  turnRate: number;
  viewDist: number;
  /** half of the vision cone, radians */
  viewHalf: number;
  crouchK: number;
  stillK: number;
  /** a lit flashlight: seen from this far whatever else */
  lightDist: number;
  /** seconds of sight to fill the meter at close range / at the edge of his range */
  closeTime: number;
  farTime: number;
  /** meter lost per second out of sight */
  decay: number;
  /** meter at which a patrolling guard turns suspicious */
  glimpse: number;
  /** seconds he stops and turns before walking to the spot */
  react: number;
  /** seconds he looks around at the spot */
  lookTime: number;
  /** seconds an alert lasts after the last sight */
  alertTime: number;
  /** inside a hiding spot he only sees you closer than this */
  hideNear: number;
  distractCooldown: number;
  /** noise radius of a sprinting / walking upright player */
  hearSprint: number;
  hearWalk: number;
  /** seconds he waits at a waypoint that has a yaw */
  pause: number;
}

const TUNING: Record<number, GuardTuning> = {
  1: { speed: 1.15, turnRate: 2.2, viewDist: 10, viewHalf: 0.61, crouchK: 0.5, stillK: 0.8, lightDist: 14, closeTime: 1.9, farTime: 5, decay: 0.3, glimpse: 0.22, react: 0.9, lookTime: 4, alertTime: 6, hideNear: 1.5, distractCooldown: 10, hearSprint: 6, hearWalk: 2.0, pause: 2.2 },
  2: { speed: 1.3, turnRate: 2.5, viewDist: 12, viewHalf: 0.61, crouchK: 0.55, stillK: 0.8, lightDist: 16, closeTime: 1.5, farTime: 4.2, decay: 0.25, glimpse: 0.2, react: 0.8, lookTime: 4, alertTime: 7, hideNear: 1.5, distractCooldown: 12, hearSprint: 7.5, hearWalk: 2.6, pause: 2 },
  3: { speed: 1.5, turnRate: 2.9, viewDist: 13, viewHalf: 0.66, crouchK: 0.6, stillK: 0.85, lightDist: 18, closeTime: 1.2, farTime: 3.5, decay: 0.2, glimpse: 0.18, react: 0.65, lookTime: 5, alertTime: 8, hideNear: 1.5, distractCooldown: 15, hearSprint: 9, hearWalk: 3.2, pause: 1.6 },
};

export function clampDiff(raw: unknown): number {
  const n = Math.round(Number(raw));
  return n === 1 || n === 3 ? n : 2;
}

export function guardTuning(diff: unknown, speed?: number): GuardTuning {
  const t = { ...TUNING[clampDiff(diff)] };
  if (speed && speed > 0) t.speed = speed;
  return t;
}

/** How many guards a calibration run gets per difficulty. */
export function guardCount(diff: unknown): number {
  return clampDiff(diff);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function forwardX(yaw: number) {
  return -Math.sin(yaw);
}
export function forwardZ(yaw: number) {
  return -Math.cos(yaw);
}
export function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function turnTowards(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/** Does the segment a→b cross the axis-aligned box (centre x/z, full size sx/sz)? Slab test in 2D. */
export function segmentHitsBox(ax: number, az: number, bx: number, bz: number, w: WallBox): boolean {
  const minX = w.x - w.sx / 2;
  const maxX = w.x + w.sx / 2;
  const minZ = w.z - w.sz / 2;
  const maxZ = w.z + w.sz / 2;
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let ta = (lo - o) / d;
    let tb = (hi - o) / d;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    return t0 <= t1;
  };
  return slab(ax, dx, minX, maxX) && slab(az, dz, minZ, maxZ);
}

export function clearOfWalls(ax: number, az: number, bx: number, bz: number, walls: readonly WallBox[]): boolean {
  for (const w of walls) if (segmentHitsBox(ax, az, bx, bz, w)) return false;
  return true;
}

/** Is the point (dx, dz) relative to someone looking along `yaw` inside the horizontal cone? */
export function inCone(dx: number, dz: number, yaw: number, half: number): boolean {
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return true;
  return (dx * forwardX(yaw) + dz * forwardZ(yaw)) / d >= Math.cos(half);
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

export interface Guard {
  id: number;
  route: RoutePt[];
  /** index of the waypoint he walks to */
  wp: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  st: number;
  mode: number;
  timer: number;
  /** where he investigates */
  tx: number;
  tz: number;
  /** the legs still to walk in M_GO (last one is the spot itself) */
  legs: Pt[];
  /** breadcrumbs back to the route */
  trail: Pt[];
  lookBase: number;
  lookPhase: number;
  /** seconds of alert left */
  alertT: number;
  /** who he is looking at (M_STARE) / who he called in */
  pid: string;
  /** walked this step (for the walk animation) */
  moving: boolean;
}

export interface GuardEventL {
  type: 'suspicious' | 'alert' | 'calm';
  guard: number;
  pid?: string;
  x: number;
  z: number;
}

export interface SenseCtx {
  /** extra line-of-sight test (physics); called only after the cheap tests pass */
  los?: (gx: number, gy: number, gz: number, p: Watched) => boolean;
  /** can he walk straight from a to b? (physics); the wall boxes are always checked */
  path?: (ax: number, az: number, bx: number, bz: number, y: number) => boolean;
}

export interface Sim {
  tun: GuardTuning;
  guards: Guard[];
  walls: WallBox[];
  hide: HideSpot[];
  eyeHeight: number;
  /** detection meter per player, 0..1 */
  meters: Record<string, number>;
  /** which guard sees this player best right now (-1 = nobody) */
  seenBy: Record<string, number>;
  /** seconds since start */
  t: number;
  lastDistract: number;
  /** filled by step / noise / distract; the caller drains it */
  events: GuardEventL[];
  /** movement switched off (tests); senses keep working */
  hold: boolean;
}

export interface SimOptions {
  routes: RoutePt[][];
  hide?: HideSpot[];
  walls?: WallBox[];
  eyeHeight?: number;
  diff?: unknown;
  speed?: number;
}

export function createSim(o: SimOptions): Sim {
  const sim: Sim = {
    tun: guardTuning(o.diff, o.speed),
    guards: [],
    walls: o.walls ?? [],
    hide: o.hide ?? [],
    eyeHeight: o.eyeHeight ?? 1.62,
    meters: {},
    seenBy: {},
    t: 0,
    lastDistract: -1e9,
    events: [],
    hold: false,
  };
  o.routes.forEach((route, i) => {
    sim.guards.push({ id: i, route, wp: 0, x: 0, y: 0, z: 0, yaw: 0, st: ST_PATROL, mode: M_WALK, timer: 0, tx: 0, tz: 0, legs: [], trail: [], lookBase: 0, lookPhase: 0, alertT: 0, pid: '', moving: false });
  });
  resetSim(sim);
  return sim;
}

/** Everyone back to the start of his route, calm, meters empty. */
export function resetSim(sim: Sim) {
  for (const g of sim.guards) {
    const a = g.route[0] ?? { x: 0, y: 0, z: 0 };
    const b = g.route[1 % Math.max(1, g.route.length)] ?? a;
    g.x = a.x;
    g.y = a.y;
    g.z = a.z;
    g.wp = g.route.length > 1 ? 1 : 0;
    g.yaw = Math.hypot(b.x - a.x, b.z - a.z) > 1e-3 ? yawTo(b.x - a.x, b.z - a.z) : (a.yaw ?? 0);
    g.st = ST_PATROL;
    g.mode = M_WALK;
    g.timer = 0;
    g.legs = [];
    g.trail = [];
    g.alertT = 0;
    g.pid = '';
    g.moving = false;
  }
  sim.meters = {};
  sim.seenBy = {};
  sim.lastDistract = -1e9;
  sim.events.length = 0;
}

/** Is the player inside a hiding spot? */
export function inHide(sim: Sim, x: number, z: number): boolean {
  for (const h of sim.hide) if (Math.hypot(x - h.x, z - h.z) <= (h.r ?? 1)) return true;
  return false;
}

/** How far this guard can make out this player. */
export function sightRange(tun: GuardTuning, p: Watched): number {
  if (p.light) return tun.lightDist;
  return tun.viewDist * (p.crouch ? tun.crouchK : 1) * (p.moving ? 1 : tun.stillK);
}

/**
 * Can guard g see player p right now? Returns the distance, or -1. Order: range,
 * cone, hiding spot, wall boxes, then the caller's physics test.
 */
export function sees(sim: Sim, g: Guard, p: Watched, ctx?: SenseCtx): number {
  const dx = p.x - g.x;
  const dz = p.z - g.z;
  const d = Math.hypot(dx, dz);
  if (Math.abs(p.y - g.y) > 2.6) return -1; // another floor
  if (d > sightRange(sim.tun, p)) return -1;
  if (d > 0.9 && !inCone(dx, dz, g.yaw, sim.tun.viewHalf)) return -1;
  if (d > sim.tun.hideNear && inHide(sim, p.x, p.z)) return -1;
  if (!clearOfWalls(g.x, g.z, p.x, p.z, sim.walls)) return -1;
  if (ctx?.los && !ctx.los(g.x, g.y + sim.eyeHeight, g.z, p)) return -1;
  return d;
}

/** Meter per second while seen at distance d. */
export function fillRate(tun: GuardTuning, d: number, p: Watched): number {
  const range = Math.max(2.5, sightRange(tun, p));
  const k = Math.min(1, Math.max(0, (d - 2) / (range - 2)));
  let time = tun.closeTime + (tun.farTime - tun.closeTime) * k;
  if (p.light) time *= 0.7;
  return 1 / time;
}

const emit = (sim: Sim, type: GuardEventL['type'], g: Guard, x: number, z: number, pid?: string) => {
  const e: GuardEventL = { type, guard: g.id, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
  if (pid) e.pid = pid;
  sim.events.push(e);
};

const canWalk = (sim: Sim, ctx: SenseCtx | undefined, ax: number, az: number, bx: number, bz: number, y: number) =>
  clearOfWalls(ax, az, bx, bz, sim.walls) && (!ctx?.path || ctx.path(ax, az, bx, bz, y));

/** Plan the walk to (x, z): straight if he can, else via the route waypoint that gets him closest. */
function planGo(sim: Sim, g: Guard, x: number, z: number, ctx?: SenseCtx) {
  g.tx = x;
  g.tz = z;
  g.legs = [];
  if (canWalk(sim, ctx, g.x, g.z, x, z, g.y)) {
    g.legs.push({ x, z });
    return;
  }
  const cands = g.route.slice().sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  for (const c of cands) {
    if (Math.hypot(c.x - g.x, c.z - g.z) < 0.3) continue;
    if (!canWalk(sim, ctx, g.x, g.z, c.x, c.z, g.y)) continue;
    g.legs.push({ x: c.x, z: c.z });
    if (canWalk(sim, ctx, c.x, c.z, x, z, g.y)) g.legs.push({ x, z });
    return;
  }
  // nowhere to go: he looks from where he stands
}

const pushTrail = (g: Guard) => {
  const last = g.trail[g.trail.length - 1];
  if (!last || Math.hypot(last.x - g.x, last.z - g.z) > 0.4) g.trail.push({ x: g.x, z: g.z });
  if (g.trail.length > 12) g.trail.splice(1, 1); // keep the point where he left the route
};

/** Something caught his attention at (x, z): stop, turn, then walk over. */
function investigate(sim: Sim, g: Guard, x: number, z: number, ctx: SenseCtx | undefined, pid?: string) {
  const wasPatrol = g.st === ST_PATROL;
  if (g.st !== ST_ALERT) g.st = ST_SUSPICIOUS;
  if (g.mode === M_WALK || g.mode === M_PAUSE) g.trail = [];
  if (g.mode !== M_GO && g.mode !== M_TURN) pushTrail(g);
  g.tx = x;
  g.tz = z;
  g.mode = M_TURN;
  g.timer = sim.tun.react;
  g.legs = [];
  if (wasPatrol) emit(sim, 'suspicious', g, x, z, pid);
}

function calm(sim: Sim, g: Guard) {
  g.st = ST_PATROL;
  g.alertT = 0;
  g.pid = '';
  g.mode = M_BACK;
  emit(sim, 'calm', g, g.x, g.z);
}

/** Walk towards (x, z); true when there. */
function walkTo(sim: Sim, g: Guard, x: number, z: number, dt: number, stop = 0.08): boolean {
  const dx = x - g.x;
  const dz = z - g.z;
  const d = Math.hypot(dx, dz);
  if (d <= stop) return true;
  const want = yawTo(dx, dz);
  g.yaw = turnTowards(g.yaw, want, sim.tun.turnRate * dt);
  // slow down while turning a sharp corner
  const k = Math.max(0, Math.cos(angleDelta(g.yaw, want)));
  const step = Math.min(d - stop * 0.5, sim.tun.speed * dt * (0.35 + 0.65 * k));
  if (step > 0) {
    g.x += (dx / d) * step;
    g.z += (dz / d) * step;
    g.moving = true;
  }
  return Math.hypot(x - g.x, z - g.z) <= stop;
}

function routeStep(sim: Sim, g: Guard, dt: number) {
  if (!g.route.length) return;
  if (g.mode === M_PAUSE) {
    const a = g.route[(g.wp - 1 + g.route.length) % g.route.length];
    if (a.yaw !== undefined) g.yaw = turnTowards(g.yaw, a.yaw, sim.tun.turnRate * dt);
    g.timer -= dt;
    if (g.timer <= 0) g.mode = M_WALK;
    return;
  }
  const w = g.route[g.wp];
  const from = g.route[(g.wp - 1 + g.route.length) % g.route.length];
  if (walkTo(sim, g, w.x, w.z, dt)) {
    g.x = w.x;
    g.z = w.z;
    g.y = w.y;
    g.wp = (g.wp + 1) % g.route.length;
    if (w.yaw !== undefined && g.route.length > 1) {
      g.mode = M_PAUSE;
      g.timer = sim.tun.pause;
    }
  } else {
    // floor height along the leg
    const seg = Math.hypot(w.x - from.x, w.z - from.z);
    const k = seg > 1e-3 ? 1 - Math.min(1, Math.hypot(w.x - g.x, w.z - g.z) / seg) : 1;
    g.y = from.y + (w.y - from.y) * k;
  }
}

function moveStep(sim: Sim, g: Guard, dt: number, ctx?: SenseCtx) {
  const tun = sim.tun;
  switch (g.mode) {
    case M_WALK:
    case M_PAUSE:
      routeStep(sim, g, dt);
      break;
    case M_TURN:
      g.yaw = turnTowards(g.yaw, yawTo(g.tx - g.x, g.tz - g.z), tun.turnRate * dt);
      g.timer -= dt;
      if (g.timer <= 0) {
        planGo(sim, g, g.tx, g.tz, ctx);
        g.mode = M_GO;
      }
      break;
    case M_GO: {
      const leg = g.legs[0];
      if (!leg) {
        g.mode = M_LOOK;
        g.timer = tun.lookTime;
        g.lookBase = Math.hypot(g.tx - g.x, g.tz - g.z) > 0.3 ? yawTo(g.tx - g.x, g.tz - g.z) : g.yaw;
        g.lookPhase = 0;
        break;
      }
      const last = g.legs.length === 1;
      if (walkTo(sim, g, leg.x, leg.z, dt, last ? 0.9 : 0.1)) {
        g.legs.shift();
        if (g.legs.length) pushTrail(g);
      }
      break;
    }
    case M_LOOK: {
      g.lookPhase += dt;
      const want = g.lookBase + Math.sin(g.lookPhase * 1.4) * 1.1;
      g.yaw = turnTowards(g.yaw, want, tun.turnRate * 0.7 * dt);
      g.timer -= dt;
      if (g.timer <= 0) {
        if (g.st === ST_ALERT && g.alertT > 0) g.timer = 0.5;
        else calm(sim, g);
      }
      break;
    }
    case M_BACK: {
      const p = g.trail[g.trail.length - 1];
      if (!p) {
        g.mode = M_WALK;
        break;
      }
      if (walkTo(sim, g, p.x, p.z, dt)) g.trail.pop();
      break;
    }
    case M_STARE:
      g.yaw = turnTowards(g.yaw, yawTo(g.tx - g.x, g.tz - g.z), tun.turnRate * dt);
      break;
  }
}

/** Distance guard g needs to hear a noise of radius r at (x, z): straight line, walls ignored. */
export function hears(g: Guard, x: number, z: number, radius: number): boolean {
  return Math.hypot(x - g.x, z - g.z) <= radius;
}

/** A noise at (x, z) audible within `radius`. Every guard in range comes to look. Returns how many heard it. */
export function noise(sim: Sim, x: number, z: number, radius: number, ctx?: SenseCtx): number {
  let n = 0;
  for (const g of sim.guards) {
    if (!hears(g, x, z, radius)) continue;
    n++;
    if (g.mode === M_STARE) continue; // he has something better to look at
    if (g.st === ST_ALERT) {
      g.tx = x;
      g.tz = z;
      if (g.mode !== M_TURN) planGo(sim, g, x, z, ctx), (g.mode = M_GO);
      continue;
    }
    investigate(sim, g, x, z, ctx);
  }
  return n;
}

/** The crew throws or knocks something: the nearest calm guard comes to look. Once per cooldown. */
export function distract(sim: Sim, x: number, z: number, ctx?: SenseCtx): boolean {
  if (sim.t - sim.lastDistract < sim.tun.distractCooldown) return false;
  let best: Guard | null = null;
  let bd = Infinity;
  for (const g of sim.guards) {
    if (g.st === ST_ALERT || g.mode === M_STARE) continue;
    const d = Math.hypot(x - g.x, z - g.z);
    if (d < bd) {
      bd = d;
      best = g;
    }
  }
  if (!best) return false;
  sim.lastDistract = sim.t;
  if (best.st === ST_SUSPICIOUS) {
    // already looking around: retarget, still tell the director
    investigate(sim, best, x, z, ctx);
    emit(sim, 'suspicious', best, x, z);
  } else investigate(sim, best, x, z, ctx);
  return true;
}

/**
 * One simulation step. `players` are all crew members; `ctx` adds physics tests.
 * New events are appended to `sim.events`.
 */
export function step(sim: Sim, dt: number, players: readonly Watched[], ctx?: SenseCtx) {
  const tun = sim.tun;
  sim.t += dt;
  const rate: Record<string, number> = {};
  const seenBy: Record<string, number> = {};
  // senses: who sees whom
  const bestOf: { p: Watched; d: number }[] = sim.guards.map(() => ({ p: null as unknown as Watched, d: -1 }));
  for (const p of players) {
    let r = 0;
    let by = -1;
    let byD = Infinity;
    for (let i = 0; i < sim.guards.length; i++) {
      const g = sim.guards[i];
      const d = sees(sim, g, p, ctx);
      if (d < 0) continue;
      let f = fillRate(tun, d, p);
      if (g.st === ST_ALERT) f *= 2; // he is already looking for you
      if (f > r) r = f;
      if (d < byD) {
        byD = d;
        by = i;
      }
      const b = bestOf[i];
      const m = sim.meters[p.pid] ?? 0;
      const bm = b.d < 0 ? -1 : (sim.meters[b.p.pid] ?? 0);
      if (b.d < 0 || m > bm || (m === bm && d < b.d)) {
        b.p = p;
        b.d = d;
      }
    }
    rate[p.pid] = r;
    seenBy[p.pid] = by;
  }
  // meters: fill while seen by anyone, decay otherwise
  const meters: Record<string, number> = {};
  for (const p of players) {
    const m = sim.meters[p.pid] ?? 0;
    const r = rate[p.pid];
    meters[p.pid] = r > 0 ? Math.min(1, m + r * dt) : Math.max(0, m - tun.decay * dt);
  }
  sim.meters = meters;
  sim.seenBy = seenBy;

  // reactions
  for (let i = 0; i < sim.guards.length; i++) {
    const g = sim.guards[i];
    g.moving = false;
    const b = bestOf[i];
    if (g.st === ST_ALERT && b.d < 0) g.alertT -= dt;
    if (b.d >= 0) {
      const p = b.p;
      const m = meters[p.pid];
      if (m >= 1 && g.st !== ST_ALERT) {
        g.st = ST_ALERT;
        g.alertT = tun.alertTime;
        g.pid = p.pid;
        g.tx = p.x;
        g.tz = p.z;
        if (g.mode === M_WALK || g.mode === M_PAUSE) (g.trail = []), pushTrail(g);
        g.mode = M_STARE;
        emit(sim, 'alert', g, p.x, p.z, p.pid);
      } else if (g.st === ST_ALERT) {
        g.alertT = tun.alertTime;
        g.pid = p.pid;
        g.tx = p.x;
        g.tz = p.z;
        if (g.mode !== M_STARE) {
          if (g.mode === M_WALK || g.mode === M_PAUSE) (g.trail = []), pushTrail(g);
          g.mode = M_STARE;
        }
      } else if (g.st === ST_SUSPICIOUS || m >= tun.glimpse) {
        // a glimpse is enough to stop him; while he keeps seeing you he stares
        if (g.st === ST_PATROL) investigate(sim, g, p.x, p.z, ctx, p.pid);
        g.tx = p.x;
        g.tz = p.z;
        g.pid = p.pid;
        if (g.mode !== M_TURN) {
          if (g.mode === M_WALK || g.mode === M_PAUSE) (g.trail = []), pushTrail(g);
          g.mode = M_STARE;
        }
      }
    } else if (g.mode === M_STARE) {
      // lost sight: go to where he last saw you
      planGo(sim, g, g.tx, g.tz, ctx);
      g.mode = M_GO;
    }
  }

  // hearing: footsteps of players moving upright
  for (const p of players) {
    if (p.crouch || p.speed < 2.2) continue;
    const r = p.speed > 4.6 ? tun.hearSprint : tun.hearWalk;
    for (const g of sim.guards) {
      if (g.st !== ST_PATROL || !hears(g, p.x, p.z, r)) continue;
      if (inHide(sim, p.x, p.z) && Math.hypot(p.x - g.x, p.z - g.z) > tun.hideNear) continue;
      investigate(sim, g, p.x, p.z, ctx);
    }
  }

  if (!sim.hold) for (const g of sim.guards) moveStep(sim, g, dt, ctx);
}

/** The guard (index) that sees this player, or -1. */
export function seenBy(sim: Sim, pid: string): number {
  return sim.seenBy[pid] ?? -1;
}
