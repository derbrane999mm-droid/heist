// Something to do and something only he knows, for every post of the first-person job:
//  - lookout ("Posten"): a live plan of the building with the guard(s) and the inside crew, bottom right.
//    Number keys 1-6 drop a five-second warning marker in a room for the inside crew ("Erdem: Wache im Saal").
//  - driver ("Fahrer"): the exact clock (job minute, minutes until the guard's round, alarm and police), and
//    once per job a horn (hold H 1.5 s) that pulls the nearest guard to the street side.
//  - vanguard ("Vorhut", role bait, inside): G throws a coin where he looks; the guard goes to look.
// Everything is derived from the replicated plan state (`pub()`), the guard system's replicated poses and
// one-shot events; nothing hidden. The host validates every intent ('jr.ping' / 'jr.honk' / 'jr.coin').
// Role keys are ignored while a skill game, a decision pop-up or the plan overlay of this player is open.
//
//   const roles = createRoles(deps, { anchors, guards, map: VARGA_MAP })   // in the factory (builds DOM + meshes)
//   attach(s) { roles.attach(s) }  detach() { roles.detach() }  update(dt, t) { roles.update(dt, t) }
import * as THREE from 'three';
import './roles.css';
import type { LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Anchors } from '../mech/skill';
import { registerStrings, t } from '../../core/i18n';
import { mayAct } from '../lineup';
import { VARGA, STAKES } from '../plan/logic';
import { jobBusy } from './director';

registerStrings(
  {
    'jr.look.title': 'Lookout',
    'jr.look.hint': 'You see the guard. Tell the others where he is.',
    'jr.look.keys': '1–6 warn the crew',
    'jr.drv.title': 'Driver',
    'jr.drv.hint': 'You have the clock. Call out how much time is left.',
    'jr.drv.round': 'min until the guard’s round',
    'jr.drv.roundNow': 'The guard’s round is due',
    'jr.drv.minute': 'Job minute {n}',
    'jr.drv.alarm': 'Alarm',
    'jr.drv.police': 'Police in at most {n} min',
    'jr.drv.policeNow': 'Police may be here',
    'jr.drv.policeUnknown': 'Police: time unknown',
    'jr.drv.honk': 'Hold H: honk (once)',
    'jr.drv.honked': 'Horn used',
    'jr.ping': '{who}: guard in the {room}',
    'jr.honk': '{who} honks.',
    'jr.coin.hint': 'G: throw a coin, it distracts the guard.',
    'jr.room.wach': 'guard room',
    'jr.room.flur': 'corridor',
    'jr.room.tresor': 'vault room',
    'jr.room.saal': 'hall',
    'jr.room.lager': 'storeroom',
    'jr.room.foyer': 'foyer',
    'jr.room.a': 'room A',
    'jr.room.b': 'room B',
    'jr.room.c': 'room C',
    'jr.room.d': 'room D',
    'jr.room.e': 'room E',
    'jr.room.f': 'room F',
    'jr.map.van': 'Van',
    'jr.map.street': 'Street',
    'jr.map.yard': 'Yard',
  },
  {
    'jr.look.title': 'Posten',
    'jr.look.hint': 'Du siehst die Wache. Sag den anderen, wo sie ist.',
    'jr.look.keys': '1–6 Crew warnen',
    'jr.drv.title': 'Fahrer',
    'jr.drv.hint': 'Du hast die Uhr. Sag an, wie viel Zeit bleibt.',
    'jr.drv.round': 'Min bis zur Runde der Wache',
    'jr.drv.roundNow': 'Die Runde der Wache ist fällig',
    'jr.drv.minute': 'Minute {n} im Job',
    'jr.drv.alarm': 'Alarm',
    'jr.drv.police': 'Polizei in höchstens {n} Min',
    'jr.drv.policeNow': 'Polizei kann da sein',
    'jr.drv.policeUnknown': 'Polizei: Zeit unbekannt',
    'jr.drv.honk': 'H halten: hupen (einmal)',
    'jr.drv.honked': 'Hupe verbraucht',
    'jr.ping': '{who}: Wache im {room}',
    'jr.honk': '{who} hupt.',
    'jr.coin.hint': 'G: Münze werfen, lenkt die Wache ab.',
    'jr.room.wach': 'Wachraum',
    'jr.room.flur': 'Flur',
    'jr.room.tresor': 'Tresorraum',
    'jr.room.saal': 'Saal',
    'jr.room.lager': 'Lager',
    'jr.room.foyer': 'Foyer',
    'jr.room.a': 'Raum A',
    'jr.room.b': 'Raum B',
    'jr.room.c': 'Raum C',
    'jr.room.d': 'Raum D',
    'jr.room.e': 'Raum E',
    'jr.room.f': 'Raum F',
    'jr.map.van': 'Wagen',
    'jr.map.street': 'Straße',
    'jr.map.yard': 'Hof',
  },
);

