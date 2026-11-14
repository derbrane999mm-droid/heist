// Getting back into a running evening: a guest reloads or drops during every part of a job, a new player joins
// a running job, the host reloads. Run: node tests/rejoin.mjs
// "Reload" = page.reload() in the SAME browser context (same localStorage = same player id, same sessionStorage
// = the crew code the game keeps for the automatic rejoin).
import { startServers, openPlayer, sleep } from './harness.mjs';
import { until, pub, act, priv, crewOf4, waitForJob, pagesByRole, phaseIs } from './plan-flow.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const PORT = Number(process.env.NV_REJOIN_PORT) || 5621;
const env = await startServers({ port: PORT, sigPort: PORT + 4000 });
const opt = { width: 1280, height: 720, quality: 'low', renderSkip: 30, lineupFast: true, lang: 'de' };
const T1 = { stake: 120000, brief: 120000, board: 120000, facts: 120000, offer: 120000, decide: 40000, accuse: 90000, beat: 150, bot: 400 };
const FAST = { stake: 3000, brief: 3000, board: 4000, facts: 2000, offer: 2500, decide: 2500, accuse: 3000, beat: 100, bot: 300 };

const sessionInfo = (p) => p.evaluate(() => ({ pid: window.__nv.session?.pid ?? null, n: window.__nv.session?.players.size ?? 0, status: window.__nv.session?.status ?? null, code: window.__nv.session?.code ?? null }));
const seatOfPid = async (host, pid) => (await pub(host))?.seats.find((s) => s.pid === pid)?.role ?? null;
const overlayOpen = (p) => p.evaluate(() => !!document.querySelector('.plan-ov') && !document.querySelector('.plan-ov').classList.contains('hidden'));
const shown = (p) => p.evaluate(() => window.__nv.plan.view.shownPhase);
const text = (p) => p.evaluate(() => document.querySelector('.plan-ov')?.textContent ?? '');

/** Reload a guest's page and wait until it sits in the crew again (automatic rejoin, no click). */
async function reloadGuest(page, n = 4) {
  await page.reload();
  await page.waitForFunction(() => window.__nv !== undefined, null, { timeout: 150000 });
  const ok = await until(() => page.evaluate((n) => !!window.__nv.session && window.__nv.session.players.size >= n && !!window.__nv.player, n), 60000, 300);
  return !!ok;
}

