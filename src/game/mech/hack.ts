// Hacking terminals: three two-terminal mini-games (Trace, Signal, Cipher).
//
// A level adds stations (one puzzle each) and terminals (in-world consoles).
// Every station has an input terminal (side 'a') and an information terminal
// (side 'b'): the player at 'a' needs what only 'b' shows, so the crew has to
// talk. Rules and generators live in hack-logic.ts; this file is the host
// wiring, the in-world screens, the keyboard overlay and the sounds.
//
// State is replicated under `hack.<station>` and only changes through the
// `hack.move` intent, which the host validates. Screens and the overlay draw
// from `hackView(state, side)`, which holds nothing of the other side's secret.
import './hack.css';
import * as THREE from 'three';
import { FONT, MONO, type Builder, type ScreenHandle } from '../build';
import type { MaterialLib } from '../materials';
import type { Interactions } from '../interact';
import type { Player } from '../player';
import type { Session } from '../../net/session';
import type { Input } from '../../core/input';
import type { AudioEngine } from '../../core/audio';
import { t, registerStrings, onLangChange } from '../../core/i18n';
import { h } from '../../ui/ui';
import * as L from './hack-logic';

registerStrings(
  {
    'hk.prompt': 'open {name}',
    'hk.term': 'TERMINAL',
    'hk.name.trace.a': 'Trace router',
    'hk.name.trace.b': 'Trace ICE map',
    'hk.name.signal.a': 'Signal tuner',
    'hk.name.signal.b': 'Signal scope',
    'hk.name.cipher.a': 'Cipher keypad',
    'hk.name.cipher.b': 'Cipher key table',
    'hk.hint.trace.a': 'Rotate tiles until the current runs from IN to OUT. ICE cells must stay dark, and only the ICE map shows where they are.',
    'hk.hint.trace.b': 'Red cells are ICE: the current must never touch them. Tell the router which cells to avoid.',
    'hk.hint.signal.a': 'Turn the dials until your wave sits on the target wave. Only the scope shows the target.',
    'hk.hint.signal.b': 'Amber is the target, teal is the tuner. Talk the tuner onto the amber wave and hold it there.',
    'hk.hint.cipher.a': 'Describe these symbols to whoever reads the key table, type the digits they give you, then confirm.',
    'hk.hint.cipher.b': 'Every symbol stands for a digit. The keypad asks for symbols: read out their digits.',
    'hk.tag.trace.a': 'Route IN to OUT. Keep ICE dark.',
    'hk.tag.trace.b': 'Red = ICE. Warn the router.',
    'hk.tag.signal.a': 'Match the target wave.',
    'hk.tag.signal.b': 'Amber = target. Guide the tuner.',
    'hk.tag.cipher.a': 'Get a digit for every symbol.',
    'hk.tag.cipher.b': 'Symbol = digit. Read them out.',
    'hk.k.move': 'move',
    'hk.k.rot': 'rotate',
    'hk.k.rotBack': 'rotate back',
    'hk.k.dial': 'pick dial',
    'hk.k.turn': 'turn',
    'hk.k.type': 'type',
    'hk.k.del': 'delete',
    'hk.k.ok': 'confirm',
    'hk.k.leave': 'leave',
    'hk.k.view': 'Display only: the controls are on the other terminal',
    'hk.strikes': 'STRIKES {n}',
    'hk.strikesOf': 'STRIKES {n}/{max}',
    'hk.solved': 'ACCESS GRANTED',
    'hk.standby': 'STANDBY',
    'hk.iceHit': 'ICE TRIPPED',
    'hk.iceList': 'ICE {list}',
    'hk.lastHit': 'LAST TRIPPED {cell}',
    'hk.in': 'IN',
    'hk.out': 'OUT',
    'hk.lock': 'LOCK',
    'hk.locking': 'LOCKING',
    'hk.locked': 'LOCKED',
    'hk.nolock': 'NO MATCH',
    'hk.match': 'MATCH',
    'hk.target': 'TARGET',
    'hk.tuner': 'TUNER',
    'hk.dial.freq': 'FREQUENCY',
    'hk.dial.amp': 'AMPLITUDE',
    'hk.dial.phase': 'PHASE',
    'hk.code': 'CODE',
    'hk.entry': 'ENTRY',
    'hk.wrong': 'WRONG CODE',
    'hk.reroll': 'NEW CODE',
    'hk.dark': 'KEY TABLE OFFLINE',
    'hk.darkSub': 'back in a moment',
  },
  {
    'hk.prompt': '{name} öffnen',
    'hk.term': 'TERMINAL',
    'hk.name.trace.a': 'Trace-Router',
    'hk.name.trace.b': 'Trace-ICE-Karte',
    'hk.name.signal.a': 'Signal-Tuner',
    'hk.name.signal.b': 'Signal-Oszilloskop',
    'hk.name.cipher.a': 'Cipher-Tastenfeld',
    'hk.name.cipher.b': 'Cipher-Schlüsseltabelle',
    'hk.hint.trace.a': 'Dreh die Kacheln, bis der Strom von IN nach OUT fließt. ICE-Felder müssen dunkel bleiben, und nur die ICE-Karte zeigt, wo sie liegen.',
    'hk.hint.trace.b': 'Rote Felder sind ICE: Der Strom darf sie nie berühren. Sag dem Router, welche Felder er meiden muss.',
    'hk.hint.signal.a': 'Dreh an den Reglern, bis deine Welle auf der Zielwelle liegt. Das Ziel zeigt nur das Oszilloskop.',
    'hk.hint.signal.b': 'Orange ist das Ziel, Türkis der Tuner. Lots den Tuner auf die orange Welle, dann haltet sie dort.',
    'hk.hint.cipher.a': 'Beschreib diese Symbole dem, der die Schlüsseltabelle liest, tipp die Ziffern, die du bekommst, und bestätige.',
    'hk.hint.cipher.b': 'Jedes Symbol steht für eine Ziffer. Das Tastenfeld fragt nach Symbolen: Sag die Ziffern dazu durch.',
    'hk.tag.trace.a': 'Von IN nach OUT. ICE bleibt dunkel.',
    'hk.tag.trace.b': 'Rot = ICE. Warn den Router.',
    'hk.tag.signal.a': 'Triff die Zielwelle.',
    'hk.tag.signal.b': 'Orange = Ziel. Lots den Tuner.',
    'hk.tag.cipher.a': 'Hol dir zu jedem Symbol die Ziffer.',
    'hk.tag.cipher.b': 'Symbol = Ziffer. Sag sie durch.',
    'hk.k.move': 'bewegen',
    'hk.k.rot': 'drehen',
    'hk.k.rotBack': 'zurückdrehen',
    'hk.k.dial': 'Regler wählen',
    'hk.k.turn': 'drehen',
    'hk.k.type': 'tippen',
    'hk.k.del': 'löschen',
    'hk.k.ok': 'bestätigen',
    'hk.k.leave': 'verlassen',
    'hk.k.view': 'Nur Anzeige: Gesteuert wird am anderen Terminal',
    'hk.strikes': 'FEHLER {n}',
    'hk.strikesOf': 'FEHLER {n}/{max}',
    'hk.solved': 'ZUGRIFF GEWÄHRT',
    'hk.standby': 'BEREIT',
    'hk.iceHit': 'ICE AUSGELÖST',
    'hk.iceList': 'ICE {list}',
    'hk.lastHit': 'ZULETZT AUSGELÖST {cell}',
    'hk.in': 'IN',
    'hk.out': 'OUT',
    'hk.lock': 'LOCK',
    'hk.locking': 'RASTET EIN',
    'hk.locked': 'EINGERASTET',
    'hk.nolock': 'KEIN TREFFER',
    'hk.match': 'DECKUNG',
    'hk.target': 'ZIEL',
    'hk.tuner': 'TUNER',
    'hk.dial.freq': 'FREQUENZ',
    'hk.dial.amp': 'AMPLITUDE',
    'hk.dial.phase': 'PHASE',
    'hk.code': 'CODE',
    'hk.entry': 'EINGABE',
    'hk.wrong': 'FALSCHER CODE',
    'hk.reroll': 'NEUER CODE',
    'hk.dark': 'TABELLE OFFLINE',
    'hk.darkSub': 'kommt gleich wieder',
  },
);

