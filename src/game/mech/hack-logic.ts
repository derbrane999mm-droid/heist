// Rules and seeded generators for the three terminal mini-games (Trace,
// Signal, Cipher). Plain functions on plain JSON state: no three.js, no DOM,
// so the same code runs on the host, in the views and in Node tests
// (tests/hack-logic.mjs imports this file directly).
//
// Every game has two terminals. Side 'a' holds the controls, side 'b' holds
// the information side 'a' is missing. `hackView` is the only thing a
// terminal renders from, and it leaves the other side's information out.

export type Diff = 1 | 2 | 3;
export type Side = 'a' | 'b';
export type GameKind = 'trace' | 'signal' | 'cipher';

export function toDiff(v: unknown): Diff {
  const n = Math.round(Number(v));
  return n === 1 ? 1 : n === 3 ? 3 : 2;
}

/** Small seeded generator (mulberry32): same seed, same puzzle. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a new seed from a seed and a counter. */
export function mix(a: number, b: number): number {
  let h = ((a >>> 0) ^ Math.imul((b >>> 0) + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

const int = (r: () => number, n: number) => Math.floor(r() * n);

function shuffled<T>(r: () => number, a: readonly T[]): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(r, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

// ===========================================================================
// TRACE: rotate circuit tiles until the current runs from the source (west
// edge) to the sink (east edge). ICE cells must never carry current.
// ===========================================================================

/** Tile kinds: 0 straight, 1 corner, 2 tee, 3 cross. */
export const TILE_STRAIGHT = 0;
export const TILE_CORNER = 1;
export const TILE_TEE = 2;
export const TILE_CROSS = 3;
/** Connection bits: north, east, south, west. */
export const DIR_N = 1;
export const DIR_E = 2;
export const DIR_S = 4;
export const DIR_W = 8;

const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];
const KIND_MASK = [DIR_N | DIR_S, DIR_N | DIR_E, DIR_N | DIR_E | DIR_W, 15];

export interface TraceCfg {
  n: number;
  ice: number;
  minLen: number;
  maxLen: number;
  /** Relative odds of straight / corner / tee / cross for cells off the route. */
  weights: [number, number, number, number];
  /** Chance that a route tile is a tee (one stray arm). */
  teeOnPath: number;
}

export const TRACE_CFG: Record<Diff, TraceCfg> = {
  1: { n: 4, ice: 2, minLen: 5, maxLen: 9, weights: [3, 4, 2, 0], teeOnPath: 0 },
  2: { n: 5, ice: 4, minLen: 7, maxLen: 13, weights: [3, 4, 3, 1], teeOnPath: 0.2 },
  3: { n: 6, ice: 7, minLen: 10, maxLen: 19, weights: [3, 4, 4, 1.5], teeOnPath: 0.3 },
};

export interface TraceState {
  kind: 'trace';
  diff: Diff;
  seed: number;
  /** Grid is n x n, cells are row-major. */
  n: number;
  /** Row where the current enters (west edge) and where it has to leave (east edge). */
  src: number;
  sink: number;
  tiles: number[];
  /** Current rotation of every tile, 0..3 quarter turns clockwise. */
  rot: number[];
  /** One rotation set that powers the sink and keeps every ICE cell dark. */
  sol: number[];
  ice: number[];
  strikes: number;
  moves: number;
  /** ICE cell that was tripped last, -1 if none yet. */
  hit: number;
  solved: boolean;
}

/** Connection bits of a tile after `rot` quarter turns clockwise. */
export function traceMask(kind: number, rot: number): number {
  const m = KIND_MASK[kind];
  const r = rot & 3;
  return ((m << r) | (m >> (4 - r))) & 15;
}

/** Which cells carry current (1/0 per cell). */
export function tracePowered(n: number, src: number, tiles: readonly number[], rot: readonly number[]): number[] {
  const on: number[] = new Array(n * n).fill(0);
  const start = src * n;
  if (!(traceMask(tiles[start], rot[start]) & DIR_W)) return on;
  const stack = [start];
  on[start] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const row = Math.floor(c / n);
    const col = c % n;
    const m = traceMask(tiles[c], rot[c]);
    for (let d = 0; d < 4; d++) {
      if (!(m & (1 << d))) continue;
      const rr = row + DR[d];
      const cc = col + DC[d];
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const k = rr * n + cc;
      if (on[k]) continue;
      if (traceMask(tiles[k], rot[k]) & (1 << ((d + 2) & 3))) {
        on[k] = 1;
        stack.push(k);
      }
    }
  }
  return on;
}

export function traceSinkOn(n: number, sink: number, tiles: readonly number[], rot: readonly number[], on: readonly number[]): boolean {
  const c = sink * n + n - 1;
  return !!on[c] && (traceMask(tiles[c], rot[c]) & DIR_E) !== 0;
}

/** Random self-avoiding route: the stack of a randomised depth-first search. */
function mazePath(r: () => number, n: number, from: number, to: number): number[] {
  const seen = new Uint8Array(n * n);
  const stack = [from];
  seen[from] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    if (cur === to) return stack;
    const row = Math.floor(cur / n);
    const col = cur % n;
    const opts: number[] = [];
    for (let d = 0; d < 4; d++) {
      const rr = row + DR[d];
      const cc = col + DC[d];
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      if (!seen[rr * n + cc]) opts.push(rr * n + cc);
    }
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const next = opts[int(r, opts.length)];
    seen[next] = 1;
    stack.push(next);
  }
  return [];
}

function dirTo(n: number, from: number, to: number): number {
  const d = to - from;
  return d === -n ? 0 : d === 1 ? 1 : d === n ? 2 : 3;
}

function weighted(r: () => number, w: readonly number[]): number {
  let total = 0;
  for (const x of w) total += x;
  let v = r() * total;
  for (let i = 0; i < w.length; i++) {
    v -= w[i];
    if (v < 0) return i;
  }
  return 0;
}

/** Always-valid instance used only if the random search fails (it practically never does). */
function traceFallback(seed: number, diff: Diff): TraceState {
  const cfg = TRACE_CFG[diff];
  const n = cfg.n;
  const tiles: number[] = [];
  const sol: number[] = [];
  for (let c = 0; c < n * n; c++) {
    const top = c < n;
    tiles.push(top ? TILE_STRAIGHT : TILE_CORNER);
    sol.push(top ? 1 : 0);
  }
  const ice: number[] = [];
  for (let i = 0; i < cfg.ice; i++) ice.push(n * n - 1 - i);
  ice.sort((a, b) => a - b);
  return { kind: 'trace', diff, seed, n, src: 0, sink: 0, tiles, rot: tiles.map(() => 0), sol, ice, strikes: 0, moves: 0, hit: -1, solved: false };
}

/**
 * Build a route first, then lay tiles on it, fill the rest at random and put
 * the ICE on cells the stored solution leaves dark. The source tile is always
 * a straight or a corner, so the current can be cut with one turn: that is
 * what makes a strike-free solution reachable from any position (`tracePlan`).
 */
export function traceGenerate(seed: number, diff: Diff): TraceState {
  const cfg = TRACE_CFG[diff];
  const n = cfg.n;
  for (let attempt = 0; attempt < 120; attempt++) {
    const r = rng(mix(seed, attempt + 1));
    const src = int(r, n);
    const sink = int(r, n);
    const path = mazePath(r, n, src * n, sink * n + n - 1);
    if (path.length < cfg.minLen || path.length > cfg.maxLen) continue;

    const tiles: number[] = new Array(n * n).fill(-1);
    const sol: number[] = new Array(n * n).fill(0);
    for (let k = 0; k < path.length; k++) {
      const c = path[k];
      const dIn = k === 0 ? 3 : dirTo(n, c, path[k - 1]);
      const dOut = k === path.length - 1 ? 1 : dirTo(n, c, path[k + 1]);
      const need = (1 << dIn) | (1 << dOut);
      let kind = ((dIn + 2) & 3) === dOut ? TILE_STRAIGHT : TILE_CORNER;
      if (k > 0 && r() < cfg.teeOnPath) kind = TILE_TEE;
      const fits: number[] = [];
      for (let q = 0; q < 4; q++) {
        const m = traceMask(kind, q);
        if (kind === TILE_TEE ? (m & need) === need : m === need) fits.push(q);
      }
      tiles[c] = kind;
      sol[c] = fits[int(r, fits.length)];
    }
    for (let c = 0; c < n * n; c++) {
      if (tiles[c] >= 0) continue;
      tiles[c] = weighted(r, cfg.weights);
      sol[c] = int(r, 4);
    }

    // ICE goes on cells the solution leaves dark, mostly right next to the live route
    const on = tracePowered(n, src, tiles, sol);
    if (!traceSinkOn(n, sink, tiles, sol, on)) continue;
    const near: number[] = [];
    const far: number[] = [];
    for (let c = 0; c < n * n; c++) {
      if (on[c]) continue;
      const row = Math.floor(c / n);
      const col = c % n;
      let touches = false;
      for (let d = 0; d < 4; d++) {
        const rr = row + DR[d];
        const cc = col + DC[d];
        if (rr >= 0 && cc >= 0 && rr < n && cc < n && on[rr * n + cc]) touches = true;
      }
      (touches ? near : far).push(c);
    }
    if (near.length + far.length < cfg.ice + 1) continue;
    const nearS = shuffled(r, near);
    const farS = shuffled(r, far);
    const lead = Math.min(nearS.length, Math.ceil(cfg.ice * 0.75));
    const ice = nearS
      .slice(0, lead)
      .concat(farS, nearS.slice(lead))
      .slice(0, cfg.ice)
      .sort((a, b) => a - b);

    // starting position: safe, unsolved, and at least half the route is wrong
    let rot: number[] | null = null;
    for (let i = 0; i < 60 && !rot; i++) {
      const cand = tiles.map(() => int(r, 4));
      const p = tracePowered(n, src, tiles, cand);
      if (ice.some((c) => p[c])) continue;
      if (traceSinkOn(n, sink, tiles, cand, p)) continue;
      let wrong = 0;
      for (const c of path) if (traceMask(tiles[c], cand[c]) !== traceMask(tiles[c], sol[c])) wrong++;
      if (wrong < Math.ceil(path.length / 2)) continue;
      rot = cand;
    }
    if (!rot) {
      rot = tiles.map(() => int(r, 4));
      rot[src * n] = 0; // straight N-S or corner N-E: the source is cut, nothing is live
    }
    return { kind: 'trace', diff, seed, n, src, sink, tiles, rot, sol, ice, strikes: 0, moves: 0, hit: -1, solved: false };
  }
  return traceFallback(seed, diff);
}

export type TraceResult = 'ok' | 'strike' | 'solved' | 'invalid';

/**
 * Turn one tile a quarter turn (dir 1 clockwise, -1 counter-clockwise).
 * If that puts current on an ICE cell the turn is refused, it costs a strike
 * and the 3x3 block around the tile is scrambled (to a position that is safe).
 */
export function traceRotate(s: TraceState, cell: unknown, dir: unknown): { state: TraceState; result: TraceResult } {
  if (s.solved || !isInt(cell) || cell < 0 || cell >= s.n * s.n || (dir !== 1 && dir !== -1)) return { state: s, result: 'invalid' };
  const n = s.n;
  const rot = s.rot.slice();
  rot[cell] = (rot[cell] + (dir === 1 ? 1 : 3)) & 3;
  const on = tracePowered(n, s.src, s.tiles, rot);
  const hit = s.ice.find((c) => on[c]);
  if (hit !== undefined) {
    const r = rng(mix(mix(s.seed, 0x7ace), s.moves + 1));
    const row = Math.floor(cell / n);
    const col = cell % n;
    let out = s.rot; // the position before the move was safe: last resort
    for (let i = 0; i < 40; i++) {
      const cand = s.rot.slice();
      for (let rr = Math.max(0, row - 1); rr <= Math.min(n - 1, row + 1); rr++) {
        for (let cc = Math.max(0, col - 1); cc <= Math.min(n - 1, col + 1); cc++) cand[rr * n + cc] = int(r, 4);
      }
      const p = tracePowered(n, s.src, s.tiles, cand);
      if (s.ice.some((c) => p[c]) || traceSinkOn(n, s.sink, s.tiles, cand, p)) continue;
      out = cand;
      break;
    }
    return { state: { ...s, rot: out, strikes: s.strikes + 1, moves: s.moves + 1, hit }, result: 'strike' };
  }
  const solved = traceSinkOn(n, s.sink, s.tiles, rot, on);
  return { state: { ...s, rot, moves: s.moves + 1, solved }, result: solved ? 'solved' : 'ok' };
}

/**
 * A strike-free way to finish from the current position: cut the source,
 * set every other tile while nothing is live, reconnect the source last.
 */
export function tracePlan(s: TraceState): { c: number; d: number }[] {
  const out: { c: number; d: number }[] = [];
  if (s.solved) return out;
  const n = s.n;
  const c0 = s.src * n;
  const rot = s.rot.slice();
  const hasW = (q: number) => (traceMask(s.tiles[c0], q) & DIR_W) !== 0;
  if (hasW(rot[c0])) {
    const d = !hasW((rot[c0] + 1) & 3) ? 1 : -1;
    rot[c0] = (rot[c0] + (d === 1 ? 1 : 3)) & 3;
    out.push({ c: c0, d });
  }
  for (let c = 0; c < n * n; c++) {
    if (c === c0) continue;
    const want = traceMask(s.tiles[c], s.sol[c]);
    let steps = 0;
    while (steps < 4 && traceMask(s.tiles[c], (rot[c] + steps) & 3) !== want) steps++;
    if (steps === 3) out.push({ c, d: -1 });
    else for (let i = 0; i < steps; i++) out.push({ c, d: 1 });
    rot[c] = (rot[c] + steps) & 3;
  }
  const want0 = traceMask(s.tiles[c0], s.sol[c0]);
  for (const d of [1, -1]) {
    const seq: { c: number; d: number }[] = [];
    let q = rot[c0];
    let ok = false;
    for (let i = 0; i < 3; i++) {
      q = (q + (d === 1 ? 1 : 3)) & 3;
      seq.push({ c: c0, d });
      if (traceMask(s.tiles[c0], q) === want0) {
        ok = true;
        break;
      }
      if (hasW(q)) break; // would go live in the wrong shape: try the other way round
    }
    if (ok) {
      out.push(...seq);
      break;
    }
  }
  return out;
}

/** Router: sees the tiles and the current, not the ICE. */
export interface TraceViewA {
  game: 'trace';
  side: 'a';
  n: number;
  src: number;
  sink: number;
  tiles: number[];
  rot: number[];
  on: number[];
  sinkOn: boolean;
  strikes: number;
  solved: boolean;
}

/** ICE map: sees the ICE and where the current is, not the tiles. */
export interface TraceViewB {
  game: 'trace';
  side: 'b';
  n: number;
  src: number;
  sink: number;
  ice: number[];
  on: number[];
  sinkOn: boolean;
  hit: number;
  strikes: number;
  solved: boolean;
}

export function traceView(s: TraceState, side: Side): TraceViewA | TraceViewB {
  const on = tracePowered(s.n, s.src, s.tiles, s.rot);
  const sinkOn = traceSinkOn(s.n, s.sink, s.tiles, s.rot, on);
  if (side === 'a') return { game: 'trace', side, n: s.n, src: s.src, sink: s.sink, tiles: s.tiles, rot: s.rot, on, sinkOn, strikes: s.strikes, solved: s.solved };
  return { game: 'trace', side, n: s.n, src: s.src, sink: s.sink, ice: s.ice, on, sinkOn, hit: s.hit, strikes: s.strikes, solved: s.solved };
}

// ===========================================================================
// SIGNAL: dials shape a wave; it has to sit on the target wave for a moment.
// The target is only on the scope (side 'b').
// ===========================================================================

export const SIGNAL_HOLD_MS = 1500;
const TAU = Math.PI * 2;
const SAMPLES = 64;

export interface SignalCfg {
  /** 2 = frequency + amplitude, 3 = + phase. */
  dials: number;
  fSteps: number;
  fMin: number;
  fStep: number;
  aSteps: number;
  aMin: number;
  aStep: number;
  pSteps: number;
  /** Largest allowed RMS distance between the two waves. */
  tol: number;
  /** The target's phase wanders: one pattern entry (in phase steps) every driftMs. 0 = steady. */
  driftMs: number;
  drift: number[];
}

export const SIGNAL_CFG: Record<Diff, SignalCfg> = {
  1: { dials: 2, fSteps: 9, fMin: 1, fStep: 0.5, aSteps: 9, aMin: 0.2, aStep: 0.1, pSteps: 1, tol: 0.11, driftMs: 0, drift: [0] },
  2: { dials: 3, fSteps: 9, fMin: 1, fStep: 0.5, aSteps: 9, aMin: 0.2, aStep: 0.1, pSteps: 12, tol: 0.09, driftMs: 9000, drift: [0, 1, 0, -1] },
  3: { dials: 3, fSteps: 17, fMin: 1, fStep: 0.25, aSteps: 17, aMin: 0.2, aStep: 0.05, pSteps: 24, tol: 0.06, driftMs: 6000, drift: [0, 1, 2, 1, 0, -1, -2, -1] },
};

export const SIGNAL_DIALS = ['freq', 'amp', 'phase'] as const;

export interface SignalState {
  kind: 'signal';
  diff: Diff;
  seed: number;
  /** Position of each dial (index into its steps). */
  dials: number[];
  target: number[];
  /** Host clock (ms) when the puzzle was created: the drift runs from here. */
  t0: number;
  /** Host clock (ms) since when the waves match, null while they do not. */
  lockSince: number | null;
  strikes: number;
  solved: boolean;
}

export interface Wave {
  /** Cycles across the scope. */
  f: number;
  /** 0..1 of the scope's half height. */
  a: number;
  /** Radians. */
  p: number;
}

export function signalSteps(diff: Diff): number[] {
  const c = SIGNAL_CFG[diff];
  return c.dials === 3 ? [c.fSteps, c.aSteps, c.pSteps] : [c.fSteps, c.aSteps];
}

export function signalWave(diff: Diff, idx: readonly number[]): Wave {
  const c = SIGNAL_CFG[diff];
  return { f: c.fMin + idx[0] * c.fStep, a: c.aMin + idx[1] * c.aStep, p: c.dials === 3 ? (idx[2] / c.pSteps) * TAU : 0 };
}

export function waveAt(w: Wave, x: number): number {
  return w.a * Math.sin(TAU * w.f * x + w.p);
}

function waveError(f1: number, a1: number, p1: number, f2: number, a2: number, p2: number): number {
  let sum = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const x = (i + 0.5) / SAMPLES;
    const d = a1 * Math.sin(TAU * f1 * x + p1) - a2 * Math.sin(TAU * f2 * x + p2);
    sum += d * d;
  }
  return Math.sqrt(sum / SAMPLES);
}

