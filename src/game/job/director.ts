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
import { registerStrings, t } from '../../core/i18n';
import type { JobStage } from './types';
import { JobHud } from './hud';
import { JobLoot } from './loot';
import type { Input } from '../../core/input';

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
    'jb.rescue': 'Stuck? Hold R to return to your objective',
    'jb.rescuing': 'Hold R ...',
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
    'jb.rescue': 'Festgesteckt? R halten: zurück zum Ziel',
    'jb.rescuing': 'R halten ...',
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
/** Lines of the 'in' beat that say the way in is open (lock picked or failed, crowbar, down through the hatch). */
const IN_DONE = new Set(['ln.open', 'ln.fumbleDoor', 'ln.lockHolds', 'ln.openSix', 'ln.crow', 'ln.allDown', 'ln.fall']);
/** Seconds R must be held to be put back at the objective. */
const RESCUE_HOLD = 1.2;
/** Below this height the player fell out of the world: put back at once. */
const FELL_Y = -8;
type Climb = JobStage['climb'];
const lineKey = (l: any): string => (l?.x?.k ?? l?.roll?.label?.k ?? '') as string;

/** Has the way in been opened in this run? Derived from replicated state only (late joiners get the same answer). */
export function entranceOpen(R: any): boolean {
  if (!R?.beats) return false;
  const i = R.beats.findIndex((b: any) => b.title.k === 'bt.in');
  if (i < 0) return false;
  if (R.beats.length > i + 1) return true;
  if (R.waitAt && R.waitAt.i > i) return true;
  return R.beats[i].lines.some((l: any) => IN_DONE.has(lineKey(l)));
}

