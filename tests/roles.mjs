// Role tools of the first-person job (src/game/job/roles.ts) on the real location (?level=varga), four players:
//   the lookout's map shows only on his page and its guard dot moves; his ping (1-6) appears as a marker and a line
//   on the inside players' pages and is rate-limited; the driver's clock shows only on his page and counts; his horn
//   (hold H) makes a guard suspicious once and is refused the second time; G works only for the Vorhut and triggers
//   a distraction (refused while the guard system cools down); keys are ignored while a pop-up or skill game is open;
//   solo on the test level works without panels; no page errors; both languages complete.
// Screenshots into test-out/roles/. Run: node tests/roles.mjs [crew|solo]
import fs from 'node:fs';
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import { until, pub, act, crewOf4, waitForJob, TEST_TIMES } from './plan-flow.mjs';

const DIR = `${OUT}/roles`;
fs.mkdirSync(DIR, { recursive: true });
const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const SEED = 6;
const TIMES = { ...TEST_TIMES, board: 30000, beat: 150, bot: 400, skill: 60000, gate: 60000 };
const POSTS = { brain: 'inside', bait: 'inside', gambler: 'lookout', hands: 'driver' };
const PREFER = ['pick', 'quiet', 'leave', 'stay', 'hide', 'slow', 'koeder'];
const SIZE = { width: 1440, height: 900 };

const rd = (page) => page.evaluate(() => window.__nvRoles.debug());
const dbg = (page) => page.evaluate(() => window.__nv.job.debugState());
const role = async (page) => {
  const p = await pub(page);
  const pid = await page.evaluate(() => window.__nv.session.pid);
  return p?.seats?.find((s) => s.pid === pid)?.role ?? null;
};
const tap = async (page, code, ms = 120) => {
  await page.evaluate((c) => window.__nv.input.debugSet(c, true), code);
  await sleep(ms);
  await page.evaluate((c) => window.__nv.input.debugSet(c, false), code);
  await sleep(120);
};
const shot = async (page, name) => {
  await page.evaluate(() => (window.__nvRenderSkip = 0));
  // the lineup's crew card and the one-time intro card cover the view in the first seconds of a run
  await until(() => page.evaluate(() => document.querySelector('.lineup')?.classList.contains('hidden') ?? true), 15000, 200);
  await page.keyboard.press('Shift');
  await sleep(900);
  await page.screenshot({ path: `${DIR}/${name}.png` });
  console.log('      shot', name);
};

async function drive(page, me, o = {}) {
  const { hold = false } = o;
  const p = await pub(page);
  if (!p || !p.phase) return p;
  const pv = await page.evaluate(() => { const r = window.__nv.plan.view.received; return r.length ? r[r.length - 1] : null; });
  const brain = me === 'brain';
  const A = (a) => act(page, a);
  switch (p.phase) {
    case 'stake': if (me === 'gambler') await A({ t: 'confirm' }); break;
    case 'brief': case 'facts': if (brain) await A({ t: 'confirm' }); break;
    case 'scout':
      if (brain) {
        if (p.board.scout.length === 3) await A({ t: 'confirm' });
        else for (const id of ['parkhaus', 'hausmeister', 'elektriker']) if (!p.board.scout.includes(id)) await A({ t: 'scout', id });
      }
      break;
    case 'shop':
      if (brain) {
        for (const id of ['decoder', 'stoer', 'bohrer']) if (!p.board.tools.includes(id)) await A({ t: 'tool', id });
        await A({ t: 'confirm' });
      }
      break;
    case 'plan':
      if (me && p.plan.posts[me] !== POSTS[me]) await A({ t: 'post', role: me, post: POSTS[me] });
      if (brain) {
        for (const s of p.seats) if (s.bot && p.plan.posts[s.role] !== POSTS[s.role]) await A({ t: 'post', role: s.role, post: POSTS[s.role] });
        if (p.plan.entrance !== 'liefer') await A({ t: 'ent', id: 'liefer' });
        else if (p.plan.targets[0] !== 'tresor') { if (!p.plan.targets.includes('tresor')) await A({ t: 'tgt', id: 'tresor' }); }
        else if (Object.entries(POSTS).every(([r, x]) => p.plan.posts[r] === x)) await A({ t: 'confirm' });
      }
      break;
    case 'offer': if (pv?.offer && !pv.offer.answered) await A({ t: 'offer', answer: 'decline' }); break;
    case 'accuse': if (pv?.accuse && !pv.accuse.choice) await A({ t: 'accuse', target: 'pass' }); break;
    case 'run': {
      const d = p.run.decision;
      if (d && d.who === me && !d.bot) {
        const opt = d.options.find((x) => PREFER.includes(x.id)) ?? d.options[0];
        await A({ t: 'choose', id: opt.id });
        break;
      }
      const st = await dbg(page);
      if (!hold && st.at) {
        const far = await page.evaluate((a) => Math.hypot(window.__nv.player.position.x - a.x, window.__nv.player.position.z - a.z) > 1.0, st.at);
        if (far) await page.evaluate((a) => window.__nv.tp(a.x, a.y + 0.03, a.z + 0.3, a.yaw ?? 0), st.at);
      }
      if (!hold && st.game) await page.evaluate((id) => window.__nv.level.games[id].debugFinish(true), st.game);
      else if (!hold && st.skill && !st.game) await tap(page, 'KeyE');
      break;
    }
  }
  return p;
}

