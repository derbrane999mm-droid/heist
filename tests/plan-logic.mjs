// Rules and step machine of the planning round, without a browser.
// Run: node tests/plan-logic.mjs   (Node 22.18+ strips the TypeScript types)
import * as E from '../src/game/plan/logic.ts';
import { hasText, keysIn } from '../src/game/plan/texts.ts';

let failed = 0;
let passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const R = E.ROLE_ORDER;

// ---------------------------------------------------------------------------
// 1. Balance: the prototype's sim.js, run against the TypeScript port
// ---------------------------------------------------------------------------
// Reference numbers from out/plan-test/sim.js (5000 runs per line, same seeds).
const REF = {
  none: { informedCareful: [90.8, 7.6, 4930], informedGierig: [67.7, 18.6, 10278] },
  base: { blindGreedy: [17.4, 82.3, 4807], informedCareful: [84.5, 9.2, 3994], informedGreedy: [45.7, 21.4, 6994], informedGierig: [54.8, 16.1, 7139] },
  all: { informedCareful: [39.4, 40.9, 1514], informedGierig: [35.3, 28.7, 3409] },
};
const REF_CAUGHT_OFFERS = 26; // base mode: share of accepted offers that were reclaimed, %

function shuffle(a, rnd) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// verbatim port of sim.js informedPlan (role ids renamed)
function informedPlan(S, style) {
  const K = (k) => (S.known[k] ? S.known[k].v : null);
  const al = K('alarm'), gd = K('guard'), sf = K('safe'), lt = K('loot'), bl = K('blind'), po = K('police');
  const tools = new Set();
  let entrance = 'liefer', panel = false;
  if (al === 'tuer') entrance = lt === 'lager' ? (gd === 'hund' ? 'vorder' : 'liefer') : 'dach';
  else if (bl === 'dach') entrance = 'dach';
  else if (bl === 'liefer' && gd !== 'hund') entrance = 'liefer';
  else entrance = gd === 'hund' ? 'vorder' : 'liefer';
  if (entrance === 'dach') tools.add('seil');
  if (al === 'tuer' && entrance !== 'dach') tools.add('magnet');
  if (al === 'bewegung') tools.add('schaum');
  if (al === 'still') tools.add('stoer');
  if (!al) { entrance = entrance === 'dach' ? 'liefer' : entrance; if (entrance === 'liefer') panel = true; else tools.add('stoer'); tools.delete('seil'); }
  if ((gd === 'hund' || !gd) && entrance === 'liefer') tools.add('leckerli');
  if ((gd === 'monitor' || !gd) && bl !== entrance) tools.add('schleife');
  let targets = [];
  if (sf === 'elek') tools.add(style.drillElek ? 'bohrer' : 'decoder');
  if (sf === 'zeit' || !sf) { if (lt === 'tresor' || style.greedy || !sf) tools.add('bohrer'); }
  if (lt) targets.push(lt);
  for (const t of style.greedy ? ['tresor', 'lager', 'vitrinen'] : ['tresor', 'vitrinen']) if (targets.indexOf(t) < 0) targets.push(t);
  if (sf === 'zeit' && !tools.has('bohrer')) targets = targets.filter((t) => t !== 'tresor');
  if (!po) tools.add('scanner');
  if (style.car) tools.add('zweitwagen');
  const hTools = ['magnet', 'schaum', 'bohrer'].some((t) => tools.has(t));
  const posts = { brain: 'inside', bait: 'inside', hands: hTools ? 'inside' : 'driver', gambler: hTools ? 'driver' : 'lookout' };
  if (targets.indexOf('lager') >= 0 && !hTools) posts.gambler = 'inside';
  if (tools.has('schleife') && !Object.values(posts).includes('lookout')) tools.delete('schleife');
  const prio = ['seil', 'magnet', 'schaum', 'stoer', 'bohrer', 'decoder', 'leckerli', 'schleife', 'scanner', 'zweitwagen'];
  let list = prio.filter((t) => tools.has(t));
  while (!E.canAfford(S, list)) list.pop();
  E.buy(S, list);
  S.plan = { entrance, panel, posts, targets };
  if (entrance === 'dach' && list.indexOf('seil') < 0) S.plan.entrance = 'liefer';
  const w = gd ? E.windowFor(S, gd) : E.windowFor(S, 'rundgang');
  while (S.plan.targets.length > 1 && E.estimateTime(S)[1] > w + style.slack) S.plan.targets.pop();
  if (S.plan.targets.indexOf('tresor') >= 0 && sf === 'mech' && !S.tools.includes('bohrer') && S.plan.posts.brain !== 'inside') S.plan.posts.brain = 'inside';
}
function blindPlan(S, rnd) {
  const tools = shuffle(S.job.tools.map((t) => t.id), rnd), list = [];
  for (const t of tools) if (E.canAfford(S, list.concat(t))) list.push(t);
  E.buy(S, list);
  const ents = list.includes('seil') ? ['vorder', 'liefer', 'dach'] : ['vorder', 'liefer'];
  const posts = { brain: 'inside', bait: 'inside', hands: rnd() < 0.5 ? 'inside' : 'driver', gambler: 'inside' };
  if (posts.hands === 'inside') posts.gambler = 'driver';
  S.plan = { entrance: ents[Math.floor(rnd() * ents.length)], panel: false, posts, targets: shuffle(['tresor', 'vitrinen', 'lager'], rnd) };
}
const careful = (pushMax, bold) => (S, d) => E.carefulChoice(S, d, pushMax, bold);
const BOTS = {
  blindGreedy: {
    stake: () => 'allin',
    scouts: (S, rnd) => shuffle(S.job.scouts.map((s) => s.id), rnd).slice(0, 3),
    plan: (S, rnd) => blindPlan(S, rnd),
    decide: (S, d) => {
      if (d.push) { const o = d.options.filter((o) => o.id !== 'leave'); return o.length ? o[0].id : 'leave'; }
      for (const p of ['crow', 'fast', 'run', 'stay', 'drill', 'distract']) if (d.options.find((o) => o.id === p)) return p;
      return d.options[0].id;
    },
  },
  informedCareful: { stake: () => 'sicher', scouts: () => ['parkhaus', 'hausmeister', 'lagerist'], plan: (S) => informedPlan(S, { slack: 0 }), decide: careful(8) },
  informedGreedy: { stake: () => 'allin', scouts: () => ['parkhaus', 'elektriker', 'besichtigung'], plan: (S) => informedPlan(S, { slack: 3, greedy: true }), decide: careful(40, true) },
  informedGierig: { stake: () => 'gierig', scouts: () => ['parkhaus', 'elektriker', 'besichtigung'], plan: (S) => informedPlan(S, { slack: 1 }), decide: careful(25) },
};
let MODE = 'base';
const offerAnswer = (S, role) => {
  const yes = MODE === 'all';
  if (yes) { const t = E.offerTargets(S, role); return 'accept:' + t[0] + ':' + t[1]; }
  return 'decline';
};
function play(bot, factSeed, runSeed) {
  const rnd = E.mulberry32(runSeed * 31 + 7);
  const S = E.newGame({ factSeed, runSeed, noOffers: MODE === 'none', botAcceptAll: MODE === 'all' });
  E.setStake(S, bot.stake(S));
  E.doScout(S, bot.scouts(S, rnd));
  const ho = E.humanOffer(S, 'pre');
  if (ho) E.answerOffer(S, ho, offerAnswer(S, ho.role));
  E.botDecide(S, 'pre');
  bot.plan(S, rnd);
  if (E.validatePlan(S).length) { S.plan.panel = false; if (E.validatePlan(S).length) S.plan.entrance = 'liefer'; }
  const g = E.runJob(S);
  let x = g.next();
  while (!x.done) x = g.next(x.value.kind === 'offers' ? Object.fromEntries(x.value.roles.map((r) => [r, offerAnswer(S, r)])) : bot.decide(S, x.value));
  E.accuse(S, 'pass');
  return { r: x.value, S };
}
const NRUN = 5000;
const balance = [];
let allKeysOk = true;
const missingKeys = new Set();
for (const [mode, bots] of Object.entries(REF)) {
  MODE = mode;
  for (const [name, ref] of Object.entries(bots)) {
    let succ = 0, caught = 0, net = 0, offAcc = 0, offCaught = 0;
    for (let i = 0; i < NRUN; i++) {
      const { r, S } = play(BOTS[name], 1000 + i, 50000 + i);
      if (r.success) succ++;
      if (r.caught) caught++;
      net += r.net;
      for (const o of S.offers) if (o.state === 'accepted') { offAcc++; if (o.reclaimed) offCaught++; }
      if (i < 40) for (const k of keysIn([S.run.beats, r])) if (!hasText(k)) missingKeys.add(k);
    }
    const got = [(100 * succ) / NRUN, (100 * caught) / NRUN, net / NRUN];
    balance.push(`${mode.padEnd(5)} ${name.padEnd(16)} success ${got[0].toFixed(1)}% (ref ${ref[0]}) · caught ${got[1].toFixed(1)}% (ref ${ref[1]}) · net ${Math.round(got[2])} (ref ${ref[2]})${mode === 'base' ? ` · offers reclaimed ${((100 * offCaught) / offAcc).toFixed(0)}% (ref ${REF_CAUGHT_OFFERS})` : ''}`);
    const ok = Math.abs(got[0] - ref[0]) <= 1.5 && Math.abs(got[1] - ref[1]) <= 1.5 && Math.abs(got[2] - ref[2]) <= Math.max(150, ref[2] * 0.03) && (mode !== 'base' || Math.abs((100 * offCaught) / offAcc - REF_CAUGHT_OFFERS) <= 2);
    check(`balance ${mode}/${name} matches the prototype`, ok, `${got[0].toFixed(1)}% / ${got[1].toFixed(1)}% / ${Math.round(got[2])}`);
  }
}
console.log('\nBalance (TypeScript port, ' + NRUN + ' runs each):\n  ' + balance.join('\n  ') + '\n');
check('every text key from the rules exists in the German table', missingKeys.size === 0, [...missingKeys].slice(0, 8).join(', '));

