// Sound of the first-person job (src/game/job/sound.ts) on the test stage (?level=job).
// Synthetic plan states go through the module's real code path (debug.feedPlan, debug.guardEvent) so each
// stinger can be checked for "exactly once per event"; one real solo job checks the counts against the
// lines of the run and that the number of live audio nodes does not grow. Listening is for a human.
// Run: node tests/job-sound.mjs
import { startServers, openPlayer, sleep } from './harness.mjs';
import { until, pub, act, waitForJob, TEST_TIMES } from './plan-flow.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const SEED = 6;
const TIMES = { ...TEST_TIMES, board: 30000, beat: 150, bot: 400, skill: 60000, gate: 12000 };
const POSTS = { brain: 'inside', hands: 'inside', gambler: 'lookout', bait: 'driver' };

// count every oscillator / buffer source the page creates and how many of them ended
const COUNT_NODES = () => {
  const w = window;
  w.__nodes = { made: 0, ended: 0 };
  const P = (window.BaseAudioContext || window.AudioContext).prototype;
  for (const fn of ['createOscillator', 'createBufferSource']) {
    const orig = P[fn];
    P[fn] = function (...a) {
      const n = orig.apply(this, a);
      w.__nodes.made++;
      n.addEventListener('ended', () => w.__nodes.ended++);
      return n;
    };
  }
};
const snd = (page, fn, arg) => page.evaluate(([f, a]) => new Function('s', 'a', 'return (' + f + ')(s, a)')(window.__nv.level.sound.debug, a), [fn.toString(), arg]);
const counts = (page) => snd(page, (d) => d.counts());
const live = (page) => page.evaluate(() => window.__nodes.made - window.__nodes.ended);

