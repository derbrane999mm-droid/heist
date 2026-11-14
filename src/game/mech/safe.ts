// Opening a safe: one skill game, three variants (see safe-logic.ts for the rules).
//
//   mech   combination lock: A/D turn the dial, find three numbers by the contact meter
//   elek   electronic lock: Space when the decoder shows the hot digit
//   drill  drilling: hold Space, watch the heat, let go before the bit binds
//
// A keyboard-driven overlay under #ui (own DOM, own CSS, everything drawn on one canvas). The pointer stays
// locked, the player is frozen while it is open. It never touches the network: the director calls
// `start(req, done)` and gets one SkillResult. Works without a session.
import './safe.css';
import type { LevelDeps } from '../level';
import type { SkillGame, SkillRequest, SkillResult } from './skill';
import { FONT, MONO } from '../build';
import { t, registerStrings, onLangChange } from '../../core/i18n';
import { h } from '../../ui/ui';
import * as L from './safe-logic';

registerStrings(
  {
    'sf.label': 'SAFE',
    'sf.title.mech': 'Combination lock',
    'sf.title.elek': 'Electronic lock',
    'sf.title.drill': 'Drilling',
    'sf.k.turn': 'turn',
    'sf.k.fine': 'fine',
    'sf.k.set': 'set',
    'sf.k.press': 'press',
    'sf.k.drill': 'drill (hold)',
    'sf.k.leave': 'leave',
    'sf.slips': 'SLIPS',
    'sf.slipsLeft': 'SLIPS LEFT',
    'sf.bits': 'BIT',
    'sf.left': 'LEFT',
    'sf.right': 'RIGHT',
    'sf.dial': 'DIAL',
    'sf.contact': 'CONTACT',
    'sf.setting': 'SETTING',
    'sf.number': 'NUMBER {n}',
    'sf.st.search': 'SEARCHING',
    'sf.st.contact': 'CONTACT: SLOW DOWN',
    'sf.st.hold': 'HOLD STILL',
    'sf.st.wrongway': 'TURN {dir} AND COME BACK',
    'sf.st.slip': 'SLIPPED: FIND IT AGAIN',
    'sf.st.set': 'NUMBER SET: TURN {dir}',
    'sf.decoder': 'DECODER SIGNAL',
    'sf.hot': 'HOT',
    'sf.st.decode': 'DECODING',
    'sf.st.hot': 'HOT: PRESS NOW',
    'sf.st.locked': 'PAD LOCKED {s} s',
    'sf.st.wrong': 'WRONG DIGIT',
    'sf.st.digit': 'POSITION {n}/{m}',
    'sf.locked': 'PAD LOCKED',
    'sf.depth': 'DEPTH',
    'sf.heat': 'HEAT',
    'sf.noise': 'NOISE',
    'sf.st.ready': 'READY',
    'sf.st.drilling': 'DRILLING',
    'sf.st.hotdrill': 'RED ZONE: LET GO',
    'sf.st.cooling': 'COOLING',
    'sf.st.bound': 'BIT BOUND',
    'sf.st.release': 'LET GO OF SPACE',
    'sf.end.open': 'SAFE OPEN',
    'sf.end.timeout': 'TIME UP',
    'sf.end.lockout': 'LOCKOUT',
    'sf.end.broke': 'BIT BROKEN',
  },
  {
    'sf.label': 'TRESOR',
    'sf.title.mech': 'Kombinationsschloss',
    'sf.title.elek': 'Elektronikschloss',
    'sf.title.drill': 'Bohren',
    'sf.k.turn': 'drehen',
    'sf.k.fine': 'fein',
    'sf.k.set': 'setzen',
    'sf.k.press': 'drücken',
    'sf.k.drill': 'bohren (halten)',
    'sf.k.leave': 'verlassen',
    'sf.slips': 'PATZER',
    'sf.slipsLeft': 'PATZER ÜBRIG',
    'sf.bits': 'BOHRER',
    'sf.left': 'LINKS',
    'sf.right': 'RECHTS',
    'sf.dial': 'RAD',
    'sf.contact': 'KONTAKT',
    'sf.setting': 'EINSTELLEN',
    'sf.number': 'ZAHL {n}',
    'sf.st.search': 'SUCHEN',
    'sf.st.contact': 'KONTAKT: LANGSAMER',
    'sf.st.hold': 'STILL HALTEN',
    'sf.st.wrongway': 'NACH {dir} DREHEN UND ZURÜCK',
    'sf.st.slip': 'DARÜBER: NOCH MAL SUCHEN',
    'sf.st.set': 'ZAHL GESETZT: NACH {dir}',
    'sf.decoder': 'DECODER-SIGNAL',
    'sf.hot': 'HEISS',
    'sf.st.decode': 'DECODIEREN',
    'sf.st.hot': 'HEISS: JETZT DRÜCKEN',
    'sf.st.locked': 'TASTATUR GESPERRT {s} s',
    'sf.st.wrong': 'FALSCHE ZIFFER',
    'sf.st.digit': 'STELLE {n}/{m}',
    'sf.locked': 'GESPERRT',
    'sf.depth': 'TIEFE',
    'sf.heat': 'HITZE',
    'sf.noise': 'LÄRM',
    'sf.st.ready': 'BEREIT',
    'sf.st.drilling': 'BOHRT',
    'sf.st.hotdrill': 'ROTER BEREICH: LOSLASSEN',
    'sf.st.cooling': 'KÜHLT AB',
    'sf.st.bound': 'BOHRER KLEMMT',
    'sf.st.release': 'LEERTASTE LOSLASSEN',
    'sf.end.open': 'TRESOR OFFEN',
    'sf.end.timeout': 'ZEIT ABGELAUFEN',
    'sf.end.lockout': 'GESPERRT',
    'sf.end.broke': 'BOHRER GEBROCHEN',
  },
);