/** RMS distance between the waves of two dial settings. */
export function signalError(diff: Diff, a: readonly number[], b: readonly number[]): number {
  const c = SIGNAL_CFG[diff];
  const pa = c.dials === 3 ? (a[2] / c.pSteps) * TAU : 0;
  const pb = c.dials === 3 ? (b[2] / c.pSteps) * TAU : 0;
  return waveError(c.fMin + a[0] * c.fStep, c.aMin + a[1] * c.aStep, pa, c.fMin + b[0] * c.fStep, c.aMin + b[1] * c.aStep, pb);
}

/** Which entry of the drift pattern is active at `now`. */
export function signalDriftIndex(s: SignalState, now: number): number {
  const c = SIGNAL_CFG[s.diff];
  if (!c.driftMs) return 0;
  return Math.floor(Math.max(0, now - s.t0) / c.driftMs) % c.drift.length;
}

/** The target's dial positions at `now` (the phase wanders on higher difficulties). */
export function signalTargetAt(s: SignalState, now: number): number[] {
  const c = SIGNAL_CFG[s.diff];
  const out = s.target.slice();
  if (c.dials === 3) out[2] = (((out[2] + c.drift[signalDriftIndex(s, now)]) % c.pSteps) + c.pSteps) % c.pSteps;
  return out;
}

