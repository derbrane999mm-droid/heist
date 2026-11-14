// Opening a safe, the rules without a browser. Pure: no DOM, no engine imports.
//
// Three variants share one step function and one result:
//   mech   combination lock: a dial 0..59, three numbers found by feel, in alternating directions
//   elek   electronic lock: a decoder cycles digits, press when the digit is "hot"
//   drill  drilling: hold to drill, heat rises, release to let it cool, a bound bit costs progress
//
// Everything is plain data (a state object per attempt) so a test or a bot can read it. Randomness comes
// from the seed only, and `safeAdvice` tells a bot what a perfect player would do next.
// Written with erasable TypeScript only (no enums), so Node can run it directly in the tests.

export type Diff = 1 | 2 | 3;
export type Variant = 'mech' | 'elek' | 'drill';
export type Status = 'run' | 'open' | 'timeout' | 'lockout' | 'broke';

export const VARIANTS: Variant[] = ['mech', 'elek', 'drill'];

export const toDiff = (v: unknown): Diff => {
  const n = Number(v);
  return n === 1 || n === 2 || n === 3 ? n : 2;
};
/** Anything unknown plays as the combination lock; the old "zeit" (time lock) safe is drilled. */
export const toVariant = (v: unknown): Variant => (v === 'elek' || v === 'drill' ? v : v === 'zeit' ? 'drill' : 'mech');

/** Small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const mix = (a: number, b: number): number => {
  let x = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) + b) | 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
};

/** Per-step input. One shape for all variants; each reads what it needs. */
export interface SafeInput {
  /** mech: turn direction held (-1 left / A, +1 right / D) */
  dir: -1 | 0 | 1;
  /** mech: fine turning (Shift held) */
  slow: boolean;
  /** Space went down this frame: mech sets the number, elek presses */
  act: boolean;
  /** Space is held: drill */
  hold: boolean;
}
export const NO_INPUT: SafeInput = { dir: 0, slow: false, act: false, hold: false };

/** Things that happened in one step; the game turns them into sounds and flashes. */
export interface Ev {
  k: 'tick' | 'enter' | 'set' | 'slip' | 'miss' | 'digit' | 'ok' | 'wrong' | 'unlock' | 'bind' | 'open' | 'fail';
  n?: number;
}

