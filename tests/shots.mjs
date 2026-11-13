// Screenshot tour of the hideout at a given quality preset.
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const quality = process.argv[2] || 'high';
const only = process.argv[3] ? process.argv[3].split(',') : null;
const VIEWS = {
  spawn: [0.1, 0, 4.8, 0, -0.03],
  table: [1.8, 0, 2.4, 0.5, -0.12],
  vault: [-5.6, 0, 0.4, Math.PI / 2, 0.02],
  keypad: [-7.75, 0, -2.2, Math.PI / 2 + 0.05, -0.12],
  closet: [6.7, 0, -5.45, -Math.PI / 2, -0.1],
  decoder: [6.0, 0, 4.0, Math.PI, 0.04],
  van: [-1.6, 0, 0.8, 2.45, -0.05],
  custodian: [-6.3, 0, -3.6, 0.52, 0.05],
  lockers: [5.2, 0, -0.8, -Math.PI / 2, 0],
  board: [0, 0, -3.2, 0, 0.12],
};
const env = await startServers();
try {
  const page = await openPlayer(env, { name: 'Mert', quality });
  await page.evaluate(() => window.__nv.start(null));
  await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 60000 });
  await sleep(2500);
  for (const [name, v] of Object.entries(VIEWS)) {
    if (only && !only.includes(name)) continue;
    await page.evaluate((v) => window.__nv.tp(...v), v);
    await sleep(quality === 'low' ? 1500 : 5000);
    await page.screenshot({ path: `${OUT}/${name}-${quality}.png` });
    console.log('shot', name);
  }
  console.log('errors', page.errors);
} finally {
  await env.stop();
}
process.exit(0);
