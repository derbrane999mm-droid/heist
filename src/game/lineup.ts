// The lineup: before the job, the crew votes each other into roles.
//
// One round per role. Everyone secretly votes for a crew member who has no
// role yet (never for themselves). Then every ballot is shown with the voter's
// name, ties are settled by the Broker, and the "winner" gets the role. The
// last role goes to whoever is left. Roles are saved with the quest.
//
// In missions a role means: only that player can do the matching task, the
// rest of the crew coaches (see `mayAct`).
import type { Session } from '../net/session';
import type { Input } from '../core/input';
import type { AudioEngine } from '../core/audio';
import { t, onLangChange } from '../core/i18n';
import { PLAYER_COLORS } from '../core/settings';
import { loadCampaign, saveCampaign } from '../core/save';
import { h, type UI } from '../ui/ui';

export type RoleId = 'brain' | 'gambler' | 'hands' | 'bait';
/** Smaller crews use the first N roles. */
export const ROLE_PRIORITY: RoleId[] = ['brain', 'gambler', 'hands', 'bait'];
export const QUESTION_VARIANTS = 4;

export interface Person {
  pid: string;
  name: string;
  color: number;
  bot?: boolean;
}

export interface LineupResult {
  role: RoleId;
  winner: string;
  votes: Record<string, string>;
  tied: string[];
  auto: boolean;
  at: number;
  end: number;
}

export interface LineupState {
  phase: 'idle' | 'vote' | 'reveal' | 'done';
  /** Solo dry run with bots: nothing is saved. */
  preview: boolean;
  people: Person[];
  order: RoleId[];
  round: number;
  q: number;
  candidates: string[];
  voted: string[];
  deadline: number;
  result: LineupResult | null;
  roles: Record<string, RoleId>;
  doneAt: number;
}

const VOTE_STEP = 550;
const REVEAL_LEAD = 900;
const ROULETTE = 2400;
const CARD = 5200;

function shuffled<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

const state = (s: Session | null): LineupState | undefined => s?.get<LineupState>('lineup');

/** Roles only count once a real lineup has finished. */
function activeRoles(s: Session | null): Record<string, RoleId> | null {
  const l = state(s);
  return l && l.phase === 'done' && !l.preview ? l.roles : null;
}

export function roleOf(s: Session | null, pid: string): RoleId | null {
  return activeRoles(s)?.[pid] ?? null;
}

/** A crew member who is in the session right now and holds `role`. */
export function holder(s: Session | null, role: RoleId): string | null {
  const roles = activeRoles(s);
  if (!roles || !s) return null;
  for (const pid of s.players.keys()) if (roles[pid] === role) return pid;
  return null;
}

/** May `pid` do a task reserved for `role`? Yes if they hold it, or if nobody present does. */
export function mayAct(s: Session | null, role: RoleId, pid?: string): boolean {
  if (!s) return false;
  const who = holder(s, role);
  return who === null || who === (pid ?? s.pid);
}

/** A crew of two or more has to do the lineup before anything else. */
export function lineupNeeded(s: Session | null): boolean {
  const l = state(s);
  return !!s && !!l && s.players.size >= 2 && (l.phase !== 'done' || l.preview);
}

export function lineupRunning(s: Session | null): boolean {
  const l = state(s);
  return !!l && (l.phase === 'vote' || l.phase === 'reveal');
}

// ---------------------------------------------------------------------------
// Host logic
// ---------------------------------------------------------------------------

