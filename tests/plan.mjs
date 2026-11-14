// The planning round with four players (lineup in fast mode, then one job), plus a solo run with bots.
// Run: node tests/plan.mjs
import { startServers, openPlayer, sleep } from './harness.mjs';
import { until, ROLES, pub, act, priv, click, crewOf4, waitForJob, pagesByRole, phaseIs } from './plan-flow.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const OFFER_TITLES = { tempo: 'Schritt', provision: 'Provision', tipp: 'Ein Tipp für dich', suendenbock: 'Sündenbock', tasche: 'Eigene Tasche', laerm: 'Ein Gefallen', nerven: 'Falsche Ansage' };
/** Offer ids that only the host's machine knows, per role. */
const secretOffers = (host) => host.evaluate(() => window.__nv.plan.controller.debugMachine.S.offers.filter((o) => o.human).map((o) => ({ role: o.role, id: o.id, when: o.when, state: o.state })));
const seen = (page) => page.evaluate(() => {
  const el = document.querySelector('.plan-ov .private[data-private]');
  return el ? { id: el.getAttribute('data-private'), text: el.textContent } : null;
});
const overlayText = (page) => page.evaluate(() => document.querySelector('.plan-ov')?.textContent ?? '');

const env = await startServers({ port: 5460, sigPort: 9460 });
const opt = { width: 1280, height: 720, quality: 'low', renderSkip: 30, lineupFast: true };
try {
  const pages = await crewOf4(env, opt);
  const [host] = pages;

  // ---- start: the lineup runs first
  check('plan API on window.__nv', await host.evaluate(() => typeof window.__nv.plan.start === 'function' && window.__nv.plan.running() === false));
  await pages[2].evaluate(() => window.__nv.plan.start()); // any crew member may ask the host
  const lineupSeen = await until(async () => (await host.evaluate(() => window.__nv.session.state.lineup?.phase)) === 'vote', 20000);
  check('without roles, starting a job runs the lineup first', !!lineupSeen && (await pub(host))?.phase === 'lineup');
  const first = await waitForJob(host);
  check('after the lineup the job starts with the stake', first && first.phase === 'stake', first?.phase);
  const by = await pagesByRole(pages);
  check('all four seats are humans with the lineup roles', ROLES.every((r) => by[r]) && first.seats.every((s) => !s.bot));
  const openAll = await until(async () => (await Promise.all(pages.map((p) => p.evaluate(() => !document.querySelector('.plan-ov').classList.contains('hidden') && window.__nv.player.frozen)))).every(Boolean), 15000);
  check('overlay is open on every page, movement frozen', !!openAll);
  check('running() is true on every page', (await Promise.all(pages.map((p) => p.evaluate(() => window.__nv.plan.running())))).every(Boolean));
  const p0 = await pub(by.bait);
  check('a timer is shown with the phase deadline', p0.deadline > 0 && (await by.bait.evaluate(() => document.querySelector('.plan-ov .pl-timer b')?.textContent ?? '')).includes(':'));

  // ---- stake: only the Zocker
  await act(by.brain, { t: 'stake', id: 'allin' });
  await sleep(600);
  check('only the Zocker can set the stake', (await pub(host)).stake === 'sicher');
  check('others see the stake cards read-only', await by.hands.evaluate(() => document.querySelector('.plan-ov [data-stake="gierig"]')?.getAttribute('aria-disabled') === 'true'));
  await click(by.gambler, '[data-stake="gierig"]');
  await until(async () => (await pub(by.hands)).stake === 'gierig');
  check('Zocker picks the stake by clicking, everyone sees it', (await pub(by.hands)).stake === 'gierig');
  await click(by.gambler, '[data-act="confirm"]');
  await phaseIs(host, 'brief');
  await click(by.brain, '[data-act="confirm"]');
  await phaseIs(host, 'scout');

  // ---- scouting: shared board, the Wortführer confirms
  await click(by.hands, '[data-scout="parkhaus"]');
  await click(by.bait, '[data-scout="hausmeister"]');
  await click(by.gambler, '[data-scout="lagerist"]');
  const board = await until(async () => {
    const all = await Promise.all(pages.map(async (p) => JSON.stringify((await pub(p)).board.scout.slice().sort())));
    return all.every((x) => x === all[0]) && JSON.parse(all[0]).length === 3 ? JSON.parse(all[0]) : false;
  });
  check('scouting board: proposals from three players, live on all four pages', !!board, JSON.stringify(board));
  // the state arrives first, the page draws it a frame or two later
  const countSel = () => Promise.all(pages.map((p) => p.evaluate(() => document.querySelectorAll('.plan-ov .sct-row.sel[data-scout]').length)));
  await until(async () => (await countSel()).every((n) => n === 3), 5000, 100);
  const selCards = await countSel();
  check('every page highlights the same three cards', selCards.every((n) => n === 3), selCards.join(','));
  // the Überblick marks the rows the three picked scouts will clear (alarm, guard) and leaves the others unknown
  const soon = await by.bait.evaluate(() => Object.fromEntries([...document.querySelectorAll('.plan-ov .ov-row[data-fk]')].map((r) => [r.dataset.fk, r.querySelector('.ov-pill')?.textContent])));
  check('scouting: Überblick shows "wird geklärt" for the rows a picked scout reveals', soon.alarm === 'wird geklärt' && soon.guard === 'wird geklärt' && soon.safe === 'unbekannt' && soon.police === 'unbekannt', JSON.stringify(soon));
  check('scouting: six compact rows, footer and confirm button outside the scrolling body', await by.brain.evaluate(() => { return document.querySelectorAll('.plan-ov .sct-row').length === 6 && !!document.querySelector('.plan-ov .sct-foot [data-act="confirm"]') && !document.querySelector('.plan-ov .card'); }));
  await act(by.hands, { t: 'confirm' });
  await sleep(600);
  check('only the Wortführer confirms the scouting', (await pub(host)).phase === 'scout');
  await click(by.brain, '[data-act="confirm"]');
  await phaseIs(host, 'facts');
  check('facts are shared after scouting', Object.keys((await pub(by.bait)).known).length >= 3);
  await click(by.brain, '[data-act="confirm"]');

  // ---- secret offers before the job
  await phaseIs(host, 'offer');
  await until(async () => (await Promise.all(pages.map(seen))).every(Boolean), 20000);
  const secrets = await secretOffers(host);
  const views = await Promise.all(pages.map(seen));
  const pids = await Promise.all(pages.map((p) => p.evaluate(() => window.__nv.session.pid)));
  const roleOfPage = (i) => first.seats.find((s) => s.pid === pids[i]).role;
  let ownOk = true, foreignOk = true;
  for (let i = 0; i < 4; i++) {
    const r = roleOfPage(i);
    const mine = secrets.find((o) => o.role === r && o.when === 'pre');
    if (!views[i] || views[i].id !== mine.id || !views[i].text.includes(OFFER_TITLES[mine.id])) ownOk = false;
    const text = await overlayText(pages[i]);
    for (const o of secrets) if (o.role !== r && o.id !== mine.id && text.includes(OFFER_TITLES[o.id])) foreignOk = false;
  }
  check('every player sees his own secret offer, marked private', ownOk && views.every((v) => v && v.text.includes('Nur für')));
  check('no page shows another player\'s offer', foreignOk);
  const pubJson = JSON.stringify(await pub(by.bait));
  check('replicated state holds no offer before the debrief', !pubJson.includes('"of.') && !Object.keys(OFFER_TITLES).some((id) => pubJson.includes(`"${id}"`)));
  // the Zocker accepts (with targets where needed), the rest declines
  const gOffer = secrets.find((o) => o.role === 'gambler' && o.when === 'pre');
  if (await by.gambler.$('.plan-ov [data-ot]')) await click(by.gambler, '[data-ot]');
  if (await by.gambler.$('.plan-ov [data-op]')) await click(by.gambler, '[data-op]');
  await click(by.gambler, '[data-offer="accept"]');
  check('state does not move while others are still deciding', (await pub(host)).phase === 'offer');
  for (const r of ['brain', 'hands', 'bait']) await click(by[r], '[data-offer="decline"]');
  await phaseIs(host, 'shop');
  const after = await secretOffers(host);
  check('answers applied after everyone answered', after.find((o) => o.role === 'gambler' && o.when === 'pre').state === 'accepted' && after.filter((o) => o.when === 'pre' && o.role !== 'gambler').every((o) => o.state === 'declined'), gOffer.id);
  if (gOffer.id === 'tipp') {
    // the host changed phase first: give the owner's page a moment to draw it
    await until(() => by.gambler.evaluate(() => !!document.querySelector('.plan-ov .private.tip')), 5000, 100);
    const tips = await Promise.all(pages.map((p) => p.evaluate(() => !!document.querySelector('.plan-ov .private.tip'))));
    check('the secret tip shows only on its owner\'s page', tips[pages.indexOf(by.gambler)] && tips.filter(Boolean).length === 1);
  }

  // ---- shopping
  const p1 = await pub(host);
  // the full tool list is behind one button (view-local: opens on this page only)
  await click(by.hands, '[data-local="shop-all"]');
  await click(by.hands, '[data-tool="bohrer"]');
  await click(by.bait, '[data-local="shop-all"]');
  await click(by.bait, '[data-tool="scanner"]');
  await until(async () => (await pub(by.brain)).board.tools.length === 2);
  await click(by.brain, '[data-act="confirm"]');
  await phaseIs(host, 'plan');
  const p2 = await pub(host);
  check('shopping: tools bought from the shared list', p2.tools.includes('bohrer') && p2.tools.includes('scanner') && p2.budget === p1.budget - 950);

  // ---- plan: everyone sets his own post
  await until(() => by.bait.evaluate(() => !!document.querySelector('.plan-ov [data-post="bait:lookout"]')), 5000, 100);
  check('posts: only your own seat is editable', await by.bait.evaluate(() => {
    const own = document.querySelector('.plan-ov [data-post="bait:lookout"]');
    const other = document.querySelector('.plan-ov [data-post="hands:lookout"]');
    return !!own && own.getAttribute('aria-disabled') !== 'true' && !!other && other.getAttribute('aria-disabled') === 'true';
  }));
  await act(by.bait, { t: 'post', role: 'hands', post: 'lookout' });
  await click(by.hands, '[data-post="hands:inside"]');
  await click(by.gambler, '[data-post="gambler:driver"]');
  await click(by.bait, '[data-post="bait:inside"]');
  await until(async () => { const p = await pub(host); return p.plan.posts.hands === 'inside' && p.plan.posts.gambler === 'driver'; });
  const pp = await pub(host);
  check('posts set by their owners, foreign change refused', pp.plan.posts.hands === 'inside' && pp.plan.posts.gambler === 'driver' && pp.plan.posts.bait === 'inside', JSON.stringify(pp.plan.posts));
  await click(by.gambler, '[data-tgt="vitrinen"]'); // toggle off
  await click(by.gambler, '[data-tgt="vitrinen"]'); // and on again
  await until(async () => (await pub(host)).plan.targets.length === 2);
  check('plan: footer holds the confirm button, no summary box', await by.brain.evaluate(() => !!document.querySelector('.plan-ov .pln-foot [data-act="confirm"]') && !document.querySelector('.plan-ov .summary') && document.querySelectorAll('.plan-ov [data-ent]').length === 3));
  if ((await pub(host)).summary.errors.length) console.log('plan errors', JSON.stringify((await pub(host)).summary.errors));
  await click(by.brain, '[data-act="confirm"]');
  await phaseIs(host, 'run');

  // ---- the job
  let decisions = 0, rightDecider = true, offersMid = 0, midOwnOk = true;
  const deciders = new Set();
  for (let guard = 0; guard < 400; guard++) {
    const p = await pub(host);
    if (p.phase === 'accuse') break;
    if (p.phase === 'offer' && p.mid) {
      await until(async () => (await Promise.all(pages.map(async (pg, i) => (await pub(host)).phase !== 'offer' || !!(await seen(pg)) || p.run.status[roleOfPage(i)] === 'caught'))).every(Boolean), 15000);
      const sec = await secretOffers(host);
      for (let i = 0; i < 4; i++) {
        const v = await seen(pages[i]);
        if (!v) continue;
        offersMid++;
        const mine = sec.find((o) => o.role === roleOfPage(i) && o.when === 'mid');
        if (!mine || mine.id !== v.id) midOwnOk = false;
        await pages[i].click('.plan-ov [data-offer="decline"]').catch(() => {});
      }
      await until(async () => (await pub(host)).phase !== 'offer', 20000);
      continue;
    }
    const d = p.run?.decision;
    if (p.phase === 'run' && d) {
      const page = by[d.who];
      const flags = await Promise.all(pages.map((pg) => pg.evaluate(() => ({ mine: !!document.querySelector('.plan-ov .decision.mine'), watch: !!document.querySelector('.plan-ov .decision.watch') }))));
      // wait until the decider's page rendered the decision
      await until(() => page.evaluate(() => !!document.querySelector('.plan-ov .decision.mine')), 8000);
      const f2 = await Promise.all(pages.map((pg) => pg.evaluate(() => ({ mine: !!document.querySelector('.plan-ov .decision.mine'), watch: !!document.querySelector('.plan-ov .decision.watch') }))));
      for (let i = 0; i < 4; i++) {
        const isDecider = pages[i] === page;
        if (isDecider ? !f2[i].mine : f2[i].mine) rightDecider = false;
      }
      // someone else trying to decide is refused
      const other = pages.find((pg) => pg !== page);
      await act(other, { t: 'choose', id: d.options[0].id });
      await sleep(300);
      const still = (await pub(host)).run?.decision;
      if (!still || JSON.stringify(still.title) !== JSON.stringify(d.title)) rightDecider = false;
      const optId = d.options.find((o) => o.id === 'leave' || o.id === 'go' || o.id === 'slow' || o.id === 'pick' || o.id === 'hide')?.id ?? d.options[0].id;
      await page.click(`.plan-ov .decision.mine [data-opt="${optId}"]`);
      deciders.add(d.who);
      decisions++;
      await until(async () => { const q = await pub(host); return JSON.stringify(q.run?.decision?.title) !== JSON.stringify(d.title) || q.phase !== 'run'; }, 10000);
      void flags;
      continue;
    }
    await sleep(300);
  }
  check('job decisions go to the role holder named in the prototype, others watch', decisions > 0 && rightDecider, `${decisions} decisions by ${[...deciders].join(',')}`);
  check('mid-job secret offers: dealt to every free player, each sees only his own', offersMid >= 1 && midOwnOk, `${offersMid} shown`);

  // ---- accusation: private, simultaneous
  await phaseIs(host, 'accuse');
  await until(async () => (await Promise.all(pages.map((pg) => pg.evaluate(() => !!document.querySelector('.plan-ov [data-acc]'))))).every(Boolean), 15000);
  await click(by.brain, '[data-acc="gambler"]');
  await click(by.brain, '[data-act="accuse"]');
  await click(by.hands, '[data-acc="pass"]');
  await click(by.hands, '[data-act="accuse"]');
  await sleep(800);
  const midAcc = await pub(by.bait);
  check('accusations stay secret until all have answered', midAcc.phase === 'accuse' && !JSON.stringify(midAcc).includes('accusations') && (await overlayText(by.bait)).indexOf('Treffer +') >= 0);
  await click(by.gambler, '[data-acc="bait"]');
  await click(by.gambler, '[data-act="accuse"]');
  await click(by.bait, '[data-acc="brain"]');
  await click(by.bait, '[data-act="accuse"]');
  await phaseIs(host, 'debrief');
  const res = (await pub(by.hands)).result;
  const acc = Object.fromEntries(res.accusations.map((a) => [a.from, a.to]));
  check('debrief: every accusation revealed as given', acc.brain === 'gambler' && acc.hands === null && acc.gambler === 'bait' && acc.bait === 'brain', JSON.stringify(acc));
  check('debrief: the Zocker\'s accepted offer is revealed (and the accusation hit)', res.offers.some((o) => o.role === 'gambler' && o.state === 'accepted') && res.accusations.find((a) => a.from === 'brain').correct === true);
  await until(async () => (await Promise.all(pages.map((pg) => pg.evaluate(() => !!document.querySelector('.plan-ov table.rank'))))).every(Boolean), 15000);
  const texts = await Promise.all(pages.map((pg) => pg.evaluate(() => {
    const t = (s) => [...document.querySelectorAll('.plan-ov ' + s)].map((e) => e.textContent).join('|');
    return [t('.grade'), t('.accl'), t('.reveal'), t('table.rank td:not(.bon)')].join('#');
  })));
  check('all four pages end on the same debrief (grade, accusations, offers, ranking)', texts.every((x) => x === texts[0]), texts[0].slice(0, 120));
  const order = await host.evaluate(() => [...document.querySelectorAll('.plan-ov h3.sub')].map((e) => e.textContent));
  check('reveal in the prototype\'s order: accusations, offers, ranking', order.slice(0, 3).join(',') === 'Verdacht,Geheime Angebote,Einzelwertung', order.join(','));
  // privacy over the network: each client only ever got private messages for its own seat
  let netOk = true;
  for (let i = 0; i < 4; i++) {
    const rec = await pages[i].evaluate(() => window.__nv.plan.view.received.map((m) => m.role));
    if (!rec.length || rec.some((r) => r !== roleOfPage(i))) netOk = false;
  }
  check('private messages reach only their owner (no foreign message on any client)', netOk);
  check('running() is false at the debrief', !(await host.evaluate(() => window.__nv.plan.running())));
  const saved = await host.evaluate(() => JSON.parse(localStorage.getItem('nullvault.campaign.v1') || '{}').missions?.['plan.varga'] ?? null);
  check('host campaign save holds a compact result', !!saved && typeof saved.best === 'number', JSON.stringify(saved));
  await click(by.hands, '[data-act="close"]');
  check('closing the debrief unfreezes the player', await by.hands.evaluate(() => document.querySelector('.plan-ov').classList.contains('hidden') && !window.__nv.player.frozen));

  const missing = await host.evaluate(() => window.__nv.missingTranslations());
  check('every text exists in English and German', missing.length === 0, missing.join(', '));
  const errors = pages.flatMap((pg) => pg.errors);
  check('no page errors (crew)', errors.length === 0, errors.slice(0, 4).join(' || '));
  for (const pg of pages) await pg.context().close();

  // ---- solo with bots, started by URL parameter
  const solo = await openPlayer(env, { ...opt, name: 'Solo', extra: '&plan=1' });
  await solo.evaluate(() => (window.__nvPlanTimes = { stake: 4000, brief: 3000, board: 6000, facts: 3000, offer: 5000, decide: 4000, accuse: 5000, beat: 120, bot: 1500 }));
  await solo.evaluate(() => window.__nv.start(null));
  const sp = await until(async () => (await pub(solo))?.phase, 30000);
  check('solo: ?plan=1 starts a job right after the session starts', !!sp);
  const s0 = await pub(solo);
  check('solo: one human (Wortführer), three bots', s0.seats.filter((s) => s.bot).length === 3 && !s0.seats.find((s) => s.role === 'brain').bot);
  const botStake = await until(async () => {
    const t = await solo.evaluate(() => document.querySelector('.plan-ov .whotxt')?.textContent ?? '');
    return t.includes('entscheidet') ? t : false;
  }, 8000, 100);
  check('solo: a bot seat shows "… entscheidet" while it decides', !!botStake, String(botStake));
  let soloOffers = 0;
  const done = await until(async () => {
    const p = await pub(solo);
    if (p.phase === 'offer' && (await seen(solo))) {
      soloOffers++;
      await solo.click('.plan-ov [data-offer="decline"]').catch(() => {});
    }
    if (p.phase === 'run' && p.run.decision && !p.run.decision.bot) await solo.click('.plan-ov .decision.mine [data-opt]').catch(() => {});
    return p.phase === 'debrief';
  }, 240000, 400);
  check('solo: a complete job alone, bots and timers fill the rest', !!done);
  check('solo: the human got secret offers too', soloOffers >= 1, String(soloOffers));
  const sr = (await pub(solo)).result;
  check('solo: debrief with ranking of four', sr && sr.final.length === 4);
  check('no page errors (solo)', solo.errors.length === 0, solo.errors.slice(0, 3).join(' || '));
} catch (e) {
  console.log('TEST CRASHED', e);
  failed++;
} finally {
  await Promise.race([env.stop(), new Promise((r) => setTimeout(r, 15000))]);
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
