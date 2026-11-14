// Calibration range (shooting): host + one client, difficulty 1.
//   node tests/range.mjs
import { startServers, openPlayer, sleep } from './harness.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 20000, step = 150) => {
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

// ---- page helpers (everything goes through window.__nv)
const rng = (page) => page.evaluate(() => window.__nv.session?.state?.rng ?? null);
const drones = (page) => page.evaluate(() => window.__nv.level.debug.drones());
const droneById = async (page, id) => (await drones(page)).find((d) => d.id === id);
const pidOf = (page) => page.evaluate(() => window.__nv.session.pid);
const me = (page) =>
  page.evaluate(() => {
    const nv = window.__nv;
    const sh = nv.level.debug.sh;
    const p = nv.player.position;
    return { hp: sh.hp(), down: sh.isDown(), frozen: nv.player.frozen, x: p.x, y: p.y, z: p.z, ammo: sh.ammo(), aware: sh.awareness() };
  });
const tp = (page, x, z, yaw = 0, pitch = 0) => page.evaluate((v) => window.__nv.tp(...v), [x, 0.02, z, yaw, pitch]);
const dbg = (page, fn, ...args) => page.evaluate(([fn, args]) => window.__nv.level.debug[fn](...args), [fn, args]);
const use = (page, id) => page.evaluate((id) => window.__nv.interactions.debugUse(id), id);
const key = (page, code, down) => page.evaluate(([c, d]) => window.__nv.input.debugSet(c, d), [code, down]);
const visible = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return !!el && !el.classList.contains('hidden'); }, sel);
const text = (page, sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', sel);
/** Point the player's camera at a drone (as this peer sees it). */
const aimAt = (page, id) =>
  page.evaluate((id) => {
    const nv = window.__nv;
    const d = nv.level.debug.drones().find((x) => x.id === id);
    if (!d) return false;
    const e = nv.player.eye;
    const dx = d.x - e.x;
    const dy = d.y - e.y;
    const dz = d.z - e.z;
    nv.player.yaw = Math.atan2(-dx, -dz);
    nv.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return true;
  }, id);
/** Records things that only last a moment (a charge-up, a projectile in flight). */
const sample = (page) =>
  page.evaluate(() => {
    window.__smp = { charge: false, shot: false };
    clearInterval(window.__smpTimer);
    window.__smpTimer = setInterval(() => {
      const d = window.__nv.level?.debug;
      if (!d || !window.__nv.session) return;
      if (d.drones().some((x) => x.charge > 0)) window.__smp.charge = true;
      if (d.sh.shots() > 0) window.__smp.shot = true;
    }, 30);
  });
const sampled = (page) => page.evaluate(() => window.__smp);

const env = await startServers({ port: 5210, sigPort: 9210 });
const opt = { width: 420, height: 240, quality: 'low', renderSkip: 12, extra: '&level=range&diff=1' };
const t0 = Date.now();
const lap = (label) => console.log(`---- ${label}  (+${Math.round((Date.now() - t0) / 1000)} s)`);
try {
  // ================================================================ solo
  const host = await openPlayer(env, { ...opt, name: 'Host' });
  await host.evaluate(() => window.__nv.start(null));
  await until(() => host.evaluate(() => !!window.__nv.player), 60000);
  const hostPid = await pidOf(host);
  const spots = await host.evaluate(() => window.__nv.level.debug.spots);
  const cps = await host.evaluate(() => window.__nv.level.debug.checkpoints);
  await until(async () => (await drones(host)).length === 3);
  await sleep(1200);
  const countLights = () => host.evaluate(() => { let n = 0; window.__nv.engine.scene.traverse((o) => { if (o.isLight) n++; }); return n; });
  const lights0 = await countLights();
  const programs0 = await host.evaluate(() => window.__nv.engine.renderer.info.programs.length);
  lap('solo');

  let ds = await drones(host);
  check('lane A starts with three unaware scouts', ds.length === 3 && ds.every((d) => d.type === 'scout' && d.st === 0 && d.hp === 2), JSON.stringify(ds.map((d) => [d.type, d.st])));
  let s = await rng(host);
  check('run starts in stage 1 without fails', s.stage === 1 && s.fails === 0 && s.loud === false);
  check('HUD shows health, ammo and the awareness chip', (await text(host, '.sh-health b')) === '100' && (await text(host, '.sh-ammo .sh-count')).startsWith('12') && (await visible(host, '.sh-aware')));
  check('objective describes lane A', (await host.evaluate(() => window.__nv.level.objective()[0])).includes('Lane A'));

  // ---- awareness: behind cover nothing happens
  await dbg(host, 'clear');
  await tp(host, ...spots.cover.player);
  await sleep(700);
  let id = await dbg(host, 'spawn', { type: 'scout', x: spots.cover.drone[0], z: spots.cover.drone[1], yaw: spots.cover.drone[2], group: 9 });
  await sleep(3800);
  let d = await droneById(host, id);
  check('a player behind cover stays unseen: drone stays unaware', !!d && d.st === 0 && d.log.length === 0, JSON.stringify(d?.log));
  check('awareness chip says hidden', (await me(host)).aware === 0 && (await text(host, '.sh-aware')) === 'Hidden');

  // ---- awareness: in the open it goes unaware -> suspicious -> alert, then attacks
  await dbg(host, 'clear');
  await tp(host, ...spots.open.player);
  await sleep(700);
  await sample(host);
  id = await dbg(host, 'spawn', { type: 'scout', x: spots.open.drone[0], z: spots.open.drone[1], yaw: spots.open.drone[2], group: 9 });
  const alerted = await until(async () => (await droneById(host, id))?.st === 2, 15000, 100);
  d = await droneById(host, id);
  check('a player in front of a drone: unaware -> suspicious -> alert', !!alerted && JSON.stringify(d.log) === '[1,2]', JSON.stringify(d?.log));
  check('awareness chip says spotted', (await me(host)).aware === 2 && (await text(host, '.sh-aware')) === 'Spotted');
  check('being spotted does not fail anything', (await rng(host)).fails === 0);
  const hit = await until(async () => (await me(host)).hp < 100, 25000, 100);
  const smp = await sampled(host);
  check('a projectile hit lowers the player’s health', !!hit, `hp ${(await me(host)).hp}`);
  check('the attack was telegraphed: charge-up, then a projectile in flight', smp.charge && smp.shot, JSON.stringify(smp));
  check('health bar follows', Number(await text(host, '.sh-health b')) < 100);

  // ---- solo wipe: back to the checkpoint, one fail
  await dbg(host, 'freeze', true);
  await dbg(host, 'hurt', hostPid, 500);
  await until(async () => (await me(host)).down, 5000, 50);
  await sleep(350);
  let m = await me(host);
  check('at 0 health the player is down and cannot move', m.down && m.frozen && (await visible(host, '.sh-down')));
  const wiped = await until(async () => (await rng(host)).fails === 1 && !(await me(host)).down, 15000);
  await sleep(400);
  m = await me(host);
  ds = await drones(host);
  check('solo wipe counts a fail', !!wiped && (await rng(host)).fails === 1);
  check('solo wipe: back at the checkpoint with full health', !m.down && !m.frozen && m.hp === 100 && Math.hypot(m.x - cps[1][0][0], m.z - cps[1][0][1]) < 0.6, `${m.x.toFixed(1)}, ${m.z.toFixed(1)} hp ${m.hp}`);
  check('solo wipe: the lane is repopulated', ds.length === 3 && ds.every((x) => x.st === 0));
  await dbg(host, 'freeze', false);

  // ================================================================ a second player joins a run in progress
  const code = await host.evaluate(() => window.__nv.session.code);
  const client = await openPlayer(env, { ...opt, name: 'Anna', lang: 'de' });
  await client.evaluate((c) => window.__nv.start(c), code);
  await until(async () => (await host.evaluate(() => window.__nv.session.players.size)) === 2 && (await client.evaluate(() => window.__nv.session?.players.size ?? 0)) === 2, 90000);
  await until(() => client.evaluate(() => !!window.__nv.player), 60000);
  const clientPid = await pidOf(client);
  lap('client joined');
  check('late joiner gets the run state', (await rng(client))?.fails === 1 && (await rng(client))?.stage === 1);

  // ---- drones are the same on both peers
  await dbg(host, 'freeze', true);
  await sleep(1500);
  let hd = await drones(host);
  let cd = await until(async () => { const x = await drones(client); return x.length === hd.length ? x : false; }, 15000);
  const same = !!cd && hd.every((a) => { const b = cd.find((x) => x.id === a.id); return b && b.type === a.type && b.st === a.st && b.hp === a.hp && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.15 && Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw))) < 0.1; });
  check('drones exist and are the same on host and client', same, `${hd.length} / ${cd ? cd.length : 0}`);
  await dbg(host, 'freeze', false);
  await sleep(2500);
  const hd2 = await drones(host);
  cd = await drones(client);
  const moved = hd2.some((a) => { const b = hd.find((x) => x.id === a.id); return b && Math.hypot(a.x - b.x, a.z - b.z) > 0.4; });
  const follows = hd2.every((a) => { const b = cd.find((x) => x.id === a.id); return b && Math.hypot(a.x - b.x, a.z - b.z) < 1.6; });
  check('patrolling drones move, and the client follows them', moved && follows);
  check('client HUD is German', (await text(client, '.sh-aware')) === 'Unentdeckt');

  // ---- a projectile fired on the host is seen by the client
  await dbg(host, 'clear');
  await tp(client, ...spots.cover.player);
  await tp(host, ...spots.open.player);
  await sleep(700);
  await sample(client);
  const hp0 = (await me(host)).hp;
  id = await dbg(host, 'spawn', { type: 'scout', x: spots.open.drone[0], z: spots.open.drone[1], yaw: spots.open.drone[2], alert: true, group: 9 });
  await until(async () => (await me(host)).hp < hp0 - 1, 25000, 100);
  await sleep(300);
  check('client sees the charge and the projectile, and the host’s health', (await sampled(client)).charge && (await sampled(client)).shot && (await client.evaluate((p) => window.__nv.level.debug.sh.hp(p), hostPid)) < 100, JSON.stringify(await sampled(client)));

  // ---- a reported hit damages and destroys a scout on both peers
  await dbg(host, 'freeze', true);
  await dbg(host, 'clear');
  await tp(host, ...spots.cover.player);
  await tp(client, ...spots.open.player);
  await sleep(600);
  id = await dbg(host, 'spawn', { type: 'scout', x: spots.open.drone[0], z: spots.open.drone[1], yaw: spots.open.drone[2], group: 9 });
  await until(async () => !!(await droneById(client, id)));
  await sleep(500);
  await aimAt(client, id);
  await sleep(500);
  check('client fires the pistol', (await dbg(client, 'fire')) === true && (await me(client)).ammo === 11);
  const hurt1 = await until(async () => (await droneById(host, id))?.hp === 1 && (await droneById(client, id))?.hp === 1, 8000);
  check('first hit damages the scout on both peers', !!hurt1);
  check('the hit drone turns on its attacker', (await droneById(host, id))?.st === 2);
  check('hit marker is shown', await client.evaluate(() => document.querySelector('.sh-hit').classList.contains('on')));
  await aimAt(client, id);
  await sleep(400);
  await dbg(client, 'fire');
  const gone = await until(async () => !(await droneById(host, id)) && !(await droneById(client, id)), 10000);
  check('second hit destroys the scout on both peers', !!gone);
  // a claim the host cannot believe: a drone that does not exist, a shot from 300 m away
  await client.evaluate(() => window.__nv.session.intent('sh.fire', { e: [0, 1, 0], id: 99, part: 'core' }));
  await sleep(300);
  check('nonsense hit reports are ignored', (await host.evaluate(() => window.__nv.session.status)) !== 'closed' && (await host.evaluate(() => window.__nv.level.debug.drones().length)) === 0);

  // ---- sentinel: shield in front, core at the back
  await tp(client, 0, 23.7);
  await sleep(600);
  id = await dbg(host, 'spawn', { type: 'sentinel', x: 5, z: 23.7, yaw: Math.PI / 2, group: 9 }); // looks down -x, at the client
  await until(async () => !!(await droneById(client, id)));
  await sleep(500);
  await aimAt(client, id);
  await sleep(500);
  await dbg(client, 'fire');
  const absorbed = await until(async () => { const x = await droneById(host, id); return x && x.shield < 1 ? x : false; }, 8000);
  check('sentinel: the front shield absorbs the shot', !!absorbed && absorbed.hp === 8, JSON.stringify(absorbed && [absorbed.hp, absorbed.shield]));
  await sleep(300);
  await client.evaluate((id) => window.__nv.session.intent('sh.fire', { e: [4, 1.6, 23.7], id, part: 'core' }), id);
  await sleep(500);
  check('sentinel: the host does not believe a core hit from the front', (await droneById(host, id)).hp === 8);
  await tp(client, 7.4, 23.7); // behind it
  await sleep(600);
  await aimAt(client, id);
  await sleep(500);
  await dbg(client, 'fire');
  const cored = await until(async () => (await droneById(host, id))?.hp === 4 && (await droneById(client, id))?.hp === 4, 8000);
  check('sentinel: a hit on the core from behind does heavy damage', !!cored, String((await droneById(host, id))?.hp));
  await aimAt(client, id);
  await sleep(400);
  await dbg(client, 'fire');
  check('sentinel: two core hits destroy it', !!(await until(async () => !(await droneById(host, id)) && !(await droneById(client, id)), 10000)));
  lap('hits');

  // ---- silent takedown from behind
  await dbg(host, 'clear');
  await dbg(host, 'freeze', false);
  await tp(client, 5.5, 23.7, Math.PI / 2); // 1.5 m behind a drone that looks down -x
  await sleep(700);
  id = await dbg(host, 'spawn', { type: 'scout', x: 4, z: 23.7, yaw: Math.PI / 2, group: 9 });
  const other = await dbg(host, 'spawn', { type: 'scout', x: -5, z: 11.4, yaw: Math.PI / 2, group: 9 });
  await until(async () => !!(await droneById(client, id)));
  const prompt = await until(async () => (await visible(client, '.sh-prompt')) && (await text(client, '.sh-prompt')), 8000);
  check('behind an unaware drone the takedown prompt appears', typeof prompt === 'string' && prompt.includes('Drohne'), String(prompt));
  await key(client, 'KeyE', true);
  const off = await until(async () => (await droneById(host, id))?.st === 4, 10000, 100);
  await key(client, 'KeyE', false);
  check('holding E shuts the drone down', !!off);
  await sleep(1500);
  check('the takedown is silent: the other drone stays unaware', (await droneById(host, other))?.st === 0 && (await droneById(host, other)).log.length === 0);
  check('the husk is replicated', (await droneById(client, id))?.st === 4);
  // from the front it does not work
  await dbg(host, 'freeze', true);
  await tp(client, -6.5, 11.4, -Math.PI / 2);
  await sleep(800);
  check('no takedown prompt in front of a drone', !(await visible(client, '.sh-prompt')));
  lap('takedown');

  // ---- downed + revive across two players
  await dbg(host, 'clear');
  await tp(client, -2, 23.7);
  await tp(host, 4, 23.7);
  await sleep(700);
  await dbg(host, 'hurt', clientPid, 500);
  const downBoth = await until(async () => (await me(client)).down && (await host.evaluate((p) => window.__nv.level.debug.sh.isDown(p), clientPid)), 8000);
  check('a downed player is down on both peers', !!downBoth && (await me(client)).frozen && (await visible(client, '.sh-down')));
  await sleep(2600);
  check('one player down is not a wipe', (await rng(host)).fails === 1 && (await me(client)).down);
  check('too far away: no revive prompt', !(await visible(host, '.sh-prompt')));
  await tp(host, -1, 23.7, Math.PI / 2);
  const rp = await until(async () => (await visible(host, '.sh-prompt')) && (await text(host, '.sh-prompt')), 8000);
  check('next to a downed crew member the revive prompt appears', typeof rp === 'string' && rp.includes('Anna'), String(rp));
  const tRev = Date.now();
  await key(host, 'KeyE', true);
  await until(async () => !!(await client.evaluate((p) => window.__nv.session.state.sh.rev[p], clientPid)), 5000, 50);
  check('the downed player sees who is helping', (await text(client, '.sh-down p')).includes('Host'));
  const up = await until(async () => !(await me(client)).down, 12000, 100);
  const revMs = Date.now() - tRev;
  await key(host, 'KeyE', false);
  await sleep(500);
  m = await me(client);
  check('holding E for about 2 s revives the crew member', !!up && revMs > 1500 && !m.down && !m.frozen && m.hp >= 30 && m.hp <= 70, `${revMs} ms, hp ${m.hp}`);
  check('revive is visible on the host too', !(await host.evaluate((p) => window.__nv.level.debug.sh.isDown(p), clientPid)));

  // ---- everyone down: crew wipe
  await dbg(host, 'hurt', clientPid, 500);
  await dbg(host, 'hurt', hostPid, 500);
  const wipe2 = await until(async () => (await rng(host)).fails === 2 && !(await me(host)).down && !(await me(client)).down, 15000);
  await sleep(600);
  m = await me(client);
  check('whole crew down: fail counted, everyone back at the checkpoint', !!wipe2 && Math.hypot(m.x - cps[1][1][0], m.z - cps[1][1][1]) < 0.6 && (await rng(client)).fails === 2, `${m.x.toFixed(1)}, ${m.z.toFixed(1)}`);
  lap('revive + wipe');

  // ================================================================ the three lanes
  // lane A: going loud is allowed, the console ends it
  await dbg(host, 'freeze', true);
  await host.evaluate(() => window.__nv.level.debug.sh.alertAll());
  await until(async () => (await rng(client)).loud === true, 8000);
  check('lane A turns loud when the crew is spotted', (await rng(client)).loud === true && (await rng(client)).stage === 1);
  await client.evaluate(() => window.__nv.session.intent('rng.console'));
  await sleep(600);
  check('the console cannot be used from across the hall', (await rng(host)).stage === 1);
  // the door to lane B is shut: walking into it goes nowhere
  await tp(host, 0, 9.6, 0);
  await sleep(400);
  await key(host, 'KeyW', true);
  await sleep(1800);
  await key(host, 'KeyW', false);
  check('the door to lane B is closed during lane A', (await me(host)).z > 8.4, `z ${(await me(host)).z.toFixed(2)}`);
  await tp(host, ...spots.console, Math.PI);
  await sleep(700);
  check('console is usable', (await use(host, 'rng-console')) === true);
  await until(async () => (await rng(client)).stage === 2, 8000);
  s = await rng(client);
  check('lane A done: stage 2 on both peers, scouts shut down', s.stage === 2 && (await host.evaluate(() => window.__nv.level.debug.sh.alive())) === 0);
  await dbg(host, 'freeze', false);

  // lane B: start the uplink, hold the ring
  await dbg(host, 'setHoldMs', 9000);
  await sleep(1800); // the door needs a moment
  await tp(client, 0.5, 9.6, 0);
  await sleep(400);
  await key(client, 'KeyW', true);
  const through = await until(async () => (await me(client)).z < 7.2, 12000, 100);
  await key(client, 'KeyW', false);
  check('the door is open now: the client walks through into lane B', !!through, `z ${(await me(client)).z.toFixed(2)}`);
  await tp(client, 0.8, 5.5);
  await tp(host, ...spots.beacon, 0);
  await sleep(700);
  check('beacon is usable', (await use(host, 'rng-beacon')) === true);
  await until(async () => (await rng(client)).hold.started === true && (await rng(client)).hold.on === true, 8000);
  check('uplink runs while someone stands in the ring', (await rng(client)).hold.on === true);
  const wave = await until(async () => { const x = (await drones(client)).filter((q) => q.st <= 2); return x.length >= 2 && x.every((q) => q.type === 'scout' && q.st === 2 && q.group === 2) ? x : false; }, 15000);
  check('a wave of alert scouts comes out of the vents', !!wave, String(wave && wave.length));
  await tp(host, 0, 6.4);
  const paused = await until(async () => (await rng(client)).hold.on === false || (await rng(client)).stage === 3, 6000, 100);
  check('uplink pauses when nobody is in the ring', !!paused && (await rng(client)).stage === 2);
  check('objective tells the crew to get back in', (await client.evaluate(() => window.__nv.level.objective()[1])).includes('pausiert'));
  await tp(host, ...spots.beacon, 0);
  const st3 = await until(async () => (await rng(client)).stage === 3, 30000);
  check('lane B done after the hold time', !!st3);
  lap('lane B');

  // lane C: sentinels guard the switch
  const guards = await until(async () => { const x = await drones(client); return x.filter((q) => q.type === 'sentinel' && q.st === 0).length === 2 && x.filter((q) => q.type === 'scout' && q.st === 0).length === 2 ? x : false; }, 20000);
  check('lane C: two sentinels and two scouts on difficulty 1, unaware', !!guards, JSON.stringify((await drones(client)).map((q) => [q.type, q.st])));
  await dbg(host, 'freeze', true);
  await tp(client, ...spots.switch, 0);
  await tp(host, 0.8, -15.3);
  await sleep(700);
  check('the switch is locked while sentinels are active', (await use(client, 'rng-switch')) === false && (await rng(client)).sent === 2);
  await client.evaluate(() => window.__nv.session.intent('rng.switch'));
  await sleep(500);
  check('the host refuses the switch too', (await rng(host)).stage === 3 && !(await host.evaluate(() => window.__nv.session.state.calib)));
  for (const g of guards.filter((q) => q.type === 'sentinel')) await dbg(host, 'kill', g.id);
  await until(async () => (await rng(client)).sent === 0, 8000);
  check('sentinel count reaches zero', (await rng(client)).sent === 0);
  check('the switch works once they are down', (await use(client, 'rng-switch')) === true);
  const res = await until(async () => (await client.evaluate(() => window.__nv.session.state.calib?.result)) && (await host.evaluate(() => window.__nv.session.state.calib?.result)), 10000);
  check('completing the stages sets calib.result', !!res && res.level === 'range' && res.diff === 1 && res.fails === 2 && res.stars === 2 && res.timeMs > 10000, JSON.stringify(res));
  check('stage is finished on both peers', (await rng(host)).stage === 4 && (await rng(client)).stage === 4);
  await sleep(500);
  check('end card is shown on both peers', (await visible(host, '.rng-card')) && (await visible(client, '.rng-card')) && (await text(client, '.rng-card')).includes('★') && (await text(host, '.rng-card h2')) === 'Range cleared');
  check('objective says the range is cleared', (await host.evaluate(() => window.__nv.level.objective()[0])) === 'Range cleared');

  // ---- leaving cleans up
  await client.evaluate(() => window.__nv.leave());
  await sleep(800);
  check('after leaving: HUD and card are gone, scouts patrol behind the menu again', !(await visible(client, '.sh-hud')) && !(await visible(client, '.rng-card')) && (await drones(client)).length === 3);

  const missing = await host.evaluate(() => window.__nv.missingTranslations());
  check('every text exists in English and German', missing.length === 0, missing.join(', '));
  const lights1 = await countLights();
  check('no light was added or removed while playing', lights1 === lights0, `${lights0} -> ${lights1}`);
  const programs1 = await host.evaluate(() => window.__nv.engine.renderer.info.programs.length);
  check('all shaders were compiled up front (none added while playing)', programs1 === programs0, `${programs0} -> ${programs1}`);
  const errors = [...host.errors, ...client.errors];
  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' || '));
} catch (e) {
  console.log('TEST CRASHED', e);
  failed++;
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
