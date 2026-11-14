// Screenshots of the first-person hands in a few animation states.
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const quality = process.argv[2] || 'medium';
const level = process.argv[3] || 'hideout';
const view = (process.argv[4] || '0.1,0,4.8,0,-0.03').split(',').map(Number);
const tune = process.argv[5] ? JSON.parse(process.argv[5]) : null;
const only = process.argv[6] ? process.argv[6].split(',') : null;
const STATES = {
  idle: {},
  reach: { reach: 1 },
  hold: { reach: 1, hold: 1 },
  sprint: { sprint: 1 },
  wall: { retract: 1 },
  off: { off: true },
};
const env = await startServers({ port: 5391, sigPort: 9391 });
try {
  const page = await openPlayer(env, { name: 'Mert', quality, width: 1280, height: 720, extra: `&level=${level}` });
  await page.evaluate(() => window.__nv.start(null));
  await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 90000 });
  await sleep(2000);
  await page.evaluate((v) => window.__nv.tp(...v), view);
  if (tune) await page.evaluate((t) => window.__nv.viewmodel.tune(t), tune);
  const crop = process.env.CROP === '1';
  if (crop) await page.evaluate(() => (document.getElementById('ui').style.display = 'none'));
  for (const [name, st] of Object.entries(STATES)) {
    if (only && !only.includes(name)) continue;
    await page.evaluate((st) => {
      const nv = window.__nv;
      nv.player.flashlightOn = !st.off;
      nv.viewmodel.force = { reach: st.reach ?? 0, hold: st.hold ?? 0, sprint: st.sprint ?? 0, retract: st.retract ?? 0 };
    }, st);
    await sleep(quality === 'low' ? 2000 : 6000);
    await page.screenshot({ path: `${OUT}/hands-${name}.png`, ...(crop ? { clip: { x: 240, y: 300, width: 1040, height: 420 } } : {}) });
    console.log('shot', name);
  }
  console.log('errors', page.errors);
} finally {
  await env.stop();
}
process.exit(0);
