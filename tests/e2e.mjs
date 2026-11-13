// End-to-end multiplayer test: 4 simulated players play through the crew check.
import { startServers, openPlayer, sleep } from './harness.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 20000, step = 250) => {
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
const st = (page) => page.evaluate(() => window.__nv.session?.state?.tut ?? null);
const roster = (page) => page.evaluate(() => (window.__nv.session ? [...window.__nv.session.players.values()].map((p) => p.name) : []));
const use = (page, id, hold) => page.evaluate(([id, hold]) => window.__nv.interactions.debugUse(id, hold), [id, hold]);

const env = await startServers({ port: 5189, sigPort: 9011 });
const opt = { width: 480, height: 270, quality: 'low', renderSkip: 8 };
try {
  // ---- host
  const host = await openPlayer(env, { ...opt, name: 'Host' });
  await host.evaluate(() => window.__nv.start(null));
  await until(() => host.evaluate(() => !!window.__nv.player));
  const code = await host.evaluate(() => window.__nv.session.code);
  check('host creates a crew with a 5-character code', /^[A-Z2-9]{5}$/.test(code), code);
  check('host is online (not offline fallback)', (await host.evaluate(() => window.__nv.session.status)) === 'online');

  const missing = await host.evaluate(() => window.__nv.missingTranslations());
  check('every text exists in English and German', missing.length === 0, missing.join(', '));

  // ---- two clients join
  const a = await openPlayer(env, { ...opt, name: 'Anna', lang: 'de' });
  const b = await openPlayer(env, { ...opt, name: 'Ben' });
  await a.evaluate((c) => window.__nv.start(c), code);
  await b.evaluate((c) => window.__nv.start(c.toLowerCase()), code); // lower-case input must work too
  const joined = await until(async () => (await roster(host)).length === 3 && (await roster(a)).length === 3 && (await roster(b)).length === 3, 40000);
  check('all three see a 3-player roster', !!joined, JSON.stringify(await roster(a)));
  await until(() => a.evaluate(() => !!window.__nv.player));
  await until(() => b.evaluate(() => !!window.__nv.player));

  // ---- wrong code
  const lost = await openPlayer(env, { ...opt, name: 'Lost' });
  await lost.evaluate(() => window.__nv.start('ZZZZZ'));
  const err = await until(() => lost.evaluate(() => document.querySelector('.menu-error')?.textContent || ''), 25000);
  check('unknown code shows a clear error', typeof err === 'string' && err.includes('ZZZZZ'), String(err));
  await lost.context().close();

  // ---- movement + collision
  await a.evaluate(() => window.__nv.tp(1.9, 0, 5.0, 0, 0)); // clear lane past the planning table
  await sleep(300);
  const p0 = await a.evaluate(() => window.__nv.player.position.toArray());
  await a.evaluate(() => window.__nv.input.debugSet('KeyW', true));
  await sleep(2500);
  await a.evaluate(() => window.__nv.input.debugSet('KeyW', false));
  const p1 = await a.evaluate(() => window.__nv.player.position.toArray());
  // nominal 3.5 m/s; software rendering drops below the 5 fps real-time floor, so allow a wide band
  check('player walks forward on W', p0[2] - p1[2] > 3 && p0[2] - p1[2] < 10, `z ${p0[2].toFixed(2)} -> ${p1[2].toFixed(2)}`);
  await a.evaluate(() => { window.__nv.tp(0, 0, -5.5, 0, 0); window.__nv.input.debugSet('KeyW', true); window.__nv.input.debugSet('ShiftLeft', true); });
  await sleep(4000);
  await a.evaluate(() => { window.__nv.input.debugSet('KeyW', false); window.__nv.input.debugSet('ShiftLeft', false); });
  const pw = await a.evaluate(() => window.__nv.player.position.toArray());
  check('walls stop the player (north wall / console)', pw[2] > -7 && pw[1] > -0.1 && pw[1] < 0.5, pw.map((v) => v.toFixed(2)).join(','));
  await a.evaluate(() => window.__nv.tp(-8.2, 0, 0, Math.PI / 2, 0));
  await a.evaluate(() => window.__nv.input.debugSet('KeyW', true));
  await sleep(2500);
  await a.evaluate(() => window.__nv.input.debugSet('KeyW', false));
  const pv = await a.evaluate(() => window.__nv.player.position.toArray());
  check('closed vault door blocks the way', pv[0] > -9.0, 'x=' + pv[0].toFixed(2));

  // ---- pose sync
  await a.evaluate(() => window.__nv.tp(2.5, 0, 1.5, 1.0, 0));
  const aPid = await a.evaluate(() => window.__nv.session.pid);
  const seen = await until(async () => {
    const pos = await b.evaluate((pid) => window.__nv.avatars.get(pid)?.position.toArray(), aPid);
    return pos && Math.hypot(pos[0] - 2.5, pos[2] - 1.5) < 0.3;
  }, 15000);
  check('client B sees client A move (relayed through host)', !!seen);
  const seenHost = await until(async () => {
    const pos = await host.evaluate((pid) => window.__nv.avatars.get(pid)?.position.toArray(), aPid);
    return pos && Math.hypot(pos[0] - 2.5, pos[2] - 1.5) < 0.3;
  }, 15000);
  check('host sees client A move', !!seenHost);

  // ---- voice mesh
  const voiceOk = await until(async () => {
    const n = await Promise.all([host, a, b].map((p) => p.evaluate(() => window.__nv.voice?.connectedCount() ?? -1)));
    return n.every((x) => x === 2) ? n : false;
  }, 40000);
  check('voice: every player has audio from both others', !!voiceOk, JSON.stringify(voiceOk));
  const mic = await Promise.all([host, a, b].map((p) => p.evaluate(() => window.__nv.voice?.micState())));
  check('voice: microphones are live', mic.every((m) => m === 'live'), JSON.stringify(mic));
  const talk = await until(() => b.evaluate((pid) => window.__nv.voice.isTalking(pid), aPid), 15000);
  check('voice: speaking indicator reacts to incoming audio', !!talk);
  await a.evaluate(() => window.__nv.input.debugSet('KeyM', true));
  await sleep(600);
  await a.evaluate(() => window.__nv.input.debugSet('KeyM', false));
  check('voice: M mutes the microphone', (await a.evaluate(() => window.__nv.voice.micState())) === 'muted');
  const quiet = await until(async () => !(await b.evaluate((pid) => window.__nv.voice.isTalking(pid), aPid)), 8000);
  check('voice: muted player goes silent for others', !!quiet);

  // ---- the puzzle
  let s = await st(host);
  check('host created the puzzle', s && s.code.length === 4 && new Set(s.code).size === 4 && s.order.length === 4);
  check('clients received the same puzzle', JSON.stringify(await st(a)) === JSON.stringify(s) && JSON.stringify(await st(b)) === JSON.stringify(s));
  check('objective (EN) asks for the relay', (await b.evaluate(() => window.__nv.level.objective()[0])).includes('relay'));
  check('objective (DE) is translated', (await a.evaluate(() => window.__nv.level.objective()[0])).includes('Relais'));

  await use(a, 'relay', true);
  await until(async () => (await st(b))?.relayBy === aPid);
  check('holding the relay is visible to everyone', (await st(b)).relayBy === aPid && (await st(host)).relayBy === aPid);
  check('another player cannot grab a held relay', (await use(b, 'relay', true)) === false);

  const solution = s.order.map((c) => s.code[c]);
  const wrong = solution.slice().reverse();
  for (const d of wrong) { await use(b, 'key-' + d); await sleep(150); }
  await until(async () => (await st(host)).strikes === 1);
  check('wrong sequence costs a strike and clears the entry', (await st(a)).strikes === 1 && (await st(a)).entered.length === 0);

  await use(a, 'relay', false);
  await until(async () => (await st(host)).relayBy === null);
  s = await st(host);
  const hostNow = await host.evaluate(() => window.__nv.session.hostNow());
  check('releasing the relay starts the 12 s capacitor', s.relayBy === null && s.powerUntil - hostNow > 9000 && s.powerUntil - hostNow <= 12000, String(Math.round(s.powerUntil - hostNow)));
  const skew = await b.evaluate(() => window.__nv.session.hostNow()) - (await host.evaluate(() => window.__nv.session.hostNow()));
  // software rendering runs at a few fps here, which smears the measurement; on real hardware this is ~10 ms
  check('client clock is synced to the host (< 700 ms under software rendering)', Math.abs(skew) < 700, Math.round(skew) + ' ms');

  for (const d of solution) { await use(b, 'key-' + d); await sleep(150); }
  const opened = await until(async () => (await st(host)).open && (await st(a)).open && (await st(b)).open);
  check('correct sequence opens the vault for everyone', !!opened);
  check('kit cannot be taken before the door has swung open', (await use(host, 'kit')) === false);
  await sleep(5000);

  // ---- late joiner gets the current world
  const c = await openPlayer(env, { ...opt, name: 'Cem' });
  await c.evaluate((code) => window.__nv.start(code), code);
  const late = await until(async () => (await roster(c)).length === 4 && (await st(c))?.open === true, 40000);
  check('4th player joins late and sees the open vault', !!late);
  const fifth = await openPlayer(env, { ...opt, name: 'Five' });
  await fifth.evaluate((code) => window.__nv.start(code), code);
  const full = await until(() => fifth.evaluate(() => document.querySelector('.menu-error')?.textContent || ''), 25000);
  check('5th player is refused with a "crew is full" message', typeof full === 'string' && /full/i.test(full), String(full));
  await fifth.context().close();

  // door is open: walk in
  await a.evaluate(() => window.__nv.tp(-8.2, 0, 0, Math.PI / 2, 0));
  await a.evaluate(() => window.__nv.input.debugSet('KeyW', true));
  await sleep(3000);
  await a.evaluate(() => window.__nv.input.debugSet('KeyW', false));
  const pin = await a.evaluate(() => window.__nv.player.position.toArray());
  check('open vault can be entered', pin[0] < -9.3, 'x=' + pin[0].toFixed(2));

  check('kit pickup works once the door is open', (await use(c, 'kit')) === true);
  await until(async () => (await st(host)).kit);
  check('kit state reaches everyone', (await st(a)).kit && (await st(b)).kit && (await st(c)).kit);
  const moved = await until(async () => (await st(host)).moved && (await st(b)).moved, 20000);
  check('blackout happens and the Custodian has moved', !!moved);
  await sleep(4000);
  const power = await Promise.all([host, a, b, c].map((p) => p.evaluate(() => window.__nv.engine.scene.environmentIntensity)));
  check('lights are back on for everyone after the blackout', power.every((v) => v > 0.95), JSON.stringify(power));
  await use(host, 'board');
  await until(async () => (await st(c)).board);
  check('job board unlocks and the objective completes', (await st(c)).board === true);
  const saved = await Promise.all([host, a].map((p) => p.evaluate(() => JSON.parse(localStorage.getItem('nullvault.campaign.v1') || '{}').crewReady)));
  check('progress is saved on the host and mirrored to clients', saved.every(Boolean), JSON.stringify(saved));

  // ---- leaving
  await b.evaluate(() => window.__nv.leave());
  const shrunk = await until(async () => (await roster(host)).length === 3 && (await roster(a)).length === 3, 15000);
  check('a leaving player disappears from every roster', !!shrunk);
  check('leaver is back in the main menu', await b.evaluate(() => !!document.querySelector('.menu:not(.hidden):not(.paused)')));
  const voiceAfter = await until(async () => (await host.evaluate(() => window.__nv.voice.connectedCount())) === 2, 15000);
  check('voice mesh shrinks with the roster', !!voiceAfter);

  // ---- rejoin restores progress
  await b.evaluate((code) => window.__nv.start(code), code);
  const back = await until(async () => (await roster(host)).length === 4 && (await st(b))?.board === true, 40000);
  check('player can rejoin and gets the finished state', !!back);

  // ---- host loss
  await host.evaluate(() => window.__nv.leave());
  const dropped = await until(() => a.evaluate(() => !!document.querySelector('.menu:not(.hidden):not(.paused)')), 60000, 1000);
  check('when the host leaves, clients return to the menu with a message', !!dropped, await a.evaluate(() => document.querySelector('.menu-error')?.textContent || ''));

  // ---- host again: saved progress
  await host.evaluate(() => window.__nv.start(null));
  await until(() => host.evaluate(() => !!window.__nv.player));
  s = await st(host);
  check('hosting again restores crew progress from the save', s.open && s.kit && s.moved);

  const allErrors = [host, a, b, c].flatMap((p) => p.errors);
  check('no page errors in any client', allErrors.length === 0, allErrors.slice(0, 5).join(' || '));
} catch (e) {
  console.log('TEST CRASHED', e);
  failed++;
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
