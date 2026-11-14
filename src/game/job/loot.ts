// Loot you can carry (first-person job). When a target of the run resolves with loot (a loot line in a
// target beat: safe, display cases, storeroom), bags appear at that place: safe 2, cases 2, storeroom 3,
// one more for a "take more" push. A player inside holds E (1 s) at a bag to pick it up, carries it (no
// sprinting) and holds E at the van's rear to stow it. A player at the van may hold E on "Abfahrt" once a
// bag is in: after a 5 s countdown (shown to everyone, cancelled by letting go) the crew leaves; bags not in
// the van are lost. A carrier who is caught drops his bag where he is.
//
// The host owns the bags (state 'jobloot', derived from the replicated plan state, validated intents
// 'job.bag'). The share of each loot entry that reached the van goes to the planning machine through one
// host-side input (PlanController.lootKept), applied when the run ends. Without a stage nothing of this runs.
import * as THREE from 'three';
import type { Session } from '../../net/session';
import type { Player } from '../player';
import type { Anchor, Anchors } from '../mech/skill';
import type { Input } from '../../core/input';
import { registerStrings, t } from '../../core/i18n';

registerStrings(
  {
    'jb.loot.count': 'Loot secured: {a} of {b}',
    'jb.loot.carry': 'You carry: loot · no sprinting',
    'jb.loot.take': 'Hold E: pick up the bag',
    'jb.loot.stow': 'Hold E: stow it in the van',
    'jb.loot.depart': 'Hold E: drive off (bags left behind are lost)',
    'jb.loot.departIn': 'Driving off in {n} …',
    'jb.loot.departHint': 'Let go of E to stop',
    'jb.loot.left': 'Driving off. {n} bag(s) stay behind.',
    'jb.to.loot': 'To the loot',
    'jb.at.loot': 'At the loot',
    'jb.sub.loot': 'Hold E at a bag to pick it up.',
    'jb.sub.carry': 'Carry it to the van and hold E at the back.',
  },
  {
    'jb.loot.count': 'Beute gesichert: {a} von {b}',
    'jb.loot.carry': 'Du trägst: Beute · kein Sprinten',
    'jb.loot.take': 'E halten: Beute nehmen',
    'jb.loot.stow': 'E halten: in den Transporter',
    'jb.loot.depart': 'E halten: Abfahrt (Zurückgelassenes ist weg)',
    'jb.loot.departIn': 'Abfahrt in {n} …',
    'jb.loot.departHint': 'E loslassen zum Abbrechen',
    'jb.loot.left': 'Abfahrt. {n} Beutel bleiben zurück.',
    'jb.to.loot': 'Zur Beute',
    'jb.at.loot': 'Bei der Beute',
    'jb.sub.loot': 'E halten an einem Beutel: aufnehmen.',
    'jb.sub.carry': 'Trag ihn zum Transporter und halte dort hinten E.',
  },
);

/** Bags per target; a second loot entry of the same target (a push "take more") gives one bag. */
export const LOOT_BAGS: Record<string, number> = { tresor: 2, vitrinen: 2, lager: 3 };
const TARGET_ANCHOR: Record<string, string> = { tresor: 'safe', vitrinen: 'case.0', lager: 'lager.goods' };
const LOOT_LINES = new Set(['ln.loot', 'ln.lootBest']);
const POOL = 12;
/** seconds E is held to pick up or stow a bag */
const HOLD_S = 1;
const DEPART_MS = 5000;
/** reach for a bag, and around the van's anchor */
const BAG_R = 1.7;
const VAN_R = 2.4;
/** host: a little more generous (poses lag) */
const HOST_SLACK = 1.2;

export type BagState = 'lie' | 'carry' | 'van' | 'lost';
export interface Bag {
  /** loot entry (order of the run's loot lines) */
  i: number;
  t: string;
  s: BagState;
  x: number;
  y: number;
  z: number;
  by: string | null;
}
export interface LootState {
  job: number;
  bags: Bag[];
  depart: { pid: string; until: number } | null;
  left: boolean;
}

export interface LootDeps {
  camera: THREE.Camera;
  root: HTMLElement;
  player: () => Player | null;
  input: () => Input | undefined;
  /** host: hand the kept share of loot entry i to the machine */
  kept: (i: number, f: number) => void;
}