// ------------------------------------------------------------------ map data

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
/** One room of the lookout's map; the order is the number key (1..6). `id` names the text `jr.room.<id>`. */
export interface RoleRoom extends Rect {
  id: string;
}
/** The lookout's plan of a location, in world metres (x east, z south; north is up on the map). */
export interface RoleMap {
  /** visible part of the world */
  view: Rect;
  building: Rect;
  rooms: RoleRoom[];
  /** floor height inside (ping markers stand here) */
  floorY: number;
  /** door openings in the outer wall: a short bright line from (x0, z0) to (x1, z1) */
  doors: { x0: number; z0: number; x1: number; z1: number }[];
  /** roof hatch and similar: a small dashed square */
  hatch?: { x: number; z: number } | null;
  yard?: Rect | null;
  street?: Rect | null;
  /** inside point the horn pulls the nearest guard to (street side of the building) */
  honkAt: { x: number; z: number };
}

/** The Auktionshaus Varga (varga-interior.ts ROOMS, varga.ts yard and street). */
export const VARGA_MAP: RoleMap = {
  view: { x0: -23, x1: 7.5, z0: -14, z1: 15.5 },
  building: { x0: -22, x1: 0, z0: -13.1, z1: 4.9 },
  rooms: [
    { id: 'wach', x0: -22, x1: -15, z0: -13.1, z1: -6.6 },
    { id: 'flur', x0: -15, x1: -7.5, z0: -13.1, z1: -6.6 },
    { id: 'tresor', x0: -7.5, x1: 0, z0: -13.1, z1: -6.6 },
    { id: 'saal', x0: -22, x1: -7.5, z0: -6.6, z1: 0.9 },
    { id: 'lager', x0: -7.5, x1: 0, z0: -6.6, z1: 4.9 },
    { id: 'foyer', x0: -22, x1: -7.5, z0: 0.9, z1: 4.9 },
  ],
  floorY: 0.27,
  doors: [
    { x0: 0, z0: -1.1, x1: 0, z1: 1.1 }, // delivery door (east wall, into the yard)
    { x0: -15.7, z0: 4.9, x1: -13.5, z1: 4.9 }, // front door (street)
  ],
  hatch: { x: -9.65, z: -1.15 },
  yard: { x0: 0, x1: 6.5, z0: -6.7, z1: 4.9 },
  street: { x0: -23, x1: 7.5, z0: 6.9, z1: 13.1 },
  honkAt: { x: -14.6, z: 3.4 }, // inside the front door (foyer)
};

/** The flat test yard (calib-job.ts): six made-up rooms behind the wall at z = 0. */
export const JOB_TEST_MAP: RoleMap = {
  view: { x0: -14, x1: 14, z0: -13, z1: 15 },
  building: { x0: -12, x1: 12, z0: -12, z1: 0 },
  rooms: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, x0: -12 + (i % 3) * 8, x1: -4 + (i % 3) * 8, z0: i < 3 ? -12 : -6, z1: i < 3 ? -6 : 0 })),
  floorY: 0,
  doors: [
    { x0: -7, z0: 0, x1: -5, z1: 0 },
    { x0: 5, z0: 0, x1: 7, z1: 0 },
  ],
  hatch: { x: 0, z: 1 },
  yard: { x0: -12, x1: 12, z0: 0, z1: 7 },
  street: { x0: -14, x1: 14, z0: 10, z1: 14 },
  honkAt: { x: 0, z: -2 },
};

// ------------------------------------------------------------------ tuning

const PING_S = 5;
const PING_GAP_MS = 2000;
const HONK_HOLD = 1.5;
const COIN_RANGE = 12;
const COIN_FLIGHT = 0.6;
const FEED_S = 4.5;
const HINT_S = 7;
const MAP_HZ = 10;

/** The guard system as roles.ts uses it; every part optional (test dummies, no guards). */
export interface RoleGuards {
  positions?(): { x: number; z: number; yaw: number; state: number }[];
  distract?(x: number, z: number): boolean;
  noise?(x: number, z: number, r: number): void;
  debugState?(): unknown;
}

export interface RolesOpts {
  anchors: Anchors;
  guards?: RoleGuards | null;
  map: RoleMap;
}