/** Distance between the tuner's wave and the target right now (no allocations: runs every frame on the host). */
export function signalErrorNow(s: SignalState, now: number): number {
  const c = SIGNAL_CFG[s.diff];
  let pc = 0;
  let pt = 0;
  if (c.dials === 3) {
    pc = (s.dials[2] / c.pSteps) * TAU;
    pt = ((s.target[2] + c.drift[signalDriftIndex(s, now)]) / c.pSteps) * TAU;
  }
  return waveError(c.fMin + s.dials[0] * c.fStep, c.aMin + s.dials[1] * c.aStep, pc, c.fMin + s.target[0] * c.fStep, c.aMin + s.target[1] * c.aStep, pt);
}

export function signalMatched(s: SignalState, now: number): boolean {
  return signalErrorNow(s, now) <= SIGNAL_CFG[s.diff].tol;
}

export function signalGenerate(seed: number, diff: Diff, t0: number): SignalState {
  const c = SIGNAL_CFG[diff];
  const r = rng(mix(seed, 0x516));
  // amplitude of at least 0.4, so a wrong frequency or phase is always clearly out of tolerance
  const aLow = Math.ceil((0.4 - c.aMin) / c.aStep - 1e-9);
  const target = [int(r, c.fSteps), aLow + int(r, c.aSteps - aLow)];
  if (c.dials === 3) target.push(int(r, c.pSteps));
  const base: SignalState = { kind: 'signal', diff, seed, dials: target, target, t0, lockSince: null, strikes: 0, solved: false };
  const farEnough = (dials: number[]) => {
    if (Math.abs(dials[0] - target[0]) < 2) return false;
    for (let k = 0; k < c.drift.length; k++) {
      const tgt = target.slice();
      if (c.dials === 3) tgt[2] = (((tgt[2] + c.drift[k]) % c.pSteps) + c.pSteps) % c.pSteps;
      if (signalError(diff, dials, tgt) < Math.max(0.25, c.tol * 3)) return false;
    }
    return true;
  };
  let dials: number[] | null = null;
  for (let i = 0; i < 200 && !dials; i++) {
    const cand = [int(r, c.fSteps), int(r, c.aSteps)];
    if (c.dials === 3) cand.push(int(r, c.pSteps));
    if (farEnough(cand)) dials = cand;
  }
  if (!dials) {
    // deterministic way out: the frequency as far from the target as the dial allows
    dials = target.slice();
    dials[0] = target[0] < c.fSteps / 2 ? c.fSteps - 1 : 0;
  }
  return { ...base, dials };
}

