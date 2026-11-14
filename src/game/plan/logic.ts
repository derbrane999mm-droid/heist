// The planning round ("Planungsrunde"): one job against the Auktionshaus Varga.
// Port of the approved prototype (out/plan-test/src/engine.js). Plain data and
// functions, no DOM, no imports: the host, the views and the Node tests
// (tests/plan-logic.mjs) all use this file directly.
//
// Two layers:
//  1. Rules (newGame, doScout, buy, runJob, settle, accuse ...): the prototype's
//     engine, same random-number order, so its balance numbers still hold.
//  2. PlanMachine: the host-side step machine around the rules for 1-4 humans.
//     It owns everything (hidden facts, everyone's secret offers). `pub()` is
//     the only thing replicated to all; `priv(role)` is sent to one player.
//
// No finished sentences leave this file: every text is a key plus parameters
// (`Txt`), rendered by each client in its own language (see texts.ts).

// ---------------------------------------------------------------------------
// Texts as keys
// ---------------------------------------------------------------------------

/** A parameter: plain value, nested text, a crew member by role ({ r }), or money ({ e }). */
export type Param = string | number | Txt | { r: Role } | { e: number };
export interface Txt {
  k: string;
  p?: Record<string, Param>;
}
const T = (k: string, p?: Record<string, Param>): Txt => (p ? { k, p } : { k });
const N = (r: Role) => ({ r });
const EUR = (n: number) => ({ e: Math.round(n) });

// ---------------------------------------------------------------------------
// Random numbers
// ---------------------------------------------------------------------------

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Same ids as the lineup. brain = Wortführer, gambler = Zocker, hands = Hände, bait = Vorhut. */
export type Role = 'brain' | 'gambler' | 'hands' | 'bait';
export const ROLE_ORDER: Role[] = ['brain', 'gambler', 'hands', 'bait'];
export type Post = 'inside' | 'lookout' | 'driver';
export const POSTS: Post[] = ['inside', 'lookout', 'driver'];
export type Status = 'ok' | 'caught' | 'hurt';

export type StakeId = 'sicher' | 'gierig' | 'allin';
export const STAKES: Record<StakeId, { extra: number; mult: number; police: number }> = {
  sicher: { extra: 0, mult: 1.0, police: 0 },
  gierig: { extra: 1, mult: 1.9, police: 0 },
  allin: { extra: 2, mult: 2.5, police: -2 },
};
export const STAKE_ORDER: StakeId[] = ['sicher', 'gierig', 'allin'];

export type OfferId = 'tempo' | 'provision' | 'tipp' | 'suendenbock' | 'tasche' | 'laerm' | 'nerven';
export interface OfferDef {
  id: OfferId;
  need: null | 'one' | 'two';
  when: ('pre' | 'mid')[];
  bot: number;
}
export const OFFERS: OfferDef[] = [
  { id: 'tempo', need: 'two', when: ['pre', 'mid'], bot: 0.5 },
  { id: 'provision', need: null, when: ['pre'], bot: 0.55 },
  { id: 'tipp', need: null, when: ['pre'], bot: 0.4 },
  { id: 'suendenbock', need: 'one', when: ['pre', 'mid'], bot: 0.45 },
  { id: 'tasche', need: null, when: ['mid'], bot: 0.5 },
  { id: 'laerm', need: null, when: ['pre', 'mid'], bot: 0.45 },
  { id: 'nerven', need: 'one', when: ['pre', 'mid'], bot: 0.4 },
];
export const offerDef = (id: string) => OFFERS.find((o) => o.id === id)!;

export type FactKey = 'alarm' | 'guard' | 'safe' | 'loot' | 'blind' | 'police';
export type TargetId = 'tresor' | 'vitrinen' | 'lager';
export type EntranceId = 'vorder' | 'liefer' | 'dach';

export interface Job {
  id: string;
  budget: number;
  facts: Record<FactKey, string[]>;
  factOrder: FactKey[];
  rules: ((f: Record<FactKey, string>) => boolean)[];
  policeMin: Record<string, number>;
  window: Record<string, number>;
  bestMult: number;
  targets: Record<TargetId, { base: number; time: number; noise: number; bulky?: boolean; tags: string[] }>;
  entrances: Record<EntranceId, { door: boolean; exit: number; yard?: boolean; panel?: boolean; needs?: string; tags: string[] }>;
  scouts: { id: string; reveals: FactKey[]; money: number; attention: number; rumour?: boolean; nervous?: number }[];
  rumourWrong: number;
  scoutCount: number;
  tools: { id: string; price: number; h?: boolean; tags: string[] }[];
}

export const VARGA: Job = {
  id: 'varga',
  budget: 3000,
  facts: {
    alarm: ['bewegung', 'tuer', 'still'],
    guard: ['rundgang', 'monitor', 'hund'],
    safe: ['mech', 'elek', 'zeit'],
    loot: ['tresor', 'vitrinen', 'lager'],
    blind: ['liefer', 'dach', 'keiner'],
    police: ['kurz', 'mittel', 'lang'],
  },
  factOrder: ['alarm', 'guard', 'safe', 'loot', 'blind', 'police'],
  rules: [(f) => !(f.safe === 'mech' && f.alarm === 'still'), (f) => !(f.guard === 'hund' && f.blind === 'liefer'), (f) => !(f.safe === 'zeit' && f.police === 'lang')],
  policeMin: { kurz: 6, mittel: 10, lang: 15 },
  window: { rundgang: 11, monitor: 14, hund: 13 },
  bestMult: 1.5,
  targets: {
    tresor: { base: 7500, time: 0, noise: 0, tags: ['long'] },
    vitrinen: { base: 3400, time: 2, noise: 2, tags: ['short', 'loud'] },
    lager: { base: 5500, time: 4, noise: 1, bulky: true, tags: ['mid'] },
  },
  entrances: {
    vorder: { door: true, exit: 1, tags: ['lock', 'camera'] },
    liefer: { door: true, exit: 1, yard: true, panel: true, tags: ['lock', 'yard'] },
    dach: { door: false, exit: 3, needs: 'seil', tags: ['rope', 'slowOut'] },
  },
  scouts: [
    { id: 'besichtigung', reveals: ['loot', 'safe'], money: 0, attention: 2 },
    { id: 'parkhaus', reveals: ['guard', 'blind'], money: 150, attention: 0 },
    { id: 'elektriker', reveals: ['alarm', 'safe'], money: 60, attention: 0, rumour: true },
    { id: 'fehlalarm', reveals: ['alarm', 'police'], money: 0, attention: 2, nervous: 3 },
    { id: 'lagerist', reveals: ['loot', 'guard'], money: 60, attention: 0, rumour: true },
    { id: 'hausmeister', reveals: ['alarm', 'blind'], money: 500, attention: 0 },
  ],
  rumourWrong: 25,
  scoutCount: 3,
  tools: [
    { id: 'magnet', price: 400, h: true, tags: ['hands'] },
    { id: 'stoer', price: 600, tags: [] },
    { id: 'schaum', price: 400, h: true, tags: ['hands'] },
    { id: 'decoder', price: 700, tags: ['quiet'] },
    { id: 'bohrer', price: 550, h: true, tags: ['loud', 'hands'] },
    { id: 'seil', price: 200, tags: [] },
    { id: 'leckerli', price: 150, tags: [] },
    { id: 'zweitwagen', price: 800, tags: [] },
    { id: 'scanner', price: 400, tags: [] },
    { id: 'schleife', price: 500, tags: ['post'] },
  ],
};
export const JOBS: Record<string, Job> = { varga: VARGA };
const SPOT_CATCH = 50,
  UNREST_P = 0.35,
  PATROL_BASE = 13,
  PATROL_P = 5,
  BAIL = 1500;
export const ACCUSE_BONUS = 400,
  ACCUSE_FINE = 400,
  NONCASH_FINE = 500;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface Offer {
  id: OfferId;
  role: Role;
  when: 'pre' | 'mid';
  human: boolean;
  state: 'open' | 'accepted' | 'declined';
  target?: Role | null;
  partner?: Role | null;
  hits?: { min: number; rolls: number; noise: number; notes: Txt[] };
  traces?: number;
  applied?: boolean;
  used?: boolean;
  bonus?: number;
  reclaimed?: boolean;
  reveal?: FactKey;
}
export interface Known {
  v: string;
  rumour: boolean;
  wrong: boolean;
  src: string;
}
export interface PlanSel {
  entrance: EntranceId;
  posts: Record<Role, Post>;
  targets: TargetId[];
  panel: boolean;
}
export type Line = { kind: string; x?: Txt; roll?: { r: number; p: number; ok: boolean; label: Txt } };
export interface Beat {
  title: Txt;
  target?: TargetId;
  lines: Line[];
  t0: number;
}
export interface Opt {
  id: string;
  label: Txt;
  text: Txt;
  pct: number;
  pctLabel: Txt;
  tags: Txt[];
  details: Txt | null;
  risk?: { pG: number; pP: number; total: number };
  dt?: number;
  nz?: number;
}
export interface Decision {
  kind: 'decide';
  title: Txt;
  who: Role;
  text: Txt;
  details?: Txt;
  options: Opt[];
  push?: boolean;
  t?: number;
}
export interface OffersStep {
  kind: 'offers';
  when: 'mid';
  roles: Role[];
}
/**
 * A skill check (first-person job): instead of rolling the dice, the machine may ask the human in seat
 * `role` to do the thing himself (src/game/mech/skill.ts). The generator receives a SkillResult, or
 * null/undefined: then it rolls exactly the roll it would have rolled without first-person play.
 */
export interface SkillStep {
  kind: 'skill';
  role: Role;
  game: string;
  variant: string;
  difficulty: 1 | 2 | 3;
  seed: number;
  tools: string[];
  /** where it happens, for the job director: 'door' (the chosen entrance) or 'safe' */
  at: string;
  /** the dice it replaces (chance after modifiers, label) */
  p: number;
  label: Txt;
}
export interface SkillAnswer {
  ok: boolean;
  seconds: number;
  noise: number;
  fumbles: number;
  gaveUp?: boolean;
}
export type Step = Decision | OffersStep | SkillStep;

/** Skill-check difficulty from the chance the dice roll would have had: >= 75 % easy, 50..74 medium, below hard. */
export const skillDifficulty = (p: number): 1 | 2 | 3 => (p >= 75 ? 1 : p >= 50 ? 2 : 3);

/**
 * How a played skill check feeds the job (kept gentle on purpose, it is on top of the step's own outcome):
 *  - ok decides the branch exactly like the dice result would (success / the step's usual failure branch).
 *  - noise (0..10 reported) adds floor(noise / 4) to the job's noise, at most +2.
 *  - fumbles: 3 or more slips add +1 noise (the total extra noise stays capped at +2).
 *  - seconds: every full 30 s beyond the first 60 s cost one job minute, at most +2 minutes.
 * Invalid numbers count as 0. Returns null for "no result" (gave up, timeout, garbage): dice fallback.
 */
export function skillEffect(a: any): null | { ok: boolean; noise: number; min: number; seconds: number } {
  if (!a || typeof a !== 'object' || a.gaveUp || typeof a.ok !== 'boolean') return null;
  const num = (v: any) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  const seconds = Math.min(3600, num(a.seconds));
  const noise = Math.min(2, Math.floor(Math.min(10, num(a.noise)) / 4) + (num(a.fumbles) >= 3 ? 1 : 0));
  const min = Math.min(2, Math.floor(Math.max(0, seconds - 60) / 30));
  return { ok: a.ok, noise, min, seconds: Math.round(seconds) };
}

export interface Game {
  job: Job;
  factSeed: number;
  runSeed: number;
  rng: () => number;
  orng: () => number;
  facts: Record<FactKey, string>;
  names: Record<Role, string>;
  humans: Role[];
  attention0: number;
  attention: number;
  budget: number;
  spent: number;
  stake: StakeId;
  scouted: string[];
  known: Partial<Record<FactKey, Known>>;
  /** Secret tips (offer "tipp"), per role, when tips are private. */
  tips: Partial<Record<Role, { k: FactKey; v: string }>>;
  privateTips: boolean;
  tools: string[];
  nervous: number;
  plan: PlanSel;
  offers: Offer[];
  botAcceptAll: boolean;
  noOffers: boolean;
  /** First-person job: rolls a human can play as a skill check are yielded as SkillStep (default off). */
  skills: boolean;
  preTraces?: Txt[];
  run?: any;
  result?: any;
}

export function genFacts(job: Job, seed: number): Record<FactKey, string> {
  const rnd = mulberry32(seed);
  for (let i = 0; i < 1000; i++) {
    const f = {} as Record<FactKey, string>;
    for (const k of job.factOrder) {
      const vals = job.facts[k];
      f[k] = vals[Math.floor(rnd() * vals.length)];
    }
    if (job.rules.every((r) => r(f))) return f;
  }
  throw new Error('no valid facts');
}

export interface NewGameOpts {
  jobId?: string;
  factSeed?: number;
  runSeed?: number;
  /** Seats played by humans: they get exactly one offer before and one during the job. Default ['brain'] (prototype). */
  humans?: Role[];
  names?: Partial<Record<Role, string>>;
  attention?: number;
  budget?: number;
  botAcceptAll?: boolean;
  noOffers?: boolean;
  /** A secret tip is told only to its owner instead of being added to the crew's facts. */
  privateTips?: boolean;
  /** Yield skill checks for human seats (first-person job). Off: the dice decide, as in the prototype. */
  skills?: boolean;
}

export function defaultPosts(): Record<Role, Post> {
  return { brain: 'inside', gambler: 'lookout', hands: 'driver', bait: 'inside' };
}

