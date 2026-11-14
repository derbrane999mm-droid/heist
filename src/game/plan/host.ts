// Session glue for the planning round. The host runs a PlanMachine (logic.ts):
// it replicates `machine.pub()` as state 'plan' and sends each human his
// `machine.priv(role)` with session.sendTo (nobody else receives it). Players
// answer with the intent 'plan.act', which only the host sees.
import type { Session } from '../../net/session';
import { loadCampaign, saveCampaign } from '../../core/save';
import { roleOf, lineupRunning } from '../lineup';
import { PlanMachine, ROLE_ORDER, VARGA, loadEvening, type Evening, type Role, type Seat, type Times, type Action, type PrivateView } from './logic';

export interface PlanApi {
  /** Start a job for the crew (runs the lineup first if roles are missing). Any crew member may ask; the host decides. */
  start(): void;
  /** True from start until the debrief is reached. */
  running(): boolean;
  /**
   * First-person job: a level hands its stage to the job director (src/game/job/director.ts), which then
   * turns the run into a walk-through with skill checks. Without a stage the job stays at the table.
   * Returns an unregister function. Installed by main.ts; undefined where no director runs.
   */
  registerStage?(stage: import('../job/types').JobStage): () => void;
}

/** First-person options of the next job, set by the job director on the host. */
export interface FirstPerson {
  skills: boolean;
  gate: PlanMachine['gate'];
}

const BOT_NAMES = ['Bot Kim', 'Bot Alex', 'Bot Sam'];
/** Evening actions are handled here, not by the machine (they start or end a job). */
const EVENING_ACTIONS = new Set(['next', 'revote', 'end']);
/** An evening saved longer ago than this is a different evening. */
const EVENING_MAX_AGE = 10 * 3600 * 1000;
const ACTIONS = new Set(['next', 'revote', 'end', 'stake', 'confirm', 'scout', 'tool', 'ent', 'tgt', 'up', 'panel', 'post', 'choose', 'offer', 'accuse', 'skill']);

/** Replicated state at path 'plan': the machine's public view, or a waiting marker. */
export type PlanPub = ReturnType<PlanMachine['pub']> & { job: number };

export class PlanController implements PlanApi {
  private s: Session | null = null;
  private m: PlanMachine | null = null;
  private job = 0;
  private timer = 0;
  private waitingLineup = false;
  private privSent = new Map<string, string>();
  /** pid -> seat, to give a seat back when its player rejoins. */
  private seatOf = new Map<string, Role>();
  private saved = false;
  /** The evening so far (jobs finished), saved with the campaign; null before the first job or after "Abend beenden". */
  private evening: Evening | null = null;
  private eveningLoaded = false;
  /** the lineup was started again between two jobs: wait for it to show running first */
  private revoting = false;
  /** first-person job (host): skill checks and beat gate for the next job; null = at the table */
  private fp: FirstPerson | null = null;
  /** Installed by main.ts when the job director exists (see PlanApi.registerStage). */
  registerStage?: PlanApi['registerStage'];

  attach(s: Session) {
    this.s = s;
    if (!s.isHost) return;
    s.handle('plan.start', () => this.hostStart());
    s.handle('plan.act', (pid, a) => {
      const m = this.m;
      if (!m || !a || typeof a !== 'object' || !ACTIONS.has(String(a.t))) return;
      const role = m.roleOf(pid);
      if (!role) return;
      if (EVENING_ACTIONS.has(String(a.t))) return this.eveningAct(pid, role, String(a.t));
      if (m.act(role, a as Action, s.hostNow())) this.publish();
    });
    const prev = s.onRoster;
    s.onRoster = (joined, left) => {
      prev?.(joined, left);
      const m = this.m;
      if (!m) return;
      if (left) {
        const r = m.roleOf(left.pid);
        if (r) {
          this.seatOf.set(left.pid, r);
          m.setSeat(r, null); // a bot plays on
        }
        this.privSent.delete(left.pid);
      }
      if (joined) {
        const r = this.seatOf.get(joined.pid);
        if (r && !m.seats[r].pid) m.setSeat(r, joined.pid, joined.name);
        this.privSent.delete(joined.pid);
      }
      this.publish();
    };
    this.timer = window.setInterval(() => this.tick(), 200);
  }

  detach() {
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
    this.s = null;
    this.m = null;
    this.waitingLineup = false;
    this.revoting = false;
    this.privSent.clear();
    this.seatOf.clear();
  }

