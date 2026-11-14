// Safe opening (mech / elek / drill), the rules without a browser.
// Run: node tests/safe-logic.mjs
import * as L from '../src/game/mech/safe-logic.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const seeds = Array.from({ length: 120 }, (_, i) => L.mix(0xbeef, i));
const IN = (o = {}) => ({ ...L.NO_INPUT, ...o });

/** Run a bot to the end. `pilot(s, t)` returns the input for this step. */
function run(s, pilot, dt = 1 / 60, maxT = 240) {
  const log = [];
  for (let i = 0; i < maxT / dt && s.status === 'run'; i++) for (const e of L.safeStep(s, pilot(s), dt)) log.push(e.k);
  return log;
}
const perfect = (useSpace) => (s) => L.safeAdvice(s, useSpace);

check('toDiff / toVariant', L.toDiff('3') === 3 && L.toDiff('x') === 2 && L.toVariant('elek') === 'elek' && L.toVariant('zeit') === 'drill' && L.toVariant(undefined) === 'mech');

// ---- deterministic per seed
for (const v of L.VARIANTS) {
  for (const d of [1, 2, 3]) {
    const a = L.safeNew(v, 42, d);
    const b = L.safeNew(v, 42, d);
    const c = L.safeNew(v, 43, d);
    check(`${v} d${d}: same seed, same puzzle; another seed differs (or has no puzzle)`, same(a, b) && (v === 'drill' || !same(a, c)));
    const ra = L.safeNew(v, 7, d);
    const rb = L.safeNew(v, 7, d);
    run(ra, perfect(false), 1 / 60);
    run(rb, perfect(false), 1 / 60);
    check(`${v} d${d}: same seed and same play, same result`, same(ra, rb));
  }
}

// ---- generators: valid puzzles
{
  let bad = '';
  for (const seed of seeds)
    for (const d of [1, 2, 3]) {
      const m = L.mechNew(seed, d);
      if (m.targets.some((x) => x < 0 || x >= 60 || x !== Math.floor(x))) bad = `mech target ${seed}`;
      if (m.dirs[0] === m.dirs[1] || m.dirs[1] === m.dirs[2]) bad = `mech dirs ${seed}`;
      if (Math.abs(L.mechDelta(m.targets[1], m.targets[0])) < 15 || Math.abs(L.mechDelta(m.targets[2], m.targets[1])) < 15) bad = `mech spacing ${seed}`;
      if (Math.abs(L.mechDelta(m.pos, m.targets[0])) < 15) bad = `mech start ${seed}`;
      if (d === 1 ? m.decoys.some((x) => x !== -100) : m.targets.some((tg, i) => Math.abs(L.mechDelta(m.decoys[i], tg)) < 14)) bad = `mech decoy ${seed}`;
      const e = L.elekNew(seed, d);
      if (e.code.length !== (d === 3 ? 5 : 4) || e.code.some((x) => x < 0 || x > 9 || x !== Math.floor(x))) bad = `elek code ${seed}`;
      if (e.code.some((x, i) => i && x === e.code[i - 1])) bad = `elek repeat ${seed}`;
    }
  check('generators: mech numbers spaced, alternating, decoys only from diff 2; elek code length 4 (5 on diff 3)', !bad, bad);
}

// ---- a perfect bot opens every variant and difficulty, within the time aimed for
for (const v of L.VARIANTS) {
  for (const d of [1, 2, 3]) {
    let ok = 0;
    let slow = 0;
    let fum = 0;
    let tmax = 0;
    let tsum = 0;
    let noiseMax = 0;
    for (const seed of seeds) {
      const s = L.safeNew(v, seed, d, 120);
      run(s, perfect(seed % 2 === 0), seed % 3 === 0 ? 1 / 30 : 1 / 60);
      const o = L.safeOutcome(s);
      if (o && o.ok) ok++;
      else slow++;
      fum += o ? o.fumbles : 0;
      tmax = Math.max(tmax, o?.seconds ?? 0);
      tsum += o?.seconds ?? 0;
      noiseMax = Math.max(noiseMax, o?.noise ?? 0);
    }
    check(`${v} d${d}: a perfect bot opens ${seeds.length}/${seeds.length} seeds without a slip`, ok === seeds.length && fum === 0, `ok ${ok}, slips ${fum}`);
    const lim = v === 'drill' ? 60 : 30;
    check(`${v} d${d}: perfect play takes at most ${lim} s (mean ${(tsum / seeds.length).toFixed(1)}, max ${tmax.toFixed(1)})`, tmax <= lim);
    if (v === 'drill') check(`drill d${d}: noise grows with drilling, capped at 10 (max ${noiseMax})`, noiseMax > 4 && noiseMax <= 10);
    if (v === 'elek') check('elek: quiet, noise 0', noiseMax === 0);
  }
}

