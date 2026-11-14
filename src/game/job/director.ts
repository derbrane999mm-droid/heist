// The job director: turns the planning round's run (src/game/plan) into a first-person job on a stage that
// a level registers (`deps.plan.registerStage(stage)`, see types.ts). The planning machine stays the only
// authority: the director only (a) shrinks the overlay to a HUD while the run plays, (b) maps every beat to
// a place of the stage and shows it as objective and marker, (c) on the host, holds a beat until the inside
// crew stands there (never longer than TIMES.gate), (d) opens the skill game when this player's skill check
// arrives and sends the result, (e) opens the entrance, (f) switches the guards on and reports their alarm.
// Whatever is missing (no stage, no game, a bot seat, a player who walks away): the dice decide as before.
//
// Skill games: the director calls `update(dt, time)` of every registered game each frame. A level that
// registers its games here must not call it as well.
import * as THREE from 'three';
import './job.css';
import type { Session } from '../../net/session';
import type { Player } from '../player';
import type { PlanController } from '../plan/host';
import type { PlanView } from '../plan/view';
import type { Anchor, SkillGame, SkillResult } from '../mech/skill';
import type { BeatRef } from '../plan/logic';
import { tx, pt, type Lang } from '../plan/texts';
import { settings } from '../../core/settings';
import { registerStrings, t } from '../../core/i18n';
import type { JobStage } from './types';

export type { JobStage, GuardSystemLike, JobPhaseEvent } from './types';

registerStrings(
  {
    'jb.go': 'Go to: {place}',
    'jb.here': 'At the {place}. Wait for the crew.',
    'jb.skillGo': 'Your turn: go to the {place}',
    'jb.skillOpen': 'Your turn at the {place}',
    'jb.lookout': 'Hold your post and keep watch',
    'jb.driver': 'Stay at the wheel',
    'jb.caught': 'You were caught',
    'jb.waitCrew': 'Waiting for the crew at the {place} ({s} s)',
    'jb.atLock': '{who} is at the lock',
    'jb.atSafe': '{who} is at the safe',
    'jb.decides': 'Decides: {who}',
    'jb.minute': 'Minute',
    'jb.round': 'Round',
    'jb.roundNow': 'now',
    'jb.roundIn': 'in {n} min',
    'jb.noise': 'Noise',
    'jb.alarm': 'Alarm on',
    'jb.yes': 'yes',
    'jb.no': 'no',
    'jb.place.van': 'van',
    'jb.place.gate': 'yard gate',
    'jb.place.door.liefer': 'delivery door',
    'jb.place.door.vorder': 'front door',
    'jb.place.in.dach': 'roof hatch',
    'jb.place.safe': 'safe',
    'jb.place.case.0': 'display cases',
    'jb.place.lager.goods': 'storeroom',
    'jb.place.post.lookout': 'lookout post',
    'jb.place.van.driver': 'driver seat',
  },
  {
    'jb.go': 'Geh zu: {place}',
    'jb.here': 'Am Ziel ({place}). Wartet auf die Crew.',
    'jb.skillGo': 'Du bist dran: geh zu {place}',
    'jb.skillOpen': 'Du bist dran: {place}',
    'jb.lookout': 'Halte deinen Posten und pass auf',
    'jb.driver': 'Bleib am Steuer',
    'jb.caught': 'Du wurdest geschnappt',
    'jb.waitCrew': 'Warten auf die Crew: {place} ({s} s)',
    'jb.atLock': '{who} ist am Schloss',
    'jb.atSafe': '{who} ist am Tresor',
    'jb.decides': 'Entscheidet: {who}',
    'jb.minute': 'Minute',
    'jb.round': 'Runde',
    'jb.roundNow': 'jetzt',
    'jb.roundIn': 'in {n} Min',
    'jb.noise': 'Lärm',
    'jb.alarm': 'Alarm läuft',
    'jb.yes': 'ja',
    'jb.no': 'nein',
    'jb.place.van': 'Transporter',
    'jb.place.gate': 'Hoftor',
    'jb.place.door.liefer': 'Liefertür',
    'jb.place.door.vorder': 'Vordertür',
    'jb.place.in.dach': 'Dachluke',
    'jb.place.safe': 'Tresor',
    'jb.place.case.0': 'Vitrinen',
    'jb.place.lager.goods': 'Lager',
    'jb.place.post.lookout': 'Posten',
    'jb.place.van.driver': 'Fahrersitz',
  },
);