const W = 1200;
const H = 520;
const DISPLAY = '"Barlow Condensed", "Arial Narrow", "Inter", sans-serif';
const TEXT = '#ece7df';
const DIM = '#a39c90';
const FAINT = '#6f6a62';
const ACCENT = '#e9b63a';
const DANGER = '#d2493a';
const OK = '#6fbf73';

/** How long the result stays on screen after the game ended. */
const CLOSE_AFTER = 1.15;

type Tone = '' | 'bad' | 'ok' | 'hot';

export interface SafeView {
  variant: L.Variant;
  visible: boolean;
  title: string;
  status: string;
  keys: string;
  slips: string;
  /** remaining share of the time bar, 1..0, or -1 without a limit */
  time: number;
}

export interface SafeGame extends SkillGame {
  /** Test and debug hooks. */
  debug: {
    /** the live logic state (plain data) while a game runs, else null */
    state(): L.SafeState | null;
    /** what the overlay shows right now */
    view(): SafeView | null;
    /** the last result handed to `done` */
    last(): SkillResult | null;
  };
}

const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number) => {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, hh, r);
  else ctx.rect(x, y, w, hh);
};
const text = (ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left', maxW?: number) => {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (maxW) ctx.fillText(s, x, y, maxW);
  else ctx.fillText(s, x, y);
};
const mono = (px: number, w = 600) => `${w} ${px}px ${MONO}`;
const display = (px: number, w = 600) => `${w} ${px}px ${DISPLAY}`;