export interface Roles {
  attach(s: Session): void;
  detach(): void;
  update(dt: number, time: number): void;
  /** test hook */
  debug(): Record<string, unknown>;
}

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag: string, attrs: Record<string, string | number>, parent?: Element) => {
  const e = document.createElementNS(SVG, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent?.append(e);
  return e;
};
const div = (cls: string, parent?: Element, html = '') => {
  const e = document.createElement('div');
  e.className = cls;
  if (html) e.innerHTML = html;
  parent?.append(e);
  return e;
};
const setText = (el: Element, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};
const live = (p: any) => !!p && !!p.run && (p.phase === 'run' || (p.phase === 'offer' && !!p.mid));
const finite = (...v: unknown[]) => v.every((x) => typeof x === 'number' && Number.isFinite(x));

export function createRoles(deps: LevelDeps, o: RolesOpts): Roles {
  const M = o.map;
  const ui = document.getElementById('ui')!;
  let session: Session | null = null;
  const unsubs: (() => void)[] = [];

  // ================================================================ DOM (built once)
  // lookout: map panel
  const look = div('jr-panel jr-look hidden', ui);
  const lookHint = div('jr-hint', look);
  const lookCard = div('jr-card', look);
  const lookHead = div('jr-head', lookCard);
  const lookTitle = document.createElement('span');
  const lookKeys = document.createElement('span');
  lookKeys.className = 'jr-sub';
  lookHead.append(lookTitle, lookKeys);
  const V = M.view;
  const svg = svgEl('svg', { class: 'jr-map', viewBox: `${V.x0} ${V.z0} ${V.x1 - V.x0} ${V.z1 - V.z0}`, preserveAspectRatio: 'xMidYMid meet' }, lookCard);
  const rect = (r: Rect, cls: string, parent: Element = svg) => svgEl('rect', { x: r.x0, y: r.z0, width: r.x1 - r.x0, height: r.z1 - r.z0, class: cls }, parent);
  if (M.street) {
    rect(M.street, 'jr-street');
    const st = svgEl('text', { x: (M.street.x0 + M.street.x1) / 2, y: (M.street.z0 + M.street.z1) / 2 + 0.5, class: 'jr-area' }, svg);
    st.setAttribute('data-k', 'jr.map.street');
  }
  if (M.yard) {
    rect(M.yard, 'jr-yard');
    const yt = svgEl('text', { x: (M.yard.x0 + M.yard.x1) / 2, y: (M.yard.z0 + M.yard.z1) / 2, class: 'jr-area' }, svg);
    yt.setAttribute('data-k', 'jr.map.yard');
  }
  rect(M.building, 'jr-bld');
  const roomEls = M.rooms.map((r, i) => {
    const g = svgEl('g', { class: 'jr-room', 'data-room': i }, svg);
    rect(r, 'jr-rr', g);
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    svgEl('rect', { x: cx - 1.05, y: cz - 2.35, width: 2.1, height: 2.1, rx: 0.35, class: 'jr-key' }, g);
    const k = svgEl('text', { x: cx, y: cz - 0.85, class: 'jr-keyt' }, g);
    k.textContent = String(i + 1);
    const name = svgEl('text', { x: cx, y: cz + 1.35, class: 'jr-rn' }, g);
    name.setAttribute('data-k', 'jr.room.' + r.id);
    g.addEventListener('click', () => ping(i));
    return g;
  });
  for (const d of M.doors) svgEl('line', { x1: d.x0, y1: d.z0, x2: d.x1, y2: d.z1, class: 'jr-door' }, svg);
  if (M.hatch) svgEl('rect', { x: M.hatch.x - 0.6, y: M.hatch.z - 0.6, width: 1.2, height: 1.2, class: 'jr-hatch' }, svg);
  const van = o.anchors.van;
  if (van) {
    svgEl('rect', { x: van.x - 1, y: van.z - 2.6, width: 2, height: 5, rx: 0.4, class: 'jr-van', transform: `rotate(${(-(van.yaw ?? 0) * 180) / Math.PI} ${van.x} ${van.z - 0.1})` }, svg);
  }
  const lk = o.anchors['post.lookout'];
  if (lk) svgEl('circle', { cx: lk.x, cy: lk.z, r: 0.7, class: 'jr-me' }, svg);
  // live dots, pooled: 3 guards, 4 crew
  const guardEls = [0, 1, 2].map(() => {
    const g = svgEl('g', { class: 'jr-guard', visibility: 'hidden' }, svg);
    svgEl('path', { d: 'M0 0 L-2.1 -4.2 A4.7 4.7 0 0 1 2.1 -4.2 Z', class: 'jr-cone' }, g);
    svgEl('circle', { cx: 0, cy: 0, r: 0.85, class: 'jr-gdot' }, g);
    return g;
  });
  const crewEls = [0, 1, 2, 3].map(() => {
    const g = svgEl('g', { class: 'jr-crew', visibility: 'hidden' }, svg);
    svgEl('circle', { cx: 0, cy: 0, r: 0.95 }, g);
    svgEl('text', { x: 0, y: 0.45 }, g);
    return g;
  });

  // driver: clock panel
  const drv = div('jr-panel jr-drv hidden', ui);
  const drvHint = div('jr-hint', drv);
  const drvCard = div('jr-card', drv);
  const drvHead = div('jr-head', drvCard);
  const drvTitle = document.createElement('span');
  const drvMin = document.createElement('span');
  drvMin.className = 'jr-sub';
  drvHead.append(drvTitle, drvMin);
  const drvBig = div('jr-big', drvCard, '<b></b><span></span>');
  const drvBigN = drvBig.firstElementChild as HTMLElement;
  const drvBigL = drvBig.lastElementChild as HTMLElement;
  const drvAlarm = div('jr-alarmrow hidden', drvCard, '<span class="jr-tag"></span><span class="jr-pol"></span>');
  const drvHonk = div('jr-honk', drvCard, '<span></span><i><b></b></i>');
  const drvHonkT = drvHonk.firstElementChild as HTMLElement;
  const drvHonkBar = drvHonk.querySelector('b') as HTMLElement;

  // one line for everyone (pings, horn, the coin hint), under the run HUD's event line
  const feed = div('jr-feed hidden', ui);
  // coin cooldown ring next to the crosshair
  const ring = div(
    'jr-ring hidden',
    ui,
    `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" class="jr-ring-bg"/><circle cx="12" cy="12" r="9" class="jr-ring-fg" pathLength="100"/></svg><span>G</span>`,
  );
  const ringFg = ring.querySelector('.jr-ring-fg') as SVGCircleElement;

  // ================================================================ world objects (built once, rule 2)
  const scene = deps.engine.scene;
  const warnMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const ringGeo = new THREE.RingGeometry(0.75, 0.95, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 3, 12, 1, true);
  beamGeo.translate(0, 1.5, 0);
  const gemGeo = new THREE.OctahedronGeometry(0.22);
  const markers = M.rooms.map((r) => {
    const g = new THREE.Group();
    const ringM = new THREE.Mesh(ringGeo, warnMat);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    const gem = new THREE.Mesh(gemGeo, warnMat);
    gem.position.y = 2.4;
    gem.scale.set(1, 1.5, 1);
    for (const m of [ringM, beam, gem]) {
      m.renderOrder = 997;
      m.frustumCulled = false;
    }
    g.add(ringM, beam, gem);
    g.name = 'jr-warn';
    g.userData.home = new THREE.Vector3((r.x0 + r.x1) / 2, M.floorY + 0.03, (r.z0 + r.z1) / 2);
    // in the scene from the start (visible, far below) so the warm-up compiles the shaders behind the loading screen
    g.position.set(0, -500, 0);
    scene.add(g);
    return { g, ringM, gem, until: 0 };
  });
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xc9a65a, metalness: 0.9, roughness: 0.35 });
  const coinGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.006, 16);
  const coins = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(coinGeo, coinMat);
    m.position.set(0, -500, 0);
    m.frustumCulled = false;
    scene.add(m);
    return { m, t: -1, a: new THREE.Vector3(), b: new THREE.Vector3(), clinked: true };
  });

  // ================================================================ sound
  const clink = (x: number, y: number, z: number) => {
    const a = deps.audio;
    if (!a.ready) return;
    const t0 = a.ctx.currentTime;
    const out = a.out({ pos: new THREE.Vector3(x, y, z) }, 0.9);
    a.tone(out, 'sine', 3150, 3080, t0, 0.22, 0.35, 0.002);
    a.tone(out, 'sine', 4720, 4650, t0, 0.14, 0.18, 0.002);
    a.tone(out, 'sine', 3150, 3100, t0 + 0.13, 0.16, 0.18, 0.002);
    a.tone(out, 'sine', 3300, 3280, t0 + 0.22, 0.12, 0.08, 0.002);
    a.burst(out, 'highpass', 5000, 0.7, t0, 0.03, 0.2);
  };
  const horn = (x: number, y: number, z: number) => {
    const a = deps.audio;
    if (!a.ready) return;
    const t0 = a.ctx.currentTime;
    const out = a.out({ pos: new THREE.Vector3(x, y, z) }, 1.6);
    const lp = a.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    lp.connect(out);
    for (const f of [392, 494]) {
      a.tone(lp, 'sawtooth', f, f * 0.99, t0, 0.75, 0.22, 0.02);
      a.tone(lp, 'square', f, f * 0.99, t0, 0.7, 0.08, 0.02);
    }
  };

  // ================================================================ state
  let job: unknown = null;
  let lastPingSent = -1e9;
  const lastPingBy = new Map<string, number>();
  const honkedJobs = new Set<unknown>();
  let honkDone = false;
  let honkHeld = 0;
  let honkNeedRelease = false;
  let coinUntil = 0;
  let coinCd = 1;
  let coinSentAt = 0;
  let coinHintLeft = 0;
  let alarmT: number | null = null;
  let mapT = 0;
  const feedQ: string[] = [];
  let feedCur = '';
  let feedLeft = 0;
  let lastLang = '';
  const dbg = { pingsSeen: 0, pingsSent: 0, honks: 0, coins: 0, coinsSent: 0, lines: [] as string[] };
  const v = new THREE.Vector3();
  const dir = new THREE.Vector3();

  const plan = () => session?.get<any>('plan') ?? null;
  const seatOf = (p: any, pid: string | undefined) => p?.seats?.find((x: any) => x.pid === pid) ?? null;
  const postOf = (p: any, role: string | null | undefined) => (role ? (p?.plan?.posts?.[role] ?? null) : null);
  const freeInside = (p: any, role: string | null | undefined) => !!role && postOf(p, role) === 'inside' && p.run?.status?.[role] !== 'caught';
  const nameOf = (p: any, pid: string) => seatOf(p, pid)?.name ?? session?.players.get(pid)?.name ?? '?';
  /** May this pid throw the coin? The bait seat's human, or anyone inside if no human holds bait. */
  const mayThrow = (p: any, pid: string) => {
    const seat = seatOf(p, pid);
    if (!seat || !freeInside(p, seat.role)) return false;
    const bait = p.seats.find((x: any) => x.role === 'bait');
    if (bait?.pid) return bait.pid === pid;
    return !!session && mayAct(session, 'bait', pid);
  };
  const busy = () => {
    const pl = deps.player();
    return jobBusy() || !pl || pl.frozen;
  };
  const say = (s: string) => {
    feedQ.push(s);
    if (feedQ.length > 4) feedQ.shift();
    dbg.lines.push(s);
    if (dbg.lines.length > 20) dbg.lines.shift();
  };

  // ================================================================ actions (client side)
  function ping(i: number) {
    const s = session;
    const p = plan();
    if (!s || !live(p) || !M.rooms[i]) return;
    if (postOf(p, seatOf(p, s.pid)?.role) !== 'lookout') return;
    const now = s.hostNow();
    if (now - lastPingSent < PING_GAP_MS) return;
    lastPingSent = now;
    dbg.pingsSent++;
    s.intent('jr.ping', { room: i });
  }

  function throwCoin() {
    const s = session;
    const pl = deps.player();
    if (!s || !pl) return;
    const now = s.hostNow();
    if (now < coinUntil || now - coinSentAt < 600) return;
    coinSentAt = now;
    const feetY = pl.position.y;
    dir.copy(pl.forward).normalize();
    const d = deps.physics.raycast(pl.eye, dir, COIN_RANGE, pl.body.collider);
    let x: number, y: number, z: number;
    if (d !== null) {
      v.copy(pl.eye).addScaledVector(dir, d);
      if (v.y > feetY + 0.35) {
        // a wall or the ceiling: the coin drops in front of it
        const h = Math.hypot(dir.x, dir.z) || 1;
        x = v.x - (dir.x / h) * 0.3;
        z = v.z - (dir.z / h) * 0.3;
        y = feetY;
      } else {
        x = v.x;
        y = v.y;
        z = v.z;
      }
    } else {
      v.copy(pl.eye).addScaledVector(dir, COIN_RANGE);
      x = v.x;
      y = feetY;
      z = v.z;
    }
    dbg.coinsSent++;
    s.intent('jr.coin', { x, y, z });
  }

  // ================================================================ host
  const hostHandlers = (s: Session) => {
    s.handle('jr.ping', (pid, a) => {
      const p = plan();
      const i = Number(a?.room);
      if (!live(p) || !Number.isInteger(i) || !M.rooms[i]) return;
      if (!seatOf(p, pid) || postOf(p, seatOf(p, pid).role) !== 'lookout') return;
      const now = s.hostNow();
      if (now - (lastPingBy.get(pid) ?? -1e9) < PING_GAP_MS) return;
      lastPingBy.set(pid, now);
      s.emit('jr.ping', { pid, room: i, until: now + PING_S * 1000 });
    });
    s.handle('jr.honk', (pid) => {
      const p = plan();
      if (!live(p) || !seatOf(p, pid) || postOf(p, seatOf(p, pid).role) !== 'driver') return;
      if (honkedJobs.has(p.job)) return;
      honkedJobs.add(p.job);
      // the nearest calm guard comes to the street side; if the coin's cooldown blocks that, the noise still carries
      const g = o.guards;
      const ok = g?.distract?.(M.honkAt.x, M.honkAt.z) ?? false;
      if (!ok) g?.noise?.(M.honkAt.x, M.honkAt.z, 25);
      const a = o.anchors.van ?? o.anchors['van.driver'];
      s.emit('jr.honk', { pid, x: a?.x ?? 0, y: (a?.y ?? 0) + 1, z: a?.z ?? 0 });
    });
    s.handle('jr.coin', (pid, a) => {
      const p = plan();
      if (!live(p) || !a || !finite(a.x, a.y, a.z) || !mayThrow(p, pid)) return;
      const pose = s.poseOf(pid);
      if (pose && Math.hypot(pose.x - a.x, pose.z - a.z) > COIN_RANGE + 1) return;
      const g = o.guards;
      if (!g?.distract) return;
      if (!g.distract(a.x, a.z)) return; // cooldown or nobody to fool: nothing is thrown
      const st = (g.debugState?.() ?? null) as { cooldown?: number } | null;
      const cd = Number(st?.cooldown) > 0 ? Number(st!.cooldown) : 12;
      s.emit('jr.coin', { pid, x: a.x, y: a.y, z: a.z, cd, until: s.hostNow() + cd * 1000 });
    });
  };

  // ================================================================ events (everyone)
  const onEvent = (name: string, a: any) => {
    const s = session;
    if (!s || !a) return;
    const p = plan();
    if (name === 'jr.ping') {
      const i = Number(a.room);
      const r = M.rooms[i];
      if (!r) return;
      dbg.pingsSeen++;
      markers[i].until = Number(a.until) || s.hostNow() + PING_S * 1000;
      say(t('jr.ping', { who: nameOf(p, a.pid), room: t('jr.room.' + r.id) }));
      deps.audio.play('ui');
    } else if (name === 'jr.honk') {
      dbg.honks++;
      if (a.pid === s.pid) honkDone = true;
      say(t('jr.honk', { who: nameOf(p, a.pid) }));
      horn(Number(a.x) || 0, Number(a.y) || 1, Number(a.z) || 0);
    } else if (name === 'jr.coin') {
      dbg.coins++;
      if (a.pid === s.pid) {
        coinUntil = Number(a.until) || 0;
        coinCd = Math.max(1, Number(a.cd) || 12);
      }
      const c = coins.find((x) => x.t < 0) ?? coins[0];
      const pl = deps.player();
      if (a.pid === s.pid && pl) c.a.copy(pl.eye).y -= 0.25;
      else {
        const pose = s.poseOf(a.pid);
        c.a.set(pose?.x ?? a.x, (pose?.y ?? a.y) + 1.4, pose?.z ?? a.z);
      }
      c.b.set(a.x, a.y + 0.01, a.z);
      c.t = 0;
      c.clinked = false;
    }
  };

  // ================================================================ per frame
  const hideAll = () => {
    look.classList.add('hidden');
    drv.classList.add('hidden');
    ring.classList.add('hidden');
    for (const m of markers) {
      m.until = 0;
      m.g.position.set(0, -500, 0);
    }
  };

  const resetRun = (p: any) => {
    job = p.job;
    honkDone = false;
    honkHeld = 0;
    honkNeedRelease = false;
    coinUntil = 0;
    alarmT = null;
    feedQ.length = 0;
    feedCur = '';
    feedLeft = 0;
    for (const m of markers) m.until = 0;
    coinHintLeft = session && mayThrow(p, session.pid) ? HINT_S : 0;
    if (coinHintLeft > 0) say(t('jr.coin.hint'));
  };

  const drawLabels = () => {
    const lang = t('jr.look.title');
    if (lang === lastLang) return;
    lastLang = lang;
    for (const e of svg.querySelectorAll('[data-k]')) e.textContent = t(e.getAttribute('data-k')!);
  };

  const drawMap = (p: any, now: number) => {
    drawLabels();
    setText(lookHint, t('jr.look.hint'));
    setText(lookTitle, t('jr.look.title'));
    setText(lookKeys, t('jr.look.keys'));
    for (let i = 0; i < roomEls.length; i++) roomEls[i].classList.toggle('on', markers[i].until > now);
    const gs = o.guards?.positions?.() ?? [];
    for (let i = 0; i < guardEls.length; i++) {
      const e = guardEls[i];
      const g = gs[i];
      if (!g) {
        e.setAttribute('visibility', 'hidden');
        continue;
      }
      e.setAttribute('visibility', 'visible');
      e.setAttribute('transform', `translate(${g.x.toFixed(2)} ${g.z.toFixed(2)}) rotate(${((-g.yaw * 180) / Math.PI).toFixed(1)})`);
      e.setAttribute('class', 'jr-guard st' + (g.state | 0));
    }
    let n = 0;
    const s = session!;
    for (const seat of p.seats ?? []) {
      if (n >= crewEls.length) break;
      if (!seat.pid || !freeInside(p, seat.role)) continue;
      const pose = s.poseOf(seat.pid);
      if (!pose) continue;
      const e = crewEls[n++];
      e.setAttribute('visibility', 'visible');
      e.setAttribute('transform', `translate(${pose.x.toFixed(2)} ${pose.z.toFixed(2)})`);
      const tx = e.lastElementChild!;
      setText(tx, String(seat.name ?? '?').charAt(0).toUpperCase());
    }
    for (; n < crewEls.length; n++) crewEls[n].setAttribute('visibility', 'hidden');
  };

  const policeLine = (p: any) => {
    const R = p.run;
    if (!R.alarmKnown) {
      alarmT = null;
      return null;
    }
    if (alarmT === null) {
      alarmT = R.t;
      // the beat that told the crew of the alarm (a late joiner finds it there)
      for (const b of R.beats ?? []) {
        if ((b.lines ?? []).some((l: any) => /^ln\.(alarm|scannerSilent|policeIn)/.test(l?.x?.k ?? ''))) {
          alarmT = Math.min(alarmT!, Number(b.t0) || R.t);
          break;
        }
      }
    }
    const kn = p.known?.police;
    const base = kn ? VARGA.policeMin[kn.v] : undefined;
    if (base === undefined) return t('jr.drv.policeUnknown');
    const mins = Math.max(3, base + (STAKES[p.stake as keyof typeof STAKES]?.police ?? 0));
    const left = mins - (R.t - (alarmT ?? R.t));
    return left > 0 ? t('jr.drv.police', { n: left }) : t('jr.drv.policeNow');
  };

  const drawClock = (p: any, dt: number) => {
    const R = p.run;
    setText(drvHint, t('jr.drv.hint'));
    setText(drvTitle, t('jr.drv.title'));
    setText(drvMin, t('jr.drv.minute', { n: R.t }));
    const left = R.windowEnd - R.t;
    drvBig.classList.toggle('due', left <= 0);
    drvBig.classList.toggle('warn', left > 0 && left <= 3);
    setText(drvBigN, left > 0 ? String(left) : '0');
    setText(drvBigL, left > 0 ? t('jr.drv.round') : t('jr.drv.roundNow'));
    const pol = policeLine(p);
    drvAlarm.classList.toggle('hidden', pol === null);
    if (pol !== null) {
      setText(drvAlarm.firstElementChild!, t('jr.drv.alarm'));
      setText(drvAlarm.lastElementChild!, pol);
    }
    // the horn: hold H for 1.5 s, once per job
    const inp = deps.input;
    const holding = !honkDone && !honkNeedRelease && inp.codeHeld('KeyH') && !busy();
    if (!inp.codeHeld('KeyH')) honkNeedRelease = false;
    honkHeld = holding ? honkHeld + dt : 0;
    if (honkHeld >= HONK_HOLD) {
      honkHeld = 0;
      honkNeedRelease = true;
      honkDone = true; // optimistic: the host allows one per job
      session?.intent('jr.honk', {});
    }
    drvHonk.classList.toggle('done', honkDone);
    setText(drvHonkT, t(honkDone ? 'jr.drv.honked' : 'jr.drv.honk'));
    drvHonkBar.style.width = `${Math.min(100, (honkHeld / HONK_HOLD) * 100).toFixed(0)}%`;
  };

  const drawMarkers = (p: any, now: number, time: number, insideMe: boolean) => {
    const k = 0.5 + 0.5 * Math.sin(time * 7);
    warnMat.opacity = 0.55 + 0.4 * k;
    beamMat.opacity = 0.12 + 0.14 * k;
    for (const m of markers) {
      const on = insideMe && m.until > now;
      if (on) {
        m.g.position.copy(m.g.userData.home as THREE.Vector3);
        const sc = 0.85 + 0.35 * k;
        m.ringM.scale.set(sc, 1, sc);
        m.gem.rotation.y = time * 2;
        m.gem.position.y = 2.4 + 0.12 * Math.sin(time * 3);
      } else if (m.g.position.y > -100) m.g.position.set(0, -500, 0);
    }
    void p;
  };

  const drawCoins = (dt: number) => {
    for (const c of coins) {
      if (c.t < 0) continue;
      c.t += dt / COIN_FLIGHT;
      const k = Math.min(1, c.t);
      c.m.position.lerpVectors(c.a, c.b, k);
      c.m.position.y += Math.sin(k * Math.PI) * Math.min(2.2, 0.35 + c.a.distanceTo(c.b) * 0.18);
      c.m.rotation.x += dt * 22;
      if (k >= 1) {
        c.m.position.copy(c.b);
        c.m.rotation.set(0, c.m.rotation.y, 0);
        if (!c.clinked) {
          c.clinked = true;
          clink(c.b.x, c.b.y, c.b.z);
        }
        // the coin lies there a little while, then goes back to the pool
        if (c.t > 1 + 6 / COIN_FLIGHT) {
          c.t = -1;
          c.m.position.set(0, -500, 0);
        }
      }
    }
  };

  const drawFeed = (dt: number) => {
    if (feedLeft > 0) feedLeft -= dt * (feedQ.length ? 1.6 : 1);
    if (feedLeft <= 0) {
      const next = feedQ.shift();
      if (next !== undefined) {
        feedCur = next;
        feedLeft = FEED_S;
        feed.classList.remove('hidden');
        feed.classList.remove('in');
        void feed.offsetWidth;
        feed.classList.add('in');
        setText(feed, next);
      } else if (feedCur) {
        feedCur = '';
        feed.classList.add('hidden');
      }
    }
  };

  // ================================================================ API
  const api: Roles = {
    attach(s) {
      session = s;
      job = null;
      lastPingSent = -1e9;
      lastPingBy.clear();
      unsubs.push(s.onEvent(onEvent));
      if (s.isHost) hostHandlers(s);
    },
    detach() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      if (session?.isHost) for (const n of ['jr.ping', 'jr.honk', 'jr.coin']) session.handle(n, () => {});
      session = null;
      job = null;
      hideAll();
      feedQ.length = 0;
      feedCur = '';
      feed.classList.add('hidden');
      for (const c of coins) {
        c.t = -1;
        c.m.position.set(0, -500, 0);
      }
    },
    update(dt, time) {
      const s = session;
      const p = plan();
      drawCoins(dt);
      drawFeed(dt);
      if (!s || !live(p)) {
        if (job !== null) {
          job = null;
          hideAll();
        }
        return;
      }
      if (job !== p.job) resetRun(p);
      const now = s.hostNow();
      const me = seatOf(p, s.pid)?.role ?? null;
      const post = postOf(p, me);
      const caught = !!me && p.run.status?.[me] === 'caught';
      const insideMe = freeInside(p, me);
      // lookout
      const isLook = post === 'lookout' && !caught;
      look.classList.toggle('hidden', !isLook);
      if (isLook) {
        mapT += dt;
        if (mapT >= 1 / MAP_HZ) {
          mapT = 0;
          drawMap(p, now);
        }
        if (!busy()) {
          const inp = deps.input;
          for (let i = 0; i < M.rooms.length && i < 9; i++) if (inp.codePressed('Digit' + (i + 1)) || inp.codePressed('Numpad' + (i + 1))) ping(i);
        }
      }
      // driver
      const isDrv = post === 'driver' && !caught;
      drv.classList.toggle('hidden', !isDrv);
      if (isDrv) drawClock(p, dt);
      // vanguard
      const canThrow = mayThrow(p, s.pid);
      if (canThrow && !busy() && deps.input.codePressed('KeyG')) throwCoin();
      const cdLeft = (coinUntil - now) / 1000;
      ring.classList.toggle('hidden', !canThrow || cdLeft <= 0);
      if (canThrow && cdLeft > 0) ringFg.style.strokeDashoffset = String(100 - Math.min(100, (100 * cdLeft) / coinCd));
      if (coinHintLeft > 0) coinHintLeft -= dt;
      drawMarkers(p, now, time, insideMe);
    },
    debug() {
      const s = session;
      const p = plan();
      const now = s?.hostNow() ?? 0;
      const vis = (e: Element) => e.getAttribute('visibility') === 'visible';
      return {
        map: !look.classList.contains('hidden'),
        clock: !drv.classList.contains('hidden'),
        ring: !ring.classList.contains('hidden'),
        feed: feed.classList.contains('hidden') ? '' : feed.textContent,
        guardsOnMap: guardEls.filter(vis).map((e) => e.getAttribute('transform')),
        crewOnMap: crewEls.filter(vis).map((e) => e.lastElementChild!.textContent),
        markers: markers.map((m, i) => (m.g.position.y > -100 ? M.rooms[i].id : null)).filter(Boolean),
        roomsLit: roomEls.map((e, i) => (e.classList.contains('on') ? M.rooms[i].id : null)).filter(Boolean),
        bigNumber: drvBigN.textContent,
        minute: drvMin.textContent,
        honkDone,
        coinCooldown: Math.max(0, (coinUntil - now) / 1000),
        canThrow: !!s && live(p) && mayThrow(p, s.pid),
        busy: busy(),
        ...dbg,
        lines: dbg.lines.slice(),
      };
    },
  };
  (window as unknown as { __nvRoles?: Roles }).__nvRoles = api;
  return api;
}