// ---- MECH
{
  const cfg = L.MECH_CFG;
  check('mech: the window narrows with difficulty, the decoy grows', cfg[1].win > cfg[2].win && cfg[2].win > cfg[3].win && cfg[1].decoy === 0 && cfg[3].decoy > cfg[2].decoy);

  // meter rises towards the number and reads 1 on it
  const s = L.mechNew(5, 2);
  const tg = s.targets[0];
  const at = (p) => {
    s.pos = p;
    s.lastDir = s.dirs[0];
    L.mechStep(s, IN(), 0);
    return s.contact;
  };
  const far = at((tg + 30) % 60);
  const near = at((tg + 6) % 60);
  const close = at((tg + 3) % 60);
  const on = at(tg);
  check('mech: contact meter rises as you approach and is full on the number', far < near && near < close && close < 1 && on === 1 && s.on, `${far.toFixed(2)} ${near.toFixed(2)} ${close.toFixed(2)} ${on}`);

  const fresh = (diff = 2, seed = 5) => {
    const m = L.mechNew(seed, diff);
    return m;
  };
  /** put the dial `o` marks before the target (in travel direction), with last turn in the required direction */
  const place = (m, o, lastOk = true) => {
    m.pos = (((m.targets[m.step] - m.dirs[m.step] * o) % 60) + 60) % 60;
    m.lastDir = lastOk ? m.dirs[m.step] : -m.dirs[m.step];
    L.mechStep(m, IN(), 0);
  };

  // hold still on it for half a second sets it
  let m = fresh();
  place(m, 0);
  let evs = [];
  for (let i = 0; i < 20; i++) evs.push(...L.mechStep(m, IN(), 1 / 60));
  check('mech: holding still on the number for 0.5 s does not set it yet', m.step === 0 && m.holdT > 0.3);
  for (let i = 0; i < 20; i++) evs.push(...L.mechStep(m, IN(), 1 / 60));
  check('mech: ... but does at half a second', m.step === 1 && evs.some((e) => e.k === 'set'));

  // Space sets it at once, but only on the number
  m = fresh();
  place(m, 8);
  const miss = L.mechStep(m, IN({ act: true }), 1 / 60);
  check('mech: Space away from the number does nothing (and says so)', m.step === 0 && miss.some((e) => e.k === 'miss'));
  place(m, 0.2);
  const hit = L.mechStep(m, IN({ act: true }), 1 / 60);
  check('mech: Space on the number sets it', m.step === 1 && hit.some((e) => e.k === 'set'));

  // direction: arriving the wrong way does not set
  m = fresh();
  place(m, 0, false);
  for (let i = 0; i < 60; i++) L.mechStep(m, IN(), 1 / 60);
  check('mech: on the number but arrived the wrong way round: it does not set', m.step === 0 && m.on && !m.dirOk);
  L.mechStep(m, IN({ act: true }), 1 / 60);
  check('mech: ... also not with Space', m.step === 0);

  // next number needs the opposite direction
  m = fresh();
  place(m, 0);
  L.mechStep(m, IN({ act: true }), 1 / 60);
  check('mech: after a number the dial must turn the other way (direction alternates)', m.step === 1 && m.dirs[1] === -m.dirs[0] && !m.dirOk);

  // overshoot slip
  m = fresh(2);
  const sl = m.dirs[0];
  place(m, 0);
  m.lastDir = sl;
  const evSlip = [];
  for (let i = 0; i < 80 && m.fumbles === 0; i++) evSlip.push(...L.mechStep(m, IN({ dir: sl, slow: true }), 1 / 60));
  check('mech: turning on past the number by more than a few marks is a slip: noise +1, fumbles +1, still not set', m.fumbles === 1 && m.noise === 1 && m.step === 0 && evSlip.some((e) => e.k === 'slip'));
  const o = m.dirs[0] * L.mechDelta(m.pos, m.targets[0]);
  check('mech: the slip came after more than slip marks of overshoot, not before', o > L.MECH_CFG[2].slip && o < L.MECH_CFG[2].slip + 0.5, `o=${o.toFixed(2)}`);
  // a slip does not count twice, and the number can be found again
  for (let i = 0; i < 30; i++) L.mechStep(m, IN({ dir: sl, slow: true }), 1 / 60);
  check('mech: one slip per overshoot', m.fumbles === 1);
  let guard = 0;
  while (m.step === 0 && guard++ < 6000) L.mechStep(m, L.mechAdvice(m), 1 / 60);
  check('mech: after a slip the same number is found again', m.step === 1 && m.fumbles === 1);

  // backing off a few marks (no overshoot) is fine
  m = fresh(2);
  place(m, 0);
  for (let i = 0; i < 30; i++) L.mechStep(m, IN({ dir: -m.dirs[0], slow: true }), 1 / 60);
  check('mech: turning back the other way is not a slip', m.fumbles === 0);

  // careless: spinning without ever stopping never opens, and slips every lap
  m = L.mechNew(9, 2, 40);
  run(m, () => IN({ dir: m.dirs[0] }));
  check('mech: careless spinning fails (time) and makes slips', m.status === 'timeout' && m.fumbles >= 3 && L.safeOutcome(m).ok === false && L.safeOutcome(m).noise >= 3, `fumbles ${m.fumbles}`);
  m = L.mechNew(9, 3, 30);
  run(m, () => IN({ act: true }));
  check('mech: mashing Space does not open it', m.status === 'timeout' && m.step === 0);
  // fine turn is slower than the normal turn
  m = fresh();
  const p0 = m.pos;
  for (let i = 0; i < 5; i++) L.mechStep(m, IN({ dir: 1, slow: true }), 0.1);
  const dSlow = Math.abs(L.mechDelta(m.pos, p0));
  m.pos = p0;
  for (let i = 0; i < 5; i++) L.mechStep(m, IN({ dir: 1 }), 0.1);
  check('mech: Shift turns the dial slower', dSlow < Math.abs(L.mechDelta(m.pos, p0)) && Math.abs(dSlow - L.MECH_SLOW * 0.5) < 0.01);
  // limit: a careful bot with the time bar
  m = L.mechNew(11, 1, 2);
  run(m, perfect(false));
  check('mech: time limit fails the attempt', m.status === 'timeout' && L.safeOutcome(m).ok === false && Math.abs(L.safeOutcome(m).seconds - 2) < 0.1);
  // the 3 numbers have to be set in order and the result reflects slips
  m = L.mechNew(3, 3);
  run(m, perfect(true));
  check('mech: three numbers, then open', m.status === 'open' && m.step === 3 && L.safeProgress(m) === 1);
}