export function installLineupHost(s: Session) {
  const fast = (window as any).__nvLineupFast === true; // automated tests
  const VOTE_MS = fast ? 7000 : 20000;
  const k = fast ? 0.1 : 1;
  const saved = loadCampaign().roles ?? {};
  if (!s.get('lineup')) {
    const init: LineupState = {
      phase: Object.keys(saved).length ? 'done' : 'idle',
      preview: false,
      people: [],
      order: [],
      round: 0,
      q: 0,
      candidates: [],
      voted: [],
      deadline: 0,
      result: null,
      roles: { ...saved },
      doneAt: 0,
    };
    s.set('lineup', init);
  }
  let votes = new Map<string, string>();
  const timers = new Set<number>();
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const clearTimers = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };
  const st = () => s.get<LineupState>('lineup');
  const voters = () => st().people.filter((p) => p.bot || s.players.has(p.pid));

  const persist = (roles: Record<string, RoleId>) => {
    const c = loadCampaign();
    c.roles = roles;
    saveCampaign(c);
  };

  /** Give a role-less crew member a role nobody present holds. */
  const giveLeftover = (pid: string) => {
    const cur = st();
    if (cur.phase !== 'done' || cur.preview || cur.roles[pid]) return;
    const taken = new Set<RoleId>();
    for (const p of s.players.keys()) if (cur.roles[p]) taken.add(cur.roles[p]);
    const free = ROLE_PRIORITY.find((r) => !taken.has(r));
    if (!free) return;
    const roles = { ...cur.roles };
    for (const p of Object.keys(roles)) if (roles[p] === free) delete roles[p]; // stale holder who is not here
    roles[pid] = free;
    s.set('lineup.roles', roles);
    persist(roles);
    s.emit('lineup.late', { pid, role: free });
  };

  const finish = () => {
    clearTimers();
    const cur = st();
    s.set('lineup.result', null);
    s.set('lineup.doneAt', s.hostNow());
    s.set('lineup.phase', 'done');
    if (cur.preview) {
      s.emit('say', { k: 'sub.lineupPreviewDone' });
      later(9000 * k, () => {
        // back to how things were before the dry run
        s.set('lineup.roles', { ...(loadCampaign().roles ?? {}) });
        s.set('lineup.preview', false);
        s.set('lineup.phase', Object.keys(loadCampaign().roles ?? {}).length ? 'done' : 'idle');
      });
    } else {
      persist(cur.roles);
      s.emit('say', { k: 'sub.lineupDone' });
      for (const pid of s.players.keys()) giveLeftover(pid); // anyone who joined mid-lineup
    }
  };

  const reveal = (winner: string, tied: string[], auto: boolean) => {
    const cur = st();
    const role = cur.order[cur.round];
    const n = votes.size;
    const ms = auto ? (1400 + CARD) * k : (REVEAL_LEAD + n * VOTE_STEP + 700 + (tied.length > 1 ? ROULETTE : 0) + CARD) * k;
    const now = s.hostNow();
    const result: LineupResult = { role, winner, votes: Object.fromEntries(votes), tied, auto, at: now, end: now + ms };
    s.set('lineup.result', result);
    s.set('lineup.phase', 'reveal');
    later(ms, () => {
      const c = st();
      if (c.phase !== 'reveal') return;
      if (c.candidates.includes(winner)) s.set('lineup.roles', { ...c.roles, [winner]: role });
      s.set('lineup.candidates', c.candidates.filter((p) => p !== winner));
      s.set('lineup.round', c.round + 1);
      startRound();
    });
  };

  const tally = () => {
    clearTimers();
    const cur = st();
    if (cur.phase !== 'vote') return;
    const counts = new Map<string, number>(cur.candidates.map((c) => [c, 0]));
    for (const target of votes.values()) if (counts.has(target)) counts.set(target, counts.get(target)! + 1);
    const max = Math.max(...counts.values());
    const tied = cur.candidates.filter((c) => counts.get(c) === max);
    const winner = tied[Math.floor(Math.random() * tied.length)];
    reveal(winner, tied.length > 1 ? tied : [], false);
  };

  const startRound = () => {
    clearTimers();
    const cur = st();
    if (cur.round >= cur.order.length || cur.candidates.length === 0) {
      finish();
      return;
    }
    votes = new Map();
    s.set('lineup.q', Math.floor(Math.random() * QUESTION_VARIANTS));
    s.set('lineup.voted', []);
    s.set('lineup.result', null);
    if (cur.candidates.length === 1) {
      reveal(cur.candidates[0], [], true);
      return;
    }
    s.set('lineup.deadline', s.hostNow() + VOTE_MS);
    s.set('lineup.phase', 'vote');
    later(VOTE_MS, tally);
    for (const bot of cur.people.filter((p) => p.bot)) {
      later((1200 + Math.random() * 6500) * k, () => {
        const c = st();
        if (c.phase !== 'vote') return;
        const options = c.candidates.filter((p) => p !== bot.pid);
        if (options.length) castVote(bot.pid, options[Math.floor(Math.random() * options.length)]);
      });
    }
  };

  const castVote = (pid: string, target: string) => {
    const cur = st();
    if (cur.phase !== 'vote' || votes.has(pid)) return;
    if (!cur.people.some((p) => p.pid === pid)) return;
    if (target === pid || !cur.candidates.includes(target)) return;
    votes.set(pid, target);
    s.set('lineup.voted', [...votes.keys()]);
    s.emit('sfx', { n: 'tick' });
    if (voters().every((p) => votes.has(p.pid))) {
      clearTimers();
      later(700 * k, tally);
    }
  };

  s.handle('lineup.start', (pid) => {
    if (pid !== s.pid) return; // the host runs the lineup
    const cur = st();
    if (cur.phase === 'vote' || cur.phase === 'reveal') return;
    clearTimers();
    const real: Person[] = [...s.players.values()].slice(0, 4).map((p) => ({ pid: p.pid, name: p.name, color: p.color }));
    const preview = real.length === 1;
    const people = preview
      ? [...real, ...['Kim', 'Alex', 'Sam'].map((n, i) => ({ pid: 'bot' + i, name: 'Bot ' + n, color: (real[0].color + 1 + i) % PLAYER_COLORS.length, bot: true }))]
      : real;
    s.set('lineup.preview', preview);
    s.set('lineup.people', people);
    s.set('lineup.order', shuffled(ROLE_PRIORITY.slice(0, people.length)));
    s.set('lineup.roles', {});
    s.set('lineup.candidates', people.map((p) => p.pid));
    s.set('lineup.round', 0);
    s.emit('say', { k: 'sub.lineupStart' });
    startRound();
  });

  s.handle('lineup.vote', (pid, a) => castVote(pid, String(a?.target ?? '')));

  const prev = s.onRoster;
  s.onRoster = (joined, left) => {
    prev?.(joined, left);
    const cur = st();
    if (!cur) return;
    if (joined) giveLeftover(joined.pid);
    if (left && (cur.phase === 'vote' || cur.phase === 'reveal')) {
      // someone dropped out mid-lineup: carry on without them
      votes.delete(left.pid);
      s.set('lineup.people', cur.people.filter((p) => p.pid !== left.pid));
      s.set('lineup.candidates', cur.candidates.filter((p) => p !== left.pid));
      if (cur.phase === 'vote') {
        if (st().candidates.length < 2 || voters().length < 2) startRound();
        else if (voters().every((p) => votes.has(p.pid))) tally();
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Client view
// ---------------------------------------------------------------------------

export class LineupView {
  private el: HTMLElement;
  private session: Session | null = null;
  private key = '';
  private unsub: (() => void)[] = [];
  private lastTick = -1;
  private timerFill = h('i');
  private timer = h('div', { class: 'lu-timer' }, this.timerFill);

  constructor(
    root: HTMLElement,
    private input: Input,
    private audio: AudioEngine,
    private ui: UI,
  ) {
    this.el = h('div', { class: 'lineup hidden' });
    root.append(this.el);
    onLangChange(() => (this.key = ''));
  }

  attach(s: Session) {
    this.session = s;
    this.key = '';
    this.unsub.push(
      // every crew member keeps a copy of the roles, so anyone can host next time
      s.onState((path) => {
        if (s.isHost || (path !== '' && !path.startsWith('lineup'))) return;
        const l = state(s);
        if (!l || l.phase !== 'done' || l.preview) return;
        const c = loadCampaign();
        if (JSON.stringify(c.roles) !== JSON.stringify(l.roles)) {
          c.roles = { ...l.roles };
          saveCampaign(c);
        }
      }),
      s.onEvent((name, a) => {
        if (name === 'lineup.late') {
          const p = s.players.get(a.pid);
          if (p) this.ui.toast(t('toast.lateRole', { name: p.name, role: t('role.' + a.role) }));
        }
      }),
    );
  }

  detach() {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.session = null;
    this.el.classList.add('hidden');
    this.key = '';
  }

  private person(l: LineupState, pid: string): Person {
    return l.people.find((p) => p.pid === pid) ?? { pid, name: '?', color: 0 };
  }

  /** Candidates I may vote for, in display order: the number keys follow this list. */
  private choices(l: LineupState): string[] {
    const me = this.session!.pid;
    return l.candidates.filter((p) => p !== me);
  }

  update() {
    const s = this.session;
    const l = state(s);
    if (!s || !l || l.phase === 'idle' || (l.phase === 'done' && s.hostNow() - l.doneAt > 9000)) {
      if (this.key !== 'off') {
        this.key = 'off';
        this.el.classList.add('hidden');
      }
      return;
    }
    const now = s.hostNow();
    const me = s.pid;
    const iAmIn = l.people.some((p) => p.pid === me);
    let stage = 0;

    if (l.phase === 'vote') {
      // voting: number keys
      if (iAmIn && !l.voted.includes(me)) {
        const options = this.choices(l);
        for (let i = 0; i < options.length; i++) {
          if (this.input.codePressed('Digit' + (i + 1)) || this.input.codePressed('Numpad' + (i + 1))) {
            s.intent('lineup.vote', { target: options[i] });
            this.audio.play('ui');
            break;
          }
        }
      }
      stage = Math.max(0, Math.ceil((l.deadline - now) / 1000));
      this.timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, (l.deadline - now) / 20000))})`;
      if (stage !== this.lastTick && stage <= 5 && stage > 0) this.audio.play('tick', { vol: 0.7 });
      this.lastTick = stage;
    } else if (l.phase === 'reveal' && l.result) {
      const r = l.result;
      const el = now - r.at;
      const n = Object.keys(r.votes).length;
      const scale = (r.end - r.at) / (r.auto ? 1400 + CARD : REVEAL_LEAD + n * VOTE_STEP + 700 + (r.tied.length > 1 ? ROULETTE : 0) + CARD);
      const e = el / scale; // elapsed on the normal (unscaled) timeline
      if (r.auto) stage = e < 1400 ? 0 : 1000;
      else {
        const shown = Math.max(0, Math.min(n, Math.floor((e - REVEAL_LEAD) / VOTE_STEP) + 1));
        const afterVotes = e - (REVEAL_LEAD + n * VOTE_STEP + 700);
        if (e < REVEAL_LEAD) stage = 0;
        else if (afterVotes < 0) stage = shown;
        else if (r.tied.length > 1 && afterVotes < ROULETTE) stage = 100 + Math.floor(afterVotes / 150);
        else stage = 1000;
      }
    }

    const key = [l.phase, l.round, l.voted.join(','), stage, Object.keys(l.roles).length, l.candidates.length].join('|');
    if (key === this.key) return;
    const prevStage = Number(this.key.split('|')[3] ?? -1);
    this.key = key;
    this.el.classList.remove('hidden');
    this.render(l, stage, iAmIn);
    if (l.phase === 'reveal') {
      if (stage === 1000 && prevStage !== 1000) this.audio.play('reveal');
      else if (stage >= 100 && stage < 1000) this.audio.play('tick', { vol: 0.6, rate: 1.3 });
      else if (stage > 0 && stage < 100) this.audio.play('tick');
    }
  }

  private render(l: LineupState, stage: number, iAmIn: boolean) {
    const s = this.session!;
    const me = s.pid;
    const nodes: Node[] = [];
    const dot = (color: number) => {
      const hex = '#' + PLAYER_COLORS[color % PLAYER_COLORS.length].toString(16).padStart(6, '0');
      return h('i', { class: 'lu-dot', style: `background:${hex};box-shadow:0 0 8px ${hex}` });
    };
    const head = h(
      'div',
      { class: 'lu-head' },
      h('span', { class: 'label' }, t('lineup.title')),
      l.phase !== 'done' ? h('span', { class: 'lu-round' }, t('lineup.round', { a: Math.min(l.round + 1, l.order.length), b: l.order.length })) : null,
    );
    nodes.push(head);
    if (l.preview) nodes.push(h('div', { class: 'lu-preview' }, t('lineup.preview')));

    if (l.phase === 'done') {
      nodes.push(h('div', { class: 'lu-role' }, t('lineup.done')));
      const grid = h('div', { class: 'lu-crew' });
      for (const p of l.people) {
        const role = l.roles[p.pid];
        if (!role) continue;
        grid.append(h('div', { class: 'lu-card' }, h('div', { class: 'lu-card-name' }, dot(p.color), p.name), h('div', { class: 'lu-card-role' }, t('role.' + role)), h('div', { class: 'lu-card-rule' }, t(`role.${role}.rule`))));
      }
      nodes.push(grid);
      this.el.replaceChildren(...nodes);
      return;
    }

    const role = l.order[l.round];
    nodes.push(h('div', { class: 'lu-q' }, t(`lq.${role}.${l.q}`)));
    nodes.push(h('div', { class: 'lu-becomes' }, h('span', {}, t('lineup.becomes')), h('b', {}, t('role.' + role)), h('span', { class: 'lu-rule' }, t(`role.${role}.rule`))));

    const list = h('div', { class: 'lu-list' });
    const r = l.phase === 'reveal' ? l.result : null;
    const options = this.choices(l);
    const votesIn = r ? Object.entries(r.votes) : [];
    const shownVotes = r ? (stage >= 100 ? votesIn : votesIn.slice(0, stage)) : [];
    let rouletteOn: string | null = null;
    if (r && stage >= 100 && stage < 1000 && r.tied.length > 1) rouletteOn = r.tied[(stage - 100) % r.tied.length];
    const final = !!r && stage === 1000;

    for (const pid of l.candidates) {
      const p = this.person(l, pid);
      const idx = options.indexOf(pid);
      const canVote = l.phase === 'vote' && iAmIn && !l.voted.includes(me) && idx >= 0;
      const chips = h('span', { class: 'lu-chips' });
      for (const [voter, target] of shownVotes) {
        if (target !== pid) continue;
        const v = this.person(l, voter);
        chips.append(h('span', { class: 'lu-chip' }, dot(v.color), v.name));
      }
      const cls = ['lu-row'];
      if (pid === me) cls.push('me');
      if (rouletteOn === pid) cls.push('spin');
      if (final && r!.winner === pid) cls.push('win');
      if (final && r!.winner !== pid) cls.push('dim');
      list.append(
        h(
          'div',
          { class: cls.join(' ') },
          canVote ? h('span', { class: 'keycap' }, String(idx + 1)) : h('span', { class: 'lu-nokey' }),
          dot(p.color),
          h('span', { class: 'lu-name' }, p.name + (pid === me ? ` (${t('hud.you')})` : '')),
          chips,
          l.phase === 'vote' && l.voted.includes(pid) ? h('span', { class: 'lu-tick' }, '✓') : null,
        ),
      );
    }
    nodes.push(list);

    if (l.phase === 'vote') {
      const total = l.people.length;
      nodes.push(this.timer);
      const foot = !iAmIn ? t('lineup.spectator') : l.voted.includes(me) ? `${t('lineup.voted')} · ${l.voted.length}/${total}` : t('lineup.voteHint');
      nodes.push(h('div', { class: 'lu-foot' }, foot));
    } else if (r) {
      let line = '';
      if (r.auto) line = stage === 1000 ? '' : t('lineup.auto');
      else if (stage === 0) line = t('lineup.counting');
      else if (stage >= 100 && stage < 1000) line = t('lineup.tie');
      else if (stage < 100 && votesIn.length === 0) line = t('lineup.noVotes');
      if (final) {
        const w = this.person(l, r.winner);
        nodes.push(h('div', { class: 'lu-verdict' }, t('lineup.is', { name: w.name, role: t('role.' + r.role) })));
      } else nodes.push(h('div', { class: 'lu-foot' }, line));
    }
    this.el.replaceChildren(...nodes);
  }
}