export function newGame(opts: NewGameOpts = {}): Game {
  const job = JOBS[opts.jobId || 'varga'];
  const factSeed = (opts.factSeed ?? 0) >>> 0;
  const runSeed = (opts.runSeed === undefined ? factSeed * 7 + 13 : opts.runSeed) >>> 0;
  const att = opts.attention || 0;
  const names = { brain: 'brain', gambler: 'gambler', hands: 'hands', bait: 'bait', ...(opts.names || {}) } as Record<Role, string>;
  const S: Game = {
    job,
    factSeed,
    runSeed,
    rng: mulberry32(runSeed ^ 0x9e3779b9),
    orng: mulberry32(runSeed ^ 0x51ed2701),
    facts: genFacts(job, factSeed),
    names,
    humans: opts.humans ? opts.humans.slice() : ['brain'],
    attention0: att,
    attention: att,
    budget: opts.budget || job.budget,
    spent: 0,
    stake: 'sicher',
    scouted: [],
    known: {},
    tips: {},
    privateTips: !!opts.privateTips,
    tools: [],
    nervous: 0,
    plan: { entrance: 'liefer', posts: defaultPosts(), targets: ['tresor', 'vitrinen'], panel: false },
    offers: [],
    botAcceptAll: !!opts.botAcceptAll,
    noOffers: !!opts.noOffers,
    skills: !!opts.skills,
  };
  dealOffers(S);
  return S;
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

function dealOffers(S: Game) {
  if (S.noOffers) return;
  const r = S.orng,
    pick = <X>(a: X[]) => a[Math.floor(r() * a.length)];
  const pre = OFFERS.filter((o) => o.when.indexOf('pre') >= 0),
    mid = OFFERS.filter((o) => o.when.indexOf('mid') >= 0);
  // Humans in seat order, then bots in seat order. With one human in the first
  // seat this is exactly the prototype's order of random draws.
  for (const role of ROLE_ORDER) {
    if (S.humans.indexOf(role) < 0) continue;
    const a = pick(pre),
      b = pick(mid.filter((o) => o.id !== a.id));
    S.offers.push({ id: a.id, role, when: 'pre', human: true, state: 'open' });
    S.offers.push({ id: b.id, role, when: 'mid', human: true, state: 'open' });
  }
  for (const role of ROLE_ORDER) {
    if (S.humans.indexOf(role) >= 0) continue;
    const n = r() < 0.5 ? 1 : 2,
      used: string[] = [];
    for (let i = 0; i < n; i++) {
      const o = pick(OFFERS.filter((x) => used.indexOf(x.id) < 0));
      used.push(o.id);
      const when = pick(o.when);
      S.offers.push({ id: o.id, role, when, human: false, state: 'open' });
    }
  }
}

export function humanOffer(S: Game, when: 'pre' | 'mid', role?: Role): Offer | null {
  return S.offers.find((o) => o.human && o.when === when && (!role || o.role === role)) || null;
}
export function offerTargets(S: Game, role: Role): Role[] {
  return ROLE_ORDER.filter((r) => r !== role);
}

/** answer: 'decline' | 'accept' | 'accept:target' | 'accept:target:partner' */
export function answerOffer(S: Game, o: Offer, answer: string) {
  if (o.state !== 'open') return;
  const parts = String(answer).split(':');
  if (parts[0] !== 'accept') {
    o.state = 'declined';
    return;
  }
  const d = offerDef(o.id),
    others = ROLE_ORDER.filter((r) => r !== o.role);
  o.target = d.need ? (others.indexOf(parts[1] as Role) >= 0 ? (parts[1] as Role) : others[0]) : null;
  o.partner = d.need === 'two' ? (others.indexOf(parts[2] as Role) >= 0 && parts[2] !== o.target ? (parts[2] as Role) : others.find((x) => x !== o.target)!) : null;
  o.state = 'accepted';
  applyOfferStart(S, o);
}

export function botDecide(S: Game, when: 'pre' | 'mid') {
  for (const o of S.offers) {
    if (o.human || o.when !== when || o.state !== 'open') continue;
    const d = offerDef(o.id),
      others = ROLE_ORDER.filter((r) => r !== o.role);
    if (S.botAcceptAll || S.orng() < d.bot) {
      const t = others[Math.floor(S.orng() * others.length)];
      const p = others.filter((x) => x !== t)[Math.floor(S.orng() * 2)];
      answerOffer(S, o, 'accept:' + t + ':' + p);
    } else o.state = 'declined';
  }
}

const newHits = () => ({ min: 0, rolls: 0, noise: 0, notes: [] as Txt[] });

function applyOfferStart(S: Game, o: Offer) {
  o.hits = o.hits || newHits();
  if (o.id === 'provision' || o.id === 'suendenbock') {
    S.attention = clamp(S.attention + 1, 0, 5);
    o.hits.notes.push(T('fx.att'));
    trace(S, o, T(o.id === 'provision' ? 'tr.provision' : 'tr.contact'));
  }
  if (o.id === 'tipp') {
    S.budget -= 400;
    S.spent += 400;
    o.hits.notes.push(T('fx.cash400'));
    trace(S, o, T('tr.cash400'));
    if (o.human) {
      const k = S.job.factOrder.find((x) => !S.known[x] || S.known[x]!.rumour);
      if (k) {
        o.reveal = k;
        if (S.privateTips) S.tips[o.role] = { k, v: S.facts[k] };
        else S.known[k] = { v: S.facts[k], rumour: false, wrong: false, src: 'tip' };
      }
    }
  }
  if (S.run) applyOfferRun(S, o);
}

/** A trace: a neutral line without the culprit. Before the job into preTraces, during the job into the next line. */
function trace(S: Game, o: Offer, text: Txt) {
  o.traces = (o.traces || 0) + 1;
  if (S.run && !S.run.done) S.run.pendingTraces.push(text);
  else (S.preTraces = S.preTraces || []).push(text);
}

function applyOfferRun(S: Game, o: Offer) {
  const R = S.run;
  if (!R || o.applied) return;
  o.applied = true;
  if (o.id === 'tempo') {
    R.mods.push({ o, kind: 'time', role: o.target, d: 2 }, { o, kind: 'catch', role: o.target, d: 15 });
    for (const r of [o.role, o.partner]) R.mods.push({ o, kind: 'time', role: r, d: -1 }, { o, kind: 'catch', role: r, d: -15 });
  }
  if (o.id === 'nerven') R.mods.push({ o, kind: 'roll', role: o.target, d: -20 });
  if (o.id === 'suendenbock') R.scapegoat[o.role] = o;
  if (o.id === 'laerm') R.pendingNoise.push({ o, n: 3 });
  if (o.id === 'tasche') {
    R.noise += 2;
    o.hits!.noise += 2;
    trace(S, o, T('tr.bag'));
  }
}

// ---------------------------------------------------------------------------
// Before the job
// ---------------------------------------------------------------------------

export function setStake(S: Game, id: string) {
  if (!(id in STAKES)) throw new Error('stake');
  S.stake = id as StakeId;
}
export function scoutCost(S: Game, ids: string[]) {
  let money = 0,
    attention = 0;
  ids.forEach((id) => {
    const a = S.job.scouts.find((x) => x.id === id)!;
    money += a.money;
    attention += a.attention;
  });
  return { money, attention };
}
export function doScout(S: Game, ids: string[]) {
  if (ids.length !== S.job.scoutCount) throw new Error('exactly ' + S.job.scoutCount);
  S.scouted = ids.slice();
  for (const id of ids) {
    const a = S.job.scouts.find((x) => x.id === id)!;
    S.budget -= a.money;
    S.spent += a.money;
    S.attention += a.attention;
    S.nervous += a.nervous || 0;
    for (const k of a.reveals) {
      const truth = S.facts[k];
      let v = truth,
        wrong = false;
      if (a.rumour) {
        const r = Math.floor(S.rng() * 100) + 1;
        if (r <= S.job.rumourWrong) {
          const others = S.job.facts[k].filter((x) => x !== truth);
          v = others[Math.floor(S.rng() * others.length)];
          wrong = true;
        }
      }
      const prev = S.known[k];
      if (!prev || (prev.rumour && !a.rumour)) S.known[k] = { v, rumour: !!a.rumour, wrong, src: a.id };
    }
  }
  S.attention = clamp(S.attention, 0, 5);
}
export const toolById = (S: Game, id: string) => S.job.tools.find((t) => t.id === id)!;
export const toolsCost = (S: Game, ids: string[]) => ids.reduce((s, id) => s + toolById(S, id).price, 0);
export function canAfford(S: Game, ids: string[]) {
  return toolsCost(S, ids) <= S.budget;
}
export function buy(S: Game, ids: string[]) {
  const cost = toolsCost(S, ids);
  if (cost > S.budget) throw new Error('too expensive');
  S.tools = ids.slice();
  S.budget -= cost;
  S.spent += cost;
}
const has = (S: Game, id: string) => S.tools.indexOf(id) >= 0;

export function extraGuards(S: Game) {
  return STAKES[S.stake].extra + (S.attention >= 3 ? 1 : 0);
}
export function windowFor(S: Game, guard: string) {
  return Math.max(4, S.job.window[guard] - 4 * extraGuards(S) - S.nervous);
}
export function possibleValues(S: Game, k: FactKey): string[] {
  const job = S.job,
    vals = job.facts[k];
  if (S.known[k]) return [S.known[k]!.v];
  return vals.filter((v) => {
    const base: Partial<Record<FactKey, string>> = {};
    for (const kk of job.factOrder) if (S.known[kk]) base[kk] = S.known[kk]!.v;
    base[k] = v;
    const free = job.factOrder.filter((kk) => base[kk] === undefined);
    const rec = (i: number): boolean => {
      if (i === free.length) return job.rules.every((r) => r(base as Record<FactKey, string>));
      for (const vv of job.facts[free[i]]) {
        base[free[i]] = vv;
        if (rec(i + 1)) {
          delete base[free[i]];
          return true;
        }
      }
      delete base[free[i]];
      return false;
    };
    return rec(0);
  });
}
export function policeTimes(S: Game) {
  return possibleValues(S, 'police').map((v) => Math.max(3, S.job.policeMin[v] + STAKES[S.stake].police));
}
const inside = (S: Game, role: Role) => S.plan.posts[role] === 'inside';
const driver = (S: Game): Role | null => ROLE_ORDER.find((r) => S.plan.posts[r] === 'driver') || null;
const lookouts = (S: Game) => ROLE_ORDER.filter((r) => S.plan.posts[r] === 'lookout');

export function validatePlan(S: Game): Txt[] {
  const P = S.plan,
    errs: Txt[] = [];
  if (!ROLE_ORDER.some((r) => P.posts[r] === 'inside')) errs.push(T('er.inside'));
  if (ROLE_ORDER.filter((r) => P.posts[r] === 'driver').length > 1) errs.push(T('er.driver'));
  if (!P.targets.length) errs.push(T('er.targets'));
  if (P.entrance === 'dach' && !has(S, 'seil')) errs.push(T('er.roof'));
  if (P.panel && !(P.entrance === 'liefer' && inside(S, 'brain'))) errs.push(T('er.panel'));
  return errs;
}

/** The plan in plain words. Most important first; the view shows three of each. */
export function planSummary(S: Game) {
  const P = S.plan,
    J = S.job,
    K = S.known,
    lines: Txt[] = [],
    risks: Txt[] = [];
  const names = (rs: Role[]): Txt => T('list.' + rs.length, Object.fromEntries(rs.map((r, i) => ['a' + i, N(r)])));
  const ins = ROLE_ORDER.filter((r) => P.posts[r] === 'inside');
  const drv = driver(S),
    lo = lookouts(S);
  lines.push(T('sm.in', { e: T('en.' + P.entrance + '.name'), who: names(ins) }));
  lines.push(T('sm.targets.' + P.targets.length, Object.fromEntries(P.targets.map((t, i) => ['a' + i, T('tg.' + t + '.name')]))));
  const est = estimateTime(S),
    gd = K.guard ? K.guard.v : null;
  const w = gd ? windowFor(S, gd) : null;
  const span = est[0] === est[1] ? String(est[0]) : est[0] + '–' + est[1];
  lines.push(T(w !== null ? 'sm.time' : 'sm.timeNoWin', { t: span, w: w ?? 0 }));
  lines.push(drv ? T(drv === 'hands' ? 'sm.drives' : 'sm.drivesSlow', { who: N(drv) }) : T('sm.noDriver'));
  lines.push(lo.length ? T('sm.lookout', { who: names(lo) }) : T('sm.noLookout'));
  if (P.panel) lines.push(T('sm.panel'));
  lines.push(T('sm.guards', { n: 1 + extraGuards(S) }));
  const kv = (k: FactKey) => (K[k] ? K[k]!.v : null);
  const tag = (k: FactKey) => (K[k] && K[k]!.rumour ? T('sm.rumour') : '');
  const al = kv('alarm');
  if (!al && !P.panel) risks.push(T('rk.alarmUnknown'));
  else if (al && !P.panel) {
    if (al === 'tuer' && J.entrances[P.entrance].door && !has(S, 'magnet')) risks.push(T('rk.door', { r: tag('alarm') }));
    if (al === 'bewegung' && !has(S, 'schaum')) risks.push(T('rk.motion', { r: tag('alarm') }));
    if (al === 'still' && !has(S, 'stoer')) risks.push(T('rk.silent', { r: tag('alarm') }));
  }
  if (P.targets.indexOf('tresor') >= 0) {
    const sf = kv('safe'),
      kopfIn = inside(S, 'brain');
    if (!sf && !has(S, 'bohrer')) risks.push(T('rk.safeUnknown'));
    else if (sf === 'zeit' && !has(S, 'bohrer')) risks.push(T('rk.safeTime', { r: tag('safe') }));
    else if (sf === 'elek' && !(has(S, 'decoder') && kopfIn) && !has(S, 'bohrer')) risks.push(T('rk.safeElek', { r: tag('safe') }));
    else if (sf === 'mech' && !kopfIn && !has(S, 'bohrer')) risks.push(T('rk.safeMech'));
  }
  if (gd === 'hund' && P.entrance === 'liefer' && !has(S, 'leckerli')) risks.push(T('rk.dog', { r: tag('guard') }));
  if (gd === 'monitor' && !(has(S, 'schleife') && lo.length) && kv('blind') !== P.entrance) risks.push(T('rk.monitor', { r: tag('guard') }));
  if (w !== null && est[1] > w) risks.push(T('rk.window'));
  if (!gd) risks.push(T('rk.guardUnknown'));
  if (!kv('police')) risks.push(T('rk.policeUnknown'));
  if ((has(S, 'magnet') || has(S, 'schaum') || has(S, 'bohrer')) && !inside(S, 'hands')) risks.push(T('rk.noHands'));
  if (has(S, 'schleife') && !lo.length) risks.push(T('rk.loopNoPost'));
  if (P.targets.indexOf('lager') >= 0 && (ins.length < 2 || !drv || P.entrance === 'dach')) risks.push(T('rk.lager'));
  return { lines, risks, errors: validatePlan(S) };
}

// ---------------------------------------------------------------- overview
// The one-glance view of the preparation ("Überblick"): for each obstacle what the crew knows
// and whether it is dealt with, plus one time bar. Read from S.known only, never from S.facts.
export type RowState = 'ok' | 'alt' | 'warn' | 'open' | 'unknown' | 'off';
export interface OverviewRow {
  id: 'alarm' | 'guard' | 'safe' | 'police';
  state: RowState;
  /** what the crew knows, null if unknown */
  what: Txt | null;
  rumour: boolean;
  /** how it is dealt with, or what is missing */
  by: Txt | null;
}
export interface Overview {
  rows: OverviewRow[];
  time: { lo: number; hi: number; window: number | null; state: 'ok' | 'warn' | 'open' | 'unknown'; /** the vault is a target but the estimate leaves its time out */ partial: boolean };
}
const ALARM_TOOL: Record<string, string> = { tuer: 'magnet', bewegung: 'schaum', still: 'stoer' };
/**
 * `tools`: the tools to judge with (the shared basket while shopping, else the bought ones).
 * `planFixed`: entrance, posts, targets and the panel are being decided (phase 'plan'); before that
 * only the tools count, and a way around an obstacle is "possible", not chosen.
 */
export function overview(S: Game, tools: string[], planFixed: boolean): Overview {
  const V: Game = { ...S, tools };
  const P = S.plan,
    J = S.job,
    K = S.known;
  const hasT = (id: string) => tools.indexOf(id) >= 0;
  const tn = (id: string) => T('tool.' + id + '.name');
  const byTool = (id: string) => T('ov.by.tool', { t: tn(id) });
  const need = (id: string) => T('ov.by.need', { t: tn(id) });
  const isIn = (r: Role) => P.posts[r] === 'inside';
  const kv = (k: FactKey) => (K[k] ? K[k]!.v : null);
  const row = (id: OverviewRow['id'], st: [RowState, Txt | null]): OverviewRow => {
    const kn = K[id];
    return { id, state: st[0], what: kn ? T((id === 'police' ? 'ov.police.' : 'fact.' + id + '.') + kn.v) : null, rumour: !!kn?.rumour, by: st[1] };
  };

  // alarm
  let a: [RowState, Txt | null];
  const al = kv('alarm');
  if (planFixed && P.panel) a = ['alt', T('ov.by.panel')];
  else if (!al) a = ['unknown', null];
  else {
    const tool = ALARM_TOOL[al];
    // door contacts only sit on doors: the roof hatch has none
    if (planFixed && al === 'tuer' && !J.entrances[P.entrance].door) a = ['alt', T('ov.by.roof')];
    else if (hasT(tool)) a = planFixed && tool !== 'stoer' && !isIn('hands') ? ['warn', T('ov.by.noHands', { t: tn(tool) })] : ['ok', byTool(tool)];
    else if (!planFixed && al === 'tuer' && hasT('seil')) a = ['alt', T('ov.by.roofOpt')];
    else a = ['open', need(tool)];
  }

  // guard
  let g: [RowState, Txt | null];
  const gd = kv('guard'),
    bl = kv('blind');
  if (!gd) g = ['unknown', null];
  else if (gd === 'rundgang') g = ['ok', T('ov.by.none')];
  else if (gd === 'hund') {
    // the dog only runs in the yard
    if (hasT('leckerli')) g = ['ok', byTool('leckerli')];
    else if (planFixed) g = J.entrances[P.entrance].yard ? ['open', need('leckerli')] : ['alt', T('ov.by.notYard')];
    else g = ['alt', T('ov.by.notYardOpt')];
  } else {
    // monitor room: the loop needs someone on lookout; the blind spot needs no tool
    const lookout = ROLE_ORDER.some((r) => P.posts[r] === 'lookout');
    if (planFixed && bl === P.entrance && !(hasT('schleife') && lookout)) g = ['alt', T('ov.by.blind')];
    else if (hasT('schleife')) g = planFixed && !lookout ? ['warn', T('ov.by.noPost')] : ['ok', byTool('schleife')];
    else if (!planFixed && (bl === 'liefer' || (bl === 'dach' && hasT('seil')))) g = ['alt', T('ov.by.blindOpt')];
    else g = ['open', need('schleife')];
  }

  // safe
  let s: [RowState, Txt | null];
  const sf = kv('safe'),
    brainIn = isIn('brain');
  if (planFixed && P.targets.indexOf('tresor') < 0) s = ['off', T('ov.by.noTarget')];
  else if (hasT('bohrer')) {
    // without the Hände the drill is unreliable, unless the quiet way works anyway
    const quiet = (sf === 'mech' && brainIn) || (sf === 'elek' && brainIn && hasT('decoder'));
    s = planFixed && !isIn('hands') && !quiet ? ['warn', T('ov.by.noHands', { t: tn('bohrer') })] : ['ok', byTool('bohrer')];
  } else if (!sf) s = ['unknown', null];
  else if (sf === 'zeit') s = ['open', need('bohrer')];
  else if (sf === 'elek') {
    if (!hasT('decoder')) s = ['open', T('ov.by.needSafeTool')];
    else s = planFixed && !brainIn ? ['warn', T('ov.by.noBrain')] : ['ok', byTool('decoder')];
  } else s = planFixed && !brainIn ? ['open', T('ov.by.noBrainHand')] : ['ok', T('ov.by.hand')];

  // police
  const p: [RowState, Txt | null] = [kv('police') ? 'ok' : 'unknown', hasT('scanner') ? T('ov.by.scanner') : null];

  // time: the plan as it stands (before the plan step: the default plan) against the guard's window
  const [lo, hi] = estimateTime(V);
  const window = gd ? windowFor(V, gd) : null;
  // a vault that cannot be opened with these tools and this plan adds no time: the estimate is then incomplete
  const partial = P.targets.indexOf('tresor') >= 0 && possibleOrAll(V, 'safe').some((sf) => safeTime(V, sf)[0] === 0);
  const ts = partial || window === null ? 'unknown' : hi > window ? 'open' : hi > window - 2 ? 'warn' : 'ok';
  return { rows: [row('alarm', a), row('guard', g), row('safe', s), row('police', p)], time: { lo, hi, window, state: ts, partial } };
}

// ---------------------------------------------------------------- shopping advice
// What each tool is for, read against what the crew knows. Everything here works on the
// replicated `known` and the tool list alone, so every client computes it for itself:
// nothing hidden goes in, nothing hidden comes out. It only does the cross-reading that
// the crew would otherwise do by hand ("we know: time lock" -> "the decoder is useless").
export type ToolFit = 'fit' | 'miss' | 'open' | 'any';
export type ShopGroupId = 'alarm' | 'safe' | 'guard' | 'way';
export type KnownPub = Partial<Record<FactKey, { v: string; rumour: boolean } | null | undefined>>;
/** The shop, grouped by the question a tool answers. `facts` are shown in the group's heading. */
export const SHOP_GROUPS: { id: ShopGroupId; facts: FactKey[]; tools: string[] }[] = [
  { id: 'alarm', facts: ['alarm'], tools: ['magnet', 'schaum', 'stoer'] },
  { id: 'safe', facts: ['safe'], tools: ['decoder', 'bohrer'] },
  { id: 'guard', facts: ['guard', 'blind'], tools: ['leckerli', 'schleife'] },
  { id: 'way', facts: ['police'], tools: ['seil', 'zweitwagen', 'scanner'] },
];
/** Tools that answer exactly one value of one fact. */
const TOOL_ANSWERS: Record<string, { fact: FactKey; v: string }> = {
  magnet: { fact: 'alarm', v: 'tuer' },
  schaum: { fact: 'alarm', v: 'bewegung' },
  stoer: { fact: 'alarm', v: 'still' },
  decoder: { fact: 'safe', v: 'elek' },
  leckerli: { fact: 'guard', v: 'hund' },
  schleife: { fact: 'guard', v: 'monitor' },
};
export interface ToolAdvice {
  state: ToolFit;
  /** the fact this advice was read from, null if it depends on none; `rumour` is that fact's */
  fact: FactKey | null;
  rumour: boolean;
  /** text key plus parameters, rendered by texts.ts */
  text: Txt;
}
/** One line of plain advice for a tool: does it fit what we know? */
export function toolAdvice(known: KnownPub, id: string): ToolAdvice {
  const kn = (k: FactKey) => known[k] || null;
  const val = (k: FactKey): Txt => T('fact.' + k + '.' + kn(k)!.v);
  if (id === 'bohrer') {
    const sf = kn('safe');
    if (!sf) return { state: 'any', fact: 'safe', rumour: false, text: T('fit.bohrer.open') };
    return { state: 'fit', fact: 'safe', rumour: sf.rumour, text: T('fit.bohrer.' + sf.v + (sf.rumour ? '.r' : '')) };
  }
  if (id === 'seil') {
    const bl = kn('blind');
    if (bl && bl.v === 'dach') return { state: 'fit', fact: 'blind', rumour: bl.rumour, text: T(bl.rumour ? 'fit.seil.blind.r' : 'fit.seil.blind') };
    return { state: 'any', fact: null, rumour: false, text: T('fit.seil.any') };
  }
  // these two help whatever the crew knows: the advice is read from no fact
  if (id === 'zweitwagen' || id === 'scanner') return { state: 'any', fact: null, rumour: false, text: T('fit.' + id + '.any') };
  const a = TOOL_ANSWERS[id];
  if (!a) return { state: 'any', fact: null, rumour: false, text: T('fit.any') };
  const k = kn(a.fact);
  if (!k) return { state: 'open', fact: a.fact, rumour: false, text: T('fit.open', { k: T('fact.' + a.fact) }) };
  if (k.v === a.v) {
    // the camera loop is pointless at an entrance no camera sees
    const bl = id === 'schleife' ? kn('blind') : null;
    const own = id === 'decoder' || id === 'schleife' ? 'fit.' + id + '.yes' : 'fit.yes';
    return { state: 'fit', fact: a.fact, rumour: k.rumour, text: T(own + (k.rumour ? '.r' : ''), { v: val(a.fact), b: bl && bl.v !== 'keiner' ? T('fit.schleife.blind', { v: T('fact.blind.' + bl.v) }) : '' }) };
  }
  if (id === 'schleife') return { state: 'any', fact: a.fact, rumour: k.rumour, text: T('fit.schleife.other' + (k.rumour ? '.r' : ''), { v: val(a.fact) }) };
  return { state: 'miss', fact: a.fact, rumour: k.rumour, text: T(k.rumour ? 'fit.no.r' : 'fit.no', { v: val(a.fact) }) };
}
export type Cover = 'yes' | 'alt' | 'no' | 'none' | 'unknown';
/**
 * Is the known obstacle of a group answered by the tools in the basket?
 * `none` = it needs no tool; `alt` = no tool against it, but the crew has a way around it (another entrance).
 */
export function shopCover(known: KnownPub, tools: string[], g: ShopGroupId): Cover | null {
  const hasT = (id: string) => tools.indexOf(id) >= 0;
  const v = (k: FactKey) => (known[k] ? known[k]!.v : null);
  if (g === 'alarm') {
    const al = v('alarm');
    if (!al) return 'unknown';
    if (hasT(al === 'tuer' ? 'magnet' : al === 'bewegung' ? 'schaum' : 'stoer')) return 'yes';
    // the roof hatch has no door contact
    return al === 'tuer' && hasT('seil') ? 'alt' : 'no';
  }
  if (g === 'safe') {
    const sf = v('safe');
    if (hasT('bohrer')) return 'yes';
    if (!sf) return 'unknown';
    if (sf === 'mech') return 'none';
    return sf === 'elek' && hasT('decoder') ? 'yes' : 'no';
  }
  if (g === 'guard') {
    const gd = v('guard');
    if (!gd) return 'unknown';
    if (gd === 'rundgang') return 'none';
    if (hasT(gd === 'hund' ? 'leckerli' : 'schleife')) return 'yes';
    // the dog only matters in the yard; the monitor room does not see an entrance in the blind spot
    if (gd === 'hund') return 'alt';
    const bl = v('blind');
    return bl === 'liefer' || (bl === 'dach' && hasT('seil')) ? 'alt' : 'no';
  }
  return null;
}

/** The values a fact can still have; all of them when wrong rumours make what the crew knows contradict itself. */
function possibleOrAll(S: Game, k: FactKey): string[] {
  const v = possibleValues(S, k);
  return v.length ? v : S.job.facts[k];
}
export function estimateTime(S: Game): [number, number] {
  const P = S.plan,
    J = S.job;
  let lo = 0,
    hi = 0;
  const add = (a: number, b?: number) => {
    lo += a;
    hi += b === undefined ? a : b;
  };
  add(J.entrances[P.entrance].door ? (inside(S, 'hands') ? 3 : 1) : 3);
  if (P.panel) add(5);
  else {
    const al = possibleOrAll(S, 'alarm');
    const t1 = al.map((a) => (a === 'tuer' && has(S, 'magnet') && J.entrances[P.entrance].door ? 1 : 0) + (a === 'bewegung' && has(S, 'schaum') ? P.targets.length : 0));
    add(Math.min(...t1), Math.max(...t1));
  }
  for (const t of P.targets) {
    if (t === 'tresor') {
      const sfs = possibleOrAll(S, 'safe').map((sf) => safeTime(S, sf)[0] as number);
      add(Math.min(...sfs), Math.max(...sfs));
    } else add(J.targets[t].time);
  }
  add(J.entrances[P.entrance].exit);
  return [lo, hi];
}
function safeTime(S: Game, sf: string): [number, string | null] {
  const kopfIn = inside(S, 'brain');
  if (sf === 'mech' && kopfIn) return [6, 'brain'];
  if (sf === 'elek' && kopfIn && has(S, 'decoder')) return [5, 'decoder'];
  if (has(S, 'bohrer')) return [sf === 'zeit' ? 8 : 4, 'bohrer'];
  return [0, null];
}

// ---------------------------------------------------------------------------
// The job (generator: yields decisions and the secret offers in the middle)
// ---------------------------------------------------------------------------

export function* runJob(S: Game): Generator<Step, any, any> {
  const J = S.job,
    F = S.facts,
    P = S.plan;
  botDecide(S, 'pre');
  const ex = extraGuards(S);
  const R: any = (S.run = {
    t: 0,
    noise: 0,
    alarm: 'armed',
    silent: false,
    alarmAt: null,
    policeAt: null,
    crewKnows: false,
    windowEnd: Math.max(3, windowFor(S, F.guard) + Math.floor(S.rng() * 6) - 4),
    beats: [] as Beat[],
    decisions: 0,
    status: { brain: 'ok', gambler: 'ok', hands: 'ok', bait: 'ok' } as Record<Role, Status>,
    loot: [] as { t: TargetId; v: number; frac: number }[],
    impacts: {} as Record<string, Txt[]>,
    goodImp: {} as Record<string, number>,
    cameraSeen: false,
    spotted: false,
    warned: false,
    out: false,
    chased: false,
    doneTargets: [] as TargetId[],
    safeFail: false,
    mods: [] as any[],
    scapegoat: {} as Record<string, Offer>,
    pendingNoise: [] as any[],
    pendingTraces: [] as Txt[],
    traceLog: [] as Txt[],
    unsure: {} as Record<string, number>,
    comp: [] as string[],
    activeMax: 0,
    midDone: false,
    skills: 0,
  });
  for (const o of S.offers)
    if (o.state === 'accepted') {
      o.hits = o.hits || newHits();
      applyOfferRun(S, o);
    }
  const insideOk = () => ROLE_ORDER.filter((r) => P.posts[r] === 'inside' && R.status[r] !== 'caught');
  const isIn = (r: Role) => P.posts[r] === 'inside' && R.status[r] !== 'caught';
  let beat: Beat = null as unknown as Beat;
  const newBeat = (title: Txt, target?: TargetId) => {
    beat = { title, lines: [], t0: R.t };
    if (target) beat.target = target;
    R.beats.push(beat);
  };
  const line = (x: Txt, kind?: string) => beat.lines.push({ x, kind: kind || 'info' });
  const impact = (k: string, x: Txt, good?: boolean) => {
    (R.impacts[k] = R.impacts[k] || []).push(x);
    if (good) R.goodImp[k] = (R.goodImp[k] || 0) + 1;
  };
  const modsFor = (kind: string, role: Role | null) => R.mods.filter((m: any) => m.kind === kind && m.role === role);
  const tline = (x: Txt) => {
    line(x, 'trace');
    R.traceLog.push(x);
  };
  const roll = (p: number, label: Txt, role?: Role | null) => {
    const rm = role ? modsFor('roll', role) : [];
    for (const m of rm) {
      p += m.d;
      m.o.hits.rolls++;
    }
    p = clamp(Math.round(p), 1, 99);
    const r = Math.floor(S.rng() * 100) + 1,
      ok = r <= p;
    beat.lines.push({ kind: 'roll', roll: { r, p, ok, label } });
    if (rm.length && (R.unsure[role!] || 0) < 2) {
      R.unsure[role!] = (R.unsure[role!] || 0) + 1;
      rm[0].o.traces = (rm[0].o.traces || 0) + 1;
      tline(T('tr.unsure', { who: N(role!) }));
    }
    return ok;
  };
  const rollP = (p: number, role?: Role | null) => {
    if (role) for (const m of modsFor('roll', role)) p += m.d;
    return clamp(Math.round(p), 1, 99);
  };
  const durQ = (base: number, role: Role | null) => {
    let d = base;
    if (role) for (const m of modsFor('time', role)) d = Math.max(1, d + m.d);
    return d;
  };
  const durA = (base: number, role: Role | null) => {
    let d = base;
    const ms = role ? modsFor('time', role) : [];
    for (const m of ms) {
      const nd = Math.max(1, d + m.d);
      m.o.hits.min += Math.max(0, nd - d);
      d = nd;
    }
    if (d !== base) {
      ms[0].o.traces = (ms[0].o.traces || 0) + 1;
      tline(T(d > base ? 'tr.slow' : 'tr.fast', { who: N(role!) }));
    }
    return d;
  };
  const groupDur = (base: number) => {
    const slow = R.mods.filter((m: any) => m.kind === 'time' && m.d > 0 && isIn(m.role));
    if (slow.length) {
      slow[0].o.hits.min += 1;
      slow[0].o.traces = (slow[0].o.traces || 0) + 1;
      tline(T('tr.wait', { who: N(slow[0].role) }));
      return base + 1;
    }
    return base;
  };
  const fumbleP = () => 5 + 3 * R.noise + (R.alarm === 'triggered' && R.crewKnows ? 15 : 0);
  const panic = () => {
    const post = P.posts.bait;
    const alone = ROLE_ORDER.filter((r) => P.posts[r] === post && R.status[r] !== 'caught').length === 1;
    return (alone ? 20 : 0) + (R.alarm === 'triggered' && R.crewKnows ? 25 : 0);
  };
  const warnLead = () => (R.noRadio ? 0 : (has(S, 'scanner') ? 4 : 0) || (lookouts(S).length ? 2 : 0));
  const decide = function* (d: Omit<Decision, 'kind'>): Generator<Step, string, any> {
    R.decisions++;
    const dd: Decision = { kind: 'decide', ...d, t: R.t };
    const c = yield dd;
    const o = dd.options.find((x) => x.id === c) || dd.options[0];
    line(T('ln.choice', { o: o.label }), 'choice');
    return o.id;
  };
  // A roll that a human may play himself (first-person job). Skill checks off, a bot seat, or no result
  // (gave up, timeout): exactly the old roll, same random numbers. A result never touches S.rng.
  let skillSt: 'ok' | 'warned' | 'arrived' = 'ok';
  const skillRoll = function* (role: Role, game: string, variant: string, at: string, p: number, label: Txt, diff?: 1 | 2 | 3): Generator<Step, boolean, any> {
    skillSt = 'ok';
    if (!S.skills || S.humans.indexOf(role) < 0) return roll(p, label, role);
    const pp = rollP(p, role);
    const st: SkillStep = { kind: 'skill', role, game, variant, at, difficulty: diff ?? skillDifficulty(pp), seed: (S.runSeed * 31 + R.beats.length * 977 + R.skills * 131 + 7) >>> 0, tools: S.tools.slice(), p: pp, label };
    R.skills++;
    const fx = skillEffect(yield st);
    if (!fx) return roll(p, label, role);
    const rm = modsFor('roll', role);
    for (const m of rm) m.o.hits.rolls++;
    beat.lines.push({ kind: fx.ok ? 'good' : 'warn', x: T(fx.ok ? 'ln.skillOk' : 'ln.skillNo', { who: N(role), s: fx.seconds }) });
    if (rm.length && (R.unsure[role] || 0) < 2) {
      R.unsure[role] = (R.unsure[role] || 0) + 1;
      rm[0].o.traces = (rm[0].o.traces || 0) + 1;
      tline(T('tr.unsure', { who: N(role) }));
    }
    if (fx.noise) R.noise += fx.noise;
    if (fx.min) {
      line(T('ln.skillSlow', { who: N(role), n: fx.min }), 'warn');
      skillSt = spend(fx.min);
    }
    return fx.ok;
  };
  const opt = (id: string, label: string, text: string, pct: number, pctLabel: string, tags?: Txt[], details?: Txt | null): Opt => ({
    id,
    label: typeof label === 'string' ? T(label) : label,
    text: T(text),
    pct,
    pctLabel: T(pctLabel),
    tags: tags || [],
    details: details || null,
  });
  const tg = (n: string, p?: Record<string, Param>) => T('tag.' + n, p);
  const tmin = (n: number) => tg('min', { n });

  function trigger(kind: 'loud' | 'silent', why: Txt) {
    if (R.alarm === 'triggered') return;
    R.alarm = 'triggered';
    R.silent = kind === 'silent';
    R.alarmAt = R.t;
    R.policeAt = R.t + Math.max(3, J.policeMin[F.police] + STAKES[S.stake].police);
    R.why = why;
    if (!R.silent) {
      R.crewKnows = true;
      line(T('ln.alarm', { why }), 'bad');
    } else if (has(S, 'scanner')) {
      R.crewKnows = true;
      line(T('ln.scannerSilent'), 'bad');
    }
  }
  function spend(d: number): 'ok' | 'warned' | 'arrived' {
    if (R.alarm === 'triggered' && !R.out) {
      const lead = warnLead();
      if (lead && !R.warned && R.t + d > R.policeAt - lead) {
        R.t = Math.max(R.t, R.policeAt - lead);
        R.warned = true;
        R.crewKnows = true;
        line(has(S, 'scanner') ? T('ln.warnScanner', { n: R.policeAt - R.t }) : T('ln.warnLookout', { who: N(lookouts(S)[0]), n: R.policeAt - R.t }), 'bad');
        return 'warned';
      }
      if (R.t + d >= R.policeAt) {
        R.t = R.policeAt;
        return 'arrived';
      }
    }
    R.t += d;
    return 'ok';
  }
  function seize(role: Role): Role {
    const sg = R.scapegoat[role];
    if (sg && !sg.used && R.status[sg.target] !== 'caught') {
      sg.used = true;
      sg.hits.notes.push(T('fx.scapegoat', { who: N(sg.target), for: N(role) }));
      R.status[sg.target] = 'caught';
      line(T('ln.caught', { who: N(sg.target) }), 'bad');
      sg.traces = (sg.traces || 0) + 1;
      tline(T('tr.knew'));
      return sg.target;
    }
    R.status[role] = 'caught';
    line(T('ln.caught', { who: N(role) }), 'bad');
    return role;
  }
  function catchRoll(role: Role, p: number) {
    for (const m of modsFor('catch', role)) {
      p += m.d;
      m.o.hits.rolls++;
    }
    if (!roll(100 - p, T('rl.escapes', { who: N(role) }))) {
      seize(role);
      return true;
    }
    return false;
  }
  function policeInside() {
    R.crewKnows = true;
    line(R.silent ? T('ln.policeInSilent', { m: R.alarmAt }) : T('ln.policeIn'), 'bad');
    if (R.silent) impact('alarm', T('im.silentAt', { m: R.alarmAt }));
    for (const r of insideOk()) catchRoll(r, r === 'bait' ? 60 + Math.round(panic() / 2) : 55);
    R.dropBulky = true;
    R.forcedOut = true;
  }
  function flushNoise() {
    while (R.pendingTraces.length) tline(R.pendingTraces.shift());
    while (R.pendingNoise.length) {
      const p = R.pendingNoise.shift();
      R.noise += p.n;
      p.o.hits.noise += p.n;
      p.o.traces = (p.o.traces || 0) + 1;
      const post = P.posts[p.o.role as Role];
      tline(T(post === 'inside' ? 'tr.noiseIn' : post === 'driver' ? 'tr.noiseCar' : 'tr.noisePost'));
    }
  }

  function* encounter(reason: Txt): Generator<Step, string, any> {
    newBeat(T('bt.encounter'));
    line(reason, 'warn');
    const opts: Opt[] = [];
    const kIn = isIn('bait');
    const pD = clamp(75 - 10 * ex - panic(), 5, 95);
    const pH = clamp(55 + (lookouts(S).length ? 20 : 0) - 10 * ex, 5, 95);
    if (kIn) opts.push(opt('distract', 'op.distract', 'op.distract.t', rollP(pD, 'bait'), 'pl.success', [tg('short')], T('op.newWindow', { n: 7 - ex })));
    opts.push(opt('hide', 'op.hide', 'op.hide.t', pH, 'pl.success', [tmin(3)], T('op.newWindow', { n: 7 - ex })));
    opts.push(opt('leave', 'op.leaveNow', 'op.leaveNow.t', 75, 'pl.unseen', [], T('op.leaveNow.d')));
    const decider = kIn ? 'bait' : insideOk()[0];
    const c = yield* decide({ title: T('dc.guard'), who: decider, text: T('dc.guard.t'), options: opts });
    let ok: boolean;
    if (c === 'distract') {
      const st = spend(durA(1, 'bait'));
      if (st !== 'ok') return st;
      ok = roll(pD, T('rl.distract'), 'bait');
      if (ok) {
        R.windowEnd = R.t + 7 - ex;
        line(T('ln.distractOk', { who: N('bait') }), 'good');
      } else line(T('ln.distractNo', { who: N('bait') }), 'bad');
    } else if (c === 'hide') {
      const st = spend(3);
      if (st !== 'ok') return st;
      ok = roll(pH, T('rl.hide'));
      if (ok) {
        R.windowEnd = R.t + 7 - ex;
        line(T('ln.hideOk'), 'good');
      } else line(T('ln.hideNo'), 'bad');
    } else {
      ok = roll(75, T('rl.leave'));
      R.leaveNow = true;
      if (ok) {
        line(T('ln.leaveOk'), 'good');
        return 'ok';
      }
      line(T('ln.leaveNo'), 'bad');
    }
    if (!ok) {
      R.spotted = true;
      impact('guard', T('im.spotted', { g: T('fact.guard.' + F.guard) }));
      trigger('loud', T('why.guardCalls'));
      R.noise = Math.min(10, R.noise + 3);
      if (R.status[decider] !== 'caught') catchRoll(c === 'distract' ? 'bait' : decider, SPOT_CATCH);
      yield* alarmDecision();
    }
    return 'ok';
  }
  function* alarmDecision(): Generator<Step, void, any> {
    if (R.alarmDecided || R.leaveNow) return;
    R.alarmDecided = true;
    const times = R.crewKnows ? policeTimes(S) : [];
    const left = remainingPlanTime(),
      exitT = J.entrances[P.entrance].exit,
      elapsed = R.t - R.alarmAt;
    const pStay = Math.round((100 * times.filter((m) => m - elapsed > left + exitT).length) / times.length);
    const pGo = Math.round((100 * times.filter((m) => m - elapsed > exitT).length) / times.length);
    const kn = S.known.police ? T(S.known.police.rumour ? 'dc.policeRumour' : 'dc.police', { n: times[0] }) : T('dc.policeUnknown', { a: Math.min(...times), b: Math.max(...times) });
    const c = yield* decide({
      title: T('dc.alarm'),
      who: 'gambler',
      text: T('dc.alarm.t'),
      details: T('dc.alarm.d', { kn, el: elapsed, left, exit: exitT }),
      options: [opt('go', 'op.go', 'op.go.t', pGo, 'pl.beforePolice', [tg('short')]), opt('stay', 'op.stay', 'op.stay.t', pStay, 'pl.beforePolice', [tmin(left)])],
    });
    if (c === 'go') R.leaveNow = true;
  }
  function remainingPlanTime() {
    let s = 0;
    for (const t of P.targets) if (R.doneTargets.indexOf(t) < 0 && t !== R.current) s += t === 'tresor' ? safeTime(S, F.safe)[0] || 0 : J.targets[t].time;
    return s;
  }
  // Unrest: the more offers are active, the likelier something goes wrong. Never explained.
  function activeOffers() {
    return S.offers.filter((o) => o.state === 'accepted' && o.applied).length;
  }
  function* unrest(): Generator<Step, void, any> {
    const n = activeOffers();
    R.activeMax = Math.max(R.activeMax, n);
    if (n < 3 || R.out) return;
    if (S.rng() >= Math.min(0.95, UNREST_P * (n - 2) * (n - 2))) return;
    let pool = ['streit', 'laut', 'funk', 'fahrer'].filter((x) => R.comp.indexOf(x) < 0 || x === 'streit' || x === 'laut');
    if (n >= 5) pool = ['streit'];
    if (n >= 4 && R.alarm === 'armed') pool.push('alarm', 'alarm');
    if (n >= 5 && R.alarm !== 'triggered') pool.push('verrat', 'verrat');
    const c = pool[Math.floor(S.rng() * pool.length)];
    R.comp.push(c);
    if (c === 'streit') {
      line(T('ln.uFight'), 'warn');
      spend(3);
    }
    if (c === 'laut') {
      line(T('ln.uKick'), 'warn');
      R.noise += 3;
    }
    if (c === 'funk') {
      line(T('ln.uRadio'), 'warn');
      R.noRadio = true;
    }
    if (c === 'fahrer') {
      line(T('ln.uCar'), 'warn');
      R.driverLate = 3;
    }
    if (c === 'verrat') {
      line(T('ln.uBetray'), 'warn');
      R.ambush = true;
      impact('police', T('im.betrayed'));
    }
    if (c === 'alarm') {
      line(T('ln.uSensor'), 'bad');
      trigger('loud', T('why.siren'));
      yield* alarmDecision();
    }
  }
  function* afterAction(): Generator<Step, string, any> {
    flushNoise();
    yield* unrest();
    if (R.alarm !== 'triggered' || !R.crewKnows) {
      if (R.noise >= 3 && !R.leaveNow) {
        const p = (R.noise - 2) * 10;
        if (!roll(100 - p, T('rl.unheard'))) {
          line(T('ln.heard'), 'warn');
          R.windowEnd = Math.min(R.windowEnd, R.t);
          impact('noise', T('im.noise'));
        }
      }
      R.noise = Math.max(0, R.noise - 1);
      if (!R.leaveNow && !R.spotted && R.t < R.windowEnd && !roll(100 - PATROL_BASE - PATROL_P * ex, T('rl.noPatrol'))) {
        const st = yield* encounter(T('ln.patrol'));
        if (st === 'arrived') {
          policeInside();
          return 'arrived';
        }
        if (st === 'warned') return 'warned';
      }
      if (R.t >= R.windowEnd && !R.leaveNow && !R.spotted) {
        const st = yield* encounter(T(R.t > R.windowEnd ? 'ln.overtime' : 'ln.windowShut'));
        if (st === 'arrived') {
          policeInside();
          return 'arrived';
        }
        if (st === 'warned') return 'warned';
      }
    }
    return 'ok';
  }
  function addLoot(t: TargetId, frac: number, push: boolean) {
    const best = F.loot === t;
    const v = J.targets[t].base * (best ? J.bestMult : 1) * frac;
    R.loot.push({ t, v, frac });
    line(T(best ? 'ln.lootBest' : 'ln.loot', { t: T('tg.' + t + '.name'), v: EUR(v * STAKES[S.stake].mult), x: push ? T('ln.pushNote') : '' }), 'good');
    if (best) impact('loot', T('im.best'), true);
  }
  // The secret offers in the middle of the job: every human who is still free gets theirs at once.
  function* midPoint(): Generator<Step, void, any> {
    if (R.midDone) return;
    R.midDone = true;
    botDecide(S, 'mid');
    for (const o of S.offers) if (o.state === 'accepted' && o.when === 'mid' && !o.human) applyOfferRun(S, o);
    const open = S.offers.filter((o) => o.human && o.when === 'mid' && o.state === 'open' && R.status[o.role] !== 'caught');
    if (open.length) {
      const ans: Partial<Record<Role, string>> = (yield { kind: 'offers', when: 'mid', roles: open.map((o) => o.role) }) || {};
      for (const o of open) answerOffer(S, o, ans[o.role] || 'decline');
    }
    flushNoise();
  }

  /* Approach */
  newBeat(T('bt.approach'));
  line(T('ln.posts', Object.fromEntries(ROLE_ORDER.map((r, i) => ['a' + i, T('ln.postOf', { who: N(r), p: T('post.' + P.posts[r]) })]))), 'info');
  line(T(ex ? 'ln.guardsN' : 'ln.guards1', { n: 1 + ex, w: R.windowEnd }), 'info');
  const loopOn = has(S, 'schleife') && lookouts(S).length > 0;
  for (const tx of S.preTraces || []) tline(tx);
  if (has(S, 'schleife')) line(T(loopOn ? 'ln.loopOn' : 'ln.loopIdle'), loopOn ? 'good' : 'warn');
  if (F.alarm === 'still' && has(S, 'stoer')) impact('alarm', T('im.jammer'), true);

  /* In */
  const E = J.entrances[P.entrance];
  newBeat(T('bt.in', { e: T('en.' + P.entrance + '.name') }));
  if (E.yard && F.guard === 'hund') {
    if (S.known.guard && S.known.guard.v !== 'hund') line(T('ln.dogRumour'), 'warn');
    if (has(S, 'leckerli')) {
      line(T('ln.dogTreat'), 'good');
      impact('guard', T('im.treat'), true);
    } else {
      line(T('ln.dog'), 'warn');
      const kOk = (P.posts.bait === 'inside' || P.posts.bait === 'lookout') && R.status.bait === 'ok';
      const pK = clamp(80 - panic(), 5, 95);
      const opts: Opt[] = [];
      if (kOk) opts.push(opt('koeder', 'op.lure', 'op.lure.t', rollP(pK, 'bait'), 'pl.success', [tmin(2)], T('op.lure.d')));
      opts.push(opt('run', 'op.through', 'op.through.t', 100, 'pl.sure', [tg('loud')], T('op.through.d')));
      if (has(S, 'seil')) opts.push(opt('roof', 'op.roof', 'op.roof.t', 100, 'pl.sure', [tmin(4)]));
      const c = yield* decide({ title: T('dc.dog'), who: kOk ? 'bait' : insideOk()[0], text: T('dc.dog.t'), options: opts });
      if (c === 'koeder') {
        spend(durA(2, 'bait'));
        if (roll(pK, T('rl.dog'), 'bait')) line(T('ln.lureOk', { who: N('bait') }), 'good');
        else {
          line(T('ln.bark'), 'bad');
          R.noise += 4;
          R.windowEnd -= 6;
        }
      } else if (c === 'run') {
        R.noise += 4;
        R.windowEnd -= 6;
        line(T('ln.barkLight'), 'bad');
      } else {
        spend(4);
        P.entrance = 'dach';
        line(T('ln.toRoof'), 'info');
      }
      impact('guard', T('im.dog'));
    }
  }
  const E2 = J.entrances[P.entrance];
  if (P.entrance !== F.blind && !loopOn) {
    R.cameraSeen = true;
    if (F.guard === 'monitor') {
      if (S.known.guard && S.known.guard.v !== 'monitor') line(T('ln.monitorRumour'), 'warn');
      if (!roll(100 - (50 + 10 * ex), T('rl.monitor'))) {
        line(T('ln.monitorSaw'), 'bad');
        R.windowEnd = Math.min(R.windowEnd, R.t + 2);
        impact('guard', T('im.monitor'));
      } else line(T('ln.monitorMissed'), 'warn');
    } else line(T('ln.filmed'), 'warn');
    impact('blind', T('im.filmed'));
  } else if (P.entrance === F.blind) {
    line(T('ln.blind'), 'good');
    impact('blind', T('im.blind'), true);
  }
  if (E2.door) {
    const hIn = isIn('hands');
    const lockT = durQ(3, hIn ? 'hands' : null);
    const pF = rollP(100 - fumbleP(), 'hands');
    const opts = hIn
      ? [opt('pick', 'op.pick', 'op.pick.t', pF, 'pl.noFumble', [tmin(lockT), tg('quiet')], T('op.pick.d')), opt('crow', 'op.crow', 'op.crow.t', 100, 'pl.sure', [tmin(1), tg('loud')], T('op.crow.d'))]
      : [opt('pick', 'op.pickOther', 'op.pickOther.t', 50, 'pl.success', [tmin(6)], T('op.pickOther.d')), opt('crow', 'op.crow', 'op.crow.t', 100, 'pl.sure', [tmin(1), tg('loud')], T('op.crow.d'))];
    const c = yield* decide({ title: T('dc.door'), who: hIn ? 'hands' : insideOk()[0], text: T('dc.door.t', { e: T('en.' + P.entrance + '.name') }), options: opts });
    if (c === 'pick') {
      if (hIn) {
        spend(durA(3, 'hands'));
        if (!(yield* skillRoll('hands', 'lock', 'door', 'door', 100 - fumbleP(), T('rl.noFumble')))) {
          spend(2);
          R.noise += 2;
          line(T('ln.fumbleDoor'), 'warn');
        } else line(T('ln.open'), 'good');
      } else {
        spend(6);
        if (!roll(50, T('rl.lockOpens'))) {
          spend(1);
          R.noise += 3;
          line(T('ln.lockHolds'), 'warn');
        } else line(T('ln.openSix'), 'good');
      }
    } else {
      spend(1);
      R.noise += 3;
      line(T('ln.crow'), 'warn');
    }
  } else {
    const who: Role = isIn('bait') ? 'bait' : isIn('hands') ? 'hands' : insideOk()[0];
    const fastT = durQ(1, who),
      slowT = durQ(3, who);
    const c = yield* decide({
      title: T('dc.hatch'),
      who,
      text: T('dc.hatch.t'),
      options: [opt('fast', 'op.fast', 'op.fast.t', rollP(85, who), 'pl.noFall', [tmin(fastT)], T('op.fast.d')), opt('slow', 'op.slow', 'op.slow.t', 100, 'pl.sure', [tmin(slowT)])],
    });
    if (c === 'fast') {
      spend(durA(1, who));
      if (!roll(85, T('rl.noFall'), who)) {
        R.status[who] = 'hurt';
        spend(2);
        line(T('ln.fall', { who: N(who) }), 'bad');
      } else line(T('ln.allDown'), 'good');
    } else {
      spend(durA(3, who));
      line(T('ln.allDown'), 'good');
    }
  }
  if (P.panel && isIn('brain') && P.entrance === 'liefer') {
    spend(durA(5, 'brain'));
    if (roll(80, T('rl.panel'), 'brain')) {
      R.alarm = 'off';
      line(T('ln.panelOff', { who: N('brain') }), 'good');
      impact('alarm', T('im.panel'), true);
    } else {
      line(T('ln.panelFail', { who: N('brain') }), 'bad');
      trigger(F.alarm === 'still' && !has(S, 'stoer') ? 'silent' : 'loud', T('why.panel'));
      if (R.silent && !R.crewKnows) line(T('ln.panelSilent'), 'warn');
    }
  }
  if (R.alarm === 'armed') {
    if (F.alarm === 'tuer' && E2.door) {
      let ok = false;
      if (has(S, 'magnet')) {
        spend(1);
        ok = isIn('hands') ? roll(100 - fumbleP(), T('rl.magnet'), 'hands') : roll(60, T('rl.magnetNoHands'));
        if (ok) {
          line(T('ln.magnet'), 'good');
          impact('alarm', T('im.magnet'), true);
        }
      }
      if (!ok) {
        trigger('loud', T('why.door', { e: T('en.' + P.entrance + '.name') }));
        impact('alarm', T('im.door'));
        if (S.known.alarm && S.known.alarm.v !== 'tuer') line(T('ln.doorRumour'), 'warn');
      }
    } else if (F.alarm === 'still' && E2.door && !has(S, 'stoer')) {
      trigger('silent', T('why.doorSilent'));
      impact('alarm', T('im.doorSilent', { m: R.t }));
    }
  }
  if (R.alarm === 'triggered' && R.crewKnows) yield* alarmDecision();
  {
    const st = yield* afterAction();
    if (st === 'arrived') R.leaveNow = true;
  }

  /* Targets */
  const order = P.targets.slice();
  const doTarget = function* (t: TargetId, frac: number, isPush: boolean): Generator<Step, string, any> {
    R.current = t;
    newBeat(T(isPush ? 'bt.push' : 'bt.target', { t: T('tg.' + t + '.name') }), t);
    if (R.alarm === 'armed' && F.alarm === 'bewegung') {
      let ok = false;
      if (has(S, 'schaum')) {
        const st = spend(1);
        if (st !== 'ok') return st;
        ok = isIn('hands') ? roll(100 - fumbleP(), T('rl.foam'), 'hands') : roll(60, T('rl.foamNoHands'));
        if (ok) line(T('ln.foam'), 'good');
      }
      if (!ok) {
        trigger('loud', T('why.motion', { t: T('tg.' + t + '.name') }));
        impact('alarm', T('im.motion'));
        if (S.known.alarm && S.known.alarm.v !== 'bewegung') line(T('ln.motionRumour'), 'warn');
      } else impact('alarm', T('im.foam'), true);
      if (R.alarm === 'triggered') {
        yield* alarmDecision();
        if (R.leaveNow && !isPush) return 'ok';
      }
    }
    if (t === 'tresor') {
      const sTrue = F.safe;
      const sName = T('fact.safe.' + sTrue);
      if (S.known.safe && S.known.safe.v !== sTrue) line(T('ln.safeRumour', { s: sName }), 'warn');
      const quietBase = sTrue === 'mech' && isIn('brain') ? 6 : sTrue === 'elek' && isIn('brain') && has(S, 'decoder') ? 5 : 0;
      const drillBase = has(S, 'bohrer') ? (sTrue === 'zeit' ? 8 : 4) : 0;
      if (!quietBase && !drillBase) {
        line(T('ln.safeShut', { s: sName }), 'bad');
        impact('safe', T('im.safeShut', { s: sName }));
        R.safeFail = true;
        spend(1);
        R.doneTargets.push(t);
        R.current = null;
        return 'ok';
      }
      const quiet = quietBase ? durQ(quietBase, 'brain') : 0,
        drill = drillBase ? durQ(drillBase, isIn('hands') ? 'hands' : null) : 0;
      let method: string;
      if (quiet && drill) {
        const pK = sTrue === 'mech' ? 85 : 90;
        method = yield* decide({
          title: T('dc.safe'),
          who: 'brain',
          text: T('dc.safe.t', { n: Math.max(0, R.windowEnd - R.t) }),
          options: [
            opt('quiet', 'op.quiet', 'op.quiet.t', rollP(pK, 'brain'), 'pl.firstTry', [tmin(quiet), tg('quiet')], T('op.quiet.d')),
            opt('drill', 'op.drill', 'op.drill.t', rollP(100 - fumbleP(), 'hands'), 'pl.noFumble', [tmin(drill), tg('loud')], T('op.drill.d')),
          ],
        });
      } else method = quiet ? 'quiet' : 'drill';
      if (method === 'quiet') {
        const st = spend(durA(quietBase, 'brain'));
        if (st !== 'ok') return st;
        const okQ = yield* skillRoll('brain', 'safe', sTrue, 'safe', sTrue === 'mech' ? 85 : 90, T('rl.combo'));
        if (skillSt !== 'ok') return skillSt;
        if (!okQ) {
          line(T('ln.secondTry'), 'warn');
          const st2 = spend(3);
          if (st2 !== 'ok') return st2;
        }
        line(T(sTrue === 'elek' ? 'ln.safeDecoder' : 'ln.safeEar'), 'good');
        impact('safe', T(sTrue === 'mech' ? 'im.safeMech' : 'im.safeElek'), true);
      } else {
        const st = spend(durA(drillBase, isIn('hands') ? 'hands' : null));
        if (st !== 'ok') return st;
        R.noise += 4;
        if (isIn('hands')) {
          const okD = yield* skillRoll('hands', 'safe', 'drill', 'safe', 100 - fumbleP(), T('rl.drill'), sTrue === 'zeit' ? 3 : undefined);
          if (skillSt !== 'ok') return skillSt;
          if (!okD) {
            line(T('ln.drillJam'), 'warn');
            const st2 = spend(2);
            if (st2 !== 'ok') return st2;
          }
        } else if (!roll(60, T('rl.drillNoHands'))) {
          line(T('ln.drillBreak'), 'warn');
          const st2 = spend(3);
          if (st2 !== 'ok') return st2;
        }
        line(T('ln.drilled'), 'good');
        impact('safe', T('im.drilled', { s: sName, n: drillBase }));
      }
      if (R.alarm === 'armed' && F.alarm === 'still' && !has(S, 'stoer')) {
        trigger('silent', T('why.safeSensor'));
        impact('alarm', T('im.safeSilent', { m: R.t }));
      }
    } else {
      const d = groupDur(J.targets[t].time);
      const st = spend(d);
      if (st !== 'ok') return st;
      R.noise += J.targets[t].noise;
      line(T(t === 'vitrinen' ? 'ln.cases' : 'ln.crates'), 'info');
    }
    addLoot(t, frac, isPush);
    if (!isPush) R.doneTargets.push(t);
    R.current = null;
    return yield* afterAction();
  };

  let first = true;
  for (const t of order) {
    if (R.leaveNow || R.forcedOut) break;
    const st = yield* doTarget(t, 1, false);
    if (st === 'arrived') {
      policeInside();
      break;
    }
    if (st === 'warned') {
      R.leaveNow = true;
      break;
    }
    if (first) {
      first = false;
      yield* midPoint();
    }
  }
  if (!R.midDone) yield* midPoint();

  /* All or nothing, also after an early stop */
  if (!R.forcedOut && !R.leaveNow) yield* unrest();
  if (!R.forcedOut && insideOk().length) {
    const early = !!R.leaveNow;
    const exitT = J.entrances[P.entrance].exit;
    const risk = (dt: number, nz: number) => {
      let pG = 8 + 6 * ex + 4 * (R.noise + nz) + (R.t + dt > R.windowEnd ? 35 : 0) - (lookouts(S).length ? 5 : 0);
      if (R.alarm === 'triggered' && R.crewKnows) pG = 10;
      pG = clamp(pG, 3, 95);
      let pP = 0;
      if (R.alarm === 'triggered' && R.crewKnows) {
        const el = R.t - R.alarmAt,
          ts = policeTimes(S);
        pP = (ts.filter((m) => m - el <= dt + exitT).length / ts.length) * 100;
      }
      return { pG, pP: Math.round(pP), total: Math.round(100 - ((100 - pG) * (100 - pP)) / 100) };
    };
    const rest = (Object.keys(J.targets) as TargetId[]).filter((t) => R.doneTargets.indexOf(t) < 0 && R.loot.every((L: any) => L.t !== t) && (t !== 'tresor' || safeTime(S, S.known.safe ? S.known.safe.v : F.safe)[1]));
    const opts: Opt[] = [];
    const dtOf = (t: TargetId) => (t === 'tresor' ? safeTime(S, S.known.safe ? S.known.safe.v : 'zeit')[0] || 6 : J.targets[t].time);
    rest.sort((a, b) => dtOf(a) - dtOf(b));
    const riskDet = (rk: { pG: number; pP: number }) => T(rk.pP ? 'op.riskDP' : 'op.riskD', { g: rk.pG, p: rk.pP });
    if (rest.length) {
      const t = rest[0],
        dt = dtOf(t),
        nz = t === 'tresor' ? (safeTime(S, S.known.safe ? S.known.safe.v : 'zeit')[1] === 'bohrer' ? 4 : 0) : J.targets[t].noise;
      const rk = risk(dt, nz);
      const o = opt('extra:' + t, '', 'op.extra.t', rk.total, 'pl.risk', [tmin(dt), tg(nz >= 2 ? 'loud' : 'quiet')], riskDet(rk));
      o.label = T('op.extra', { t: T('tg.' + t + '.name') });
      opts.push({ ...o, risk: rk, dt, nz });
    }
    const done = R.loot.length ? R.loot.slice().sort((a: any, b: any) => b.v - a.v)[0].t : null;
    if (done) {
      const rk = risk(3, 1);
      const o = opt('more:' + done, '', 'op.more.t', rk.total, 'pl.risk', [tmin(3), tg('pct', { n: 40 })], riskDet(rk));
      o.label = T('op.more', { t: T('tg.' + done + '.name') });
      opts.push({ ...o, risk: rk, dt: 3, nz: 1 });
    }
    if (opts.length) {
      opts.push(opt('leave', 'op.out', 'op.out.t', 0, 'pl.risk', []));
      newBeat(T('bt.greed'));
      line(T(early ? 'ln.greedEarly' : 'ln.greedDone'), 'info');
      const c = yield* decide({ title: T(early ? 'dc.greedEarly' : 'dc.greed'), who: 'gambler', text: T('dc.greed.t', { m: R.t, n: R.noise }), options: opts, push: true });
      const o = opts.find((x) => x.id === c)!;
      if (c !== 'leave') {
        R.pushed = true;
        if (!roll(100 - o.risk!.pG, T('rl.greed'))) {
          line(T('ln.greedGuard'), 'bad');
          const victims = insideOk();
          seize(victims[Math.floor(S.rng() * victims.length)]);
          trigger('loud', T('why.panic'));
          R.pushFailed = true;
          R.leaveNow = true;
          if (spend(1) === 'arrived') policeInside();
        } else {
          const [kind, t] = c.split(':') as [string, TargetId];
          const st = kind === 'extra' ? yield* doTarget(t, 1, true) : yield* doTarget(t, 0.4, true);
          if (st === 'arrived') policeInside();
        }
      }
    }
  }

  /* Out */
  newBeat(T('bt.out'));
  const E3 = J.entrances[P.entrance];
  const outName = T('en.' + P.entrance + '.name');
  if (!R.forcedOut && insideOk().length) {
    const st = spend(E3.exit);
    if (st === 'arrived') {
      line(T('ln.almostOut'), 'bad');
      for (const r of insideOk()) catchRoll(r, r === 'bait' ? 50 + Math.round(panic() / 2) : 40);
      R.dropBulky = true;
    } else if (st === 'warned') {
      if (spend(E3.exit) === 'arrived') {
        line(T('ln.tooSlow'), 'bad');
        for (const r of insideOk()) catchRoll(r, 40);
        R.dropBulky = true;
      } else line(T('ln.outVia', { e: outName, m: R.t }), 'good');
    } else line(T('ln.outVia', { e: outName, m: R.t }), 'good');
  } else if (R.forcedOut) line(T('ln.run'), 'warn');
  R.out = true;
  const carriers = insideOk().length;
  R.loot.forEach((L: any) => {
    if (L.t !== 'lager') return;
    let f = 1;
    const why: Txt[] = [];
    if (carriers < 2) {
      f *= 0.5;
      why.push(T('why.carriers'));
    }
    if (!driver(S)) {
      f *= 0.5;
      why.push(T('why.noCar'));
    }
    if (P.entrance === 'dach') {
      f *= 0.5;
      why.push(T('why.rope'));
    }
    if (R.dropBulky) {
      f *= 0.5;
      why.push(T('why.dropped'));
    }
    if (f < 1) {
      L.v *= f;
      line(T('ln.lagerPart', { n: Math.round(f * 100), why: T('list.' + why.length, Object.fromEntries(why.map((w, i) => ['a' + i, w]))) }), 'warn');
    }
  });

  /* Getaway */
  newBeat(T('bt.getaway'));
  const drv = driver(S);
  let G = drv === 'hands' ? 2 : drv ? 3 : 6;
  if (drv) G = durA(G, drv);
  if (R.driverLate) G += R.driverLate;
  flushNoise();
  if (drv && drv !== 'hands') {
    if (!roll(85, T('rl.stall', { who: N(drv) }), drv)) {
      G += 3;
      line(T('ln.stall', { who: N(drv) }), 'warn');
    }
  }
  if (has(S, 'zweitwagen') && drv) G = Math.max(1, G - 1);
  const escapees = ROLE_ORDER.filter((r) => R.status[r] !== 'caught');
  if (!escapees.length) line(T('ln.nobody'), 'bad');
  else if (R.ambush || (R.alarm === 'triggered' && R.policeAt <= R.t + G)) {
    R.chased = true;
    if (R.silent && !R.crewKnows) impact('alarm', T('im.silentChase'));
    line(T('ln.chase'), 'bad');
    const pC = clamp((drv === 'hands' ? 75 : drv ? 55 : 35) + (has(S, 'zweitwagen') ? 20 : 0) + (has(S, 'scanner') ? 10 : 0) - 5 * STAKES[S.stake].extra - (R.ambush ? 30 : 0), 5, 95);
    if (roll(pC, T('rl.chase'), drv)) line(T('ln.lost'), 'good');
    else {
      const v = escapees[Math.floor(S.rng() * escapees.length)];
      seize(v);
      if (drv && S.rng() < 0.5) {
        const w = escapees.find((r) => r !== v && R.status[r] === 'ok');
        if (w) {
          R.status[w] = 'hurt';
          line(T('ln.hurt', { who: N(w) }), 'bad');
        }
      }
    }
    if (R.alarm === 'triggered') impact('police', T('im.policeAfter', { n: R.policeAt - R.alarmAt }));
  } else {
    if (R.alarm === 'triggered') impact('police', T('im.policeLate', { n: R.policeAt - R.alarmAt }), true);
    line(R.alarm === 'triggered' ? T('ln.goneBefore') : drv ? T('ln.driveOff', { who: N(drv) }) : T('ln.walkOff'), 'good');
  }
  R.done = true;
  return settle(S);
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export function settle(S: Game) {
  const R = S.run,
    J = S.job,
    F = S.facts,
    st = STAKES[S.stake];
  const caught = ROLE_ORDER.filter((r) => R.status[r] === 'caught');
  const insideAll = ROLE_ORDER.filter((r) => S.plan.posts[r] === 'inside');
  const gross = R.loot.reduce((s: number, L: any) => s + L.v, 0);
  let lostShare = 0;
  if (S.stake === 'allin' && caught.length) {
    const lost = caught.filter((r) => insideAll.indexOf(r) >= 0).length + (R.chased ? caught.filter((r) => insideAll.indexOf(r) < 0).length : 0);
    lostShare = gross * Math.min(1, lost / Math.max(1, insideAll.length));
  }
  const loot = Math.round(((gross - lostShare) * st.mult) / 10) * 10;
  const bonus: Record<Role, number> = { brain: 0, gambler: 0, hands: 0, bait: 0 };
  let cut = 0;
  const acc = S.offers.filter((o) => o.state === 'accepted');
  for (const o of acc) {
    let b = 0;
    if (o.id === 'provision') {
      b = Math.round((loot * 0.1) / 10) * 10;
      cut += b;
    }
    if (o.id === 'tasche') {
      b = Math.min(1500, Math.max(0, loot - cut));
      cut += b;
    }
    if (o.id === 'laerm') b = 700;
    if (o.id === 'nerven') b = 800;
    if (R.status[o.role] === 'caught' && o.id === 'tasche') b = 0;
    o.bonus = b;
    bonus[o.role] += b;
  }
  const bail = caught.length * BAIL;
  const pot = loot - cut - S.spent - bail;
  const free = ROLE_ORDER.filter((r) => R.status[r] !== 'caught');
  const share = {} as Record<Role, number>;
  for (const r of ROLE_ORDER) share[r] = pot > 0 ? (R.status[r] === 'caught' ? 0 : pot / Math.max(1, free.length)) : pot / 4;
  const fair = (loot - S.spent - bail) / 4;
  const indiv = ROLE_ORDER.map((r) => ({ role: r, share: Math.round(share[r]), bonus: bonus[r], total: Math.round(share[r] + bonus[r]), status: R.status[r] as Status, rank: 0, vsFair: 0 })).sort((a, b) => b.total - a.total);
  indiv.forEach((x, i) => {
    x.rank = i + 1;
    x.vsFair = x.total - Math.round(fair);
  });
  let att = S.attention + (R.alarm === 'triggered' ? 1 : 0) + (R.cameraSeen ? 1 : 0) + caught.length * (S.stake === 'allin' ? 2 : 1) + (R.status.gambler === 'caught' ? 1 : 0);
  att = clamp(att, 0, 5);
  const net = pot;
  let grade: [string, string];
  if (caught.length >= 2 || (loot === 0 && caught.length)) grade = ['F', 'gr.F'];
  else if (loot === 0) grade = ['E', 'gr.E'];
  else if (caught.length === 1) grade = ['D', 'gr.Dloss'];
  else if (net >= 9000) grade = ['A', 'gr.A'];
  else if (net >= 5000) grade = ['B', 'gr.B'];
  else if (net >= 1500) grade = ['C', 'gr.C'];
  else grade = ['D', 'gr.D'];
  if (att >= 4 && grade[0] < 'D') grade = [String.fromCharCode(grade[0].charCodeAt(0) + 1), 'gr.loud'];
  const unknown: any[] = [];
  for (const k of J.factOrder) {
    const kn = S.known[k];
    if (kn && !kn.wrong) continue;
    const imp: Txt[] = (R.impacts[k] || []).concat(k === 'guard' && R.impacts.noise ? R.impacts.noise : []);
    const allGood = imp.length && (R.goodImp[k] || 0) >= (R.impacts[k] || []).length;
    unknown.push({ k, value: F[k], wrong: kn ? kn.v : null, src: kn ? kn.src : null, impact: imp.length ? imp : [T('im.none')], hint: allGood ? null : T('hint.' + k + '.' + F[k]) });
  }
  const offers = S.offers.map((o) => {
    const h = o.hits || newHits();
    const eff: Txt[] = [];
    if (h.min > 0) eff.push(T('fx.min', { n: h.min }));
    if (h.rolls) eff.push(T(h.rolls === 1 ? 'fx.roll1' : 'fx.rolls', { n: h.rolls }));
    if (h.noise) eff.push(T('fx.noise', { n: h.noise }));
    eff.push(...h.notes);
    return { id: o.id, role: o.role, human: o.human, when: o.when, state: o.state, target: o.target || null, partner: o.partner || null, bonus: o.bonus || 0, effects: eff, reclaimed: false };
  });
  const success = caught.length === 0 && net > 0;
  const co = carryOver(att, net, success, J.budget);
  const active = Math.max(R.activeMax, S.offers.filter((o) => o.state === 'accepted' && o.applied).length);
  S.result = {
    bail,
    active,
    incidents: R.comp.length,
    traces: R.traceLog.slice(),
    fair: Math.round(fair),
    gross: Math.round(gross),
    lostShare: Math.round(lostShare * st.mult),
    mult: st.mult,
    stake: S.stake,
    loot,
    cut,
    spent: S.spent,
    net,
    attention: att,
    nextBudget: co.budget,
    nextAttention: co.attention,
    status: { ...R.status },
    caught: caught.length,
    grade,
    unknown,
    success,
    pushed: !!R.pushed,
    decisions: R.decisions,
    indiv,
    offers,
    accepted: acc.length,
  };
  return S.result;
}

// ---------------------------------------------------------------------------
// The evening: several jobs in a row, one running ranking, consequences that carry over
// ---------------------------------------------------------------------------

/** The heat cools by this much between two jobs of one evening (attention the crew ended with minus this). */
export const CARRY_COOL = 1;
/** Next job's budget = base budget + this share of a positive crew pot of a clean job ... */
export const CARRY_POT_SHARE = 0.1;
/** ... but at most this many euros (rounded to 50). A failed job (somebody caught, or no profit) gives nothing. */
export const CARRY_POT_CAP = 1000;

/** What the next job of the evening starts with: attention (cooled by one) and budget (base plus a bounded share of the last pot). */
export function carryOver(attention: number, pot: number, success: boolean, baseBudget: number) {
  const bonus = success && pot > 0 ? Math.min(CARRY_POT_CAP, Math.round((pot * CARRY_POT_SHARE) / 50) * 50) : 0;
  return { attention: clamp(attention - CARRY_COOL, 0, 5), budget: baseBudget + bonus };
}

export interface EveningPlayer {
  /** stable identity: the player's pid; a bot seat is 'bot:<role>' */
  key: string;
  name: string;
  /** seat in the latest job (roles can be re-voted between jobs) */
  role: Role;
  bot: boolean;
  jobs: number;
  /** total individual take of the evening (after accusations) */
  total: number;
  /** this job's take (the latest job) */
  take: number;
  caught: number;
  hits: number;
  misses: number;
}
/** Public, replicated and saved. Numbers and names only: never a hidden fact or an offer. */
export interface Evening {
  jobs: number;
  /** sum of the crew pots (net) of all jobs */
  pot: number;
  players: EveningPlayer[];
  /** what the next job starts with */
  carry: { attention: number; budget: number };
}

export function emptyEvening(): Evening {
  return { jobs: 0, pot: 0, players: [], carry: { attention: 0, budget: JOBS.varga.budget } };
}

/** Validate an evening read from storage (untrusted); null when it is not usable. */
export function loadEvening(x: any): Evening | null {
  if (!x || typeof x !== 'object' || !Array.isArray(x.players) || !(x.jobs > 0)) return null;
  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const players: EveningPlayer[] = [];
  for (const p of x.players.slice(0, 8)) {
    if (!p || typeof p.key !== 'string' || ROLE_ORDER.indexOf(p.role) < 0) return null;
    players.push({ key: p.key.slice(0, 64), name: String(p.name ?? '').slice(0, 16), role: p.role, bot: !!p.bot, jobs: n(p.jobs), total: n(p.total), take: n(p.take), caught: n(p.caught), hits: n(p.hits), misses: n(p.misses) });
  }
  const c = x.carry || {};
  return { jobs: Math.floor(n(x.jobs)), pot: n(x.pot), players, carry: { attention: clamp(Math.floor(n(c.attention)), 0, 5), budget: n(c.budget) || JOBS.varga.budget } };
}

export interface CastSeat {
  role: Role;
  pid: string | null;
  name: string;
}

/** Add one finished job (a settled result after the accusations) to the evening. Pure: returns a new evening. */
export function settleEvening(prev: Evening | null, r: any, cast: CastSeat[], baseBudget = JOBS.varga.budget): Evening {
  const ev: Evening = prev ? JSON.parse(JSON.stringify(prev)) : emptyEvening();
  const done = new Set<string>();
  for (const c of cast) {
    const fin = (r.final as any[]).find((x) => x.role === c.role);
    const take = fin ? fin.total : 0;
    const key = c.pid ?? 'bot:' + c.role;
    let p = ev.players.find((x) => x.key === key);
    if (!p) ev.players.push((p = { key, name: c.name, role: c.role, bot: !c.pid, jobs: 0, total: 0, take: 0, caught: 0, hits: 0, misses: 0 }));
    p.name = c.name;
    p.role = c.role;
    p.bot = !c.pid;
    p.jobs++;
    p.take = take;
    p.total += take;
    if (r.status[c.role] === 'caught') p.caught++;
    for (const a of r.accusations as any[]) if (a.from === c.role && a.to) a.correct ? p.hits++ : p.misses++;
    done.add(key);
  }
  for (const p of ev.players) if (!done.has(p.key)) p.take = 0; // not at this job's table
  ev.jobs++;
  ev.pot += r.net;
  ev.carry = carryOver(r.attention, r.net, r.success, baseBudget);
  ev.players.sort((a, b) => b.total - a.total);
  return ev;
}

// ---------------------------------------------------------------------------
// Suspicion: after the job, before the reveal
// ---------------------------------------------------------------------------

function suspicion(S: Game, role: Role) {
  const own = S.offers.filter((o) => o.state === 'accepted' && o.role === role);
  if (!own.length) return 0.05;
  const tr = own.reduce((a, o) => a + (o.traces || 0), 0);
  return Math.min(0.6, 0.02 + 0.06 * own.length * own.length + 0.03 * Math.min(tr, 6));
}

/** choices: what each human seat said (role, 'pass' or missing). Bot seats decide themselves. */
export function accuse(S: Game, choices: Partial<Record<Role, string>> | string = {}) {
  if (typeof choices === 'string') choices = { [S.humans[0]]: choices };
  const r = S.result,
    rng = S.orng;
  const acc = S.offers.filter((o) => o.state === 'accepted');
  const list: { from: Role; to: Role | null; correct?: boolean; amount?: number }[] = [];
  for (const from of ROLE_ORDER) {
    let to: Role | null = null;
    if (S.humans.indexOf(from) >= 0) {
      const c = choices[from];
      to = c && c !== 'pass' && c !== from && ROLE_ORDER.indexOf(c as Role) >= 0 ? (c as Role) : null;
    } else {
      let best: Role | null = null,
        bp = 0;
      for (const x of ROLE_ORDER)
        if (x !== from) {
          const p = suspicion(S, x);
          if (p > bp || (p === bp && rng() < 0.5)) {
            bp = p;
            best = x;
          }
        }
      if (rng() < bp) to = best;
    }
    list.push({ from, to });
  }
  const total = {} as Record<Role, number>;
  r.indiv.forEach((x: any) => {
    total[x.role as Role] = x.total;
  });
  const giveOthers = (amount: number, except: Role[]) => {
    const o = ROLE_ORDER.filter((x) => except.indexOf(x) < 0);
    o.forEach((x) => {
      total[x] += amount / o.length;
    });
  };
  const reclaimed: Partial<Record<Role, number>> = {};
  for (const a of list) {
    if (!a.to) continue;
    const own = acc.filter((o) => o.role === a.to);
    a.correct = own.length > 0;
    if (a.correct) {
      if (!reclaimed[a.to]) {
        const back = own.reduce((t, o) => t + (o.bonus || NONCASH_FINE), 0);
        reclaimed[a.to] = back;
        total[a.to] -= back;
        giveOthers(back, [a.to]);
        own.forEach((o) => {
          o.reclaimed = true;
        });
      }
      total[a.from] += ACCUSE_BONUS;
      giveOthers(-ACCUSE_BONUS, [a.from, a.to]);
      a.amount = reclaimed[a.to];
    } else {
      total[a.from] -= ACCUSE_FINE;
      giveOthers(ACCUSE_FINE, [a.from]);
    }
  }
  const before = {} as Record<Role, number>;
  r.indiv.forEach((x: any) => {
    before[x.role as Role] = x.rank;
  });
  const fin = ROLE_ORDER.map((role) => ({ role, total: Math.round(total[role]), status: r.status[role] as Status, before: before[role], rank: 0 })).sort((a, b) => b.total - a.total);
  fin.forEach((x, i) => {
    x.rank = i + 1;
  });
  r.accusations = list.map((a) => ({ from: a.from, to: a.to, correct: !!a.correct, amount: a.amount || 0 }));
  r.final = fin;
  r.offers.forEach((o: any) => {
    const so = S.offers.find((x) => x.id === o.id && x.role === o.role);
    o.reclaimed = !!(so && so.reclaimed);
  });
  return r;
}

// ---------------------------------------------------------------------------
// Bots (from the prototype's sim.js: the careful, informed planner)
// ---------------------------------------------------------------------------

export const BOT_SCOUTS = ['parkhaus', 'hausmeister', 'lagerist'];

/** Tools and layout an informed, careful crew would choose from what it knows. Does not change S. */
export function informedPlan(S: Game, style: { slack: number; greedy?: boolean; drillElek?: boolean; car?: boolean } = { slack: 0 }) {
  const K = (k: FactKey) => (S.known[k] ? S.known[k]!.v : null);
  const al = K('alarm'),
    gd = K('guard'),
    sf = K('safe'),
    lt = K('loot') as TargetId | null,
    bl = K('blind'),
    po = K('police');
  const tools = new Set<string>();
  let entrance: EntranceId = 'liefer',
    panel = false;
  if (al === 'tuer') entrance = lt === 'lager' ? (gd === 'hund' ? 'vorder' : 'liefer') : 'dach';
  else if (bl === 'dach') entrance = 'dach';
  else if (bl === 'liefer' && gd !== 'hund') entrance = 'liefer';
  else entrance = gd === 'hund' ? 'vorder' : 'liefer';
  if (entrance === 'dach') tools.add('seil');
  if (al === 'tuer' && entrance !== 'dach') tools.add('magnet');
  if (al === 'bewegung') tools.add('schaum');
  if (al === 'still') tools.add('stoer');
  if (!al) {
    entrance = entrance === 'dach' ? 'liefer' : entrance;
    if (entrance === 'liefer') panel = true;
    else tools.add('stoer');
    tools.delete('seil');
  }
  if ((gd === 'hund' || !gd) && entrance === 'liefer') tools.add('leckerli');
  if ((gd === 'monitor' || !gd) && bl !== entrance) tools.add('schleife');
  let targets: TargetId[] = [];
  if (sf === 'elek') tools.add(style.drillElek ? 'bohrer' : 'decoder');
  if (sf === 'zeit' || !sf) {
    if (lt === 'tresor' || style.greedy || !sf) tools.add('bohrer');
  }
  if (lt) targets.push(lt);
  for (const t of (style.greedy ? ['tresor', 'lager', 'vitrinen'] : ['tresor', 'vitrinen']) as TargetId[]) if (targets.indexOf(t) < 0) targets.push(t);
  if (sf === 'zeit' && !tools.has('bohrer')) targets = targets.filter((t) => t !== 'tresor');
  if (!po) tools.add('scanner');
  if (style.car) tools.add('zweitwagen');
  const hTools = ['magnet', 'schaum', 'bohrer'].some((t) => tools.has(t));
  const posts: Record<Role, Post> = { brain: 'inside', bait: 'inside', hands: hTools ? 'inside' : 'driver', gambler: hTools ? 'driver' : 'lookout' };
  if (targets.indexOf('lager') >= 0 && !hTools) posts.gambler = 'inside';
  if (tools.has('schleife') && !Object.values(posts).includes('lookout')) tools.delete('schleife');
  const prio = ['seil', 'magnet', 'schaum', 'stoer', 'bohrer', 'decoder', 'leckerli', 'schleife', 'scanner', 'zweitwagen'];
  const list = prio.filter((t) => tools.has(t));
  while (!canAfford(S, list)) list.pop();
  return { tools: list, entrance, panel, posts, targets };
}

/** Lay out the plan with the tools already bought (second half of informedPlan). */
export function informedLayout(S: Game, style: { slack: number; greedy?: boolean } = { slack: 0 }): PlanSel {
  const saved = S.tools;
  const p = informedPlan({ ...S, tools: [], budget: S.budget + toolsCost(S, saved) } as Game, style);
  const plan: PlanSel = { entrance: p.entrance, panel: p.panel, posts: p.posts, targets: p.targets.slice() };
  const scratch = { ...S, plan } as Game;
  if (plan.entrance === 'dach' && saved.indexOf('seil') < 0) plan.entrance = 'liefer';
  const gd = S.known.guard ? S.known.guard.v : null;
  const w = gd ? windowFor(S, gd) : windowFor(S, 'rundgang');
  while (plan.targets.length > 1 && estimateTime(scratch)[1] > w + style.slack) plan.targets.pop();
  const sf = S.known.safe ? S.known.safe.v : null;
  if (plan.targets.indexOf('tresor') >= 0 && sf === 'mech' && saved.indexOf('bohrer') < 0 && plan.posts.brain !== 'inside') plan.posts.brain = 'inside';
  if (validatePlan(scratch).length) {
    plan.panel = false;
    if (validatePlan(scratch).length) plan.entrance = 'liefer';
  }
  return plan;
}

/** The careful decision bot from sim.js. Also the default when a decider's timer runs out. */
export function carefulChoice(S: Game, d: Decision, pushMax = 8, bold = false): string {
  const ids = d.options.map((o) => o.id),
    get = (id: string) => d.options.find((o) => o.id === id)!;
  if (d.push) {
    const c = d.options.filter((o) => o.id !== 'leave' && o.pct <= pushMax).sort((a, b) => (b.dt || 0) - (a.dt || 0));
    return c.length ? c[0].id : 'leave';
  }
  if (ids.includes('pick')) return get('pick').pct >= 75 ? 'pick' : 'crow';
  if (ids.includes('fast')) return bold ? 'fast' : 'slow';
  if (ids.includes('koeder')) return get('koeder').pct >= 60 ? 'koeder' : ids.includes('roof') ? 'roof' : 'koeder';
  if (ids.includes('stay')) return get('stay').pct >= (bold ? 50 : 90) ? 'stay' : 'go';
  if (ids.includes('quiet')) {
    const w = S.run.windowEnd - S.run.t;
    return w >= 8 ? 'quiet' : 'drill';
  }
  return d.options.slice().sort((a, b) => b.pct - a.pct)[0].id;
}

// ---------------------------------------------------------------------------
// The step machine (host side)
// ---------------------------------------------------------------------------

export type Phase = 'stake' | 'brief' | 'scout' | 'facts' | 'offer' | 'shop' | 'plan' | 'run' | 'accuse' | 'debrief';
export const PHASES: Phase[] = ['stake', 'brief', 'scout', 'facts', 'offer', 'shop', 'plan', 'run', 'accuse', 'debrief'];

export interface Seat {
  role: Role;
  /** Player id of the human in this seat, or null for a bot. */
  pid: string | null;
  name: string;
}
export interface Times {
  stake: number;
  brief: number;
  board: number;
  facts: number;
  offer: number;
  decide: number;
  accuse: number;
  beat: number;
  bot: number;
  /** first-person job: how long a player has for a skill check before the dice decide */
  skill: number;
  /** first-person job: how long a beat waits for the inside crew to reach its place */
  gate: number;
}
export const TIMES: Times = { stake: 60000, brief: 90000, board: 180000, facts: 60000, offer: 30000, decide: 25000, accuse: 30000, beat: 2600, bot: 2200, skill: 90000, gate: 45000 };

export type Action =
  | { t: 'stake'; id: string }
  | { t: 'confirm' }
  | { t: 'scout'; id: string }
  | { t: 'tool'; id: string }
  | { t: 'ent'; id: string }
  | { t: 'tgt'; id: string }
  | { t: 'up'; i: number }
  | { t: 'panel'; on: boolean }
  | { t: 'post'; role: string; post: string }
  | { t: 'choose'; id: string }
  | { t: 'offer'; answer: string }
  | { t: 'accuse'; target: string }
  | ({ t: 'skill' } & SkillAnswer);

/** A message for one seat only (the host forwards it to that player). */
export interface PrivateView {
  role: Role;
  offer: null | { id: OfferId; when: 'pre' | 'mid'; need: OfferDef['need']; targets: Role[]; deadline: number; answered: boolean };
  tip: null | { k: FactKey; v: string };
  accuse: null | { choice: string | null; deadline: number };
  /** A skill check that only I play (first-person job): the SkillRequest plus where and until when. */
  skill: null | { n: number; game: string; variant: string; difficulty: 1 | 2 | 3; seed: number; tools: string[]; timeLimit: number; at: string; deadline: number };
  /** My own answers so far (only ever sent to me). */
  mine: { id: OfferId; when: 'pre' | 'mid'; state: string; target: Role | null; partner: Role | null }[];
}

export interface MachineOpts {
  seed: number;
  factSeed?: number;
  seats: Seat[];
  times?: Partial<Times>;
  attention?: number;
  budget?: number;
  /** The evening so far (before this job). Its carry-over is the start attention and budget unless given explicitly. */
  evening?: Evening | null;
  /** First-person job: humans play some rolls as skill checks (see SkillStep). Default off. */
  skills?: boolean;
}

/** Where a beat is, for the first-person job (the director maps it to an anchor). */
export interface BeatRef {
  title: Txt;
  target: TargetId | null;
}

export class PlanMachine {
  S: Game;
  seats: Record<Role, Seat>;
  phase: Phase = 'stake';
  deadline = 0;
  /** Bumped on every change of the public view. */
  version = 0;
  times: Times;
  now = 0;
  board = { scout: [] as string[], tools: [] as string[] };
  private gen: Generator<Step, any, any> | null = null;
  private pending: Step | null = null;
  private pendingOpen = false;
  private shown = 0;
  private nextBeatAt = 0;
  private botAt = 0;
  private offerAnswers = new Map<Role, string>();
  private offerWhen: 'pre' | 'mid' = 'pre';
  private accusations = new Map<Role, string>();
  private botsActed = new Set<string>();
  private pubCache: any = null;
  /** counts skill checks, so a client can tell a new request from a repeated one */
  private skillN = 0;
  /**
   * First-person job (set by the host's job director): may beat `i` be shown now? False holds the job until
   * it returns true or `times.gate` ran out (scares never soft-lock). Null: no waiting (the planning table).
   */
  gate: ((b: BeatRef, i: number) => boolean) | null = null;
  private gating = -1;
  private gateSince = 0;
  /** The evening before this job, and (from the debrief on) including it. */
  evening0: Evening | null;
  evening: Evening | null;
  /** The crew ended the evening at this debrief: the final ranking is shown. */
  ended = false;
  /** who sat where when the job began (a human who leaves keeps his take) */
  private cast: CastSeat[];

  constructor(o: MachineOpts, now = 0) {
    this.evening0 = o.evening ?? null;
    this.evening = this.evening0;
    this.times = { ...TIMES, ...(o.times || {}) };
    this.now = now;
    this.seats = {} as Record<Role, Seat>;
    for (const r of ROLE_ORDER) this.seats[r] = o.seats.find((s) => s.role === r) ?? { role: r, pid: null, name: r };
    this.cast = ROLE_ORDER.map((r) => ({ role: r, pid: this.seats[r].pid, name: this.seats[r].name }));
    const humans = ROLE_ORDER.filter((r) => this.seats[r].pid);
    this.S = newGame({
      factSeed: o.factSeed ?? o.seed * 13 + 5,
      runSeed: o.seed,
      humans,
      names: Object.fromEntries(ROLE_ORDER.map((r) => [r, this.seats[r].name])),
      attention: o.attention ?? o.evening?.carry.attention,
      budget: o.budget ?? o.evening?.carry.budget,
      privateTips: true,
      skills: !!o.skills,
    });
    this.enter('stake');
  }

  isHuman(r: Role) {
    return !!this.seats[r].pid;
  }
  roleOf(pid: string): Role | null {
    return ROLE_ORDER.find((r) => this.seats[r].pid === pid) ?? null;
  }
  /** A player left (pid null: a bot takes the seat) or came back. */
  setSeat(role: Role, pid: string | null, name?: string) {
    this.seats[role] = { ...this.seats[role], pid };
    if (pid) this.cast[ROLE_ORDER.indexOf(role)] = { role, pid, name: name ?? this.cast[ROLE_ORDER.indexOf(role)].name };
    this.touch();
    this.scheduleBot();
  }
  running() {
    return this.phase !== 'debrief';
  }

  /** Who decides the current step, by role (null: everyone, or nobody). */
  decider(): Role | null {
    switch (this.phase) {
      case 'stake':
        return 'gambler';
      case 'brief':
      case 'scout':
      case 'facts':
      case 'shop':
      case 'plan':
        return 'brain';
      case 'run':
        return this.pending && this.pending.kind === 'decide' && this.pendingOpen ? this.pending.who : null;
      default:
        return null;
    }
  }

  private touch() {
    this.version++;
    this.pubCache = null;
  }

  private enter(p: Phase) {
    this.phase = p;
    const T0 = this.times;
    const dur: Partial<Record<Phase, number>> = { stake: T0.stake, brief: T0.brief, scout: T0.board, facts: T0.facts, offer: T0.offer, shop: T0.board, plan: T0.board, accuse: T0.accuse };
    this.deadline = dur[p] ? this.now + dur[p]! : 0;
    if (p === 'offer') this.offerAnswers.clear();
    if (p === 'run') this.startRun();
    this.touch();
    this.scheduleBot();
  }

  /** When does a bot act on the current step (if a bot is involved)? */
  private scheduleBot() {
    this.botAt = this.now + this.times.bot;
  }

  // -------------------------------------------------------------- actions

  act(role: Role | null, a: Action, now = this.now): boolean {
    this.now = Math.max(this.now, now);
    if (!role || !a || typeof a !== 'object') return false;
    const human = this.isHuman(role);
    if (!human) return false;
    const ok = this.apply(role, a);
    if (ok) this.touch();
    return ok;
  }

  private apply(role: Role, a: Action): boolean {
    const S = this.S,
      J = S.job;
    const brain = role === 'brain';
    switch (this.phase) {
      case 'stake':
        if (role !== 'gambler') return false;
        if (a.t === 'stake' && a.id in STAKES) {
          S.stake = a.id as StakeId;
          return true;
        }
        if (a.t === 'confirm') return this.next();
        return false;
      case 'brief':
      case 'facts':
        if (a.t === 'confirm' && brain) return this.next();
        return false;
      case 'scout':
        if (a.t === 'scout' && J.scouts.some((x) => x.id === a.id)) {
          const sel = this.board.scout,
            i = sel.indexOf(a.id);
          if (i >= 0) sel.splice(i, 1);
          else if (sel.length < J.scoutCount) sel.push(a.id);
          else return false;
          return true;
        }
        if (a.t === 'confirm' && brain && this.board.scout.length === J.scoutCount) return this.next();
        return false;
      case 'offer': {
        if (a.t !== 'offer') return false;
        const o = this.openOfferOf(role);
        if (!o || this.offerAnswers.has(role)) return false;
        this.offerAnswers.set(role, this.cleanAnswer(o, String(a.answer)));
        if (this.offerHumans().every((r) => this.offerAnswers.has(r))) this.closeOffers();
        return true;
      }
      case 'shop':
        if (a.t === 'tool' && J.tools.some((x) => x.id === a.id)) {
          const sel = this.board.tools,
            i = sel.indexOf(a.id);
          if (i >= 0) sel.splice(i, 1);
          else if (toolsCost(S, sel) + toolById(S, a.id).price <= S.budget) sel.push(a.id);
          else return false;
          return true;
        }
        if (a.t === 'confirm' && brain) return this.next();
        return false;
      case 'plan': {
        const P = S.plan;
        if (a.t === 'ent' && a.id in J.entrances) {
          const e = J.entrances[a.id as EntranceId];
          if (e.needs && !has(S, e.needs)) return false;
          P.entrance = a.id as EntranceId;
          if (!(P.entrance === 'liefer' && P.posts.brain === 'inside')) P.panel = false;
          return true;
        }
        if (a.t === 'tgt' && a.id in J.targets) {
          const i = P.targets.indexOf(a.id as TargetId);
          if (i >= 0) P.targets.splice(i, 1);
          else P.targets.push(a.id as TargetId);
          return true;
        }
        if (a.t === 'up') {
          const i = Math.floor(Number(a.i));
          if (!(i > 0 && i < P.targets.length)) return false;
          [P.targets[i - 1], P.targets[i]] = [P.targets[i], P.targets[i - 1]];
          return true;
        }
        if (a.t === 'panel') {
          const ok = P.entrance === 'liefer' && P.posts.brain === 'inside';
          if (a.on && !ok) return false;
          P.panel = !!a.on;
          return true;
        }
        if (a.t === 'post') {
          const r = a.role as Role;
          if (ROLE_ORDER.indexOf(r) < 0 || POSTS.indexOf(a.post as Post) < 0) return false;
          // everyone sets his own post; the Wortführer also sets the bots'
          if (!(r === role || (brain && !this.isHuman(r)))) return false;
          if (a.post === 'driver') for (const x of ROLE_ORDER) if (P.posts[x] === 'driver') P.posts[x] = 'lookout';
          P.posts[r] = a.post as Post;
          if (!(P.entrance === 'liefer' && P.posts.brain === 'inside')) P.panel = false;
          return true;
        }
        if (a.t === 'confirm' && brain && validatePlan(S).length === 0) return this.next();
        return false;
      }
      case 'run': {
        const d = this.pending;
        if (a.t === 'choose' && d && d.kind === 'decide' && this.pendingOpen && d.who === role) {
          if (!d.options.some((o) => o.id === a.id)) return false;
          this.resolveDecision(String(a.id));
          return true;
        }
        if (a.t === 'skill' && d && d.kind === 'skill' && this.pendingOpen && d.role === role) {
          this.advance(a);
          return true;
        }
        if (a.t === 'offer' && d && d.kind === 'offers' && this.phase === 'run') return false;
        return false;
      }
      case 'accuse': {
        if (a.t !== 'accuse' || this.accusations.has(role)) return false;
        const tgt = String(a.target);
        if (tgt !== 'pass' && (ROLE_ORDER.indexOf(tgt as Role) < 0 || tgt === role)) return false;
        this.accusations.set(role, tgt);
        if (ROLE_ORDER.filter((r) => this.isHuman(r)).every((r) => this.accusations.has(r))) this.finishAccuse();
        return true;
      }
    }
    return false;
  }

  private cleanAnswer(o: Offer, ans: string): string {
    const parts = ans.split(':');
    if (parts[0] !== 'accept') return 'decline';
    const d = offerDef(o.id),
      others = offerTargets(this.S, o.role);
    const t = parts[1] as Role,
      p = parts[2] as Role;
    if (d.need && others.indexOf(t) < 0) return 'decline';
    if (d.need === 'two' && (others.indexOf(p) < 0 || p === t)) return 'decline';
    return 'accept' + (d.need ? ':' + t : '') + (d.need === 'two' ? ':' + p : '');
  }

  /** Leave the current phase (confirm or timer). */
  private next(): boolean {
    const S = this.S;
    switch (this.phase) {
      case 'stake':
        this.enter('brief');
        return true;
      case 'brief':
        this.enter('scout');
        return true;
      case 'scout': {
        const sel = this.board.scout;
        for (const id of [...BOT_SCOUTS, ...S.job.scouts.map((x) => x.id)]) if (sel.length < S.job.scoutCount && sel.indexOf(id) < 0) sel.push(id);
        doScout(S, sel);
        this.enter('facts');
        return true;
      }
      case 'facts':
        this.offerWhen = 'pre';
        if (this.offerHumans().length) this.enter('offer');
        else {
          botDecide(S, 'pre');
          this.enter('shop');
        }
        return true;
      case 'shop': {
        const sel = this.board.tools.slice();
        while (!canAfford(S, sel)) sel.pop();
        buy(S, sel);
        if (S.plan.entrance === 'dach' && !has(S, 'seil')) S.plan.entrance = 'liefer';
        this.enter('plan');
        return true;
      }
      case 'plan':
        this.fixPlan();
        this.enter('run');
        return true;
    }
    return false;
  }

  /** Make an invalid plan valid when the timer locks it. */
  private fixPlan() {
    const S = this.S,
      P = S.plan;
    if (!P.targets.length) P.targets.push('tresor');
    if (P.entrance === 'dach' && !has(S, 'seil')) P.entrance = 'liefer';
    if (P.panel && !(P.entrance === 'liefer' && P.posts.brain === 'inside')) P.panel = false;
    let seen = false;
    for (const r of ROLE_ORDER)
      if (P.posts[r] === 'driver') {
        if (seen) P.posts[r] = 'lookout';
        seen = true;
      }
    if (!ROLE_ORDER.some((r) => P.posts[r] === 'inside')) P.posts.brain = 'inside';
  }

  // -------------------------------------------------------------- offers

  /** Humans who get an offer now: every human still free (pre: all humans). */
  private offerHumans(): Role[] {
    if (this.offerWhen === 'pre') return this.S.offers.filter((o) => o.human && o.when === 'pre' && o.state === 'open').map((o) => o.role);
    const p = this.pending;
    return p && p.kind === 'offers' ? p.roles : [];
  }
  private openOfferOf(role: Role): Offer | null {
    if (this.offerHumans().indexOf(role) < 0) return null;
    return this.S.offers.find((o) => o.human && o.role === role && o.when === this.offerWhen && o.state === 'open') || null;
  }
  /** Apply all answers at once, in seat order: nothing changes while players are still deciding. */
  private closeOffers() {
    const S = this.S;
    if (this.offerWhen === 'pre') {
      for (const r of ROLE_ORDER) {
        const o = this.openOfferOf(r);
        if (o) answerOffer(S, o, this.offerAnswers.get(r) || 'decline');
      }
      botDecide(S, 'pre');
      this.enter('shop');
    } else {
      const ans = Object.fromEntries(this.offerAnswers);
      this.phase = 'run';
      this.deadline = 0;
      this.advance(ans);
    }
  }

  // -------------------------------------------------------------- the job

  private startRun() {
    this.gen = runJob(this.S);
    this.shown = 0;
    this.nextBeatAt = this.now;
    this.advance(undefined);
  }

  private advance(value: any) {
    const x = this.gen!.next(value);
    this.pendingOpen = false;
    if (x.done) {
      this.pending = null;
    } else {
      this.pending = x.value;
    }
    this.touch();
  }

  private resolveDecision(id: string) {
    this.advance(id);
  }

  private openPending() {
    const p = this.pending;
    if (!p || this.pendingOpen) return;
    this.pendingOpen = true;
    if (p.kind === 'skill') {
      if (!this.isHuman(p.role)) {
        // a bot (or a player who left) cannot play it: the dice decide at once
        this.advance(null);
        return;
      }
      this.skillN++;
      this.deadline = this.now + this.times.skill;
    } else if (p.kind === 'decide') {
      this.deadline = this.now + this.times.decide;
      this.scheduleBot();
    } else {
      // secret offers in the middle: a sub-phase of the job
      this.offerWhen = 'mid';
      this.offerAnswers.clear();
      this.phase = 'offer';
      this.deadline = this.now + this.times.offer;
    }
    this.touch();
  }

  private finishRun() {
    this.enter('accuse');
  }

  private finishAccuse() {
    const choices: Partial<Record<Role, string>> = {};
    for (const r of ROLE_ORDER) if (this.isHuman(r)) choices[r] = this.accusations.get(r) || 'pass';
    // seats whose human left during the job count as "pass"
    const S = this.S;
    for (const r of S.humans) if (!(r in choices)) choices[r] = 'pass';
    accuse(S, choices);
    this.evening = settleEvening(this.evening0, S.result, this.cast, S.job.budget);
    this.enter('debrief');
  }

  // -------------------------------------------------------------- clock

  /** Advance the clock: timers, beats, bots. Returns true if anything changed. */
  tick(now: number): boolean {
    this.now = Math.max(this.now, now);
    const v = this.version;
    for (let guard = 0; guard < 50; guard++) {
      const before = this.version;
      this.step();
      if (this.version === before) break;
    }
    return this.version !== v;
  }

  private step() {
    const now = this.now,
      S = this.S;
    const timeUp = this.deadline > 0 && now >= this.deadline;
    const botTime = now >= this.botAt;
    switch (this.phase) {
      case 'stake':
        if (timeUp) this.next();
        else if (!this.isHuman('gambler') && botTime) {
          S.stake = 'sicher';
          this.next();
        }
        return;
      case 'brief':
      case 'facts':
        if (timeUp || (!this.isHuman('brain') && botTime)) this.next();
        return;
      case 'scout':
        if (!timeUp && !this.isHuman('brain') && botTime) {
          this.board.scout = this.board.scout.filter((x) => BOT_SCOUTS.indexOf(x) >= 0);
        }
        if (timeUp || (!this.isHuman('brain') && botTime)) this.next();
        return;
      case 'shop':
        if (!timeUp && !this.isHuman('brain') && botTime) this.board.tools = informedPlan(S).tools;
        if (timeUp || (!this.isHuman('brain') && botTime)) this.next();
        return;
      case 'plan':
        if (!timeUp && !this.isHuman('brain') && botTime) {
          const keep = { ...S.plan.posts };
          S.plan = informedLayout(S);
          // humans keep their own posts
          for (const r of ROLE_ORDER) if (this.isHuman(r)) S.plan.posts[r] = keep[r];
        }
        if (timeUp || (!this.isHuman('brain') && botTime)) this.next();
        return;
      case 'offer':
        if (timeUp || this.offerHumans().every((r) => this.offerAnswers.has(r) || !this.isHuman(r))) this.closeOffers();
        return;
      case 'run': {
        const beats = S.run ? S.run.beats.length : 0;
        if (this.shown < beats) {
          if (now >= this.nextBeatAt) {
            const b = S.run.beats[this.shown];
            if (this.gate && !this.gate({ title: b.title, target: b.target ?? null }, this.shown)) {
              if (this.gating !== this.shown) {
                this.gating = this.shown;
                this.gateSince = now;
                this.touch();
              }
              if (now < this.gateSince + this.times.gate) return;
            }
            if (this.gating >= 0) this.gating = -1;
            this.shown++;
            this.nextBeatAt = now + this.times.beat;
            this.touch();
          }
          return;
        }
        if (now < this.nextBeatAt) return;
        const p = this.pending;
        if (!p) {
          this.finishRun();
          return;
        }
        if (!this.pendingOpen) {
          this.openPending();
          return;
        }
        if (p.kind === 'decide') {
          if (timeUp || (!this.isHuman(p.who) && botTime)) this.resolveDecision(carefulChoice(S, p));
        } else if (p.kind === 'skill') {
          // no answer in time, or the player left: the dice decide
          if (timeUp || !this.isHuman(p.role)) this.advance(null);
        }
        return;
      }
      case 'accuse':
        if (timeUp || ROLE_ORDER.filter((r) => this.isHuman(r)).every((r) => this.accusations.has(r))) this.finishAccuse();
        return;
    }
  }

  // -------------------------------------------------------------- views

  /** Everything all players may see. Never contains hidden facts or anyone's offers before the debrief. */
  pub() {
    if (this.pubCache) return this.pubCache;
    const S = this.S,
      R = S.run;
    const known: Record<string, { v: string; rumour: boolean }> = {};
    for (const k of S.job.factOrder) if (S.known[k]) known[k] = { v: S.known[k]!.v, rumour: S.known[k]!.rumour };
    const pre = ['stake', 'brief', 'scout', 'facts', 'offer', 'shop', 'plan'].indexOf(this.phase) >= 0 && !(this.phase === 'offer' && this.offerWhen === 'mid');
    const v: any = {
      v: this.version,
      phase: this.phase,
      mid: this.phase === 'offer' && this.offerWhen === 'mid',
      deadline: this.deadline,
      decider: this.decider(),
      seats: ROLE_ORDER.map((r) => ({ role: r, pid: this.seats[r].pid, name: this.seats[r].name, bot: !this.seats[r].pid })),
      stake: S.stake,
      attention0: S.attention0,
      attention: S.attention,
      budget: S.budget,
      spent: S.spent,
      known,
      scouted: S.scouted.slice(),
      tools: S.tools.slice(),
      board: { scout: this.board.scout.slice(), tools: this.board.tools.slice() },
      plan: { entrance: S.plan.entrance, posts: { ...S.plan.posts }, targets: S.plan.targets.slice(), panel: S.plan.panel },
      preTraces: (S.preTraces || []).slice(),
      summary: pre ? planSummary(S) : null,
      evening: this.evening,
      ended: this.ended,
      overview: pre ? overview(S, this.phase === 'shop' ? this.board.tools : S.tools, this.phase === 'plan') : null,
    };
    if (R) {
      const d = this.pending && this.pending.kind === 'decide' && this.pendingOpen ? this.pending : null;
      v.run = {
        t: R.t,
        noise: R.noise,
        windowEnd: R.windowEnd,
        alarmKnown: R.alarm === 'triggered' && R.crewKnows,
        status: { ...R.status },
        doneTargets: R.doneTargets.slice(),
        shown: this.shown,
        beats: R.beats.slice(0, this.shown).map((b: Beat) => ({ title: b.title, target: b.target ?? null, t0: b.t0, lines: b.lines.slice() })),
        decision: d
          ? {
              who: d.who,
              title: d.title,
              text: d.text,
              details: d.details ?? null,
              push: !!d.push,
              bot: !this.isHuman(d.who),
              options: d.options.map((o) => ({ id: o.id, label: o.label, text: o.text, pct: o.pct, pctLabel: o.pctLabel, tags: o.tags, details: o.details })),
            }
          : null,
        entrance: S.plan.entrance,
        // first-person job: who is at the lock / safe right now (no request details, no hidden facts)
        skill: this.pending && this.pending.kind === 'skill' && this.pendingOpen ? { who: this.pending.role, game: this.pending.game, at: this.pending.at } : null,
        // first-person job: the next beat waits for the inside crew to reach its place
        waitAt: this.gating >= 0 && this.gating < R.beats.length ? { i: this.gating, title: R.beats[this.gating].title, target: R.beats[this.gating].target ?? null, until: this.gateSince + this.times.gate } : null,
      };
    }
    if (this.phase === 'accuse' || this.phase === 'debrief') v.traces = S.result.traces.slice();
    if (this.phase === 'debrief') {
      const r = S.result;
      v.result = { ...r, offers: r.offers.filter((o: any) => true), facts: { ...S.facts } };
      v.result.knownAtEnd = known;
    }
    this.pubCache = JSON.parse(JSON.stringify(v));
    return this.pubCache;
  }

  /** Debrief: the crew calls the evening over (the final ranking shows on every page). */
  endEvening(): boolean {
    if (this.phase !== 'debrief' || this.ended) return false;
    this.ended = true;
    this.touch();
    return true;
  }

  /** What only `role` may see. */
  priv(role: Role): PrivateView {
    const S = this.S;
    const o = this.phase === 'offer' ? this.openOfferOf(role) : null;
    const d = o ? offerDef(o.id) : null;
    const tip = S.tips[role];
    return {
      role,
      offer:
        o && d
          ? { id: o.id, when: o.when, need: d.need, targets: offerTargets(S, role), deadline: this.deadline, answered: this.offerAnswers.has(role) }
          : null,
      tip: tip && this.phase !== 'debrief' ? { k: tip.k, v: tip.v } : null,
      accuse: this.phase === 'accuse' ? { choice: this.accusations.get(role) ?? null, deadline: this.deadline } : null,
      skill: this.skillOf(role),
      mine: S.offers.filter((x) => x.role === role && x.human && x.state !== 'open').map((x) => ({ id: x.id, when: x.when, state: x.state, target: x.target ?? null, partner: x.partner ?? null })),
    };
  }

  /**
   * First-person job: a guard of the stage spotted the crew and raised the alarm. Treated like the monitor
   * room seeing the crew at the door: the guard window closes within 2 job minutes (afterAction then runs
   * the usual guard encounter). Once per job, during the run only; returns true if it applied.
   */
  guardAlert(): boolean {
    const R = this.S.run;
    if (!(this.phase === 'run' || (this.phase === 'offer' && this.offerWhen === 'mid'))) return false;
    if (!R || R.done || R.out || R.guardAlert) return false;
    R.guardAlert = true;
    R.windowEnd = Math.min(R.windowEnd, R.t + 2);
    const b = R.beats[R.beats.length - 1];
    if (b) b.lines.push({ kind: 'bad', x: T('ln.guardAlert') });
    (R.impacts.guard = R.impacts.guard || []).push(T('im.guardAlert'));
    this.touch();
    return true;
  }

  private skillOf(role: Role): PrivateView['skill'] {
    const p = this.pending;
    if (this.phase !== 'run' || !p || p.kind !== 'skill' || !this.pendingOpen || p.role !== role) return null;
    return { n: this.skillN, game: p.game, variant: p.variant, difficulty: p.difficulty, seed: p.seed, tools: p.tools.slice(), timeLimit: Math.round(this.times.skill / 1000), at: p.at, deadline: this.deadline };
  }

  /** Compact result for the campaign save. */
  summaryForSave() {
    const r = this.S.result;
    if (!r) return null;
    const stars = r.grade[0] === 'A' ? 3 : r.grade[0] === 'B' || r.grade[0] === 'C' ? 2 : r.grade[0] === 'D' ? 1 : 0;
    return { stars, net: r.net as number };
  }
}
