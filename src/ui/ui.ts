// DOM overlay: menus, settings, HUD, toasts, subtitles.
import './styles.css';
import { t, onLangChange } from '../core/i18n';
import { settings, PLAYER_COLORS, type QualityName, type Settings } from '../core/settings';
import type { MicState } from '../net/voice';

export const VERSION = '0.1.0';

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export interface UIEvents {
  onCreate(): void;
  onJoin(code: string): void;
  onResume(): void;
  onLeave(): void;
  onInvite(): void;
  onSound(kind: 'ui' | 'uiHover'): void;
}

export interface CrewRow {
  name: string;
  color: number;
  you: boolean;
  host: boolean;
  talking: boolean;
}

type MenuMode = 'main' | 'pause' | 'none';

export class UI {
  private root: HTMLElement;
  private menu!: HTMLElement;
  private hud!: HTMLElement;
  private boot!: HTMLElement;
  private veil!: HTMLElement;
  private crosshair!: HTMLElement;
  private promptEl!: HTMLElement;
  private objectiveEl!: HTMLElement;
  private objectiveText!: HTMLElement;
  private crewEl!: HTMLElement;
  private micEl!: HTMLElement;
  private micText!: HTMLElement;
  private statsEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private subtitleEl!: HTMLElement;
  private toastsEl!: HTMLElement;
  private mode: MenuMode = 'main';
  private view: 'home' | 'settings' = 'home';
  private busy = false;
  private error = '';
  private inviteCode: string | null;
  private subQueue: { key: string; vars?: Record<string, string | number>; dur: number }[] = [];
  private subTimer: number | null = null;
  private lastPrompt = '';
  private lastObjective = '';
  private lastCrew = '';
  private lastMic = '';
  private codeDraft = '';

  constructor(
    root: HTMLElement,
    private ev: UIEvents,
    inviteCode: string | null,
  ) {
    this.root = root;
    this.inviteCode = inviteCode;
    this.build();
    onLangChange(() => this.refresh());
  }

  private build() {
    this.veil = h('div', { class: 'veil' });
    this.hud = h('div', { class: 'hud hidden' });
    this.crosshair = h('div', { class: 'crosshair' });
    this.promptEl = h('div', { class: 'prompt hidden' });
    this.objectiveText = h('div', { class: 'objective-text' });
    this.objectiveEl = h('div', { class: 'objective hidden' }, h('div', { class: 'label', 'data-i18n': 'hud.objective' }, t('hud.objective')), this.objectiveText);
    this.crewEl = h('div', { class: 'crew' });
    this.micText = h('span');
    this.micEl = h('div', { class: 'mic off' }, h('i', { class: 'mic-dot' }), this.micText);
    this.statsEl = h('div', { class: 'stats' });
    this.hintEl = h('div', { class: 'hint', 'data-i18n': 'hud.controls' }, t('hud.controls'));
    this.subtitleEl = h('div', { class: 'subtitle' });
    this.toastsEl = h('div', { class: 'toasts' });
    this.hud.append(this.crosshair, this.promptEl, this.objectiveEl, this.crewEl, this.micEl, this.statsEl, this.hintEl, this.subtitleEl);
    this.menu = h('div', { class: 'menu interactive' });
    this.boot = h('div', { class: 'boot' }, this.logo(), h('div', { class: 'boot-bar' }, h('i')));
    this.root.append(this.veil, this.hud, this.menu, this.toastsEl, this.boot);
    this.renderMenu();
  }

  private logo(): HTMLElement {
    const mark = h('div', { class: 'logo-mark' }, h('b', {}, 'Ø'), ' NULL VAULT');
    return h('div', { class: 'logo' }, mark, h('div', { class: 'logo-tag' }, t('title.tag')), h('div', { class: 'logo-rule' }));
  }

  // ---------------------------------------------------------------- menus

  showMenu(mode: MenuMode) {
    this.mode = mode;
    this.view = 'home';
    this.busy = false;
    this.menu.classList.toggle('hidden', mode === 'none');
    this.menu.classList.toggle('paused', mode === 'pause');
    this.hud.classList.toggle('hidden', mode === 'main');
    if (mode !== 'none') this.renderMenu();
  }

  menuMode(): MenuMode {
    return this.mode;
  }

  setBusy(busy: boolean) {
    this.busy = busy;
    this.renderMenu();
  }

  setError(text: string) {
    this.error = text;
    this.renderMenu();
  }

  private btn(labelKey: string, cls: string, onClick: () => void, vars?: Record<string, string>): HTMLButtonElement {
    const b = h('button', { class: 'btn ' + cls, type: 'button' }, t(labelKey, vars));
    b.addEventListener('click', () => {
      this.ev.onSound('ui');
      onClick();
    });
    b.addEventListener('mouseenter', () => this.ev.onSound('uiHover'));
    if (this.busy) b.disabled = true;
    return b;
  }