// ---------------------------------------------------------------------------
// 2. The step machine
// ---------------------------------------------------------------------------
const FAST = { stake: 4000, brief: 4000, board: 6000, facts: 3000, offer: 3000, decide: 3000, accuse: 3000, beat: 50, bot: 200 };
const OFFER_IDS = E.OFFERS.map((o) => o.id);

/** Things that must never be in the public view before the debrief. */
function leaks(m, pubJson, pub) {
  const out = [];
  if (pub.phase === 'debrief') return out;
  if (/"facts"\s*:/.test(pubJson)) out.push('facts object');
  if (pubJson.includes('"of.')) out.push('offer text key');
  for (const id of OFFER_IDS) if (pubJson.includes(`"${id}"`)) out.push('offer id ' + id);
  if (/"policeAt"|"silent"|"scapegoat"|"mods"|"offers"/.test(pubJson)) out.push('hidden run field');
  // before the job: only what the crew knows
  if (!pub.run) {
    for (const k of m.S.job.factOrder) if (!m.S.known[k] && pubJson.includes(`"fact.${k}.`)) out.push('unknown fact ' + k);
    if (!m.S.known.police && pubJson.includes('"ov.police.')) out.push('unknown fact police (overview)');
    for (const r of R) { const tip = m.S.tips[r]; if (tip && !m.S.known[tip.k] && pubJson.includes(`"fact.${tip.k}.`)) out.push('tip in public view'); }
  }
  if (pub.known) for (const k of Object.keys(pub.known)) if (!m.S.known[k]) out.push('known has extra ' + k);
  return out;
}
function privLeaks(m, role, pv) {
  const out = [];
  if (pv.role !== role) out.push('wrong role');
  if (pv.offer) {
    const own = m.S.offers.find((o) => o.role === role && o.human && o.id === pv.offer.id && o.when === pv.offer.when);
    if (!own) out.push(`offer ${pv.offer.id} is not ${role}'s`);
  }
  for (const x of pv.mine) if (!m.S.offers.some((o) => o.role === role && o.id === x.id && o.when === x.when)) out.push('mine has a foreign offer');
  if (pv.tip && (!m.S.tips[role] || m.S.tips[role].k !== pv.tip.k)) out.push('foreign tip');
  return out;
}