export function createSafeGame(deps: LevelDeps): SafeGame {
  const { audio, input } = deps;

  // ------------------------------------------------------------------ DOM
  const canvas = h('canvas', { class: 'sf-canvas', width: W, height: H });
  const ctx = canvas.getContext('2d')!;
  const titleEl = h('span', { class: 'sf-title' });
  const statusEl = h('span', { class: 'sf-status' });
  const keysEl = h('div', { class: 'sf-keys' });
  const slipsEl = h('div', { class: 'sf-slips' });
  const timeBar = h('i');
  const timeEl = h('div', { class: 'sf-time hidden' }, timeBar);
  const el = h(
    'div',
    { class: 'sf hidden' },
    h('div', { class: 'sf-head' }, h('span', { class: 'label' }, t('sf.label')), titleEl, statusEl),
    h('div', { class: 'sf-stage' }, canvas),
    h('div', { class: 'sf-foot' }, keysEl, slipsEl),
    timeEl,
  );
  const labelEl = el.querySelector('.label') as HTMLElement;
  const root = document.getElementById('ui');
  if (root) root.insertBefore(el, root.querySelector('.menu'));
  else document.body.append(el);

  // ------------------------------------------------------------------ state
  let state: L.SafeState | null = null;
  let finish: ((r: SkillResult) => void) | null = null;
  let running = false; // a game is being played
  let closeT = -1; // > 0: the result stays up for a moment
  let skipInput = false;
  let lastResult: SkillResult | null = null;
  let flashT = 0; // strike shake
  let goodT = 0;
  let msgT = 0; // a short message after a slip or a set
  let msg = '';
  let msgTone: Tone = '';
  let clock = 0;
  let lastStatus = '';
  let lastTone: Tone = 'x' as Tone;
  let lastSlips = '';
  let lastTime = -2;
  let frozenPlayer: { frozen: boolean } | null = null;

  // ------------------------------------------------------------------ sound
  const ready = () => audio.ready && audio.ctx.state === 'running';
  type Snd = 'tick' | 'enter' | 'set' | 'slip' | 'miss' | 'digit' | 'hotdigit' | 'ok' | 'wrong' | 'unlock' | 'bind' | 'open' | 'fail' | 'broke' | 'start';
  const sfx = (kind: Snd, c = 0) => {
    if (!ready()) return;
    const a = audio;
    const at = a.ctx.currentTime + 0.001;
    switch (kind) {
      case 'tick': {
        const o = a.out(undefined, 0.045 + 0.07 * c);
        a.burst(o, 'bandpass', 2200 + c * 1800, 4, at, 0.012, 0.8);
        break;
      }
      case 'enter': {
        const o = a.out(undefined, 0.22);
        a.burst(o, 'bandpass', 1800, 5, at, 0.03, 1);
        a.tone(o, 'triangle', 900, 500, at, 0.05, 0.5);
        break;
      }
      case 'set': {
        const o = a.out(undefined, 0.3);
        a.tone(o, 'sine', 150, 55, at, 0.22, 1);
        a.burst(o, 'lowpass', 700, 1, at, 0.1, 0.8);
        a.burst(o, 'bandpass', 3000, 3, at + 0.02, 0.02, 0.6);
        break;
      }
      case 'slip': {
        const o = a.out(undefined, 0.22);
        a.tone(o, 'sawtooth', 140, 60, at, 0.3, 0.7);
        a.burst(o, 'bandpass', 500, 1, at, 0.25, 0.6);
        break;
      }
      case 'miss': {
        const o = a.out(undefined, 0.1);
        a.tone(o, 'square', 200, 170, at, 0.06, 0.4);
        break;
      }
      case 'digit':
      case 'hotdigit': {
        const o = a.out(undefined, kind === 'hotdigit' ? 0.09 : 0.035);
        a.tone(o, 'square', kind === 'hotdigit' ? 1560 : 880, kind === 'hotdigit' ? 1560 : 880, at, 0.035, 0.5);
        break;
      }
      case 'ok': {
        const o = a.out(undefined, 0.17);
        a.tone(o, 'square', 880, 880, at, 0.08, 0.6);
        a.tone(o, 'square', 1320, 1320, at + 0.09, 0.13, 0.6);
        break;
      }
      case 'wrong': {
        const o = a.out(undefined, 0.2);
        a.tone(o, 'square', 150, 140, at, 0.4, 0.7);
        break;
      }
      case 'unlock': {
        const o = a.out(undefined, 0.1);
        a.tone(o, 'triangle', 600, 600, at, 0.07, 0.6);
        break;
      }
      case 'bind': {
        const o = a.out(undefined, 0.3);
        a.burst(o, 'bandpass', 2800, 3, at, 0.35, 1, 0.002, 900);
        a.tone(o, 'sawtooth', 300, 70, at, 0.35, 0.7);
        break;
      }
      case 'open': {
        // the bolt: two heavy clunks, then a short rising chime
        const o = a.out(undefined, 0.32);
        a.tone(o, 'sine', 130, 55, at, 0.25, 1);
        a.burst(o, 'lowpass', 600, 1, at, 0.12, 0.8);
        a.tone(o, 'sine', 110, 45, at + 0.2, 0.3, 1);
        a.burst(o, 'bandpass', 2400, 3, at + 0.2, 0.03, 0.7);
        const q = a.out(undefined, 0.12);
        a.tone(q, 'sine', 523, 523, at + 0.5, 0.2, 0.7);
        a.tone(q, 'sine', 784, 784, at + 0.62, 0.35, 0.7);
        break;
      }
      case 'fail': {
        const o = a.out(undefined, 0.26);
        a.tone(o, 'sawtooth', 220, 70, at, 0.5, 0.7);
        a.burst(o, 'lowpass', 400, 1, at, 0.3, 0.6);
        break;
      }
      case 'broke': {
        const o = a.out(undefined, 0.34);
        a.burst(o, 'highpass', 3000, 0.7, at, 0.18, 1);
        a.tone(o, 'sawtooth', 500, 80, at, 0.4, 0.8);
        break;
      }
      case 'start': {
        const o = a.out(undefined, 0.1);
        a.tone(o, 'triangle', 520, 780, at, 0.1, 0.6);
        break;
      }
    }
  };

  // a drill whose pitch follows the heat: made when the drill first runs, silent between
  let drillNodes: { g: GainNode; o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode } | null = null;
  let grindT = 0;
  const drillSound = (drilling: boolean, heat: number, dt: number) => {
    if (!ready()) return;
    const c = audio.ctx;
    if (!drillNodes) {
      if (!drilling) return;
      const g = audio.out(undefined, 0);
      g.gain.value = 0;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      const o1 = c.createOscillator();
      o1.type = 'sawtooth';
      const o2 = c.createOscillator();
      o2.type = 'square';
      o1.frequency.value = o2.frequency.value = 80;
      o1.connect(f);
      o2.connect(f);
      f.connect(g);
      o1.start();
      o2.start();
      drillNodes = { g, o1, o2, f };
    }
    const n = drillNodes;
    const now = c.currentTime;
    const hz = 55 + heat * 150;
    n.o1.frequency.setTargetAtTime(hz, now, 0.05);
    n.o2.frequency.setTargetAtTime(hz * 0.5 + 3, now, 0.05);
    n.f.frequency.setTargetAtTime(450 + heat * 2300, now, 0.05);
    n.g.gain.setTargetAtTime(drilling ? 0.11 : 0, now, drilling ? 0.04 : 0.06);
    if (drilling) {
      grindT -= dt;
      if (grindT <= 0) {
        grindT = 0.07 - heat * 0.03;
        const o = audio.out(undefined, 0.05 + heat * 0.05);
        audio.burst(o, 'bandpass', 1800 + heat * 2600, 2, now + 0.001, 0.05, 0.8);
      }
    }
  };
  const stopDrill = () => {
    if (!drillNodes) return;
    const n = drillNodes;
    drillNodes = null;
    try {
      n.g.gain.cancelScheduledValues(0);
      n.g.gain.value = 0;
      n.o1.stop();
      n.o2.stop();
      n.o1.disconnect();
      n.o2.disconnect();
      n.f.disconnect();
      n.g.disconnect();
    } catch {
      /* already stopped */
    }
  };

  // ------------------------------------------------------------------ texts
  const dirWord = (d: number) => t(d > 0 ? 'sf.right' : 'sf.left');

  const keyRow = (variant: L.Variant) => {
    const key = (caps: string[], label: string) => h('span', { class: 'sf-key' }, ...caps.map((c) => h('span', { class: 'keycap' }, c)), h('span', {}, t(label)));
    const nodes: Node[] = [];
    if (variant === 'mech') nodes.push(key(['A', 'D'], 'sf.k.turn'), key(['Shift'], 'sf.k.fine'), key(['Space'], 'sf.k.set'));
    else if (variant === 'elek') nodes.push(key(['Space'], 'sf.k.press'));
    else nodes.push(key(['Space'], 'sf.k.drill'));
    const leave = key(['Esc', 'Q'], 'sf.k.leave');
    leave.classList.add('sf-leave');
    nodes.push(leave);
    keysEl.replaceChildren(...nodes);
  };

  const statusOf = (s: L.SafeState): { text: string; tone: Tone } => {
    if (s.status !== 'run') {
      const k = s.status === 'open' ? 'sf.end.open' : s.status === 'timeout' ? 'sf.end.timeout' : s.status === 'lockout' ? 'sf.end.lockout' : 'sf.end.broke';
      return { text: t(k), tone: s.status === 'open' ? 'ok' : 'bad' };
    }
    if (s.kind === 'mech') {
      const i = Math.min(s.step, 2);
      if (msgT > 0) return { text: msg, tone: msgTone };
      if (s.on && s.dirOk) return { text: t('sf.st.hold'), tone: 'hot' };
      if (s.on && !s.dirOk) return { text: t('sf.st.wrongway', { dir: dirWord(-s.dirs[i]) }), tone: '' };
      if (s.contact > 0.7) return { text: t('sf.st.contact'), tone: 'hot' };
      return { text: t('sf.st.search'), tone: '' };
    }
    if (s.kind === 'elek') {
      if (s.lockT > 0) return { text: t('sf.st.locked', { s: s.lockT.toFixed(1) }), tone: 'bad' };
      if (L.elekHot(s)) return { text: t('sf.st.hot'), tone: 'hot' };
      return { text: t('sf.st.digit', { n: s.pos + 1, m: s.code.length }), tone: '' };
    }
    const cfg = L.DRILL_CFG[s.diff];
    if (s.stuck > 0) return { text: t('sf.st.bound'), tone: 'bad' };
    if (s.latch) return { text: t('sf.st.release'), tone: 'bad' };
    if (s.drilling && s.heat >= cfg.red) return { text: t('sf.st.hotdrill'), tone: 'bad' };
    if (s.drilling) return { text: t('sf.st.drilling'), tone: '' };
    if (s.heat > 0.12) return { text: t('sf.st.cooling'), tone: '' };
    return { text: t('sf.st.ready'), tone: '' };
  };

  const slipsOf = (s: L.SafeState): string => {
    if (s.kind === 'mech') return `${t('sf.slips')} ${s.fumbles}`;
    if (s.kind === 'elek') return t('sf.slipsLeft') + ' ' + '●'.repeat(Math.max(0, L.ELEK_MAX_WRONG - s.wrong)) + '○'.repeat(Math.min(L.ELEK_MAX_WRONG, s.wrong));
    return t('sf.bits') + ' ' + '●'.repeat(Math.max(0, L.DRILL_MAX_BINDS - s.binds)) + '○'.repeat(Math.min(L.DRILL_MAX_BINDS, s.binds));
  };

  const refreshChrome = (force = false) => {
    const s = state;
    if (!s) return;
    const st = statusOf(s);
    if (force || st.text !== lastStatus || st.tone !== lastTone) {
      lastStatus = st.text;
      lastTone = st.tone;
      statusEl.textContent = st.text;
      statusEl.className = 'sf-status' + (st.tone ? ' ' + st.tone : '');
    }
    const sl = slipsOf(s);
    if (force || sl !== lastSlips) {
      lastSlips = sl;
      slipsEl.textContent = sl;
    }
    if (s.limit > 0) {
      const left = Math.max(0, 1 - s.t / s.limit);
      if (force || Math.abs(left - lastTime) > 0.004) {
        lastTime = left;
        timeBar.style.width = (left * 100).toFixed(1) + '%';
        timeEl.classList.toggle('low', left < 0.2);
      }
    }
  };

  const renderChrome = () => {
    if (!state) return;
    labelEl.textContent = t('sf.label');
    titleEl.textContent = t('sf.title.' + state.kind);
    keyRow(state.kind);
    refreshChrome(true);
  };
  onLangChange(() => {
    if (state) renderChrome();
  });

  // ------------------------------------------------------------------ drawing
  const clear = () => {
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0a09');
    g.addColorStop(1, '#070706');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };

  const label = (s: string, x: number, y: number, color = DIM, align: CanvasTextAlign = 'left') => text(ctx, s, x, y, `600 15px ${FONT}`, color, align);

  const drawMech = (s: L.MechState) => {
    const cx = 300;
    const cy = 262;
    const R = 226;
    // bezel
    const bz = ctx.createRadialGradient(cx - 60, cy - 70, 20, cx, cy, R);
    bz.addColorStop(0, '#3a3d42');
    bz.addColorStop(1, '#141517');
    ctx.fillStyle = bz;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(236,231,223,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#0a0b0c';
    ctx.beginPath();
    ctx.arc(cx, cy, R - 16, 0, Math.PI * 2);
    ctx.fill();
    // contact glow along the ring around the pointer
    const ang = (m: number) => -Math.PI / 2 + (m / L.MECH_N) * Math.PI * 2;
    const pa = ang(s.pos);
    const col = s.on ? OK : ACCENT;
    if (s.contact > 0.02) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.15 + 0.7 * s.contact;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, R - 8, pa - 0.1 - 0.25 * s.contact, pa + 0.1 + 0.25 * s.contact);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }
    // marks and numbers
    for (let m = 0; m < L.MECH_N; m++) {
      const a = ang(m);
      const big = m % 5 === 0;
      const r1 = R - 24;
      const r0 = r1 - (big ? 24 : 11);
      ctx.strokeStyle = big ? 'rgba(236,231,223,0.88)' : 'rgba(163,156,144,0.55)';
      ctx.lineWidth = big ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
      if (big) text(ctx, String(m), cx + Math.cos(a) * (R - 66), cy + Math.sin(a) * (R - 66), mono(20, 500), DIM, 'center');
    }
    // pointer and knob
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(pa) * 44, cy + Math.sin(pa) * 44);
    ctx.lineTo(cx + Math.cos(pa) * (R - 36), cy + Math.sin(pa) * (R - 36));
    ctx.stroke();
    ctx.lineCap = 'butt';
    const kn = ctx.createRadialGradient(cx - 14, cy - 16, 4, cx, cy, 60);
    kn.addColorStop(0, '#565a60');
    kn.addColorStop(1, '#1d1f22');
    ctx.fillStyle = kn;
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(236,231,223,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = 0; i < 16; i++) {
      const a = pa + (i / 16) * Math.PI * 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 48, cy + Math.sin(a) * 48);
      ctx.lineTo(cx + Math.cos(a) * 57, cy + Math.sin(a) * 57);
      ctx.stroke();
    }
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(pa) * 36, cy + Math.sin(pa) * 36, 5, 0, Math.PI * 2);
    ctx.fill();

    // right side: readout, contact meter, set progress, the three numbers
    const x0 = 660;
    label(t('sf.dial'), x0, 44);
    text(ctx, String(Math.round(s.pos) % L.MECH_N).padStart(2, '0'), x0, 100, mono(84, 700), TEXT);
    label(t('sf.contact'), x0, 178);
    const segs = 24;
    const lit = Math.round(s.contact * segs);
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = i < lit ? (s.on ? OK : i > segs * 0.7 ? '#f5cf6b' : ACCENT) : 'rgba(236,231,223,0.09)';
      ctx.fillRect(x0 + i * 22, 196, 17, 30);
    }
    const hp = Math.min(1, s.holdT / L.MECH_HOLD);
    label(t('sf.setting'), x0, 256, hp > 0 ? OK : FAINT);
    ctx.fillStyle = 'rgba(236,231,223,0.09)';
    ctx.fillRect(x0 + 130, 249, 398, 14);
    ctx.fillStyle = OK;
    ctx.fillRect(x0 + 130, 249, 398 * hp, 14);
    for (let i = 0; i < 3; i++) {
      const bx = x0 + i * 180;
      const by = 306;
      const done = i < s.step;
      const cur = i === s.step && s.status === 'run';
      ctx.fillStyle = cur ? 'rgba(233,182,58,0.1)' : 'rgba(236,231,223,0.04)';
      rr(ctx, bx, by, 168, 150, 4);
      ctx.fill();
      ctx.strokeStyle = done ? OK : cur ? ACCENT : 'rgba(236,231,223,0.16)';
      ctx.lineWidth = cur ? 2.5 : 1.5;
      rr(ctx, bx, by, 168, 150, 4);
      ctx.stroke();
      label(t('sf.number', { n: i + 1 }), bx + 14, by + 22, done ? OK : cur ? ACCENT : FAINT);
      const d = s.dirs[i];
      const dtxt = d > 0 ? `D  ▶` : `◀  A`;
      text(ctx, done ? String(s.targets[i]).padStart(2, '0') : '––', bx + 84, by + 78, mono(done ? 58 : 46, 700), done ? TEXT : FAINT, 'center');
      text(ctx, dtxt, bx + 84, by + 122, mono(22, 600), cur ? ACCENT : FAINT, 'center');
    }
  };

  const drawElek = (s: L.ElekState, now: number) => {
    const n = s.code.length;
    const bw = 148;
    const gap = 22;
    const total = n * bw + (n - 1) * gap;
    const x0 = (W - total) / 2;
    const y0 = 44;
    const hot = s.status === 'run' && L.elekHot(s) && s.lockT <= 0;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (bw + gap);
      const done = i < s.pos;
      const cur = i === s.pos && s.status === 'run';
      const locked = cur && s.lockT > 0;
      ctx.fillStyle = '#0d0f11';
      rr(ctx, x, y0, bw, 190, 6);
      ctx.fill();
      ctx.save();
      if (cur && hot) {
        ctx.shadowColor = OK;
        ctx.shadowBlur = 26;
      }
      ctx.strokeStyle = done ? OK : locked ? DANGER : cur ? (hot ? OK : ACCENT) : 'rgba(236,231,223,0.16)';
      ctx.lineWidth = cur ? 3 : 1.5;
      rr(ctx, x, y0, bw, 190, 6);
      ctx.stroke();
      ctx.restore();
      const txt = done ? String(s.code[i]) : cur ? String(s.digit) : '–';
      text(ctx, txt, x + bw / 2, y0 + 98, mono(112, 700), done ? OK : locked ? DANGER : cur ? (hot ? OK : TEXT) : FAINT, 'center');
      label(String(i + 1), x + 12, y0 + 20, cur ? ACCENT : FAINT);
      if (locked) text(ctx, t('sf.locked'), x + bw / 2, y0 + 168, `600 15px ${FONT}`, DANGER, 'center', bw - 16);
    }
    // decoder signal
    const by = 300;
    label(t('sf.decoder'), x0, by - 22);
    const sig = L.elekSignal(s);
    const wob = s.status === 'run' && !hot ? Math.sin(now * 17) * 0.025 + Math.sin(now * 29 + 1) * 0.02 : 0;
    const segs = 40;
    const bwid = total - 170;
    const lit = Math.max(0, Math.min(segs, Math.round((sig + wob) * segs)));
    const sw = bwid / segs;
    for (let i = 0; i < segs; i++) {
      const hi = i >= segs * 0.78;
      ctx.fillStyle = i < lit ? (hi ? OK : ACCENT) : 'rgba(236,231,223,0.08)';
      if (i < lit && !hi) ctx.globalAlpha = 0.45 + 0.55 * (i / segs);
      ctx.fillRect(x0 + i * sw, by, sw - 3, 40);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    if (hot) {
      ctx.shadowColor = OK;
      ctx.shadowBlur = 24;
    }
    ctx.fillStyle = hot ? 'rgba(111,191,115,0.2)' : 'rgba(236,231,223,0.04)';
    rr(ctx, x0 + total - 150, by - 6, 150, 52, 5);
    ctx.fill();
    ctx.strokeStyle = hot ? OK : 'rgba(236,231,223,0.18)';
    ctx.lineWidth = 2;
    rr(ctx, x0 + total - 150, by - 6, 150, 52, 5);
    ctx.stroke();
    ctx.restore();
    text(ctx, t('sf.hot'), x0 + total - 75, by + 20, display(34, 700), hot ? OK : FAINT, 'center');
    // the decoder's ribbon of digits
    const ry = 400;
    const cw = Math.min(88, total / 10 - 6);
    const rx = (W - (cw + 6) * 10 + 6) / 2;
    for (let d = 0; d < 10; d++) {
      const on = s.status === 'run' && d === s.digit;
      ctx.fillStyle = on ? (hot ? OK : ACCENT) : 'rgba(236,231,223,0.05)';
      rr(ctx, rx + d * (cw + 6), ry, cw, 60, 4);
      ctx.fill();
      text(ctx, String(d), rx + d * (cw + 6) + cw / 2, ry + 31, mono(30, 700), on ? '#16130f' : FAINT, 'center');
    }
  };

  const drawDrill = (s: L.DrillState, now: number) => {
    const cfg = L.DRILL_CFG[s.diff];
    const cx = 300;
    const cy = 270;
    const R = 212;
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const at = (v: number) => a0 + sweep * v;
    // track and zones
    ctx.lineWidth = 30;
    const arc = (v0: number, v1: number, color: string, r = R) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, at(v0), at(v1));
      ctx.stroke();
    };
    arc(0, 1, 'rgba(236,231,223,0.07)');
    arc(0, cfg.red - 0.22, 'rgba(120,150,170,0.28)');
    arc(cfg.red - 0.22, cfg.red, 'rgba(233,182,58,0.3)');
    arc(cfg.red, 1, 'rgba(210,73,58,0.38)');
    // filled heat
    const fill = (v0: number, v1: number, color: string) => {
      if (s.heat <= v0) return;
      arc(v0, Math.min(s.heat, v1), color);
    };
    ctx.save();
    ctx.shadowColor = s.heat >= cfg.red ? DANGER : s.heat >= cfg.red - 0.22 ? ACCENT : '#7fa6bf';
    ctx.shadowBlur = 18;
    fill(0, cfg.red - 0.22, '#7fa6bf');
    fill(cfg.red - 0.22, cfg.red, ACCENT);
    fill(cfg.red, 1, DANGER);
    ctx.restore();
    // ticks
    for (let i = 0; i <= 10; i++) {
      const a = at(i / 10);
      ctx.strokeStyle = 'rgba(236,231,223,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26));
      ctx.lineTo(cx + Math.cos(a) * (R - 36), cy + Math.sin(a) * (R - 36));
      ctx.stroke();
    }
    // needle
    const na = at(s.heat);
    ctx.strokeStyle = TEXT;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(na) * 96, cy + Math.sin(na) * 96);
    ctx.lineTo(cx + Math.cos(na) * (R - 42), cy + Math.sin(na) * (R - 42));
    ctx.stroke();
    ctx.lineCap = 'butt';
    // the chuck with its bit: spins while drilling, shakes when bound
    const shake = s.stuck > 0 ? Math.sin(now * 90) * 4 : s.drilling ? Math.sin(now * 60) * 1.4 * (0.4 + s.heat) : 0;
    const spin = s.drilling ? now * 22 : 0;
    ctx.save();
    ctx.translate(cx + shake, cy);
    const hub = ctx.createRadialGradient(-14, -16, 4, 0, 0, 88);
    hub.addColorStop(0, '#5a5e64');
    hub.addColorStop(1, '#16181a');
    ctx.fillStyle = hub;
    ctx.beginPath();
    ctx.arc(0, 0, 84, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = s.stuck > 0 ? DANGER : 'rgba(236,231,223,0.22)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.rotate(spin);
    ctx.strokeStyle = s.heat >= cfg.red ? '#ff9c80' : '#c9d3da';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(26, 14, 56, 0);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.restore();
    text(ctx, `${Math.round(s.heat * 100)}%`, cx, cy + R - 18, mono(26, 700), s.heat >= cfg.red ? DANGER : TEXT, 'center');
    label(t('sf.heat'), cx, cy + R - 50, DIM, 'center');

    // right side: depth, noise
    const x0 = 660;
    label(t('sf.depth'), x0, 60);
    text(ctx, `${Math.floor(s.progress * 100)}%`, x0 + 528, 60, mono(44, 700), TEXT, 'right');
    ctx.fillStyle = 'rgba(236,231,223,0.08)';
    rr(ctx, x0, 96, 528, 56, 4);
    ctx.fill();
    ctx.fillStyle = s.progress > 0.9 ? OK : ACCENT;
    rr(ctx, x0, 96, Math.max(0, 528 * s.progress), 56, 4);
    ctx.fill();
    for (let i = 1; i < 10; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x0 + i * 52.8 - 1, 96, 2, 56);
    }
    label(t('sf.noise'), x0, 230);
    const nz = Math.round(s.noise);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i < nz ? (i > 6 ? DANGER : i > 3 ? ACCENT : '#7fa6bf') : 'rgba(236,231,223,0.08)';
      ctx.fillRect(x0 + i * 53, 250, 46, 24);
    }
    const st = statusOf(s);
    text(ctx, st.text, x0, 350, display(46, 700), st.tone === 'bad' ? DANGER : st.tone === 'ok' ? OK : s.drilling ? TEXT : DIM, 'left', 528);
    // the bit's lives, as bits
    for (let i = 0; i < L.DRILL_MAX_BINDS; i++) {
      const alive = i >= s.binds;
      ctx.strokeStyle = alive ? TEXT : 'rgba(236,231,223,0.18)';
      ctx.lineWidth = alive ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(x0 + 18 + i * 56, 400);
      ctx.lineTo(x0 + 18 + i * 56, 460);
      ctx.stroke();
      if (!alive) {
        ctx.strokeStyle = DANGER;
        ctx.beginPath();
        ctx.moveTo(x0 + 6 + i * 56, 420);
        ctx.lineTo(x0 + 30 + i * 56, 440);
        ctx.stroke();
      }
    }
  };

  const draw = (now: number) => {
    const s = state;
    if (!s) return;
    clear();
    if (s.kind === 'mech') drawMech(s);
    else if (s.kind === 'elek') drawElek(s, now);
    else drawDrill(s, now);
  };

  // ------------------------------------------------------------------ flow
  const hide = () => {
    el.classList.add('hidden');
    el.classList.remove('strike', 'good', 'won', 'lost');
    el.parentElement?.classList.remove('sf-open');
    stopDrill();
    const p = frozenPlayer ?? deps.player();
    if (p) p.frozen = false;
    frozenPlayer = null;
    closeT = -1;
  };

  const end = (gaveUp: boolean) => {
    const s = state;
    if (!s || !running) return;
    running = false;
    const o = L.safeOutcome(s);
    const r: SkillResult = o
      ? { ok: o.ok, seconds: o.seconds, noise: o.noise, fumbles: o.fumbles }
      : { ok: false, seconds: Math.round(s.t * 10) / 10, noise: s.kind === 'elek' ? 0 : s.noise, fumbles: s.fumbles, gaveUp: true };
    if (gaveUp) r.gaveUp = true;
    lastResult = r;
    const cb = finish;
    finish = null;
    if (gaveUp) hide();
    else {
      closeT = CLOSE_AFTER;
      el.classList.add(r.ok ? 'won' : 'lost');
      stopDrill();
      refreshChrome(true);
    }
    cb?.(r);
  };

  const handle = (evs: L.Ev[], s: L.SafeState) => {
    for (const e of evs) {
      switch (e.k) {
        case 'tick':
          sfx('tick', e.n ?? 0);
          break;
        case 'enter':
          sfx('enter');
          break;
        case 'set':
          sfx('set');
          goodT = 0.35;
          if (s.kind === 'mech' && s.step < 3) {
            msg = t('sf.st.set', { dir: dirWord(s.dirs[s.step]) });
            msgTone = 'ok';
            msgT = 1.6;
          }
          break;
        case 'slip':
          sfx('slip');
          flashT = 0.4;
          msg = t('sf.st.slip');
          msgTone = 'bad';
          msgT = 1.6;
          break;
        case 'miss':
          sfx('miss');
          break;
        case 'digit':
          sfx(e.n ? 'hotdigit' : 'digit');
          break;
        case 'ok':
          sfx('ok');
          goodT = 0.35;
          break;
        case 'wrong':
          sfx('wrong');
          flashT = 0.4;
          break;
        case 'unlock':
          sfx('unlock');
          break;
        case 'bind':
          sfx('bind');
          flashT = 0.4;
          break;
        case 'open':
          sfx('open');
          break;
        case 'fail':
          sfx(s.kind === 'drill' && s.status === 'broke' ? 'broke' : 'fail');
          break;
      }
    }
  };

  const game: SafeGame = {
    id: 'safe',

    start(r, done) {
      if (running) return;
      if (closeT >= 0) hide();
      finish = done;
      const variant = L.toVariant(r.variant);
      const diff = L.toDiff(r.difficulty);
      state = L.safeNew(variant, Number.isFinite(r.seed) ? r.seed >>> 0 : 1, diff, r.timeLimit > 0 ? r.timeLimit : 0);
      running = true;
      skipInput = true; // the key that opened the game is not an input
      msgT = flashT = goodT = 0;
      lastStatus = lastSlips = '';
      lastTime = -2;
      lastTone = 'x' as Tone;
      const p = deps.player();
      if (p) {
        p.frozen = true;
        frozenPlayer = p;
      }
      timeEl.classList.toggle('hidden', !(r.timeLimit > 0));
      timeEl.classList.remove('low');
      el.classList.remove('hidden', 'strike', 'good', 'won', 'lost');
      el.parentElement?.classList.add('sf-open');
      renderChrome();
      sfx('start');
    },

    cancel() {
      const was = running || closeT >= 0;
      running = false;
      finish = null;
      if (was) hide();
    },

    active: () => running,

    update(dt, time) {
      clock = time;
      if (!state || el.classList.contains('hidden')) return;
      dt = Math.min(dt, 0.05);
      const p = frozenPlayer;
      if (running) {
        if (p) p.frozen = true;
        const s = state;
        if (skipInput) skipInput = false;
        else if (input.codePressed('Escape') || input.codePressed('KeyQ')) {
          end(true);
          return;
        }
        const left = input.codeHeld('KeyA') || input.codeHeld('ArrowLeft');
        const right = input.codeHeld('KeyD') || input.codeHeld('ArrowRight');
        const space = input.codePressed('Space');
        const inp: L.SafeInput = {
          dir: left === right ? 0 : left ? -1 : 1,
          slow: input.codeHeld('ShiftLeft') || input.codeHeld('ShiftRight'),
          act: space,
          hold: input.codeHeld('Space'),
        };
        const evs = L.safeStep(s, inp, dt);
        handle(evs, s);
        if (s.kind === 'drill') drillSound(s.drilling, s.heat, dt);
        if (s.status !== 'run') end(false);
      } else if (closeT >= 0) {
        closeT -= dt;
        if (closeT <= 0) {
          hide();
          return;
        }
      }
      if (flashT > 0) {
        flashT -= dt;
        el.classList.toggle('strike', flashT > 0);
      }
      if (goodT > 0) {
        goodT -= dt;
        el.classList.toggle('good', goodT > 0);
      }
      if (msgT > 0) msgT -= dt;
      draw(clock);
      refreshChrome();
    },

    debugFinish(ok) {
      const s = state;
      if (!s || !running) return;
      s.status = ok ? 'open' : s.kind === 'elek' ? 'lockout' : s.kind === 'drill' ? 'broke' : 'timeout';
      end(false);
    },

    debug: {
      state: () => (running ? state : null),
      view: () => {
        if (!state) return null;
        return {
          variant: state.kind,
          visible: !el.classList.contains('hidden'),
          title: titleEl.textContent ?? '',
          status: statusEl.textContent ?? '',
          keys: keysEl.textContent ?? '',
          slips: slipsEl.textContent ?? '',
          time: state.limit > 0 ? Math.max(0, 1 - state.t / state.limit) : -1,
        };
      },
      last: () => lastResult,
    },
  };
  return game;
}
