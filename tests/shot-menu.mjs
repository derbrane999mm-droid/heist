import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const env = await startServers();
try {
  const q = process.argv[2] || 'high';
  const page = await openPlayer(env, { name: 'Mert', quality: q, noPause: true });
  await sleep(Number(process.argv[3] || 9000));
  await page.screenshot({ path: `${OUT}/menu-${q}.png` });
  console.log('info', await page.evaluate(() => window.__nv.engine.screenshotInfo()));
  console.log('errors', page.errors);
} finally {
  await env.stop();
}
process.exit(0);