export type SignalResult = 'ok' | 'lock' | 'unlock' | 'solved' | 'none' | 'invalid';

/** What the clock changes on its own: the lock starts, breaks (drift) or completes. */
export function signalCheck(s: SignalState, now: number): 'none' | 'lock' | 'unlock' | 'solved' {
  if (s.solved) return 'none';
  const m = signalMatched(s, now);
  if (m && s.lockSince === null) return 'lock';
  if (!m && s.lockSince !== null) return 'unlock';
  if (m && s.lockSince !== null && now - s.lockSince >= SIGNAL_HOLD_MS) return 'solved';
  return 'none';
}

export function signalTick(s: SignalState, now: number): { state: SignalState; result: SignalResult } {
  const result = signalCheck(s, now);
  if (result === 'lock') return { state: { ...s, lockSince: now }, result };
  if (result === 'unlock') return { state: { ...s, lockSince: null }, result };
  if (result === 'solved') return { state: { ...s, solved: true }, result };
  return { state: s, result };
}

/** Move one dial by one step. Frequency and amplitude stop at their ends, the phase wraps. */
export function signalTurn(s: SignalState, dial: unknown, dir: unknown, now: number): { state: SignalState; result: SignalResult } {
  const steps = signalSteps(s.diff);
  if (s.solved || !isInt(dial) || dial < 0 || dial >= steps.length || (dir !== 1 && dir !== -1)) return { state: s, result: 'invalid' };
  let v = s.dials[dial] + dir;
  if (dial === 2) v = (v + steps[2]) % steps[2];
  else if (v < 0 || v >= steps[dial]) return { state: s, result: 'invalid' };
  const dials = s.dials.slice();
  dials[dial] = v;
  const next: SignalState = { ...s, dials };
  const m = signalMatched(next, now);
  if (m && s.lockSince === null) return { state: { ...next, lockSince: now }, result: 'lock' };
  if (!m && s.lockSince !== null) return { state: { ...next, lockSince: null }, result: 'unlock' };
  return { state: next, result: 'ok' };
}

