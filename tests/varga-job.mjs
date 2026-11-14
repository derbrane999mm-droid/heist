// The whole evening job in first person on the real location (?level=varga).
//   (a) solo: plan at the van, walk to every objective, play the safe, reach the debrief, start the next job;
//       also through the front door (Vordertür) and the roof hatch (Dachluke)
//   (b) four players: the role holders get their skill games, the Hände give up the lock with Q (dice)
//   (c) nobody moves at all: the timeouts carry the job to the debrief
// Screenshots (1440x900) into test-out/varga-job/. Run: node tests/varga-job.mjs [solo|crew|idle ...]
import fs from 'node:fs';
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import { until, pub, act, crewOf4, waitForJob, TEST_TIMES } from './plan-flow.mjs';

const DIR = `${OUT}/varga-job`;
fs.mkdirSync(DIR, { recursive: true });
const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const SEED = 6; // safe 'elek', guard round
const TIMES = { ...TEST_TIMES, board: 30000, beat: 150, bot: 400, skill: 60000, gate: 15000 };
const POSTS = { brain: 'inside', hands: 'inside', gambler: 'lookout', bait: 'driver' };
const PREFER = ['pick', 'quiet', 'leave', 'stay', 'hide', 'slow', 'koeder'];
const SIZE = { width: 1440, height: 900 };

const dbg = (page) => page.evaluate(() => window.__nv.job.debugState());
const pos = (page) => page.evaluate(() => ({ x: window.__nv.player.position.x, y: window.__nv.player.position.y, z: window.__nv.player.position.z }));
const props = (page) => page.evaluate(() => window.__nv.level.stage.debugProps());
const shot = async (page, name) => {
  await sleep(700);
  await page.screenshot({ path: `${DIR}/${name}.png` });
  console.log('      shot', name);
};
const role = async (page) => {
  const p = await pub(page);
  const pid = await page.evaluate(() => window.__nv.session.pid);
  return p?.seats?.find((s) => s.pid === pid)?.role ?? null;
};

/** Stand behind the van, look at it and press E (the real interaction, not a hook). */
async function planAtVan(page) {
  await page.evaluate(() => window.__nv.tp(1.7, 0.02, 8.25, Math.PI / 2, -0.05));
  const prompt = await until(() => page.evaluate(() => (window.__nv.interactions.promptText?.text ?? '') || false), 8000, 100);
  await page.evaluate(() => window.__nv.input.debugSet('KeyE', true));
  await sleep(150);
  await page.evaluate(() => window.__nv.input.debugSet('KeyE', false));
  const started = await until(async () => (await pub(page))?.phase ?? false, 8000, 100);
  if (!started) await page.evaluate(() => window.__nv.interactions.debugUse('varga.plan')); // fallback, reported below
  return { prompt, started: !!started };
}