/** "Abfahrt" only once the job heads out (no driving off while targets are still on the plan). */
const outShown = (p: any) => !!p?.run?.beats?.some((b: any) => b.title?.k === 'bt.out');
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export class JobLoot {
  private s: Session | null = null;
  private anchors: Anchors = {};
  private readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly bagMat: THREE.MeshStandardMaterial;
  private readonly crateMat: THREE.MeshStandardMaterial;
  private readonly countEl: HTMLElement;
  private readonly carryEl: HTMLElement;
  private readonly departEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly promptBar: HTMLElement;
  private readonly promptTxt: HTMLElement;
  private held = 0;
  private holdWhat = '';
  private departSent = false;
  private v = new THREE.Vector3();
  private q = new THREE.Vector3();
  /** host: last known pose of carriers (a carrier who drops out drops the bag there) */
  private lastPos = new Map<string, { x: number; y: number; z: number }>();
  private hostKey = '';

  constructor(private d: LootDeps) {
    // pooled meshes, all materials made here (ENGINE.md rule 2); parked far below until used
    const geo = new THREE.BoxGeometry(0.56, 0.3, 0.32);
    geo.translate(0, 0.15, 0);
    // a little self-light so a bag reads in a dark room
    this.bagMat = new THREE.MeshStandardMaterial({ color: 0x6b6450, roughness: 0.8, metalness: 0.05, emissive: 0x3a3220, emissiveIntensity: 0.6 });
    this.crateMat = new THREE.MeshStandardMaterial({ color: 0x9a7444, roughness: 0.9, metalness: 0, emissive: 0x3a2a14, emissiveIntensity: 0.6 });
    for (let k = 0; k < POOL; k++) {
      const m = new THREE.Mesh(geo, k % 2 ? this.crateMat : this.bagMat);
      m.position.set(0, -500, 0);
      m.castShadow = false;
      this.meshes.push(m);
      this.group.add(m);
    }
    this.group.name = 'jb-loot';
    d.camera.parent?.add(this.group);
    const el = (cls: string) => {
      const e = document.createElement('div');
      e.className = cls;
      return e;
    };
    this.countEl = el('jb-loot hidden');
    this.carryEl = el('jb-carry hidden');
    this.departEl = el('jb-depart hidden');
    this.promptEl = el('jb-prompt jb-lprompt hidden');
    this.promptTxt = document.createElement('span');
    const bar = el('jb-lbar');
    this.promptBar = document.createElement('i');
    bar.append(this.promptBar);
    const k = document.createElement('kbd');
    k.textContent = 'E';
    this.promptEl.append(k, this.promptTxt, bar);
    d.root.append(this.countEl, this.carryEl, this.departEl, this.promptEl);
  }

  setAnchors(a: Anchors | null) {
    this.anchors = a ?? {};
  }

  attach(s: Session) {
    this.s = s;
    if (s.isHost) s.handle('job.bag', (pid, a) => this.onIntent(pid, a));
  }

  detach() {
    this.s = null;
    this.hide();
  }

  private state(job: number): LootState | null {
    const L = this.s?.get<LootState>('jobloot');
    return L && L.job === job ? L : null;
  }

  // ------------------------------------------------------------------ host

  /** Host, every frame of a run: spawn bags for new loot, drop bags of caught carriers, finish the countdown. */
  hostTick(p: any) {
    const s = this.s;
    if (!s || !s.isHost || !p?.run) return;
    let L = s.get<LootState>('jobloot');
    let changed = false;
    if (!L || L.job !== p.job) {
      L = { job: p.job, bags: [], depart: null, left: false };
      this.lastPos.clear();
      changed = true;
    } else L = { ...L, bags: L.bags.map((b) => ({ ...b })) };
    const R = p.run;
    const inside = this.insideHumans(p);
    // new loot entries -> bags
    let idx = 0;
    for (const b of R.beats) {
      for (const l of b.lines) {
        if (!LOOT_LINES.has(l?.x?.k)) continue;
        const i = idx++;
        if (L.bags.some((x) => x.i === i) || !b.target) continue;
        const t = b.target as string;
        const again = L.bags.some((x) => x.t === t);
        const n = again ? 1 : (LOOT_BAGS[t] ?? 1);
        const a = this.anchors[TARGET_ANCHOR[t]] ?? this.anchors.van;
        if (!a) continue;
        for (let k = 0; k < n; k++) {
          // a small half ring in front of the place, facing where the crew stands
          const yaw = (a.yaw ?? 0) + (k - (n - 1) / 2) * 0.9 + (again ? 1.6 : 0);
          const r = 0.75 + (again ? 0.3 : 0);
          // no human inside to carry it: the bots take it to the van
          const s0: BagState = L.left ? 'lost' : inside.length ? 'lie' : 'van';
          L.bags.push({ i, t, s: s0, x: a.x + Math.sin(yaw) * r, y: a.y + 0.02, z: a.z + Math.cos(yaw) * r, by: null });
        }
        changed = true;
      }
    }
    // carriers: remember where they are; caught or gone -> the bag drops there
    for (const b of L.bags) {
      if (b.s !== 'carry' || !b.by) continue;
      const pose = s.poseOf(b.by);
      if (pose) this.lastPos.set(b.by, { x: pose.x, y: pose.y, z: pose.z });
      const role = p.seats?.find((x: any) => x.pid === b.by)?.role;
      if (!pose || !role || R.status[role] === 'caught' || !s.players.has(b.by)) {
        const lp = this.lastPos.get(b.by);
        if (lp) Object.assign(b, { x: lp.x, y: lp.y + 0.02, z: lp.z });
        b.s = 'lie';
        b.by = null;
        changed = true;
      }
    }
    // the countdown: leave, everything not in the van is lost
    if (L.depart && s.hostNow() >= L.depart.until && !L.left) {
      L.left = true;
      L.depart = null;
      for (const b of L.bags) if (b.s === 'lie' || b.s === 'carry') {
        b.s = 'lost';
        b.by = null;
      }
      changed = true;
    }
    if (changed) this.publish(L);
  }

  private publish(L: LootState) {
    this.s?.set('jobloot', L);
    // the machine gets each entry's kept share (applied only when the run ends)
    const key = L.job + '|' + L.bags.map((b) => b.i + b.s).join(',');
    if (key === this.hostKey) return;
    this.hostKey = key;
    const n = new Map<number, [number, number]>();
    for (const b of L.bags) {
      const c = n.get(b.i) ?? [0, 0];
      c[1]++;
      if (b.s === 'van') c[0]++;
      n.set(b.i, c);
    }
    for (const [i, [a, tot]] of n) this.d.kept(i, tot ? a / tot : 1);
  }

  private insideHumans(p: any): string[] {
    return (p.seats ?? []).filter((x: any) => x.pid && p.plan?.posts?.[x.role] === 'inside' && p.run?.status?.[x.role] !== 'caught').map((x: any) => x.pid as string);
  }

  private onIntent(pid: string, a: any) {
    const s = this.s;
    const p = s?.get<any>('plan');
    if (!s || !p?.run || !a || typeof a !== 'object' || !(p.phase === 'run' || (p.phase === 'offer' && p.mid))) return;
    const L0 = this.state(p.job);
    if (!L0) return;
    const L: LootState = { ...L0, bags: L0.bags.map((b) => ({ ...b })) };
    const pose = s.poseOf(pid);
    const van = this.anchors.van;
    const atVan = !pose || !van || flat(pose, van) <= (van.r ?? 1.4) + VAN_R + HOST_SLACK;
    const mine = L.bags.find((b) => b.s === 'carry' && b.by === pid);
    if (a.a === 'take') {
      const b = L.bags[Math.floor(Number(a.k))];
      if (!b || b.s !== 'lie' || mine || L.left || this.insideHumans(p).indexOf(pid) < 0) return;
      if (pose && flat(pose, b) > BAG_R + HOST_SLACK) return;
      b.s = 'carry';
      b.by = pid;
    } else if (a.a === 'stow') {
      if (!mine || !atVan) return;
      mine.s = 'van';
      mine.by = null;
      Object.assign(mine, van ? { x: van.x, y: van.y, z: van.z } : {});
    } else if (a.a === 'depart') {
      if (a.on) {
        if (L.depart || L.left || !atVan || !L.bags.some((b) => b.s === 'van') || mine || !outShown(p)) return;
        if (!(p.seats ?? []).some((x: any) => x.pid === pid && p.run.status[x.role] !== 'caught')) return;
        L.depart = { pid, until: s.hostNow() + DEPART_MS };
      } else {
        if (!L.depart || L.depart.pid !== pid) return;
        L.depart = null;
      }
    } else return;
    this.publish(L);
  }

  // ------------------------------------------------------------------ queries (director)

  /** 'none' (no bags), 'pending' (bags not in the van yet), 'done' (all in or lost), 'left' (the crew drove off). */
  status(job: number): 'none' | 'pending' | 'done' | 'left' {
    const L = this.state(job);
    if (!L || !L.bags.length) return L?.left ? 'left' : 'none';
    if (L.left) return 'left';
    return L.bags.every((b) => b.s === 'van' || b.s === 'lost') ? 'done' : 'pending';
  }

  /** Am I carrying a bag? */
  carrying(job: number): boolean {
    const L = this.state(job);
    const pid = this.s?.pid;
    return !!L && L.bags.some((b) => b.s === 'carry' && b.by === pid);
  }

  /** The nearest bag lying around (an objective for the crew inside). */
  nearestLying(job: number, from: { x: number; z: number } | undefined): Anchor | null {
    const L = this.state(job);
    if (!L || L.left || !from) return null;
    let best: Anchor | null = null,
      bd = Infinity;
    for (const b of L.bags) {
      if (b.s !== 'lie') continue;
      const dd = flat(from, b);
      if (dd < bd) {
        bd = dd;
        best = { x: b.x, y: b.y, z: b.z, r: 0.9 };
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ per frame (every client)

  /**
   * Draw the bags, the count, the carry line and the countdown; handle hold-E at bags and at the van.
   * `canAct`: I am inside, free, and no game, pop-up or task of mine is open.
   */
  update(dt: number, p: any, canAct: boolean, hostNow: number) {
    const s = this.s;
    const L = this.state(p.job);
    if (this.group.parent !== this.d.camera.parent) this.d.camera.parent?.add(this.group);
    if (!s || !L) return this.hide();
    const pid = s.pid;
    const pl = this.d.player();
    const inp = this.d.input();
    // meshes
    let k = 0;
    for (const b of L.bags) {
      if (k >= this.meshes.length) break;
      const m = this.meshes[k++];
      m.material = b.t === 'lager' ? this.crateMat : this.bagMat;
      // my own bag is close to the eye: smaller, so it does not fill the view
      m.scale.setScalar(b.s === 'carry' && b.by === pid ? 0.55 : 1);
      if (b.s === 'lie') {
        m.position.set(b.x, b.y, b.z);
        m.rotation.set(0, b.x * 3.1 + b.z, 0);
      } else if (b.s === 'carry' && b.by === pid && pl) {
        // in front of me, low on the left (the right hand holds the torch): always in view
        const cam = this.d.camera;
        cam.updateMatrixWorld();
        this.v.set(-0.45, -0.52, -0.95).applyMatrix4(cam.matrixWorld);
        m.position.copy(this.v);
        cam.getWorldDirection(this.q);
        m.rotation.set(0, Math.atan2(this.q.x, this.q.z), 0);
      } else if (b.s === 'carry' && b.by) {
        const pose = s.poseOf(b.by);
        if (pose) {
          m.position.set(pose.x + Math.cos(pose.yaw) * 0.3, pose.y + 0.75, pose.z - Math.sin(pose.yaw) * 0.3);
          m.rotation.set(0, pose.yaw, 0);
        } else m.position.set(0, -500, 0);
      } else m.position.set(0, -500, 0);
    }
    for (; k < this.meshes.length; k++) this.meshes[k].position.set(0, -500, 0);

    // the count, for everyone
    const total = L.bags.length;
    const inVan = L.bags.filter((b) => b.s === 'van').length;
    this.countEl.classList.toggle('hidden', !total);
    if (total) this.text(this.countEl, t('jb.loot.count', { a: inVan, b: total }));
    this.countEl.classList.toggle('all', total > 0 && inVan === total);
    const mine = L.bags.find((b) => b.s === 'carry' && b.by === pid) ?? null;
    this.carryEl.classList.toggle('hidden', !mine);
    if (mine) {
      this.text(this.carryEl, t('jb.loot.carry'));
      // no sprinting while carrying (the player reads Shift next frame)
      inp?.debugSet('ShiftLeft', false);
      inp?.debugSet('ShiftRight', false);
    }
    // the countdown, for everyone
    if (L.depart) {
      const n = Math.max(0, Math.ceil((L.depart.until - hostNow) / 1000));
      this.departEl.classList.remove('hidden');
      this.departEl.innerHTML = `<b>${t('jb.loot.departIn', { n })}</b>${L.depart.pid === pid ? `<small>${t('jb.loot.departHint')}</small>` : ''}`;
    } else this.departEl.classList.add('hidden');

    // what E does here
    let what = '',
      label = '',
      arg: any = null;
    const van = this.anchors.van;
    const atVan = !!pl && !!van && flat(pl.position, van) <= (van.r ?? 1.4) + VAN_R;
    if (canAct && pl && !L.left) {
      if (mine && atVan) {
        what = 'stow';
        label = t('jb.loot.stow');
      } else if (!mine) {
        let bi = -1,
          bd = BAG_R;
        L.bags.forEach((b, i) => {
          if (b.s !== 'lie') return;
          const dd = flat(pl.position, b);
          if (dd < bd && Math.abs(pl.position.y - b.y) < 2) {
            bd = dd;
            bi = i;
          }
        });
        if (bi >= 0) {
          what = 'take:' + bi;
          label = t('jb.loot.take');
          arg = bi;
        } else if (atVan && inVan > 0 && outShown(p) && L.bags.some((b) => b.s === 'lie' || b.s === 'carry')) {
          what = 'depart';
          label = t('jb.loot.depart');
        }
      }
    }
    const down = !!inp?.useHeld();
    if (what === 'depart') {
      if (down && !this.departSent && !L.depart) {
        this.departSent = true;
        s.intent('job.bag', { a: 'depart', on: true });
      }
    }
    if (this.departSent && (!down || what !== 'depart')) {
      this.departSent = false;
      if (L.depart?.pid === pid) s.intent('job.bag', { a: 'depart', on: false });
    }
    if (what && what !== 'depart' && down) {
      if (this.holdWhat !== what) {
        this.holdWhat = what;
        this.held = 0;
      }
      this.held += dt;
      if (this.held >= HOLD_S) {
        this.held = 0;
        this.holdWhat = '';
        if (what === 'stow') s.intent('job.bag', { a: 'stow' });
        else s.intent('job.bag', { a: 'take', k: arg });
      }
    } else {
      this.held = 0;
      this.holdWhat = '';
    }
    const showPrompt = !!what && !(what === 'depart' && L.depart);
    this.promptEl.classList.toggle('hidden', !showPrompt);
    if (showPrompt) {
      this.text(this.promptTxt, label);
      this.promptBar.style.width = (what === 'depart' ? 0 : Math.min(1, this.held / HOLD_S) * 100) + '%';
    }
  }

  private text(el: HTMLElement, s: string) {
    if (el.textContent !== s) el.textContent = s;
  }

  hide() {
    for (const m of this.meshes) m.position.set(0, -500, 0);
    this.countEl.classList.add('hidden');
    this.carryEl.classList.add('hidden');
    this.departEl.classList.add('hidden');
    this.promptEl.classList.add('hidden');
    this.held = 0;
    this.holdWhat = '';
    this.departSent = false;
  }

  /** Test hooks: the replicated bags of this job, and what this client shows. */
  debug(job: number) {
    const L = this.state(job);
    return {
      bags: L ? L.bags.map((b) => ({ ...b })) : [],
      depart: L?.depart ?? null,
      left: !!L?.left,
      count: this.countEl.classList.contains('hidden') ? '' : (this.countEl.textContent ?? ''),
      carry: this.carryEl.classList.contains('hidden') ? '' : (this.carryEl.textContent ?? ''),
      departText: this.departEl.classList.contains('hidden') ? '' : (this.departEl.textContent ?? ''),
      prompt: this.promptEl.classList.contains('hidden') ? '' : (this.promptTxt.textContent ?? ''),
    };
  }

  /** Test hook: do what holding E would do here (k: bag index for 'take'). */
  debugAct(a: 'take' | 'stow' | 'depart' | 'stop', k?: number) {
    const s = this.s;
    if (!s) return;
    if (a === 'take') s.intent('job.bag', { a: 'take', k });
    else if (a === 'stow') s.intent('job.bag', { a: 'stow' });
    else s.intent('job.bag', { a: 'depart', on: a === 'depart' });
  }
}