/** Dial steps that put the tuner exactly on the target as it is at `now`. */
export function signalPlan(s: SignalState, now: number): { dial: number; d: number }[] {
  const out: { dial: number; d: number }[] = [];
  if (s.solved) return out;
  const steps = signalSteps(s.diff);
  const tgt = signalTargetAt(s, now);
  for (let dial = 0; dial < steps.length; dial++) {
    let delta = tgt[dial] - s.dials[dial];
    if (dial === 2) {
      const n = steps[2];
      delta = ((delta % n) + n) % n;
      if (delta > n / 2) delta -= n;
    }
    for (let i = 0; i < Math.abs(delta); i++) out.push({ dial, d: delta > 0 ? 1 : -1 });
  }
  return out;
}

/** Tuner: dials and its own wave. No target. */
export interface SignalViewA {
  game: 'signal';
  side: 'a';
  dials: number[];
  steps: number[];
  cur: Wave;
  lockSince: number | null;
  hold: number;
  solved: boolean;
}

/** Scope: the target wave, the tuner's wave on top, and how close they are. */
export interface SignalViewB {
  game: 'signal';
  side: 'b';
  cur: Wave;
  tgt: Wave;
  /** 0..1, 1 = identical. */
  match: number;
  inTol: boolean;
  lockSince: number | null;
  hold: number;
  solved: boolean;
}

