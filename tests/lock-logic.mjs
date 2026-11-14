// Rules of the lock picking game, without a browser.
// Run: node tests/lock-logic.mjs
import * as L from '../src/game/mech/lock-logic.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const DT = 1 / 60;

/** A perfect bot: presses when the helper says so. Returns the final state. */
function runBot(s, { reaction = 0, maxSeconds = 300 } = {}) {
  let lagged = 0;
  while (s.status === 'run' && s.time < maxSeconds) {
    L.step(s, DT);
    if (L.botShouldPress(s, DT + reaction)) L.press(s);
    lagged++;
  }
  return s;
}

// ---- generator
const a = L.generate('door', 2, 1234, 60);
const b = L.generate('door', 2, 1234, 60);
check('same seed gives the same lock', JSON.stringify(a) === JSON.stringify(b));
check('another seed gives another lock', JSON.stringify(L.generate('door', 2, 1235).pins) !== JSON.stringify(a.pins));
check('pin counts: door 3/4/5, case 2/3/4', [1, 2, 3].every((d) => L.generate('door', d, 1).pins.length === d + 2 && L.generate('case', d, 1).pins.length === d + 1));
{
  let bad = 0;
  for (let seed = 0; seed < 300; seed++)
    for (const v of ['door', 'case'])
      for (const d of [1, 2, 3]) {
        const s = L.generate(v, d, seed);
        for (const p of s.pins) if (p.c - p.w / 2 < 0.05 || p.c + p.w / 2 > 0.95 || p.w <= 0 || p.speed <= 0) bad++;
        for (let i = 1; i < s.pins.length; i++) if (s.pins[i].speed <= s.pins[i - 1].speed) bad++;
      }
  check('zones stay inside the travel, each pin is faster than the last', bad === 0, `${bad} bad`);
}
check('harder levels: narrower zone, faster marker', L.generate('door', 3, 1).pins[0].w < L.generate('door', 1, 1).pins[0].w && L.generate('door', 3, 1).pins[0].speed > L.generate('door', 1, 1).pins[0].speed);
check('case is quicker than door', L.generate('case', 2, 1).pins[0].speed > L.generate('door', 2, 1).pins[0].speed);
check('toDiff / toVariant sanitise input', L.toDiff('3') === 3 && L.toDiff(undefined) === 2 && L.toDiff(0) === 1 && L.toVariant('case') === 'case' && L.toVariant('x') === 'door');

// ---- sweep
{
  const s = L.generate('door', 2, 5);
  let edges = 0;
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < 60 * 20; i++) {
    if (L.step(s, DT)) edges++;
    lo = Math.min(lo, s.pos);
    hi = Math.max(hi, s.pos);
  }
  check('marker bounces between 0 and 1', edges >= 8 && lo >= 0 && hi <= 1 && lo < 0.05 && hi > 0.95, `edges ${edges}`);
  const big = L.generate('door', 3, 5);
  L.step(big, 5);
  check('a huge time step keeps the marker in range', big.pos >= 0 && big.pos <= 1);
}

// ---- press and slips
{
  const s = L.generate('door', 2, 7);
  s.pos = s.pins[0].c;
  check('press in the zone sets the pin', L.press(s) === 'set' && s.set[0] && s.cur === 1 && s.slips === 0);
  check('right after a set, presses are ignored', L.press(s) === 'ignored' && s.slips === 0);
  L.step(s, 0.2);
  s.pos = Math.abs(s.pins[1].c - 0.9) > 0.3 ? 0.9 : 0.1;
  const r = L.press(s);
  check('press outside is a slip: noise +1, slips +1, pin stays down', r === 'slip' && s.slips === 1 && s.noise === 1 && !s.set[1] && s.cur === 1);
  check('after a slip, mashing is ignored (one slip only)', L.press(s) === 'ignored' && s.slips === 1);
}
{
  const s = L.generate('door', 3, 7);
  s.pos = s.pins[0].c;
  L.press(s);
  L.step(s, 0.3);
  s.pos = s.pins[1].c;
  L.press(s);
  L.step(s, 0.3);
  check('difficulty 3: two pins set', s.set[0] && s.set[1] && s.cur === 2);
  s.pos = s.pins[2].c > 0.5 ? 0.02 : 0.98;
  L.press(s);
  check('difficulty 3: a slip drops the previous pin too', !s.set[1] && s.set[0] && s.cur === 1 && s.slips === 1);
}
{
  const s = L.generate('door', 2, 7);
  s.pos = s.pins[0].c;
  L.press(s);
  L.step(s, 0.3);
  s.pos = s.pins[1].c > 0.5 ? 0.02 : 0.98;
  L.press(s);
  check('difficulty 2: a slip does not touch earlier pins', s.set[0] && s.cur === 1);
}
{
  const s = L.generate('door', 2, 9);
  let last = '';
  for (let i = 0; i < s.maxSlips; i++) {
    L.step(s, 1);
    s.pos = s.pins[s.cur].c > 0.5 ? 0 : 1;
    last = L.press(s);
  }
  check('too many slips break the pick', last === 'broke' && s.status === 'broke' && s.slips === s.maxSlips);
  check('a broken lock takes no more input', L.press(s) === 'ignored' && L.step(s, 1) === false);
}
{
  const s = L.generate('door', 2, 9, 5);
  for (let i = 0; i < 60 * 6 && s.status === 'run'; i++) L.step(s, DT);
  check('the time limit ends the attempt', s.status === 'timeout' && s.time === 5 && L.timeLeft(s) === 0);
  const free = L.generate('door', 2, 9, 0);
  for (let i = 0; i < 60 * 30; i++) L.step(free, DT);
  check('without a limit nothing times out', free.status === 'run' && L.timeLeft(free) === null);
}