const C = {
  bg: '#03070b',
  teal: '#35e6d0',
  amber: '#ffa23a',
  red: '#ff4d5e',
  green: '#5dff8f',
  dim: '#7f95a3',
  ink: '#e9eff3',
  off: '#465563',
  faint: 'rgba(255,255,255,0.07)',
  line: 'rgba(255,255,255,0.18)',
};
const TEAL = 0x35e6d0;
const AMBER = 0xffa23a;
const COLS = 'ABCDEFGH';
const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];
/** How close (to the spot in front of an input terminal) a player has to be for the host to accept a move. */
const REACH = 3.5;

/** The 18 cipher symbols: 6 families of 3 look-alikes, on a 100x100 box. `s` is stroked, `f` filled. */
const GLYPH_SRC: { s: string; f?: string }[] = [
  { s: 'M50 14A36 36 0 1 1 49.9 14Z' },
  { s: 'M50 14A36 36 0 1 1 49.9 14Z', f: 'M50 38A12 12 0 1 1 49.9 38Z' },
  { s: 'M50 14A36 36 0 1 1 49.9 14Z M50 4V96' },
  { s: 'M50 12L90 84H10Z' },
  { s: 'M50 88L90 16H10Z' },
  { s: 'M50 12L90 84H10Z M27 56H73' },
  { s: 'M16 16H84V84H16Z' },
  { s: 'M16 16H84V84H16Z M16 84L84 16' },
  { s: 'M16 16H84V84H16Z M16 16L84 84 M16 84L84 16' },
  { s: 'M50 10V90 M10 50H90' },
  { s: 'M18 18L82 82 M82 18L18 82' },
  { s: 'M50 8V92 M8 50H92 M21 21L79 79 M79 21L21 79' },
  { s: 'M10 72L37 28L63 72L90 28' },
  { s: 'M8 50C22 6 38 6 50 50S78 94 92 50' },
  { s: 'M8 72L29 28L50 72L71 28L92 72' },
  { s: 'M50 92V10 M50 10L22 42 M50 10L78 42' },
  { s: 'M50 92V48 M50 48L20 10 M50 48L80 10' },
  { s: 'M50 92V10 M20 12V38Q20 58 50 58Q80 58 80 38V12' },
];
let glyphs: { s: Path2D; f: Path2D | null }[] | null = null;
function glyphPaths() {
  glyphs ??= GLYPH_SRC.map((g) => ({ s: new Path2D(g.s), f: g.f ? new Path2D(g.f) : null }));
  return glyphs;
}

export interface HackDeps {
  builder: Builder;
  mats: MaterialLib;
  interactions: Interactions;
  audio: AudioEngine;
  input: Input;
  player(): Player | null;
  diff: L.Diff;
  /** Fixed puzzle seed (URL `seed=`), for tests and screenshots. Random otherwise. */
  seed?: number;
}

interface Station {
  id: string;
  kind: L.GameKind;
  index: number;
  terms: Terminal[];
}

interface Terminal {
  id: string;
  station: Station;
  side: L.Side;
  /** Screen centre: where its sounds come from. */
  pos: THREE.Vector3;
  /** The spot in front of it. */
  stand: THREE.Vector3;
  yaw: number;
  screen: ScreenHandle | null;
  view: L.HackView | null;
  dirty: boolean;
  /** Time-driven display state (drift step, table on/off): a change means redraw. */
  phase: number;
  /** Seconds left of the red strike flash. */
  flash: number;
}

interface DrawOpts {
  cursor: number;
  sel: number;
  now: number;
  /** The overlay (large, with glow) rather than the in-world screen. */
  big: boolean;
}

type Sound = 'move' | 'rot' | 'key' | 'dial' | 'lock' | 'unlock' | 'strike' | 'reroll' | 'solved' | 'open' | 'close' | 'nope';

export class HackSystem {
  /** Called on every peer when a station is solved. */
  onSolved: ((station: string) => void) | null = null;
  /** Called on the host only, right after it marked a station solved. */
  onHostSolved: ((station: string) => void) | null = null;

  private stations = new Map<string, Station>();
  private stationList: Station[] = [];
  private terms: Terminal[] = [];
  private labels: { redraw(): void }[] = [];
  private session: Session | null = null;
  private unsubs: (() => void)[] = [];
  private time = 0;

  // overlay
  private el: HTMLElement;
  private titleEl = h('span', { class: 'hk-title' });
  private statusEl = h('span', { class: 'hk-status' });
  private hintEl = h('div', { class: 'hk-hint' });
  private keysEl = h('div', { class: 'hk-keys' });
  private canvas = h('canvas');
  private ctx: CanvasRenderingContext2D;
  private open: Terminal | null = null;
  private ovDirty = false;
  private skipInput = false;
  private closeAt = -1;
  private strikeAnim = 0;
  private cursor = new Map<string, number>();
  private sel = new Map<string, number>();
  private repKey = '';
  private repT = 0;

  constructor(private d: HackDeps) {
    this.ctx = this.canvas.getContext('2d')!;
    this.el = h(
      'div',
      { class: 'hack hidden' },
      h('div', { class: 'hk-head' }, h('span', { class: 'label' }, t('hk.term')), this.titleEl, this.statusEl),
      this.hintEl,
      h('div', { class: 'hk-board' }, this.canvas),
      this.keysEl,
    );
    const root = document.getElementById('ui');
    if (root) root.insertBefore(this.el, root.querySelector('.menu')); // below the pause menu
    onLangChange(() => this.redraw());
    window.addEventListener('resize', () => (this.ovDirty = true));
  }

  // ------------------------------------------------------------------ building

  addStation(id: string, kind: L.GameKind) {
    const station: Station = { id, kind, index: this.stations.size, terms: [] };
    this.stations.set(id, station);
    this.stationList.push(station);
  }