function runMachine(seed, seats, behave, limit = 20000) {
  const m = new E.PlanMachine({ seed, seats, times: FAST }, 0);
  let now = 0;
  const issues = [];
  const seen = new Set();
  const decisions = [];
  for (let i = 0; i < limit && m.phase !== 'debrief'; i++) {
    now += 100;
    m.tick(now);
    if (behave) behave(m, now, decisions);
    const pub = m.pub();
    const j = JSON.stringify(pub);
    for (const l of leaks(m, j, pub)) issues.push(`${pub.phase}: ${l}`);
    for (const r of R) if (m.isHuman(r)) for (const l of privLeaks(m, r, m.priv(r))) issues.push(`${pub.phase}/${r}: ${l}`);
    seen.add(pub.phase);
  }
  for (const k of keysIn(m.pub())) if (!hasText(k)) missingKeys.add(k);
  return { m, issues, seen, decisions };
}

// bots only, many seeds
{
  let reached = 0, issues = [];
  const SEEDS = 150;
  for (let s = 1; s <= SEEDS; s++) {
    const { m, issues: iss } = runMachine(s, R.map((r) => ({ role: r, pid: null, name: 'Bot ' + r })));
    if (m.phase === 'debrief' && m.pub().result?.final?.length === 4) reached++;
    issues.push(...iss);
  }
  check('bots only: the step machine reaches the debrief for every seed', reached === SEEDS, `${reached}/${SEEDS}`);
  check('bots only: no hidden fact or offer in the public view', issues.length === 0, issues.slice(0, 3).join(' | '));
}