// ---- ELEK
{
  const e0 = L.elekNew(4, 2);
  check('elek: the signal peaks on the hot digit', (() => {
    const s = L.elekNew(4, 2);
    const tg = s.code[0];
    s.phase = tg + 0.5;
    s.digit = tg;
    const hot = L.elekSignal(s);
    s.phase = (tg + 4.5) % 10;
    s.digit = Math.floor(s.phase);
    const cold = L.elekSignal(s);
    s.phase = (tg + 9.5) % 10;
    s.digit = Math.floor(s.phase);
    const warm = L.elekSignal(s);
    return hot > 0.99 && cold < 0.05 && warm > cold && warm < hot && L.elekHot(L.elekNew(4, 2)) === (e0.digit === e0.code[0]);
  })());

  const nonHot = (s) => {
    while (L.elekHot(s) || (s.prevDigit === s.code[s.pos] && s.since < L.ELEK_GRACE + 0.05)) L.elekStep(s, IN(), 1 / 60);
  };
  // wrong press: lock 2 s, fumbles +1, noise 0, ignored while locked
  let s = L.elekNew(8, 2);
  nonHot(s);
  let ev = L.elekStep(s, IN({ act: true }), 1 / 60);
  check('elek: a wrong press locks the pad for 2 s: fumbles +1', ev.some((x) => x.k === 'wrong') && s.fumbles === 1 && Math.abs(s.lockT - L.ELEK_LOCK) < 0.001 && s.wrong === 1);
  for (let i = 0; i < 60; i++) L.elekStep(s, IN({ act: true }), 1 / 60);
  check('elek: presses while locked count for nothing', s.fumbles === 1 && s.pos === 0 && s.lockT > 0.9);
  for (let i = 0; i < 70; i++) L.elekStep(s, IN(), 1 / 60);
  check('elek: after 2 s the pad is free again', s.lockT === 0 && s.status === 'run');
  // right press resets the streak
  while (!L.elekHot(s)) L.elekStep(s, IN(), 1 / 60);
  L.elekStep(s, IN({ act: true }), 0);
  check('elek: the right digit at the right time cracks the position and clears the wrong streak', s.pos === 1 && s.wrong === 0 && s.fumbles === 1);
  // the grace: a press just after the digit moved on still counts
  s = L.elekNew(8, 2);
  while (!L.elekHot(s)) L.elekStep(s, IN(), 1 / 60);
  while (L.elekHot(s)) L.elekStep(s, IN(), 1 / 120);
  L.elekStep(s, IN({ act: true }), 0.01);
  check('elek: a press a heartbeat after the right digit moved on still counts', s.pos === 1);
  // 3 wrong in a row = lockout
  s = L.elekNew(8, 1, 120);
  let guard = 0;
  while (s.status === 'run' && guard++ < 20000) {
    if (s.lockT === 0) {
      nonHot(s);
      L.elekStep(s, IN({ act: true }), 1 / 60);
    } else L.elekStep(s, IN(), 1 / 60);
  }
  const out = L.safeOutcome(s);
  check('elek: three wrong presses in a row trip the lockout: ok false, noise 0, 3 fumbles', s.status === 'lockout' && out.ok === false && out.fumbles === 3 && out.noise === 0, JSON.stringify(out));
  // wrong, right, wrong, right, wrong: not in a row, no lockout
  s = L.elekNew(8, 2);
  for (let round = 0; round < 2; round++) {
    nonHot(s);
    L.elekStep(s, IN({ act: true }), 1 / 60);
    while (s.lockT > 0) L.elekStep(s, IN(), 1 / 60);
    while (!L.elekHot(s)) L.elekStep(s, IN(), 1 / 60);
    L.elekStep(s, IN({ act: true }), 0);
  }
  nonHot(s);
  L.elekStep(s, IN({ act: true }), 1 / 60);
  check('elek: wrong presses that are not in a row do not trip the lockout', s.status === 'run' && s.fumbles === 3 && s.wrong === 1 && s.pos === 2);
  // time limit
  s = L.elekNew(8, 2, 3);
  run(s, () => IN());
  check('elek: time limit fails the attempt', s.status === 'timeout' && !L.safeOutcome(s).ok);
  // the decoder starts every position away from the right digit (not a free first press)
  let free = 0;
  for (const seed of seeds) {
    const x = L.elekNew(seed, 2);
    if (L.elekHot(x)) free++;
  }
  check('elek: the first position never starts on the hot digit', free === 0);
}

