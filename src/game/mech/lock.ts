// Lock picking: the skill game for doors and display cases (contract: ./skill.ts).
//
// A keyboard overlay under #ui. A marker sweeps over the current pin's travel; Space or E while it is inside
// the bright zone sets the pin, outside it is a slip (noise, the pin drops). The rules live in lock-logic.ts,
// this file is the overlay, the sounds and the hand-over to the job director. Local to the player: no network.
import './lock.css';
import type { LevelDeps } from '../level';
import type { SkillGame, SkillGameFactory, SkillRequest, SkillResult } from './skill';
import { t, registerStrings, onLangChange } from '../../core/i18n';
import { h } from '../../ui/ui';
import * as L from './lock-logic';

registerStrings(
  {
    'lk.label': 'LOCKPICK',
    'lk.title.door': 'Door lock',
    'lk.title.case': 'Display case lock',
    'lk.hint': 'Press when the marker is inside the bright zone.',
    'lk.set': 'Pin set',
    'lk.slip': 'Slip: the lock rattles',
    'lk.slip.back': 'Slip: the lock rattles and the last pin drops',
    'lk.open': 'OPEN',
    'lk.broke': 'The pick snapped',
    'lk.timeout': 'Out of time',
    'lk.slips': 'SLIPS LEFT',
    'lk.pins': 'PIN {n}/{max}',
    'lk.k.set': 'set the pin',
    'lk.k.leave': 'give up',
  },
  {
    'lk.label': 'DIETRICH',
    'lk.title.door': 'Türschloss',
    'lk.title.case': 'Vitrinenschloss',
    'lk.hint': 'Drück, wenn der Marker in der hellen Zone ist.',
    'lk.set': 'Stift gesetzt',
    'lk.slip': 'Abgerutscht: Das Schloss klackert',
    'lk.slip.back': 'Abgerutscht: Das Schloss klackert und der letzte Stift fällt',
    'lk.open': 'OFFEN',
    'lk.broke': 'Der Dietrich ist gebrochen',
    'lk.timeout': 'Die Zeit ist um',
    'lk.slips': 'FEHLVERSUCHE ÜBRIG',
    'lk.pins': 'STIFT {n}/{max}',
    'lk.k.set': 'Stift setzen',
    'lk.k.leave': 'aufgeben',
  },
);

type Sound = 'tick' | 'set' | 'slip' | 'open' | 'broke';
/** How long the result stays on screen after the game is over. */
const OUTRO = 1.1;
/** Walking (or being moved) further than this from where it began counts as walking away. */
const WALK_AWAY = 2.5;

