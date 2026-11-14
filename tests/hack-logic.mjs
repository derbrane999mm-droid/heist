// Rules of the terminal mini-games, without a browser.
// Run: node tests/hack-logic.mjs   (or: npx tsx tests/hack-logic.mjs)
import * as L from '../src/game/mech/hack-logic.ts';

let failed = 0;
let passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
/** Collects failures of a check that runs many times: one line per check at the end. */
const tally = () => {
  const bad = [];
  return { bad, expect: (ok, what) => void (ok || bad.push(what)), report: (name, extra = '') => check(name, bad.length === 0, bad.length ? `${bad.length} failed, first: ${bad[0]}` : extra) };
};
const N = 200;
const seeds = Array.from({ length: N }, (_, i) => L.mix(0xa11ce, i));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const iceLive = (s, rot = s.rot) => {
  const on = L.tracePowered(s.n, s.src, s.tiles, rot);
  return s.ice.some((c) => on[c]);
};
const sinkLive = (s, rot = s.rot) => L.traceSinkOn(s.n, s.sink, s.tiles, rot, L.tracePowered(s.n, s.src, s.tiles, rot));

// --------------------------------------------------------------------------- helpers
check('toDiff: 1..3 pass through, anything else is 2', L.toDiff('1') === 1 && L.toDiff(3) === 3 && L.toDiff(undefined) === 2 && L.toDiff('9') === 2 && L.toDiff('x') === 2);
{
  const a = L.rng(42);
  const b = L.rng(42);
  const c = L.rng(43);
  const xs = Array.from({ length: 5 }, () => a());
  const ys = Array.from({ length: 5 }, () => b());
  const zs = Array.from({ length: 5 }, () => c());
  check('rng: same seed gives the same numbers, another seed does not', same(xs, ys) && !same(xs, zs) && xs.every((v) => v >= 0 && v < 1));
}
check(
  'tile masks: straight, corner, tee and cross connect the right edges',
  L.traceMask(0, 0) === 5 && L.traceMask(0, 1) === 10 && L.traceMask(1, 0) === 3 && L.traceMask(1, 2) === 12 && L.traceMask(1, 3) === 9 && L.traceMask(2, 0) === 11 && L.traceMask(2, 1) === 7 && L.traceMask(3, 2) === 15,
);