/** Anchor of each entrance (how the crew gets in and out). */
export const ENTRANCE_ANCHOR: Record<string, string> = { liefer: 'door.liefer', vorder: 'door.vorder', dach: 'in.dach' };
const TARGET_ANCHOR: Record<string, string> = { tresor: 'safe', vitrinen: 'case.0', lager: 'lager.goods' };
/** Beats that wait for the inside crew to reach their place (the approach starts at the van, encounters and greed happen where you are). */
const GATED = new Set(['bt.in', 'bt.target', 'bt.push', 'bt.out', 'bt.getaway']);
/** How close counts as "there", on top of the anchor's own radius. */
const SLACK = 1.0;
/** Walking this far from the skill anchor while the game is open counts as giving up. */
const LEAVE = 4.0;

/** The stage anchor where a beat happens (null: wherever the crew is). */
export function beatAnchor(b: { title: { k: string }; target?: string | null }, entrance: string): string | null {
  switch (b.title.k) {
    case 'bt.approach':
      return 'gate';
    case 'bt.in':
    case 'bt.out':
      return ENTRANCE_ANCHOR[entrance] ?? null;
    case 'bt.target':
    case 'bt.push':
      return b.target ? (TARGET_ANCHOR[b.target] ?? null) : null;
    case 'bt.getaway':
      return 'van';
    default:
      return null;
  }
}

const flatDist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface DirectorDeps {
  plan: PlanController;
  view: PlanView;
  player: () => Player | null;
  camera: THREE.Camera;
  root: HTMLElement;
}

export class JobDirector {
  private stage: JobStage | null = null;
  private s: Session | null = null;
  private unsub: (() => void)[] = [];
  private priv: any = null;
  private readonly hud: HTMLElement;
  private readonly marker: HTMLElement;
  private hudKey = '';
  private runJob: unknown = null;
  private doorOpen = '';
  private open: { n: number; game: SkillGame; anchor: Anchor | null } | null = null;
  private sent = new Set<number>();
  private froze = false;
  private lastAlert = 0;
  private phaseKey = '';
  private objKey: string | null = null;
  private objAt: Anchor | null = null;
  private v = new THREE.Vector3();
  /** for tests: the last skill result this client sent */
  lastResult: (SkillResult & { n: number }) | null = null;

  constructor(private d: DirectorDeps) {
    this.hud = document.createElement('div');
    this.hud.className = 'jb-hud hidden';
    this.marker = document.createElement('div');
    this.marker.className = 'jb-marker hidden';
    this.marker.innerHTML = '<i></i><span></span>';
    d.root.append(this.hud, this.marker);
  }

  /** PlanApi.registerStage: a level hands over its stage. Returns the unregister function. */
  register(stage: JobStage): () => void {
    this.stage = stage;
    this.applyHost();
    this.bindGuards();
    return () => {
      if (this.stage !== stage) return;
      this.endRun();
      this.stage = null;
      this.applyHost();
      this.hide();
    };
  }

  hasStage() {
    return !!this.stage;
  }

  attach(s: Session) {
    this.s = s;
    this.priv = null;
    this.sent.clear();
    this.unsub.push(
      s.onPrivate((name, a) => {
        if (name === 'plan.priv') this.priv = a;
      }),
    );
    if (s.isHost) s.handle('job.alert', (pid) => this.d.plan.guardAlert(pid));
    this.d.view.hudMode = (p) => !!this.stage && this.inRun(p);
    this.applyHost();
  }

  detach() {
    this.endRun();
    for (const u of this.unsub) u();
    this.unsub = [];
    this.d.view.hudMode = null;
    this.d.plan.setFirstPerson(null);
    this.s = null;
    this.priv = null;
    this.hide();
  }

  /** Host: skill checks and the beat gate only while a stage is registered. */
  private applyHost() {
    const s = this.s;
    if (!s || !s.isHost) return;
    this.d.plan.setFirstPerson(this.stage ? { skills: true, gate: (b, i) => this.gate(b, i) } : null);
  }

  private bindGuards() {
    const g = this.stage?.guards;
    if (!g) return;
    // guard.ts fires its events on every peer: only the host reports them (it is its own intent)
    if (typeof g.onEvent === 'function') g.onEvent((e) => e?.type === 'alert' && this.s?.isHost && this.alert());
    else g.onAlert = () => this.alert();
  }