  start() {
    this.s?.intent('plan.start');
  }

  running(): boolean {
    const p = this.s?.get<any>('plan');
    return !!p && p.phase !== 'debrief';
  }

  // ------------------------------------------------------------------ host

  /** Wortführer (or the host, when a bot holds that seat) may lead the evening. */
  private leads(pid: string, role: Role) {
    return role === 'brain' || (!this.m?.seats.brain.pid && pid === this.s?.pid);
  }

  private eveningAct(pid: string, role: Role, t: string) {
    const s = this.s,
      m = this.m;
    if (!s || !m || m.phase !== 'debrief' || m.ended || this.waitingLineup) return;
    if (t === 'next' && this.leads(pid, role)) return this.hostStart();
    if (t === 'end' && this.leads(pid, role)) {
      if (m.endEvening()) {
        this.evening = null;
        this.eveningLoaded = true;
        const c = loadCampaign();
        delete c.evening;
        saveCampaign(c);
        this.publish();
      }
      return;
    }
    if (t === 'revote' && (this.leads(pid, role) || pid === s.pid)) {
      // the existing lineup again, then the next job starts by itself (several humans only; alone nobody has a role to vote on)
      const humans = [...s.players.values()].slice(0, 4);
      if (humans.length < 2 || lineupRunning(s)) return;
      this.waitingLineup = true;
      this.revoting = true;
      s.set('plan', { phase: 'lineup', job: this.job });
      s.intent('lineup.start');
    }
  }

  private hostStart() {
    const s = this.s;
    if (!s || !s.isHost || this.waitingLineup) return;
    if (this.m && this.m.running()) return;
    const humans = [...s.players.values()].slice(0, 4);
    if (humans.length > 1 && humans.some((p) => !roleOf(s, p.pid))) {
      // roles first: the lineup decides who is who
      this.waitingLineup = true;
      s.set('plan', { phase: 'lineup', job: this.job });
      if (!lineupRunning(s)) s.intent('lineup.start');
      return;
    }
    this.begin();
  }

  private begin() {
    const s = this.s!;
    this.waitingLineup = false;
    this.revoting = false;
    const humans = [...s.players.values()].slice(0, 4);
    const seats: Seat[] = [];
    if (humans.length === 1) seats.push({ role: 'brain', pid: humans[0].pid, name: humans[0].name });
    else for (const p of humans) {
      const r = roleOf(s, p.pid);
      if (r && !seats.some((x) => x.role === r)) seats.push({ role: r, pid: p.pid, name: p.name });
    }
    let b = 0;
    for (const r of ROLE_ORDER) if (!seats.some((x) => x.role === r)) seats.push({ role: r, pid: null, name: BOT_NAMES[b++ % BOT_NAMES.length] });
    const times: Partial<Times> = (window as any).__nvPlanTimes ?? {};
    const seed = Number((window as any).__nvPlanSeed) || Math.floor(Math.random() * 1e9) + 1;
    if (!this.eveningLoaded) {
      this.eveningLoaded = true;
      const c = loadCampaign();
      const ev = loadEvening(c.evening);
      this.evening = ev && Date.now() - (Number((c.evening as any)?.at) || 0) < EVENING_MAX_AGE ? ev : null;
    }
    this.job++;
    this.saved = false;
    this.privSent.clear();
    this.seatOf.clear();
    this.m = new PlanMachine({ seed, seats, times, skills: !!this.fp?.skills, evening: this.evening }, s.hostNow());
    this.m.gate = this.fp?.gate ?? null;
    s.emit('sfx', { n: 'ui' });
    this.publish();
  }

  private tick() {
    const s = this.s;
    if (!s) return;
    if (this.waitingLineup) {
      const l = s.get<any>('lineup');
      const humans = [...s.players.values()].slice(0, 4);
      if (this.revoting && humans.length < 2) this.begin();
      else if (this.revoting && !lineupRunning(s) && !(l && l.phase === 'done' && !l.preview && humans.every((p) => roleOf(s, p.pid)))) s.intent('lineup.start');
      else if (l && l.phase === 'done' && !l.preview && humans.every((p) => roleOf(s, p.pid))) this.begin();
      else if (humans.length === 1) this.begin();
      return;
    }
    const m = this.m;
    if (!m) return;
    if (m.tick(s.hostNow())) this.publish();
    else this.sendPrivates();
  }

