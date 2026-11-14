// Screenshot tour of the casino style sample.
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const quality = process.argv[2] || 'medium';
const only = process.argv[3] ? process.argv[3].split(',') : null;
const hud = process.argv[4] !== 'nohud';
const VIEWS = {
  entrance: { v: [-0.2, 0, 8.6, 0, -0.05] },
  slots: { v: [-4.9, 0, 3.6, 1.45, -0.03] },
  table: { v: [0.9, 0, 4.9, 0.55, -0.3] },
  cage: { v: [3.4, 0, -5.6, -0.12, -0.03] },
  door: { v: [-3.75, 0, -9.35, 0.2, -0.06], f: { reach: 1 } },
  lounge: { v: [4.4, 0, 7.4, -2.24, -0.12] },
  dark: { v: [-0.2, 0, 8.6, 0, -0.05], off: true },
};
const env = await startServers({ port: 5392, sigPort: 9392 });
try {
  const page = await openPlayer(env, { name: 'Mert', quality, lang: 'de', width: 1280, height: 720, extra: '&level=casino' });
  await page.evaluate(() => window.__nv.start(null));
  await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 120000 });
  await sleep(2500);
  if (!hud) await page.evaluate(() => (document.getElementById('ui').style.display = 'none'));
  for (const [name, view] of Object.entries(VIEWS)) {
    if (only && !only.includes(name)) continue;
    await page.evaluate((view) => {
      const nv = window.__nv;
      nv.tp(...view.v);
      nv.player.flashlightOn = !view.off;
      nv.viewmodel.force = { reach: 0, hold: 0, sprint: 0, retract: 0, ...(view.f ?? {}) };
    }, view);
    await sleep(quality === 'low' ? 2000 : 6500);
    await page.screenshot({ path: `${OUT}/casino-${name}.jpg`, type: 'jpeg', quality: 88 });
    console.log('shot', name);
  }
  console.log('errors', JSON.stringify(page.errors).slice(0, 600));
} finally {
  await env.stop();
}
process.exit(0);
