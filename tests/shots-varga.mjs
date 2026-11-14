// Screenshot tour of the Varga delivery-yard style sample (1440x900, HUD hidden).
// Usage: node tests/shots-varga.mjs [quality=high] [view,view,...|all] [fps]
//   fps: also measure the frame rate (requestAnimationFrame) at a few views.
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
const DIR = `${OUT}/varga`;
fs.mkdirSync(DIR, { recursive: true });
const quality = process.argv[2] || 'high';
const only = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',') : null;
const fps = process.argv.includes('fps');
const K = 0.12; // pavement / yard height
// tp(x, feetY, z, yaw, pitch); yaw 0 looks north (-z), +pi/2 looks west (-x)
const VIEWS = {
  van: { v: [1.9, 0, 8.3, 0.12, -0.03] },
  pavement: { v: [-0.6, K, 6.1, -0.95, -0.04] },
  gate: { v: [2.4, K, 6.3, 0.33, -0.06] },
  yard: { v: [5.2, K, 3.9, 0.6, -0.1] },
  door: { v: [3.0, K, 0.9, 1.3, 0.12] },
  back: { v: [1.0, K + 0.15, 0.1, -2.93, -0.02] },
  'door-open': { v: [3.0, K, 0.9, 1.3, 0.05], open: true },
  'dark-yard': { v: [5.2, K, 3.9, 0.6, -0.1], off: true },
  'dark-street': { v: [-2.4, K, 6.2, -1.5, -0.04], off: true },
  // the interior in the same scene (floor 0.27)
  front: { v: [-14.6, K, 8.0, 0, 0.02] },
  'door-in': { v: [-4.0, 0.27, 0.6, -1.57, 0.0], open: true },
  lager: { v: [-1.2, 0.27, 3.6, 0.75, 0.05] },
  saal: { v: [-8.4, 0.27, -2.4, 1.57, 0.0] },
  foyer: { v: [-14.6, 0.27, 3.6, Math.PI, 0.05] },
  flur: { v: [-13.5, 0.27, -8.6, -1.57, 0.0] },
  tresor: { v: [-7.2, 0.27, -8.4, -1.9, -0.1] },
};
const env = await startServers({ port: 5402, sigPort: 9402 });
try {
  const page = await openPlayer(env, { name: 'Mert', quality, lang: 'de', width: 1440, height: 900, extra: '&level=varga' });
  await page.evaluate(() => (document.getElementById('ui').style.display = 'none'));
  if (!only || only.includes('menu')) {
    await sleep(5000);
    await page.screenshot({ path: `${DIR}/varga-${quality}-menu.jpg`, type: 'jpeg', quality: 88 });
    console.log('shot menu');
  }
  await page.evaluate(() => window.__nv.start(null));
  await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 120000 });
  await sleep(2500);
  await page.evaluate(() => (document.getElementById('ui').style.display = 'none'));
  for (const [name, view] of Object.entries(VIEWS)) {
    if (only && !only.includes(name)) continue;
    await page.evaluate((view) => {
      const nv = window.__nv;
      nv.tp(...view.v);
      nv.player.flashlightOn = !view.off;
      nv.level.openDeliveryDoor?.(!!view.open);
      nv.viewmodel.force = { reach: 0, hold: 0, sprint: 0, retract: 0 };
    }, view);
    await sleep(quality === 'low' ? 2000 : 5000);
    await page.screenshot({ path: `${DIR}/varga-${quality}-${name}.jpg`, type: 'jpeg', quality: 88 });
    if (fps) {
      const f = await page.evaluate(
        () =>
          new Promise((res) => {
            let n = 0;
            const t0 = performance.now();
            const tick = () => {
              n++;
              if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
              else res(((n - 1) * 1000) / (performance.now() - t0));
            };
            requestAnimationFrame(tick);
          }),
      );
      const info = await page.evaluate(() => window.__nv.engine?.screenshotInfo?.() ?? null);
      console.log('shot', name, 'fps', f.toFixed(1), info ? JSON.stringify(info) : '');
    } else console.log('shot', name);
  }
  console.log('errors', JSON.stringify(page.errors).slice(0, 600));
} finally {
  await env.stop();
}
process.exit(0);
