// Screenshot tour of the HQ style sample (empty rented flat in an old building, at night).
// Usage: node tests/shots-hq.mjs [quality] [view,view,...] [nohud]
// The view "menu" is the main-menu background (no session started, #ui hidden).
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const quality = process.argv[2] || 'medium';
const only = process.argv[3] ? process.argv[3].split(',') : null;
const hud = process.argv[4] !== 'nohud';
const VIEWS = {
  hallway: { v: [2.3, 0, 4.0, 0.05, -0.05] },
  table: { v: [-0.3, 0, 1.1, -0.45, -0.35] },
  wall: { v: [1.2, 0, 0.6, -1.4, 0.02] },
  kitchen: { v: [-1.0, 0, 0.9, 2.2, -0.3] },
  sleeping: { v: [1.2, 0, 0.9, 1.25, -0.25] },
  bags: { v: [1.0, 0, 2.1, -1.1, -0.35] },
  windows: { v: [0.4, 0, 2.0, 0.05, 0.05] },
  entrance: { v: [1.0, 0, 3.6, -1.5, -0.05] },
  lighton: { v: [-1.4, 0, 2.0, -0.75, -0.1], light: true },
};
const env = await startServers({ port: 5393, sigPort: 9393 });
try {
  const page = await openPlayer(env, { name: 'Mert', quality, lang: 'de', width: 1280, height: 720, extra: '&level=hq' });
  const menuTimes = (only ?? []).filter((n) => n.startsWith('menu'));
  if (menuTimes.length) {
    // main-menu background: wait for loading to finish, no session
    await page.waitForFunction(() => !!window.__nv && !!window.__nv.level, null, { timeout: 150000 });
    await page.evaluate(() => (document.getElementById('ui').style.display = 'none'));
    await sleep(quality === 'low' ? 3000 : 8000);
    for (const name of menuTimes) {
      await page.screenshot({ path: `${OUT}/hq-${name}.jpg`, type: 'jpeg', quality: 88 });
      console.log('shot', name);
      if (menuTimes.length > 1) await sleep(12000);
    }
    await page.evaluate(() => (document.getElementById('ui').style.display = ''));
  }
  const rest = Object.entries(VIEWS).filter(([n]) => !only || only.includes(n));
  if (rest.length) {
    await page.evaluate(() => window.__nv.start(null));
    await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 120000 });
    await sleep(2500);
    if (!hud) await page.evaluate(() => (document.getElementById('ui').style.display = 'none'));
    for (const [name, view] of rest) {
      await page.evaluate((view) => {
        const nv = window.__nv;
        nv.tp(...view.v);
        nv.player.flashlightOn = false;
        nv.viewmodel.force = { reach: 0, hold: 0, sprint: 0, retract: 0, ...(view.f ?? {}) };
        if (view.light) nv.interactions.debugUse('hq.switch');
      }, view);
      await sleep(quality === 'low' ? 2000 : 6500);
      await page.screenshot({ path: `${OUT}/hq-${name}.jpg`, type: 'jpeg', quality: 88 });
      console.log('shot', name);
      if (view.light) await page.evaluate(() => window.__nv.interactions.debugUse('hq.switch'));
    }
  }
  console.log('errors', JSON.stringify(page.errors).slice(0, 600));
} finally {
  await env.stop();
}
process.exit(0);