// four humans who act: random but valid choices, some accept offers
{
  let reached = 0, issues = [], offersSeen = 0, offersOwn = 0, decidersOk = true, accepted = 0, tipSeen = 0;
  for (let s = 1; s <= 120; s++) {
    const seats = R.map((r, i) => ({ role: r, pid: 'p' + i, name: 'P' + i }));
    const rnd = E.mulberry32(s * 977);
    const { m, issues: iss } = runMachine(s, seats, (m, now) => {
      const p = m.pub();
      if (rnd() < 0.5) return; // act on some ticks only
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      for (const r of R) {
        const pv = m.priv(r);
        if (pv.tip) tipSeen++;
        if (pv.offer && !pv.offer.answered) {
          offersSeen++;
          const yes = rnd() < 0.5;
          const t = pv.offer.targets;
          if (yes) accepted++;
          m.act(r, { t: 'offer', answer: yes ? 'accept:' + t[0] + ':' + t[1] : 'decline' }, now);
        }
        if (pv.accuse && pv.accuse.choice === null) m.act(r, { t: 'accuse', target: pick([...R.filter((x) => x !== r), 'pass']) }, now);
      }
      // someone who is not the decider tries to decide: must be refused
      if (p.run && p.run.decision) {
        const who = p.run.decision.who;
        const other = R.find((x) => x !== who);
        const before = m.version;
        if (m.act(other, { t: 'choose', id: p.run.decision.options[0].id }, now)) decidersOk = false;
        if (m.version !== before) decidersOk = false;
        m.act(who, { t: 'choose', id: pick(p.run.decision.options).id }, now);
      }
      if (p.phase === 'stake') { m.act('brain', { t: 'stake', id: 'allin' }, now) && (decidersOk = false); m.act('gambler', { t: 'stake', id: pick(E.STAKE_ORDER) }, now); m.act('gambler', { t: 'confirm' }, now); }
      if (p.phase === 'scout') { m.act(pick(R), { t: 'scout', id: pick(m.S.job.scouts).id }, now); if (p.board.scout.length === 3) { if (m.act('hands', { t: 'confirm' }, now)) decidersOk = false; m.act('brain', { t: 'confirm' }, now); } }
      if (p.phase === 'shop') { m.act(pick(R), { t: 'tool', id: pick(m.S.job.tools).id }, now); if (rnd() < 0.2) m.act('brain', { t: 'confirm' }, now); }
      if (p.phase === 'plan') {
        const r = pick(R);
        m.act(r, { t: 'post', role: r, post: pick(E.POSTS) }, now);
        if (m.act('hands', { t: 'post', role: 'bait', post: 'driver' }, now)) decidersOk = false; // not his own seat, not a bot
        m.act(pick(R), { t: 'tgt', id: pick(['tresor', 'vitrinen', 'lager']) }, now);
        if (rnd() < 0.2) m.act('brain', { t: 'confirm' }, now);
      }
      if (p.phase === 'brief' || p.phase === 'facts') m.act('brain', { t: 'confirm' }, now);
    });
    if (m.phase === 'debrief') reached++;
    issues.push(...iss);
    offersOwn += m.S.offers.filter((o) => o.human).length;
  }
  check('4 humans: every job ends in the debrief', reached === 120, `${reached}/120`);
  check('4 humans: public view never shows hidden facts, tips or offers; private views only the owner\'s', issues.length === 0, issues.slice(0, 3).join(' | '));
  check('4 humans: every human gets exactly one offer before and one during the job', offersOwn === 120 * 8);
  check('4 humans: only the named role holder can decide, stake, confirm or set a foreign post', decidersOk);
  check('4 humans: offers were shown and answered (some accepted, some tips)', offersSeen > 300 && accepted > 100 && tipSeen > 0, `${offersSeen} shown, ${accepted} accepted, tip ticks ${tipSeen}`);
}

// one human (Wortführer) who never does anything: timers carry the job to the end
{
  const { m, issues, seen } = runMachine(7, R.map((r, i) => ({ role: r, pid: r === 'brain' ? 'solo' : null, name: r })));
  check('solo, idle: timers lock every phase and the job still ends', m.phase === 'debrief' && ['stake', 'brief', 'scout', 'facts', 'offer', 'shop', 'plan', 'run', 'accuse'].every((p) => seen.has(p)), [...seen].join(','));
  check('solo, idle: unanswered offers count as declined', m.S.offers.filter((o) => o.human).every((o) => o.state !== 'accepted'));
  check('solo, idle: no leaks', issues.length === 0, issues.slice(0, 2).join(' | '));
}

// timers: a decision waits for the human, then the default applies after the deadline
{
  const m = new E.PlanMachine({ seed: 3, seats: [{ role: 'brain', pid: 'a', name: 'A' }, { role: 'gambler', pid: 'b', name: 'B' }, { role: 'hands', pid: 'c', name: 'C' }, { role: 'bait', pid: 'd', name: 'D' }], times: FAST }, 0);
  let now = 0, sawDecision = null, deadlineOk = true, waited = true;
  while (m.phase !== 'debrief' && now < 2e6) {
    now += 100;
    m.tick(now);
    const p = m.pub();
    if (p.phase === 'offer') for (const r of R) if (m.priv(r).offer && !m.priv(r).offer.answered) m.act(r, { t: 'offer', answer: 'decline' }, now);
    if (p.run?.decision && !sawDecision) {
      sawDecision = { who: p.run.decision.who, deadline: p.deadline, at: now };
      if (!(p.deadline > now && p.deadline - now <= FAST.decide)) deadlineOk = false;
    }
    if (sawDecision && !sawDecision.done) {
      if (m.pub().run?.decision && now < sawDecision.deadline - 100) continue;
      if (m.pub().run?.decision && now >= sawDecision.deadline + 200) waited = false;
      if (!m.pub().run?.decision || now >= sawDecision.deadline) sawDecision.done = now;
    }
  }
  check('timers: a job decision names its decider and a deadline about 25 s (test: 3 s) ahead', !!sawDecision && deadlineOk);
  check('timers: without an answer the default is taken when the deadline passes', !!sawDecision?.done && waited && sawDecision.done >= sawDecision.deadline);
}

check('every text key from the step machine exists in the German table', missingKeys.size === 0, [...missingKeys].slice(0, 8).join(', '));

