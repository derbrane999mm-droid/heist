// Screenshots of the planning round: shared scouting board on two pages, a private offer,
// a job decision as decider and as onlooker, the accusation and the debrief.
// Run: node tests/shots-plan.mjs   (files in test-out/plan-*.png)
import { startServers, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
import { until, pub, act, click, crewOf4, waitForJob, pagesByRole, phaseIs } from './plan-flow.mjs';

fs.mkdirSync(OUT, { recursive: true });
const env = await startServers({ port: 5461, sigPort: 9461 });
const shot = async (page, file) => {
  await sleep(400);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log('shot', `${OUT}/${file}`);
};
const opt = { width: 1280, height: 720, quality: 'low', renderSkip: 40, lineupFast: true, times: { stake: 120000, brief: 120000, board: 180000, facts: 120000, offer: 120000, decide: 120000, accuse: 120000, beat: 150, bot: 800 } };
try {
  // host at 1920x1080, the others at 1280x720
  const pages = await crewOf4(env, opt, ['Mert', 'Erdem', 'Marc', 'Fabian'], { 0: { width: 1920, height: 1080 } });
  const [host] = pages;
  await host.evaluate(() => (window.__nvPlanSeed = 4242));
  await host.evaluate(() => window.__nv.plan.start());
  await waitForJob(host);
  const by = await pagesByRole(pages);
  await click(by.gambler, '[data-stake="gierig"]');
  await sleep(500);
  await shot(by.gambler, 'plan-1-stake-1280.png');
  await click(by.gambler, '[data-act="confirm"]');
  await phaseIs(host, 'brief');
  await click(by.brain, '[data-act="confirm"]');
  await phaseIs(host, 'scout');
  await click(by.hands, '[data-scout="parkhaus"]');
  await click(by.bait, '[data-scout="elektriker"]');
  await until(async () => (await pub(host)).board.scout.length === 2);
  await sleep(800);
  await shot(host, 'plan-2-scout-board-host-1920.png');
  await shot(by.hands === host ? by.bait : by.hands, 'plan-2-scout-board-guest-1280.png');
  await click(by.brain, '[data-scout="hausmeister"]');
  await until(async () => (await pub(host)).board.scout.length === 3);
  await click(by.brain, '[data-act="confirm"]');
  await phaseIs(host, 'facts');
  await click(by.brain, '[data-act="confirm"]');
  await phaseIs(host, 'offer');
  // a private offer, with a target picked if it needs one
  const op = by.hands;
  await op.waitForSelector('.plan-ov .private[data-private]');
  if (await op.$('.plan-ov [data-ot]')) await click(op, '[data-ot]');
  await sleep(500);
  await shot(op, 'plan-3-private-offer-1280.png');
  for (const p of pages) await p.click('.plan-ov [data-offer="decline"]').catch(() => {});
  await phaseIs(host, 'shop');
  await click(by.bait, '[data-tool="bohrer"]');
  await click(by.hands, '[data-tool="scanner"]');
  await sleep(600);
  await shot(by.bait, 'plan-4-shop-1280.png');
  await click(by.brain, '[data-act="confirm"]');
  await phaseIs(host, 'plan');
  await click(by.hands, '[data-post="hands:inside"]');
  await click(by.gambler, '[data-post="gambler:driver"]');
  await sleep(800);
  await shot(host, 'plan-5-plan-1920.png');
  await click(by.brain, '[data-act="confirm"]');
  await phaseIs(host, 'run');
  let decShots = 0, midShot = false;
  for (let guard = 0; guard < 300; guard++) {
    const p = await pub(host);
    if (p.phase === 'accuse') break;
    if (p.phase === 'offer' && p.mid) {
      await sleep(1200);
      if (!midShot) { await shot(by.bait, 'plan-6-mid-offer-1280.png'); midShot = true; }
      for (const pg of pages) await pg.click('.plan-ov [data-offer="decline"]').catch(() => {});
      await until(async () => (await pub(host)).phase !== 'offer', 20000);
      continue;
    }
    const d = p.run?.decision;
    if (d) {
      const page = by[d.who];
      await until(() => page.evaluate(() => !!document.querySelector('.plan-ov .decision.mine')), 8000);
      if (decShots === 0) {
        await sleep(800);
        await shot(page, `plan-7-decision-decider-${page === host ? 1920 : 1280}.png`);
        const watcher = pages.find((x) => x !== page && x !== host) ?? pages.find((x) => x !== page);
        await shot(watcher, 'plan-7-decision-onlooker-1280.png');
        decShots++;
      }
      const id = d.options.find((o) => ['slow', 'pick', 'hide', 'go', 'leave'].includes(o.id))?.id ?? d.options[0].id;
      await page.click(`.plan-ov .decision.mine [data-opt="${id}"]`);
      await until(async () => JSON.stringify((await pub(host)).run?.decision?.title) !== JSON.stringify(d.title), 10000);
      continue;
    }
    await sleep(300);
  }
  await phaseIs(host, 'accuse');
  await until(() => by.bait.evaluate(() => !!document.querySelector('.plan-ov [data-acc]')));
  await click(by.bait, '[data-acc="gambler"]');
  await sleep(500);
  await shot(by.bait, 'plan-8-accuse-1280.png');
  for (const [r, pg] of Object.entries(by)) {
    await pg.click(`.plan-ov [data-acc="${r === 'gambler' ? 'pass' : 'gambler'}"]`).catch(() => {});
    await pg.click('.plan-ov [data-act="accuse"]').catch(() => {});
  }
  await phaseIs(host, 'debrief');
  await sleep(1500);
  await shot(host, 'plan-9-debrief-1920.png');
  await shot(by.hands === host ? by.bait : by.hands, 'plan-9-debrief-1280.png');
  // scroll the debrief to the reveal of the offers and the ranking
  const g = by.hands === host ? by.bait : by.hands;
  await g.evaluate(() => { const pn = document.querySelector('.plan-ov .pl-panel'); const h = [...document.querySelectorAll('.plan-ov h3.sub')].find((x) => x.textContent.includes('Geheime')); pn.scrollTop += h.getBoundingClientRect().top - pn.getBoundingClientRect().top - 10; });
  await shot(g, 'plan-9-debrief-reveal-1280.png');
  console.log('errors', pages.flatMap((p) => p.errors));
} catch (e) {
  console.log('SHOTS CRASHED', e);
  process.exitCode = 1;
} finally {
  // stopping the servers can hang on open peer connections: never hold the browser lock
  await Promise.race([env.stop(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode ?? 0);
}
