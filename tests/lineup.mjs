// The lineup (role voting) with 4 simulated players. Uses shortened timers.
import { startServers, openPlayer, sleep } from './harness.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 20000, step = 200) => {
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
const lu = (page) => page.evaluate(() => window.__nv.session?.state?.lineup ?? null);
const pidOf = (page) => page.evaluate(() => window.__nv.session.pid);
const vote = (page, target) => page.evaluate((t) => window.__nv.session.intent('lineup.vote', { target: t }), target);
const use = (page, id, hold) => page.evaluate(([id, hold]) => window.__nv.interactions.debugUse(id, hold), [id, hold]);
const ROLES = ['brain', 'gambler', 'hands', 'bait'];

const env = await startServers({ port: 5191, sigPort: 9013 });
const opt = { width: 420, height: 240, quality: 'low', renderSkip: 12, lineupFast: true, extra: '&level=hideout' }; // the lineup gating lives in the old hub
try {
  const host = await openPlayer(env, { ...opt, name: 'Host' });
  await host.evaluate(() => window.__nv.start(null));
  await until(() => host.evaluate(() => !!window.__nv.player));
  const code = await host.evaluate(() => window.__nv.session.code);
  const pages = [host];
  for (const name of ['Anna', 'Ben', 'Cem']) {
    const p = await openPlayer(env, { ...opt, name, lang: name === 'Anna' ? 'de' : 'en' });
    await p.evaluate((c) => window.__nv.start(c), code);
    pages.push(p);
  }
  const [, a, b, c] = pages;
  await until(async () => (await Promise.all(pages.map((p) => p.evaluate(() => window.__nv.session?.players.size ?? 0)))).every((n) => n === 4), 60000);
  for (const p of pages) await until(() => p.evaluate(() => !!window.__nv.player));
  const pids = await Promise.all(pages.map(pidOf));
  const byPid = Object.fromEntries(pids.map((pid, i) => [pid, pages[i]]));

  // ---- before the lineup
  check('crew of 4: objective sends everyone to the lineup', (await b.evaluate(() => window.__nv.level.objective()[0])).toLowerCase().includes('lineup'));
  check('practice vault is locked until the lineup is done', (await use(a, 'relay', true)) === false && (await use(b, 'key-1')) === false);
  await a.evaluate(() => window.__nv.session.intent('lineup.start'));
  await sleep(800);
  check('only the host can start the lineup', (await lu(host)).phase === 'idle');

  // ---- round 1: clear majority
  await host.evaluate(() => window.__nv.session.intent('lineup.start'));
  await until(async () => (await lu(c))?.phase === 'vote');
  let s = await lu(host);
  check('lineup starts with 4 roles and 4 candidates', s.order.length === 4 && new Set(s.order).size === 4 && s.candidates.length === 4);
  const target1 = pids[1]; // Anna
  await vote(c, pids[3]); // voting for yourself is ignored
  await sleep(300);
  check('nobody can vote for themselves', !(await lu(host)).voted.includes(pids[3]));
  await vote(host, target1);
  // Ben votes with the number key: his first choice in display order
  const benFirst = s.candidates.filter((p) => p !== pids[2])[0];
  await b.evaluate(() => window.__nv.input.debugSet('Digit1', true));
  await sleep(400);
  await b.evaluate(() => window.__nv.input.debugSet('Digit1', false));
  await until(async () => (await lu(host)).voted.includes(pids[2]));
  check('number key casts a vote', (await lu(host)).voted.includes(pids[2]));
  const mid = await lu(a);
  check('ballots stay secret until everyone has voted', mid.phase === 'vote' && mid.result === null && !JSON.stringify(mid).includes('"votes"'));
  await vote(c, target1);
  await vote(a, pids[0]);
  await until(async () => (await lu(a))?.phase === 'reveal');
  s = await lu(a);
  const expect1 = { [pids[0]]: target1, [pids[2]]: benFirst, [pids[3]]: target1, [pids[1]]: pids[0] };
  check('reveal shows who voted for whom', JSON.stringify(Object.entries(s.result.votes).sort()) === JSON.stringify(Object.entries(expect1).sort()));
  const tally = {};
  for (const t of Object.values(expect1)) tally[t] = (tally[t] || 0) + 1;
  const top = Math.max(...Object.values(tally));
  const leaders = Object.keys(tally).filter((k) => tally[k] === top);
  check('most votes wins the role', leaders.includes(s.result.winner) && s.result.role === s.order[0], `${tally[s.result.winner]} votes`);
  const w1 = s.result.winner;

  // ---- round 2: tie
  await until(async () => { const x = await lu(host); return x.round === 1 && x.phase === 'vote'; });
  s = await lu(host);
  check('the winner got the role and left the candidate list', s.roles[w1] === s.order[0] && !s.candidates.includes(w1) && s.candidates.length === 3);
  const [p, q] = s.candidates;
  const voters = pids.slice();
  // two votes for p, two for q (nobody for themselves)
  const plan = {};
  let np = 0, nq = 0;
  for (const v of voters) {
    if (v === p) { plan[v] = q; nq++; }
    else if (v === q) { plan[v] = p; np++; }
  }
  for (const v of voters) {
    if (plan[v]) continue;
    if (np <= nq) { plan[v] = p; np++; } else { plan[v] = q; nq++; }
  }
  for (const v of voters) await vote(byPid[v], plan[v]);
  await until(async () => { const x = await lu(b); return x.phase === 'reveal' && x.round === 1; });
  s = await lu(b);
  check('a tie is settled between the tied players only', np === nq && s.result.tied.length === 2 && s.result.tied.includes(s.result.winner), `${np}:${nq}`);

  // ---- round 3: nobody votes, the timer decides
  await until(async () => { const x = await lu(host); return x.round === 2 && x.phase === 'vote'; });
  await until(async () => { const x = await lu(host); return x.round === 2 && x.phase === 'reveal'; }, 15000);
  s = await lu(host);
  check('no votes before the timer: the Broker picks a candidate', Object.keys(s.result.votes).length === 0 && s.candidates.includes(s.result.winner));

  // ---- round 4: last role by elimination
  await until(async () => (await lu(c)).phase === 'done', 20000);
  const done = await Promise.all(pages.map(lu));
  const roles = done[0].roles;
  check('everyone ends up with exactly one role, all four used', pids.every((x) => ROLES.includes(roles[x])) && new Set(Object.values(roles)).size === 4, JSON.stringify(Object.values(roles)));
  check('all players see the same roles', done.every((d) => JSON.stringify(d.roles) === JSON.stringify(roles)));
  await sleep(600);
  const saved = await Promise.all(pages.map((pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('nullvault.campaign.v1') || '{}').roles || {})));
  check('roles are saved on the host and mirrored on every device', saved.every((r) => JSON.stringify(r) === JSON.stringify(roles)));
  const rowRoles = await b.evaluate(() => [...document.querySelectorAll('.crew-role')].map((e) => e.textContent));
  check('crew list shows the roles', rowRoles.length === 4, rowRoles.join(','));

  // ---- roles gate the practice vault
  const brain = pids.find((x) => roles[x] === 'brain');
  const bait = pids.find((x) => roles[x] === 'bait');
  const notBrain = pids.find((x) => x !== brain);
  check('only the Brain can use the keypad', (await use(byPid[notBrain], 'key-1')) === false && (await use(byPid[brain], 'key-1')) === true);
  await until(async () => (await host.evaluate(() => window.__nv.session.state.tut.entered.length)) === 1);
  // a non-Brain sending the intent directly is refused by the host too
  await byPid[notBrain].evaluate(() => window.__nv.session.intent('key', { k: 2 }));
  await sleep(500);
  check('the host rejects key presses from anyone else', (await host.evaluate(() => window.__nv.session.state.tut.entered.length)) === 1);
  check('the relay is open to everyone', (await use(byPid[notBrain], 'relay', true)) === true);
  await use(byPid[notBrain], 'relay', false);
  const brainName = await byPid[brain].evaluate(() => window.__nv.session.name);
  const obj = await until(async () => {
    const o = await byPid[notBrain].evaluate(() => window.__nv.level.objective().join(' | '));
    return o.includes(brainName) ? o : false;
  }, 8000);
  check('objective names the Brain', !!obj, String(obj));
  // solve it as the Brain, then only the Bait can take the kit
  await byPid[brain].evaluate(() => {
    const t = window.__nv.session.state.tut;
    window.__nv.interactions.debugUse('key-c');
    for (const d of t.order.map((c) => t.code[c])) window.__nv.interactions.debugUse('key-' + d);
  });
  await until(async () => (await host.evaluate(() => window.__nv.session.state.tut.open)) === true);
  await sleep(4500);
  const notBait = pids.find((x) => x !== bait);
  check('only the Bait can take the comms kit', (await use(byPid[notBait], 'kit')) === false && (await use(byPid[bait], 'kit')) === true);

  // ---- redo with a player leaving mid-vote, then rejoining
  await host.evaluate(() => window.__nv.session.intent('lineup.start'));
  await until(async () => (await lu(host)).phase === 'vote');
  await c.evaluate(() => window.__nv.leave());
  await until(async () => (await lu(host)).people.length === 3);
  await until(async () => (await lu(host)).phase === 'done', 40000);
  s = await lu(host);
  check('lineup finishes when someone leaves mid-vote', Object.keys(s.roles).length === 3 && new Set(Object.values(s.roles)).size === 3 && !s.roles[pids[3]]);
  await c.evaluate((code) => window.__nv.start(code), code);
  const late = await until(async () => { const x = await lu(host); return x.roles[pids[3]] && new Set(Object.values(x.roles)).size === 4; }, 40000);
  check('a late joiner gets the role that is left', !!late);

  // ---- solo dry run with bots
  const solo = await openPlayer(env, { ...opt, name: 'Solo' });
  await solo.evaluate(() => window.__nv.start(null));
  await until(() => solo.evaluate(() => !!window.__nv.player));
  check('solo: no lineup required', (await use(solo, 'relay', true)) === true);
  await use(solo, 'relay', false);
  await solo.evaluate(() => window.__nv.session.intent('lineup.start'));
  await until(async () => (await lu(solo)).phase === 'vote');
  s = await lu(solo);
  check('solo: dry run with three bots', s.preview === true && s.people.length === 4 && s.people.filter((x) => x.bot).length === 3);
  await until(async () => (await lu(solo)).phase === 'done', 40000);
  await until(async () => (await lu(solo)).phase === 'idle', 15000);
  s = await lu(solo);
  const soloSave = await solo.evaluate(() => JSON.parse(localStorage.getItem('nullvault.campaign.v1') || '{}').roles || {});
  check('solo: nothing from the dry run is kept', s.phase === 'idle' && Object.keys(s.roles).length === 0 && Object.keys(soloSave).length === 0);

  const missing = await host.evaluate(() => window.__nv.missingTranslations());
  check('every text exists in English and German', missing.length === 0, missing.join(', '));
  const errors = [...pages, solo].flatMap((pg) => pg.errors);
  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' || '));
} catch (e) {
  console.log('TEST CRASHED', e);
  failed++;
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