export function signalView(s: SignalState, side: Side, now: number): SignalViewA | SignalViewB {
  const cur = signalWave(s.diff, s.dials);
  if (side === 'a') return { game: 'signal', side, dials: s.dials, steps: signalSteps(s.diff), cur, lockSince: s.lockSince, hold: SIGNAL_HOLD_MS, solved: s.solved };
  const tgt = signalWave(s.diff, signalTargetAt(s, now));
  const err = signalErrorNow(s, now);
  const match = Math.max(0, Math.min(1, 1 - err / (0.9 * tgt.a + 0.1)));
  return { game: 'signal', side, cur, tgt, match, inTol: err <= SIGNAL_CFG[s.diff].tol, lockSince: s.lockSince, hold: SIGNAL_HOLD_MS, solved: s.solved };
}

// ===========================================================================
// CIPHER: the keypad shows a code as symbols, the key table (side 'b') says
// which digit each symbol stands for. A wrong entry reshuffles the table,
// three wrong entries make a new code.
// ===========================================================================

/** 18 symbols in 6 families of 3 look-alikes (family = id / 3). Drawn by hack.ts. */
export const GLYPH_COUNT = 18;

export interface CipherCfg {
  /** Symbols on the key table = digits in use (1..table). */
  table: number;
  len: number;
  /** How many look-alikes to take from each chosen family. */
  pick: number[];
  /** The key table is readable for `on` ms, then dark for `off` ms. null = always on. */
  blink: { on: number; off: number } | null;
}