  private publish() {
    const s = this.s,
      m = this.m;
    if (!s || !m) return;
    s.set('plan', { ...m.pub(), job: this.job });
    this.sendPrivates();
    if (m.phase === 'debrief' && !this.saved) {
      this.saved = true;
      const r = m.summaryForSave();
      if (r) {
        const c = loadCampaign();
        this.evening = m.evening;
        if (m.evening) c.evening = { ...m.evening, at: Date.now() };
        const prev = c.missions['plan.varga'];
        c.missions['plan.varga'] = { stars: Math.max(prev?.stars ?? 0, r.stars), best: Math.max(prev?.best ?? -Infinity, r.net) };
        saveCampaign(c);
      }
    }
  }

  /** Each human gets only his own private view, and only when it changed. */
  private sendPrivates() {
    const s = this.s,
      m = this.m;
    if (!s || !m) return;
    for (const r of ROLE_ORDER) {
      const pid = m.seats[r].pid;
      if (!pid) continue;
      const pv: PrivateView & { job: number } = { ...m.priv(r), job: this.job };
      const j = JSON.stringify(pv);
      if (this.privSent.get(pid) === j) continue;
      this.privSent.set(pid, j);
      s.sendTo(pid, 'plan.priv', pv);
    }
  }

  /**
   * DEVELOPMENT HELPER (URL `?plan=1&to=<phase>[&seed=<n>]`, see main.ts): for a solo host, start a job
   * with 60 minute phase timers and click through the preparation (through the same `plan.act` intent a
   * real click sends) until `to` is reached. Does nothing for a crew, an unknown phase or without the URL.
   */
  devJump(to: string, seed?: number) {
    const s = this.s;
    const order = ['stake', 'brief', 'scout', 'facts', 'offer', 'shop', 'plan'];
    if (!s || !s.isHost || s.players.size !== 1 || order.indexOf(to) < 0) return;
    const w = window as any;
    if (!w.__nvPlanTimes) {
      const H = 3600000;
      w.__nvPlanTimes = { stake: H, brief: H, board: H, facts: H, offer: H, decide: H, accuse: H, beat: 150, bot: 500 };
    }
    if (seed && Number.isFinite(seed)) w.__nvPlanSeed = seed;
    this.start();
    const target = order.indexOf(to);
    const t0 = Date.now();
    let acted = '';
    const stop = window.setInterval(() => {
      const ss = this.s;
      const p = ss?.get<any>('plan');
      if (!ss || !p || Date.now() - t0 > 60000 || s.players.size !== 1) return void clearInterval(stop);
      const i = order.indexOf(p.phase);
      if (p.phase === 'run' || p.phase === 'accuse' || p.phase === 'debrief' || i >= target) return void clearInterval(stop);
      if (i < 0) return;
      const key = p.job + ':' + p.phase;
      const act = (a: any) => ss.intent('plan.act', a);
      if (p.phase === 'scout') {
        if (acted !== key) {
          acted = key;
          for (const sc of VARGA.scouts.slice(0, VARGA.scoutCount)) act({ t: 'scout', id: sc.id });
        } else if (p.board.scout.length === VARGA.scoutCount && acted !== key + 'c') {
          acted = key + 'c';
          act({ t: 'confirm' });
        }
        return;
      }
      if (acted === key) return;
      if (p.phase === 'brief' || p.phase === 'facts' || p.phase === 'shop') {
        acted = key;
        act({ t: 'confirm' });
      } else if (p.phase === 'offer') {
        if (this.m?.priv('brain').offer) {
          acted = key;
          act({ t: 'offer', answer: 'decline' });
        }
      }
    }, 150);
  }

  /** Host: first-person options for jobs (null: back to the table). A running job keeps its skill setting, the gate follows at once. */
  setFirstPerson(fp: FirstPerson | null) {
    this.fp = fp;
    if (this.m) this.m.gate = fp?.gate ?? null;
  }

  /** Host: a guard of the first-person stage raised the alarm (reported by any crew member's client). */
  guardAlert(pid: string) {
    const m = this.m;
    if (!m || !m.roleOf(pid)) return;
    if (m.guardAlert()) this.publish();
  }

  /** The session this controller is attached to (job director). */
  get session() {
    return this.s;
  }

  /** Test hook: the host's machine (holds every secret; never replicated). */
  get debugMachine() {
    return this.m;
  }
}