  /** A guard raised the alarm on this client: tell the host (at most every 5 s; the machine applies it once per job). */
  private alert() {
    const s = this.s;
    if (!s || !this.inRun(s.get('plan'))) return;
    const now = performance.now();
    if (now - this.lastAlert < 5000) return;
    this.lastAlert = now;
    s.intent('job.alert', {});
  }

  private inRun(p: any): boolean {
    return !!p && !!p.run && (p.phase === 'run' || (p.phase === 'offer' && !!p.mid));
  }

  private me(p: any): string | null {
    return p?.seats?.find((x: any) => x.pid === this.s?.pid)?.role ?? null;
  }

  private anchor(key: string | null): Anchor | null {
    return key && this.stage ? (this.stage.anchors[key] ?? null) : null;
  }

  private near(pos: { x: number; z: number } | undefined, a: Anchor, extra = SLACK) {
    return !!pos && flatDist(pos, a) <= (a.r ?? 1.2) + extra;
  }

  /** Host: may beat i be shown? Only when every inside human (free, connected) stands at its place. */
  private gate(b: BeatRef, i: number): boolean {
    const s = this.s;
    if (!s || !this.stage || i === 0 || !GATED.has(b.title.k)) return true;
    const p = s.get<any>('plan');
    if (!p?.run || !p.plan) return true;
    const a = this.anchor(beatAnchor(b, p.run.entrance));
    if (!a) return true;
    for (const seat of p.seats) {
      if (!seat.pid || p.plan.posts[seat.role] !== 'inside' || p.run.status[seat.role] === 'caught') continue;
      const pose = s.poseOf(seat.pid);
      if (!pose) continue;
      if (!this.near(pose, a)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, time: number) {
    const st = this.stage;
    if (st) for (const k in st.games) st.games[k].update(dt, time);
    const s = this.s;
    const p = s?.get<any>('plan');
    if (!s || !st || !this.inRun(p)) {
      if (this.runJob !== null && (!p || !this.inRun(p))) this.endRun();
      this.hide();
      return;
    }
    if (this.runJob !== p.job) this.startRun(p);
    const R = p.run;
    // the entrance opens with the beat that gets the crew in
    if (R.beats.some((b: any) => b.title.k === 'bt.in') && this.doorOpen !== R.entrance) {
      this.doorOpen = R.entrance;
      st.openDoor?.(R.entrance, true);
    }
    const objective = this.objective(p);
    this.skill(p);
    this.drawHud(p, objective.text);
    this.drawMarker(objective.anchor, objective.key);
    const last = R.beats[R.beats.length - 1];
    const pk = `${p.job}|${p.phase}|${R.beats.length}|${objective.key}`;
    if (pk !== this.phaseKey) {
      this.phaseKey = pk;
      st.onPhase?.({ phase: p.phase, beat: R.beats.length - 1, anchor: last ? beatAnchor(last, R.entrance) : null });
    }
  }

  private startRun(p: any) {
    this.runJob = p.job;
    this.doorOpen = '';
    this.sent.clear();
    const pl = this.d.player();
    const me = this.me(p);
    if (pl && me) {
      const post = p.plan.posts[me];
      const key = post === 'lookout' ? 'post.lookout' : post === 'driver' ? 'van.driver' : 'van';
      const a = this.anchor(key) ?? this.anchor('van');
      if (a) {
        // the inside crew stands side by side behind the van
        const i = ['brain', 'gambler', 'hands', 'bait'].indexOf(me);
        const off = key === 'van' ? (i - 1.5) * 0.9 : 0;
        const yaw = a.yaw ?? 0;
        pl.teleport(new THREE.Vector3(a.x + Math.cos(yaw) * off, a.y + 0.02, a.z - Math.sin(yaw) * off), yaw);
      }
    }
    this.guardsOn(true);
  }

  private guardsOn(on: boolean) {
    const g = this.stage?.guards;
    if (!g) return;
    if (g.setActive) g.setActive(on);
    else g.activate?.(on);
  }

  private endRun() {
    if (this.runJob === null) return;
    this.runJob = null;
    this.closeGame(false);
    if (this.doorOpen) this.stage?.openDoor?.(this.doorOpen, false);
    this.doorOpen = '';
    this.guardsOn(false);
    this.phaseKey = '';
  }

  /** What this player should do now, and where. */
  private objective(p: any): { key: string | null; anchor: Anchor | null; text: string } {
    const R = p.run;
    const me = this.me(p);
    const place = (k: string) => t('jb.place.' + k);
    if (!me) return { key: null, anchor: null, text: '' };
    if (R.status[me] === 'caught') return { key: null, anchor: null, text: t('jb.caught') };
    const sk = this.mySkill(p);
    if (sk) {
      const key = this.skillKey(R, sk.at);
      const a = this.anchor(key);
      const here = !a || this.near(this.d.player()?.position, a);
      return { key, anchor: a, text: t(here ? 'jb.skillOpen' : 'jb.skillGo', { place: key ? place(key) : '' }) };
    }
    const post = p.plan.posts[me];
    if (post === 'lookout') return { key: 'post.lookout', anchor: this.anchor('post.lookout'), text: t('jb.lookout') };
    if (post === 'driver') return { key: 'van.driver', anchor: this.anchor('van.driver'), text: t('jb.driver') };
    let key: string | null = null;
    if (R.waitAt) key = beatAnchor(R.waitAt, R.entrance);
    else
      for (let i = R.beats.length - 1; i >= 0 && !key; i--) {
        key = beatAnchor(R.beats[i], R.entrance);
      }
    const a = this.anchor(key);
    if (!key || !a) return { key: null, anchor: null, text: '' };
    const here = this.near(this.d.player()?.position, a);
    return { key, anchor: a, text: t(here ? 'jb.here' : 'jb.go', { place: place(key) }) };
  }

  private skillKey(R: any, at: string) {
    return at === 'door' ? (ENTRANCE_ANCHOR[R.entrance] ?? null) : at;
  }

  private mySkill(p: any) {
    const sk = this.priv?.skill;
    return sk && this.priv.job === p.job && p.phase === 'run' ? sk : null;
  }

  // ------------------------------------------------------------------ skill checks

  private skill(p: any) {
    const sk = this.mySkill(p);
    if (this.open && (!sk || sk.n !== this.open.n)) this.closeGame(false);
    if (!sk || this.sent.has(sk.n)) return;
    const st = this.stage!;
    const pl = this.d.player();
    if (this.open) {
      // walked away: give up, the dice decide
      if (this.open.anchor && pl && !this.near(pl.position, this.open.anchor, LEAVE)) this.closeGame(true);
      return;
    }
    const game = st.games[sk.game];
    if (!game) return this.send(sk.n, { ok: false, seconds: 0, noise: 0, fumbles: 0, gaveUp: true });
    const a = this.anchor(this.skillKey(p.run, sk.at));
    if (a && !this.near(pl?.position, a)) return; // "geh zum Tresor": opens on arrival
    if (this.d.view.isOpen()) return; // a card of mine is open: after it
    this.open = { n: sk.n, game, anchor: a };
    if (pl && !pl.frozen) {
      pl.frozen = true;
      this.froze = true;
    }
    const n = sk.n;
    game.start({ game: sk.game, variant: sk.variant, difficulty: sk.difficulty, seed: sk.seed, tools: sk.tools, timeLimit: sk.timeLimit }, (r) => {
      if (!this.open || this.open.n !== n) return;
      this.open = null;
      this.unfreeze();
      this.send(n, r);
    });
  }

  private send(n: number, r: SkillResult) {
    if (this.sent.has(n)) return;
    this.sent.add(n);
    this.lastResult = { ...r, n };
    this.s?.intent('plan.act', { t: 'skill', ok: !!r.ok, seconds: Number(r.seconds) || 0, noise: Number(r.noise) || 0, fumbles: Number(r.fumbles) || 0, gaveUp: !!r.gaveUp });
  }

  private closeGame(gaveUp: boolean) {
    const o = this.open;
    if (!o) return;
    this.open = null;
    try {
      o.game.cancel();
    } catch (e) {
      console.error('[job] cancel failed', e);
    }
    this.unfreeze();
    if (gaveUp) this.send(o.n, { ok: false, seconds: 0, noise: 0, fumbles: 0, gaveUp: true });
  }

  private unfreeze() {
    const pl = this.d.player();
    if (pl && this.froze) pl.frozen = false;
    this.froze = false;
  }

  // ------------------------------------------------------------------ HUD

  private lang(): Lang {
    return settings.get('lang') === 'en' ? 'en' : 'de';
  }

  private drawHud(p: any, objective: string) {
    const s = this.s!;
    const R = p.run;
    const ctx = { lang: this.lang(), name: (r: string) => p.seats?.find((x: any) => x.role === r)?.name ?? pt('role.' + r + '.name') };
    const wait = R.waitAt ? Math.max(0, Math.ceil((R.waitAt.until - s.hostNow()) / 1000)) : 0;
    const key = [p.job, p.v, this.lang(), objective, wait, !!this.priv?.skill].join('|');
    this.hud.classList.remove('hidden');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const beat = R.beats[R.beats.length - 1];
    const lines = beat ? beat.lines.slice(-2) : [];
    const line = (l: any) => (l.kind === 'roll' ? `${tx(l.roll.label, ctx)}: ${t(l.roll.ok ? 'jb.yes' : 'jb.no')}` : tx(l.x, ctx));
    let who = '';
    if (R.decision) who = t('jb.decides', { who: ctx.name(R.decision.who) });
    else if (R.skill) who = t(R.skill.game === 'safe' ? 'jb.atSafe' : 'jb.atLock', { who: ctx.name(R.skill.who) });
    else if (R.waitAt) {
      const k = beatAnchor(R.waitAt, R.entrance);
      who = t('jb.waitCrew', { place: k ? t('jb.place.' + k) : '', s: wait });
    }
    const meter = Array.from({ length: 10 }, (_, i) => `<i class="${i < R.noise ? 'on' + (i >= 5 ? ' hi' : '') : ''}"></i>`).join('');
    let st = `<span>${esc(t('jb.minute'))} <b>${R.t}</b></span>`;
    if (!R.alarmKnown) st += `<span>${esc(t('jb.round'))} <b>${R.t >= R.windowEnd ? esc(t('jb.roundNow')) : esc(t('jb.roundIn', { n: R.windowEnd - R.t }))}</b></span>`;
    st += `<span>${esc(t('jb.noise'))} <span class="jb-meter">${meter}</span></span>`;
    if (R.alarmKnown) st += `<span class="jb-alarm">${esc(t('jb.alarm'))}</span>`;
    this.hud.innerHTML =
      `<div class="jb-stats">${st}</div>` +
      (beat ? `<div class="jb-beat">${esc(tx(beat.title, ctx))}</div>` : '') +
      lines.map((l: any) => `<div class="jb-line ${esc(l.kind === 'roll' ? (l.roll.ok ? 'good' : 'bad') : l.kind)}">${esc(line(l))}</div>`).join('') +
      (who ? `<div class="jb-who">${esc(who)}</div>` : '') +
      (objective ? `<div class="jb-obj">${esc(objective)}</div>` : '');
  }

  private drawMarker(a: Anchor | null, key: string | null) {
    const pl = this.d.player();
    this.objKey = key;
    this.objAt = a;
    if (!a || !pl) {
      this.marker.classList.add('hidden');
      return;
    }
    const cam = this.d.camera;
    this.v.set(a.x, a.y + 1.4, a.z).project(cam);
    if (this.v.z > 1 || this.v.z < -1) {
      this.marker.classList.add('hidden');
      return;
    }
    const x = Math.min(0.95, Math.max(-0.95, this.v.x));
    const y = Math.min(0.9, Math.max(-0.9, this.v.y));
    this.marker.classList.remove('hidden');
    this.marker.style.left = ((x + 1) / 2) * 100 + '%';
    this.marker.style.top = ((1 - y) / 2) * 100 + '%';
    const span = this.marker.lastElementChild as HTMLElement;
    const txt = Math.round(flatDist(pl.position, a)) + ' m';
    if (span.textContent !== txt) span.textContent = txt;
  }

  private hide() {
    this.hud.classList.add('hidden');
    this.marker.classList.add('hidden');
    this.hudKey = '';
    this.objKey = null;
    this.objAt = null;
  }

  /** Test hook: what this client shows and does. */
  debugState() {
    return {
      stage: !!this.stage,
      hud: !this.hud.classList.contains('hidden'),
      hudText: this.hud.textContent ?? '',
      objective: this.objKey,
      at: this.objAt ? { x: this.objAt.x, y: this.objAt.y, z: this.objAt.z } : null,
      overlay: this.d.view.isOpen(),
      marker: !this.marker.classList.contains('hidden'),
      game: this.open ? this.open.game.id : null,
      skill: this.priv?.skill ?? null,
      lastResult: this.lastResult,
    };
  }
}