export const CIPHER_CFG: Record<Diff, CipherCfg> = {
  1: { table: 6, len: 3, pick: [1, 1, 1, 1, 1, 1], blink: null },
  2: { table: 9, len: 4, pick: [2, 2, 2, 1, 1, 1], blink: null },
  3: { table: 9, len: 5, pick: [3, 3, 2, 1], blink: { on: 4000, off: 2500 } },
};
export const CIPHER_STRIKES = 3;

export interface CipherState {
  kind: 'cipher';
  diff: Diff;
  seed: number;
  /** How many codes have been burned so far. */
  gen: number;
  t0: number;
  /** Key table: symbol ids in display order, and the digit each one stands for. */
  symbols: number[];
  map: number[];
  /** The code: symbol ids in entry order. */
  code: number[];
  entered: number[];
  /** Wrong entries on the current code (0..2). */
  strikes: number;
  /** Wrong entries since the start (for the score). */
  total: number;
  solved: boolean;
}

export function cipherGenerate(seed: number, diff: Diff, t0: number, gen = 0, total = 0): CipherState {
  const cfg = CIPHER_CFG[diff];
  const r = rng(mix(mix(seed, 0xc1f3), gen));
  const fams = shuffled(r, [0, 1, 2, 3, 4, 5]);
  const picked: number[] = [];
  cfg.pick.forEach((count, i) => {
    for (const v of shuffled(r, [0, 1, 2]).slice(0, count)) picked.push(fams[i] * 3 + v);
  });
  const symbols = shuffled(r, picked);
  const digits: number[] = [];
  for (let d = 1; d <= cfg.table; d++) digits.push(d);
  const map = shuffled(r, digits);
  const code = shuffled(r, symbols).slice(0, cfg.len);
  return { kind: 'cipher', diff, seed, gen, t0, symbols, map, code, entered: [], strikes: 0, total, solved: false };
}

/** The digits that open it right now. */
export function cipherSolution(s: CipherState): number[] {
  return s.code.map((g) => s.map[s.symbols.indexOf(g)]);
}

export function cipherVisible(s: CipherState, now: number): boolean {
  const b = CIPHER_CFG[s.diff].blink;
  if (!b || s.solved) return true;
  const span = b.on + b.off;
  return ((((now - s.t0) % span) + span) % span) < b.on;
}

export type CipherResult = 'key' | 'back' | 'strike' | 'reroll' | 'solved' | 'invalid';

/** `k`: a digit 1..table, 'back' (delete the last digit) or 'ok' (confirm the entry). */
export function cipherPress(s: CipherState, k: unknown): { state: CipherState; result: CipherResult } {
  const cfg = CIPHER_CFG[s.diff];
  if (s.solved) return { state: s, result: 'invalid' };
  if (k === 'back') {
    if (!s.entered.length) return { state: s, result: 'invalid' };
    return { state: { ...s, entered: s.entered.slice(0, -1) }, result: 'back' };
  }
  if (k === 'ok') {
    if (s.entered.length !== cfg.len) return { state: s, result: 'invalid' };
    const want = cipherSolution(s);
    if (s.entered.every((d, i) => d === want[i])) return { state: { ...s, solved: true }, result: 'solved' };
    const total = s.total + 1;
    if (s.strikes + 1 >= CIPHER_STRIKES) return { state: cipherGenerate(s.seed, s.diff, s.t0, s.gen + 1, total), result: 'reroll' };
    // same code, but the table is dealt again: whatever the crew remembered is void
    const r = rng(mix(mix(mix(s.seed, 0x51ab), s.gen), total));
    const digits: number[] = [];
    for (let d = 1; d <= cfg.table; d++) digits.push(d);
    const before = want.join(',');
    let symbols = s.symbols;
    let map = s.map;
    for (let i = 0; i < 12; i++) {
      symbols = shuffled(r, s.symbols);
      map = shuffled(r, digits);
      if (s.code.map((g) => map[symbols.indexOf(g)]).join(',') !== before) break;
    }
    return { state: { ...s, symbols, map, entered: [], strikes: s.strikes + 1, total }, result: 'strike' };
  }
  if (!isInt(k) || k < 1 || k > cfg.table || s.entered.length >= cfg.len) return { state: s, result: 'invalid' };
  return { state: { ...s, entered: [...s.entered, k] }, result: 'key' };
}