// ---- bots
{
  let fails = 0;
  let worst = 0;
  const times = { 1: [], 2: [], 3: [] };
  for (const v of ['door', 'case'])
    for (const d of [1, 2, 3])
      for (let seed = 0; seed < 100; seed++) {
        const s = runBot(L.generate(v, d, seed));
        if (s.status !== 'open' || s.slips > 0) fails++;
        worst = Math.max(worst, s.time);
        if (v === 'door') times[d].push(s.time);
      }
  check('a perfect bot opens every lock without a slip', fails === 0, `${fails} failed, slowest ${worst.toFixed(1)} s`);
  const avg = (x) => x.reduce((p, c) => p + c, 0) / x.length;
}
{
  // a human model: aims at the centre with a timing error of ~90 ms (sigma), needs 0.6 s to look at the next pin
  const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
  const r = L.rng(2024);
  const stats = { 1: [], 2: [], 3: [] };
  let opened = 0;
  let n = 0;
  for (const d of [1, 2, 3])
    for (let seed = 0; seed < 150; seed++) {
      const s = L.generate('door', d, seed);
      let plan = -1;
      let look = 0.6;
      while (s.status === 'run' && s.time < 200) {
        L.step(s, DT);
        look -= DT;
        if (look > 0) continue;
        if (plan < 0 && s.lockout <= 0) plan = s.time + L.pressIn(s) + gauss(r) * 0.09;
        if (plan >= 0 && s.time >= plan) {
          const was = s.cur;
          L.press(s);
          plan = -1;
          look = 0.6;
          if (s.cur !== was) look = 0.6;
        }
      }
      n++;
      if (s.status === 'open') {
        opened++;
        stats[d].push(s.time);
      }
    }
  const avg = (x) => x.reduce((p, c) => p + c, 0) / x.length;
  check('a human model (90 ms timing error) usually opens', opened / n > 0.8, `${opened}/${n}`);
  check('a human model needs about 6 to 25 s on difficulty 2', avg(stats[2]) > 6 && avg(stats[2]) < 25, `d1 ${avg(stats[1]).toFixed(1)} s, d2 ${avg(stats[2]).toFixed(1)} s, d3 ${avg(stats[3]).toFixed(1)} s`);
}
{
  // a human who reacts 80 ms late and jitters still opens a difficulty 2 lock most of the time
  let ok = 0;
  const r = L.rng(42);
  for (let seed = 0; seed < 100; seed++) {
    const s = L.generate('door', 2, seed);
    while (s.status === 'run' && s.time < 120) {
      L.step(s, DT);
      if (L.botShouldPress(s, 0.01 + r() * 0.05)) L.press(s);
    }
    if (s.status === 'open') ok++;
  }
  check('a sloppy bot still opens difficulty 2 mostly', ok >= 90, `${ok}/100`);
}
{
  // random pressing mostly fails
  const r = L.rng(99);
  let opened = 0;
  const N = 200;
  for (let seed = 0; seed < N; seed++) {
    const s = L.generate('door', 2, seed);
    while (s.status === 'run' && s.time < 120) {
      L.step(s, DT);
      if (r() < 0.04) L.press(s);
    }
    if (s.status === 'open') opened++;
  }
  check('random pressing mostly fails', opened < N * 0.2, `${opened}/${N} opened`);
}
{
  // pressIn is a prediction: pressing at that moment hits
  let bad = 0;
  for (let seed = 0; seed < 200; seed++) {
    const s = L.generate('door', 3, seed);
    L.step(s, seed * 0.013);
    const t = L.pressIn(s);
    let left = t;
    while (left > 1e-9) {
      const d = Math.min(left, DT / 3);
      L.step(s, d);
      left -= d;
    }
    if (L.press(s) === 'slip') bad++;
  }
  check('pressIn predicts the moment the marker is on the centre', bad === 0, `${bad} off`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
