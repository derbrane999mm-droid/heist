// Smoke test: every registered level boots, starts a solo session and runs a few seconds without errors.
// Usage: node tests/smoke-levels.mjs [level ...]   (NV_DIST=1 to test the production build)
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const levels = process.argv.slice(2).length ? process.argv.slice(2) : ['hideout', 'hack'];
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const env = await startServers({ port: 5194, sigPort: 9016 });
try {
  for (const level of levels) {
    for (const lang of ['en', 'de']) {
      const page = await openPlayer(env, { name: 'Smoke', quality: 'low', width: 640, height: 360, renderSkip: 6, lang, extra: `&level=${level}&diff=2` });
      await page.evaluate(() => window.__nv.start(null));
      const started = await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 150000 }).then(() => true, () => false);
      check(`${level} (${lang}): session starts`, started);
      await sleep(2500);
      await page.evaluate(() => window.__nv.input.debugSet('KeyW', true));
      await sleep(1200);
      await page.evaluate(() => window.__nv.input.debugSet('KeyW', false));
      const info = await page.evaluate(() => ({ objective: window.__nv.level.objective(), status: window.__nv.session.status, y: window.__nv.player.position.y, missing: window.__nv.missingTranslations() }));
      check(`${level} (${lang}): objective text present`, Array.isArray(info.objective) && info.objective.length > 0 && info.objective.every((s) => typeof s === 'string' && s.length > 3 && !/^[a-z]+\.[a-zA-Z.]+$/.test(s)), JSON.stringify(info.objective).slice(0, 140));
      check(`${level} (${lang}): player stands on the floor`, info.y > -0.5 && info.y < 3, 'y=' + info.y.toFixed(2));
      check(`${level} (${lang}): all texts translated`, info.missing.length === 0, info.missing.slice(0, 5).join(', '));
      check(`${level} (${lang}): no page errors`, page.errors.length === 0, page.errors.slice(0, 3).join(' || '));
      if (lang === 'en') await page.screenshot({ path: `${OUT}/smoke-${level}.png` });
      await page.context().close();
    }
  }
} catch (e) {
  console.log('TEST CRASHED', e);
  failed++;
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