  /**
   * Build a console at (x, z): a screen facing `rotY` (0 = towards +z) above a
   * desk, mounted on whatever is behind it. Call before `builder.finalize()`.
   * Returns the interaction id (`hack-<station>-<side>`).
   */
  addTerminal(stationId: string, side: L.Side, x: number, z: number, rotY: number): string {
    const station = this.stations.get(stationId);
    if (!station) throw new Error('unknown hack station ' + stationId);
    const b = this.d.builder;
    const m = this.d.mats;
    const nx = Math.sin(rotY);
    const nz = Math.cos(rotY);
    const accent = side === 'a' ? TEAL : AMBER;
    const id = `hack-${stationId}-${side}`;
    const term: Terminal = {
      id,
      station,
      side,
      pos: new THREE.Vector3(x + nx * 0.1, 1.55, z + nz * 0.1),
      stand: new THREE.Vector3(x + nx * 1.05, 0, z + nz * 1.05),
      yaw: rotY,
      screen: null,
      view: null,
      dirty: true,
      phase: -1,
      flash: 0,
    };
    // housing, desk, a strip of light in the terminal's colour
    b.box(m.darkMetal, 1.38, 0.94, 0.08, x + nx * 0.04, 1.55, z + nz * 0.04, { rotY, collide: false, round: 0.02, tile: 1 });
    b.box(m.black, 1.27, 0.82, 0.02, x + nx * 0.082, 1.55, z + nz * 0.082, { rotY, collide: false, shadow: false });
    b.box(m.darkMetal, 1.38, 0.92, 0.5, x + nx * 0.25, 0.46, z + nz * 0.25, { rotY, round: 0.03, tile: 1 });
    b.box(m.black, 1.22, 0.02, 0.34, x + nx * 0.27, 0.93, z + nz * 0.27, { rotY, collide: false, shadow: false });
    b.glowBox(accent, 0.46, 0.008, 0.13, x + nx * 0.3, 0.944, z + nz * 0.3, 0.7, rotY);
    b.glowBox(accent, 1.2, 0.016, 0.02, x + nx * 0.09, 1.135, z + nz * 0.09, 3, rotY);
    b.glowBox(accent, 0.02, 0.6, 0.02, x + nx * 0.51, 0.5, z + nz * 0.51, 1.6, rotY);
    term.screen = b.screen(1.2, 0.75, x + nx * 0.095, 1.55, z + nz * 0.095, rotY, 500, (ctx, w, hh) => this.drawScreen(term, ctx, w, hh));
    this.labels.push(
      b.decal(
        1.2,
        0.13,
        x + nx * 0.02,
        2.09,
        z + nz * 0.02,
        rotY,
        320,
        (ctx, w, hh) => {
          ctx.fillStyle = side === 'a' ? C.teal : C.amber;
          ctx.font = `600 ${hh * 0.7}px ${FONT}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(t(`hk.name.${station.kind}.${side}`).toUpperCase(), 4, hh / 2, w - 8);
        },
        1.5,
      ),
    );
    this.d.interactions.add({
      id,
      object: term.screen.mesh,
      range: 2.5,
      prompt: () => {
        if (!this.session || this.open) return null;
        const st = this.state(stationId);
        return st && !st.solved ? t('hk.prompt', { name: t(`hk.name.${station.kind}.${side}`) }) : null;
      },
      onUse: () => this.openTerminal(term),
    });
    station.terms.push(term);
    this.terms.push(term);
    return id;
  }

  // ------------------------------------------------------------------ state

  /** Read straight from the replicated tree: this runs for every terminal every frame. */
  private state(id: string): L.HackState | undefined {
    const all = this.session?.state.hack as Record<string, L.HackState> | undefined;
    return all ? all[id] : undefined;
  }

  solved(id: string): boolean {
    return !!this.state(id)?.solved;
  }

  solvedCount(): number {
    let n = 0;
    for (const st of this.stationList) if (this.solved(st.id)) n++;
    return n;
  }

  allSolved(): boolean {
    return this.stations.size > 0 && this.solvedCount() === this.stations.size;
  }

  /** Wrong moves over all stations. */
  strikes(): number {
    let n = 0;
    for (const station of this.stationList) {
      const st = this.state(station.id);
      if (st) n += L.hackStrikes(st);
    }
    return n;
  }

  stationIds(): string[] {
    return this.stationList.map((st) => st.id);
  }

  kindOf(id: string): L.GameKind | undefined {
    return this.stations.get(id)?.kind;
  }

  isOpen(): boolean {
    return this.open !== null;
  }

  // ------------------------------------------------------------------ session

  attach(s: Session) {
    this.session = s;
    if (s.isHost) {
      if (!s.get('hack')) {
        const seed = this.d.seed ?? (Math.random() * 0x100000000) >>> 0;
        const now = s.hostNow();
        const all: Record<string, L.HackState> = {};
        for (const st of this.stationList) all[st.id] = L.hackGenerate(st.kind, L.mix(seed, st.index + 1), this.d.diff, now);
        s.set('hack', all);
      }
      s.handle('hack.move', (pid, a) => this.hostMove(s, pid, a));
    }
    this.unsubs.push(
      s.onState((path) => {
        if (path === '' || path === 'hack') for (const term of this.terms) term.dirty = true;
        else if (path.startsWith('hack.')) {
          const st = this.stations.get(path.split('.')[1]);
          if (st) for (const term of st.terms) term.dirty = true;
        }
      }),
      s.onEvent((name, a) => {
        if (name === 'hack.fx') this.onFx(s, a);
      }),
    );
    for (const term of this.terms) term.dirty = true;
  }

  detach() {
    this.closeTerminal(false);
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.session = null;
    for (const term of this.terms) {
      term.dirty = true;
      term.flash = 0;
    }
  }

  /** Host: one move from one player. Everything about it is checked here. */
  private hostMove(s: Session, pid: string, a: any) {
    if (!a || typeof a !== 'object' || typeof a.s !== 'string') return;
    const station = this.stations.get(a.s);
    const cur = station && this.state(station.id);
    if (!station || !cur || cur.solved) return;
    // the player has to stand at an input terminal of this station
    const pose = s.poseOf(pid);
    if (pose) {
      let near = false;
      for (const term of station.terms) {
        if (term.side !== 'a') continue;
        const dx = pose.x - term.stand.x;
        const dz = pose.z - term.stand.z;
        if (dx * dx + dz * dz <= REACH * REACH) near = true;
      }
      if (!near) return;
    }
    const { state, result } = L.hackApply(cur, a, s.hostNow());
    if (result === 'invalid') return;
    s.set('hack.' + station.id, state);
    s.emit('hack.fx', { s: station.id, k: result, by: pid });
    if (state.solved) this.onHostSolved?.(station.id);
  }

  /** Host: what the clock does on its own (the signal lock). */
  private hostTick(s: Session, now: number) {
    for (const station of this.stationList) {
      if (station.kind !== 'signal') continue;
      const cur = this.state(station.id);
      if (!cur || cur.kind !== 'signal' || cur.solved) continue;
      const res = L.signalCheck(cur, now);
      if (res === 'none') continue;
      const next = L.signalTick(cur, now).state;
      s.set('hack.' + station.id, next);
      s.emit('hack.fx', { s: station.id, k: res, by: '' });
      if (next.solved) this.onHostSolved?.(station.id);
    }
  }

  private onFx(s: Session, a: any) {
    const station = this.stations.get(String(a?.s));
    if (!station) return;
    const term = station.terms.find((x) => x.side === 'a') ?? station.terms[0];
    const pos = term?.pos;
    const mine = a.by === s.pid; // the player who pressed the key already heard the click
    switch (a.k as L.HackResult) {
      case 'ok':
        if (!mine) this.sfx(station.kind === 'trace' ? 'rot' : 'dial', pos);
        break;
      case 'key':
      case 'back':
        if (!mine) this.sfx('key', pos);
        break;
      case 'lock':
        this.sfx('lock', pos);
        break;
      case 'unlock':
        this.sfx('unlock', pos);
        break;
      case 'strike':
      case 'reroll':
        for (const x of station.terms) {
          x.flash = 0.8;
          x.dirty = true;
        }
        this.sfx(a.k === 'reroll' ? 'reroll' : 'strike', pos);
        if (this.open?.station === station) {
          this.strikeAnim = 0.45;
          this.el.classList.add('strike');
        }
        break;
      case 'solved':
        this.sfx('solved', pos);
        if (this.open?.station === station) this.closeAt = this.time + 1.9;
        this.onSolved?.(station.id);
        break;
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, time: number) {
    this.time = time;
    const s = this.session;
    const now = s ? s.hostNow() : 0;
    if (s?.isHost) this.hostTick(s, now);
    for (const term of this.terms) {
      if (term.flash > 0) {
        term.flash -= dt;
        if (term.flash <= 0) term.dirty = true;
      }
      const st = s ? this.state(term.station.id) : undefined;
      const phase = st ? this.phaseOf(st, term.side, now) : -1;
      if (phase !== term.phase) {
        term.phase = phase;
        term.dirty = true;
      }
      if (term.dirty) {
        term.dirty = false;
        term.view = st ? L.hackView(st, term.side, now) : null;
        term.screen?.redraw();
        if (term === this.open) this.ovDirty = true;
      }
    }
    if (this.open) this.updateOverlay(dt, now);
  }

  /** Things that change with the clock alone (no state message): the drifting target, the blinking table. */
  private phaseOf(st: L.HackState, side: L.Side, now: number): number {
    if (side === 'a') return 0;
    if (st.kind === 'signal') return L.signalDriftIndex(st, now);
    if (st.kind === 'cipher') return L.cipherVisible(st, now) ? 1 : 0;
    return 0;
  }

  /** Redraw every text surface (language change, fonts loaded). */
  redraw() {
    for (const term of this.terms) term.dirty = true;
    for (const l of this.labels) l.redraw();
    if (this.open) this.renderChrome(this.open);
  }

  // ------------------------------------------------------------------ overlay

  private openTerminal(term: Terminal) {
    const player = this.d.player();
    if (!this.session || !player || this.open) return;
    this.open = term;
    player.frozen = true;
    this.skipInput = true; // the E that opened it is not a move
    this.closeAt = -1;
    this.repKey = '';
    this.el.classList.remove('hidden', 'strike');
    this.el.classList.toggle('side-b', term.side === 'b');
    this.el.parentElement?.classList.add('hk-open'); // makes room: see hack.css
    this.renderChrome(term);
    this.ovDirty = true;
    this.sfx('open');
  }

  private closeTerminal(sound = true) {
    if (!this.open) return;
    this.open = null;
    this.el.classList.add('hidden');
    this.el.parentElement?.classList.remove('hk-open');
    const player = this.d.player();
    if (player) player.frozen = false;
    if (sound) this.sfx('close');
  }

  private renderChrome(term: Terminal) {
    const kind = term.station.kind;
    this.titleEl.textContent = t(`hk.name.${kind}.${term.side}`);
    this.hintEl.textContent = t(`hk.hint.${kind}.${term.side}`);
    const key = (caps: string[], label: string) => h('span', { class: 'hk-key' }, ...caps.map((c) => h('span', { class: 'keycap' }, c)), h('span', {}, t(label)));
    const nodes: Node[] = [];
    if (term.side === 'b') nodes.push(h('span', { class: 'hk-view' }, t('hk.k.view')));
    else if (kind === 'trace') nodes.push(key(['W', 'A', 'S', 'D'], 'hk.k.move'), key(['E'], 'hk.k.rot'), key(['R'], 'hk.k.rotBack'));
    else if (kind === 'signal') nodes.push(key(['W', 'S'], 'hk.k.dial'), key(['A', 'D'], 'hk.k.turn'));
    else {
      const st = this.state(term.station.id);
      const keys = st?.kind === 'cipher' ? L.CIPHER_CFG[st.diff].table : 9;
      nodes.push(key(['1', '–', String(keys)], 'hk.k.type'), key(['⌫'], 'hk.k.del'), key(['E'], 'hk.k.ok'));
    }
    const leave = key(['Q'], 'hk.k.leave');
    leave.classList.add('hk-leave');
    nodes.push(leave);
    this.keysEl.replaceChildren(...nodes);
  }

  private pressed(a: string, b: string): boolean {
    return this.d.input.codePressed(a) || this.d.input.codePressed(b);
  }

  /** Pressed, or held long enough to repeat. */
  private stepKey(a: string, b: string, dt: number): boolean {
    const input = this.d.input;
    if (input.codePressed(a) || input.codePressed(b)) {
      this.repKey = a;
      this.repT = 0.34;
      return true;
    }
    if (this.repKey === a) {
      if (!input.codeHeld(a) && !input.codeHeld(b)) this.repKey = '';
      else {
        this.repT -= dt;
        if (this.repT <= 0) {
          this.repT = 0.1;
          return true;
        }
      }
    }
    return false;
  }

  private updateOverlay(dt: number, now: number) {
    const term = this.open!;
    const player = this.d.player();
    const s = this.session;
    if (!player || !s) {
      this.closeTerminal(false);
      return;
    }
    player.frozen = true;
    if (this.closeAt >= 0 && this.time >= this.closeAt) {
      this.closeTerminal(false);
      return;
    }
    if (this.strikeAnim > 0) {
      this.strikeAnim -= dt;
      if (this.strikeAnim <= 0) this.el.classList.remove('strike');
    }
    const st = this.state(term.station.id);
    if (this.skipInput) this.skipInput = false;
    else {
      if (this.d.input.codePressed('KeyQ')) {
        this.closeTerminal();
        return;
      }
      if (st && !st.solved && term.side === 'a') this.keys(s, term, st, dt);
    }
    const v = term.view;
    const animating = !!v && v.game === 'signal' && v.lockSince !== null && !v.solved;
    if (this.ovDirty || animating) {
      this.ovDirty = false;
      this.drawOverlay(term, now);
    }
  }

  private keys(s: Session, term: Terminal, st: L.HackState, dt: number) {
    const id = term.station.id;
    const input = this.d.input;
    if (st.kind === 'trace') {
      const n = st.n;
      let c = Math.min(this.cursor.get(id) ?? st.src * n, n * n - 1);
      const before = c;
      if (this.stepKey('KeyW', 'ArrowUp', dt) && c >= n) c -= n;
      if (this.stepKey('KeyS', 'ArrowDown', dt) && c < n * (n - 1)) c += n;
      if (this.stepKey('KeyA', 'ArrowLeft', dt) && c % n > 0) c -= 1;
      if (this.stepKey('KeyD', 'ArrowRight', dt) && c % n < n - 1) c += 1;
      if (c !== before) {
        this.cursor.set(id, c);
        this.ovDirty = true;
        this.sfx('move');
      }
      const dir = input.codePressed('KeyE') ? 1 : input.codePressed('KeyR') ? -1 : 0;
      if (dir) {
        s.intent('hack.move', { s: id, c, d: dir });
        this.sfx('rot');
      }
    } else if (st.kind === 'signal') {
      const count = st.dials.length;
      let sel = Math.min(this.sel.get(id) ?? 0, count - 1);
      const before = sel;
      if (this.pressed('KeyW', 'ArrowUp')) sel = (sel + count - 1) % count;
      if (this.pressed('KeyS', 'ArrowDown')) sel = (sel + 1) % count;
      for (let i = 0; i < count; i++) if (this.pressed('Digit' + (i + 1), 'Numpad' + (i + 1))) sel = i;
      if (sel !== before) {
        this.sel.set(id, sel);
        this.ovDirty = true;
        this.sfx('move');
      }
      const dir = this.stepKey('KeyD', 'ArrowRight', dt) ? 1 : this.stepKey('KeyA', 'ArrowLeft', dt) ? -1 : 0;
      if (dir) {
        const v = st.dials[sel] + dir;
        if (sel !== 2 && (v < 0 || v >= L.signalSteps(st.diff)[sel])) this.sfx('nope');
        else {
          s.intent('hack.move', { s: id, dial: sel, d: dir });
          this.sfx('dial', undefined, 0.8 + 0.4 * (v / L.signalSteps(st.diff)[sel]));
        }
      }
    } else {
      const keys = L.CIPHER_CFG[st.diff].table;
      for (let k = 1; k <= keys; k++) {
        if (!this.pressed('Digit' + k, 'Numpad' + k)) continue;
        if (st.entered.length >= st.code.length) this.sfx('nope');
        else {
          s.intent('hack.move', { s: id, k });
          this.sfx('key', undefined, 1 + k * 0.03);
        }
      }
      if (input.codePressed('Backspace') && st.entered.length) {
        s.intent('hack.move', { s: id, k: 'back' });
        this.sfx('key', undefined, 0.7);
      }
      if (input.codePressed('KeyE')) {
        if (st.entered.length === st.code.length) s.intent('hack.move', { s: id, k: 'ok' });
        else this.sfx('nope');
      }
    }
  }

  private cellName(n: number, c: number): string {
    return COLS[c % n] + (Math.floor(c / n) + 1);
  }

  private statusOf(term: Terminal, v: L.HackView | null): { text: string; tone: '' | 'bad' | 'ok' } {
    if (!v) return { text: t('hk.standby'), tone: '' };
    if (v.solved) return { text: t('hk.solved'), tone: 'ok' };
    if (v.game === 'trace') {
      if (v.side === 'b') {
        const list = v.ice.map((c) => this.cellName(v.n, c)).join(' · ');
        return { text: t('hk.iceList', { list }) + (v.hit >= 0 ? '   ' + t('hk.lastHit', { cell: this.cellName(v.n, v.hit) }) : ''), tone: term.flash > 0 ? 'bad' : '' };
      }
      return { text: term.flash > 0 ? t('hk.iceHit') : t('hk.strikes', { n: v.strikes }), tone: term.flash > 0 ? 'bad' : '' };
    }
    if (v.game === 'signal') return { text: v.lockSince !== null ? t('hk.locking') : t('hk.nolock'), tone: v.lockSince !== null ? 'ok' : '' };
    if (term.flash > 0) return { text: t(v.strikes === 0 ? 'hk.reroll' : 'hk.wrong'), tone: 'bad' };
    return { text: t('hk.strikesOf', { n: v.strikes, max: v.max }), tone: v.strikes > 0 ? 'bad' : '' };
  }

  private drawOverlay(term: Terminal, now: number) {
    const st = this.statusOf(term, term.view);
    if (this.statusEl.textContent !== st.text) this.statusEl.textContent = st.text;
    this.statusEl.className = 'hk-status ' + st.tone;
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr));
    const hh = Math.max(2, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== hh) {
      this.canvas.width = w;
      this.canvas.height = hh;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, hh);
    const v = term.view;
    if (!v) return;
    const pad = w * 0.035;
    const id = term.station.id;
    this.drawBoard(ctx, pad, pad, w - pad * 2, hh - pad * 2, v, { cursor: this.cursor.get(id) ?? (v.game === 'trace' ? v.src * v.n : 0), sel: this.sel.get(id) ?? 0, now, big: true });
    if (v.solved) this.banner(ctx, 0, 0, w, hh);
  }

  // ------------------------------------------------------------------ drawing

  private banner(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number) {
    ctx.fillStyle = 'rgba(3,7,11,0.8)';
    ctx.fillRect(x, y, w, hh);
    ctx.fillStyle = C.green;
    ctx.font = `700 ${Math.min(hh * 0.2, w * 0.085)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('hk.solved'), x + w / 2, y + hh / 2, w * 0.9);
  }

  /** The in-world screen: a small header, the same board the overlay shows (without the cursor), one line of help. */
  private drawScreen(term: Terminal, ctx: CanvasRenderingContext2D, w: number, hh: number) {
    const kind = term.station.kind;
    const accent = term.side === 'a' ? C.teal : C.amber;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = 'rgba(255,255,255,0.016)';
    for (let y = 0; y < hh; y += 6) ctx.fillRect(0, y, w, 2);
    const pad = w * 0.035;
    const head = hh * 0.14;
    const foot = hh * 0.1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = accent;
    ctx.font = `700 ${head * 0.5}px ${FONT}`;
    ctx.fillText(t(`hk.name.${kind}.${term.side}`).toUpperCase(), pad, head * 0.56, w * 0.55);
    const v = term.view;
    const status = this.statusOf(term, v);
    ctx.textAlign = 'right';
    ctx.fillStyle = status.tone === 'bad' ? C.red : status.tone === 'ok' ? C.green : C.dim;
    ctx.font = `500 ${head * 0.36}px ${MONO}`;
    ctx.fillText(status.text, w - pad, head * 0.56, w * 0.42);
    ctx.fillStyle = accent;
    ctx.fillRect(pad, head, w - pad * 2, 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim;
    ctx.font = `500 ${foot * 0.5}px ${FONT}`;
    ctx.fillText(t(`hk.tag.${kind}.${term.side}`), pad, hh - foot * 0.55, w - pad * 2);
    const by = head + pad * 0.7;
    const bh = hh - head - foot - pad * 1.1;
    if (!v) {
      ctx.fillStyle = 'rgba(127,149,163,0.45)';
      ctx.font = `600 ${hh * 0.11}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(t('hk.standby'), w / 2, by + bh / 2);
      return;
    }
    this.drawBoard(ctx, pad, by, w - pad * 2, bh, v, { cursor: -1, sel: -1, now: this.session?.hostNow() ?? 0, big: false });
    if (v.solved) this.banner(ctx, 0, head + 2, w, hh - head - 2);
    if (term.flash > 0) {
      ctx.fillStyle = 'rgba(255,77,94,0.2)';
      ctx.fillRect(0, 0, w, hh);
    }
  }

  private drawBoard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, v: L.HackView, o: DrawOpts) {
    ctx.shadowBlur = 0;
    if (v.game === 'trace') this.drawTrace(ctx, x, y, w, hh, v, o);
    else if (v.game === 'signal') {
      if (v.side === 'a') this.drawTuner(ctx, x, y, w, hh, v, o);
      else this.drawScope(ctx, x, y, w, hh, v, o);
    } else if (v.side === 'a') this.drawKeypad(ctx, x, y, w, hh, v);
    else this.drawTable(ctx, x, y, w, hh, v);
    ctx.shadowBlur = 0;
  }

  private drawTrace(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, v: L.TraceViewA | L.TraceViewB, o: DrawOpts) {
    const n = v.n;
    const lab = Math.min(w, hh) * 0.085;
    const cell = Math.min((hh - lab) / n, (w - lab) / (n + 2));
    const grid = cell * n;
    const port = cell;
    const start = x + (w - (lab + grid + port * 2)) / 2;
    const left = start + lab + port;
    const top = y + lab + (hh - lab - grid) / 2;
    const lw = cell * 0.16;
    const gap = Math.max(1, cell * 0.04);

    // coordinates: letters across, numbers down (both terminals use the same)
    ctx.fillStyle = C.dim;
    ctx.font = `600 ${lab * 0.56}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      ctx.fillText(COLS[i], left + (i + 0.5) * cell, top - lab * 0.5);
      ctx.fillText(String(i + 1), start + lab * 0.5, top + (i + 0.5) * cell);
    }

    // source and sink
    const sy = top + (v.src + 0.5) * cell;
    const ky = top + (v.sink + 0.5) * cell;
    ctx.lineCap = 'butt';
    ctx.lineWidth = lw;
    ctx.strokeStyle = C.teal;
    ctx.fillStyle = C.teal;
    ctx.beginPath();
    ctx.moveTo(left - port * 0.7, sy);
    ctx.lineTo(left, sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(left - port * 0.7, sy, lw * 1.05, 0, Math.PI * 2);
    ctx.fill();
    const outCol = v.sinkOn ? C.green : C.off;
    ctx.strokeStyle = outCol;
    ctx.beginPath();
    ctx.moveTo(left + grid, ky);
    ctx.lineTo(left + grid + port * 0.7 - lw, ky);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, lw * 0.5);
    ctx.beginPath();
    ctx.arc(left + grid + port * 0.7, ky, lw, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `700 ${cell * 0.24}px ${FONT}`;
    ctx.fillStyle = C.teal;
    ctx.fillText(t('hk.in'), left - port * 0.5, sy - cell * 0.3);
    ctx.fillStyle = v.sinkOn ? C.green : C.dim;
    ctx.fillText(t('hk.out'), left + grid + port * 0.5, ky - cell * 0.3);

    for (let i = 0; i < n * n; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.beginPath();
      ctx.roundRect(left + (i % n) * cell + gap, top + Math.floor(i / n) * cell + gap, cell - gap * 2, cell - gap * 2, cell * 0.08);
      ctx.fill();
    }

    if (v.side === 'a') {
      // dark tiles first, live ones on top
      for (let pass = 0; pass < 2; pass++) {
        const col = pass ? C.teal : C.off;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = lw;
        if (pass && o.big) {
          ctx.shadowColor = C.teal;
          ctx.shadowBlur = cell * 0.22;
        }
        ctx.beginPath();
        for (let i = 0; i < n * n; i++) {
          if ((v.on[i] ? 1 : 0) !== pass) continue;
          const cx = left + ((i % n) + 0.5) * cell;
          const cy = top + (Math.floor(i / n) + 0.5) * cell;
          const mask = L.traceMask(v.tiles[i], v.rot[i]);
          for (let d = 0; d < 4; d++) {
            if (!(mask & (1 << d))) continue;
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + DC[d] * cell * 0.5, cy + DR[d] * cell * 0.5);
          }
        }
        ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < n * n; i++) {
          if ((v.on[i] ? 1 : 0) !== pass) continue;
          const cx = left + ((i % n) + 0.5) * cell;
          const cy = top + (Math.floor(i / n) + 0.5) * cell;
          ctx.moveTo(cx + lw * 0.5, cy);
          ctx.arc(cx, cy, lw * 0.5, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (o.cursor >= 0 && o.cursor < n * n) {
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = Math.max(2, cell * 0.06);
        if (o.big) {
          ctx.shadowColor = C.amber;
          ctx.shadowBlur = cell * 0.2;
        }
        ctx.beginPath();
        ctx.roundRect(left + (o.cursor % n) * cell + gap * 0.5, top + Math.floor(o.cursor / n) * cell + gap * 0.5, cell - gap, cell - gap, cell * 0.1);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    } else {
      const ice = new Set(v.ice);
      for (let i = 0; i < n * n; i++) {
        const cx = left + ((i % n) + 0.5) * cell;
        const cy = top + (Math.floor(i / n) + 0.5) * cell;
        if (ice.has(i)) {
          ctx.fillStyle = i === v.hit ? 'rgba(255,77,94,0.38)' : 'rgba(255,77,94,0.15)';
          ctx.strokeStyle = C.red;
          ctx.lineWidth = Math.max(1.5, cell * 0.035);
          ctx.beginPath();
          ctx.roundRect(cx - cell / 2 + gap, cy - cell / 2 + gap, cell - gap * 2, cell - gap * 2, cell * 0.08);
          ctx.fill();
          ctx.stroke();
          // a little ice crystal
          ctx.lineWidth = Math.max(1.5, cell * 0.05);
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const a = Math.PI / 2 + (k * Math.PI) / 3;
            ctx.moveTo(cx - Math.cos(a) * cell * 0.24, cy - Math.sin(a) * cell * 0.24);
            ctx.lineTo(cx + Math.cos(a) * cell * 0.24, cy + Math.sin(a) * cell * 0.24);
          }
          ctx.stroke();
        } else if (v.on[i]) {
          ctx.fillStyle = C.teal;
          if (o.big) {
            ctx.shadowColor = C.teal;
            ctx.shadowBlur = cell * 0.25;
          }
          ctx.beginPath();
          ctx.arc(cx, cy, cell * 0.17, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = C.off;
          ctx.beginPath();
          ctx.arc(cx, cy, cell * 0.035, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private scope(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, waves: { w: L.Wave; color: string; width: number }[], big: boolean) {
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(x, y, w, hh);
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.faint;
    ctx.beginPath();
    for (let i = 1; i < 8; i++) {
      ctx.moveTo(x + (w * i) / 8, y);
      ctx.lineTo(x + (w * i) / 8, y + hh);
    }
    for (let i = 1; i < 4; i++) {
      ctx.moveTo(x, y + (hh * i) / 4);
      ctx.lineTo(x + w, y + (hh * i) / 4);
    }
    ctx.stroke();
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(x, y + hh / 2);
    ctx.lineTo(x + w, y + hh / 2);
    ctx.stroke();
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
    const steps = big ? 260 : 130;
    ctx.lineJoin = 'round';
    for (const wave of waves) {
      ctx.strokeStyle = wave.color;
      ctx.lineWidth = wave.width;
      if (big) {
        ctx.shadowColor = wave.color;
        ctx.shadowBlur = wave.width * 3;
      }
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const py = y + hh / 2 - L.waveAt(wave.w, u) * hh * 0.46;
        if (i === 0) ctx.moveTo(x + u * w, py);
        else ctx.lineTo(x + u * w, py);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  private lockBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, v: L.SignalViewA | L.SignalViewB, now: number) {
    const p = v.solved ? 1 : v.lockSince !== null ? Math.max(0, Math.min(1, (now - v.lockSince) / v.hold)) : 0;
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${hh * 0.4}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim;
    ctx.fillText(t('hk.lock'), x, y + hh / 2, w * 0.1);
    const bx = x + w * 0.11;
    const bw = w * 0.62;
    const bh = hh * 0.36;
    const by = y + (hh - bh) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = p >= 1 ? C.green : C.teal;
    ctx.fillRect(bx, by, bw * p, bh);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.textAlign = 'right';
    ctx.fillStyle = v.solved ? C.green : v.lockSince !== null ? C.teal : C.dim;
    ctx.fillText(t(v.solved ? 'hk.locked' : v.lockSince !== null ? 'hk.locking' : 'hk.nolock'), x + w, y + hh / 2, w * 0.25);
  }

  private dialText(i: number, w: L.Wave): string {
    if (i === 0) return String(Math.round(w.f * 100) / 100) + '×';
    if (i === 1) return Math.round(w.a * 100) + '%';
    return Math.round((w.p * 180) / Math.PI) + '°';
  }

  private drawTuner(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, v: L.SignalViewA, o: DrawOpts) {
    const lockH = hh * 0.14;
    const gap = w * 0.035;
    const top = hh - lockH - gap * 0.5;
    const scopeW = w * 0.58;
    this.scope(ctx, x, y, scopeW, top, [{ w: v.cur, color: C.teal, width: o.big ? 3.5 : 2.5 }], o.big);
    const dx = x + scopeW + gap;
    const dw = w - scopeW - gap;
    const rowH = top / 3;
    for (let i = 0; i < v.steps.length; i++) {
      const ry = y + i * rowH;
      const on = o.sel === i;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = on ? C.amber : C.dim;
      ctx.font = `600 ${rowH * 0.19}px ${FONT}`;
      ctx.fillText(`${i + 1}  ${t('hk.dial.' + L.SIGNAL_DIALS[i])}`, dx, ry + rowH * 0.27, dw * 0.62);
      ctx.textAlign = 'right';
      ctx.fillStyle = C.ink;
      ctx.font = `500 ${rowH * 0.23}px ${MONO}`;
      ctx.fillText(this.dialText(i, v.cur), dx + dw, ry + rowH * 0.27, dw * 0.36);
      const ty = ry + rowH * 0.66;
      const steps = v.steps[i];
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1.5, rowH * 0.025);
      ctx.beginPath();
      ctx.moveTo(dx, ty);
      ctx.lineTo(dx + dw, ty);
      for (let k = 0; k < steps; k++) {
        const tx = dx + (steps > 1 ? k / (steps - 1) : 0.5) * dw;
        ctx.moveTo(tx, ty - rowH * 0.07);
        ctx.lineTo(tx, ty + rowH * 0.07);
      }
      ctx.stroke();
      const kx = dx + (steps > 1 ? v.dials[i] / (steps - 1) : 0.5) * dw;
      ctx.fillStyle = on ? C.amber : C.teal;
      if (o.big) {
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = rowH * 0.14;
      }
      ctx.beginPath();
      ctx.arc(kx, ty, rowH * 0.115, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (on) {
        ctx.fillStyle = C.amber;
        ctx.fillRect(dx - gap * 0.45, ry + rowH * 0.12, Math.max(2, w * 0.004), rowH * 0.76);
      }
    }
    this.lockBar(ctx, x, y + hh - lockH, w, lockH, v, o.now);
  }

  private drawScope(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, v: L.SignalViewB, o: DrawOpts) {
    const lockH = hh * 0.14;
    const gap = w * 0.035;
    const top = hh - lockH - gap * 0.5;
    const scopeW = w * 0.74;
    this.scope(
      ctx,
      x,
      y,
      scopeW,
      top,
      [
        { w: v.tgt, color: C.amber, width: o.big ? 4.5 : 3 },
        { w: v.cur, color: C.teal, width: o.big ? 2.5 : 1.8 },
      ],
      o.big,
    );
    const px = x + scopeW + gap;
    const pw = w - scopeW - gap;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.dim;
    ctx.font = `600 ${top * 0.075}px ${FONT}`;
    ctx.fillText(t('hk.match'), px, y + top * 0.09, pw);
    ctx.fillStyle = v.inTol ? C.green : C.amber;
    ctx.font = `700 ${Math.min(top * 0.26, pw * 0.42)}px ${MONO}`;
    ctx.fillText(Math.round(v.match * 100) + '%', px, y + top * 0.3, pw);
    const legend: [string, string][] = [
      [C.amber, t('hk.target')],
      [C.teal, t('hk.tuner')],
    ];
    ctx.font = `600 ${top * 0.07}px ${FONT}`;
    legend.forEach(([col, text], i) => {
      const ly = y + top * (0.62 + i * 0.16);
      ctx.fillStyle = col;
      ctx.fillRect(px, ly - top * 0.012, pw * 0.22, Math.max(2, top * 0.024));
      ctx.fillStyle = C.ink;
      ctx.fillText(text, px + pw * 0.3, ly, pw * 0.7);
    });
    this.lockBar(ctx, x, y + hh - lockH, w, lockH, v, o.now);
  }

  private glyph(ctx: CanvasRenderingContext2D, id: number, cx: number, cy: number, size: number, color: string) {
    const g = glyphPaths()[id];
    if (!g) return;
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(size / 100, size / 100);
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.stroke(g.s);
    if (g.f) {
      ctx.fillStyle = color;
      ctx.fill(g.f);
    }
    ctx.restore();
  }

  private drawKeypad(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, v: L.CipherViewA) {
    const n = v.code.length;
    const gap = w * 0.025;
    const lab = hh * 0.09;
    const tile = Math.min((hh - lab * 2) * 0.58, (w - gap * (n - 1)) / n);
    const slotH = Math.min(hh - lab * 2 - tile, tile * 0.62);
    const rowW = n * tile + (n - 1) * gap;
    const x0 = x + (w - rowW) / 2;
    const y0 = y + (hh - (lab * 2 + tile + slotH)) / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim;
    ctx.font = `600 ${lab * 0.5}px ${FONT}`;
    ctx.fillText(t('hk.code'), x0, y0 + lab * 0.45);
    ctx.fillText(t('hk.entry'), x0, y0 + lab * 1.45 + tile);
    for (let i = 0; i < n; i++) {
      const tx = x0 + i * (tile + gap);
      ctx.fillStyle = 'rgba(255,162,58,0.07)';
      ctx.strokeStyle = 'rgba(255,162,58,0.55)';
      ctx.lineWidth = Math.max(1.5, tile * 0.02);
      ctx.beginPath();
      ctx.roundRect(tx, y0 + lab, tile, tile, tile * 0.07);
      ctx.fill();
      ctx.stroke();
      this.glyph(ctx, v.code[i], tx + tile / 2, y0 + lab + tile / 2, tile * 0.64, C.amber);
      const sy = y0 + lab * 2 + tile;
      const next = i === v.entered.length;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = next ? C.teal : C.line;
      ctx.beginPath();
      ctx.roundRect(tx, sy, tile, slotH, tile * 0.07);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'center';
      if (i < v.entered.length) {
        ctx.fillStyle = C.teal;
        ctx.font = `700 ${slotH * 0.66}px ${MONO}`;
        ctx.fillText(String(v.entered[i]), tx + tile / 2, sy + slotH * 0.54);
      } else {
        ctx.fillStyle = next ? C.teal : C.off;
        ctx.fillRect(tx + tile * 0.36, sy + slotH * 0.72, tile * 0.28, Math.max(2, slotH * 0.05));
      }
      ctx.textAlign = 'left';
    }
  }

  private drawTable(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, v: L.CipherViewB) {
    const cols = 3;
    const rows = Math.ceil(v.count / cols);
    const gap = w * 0.02;
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = (hh - gap * (rows - 1)) / rows;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < v.count; i++) {
      const cx = x + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (ch + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = C.faint;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(cx, cy, cw, ch, ch * 0.08);
      ctx.fill();
      ctx.stroke();
      if (!v.visible) continue;
      const row = v.rows[i];
      const size = Math.min(ch * 0.7, cw * 0.34);
      this.glyph(ctx, row.g, cx + cw * 0.25, cy + ch / 2, size, C.ink);
      ctx.strokeStyle = C.dim;
      ctx.lineWidth = Math.max(1.5, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx + cw * 0.47, cy + ch / 2);
      ctx.lineTo(cx + cw * 0.59, cy + ch / 2);
      ctx.moveTo(cx + cw * 0.555, cy + ch / 2 - size * 0.12);
      ctx.lineTo(cx + cw * 0.59, cy + ch / 2);
      ctx.lineTo(cx + cw * 0.555, cy + ch / 2 + size * 0.12);
      ctx.stroke();
      ctx.fillStyle = C.amber;
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.min(ch * 0.62, cw * 0.3)}px ${MONO}`;
      ctx.fillText(String(row.d), cx + cw * 0.78, cy + ch * 0.53);
    }
    if (!v.visible) {
      ctx.textAlign = 'center';
      ctx.fillStyle = C.red;
      ctx.font = `700 ${Math.min(hh * 0.13, w * 0.07)}px ${FONT}`;
      ctx.fillText(t('hk.dark'), x + w / 2, y + hh * 0.46, w * 0.9);
      ctx.fillStyle = C.dim;
      ctx.font = `500 ${Math.min(hh * 0.07, w * 0.04)}px ${FONT}`;
      ctx.fillText(t('hk.darkSub'), x + w / 2, y + hh * 0.6, w * 0.9);
    }
  }

  // ------------------------------------------------------------------ sound

  private sfx(kind: Sound, pos?: THREE.Vector3, rate = 1) {
    const a = this.d.audio;
    if (!a.ready || a.ctx.state !== 'running') return;
    const at = a.ctx.currentTime + 0.001;
    const opts = pos ? { pos } : undefined;
    switch (kind) {
      case 'move': {
        const o = a.out(opts, 0.05);
        a.tone(o, 'sine', 1500, 1500, at, 0.022, 1);
        break;
      }
      case 'rot': {
        // a relay snapping over
        const o = a.out(opts, 0.15);
        a.burst(o, 'bandpass', 2600, 3, at, 0.03, 0.9);
        a.tone(o, 'triangle', 420, 640, at, 0.05, 0.7);
        break;
      }
      case 'key': {
        const o = a.out(opts, 0.14);
        a.tone(o, 'square', 940 * rate, 940 * rate, at, 0.045, 0.45);
        a.burst(o, 'highpass', 3200, 0.7, at, 0.012, 0.6);
        break;
      }
      case 'dial': {
        const o = a.out(opts, 0.1);
        a.tone(o, 'triangle', 620 * rate, 640 * rate, at, 0.035, 0.8);
        a.burst(o, 'highpass', 4200, 0.7, at, 0.008, 0.4);
        break;
      }
      case 'nope': {
        const o = a.out(opts, 0.08);
        a.tone(o, 'square', 190, 170, at, 0.06, 0.6);
        break;
      }
      case 'lock': {
        // lock-on: two quick rising notes (the bar shows the hold; a long tone would pile up while sweeping a dial)
        const o = a.out(opts, 0.11);
        a.tone(o, 'sine', 660, 700, at, 0.12, 0.8);
        a.tone(o, 'sine', 990, 1320, at + 0.1, 0.3, 0.8);
        break;
      }
      case 'unlock': {
        const o = a.out(opts, 0.1);
        a.tone(o, 'sine', 700, 330, at, 0.22, 0.8);
        break;
      }
      case 'strike': {
        const o = a.out(opts, 0.24);
        a.tone(o, 'sawtooth', 160, 120, at, 0.16, 0.8);
        a.tone(o, 'sawtooth', 151, 104, at + 0.18, 0.28, 0.8);
        a.burst(o, 'lowpass', 900, 1, at, 0.2, 0.5);
        break;
      }
      case 'reroll': {
        const o = a.out(opts, 0.24);
        [392, 330, 262, 196].forEach((f, i) => a.tone(o, 'sawtooth', f, f * 0.97, at + i * 0.11, 0.16, 0.6));
        a.burst(o, 'lowpass', 700, 1, at + 0.44, 0.3, 0.6);
        break;
      }
      case 'solved': {
        const o = a.out(opts, 0.17);
        [523, 659, 784, 1047, 1568].forEach((f, i) => a.tone(o, 'sine', f, f, at + i * 0.075, 0.5, 0.8));
        a.tone(o, 'triangle', 261, 261, at, 0.7, 0.4);
        break;
      }
      case 'open': {
        const o = a.out(opts, 0.1);
        a.tone(o, 'triangle', 500, 1000, at, 0.09, 0.9);
        a.burst(o, 'highpass', 3000, 0.7, at, 0.03, 0.4);
        break;
      }
      case 'close': {
        const o = a.out(opts, 0.1);
        a.tone(o, 'triangle', 900, 450, at, 0.09, 0.9);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ test and debug hooks

  private term(id: string): Terminal | undefined {
    return this.terms.find((x) => x.id === id);
  }

  readonly debug = {
    logic: L,
    stations: () => this.stationIds(),
    state: (id: string) => this.state(id) ?? null,
    /** What a terminal renders from, as of now. */
    view: (termId: string) => {
      const term = this.term(termId);
      const st = term && this.state(term.station.id);
      return st && this.session ? L.hackView(st, term.side, this.session.hostNow()) : null;
    },
    /** Where to stand to use a terminal: [x, y, z, yaw, pitch] for `__nv.tp`. */
    stand: (termId: string) => {
      const term = this.term(termId);
      return term ? [term.stand.x, 0.02, term.stand.z, term.yaw, 0] : null;
    },
    /**
     * Can someone standing at terminal `fromId` read the screen of terminal `ofId`?
     * Tries eye positions around the spot in front of `fromId` against points on the
     * other screen: readable means seen from the front with nothing solid in between.
     */
    readable: (fromId: string, ofId: string) => {
      const from = this.term(fromId);
      const of = this.term(ofId);
      if (!from || !of) return null;
      const physics = this.d.builder.physics;
      const own = this.d.player()?.body.collider;
      const eye = new THREE.Vector3();
      const dir = new THREE.Vector3();
      const nx = Math.sin(of.yaw);
      const nz = Math.cos(of.yaw);
      for (const side of [-0.8, 0, 0.8]) {
        for (const back of [0, 0.8]) {
          for (const height of [1.0, 1.64]) {
            eye.set(from.stand.x + Math.cos(from.yaw) * side + Math.sin(from.yaw) * back, height, from.stand.z - Math.sin(from.yaw) * side + Math.cos(from.yaw) * back);
            for (const u of [-0.5, 0, 0.5]) {
              for (const v of [-0.3, 0, 0.3]) {
                dir.set(of.pos.x + Math.cos(of.yaw) * u - eye.x, of.pos.y + v - eye.y, of.pos.z - Math.sin(of.yaw) * u - eye.z);
                const dist = dir.length();
                dir.multiplyScalar(1 / dist);
                if (-(dir.x * nx + dir.z * nz) < 0.12) continue; // from behind or edge-on a flat screen shows nothing
                if (physics.raycast(eye, dir, dist - 0.12, own) === null) return true;
              }
            }
          }
        }
      }
      return false;
    },
    openId: () => this.open?.id ?? null,
    /** The overlay as the player has it in front of them. */
    overlay: () =>
      this.open
        ? {
            term: this.open.id,
            visible: !this.el.classList.contains('hidden'),
            title: this.titleEl.textContent,
            hint: this.hintEl.textContent,
            status: this.statusEl.textContent,
            keys: this.keysEl.textContent,
            view: this.open.view,
            cursor: this.cursor.get(this.open.station.id) ?? null,
            sel: this.sel.get(this.open.station.id) ?? null,
            canvas: [this.canvas.width, this.canvas.height],
          }
        : null,
    close: () => this.closeTerminal(false),
    /** Intent arguments that finish a station from where it stands. */
    plan: (id: string) => {
      const st = this.state(id);
      return st && this.session ? L.hackPlan(st, this.session.hostNow()).map((mv) => ({ s: id, ...mv })) : [];
    },
    solve: (id: string) => {
      for (const mv of this.debug.plan(id)) this.session?.intent('hack.move', mv);
    },
  };
}
