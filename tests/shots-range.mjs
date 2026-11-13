// Screenshot tour of the calibration range (shooting).
//   flock /tmp/nv-browser.lock node tests/shots-range.mjs [quality] [view,view…]
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const quality = process.argv[2] || 'medium';
const only = process.argv[3] ? process.argv[3].split(',') : null;

// name: [stage, x, y, z, yaw, pitch, setup?]
const VIEWS = {
  spawn: [1, 0.4, 0, 30.7, 0.05, -0.02],
  lane: [1, -7.1, 0, 24.4, -1.42, -0.04],
  rack: [1, -6.6, 0, 19.6, -2.2, -0.02],
  ring: [2, 1.2, 0, 6.6, 0.1, -0.1],
  fight: [2, 2.2, 0, -0.6, 0.5, 0.12, 'fight'],
  sentinels: [3, 0.6, 0, -20.6, 0.05, -0.02],
  core: [3, -3.6, 0, -36.4, -2.6, 0.02],
  down: [3, 3.4, 0, -20.4, 0.3, 0, 'down'],
};

const env = await startServers({ port: 5210, sigPort: 9210 });
try {
  const page = await openPlayer(env, { name: 'Mert', quality, width: 1120, height: 630, renderSkip: 40, extra: '&level=range&diff=2' });
  const shot = async (file) => {
    await page.evaluate(() => (window.__nvRenderSkip = 0));
    await sleep(quality === 'low' ? 2500 : 7000);
    await page.screenshot({ path: `${OUT}/${file}` });
    await page.evaluate(() => (window.__nvRenderSkip = 40));
  };
  if (!only || only.includes('menu')) {
    await sleep(3000);
    await shot(`range-menu-${quality}.png`);
    console.log('shot menu');
  }
  await page.evaluate(() => window.__nv.start(null));
  await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 90000 });
  await sleep(1500);
  let stage = 1;
  for (const [name, v] of Object.entries(VIEWS)) {
    if (only && !only.includes(name)) continue;
    const [want, x, y, z, yaw, pitch, setup] = v;
    await page.evaluate(
      ([want, stage, setup]) => {
        const nv = window.__nv;
        const dbg = nv.level.debug;
        dbg.freeze(false);
        if (want !== stage) {
          nv.session.set('rng.stage', want);
          nv.session.set('rng.sent', 2);
          dbg.repopulate();
        }
        if (setup === 'fight') {
          // a wave in the air, a few of them charging
          dbg.clear();
          const at = [[-4, 2.2, -7], [0.5, 1.7, -8.5], [4.5, 2.4, -6], [-6.5, 1.9, -3], [6, 1.6, -9.5]];
          for (const [sx, sy, sz] of at) dbg.spawn({ type: 'scout', x: sx, z: sz, y: sy, yaw: Math.atan2(-(2.2 - sx), -(-0.6 - sz)), alert: true, group: 2, dmg: 0.6 });
        }
      },
      [want, stage, setup],
    );
    stage = want;
    await page.evaluate((v) => window.__nv.tp(...v), [x, y, z, yaw, pitch]);
    // let patrols move a little / attacks charge, then stop time for the picture
    await sleep(setup === 'fight' ? 2600 : 1800);
    await page.evaluate(() => window.__nv.level.debug.freeze(true));
    if (setup === 'down') {
      // solo: the overlay only shows until the lane resets, so catch it right away
      await page.evaluate(() => window.__nv.level.debug.hurt(window.__nv.session.pid, 500));
      await sleep(350);
    }
    await shot(`range-${name}-${quality}.png`);
    console.log('shot', name, JSON.stringify(await page.evaluate(() => window.__nv.level.debug.drones().map((d) => [d.type[1], d.st, +d.x.toFixed(1), +d.z.toFixed(1)]))));
  }
  console.log('info', JSON.stringify(await page.evaluate(() => window.__nv.engine.screenshotInfo())));
  console.log('errors', page.errors);
} finally {
  await env.stop();
}
process.exit(0);