// --------------------------------------------------------------------------- TRACE
for (const diff of [1, 2, 3]) {
  const cfg = L.TRACE_CFG[diff];
  const shape = tally();
  const solvable = tally();
  const start = tally();
  const plan = tally();
  const walk = tally();
  const strikes = tally();
  let fallbacks = 0;
  let planLen = 0;
  let strikesSeen = 0;
  for (const seed of seeds) {
    const s = L.traceGenerate(seed, diff);
    const n = s.n;
    shape.expect(n === cfg.n && s.tiles.length === n * n && s.rot.length === n * n && s.sol.length === n * n, `grid size, seed ${seed}`);
    shape.expect(s.ice.length === cfg.ice && new Set(s.ice).size === cfg.ice && s.ice.every((c) => c >= 0 && c < n * n), `ICE count, seed ${seed}`);
    shape.expect(s.tiles.every((k) => k >= 0 && k <= 3) && s.rot.every((q) => q >= 0 && q <= 3), `tile values, seed ${seed}`);
    shape.expect(s.tiles[s.src * n] <= 1, `source tile can be cut, seed ${seed}`);
    shape.expect(same(s, L.traceGenerate(seed, diff)), `deterministic, seed ${seed}`);
    if (s.tiles.slice(0, n).every((k) => k === 0) && s.tiles.slice(n).every((k) => k === 1)) fallbacks++;

    // the stored solution powers the sink and keeps the ICE dark
    solvable.expect(sinkLive(s, s.sol), `solution reaches the sink, seed ${seed}`);
    solvable.expect(!iceLive(s, s.sol), `solution keeps ICE dark, seed ${seed}`);

    // the starting position is safe and not solved yet
    start.expect(!s.solved && !sinkLive(s) && !iceLive(s) && s.strikes === 0, `seed ${seed}`);

    // a strike-free way through, played with the real rule function
    let cur = s;
    let ok = true;
    const moves = L.tracePlan(s);
    planLen += moves.length;
    moves.forEach((m, i) => {
      const r = L.traceRotate(cur, m.c, m.d);
      if (r.result !== (i === moves.length - 1 ? 'solved' : 'ok')) ok = false;
      cur = r.state;
    });
    plan.expect(ok && cur.solved && cur.strikes === 0 && sinkLive(cur) && !iceLive(cur), `seed ${seed}`);
    plan.expect(L.traceRotate(cur, 0, 1).result === 'invalid', `no moves after the win, seed ${seed}`);

    // random play: no position ever has live ICE, strikes scramble to a safe position, wins are real
    const r = L.rng(seed ^ 0x5eed);
    cur = s;
    for (let i = 0; i < 400 && !cur.solved; i++) {
      const cell = Math.floor(r() * n * n);
      const dir = r() < 0.5 ? 1 : -1;
      const before = cur;
      const res = L.traceRotate(cur, cell, dir);
      cur = res.state;
      walk.expect(!iceLive(cur), `live ICE after a move, seed ${seed}`);
      walk.expect(cur.solved === sinkLive(cur), `solved flag matches the sink, seed ${seed}`);
      walk.expect(res.result !== 'invalid' && cur.moves === before.moves + 1, `move counted, seed ${seed}`);
      if (res.result === 'strike') {
        strikesSeen++;
        strikes.expect(cur.strikes === before.strikes + 1 && cur.ice.includes(cur.hit) && !cur.solved, `strike bookkeeping, seed ${seed}`);
        // only the 3x3 block around the tile may have changed
        const row = Math.floor(cell / n);
        const col = cell % n;
        const outside = cur.rot.every((q, c) => q === before.rot[c] || (Math.abs(Math.floor(c / n) - row) <= 1 && Math.abs((c % n) - col) <= 1));
        strikes.expect(outside, `scramble stays in the 3x3 block, seed ${seed}`);
        // and the puzzle can still be finished without another strike
        let c2 = cur;
        for (const m of L.tracePlan(cur)) c2 = L.traceRotate(c2, m.c, m.d).state;
        strikes.expect(c2.solved && c2.strikes === cur.strikes, `still solvable after a strike, seed ${seed}`);
      } else {
        walk.expect(cur.strikes === before.strikes, `no strike without live ICE, seed ${seed}`);
      }
    }
  }
  shape.report(`trace d${diff}: ${N} instances are well-formed and deterministic (${cfg.n}x${cfg.n}, ${cfg.ice} ICE)`, `fallback instances: ${fallbacks}`);
  check(`trace d${diff}: the random generator almost never needs the fallback`, fallbacks <= N * 0.02, `${fallbacks}/${N}`);
  solvable.report(`trace d${diff}: stored solution powers the sink without touching ICE`);
  start.report(`trace d${diff}: starting position is safe and unsolved`);
  plan.report(`trace d${diff}: a strike-free solution exists from the start and wins`, `avg ${(planLen / N).toFixed(1)} turns`);
  walk.report(`trace d${diff}: random play never leaves live ICE, win flag is exact`);
  strikes.report(`trace d${diff}: powering ICE costs a strike and scramble keeps it solvable`, `${strikesSeen} strikes seen`);
  check(`trace d${diff}: strikes actually happen in random play`, strikesSeen > N / 4, String(strikesSeen));
}
{
  const s = L.traceGenerate(7, 2);
  const bad = [
    [-1, 1],
    [s.n * s.n, 1],
    [1.5, 1],
    ['3', 1],
    [0, 0],
    [0, 2],
    [0, '1'],
    [null, 1],
  ];
  check('trace: malformed moves are refused and change nothing', bad.every(([c, d]) => {
    const r = L.traceRotate(s, c, d);
    return r.result === 'invalid' && r.state === s;
  }));
  const a = L.traceView(s, 'a');
  const b = L.traceView(s, 'b');
  check('trace: the router view has tiles but no ICE', 'tiles' in a && 'rot' in a && !('ice' in a) && !('hit' in a) && !('sol' in a) && !JSON.stringify(a).includes('ice'));
  check('trace: the ICE map has ICE but no tiles', 'ice' in b && same(b.ice, s.ice) && !('tiles' in b) && !('rot' in b) && !('sol' in b));
  check('trace: both views show where the current is', same(a.on, b.on) && a.on.length === s.n * s.n);
}