export function cipherPlan(s: CipherState): { k: number | 'ok' | 'back' }[] {
  const out: { k: number | 'ok' | 'back' }[] = [];
  if (s.solved) return out;
  for (let i = 0; i < s.entered.length; i++) out.push({ k: 'back' });
  for (const d of cipherSolution(s)) out.push({ k: d });
  out.push({ k: 'ok' });
  return out;
}

/** Keypad: the code as symbols and what was typed. No table. */
export interface CipherViewA {
  game: 'cipher';
  side: 'a';
  code: number[];
  entered: number[];
  keys: number;
  strikes: number;
  max: number;
  gen: number;
  solved: boolean;
}

/** Key table: symbol -> digit. No code. */
export interface CipherViewB {
  game: 'cipher';
  side: 'b';
  visible: boolean;
  /** Empty while the table is dark. */
  rows: { g: number; d: number }[];
  count: number;
  strikes: number;
  max: number;
  solved: boolean;
}

export function cipherView(s: CipherState, side: Side, now: number): CipherViewA | CipherViewB {
  if (side === 'a') return { game: 'cipher', side, code: s.code, entered: s.entered, keys: CIPHER_CFG[s.diff].table, strikes: s.strikes, max: CIPHER_STRIKES, gen: s.gen, solved: s.solved };
  const visible = cipherVisible(s, now);
  return {
    game: 'cipher',
    side,
    visible,
    rows: visible ? s.symbols.map((g, i) => ({ g, d: s.map[i] })) : [],
    count: s.symbols.length,
    strikes: s.strikes,
    max: CIPHER_STRIKES,
    solved: s.solved,
  };
}

// ===========================================================================
// One front door for all three games
// ===========================================================================

export type HackState = TraceState | SignalState | CipherState;
export type HackView = TraceViewA | TraceViewB | SignalViewA | SignalViewB | CipherViewA | CipherViewB;
export type HackResult = TraceResult | SignalResult | CipherResult;
/** A move as it travels in an intent: trace { c, d }, signal { dial, d }, cipher { k }. */
export interface HackMove {
  c?: unknown;
  d?: unknown;
  dial?: unknown;
  k?: unknown;
}

export function hackGenerate(kind: GameKind, seed: number, diff: Diff, now: number): HackState {
  if (kind === 'trace') return traceGenerate(seed, diff);
  if (kind === 'signal') return signalGenerate(seed, diff, now);
  return cipherGenerate(seed, diff, now);
}

/** Apply one move. Anything that is not a legal move comes back as 'invalid' with the state untouched. */
export function hackApply(s: HackState, move: HackMove | null | undefined, now: number): { state: HackState; result: HackResult } {
  if (!move || typeof move !== 'object') return { state: s, result: 'invalid' };
  if (s.kind === 'trace') return traceRotate(s, move.c, move.d);
  if (s.kind === 'signal') return signalTurn(s, move.dial, move.d, now);
  return cipherPress(s, move.k);
}

export function hackView(s: HackState, side: Side, now: number): HackView {
  if (s.kind === 'trace') return traceView(s, side);
  if (s.kind === 'signal') return signalView(s, side, now);
  return cipherView(s, side, now);
}

/** Moves that finish the puzzle from where it stands (tests, debug hooks). Signal still needs the hold time afterwards. */
export function hackPlan(s: HackState, now: number): HackMove[] {
  if (s.kind === 'trace') return tracePlan(s);
  if (s.kind === 'signal') return signalPlan(s, now);
  return cipherPlan(s);
}

/** Wrong moves so far (the score counts them as fails). Signal has none: it cannot be entered wrongly. */
export function hackStrikes(s: HackState): number {
  return s.kind === 'cipher' ? s.total : s.strikes;
}