// ---------------------------------------------------------------------------
// shopping advice: pure reading of what the crew knows against the tool list
// ---------------------------------------------------------------------------
{
  const toolIds = E.VARGA.tools.map((t) => t.id);
  const STATES = new Set(['fit', 'miss', 'open', 'any']);
  const FK = ['alarm', 'safe', 'guard', 'blind', 'police'];
  const opts = (k) => [null, ...E.VARGA.facts[k].flatMap((v) => [{ v, rumour: false }, { v, rumour: true }])];
  const allOpts = FK.map(opts);
  const strip = (kn) => Object.fromEntries(Object.entries(kn).filter(([, x]) => x).map(([k, x]) => [k, { v: x.v, rumour: false }]));
  let combos = 0, badState = 0, rumourFlag = 0, rumourState = 0;
  const missing = new Set();
  const rumourDiffs = new Set();
  const seenKeys = new Set();
  const idx = FK.map(() => 0);
  for (;;) {
    const known = {};
    FK.forEach((k, i) => { if (allOpts[i][idx[i]]) known[k] = allOpts[i][idx[i]]; });
    const plain = strip(known);
    combos++;
    for (const id of toolIds) {
      const a = E.toolAdvice(known, id);
      if (!STATES.has(a.state)) badState++;
      const want = a.fact ? !!known[a.fact]?.rumour : false;
      if (a.rumour !== want) rumourFlag++;
      const b = E.toolAdvice(plain, id);
      if (a.state !== b.state) { rumourState++; rumourDiffs.add(id); }
      for (const k of keysIn(a.text)) {
        if (!seenKeys.has(k)) { seenKeys.add(k); if (!hasText(k)) missing.add(k); }
      }
    }
    let j = 0;
    while (j < FK.length && ++idx[j] === allOpts[j].length) idx[j++] = 0;
    if (j === FK.length) break;
  }
  check('shop advice: every tool x every known/rumour/unknown combination gives a valid state', badState === 0 && combos > 16000, `${combos} combinations, ${badState} bad`);
  check('shop advice: every text key (nested params included) exists in the German table', missing.size === 0 && seenKeys.size > 20, `${seenKeys.size} keys; missing: ${[...missing].slice(0, 8).join(', ')}`);
  check('shop advice: rumour flag is true exactly when the fact it was read from is a rumour', rumourFlag === 0, `${rumourFlag} mismatches`);
  check('shop advice: a rumour never changes the state compared with the verified value', rumourState === 0, `${rumourState} differences, tools: ${[...rumourDiffs].join(',')}`);

  const groupTools = E.SHOP_GROUPS.flatMap((g) => g.tools);
  const dup = groupTools.filter((t, i) => groupTools.indexOf(t) !== i);
  const unknownT = groupTools.filter((t) => !toolIds.includes(t));
  const absent = toolIds.filter((t) => groupTools.filter((x) => x === t).length !== 1);
  check('shop groups: every tool is in exactly one group', absent.length === 0 && dup.length === 0, `not once: ${absent.join(',')} dup: ${dup.join(',')}`);
  check('shop groups: no unknown tool ids, no empty group, group ids unique', unknownT.length === 0 && E.SHOP_GROUPS.every((g) => g.tools.length && g.facts.length) && new Set(E.SHOP_GROUPS.map((g) => g.id)).size === E.SHOP_GROUPS.length, unknownT.join(','));

  const kn = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v, rumour: false }]));
  const st = (o, id) => E.toolAdvice(kn(o), id).state;
  check('shop advice: safe=zeit -> decoder miss, bohrer fit', st({ safe: 'zeit' }, 'decoder') === 'miss' && st({ safe: 'zeit' }, 'bohrer') === 'fit');
  check('shop advice: safe unknown -> decoder open, bohrer any', st({}, 'decoder') === 'open' && st({}, 'bohrer') === 'any');
  check('shop advice: alarm=still -> stoer fit, magnet and schaum miss', st({ alarm: 'still' }, 'stoer') === 'fit' && st({ alarm: 'still' }, 'magnet') === 'miss' && st({ alarm: 'still' }, 'schaum') === 'miss');
  check('shop advice: guard=hund -> leckerli fit; guard unknown -> leckerli open', st({ guard: 'hund' }, 'leckerli') === 'fit' && st({}, 'leckerli') === 'open');
  const cv = (o, t, g) => E.shopCover(kn(o), t, g);
  check('shop cover: alarm', cv({ alarm: 'tuer' }, ['magnet'], 'alarm') === 'yes' && cv({ alarm: 'tuer' }, [], 'alarm') === 'no' && cv({}, [], 'alarm') === 'unknown');
  check('shop cover: safe', cv({ safe: 'mech' }, [], 'safe') === 'none' && cv({}, ['bohrer'], 'safe') === 'yes');
  check('shop cover: alternatives (alt) and the cases that stay no', cv({ alarm: 'tuer' }, ['seil'], 'alarm') === 'alt' && cv({ alarm: 'bewegung' }, ['seil'], 'alarm') === 'no' && cv({ guard: 'hund' }, [], 'guard') === 'alt' && cv({ guard: 'monitor', blind: 'liefer' }, [], 'guard') === 'alt' && cv({ guard: 'monitor', blind: 'dach' }, ['seil'], 'guard') === 'alt' && cv({ guard: 'monitor', blind: 'dach' }, [], 'guard') === 'no' && cv({ guard: 'monitor', blind: 'keiner' }, ['seil'], 'guard') === 'no' && cv({ guard: 'monitor' }, [], 'guard') === 'no');
  check('shop cover: guard and way', cv({ guard: 'rundgang' }, [], 'guard') === 'none' && cv({ guard: 'monitor' }, ['schleife'], 'guard') === 'yes' && cv({ police: 'kurz' }, [], 'way') === null);
}