// --------------------------------------------------------------------------- SIGNAL
for (const diff of [1, 2, 3]) {
  const cfg = L.SIGNAL_CFG[diff];
  const shape = tally();
  const solvable = tally();
  const start = tally();
  const win = tally();
  const tol = tally();
  const drift = tally();
  const steps = L.signalSteps(diff);
  const T0 = 50_000;
  for (const seed of seeds) {
    const s = L.signalGenerate(seed, diff, T0);
    shape.expect(s.dials.length === cfg.dials && s.target.length === cfg.dials, `dial count, seed ${seed}`);
    shape.expect(s.dials.every((v, i) => Number.isInteger(v) && v >= 0 && v < steps[i]) && s.target.every((v, i) => Number.isInteger(v) && v >= 0 && v < steps[i]), `dial range, seed ${seed}`);
    shape.expect(same(s, L.signalGenerate(seed, diff, T0)) && s.lockSince === null && !s.solved, `deterministic, seed ${seed}`);

    // the stored solution is within tolerance, at every point of the drift
    const cycle = cfg.driftMs ? cfg.drift.length : 1;
    for (let k = 0; k < cycle; k++) {
      const now = T0 + k * (cfg.driftMs || 1) + 10;
      const tgt = L.signalTargetAt(s, now);
      solvable.expect(tgt.every((v, i) => v >= 0 && v < steps[i]), `target stays on the dial, seed ${seed}`);
      solvable.expect(L.signalError(diff, tgt, tgt) === 0 && L.signalMatched({ ...s, dials: tgt }, now), `target is within tolerance, seed ${seed} step ${k}`);
      start.expect(!L.signalMatched(s, now), `start is off target, seed ${seed} step ${k}`);
      // what "tolerance" means: one amplitude step off still passes, frequency or phase must be exact
      const amp = tgt.slice();
      amp[1] += amp[1] > 0 ? -1 : 1;
      tol.expect(L.signalError(diff, amp, tgt) <= cfg.tol, `amplitude one step off passes, seed ${seed}`);
      const amp2 = tgt.slice();
      amp2[1] += amp2[1] > 1 ? -2 : 2;
      tol.expect(L.signalError(diff, amp2, tgt) > cfg.tol, `amplitude two steps off fails, seed ${seed}`);
      const fr = tgt.slice();
      fr[0] += fr[0] > 0 ? -1 : 1;
      tol.expect(L.signalError(diff, fr, tgt) > cfg.tol, `frequency one step off fails, seed ${seed}`);
      if (cfg.dials === 3) {
        const ph = tgt.slice();
        ph[2] = (ph[2] + 1) % steps[2];
        tol.expect(L.signalError(diff, ph, tgt) > cfg.tol, `phase one step off fails, seed ${seed}`);
      }
    }

    // tune with the plan, hold, win
    const now = T0 + 20;
    let cur = s;
    let locked = false;
    const moves = L.signalPlan(s, now);
    for (const m of moves) {
      const r = L.signalTurn(cur, m.dial, m.d, now);
      if (r.result === 'invalid') win.expect(false, `plan step refused, seed ${seed}`);
      if (r.result === 'lock') locked = true;
      cur = r.state;
    }
    win.expect(moves.length > 0 && locked && cur.lockSince === now && !cur.solved, `plan locks on, seed ${seed}`);
    win.expect(L.signalTick(cur, now + L.SIGNAL_HOLD_MS - 1).result === 'none', `no win before the hold time, seed ${seed}`);
    const done = L.signalTick(cur, now + L.SIGNAL_HOLD_MS);
    win.expect(done.result === 'solved' && done.state.solved, `win after the hold time, seed ${seed}`);
    win.expect(L.signalTurn(done.state, 0, 1, now).result === 'invalid' && L.signalTick(done.state, now + 9999).result === 'none', `nothing moves after the win, seed ${seed}`);
    // leaving the target breaks the lock
    const off = L.signalTurn(cur, 0, cur.dials[0] > 0 ? -1 : 1, now + 100);
    win.expect(off.result === 'unlock' && off.state.lockSince === null, `detuning breaks the lock, seed ${seed}`);
    win.expect(L.signalTick(off.state, now + 5000).result === 'none', `no win while off target, seed ${seed}`);

    if (cfg.driftMs) {
      // the target moves on: the lock breaks, and tuning again wins
      const later = T0 + cfg.driftMs + 30;
      const t1 = L.signalTick(cur, later);
      drift.expect(t1.result === 'unlock', `drift breaks the lock, seed ${seed}`);
      let c2 = t1.state;
      for (const m of L.signalPlan(c2, later)) c2 = L.signalTurn(c2, m.dial, m.d, later).state;
      drift.expect(c2.lockSince === later && L.signalTick(c2, later + L.SIGNAL_HOLD_MS).result === 'solved', `re-tuning wins, seed ${seed}`);
      drift.expect(cfg.driftMs >= L.SIGNAL_HOLD_MS * 3, 'drift leaves room for the hold');
    }
  }
  shape.report(`signal d${diff}: ${N} instances are well-formed and deterministic (${cfg.dials} dials, tolerance ${cfg.tol})`);
  solvable.report(`signal d${diff}: the stored target is on the dials and within tolerance`);
  start.report(`signal d${diff}: the starting wave is off target`);
  tol.report(`signal d${diff}: tolerance forgives one amplitude step, nothing else`);
  win.report(`signal d${diff}: plan locks, the hold time decides the win, detuning breaks the lock`);
  if (cfg.driftMs) drift.report(`signal d${diff}: drift breaks the lock and it can be won again`);
}
{
  const s = L.signalGenerate(11, 2, 0);
  const low = { ...s, dials: [0, 0, 0] };
  const high = { ...s, dials: [8, 8, 11] };
  check(
    'signal: frequency and amplitude stop at the ends, phase wraps, malformed turns are refused',
    L.signalTurn(low, 0, -1, 0).result === 'invalid' &&
      L.signalTurn(low, 1, -1, 0).result === 'invalid' &&
      L.signalTurn(high, 0, 1, 0).result === 'invalid' &&
      L.signalTurn(high, 1, 1, 0).result === 'invalid' &&
      L.signalTurn(low, 2, -1, 0).state.dials[2] === 11 &&
      L.signalTurn(high, 2, 1, 0).state.dials[2] === 0 &&
      L.signalTurn(s, 3, 1, 0).result === 'invalid' &&
      L.signalTurn(s, 0, 2, 0).result === 'invalid' &&
      L.signalTurn(s, '0', 1, 0).result === 'invalid' &&
      L.signalTurn(L.signalGenerate(11, 1, 0), 2, 1, 0).result === 'invalid',
  );
  const a = L.signalView(s, 'a', 0);
  const b = L.signalView(s, 'b', 0);
  check('signal: the tuner view has dials but no target', 'dials' in a && !('tgt' in a) && !('target' in a) && !('match' in a) && !('inTol' in a));
  check('signal: the scope has the target and the live wave', 'tgt' in b && 'cur' in b && !('dials' in b) && b.match >= 0 && b.match < 1 && b.inTol === false);
  const on = L.signalView({ ...s, dials: L.signalTargetAt(s, 0) }, 'b', 0);
  check('signal: the scope reads 100 % on target', on.match === 1 && on.inTol === true);
}