export const createLockGame: SkillGameFactory = (deps: LevelDeps): SkillGame => {
  const { audio, input } = deps;

  let s: L.LockState | null = null;
  let done: ((r: SkillResult) => void) | null = null;
  let running = false;
  let outro = 0;
  let frozeIt = false;
  let skipInput = false;
  let unLang: (() => void) | null = null;
  let start0: { x: number; z: number } | null = null;
  let msgKey = '';
  let msgT = 0;
  let slipAnim = 0;
  let sig = '';
  let zoneFor = -1;

  // ---------------------------------------------------------------- DOM (built once)
  const labelEl = h('span', { class: 'label' });
  const titleEl = h('div', { class: 'lk-title' });
  const pinNoEl = h('div', { class: 'lk-pinno' });
  const clockEl = h('div', { class: 'lk-clock' });
  const timeFill = h('i');
  const timeEl = h('div', { class: 'lk-time' }, timeFill);
  const pinsEl = h('div', { class: 'lk-pins' });
  const zoneEl = h('div', { class: 'lk-zone' });
  const markerEl = h('div', { class: 'lk-marker' });
  const trackEl = h('div', { class: 'lk-track' }, zoneEl, markerEl);
  const msgEl = h('div', { class: 'lk-msg' });
  const slipsLabel = h('span', { class: 'label' });
  const slipsEl = h('span', { class: 'lk-dots' });
  const keysEl = h('div', { class: 'lk-keys' });
  const root = h(
    'div',
    { class: 'lock hidden' },
    h('div', { class: 'lk-head' }, labelEl, titleEl, pinNoEl, clockEl),
    timeEl,
    pinsEl,
    trackEl,
    h('div', { class: 'lk-foot' }, msgEl, h('div', { class: 'lk-slips' }, slipsLabel, slipsEl)),
    keysEl,
  );
  const ui = document.getElementById('ui') ?? document.body;
  ui.insertBefore(root, ui.querySelector('.menu')); // below the pause menu

  // ---------------------------------------------------------------- sound
  const sfx = (kind: Sound, rate = 1) => {
    const a = audio;
    if (!a.ready || a.ctx.state !== 'running') return;
    const at = a.ctx.currentTime + 0.001;
    switch (kind) {
      case 'tick': {
        const o = a.out(undefined, 0.035);
        a.tone(o, 'sine', 1500, 1500, at, 0.02, 1);
        break;
      }
      case 'set': {
        const o = a.out(undefined, 0.16);
        a.burst(o, 'bandpass', 2600 * rate, 3, at, 0.03, 0.9);
        a.tone(o, 'triangle', 420 * rate, 640 * rate, at, 0.06, 0.7);
        a.tone(o, 'sine', 1180 * rate, 1180 * rate, at + 0.04, 0.12, 0.25);
        break;
      }
      case 'slip': {
        const o = a.out(undefined, 0.2);
        a.burst(o, 'bandpass', 2200, 1.6, at, 0.3, 0.8, 0.004, 700);
        a.tone(o, 'sawtooth', 150, 95, at, 0.12, 0.35);
        break;
      }
      case 'open': {
        const o = a.out(undefined, 0.26);
        a.tone(o, 'sine', 120, 44, at, 0.28, 0.9);
        a.burst(o, 'lowpass', 600, 0.8, at, 0.14, 0.9);
        a.tone(o, 'triangle', 660, 990, at + 0.12, 0.2, 0.35);
        break;
      }
      case 'broke': {
        const o = a.out(undefined, 0.22);
        a.burst(o, 'highpass', 3200, 0.7, at, 0.06, 0.9);
        a.tone(o, 'square', 330, 90, at, 0.2, 0.5);
        break;
      }
    }
  };

  // ---------------------------------------------------------------- drawing
  const keycap = (txt: string) => h('span', { class: 'keycap' }, txt);
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.ceil(sec) % 60).padStart(2, '0')}`;

  /** Everything that depends on the language or the lock's size. */
  function renderChrome() {
    if (!s) return;
    labelEl.textContent = t('lk.label');
    titleEl.textContent = t('lk.title.' + s.variant);
    slipsLabel.textContent = t('lk.slips');
    keysEl.replaceChildren(
      h('span', { class: 'lk-key' }, keycap('Space'), h('span', {}, '/'), keycap('E'), h('span', {}, t('lk.k.set'))),
      h('span', { class: 'lk-key lk-leave' }, keycap('Q'), h('span', {}, t('lk.k.leave'))),
    );
    if (!pinsEl.childElementCount) {
      for (let i = 0; i < s.pins.length; i++) {
        pinsEl.append(h('div', { class: 'lk-pin' }, h('div', { class: 'lk-slot' }, h('div', { class: 'lk-bar' })), h('div', { class: 'lk-n' }, String(i + 1))));
      }
      slipsEl.replaceChildren(...Array.from({ length: s.maxSlips }, () => h('i')));
    }
    if (!msgKey) setMsg('lk.hint', 0);
    else msgEl.textContent = t(msgKey);
    sig = '';
    zoneFor = -1;
    draw();
  }

  function setMsg(key: string, secs = 1.3) {
    msgKey = key;
    msgT = secs;
    msgEl.textContent = t(key);
    msgEl.className = 'lk-msg' + (key === 'lk.hint' ? '' : key === 'lk.set' || key === 'lk.open' ? ' good' : ' bad');
  }

  function draw() {
    if (!s) return;
    const p = s.pins[s.cur];
    if (zoneFor !== s.cur) {
      zoneFor = s.cur;
      zoneEl.style.left = `${(p.c - p.w / 2) * 100}%`;
      zoneEl.style.width = `${p.w * 100}%`;
      pinNoEl.textContent = t('lk.pins', { n: s.cur + 1, max: s.pins.length });
    }
    markerEl.style.left = `${s.pos * 100}%`;
    trackEl.classList.toggle('hit', s.status === 'run' && L.inZone(s));
    const cur = s.cur;
    const key = s.set.map((v, i) => (v ? '1' : i === cur ? 'c' : '0')).join('') + '|' + s.slips + '|' + s.status;
    if (key !== sig) {
      sig = key;
      const pins = pinsEl.children;
      for (let i = 0; i < pins.length; i++) {
        pins[i].classList.toggle('set', s.set[i]);
        pins[i].classList.toggle('cur', i === s.cur && s.status === 'run');
      }
      const dots = slipsEl.children;
      for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('used', i < s.slips);
      root.classList.toggle('low', s.maxSlips - s.slips <= 2);
    }
    const left = L.timeLeft(s);
    timeEl.classList.toggle('hidden', left === null);
    clockEl.classList.toggle('hidden', left === null);
    if (left !== null) {
      timeFill.style.width = `${(left / s.timeLimit) * 100}%`;
      clockEl.textContent = fmt(left);
      timeEl.classList.toggle('low', left < s.timeLimit * 0.25);
      clockEl.classList.toggle('low', left < s.timeLimit * 0.25);
    }
  }

  // ---------------------------------------------------------------- life cycle
  function release() {
    unLang?.();
    unLang = null;
    root.classList.add('hidden');
    root.classList.remove('slip', 'open', 'broke', 'timeout', 'low');
    ui.classList.remove('lk-open');
    if (frozeIt) {
      const pl = deps.player();
      if (pl) pl.frozen = false;
      frozeIt = false;
    }
    outro = 0;
    running = false;
    s = null;
    done = null;
  }

  function finish(gaveUp: boolean) {
    if (!s || !running) return;
    const st = s;
    const cb = done;
    running = false;
    done = null;
    const result: SkillResult = { ok: st.status === 'open', seconds: Math.round(st.time * 10) / 10, noise: st.noise, fumbles: st.slips };
    if (gaveUp) result.gaveUp = true;
    if (gaveUp) {
      release();
    } else {
      // leave the verdict on screen for a moment; the player stays frozen until it fades
      root.classList.add(st.status);
      setMsg(st.status === 'open' ? 'lk.open' : st.status === 'broke' ? 'lk.broke' : 'lk.timeout', 99);
      sfx(st.status === 'open' ? 'open' : 'broke');
      draw();
      outro = OUTRO;
    }
    cb?.(result);
  }

  function start(req: SkillRequest, cb: (r: SkillResult) => void) {
    if (running || outro > 0) release();
    s = L.generate(L.toVariant(req.variant), L.toDiff(req.difficulty), req.seed >>> 0, req.timeLimit);
    done = cb;
    running = true;
    skipInput = true; // the E that opened the lock is not a pick
    msgKey = '';
    msgT = 0;
    slipAnim = 0;
    pinsEl.replaceChildren();
    const pl = deps.player();
    if (pl) {
      pl.frozen = true;
      frozeIt = true;
      start0 = { x: pl.position.x, z: pl.position.z };
    } else start0 = null;
    root.classList.remove('hidden', 'slip', 'open', 'broke', 'timeout', 'low');
    ui.classList.add('lk-open'); // the objective box would only sit half behind it
    unLang = onLangChange(renderChrome);
    renderChrome();
  }

  function update(dt: number) {
    if (!s) return;
    if (!running) {
      // the verdict fades out
      outro -= dt;
      if (outro <= 0) release();
      return;
    }
    dt = Math.min(dt, 0.1);
    const pl = deps.player();
    if (pl) {
      pl.frozen = true;
      if (start0 && Math.hypot(pl.position.x - start0.x, pl.position.z - start0.z) > WALK_AWAY) return finish(true);
    }
    if (skipInput) skipInput = false;
    else {
      if (input.codePressed('Escape') || input.codePressed('KeyQ')) return finish(true);
      if (input.codePressed('Space') || input.codePressed('KeyE')) {
        const was = s.cur;
        const r = L.press(s);
        if (r === 'set') sfx('set', 1 + 0.07 * was), setMsg('lk.set', 0.7);
        else if (r === 'slip' || r === 'broke') {
          sfx('slip');
          setMsg(s.diff >= 3 && was > 0 ? 'lk.slip.back' : 'lk.slip');
          slipAnim = 0.4;
          root.classList.add('slip');
        } else if (r === 'open') sfx('set', 1 + 0.07 * was);
      }
    }
    if (L.step(s, dt)) sfx('tick');
    if (msgT > 0 && s.status === 'run') {
      msgT -= dt;
      if (msgT <= 0) setMsg('lk.hint', 0);
    }
    if (slipAnim > 0) {
      slipAnim -= dt;
      if (slipAnim <= 0) root.classList.remove('slip');
    }
    draw();
    if (s.status !== 'run') finish(false);
  }

  return {
    id: 'lock',
    start,
    cancel() {
      if (s) release();
    },
    active: () => running,
    update,
    debugFinish(ok: boolean) {
      if (!s || !running) return;
      if (ok) {
        s.set.fill(true);
        s.status = 'open';
      } else s.status = 'broke';
      finish(false);
    },
    /** Test hooks: the live lock state and the helpers a bot needs. */
    ...({
      debug: {
        state: () => s,
        pressIn: () => (s ? L.pressIn(s) : Infinity),
        botShouldPress: (lead?: number) => (s ? L.botShouldPress(s, lead) : false),
        overlay: () => root,
        outro: () => outro > 0,
      },
    } as object),
  };
};
