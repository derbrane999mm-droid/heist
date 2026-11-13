// Renders the lineup overlay in its reveal / verdict / summary states from synthetic data (one page, fast).
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const env = await startServers({ port: 5193, sigPort: 9015 });
try {
  for (const lang of ['en', 'de']) {
    const page = await openPlayer(env, { name: 'Mert', quality: 'low', lang, renderSkip: 6 });
    await page.evaluate(() => window.__nv.start(null));
    await page.waitForFunction(() => window.__nv.player !== null, null, { timeout: 150000 });
    await sleep(1500);
    const states = { reveal: 3, tie: 103, verdict: 1000, crew: -1 };
    for (const [name, stage] of Object.entries(states)) {
      await page.evaluate(([stage]) => {
        const nv = window.__nv;
        const me = nv.session.pid;
        const people = [{ pid: me, name: 'Mert', color: 0 }, { pid: 'p2', name: 'Jonas', color: 4 }, { pid: 'p3', name: 'Leonie', color: 1 }, { pid: 'p4', name: 'Emre', color: 2 }];
        const base = { preview: false, people, order: ['brain', 'hands', 'gambler', 'bait'], round: 1, q: 1, voted: [], deadline: 0, doneAt: 0, roles: { p4: 'brain' }, candidates: [me, 'p2', 'p3'] };
        const result = { role: 'hands', winner: 'p2', votes: { [me]: 'p2', p2: 'p3', p3: 'p2', p4: 'p3' }, tied: ['p2', 'p3'], auto: false, at: 0, end: 1 };
        const l = stage === -1 ? { ...base, phase: 'done', result: null, roles: { p4: 'brain', p2: 'hands', [me]: 'gambler', p3: 'bait' } } : { ...base, phase: 'reveal', result };
        const view = nv.lineupView;
        view.session = nv.session;
        view.render(l, stage, true);
        view.el.classList.remove('hidden');
        view.key = 'off';
      }, [stage]);
      await sleep(900);
      await page.screenshot({ path: `${OUT}/lineup-ui-${name}-${lang}.png` });
      console.log('shot', name, lang);
    }
    console.log('errors', page.errors);
    await page.context().close();
  }
} finally {
  await env.stop();
}
process.exit(0);