/** One step of everything a player does on his own. */
async function drive(page, me, o = {}) {
  const { hold = false, finishSkill = true, entrance = 'liefer', tools = ['decoder', 'stoer', 'bohrer'] } = o;
  const p = await pub(page);
  if (!p || !p.phase) return p;
  const pv = await page.evaluate(() => { const r = window.__nv.plan.view.received; return r.length ? r[r.length - 1] : null; });
  const brain = me === 'brain';
  const A = (a) => act(page, a);
  switch (p.phase) {
    case 'stake': if (me === 'gambler') await A({ t: 'confirm' }); break;
    case 'brief': case 'facts': if (brain) await A({ t: 'confirm' }); break;
    case 'scout':
      if (brain) {
        if (p.board.scout.length === 3) await A({ t: 'confirm' });
        else for (const id of ['parkhaus', 'hausmeister', 'elektriker']) if (!p.board.scout.includes(id)) await A({ t: 'scout', id });
      }
      break;
    case 'shop':
      if (brain) {
        for (const id of tools) if (!p.board.tools.includes(id)) await A({ t: 'tool', id });
        await A({ t: 'confirm' });
      }
      break;
    case 'plan':
      if (me && p.plan.posts[me] !== POSTS[me]) await A({ t: 'post', role: me, post: POSTS[me] });
      if (brain) {
        for (const s of p.seats) if (s.bot && p.plan.posts[s.role] !== POSTS[s.role]) await A({ t: 'post', role: s.role, post: POSTS[s.role] });
        if (p.plan.entrance !== entrance) await A({ t: 'ent', id: entrance });
        else if (p.plan.targets[0] !== 'tresor') { if (!p.plan.targets.includes('tresor')) await A({ t: 'tgt', id: 'tresor' }); }
        else if (Object.entries(POSTS).every(([r, x]) => p.plan.posts[r] === x)) await A({ t: 'confirm' });
      }
      break;
    case 'offer': if (pv?.offer && !pv.offer.answered) await A({ t: 'offer', answer: 'decline' }); break;
    case 'accuse': if (pv?.accuse && !pv.accuse.choice) await A({ t: 'accuse', target: 'pass' }); break;
    case 'run': {
      const d = p.run.decision;
      if (d && d.who === me && !d.bot) {
        const opt = d.options.find((x) => PREFER.includes(x.id)) ?? d.options[0];
        await A({ t: 'choose', id: opt.id });
        break;
      }
      const st = await dbg(page);
      if (!hold && st.at) {
        const far = await page.evaluate((a) => Math.hypot(window.__nv.player.position.x - a.x, window.__nv.player.position.z - a.z) > 1.0, st.at);
        if (far) await page.evaluate((a) => window.__nv.tp(a.x, a.y + 0.03, a.z + 0.3, a.yaw ?? 0), st.at);
      }
      if (finishSkill && st.game) await page.evaluate((id) => window.__nv.level.games[id].debugFinish(true), st.game);
      else if (finishSkill && st.skill && !st.game) {
        // the HUD may ask for E at the anchor before the game opens
        await page.evaluate(() => window.__nv.input.debugSet('KeyE', true));
        await sleep(120);
        await page.evaluate(() => window.__nv.input.debugSet('KeyE', false));
      }
      break;
    }
  }
  return p;
}