// --------------------------------------------------------------------------- CIPHER
for (const diff of [1, 2, 3]) {
  const cfg = L.CIPHER_CFG[diff];
  const shape = tally();
  const solvable = tally();
  const wrong = tally();
  const T0 = 9000;
  const enter = (s, digits) => {
    let cur = s;
    for (const d of digits) cur = L.cipherPress(cur, d).state;
    return L.cipherPress(cur, 'ok');
  };
  const wellFormed = (s) =>
    s.symbols.length === cfg.table &&
    new Set(s.symbols).size === cfg.table &&
    s.symbols.every((g) => Number.isInteger(g) && g >= 0 && g < L.GLYPH_COUNT) &&
    same([...s.map].sort((a, b) => a - b), Array.from({ length: cfg.table }, (_, i) => i + 1)) &&
    s.code.length === cfg.len &&
    new Set(s.code).size === cfg.len &&
    s.code.every((g) => s.symbols.includes(g));
  for (const seed of seeds) {
    const s = L.cipherGenerate(seed, diff, T0);
    shape.expect(wellFormed(s), `table and code, seed ${seed}`);
    shape.expect(same(s, L.cipherGenerate(seed, diff, T0)) && !s.solved && s.entered.length === 0, `deterministic, seed ${seed}`);

    // the stored code maps back: digit -> symbol through the table gives the code again
    const sol = L.cipherSolution(s);
    solvable.expect(sol.length === cfg.len && sol.every((d) => d >= 1 && d <= cfg.table), `solution digits, seed ${seed}`);
    solvable.expect(same(sol.map((d) => s.symbols[s.map.indexOf(d)]), s.code), `digits map back to the code, seed ${seed}`);
    const win = enter(s, sol);
    solvable.expect(win.result === 'solved' && win.state.solved, `entering the solution wins, seed ${seed}`);
    solvable.expect(L.cipherPress(win.state, 1).result === 'invalid', `no keys after the win, seed ${seed}`);
    let viaPlan = s;
    for (const m of L.cipherPlan(s)) viaPlan = L.cipherPress(viaPlan, m.k).state;
    solvable.expect(viaPlan.solved, `plan wins, seed ${seed}`);

    // a wrong entry: strike, same code, the table is dealt again and the old digits no longer work
    const bad = sol.slice();
    bad[0] = (bad[0] % cfg.table) + 1;
    const w1 = enter(s, bad);
    wrong.expect(w1.result === 'strike' && w1.state.strikes === 1 && w1.state.total === 1 && w1.state.entered.length === 0 && !w1.state.solved, `first strike, seed ${seed}`);
    wrong.expect(same(w1.state.code, s.code) && wellFormed(w1.state) && w1.state.gen === 0, `code survives the first strike, seed ${seed}`);
    wrong.expect(!same(L.cipherSolution(w1.state), sol), `old digits are void after a strike, seed ${seed}`);
    wrong.expect(enter(w1.state, L.cipherSolution(w1.state)).result === 'solved', `still solvable after a strike, seed ${seed}`);
    // three wrong entries: new code
    let cur = w1.state;
    let last = w1;
    for (let i = 0; i < 2; i++) {
      const sol2 = L.cipherSolution(cur);
      const b2 = sol2.slice();
      b2[cfg.len - 1] = (b2[cfg.len - 1] % cfg.table) + 1;
      last = enter(cur, b2);
      cur = last.state;
    }
    wrong.expect(last.result === 'reroll' && cur.gen === 1 && cur.strikes === 0 && cur.total === 3 && cur.entered.length === 0 && wellFormed(cur), `third strike makes a new code, seed ${seed}`);
    wrong.expect(!same(cur.code, s.code) || !same(cur.symbols, s.symbols), `the new code differs, seed ${seed}`);
    wrong.expect(enter(cur, L.cipherSolution(cur)).result === 'solved', `the new code is solvable, seed ${seed}`);
  }
  shape.report(`cipher d${diff}: ${N} instances are well-formed and deterministic (${cfg.len} symbols from ${cfg.table})`);
  solvable.report(`cipher d${diff}: the stored code maps back through the table and wins`);
  wrong.report(`cipher d${diff}: wrong entries strike and reshuffle, three make a new code, all stay solvable`);
}
{
  const s = L.cipherGenerate(5, 2, 0);
  const full = [1, 2, 3, 4].reduce((c, d) => L.cipherPress(c, d).state, s);
  check(
    'cipher: incomplete confirm, extra digits, digits off the table and empty delete are refused without a strike',
    L.cipherPress(s, 'ok').result === 'invalid' &&
      L.cipherPress(L.cipherPress(s, 1).state, 'ok').result === 'invalid' &&
      full.entered.length === 4 &&
      L.cipherPress(full, 5).result === 'invalid' &&
      L.cipherPress(s, 0).result === 'invalid' &&
      L.cipherPress(s, 10).result === 'invalid' &&
      L.cipherPress(s, '1').result === 'invalid' &&
      L.cipherPress(s, 1.5).result === 'invalid' &&
      L.cipherPress(s, 'back').result === 'invalid' &&
      L.cipherPress(s, undefined).result === 'invalid' &&
      L.cipherPress(full, 'back').state.entered.length === 3 &&
      L.cipherPress(L.cipherGenerate(5, 1, 0), 7).result === 'invalid',
  );
  const a = L.cipherView(s, 'a', 0);
  const b = L.cipherView(s, 'b', 0);
  check('cipher: the keypad view has the code but no table', 'code' in a && !('rows' in a) && !('map' in a) && !('symbols' in a));
  check('cipher: the key table has every symbol with its digit but no code', !('code' in b) && b.rows.length === 9 && b.rows.every((r, i) => r.g === s.symbols[i] && r.d === s.map[i]));
  const d3 = L.cipherGenerate(5, 3, 1000);
  const { on, off } = L.CIPHER_CFG[3].blink;
  const dark = L.cipherView(d3, 'b', 1000 + on + 10);
  check(
    'cipher d3: the key table blinks out and comes back, and is empty while dark',
    L.cipherVisible(d3, 1000) && L.cipherVisible(d3, 1000 + on - 1) && !L.cipherVisible(d3, 1000 + on + 10) && L.cipherVisible(d3, 1000 + on + off + 10) && dark.visible === false && dark.rows.length === 0 && dark.count === 9,
  );
  check('cipher d1/d2: the key table never blinks out', [1, 2].every((d) => [0, 3000, 5000, 9000, 60000].every((t) => L.cipherVisible(L.cipherGenerate(5, d, 0), t))));
}

