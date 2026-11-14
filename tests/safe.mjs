// Safe opening (calib level "safe"): three variants driven with simulated keys, give-up, failure, both languages.
// Run: node tests/safe.mjs      Screenshots: test-out/safe/<variant>.png (1440x900)
import fs from 'node:fs';
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 60000, step = 40) => {
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
const shotDir = `${OUT}/safe`;
fs.mkdirSync(shotDir, { recursive: true });

const state = (p) => p.evaluate(() => window.__nv.level.safe.game.debug.state());
const view = (p) => p.evaluate(() => window.__nv.level.safe.game.debug.view());
const result = (p) => p.evaluate(() => window.__nv.level.safe.result());
const frozen = (p) => p.evaluate(() => window.__nv.player.frozen);
const tap = (p, code) =>
  p.evaluate((c) => {
    window.__nv.input.debugSet(c, true);
    window.__nv.input.debugSet(c, false);
  }, code);
const release = (p) =>
  p.evaluate(() => {
    for (const c of ['KeyA', 'KeyD', 'ShiftLeft', 'Space']) window.__nv.input.debugSet(c, false);
  });
/** One tick of the perfect player, through the keyboard. */
const perfectTick = (p) =>
  p.evaluate(() => {
    const S = window.__nv.level.safe;
    const st = S.game.debug.state();
    const set = (c, d) => window.__nv.input.debugSet(c, d);
    if (!st) return null;
    const a = S.logic.safeAdvice(st, false);
    set('KeyA', a.dir < 0);
    set('KeyD', a.dir > 0);
    set('ShiftLeft', a.slow);
    if (st.kind === 'drill') set('Space', a.hold);
    else if (a.act) {
      set('Space', true);
      set('Space', false);
    }
    return { kind: st.kind, p: S.logic.safeProgress(st), heat: st.heat ?? 0 };
  });
/** Careless play: elek presses at every wrong moment, drill hammers the key, mech never stops turning. */
const carelessTick = (p) =>
  p.evaluate(() => {
    const S = window.__nv.level.safe;
    const st = S.game.debug.state();
    const set = (c, d) => window.__nv.input.debugSet(c, d);
    if (!st) return;
    if (st.kind === 'elek') {
      if (S.logic.elekSignal(st) < 0.2 && st.lockT === 0) {
        set('Space', true);
        set('Space', false);
      }
    } else if (st.kind === 'drill') set('Space', !(st.latch && st.stuck <= 0));
    else set(st.dirs[0] > 0 ? 'KeyD' : 'KeyA', true);
  });

const env = await startServers({ port: 5541, sigPort: 9541 });
const open = async (variant, { lang = 'en', diff = 2, width = 1440, height = 900, extra = '' } = {}) => {
  const p = await openPlayer(env, { name: 'Safe', quality: 'low', width, height, renderSkip: 12, lang, extra: `&level=safe&variant=${variant}&diff=${diff}${extra}` });
  await p.evaluate(() => window.__nv.start(null));
  await until(() => p.evaluate(() => !!window.__nv.player), 150000);
  await sleep(600);
  return p;
};
/** Start through the prop, like a player (E on the safe), and wait until the overlay is up. */
const startIt = async (p) => {
  const used = await p.evaluate(() => window.__nv.interactions.debugUse('safe'));
  await sleep(250);
  return used;
};

try {
  for (const variant of ['mech', 'elek', 'drill']) {
    const p = await open(variant);
    const name = variant.padEnd(5);
    check(`${name} level "safe" boots with the variant from the URL`, (await p.evaluate(() => window.__nv.level.safe.variant)) === variant);
    check(`${name} no safe game is open at the start`, (await state(p)) === null && (await frozen(p)) === false);

    // ---- start, overlay, freeze
    check(`${name} looking at the safe and pressing E starts the game`, (await startIt(p)) === true);
    let v = await view(p);
    check(`${name} overlay is up with a title, key help and slips`, !!v && v.visible && v.title.length > 3 && v.keys.includes('Space') && v.keys.includes('Esc') && v.slips.length > 2 && v.variant === variant, JSON.stringify(v));
    check(`${name} the player is frozen while it is open`, (await frozen(p)) === true);
    check(`${name} it cannot be started twice`, (await p.evaluate(() => window.__nv.interactions.debugUse('safe'))) === false);
    check(`${name} no time bar without a limit`, v.time === -1);
    // keys do not move the player
    const p0 = await p.evaluate(() => window.__nv.player.position.toArray());
    await p.evaluate(() => window.__nv.input.debugSet('KeyW', true));
    await sleep(500);
    await p.evaluate(() => window.__nv.input.debugSet('KeyW', false));
    const p1 = await p.evaluate(() => window.__nv.player.position.toArray());
    check(`${name} W does not walk while it is open`, Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) < 0.05);

    // ---- a perfect player opens it; screenshot part-way
    let shot = false;
    const t0 = Date.now();
    let r = null;
    while (Date.now() - t0 < 120000) {
      const info = await perfectTick(p);
      if (!shot && info && info.p >= 0.34 && (variant !== 'drill' || info.heat > 0.4)) {
        shot = true;
        await sleep(60);
        await p.screenshot({ path: `${shotDir}/${variant}.png` });
      }
      r = await result(p);
      if (r) break;
      await sleep(25);
    }
    await release(p);
    check(`${name} a player pressing the right keys opens it`, !!r && r.ok === true && !r.gaveUp, JSON.stringify(r));
    check(`${name} result: seconds, noise 0..10, no slips`, !!r && r.seconds > 2 && r.seconds < 80 && r.noise >= 0 && r.noise <= 10 && r.fumbles === 0, JSON.stringify(r));
    if (variant === 'elek') check(`${name} electronic lock is quiet`, r.noise === 0);
    if (variant === 'drill') check(`${name} drilling is loud`, r.noise >= 4);
    check(`${name} screenshot taken`, shot);
    await sleep(1800);
    check(`${name} after the result the overlay closes and the player is free again`, (await view(p)).visible === false && (await frozen(p)) === false);

    // ---- give up with Esc
    await p.evaluate(() => window.__nv.level.safe.game.debug.last());
    await startIt(p);
    await sleep(300);
    const runs = await p.evaluate(() => window.__nv.level.safe.runs());
    await tap(p, 'Escape');
    await until(async () => (await p.evaluate(() => window.__nv.level.safe.runs())) === runs + 1, 4000);
    r = await result(p);
    check(`${name} Esc gives up: gaveUp, ok false, overlay closed, player free`, !!r && r.gaveUp === true && r.ok === false && (await view(p)).visible === false && (await frozen(p)) === false, JSON.stringify(r));

    // ---- failure path
    let fr;
    if (variant === 'mech') {
      // a time limit: the bar shrinks and the attempt fails at zero
      await p.evaluate(() => window.__nv.level.safe.game.start({ game: 'safe', variant: 'mech', difficulty: 2, seed: 5, tools: [], timeLimit: 3 }, (x) => (window.__nv.level.safe.__r = x)));
      await sleep(400);
      v = await view(p);
      check(`${name} with a time limit a bar shows and shrinks`, v.time > 0 && v.time < 1, `time ${v.time}`);
      await sleep(3200);
      fr = await p.evaluate(() => window.__nv.level.safe.__r);
      check(`${name} the time limit fails it: ok false, not gaveUp`, !!fr && fr.ok === false && !fr.gaveUp && fr.seconds >= 2.9, JSON.stringify(fr));
      await sleep(1600);
      // careless spinning with Esc-less fail: slips count
      await p.evaluate(() => window.__nv.level.safe.game.start({ game: 'safe', variant: 'mech', difficulty: 1, seed: 6, tools: [], timeLimit: 40 }, (x) => (window.__nv.level.safe.__r = null || x)));
      await sleep(300);
      const t1 = Date.now();
      let st;
      while (Date.now() - t1 < 30000) {
        await carelessTick(p);
        st = await state(p);
        if (st && st.fumbles >= 1) break;
        await sleep(40);
      }
      await release(p);
      check(`${name} turning past the number is a slip (fumbles and noise +1)`, !!st && st.fumbles >= 1 && st.noise >= 1, JSON.stringify(st && { f: st.fumbles, n: st.noise }));
      await p.evaluate(() => window.__nv.level.safe.game.cancel());
    } else {
      await startIt(p);
      await sleep(300);
      const t1 = Date.now();
      const before = await p.evaluate(() => window.__nv.level.safe.runs());
      while (Date.now() - t1 < 90000) {
        await carelessTick(p);
        if ((await p.evaluate(() => window.__nv.level.safe.runs())) > before) break;
        await sleep(30);
      }
      await release(p);
      fr = await result(p);
      if (variant === 'elek') check(`${name} three wrong presses trip the lockout: ok false, 3 slips, quiet`, !!fr && fr.ok === false && !fr.gaveUp && fr.fumbles === 3 && fr.noise === 0, JSON.stringify(fr));
      else check(`${name} three binds break the bit: ok false, 3 slips, loud`, !!fr && fr.ok === false && !fr.gaveUp && fr.fumbles === 3 && fr.noise > 0, JSON.stringify(fr));
      await sleep(1600);
    }

    // ---- debugFinish both ways
    for (const ok of [true, false]) {
      await startIt(p);
      await sleep(250);
      const before = await p.evaluate(() => window.__nv.level.safe.runs());
      await p.evaluate((ok) => window.__nv.level.safe.game.debugFinish(ok), ok);
      await until(async () => (await p.evaluate(() => window.__nv.level.safe.runs())) > before, 3000);
      r = await result(p);
      check(`${name} debugFinish(${ok}) reports ${ok ? 'success' : 'failure'}`, !!r && r.ok === ok && !r.gaveUp, JSON.stringify(r));
      await sleep(1500);
    }
    // cancel closes without a result
    await startIt(p);
    await sleep(250);
    const before = await p.evaluate(() => window.__nv.level.safe.runs());
    await p.evaluate(() => window.__nv.level.safe.game.cancel());
    await sleep(200);
    check(`${name} cancel() closes it without a result and frees the player`, (await p.evaluate(() => window.__nv.level.safe.runs())) === before && (await view(p)).visible === false && (await frozen(p)) === false && !(await p.evaluate(() => window.__nv.level.safe.game.active())));

    check(`${name} no page errors`, p.errors.length === 0, p.errors.slice(0, 3).join(' || '));
    await p.context().close();
  }

  // ---- German: every text translated, nothing shows a raw key
  const titles = { mech: 'Kombinationsschloss', elek: 'Elektronikschloss', drill: 'Bohren' };
  for (const variant of ['mech', 'elek', 'drill']) {
    const p = await open(variant, { lang: 'de', width: 1000, height: 640 });
    const missing = await p.evaluate(() => window.__nv.missingTranslations());
    check(`${variant.padEnd(5)} (de) all texts exist in both languages`, missing.length === 0, missing.slice(0, 5).join(', '));
    await startIt(p);
    await sleep(400);
    // go through several statuses
    const seen = new Set();
    for (let i = 0; i < 120; i++) {
      await perfectTick(p);
      const v = await view(p);
      if (v) seen.add(v.status);
      if (await result(p)) break;
      await sleep(60);
    }
    await release(p);
    const v = await view(p);
    const all = [v.title, v.keys, v.slips, ...seen].join(' | ');
    check(`${variant.padEnd(5)} (de) German title and no raw keys on screen`, v.title === titles[variant] && !/\bsf\.|sfl\./.test(all) && /drücken|drehen|bohren|setzen/.test(v.keys), all.slice(0, 160));
    check(`${variant.padEnd(5)} (de) no page errors`, p.errors.length === 0, p.errors.slice(0, 3).join(' || '));
    await p.context().close();
  }
} catch (e) {
  console.log('TEST CRASHED', e);
  failed++;
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
