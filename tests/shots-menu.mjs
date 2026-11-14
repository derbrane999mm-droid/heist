// Screenshot tour of the UI: main menu (EN/DE, 1280x720 and 1920x1080), dialogs, settings,
// in-game HUD in the casino, pause menu and the lineup overlay (voting and reveal).
// Usage: flock /tmp/nv-browser.lock node tests/shots-menu.mjs [menu,hud,lineup]
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? process.argv[2].split(',') : ['menu', 'hud', 'lineup'];
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/ui-${name}.png` });
  console.log('shot', name);
};
const click = (page, sel, n = 0) => page.evaluate(([sel, n]) => document.querySelectorAll(sel)[n].click(), [sel, n]);
const env = await startServers({ port: 5394, sigPort: 9394 });
let failed = false;
try {
  if (only.includes('menu')) {
    for (const lang of ['en', 'de']) {
      const page = await openPlayer(env, { name: 'Mert', quality: 'low', lang, renderSkip: 4 });
      await page.waitForFunction(() => !document.querySelector('.boot'), null, { timeout: 150000 });
      await sleep(2500);
      await shot(page, `menu-${lang}`);
      await click(page, '.menu .btn.item', 0); // create crew
      await sleep(900);
      await shot(page, `create-${lang}`);
      await click(page, '.menu .btn.ghost');
      await click(page, '.menu .btn.item', 1); // join crew
      await page.evaluate(() => {
        const c = document.querySelector('input.code');
        c.value = 'K7QX2';
        c.dispatchEvent(new Event('input'));
      });
      await sleep(900);
      await shot(page, `join-${lang}`);
      await click(page, '.menu .btn.ghost');
      await click(page, '.menu .btn.item', 2); // settings
      await sleep(900);
      await shot(page, `settings-${lang}`);
      const missing = await page.evaluate(() => window.__nv.missingTranslations?.() ?? []);
      if (missing.length) {
        console.log('MISSING TRANSLATIONS', missing);
        failed = true;
      }
      if (page.errors.length) console.log('errors', page.errors);
      await page.context().close();
    }
    const big = await openPlayer(env, { name: 'Mert', quality: 'low', lang: 'en', width: 1920, height: 1080, renderSkip: 4 });
    await big.waitForFunction(() => !document.querySelector('.boot'), null, { timeout: 150000 });
    await sleep(3000);
    await shot(big, 'menu-en-1080');
    await big.context().close();
    // an invite link adds a "join crew CODE" row
    const inv = await openPlayer(env, { name: 'Mert', quality: 'low', lang: 'de', renderSkip: 4, extra: '&c=K7QX2' });
    await inv.waitForFunction(() => !document.querySelector('.boot'), null, { timeout: 150000 });
    await sleep(2500);
    await shot(inv, 'menu-invite-de');
    await inv.context().close();
  }

  if (only.includes('hud')) {
    const page = await openPlayer(env, { name: 'Mert', quality: 'low', lang: 'de', extra: '&level=casino' });
    await page.evaluate(() => window.__nv.start(null));
    await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 150000 });
    await sleep(2500);
    // stand at the staff door and aim at the card reader so the "E" prompt shows
    // (the reader sits at about x -3.54, y 1.22, z -10.88)
    await page.evaluate(() => window.__nv.tp(-3.75, 0, -9.35, -0.137, -0.27));
    await page.waitForFunction(() => !!window.__nv.interactions.promptText, null, { timeout: 30000 }).catch(() => console.log('NO PROMPT'));
    await page.evaluate(() => {
      window.__nv.ui.toast('Jonas ist der Crew beigetreten', '', 30000);
    });
    await sleep(1500);
    await page.evaluate(() => window.__nv.ui.say('sub.lineupDone'));
    await sleep(3000);
    console.log('subtitle', await page.evaluate(() => (() => { const e = document.querySelector('.subtitle'); const cs = getComputedStyle(e); return [e.className, cs.opacity, cs.display, JSON.stringify(e.getBoundingClientRect()), getComputedStyle(e.parentElement).opacity].join(' | '); })()));
    await shot(page, 'hud-de');
    await page.evaluate(() => window.__nv.ui.showMenu('pause'));
    await sleep(1200);
    await shot(page, 'pause-de');
    await page.evaluate(() => document.querySelectorAll('.menu .btn.item')[2].click());
    await sleep(1000);
    await shot(page, 'pause-settings-de');
    if (page.errors.length) console.log('errors', page.errors);
    await page.context().close();
  }

  if (only.includes('lineup')) {
    for (const lang of ['de', 'en']) {
      const page = await openPlayer(env, { name: 'Mert', quality: 'low', lang, renderSkip: 6 });
      await page.evaluate(() => window.__nv.start(null));
      await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 150000 });
      await sleep(1500);
      const states = { vote: 0, reveal: 3, verdict: 1000, crew: -1 };
      for (const [name, stage] of Object.entries(states)) {
        await page.evaluate(([name, stage]) => {
          const nv = window.__nv;
          const me = nv.session.pid;
          const people = [{ pid: me, name: 'Mert', color: 0 }, { pid: 'p2', name: 'Jonas', color: 4 }, { pid: 'p3', name: 'Leonie', color: 1 }, { pid: 'p4', name: 'Emre', color: 2 }];
          const base = { preview: false, people, order: ['brain', 'hands', 'gambler', 'bait'], round: 1, q: 1, voted: [], deadline: 0, doneAt: 0, roles: { p4: 'brain' }, candidates: [me, 'p2', 'p3'] };
          const result = { role: 'hands', winner: 'p2', votes: { [me]: 'p2', p2: 'p3', p3: 'p2', p4: 'p3' }, tied: ['p2', 'p3'], auto: false, at: 0, end: 1 };
          let l;
          if (name === 'vote') l = { ...base, phase: 'vote', voted: ['p3', 'p4'], deadline: nv.session.hostNow() + 12000 };
          else if (stage === -1) l = { ...base, phase: 'done', result: null, roles: { p4: 'brain', p2: 'hands', [me]: 'gambler', p3: 'bait' } };
          else l = { ...base, phase: 'reveal', result };
          const view = nv.lineupView;
          view.session = nv.session;
          view.render(l, stage, true);
          view.timerFill.style.transform = 'scaleX(0.6)';
          view.el.classList.remove('hidden');
          view.key = 'off';
        }, [name, stage]);
        await sleep(900);
        await shot(page, `lineup-${name}-${lang}`);
      }
      if (page.errors.length) console.log('errors', page.errors);
      await page.context().close();
    }
  }
} finally {
  await env.stop();
}
process.exit(failed ? 1 : 0);