try {
  const pages = await crewOf4(env, { ...opt, times: T1 });
  const [host, ...guests] = pages;
  const code = (await sessionInfo(host)).code;
  await host.evaluate(() => window.__nv.plan.start());
  const first = await waitForJob(host);
  const by = await pagesByRole(pages);
  const roleOfPage = Object.fromEntries(Object.entries(by).map(([r, p]) => [pages.indexOf(p), r]));
  const guestIdx = [1, 2, 3];
  console.log('roles', JSON.stringify(roleOfPage), 'phase', first.phase);

  // ---- walk to the shop (long timers: only clicks move it on)
  await act(by.gambler, { t: 'confirm' });
  await phaseIs(host, 'brief');
  await act(by.brain, { t: 'confirm' });
  await phaseIs(host, 'scout');
  for (const id of ['parkhaus', 'hausmeister', 'lagerist']) await act(by.hands, { t: 'scout', id });
  await until(async () => (await pub(host)).board.scout.length === 3);
  await act(by.brain, { t: 'confirm' });
  await phaseIs(host, 'facts');
  await act(by.brain, { t: 'confirm' });
  await phaseIs(host, 'offer');
  await until(async () => (await Promise.all(pages.map(priv))).every((v) => v && v.offer), 20000);
  for (const p of pages) await act(p, { t: 'offer', answer: 'decline' });
  await phaseIs(host, 'shop');
  await act(by.brain, { t: 'tool', id: 'bohrer' });
  await until(async () => (await pub(host)).board.tools.includes('bohrer'));

  // ---- A: a guest reloads in the shop
  {
    const gi = guestIdx[0];
    const g = pages[gi];
    const role = roleOfPage[gi];
    const pid = (await sessionInfo(g)).pid;
    const before = await pub(host);
    const back = await reloadGuest(g);
    check('A  reload in the shop: the page rejoins the crew by itself', back);
    const info = await sessionInfo(g);
    check('A  same player id and same seat (human, not a bot)', info.pid === pid && (await seatOfPid(host, pid)) === role, `${info.pid}/${await seatOfPid(host, pid)}`);
    const opened = await until(async () => (await overlayOpen(g)) && (await shown(g)) === 'shop', 20000, 200);
    check('A  overlay opens again on the shop step', !!opened, await shown(g));
    const pb = await pub(g);
    check('A  the shared board is current (tool picked before the reload is there)', !!pb && pb.board.tools.includes('bohrer'));
    check('A  the timer keeps running: same deadline, timer shown', pb.deadline === before.deadline && /:/.test(await g.evaluate(() => document.querySelector('.plan-ov .pl-timer b')?.textContent ?? '')));
    const pv = await until(() => priv(g), 15000);
    check('A  his private view was sent again', !!pv && pv.role === role, pv ? pv.role : 'none');
    check('A  the others kept their seats, nobody got a bot', (await pub(host)).seats.every((s) => s.pid && !s.bot));

    // A2: the connection drops without a reload (network hiccup): the game reconnects by itself
    const g2 = pages[guestIdx[1]];
    const pid2 = (await sessionInfo(g2)).pid;
    await g2.evaluate(() => window.__nv.session.rel.close());
    await sleep(500);
    const again = await until(async () => { const i = await sessionInfo(g2); return i.status === 'online' && i.n >= 4 && (await seatOfPid(host, pid2)) === roleOfPage[guestIdx[1]]; }, 40000, 300);
    check('A2 a dropped connection comes back by itself with the same seat', !!again);
    const pv2 = await until(async () => (await g2.evaluate(() => window.__nv.plan.view.received.length)) > 0 ? true : false, 15000);
    check('A2 private view re-sent after the reconnect', !!pv2);
  }

  // ---- plan, then the run
  await act(by.brain, { t: 'confirm' });
  await phaseIs(host, 'plan');
  await act(by.brain, { t: 'confirm' });
  await phaseIs(host, 'run');

  // ---- B: reload the page of the player who has to decide
  let bDone = false;
  let reloadedForB = false;
  for (let guard = 0; guard < 300; guard++) {
    const p = await pub(host);
    if (p.phase === 'accuse') break;
    if (p.phase === 'offer' && p.mid) {
      // a private mid-job offer: reload one guest who holds one, it has to be shown again
      const holders = await Promise.all(pages.map(priv));
      const idx = guestIdx.find((i) => holders[i]?.offer && !holders[i].offer.answered);
      if (idx !== undefined && !bDone && !reloadedForB) {
        reloadedForB = true;
        const g = pages[idx];
        await reloadGuest(g);
        const again = await until(() => g.evaluate(() => !!document.querySelector('.plan-ov .private[data-private]')), 20000, 200);
        check('B  a private offer addressed to the guest is shown again after his reload', !!again);
      }
      for (const pg of pages) await act(pg, { t: 'offer', answer: 'decline' });
      await until(async () => (await pub(host)).phase !== 'offer', 20000);
      continue;
    }
    const d = p.run?.decision;
    if (p.phase === 'run' && d && !d.bot) {
      const page = by[d.who];
      const idx = pages.indexOf(page);
      if (!bDone && idx > 0) {
        bDone = true;
        const deadline = p.deadline;
        await reloadGuest(page);
        const back = await until(() => page.evaluate(() => !!document.querySelector('.plan-ov .decision.mine')), 25000, 200);
        const p2 = await pub(page);
        check('B  run: after the reload the pending decision is shown to the decider again', !!back && p2.run?.decision?.who === d.who && (await seatOfPid(host, (await sessionInfo(page)).pid)) === d.who);
        check('B  run: current beat and doors/state come from the snapshot', p2.phase === 'run' && p2.run.beats.length === p.run.beats.length && !!(await page.evaluate(() => document.querySelector('.plan-ov .pl-floor'))));
        check('B  run: the decision deadline is unchanged', p2.deadline === deadline, `${p2.deadline} vs ${deadline}`);
      }
      await act(page, { t: 'choose', id: d.options[0].id });
      await until(async () => { const q = await pub(host); return JSON.stringify(q.run?.decision?.title) !== JSON.stringify(d.title) || q.phase !== 'run'; }, 10000);
      continue;
    }
    await sleep(300);
  }
  if (!bDone) check('B  run: a guest was the decider at least once', false, 'the host decided every time (seed): not tested');

  // ---- C: accusation
  await phaseIs(host, 'accuse');
  await until(async () => (await Promise.all(pages.map((pg) => pg.evaluate(() => !!document.querySelector('.plan-ov [data-acc]'))))).every(Boolean), 15000);
  const g1 = pages[guestIdx[0]], g2 = pages[guestIdx[1]], g3 = pages[guestIdx[2]];
  await act(g1, { t: 'accuse', target: 'pass' });
  await until(async () => (await priv(g1))?.accuse?.choice === 'pass', 10000);
  await reloadGuest(g1);
  const keep = await until(async () => (await priv(g1))?.accuse?.choice === 'pass', 20000, 200);
  check('C  accusation: a choice already made survives his reload', !!keep, JSON.stringify((await priv(g1))?.accuse));
  check('C  accusation: he sees the accusation screen like the others', (await shown(g1)) === 'accuse' && (await overlayOpen(g1)));
  const pbefore = (await pub(host)).deadline;
  await reloadGuest(g2); // reloads before choosing
  const g2back = await until(async () => (await shown(g2)) === 'accuse' && (await priv(g2))?.accuse?.choice === null, 20000, 200);
  check('C  accusation: a guest who reloads before choosing sees the open question again, same deadline', !!g2back && (await pub(g2)).deadline === pbefore);
  for (const [pg, tgt] of [[g2, 'pass'], [g3, 'pass'], [host, 'pass']]) await act(pg, { t: 'accuse', target: tgt });
  await phaseIs(host, 'debrief');
  await until(async () => (await Promise.all(pages.map((pg) => pg.evaluate(() => !!document.querySelector('.plan-ov table.rank'))))).every(Boolean), 20000);
  await reloadGuest(g3);
  await until(async () => (await shown(g3)) === 'debrief' && (await g3.evaluate(() => !!document.querySelector('.plan-ov table.rank'))), 20000, 200);
  const grab = (pg) => pg.evaluate(() => {
    const t = (s) => [...document.querySelectorAll('.plan-ov ' + s)].map((e) => e.textContent).join('|');
    return [t('.grade'), t('.accl'), t('.reveal'), t('table.rank td:not(.bon)'), t('.evening .evt')].join('#');
  });
  const texts = await Promise.all(pages.map(grab));
  check('C  debrief: a reloaded guest sees the same debrief as the others (grade, accusations, ranking, evening)', texts.every((x) => x === texts[0]) && texts[0].length > 30, texts[0].slice(0, 80));
  const ev1 = (await pub(host)).evening;
  check('C  evening totals after job 1 are on every page', ev1?.jobs === 1 && (await Promise.all(pages.map(async (pg) => (await pub(pg)).evening?.jobs === 1))).every(Boolean));

  // ---- D + E: job 2 with fast timers. A guest is away for the whole preparation and run, a new player joins.
  await host.evaluate((t) => (window.__nvPlanTimes = t), FAST);
  await act(by.brain, { t: 'next' });
  const j2 = await until(async () => { const q = await pub(host); return q.job === 2 && q.phase === 'stake' ? q : false; }, 30000);
  check('D  job 2 starts', !!j2);
  const awayIdx = guestIdx.find((i) => roleOfPage[i] !== 'brain');
  const away = pages[awayIdx];
  const awayPid = (await sessionInfo(away)).pid;
  const awayRole = roleOfPage[awayIdx];
  await away.goto('about:blank'); // leaves like a closed tab
  const botted = await until(async () => { const s = (await pub(host)).seats.find((x) => x.role === awayRole); return s && !s.pid; }, 30000);
  check('D  after the grace period (15 s) a bot holds his seat', !!botted);
  const reachedAccuse = await until(async () => { const q = await pub(host); return q.job === 2 && (q.phase === 'accuse' || q.phase === 'debrief') ? q : false; }, 240000, 500);
  check('D  the job runs on without him (deadlines and bots take over, no soft lock)', !!reachedAccuse);
  // he comes back while the accusation (or debrief) is on: his seat is his again
  await away.goto(env.base + '');
  await away.waitForFunction(() => window.__nv !== undefined, null, { timeout: 150000 });
  // a fresh navigation keeps the tab's sessionStorage in Chrome; if not, one click on the offered crew button does it
  const auto = await until(() => away.evaluate(() => !!window.__nv.session), 25000, 300);
  if (!auto) {
    const offered = await away.evaluate(() => [...document.querySelectorAll('.menu .invite, #ui .invite')].map((b) => b.textContent).join('|'));
    console.log('no automatic rejoin after a fresh navigation; one-click button text:', JSON.stringify(offered));
    await away.evaluate((c) => window.__nv.start(c), code);
  }
  const seated = await until(async () => (await seatOfPid(host, awayPid)) === awayRole, 30000, 300);
  check('D  when he returns he is seated again, same role', !!seated);
  await until(async () => (await shown(away)) !== '' && (await overlayOpen(away)), 20000, 200);
  check('D  and the overlay shows the current step', (await overlayOpen(away)) && ['accuse', 'debrief'].includes(await shown(away)), await shown(away));
  const d2 = await until(async () => { const q = await pub(host); return q.job === 2 && q.phase === 'debrief' ? q : false; }, 120000, 500);
  check('D  job 2 reaches its debrief with the evening counting two jobs', !!d2 && d2.evening.jobs === 2, d2 ? String(d2.evening.jobs) : '');
  await sleep(1500);
  const evRows = (pg) => pg.evaluate(() => [...document.querySelectorAll('.plan-ov .evening .evt tr')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()).join('/'));
  const rowsAll = await Promise.all(pages.map(evRows));
  check('D  all four pages show the same evening table', rowsAll.every((r) => r === rowsAll[0]) && rowsAll[0].length > 10, rowsAll[0].slice(0, 80));
  const evBefore = await host.evaluate(() => JSON.parse(localStorage.getItem('nullvault.campaign.v1') || '{}').evening ?? null);
  check('F0 host campaign save holds the evening (2 jobs) before the host disappears', !!evBefore && evBefore.jobs === 2, evBefore ? String(evBefore.jobs) : 'none');

  // ---- F: the host reloads
  const g0 = pages[1];
  await host.reload();
  await host.waitForFunction(() => window.__nv !== undefined, null, { timeout: 150000 });
  const hostSession = await host.evaluate(() => !!window.__nv.session);
  check('F  a reloaded host does not come back as host by himself (menu shown)', !hostSession);
  const msg = await until(() => g0.evaluate(() => document.body.textContent.includes('Der Host ist weg')), 40000, 500);
  check('F  guests see "Der Host ist weg. Wartet, bis er die Crew neu erstellt ..."', !!msg);
  await host.evaluate(() => window.__nv.start(null));
  await until(() => host.evaluate(() => !!window.__nv.player), 150000);
  const code2 = await sessionInfo(host);
  check('F  the host creates the crew again (code ' + code + ' -> ' + code2.code + (code2.code === code ? ', same code' : '') + ')', !!code2.code);
  // guests: either back by themselves (same code, still retrying) or by joining the new code
  const joined = [];
  for (const g of [pages[1], pages[2], pages[3]]) {
    const ok = await until(async () => { const i = await sessionInfo(g); return i.status === 'online' && i.code === code2.code && i.n >= 4; }, code2.code === code ? 45000 : 1000, 500);
    if (!ok) {
      await g.evaluate(() => (window.__nv.session ? window.__nv.leave() : 0));
      await g.evaluate((c) => window.__nv.start(c), code2.code);
    }
    joined.push(!!ok);
  }
  await until(async () => (await Promise.all(pages.map((p) => sessionInfo(p)))).every((i) => i.n === 4 && i.code === code2.code), 60000, 500);
  console.log('guests back by themselves (same code):', joined.join(','));
  check('F  the crew is complete again', (await Promise.all(pages.map((p) => sessionInfo(p)))).every((i) => i.n === 4));
  await host.evaluate((t) => (window.__nvPlanTimes = t), FAST);
  await host.evaluate(() => window.__nv.plan.start());
  const j3 = await until(async () => { const q = await pub(host); return q && q.phase === 'stake' ? q : false; }, 150000, 500);
  check('F  after the new crew the evening score survives (2 jobs on the board, 4 players)', !!j3 && j3.evening?.jobs === 2 && j3.evening.players.length === 4, j3 ? String(j3.evening?.jobs) : 'no job');
  check('F  every human has his seat in the new job', !!j3 && j3.seats.filter((s) => s.pid).length === 4, j3 ? j3.seats.map((s) => !!s.pid).join(',') : '');
  for (const p of pages) if (p.errors.length) console.log('page errors', p.errors.slice(0, 3));
} catch (e) {
  console.log('TEST ERROR', e);
  failed++;
}