// --------------------------------------------------------------------------- shared front door
{
  const now = 1000;
  const kinds = ['trace', 'signal', 'cipher'];
  const states = kinds.map((k, i) => L.hackGenerate(k, 99 + i, 1, now));
  check('hackGenerate makes the right game', states.every((s, i) => s.kind === kinds[i]));
  check(
    'hackApply refuses garbage for every game',
    states.every((s) => [null, undefined, 5, 'x', {}, { c: 'a', d: 1 }, { dial: 9, d: 1 }, { k: 'nope' }].every((m) => {
      const r = L.hackApply(s, m, now);
      return r.result === 'invalid' && r.state === s;
    })),
  );
  const done = states.map((s) => {
    let cur = s;
    for (const m of L.hackPlan(s, now)) cur = L.hackApply(cur, m, now).state;
    if (cur.kind === 'signal') cur = L.signalTick(cur, now + L.SIGNAL_HOLD_MS).state;
    return cur;
  });
  check('hackPlan + hackApply solve every game', done.every((s) => s.solved));
  check('no view ever carries the stored solution or the seed', states.every((s) => ['a', 'b'].every((side) => !/"(sol|seed|target|map)"/.test(JSON.stringify(L.hackView(s, side, now))))));
  // one deliberate wrong entry in the cipher, one tripped ICE cell in the trace
  const cs = states[2];
  const wrong = L.cipherSolution(cs);
  wrong[0] = (wrong[0] % L.CIPHER_CFG[1].table) + 1;
  const struck = L.cipherPress(wrong.reduce((c, d) => L.cipherPress(c, d).state, cs), 'ok');
  let tripped = null;
  for (let i = 0; i < 300 && !tripped; i++) {
    let cur = L.traceGenerate(L.mix(0xbad, i), 2);
    const r = L.rng(i);
    for (let k = 0; k < 200 && !tripped; k++) {
      const res = L.traceRotate(cur, Math.floor(r() * cur.n * cur.n), 1);
      cur = res.state;
      if (res.result === 'strike') tripped = cur;
    }
  }
  check(
    'hackStrikes counts wrong moves for the score (cipher: over all codes, signal: none)',
    states.every((s) => L.hackStrikes(s) === 0) && struck.result === 'strike' && L.hackStrikes(struck.state) === 1 && !!tripped && L.hackStrikes(tripped) === 1 && L.hackStrikes(done[1]) === 0,
  );
}

console.log(failed ? `\n${failed} check(s) FAILED, ${passed} passed` : `\nALL ${passed} CHECKS PASSED`);
process.exit(failed ? 1 : 0);