export interface Outcome {
  ok: boolean;
  /** seconds the attempt took */
  seconds: number;
  /** 0..10 */
  noise: number;
  fumbles: number;
  reason: Status;
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const round1 = (x: number) => Math.round(x * 10) / 10;

// ============================================================================ MECH

export const MECH_N = 60;
export const MECH_SPEED = 12; // marks per second
export const MECH_SLOW = 4;
export const MECH_HOLD = 0.5; // seconds to hold still on the number

export interface MechCfg {
  /** half width of the true spot in marks: "on it" */
  win: number;
  /** how far from the spot the meter starts to rise, in marks */
  falloff: number;
  /** peak of the decoy bump (0 = none); the true spot always reads 1 */
  decoy: number;
  /** overshoot in marks that counts as a slip */
  slip: number;
}
export const MECH_CFG: Record<Diff, MechCfg> = {
  1: { win: 2.2, falloff: 12, decoy: 0, slip: 5 },
  2: { win: 1.5, falloff: 10, decoy: 0.5, slip: 4 },
  3: { win: 1.0, falloff: 9, decoy: 0.65, slip: 3 },
};

export interface MechState {
  kind: 'mech';
  diff: Diff;
  seed: number;
  limit: number;
  t: number;
  status: Status;
  targets: number[];
  /** required turn direction per number */
  dirs: (1 | -1)[];
  decoys: number[];
  /** numbers set so far */
  step: number;
  /** dial position, 0..60 (marks are integers) */
  pos: number;
  /** last direction actually turned (0 = not yet) */
  lastDir: number;
  /** the dial has been on the spot since the last approach */
  peaked: boolean;
  /** seconds held still on the spot, in the right direction */
  holdT: number;
  /** meter 0..1 */
  contact: number;
  on: boolean;
  /** the dial arrived turning the required way */
  dirOk: boolean;
  fumbles: number;
  noise: number;
}

const wrap = (x: number) => ((x % MECH_N) + MECH_N) % MECH_N;
/** a - b on the circle, in (-30, 30] */
export const mechDelta = (a: number, b: number): number => {
  let d = wrap(a - b);
  if (d > MECH_N / 2) d -= MECH_N;
  return d;
};

export function mechNew(seed: number, diff: Diff, limit = 0): MechState {
  const r = rng(mix(seed, 0x5afe01));
  const far = (from: number, min: number) => {
    for (let i = 0; i < 50; i++) {
      const v = Math.floor(r() * MECH_N);
      if (Math.abs(mechDelta(v, from)) >= min) return v;
    }
    return wrap(from + 30);
  };
  const t0 = 5 + Math.floor(r() * 50);
  const t1 = far(t0, 15);
  let t2 = far(t1, 15);
  if (Math.abs(mechDelta(t2, t0)) < 8) t2 = wrap(t1 + 30);
  const targets = [t0, t1, t2];
  const d0: 1 | -1 = r() < 0.5 ? 1 : -1;
  const dirs: (1 | -1)[] = [d0, (-d0) as 1 | -1, d0];
  const decoys = targets.map((tg) => (MECH_CFG[diff].decoy > 0 ? wrap(tg + (r() < 0.5 ? -1 : 1) * (14 + Math.floor(r() * 10))) : -100));
  const s: MechState = {
    kind: 'mech', diff, seed, limit, t: 0, status: 'run', targets, dirs, decoys, step: 0,
    pos: far(t0, 15), lastDir: 0, peaked: false, holdT: 0, contact: 0, on: false, dirOk: false, fumbles: 0, noise: 0,
  };
  mechRead(s);
  return s;
}

/** Contact meter, "on" and direction flags from the dial position. Returns the signed overshoot in the travel direction. */
function mechRead(s: MechState): number {
  const cfg = MECH_CFG[s.diff];
  const i = Math.min(s.step, 2);
  const dl = mechDelta(s.pos, s.targets[i]);
  const d = Math.abs(dl);
  const tc = d <= cfg.win ? 1 : Math.pow(Math.max(0, 1 - (d - cfg.win) / cfg.falloff), 1.5);
  const dc = cfg.decoy > 0 ? cfg.decoy * Math.max(0, 1 - Math.abs(mechDelta(s.pos, s.decoys[i])) / 5) : 0;
  s.contact = Math.max(tc, dc);
  s.on = d <= cfg.win;
  s.dirOk = s.lastDir === s.dirs[i];
  return s.dirs[i] * dl;
}

export function mechStep(s: MechState, inp: SafeInput, dt: number): Ev[] {
  const ev: Ev[] = [];
  if (s.status !== 'run') return ev;
  dt = Math.min(dt, 0.1);
  s.t += dt;
  if (s.limit > 0 && s.t >= s.limit) {
    s.status = 'timeout';
    ev.push({ k: 'fail' });
    return ev;
  }
  const cfg = MECH_CFG[s.diff];
  const wasOn = s.on;
  if (inp.dir !== 0) {
    s.lastDir = inp.dir;
    const old = s.pos;
    s.pos = wrap(s.pos + inp.dir * (inp.slow ? MECH_SLOW : MECH_SPEED) * dt);
    if (Math.floor(old) !== Math.floor(s.pos)) ev.push({ k: 'tick', n: s.contact });
  }
  const o = mechRead(s);
  if (s.on && !wasOn) ev.push({ k: 'enter' });
  if (s.on) s.peaked = true;
  else if (o < -cfg.falloff) s.peaked = false;
  if (s.peaked && o > cfg.slip) {
    // went past the number: that number has to be found again
    s.peaked = false;
    s.holdT = 0;
    s.fumbles++;
    s.noise = Math.min(10, s.noise + 1);
    ev.push({ k: 'slip' });
    return ev;
  }
  if (s.on && s.dirOk && inp.dir === 0) s.holdT += dt;
  else s.holdT = 0;
  if (inp.act && !(s.on && s.dirOk)) ev.push({ k: 'miss' });
  if (s.on && s.dirOk && (inp.act || s.holdT >= MECH_HOLD)) {
    s.step++;
    s.holdT = 0;
    s.peaked = false;
    ev.push({ k: 'set', n: s.step });
    if (s.step >= 3) {
      s.status = 'open';
      ev.push({ k: 'open' });
    } else mechRead(s);
  }
  return ev;
}

/** What a perfect player does next: turn the required way, slow down near the number, stop on it, hold. */
export function mechAdvice(s: MechState, useSpace = false): SafeInput {
  if (s.status !== 'run') return NO_INPUT;
  const cfg = MECH_CFG[s.diff];
  const i = Math.min(s.step, 2);
  const req = s.dirs[i];
  const o = req * mechDelta(s.pos, s.targets[i]);
  if (Math.abs(o) <= cfg.win * 0.8 && s.dirOk) return { dir: 0, slow: false, act: useSpace, hold: false };
  if (o < -cfg.win * 0.8) return { dir: req, slow: o > -10, act: false, hold: false };
  // past the number, or on it the wrong way round: back off, then come in again the right way
  return { dir: (-req) as 1 | -1, slow: o < 6, act: false, hold: false };
}

// ============================================================================ ELEK

export interface ElekCfg {
  len: number;
  /** digits per second */
  speed: number;
}
export const ELEK_CFG: Record<Diff, ElekCfg> = {
  1: { len: 4, speed: 2.0 },
  2: { len: 4, speed: 2.6 },
  3: { len: 5, speed: 3.2 },
};
export const ELEK_LOCK = 2; // seconds the pad stays locked after a wrong press
export const ELEK_GRACE = 0.12; // a press this soon after the right digit moved on still counts
export const ELEK_MAX_WRONG = 3;

export interface ElekState {
  kind: 'elek';
  diff: Diff;
  seed: number;
  limit: number;
  t: number;
  status: Status;
  code: number[];
  /** how many positions are cracked */
  pos: number;
  /** decoder phase 0..10, the shown digit is floor(phase) */
  phase: number;
  digit: number;
  prevDigit: number;
  /** seconds since the shown digit changed */
  since: number;
  lockT: number;
  /** wrong presses in a row */
  wrong: number;
  fumbles: number;
  /** generator state for the start phases */
  rs: number;
}

const nextRand = (rs: number): [number, number] => {
  const n = (rs + 0x6d2b79f5) | 0;
  let t = Math.imul(n ^ (n >>> 15), 1 | n);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [n, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
};

/** Start phase for the position `pos`: never right next to the digit that is wanted. */
function elekRephase(s: ElekState) {
  const target = s.code[Math.min(s.pos, s.code.length - 1)];
  let v = 0;
  for (let i = 0; i < 8; i++) {
    const [rs, x] = nextRand(s.rs);
    s.rs = rs;
    v = x * 10;
    const d = Math.abs(((v - (target + 0.5) + 15) % 10) - 5);
    if (d >= 3) break;
  }
  s.phase = v;
  s.digit = Math.floor(v);
  s.prevDigit = -1;
  s.since = 0;
}

export function elekNew(seed: number, diff: Diff, limit = 0): ElekState {
  const r = rng(mix(seed, 0x5afe02));
  const cfg = ELEK_CFG[diff];
  const code: number[] = [];
  for (let i = 0; i < cfg.len; i++) {
    let d = Math.floor(r() * 10);
    if (i > 0 && d === code[i - 1]) d = (d + 1 + Math.floor(r() * 8)) % 10;
    code.push(d);
  }
  const s: ElekState = { kind: 'elek', diff, seed, limit, t: 0, status: 'run', code, pos: 0, phase: 0, digit: 0, prevDigit: -1, since: 0, lockT: 0, wrong: 0, fumbles: 0, rs: mix(seed, 0x5afe03) | 0 };
  elekRephase(s);
  return s;
}

/** Decoder signal 0..1 for the shown phase: rises as the wanted digit comes round, is highest on it. */
export function elekSignal(s: ElekState): number {
  const target = s.code[Math.min(s.pos, s.code.length - 1)];
  const dd = Math.abs(((s.phase - (target + 0.5) + 15) % 10) - 5);
  return Math.pow(clamp(1 - dd / 3.5, 0, 1), 1.4);
}
export const elekHot = (s: ElekState): boolean => s.digit === s.code[Math.min(s.pos, s.code.length - 1)];

export function elekStep(s: ElekState, inp: SafeInput, dt: number): Ev[] {
  const ev: Ev[] = [];
  if (s.status !== 'run') return ev;
  dt = Math.min(dt, 0.1);
  s.t += dt;
  if (s.limit > 0 && s.t >= s.limit) {
    s.status = 'timeout';
    ev.push({ k: 'fail' });
    return ev;
  }
  const cfg = ELEK_CFG[s.diff];
  s.phase = (s.phase + cfg.speed * dt) % 10;
  const dg = Math.floor(s.phase);
  if (dg !== s.digit) {
    s.prevDigit = s.digit;
    s.digit = dg;
    s.since = 0;
    ev.push({ k: 'digit', n: elekHot(s) ? 1 : 0 });
  } else s.since += dt;
  if (s.lockT > 0) {
    s.lockT -= dt;
    if (s.lockT <= 0) {
      s.lockT = 0;
      ev.push({ k: 'unlock' });
    }
    if (inp.act) ev.push({ k: 'miss' });
    return ev;
  }
  if (!inp.act) return ev;
  const target = s.code[s.pos];
  if (s.digit === target || (s.prevDigit === target && s.since < ELEK_GRACE)) {
    s.pos++;
    s.wrong = 0;
    ev.push({ k: 'ok', n: s.pos });
    if (s.pos >= s.code.length) {
      s.status = 'open';
      ev.push({ k: 'open' });
    } else elekRephase(s);
  } else {
    s.wrong++;
    s.fumbles++;
    s.lockT = ELEK_LOCK;
    ev.push({ k: 'wrong', n: s.wrong });
    if (s.wrong >= ELEK_MAX_WRONG) {
      s.status = 'lockout';
      ev.push({ k: 'fail' });
    }
  }
  return ev;
}

/** Perfect play: press the moment the shown digit is the hot one. */
export function elekAdvice(s: ElekState): SafeInput {
  if (s.status !== 'run' || s.lockT > 0) return NO_INPUT;
  return { dir: 0, slow: false, act: elekHot(s), hold: false };
}

// ============================================================================ DRILL

export interface DrillCfg {
  /** seconds of drilling the safe needs, bit never binding */
  need: number;
  /** heat from here on is the red zone */
  red: number;
  /** heat gained per second drilling */
  up: number;
}
export const DRILL_CFG: Record<Diff, DrillCfg> = {
  1: { need: 14, red: 0.8, up: 0.32 },
  2: { need: 18, red: 0.7, up: 0.38 },
  3: { need: 20, red: 0.6, up: 0.46 },
};
export const DRILL_COOL = 0.45; // heat lost per second while released
export const DRILL_STUCK = 1.2; // seconds the bound bit cannot be used
export const DRILL_PENALTY = 0.1;
export const DRILL_MAX_BINDS = 3;
/** noise per second of drilling; capped at 10 */
export const DRILL_NOISE = 0.35;

export interface DrillState {
  kind: 'drill';
  diff: Diff;
  seed: number;
  limit: number;
  t: number;
  status: Status;
  /** 0..1 */
  progress: number;
  /** 0..1, 1 = bound */
  heat: number;
  binds: number;
  /** seconds left of the bound bit being stuck */
  stuck: number;
  /** after a bind the key must be let go once before drilling goes on */
  latch: boolean;
  drilling: boolean;
  /** total seconds the drill ran */
  drillT: number;
  fumbles: number;
  noise: number;
}

export function drillNew(seed: number, diff: Diff, limit = 0): DrillState {
  return { kind: 'drill', diff, seed, limit, t: 0, status: 'run', progress: 0, heat: 0, binds: 0, stuck: 0, latch: false, drilling: false, drillT: 0, fumbles: 0, noise: 0 };
}

export function drillStep(s: DrillState, inp: SafeInput, dt: number): Ev[] {
  const ev: Ev[] = [];
  if (s.status !== 'run') return ev;
  dt = Math.min(dt, 0.1);
  s.t += dt;
  if (s.limit > 0 && s.t >= s.limit) {
    s.status = 'timeout';
    s.drilling = false;
    ev.push({ k: 'fail' });
    return ev;
  }
  const cfg = DRILL_CFG[s.diff];
  if (s.stuck > 0) s.stuck = Math.max(0, s.stuck - dt);
  if (!inp.hold && s.stuck <= 0) s.latch = false;
  const go = inp.hold && s.stuck <= 0 && !s.latch;
  s.drilling = go;
  if (go) {
    s.heat = Math.min(1, s.heat + cfg.up * dt);
    s.progress = Math.min(1, s.progress + dt / cfg.need);
    s.drillT += dt;
    s.noise = Math.min(10, round1(s.drillT * DRILL_NOISE));
    if (s.progress >= 1) {
      s.status = 'open';
      s.drilling = false;
      ev.push({ k: 'open' });
    } else if (s.heat >= 1) {
      s.binds++;
      s.fumbles++;
      s.progress = Math.max(0, s.progress - DRILL_PENALTY);
      s.heat = Math.max(0, cfg.red - 0.25);
      s.stuck = DRILL_STUCK;
      s.latch = true;
      s.drilling = false;
      ev.push({ k: 'bind', n: s.binds });
      if (s.binds >= DRILL_MAX_BINDS) {
        s.status = 'broke';
        ev.push({ k: 'fail' });
      }
    }
  } else s.heat = Math.max(0, s.heat - DRILL_COOL * dt);
  return ev;
}

/** Perfect play: drill until just short of the red zone, let it cool, repeat. */
export function drillAdvice(s: DrillState): SafeInput {
  if (s.status !== 'run' || s.stuck > 0 || s.latch) return NO_INPUT;
  const cfg = DRILL_CFG[s.diff];
  const hold = s.drilling ? s.heat < cfg.red - 0.08 : s.heat <= 0.2;
  return { dir: 0, slow: false, act: false, hold };
}

// ============================================================================ common

export type SafeState = MechState | ElekState | DrillState;

export function safeNew(variant: Variant, seed: number, diff: Diff, limit = 0): SafeState {
  return variant === 'elek' ? elekNew(seed, diff, limit) : variant === 'drill' ? drillNew(seed, diff, limit) : mechNew(seed, diff, limit);
}
export function safeStep(s: SafeState, inp: SafeInput, dt: number): Ev[] {
  return s.kind === 'elek' ? elekStep(s, inp, dt) : s.kind === 'drill' ? drillStep(s, inp, dt) : mechStep(s, inp, dt);
}
export function safeAdvice(s: SafeState, useSpace = false): SafeInput {
  return s.kind === 'elek' ? elekAdvice(s) : s.kind === 'drill' ? drillAdvice(s) : mechAdvice(s, useSpace);
}

/** The result for a finished attempt, null while it still runs. */
export function safeOutcome(s: SafeState): Outcome | null {
  if (s.status === 'run') return null;
  return {
    ok: s.status === 'open',
    seconds: round1(s.t),
    noise: s.kind === 'elek' ? 0 : s.noise,
    fumbles: s.fumbles,
    reason: s.status,
  };
}

/** Share of the way to opening, 0..1 (for tests and the bar). */
export function safeProgress(s: SafeState): number {
  return s.kind === 'mech' ? s.step / 3 : s.kind === 'elek' ? s.pos / s.code.length : s.progress;
}
