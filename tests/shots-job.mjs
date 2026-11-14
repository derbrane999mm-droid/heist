// Screenshots of the first-person job HUD on the test stage (?level=job), solo, German:
// intro card, objective + marker on the way, a decision pop-up (decider) and a bot's decision as a watcher
// sees it, the secret offer pop-up (and its target step), the skill prompt, the Tab log, and the pop-up
// over a bright scene. Each moment in every size (default 1440x900 and 1280x720) into test-out/job/.
// Run: node tests/shots-job.mjs [--size WxH ...] [--lang en]
import fs from 'node:fs';
import path from 'node:path';
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import { until, pub, act } from './plan-flow.mjs';

const args = process.argv.slice(2);
const sizes = [];
let lang = 'de';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--size') sizes.push(args[++i].split('x').map(Number));
  if (args[i] === '--lang') lang = args[++i];
}
if (!sizes.length) sizes.push([1440, 900], [1280, 720]);
const dir = path.join(OUT, 'job');
fs.mkdirSync(dir, { recursive: true });

const SEED = 6;
const TIMES = { stake: 60000, brief: 60000, board: 60000, facts: 60000, offer: 120000, decide: 120000, accuse: 60000, beat: 900, bot: 6000, skill: 120000, gate: 30000 };
const POSTS = { brain: 'inside', hands: 'inside', gambler: 'lookout', bait: 'driver' };
const dbg = (page) => page.evaluate(() => window.__nv.job.debugState());
const taken = new Set();

async function shot(page, name) {
  if (taken.has(name)) return;
  taken.add(name);
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(350);
    const f = path.join(dir, `${name}-${w}x${h}.png`);
    await page.screenshot({ path: f });
    console.log('  ', path.relative(process.cwd(), f));
  }
}

async function prep(page) {
  const p = await pub(page);
  const A = (a) => act(page, a);
  const pv = await page.evaluate(() => { const r = window.__nv.plan.view.received; return r.length ? r[r.length - 1] : null; });
  switch (p?.phase) {
    case 'brief': case 'facts': await A({ t: 'confirm' }); break;
    case 'scout':
      if (p.board.scout.length === 3) await A({ t: 'confirm' });
      else for (const id of ['parkhaus', 'hausmeister', 'elektriker']) if (!p.board.scout.includes(id)) await A({ t: 'scout', id });
      break;
    case 'offer': if (!p.mid && pv?.offer && !pv.offer.answered) await A({ t: 'offer', answer: 'decline' }); break;
    case 'shop':
      for (const id of ['decoder', 'stoer', 'bohrer']) if (!p.board.tools.includes(id)) await A({ t: 'tool', id });
      if (['decoder', 'stoer', 'bohrer'].every((x) => p.board.tools.includes(x))) await A({ t: 'confirm' });
      break;
    case 'plan':
      for (const s of p.seats) if (p.plan.posts[s.role] !== POSTS[s.role]) await A({ t: 'post', role: s.role, post: POSTS[s.role] });
      if (p.plan.targets[0] !== 'tresor') { if (!p.plan.targets.includes('tresor')) await A({ t: 'tgt', id: 'tresor' }); }
      else if (Object.entries(POSTS).every(([r, x]) => p.plan.posts[r] === x)) await A({ t: 'confirm' });
      break;
  }
  return p;
}

const env = await startServers({ port: 5583, sigPort: 9583 });
try {
  const [w0, h0] = sizes[0];
  const page = await openPlayer(env, { name: 'Mert', quality: 'medium', lang, width: w0, height: h0, renderSkip: 0, extra: '&level=job' });
  await page.evaluate(([t, s]) => { window.__nvPlanTimes = t; window.__nvPlanSeed = s; }, [TIMES, SEED]);
  await page.evaluate(() => window.__nv.start(null));
  await until(() => page.evaluate(() => !!window.__nv.player), 150000);
  await page.evaluate(() => window.__nv.plan.start());
  await until(async () => { const p = await prep(page); return p?.phase === 'run'; }, 180000, 300);
  await sleep(900);
  // 1. intro card
  await shot(page, '01-intro');
  await page.keyboard.press('ShiftLeft');
  // 2. on the way: a few metres behind the van, looking past the objective
  await page.evaluate(() => window.__nv.tp(3, 0.02, 19, 0.35, -0.05));
  await sleep(1500);
  await shot(page, '02-objective');
  // looking away: the edge arrow
  await page.evaluate(() => window.__nv.tp(3, 0.02, 19, 2.6, 0));
  await sleep(500);
  await shot(page, '03-edge-arrow');
  let logShot = false, offerDone = false;
  const end = await until(async () => {
    const p = await pub(page);
    if (!p) return false;
    if (p.phase === 'accuse' || p.phase === 'debrief') return p;
    const st = await dbg(page);
    if (p.phase === 'run' && p.run.beats.length >= 4 && !logShot) {
      logShot = true;
      await page.keyboard.down('Tab');
      await sleep(400);
      await shot(page, '08-tab-log');
      await page.keyboard.up('Tab');
    }
    if (st.popup === 'decision') {
      await shot(page, '04-decision-decider');
      if (!taken.has('09-decision-bright')) {
        await page.evaluate(() => { const s = window.__nv.engine?.scene; if (s) { window.__bg = s.background.getHex(); s.background.setHex(0xd9d4ca); s.fog.color.setHex(0xd9d4ca); } });
        await shot(page, '09-decision-bright');
        await page.evaluate(() => { const s = window.__nv.engine?.scene; if (s) { s.background.setHex(window.__bg); s.fog.color.setHex(window.__bg); } });
      }
      await page.keyboard.press('Digit1');
      await sleep(400);
      return false;
    }
    if (st.popup === 'offer') {
      if (st.offerStep === 'main') {
        await shot(page, '06-offer');
        await page.keyboard.press('Digit1');
      } else {
        await shot(page, '07-offer-target');
        await page.keyboard.press('Digit1');
      }
      offerDone = true;
      await sleep(400);
      return false;
    }
    if (p.phase === 'run' && p.run.decision && p.run.decision.bot) {
      await sleep(300);
      await shot(page, '05-decision-watcher');
    }
    if (st.prompt) {
      await page.evaluate(() => { const a = window.__nv.job.debugState().at; if (a) window.__nv.tp(a.x, 0.02, a.z + 2.2, 0, -0.15); });
      await sleep(300);
      await shot(page, '10-skill-prompt');
      await page.keyboard.press('KeyE');
      await sleep(400);
      await shot(page, '11-skill-game');
      return false;
    }
    if (st.game) {
      await page.evaluate((id) => window.__nv.level.games[id].debugFinish(true), st.game);
      return false;
    }
    if (st.at && p.phase === 'run') {
      const far = await page.evaluate((a) => Math.hypot(window.__nv.player.position.x - a.x, window.__nv.player.position.z - a.z) > 1.2, st.at);
      if (far) await page.evaluate((a) => window.__nv.tp(a.x, a.y + 0.02, a.z + 0.3, 0, 0), st.at);
    }
    return false;
  }, 400000, 250);
  console.log(end ? 'reached ' + end.phase : 'did not finish', '· offer seen:', offerDone, '· shots:', [...taken].join(', '));
  if (page.errors.length) console.log('PAGE ERRORS', page.errors.slice(0, 5));
} finally {
  await env.stop();
}
