// The first-person job on the test stage (?level=job): solo and four players.
// A job runs from the plan to the debrief on the stage, the HUD replaces the overlay during the run,
// objectives follow the beats, a skill request reaches only its role holder, finishing it advances the
// job, walking away falls back to the dice, beats wait for the inside crew, guards report an alarm.
// Run: node tests/job.mjs
import { startServers, openPlayer, sleep } from './harness.mjs';
import { until, pub, act, crewOf4, waitForJob, pagesByRole, TEST_TIMES } from './plan-flow.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const SEED = 6; // safe 'elek', silent alarm, guard round (decoder + jammer make the vault reachable)
const TIMES = { ...TEST_TIMES, board: 30000, beat: 150, bot: 400, skill: 60000, gate: 12000 };
const POSTS = { brain: 'inside', hands: 'inside', gambler: 'lookout', bait: 'driver' };
const PREFER = ['pick', 'quiet', 'leave', 'stay', 'hide', 'slow', 'koeder'];

const dbg = (page) => page.evaluate(() => window.__nv.job.debugState());
const role = async (page) => {
  const p = await pub(page);
  const pid = await page.evaluate(() => window.__nv.session.pid);
  return p?.seats?.find((s) => s.pid === pid)?.role ?? null;
};

/** Everything a player does on his own, one step per call. `hold` = do not walk. */
async function drive(page, me, { hold = false, finishSkill = true } = {}) {
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
        for (const id of ['decoder', 'stoer', 'bohrer']) if (!p.board.tools.includes(id)) await A({ t: 'tool', id });
        if (['decoder', 'stoer', 'bohrer'].every((x) => p.board.tools.includes(x))) await A({ t: 'confirm' });
      }
      break;
    case 'plan':
      if (me && p.plan.posts[me] !== POSTS[me]) await A({ t: 'post', role: me, post: POSTS[me] });
      if (brain) {
        for (const s of p.seats) if (s.bot && p.plan.posts[s.role] !== POSTS[s.role]) await A({ t: 'post', role: s.role, post: POSTS[s.role] });
        if (p.plan.targets[0] !== 'tresor') { if (!p.plan.targets.includes('tresor')) await A({ t: 'tgt', id: 'tresor' }); }
        else if (Object.entries(POSTS).every(([r, x]) => p.plan.posts[r] === x)) await A({ t: 'confirm' });
      }
      break;
    case 'offer': if (pv?.offer && !pv.offer.answered) await A({ t: 'offer', answer: 'decline' }); break;
    case 'accuse': if (pv?.accuse && !pv.accuse.choice) await A({ t: 'accuse', target: 'pass' }); break;
    case 'run': {
      const d = p.run.decision;
      if (d && d.who === me && !d.bot) {
        const o = d.options.find((x) => PREFER.includes(x.id)) ?? d.options[0];
        await A({ t: 'choose', id: o.id });
        break;
      }
      const st = await dbg(page);
      if (!hold && st.at) await page.evaluate((a) => window.__nv.tp(a.x, a.y + 0.02, a.z + 0.3), st.at);
      if (finishSkill && st.game) await page.evaluate((id) => window.__nv.level.games[id].debugFinish(true), st.game);
      break;
    }
  }
  return p;
}