/** The stage anchor where a beat happens (null: wherever the crew is). */
export function beatAnchor(b: { title: { k: string }; target?: string | null }, entrance: string, climb?: Climb): string | null {
  switch (b.title.k) {
    case 'bt.approach':
      return 'gate';
    case 'bt.in':
      return climb?.[entrance]?.wait ?? ENTRANCE_ANCHOR[entrance] ?? null;
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
/** How long the getaway waits for bags that are not in the van yet (ms; tests: `__nvPlanTimes.loot`). */
const lootWait = () => Number((window as any).__nvPlanTimes?.loot) || 120000;
/** Host check "at the task place": a little more generous than the client's prompt (poses lag a bit). */
const TAKE_SLACK = 2.5;

/** A task open to everyone inside (bot seat's job) or a "which way" choice answered at its place. */
export interface OpenTask {
  kind: 'take' | 'choice';
  /** anchor key of the place */
  key: string | null;
  anchor: Anchor | null;
  /** whose job it normally is */
  holder: string | null;
  /** what I may press here: key, task kind ('lock' | 'safe' | 'drill' | 'crow'), choice id */
  opts: { key: 'E' | 'F'; task: string; id: string }[];
  /** for 'take': the request number; for 'choice': '' */
  ref: string;
}
let busyNow = false;
/** A skill game, a decision pop-up or the plan overlay of this player is open (src/game/job/roles.ts ignores its keys then). */
export const jobBusy = () => busyNow;

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
  /** everything the player sees during the run (hud.ts) */
  private readonly ui: JobHud;
  /** bags to carry to the van (loot.ts) */
  readonly loot: JobLoot;
  private runJob: unknown = null;
  private doorOpen = '';
  private open: { n: number; game: SkillGame; anchor: Anchor | null } | null = null;
  private sent = new Set<number>();
  /** this frame: standing at my task's place, game not opened yet */
  private promptNow = false;
  private froze = false;
  private lastAlert = 0;
  private phaseKey = '';
  private objKey: string | null = null;
  private objAt: Anchor | null = null;
  private v = new THREE.Vector3();
  private climbedIn: unknown = null;
  private climbedOut: unknown = null;
  private rDown = false;
  private rHeld = 0;
  /** I started an open task or a world choice at its place: open my game as soon as the request arrives */
  private autoOpenUntil = 0;
  /** the open task / choice I already answered (key), so one key press sends once */
  private tookKey = '';
  /** this frame: an open task or choice I may start here (prompts "E ..." / "F ...") */
  private openNow: OpenTask | null = null;
  /** for tests: the last skill result this client sent */
  lastResult: (SkillResult & { n: number }) | null = null;
  /** for tests: every skill request this client received (job, n, game, variant, standIn, holder) */
  skillLog: { job: unknown; n: number; game: string; variant: string; standIn: boolean; holder: string | null }[] = [];

  constructor(private d: DirectorDeps) {
    this.ui = new JobHud({ root: d.root, camera: d.camera, act: (a) => this.s?.intent('plan.act', a) });
    this.loot = new JobLoot({
      camera: d.camera,
      root: d.root,
      player: d.player,
      input: () => (this.d.view as unknown as { input?: Input }).input,
      kept: (i, f) => this.d.plan.lootKept(i, f),
    });
    // hold R: back to the objective (own listener: works whatever the level binds)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && !e.repeat) this.rDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyR') this.rDown = false;
    });
    window.addEventListener('blur', () => (this.rDown = false));
  }

  /** PlanApi.registerStage: a level hands over its stage. Returns the unregister function. */
  register(stage: JobStage): () => void {
    this.stage = stage;
    this.loot.setAnchors(stage.anchors);
    this.applyHost();
    this.bindGuards();
    return () => {
      if (this.stage !== stage) return;
      this.endRun();
      this.stage = null;
      this.loot.setAnchors(null);
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
    this.loot.attach(s);
    this.d.view.hudMode = (p) => !!this.stage && this.inRun(p);
    // with a stage the planning overlay stays closed for the whole run: decisions and offers are the HUD's glass pop-up
    this.d.view.needsMe = () => false;
    this.applyHost();
  }

  detach() {
    this.endRun();
    for (const u of this.unsub) u();
    this.unsub = [];
    this.d.view.hudMode = null;
    this.d.plan.setFirstPerson(null);
    this.loot.detach();
    this.s = null;
    this.priv = null;
    this.hide();
  }

  /** Host: skill checks and the beat gate only while a stage is registered. */
  private applyHost() {
    const s = this.s;
    if (!s || !s.isHost) return;
    this.d.plan.setFirstPerson(this.stage ? { skills: true, gate: (b, i) => this.gate(b, i), near: (role, at) => this.atPlace(role, at) } : null);
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
  private gate(b: BeatRef, i: number): boolean | number {
    const s = this.s;
    if (!s || !this.stage || i === 0 || !GATED.has(b.title.k)) return true;
    const p = s.get<any>('plan');
    if (!p?.run || !p.plan) return true;
    const a = this.anchor(beatAnchor(b, p.run.entrance, this.stage?.climb));
    if (!a) return true;
    const van = this.anchor('van');
    const k = b.title.k;
    // the getaway waits for the bags as well (longer: up to 2 minutes), unless the crew drove off ("Abfahrt")
    const bags = k === 'bt.getaway' ? this.loot.status(p.job) : 'none';
    if (bags === 'left') return true;
    for (const seat of p.seats) {
      if (!seat.pid || p.plan.posts[seat.role] !== 'inside' || p.run.status[seat.role] === 'caught') continue;
      const pose = s.poseOf(seat.pid);
      if (!pose) continue;
      // on the way out, whoever already carried a bag to the van counts as out
      if (!this.near(pose, a) && !(k === 'bt.out' && van && this.near(pose, van, 2.5))) return bags === 'pending' ? lootWait() : false;
    }
    return bags === 'pending' ? lootWait() : true;
  }

  /** Host: is the human in seat `role` at the task place `at` ('door' | 'safe')? No pose known: yes (never block on missing data). */
  private atPlace(role: string, at: string): boolean {
    const s = this.s;
    const p = s?.get<any>('plan');
    if (!s || !p?.run) return true;
    const pid = p.seats?.find((x: any) => x.role === role)?.pid;
    const a = this.anchor(this.skillKey(p.run, at));
    const pose = pid ? s.poseOf(pid) : undefined;
    if (!a || !pose) return true;
    return this.near(pose, a, TAKE_SLACK);
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, time: number) {
    busyNow = !!this.open || this.ui.popupOpen() || this.d.view.isOpen();
    const st = this.stage;
    if (st) for (const k in st.games) st.games[k].update(dt, time);
    const s = this.s;
    const p = s?.get<any>('plan');
    if (!s || !st || !this.inRun(p)) {
      if (this.runJob !== null && (!p || !this.inRun(p))) this.endRun(!!p && !!st);
      this.hide();
      return;
    }
    if (this.runJob !== p.job) this.startRun(p);
    const R = p.run;
    // the entrance opens once the crew has got it open (lock picked, crowbar, hatch); derived from state every frame
    const inOpen = entranceOpen(R);
    if (inOpen && this.doorOpen !== R.entrance) {
      this.doorOpen = R.entrance;
      st.openDoor?.(R.entrance, true);
    }
    this.climbing(p, inOpen);
    if (s.isHost) this.loot.hostTick(p);
    const objective = this.objective(p);
    this.skill(p);
    const canCarry = !!this.insideMe(p) && !this.open && !this.ui.popupOpen() && !this.d.view.isOpen() && !this.mySkill(p) && !this.openNow;
    this.loot.update(dt, p, canCarry, s.hostNow());
    this.drawHud(p, objective, dt);
    this.rescue(dt, objective.anchor, p);
    const last = R.beats[R.beats.length - 1];
    const pk = `${p.job}|${p.phase}|${R.beats.length}|${objective.key}`;
    if (pk !== this.phaseKey) {
      this.phaseKey = pk;
      st.onPhase?.({ phase: p.phase, beat: R.beats.length - 1, anchor: last ? beatAnchor(last, R.entrance, st.climb) : null });
    }
  }

  /** Inside crew of this client (free, posted inside)? */
  private insideMe(p: any): string | null {
    const me = this.me(p);
    if (!me || p.plan?.posts?.[me] !== 'inside' || p.run?.status?.[me] === 'caught') return null;
    return me;
  }

  /** Roof hatch and similar: place the inside crew in and out (no climbing). */
  private climbing(p: any, inOpen: boolean) {
    const R = p.run;
    const c = this.stage?.climb?.[R.entrance];
    const pl = this.d.player();
    const me = this.insideMe(p);
    if (!c || !pl || !me) return;
    const i = ['brain', 'gambler', 'hands', 'bait'].indexOf(me);
    const put = (key: string) => {
      const a = this.anchor(key);
      if (!a) return;
      const ox = ((i % 2) - 0.5) * 0.8;
      const oz = (Math.floor(i / 2) - 0.5) * 0.8;
      pl.teleport(new THREE.Vector3(a.x + ox, a.y + 0.02, a.z + oz), a.yaw ?? pl.yaw);
    };
    const outShown = R.beats.some((b: any) => b.title.k === 'bt.out');
    if (outShown) {
      if (this.climbedOut !== p.job) {
        this.climbedOut = p.job;
        if (this.climbedIn === p.job) put(c.exit);
      }
    } else if (inOpen && this.climbedIn !== p.job) {
      this.climbedIn = p.job;
      put(ENTRANCE_ANCHOR[R.entrance] ?? c.exit);
    }
  }

  /** Hold R (or fall out of the world): back to the current objective's place. */
  private rescue(dt: number, a: Anchor | null, p: any) {
    const pl = this.d.player();
    if (!pl) return;
    const me = this.me(p);
    const target = a ?? (me && p.plan?.posts?.[me] === 'lookout' ? this.anchor('post.lookout') : null) ?? this.anchor('van');
    const fell = pl.position.y < FELL_Y;
    const holding = this.rDown && !pl.frozen && !this.d.view.isOpen();
    this.rHeld = holding ? this.rHeld + dt : 0;
    this.ui.setRescue(me ? t(this.rHeld > 0 ? 'jb.rescuing' : 'jb.rescue') : null, this.rHeld > 0);
    if (!target || (!fell && this.rHeld < RESCUE_HOLD)) return;
    this.rHeld = 0;
    this.rDown = false;
    pl.teleport(new THREE.Vector3(target.x, target.y + 0.05, target.z + 0.3), target.yaw ?? pl.yaw);
  }

  /** Test hook: what "hold R" does, without the key. */
  debugRescue() {
    const s = this.s;
    const p = s?.get<any>('plan');
    if (!p || !this.inRun(p)) return false;
    this.rHeld = RESCUE_HOLD;
    this.rDown = true;
    this.rescue(0.001, this.objective(p).anchor, p);
    return true;
  }

  private startRun(p: any) {
    this.runJob = p.job;
    this.doorOpen = '';
    this.sent.clear();
    this.ui.startRun(p);
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

  private endRun(home = false) {
    if (this.runJob === null) return;
    this.runJob = null;
    // after the job: everyone back at the van before the doors shut (nobody stays locked in)
    const pl = this.d.player();
    const van = this.anchor('van');
    if (home && pl && van && flatDist(pl.position, van) > 6) {
      const i = Math.floor(Math.random() * 4);
      pl.teleport(new THREE.Vector3(van.x + (i - 1.5) * 0.7, van.y + 0.02, van.z + 0.4), van.yaw ?? 0);
    }
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
    const ot = this.openTask(p);
    if (ot) return { key: ot.key, anchor: ot.anchor, text: '' };
    // carrying a bag: to the van
    if (this.loot.carrying(p.job)) return { key: 'van', anchor: this.anchor('van'), text: '' };
    const post = p.plan.posts[me];
    if (post === 'lookout') return { key: 'post.lookout', anchor: this.anchor('post.lookout'), text: t('jb.lookout') };
    if (post === 'driver') return { key: 'van.driver', anchor: this.anchor('van.driver'), text: t('jb.driver') };
    let key: string | null = null;
    if (R.waitAt) key = beatAnchor(R.waitAt, R.entrance, this.stage?.climb);
    else
      for (let i = R.beats.length - 1; i >= 0 && !key; i--) {
        key = beatAnchor(R.beats[i], R.entrance, this.stage?.climb);
      }
    // bags still lying around once the job heads out (or nothing else to do): fetch them
    if (post === 'inside' && (!key || key === 'van' || R.beats.some((b: any) => b.title.k === 'bt.out' || b.title.k === 'bt.greed'))) {
      const bag = this.loot.nearestLying(p.job, this.d.player()?.position);
      if (bag) return { key: 'loot', anchor: bag, text: '' };
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

  /** A task open to everyone inside, or a world choice, that I (inside, free) may start. */
  private openTask(p: any): OpenTask | null {
    const R = p.run;
    const me = this.insideMe(p);
    if (!me || p.phase !== 'run' || this.mySkill(p)) return null;
    if (R.skill && R.skill.open) {
      const key = this.skillKey(R, R.skill.at);
      return { kind: 'take', key, anchor: this.anchor(key), holder: R.skill.holder ?? null, opts: [{ key: 'E', task: R.skill.kind ?? R.skill.game, id: '' }], ref: 'n' + R.skill.n };
    }
    const c = R.choice;
    if (c) {
      const opts = (c.opts ?? []).filter((o: any) => !o.only || o.only === me).map((o: any) => ({ key: o.key, task: o.task, id: o.id }));
      if (!opts.length) return null;
      const key = this.skillKey(R, c.at);
      const holder = (c.opts.find((o: any) => o.role)?.role as string) ?? null;
      return { kind: 'choice', key, anchor: this.anchor(key), holder, opts, ref: 'c' + R.shown + ':' + (c.until ?? 0) };
    }
    return null;
  }

  // ------------------------------------------------------------------ skill checks

  private skill(p: any) {
    this.promptNow = false;
    this.openNow = null;
    this.openTaskKeys(p);
    const sk = this.mySkill(p);
    if (sk && !this.skillLog.some((x) => x.job === p.job && x.n === sk.n)) {
      this.skillLog.push({ job: p.job, n: sk.n, game: sk.game, variant: sk.variant, standIn: !!sk.standIn, holder: sk.holder ?? null });
      if (this.skillLog.length > 40) this.skillLog.shift();
    }
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
    if (a && !this.near(pl?.position, a)) {
      this.ui.takeE();
      return; // "geh zum Tresor": the prompt shows on arrival
    }
    if (this.d.view.isOpen() || this.ui.popupOpen()) return; // a card of mine is open: after it
    // at the place: the HUD shows "E  Schloss knacken"; only E opens the game (or I just started it myself)
    const inp = (this.d.view as unknown as { input?: Input }).input;
    const auto = performance.now() < this.autoOpenUntil;
    const e = this.ui.takeE();
    if (!auto && !e && !inp?.codePressed('KeyE')) {
      this.promptNow = true;
      return;
    }
    this.autoOpenUntil = 0;
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

  /** An open task or a world choice: at its place, E (or F) starts it; the host decides who was first. */
  private openTaskKeys(p: any) {
    const ot = this.openTask(p);
    if (!ot) return;
    const pl = this.d.player();
    if (ot.anchor && !this.near(pl?.position, ot.anchor)) return;
    if (this.tookKey === ot.ref || this.open || this.d.view.isOpen() || this.ui.popupOpen()) return;
    this.openNow = ot;
    const inp = (this.d.view as unknown as { input?: Input }).input;
    const e = this.ui.takeE() || !!inp?.codePressed('KeyE');
    const f = this.ui.takeF() || !!inp?.codePressed('KeyF');
    const o = ot.opts.find((x) => (x.key === 'E' && e) || (x.key === 'F' && f));
    if (!o) return;
    this.tookKey = ot.ref;
    this.openNow = null;
    // a task follows (lock, safe, drill): my game opens as soon as the host hands it to me
    if (o.task !== 'crow') this.autoOpenUntil = performance.now() + 8000;
    if (ot.kind === 'take') this.s?.intent('plan.act', { t: 'take', n: Number(ot.ref.slice(1)) });
    else this.s?.intent('plan.act', { t: 'choose', id: o.id });
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

  private drawHud(p: any, o: { key: string | null; anchor: Anchor | null }, dt: number) {
    const s = this.s!;
    const pl = this.d.player();
    const sk = this.mySkill(p);
    this.objKey = o.key;
    this.objAt = o.anchor;
    this.ui.frame(
      {
        p,
        me: this.me(p),
        priv: this.priv,
        hostNow: s.hostNow(),
        key: o.key,
        anchor: o.anchor,
        here: !!o.anchor && this.near(pl?.position, o.anchor),
        mySkill: sk && !this.sent.has(sk.n) ? { game: sk.game, variant: sk.variant, standIn: !!sk.standIn, holder: sk.holder ?? null } : null,
        gameOpen: !!this.open,
        prompt: this.promptNow,
        openTask: this.openTask(p),
        openHere: this.openNow,
        carrying: this.loot.carrying(p.job),
        player: pl,
      },
      dt,
    );
  }

  private hide() {
    this.ui.hide();
    this.loot.hide();
    this.rHeld = 0;
    this.objKey = null;
    this.objAt = null;
  }

  /** Test hook: a place of the registered stage. */
  debugAnchor(key: string): Anchor | null {
    return this.anchor(key);
  }

  /** Test hook: what this client shows and does. */
  debugState() {
    return {
      stage: !!this.stage,
      hud: this.ui.isShown(),
      ...this.ui.debug(),
      hudText: this.ui.debug().text,
      objective: this.objKey,
      at: this.objAt ? { x: this.objAt.x, y: this.objAt.y, z: this.objAt.z } : null,
      overlay: this.d.view.isOpen(),
      marker: this.ui.debug().marker3d || this.ui.debug().edge,
      game: this.open ? this.open.game.id : null,
      skill: this.priv?.skill ?? null,
      openTask: this.openNow ? { kind: this.openNow.kind, keys: this.openNow.opts.map((o) => o.key + ':' + o.task) } : null,
      lastResult: this.lastResult,
      skillLog: this.skillLog.slice(),
      pid: this.s?.pid ?? null,
      loot: this.s?.get<any>('plan') ? this.loot.debug(this.s.get<any>('plan').job) : null,
    };
  }
}
