// Shared steps for the planning-round browser tests (tests/plan.mjs, tests/shots-plan.mjs).
import { openPlayer, sleep } from './harness.mjs';

export const until = async (fn, ms = 30000, step = 200) => {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
};
export const ROLES = ['brain', 'gambler', 'hands', 'bait'];
export const pub = (page) => page.evaluate(() => window.__nv.session?.state?.plan ?? null);
export const act = (page, a) => page.evaluate((a) => window.__nv.session.intent('plan.act', a), a);
export const priv = (page) => page.evaluate(() => {
  const r = window.__nv.plan.view.received;
  return r.length ? r[r.length - 1] : null;
});
/** Click a button in the overlay like a player would. */
export const click = async (page, sel) => {
  await page.waitForSelector('.plan-ov ' + sel, { timeout: 20000 });
  await page.click('.plan-ov ' + sel, { timeout: 20000 });
};
/** Test timings: long enough to act on slow software rendering, short beats. */
export const TEST_TIMES = { stake: 60000, brief: 60000, board: 90000, facts: 60000, offer: 60000, decide: 60000, accuse: 60000, beat: 150, bot: 500 };

/** Host + three guests in one crew. */
export async function crewOf4(env, opt, names = ['Mert', 'Erdem', 'Marc', 'Fabian'], extra = {}) {
  const host = await openPlayer(env, { ...opt, ...(extra[0] || {}), name: names[0] });
  await host.evaluate((t) => (window.__nvPlanTimes = t), opt.times || TEST_TIMES);
  await host.evaluate(() => window.__nv.start(null));
  await until(() => host.evaluate(() => !!window.__nv.player), 150000);
  const code = await host.evaluate(() => window.__nv.session.code);
  const pages = [host];
  for (let i = 1; i < 4; i++) {
    const p = await openPlayer(env, { ...opt, ...(extra[i] || {}), name: names[i] });
    await p.evaluate((c) => window.__nv.start(c), code);
    pages.push(p);
  }
  await until(async () => (await Promise.all(pages.map((p) => p.evaluate(() => window.__nv.session?.players.size ?? 0)))).every((n) => n === 4), 90000);
  for (const p of pages) await until(() => p.evaluate(() => !!window.__nv.player), 150000);
  return pages;
}

/** After plan.start(): wait through the lineup (fast mode: the Broker picks when nobody votes). */
export async function waitForJob(host, ms = 150000) {
  return until(async () => {
    const p = await pub(host);
    return p && p.phase && p.phase !== 'lineup' ? p : false;
  }, ms, 500);
}

/** Map role -> page for the running job. */
export async function pagesByRole(pages) {
  const p = await pub(pages[0]);
  const pids = await Promise.all(pages.map((pg) => pg.evaluate(() => window.__nv.session.pid)));
  const out = {};
  for (const s of p.seats) if (s.pid) out[s.role] = pages[pids.indexOf(s.pid)];
  return out;
}

export const phaseIs = (page, ph) => until(async () => (await pub(page))?.phase === ph, 60000);
