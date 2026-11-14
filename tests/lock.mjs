// Lock picking game (test level "lock"): a bot opens it, give-up and break paths, timeout, case variant,
// both languages, screenshots. Run: node tests/lock.mjs
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';

fs.mkdirSync(`${OUT}/lock`, { recursive: true });
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 30000, step = 100) => {
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
const env = await startServers({ port: 5531, sigPort: 9531 });

const open = async (extra, opt = {}) => {
  const page = await openPlayer(env, { name: 'Locky', quality: 'low', width: 640, height: 360, renderSkip: 4, extra: `&level=lock${extra}`, ...opt });
  await page.evaluate(() => window.__nv.start(null));
  await until(() => page.evaluate(() => !!window.__nv.player), 150000);
  await sleep(800);
  return page;
};
const lockApi = (page, fn) => page.evaluate(fn);
/** Stand in front of the door, look at it and press E (the interaction). */
const startGame = async (page) => {
  await page.evaluate(() => window.__nv.tp(0, 0.02, -1.6, 0, 0));
  const focused = await until(() => page.evaluate(() => window.__nv.interactions.focused?.id === 'lock.door'), 5000);
  await page.evaluate(() => window.__nv.interactions.debugUse('lock.door'));
  const active = await until(() => page.evaluate(() => window.__nv.level.lock.active()), 5000);
  return { focused, active };
};
/** A perfect player inside the page: presses when the logic's helper says so. Stops when `until` says so. */
const startBot = (page, stopAtPins = 99) =>
  page.evaluate((stopAtPins) => {
    const nv = window.__nv;
    const d = nv.level.lock.debug;
    const tap = () => {
      nv.input.debugSet('Space', true);
      nv.input.debugSet('Space', false);
    };
    window.__botOn = true;
    const loop = () => {
      const s = d.state();
      if (window.__botOn && s && s.status === 'run' && s.cur < stopAtPins && d.botShouldPress(0.03)) tap();
      requestAnimationFrame(loop);
    };
    loop();
  }, stopAtPins);
const stopBot = (page) => page.evaluate(() => (window.__botOn = false));
const tapKey = (page, code) =>
  page.evaluate((c) => {
    window.__nv.input.debugSet(c, true);
    window.__nv.input.debugSet(c, false);
  }, code);

try {
  // ---------------------------------------------------------------- 1. difficulty 2: a bot opens the lock
  {
    const page = await open('&diff=2&seed=77');
    check('level "lock" boots with a door to look at', true);
    const r = await startGame(page);
    check('looking at the door focuses it, E starts the game', r.focused && r.active);
    await sleep(300);
    const info = await page.evaluate(() => {
      const d = window.__nv.level.lock.debug;
      const s = d.state();
      const o = d.overlay();
      return { pins: s.pins.length, frozen: window.__nv.player.frozen, shown: !o.classList.contains('hidden'), title: o.querySelector('.lk-title').textContent, pinEls: o.querySelectorAll('.lk-pin').length, slipsDots: o.querySelectorAll('.lk-dots i').length, hasKeys: o.querySelectorAll('.keycap').length >= 3 };
    });
    check('difficulty 2 shows 4 pins, the title, slips and key help', info.pins === 4 && info.pinEls === 4 && info.slipsDots === 6 && info.hasKeys && info.title === 'Door lock', JSON.stringify(info));
    check('overlay is visible and the player is frozen', info.shown && info.frozen);
    const p0 = await page.evaluate(() => window.__nv.player.position.toArray());
    await page.evaluate(() => window.__nv.input.debugSet('KeyW', true));
    await sleep(500);
    await page.evaluate(() => window.__nv.input.debugSet('KeyW', false));
    const p1 = await page.evaluate(() => window.__nv.player.position.toArray());
    check('movement is frozen while it is open', Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) < 0.05);
    await startBot(page);
    const got = await until(() => page.evaluate(() => window.__nv.lockResult ?? null), 90000);
    await stopBot(page);
    check('the bot opens the lock without a slip', !!got && got.ok === true && got.fumbles === 0 && got.noise === 0 && !got.gaveUp, JSON.stringify(got));
    check('the time is plausible', !!got && got.seconds > 1 && got.seconds < 40, `${got && got.seconds} s`);
    await until(() => page.evaluate(() => !window.__nv.level.lock.debug.overlay() || window.__nv.level.lock.debug.overlay().classList.contains('hidden')), 5000);
    const after = await page.evaluate(() => ({ frozen: window.__nv.player.frozen, active: window.__nv.level.lock.active(), ui: document.getElementById('ui').classList.contains('lk-open'), obj: window.__nv.level.objective()[0] }));
    check('after the verdict the overlay is gone, the player is free, nothing is left behind', !after.frozen && !after.active && !after.ui, JSON.stringify(after));
    check('the door is open now', /open/i.test(after.obj));
    check('no page errors (open path)', page.errors.length === 0, page.errors.slice(0, 3).join(' || '));
    await page.context().close();
  }

  // ---------------------------------------------------------------- 2. give up, then break the pick
  {
    const page = await open('&diff=2&seed=5');
    await startGame(page);
    await sleep(300);
    await tapKey(page, 'Escape');
    const g = await until(() => page.evaluate(() => window.__nv.lockResult ?? null), 5000);
    check('Esc gives up: gaveUp, ok false', !!g && g.gaveUp === true && g.ok === false, JSON.stringify(g));
    const a = await page.evaluate(() => ({ frozen: window.__nv.player.frozen, active: window.__nv.level.lock.active(), shown: !window.__nv.level.lock.debug.overlay().classList.contains('hidden') }));
    check('giving up closes at once and frees the player', !a.frozen && !a.active && !a.shown, JSON.stringify(a));

    await startGame(page);
    await sleep(300);
    // slip on purpose: press whenever the marker is far from the zone and the lock is ready
    const slipper = await page.evaluate(() => {
      const nv = window.__nv;
      const d = nv.level.lock.debug;
      window.__slipOn = true;
      const loop = () => {
        const s = d.state();
        if (window.__slipOn && s && s.status === 'run' && s.lockout <= 0) {
          const p = s.pins[s.cur];
          if (Math.abs(s.pos - p.c) > p.w / 2 + 0.1) {
            nv.input.debugSet('KeyE', true);
            nv.input.debugSet('KeyE', false);
          }
        }
        requestAnimationFrame(loop);
      };
      loop();
      return true;
    });
    const broke = await until(() => page.evaluate(() => window.__nv.lockResult ?? null), 30000);
    check('too many slips: the pick breaks (ok false, 6 fumbles, noise 6)', !!broke && broke.ok === false && broke.fumbles === 6 && broke.noise === 6 && !broke.gaveUp, JSON.stringify(broke));
    check('a broken lock does not open the door', await page.evaluate(() => /locked|verschlossen/i.test(window.__nv.level.objective()[0])));
    await until(() => page.evaluate(() => !window.__nv.level.lock.debug.outro()), 5000);
    check('same lock again after a failure: the door can be tried once more', (await startGame(page)).active);
    await page.evaluate(() => (window.__slipOn = false));
    await page.evaluate(() => window.__nv.level.lock.cancel());
    const c = await page.evaluate(() => ({ frozen: window.__nv.player.frozen, active: window.__nv.level.lock.active(), shown: !window.__nv.level.lock.debug.overlay().classList.contains('hidden') }));
    check('cancel() cleans up fully', !c.frozen && !c.active && !c.shown);
    // debugFinish
    await startGame(page);
    await page.evaluate(() => window.__nv.level.lock.debugFinish(true));
    const dbg = await until(() => page.evaluate(() => window.__nv.lockResult ?? null), 3000);
    check('debugFinish(true) reports success', !!dbg && dbg.ok === true);
    check('no page errors (give-up / break path)', page.errors.length === 0, page.errors.slice(0, 3).join(' || '));
    await page.context().close();
  }

  // ---------------------------------------------------------------- 3. German, case variant, timeout
  {
    const page = await open('&diff=2&variant=case&limit=4&seed=9', { lang: 'de' });
    await startGame(page);
    await sleep(300);
    const info = await page.evaluate(() => {
      const o = window.__nv.level.lock.debug.overlay();
      return { pins: window.__nv.level.lock.debug.state().pins.length, text: o.textContent, bar: !o.querySelector('.lk-time').classList.contains('hidden') };
    });
    check('case variant has 3 pins at difficulty 2', info.pins === 3);
    check('German texts and a time bar with a limit', /Vitrinenschloss/.test(info.text) && /Stift setzen/.test(info.text) && /aufgeben/.test(info.text) && info.bar, info.text.slice(0, 120));
    const r = await until(() => page.evaluate(() => window.__nv.lockResult ?? null), 15000);
    check('running out of time fails without giving up (ok false, 0 fumbles)', !!r && r.ok === false && !r.gaveUp && r.fumbles === 0 && r.seconds >= 3.9 && r.seconds <= 4.3, JSON.stringify(r));
    const missing = await page.evaluate(() => window.__nv.missingTranslations().filter((k) => k.includes('lk')));
    check('every lock text exists in both languages', missing.length === 0, missing.join(','));
    check('no page errors (de / case / timeout)', page.errors.length === 0, page.errors.slice(0, 3).join(' || '));
    await page.context().close();
  }

  // ---------------------------------------------------------------- 4. screenshots at 1440x900
  {
    const page = await open('&diff=2&seed=3&limit=45', { width: 1440, height: 900, quality: 'medium', renderSkip: 0 });
    await startGame(page);
    await startBot(page, 2); // sets two pins, then stops
    await until(() => page.evaluate(() => window.__nv.level.lock.debug.state().cur >= 2), 30000);
    await sleep(500);
    await page.screenshot({ path: `${OUT}/lock/playing.png` });
    // one slip for the second picture, then finish
    await stopBot(page);
    await page.evaluate(() => {
      const s = window.__nv.level.lock.debug.state();
      s.lockout = 0;
    });
    await until(() => page.evaluate(() => {
      const s = window.__nv.level.lock.debug.state();
      const p = s.pins[s.cur];
      return Math.abs(s.pos - p.c) > p.w / 2 + 0.2;
    }), 5000, 20);
    await tapKey(page, 'Space');
    await sleep(120);
    await page.screenshot({ path: `${OUT}/lock/slip.png` });
    await sleep(900);
    await startBot(page);
    await until(() => page.evaluate(() => window.__nv.lockResult ?? null), 60000);
    await sleep(250);
    await page.screenshot({ path: `${OUT}/lock/open.png` });
    check('screenshots taken', fs.existsSync(`${OUT}/lock/playing.png`) && fs.existsSync(`${OUT}/lock/open.png`));
    check('no page errors (screenshots)', page.errors.length === 0, page.errors.slice(0, 3).join(' || '));
    await page.context().close();
  }
} catch (e) {
  console.log('TEST CRASHED', e);
  failed++;
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
