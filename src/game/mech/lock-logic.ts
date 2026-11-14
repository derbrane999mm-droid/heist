// Lock picking, the rules without a browser. Pure: no DOM, no engine imports.
//
// A row of pins. A marker sweeps back and forth over the current pin's travel (0..1). Pressing while the
// marker is inside the sweet zone sets the pin; pressing outside is a slip (noise, the pin drops, on the
// hardest level the previous one too). Too many slips break the pick; a time limit may run out.

export type Diff = 1 | 2 | 3;
export type Variant = 'door' | 'case';
export type Status = 'run' | 'open' | 'broke' | 'timeout';
export type PressResult = 'set' | 'open' | 'slip' | 'broke' | 'ignored';

export interface Pin {
  /** zone centre, 0..1 */
  c: number;
  /** zone width, 0..1 */
  w: number;
  /** marker speed while this pin is current, in full travels per second */
  speed: number;
}

export interface LockState {
  variant: Variant;
  diff: Diff;
  seed: number;
  pins: Pin[];
  /** which pins are set */
  set: boolean[];
  /** the pin being worked on */
  cur: number;
  /** marker position 0..1 and direction */
  pos: number;
  dir: 1 | -1;
  slips: number;
  maxSlips: number;
  /** noise made so far (0..10) */
  noise: number;
  /** seconds since the start */
  time: number;
  /** 0 = no limit */
  timeLimit: number;
  /** presses are ignored for this many seconds (after a slip or a set pin) */
  lockout: number;
  status: Status;
}

/** A press this far outside the zone still counts (reaction time is not a skill check). */
export const GRACE = 0.012;
export const SLIP_LOCKOUT = 0.4;
export const SET_LOCKOUT = 0.15;

export function toDiff(v: unknown): Diff {
  const n = Math.round(Number(v));
  return n <= 1 ? 1 : n >= 3 ? 3 : 2;
}
export function toVariant(v: unknown): Variant {
  return v === 'case' ? 'case' : 'door';
}
export function pinCount(variant: Variant, diff: Diff): number {
  return (variant === 'case' ? 1 : 2) + diff;
}
export function maxSlipsFor(diff: Diff): number {
  return diff === 1 ? 7 : diff === 2 ? 6 : 5;
}

/** Small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONE_W: Record<Diff, number> = { 1: 0.2, 2: 0.15, 3: 0.11 };
const SPEED: Record<Diff, number> = { 1: 0.4, 2: 0.5, 3: 0.65 };

/** Build the lock for a request. Same arguments, same lock. */
export function generate(variant: Variant, diff: Diff, seed: number, timeLimit = 0): LockState {
  const r = rng(seed ^ (diff * 7919) ^ (variant === 'case' ? 0x5bd1e995 : 0));
  const n = pinCount(variant, diff);
  const quick = variant === 'case' ? 1.2 : 1;
  const w = ZONE_W[diff] * (variant === 'case' ? 1.1 : 1);
  const pins: Pin[] = [];
  let prev = 0.5;
  for (let i = 0; i < n; i++) {
    const lo = 0.1 + w / 2;
    const hi = 0.9 - w / 2;
    let c = lo + r() * (hi - lo);
    for (let k = 0; k < 6 && Math.abs(c - prev) < 0.18; k++) c = lo + r() * (hi - lo);
    prev = c;
    pins.push({ c, w, speed: SPEED[diff] * quick * (1 + 0.08 * i) });
  }
  return {
    variant,
    diff,
    seed,
    pins,
    set: pins.map(() => false),
    cur: 0,
    pos: 0,
    dir: 1,
    slips: 0,
    maxSlips: maxSlipsFor(diff),
    noise: 0,
    time: 0,
    timeLimit: timeLimit > 0 ? timeLimit : 0,
    lockout: 0,
    status: 'run',
  };
}

/** Advance time. Returns true if the marker hit an end of the travel (for the tick sound). */
export function step(s: LockState, dt: number): boolean {
  if (s.status !== 'run' || dt <= 0) return false;
  s.time += dt;
  s.lockout = Math.max(0, s.lockout - dt);
  if (s.timeLimit > 0 && s.time >= s.timeLimit) {
    s.time = s.timeLimit;
    s.status = 'timeout';
    return false;
  }
  let edge = false;
  let move = s.pins[s.cur].speed * dt;
  for (let guard = 0; move > 0 && guard < 8; guard++) {
    const room = s.dir > 0 ? 1 - s.pos : s.pos;
    if (move < room) {
      s.pos += s.dir * move;
      break;
    }
    move -= room;
    s.pos = s.dir > 0 ? 1 : 0;
    s.dir = (s.dir * -1) as 1 | -1;
    edge = true;
  }
  return edge;
}

export function inZone(s: LockState): boolean {
  const p = s.pins[s.cur];
  return Math.abs(s.pos - p.c) <= p.w / 2 + GRACE;
}

/** The player presses the key. */
export function press(s: LockState): PressResult {
  if (s.status !== 'run' || s.lockout > 0) return 'ignored';
  if (inZone(s)) {
    s.set[s.cur] = true;
    if (s.cur >= s.pins.length - 1) {
      s.status = 'open';
      return 'open';
    }
    s.cur++;
    s.lockout = SET_LOCKOUT;
    return 'set';
  }
  s.slips++;
  s.noise = Math.min(10, s.noise + 1);
  s.set[s.cur] = false;
  if (s.diff >= 3 && s.cur > 0) {
    s.cur--;
    s.set[s.cur] = false;
  }
  s.lockout = SLIP_LOCKOUT;
  if (s.slips >= s.maxSlips) {
    s.status = 'broke';
    return 'broke';
  }
  return 'slip';
}

/** Seconds until the marker is next at the centre of the current zone (and presses are allowed again). */
export function pressIn(s: LockState): number {
  if (s.status !== 'run') return Infinity;
  const p = s.pins[s.cur];
  let d: number;
  if (s.dir > 0) d = p.c >= s.pos ? p.c - s.pos : 1 - s.pos + (1 - p.c);
  else d = p.c <= s.pos ? s.pos - p.c : s.pos + p.c;
  return Math.max(d / p.speed, s.lockout);
}

/**
 * For a test bot: should it press now? `lead` is how many seconds ahead of the centre it may fire, to cover
 * the delay until the game sees the key (one frame).
 */
export function botShouldPress(s: LockState, lead = 0.02): boolean {
  if (s.status !== 'run' || s.lockout > 0) return false;
  const p = s.pins[s.cur];
  return Math.abs(s.pos - p.c) <= p.w * 0.3 || pressIn(s) <= lead;
}

/** Seconds left on the clock, or null without a limit. */
export function timeLeft(s: LockState): number | null {
  return s.timeLimit > 0 ? Math.max(0, s.timeLimit - s.time) : null;
}