// ---- DRILL
{
  const c = L.DRILL_CFG;
  check('drill: harder = longer and a narrower safe heat band', c[1].need < c[2].need && c[2].need < c[3].need && c[1].red > c[2].red && c[2].red > c[3].red && c[3].up > c[1].up);
  let s = L.drillNew(1, 2);
  for (let i = 0; i < 60; i++) L.drillStep(s, IN({ hold: true }), 1 / 60);
  check('drill: heat rises while drilling and progress fills', s.heat > 0.3 && s.progress > 0.04);
  const h0 = s.heat;
  for (let i = 0; i < 30; i++) L.drillStep(s, IN(), 1 / 60);
  check('drill: heat falls while released', s.heat < h0 - 0.15);
  // holding the key down binds the bit
  s = L.drillNew(1, 2, 200);
  const evs = [];
  let firstBindAt = -1;
  let progBefore = 0;
  for (let i = 0; i < 12000 && s.status === 'run'; i++) {
    const pb = s.progress;
    const e = L.drillStep(s, IN({ hold: !(s.latch && s.stuck <= 0) }), 1 / 60); // hammering: lets go for one frame after each bind
    evs.push(...e.map((x) => x.k));
    if (firstBindAt < 0 && e.some((x) => x.k === 'bind')) {
      firstBindAt = s.t;
      progBefore = pb;
      check('drill: a bind costs 10 % progress, fumbles +1, and the bit is stuck for a moment', s.fumbles === 1 && Math.abs(s.progress - Math.max(0, pb + 1 / 60 / c[2].need - 0.1)) < 0.01 + 0.002 && s.stuck > 1);
    }
  }
  check('drill: holding Space down (letting go only when the bit frees up) binds three times: the bit breaks (ok false)', s.status === 'broke' && s.binds === 3 && s.fumbles === 3 && !L.safeOutcome(s).ok && evs.filter((k) => k === 'bind').length === 3, `status ${s.status}`);
  check('drill: a bound bit cannot go on drilling until the key was let go', (() => {
    const d = L.drillNew(2, 3);
    while (d.binds === 0) L.drillStep(d, IN({ hold: true }), 1 / 60);
    for (let i = 0; i < 120; i++) L.drillStep(d, IN({ hold: true }), 1 / 60); // stuck 1.2 s, key still down
    const p = d.progress;
    for (let i = 0; i < 30; i++) L.drillStep(d, IN({ hold: true }), 1 / 60);
    const stillHeld = d.progress === p && d.drilling === false;
    L.drillStep(d, IN(), 1 / 60);
    L.drillStep(d, IN({ hold: true }), 1 / 60);
    return stillHeld && d.drilling === true;
  })());
  // noise follows the drill running time
  s = L.drillNew(1, 2);
  for (let i = 0; i < 60 * 8; i++) L.drillStep(s, IN({ hold: i % 120 < 60 }), 1 / 60);
  check('drill: noise grows with the time the drill ran (not with time passed)', Math.abs(s.noise - Math.round(s.drillT * L.DRILL_NOISE * 10) / 10) < 0.11 && s.noise > 0.5 && s.noise < 2);
  const longRun = L.drillNew(1, 3, 500);
  run(longRun, perfect(false), 1 / 60, 400);
  check('drill: noise is capped at 10', L.safeOutcome(longRun).noise <= 10);
  // slow starts do not break and noise at the end is a sensible loud number
  s = L.drillNew(1, 2);
  run(s, perfect(false));
  const o = L.safeOutcome(s);
  check('drill: perfect play on d2 is loud: noise 5..10', o.ok && o.noise >= 5 && o.noise <= 10, `noise ${o.noise}, ${o.seconds}s`);
  // limit
  s = L.drillNew(1, 2, 5);
  run(s, perfect(false));
  check('drill: time limit fails the attempt', s.status === 'timeout' && !L.safeOutcome(s).ok);
  // a finished attempt ignores further input
  s = L.drillNew(1, 1);
  run(s, perfect(false));
  const snap = JSON.stringify(s);
  for (let i = 0; i < 20; i++) L.drillStep(s, IN({ hold: true }), 1 / 60);
  check('a finished attempt ignores any further input', JSON.stringify(s) === snap);
}

// ---- outcome shape
{
  const s = L.safeNew('mech', 1, 1);
  check('outcome is null while the attempt runs', L.safeOutcome(s) === null);
  run(s, perfect(false));
  const o = L.safeOutcome(s);
  check('outcome has ok, seconds, noise 0..10, fumbles', o.ok === true && o.seconds > 1 && o.noise >= 0 && o.noise <= 10 && o.fumbles === 0 && o.reason === 'open');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