  private renderMenu() {
    if (this.mode === 'none') return;
    const col = h('div', { class: 'menu-col' });
    if (this.view === 'settings') {
      col.append(h('div', { class: 'label' }, t('menu.settings')), this.settingsPanel(), this.btn('menu.back', 'ghost', () => {
        this.view = 'home';
        this.renderMenu();
      }));
    } else if (this.mode === 'main') {
      const name = h('input', { type: 'text', maxlength: '16', placeholder: t('menu.name.ph'), value: settings.get('name'), autocomplete: 'off', spellcheck: 'false' });
      name.addEventListener('input', () => settings.set('name', name.value.trim().slice(0, 16)));
      const swatches = h('div', { class: 'swatches' });
      PLAYER_COLORS.forEach((c, i) => {
        const hex = '#' + c.toString(16).padStart(6, '0');
        const s = h('button', { class: 'swatch' + (settings.get('color') === i ? ' on' : ''), type: 'button', style: `background:${hex};color:${hex}`, 'aria-label': hex });
        s.addEventListener('click', () => {
          settings.set('color', i);
          this.ev.onSound('ui');
          this.renderMenu();
        });
        swatches.append(s);
      });
      col.append(
        this.logo(),
        h('div', { class: 'field' }, h('div', { class: 'label' }, t('menu.name')), name),
        h('div', { class: 'field' }, h('div', { class: 'label' }, t('menu.color')), swatches),
      );
      if (this.inviteCode) {
        col.append(this.btn('menu.joinCode', 'primary', () => this.ev.onJoin(this.inviteCode!), { code: this.inviteCode }));
        col.append(this.btn('menu.create', '', () => this.ev.onCreate()));
      } else {
        col.append(this.btn('menu.create', 'primary', () => this.ev.onCreate()));
        const code = h('input', { type: 'text', class: 'code', maxlength: '5', placeholder: t('menu.code.ph'), value: this.codeDraft, autocomplete: 'off', spellcheck: 'false' });
        const join = this.btn('menu.join', '', () => this.ev.onJoin(code.value));
        code.addEventListener('input', () => {
          code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
          this.codeDraft = code.value;
        });
        code.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') join.click();
        });
        col.append(h('div', { class: 'row' }, code, join));
      }
      col.append(
        this.btn('menu.settings', 'ghost', () => {
          this.view = 'settings';
          this.renderMenu();
        }),
        h('div', { class: 'menu-error' }, this.busy ? t('menu.connecting') : this.error),
      );
    } else {
      col.append(
        h('div', { class: 'logo' }, h('div', { class: 'logo-mark', style: 'font-size:34px' }, t('menu.paused')), h('div', { class: 'logo-rule' })),
        this.btn('menu.resume', 'primary', () => this.ev.onResume()),
        this.btn('menu.invite', '', () => this.ev.onInvite()),
        this.btn('menu.settings', '', () => {
          this.view = 'settings';
          this.renderMenu();
        }),
        this.btn('menu.leave', 'danger', () => this.ev.onLeave()),
      );
    }
    const nodes: Node[] = [col];
    if (this.mode === 'main') {
      nodes.push(h('div', { class: 'menu-foot' }, h('span', {}, t('hud.controls')), h('span', {}, t('menu.build', { v: VERSION }))));
    }
    this.menu.replaceChildren(...nodes);
  }

  private settingsPanel(): HTMLElement {
    const seg = <K extends keyof Settings>(key: K, options: [Settings[K], string][]) => {
      const el = h('div', { class: 'seg' });
      for (const [val, label] of options) {
        const b = h('button', { type: 'button', class: settings.get(key) === val ? 'on' : '' }, label);
        b.addEventListener('click', () => {
          settings.set(key, val);
          this.ev.onSound('ui');
          this.renderMenu();
        });
        el.append(b);
      }
      return el;
    };
    const slider = (key: 'sensitivity' | 'fov' | 'master' | 'sfx' | 'music' | 'voice', min: number, max: number, step: number) => {
      const el = h('input', { type: 'range', min, max, step, value: settings.get(key) });
      el.addEventListener('input', () => settings.set(key, Number(el.value)));
      return el;
    };
    const row = (labelKey: string, control: HTMLElement) => h('div', { class: 'set-row' }, h('span', {}, t(labelKey)), control);
    const onOff: [boolean, string][] = [
      [false, t('set.off')],
      [true, t('set.on')],
    ];
    return h(
      'div',
      { class: 'settings' },
      row('set.language', seg('lang', [['en', 'English'], ['de', 'Deutsch']])),
      row(
        'set.quality',
        seg(
          'quality',
          (['auto', 'low', 'medium', 'high', 'ultra'] as (QualityName | 'auto')[]).map((q) => [q, t('set.q.' + q)]),
        ),
      ),
      row('set.sensitivity', slider('sensitivity', 0.2, 3, 0.05)),
      row('set.fov', slider('fov', 60, 100, 1)),
      row('set.invertY', seg('invertY', onOff)),
      row('set.master', slider('master', 0, 1, 0.01)),
      row('set.sfx', slider('sfx', 0, 1, 0.01)),
      row('set.music', slider('music', 0, 1, 0.01)),
      row('set.voice', slider('voice', 0, 1, 0.01)),
      row('set.voiceMode', seg('voiceMode', [['open', t('set.vm.open')], ['ptt', t('set.vm.ptt')]])),
      row('set.showFps', seg('showFps', onOff)),
    );
  }

  // ---------------------------------------------------------------- boot

  hideBoot() {
    this.boot.style.opacity = '0';
    window.setTimeout(() => this.boot.remove(), 800);
  }

  fatal(message: string) {
    this.boot.replaceChildren(this.logo(), h('div', { class: 'fatal' }, message));
    this.boot.style.opacity = '1';
    if (!this.boot.isConnected) this.root.append(this.boot);
  }

  // ---------------------------------------------------------------- HUD

  setPrompt(p: { text: string; hold: boolean } | null) {
    const key = p ? (p.hold ? 'H' : 'P') + p.text : '';
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    this.crosshair.classList.toggle('focus', !!p);
    this.promptEl.classList.toggle('hidden', !p);
    if (p) this.promptEl.replaceChildren(h('span', { class: 'keycap' }, 'E'), h('span', {}, p.text));
  }

  setObjective(lines: string[]) {
    const key = lines.join('|');
    if (key === this.lastObjective) return;
    this.lastObjective = key;
    this.objectiveEl.classList.toggle('hidden', lines.length === 0);
    this.objectiveText.replaceChildren(...lines.map((l) => h('div', {}, l)));
  }

  setCrew(code: string, rows: CrewRow[]) {
    const key = code + JSON.stringify(rows) + settings.get('lang');
    if (key === this.lastCrew) return;
    this.lastCrew = key;
    const nodes: Node[] = [];
    if (code) nodes.push(h('div', { class: 'crew-code' }, h('span', { class: 'label' }, t('hud.code')), h('b', {}, code)));
    for (const r of rows) {
      const hex = '#' + PLAYER_COLORS[r.color % PLAYER_COLORS.length].toString(16).padStart(6, '0');
      const meta = [r.you ? t('hud.you') : '', r.host ? t('hud.host') : ''].filter(Boolean).join(' · ');
      nodes.push(
        h(
          'div',
          { class: 'crew-item' },
          h('i', { class: 'crew-dot', style: `background:${hex};box-shadow:0 0 8px ${hex}` }),
          h('span', { class: 'crew-name' }, r.name),
          h('span', { class: 'bars' + (r.talking ? ' on' : '') }, h('i'), h('i'), h('i')),
          meta ? h('span', { class: 'crew-meta' }, meta) : null,
        ),
      );
    }
    this.crewEl.replaceChildren(...nodes);
  }

  setMic(state: MicState, speaking: boolean) {
    const key = state + speaking + settings.get('lang');
    if (key === this.lastMic) return;
    this.lastMic = key;
    this.micEl.className = 'mic ' + (state === 'live' || state === 'ptt' ? 'live' : state) + (speaking ? ' speaking' : '');
    this.micText.textContent = t(state === 'live' ? 'hud.mic.on' : state === 'muted' ? 'hud.mic.muted' : state === 'ptt' ? 'hud.mic.ptt' : 'hud.mic.off');
  }

  setStats(text: string) {
    if (this.statsEl.textContent !== text) this.statsEl.textContent = text;
  }

  fadeHint() {
    this.hintEl.style.opacity = '0';
  }

  toast(text: string, kind: '' | 'warn' = '', ms = 4200) {
    const el = h('div', { class: 'toast ' + kind }, text);
    this.toastsEl.append(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild?.remove();
    window.setTimeout(() => {
      el.style.opacity = '0';
      window.setTimeout(() => el.remove(), 450);
    }, ms);
  }

  /** Queue a subtitle line (translated at display time, so language switches apply). */
  say(key: string, vars?: Record<string, string | number>) {
    const text = t(key, vars);
    this.subQueue.push({ key, vars, dur: Math.max(3200, text.length * 62) });
    if (this.subTimer === null) this.nextSub();
  }

  clearSubtitles() {
    this.subQueue = [];
    if (this.subTimer !== null) clearTimeout(this.subTimer);
    this.subTimer = null;
    this.subtitleEl.classList.remove('on');
  }

  private nextSub() {
    const s = this.subQueue.shift();
    if (!s) {
      this.subTimer = null;
      this.subtitleEl.classList.remove('on');
      return;
    }
    const text = t(s.key, s.vars);
    const m = /^([A-ZÄÖÜ ]{2,14}):\s*(.*)$/s.exec(text);
    if (m) this.subtitleEl.replaceChildren(h('b', {}, m[1] + ' '), m[2]);
    else this.subtitleEl.textContent = text;
    this.subtitleEl.classList.add('on');
    this.ev.onSound('uiHover');
    this.subTimer = window.setTimeout(() => {
      this.subtitleEl.classList.remove('on');
      this.subTimer = window.setTimeout(() => this.nextSub(), 320);
    }, s.dur);
  }

  setVeil(opacity: number, instant = false) {
    this.veil.style.transition = instant ? 'none' : '';
    this.veil.style.opacity = String(opacity);
  }

  refresh() {
    this.lastPrompt = this.lastObjective = this.lastCrew = this.lastMic = '\0';
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
    this.renderMenu();
  }
}
