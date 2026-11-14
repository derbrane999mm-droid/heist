// The night watchman in the calibration level `guard`: host + one client, difficulty 1 (one guard).
//   node tests/guard.mjs
import { startServers, openPlayer, sleep } from './harness.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 20000, step = 120) => {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
};

const st = (page) => page.evaluate(() => window.__nv.level.debug.state());
const events = (page) => page.evaluate(() => window.__nv.level.debug.events.slice());
const clearEvents = (page) => page.evaluate(() => (window.__nv.level.debug.events.length = 0));
const dbg = (page, fn, ...args) => page.evaluate(([fn, args]) => window.__nv.level.debug[fn](...args), [fn, args]);
const tp = (page, x, z, yaw = 0) => page.evaluate((v) => window.__nv.tp(...v), [x, 0.02, z, yaw, 0]);
const pidOf = (page) => page.evaluate(() => window.__nv.session.pid);
const clearMeters = (page) => page.evaluate(() => (window.__nv.level.debug.hooks.sim().meters = {}));
const hudText = (page) => page.evaluate(() => document.querySelector('.gd-label')?.textContent ?? '');
const ang = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

const env = await startServers({ port: 5551, sigPort: 9551 });
const opt = { width: 420, height: 240, quality: 'low', renderSkip: 12, extra: '&level=guard&diff=1' };
const t0 = Date.now();
const lap = (label) => console.log(`---- ${label}  (+${Math.round((Date.now() - t0) / 1000)} s)`);
try {
  // ================================================================ host alone
  const host = await openPlayer(env, { ...opt, name: 'Host' });
  await host.evaluate(() => window.__nv.start(null));
  await until(() => host.evaluate(() => !!window.__nv.player), 90000);
  const hostPid = await pidOf(host);
  await dbg(host, 'noFail', true);
  await sleep(800);
  lap('host');
  let s = await st(host);
  check('guards start active on the host: one guard at diff 1, visible', s.on && s.guards.length === 1 && s.guards[0].visible);
  check('HUD indicator hidden while nobody looks', !(await host.evaluate(() => window.__nv.level.debug.state().hud.shown)) && (await host.evaluate(() => document.querySelector('.gd-hud').classList.contains('gd-hidden'))));
  const g0 = s.guards[0];
  await sleep(2000);
  s = await st(host);
  check('he walks his round', Math.hypot(s.guards[0].x - g0.x, s.guards[0].z - g0.z) > 1.5 && s.guards[0].st === 0);

  // the host steps in front of him: alert, then the guard is held there (late join test below)
  await dbg(host, 'hold', true);
  await dbg(host, 'place', 0, 0, 4.5, -Math.PI / 2);
  await tp(host, 3.5, 4.5, Math.PI / 2);
  const hostAlert = await until(async () => (await events(host)).some((e) => e.type === 'alert' && e.pid === hostPid), 8000, 80);
  check('host standing in his path: alert event with his id', !!hostAlert, JSON.stringify(await events(host)));
  check('host HUD turns red and says spotted', (await st(host)).hud.red && (await hudText(host)) === 'Spotted');
  await tp(host, 4, 11);

  // ================================================================ a client joins late
  const code = await host.evaluate(() => window.__nv.session.code);
  const client = await openPlayer(env, { ...opt, name: 'Anna', lang: 'de' });
  await client.evaluate((c) => window.__nv.start(c), code);
  await until(async () => (await host.evaluate(() => window.__nv.session.players.size)) === 2 && (await client.evaluate(() => window.__nv.session?.players.size ?? 0)) === 2, 90000);
  await until(() => client.evaluate(() => !!window.__nv.player), 60000);
  const clientPid = await pidOf(client);
  lap('client joined');
  const late = await until(async () => {
    const c = await st(client);
    return c.on && c.guards[0].visible && c.guards[0].st === 2 && Math.hypot(c.guards[0].x - 0, c.guards[0].z - 4.5) < 0.1 ? c : false;
  }, 15000);
  check('late joiner gets the current state: guard on, where he stands, still alert', !!late, JSON.stringify((await st(client)).guards));

  // ---- the guard is the same on both peers
  await dbg(host, 'place', 0, -6, 4.5, -Math.PI / 2);
  await sleep(1200);
  let hs = await st(host);
  let cs = await st(client);
  check('held guard: same position and facing on host and client', Math.hypot(hs.guards[0].x - cs.guards[0].x, hs.guards[0].z - cs.guards[0].z) < 0.1 && ang(hs.guards[0].yaw, cs.guards[0].yaw) < 0.05 && cs.guards[0].st === 0);
  await dbg(host, 'hold', false);
  await sleep(2500);
  const pair = await Promise.all([st(host), st(client)]);
  hs = pair[0];
  cs = pair[1];
  const off = Math.hypot(hs.guards[0].x - cs.guards[0].x, hs.guards[0].z - cs.guards[0].z);
  check('walking guard: client follows within half a metre', Math.hypot(hs.guards[0].x + 6, hs.guards[0].z - 4.5) > 1.5 && off < 0.6, `off ${off.toFixed(2)} m`);

  // ---- the client stands in his path: meter rises, alert on both pages
  await dbg(host, 'hold', true);
  await clearEvents(host);
  await clearEvents(client);
  await clearMeters(host);
  await dbg(host, 'place', 0, 0, 4.5, -Math.PI / 2);
  await sleep(400);
  await client.evaluate(() => {
    window.__gdMax = 0;
    clearInterval(window.__gdTimer);
    window.__gdTimer = setInterval(() => {
      const m = window.__nv.level.debug.state().me;
      if (m < 1) window.__gdMax = Math.max(window.__gdMax, m);
    }, 40);
  });
  await tp(client, 4, 4.5, Math.PI / 2);
  const alertHost = await until(async () => (await events(host)).find((e) => e.type === 'alert' && e.pid === clientPid), 10000, 80);
  const alertClient = await until(async () => (await events(client)).find((e) => e.type === 'alert' && e.pid === clientPid), 5000, 80);
  const partial = await client.evaluate(() => window.__gdMax);
  check('client in his path: his meter fills step by step on the client', partial > 0.1 && partial < 1, partial.toFixed(2));
  check('alert event with the client’s id on the host', !!alertHost, JSON.stringify(alertHost));
  check('... and on the client', !!alertClient && alertClient.guard === 0);
  check('the suspicious event came first', (await events(client)).findIndex((e) => e.type === 'suspicious') === 0);
  await until(async () => (await st(client)).hud.red, 3000);
  check('client HUD is red and German', (await st(client)).hud.red && (await hudText(client)) === 'Entdeckt');
  check('the host HUD is not about the host this time', !(await st(host)).hud.red);

  // ---- hiding: in the coat niche he does not see you unless he stands right there
  await tp(client, 4, 11);
  await sleep(300);
  await dbg(host, 'place', 0, 9.6, 2.6, Math.atan2(-(11.45 - 9.6), -(0 - 2.6)));
  await clearMeters(host);
  await clearEvents(host);
  await tp(client, 11.45, 0, Math.PI / 2);
  await sleep(2500);
  const hidMeter = (await st(host)).meters[clientPid] ?? 0;
  check('in the hiding spot 2.5 m from him: not seen', hidMeter === 0 && !(await events(host)).length, `meter ${hidMeter}`);
  await dbg(host, 'place', 0, 10.25, 0.3, -Math.PI / 2);
  const close = await until(async () => ((await st(host)).meters[clientPid] ?? 0) > 0.05, 4000, 80);
  check('... but seen when he stands within 1.5 m', !!close);
  await tp(client, 4, 11);
  await clearMeters(host);

  // ---- noise and distraction (host API), events reach the client
  await dbg(host, 'place', 0, 0, 4.5, -Math.PI / 2);
  await dbg(host, 'hold', false);
  await sleep(300);
  await clearEvents(host);
  await clearEvents(client);
  await host.evaluate(() => window.__nv.level.debug.guards.noise(-3, 4.5, 6));
  const heard = await until(async () => (await st(client)).guards[0].st === 1 && (await events(client)).some((e) => e.type === 'suspicious' && e.x === -3), 4000);
  check('a noise makes him suspicious, client sees it', !!heard);
  const back = await until(async () => (await events(host)).some((e) => e.type === 'calm'), 30000, 250);
  check('he looks around and calms down again', !!back && (await st(host)).guards[0].st === 0);
  const d1 = await host.evaluate(() => window.__nv.level.debug.guards.distract(8, 5));
  const d2 = await host.evaluate(() => window.__nv.level.debug.guards.distract(8, 5));
  check('distraction works once, then waits for its cooldown', d1 === true && d2 === false && (await st(host)).guards[0].st === 1 && (await st(host)).cooldown > 5);

  // ---- switched off: gone on both peers
  await host.evaluate(() => window.__nv.level.debug.guards.setActive(false));
  const off2 = await until(async () => !(await st(client)).on && !(await st(client)).guards[0].visible && !(await st(host)).guards[0].visible, 5000);
  check('setActive(false) hides the guard on host and client', !!off2);
  await host.evaluate(() => window.__nv.level.debug.guards.setActive(true));
  const on2 = await until(async () => (await st(client)).guards[0].visible, 5000);
  check('setActive(true) brings him back at the start of his round', !!on2 && Math.hypot((await st(host)).guards[0].x + 10, (await st(host)).guards[0].z - 4.5) < 1.5);

  // ---- texts and errors
  check('both languages have all texts', (await host.evaluate(() => window.__nv.missingTranslations())).length === 0 && (await client.evaluate(() => window.__nv.missingTranslations())).length === 0);
  check('objective in English and German', (await host.evaluate(() => window.__nv.level.objective()[0])).startsWith('Reach') && (await client.evaluate(() => window.__nv.level.objective()[0])).startsWith('Erreicht'));
  check('no page errors', host.errors.length === 0 && client.errors.length === 0, [...host.errors, ...client.errors].slice(0, 4).join(' || '));
  lap('done');
} catch (e) {
  console.log('TEST CRASHED', e);
  failed++;
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
