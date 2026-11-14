// Session glue for the planning round. The host runs a PlanMachine (logic.ts):
// it replicates `machine.pub()` as state 'plan' and sends each human his
// `machine.priv(role)` with session.sendTo (nobody else receives it). Players
// answer with the intent 'plan.act', which only the host sees.
import type { Session } from '../../net/session';
import { loadCampaign, saveCampaign } from '../../core/save';
import { roleOf, lineupRunning } from '../lineup';
import { PlanMachine, ROLE_ORDER, type Role, type Seat, type Times, type Action, type PrivateView } from './logic';

export interface PlanApi {
  /** Start a job for the crew (runs the lineup first if roles are missing). Any crew member may ask; the host decides. */
  start(): void;
  /** True from start until the debrief is reached. */
  running(): boolean;
}

const BOT_NAMES = ['Bot Kim', 'Bot Alex', 'Bot Sam'];
const ACTIONS = new Set(['stake', 'confirm', 'scout', 'tool', 'ent', 'tgt', 'up', 'panel', 'post', 'choose', 'offer', 'accuse']);

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

  attach(s: Session) {
    this.s = s;
    if (!s.isHost) return;
    s.handle('plan.start', () => this.hostStart());
    s.handle('plan.act', (pid, a) => {
      const m = this.m;
      if (!m || !a || typeof a !== 'object' || !ACTIONS.has(String(a.t))) return;
      const role = m.roleOf(pid);
      if (!role) return;
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
        if (r && !m.seats[r].pid) m.setSeat(r, joined.pid);
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
    this.job++;
    this.saved = false;
    this.privSent.clear();
    this.seatOf.clear();
    this.m = new PlanMachine({ seed, seats, times }, s.hostNow());
    s.emit('sfx', { n: 'ui' });
    this.publish();
  }

  private tick() {
    const s = this.s;
    if (!s) return;
    if (this.waitingLineup) {
      const l = s.get<any>('lineup');
      const humans = [...s.players.values()].slice(0, 4);
      if (l && l.phase === 'done' && !l.preview && humans.every((p) => roleOf(s, p.pid))) this.begin();
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

  /** Test hook: the host's machine (holds every secret; never replicated). */
  get debugMachine() {
    return this.m;
  }
}