// ---------------------------------------------------------------------------
// the Überblick: one row per obstacle plus the time bar, read from what the crew knows
// ---------------------------------------------------------------------------
{
  const STATES = new Set(['ok', 'alt', 'warn', 'open', 'unknown', 'off']);
  const TSTATES = new Set(['ok', 'warn', 'open', 'unknown']);
  const FK = ['alarm', 'guard', 'safe', 'blind', 'police'];
  const opts = (k) => [null, ...E.VARGA.facts[k].flatMap((v) => [{ v, rumour: false }, { v, rumour: true }])];
  const allOpts = FK.map(opts);
  const TOOLSETS = [[], ['magnet'], ['schaum', 'bohrer'], ['stoer', 'decoder', 'leckerli'], ['seil', 'schleife'], ['bohrer', 'decoder', 'scanner', 'schleife', 'leckerli', 'magnet'], ['seil', 'scanner']];
  const PLANS = [
    null,
    { entrance: 'liefer', posts: { brain: 'inside', gambler: 'lookout', hands: 'driver', bait: 'inside' }, targets: ['tresor', 'vitrinen'], panel: true },
    { entrance: 'dach', posts: { brain: 'driver', gambler: 'inside', hands: 'inside', bait: 'inside' }, targets: ['vitrinen'], panel: false },
    { entrance: 'vorder', posts: { brain: 'inside', gambler: 'inside', hands: 'inside', bait: 'driver' }, targets: ['lager', 'tresor'], panel: false },
  ];
  let combos = 0, bad = 0, badTime = 0, badWhat = 0, badPartial = 0, badBy = 0;
  const keys = new Set(), missing = new Set();
  const badEx = [];
  const idx = FK.map(() => 0);
  for (;;) {
    const S = E.newGame({ factSeed: 7 });
    S.known = {};
    FK.forEach((k, i) => { const o = allOpts[i][idx[i]]; if (o) S.known[k] = { v: o.v, rumour: o.rumour, wrong: false, src: 't' }; });
    for (const tools of TOOLSETS)
      for (const pl of PLANS) {
        if (pl) S.plan = JSON.parse(JSON.stringify(pl));
        const o = E.overview(S, tools, !!pl);
        combos++;
        if (o.rows.length !== 4 || o.rows.map((r) => r.id).join() !== 'alarm,guard,safe,police' || o.rows.some((r) => !STATES.has(r.state))) { bad++; if (badEx.length < 3) badEx.push(JSON.stringify(o.rows.map((r) => r.state))); }
        if (o.rows.some((r) => !!r.what !== !!S.known[r.id] || r.rumour !== !!S.known[r.id]?.rumour)) badWhat++;
        if (o.rows.some((r) => r.id !== 'safe' && r.state === 'off')) bad++;
        const t = o.time;
        const wantT = t.partial || t.window === null ? 'unknown' : t.hi > t.window ? 'open' : t.hi > t.window - 2 ? 'warn' : 'ok';
        if (!TSTATES.has(t.state) || t.state !== wantT || t.lo > t.hi || (t.window === null) !== !S.known.guard) badTime++;
        // partial: only with the vault as a target, never with the drill, and the bar is then grey
        const hasTresor = (S.plan.targets || []).includes('tresor');
        if (typeof t.partial !== 'boolean' || (t.partial && (!hasTresor || tools.includes('bohrer') || t.state !== 'unknown'))) badPartial++;
        if (!hasTresor && t.partial) badPartial++;
        if (o.rows.some((r) => r.id !== 'police' && r.state === 'open' && !r.by)) badBy++;
        for (const k of keysIn(o)) if (!keys.has(k)) { keys.add(k); if (!hasText(k)) missing.add(k); }
      }
    let j = 0;
    while (j < FK.length && ++idx[j] === allOpts[j].length) idx[j++] = 0;
    if (j === FK.length) break;
  }
  check('overview: valid row ids and states for every known/rumour/unknown x tools x plan combination', bad === 0 && combos > 50000, `${combos} combinations, ${bad} bad ${badEx.join(' ')}`);
  check('overview: `what` and `rumour` follow exactly what the crew knows', badWhat === 0, `${badWhat} bad`);
  check('overview: time state follows the thresholds; window null exactly while the guard is unknown', badTime === 0, `${badTime} bad`);
  check('overview: time.partial is a boolean, only with the vault as target and no drill, and the bar is then unknown', badPartial === 0, `${badPartial} bad`);
  check('overview: every open alarm/guard/safe row says what is missing (`by`)', badBy === 0, `${badBy} bad`);
  check('overview: every text key it can return exists', missing.size === 0 && keys.size > 25, `${keys.size} keys; missing: ${[...missing].join(', ')}`);

  // spot checks
  const mk = (known = {}, plan = null) => {
    const S = E.newGame({ factSeed: 7 });
    S.known = Object.fromEntries(Object.entries(known).map(([k, v]) => [k, { v, rumour: false, wrong: false, src: 't' }]));
    if (plan) S.plan = { entrance: 'liefer', posts: { brain: 'inside', gambler: 'lookout', hands: 'inside', bait: 'driver' }, targets: ['tresor'], panel: false, ...plan, posts: { brain: 'inside', gambler: 'lookout', hands: 'inside', bait: 'driver', ...(plan.posts || {}) } };
    return S;
  };
  const ov = (known, tools, plan) => E.overview(mk(known, plan), tools, !!plan);
  const row = (o, id) => o.rows.find((r) => r.id === id);
  const st = (known, tools, plan, id) => row(ov(known, tools, plan), id).state;
  const by = (known, tools, plan, id) => row(ov(known, tools, plan), id).by?.k ?? null;
  const none = ov({}, [], null);
  check('overview: nothing known -> all four rows unknown, no window', none.rows.every((r) => r.state === 'unknown' && r.what === null) && none.time.window === null && none.time.state === 'unknown');
  check('overview alarm: tool fits -> ok; wrong tool -> open; panel -> alt', st({ alarm: 'still' }, ['stoer'], null, 'alarm') === 'ok' && st({ alarm: 'still' }, ['magnet'], null, 'alarm') === 'open' && st({ alarm: 'bewegung' }, [], { panel: true }, 'alarm') === 'alt' && by({}, [], { panel: true }, 'alarm') === 'ov.by.panel');
  check('overview alarm: magnet without the Hände inside -> warn; Störsender needs no hands', st({ alarm: 'tuer' }, ['magnet'], { posts: { hands: 'driver' } }, 'alarm') === 'warn' && by({ alarm: 'tuer' }, ['magnet'], { posts: { hands: 'driver' } }, 'alarm') === 'ov.by.noHands' && st({ alarm: 'still' }, ['stoer'], { posts: { hands: 'driver' } }, 'alarm') === 'ok' && st({ alarm: 'tuer' }, ['magnet'], null, 'alarm') === 'ok');
  check('overview alarm: door contacts and the roof hatch', st({ alarm: 'tuer' }, ['seil'], null, 'alarm') === 'alt' && by({ alarm: 'tuer' }, ['seil'], null, 'alarm') === 'ov.by.roofOpt' && st({ alarm: 'tuer' }, ['seil'], { entrance: 'dach' }, 'alarm') === 'alt' && by({ alarm: 'tuer' }, ['seil'], { entrance: 'dach' }, 'alarm') === 'ov.by.roof' && st({ alarm: 'tuer' }, ['seil'], { entrance: 'vorder' }, 'alarm') === 'open' && st({ alarm: 'bewegung' }, ['seil'], null, 'alarm') === 'open');
  check('overview guard: round -> ok; dog by entrance; dog treats -> ok', st({ guard: 'rundgang' }, [], null, 'guard') === 'ok' && st({ guard: 'hund' }, [], null, 'guard') === 'alt' && st({ guard: 'hund' }, [], { entrance: 'liefer' }, 'guard') === 'open' && st({ guard: 'hund' }, [], { entrance: 'vorder' }, 'guard') === 'alt' && st({ guard: 'hund' }, ['leckerli'], { entrance: 'liefer' }, 'guard') === 'ok');
  check('overview guard: monitor room, loop and blind spot', st({ guard: 'monitor' }, [], null, 'guard') === 'open' && st({ guard: 'monitor' }, ['schleife'], null, 'guard') === 'ok' && st({ guard: 'monitor' }, ['schleife'], { posts: { gambler: 'inside' } }, 'guard') === 'warn' && st({ guard: 'monitor', blind: 'liefer' }, [], null, 'guard') === 'alt' && st({ guard: 'monitor', blind: 'dach' }, [], null, 'guard') === 'open' && st({ guard: 'monitor', blind: 'dach' }, ['seil'], null, 'guard') === 'alt' && st({ guard: 'monitor', blind: 'dach' }, ['seil'], { entrance: 'dach' }, 'guard') === 'alt' && st({ guard: 'monitor', blind: 'dach' }, ['seil'], { entrance: 'liefer' }, 'guard') === 'open');
  check('overview safe: drill, decoder, by hand, time lock, no target', st({}, ['bohrer'], null, 'safe') === 'ok' && st({ safe: 'zeit' }, [], null, 'safe') === 'open' && by({ safe: 'zeit' }, [], null, 'safe') === 'ov.by.need' && st({ safe: 'zeit' }, ['decoder'], null, 'safe') === 'open' && st({ safe: 'elek' }, ['decoder'], null, 'safe') === 'ok' && st({ safe: 'elek' }, ['decoder'], { posts: { brain: 'lookout' } }, 'safe') === 'warn' && st({ safe: 'mech' }, [], null, 'safe') === 'ok' && st({ safe: 'mech' }, [], { posts: { brain: 'lookout' } }, 'safe') === 'open' && st({ safe: 'zeit' }, [], { targets: ['vitrinen'] }, 'safe') === 'off' && st({ safe: 'zeit' }, ['bohrer'], { posts: { hands: 'driver' } }, 'safe') === 'warn');
  check('overview open rows name the missing tool', (() => { const n = (kn, tl, pl, id) => { const b = row(ov(kn, tl, pl), id).by; return b?.k === 'ov.by.need' ? b.p.t.k : null; }; return n({ alarm: 'tuer' }, [], null, 'alarm') === 'tool.magnet.name' && n({ alarm: 'bewegung' }, [], null, 'alarm') === 'tool.schaum.name' && n({ alarm: 'still' }, [], null, 'alarm') === 'tool.stoer.name' && n({ guard: 'monitor' }, [], null, 'guard') === 'tool.schleife.name' && n({ guard: 'hund' }, [], { entrance: 'liefer' }, 'guard') === 'tool.leckerli.name' && n({ safe: 'zeit' }, [], null, 'safe') === 'tool.bohrer.name' && by({ safe: 'elek' }, [], null, 'safe') === 'ov.by.needSafeTool' && by({ safe: 'mech' }, [], { posts: { brain: 'lookout' } }, 'safe') === 'ov.by.noBrainHand'; })());
  check('overview police: known -> ok, scanner noted', st({ police: 'kurz' }, [], null, 'police') === 'ok' && by({ police: 'kurz' }, ['scanner'], null, 'police') === 'ov.by.scanner' && st({}, ['scanner'], null, 'police') === 'unknown');
  {
    // partial: the vault is a target but its time is missing from the estimate
    const tr = { targets: ['tresor'] };
    const pt = (kn, tl, pl) => ov(kn, tl, pl).time;
    check('overview time.partial: true when the vault cannot be opened or is unknown', pt({ guard: 'rundgang', safe: 'zeit' }, [], tr).partial && pt({ guard: 'rundgang' }, [], tr).partial && pt({ guard: 'rundgang', safe: 'elek' }, ['decoder'], { ...tr, posts: { brain: 'lookout' } }).partial && pt({ guard: 'rundgang', safe: 'zeit' }, [], tr).state === 'unknown' && pt({ guard: 'rundgang', safe: 'zeit' }, [], null).partial);
    check('overview time.partial: false with the drill, a working quiet way, or no vault target', !pt({ guard: 'rundgang', safe: 'zeit' }, ['bohrer'], tr).partial && !pt({ guard: 'rundgang' }, ['bohrer'], tr).partial && !pt({ guard: 'rundgang', safe: 'mech' }, [], tr).partial && !pt({ guard: 'rundgang', safe: 'elek' }, ['decoder'], tr).partial && !pt({ guard: 'rundgang', safe: 'zeit' }, [], { targets: ['vitrinen'] }).partial && pt({ guard: 'rundgang', safe: 'zeit' }, ['bohrer'], tr).state !== 'unknown');
    check('overview text keys: partial, need, new shop lead', ['ov.time.partialT', 'ov.time.partial', 'ov.by.need', 'sh.lead'].every(hasText) && !hasText('ov.by.needDrill'));
  }
  {
    // time: judged with the given tools, against the window of the known guard
    const S = mk({ guard: 'rundgang', safe: 'zeit' }, { targets: ['tresor'] });
    const w = E.windowFor(S, 'rundgang');
    const a = E.overview(S, [], true).time, b = E.overview(S, ['bohrer'], true).time;
    check('overview time: estimated with the given tools, window from the known guard', a.window === w && b.hi === a.hi + 8 && E.estimateTime({ ...S, tools: ['bohrer'] })[1] === b.hi, `${JSON.stringify(a)} ${JSON.stringify(b)}`);
    const S2 = mk({ guard: 'rundgang' }, { targets: ['tresor', 'vitrinen', 'lager'] });
    S2.stake = 'allin';
    S2.attention = 4;
    const c = E.overview(S2, ['bohrer'], true).time;
    check('overview time: a plan longer than the window -> open', c.window !== null && c.hi > c.window && c.state === 'open', JSON.stringify(c));
  }
  // pub(): the overview is only there while the crew prepares, and follows the shared basket
  {
    const m = new E.PlanMachine({ seed: 3, seats: [{ role: 'brain', pid: 'p1', name: 'A' }], times: { ...FAST, bot: 1e9 } }, 0);
    let now = 0;
    const steps = [];
    for (let i = 0; i < 400 && m.phase !== 'shop'; i++) {
      now += 100;
      if (m.phase === 'scout') { for (const id of ['parkhaus', 'hausmeister', 'lagerist']) m.act('brain', { t: 'scout', id }, now); }
      if (m.phase === 'offer') { const o = m.priv('brain').offer; if (o) m.act('brain', { t: 'offer', answer: 'decline' }, now); }
      if (['stake', 'brief', 'scout', 'facts'].includes(m.phase)) m.act('brain', { t: 'confirm' }, now);
      m.tick(now);
      steps.push(m.phase + ':' + !!m.pub().overview);
    }
    const p0 = m.pub();
    m.act('brain', { t: 'tool', id: 'bohrer' }, now);
    const p1 = m.pub();
    check('pub(): overview present in every preparation phase reached', m.phase === 'shop' && steps.every((s) => s.endsWith(':true')), steps.filter((s, i) => steps.indexOf(s) === i).join(' '));
    check('pub(): the overview follows the shared basket at once (cache invalidated)', p1 !== p0 && row(p1.overview, 'safe').state === 'ok' && row(p1.overview, 'safe').by.p.t.k === 'tool.bohrer.name', JSON.stringify(row(p1.overview, 'safe')));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
