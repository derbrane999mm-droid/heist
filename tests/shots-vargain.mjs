// Screenshot tour of the Varga interior test level (1440x900, HUD hidden).
// Usage: node tests/shots-vargain.mjs [quality=high] [view,view,...|all] [fps]
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
const DIR = `${OUT}/vargain`;
fs.mkdirSync(DIR, { recursive: true });
const quality = process.argv[2] || 'high';
const only = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',') : null;
const fps = process.argv.includes('fps');
const walk = process.argv.includes('walk');
const F = 0.27;
// tp(x, feetY, z, yaw, pitch); yaw 0 looks north (-z), +pi/2 looks west (-x)
const VIEWS = {
  liefer: { v: [-1.4, F, 0, 1.57, -0.05] },
  lager: { v: [-1.2, F, 3.6, 0.75, 0.05] },
  goods: { v: [-4.7, F, -0.6, 0, -0.2] },
  panel: { v: [-1.6, F, 2.55, -1.57, -0.05] },
  saal: { v: [-8.4, F, -0.2, 1.2, -0.08] },
  cases: { v: [-16.5, F, 0.3, 0, -0.35] },
  saalN: { v: [-14, F, -1.0, 0.25, 0.0] },
  hatch: { v: [-9.65, F, 0.6, 0, 0.9] },
  foyer: { v: [-8.5, F, 2.6, 1.57, -0.05] },
  vorder: { v: [-14.6, F, 1.6, Math.PI, -0.05] },
  flur: { v: [-11.25, F, -7.2, 0.2, -0.05] },
  wach: { v: [-16, F, -7.6, 0.75, -0.1] },
  tresor: { v: [-9.6, F, -8.4, -1.35, -0.05], vault: true },
  safe: { v: [-7.2, F, -8.0, -0.9, -0.05], vault: true },
  safeopen: { v: [-6.5, F, -7.6, -0.9, -0.05], vault: true },
  open: { v: [-15.3, F, -0.4, 0, -0.45], open: true },
  alarm: { v: [-1.2, F, 3.6, 0.75, 0.05], alarm: true },
  'dark-saal': { v: [-8.4, F, -0.2, 1.2, -0.08], off: true },
  'dark-lager': { v: [-1.2, F, 3.6, 0.75, 0.05], off: true },
  'dark-foyer': { v: [-8.5, F, 2.6, 1.57, -0.05], off: true },
};
const env = await startServers({ port: 5521, sigPort: 9521 });
try {
  const page = await openPlayer(env, { name: 'Mert', quality, lang: 'de', width: 1440, height: 900, extra: '&level=vargain' });
  await page.evaluate(() => window.__nv.start(null));
  await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 120000 });
  await sleep(2500);
  await page.evaluate(() => (document.getElementById('ui').style.display = 'none'));
  if (walk) {
    // walk the guard loop: every segment must be passable for the player capsule
    const res = await page.evaluate(async () => {
      const nv = window.__nv;
      const a = nv.level.interior.anchors;
      const pts = Object.keys(a).filter((k) => k.startsWith('guard.')).map((k) => a[k]);
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        nv.tp(p.x, p.y, p.z, Math.atan2(-(q.x - p.x), -(q.z - p.z)), 0);
        await new Promise((r) => setTimeout(r, 300));
        nv.input.debugSet('KeyW', true);
        const t0 = performance.now();
        let d = 99;
        while (performance.now() - t0 < 9000) {
          const pp = nv.player.position;
          d = Math.hypot(pp.x - q.x, pp.z - q.z);
          if (d < 0.6) break;
          nv.player.yaw = Math.atan2(-(q.x - pp.x), -(q.z - pp.z));
          await new Promise((r) => setTimeout(r, 50));
        }
        nv.input.debugSet('KeyW', false);
        out.push(`${i}->${(i + 1) % pts.length}: ${d < 0.6 ? 'ok' : 'BLOCKED d=' + d.toFixed(2)}`);
      }
      return out;
    });
    console.log(res.join('\n'));
  }
  for (const [name, view] of Object.entries(VIEWS)) {
    if (only && !only.includes(name)) continue;
    await page.evaluate((view) => {
      const nv = window.__nv;
      const it = nv.level.interior;
      it.openVaultDoor(!!view.vault);
      it.openSafe(!!view.vault && view.v[0] > -6.8);
      for (let i = 0; i < 4; i++) it.openCase(i, !!view.open && i === 2);
      it.openFrontDoor(!!view.open);
      it.openHatch(!!view.open);
      it.setAlarm(!!view.alarm);
      nv.tp(...view.v);
      nv.player.flashlightOn = !view.off;
      nv.viewmodel.force = { reach: 0, hold: 0, sprint: 0, retract: 0 };
    }, view);
    await sleep(quality === 'low' ? 2000 : 4500);
    await page.screenshot({ path: `${DIR}/vargain-${quality}-${name}.jpg`, type: 'jpeg', quality: 88 });
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