const env = await startServers({ port: 5561, sigPort: 9561 });
const opt = { width: 960, height: 600, quality: 'low', renderSkip: 30, lineupFast: true, extra: '&level=job', times: TIMES };
try {
  // ================================================================ solo
  {
    const page = await openPlayer(env, { ...opt, name: 'Mert' });
    await page.evaluate(([t, s]) => { window.__nvPlanTimes = t; window.__nvPlanSeed = s; }, [TIMES, SEED]);
    await page.evaluate(() => window.__nv.start(null));
    await until(() => page.evaluate(() => !!window.__nv.player), 150000);
    check('solo: the test stage is registered with the director', (await dbg(page)).stage);
    await page.evaluate(() => window.__nv.plan.start());
    // planning at full overlay
    const prep = await until(async () => { const p = await pub(page); return p?.phase === 'scout' ? p : (await drive(page, 'brain'), false); }, 60000, 300);
    const d0 = await dbg(page);
    check('solo: preparation uses the full overlay, no HUD', !!prep && d0.overlay && !d0.hud);
    // drive to the run, hold still at the start to see the gate wait
    const run = await until(async () => { const p = await drive(page, 'brain', { hold: true }); return p?.phase === 'run' ? p : false; }, 120000, 300);
    check('solo: the job reaches the run', !!run);
    await sleep(800);
    const r0 = await dbg(page);
    const pos0 = await page.evaluate(() => ({ x: window.__nv.player.position.x, z: window.__nv.player.position.z, frozen: window.__nv.player.frozen }));
    check('solo: run -> HUD on, overlay closed, player can move', r0.hud && !r0.overlay && !pos0.frozen, JSON.stringify({ hud: r0.hud, overlay: r0.overlay, frozen: pos0.frozen }));
    check('solo: the inside crew starts at the van', Math.hypot(pos0.x - 0, pos0.z - 12) < 3, JSON.stringify(pos0));
    check('solo: HUD shows the beat and the meters', /Minute/.test(r0.hudText) && r0.hudText.length > 20, r0.hudText.slice(0, 120));
    // the 'in' beat waits for me at the door
    const waiting = await until(async () => { const p = await drive(page, 'brain', { hold: true }); return p?.run?.waitAt ? p : false; }, 30000, 300);
    const wobj = await dbg(page);
    check('solo: a beat waits for the inside crew at its place (gate)', !!waiting && !!wobj.objective && wobj.marker, `${wobj.objective} · ${wobj.hudText.slice(-60)}`);
    // follow the job; record objectives; at the vault: first stay away, then walk there
    const objectives = new Set([r0.objective, wobj.objective]);
    let skillSeen = null, openedFar = false, skillDone = false, alertSent = false, overlayForCard = false, doorOpen = false;
    const end = await until(async () => {
      const st = await dbg(page);
      if (st.objective) objectives.add(st.objective);
      if (st.skill && !skillSeen) {
        skillSeen = st.skill;
        await sleep(1500);
        openedFar = (await dbg(page)).game !== null; // not at the safe yet: must not open
      }
      const p = await pub(page);
      if (p?.run?.decision?.who === 'brain') overlayForCard ||= (await dbg(page)).overlay && (await page.evaluate(() => window.__nv.player.frozen));
      if (p?.run && !alertSent && p.run.beats.length >= 3) { alertSent = true; await page.evaluate(() => window.__nv.level.guards.fire()); }
      if (!doorOpen) doorOpen = (await page.evaluate(() => window.__nv.level.doors())).liefer;
      // stay away from the safe until its request is here: it must wait for me (the gate gives up after its timeout)
      await drive(page, 'brain', { hold: st.objective === 'safe' && !skillSeen });
      if ((await dbg(page)).lastResult) skillDone = true;
      return p?.phase === 'debrief' ? p : false;
    }, 240000, 300);
    check('solo: the job runs on the stage until the debrief', !!end);
    check('solo: objectives follow the beats (door, safe, van)', ['door.liefer', 'van'].every((k) => objectives.has(k)) && (!skillSeen || objectives.has('safe')), [...objectives].join(','));
    check('solo: the safe skill request reached the Wortführer', !!skillSeen && skillSeen.game === 'safe' && skillSeen.variant === 'elek', JSON.stringify(skillSeen));
    check('solo: away from the safe the game does not open (it opens on arrival)', !!skillSeen && !openedFar && skillDone);
    const lines = await page.evaluate(() => window.__nv.plan.controller.debugMachine.S.run.beats.flatMap((b) => b.lines.map((l) => l.x?.k ?? l.roll?.label?.k)));
    check('solo: finishing the skill game advances the job with its result', skillDone && lines.includes('ln.skillOk') && !lines.includes('rl.combo'));
    check('solo: a decision card opens the overlay (frozen) for its decider', overlayForCard);
    check('solo: the entrance opened', doorOpen);
    check('solo: a guard alarm reached the machine', await page.evaluate(() => !!window.__nv.plan.controller.debugMachine.S.run.guardAlert) && lines.includes('ln.guardAlert'));
    const fin = await dbg(page);
    check('solo: debrief -> full overlay again, HUD off', fin.overlay && !fin.hud);
    check('solo: no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    check('solo: every text exists in English and German', (await page.evaluate(() => window.__nv.missingTranslations().filter((k) => /\bjb|jbl\./.test(k)))).length === 0);
    await page.context().close();
  }

  // ================================================================ four players
  {
    const pages = await crewOf4(env, opt);
    const [host] = pages;
    await host.evaluate((s) => (window.__nvPlanSeed = s), SEED);
    await pages[1].evaluate(() => window.__nv.plan.start());
    const job = await waitForJob(host);
    check('4p: the job starts after the lineup', !!job);
    const by = await pagesByRole(pages);
    const roles = Object.fromEntries(await Promise.all(pages.map(async (p) => [await p.evaluate(() => window.__nv.session.pid), await role(p)])));
    const roleOfPage = new Map(pages.map((p) => [p, null]));
    for (const p of pages) roleOfPage.set(p, await role(p));
    void roles;
    // prep
    const run = await until(async () => {
      for (const p of pages) await drive(p, roleOfPage.get(p), { hold: true });
      return (await pub(host))?.phase === 'run';
    }, 180000, 300);
    check('4p: the job reaches the run', !!run);
    await sleep(800);
    const hudAll = await Promise.all(pages.map(dbg));
    check('4p: HUD on every page during the run', hudAll.every((d) => d.hud), hudAll.map((d) => d.hud).join(','));
    const posLook = await by.gambler.evaluate(() => ({ x: window.__nv.player.position.x, z: window.__nv.player.position.z }));
    const posDrv = await by.bait.evaluate(() => ({ x: window.__nv.player.position.x, z: window.__nv.player.position.z }));
    check('4p: lookout placed at the post, driver at the driver seat', Math.hypot(posLook.x + 9, posLook.z - 9) < 1.5 && Math.hypot(posDrv.x + 3, posDrv.z - 12.5) < 1.5, JSON.stringify([posLook, posDrv]));
    // follow: the Hände walk away from the door lock once it is open -> dice
    let lockSeenBy = new Set(), lockWalked = false, safeOk = false, othersSaw = 0;
    const end = await until(async () => {
      for (const p of pages) {
        const me = roleOfPage.get(p);
        const st = await dbg(p);
        if (st.skill) {
          if (st.skill.game === 'lock') lockSeenBy.add(me);
          if (me !== (st.skill.game === 'lock' ? 'hands' : 'brain')) othersSaw++;
        }
        if (me === 'hands' && st.game === 'lock' && !lockWalked) {
          lockWalked = true;
          await p.evaluate(() => window.__nv.tp(0, 0.02, 14)); // walk away while the lock game is open
          await sleep(600);
          continue;
        }
        await drive(p, me);
        if (me === 'brain' && st.lastResult?.ok) safeOk = true;
      }
      const p = await pub(host);
      return p?.phase === 'debrief' ? p : false;
    }, 300000, 300);
    check('4p: the job runs on the stage until the debrief', !!end);
    const lines = await host.evaluate(() => window.__nv.plan.controller.debugMachine.S.run.beats.flatMap((b) => b.lines.map((l) => l.x?.k ?? l.roll?.label?.k)));
    check('4p: the door lock request reached only the Hände', lockSeenBy.size === 1 && lockSeenBy.has('hands') && othersSaw === 0, [...lockSeenBy].join(','));
    check('4p: walking away from the lock -> the dice decide', lockWalked && lines.includes('rl.noFumble') && !lines.includes('ln.skillNo'), lines.filter((k) => /skill|noFumble/.test(k)).join(','));
    check('4p: the Wortführer opened the safe by hand', safeOk && lines.includes('ln.skillOk'));
    const priv = await Promise.all(pages.map((p) => p.evaluate(() => window.__nv.plan.view.received.filter((m) => m.skill).map((m) => m.role))));
    check('4p: private skill messages only ever carried the receiver\'s own role', priv.every((list, i) => list.every((r) => r === roleOfPage.get(pages[i]))));
    const errs = pages.flatMap((p) => p.errors);
    check('4p: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  }
  // ================================================================ everyone in the host's level
  {
    const host = await openPlayer(env, { ...opt, name: 'Host', extra: '&level=job' });
    await host.evaluate(() => window.__nv.start(null));
    await until(() => host.evaluate(() => !!window.__nv.player), 150000);
    const code = await host.evaluate(() => window.__nv.session.code);
    const guest = await openPlayer(env, { ...opt, name: 'Gast', extra: '' }); // default level
    const before = await guest.evaluate(() => ({ level: window.__nv.levelName, pid: localStorage.getItem('nullvault.settings.v1') }));
    await guest.evaluate((c) => window.__nv.start(c), code);
    const after = await until(async () => {
      const st = await guest.evaluate(() => window.__nv && window.__nv.session && window.__nv.player ? { level: window.__nv.levelName, n: window.__nv.session.players.size, name: [...window.__nv.session.players.values()].find((p) => p.pid === window.__nv.session.pid)?.name, stage: window.__nv.job.debugState().stage } : null).catch(() => null);
      return st && st.level === 'job' && st.n === 2 ? st : false;
    }, 150000, 500);
    check('level: a guest in another level reloads into the host\'s level and rejoins the crew', before.level !== 'job' && !!after && after.stage, JSON.stringify({ before: before.level, after }));
    check('level: name kept after the reload', after && after.name === 'Gast');
    const hostSees = await host.evaluate(() => [...window.__nv.session.players.values()].map((p) => p.name).sort().join(','));
    check('level: the host has the guest back once (no ghost seat)', hostSees === 'Gast,Host', hostSees);
    const errs = [...host.errors, ...guest.errors];
    check('level: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  }
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