// ---- E: a genuinely new player joins a crew of three during a job
try {
  const names = ['Mert', 'Erdem', 'Marc'];
  const host = await openPlayer(env, { ...opt, name: names[0] });
  await host.evaluate((t) => (window.__nvPlanTimes = t), FAST);
  await host.evaluate(() => window.__nv.start(null));
  await until(() => host.evaluate(() => !!window.__nv.player), 150000);
  const code = (await sessionInfo(host)).code;
  const pages = [host];
  for (const n of names.slice(1)) {
    const p = await openPlayer(env, { ...opt, name: n });
    await p.evaluate((c) => window.__nv.start(c), code);
    pages.push(p);
  }
  await until(async () => (await Promise.all(pages.map((p) => sessionInfo(p)))).every((i) => i.n === 3), 90000);
  await host.evaluate(() => (window.__nvPlanTimes = { stake: 30000, brief: 20000, board: 20000, facts: 15000, offer: 15000, decide: 8000, accuse: 10000, beat: 200, bot: 500 }));
  await host.evaluate(() => window.__nv.plan.start());
  const first = await waitForJob(host);
  check('E  crew of three: job running with one bot seat', !!first && first.seats.filter((s) => !s.pid).length === 1, first ? first.phase : '');
  const nu = await openPlayer(env, { ...opt, name: 'Fabian' });
  await nu.evaluate((c) => window.__nv.start(c), code);
  const got = await until(async () => (await pub(nu))?.phase === first.phase || (await pub(nu))?.job === first.job, 30000, 300);
  check('E  the new player receives the \'plan\' state of the running job (not null)', !!got, JSON.stringify((await pub(nu))?.phase ?? null));
  const opened = await until(async () => (await overlayOpen(nu)), 15000, 200);
  const seatsNew = (await pub(nu))?.seats ?? [];
  const nuPid = (await sessionInfo(nu)).pid;
  check('E  he sees the job as a spectator, the three seats stay with their players', !!opened && !seatsNew.some((s) => s.pid === nuPid) && seatsNew.filter((s) => s.pid).length === 3 && /schaust zu/i.test(await text(nu)), (await text(nu)).slice(0, 60));
  check('E  the running job is not disturbed (same job, same phase family)', (await pub(host)).job === first.job && (await pub(host)).seats.filter((s) => s.pid).length === 3);
  const roleNew = await nu.evaluate(() => window.__nv.session.state.lineup?.roles?.[window.__nv.session.pid] ?? null);
  check('E  he got the free lineup role for the next job', !!roleNew, String(roleNew));
  // a fifth page is turned away with a clear message (it must not hang or half-join)
  const fifth = await openPlayer(env, { ...opt, name: 'Extra' });
  await fifth.evaluate((c) => window.__nv.start(c), code);
  const full = await until(() => fifth.evaluate(() => document.body.textContent.includes('Diese Crew ist voll')), 20000, 300);
  check('E  a fifth player is told the crew is full (no half-join)', !!full && !(await fifth.evaluate(() => !!window.__nv.session)));
  // let the job end by its timers, then start the next one: four humans
  await host.evaluate((t) => (window.__nvPlanTimes = t), FAST);
  const deb = await until(async () => { const q = await pub(host); return q.phase === 'debrief' ? q : false; }, 600000, 1000);
  check('E  the job (long timers: waits) ends at the debrief', !!deb);
  if (deb) {
    const brainPid = deb.seats.find((s) => s.role === 'brain').pid;
    const pids = await Promise.all(pages.map((p) => sessionInfo(p)));
    const leader = brainPid ? pages[pids.findIndex((i) => i.pid === brainPid)] : host;
    await act(leader, { t: 'next' });
    const j2 = await until(async () => { const q = await pub(host); return q.job === 2 && q.phase === 'stake' ? q : false; }, 30000);
    check('E  next job: the newcomer sits at the free seat (4 humans)', !!j2 && j2.seats.filter((s) => s.pid).length === 4 && j2.seats.some((s) => s.pid === nuPid), j2 ? j2.seats.map((s) => !!s.pid).join(',') : '');
  }
} catch (e) {
  console.log('TEST ERROR (E)', e);
  failed++;
}

await env.stop();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