const env = await startServers({ port: 5571, sigPort: 9571 });
try {
  // ================================================================ (a) solo
  const solo = async ({ entrance, tools, lang = 'en', shots = false, tag }) => {
    const page = await openPlayer(env, { ...SIZE, name: 'Mert', quality: shots ? 'medium' : 'low', lang, renderSkip: shots ? 0 : 20, extra: '&level=varga' });
    await page.evaluate(([t, s]) => { window.__nvPlanTimes = t; window.__nvPlanSeed = s; }, [TIMES, SEED]);
    await page.evaluate(() => window.__nv.start(null));
    await until(() => page.evaluate(() => !!window.__nv.player), 150000);
    check(`${tag}: the stage is registered`, (await dbg(page)).stage);
    const lights = await page.evaluate(() => { let n = 0; window.__nv.engine.scene.traverse((o) => { if (o.isLight && !o.isAmbientLight) n++; }); return n; });
    if (shots) console.log('      scene lights incl. 4 player torches:', lights);
    const st0 = await planAtVan(page);
    check(`${tag}: at the van the prompt shows and E starts the job`, !!st0.prompt && st0.started, JSON.stringify(st0));
    await until(async () => { const p = await pub(page); return p?.phase === 'scout' ? p : (await drive(page, 'brain', { entrance, tools }), false); }, 60000, 300);
    if (shots) await shot(page, '01-planning-at-van');
    const run = await until(async () => { const p = await drive(page, 'brain', { hold: true, entrance, tools }); return p?.phase === 'run' ? p : false; }, 150000, 300);
    check(`${tag}: the job reaches the run`, !!run);
    const planned = await pub(page);
    check(`${tag}: the plan uses entrance ${entrance}`, planned?.plan?.entrance === entrance, planned?.plan?.entrance);
    await sleep(600);
    const p0 = await pos(page);
    check(`${tag}: the inside crew starts at the van`, Math.hypot(p0.x - 1.9, p0.z - 8.3) < 3, JSON.stringify(p0));
    // rescue: fall out of the world and get put back; hold R from a silly place
    await page.evaluate(() => window.__nv.tp(40, -30, 40));
    const back = await until(async () => { const q = await pos(page); return q.y > -2 ? q : false; }, 5000, 100);
    check(`${tag}: falling out of the world puts me back`, !!back, JSON.stringify(back));
    await page.evaluate(() => window.__nv.tp(30, 0.02, 10));
    await page.evaluate(() => window.__nv.job.debugRescue());
    const r1 = await pos(page);
    const d1 = await dbg(page);
    check(`${tag}: hold R puts me at the objective`, !!d1.at && Math.hypot(r1.x - d1.at.x, r1.z - d1.at.z) < 1.5, JSON.stringify({ r1, at: d1.at, obj: d1.objective }));
    check(`${tag}: the HUD names the hold-R key`, await page.evaluate(() => /R/.test(document.querySelector('.jb-rescue')?.textContent ?? '') && !document.querySelector('.jb-rescue').classList.contains('hidden')));
    const objectives = new Set();
    let skillSeen = null, skillDone = false, doorSeen = false, vaultSeen = false, hatchSeen = false, inShot = false, hudShot = false, lagerShot = false, guardShot = false, safeShot = false, inside = false;
    const end = await until(async () => {
      const st = await dbg(page);
      if (st.objective) objectives.add(st.objective);
      if (st.skill && !skillSeen) skillSeen = st.skill;
      const pr = await props(page);
      doorSeen ||= pr[entrance];
      vaultSeen ||= pr.vault;
      hatchSeen ||= pr.dach;
      const p = await pub(page);
      if (shots && !hudShot && p?.phase === 'run' && st.objective === 'door.' + entrance && !st.overlay) {
        hudShot = true;
        await page.evaluate(() => window.__nv.tp(4.6, 0.14, 1.2, 1.35, 0.02));
        await shot(page, '02-hud-on-the-way-to-the-door');
      }
      const q = await pos(page);
      if (q.x < -0.5 && q.x > -21.7 && q.z < 4.5 && q.z > -12.8) inside = true;
      if (shots && !lagerShot && inside && pr.vault && !st.overlay && !st.game) {
        lagerShot = true;
        await page.evaluate(() => window.__nv.tp(-1.2, 0.3, 3.6, 0.75, 0.05));
        await shot(page, '04-inside-storage-room');
        // the guard: stand a few metres from him, looking at him
        const g = await page.evaluate(() => window.__nv.level.guards?.debugState()?.guards?.[0] ?? null);
        if (g) {
          await page.evaluate((g) => {
            // stand on his route behind him (waypoints see each other), looking at his back
            const A = window.__nv.level.anchors;
            const fx = -Math.sin(g.yaw), fz = -Math.cos(g.yaw);
            let best = null;
            for (let i = 0; A['guard.' + i]; i++) {
              const w = A['guard.' + i];
              const dx = w.x - g.x, dz = w.z - g.z, d = Math.hypot(dx, dz);
              if (d > 0.8 && (dx * fx + dz * fz) / d < -0.7 && (!best || d < best.d)) best = { d, dx, dz };
            }
            const k = best ? Math.min(3.0, best.d - 0.3) / best.d : 0;
            const x = best ? g.x + best.dx * k : g.x - fx * 3, z = best ? g.z + best.dz * k : g.z - fz * 3;
            window.__nv.level.guards && window.__nv.tp(x, 0.3, z, Math.atan2(-(g.x - x), -(g.z - z)), 0.0);
          }, g);
          await sleep(400);
          guardShot = !(await dbg(page)).overlay;
          if (!guardShot) lagerShot = false;
          await shot(page, '05-guard');
        }
      }
      if (shots && !safeShot && st.game === 'safe') {
        safeShot = true;
        await shot(page, '06-safe-game');
      }
      await drive(page, 'brain', { hold: st.objective === 'safe' && !skillSeen, entrance, tools });
      if ((await dbg(page)).lastResult) skillDone = true;
      return p?.phase === 'debrief' ? p : false;
    }, 300000, 300);
    check(`${tag}: the job runs on the location until the debrief`, !!end);
    const facts = await page.evaluate(() => window.__nv.plan.controller.debugMachine.S.facts.safe);
    const entKey = entrance === 'dach' ? 'gate' : 'door.' + entrance;
    check(`${tag}: objectives follow the beats`, [entKey, 'van'].every((k) => objectives.has(k)), [...objectives].join(','));
    check(`${tag}: the safe request matches the true safe and was played`, !!skillSeen && skillSeen.game === 'safe' && (skillSeen.variant === facts || skillSeen.variant === 'drill') && skillDone, JSON.stringify({ skillSeen, facts }));
    check(`${tag}: the entrance opened for this client`, entrance === 'dach' ? hatchSeen : doorSeen);
    check(`${tag}: the vault door opened`, vaultSeen);
    check(`${tag}: the crew got inside the building`, inside);
    if (shots) {
      await sleep(1200);
      await shot(page, '07-debrief');
      check(`${tag}: screenshots of the storage room and the guard`, lagerShot && guardShot && safeShot);
    }
    // after the debrief: back at the van, doors shut, next job from the van
    await sleep(800);
    const pe = await pos(page);
    const pr = await props(page);
    check(`${tag}: after the job I stand by the van and the doors are shut`, Math.hypot(pe.x - 1.9, pe.z - 8.3) < 7 && !pr.liefer && !pr.vorder && !pr.vault, JSON.stringify({ pe, pr }));
    const job1 = (await pub(page)).job;
    await page.evaluate(() => window.__nv.plan.view.close?.());
    const again = await page.evaluate(() => window.__nv.interactions.debugUse('varga.plan'));
    const next = await until(async () => { const p = await pub(page); return p && p.job === job1 + 1 && p.phase !== 'debrief' ? p : false; }, 10000, 200);
    check(`${tag}: the next job starts at the van again`, again && !!next, JSON.stringify({ again, phase: next?.phase }));
    check(`${tag}: no page errors`, page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    check(`${tag}: every text exists in English and German`, (await page.evaluate(() => window.__nv.missingTranslations().filter((k) => /^(jb|varga|lk|sf|gd)\./.test(k)))).length === 0);
    await page.context().close();
  };
  if (want('solo')) {
    await solo({ entrance: 'liefer', tools: ['decoder', 'stoer', 'bohrer'], shots: true, tag: 'solo liefer' });
    await solo({ entrance: 'vorder', tools: ['decoder', 'stoer', 'bohrer'], lang: 'de', tag: 'solo vorder' });
    await solo({ entrance: 'dach', tools: ['seil', 'decoder', 'stoer'], tag: 'solo dach' });
  }

  // ================================================================ (b) four players
  if (want('crew')) {
    const opt = { ...SIZE, quality: 'low', renderSkip: 30, lineupFast: true, extra: '&level=varga', times: TIMES };
    const pages = await crewOf4(env, opt);
    const [host] = pages;
    await host.evaluate((s) => (window.__nvPlanSeed = s), SEED);
    // a guest starts it at the van
    const st0 = await planAtVan(pages[2]);
    check('4p: a guest starts the job at the van', st0.started || !!(await pub(host))?.phase, JSON.stringify(st0));
    const job = await waitForJob(host);
    check('4p: the job starts after the lineup', !!job);
    const roleOf = new Map();
    for (const p of pages) roleOf.set(p, await role(p));
    const run = await until(async () => {
      for (const p of pages) await drive(p, roleOf.get(p), { hold: true });
      return (await pub(host))?.phase === 'run';
    }, 200000, 300);
    check('4p: the job reaches the run', !!run);
    await sleep(800);
    const by = Object.fromEntries([...roleOf.entries()].map(([p, r]) => [r, p]));
    const pl = await pos(by.gambler), pd = await pos(by.bait);
    check('4p: lookout at post.lookout, driver at van.driver', Math.hypot(pl.x + 1.5, pl.z - 14.2) < 1.5 && Math.hypot(pd.x + 3.3, pd.z - 9.75) < 1.5, JSON.stringify([pl, pd]));
    let lockBy = new Set(), gaveUp = false, lockShot = false, safeBy = new Set(), others = 0;
    const end = await until(async () => {
      for (const p of pages) {
        const me = roleOf.get(p);
        const st = await dbg(p);
        if (st.skill) {
          (st.skill.game === 'lock' ? lockBy : safeBy).add(me);
          if (me !== (st.skill.game === 'lock' ? 'hands' : st.skill.variant === 'drill' ? 'hands' : 'brain')) others++;
        }
        if (me === 'hands' && st.game === 'lock' && !gaveUp) {
          if (!lockShot) {
            lockShot = true;
            await p.evaluate(() => (window.__nvRenderSkip = 0));
            // the crew card of the lineup stays 9 s; with test timings the run comes sooner than in a real evening
            await until(() => p.evaluate(() => document.querySelector('.lineup')?.classList.contains('hidden') ?? true), 12000, 200);
            await sleep(1500);
            await shot(p, '03-lock-game-delivery-door');
            const keys = await p.evaluate(() => document.querySelector('.lk-keys, [class*="lk-key"]')?.parentElement?.textContent ?? '');
            check('4p: the lock help shows Q, not Esc', /Q/.test(keys) && !/Esc/.test(keys), keys);
          }
          gaveUp = true;
          await p.evaluate(() => window.__nv.input.debugSet('KeyQ', true));
          await sleep(200);
          await p.evaluate(() => window.__nv.input.debugSet('KeyQ', false));
          continue;
        }
        await drive(p, me);
      }
      const p = await pub(host);
      return p?.phase === 'debrief' ? p : false;
    }, 360000, 300);
    check('4p: the job runs until the debrief', !!end);
    const lines = await host.evaluate(() => window.__nv.plan.controller.debugMachine.S.run.beats.flatMap((b) => b.lines.map((l) => l.x?.k ?? l.roll?.label?.k)));
    check('4p: the door lock reached only the Hände', lockBy.size === 1 && lockBy.has('hands') && others === 0, [...lockBy].join(','));
    check('4p: the Hände gave up with Q -> the dice decided', gaveUp && lines.includes('rl.noFumble'), lines.filter((k) => /skill|noFumble/.test(k)).join(','));
    check('4p: the safe was played by its role holder', safeBy.size >= 1 && lines.includes('ln.skillOk'), [...safeBy].join(','));
    const hostProps = await props(host);
    void hostProps;
    const errs = pages.flatMap((p) => p.errors);
    check('4p: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    for (const p of pages) await p.context().close();
  }

  // ================================================================ (c) nobody moves
  if (want('idle')) {
    const T = { stake: 2500, brief: 2500, board: 3000, facts: 2500, offer: 2500, decide: 2500, accuse: 2500, beat: 150, bot: 300, skill: 3000, gate: 3000 };
    const page = await openPlayer(env, { width: 960, height: 600, name: 'Mert', quality: 'low', renderSkip: 30, extra: '&level=varga' });
    await page.evaluate(([t, s]) => { window.__nvPlanTimes = t; window.__nvPlanSeed = s; }, [T, SEED]);
    await page.evaluate(() => window.__nv.start(null));
    await until(() => page.evaluate(() => !!window.__nv.player), 150000);
    await planAtVan(page);
    const t0 = Date.now();
    let sawSkill = false, sawWait = false;
    const end = await until(async () => {
      const p = await pub(page);
      if (p?.run?.skill) sawSkill = true;
      if (p?.run?.waitAt) sawWait = true;
      return p?.phase === 'debrief' ? p : false;
    }, 300000, 300);
    check('idle: nobody moves, the timeouts carry the job to the debrief', !!end, `${Math.round((Date.now() - t0) / 1000)} s`);
    check('idle: beats waited for the crew and gave up', sawWait);
    console.log('      idle: a skill request timed out:', sawSkill);
    check('idle: no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
