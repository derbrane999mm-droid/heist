// Screenshots of the hacking calibration level: the room, every terminal overlay, the end card.
// Run: node tests/shots-hack.mjs [quality=medium] [diff=2] [lang=en] [only,names]
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const quality = process.argv[2] || 'medium';
const diff = process.argv[3] || '2';
const lang = process.argv[4] || 'en';
const only = process.argv[5] ? process.argv[5].split(',') : null;
const tag = `d${diff}-${lang}`;
const env = await startServers({ port: 5241, sigPort: 9241 });
try {
  const page = await openPlayer(env, { name: 'Mert', quality, lang, renderSkip: 60, extra: `&level=hack&diff=${diff}&seed=20261114` });
  const shot = async (name, wait = 6000) => {
    if (only && !only.includes(name)) return;
    await page.evaluate(() => (window.__nvRenderSkip = 0));
    await sleep(wait);
    try {
      await page.screenshot({ path: `${OUT}/hack-${name}-${tag}.png`, timeout: 150000 });
      console.log('shot', name);
    } catch (e) {
      console.log('shot FAILED', name, String(e).split('\n')[0]);
    }
    await page.evaluate(() => (window.__nvRenderSkip = 60));
  };
  await shot('menu', 5000);
  await page.evaluate(() => window.__nv.start(null));
  await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 60000 });
  await sleep(1500);
  const tp = (...v) => page.evaluate((v) => window.__nv.tp(...v), v);
  const stand = async (term) => {
    await page.evaluate((term) => window.__nv.tp(...window.__nv.level.hack.stand(term)), term);
    // the host only accepts moves from someone standing at the terminal: wait until it has the new position
    await page.waitForFunction(
      (term) => {
        const p = window.__nv.session.poseOf(window.__nv.session.pid);
        const s = window.__nv.level.hack.stand(term);
        return !!p && Math.hypot(p.x - s[0], p.z - s[2]) < 0.5;
      },
      term,
      { timeout: 60000 },
    );
  };
  const open = async (term) => {
    await stand(term);
    await page.evaluate((term) => window.__nv.interactions.debugUse(term), term);
    await sleep(600);
  };
  const close = () => page.evaluate(() => window.__nv.level.hack.close());

  // ---- the room
  await tp(0, 0.02, 5.4, 0, -0.02);
  await shot('room-spawn');
  await tp(-3.6, 0.02, 4.9, 0.55, -0.03);
  await shot('room-trace-a');
  await tp(-2.0, 0.02, -0.2, Math.PI / 2, -0.02);
  await shot('room-aisle-west');
  await tp(1.2, 0.02, -2.6, 0.35, 0.03);
  await shot('room-door');
  await stand('hack-cipher-b');
  await shot('room-screen-close');
  await tp(7.9, 0.02, 4.4, 0.9, -0.02);
  await shot('room-east');

  // ---- Trace: most of the route laid, one tile still wrong, current flowing
  await stand('hack-trace-a');
  await page.evaluate(() => {
    const hk = window.__nv.level.hack;
    const L = hk.logic;
    let s = window.__nv.session.state.hack.trace;
    const plan = L.tracePlan(s);
    const last = plan[plan.length - 1];
    const moves = plan.slice(0, -1);
    for (const m of moves) s = L.traceRotate(s, m.c, m.d).state;
    // break one tile so it is not solved, then reconnect the source
    for (let c = s.n * s.n - 1; c >= 0; c--) {
      if (c === last.c) continue;
      const broken = L.traceRotate(s, c, 1).state;
      const r = L.traceRotate(broken, last.c, last.d);
      const on = L.tracePowered(r.state.n, r.state.src, r.state.tiles, r.state.rot).reduce((a, b) => a + b, 0);
      if (r.result === 'ok' && on >= 3) {
        moves.push({ c, d: 1 }, last);
        break;
      }
    }
    for (const m of moves) window.__nv.session.intent('hack.move', { s: 'trace', ...m });
  });
  await open('hack-trace-a');
  await page.evaluate(() => {
    for (const k of ['KeyD', 'KeyS']) {
      window.__nv.input.debugSet(k, true);
      window.__nv.input.debugSet(k, false);
    }
  });
  await shot('ov-trace-a', 3500);
  await close();
  await open('hack-trace-b');
  await shot('ov-trace-b', 3500);
  await close();

  // ---- Signal: tuner part of the way there
  await stand('hack-signal-a');
  await page.evaluate(() => {
    const plan = window.__nv.level.hack.plan('signal');
    for (const m of plan.slice(0, Math.max(1, plan.length - 3))) window.__nv.session.intent('hack.move', m);
  });
  await open('hack-signal-a');
  await page.evaluate(() => {
    window.__nv.input.debugSet('KeyS', true);
    window.__nv.input.debugSet('KeyS', false);
  });
  await shot('ov-signal-a', 3500);
  await close();
  await open('hack-signal-b');
  await shot('ov-signal-b', 3500);
  await close();

  // ---- Cipher: two digits typed
  await stand('hack-cipher-a');
  await page.evaluate(() => {
    const plan = window.__nv.level.hack.plan('cipher');
    for (const m of plan.slice(0, 2)) window.__nv.session.intent('hack.move', m);
  });
  await open('hack-cipher-a');
  await shot('ov-cipher-a', 3500);
  await close();
  await open('hack-cipher-b');
  await shot('ov-cipher-b', 3500);
  await close();

  // ---- a strike, then finish everything
  await stand('hack-cipher-a');
  await page.evaluate(() => {
    const s = window.__nv.session.state.hack.cipher;
    for (let i = s.entered.length; i < s.code.length; i++) window.__nv.session.intent('hack.move', { s: 'cipher', k: 1 });
    window.__nv.session.intent('hack.move', { s: 'cipher', k: 'ok' });
  });
  await sleep(1500);
  await page.evaluate(() => window.__nv.level.hack.solve('cipher'));
  await stand('hack-trace-a');
  await page.evaluate(() => window.__nv.level.hack.solve('trace'));
  await stand('hack-signal-a');
  // on higher difficulties the target wanders: tune again whenever the lock is lost
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => window.__nv.session.state.hack.signal);
    if (s.solved) break;
    if (s.lockSince === null) await page.evaluate(() => window.__nv.level.hack.solve('signal'));
    await sleep(1000);
  }
  await page.waitForFunction(() => !!window.__nv.session.state.calib?.result, null, { timeout: 60000 });
  console.log('result', JSON.stringify(await page.evaluate(() => window.__nv.session.state.calib.result)));
  await sleep(3500);
  await tp(0.9, 0.02, -2.4, 0.2, 0.03);
  await shot('done-door');
  await stand('hack-trace-a');
  await shot('done-screen', 3500);
  console.log('errors', page.errors);
} finally {
  await env.stop();
}
process.exit(0);