const env = await startServers({ port: 5591, sigPort: 9591 });
try {
  // ================================================================ four players
  if (want('crew')) {
    const opt = { ...SIZE, quality: 'low', renderSkip: 30, lineupFast: true, extra: '&level=varga', times: TIMES };
    const pages = await crewOf4(env, opt, ['Mert', 'Erdem', 'Marc', 'Fabian'], [{}, { lang: 'de' }, {}, { lang: 'de' }]);
    const [host] = pages;
    await host.evaluate((s) => (window.__nvPlanSeed = s), SEED);
    await host.evaluate(() => window.__nv.plan.start());
    check('job starts after the lineup', !!(await waitForJob(host)));
    const roleOf = new Map();
    for (const p of pages) roleOf.set(p, await role(p));
    const by = Object.fromEntries([...roleOf.entries()].map(([p, r]) => [r, p]));
    const nameOf = async (page) => page.evaluate(() => window.__nv.session.me.name);
    const run = await until(async () => {
      for (const p of pages) await drive(p, roleOf.get(p), { hold: true });
      return (await pub(host))?.phase === 'run';
    }, 200000, 300);
    check('the job reaches the run', !!run);
    await sleep(1500);
    const L = by.gambler, D = by.hands, B = by.bait, W = by.brain;
    const [rl, rd2, rb, rw] = await Promise.all([L, D, B, W].map(rd));
    check('map only on the lookout page', rl.map && !rd2.map && !rb.map && !rw.map, JSON.stringify([rl.map, rd2.map, rb.map, rw.map]));
    check('clock only on the driver page', rd2.clock && !rl.clock && !rb.clock && !rw.clock, JSON.stringify([rd2.clock, rl.clock, rb.clock, rw.clock]));
    check('the map shows the two inside crew members', rl.crewOnMap.length === 2, JSON.stringify(rl.crewOnMap));
    const g0 = (await rd(L)).guardsOnMap;
    await sleep(2500);
    const g1 = (await rd(L)).guardsOnMap;
    check('the guard dot is on the map and moves', g0.length >= 1 && g1.length >= 1 && g0[0] !== g1[0], JSON.stringify([g0, g1]));
    check('the Vorhut has the coin hint, nobody else', (await rd(B)).lines.some((l) => /G:/.test(l)) && !(await rd(W)).lines.some((l) => /G:/.test(l)));

    // ---------------------------------------------------------------- ping
    await L.evaluate(() => window.__nv.tp(-1.5, 0.14, 14.2, -0.39, 0));
    await tap(L, 'Digit4');
    await tap(L, 'Digit5'); // within 2 s: ignored
    const seen = await until(async () => { const r = await rd(W); return r.markers.includes('saal') ? r : false; }, 5000, 100);
    const lname = await nameOf(L);
    check('the ping shows as a marker on an inside page', !!seen, JSON.stringify(seen && seen.markers));
    check('…and as a line with the lookout\'s name', !!seen && seen.lines.some((l) => l.includes(lname) && /Saal|hall/.test(l)), JSON.stringify(seen && seen.lines));
    const rb2 = await rd(B);
    check('the second Vorhut page sees it too', rb2.markers.includes('saal'), JSON.stringify(rb2.markers));
    check('the driver sees no world marker', (await rd(D)).markers.length === 0);
    check('the lookout\'s map lights the room', (await rd(L)).roomsLit.includes('saal'));
    // inside view of the warning: stand in the storage room, look west to the hall
    await W.evaluate(() => window.__nv.tp(-5.5, 0.3, -2.2, Math.PI / 2, 0.02));
    await shot(W, 'ping-seen-from-inside');
    await shot(L, 'lookout-map');
    check('one ping only (client rate limit)', (await rd(W)).pingsSeen === 1, String((await rd(W)).pingsSeen));
    await sleep(2200);
    await L.evaluate(() => { window.__nv.session.intent('jr.ping', { room: 0 }); window.__nv.session.intent('jr.ping', { room: 1 }); });
    await sleep(800);
    check('two intents in a row: the host lets one through', (await rd(W)).pingsSeen === 2, String((await rd(W)).pingsSeen));
    await W.evaluate(() => window.__nv.session.intent('jr.ping', { room: 2 }));
    await sleep(800);
    check('an inside player cannot ping', (await rd(W)).pingsSeen === 2);
    // pop-up open for the lookout: number keys are the pop-up's
    await sleep(2200);
    await L.evaluate(() => { const u = window.__nv.job.ui; u.__po = u.popupOpen; u.popupOpen = () => true; });
    await sleep(200);
    const sent0 = (await rd(L)).pingsSent;
    await tap(L, 'Digit2');
    check('number keys are ignored while a pop-up is open', (await rd(L)).pingsSent === sent0 && (await rd(L)).busy);
    await L.evaluate(() => { const u = window.__nv.job.ui; u.popupOpen = u.__po; delete u.__po; });

    // ---------------------------------------------------------------- driver clock + horn
    await shot(D, 'driver-clock');
    await host.evaluate(() => { window.__gdEv = []; window.__nv.level.stage.guards?.onEvent((e) => window.__gdEv.push(e.type)); });
    // skill game open (player frozen): H does nothing
    await D.evaluate(() => (window.__nv.player.frozen = true));
    await tap(D, 'KeyH', 1800);
    await D.evaluate(() => (window.__nv.player.frozen = false));
    check('H is ignored while a skill game is open', !(await rd(D)).honkDone);
    await tap(D, 'KeyH', 600);
    check('a short tap on H does not honk', !(await rd(D)).honkDone);
    await tap(D, 'KeyH', 1800);
    const honk = await until(async () => { const r = await rd(W); return r.honks === 1 ? r : false; }, 5000, 100);
    const dname = await nameOf(D);
    check('the horn reaches everyone with a line', !!honk && honk.lines.some((l) => l.includes(dname)), JSON.stringify(honk && honk.lines.slice(-2)));
    const sus = await until(() => host.evaluate(() => window.__gdEv.includes('suspicious') || (window.__nv.level.stage.guards?.positions() ?? []).some((g) => g.state === 1)), 4000, 100);
    check('the horn makes a guard suspicious', !!sus);
    await tap(D, 'KeyH', 1800);
    await D.evaluate(() => window.__nv.session.intent('jr.honk', {}));
    await sleep(800);
    check('the second horn is refused', (await rd(W)).honks === 1 && (await rd(D)).honks === 1);

    // ---------------------------------------------------------------- coin
    // the horn used the guard's distraction: a coin now is refused, nothing is thrown
    await B.evaluate(() => window.__nv.tp(3.2, 0.14, 0.5, 0, -0.45));
    await W.evaluate(() => window.__nv.tp(3.2, 0.14, 2.5, 0, -0.45));
    await tap(B, 'KeyG');
    await sleep(800);
    check('G during the guard\'s cooldown: nothing is thrown', (await rd(B)).coins === 0 && (await rd(B)).coinsSent === 1, JSON.stringify(await rd(B)));
    await tap(W, 'KeyG');
    await sleep(500);
    check('G does nothing for the Wortführer (the Vorhut is human)', (await rd(W)).coinsSent === 0);
    const cd = await host.evaluate(() => window.__nv.level.stage.guards.debugState().cooldown);
    await sleep(cd * 1000 + 300);
    // frozen (skill game): G ignored
    await B.evaluate(() => (window.__nv.player.frozen = true));
    await tap(B, 'KeyG');
    await B.evaluate(() => (window.__nv.player.frozen = false));
    check('G is ignored while a skill game is open', (await rd(B)).coinsSent === 1);
    await host.evaluate(() => (window.__gdEv = []));
    await sleep(700);
    await tap(B, 'KeyG');
    const coin = await until(async () => { const r = await rd(W); return r.coins === 1 ? r : false; }, 5000, 100);
    check('G throws a coin that everyone sees', !!coin);
    const cd2 = await host.evaluate(() => window.__nv.level.stage.guards.debugState().cooldown);
    check('…and the guard system took it as a distraction', cd2 > 1, String(cd2));
    await sleep(300);
    const rb3 = await rd(B);
    check('the Vorhut sees the cooldown ring', rb3.ring && rb3.coinCooldown > 1, JSON.stringify({ ring: rb3.ring, cd: rb3.coinCooldown }));
    await shot(B, 'vorhut-coin');

    // ---------------------------------------------------------------- the clock counts
    const m0 = (await rd(D)).minute;
    const moved = await until(async () => {
      for (const p of pages) await drive(p, roleOf.get(p));
      const m = (await rd(D)).minute;
      return m !== m0 ? m : false;
    }, 120000, 300);
    check('the driver\'s clock counts', !!moved, `${m0} -> ${moved}`);
    check('the big number is the round', /^\d+$/.test((await rd(D)).bigNumber ?? ''));

    const errs = pages.flatMap((p) => p.errors);
    check('4p: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    for (const p of [host, pages[1]]) {
      const miss = await p.evaluate(() => window.__nv.missingTranslations().filter((k) => /^jr\./.test(k)));
      check('every jr. text exists in English and German', miss.length === 0, miss.join(','));
    }
    for (const p of pages) await p.context().close();
  }

  // ================================================================ solo on the test level
  if (want('solo')) {
    const page = await openPlayer(env, { width: 960, height: 600, name: 'Mert', quality: 'low', lang: 'de', renderSkip: 20, extra: '&level=job' });
    await page.evaluate(([t, s]) => { window.__nvPlanTimes = t; window.__nvPlanSeed = s; }, [{ ...TIMES, gate: 3000 }, SEED]);
    await page.evaluate(() => window.__nv.start(null));
    await until(() => page.evaluate(() => !!window.__nv.player), 150000);
    await page.evaluate(() => window.__nv.plan.start());
    const run = await until(async () => { const p = await drive(page, 'brain', { hold: true }); return p?.phase === 'run' ? p : false; }, 150000, 300);
    check('solo: the job reaches the run', !!run);
    await sleep(1000);
    const r = await rd(page);
    check('solo: no map, no clock', !r.map && !r.clock);
    check('solo: the coin is there (no human Vorhut)', r.canThrow);
    await tap(page, 'KeyG');
    await sleep(500);
    check('solo: without a guard system G throws nothing, quietly', (await rd(page)).coins === 0);
    const end = await until(async () => { const p = await drive(page, 'brain'); return p?.phase === 'debrief' ? p : false; }, 200000, 300);
    check('solo: the job runs to the debrief', !!end);
    check('solo: panels gone after the job', !(await rd(page)).map && !(await rd(page)).clock);
    check('solo: no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
