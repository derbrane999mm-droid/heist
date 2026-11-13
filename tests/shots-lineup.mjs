// Screenshots of the lineup overlay with four players (host at normal timing).
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const env = await startServers({ port: 5192, sigPort: 9014 });
const lu = (page) => page.evaluate(() => window.__nv.session?.state?.lineup ?? null);
const until = async (fn, ms = 60000) => { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > ms) return false; await sleep(250); } };
try {
  const lang = process.argv[2] || 'en';
  const host = await openPlayer(env, { name: 'Mert', quality: 'medium', renderSkip: 40, lang });
  const shot = async (file) => {
    await host.evaluate(() => (window.__nvRenderSkip = 0));
    await sleep(2500);
    await host.screenshot({ path: `${OUT}/${file}` });
    await host.evaluate(() => (window.__nvRenderSkip = 40));
    console.log('shot', file);
  };
  await host.evaluate(() => window.__nv.start(null));
  await host.waitForFunction(() => window.__nv.player !== null, null, { timeout: 150000 });
  const code = await host.evaluate(() => window.__nv.session.code);
  const guests = [];
  const spots = [[-1.8, 1.9, -2.4], [0.2, -2.3, 3.1], [2.1, 1.2, 2.2]];
  for (const [i, name] of ['Jonas', 'Leonie', 'Emre'].entries()) {
    const g = await openPlayer(env, { name, quality: 'low', width: 320, height: 200, renderSkip: 30 });
    await g.evaluate((c) => window.__nv.start(c), code);
    await g.waitForFunction(() => window.__nv.player !== null, null, { timeout: 150000 });
    await g.evaluate((v) => window.__nv.tp(v[0], 0, v[1], v[2], 0), spots[i]);
    guests.push(g);
  }
  await until(() => host.evaluate(() => window.__nv.session.players.size === 4));
  await host.evaluate(() => window.__nv.tp(0.4, 0, 4.4, 0.05, 0.02));
  await sleep(2000);
  await shot(`lineup-0-before-${lang}.png`);
  await host.evaluate(() => window.__nv.session.intent('lineup.start'));
  await until(async () => (await lu(host)).phase === 'vote');
  const vote = (pg, pick) => pg.evaluate((pick) => { const s = window.__nv.session; const l = s.state.lineup; const opts = l.candidates.filter((p) => p !== s.pid); s.intent('lineup.vote', { target: opts[Math.min(pick, opts.length - 1)] }); }, pick);
  await vote(guests[0], 0);
  await sleep(1500);
  await shot(`lineup-1-vote-${lang}.png`);
  await vote(guests[1], 0); await vote(guests[2], 1); await vote(host, 0);
  await until(async () => (await lu(host)).phase === 'reveal');
  await sleep(1800);
  await shot(`lineup-2-reveal-${lang}.png`);
  await sleep(2500);
  await shot(`lineup-3-verdict-${lang}.png`);
  // remaining rounds: vote fast
  await until(async () => {
    const l = await lu(host);
    if (l.phase === 'done') return true;
    if (l.phase === 'vote') for (const pg of [host, ...guests]) await pg.evaluate(() => { const s = window.__nv.session; const l = s.state.lineup; if (l.phase !== 'vote' || l.voted.includes(s.pid)) return; const t = l.candidates.find((p) => p !== s.pid); if (t) s.intent('lineup.vote', { target: t }); });
    return false;
  }, 120000);
  await sleep(1200);
  await shot(`lineup-4-crew-${lang}.png`);
  await sleep(9000);
  await host.evaluate(() => window.__nv.tp(-7.6, 0, -2.3, Math.PI / 2 + 0.05, -0.1));
  await sleep(600);
  await shot(`lineup-5-locked-${lang}.png`);
  console.log('errors', host.errors, guests.flatMap((g) => g.errors));
} finally {
  await env.stop();
}
process.exit(0);