const env = await startServers({ port: 5601, sigPort: 9601 });
const opt = { width: 960, height: 600, quality: 'low', renderSkip: 30, lineupFast: true, extra: '&level=job', times: TIMES };
try {
  const page = await openPlayer(env, { ...opt, name: 'Mert' });
  await page.evaluate(COUNT_NODES);
  // ---------------------------------------------------------------- before a session
  const pre = await snd(page, (d) => ({ attached: d.attached(), built: d.built(), c: d.counts(), bed: d.bed() }));
  check('nothing plays before a session', !pre.attached && !pre.built && Object.keys(pre.c).length === 0 && pre.bed === 'none', JSON.stringify(pre));
  await page.evaluate(() => window.__nv.start(null));
  await until(() => page.evaluate(() => !!window.__nv.player), 150000);
  await sleep(1500);
  const ready = await page.evaluate(() => ({ r: window.__nv.engine && true, st: [...document.querySelectorAll('x')].length }));
  void ready;
  const st0 = await snd(page, (d) => ({ attached: d.attached(), built: d.built(), bed: d.bed() }));
  check('session: ambience built and the outside bed is on at the spawn', st0.attached && st0.built && st0.bed === 'out', JSON.stringify(st0));
  // ---------------------------------------------------------------- beds follow the listener
  await page.evaluate(() => window.__nv.tp(0, 0.02, -5));
  await sleep(500);
  check('ambience: teleported inside -> inside bed', (await snd(page, (d) => d.bed())) === 'in');
  await page.evaluate(() => window.__nv.tp(0, 0.02, 15));
  await sleep(500);
  check('ambience: back outside -> outside bed', (await snd(page, (d) => d.bed())) === 'out');
  // ---------------------------------------------------------------- no run: stingers stay silent
  await snd(page, (d) => { d.reset(); d.guardEvent({ type: 'suspicious' }); d.guardEvent({ type: 'alert' }); });
  await sleep(200);
  const c0 = await counts(page);
  check('outside a run: guard events make no sound', !c0.suspicious && !c0.alert, JSON.stringify(c0));

  // ---------------------------------------------------------------- synthetic run, event by event
  const me = await page.evaluate(() => window.__nv.session.pid);
  const T = (k) => ({ k });
  const beat = (k, lines = []) => ({ title: T(k), target: null, t0: 0, lines });
  const L = (kind, k, extra = {}) => ({ kind, x: T(k), ...extra });
  const base = { phase: 'run', job: 11, seats: [{ role: 'brain', pid: me, bot: false }], deadline: 0, result: null };
  let ver = 100;
  const feed = (run, extra = {}) => page.evaluate(([p]) => window.__nv.level.sound.debug.feedPlan(p), [{ ...base, v: ++ver, ...extra, run: { beats: [], shown: 1, alarmKnown: false, decision: null, skill: null, ...run } }]);
  const delta = async (fn) => {
    const a = await counts(page);
    await fn();
    await sleep(120);
    const b = await counts(page);
    const d = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((b[k] || 0) !== (a[k] || 0)) d[k] = (b[k] || 0) - (a[k] || 0);
    return d;
  };
  const only = (d, k) => Object.keys(d).length === 1 && d[k] === 1;
  const b0 = [beat('bt.approach', [L('info', 'ln.x')])];
  await snd(page, (d) => d.reset());
  let d = await delta(() => feed({ beats: b0 }));
  check('run start: one breath of silence, then one low note (once)', only(d, 'runStart'), JSON.stringify(d));
  d = await delta(() => feed({ beats: b0 }, { v: 5000 }));
  check('same state again: nothing plays twice', Object.keys(d).length === 0, JSON.stringify(d));
  // inside + guard suspicious: for me (louder) and a second event after the dedupe window
  await page.evaluate(() => window.__nv.tp(0, 0.02, -5));
  await sleep(400);
  d = await delta(() => snd(page, (x, pid) => x.guardEvent({ type: 'suspicious', pid }), me));
  check('guard suspicious (inside, noticed me): warning once', only(d, 'suspicious'), JSON.stringify(d));
  await page.evaluate(() => window.__nv.tp(0, 0.02, 15));
  await sleep(2800);
  d = await delta(() => snd(page, (x) => x.guardEvent({ type: 'suspicious' })));
  check('guard suspicious while I am outside: silent', Object.keys(d).length === 0, JSON.stringify(d));
  d = await delta(() => snd(page, (x) => x.guardEvent({ type: 'alert' })));
  check('guard alert: one hard hit', only(d, 'alert'), JSON.stringify(d));
  // skills
  let b = [...b0, beat('bt.in')];
  d = await delta(async () => {
    await feed({ beats: b, skill: { who: 'brain', game: 'safe', at: 'safe' } });
    b = [...b0, beat('bt.in', [L('good', 'ln.skillOk')])];
    await feed({ beats: b });
  });
  check('safe task succeeds: heavy bolt once (no extra tick)', only(d, 'skillSafe'), JSON.stringify(d));
  d = await delta(async () => {
    await feed({ beats: b, skill: { who: 'brain', game: 'lock', at: 'door' } });
    b = [...b0, beat('bt.in', [L('good', 'ln.skillOk')]), beat('bt.x', [L('good', 'ln.skillOk')])];
    await feed({ beats: b });
  });
  check('lock task succeeds: clean clunk once', only(d, 'skillLock'), JSON.stringify(d));
  d = await delta(async () => {
    await feed({ beats: b, skill: { who: 'brain', game: 'lock', at: 'door' } });
    b = [...b, beat('bt.y', [L('warn', 'ln.skillNo')])];
    await feed({ beats: b });
  });
  check('task fails: dull snap once', only(d, 'taskFail'), JSON.stringify(d));
  d = await delta(async () => {
    await feed({ beats: b, skill: { who: 'brain', game: 'safe', at: 'safe' } });
    await feed({ beats: b });
    b = [...b, beat('bt.z', [{ kind: 'info', roll: { r: 10, p: 50, ok: true, label: T('rl.noFumble') } }])];
    await feed({ beats: b });
  });
  check('task falls back to the dice: dull snap once', only(d, 'taskDice'), JSON.stringify(d));
  // lines
  d = await delta(() => feed({ beats: [...b, beat('bt.q', [L('bad', 'ln.caught')])] }));
  check('bad job line: soft thud once', only(d, 'badLine'), JSON.stringify(d));
  b = [...b, beat('bt.q', [L('bad', 'ln.caught')])];
  d = await delta(() => feed({ beats: [...b, beat('bt.r', [L('good', 'ln.loot')])] }));
  check('good job line: soft tick once', only(d, 'goodLine'), JSON.stringify(d));
  b = [...b, beat('bt.r', [L('good', 'ln.loot')])];
  d = await delta(() => feed({ beats: [...b, beat('bt.s', [L('good', 'ln.loot'), L('bad', 'ln.caught'), L('bad', 'ln.alarm')])] }));
  check('several lines at once: one sound only (bad wins)', only(d, 'badLine'), JSON.stringify(d));
  b = [...b, beat('bt.s', [L('good', 'ln.loot'), L('bad', 'ln.caught'), L('bad', 'ln.alarm')])];
  // decision for me
  const dec = { who: 'brain', bot: false, options: [] };
  const hostNow = () => page.evaluate(() => window.__nv.session.hostNow());
  d = await delta(() => feed({ beats: b, decision: dec, shown: 7 }, { deadline: 4e12 }));
  check('decision pop-up opens for me: attention tone once', only(d, 'decision'), JSON.stringify(d));
  d = await delta(() => feed({ beats: b, decision: dec, shown: 7 }, { deadline: 4e12 }));
  check('same decision again: no second tone', Object.keys(d).length === 0, JSON.stringify(d));
  d = await delta(() => feed({ beats: b, decision: { ...dec, who: 'gambler' }, shown: 8 }));
  check('decision of somebody else: silent', Object.keys(d).length === 0, JSON.stringify(d));
  const dl = (await hostNow()) + 5600;
  const t0 = await counts(page);
  await feed({ beats: b, decision: dec, shown: 9 }, { deadline: dl });
  await sleep(6500);
  const t1 = await counts(page);
  check('decision: five quiet ticks in the last five seconds', (t1.decisionTick || 0) - (t0.decisionTick || 0) === 5 && t1.decision - t0.decision === 1, JSON.stringify({ ticks: (t1.decisionTick || 0) - (t0.decisionTick || 0), tone: t1.decision - t0.decision }));
  await feed({ beats: b, decision: null, shown: 10 });
  // alarm
  await sleep(3200);
  d = await delta(() => feed({ beats: b, alarmKnown: true }));
  const loopOn = await snd(page, (x) => x.alarmLoop());
  check('alarm known: hard hit once and the loop starts', only(d, 'alert') && loopOn, JSON.stringify({ d, loopOn }));
  d = await delta(() => feed({ beats: b, alarmKnown: true }));
  check('alarm still known: no second hit', Object.keys(d).length === 0, JSON.stringify(d));
  await feed({ beats: b, alarmKnown: false });
  await sleep(300);
  check('alarm over: the loop stops', !(await snd(page, (x) => x.alarmLoop())));
  // getaway
  b = [...b, beat('bt.getaway')];
  d = await delta(() => feed({ beats: b }));
  check('getaway: engine start once', only(d, 'getaway'), JSON.stringify(d));
  d = await delta(() => feed({ beats: b }));
  check('getaway again: nothing', Object.keys(d).length === 0);
  // endings
  d = await delta(() => feed({ beats: b }, { phase: 'debrief', result: { success: true } }));
  check('job ends well: its cadence once', only(d, 'endGood'), JSON.stringify(d));
  d = await delta(() => feed({ beats: b }, { phase: 'debrief', result: { success: true } }));
  check('debrief state again: nothing', Object.keys(d).length === 0);
  base.job = 12;
  await feed({ beats: [] });
  d = await delta(() => feed({ beats: [beat('bt.approach')] }, { phase: 'debrief', result: { success: false } }));
  check('job ends badly: the other cadence once', only(d, 'endBad'), JSON.stringify(d));
  // late joiner: lines already there stay silent
  base.job = 13;
  d = await delta(() => feed({ beats: [beat('bt.a', [L('bad', 'ln.x')]), beat('bt.b', [L('good', 'ln.y')]), beat('bt.c')], alarmKnown: false }));
  check('joining a run in progress: old lines are silent', Object.keys(d).length === 0, JSON.stringify(d));
  // ---------------------------------------------------------------- detach
  await feed({ beats: b, alarmKnown: true });
  const before = await counts(page);
  await snd(page, (x) => x.guardEvent({ type: 'alert' }));
  await page.evaluate(() => window.__nv.level.sound.detach());
  await sleep(1800);
  const dt = await snd(page, (x) => ({ attached: x.attached(), built: x.built(), loop: x.alarmLoop(), bed: x.bed() }));
  await snd(page, (x) => x.guardEvent({ type: 'alert' }));
  await sleep(200);
  const after = await counts(page);
  check('detach: beds, alarm loop and graph are gone, nothing plays any more', !dt.attached && !dt.built && !dt.loop && dt.bed === 'none' && JSON.stringify(before) === JSON.stringify(after), JSON.stringify(dt));
  const liveDetached = await live(page);
  console.log('INFO  live oscillators/buffer sources after detach:', liveDetached);
  await page.evaluate(() => window.__nv.level.sound.attach(window.__nv.session));
  await sleep(600);
  check('attach again: the graph is rebuilt', (await snd(page, (x) => x.built())) && (await snd(page, (x) => x.bed())) === 'out');
  check('synthetic part: no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.context().close();

  // ================================================================ one real solo job
  {
    const p2 = await openPlayer(env, { ...opt, name: 'Mert' });
    await p2.evaluate(COUNT_NODES);
    await p2.evaluate(([t, s]) => { window.__nvPlanTimes = t; window.__nvPlanSeed = s; }, [TIMES, SEED]);
    await p2.evaluate(() => window.__nv.start(null));
    await until(() => p2.evaluate(() => !!window.__nv.player), 150000);
    await p2.evaluate(() => window.__nv.plan.start());
    const A = (a) => act(p2, a);
    let liveA = null, madeA = 0, alertSent = false, skills = 0, okSkills = 0, runSeen = false;
    const end = await until(async () => {
      const p = await pub(p2);
      if (!p || !p.phase) return false;
      const pv = await p2.evaluate(() => { const r = window.__nv.plan.view.received; return r.length ? r[r.length - 1] : null; });
      switch (p.phase) {
        case 'stake': await A({ t: 'confirm' }); break;
        case 'brief': case 'facts': await A({ t: 'confirm' }); break;
        case 'scout':
          if (p.board.scout.length === 3) await A({ t: 'confirm' });
          else for (const id of ['parkhaus', 'hausmeister', 'elektriker']) if (!p.board.scout.includes(id)) await A({ t: 'scout', id });
          break;
        case 'shop':
          for (const id of ['decoder', 'stoer', 'bohrer']) if (!p.board.tools.includes(id)) await A({ t: 'tool', id });
          if (['decoder', 'stoer', 'bohrer'].every((x) => p.board.tools.includes(x))) await A({ t: 'confirm' });
          break;
        case 'plan':
          for (const s of p.seats) if (p.plan.posts[s.role] !== POSTS[s.role]) await A({ t: 'post', role: s.role, post: POSTS[s.role] });
          if (p.plan.targets[0] !== 'tresor') { if (!p.plan.targets.includes('tresor')) await A({ t: 'tgt', id: 'tresor' }); }
          else if (Object.entries(POSTS).every(([r, x]) => p.plan.posts[r] === x)) await A({ t: 'confirm' });
          break;
        case 'offer':
          if (pv?.offer && !pv.offer.answered) {
            if (!p.mid) await A({ t: 'offer', answer: 'decline' });
            else { await p2.keyboard.press('Digit2'); await sleep(150); }
          }
          break;
        case 'accuse': if (pv?.accuse && !pv.accuse.choice) await A({ t: 'accuse', target: 'pass' }); break;
        case 'run': {
          const st = await p2.evaluate(() => window.__nv.job.debugState());
          if (!runSeen) { runSeen = true; await sleep(3500); liveA = await live(p2); madeA = await p2.evaluate(() => window.__nodes.made); }
          const d = p.run.decision;
          if (d && !d.bot && st.popup === 'decision') { await sleep(300); await p2.keyboard.press('Digit1'); await sleep(150); break; }
          if (st.at) await p2.evaluate((a) => window.__nv.tp(a.x, a.y + 0.02, a.z + 0.3), st.at);
          if (st.prompt && !st.game) { await p2.keyboard.press('KeyE'); await sleep(150); }
          else if (st.game) {
            skills++;
            const ok = skills !== 1; // first check fails by hand, the rest succeed
            if (ok) okSkills++;
            await p2.evaluate(([id, o]) => window.__nv.level.games[id].debugFinish(o), [st.game, ok]);
          }
          if (!alertSent && p.run.beats.length >= 3) { alertSent = true; await p2.evaluate(() => window.__nv.level.guards.fire()); }
          break;
        }
      }
      return p.phase === 'debrief' ? p : false;
    }, 300000, 300);
    check('real job: reaches the debrief', !!end);
    await sleep(4500);
    const c = await p2.evaluate(() => window.__nv.level.sound.debug.counts());
    const lines = await p2.evaluate(() => window.__nv.plan.controller.debugMachine.S.run.beats.flatMap((b) => b.lines.map((l) => ({ k: l.x?.k ?? l.roll?.label?.k, kind: l.kind, roll: !!l.roll }))));
    const nOk = lines.filter((l) => l.k === 'ln.skillOk').length;
    const nNo = lines.filter((l) => l.k === 'ln.skillNo').length;
    console.log('INFO  counts', JSON.stringify(c));
    console.log('INFO  skill lines ok/no', nOk, nNo, ' played ok/fail', okSkills, skills - okSkills);
    check('real job: run start, one end cadence, getaway once', c.runStart === 1 && (c.endGood || 0) + (c.endBad || 0) === 1 && c.getaway === 1, JSON.stringify({ rs: c.runStart, g: c.getaway, eg: c.endGood, eb: c.endBad }));
    check('real job: skill sounds match the skill lines exactly (ok -> clunk/bolt, miss -> snap)', (c.skillLock || 0) + (c.skillSafe || 0) === nOk && (c.taskFail || 0) === nNo, JSON.stringify({ c, nOk, nNo }));
    check('real job: a decision tone for every decision of mine, ticks at most 5 per decision', (c.decision || 0) > 0 && (c.decisionTick || 0) <= 5 * (c.decision || 0), JSON.stringify({ d: c.decision, t: c.decisionTick }));
    check('real job: alarm loop is off at the end (the test guard has no events; the alarm hit is covered above)', !(await p2.evaluate(() => window.__nv.level.sound.debug.alarmLoop())));
    const liveB = await live(p2);
    const madeB = await p2.evaluate(() => window.__nodes.made);
    console.log('INFO  nodes made during the job:', madeB - madeA, ' live at run start:', liveA, ' live at the end:', liveB);
    check('real job: live audio nodes do not grow (end <= start + 6)', liveA !== null && liveB <= liveA + 6, `${liveA} -> ${liveB}`);
    check('real job: no page errors', p2.errors.length === 0, p2.errors.slice(0, 3).join(' | '));
    await p2.context().close();
  }
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
