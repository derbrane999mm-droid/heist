// The first-person job on the test stage (?level=job): solo and four players.
// A job runs from the plan to the debrief on the stage, the HUD replaces the overlay during the run (the
// planning overlay never opens), objectives follow the beats and every role has one, decisions are a glass
// pop-up on the decider's page only (number keys), the others see one line, secret offers are a pop-up on
// their owner's page only (accept with targets / decline), a skill request reaches only its role holder and
// shows "E ..." at its place (E opens the game), finishing it advances the job, walking away falls back to
// the dice, beats wait for the inside crew, guards report an alarm, the intro card shows once, Tab holds the log.
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
async function drive(page, me, { hold = false, finishSkill = true, offerMode = 'keys', stats = {} } = {}) {
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
    case 'offer':
      if (pv?.offer && !pv.offer.answered && !p.mid) await A({ t: 'offer', answer: 'decline' });
      else if (pv?.offer && !pv.offer.answered && p.mid) {
        // mid-job offers: the glass pop-up on this page
        const st = await dbg(page);
        if (st.popup !== 'offer') break;
        if (offerMode === 'keys') {
          stats.offerKeys = (stats.offerKeys || 0) + 1;
          await page.keyboard.press('Digit1'); // accept; then the first target(s)
        } else {
          stats.offerClicks = (stats.offerClicks || 0) + 1;
          await page.click('[data-jb-offer="decline"]');
        }
        await sleep(150);
      }
      break;
    case 'accuse': if (pv?.accuse && !pv.accuse.choice) await A({ t: 'accuse', target: 'pass' }); break;
    case 'run': {
      const d = p.run.decision;
      const st = await dbg(page);
      if (d && d.who === me && !d.bot) {
        // the decider answers his glass pop-up with a number key
        if (st.popup !== 'decision') break;
        // like a person: read it for a moment (the others' pages show "… decides …" meanwhile)
        const dk = p.job + ':' + p.run.shown;
        if (stats.decAt?.k !== dk) { stats.decAt = { k: dk, t: Date.now() }; break; }
        if (Date.now() - stats.decAt.t < 1200) break;
        const i = Math.max(0, d.options.findIndex((x) => PREFER.includes(x.id)));
        stats.decKeys = (stats.decKeys || 0) + 1;
        await page.keyboard.press('Digit' + (i + 1));
        await sleep(150);
        break;
      }
      if (stats.holdSafe && p.run.choice?.at === 'safe') break; // the test looks at the safe from afar first
      // loot: pick up the nearest bag, carry it to the van, stow it (stats.carry: 'all' | 'one' | 'none')
      if (!hold && st.loot && !st.game && !st.skill && p.plan.posts[me] === 'inside' && (stats.carry ?? 'all') !== 'none') {
        const myPid = await page.evaluate(() => window.__nv.session.pid);
        const L = st.loot;
        const mine = L.bags.find((b) => b.s === 'carry' && b.by === myPid);
        const inVan = L.bags.filter((b) => b.s === 'van').length;
        const van = await page.evaluate(() => window.__nv.job.debugAnchor('van'));
        if (mine && van) {
          await page.evaluate((a) => window.__nv.tp(a.x, a.y + 0.02, a.z + 0.3), van);
          await sleep(250);
          await page.evaluate(() => window.__nv.job.loot.debugAct('stow'));
          stats.stowed = (stats.stowed || 0) + 1;
          await sleep(250);
          break;
        }
        const k = L.bags.findIndex((b) => b.s === 'lie');
        if (k >= 0 && !L.left && (stats.carry !== 'one' || inVan === 0)) {
          const b = L.bags[k];
          await page.evaluate((b) => window.__nv.tp(b.x + 0.3, b.y + 0.02, b.z), b);
          await sleep(250);
          await page.evaluate((k) => window.__nv.job.loot.debugAct('take', k), k);
          stats.taken = (stats.taken || 0) + 1;
          await sleep(250);
          break;
        }
        if (stats.carry === 'one' && inVan > 0 && !L.left && L.bags.some((b) => b.s === 'lie') && van && !stats.departed) {
          // "Abfahrt": hold E at the van; everyone sees the countdown
          await page.evaluate((a) => window.__nv.tp(a.x, a.y + 0.02, a.z + 0.3), van);
          await sleep(250);
          await page.evaluate(() => window.__nv.job.loot.debugAct('depart'));
          stats.departed = Date.now();
          break;
        }
      }
      if (!hold && st.at) await page.evaluate((a) => window.__nv.tp(a.x, a.y + 0.02, a.z + 0.3), st.at);
      if (finishSkill && st.prompt && !st.game) {
        stats.prompts = (stats.prompts || 0) + 1;
        await page.keyboard.press('KeyE');
        await sleep(150);
      } else if (finishSkill && st.game) await page.evaluate((id) => window.__nv.level.games[id].debugFinish(true), st.game);
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
    check('solo: HUD shows the meters and one objective with distance', /Time/.test(r0.hudText) && /Noise/.test(r0.hudText) && r0.obj.length > 3 && / m$/.test(r0.dist), JSON.stringify({ obj: r0.obj, dist: r0.dist, sub: r0.sub }));
    check('solo: the intro card shows at the start of the run', r0.intro && r0.introCount === 1);
    await page.keyboard.press('ShiftLeft');
    await sleep(200);
    check('solo: any key closes the intro card', !(await dbg(page)).intro);
    check('solo: the world marker stands at the objective', r0.marker3d || r0.edge);
    // the 'in' beat waits for me at the door
    const waiting = await until(async () => { const p = await drive(page, 'brain', { hold: true }); return p?.run?.waitAt ? p : false; }, 30000, 300);
    const wobj = await dbg(page);
    check('solo: a beat waits for the inside crew at its place (gate)', !!waiting && !!wobj.objective && wobj.marker, `${wobj.objective} · ${wobj.hudText.slice(-60)}`);
    // follow the job; record objectives; at the vault: first stay away, then walk there
    const objectives = new Set([r0.objective, wobj.objective]);
    const objTexts = new Set([r0.obj, wobj.obj]);
    const stats = { holdSafe: true };
    let skillSeen = null, openedFar = false, skillDone = false, alertSent = false, doorOpen = false;
    let standInLock = false, safePopup = null, safeFar = 0, lootCount = '', diceSeen = '';
    const toasts = new Set();
    let overlayInRun = false, popupNotFrozen = false, decPopup = null, promptBeforeGame = false, gameAfterE = false, logSeen = null, logClosed = false, offerPopup = null, offerTargetStep = false;
    const end = await until(async () => {
      let st = await dbg(page);
      // the safe is answered at its place: away from it, no prompt and no game (they show on arrival)
      let holdSafe = false;
      const p0 = await pub(page);
      if (p0?.run?.choice?.at === 'safe' && st.objective === 'safe' && safeFar < 2) {
        safeFar++;
        holdSafe = true;
        await page.evaluate((a) => window.__nv.tp(a.x, a.y + 0.02, a.z + 8), st.at);
        await sleep(1200);
        st = await dbg(page);
        if (st.prompt || st.game) openedFar = true;
      }
      stats.holdSafe = safeFar < 2;
      if (st.objective) objectives.add(st.objective);
      if (st.obj) objTexts.add(st.obj);
      if (st.loot?.count) lootCount = st.loot.count;
      if (st.toast) toasts.add(st.toast);
      if (st.dice) diceSeen = st.dice;
      const pp = await pub(page);
      if (pp && (pp.phase === 'run' || (pp.phase === 'offer' && pp.mid)) && st.overlay) overlayInRun = true;
      if (st.popup === 'decision' && !decPopup) {
        decPopup = { text: st.popText, opts: await page.evaluate(() => document.querySelectorAll('.jb-pop [data-jb-opt]').length) };
        popupNotFrozen = !(await page.evaluate(() => window.__nv.player.frozen));
      }
      if (st.popup === 'offer' && !offerPopup) offerPopup = { text: st.popText, btns: await page.evaluate(() => document.querySelectorAll('.jb-pop [data-jb-offer]').length) };
      if (st.popup === 'offer' && st.offerStep !== 'main') offerTargetStep = await page.evaluate(() => document.querySelectorAll('.jb-pop [data-jb-target]').length > 0);
      if (st.prompt && !st.game) {
        promptBeforeGame = await page.evaluate(() => !!document.querySelector('[data-jb-skill]:not(.hidden)'));
        await page.keyboard.press('KeyE');
        await sleep(250);
        gameAfterE = (await dbg(page)).game !== null;
      }
      if (pp?.phase === 'run' && pp.run.beats.length >= 3 && !logSeen) {
        await page.keyboard.down('Tab');
        await sleep(200);
        logSeen = await dbg(page);
        await page.keyboard.up('Tab');
        await sleep(150);
        logClosed = !(await dbg(page)).log;
      }
      if ((st.skillLog || []).some((x) => x.game === 'lock' && x.standIn && x.holder === 'hands')) standInLock = true;
      if (!skillSeen) skillSeen = (st.skillLog || []).find((x) => x.game === 'safe') ?? null;
      if (st.popup === 'decision' && /safe|Tresor/i.test(st.popText)) safePopup = st.popText;
      if (st.skill && !skillSeen && st.skill.game === 'safe') skillSeen = st.skill;
      const p = await pub(page);
      if (p?.run && !alertSent && p.run.beats.length >= 3) { alertSent = true; await page.evaluate(() => window.__nv.level.guards.fire()); }
      if (!doorOpen) doorOpen = (await page.evaluate(() => window.__nv.level.doors())).liefer;
      // stay away from the safe until its request is here: it must wait for me (the gate gives up after its timeout)
      await drive(page, 'brain', { hold: holdSafe, stats });
      if ((await dbg(page)).lastResult) skillDone = true;
      return p?.phase === 'debrief' ? p : false;
    }, 240000, 300);
    check('solo: the job runs on the stage until the debrief', !!end);
    check('solo: objectives follow the beats (door, safe, van)', ['door.liefer', 'van'].every((k) => objectives.has(k)) && (!skillSeen || objectives.has('safe')), [...objectives].join(','));
    check('solo: the safe skill request reached the Wortführer', !!skillSeen && skillSeen.game === 'safe' && skillSeen.variant === 'elek', JSON.stringify(skillSeen));
    check('solo: away from the safe no prompt and no game (they show on arrival)', !!skillSeen && safeFar > 0 && !openedFar && skillDone, JSON.stringify({ safeFar, openedFar }));
    const lines = await page.evaluate(() => window.__nv.plan.controller.debugMachine.S.run.beats.flatMap((b) => b.lines.map((l) => l.x?.k ?? l.roll?.label?.k)));
    check('solo: finishing the skill game advances the job with its result', skillDone && lines.includes('ln.skillOk') && !lines.includes('rl.combo'));
    check('solo: the planning overlay stays closed during the run', !overlayInRun);
    if (decPopup) {
      check('solo: a decision is a glass pop-up with its options (player not frozen)', decPopup.opts >= 2 && popupNotFrozen, JSON.stringify(decPopup));
      check('solo: decisions were answered with number keys', (stats.decKeys || 0) > 0 && lines.includes('ln.choice'), JSON.stringify(stats));
    } else console.log('      solo: no decision pop-up in this job (door and safe are answered at their place)');
    const who = await page.evaluate(() => window.__nv.plan.controller.debugMachine.S.run.beats.flatMap((b) => b.lines).filter((l) => l.x?.k === 'ln.skillOk' || l.x?.k === 'ln.skillNo').map((l) => l.x.p.who.r));
    check('solo: the player picked the door lock himself (stand-in for the bot Hände) and opened the safe', standInLock && who.length >= 2 && who.every((r) => r === 'brain'), JSON.stringify({ standInLock, who }));
    check('solo: the safe asked no pop-up (E at the safe chose the way)', !safePopup && !lines.includes('ln.choice') || !safePopup, String(safePopup));
    check('solo: the secret offer is a glass pop-up with accept/decline', !!offerPopup && offerPopup.btns === 2, JSON.stringify(offerPopup));
    const myOffer = await page.evaluate(() => window.__nv.plan.controller.debugMachine.S.offers.find((o) => o.human && o.when === 'mid'));
    check('solo: accepting the offer with keys (incl. its target step) reached the machine', !!myOffer && myOffer.state === 'accepted' && (!myOffer.target || offerTargetStep), JSON.stringify({ myOffer: myOffer && { id: myOffer.id, state: myOffer.state, target: myOffer.target, partner: myOffer.partner }, offerTargetStep }));
    check('solo: at the task place the prompt "E ..." shows and E opens the game', promptBeforeGame && gameAfterE);
    check('solo: holding Tab shows the log, releasing hides it', !!logSeen && logSeen.log && logSeen.logText.length > 20 && logClosed);
    check('solo: the objective text changes with the beats', objTexts.size >= 3, [...objTexts].join(' | '));
    check('solo: the intro card showed only once', (await dbg(page)).introCount === 1);
    check('solo: the entrance opened', doorOpen);
    check('solo: a guard alarm reached the machine', await page.evaluate(() => !!window.__nv.plan.controller.debugMachine.S.run.guardAlert) && lines.includes('ln.guardAlert'));
    const fin = await dbg(page);
    const runLoot = await page.evaluate(() => window.__nv.plan.controller.debugMachine.S.run.loot.map((l) => ({ t: l.t, kept: l.kept ?? 1 })));
    check('solo: bags appeared at the target, were carried and stowed in the van', fin.loot && fin.loot.bags.length >= 2 && fin.loot.bags.every((b) => b.s === 'van') && stats.stowed >= fin.loot.bags.length && runLoot.every((l) => l.kept === 1), JSON.stringify({ bags: fin.loot?.bags.map((b) => b.t + ':' + b.s), stats: { taken: stats.taken, stowed: stats.stowed }, runLoot }));
    check('solo: the HUD counted the secured loot', /Loot secured: \d+ of \d+|Beute gesichert/.test(lootCount), lootCount);
    check('solo: a target done shows a centred toast', toasts.size > 0, [...toasts].join(' | '));
    console.log('      solo: dice countdown seen:', diceSeen || '(none)');
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
    let overlayInRun = 0, decLeak = 0, offerLeak = 0, watcherLine = '', decPopupBy = new Set(), offerPopupBy = new Set();
    const objBy = {}, stats4 = { brain: { carry: 'one' }, gambler: { carry: 'none' }, hands: { carry: 'none' }, bait: { carry: 'none' } };
    const countBy = {}, departBy = {};
    const end = await until(async () => {
      const hp = await pub(host);
      for (const p of pages) {
        const me = roleOfPage.get(p);
        const st = await dbg(p);
        const pv = await p.evaluate(() => { const r = window.__nv.plan.view.received; return r.length ? r[r.length - 1] : null; });
        if (hp && (hp.phase === 'run' || (hp.phase === 'offer' && hp.mid))) {
          if (st.overlay) {
            // the page may lag the host by a frame: count it only if its own state is the run and it stays open
            await sleep(300);
            const own = await pub(p);
            if (own && (own.phase === 'run' || (own.phase === 'offer' && own.mid)) && (await dbg(p)).overlay) overlayInRun++;
          }
          if (st.obj) (objBy[me] ||= new Set()).add(st.obj);
          if (st.loot?.count) countBy[me] = st.loot.count;
          if (st.loot?.departText) departBy[me] = st.loot.departText;
          const d = hp.run?.decision;
          if (st.popup === 'decision') {
            if (d && d.who === me) decPopupBy.add(me);
            else if (d) decLeak++;
          }
          if (d && !d.bot && d.who !== me && /decides/.test(st.event)) watcherLine = st.event;
          if (st.popup === 'offer') {
            if (pv?.offer && pv.offer.when === 'mid') offerPopupBy.add(me);
            else offerLeak++;
          }
        }
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
        await drive(p, me, { offerMode: me === 'brain' ? 'keys' : 'click', stats: (stats4[me] ||= {}) });
        if (me === 'brain' && st.lastResult?.ok) safeOk = true;
      }
      const p = await pub(host);
      return p?.phase === 'debrief' ? p : false;
    }, 300000, 300);
    check('4p: the job runs on the stage until the debrief', !!end);
    const L4 = await host.evaluate(() => ({ loot: window.__nv.plan.controller.debugMachine.S.run.loot.map((l) => ({ t: l.t, kept: l.kept ?? 1, v: l.v })), bags: window.__nv.job.debugState().loot }));
    check('4p: the loot count showed on every page', ['brain', 'gambler', 'hands', 'bait'].every((r) => /Loot secured|Beute gesichert/.test(countBy[r] || '')), JSON.stringify(countBy));
    check('4p: "Abfahrt" at the van: countdown on the other pages, the crew left, bags behind are lost', !!stats4.brain.departed && Object.keys(departBy).some((r) => r !== 'brain') && L4.bags.left && L4.bags.bags.some((b) => b.s === 'lost') && L4.bags.bags.some((b) => b.s === 'van'), JSON.stringify({ departBy, bags: L4.bags?.bags.map((b) => b.s) }));
    check('4p: a bag left behind reduces that target\'s take', L4.loot.some((l) => l.kept < 1), JSON.stringify(L4.loot));
    const lines = await host.evaluate(() => window.__nv.plan.controller.debugMachine.S.run.beats.flatMap((b) => b.lines.map((l) => l.x?.k ?? l.roll?.label?.k)));
    check('4p: the door lock request reached only the Hände', lockSeenBy.size === 1 && lockSeenBy.has('hands') && othersSaw === 0, [...lockSeenBy].join(','));
    check('4p: walking away from the lock -> the dice decide', lockWalked && lines.includes('rl.noFumble') && !lines.includes('ln.skillNo'), lines.filter((k) => /skill|noFumble/.test(k)).join(','));
    check('4p: the Wortführer opened the safe by hand', safeOk && lines.includes('ln.skillOk'));
    check('4p: the planning overlay stayed closed during the run on every page', overlayInRun === 0, String(overlayInRun));
    check('4p: every role had an objective', ['brain', 'gambler', 'hands', 'bait'].every((r) => objBy[r]?.size > 0), JSON.stringify(Object.fromEntries(Object.entries(objBy).map(([k, v]) => [k, [...v]]))));
    check('4p: a decision pop-up showed only on its decider\'s page', decPopupBy.size > 0 && decLeak === 0, JSON.stringify({ by: [...decPopupBy], leak: decLeak }));
    check('4p: the others saw one line "… decides …"', !!watcherLine, watcherLine);
    check('4p: decisions were answered with number keys', Object.values(stats4).some((x) => x.decKeys > 0), JSON.stringify(stats4));
    const offers = await host.evaluate(() => window.__nv.plan.controller.debugMachine.S.offers.filter((o) => o.human && o.when === 'mid').map((o) => ({ role: o.role, state: o.state, target: o.target ?? null })));
    check('4p: the mid-job offer pop-up showed only on each owner\'s page', offerPopupBy.size > 0 && offerLeak === 0, JSON.stringify({ by: [...offerPopupBy], leak: offerLeak }));
    check('4p: offers: keys accept (with target), a click declines', offers.length > 0 && offers.every((o) => (o.role === 'brain' ? o.state === 'accepted' : o.state !== 'accepted')) && (stats4.brain?.offerKeys > 0) && Object.values(stats4).some((x) => x.offerClicks > 0), JSON.stringify({ offers, stats4 }));
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
