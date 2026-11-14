// Screenshots of the preparation steps of the planning round (solo job, German), one PNG per step and size.
// Usage: node tests/shots-prep.mjs [--size 1440x900] [--size 1280x720] [--seed 4242] [--out test-out/prep] [--keep-traces]
// Files: <out>/<index>-<step>-<WxH>.png. Spoiler rule: `.ln.trace` lines are removed from the page before each shot
// unless --keep-traces is given.
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import { until, pub, click, domPhase, phaseIs } from './plan-flow.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const sizes = [];
let seed = 4242, out = path.join(OUT, 'prep'), keepTraces = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--size') sizes.push(args[++i]);
  else if (args[i] === '--seed') seed = Number(args[++i]);
  else if (args[i] === '--out') out = path.resolve(args[++i]);
  else if (args[i] === '--keep-traces') keepTraces = true;
  else { console.log('unknown argument', args[i]); process.exit(1); }
}
if (!sizes.length) sizes.push('1440x900');
fs.mkdirSync(out, { recursive: true });

// bot: the stake is set by the bot seat after this delay, so the stake step stays up long enough to be shot
const H = 3600000;
const TIMES = { stake: H, brief: H, board: H, facts: H, offer: H, decide: H, accuse: H, beat: 150, bot: 5000 };

async function run(size, idx) {
  const [width, height] = size.split('x').map(Number);
  const env = await startServers({ port: 5471 + idx, sigPort: 9471 + idx });
  const files = [];
  let page;
  try {
    page = await openPlayer(env, { name: 'Mert', lang: 'de', quality: 'low', width, height, renderSkip: 12 });
    await page.evaluate(([t, s]) => { window.__nvPlanTimes = t; window.__nvPlanSeed = s; }, [TIMES, seed]);
    await page.evaluate(() => window.__nv.start(null));
    await until(() => page.evaluate(() => !!window.__nv.player), 150000);
    await page.evaluate(() => window.__nv.plan.start());
    let n = 0;
    const shot = async (step) => {
      if (!keepTraces) await page.evaluate(() => document.querySelectorAll('.plan-ov .ln.trace').forEach((e) => e.remove()));
      await page.mouse.move(0, 0);
      const file = path.join(out, `${++n}-${step}-${size}.png`);
      await page.screenshot({ path: file });
      files.push(file);
    };
    const step = async (ph, step, extra) => {
      if (!(await domPhase(page, ph))) throw new Error('phase never drawn: ' + ph);
      if (ph !== 'stake') await sleep(600); // card animations
      await shot(step);
      if (extra) await extra();
    };
    await step('stake', 'stake');
    await step('brief', 'brief', () => click(page, '[data-act="confirm"]'));
    await step('scout', 'scout', async () => {
      for (const id of ['besichtigung', 'parkhaus', 'elektriker']) await click(page, `[data-scout="${id}"]`);
      await until(async () => (await pub(page)).board.scout.length === 3);
      await sleep(600);
      await shot('scout-picked');
      await click(page, '[data-act="confirm"]');
    });
    await step('facts', 'facts', () => click(page, '[data-act="confirm"]'));
    // the private offer is declined; if there is none the shop comes up by itself
    for (let g = 0; g < 100; g++) {
      const p = await pub(page);
      if (p?.phase === 'shop') break;
      if (p?.phase === 'offer' && (await page.$('.plan-ov [data-offer="decline"]'))) await page.click('.plan-ov [data-offer="decline"]').catch(() => {});
      await sleep(200);
    }
    await step('shop', 'shop', async () => {
      if (await page.$('.plan-ov [data-local="shop-all"]')) {
        await page.click('.plan-ov [data-local="shop-all"]');
        await sleep(600);
        await shot('shop-all');
      }
      await click(page, '[data-act="confirm"]');
    });
    await step('plan', 'plan');
    console.log(`[${size}] saved:\n  ` + files.join('\n  '));
    if (page.errors.length) console.log(`[${size}] page errors:`, page.errors);
  } finally {
    await Promise.race([env.stop(), new Promise((r) => setTimeout(r, 15000))]);
  }
}

try {
  await Promise.all(sizes.map((s, i) => run(s, i)));
} catch (e) {
  console.log('SHOTS CRASHED', e);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
