// Screenshots of the night watchman in the calibration level `guard`.
//   node tests/shots-guard.mjs [quality]      -> test-out/guard/*.png
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(OUT, 'guard');
fs.mkdirSync(dir, { recursive: true });
const quality = process.argv[2] || 'medium';

// name: player [x, z, yaw, pitch], guard [x, z, yaw], hold?, wait ms
const VIEWS = {
  walking: { me: [-7, 3.2, -1.45, -0.06], guard: [-3.6, 4.5, -Math.PI / 2], hold: false, wait: 1200 },
  noticed: { me: [4.6, 3.6, 1.75, -0.08], guard: [1.2, 4.6, -1.0], hold: true, wait: 900 },
  north: { me: [9.4, -7.6, 1.75, -0.05], guard: [1.5, -8.6, -0.9], hold: true, wait: 300 },
};

const env = await startServers({ port: 5553, sigPort: 9553 });
let failed = 0;
try {
  const page = await openPlayer(env, { name: 'Mert', quality, width: 1120, height: 630, renderSkip: 40, extra: '&level=guard&diff=1' });
  await page.evaluate(() => window.__nv.start(null));
  await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 120000 });
  await sleep(1500);
  for (const [name, v] of Object.entries(VIEWS)) {
    await page.evaluate(([v]) => {
      const d = window.__nv.level.debug;
      d.noFail(true);
      d.hold(true);
      d.place(0, ...v.guard);
      window.__nv.tp(v.me[0], 0.02, v.me[1], v.me[2], v.me[3]);
      // forget any earlier sighting
      d.hooks.sim().meters = {};
    }, [v]);
    await page.evaluate(() => (window.__nvRenderSkip = 0));
    await sleep(quality === 'low' ? 2000 : 5000);
    await page.evaluate(([v]) => {
      const d = window.__nv.level.debug;
      d.hooks.sim().meters = {};
      d.place(0, ...v.guard);
      d.hold(v.hold);
    }, [v]);
    await sleep(v.wait);
    const file = path.join(dir, `${name}.png`);
    await page.screenshot({ path: file });
    await page.evaluate(() => (window.__nvRenderSkip = 40));
    console.log('shot', file, JSON.stringify((await page.evaluate(() => window.__nv.level.debug.state())).hud));
  }
  if (page.errors.length) {
    console.log('page errors:', page.errors.slice(0, 5));
    failed++;
  }
} catch (e) {
  console.log('CRASHED', e);
  failed++;
} finally {
  await env.stop();
}
process.exit(failed ? 1 : 0);
