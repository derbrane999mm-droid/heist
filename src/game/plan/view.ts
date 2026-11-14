// The planning-round overlay: a port of the prototype's single-player UI
// (out/plan-test/src/ui.js) to a shared, host-driven view. It renders the
// replicated state 'plan' plus this player's private message, and sends
// every click as the intent 'plan.act'. While it is open the pointer is free,
// the player cannot move, and voice chat keeps running.
import './plan.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import type { Session } from '../../net/session';
import type { Input } from '../../core/input';
import type { AudioEngine } from '../../core/audio';
import type { Player } from '../player';
import { settings } from '../../core/settings';
import { onLangChange } from '../../core/i18n';
import { tx, pt, eur, type Txt, type Lang } from './texts';
import { VARGA, ROLE_ORDER, STAKE_ORDER, POSTS, ACCUSE_BONUS, ACCUSE_FINE, SHOP_GROUPS, offerDef, toolAdvice, shopCover, type Role, type FactKey, type ShopGroupId } from './logic';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const STEPS = ['stake', 'brief', 'scout', 'shop', 'plan', 'run', 'debrief'] as const;
const stepOf = (phase: string, mid: boolean): number => {
  if (phase === 'stake') return 0;
  if (phase === 'brief') return 1;
  if (phase === 'scout' || phase === 'facts') return 2;
  if (phase === 'offer') return mid ? 5 : 2;
  if (phase === 'shop') return 3;
  if (phase === 'plan') return 4;
  if (phase === 'run') return 5;
  return 6;
};

export class PlanView {
  readonly el: HTMLElement;
  private s: Session | null = null;
  private priv: any = null;
  private key = '';
  private shownPhase = '';
  /** what the mouse is over in the shop: facts to light up on the floor plan, tool to explain */
  private hoverHl = '';
  private hoverTool = '';
  /** scouting and plan: the row or entrance under the mouse, whose details show in the footer line */
  private hoverInfo = '';
  private shownJob: unknown = null;
  private open = false;
  private dismissed = -1;
  private frozeIt = false;
  private talk = false;
  private offerSel: { t: string | null; p: string | null } = { t: null, p: null };
  /** shop: the full tool list is open (this page only, not replicated; closed on every phase change) */
  private shopAll = false;
  private accSel: string | null = null;
  private openDetails = new Set<string>();
  private lastBeats = 0;
  private lastSec = -1;
  private unsub: (() => void)[] = [];
  /** Every private message this client received (tests check that it only ever holds its own). */
  readonly received: any[] = [];
  /**
   * First-person job (set by the job director, src/game/job): while it returns true for the current state,
   * the overlay opens only when this player has to act (his decision card, his secret offer) and the
   * director's HUD shows the rest. The pointer is locked again and the player can walk otherwise.
   */
  hudMode: ((p: any) => boolean) | null = null;

  constructor(
    root: HTMLElement,
    private input: Input,
    private audio: AudioEngine,
    private player: () => Player | null,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'plan-ov interactive hidden';
    root.append(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('mouseover', (e) => this.onHover(e.target as HTMLElement));
    this.el.addEventListener('focusin', (e) => this.onHover(e.target as HTMLElement));
    this.el.addEventListener('mouseleave', () => this.onHover(null));
    this.el.addEventListener('toggle', (e) => {
      const d = e.target as HTMLDetailsElement;
      const k = d.dataset?.dk;
      if (!k) return;
      if (d.open) this.openDetails.add(k);
      else this.openDetails.delete(k);
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV') this.talk = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyV') this.talk = false;
    });
    window.addEventListener('blur', () => (this.talk = false));
    onLangChange(() => (this.key = ''));
  }

  /** Push-to-talk while the overlay holds the pointer (game input is off then). */
  talkHeld() {
    return this.open && this.talk;
  }
  isOpen() {
    return this.open;
  }

  attach(s: Session) {
    this.s = s;
    this.key = '';
    this.shownPhase = '';
    this.shownJob = null;
    this.unsub.push(
      s.onPrivate((name, a) => {
        if (name !== 'plan.priv') return;
        this.received.push(a);
        // a different offer starts with nothing picked
        const was = this.priv?.offer, now = a?.offer;
        if ((was?.id ?? null) !== (now?.id ?? null) || (was?.when ?? null) !== (now?.when ?? null)) this.offerSel = { t: null, p: null };
        this.priv = a;
        this.key = '';
      }),
    );
  }

  detach() {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.s = null;
    this.priv = null;
    this.setOpen(false, false);
  }

  private lang(): Lang {
    return settings.get('lang') === 'en' ? 'en' : 'de';
  }
  private pub(): any {
    return this.s?.get('plan') ?? null;
  }
  private myRole(p: any): Role | null {
    const me = this.s?.pid;
    return (p?.seats?.find((x: any) => x.pid === me)?.role as Role) ?? null;
  }

  private setOpen(on: boolean, relock = true) {
    if (on === this.open) return;
    this.open = on;
    this.el.classList.toggle('hidden', !on);
    const pl = this.player();
    if (on) {
      this.input.unlock();
      if (pl && !pl.frozen) {
        pl.frozen = true;
        this.frozeIt = true;
      }
    } else {
      if (pl && this.frozeIt) pl.frozen = false;
      this.frozeIt = false;
      if (relock) void this.input.lock();
    }
  }

  update() {
    const s = this.s;
    const p = this.pub();
    // while the lineup runs its own overlay is in charge
    let want = !!s && !!p && p.phase && p.phase !== 'lineup' && !(p.phase === 'debrief' && this.dismissed === p.job);
    if (want && this.hudMode?.(p)) want = this.needsMe(p);
    this.setOpen(!!want);
    if (!want) return;
    if (this.priv && this.priv.job !== p.job) this.priv = null;
    const key = [p.job, p.v, p.phase, JSON.stringify(this.priv), this.offerSel.t, this.offerSel.p, this.accSel, this.shopAll, this.lang()].join('|');
    if (key !== this.key) {
      const newBeats = (p.run?.beats?.length ?? 0) > this.lastBeats;
      // tracked apart from the key: a click clears the key to force a redraw, and that must not count as a new phase
      // (it used to, which wiped the target picked for a secret offer before it could be accepted)
      const phaseChanged = this.shownPhase !== p.phase || this.shownJob !== p.job;
      this.shownPhase = p.phase;
      this.shownJob = p.job;
      if (phaseChanged) {
        this.offerSel = { t: null, p: null };
        this.shopAll = false;
        this.hoverHl = this.hoverTool = this.hoverInfo = '';
        if (p.phase !== 'accuse') this.accSel = null;
      }
      this.key = key;
      this.render(p, phaseChanged, newBeats);
      this.lastBeats = p.run?.beats?.length ?? 0;
      if (newBeats) this.audio.play('tick', { vol: 0.5 });
    }
    this.updateTimer(p);
  }

  /** First-person job: does this player have to act on the overlay right now? */
  needsMe(p: any): boolean {
    const me = this.myRole(p);
    if (!me) return false;
    if (p.phase === 'run') return !!p.run?.decision && p.run.decision.who === me && !p.run.decision.bot;
    if (p.phase === 'offer' && p.mid) return !!this.priv?.offer && !this.priv.offer.answered && this.priv.job === p.job;
    return true;
  }

  private updateTimer(p: any) {
    const el = this.el.querySelector('.pl-timer') as HTMLElement | null;
    if (!el || !this.s) return;
    const left = p.deadline ? Math.max(0, p.deadline - this.s.hostNow()) : 0;
    const sec = Math.ceil(left / 1000);
    if (sec === this.lastSec && el.dataset.on === String(!!p.deadline)) return;
    this.lastSec = sec;
    el.dataset.on = String(!!p.deadline);
    const txt = el.querySelector('b');
    if (txt) txt.textContent = p.deadline ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '';
    el.classList.toggle('hot', !!p.deadline && sec <= 10);
    if (p.deadline && sec <= 5 && sec > 0) this.audio.play('tick', { vol: 0.4 });
  }

  // ------------------------------------------------------------------ helpers

  private ctx(p: any) {
    const lang = this.lang();
    return { lang, name: (r: string) => p.seats?.find((x: any) => x.role === r)?.name ?? pt('role.' + r + '.name') };
  }
  private T(p: any, x: Txt | string | null | undefined) {
    return esc(tx(x as any, this.ctx(p)));
  }
  private K(k: string, vars?: Record<string, string | number>) {
    return esc(pt(k, vars, this.lang()));
  }
  private det(body: string, label?: string, key?: string) {
    if (!body) return '';
    const k = key ?? label ?? 'd';
    return `<details class="det" data-dk="${esc(k)}"${this.openDetails.has(k) ? ' open' : ''}><summary>${label ? esc(label) : this.K('ui.details')}</summary><div class="detbody">${body}</div></details>`;
  }
  private tags(list: string[], cls = '') {
    return list
      .filter(Boolean)
      .slice(0, 2)
      .map((t) => `<span class="tag ${cls}">${t}</span>`)
      .join('');
  }
  private card(o: { sel?: boolean; dis?: boolean; data: string; title: string; text?: string; tags?: string[]; tagcls?: string; px?: string; pct?: number; pctLabel?: string; details?: string; dk: string; ro?: boolean }) {
    const right = o.pct !== undefined ? `<div class="pct">${o.pct} %<small>${o.pctLabel ?? ''}</small></div>` : o.px ? `<span class="px">${o.px}</span>` : '';
    const ro = o.ro ? ' ro' : '';
    return `<div class="card${o.sel ? ' sel' : ''}${o.dis ? ' dis' : ''}${ro}"><button type="button" class="cardbtn" ${o.data}${o.dis || o.ro ? ' aria-disabled="true"' : ''}${o.sel !== undefined ? ` aria-pressed="${!!o.sel}"` : ''}><div class="cmain"><h3>${o.title}</h3>${o.text ? `<div class="d">${o.text}</div>` : ''}${o.tags && o.tags.length ? `<div class="tags">${this.tags(o.tags, o.tagcls)}</div>` : ''}</div>${right}</button>${o.details ? this.det(o.details, undefined, o.dk) : ''}</div>`;
  }
  private name(p: any, r: string) {
    return esc(this.ctx(p).name(r));
  }

  // ------------------------------------------------------------------ render

  private render(p: any, phaseChanged: boolean, newBeats: boolean) {
    // the part of the panel that scrolls (the shop keeps its footer outside of it)
    const scroller = () => (this.el.querySelector('.pl-panel .shp-body, .pl-panel .sct-body, .pl-panel .pln-body') || this.el.querySelector('.pl-panel')) as HTMLElement | null;
    const panelOld = scroller();
    const scroll = panelOld && !phaseChanged ? panelOld.scrollTop : 0;
    const me = this.myRole(p);
    let body: string;
    if (p.phase === 'lineup') {
      body = `<div class="pl-wait"><div class="kicker">${this.K('ui.brand')}</div><h2>${this.K('ui.job')}</h2><p class="lead">${this.K('ui.waitingLineup')}</p></div>`;
      this.el.innerHTML = `<div class="pl-app pl-only">${body}</div>`;
      return;
    }
    const head = this.header(p, me);
    const panel = this.panel(p, me);
    const ov = this.overview(p);
    this.el.innerHTML = `<div class="pl-app pl-ph-${esc(p.phase)}">${head}<main><section class="pl-left${ov ? ' ov-on' : ''}">${ov}<div class="cap"><span>${this.K('ui.floor')}</span><span>${this.K(p.phase === 'debrief' ? 'ui.floorKeyEnd' : p.phase === 'shop' ? 'ui.floorKeyShop' : 'ui.floorKey')}</span></div><div class="pl-floor">${this.floor(p)}</div>${this.crew(p, me)}</section><section class="pl-panel" aria-live="polite">${panel}</section></main></div>`;
    const pn = scroller()!;
    if (p.phase === 'run' || (p.phase === 'offer' && p.mid)) {
      const tgt = (pn.querySelector('.decision') || pn.querySelector('.private') || pn.querySelector('.beat.cur')) as HTMLElement | null;
      if (tgt && (newBeats || phaseChanged || p.run?.decision)) pn.scrollTop = Math.max(0, tgt.offsetTop - pn.offsetTop - 140);
      else pn.scrollTop = scroll;
    } else pn.scrollTop = scroll;
    this.lastSec = -1;
    if (p.phase !== 'shop' && p.phase !== 'scout' && p.phase !== 'plan') this.hoverHl = this.hoverTool = this.hoverInfo = '';
    this.applyHover();
  }

  private header(p: any, me: Role | null) {
    const cur = stepOf(p.phase, p.mid);
    const steps = STEPS.map((k, i) => `<li class="${i === cur ? 'cur' : i < cur ? 'done' : ''}"><b>${i + 1}</b>${this.K('ui.step.' + k)}</li>`).join('');
    let st = '';
    const att = p.phase === 'debrief' && p.result ? p.result.attention : p.attention;
    const dots = (n: number, hot: boolean) => `<span class="dots${hot ? ' hot' : ''}">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
    st += `<span>${this.K('ui.cash')} <span class="v">${eur(p.budget)}</span></span>`;
    st += `<span>${this.K('ui.attention')} <span class="v">${att}/5</span>${dots(att, att >= 3)}</span>`;
    if (p.run && (p.phase === 'run' || (p.phase === 'offer' && p.mid))) {
      const R = p.run;
      st += `<span>${this.K('ui.minute')} <span class="v">${R.t}</span></span>`;
      if (!R.alarmKnown) st += `<span>${this.K('ui.round')} <span class="v">${R.t >= R.windowEnd ? this.K('ui.roundNow') : this.K('ui.roundIn', { n: R.windowEnd - R.t })}</span></span>`;
      st += `<span>${this.K('ui.noise')}<span class="meter">${Array.from({ length: 10 }, (_, i) => `<i class="${i < R.noise ? 'on' + (i >= 5 ? ' hi' : '') : ''}"></i>`).join('')}</span></span>`;
      if (R.alarmKnown) st += `<span class="alarmtag">${this.K('ui.alarmOn')}</span>`;
    } else st += `<span>${this.K('ui.stake')} <span class="v">${this.K('stake.' + p.stake + '.name')}</span></span>`;
    // who decides, and the clock
    const raw = (r: Role) => this.ctx(p).name(r) + (r === me ? ` (${pt('ui.you', undefined, this.lang())})` : '');
    const d = p.decider as Role | null;
    const seat = d ? p.seats.find((x: any) => x.role === d) : null;
    let who = '';
    if (p.phase === 'run' && p.run?.decision) who = p.run.decision.bot ? this.K('ui.decidesBot', { who: raw(d!) }) : this.K('ui.decides', { who: raw(d!) });
    else if (['scout', 'shop', 'plan'].includes(p.phase)) who = this.K('ui.everyone', { who: raw('brain') });
    else if (seat) who = seat.bot ? this.K('ui.decidesBot', { who: raw(d!) }) : this.K('ui.decides', { who: raw(d!) });
    else if (p.phase === 'offer') who = this.K(p.mid ? 'ph.offer.waitMid' : 'ph.offer.wait');
    else if (p.phase === 'accuse') who = this.K('ph.accuse.private');
    const timer = `<div class="pl-timer"><span>${p.deadline ? this.K('ui.left', { t: '' }).trim() : ''}</span> <b></b></div>`;
    return `<header><div class="brand">${this.K('ui.brand')} <span>· ${this.K('ui.job')}</span></div><ol class="steps">${steps}</ol><div class="status">${st}</div><div class="pl-who"><span class="whotxt">${who}</span>${timer}</div></header>`;
  }

  private crew(p: any, me: Role | null) {
    const rows = ROLE_ORDER.map((r) => {
      const seat = p.seats.find((x: any) => x.role === r);
      const status = p.run?.status?.[r];
      const post = p.plan?.posts?.[r];
      const tags: string[] = [];
      if (seat.bot) tags.push(`<span class="tag">${this.K('ui.bot')}</span>`);
      if (status && status !== 'ok') tags.push(`<span class="tag ${status === 'caught' ? 'bad' : 'acc'}">${this.K('status.' + status)}</span>`);
      const showPost = ['plan', 'run', 'accuse', 'debrief'].includes(p.phase) || (p.phase === 'offer' && p.mid);
      return `<div class="pl-seat${r === me ? ' me' : ''}${p.decider === r ? ' dec' : ''}"><b>${esc(seat.name)}${r === me ? ` <small>(${this.K('ui.you')})</small>` : ''}</b><span>${this.K('role.' + r + '.name')}${showPost && post ? ' · ' + this.K('post.' + post) : ''}</span><span class="st">${tags.join('')}</span></div>`;
    }).join('');
    return `<div class="pl-crew">${rows}</div><div class="pl-voice">${this.K('ui.voice')}</div>`;
  }

  private panel(p: any, me: Role | null): string {
    const fn = (this as any)['ph_' + p.phase];
    let h = fn ? fn.call(this, p, me) : '';
    if (!me && p.phase !== 'debrief') h = `<p class="pl-muted pl-spec">${this.K('ui.spectator')}</p>` + h;
    return h;
  }

  private factList(p: any) {
    let h = '<div class="facts">';
    for (const k of VARGA.factOrder) {
      const kn = p.known[k];
      h += `<div class="fact"><div class="k">${this.K('fact.' + k)}</div><div class="val ${!kn ? 'q' : kn.rumour ? 'r' : ''}">${kn ? this.K('fact.' + k + '.' + kn.v) + (kn.rumour ? ' ' + this.K('fact.rumour') : '') : '?'}</div></div>`;
    }
    return h + '</div>';
  }
  private waitBtn(p: any, role: Role) {
    return `<p class="pl-muted pl-waitfor">${this.K('ui.waitFor', { who: this.ctx(p).name(role) })}</p>`;
  }

  private ph_stake(p: any, me: Role | null) {
    const mine = me === 'gambler';
    let h = `<div class="kicker">${this.K('ph.stake.kicker', { who: this.ctx(p).name('gambler') })}</div><h2>${this.K('ph.stake.title')}</h2><p class="lead">${this.K('ph.stake.lead')}</p>`;
    if (p.attention0 >= 3) h += `<p class="pl-muted">${this.K('ph.stake.carry', { n: p.attention0 })}</p>`;
    h += '<div class="cards">' + STAKE_ORDER.map((id) => this.card({ sel: p.stake === id, ro: !mine, data: `data-stake="${id}"`, title: this.K(`stake.${id}.name`), text: this.K(`stake.${id}.text`), px: this.K(`stake.${id}.tag`), details: this.K(`stake.${id}.details`), dk: 'st' + id })).join('') + '</div>';
    h += mine ? `<div class="btnrow"><button class="pl-btn pri" data-act="confirm">${this.K('ph.stake.go', { s: pt('stake.' + p.stake + '.name') })}</button></div>` : this.waitBtn(p, 'gambler');
    return h;
  }

  private ph_brief(p: any, me: Role | null) {
    let h = `<div class="kicker">${this.K('ph.brief.kicker')}</div><h2>${this.K('ui.job')}</h2><p class="lead">${this.K('job.intro')}</p>`;
    h += `<p><b>${this.K('ph.brief.open')}</b> ${VARGA.factOrder.map((k) => `<span class="tag">${this.K('fact.' + k)} ?</span>`).join(' ')}</p>`;
    h += `<p><b>${this.K('ph.brief.targets')}</b> ${this.K('ph.brief.targetsText')}</p>`;
    h += this.det('<ul class="plain">' + [0, 1, 2].map((i) => `<li>${this.K('rule.' + i)}</li>`).join('') + '</ul>', pt('ph.brief.rules'), 'rules');
    h += this.det('<ul class="plain">' + (['tresor', 'vitrinen', 'lager'] as const).map((t) => `<li><b>${this.K('tg.' + t + '.name')}</b> (${eur(VARGA.targets[t].base)}): ${this.K('tg.' + t + '.details')}</li>`).join('') + `<li>${this.K('ph.brief.best')}</li></ul>`, pt('ph.brief.targetsMore'), 'tgts');
    h += this.det('<ul class="plain">' + (['vorder', 'liefer', 'dach'] as const).map((e) => `<li><b>${this.K('en.' + e + '.name')}:</b> ${this.K('en.' + e + '.text')} ${this.K('en.' + e + '.details')}</li>`).join('') + '</ul>', pt('ph.brief.entrances'), 'ents');
    h += this.det('<ul class="plain">' + ROLE_ORDER.map((r) => `<li><b>${this.K('role.' + r + '.name')} (${this.name(p, r)}):</b> ${this.K('role.' + r + '.can')} ${this.K('role.' + r + '.weak')}</li>`).join('') + '</ul>', pt('ph.brief.roles'), 'roles');
    h += this.det(this.K('job.introMore'), pt('ph.brief.house'), 'house');
    h += me === 'brain' ? `<div class="btnrow"><button class="pl-btn pri" data-act="confirm">${this.K('ph.brief.go')}</button></div>` : this.waitBtn(p, 'brain');
    return h;
  }

  private ph_scout(p: any, me: Role | null) {
    const sel: string[] = p.board.scout;
    const idle = `${this.K('ph.hover')} ${this.K('ui.locked')}`;
    let h = `<div class="sct-body"><div class="kicker">${this.K('ph.scout.kicker')}</div><h2>${this.K('ph.scout.title')}</h2><p class="sct-lead">${this.K('ph.scout.lead2')}</p><div class="sct-list">`;
    for (const a of VARGA.scouts) {
      const on = sel.includes(a.id),
        dis = !on && sel.length >= VARGA.scoutCount;
      const chips = [a.money ? `<span class="sct-chip">${eur(a.money)}</span>` : '', a.attention ? `<span class="sct-chip">${this.K('tag.att', { n: a.attention })}</span>` : '', a.rumour ? `<span class="sct-chip acc">${this.K('tag.rumour')}</span>` : ''].join('');
      const clears = this.K('ph.scout.clears', { a: pt('sct.f.' + a.reveals[0], undefined, this.lang()), b: pt('sct.f.' + a.reveals[1], undefined, this.lang()) });
      h += `<button type="button" class="sct-row${on ? ' sel' : ''}${dis ? ' dis' : ''}${me ? '' : ' ro'}" data-scout="${a.id}" data-hl="${a.reveals.join(' ')}" aria-pressed="${on}"${dis || !me ? ' aria-disabled="true"' : ''}><span class="sct-box">${on ? '✓' : ''}</span><span class="sct-nm"><b>${this.K('sc.' + a.id + '.name')}</b><span>${clears}</span></span><span class="sct-chips">${chips}</span></button>`;
    }
    let money = 0,
      attn = 0;
    for (const id of sel) {
      const a = VARGA.scouts.find((x) => x.id === id)!;
      money += a.money;
      attn += a.attention;
    }
    const after = Math.min(5, p.attention + attn);
    h += `</div><p class="sct-legend">${this.K('sct.legend')}</p></div>`;
    h += `<div class="sct-foot"><p class="sct-info" data-default="${idle}">${idle}</p><div class="sct-bar"><span class="sct-count">${this.K('ph.scout.count', { n: sel.length, m: eur(money), a: after })}${after >= 3 ? ` <span class="tag bad">${this.K('ph.scout.moreGuard')}</span>` : ''}</span>`;
    h += me === 'brain' ? `<button class="pl-btn pri" data-act="confirm"${sel.length === 3 ? '' : ' disabled'}>${this.K('ph.scout.go')}</button>` : this.waitBtn(p, 'brain');
    return h + '</div></div>';
  }

  private ph_facts(p: any, me: Role | null) {
    let h = `<div class="kicker">${this.K('ph.scout.kicker')}</div><h2>${this.K('ph.scout.title')}</h2><p class="lead">${this.K('ph.facts.lead')}</p>${this.factList(p)}`;
    h += me === 'brain' ? `<div class="btnrow"><button class="pl-btn pri" data-act="confirm">${this.K('ph.facts.go')}</button></div>` : this.waitBtn(p, 'brain');
    return h;
  }

  /** The private offer, on this player's screen only. */
  private offerPanel(p: any) {
    const o = this.priv?.offer;
    if (!o) return `<p class="lead pl-muted pl-offerwait">${this.K(p.mid ? 'ph.offer.waitMid' : 'ph.offer.wait')}</p>`;
    const me = this.priv.role as Role;
    let h = `<div class="private" data-private="${esc(o.id)}"><div class="privhead">${this.K('pv.head', { who: this.ctx(p).name(me) })}</div>`;
    if (o.answered) return h + `<p class="lead">${this.K('ph.offer.answered')}</p></div>`;
    h += `<div class="kicker">${this.K('pv.kicker')}</div><h2>${this.K('of.' + o.id + '.title')}</h2><p class="lead">${this.K('of.' + o.id + '.text')}</p>`;
    h += `<div class="tags"><span class="tag ok">${this.K('of.' + o.id + '.gain')}</span><span class="tag bad">${this.K('of.' + o.id + '.cost')}</span></div>`;
    h += this.det(this.K('of.' + o.id + '.details'), undefined, 'of' + o.id);
    const d = offerDef(o.id);
    if (d.need) {
      h += `<p class="pick">${this.K(d.need === 'two' ? 'pv.pickSlow' : 'pv.pickOne')}</p><div class="order">${o.targets.map((r: string) => `<button type="button" class="chip${this.offerSel.t === r ? ' on' : ''}" data-ot="${r}">${this.name(p, r)}</button>`).join('')}</div>`;
      if (d.need === 'two') h += `<p class="pick">${this.K('pv.pickPartner')}</p><div class="order">${o.targets.filter((r: string) => r !== this.offerSel.t).map((r: string) => `<button type="button" class="chip${this.offerSel.p === r ? ' on' : ''}" data-op="${r}">${this.name(p, r)}</button>`).join('')}</div>`;
    }
    const ready = !d.need || (this.offerSel.t && (d.need !== 'two' || this.offerSel.p));
    h += `<div class="btnrow"><button class="pl-btn pri" data-offer="accept"${ready ? '' : ' disabled'}>${this.K('pv.accept')}</button><button class="pl-btn" data-offer="decline">${this.K('pv.decline')}</button></div><p class="pl-muted small">${this.K('pv.default')}</p></div>`;
    return h;
  }

  private ph_offer(p: any) {
    if (p.mid) return this.ph_run(p, this.myRole(p), true);
    return `<div class="kicker">${this.K('ph.scout.kicker')}</div>${this.factList(p)}${this.offerPanel(p)}`;
  }

  /** One fact as the crew knows it: value, "(Gerücht)" or "unbekannt". */
  private knownHtml(p: any, k: FactKey) {
    const kn = p.known[k];
    if (!kn) return `<b class="q">${this.K('sh.unknown')}</b>`;
    return `<b class="${kn.rumour ? 'r' : ''}">${this.K('fact.' + k + '.' + kn.v)}${kn.rumour ? ' ' + this.K('fact.rumour') : ''}</b>`;
  }

  /**
   * The "Überblick": always visible while the crew prepares. Four obstacles with what the crew knows
   * and a status, then one time bar. Computed by the host (pub().overview) from what the crew knows.
   */
  private overview(p: any) {
    const o = p.overview;
    if (!o) return '';
    // scouting: a fact one of the picked scouts will reveal is "being cleared", not just unknown
    const soon = new Set<string>();
    if (p.phase === 'scout') for (const id of p.board?.scout ?? []) for (const k of VARGA.scouts.find((x) => x.id === id)?.reveals ?? []) soon.add(k);
    const pill = (id: string, st: string) => {
      const lbl = id === 'police' && st === 'ok' ? 'known' : st === 'unknown' && soon.has(id) ? 'soon' : st;
      return `<span class="ov-pill ov-${lbl}">${this.K('ov.st.' + lbl)}</span>`;
    };
    let h = `<div class="ov-card"><div class="ov-title">${this.K('ov.title')}</div>`;
    for (const r of o.rows) {
      let sub = r.what ? `<span class="ov-v">${this.T(p, r.what)}</span>${r.rumour ? `<span class="ov-r">, ${this.K('ov.rumour')}</span>` : ''}` : r.id === 'police' ? this.K('ov.police.sub') : `<i class="ov-q">${this.K('ov.unknown')}</i>`;
      if (r.by) sub += ` · ${this.T(p, r.by)}`;
      h += `<div class="ov-row" data-fk="${r.id}"><div class="ov-txt"><b>${this.K('ov.row.' + r.id)}</b><span class="ov-sub">${sub}</span></div>${pill(r.id, r.state)}</div>`;
    }
    const t = o.time;
    const span = t.lo === t.hi ? String(t.hi) : `${t.lo}–${t.hi}`;
    // without a known window the bar is drawn against the longest window the job can have
    const scale = t.window ?? Math.max(...Object.values(VARGA.window));
    const pc = (n: number) => Math.max(0, Math.min(100, (n / Math.max(1, scale)) * 100));
    // before the crew knows the guard and the safe there is nothing honest to show: no numbers, an empty bar
    const st = (id: string) => o.rows.find((r: any) => r.id === id)?.state;
    const early = st('guard') === 'unknown' && st('safe') === 'unknown';
    const lo = early ? 0 : pc(t.lo),
      hi = early ? 0 : pc(t.hi);
    const right = early ? this.K('ov.unknown') : t.partial ? this.K('ov.time.partialT', { t: span }) : t.window !== null ? this.K('ov.time.of', { t: span, w: t.window }) : this.K('ov.time.noWin', { t: span });
    h += `<div class="ov-row ov-time ov-t-${early ? 'unknown' : t.state}"><div class="ov-th"><b>${this.K('ov.row.time')}</b><span>${right}</span></div>`;
    h += `<div class="ov-bar"><i class="ov-fill" style="width:${lo.toFixed(1)}%"></i>${hi > lo ? `<i class="ov-span" style="left:${lo.toFixed(1)}%;width:${(hi - lo).toFixed(1)}%"></i>` : ''}</div>`;
    h += `<div class="ov-cap">${this.K(early ? 'ov.time.early' : t.partial ? 'ov.time.partial' : 'ov.time.' + t.state)}</div></div>`;
    return h + '</div>';
  }

  /** What a shop element is about, for the hover highlight (floor plan badges and Überblick rows). */
  private toolHl(p: any, id: string) {
    const adv = toolAdvice(p.known, id);
    return [...(adv.fact ? [adv.fact] : []), ...(id === 'seil' ? ['dach'] : []), ...(id === 'schleife' ? ['blind'] : []), ...(id === 'scanner' ? ['police'] : [])].join(' ');
  }

  /**
   * Shopping, reduced: what is still missing against what the crew knows, the basket, and the
   * full list behind one button. The Überblick on the left carries the state of every obstacle.
   */
  private ph_shop(p: any, me: Role | null) {
    const sel: string[] = p.board.tools;
    const tool = (id: string) => VARGA.tools.find((t) => t.id === id)!;
    const cost = sel.reduce((s, id) => s + tool(id).price, 0),
      left = p.budget - cost;
    const tname = (id: string) => this.K('tool.' + id + '.name');
    let h = `<div class="shp-body"><div class="shp-head"><h2>${this.K('ph.shop.title')}</h2><p class="shp-lead">${this.K('sh.lead')}</p><div class="shp-left"><span>${this.K('sh.left')}</span><b>${eur(left)}</b></div></div>`;
    if (p.preTraces?.length) h += p.preTraces.map((t: Txt) => `<div class="ln trace">${this.T(p, t)}</div>`).join('');
    const tip = this.priv?.tip;
    if (tip) h += `<div class="private tip"><div class="privhead">${this.K('pv.head', { who: this.ctx(p).name(this.priv.role) })}</div><div class="kicker">${this.K('pv.tipKicker')}</div><h3>${this.K('fact.' + tip.k)}</h3><p class="lead">${this.K('pv.tipText', { v: pt('fact.' + tip.k + '.' + tip.v) })}</p></div>`;

    // 1. what is still missing: per open obstacle the tools that answer it
    const rows: any[] = p.overview?.rows ?? [];
    const st = (id: string) => rows.find((r) => r.id === id)?.state ?? 'unknown';
    const want: string[] = [];
    const guesses: string[] = [];
    const add = (id: string) => {
      if (!sel.includes(id) && !want.includes(id)) want.push(id);
    };
    for (const g of SHOP_GROUPS) {
      if (g.id === 'way') continue;
      const s = st(g.id);
      if (s === 'open') {
        for (const id of g.tools) if (toolAdvice(p.known, id).state === 'fit' && toolAdvice(p.known, id).fact === g.id) add(id);
        // a camera blind spot at the roof: the rope makes that way possible
        if (g.id === 'guard' && toolAdvice(p.known, 'seil').state === 'fit') add('seil');
      } else if (s === 'unknown') {
        if (g.id === 'safe') add('bohrer');
        else guesses.push(this.K('sh.guess', { k: pt('ov.row.' + g.id, undefined, this.lang()) }));
      }
    }
    const buyLine = (id: string) => {
      const t = tool(id),
        dis = t.price > left;
      return `<div class="shp-nl" data-hl="${this.toolHl(p, id)}"><div class="shp-nt"><b>${tname(id)}</b><span>${this.K('tool.' + id + '.text')}</span></div><span class="px">${dis ? `<small>${this.K('sh.tooDear')}</small> ` : ''}${eur(t.price)}</span><button type="button" class="shp-buy${dis ? ' dis' : ''}" data-tool="${id}" aria-pressed="false"${dis || !me ? ' aria-disabled="true"' : ''}>${this.K('sh.buy')}</button></div>`;
    };
    h += `<section class="shp-sec"><h3>${this.K('sh.need')}</h3>`;
    if (!want.length) h += `<p class="shp-none">${this.K('sh.needNone')}</p>`;
    h += want.map(buyLine).join('');
    h += guesses.map((g) => `<p class="shp-guess">${g}</p>`).join('');
    h += '</section>';

    // 2. the basket
    h += `<section class="shp-sec"><h3>${this.K('sh.inBasket')}</h3><div class="shp-chips">`;
    h += sel.length
      ? sel.map((id) => `<button type="button" class="chip shp-chip" data-tool="${id}" data-hl="${this.toolHl(p, id)}" aria-pressed="true" aria-label="${this.K('sh.remove')}: ${tname(id)}"${me ? '' : ' aria-disabled="true"'}>✓ ${tname(id)} · ${eur(tool(id).price)}</button>`).join('')
      : `<span class="pl-muted">${this.K('sh.basketEmpty')}</span>`;
    h += '</div></section>';

    // 3. everything, on request
    h += `<button type="button" class="shp-more" data-local="shop-all" aria-expanded="${this.shopAll}">${this.shopAll ? this.K('sh.showLess') : this.K('sh.showAll', { n: VARGA.tools.length })}</button>`;
    if (this.shopAll) {
      const cols = ['', ''];
      SHOP_GROUPS.forEach((g, gi) => {
        const know = g.facts.map((k) => (g.facts.length === 1 && g.id !== 'way' ? `${this.K('sh.know')} ` : `${this.K('fact.' + k)}: `) + this.knownHtml(p, k)).join(' · ');
        let c = `<section class="shp-group" data-hl="${g.facts.join(' ')}"><div class="shp-gh${g.facts.length > 1 ? ' multi' : ''}"><h3>${this.K('sh.g.' + g.id)}</h3><span class="shp-know">${know}</span></div><div class="shp-tiles">`;
        for (const id of g.tools) {
          const t = tool(id),
            on = sel.includes(id),
            dis = !on && t.price > left,
            adv = toolAdvice(p.known, id);
          const mark = adv.state === 'fit' ? '✓' : adv.state === 'miss' ? '✕' : adv.state === 'open' ? '?' : '•';
          c += `<button type="button" class="shp-tile ${adv.state}${adv.rumour ? ' rum' : ''}${on ? ' sel' : ''}${dis ? ' dis' : ''}${me ? '' : ' ro'}" data-tool="${id}" data-hl="${this.toolHl(p, id)}" aria-pressed="${on}"${dis || !me ? ' aria-disabled="true"' : ''}>`;
          c += `<span class="shp-th"><b>${tname(id)}</b><span class="px">${dis ? `<small>${this.K('sh.tooDear')}</small> ` : ''}${eur(t.price)}</span></span>`;
          c += `<span class="shp-tx">${this.K('tool.' + id + '.text')}</span><span class="shp-fit"><i>${mark}</i>${this.T(p, adv.text)}</span></button>`;
        }
        cols[gi % 2] += c + '</div></section>';
      });
      h += `<div class="shp-cols"><div class="shp-col">${cols[0]}</div><div class="shp-col">${cols[1]}</div></div>`;
    }

    // footer: the button (and, with the full list open, the exact numbers of the tool under the mouse)
    const idle = `${this.K('sh.hover')} ${this.K('ui.locked')}`;
    h += `</div><div class="shp-foot">${this.shopAll ? `<p class="shp-info" data-default="${idle}">${idle}</p>` : '<span></span>'}`;
    h += me === 'brain' ? `<button class="pl-btn pri" data-act="confirm">${this.K('ph.shop.go')}</button>` : this.waitBtn(p, 'brain');
    return h + '</div>';
  }
  /** Light up on the floor plan and in the Überblick what the element under the mouse is about; in the full shop list also show the tool's exact numbers. */
  private onHover(target: HTMLElement | null) {
    const hlEl = target?.closest?.('[data-hl]') as HTMLElement | null;
    const toolEl = target?.closest?.('[data-tool]') as HTMLElement | null;
    const hl = hlEl?.dataset.hl ?? '',
      tool = toolEl?.dataset.tool ?? '';
    const infoEl = target?.closest?.('[data-scout], [data-ent]') as HTMLElement | null;
    const info = infoEl ? (infoEl.dataset.scout ? 'sc.' + infoEl.dataset.scout : 'en.' + infoEl.dataset.ent) : '';
    if (hl === this.hoverHl && tool === this.hoverTool && info === this.hoverInfo) return;
    this.hoverHl = hl;
    this.hoverTool = tool;
    this.hoverInfo = info;
    this.applyHover();
  }
  private applyHover() {
    const keys = this.hoverHl ? this.hoverHl.split(' ') : [];
    this.el.querySelectorAll('.bp-badge[data-fk], .bp-ent[data-fk], .ov-row[data-fk]').forEach((b) => b.classList.toggle('hl', keys.includes(b.getAttribute('data-fk')!)));
    const line = this.el.querySelector('.sct-info, .pln-info') as HTMLElement | null;
    if (line) {
      const d = this.hoverInfo ? pt(this.hoverInfo + '.details', undefined, this.lang()) : '';
      line.textContent = d || (line.dataset.default ?? '');
      line.classList.toggle('on', !!d);
    }
    const info = this.el.querySelector('.shp-info') as HTMLElement | null;
    if (!info) return;
    const d = this.hoverTool ? pt('tool.' + this.hoverTool + '.details', undefined, this.lang()) : '';
    info.textContent = this.hoverTool && d ? `${pt('tool.' + this.hoverTool + '.name', undefined, this.lang())}: ${d}` : (info.dataset.default ?? '');
    info.classList.toggle('on', !!(this.hoverTool && d));
  }

  private ph_plan(p: any, me: Role | null) {
    const Pl = p.plan;
    const idle = `${this.K('ph.hover')} ${this.K('ui.locked')}`;
    let h = `<div class="pln-body"><h2>${this.K('ph.plan.title')}</h2>`;
    h += `<h3 class="pln-h">${this.K('ph.plan.entrance')}</h3><div class="pln-ents">` + (['vorder', 'liefer', 'dach'] as const).map((id) => {
      const e = VARGA.entrances[id];
      const dis = !!e.needs && !p.tools.includes(e.needs);
      return `<button type="button" class="pln-ent${Pl.entrance === id ? ' sel' : ''}${dis ? ' dis' : ''}${me ? '' : ' ro'}" data-ent="${id}" aria-pressed="${Pl.entrance === id}"${dis || !me ? ' aria-disabled="true"' : ''}><b>${this.K('en.' + id + '.name')}</b><span>${dis ? this.K('ph.plan.needsRope') : this.K('en.' + id + '.text')}</span></button>`;
    }).join('') + '</div>';
    h += `<h3 class="pln-h">${this.K('ph.plan.posts')}</h3><p class="pln-hint">${this.K('ph.plan.postsHint')}</p>`;
    for (const r of ROLE_ORDER) {
      const seat = p.seats.find((x: any) => x.role === r);
      const mayEdit = !!me && (r === me || (me === 'brain' && seat.bot));
      h += `<div class="postrow${r === me ? ' me' : ''}"><div class="who"><b>${esc(seat.name)}${r === me ? ` <small>(${this.K('ui.you')})</small>` : ''}</b><span>${this.K('role.' + r + '.name')}</span></div><div class="pl-seg${mayEdit ? '' : ' ro'}" role="group">${POSTS.map((x) => `<button type="button" data-post="${r}:${x}" class="${Pl.posts[r] === x ? 'on' : ''}"${mayEdit ? '' : ' aria-disabled="true"'} aria-pressed="${Pl.posts[r] === x}">${this.K('post.' + x)}</button>`).join('')}</div></div>`;
    }
    const panelOk = Pl.entrance === 'liefer' && Pl.posts.brain === 'inside';
    h += `<label class="toggle${panelOk ? '' : ' off'}"><input type="checkbox" data-panel="1"${Pl.panel ? ' checked' : ''}${panelOk && me ? '' : ' disabled'}> ${this.K('ph.plan.panel')} <span class="tag">80 %</span></label>`;
    h += `<h3 class="pln-h">${this.K('ph.plan.targets')}</h3><div class="order">` + (['tresor', 'vitrinen', 'lager'] as const).map((t) => {
      const i = Pl.targets.indexOf(t);
      return `<button type="button" class="chip${i >= 0 ? ' on' : ''}" data-tgt="${t}" aria-pressed="${i >= 0}"${me ? '' : ' aria-disabled="true"'}>${i >= 0 ? i + 1 + '. ' : '+ '}${this.K('tg.' + t + '.name')}</button>`;
    }).join('') + '</div>';
    if (Pl.targets.length > 1 && me) h += '<div class="order">' + Pl.targets.map((t: string, i: number) => (i > 0 ? `<button type="button" class="chip" data-up="${i}">${this.K('tg.' + t + '.name')} ↑</button>` : '')).join('') + '</div>';
    // notes: what blocks the plan, and what neither the Überblick rows nor the time bar show
    const sm = p.summary;
    const notes: string[] = [];
    if (sm) {
      const rows: any[] = p.overview?.rows ?? [];
      const by = (id: string) => rows.find((r) => r.id === id)?.by?.k;
      for (const l of sm.errors as Txt[]) notes.push(`<li class="err">${this.T(p, l)}</li>`);
      for (const l of sm.lines as Txt[]) if (l.k === 'sm.noDriver' || l.k === 'sm.noLookout') notes.push(`<li>${this.T(p, l)}</li>`);
      for (const l of sm.risks as Txt[]) {
        const k = l.k;
        // the Überblick shows a tool without the Hände inside and a loop without a post only for the obstacle at hand
        const shown = (k === 'rk.noHands' && (by('alarm') === 'ov.by.noHands' || by('safe') === 'ov.by.noHands')) || (k === 'rk.loopNoPost' && by('guard') === 'ov.by.noPost');
        if (k === 'rk.lager' || ((k === 'rk.noHands' || k === 'rk.loopNoPost') && !shown) || (k === 'rk.window' && p.overview?.time?.partial)) notes.push(`<li class="risk">${this.T(p, l)}</li>`);
      }
    }
    if (notes.length) h += `<h3 class="pln-h">${this.K('ph.plan.notes')}</h3><ul class="pln-notes">${notes.join('')}</ul>`;
    h += `</div><div class="pln-foot"><p class="pln-info" data-default="${idle}">${idle}</p><div class="pln-bar">`;
    h += me === 'brain' ? `<button class="pl-btn pri" data-act="confirm"${sm && sm.errors.length ? ' disabled' : ''}>${this.K('ph.plan.go')}</button>` : this.waitBtn(p, 'brain');
    return h + '</div></div>';
  }

  private dice(p: any, d: any) {
    return `<div class="dice ${d.ok ? 'ok' : 'no'}"><span>${this.T(p, d.label)}</span><span class="res">${this.K(d.ok ? 'rl.yes' : 'rl.no')}</span><span class="num">${this.K('rl.num', { r: d.r, p: d.p })}</span></div>`;
  }

  private ph_run(p: any, me: Role | null, offerMid = false) {
    const R = p.run;
    let h = `<div class="kicker">${this.K('ph.run.kicker')}</div><h2>${this.K('ph.run.title')}</h2><div class="feed">`;
    const n = R.beats.length;
    R.beats.forEach((b: any, i: number) => {
      h += `<div class="beat${i === n - 1 ? ' cur' : ''}"><h3>${this.T(p, b.title)}<small>${this.K('ui.minute')} ${b.t0}</small></h3>${b.lines.map((l: any) => (l.kind === 'roll' ? this.dice(p, l.roll) : `<div class="ln ${l.kind}">${this.T(p, l.x)}</div>`)).join('')}</div>`;
    });
    h += '</div>';
    if (offerMid) return h + this.offerPanel(p);
    const d = R.decision;
    if (d) {
      const mine = me === d.who && !d.bot;
      h += `<div class="decision${mine ? ' mine' : ' watch'}"><div class="who">${this.K('ph.run.decision', { gen: pt('role.' + d.who + '.gen'), who: this.ctx(p).name(d.who) })}</div><h3 class="dtitle">${this.T(p, d.title)}</h3><p class="pl-muted">${this.T(p, d.text)}</p>${d.details ? this.det(this.T(p, d.details), undefined, 'dd' + R.shown) : ''}<div class="cards">`;
      h += d.options.map((o: any) => this.card({ ro: !mine, data: `data-opt="${esc(o.id)}"`, title: this.T(p, o.label), text: this.T(p, o.text), tags: o.tags.map((t: Txt) => this.T(p, t)), pct: o.pct, pctLabel: this.T(p, o.pctLabel), details: o.details ? this.T(p, o.details) : '', dk: 'op' + o.id })).join('');
      h += '</div>';
      if (!mine) h += `<p class="pl-muted pl-waitfor">${d.bot ? this.K('ui.decidesBot', { who: this.ctx(p).name(d.who) }) : this.K('ui.waitFor', { who: this.ctx(p).name(d.who) })}</p>`;
      h += '</div>';
    } else h += `<p class="pl-muted pl-next">${this.K('ph.run.waitBeat')}</p>`;
    return h;
  }

  private ph_accuse(p: any, me: Role | null) {
    let h = `<div class="kicker">${this.K('ph.accuse.kicker')}</div><h2>${this.K('ph.accuse.title')}</h2><p class="lead">${this.K('ph.accuse.lead')}</p>`;
    h += `<div class="tags"><span class="tag ok">${this.K('ph.accuse.hit', { m: eur(ACCUSE_BONUS) })}</span><span class="tag bad">${this.K('ph.accuse.miss', { m: eur(ACCUSE_FINE) })}</span></div>`;
    h += this.det(this.K('ph.accuse.details'), undefined, 'accd');
    const tr: Txt[] = p.traces || [];
    h += this.det(tr.length ? '<ul class="plain">' + tr.map((t) => `<li>${this.T(p, t)}</li>`).join('') + '</ul>' : this.K('ph.accuse.noTraces'), pt('ph.accuse.traces', { n: tr.length }), 'traces');
    const acc = this.priv?.accuse;
    if (!me || !acc) return h + `<p class="pl-muted">${this.K('ph.accuse.done')}</p>`;
    if (acc.choice) {
      const c = acc.choice === 'pass' ? this.K('ph.accuse.nobody') : this.name(p, acc.choice);
      return h + `<div class="private"><div class="privhead">${this.K('pv.head', { who: this.ctx(p).name(me) })}</div><p class="lead"><b>${c}</b></p><p class="pl-muted">${this.K('ph.accuse.done')}</p></div>`;
    }
    h += `<div class="private"><div class="privhead">${this.K('pv.head', { who: this.ctx(p).name(me) })}</div><div class="order">` + ROLE_ORDER.filter((x) => x !== me).map((x) => `<button type="button" class="chip${this.accSel === x ? ' on' : ''}" data-acc="${x}">${this.name(p, x)}</button>`).join('') + `<button type="button" class="chip${this.accSel === 'pass' ? ' on' : ''}" data-acc="pass">${this.K('ph.accuse.nobody')}</button></div>`;
    h += `<div class="btnrow"><button class="pl-btn pri" data-act="accuse"${this.accSel ? '' : ' disabled'}>${this.K('ph.accuse.go')}</button></div><p class="pl-muted small">${this.K('ph.accuse.private')}</p></div>`;
    return h;
  }

  private ph_debrief(p: any, me: Role | null) {
    const r = p.result;
    if (!r) return '';
    const nm = (x: string | null) => (x ? this.name(p, x) : '');
    let h = `<div class="kicker">${this.K('ph.debrief.kicker')}</div><div class="grade"><div class="g ${r.grade[0]}">${r.grade[0]}</div><div><h2>${this.K(r.grade[1])}</h2><div class="pl-muted">${this.K('ph.debrief.net')} <b class="num">${eur(r.net)}</b></div></div></div>`;
    const money = `<table class="money"><tr><td>${this.K('ph.debrief.loot', { m: r.mult.toFixed(1).replace('.', ','), s: pt('stake.' + r.stake + '.name') })}</td><td>${eur(r.loot)}</td></tr>${r.lostShare ? `<tr><td>${this.K('ph.debrief.lost')}</td><td>−${eur(r.lostShare)}</td></tr>` : ''}${r.cut ? `<tr><td>${this.K('ph.debrief.cut')}</td><td>−${eur(r.cut)}</td></tr>` : ''}${r.bail ? `<tr><td>${this.K('ph.debrief.bail')}</td><td>−${eur(r.bail)}</td></tr>` : ''}<tr><td>${this.K('ph.debrief.spent')}</td><td>−${eur(r.spent)}</td></tr><tr class="sum"><td>${this.K('ph.debrief.net').replace(/:$/, '')}</td><td>${eur(r.net)}</td></tr></table><p>${this.K('ph.debrief.att', { a: r.attention })} ${this.K(r.attention >= 3 ? 'ph.debrief.carryHot' : 'ph.debrief.carry', { m: eur(r.nextBudget), a: r.attention })}</p>`;
    h += this.det(money, pt('ph.debrief.numbers'), 'money');
    // 1. accusations
    h += `<h3 class="sub">${this.K('ph.debrief.accusations')}</h3>`;
    const al = r.accusations.filter((a: any) => a.to);
    if (!al.length) h += `<p class="pl-muted">${this.K('ph.debrief.noAccusations')}</p>`;
    h += al.map((a: any) => `<div class="accl"><b>${nm(a.from)}</b> → <b>${nm(a.to)}</b> <span class="tag ${a.correct ? 'ok' : 'bad'}">${this.K(a.correct ? 'ph.debrief.hit' : 'ph.debrief.wrong')}</span></div>`).join('');
    // 2. secret offers
    const acc = r.offers.filter((o: any) => o.state === 'accepted'),
      dec = r.offers.filter((o: any) => o.state !== 'accepted');
    h += `<h3 class="sub">${this.K('ph.debrief.offers')}</h3><p class="pl-muted">${this.K(r.active === 1 ? 'ph.debrief.active1' : 'ph.debrief.activeN', { n: r.active })}${r.incidents ? ' ' + this.K(r.incidents === 1 ? 'ph.debrief.incident1' : 'ph.debrief.incidentN', { n: r.incidents }) : ''}</p>`;
    if (!acc.length) h += `<p class="pl-muted">${this.K('ph.debrief.noneAccepted')}</p>`;
    for (const o of acc) {
      const hit = o.target ? (o.partner ? this.K('ph.debrief.slower', { who: this.ctx(p).name(o.target) }) : nm(o.target)) : this.K('ph.debrief.crew');
      const badge = o.bonus ? ` <span class="tag ${o.reclaimed ? 'bad' : 'ok'}">${o.reclaimed ? this.K('ph.debrief.reclaimed') : '+' + eur(o.bonus)}</span>` : o.reclaimed ? ` <span class="tag bad">${this.K('ph.debrief.caught')}</span>` : '';
      const eff = o.effects.length ? this.K('ph.debrief.effect', { e: o.effects.map((e: Txt) => tx(e, this.ctx(p))).join(', ') }) : this.K('ph.debrief.noEffect');
      h += `<div class="reveal${o.reclaimed ? ' caught' : ''}"><div class="rh">${this.K('ph.debrief.took', { who: this.ctx(p).name(o.role), o: pt('of.' + o.id + '.title') })}${badge}</div><div class="rl">${this.K('ph.debrief.hitWho')} <b>${hit}</b></div><div class="rl pl-muted">${eff}</div></div>`;
    }
    if (dec.length) h += this.det(dec.map((o: any) => `${nm(o.role)} – „${this.K('of.' + o.id + '.title')}“`).join(' · '), pt('ph.debrief.declined', { n: dec.length }), 'declined');
    // 3. ranking after the accusations
    h += `<h3 class="sub">${this.K('ph.debrief.ranking')}</h3><table class="rank">` + r.final.map((x: any) => {
      const mv = x.before - x.rank;
      return `<tr class="${x.status === 'caught' ? 'caught' : ''}${x.role === me ? ' me' : ''}"><td class="rk">${x.rank}.</td><td><b>${nm(x.role)}</b>${x.status !== 'ok' ? ` <span class="tag ${x.status === 'hurt' ? 'acc' : 'bad'}">${this.K('status.' + x.status)}</span>` : ''}</td><td class="bon">${mv > 0 ? '▲ ' + mv : mv < 0 ? '▼ ' + -mv : ''}</td><td class="num">${eur(x.total)}</td></tr>`;
    }).join('') + '</table>';
    const mine = me ? r.final.find((x: any) => x.role === me) : null;
    h += `<p class="pl-muted">${this.K('ph.debrief.fair', { m: eur(r.fair) })}${mine ? ' ' + this.K('ph.debrief.yourRank', { n: mine.rank }) : ''}</p>`;
    // 4. what you did not know
    h += `<h3 class="sub">${this.K('ph.debrief.unknown')}</h3>`;
    if (!r.unknown.length) h += `<p class="pl-muted">${this.K('ph.debrief.knewAll')}</p>`;
    for (const u of r.unknown) {
      const said = u.wrong ? this.K('ph.debrief.said', { src: pt('sc.' + u.src + '.name'), v: pt('fact.' + u.k + '.' + u.wrong) }) + ' ' : '';
      h += `<div class="unk"><div class="h"><b>${this.K('fact.' + u.k)}: ${this.K('fact.' + u.k + '.' + u.value)}</b>${u.wrong ? `<span class="tag bad">${this.K('ph.debrief.rumourWrong')}</span>` : ''}</div><div class="c">${u.impact.map((x: Txt) => this.T(p, x)).join(' ')}</div>${this.det(said + (u.hint ? this.T(p, u.hint) : this.K('ph.debrief.noHint')), pt('ph.debrief.helped'), 'hint' + u.k)}</div>`;
    }
    h += `<div class="btnrow"><button class="pl-btn pri" data-act="close">${this.K('ui.close')}</button></div><p class="pl-muted small">${this.K('ui.closeHint')}</p>`;
    return h;
  }

  // ------------------------------------------------------------------ floor plan (prototype's blueprint, desktop layout)

  private floor(p: any) {
    const R = p.run && ['run', 'accuse', 'debrief'].includes(p.phase) || (p.phase === 'offer' && p.mid) ? p.run : null;
    const end = p.phase === 'debrief' && p.result;
    const facts = end ? p.result.facts : null;
    const fs = 13;
    // shop: a tick on every obstacle the basket has an answer for
    const basket: string[] | null = p.phase === 'shop' ? p.board.tools : null;
    const covered = (g: ShopGroupId) => !!basket && shopCover(p.known, basket, g) === 'yes';
    const badge = (x: number, y: number, text: string, cls: string, anchor?: string, fk?: string, cov?: boolean) => {
      if (cov) text = '✓ ' + text;
      const w = Math.max(fs * 2, text.length * fs * 0.58 + 12),
        hh = fs + 9;
      let x0 = anchor === 'end' ? x - w : anchor === 'mid' ? x - w / 2 : x;
      x0 = Math.max(2, Math.min(638 - w, x0));
      return `<g class="bp-badge ${cls}${cov ? ' cov' : ''}"${fk ? ` data-fk="${fk}"` : ''}><rect x="${x0}" y="${y - hh / 2 - 2}" width="${w}" height="${hh}" rx="2"/><text x="${x0 + w / 2}" y="${y + fs * 0.35 - 2}" text-anchor="middle">${esc(text)}</text></g>`;
    };
    const factBadge = (k: string, short: (v: string) => string, ql: string) => {
      const kn = p.known[k];
      if (end && (!kn || (kn && kn.v !== facts[k]))) return { text: short(facts[k]), cls: 'x', v: facts[k] };
      if (!kn) return { text: (ql ? ql + ' ' : '') + '?', cls: 'q', v: null };
      return { text: short(kn.v) + (kn.rumour ? ' ?' : ''), cls: kn.rumour ? 'r' : '', v: kn.v };
    };
    const P = p.plan;
    const planShown = ['plan', 'run', 'accuse', 'debrief'].includes(p.phase) || (p.phase === 'offer' && p.mid);
    const roomCls = (t: string) => {
      if (!R) return P && p.phase === 'plan' && P.targets.includes(t) ? 'bp-room hl' : 'bp-room';
      const b = R.beats[R.beats.length - 1];
      if (b && b.target === t && p.phase === 'run') return 'bp-room hl';
      return R.doneTargets.includes(t) ? 'bp-room done' : 'bp-room';
    };
    const L = (x: number, y: number, t: string, cls?: string) => `<text class="${cls || 'bp-lbl'}" x="${x}" y="${y}">${esc(t)}</text>`;
    const lab = (k: string) => pt('fp.' + k, undefined, this.lang());
    let s = '<svg viewBox="0 0 640 470" role="img" xmlns="http://www.w3.org/2000/svg">';
    for (let x = 0; x <= 640; x += 20) s += `<line class="bp-grid" x1="${x}" y1="0" x2="${x}" y2="470"/>`;
    for (let y = 0; y <= 470; y += 20) s += `<line class="bp-grid" x1="0" y1="${y}" x2="640" y2="${y}"/>`;
    s += `<rect class="bp-room" x="40" y="40" width="140" height="130"/>` + L(52, 62, lab('guardroom'));
    s += `<rect class="bp-room" x="180" y="40" width="150" height="130"/>` + L(192, 62, lab('hall'));
    s += `<rect class="${roomCls('tresor')}" x="330" y="40" width="150" height="130"/>` + L(342, 62, lab('vault'));
    s += `<rect class="bp-room" x="372" y="90" width="66" height="54" style="fill:#0d0c0b"/>`;
    s += `<rect class="${roomCls('vitrinen')}" x="40" y="170" width="290" height="150"/>` + L(52, 192, lab('gallery'));
    for (let i = 0; i < 4; i++) s += `<rect x="${62 + i * 48}" y="250" width="32" height="18" fill="none" stroke="#5d574f"/>`;
    s += L(62, 290, lab('cases'), 'bp-sm');
    s += `<rect class="${roomCls('lager')}" x="330" y="170" width="150" height="230"/>` + L(342, 192, lab('store'));
    for (let i = 0; i < 3; i++) s += `<rect x="${346 + i * 30}" y="236" width="22" height="22" fill="none" stroke="#5d574f"/>`;
    s += `<rect class="bp-room" x="40" y="320" width="290" height="80"/>` + L(52, 342, lab('foyer'));
    s += `<rect x="420" y="338" width="48" height="30" fill="#0d0c0b" stroke="#6a645a"/>` + L(420, 332, lab('panel'), 'bp-sm');
    s += `<rect class="bp-wall" x="40" y="40" width="440" height="360"/>`;
    s += `<rect x="480" y="170" width="130" height="230" fill="none" stroke="#3a3732" stroke-dasharray="4 4"/>` + L(494, 192, lab('yard'));
    s += `<line x1="20" y1="425" x2="620" y2="425" stroke="#3a3732"/>` + L(200, 452, lab('street'));
    const ent = (id: string) => 'bp-ent' + (P && planShown && P.entrance === id ? ' sel' : '');
    s += `<rect class="${ent('vorder')}" x="165" y="394" width="44" height="12"/>` + L(216, 418, pt('en.vorder.name', undefined, this.lang()), 'bp-sm');
    s += `<rect class="${ent('liefer')}" x="474" y="280" width="12" height="44"/>` + L(492, 300, pt('en.liefer.name', undefined, this.lang()), 'bp-sm');
    s += `<rect class="${ent('dach')}" data-fk="dach" x="270" y="262" width="34" height="34" stroke-dasharray="4 3"/>` + L(262, 312, pt('en.dach.name', undefined, this.lang()), 'bp-sm');
    const short = (k: string) => (v: string) => lab(k + '.' + v);
    let b = factBadge('alarm', short('alarm'), '');
    s += badge(474, 388, b.cls === 'q' ? lab('alarmQ') : b.text, b.cls, 'end', 'alarm', covered('alarm'));
    b = factBadge('guard', short('guard'), '');
    s += badge(52, 92, b.cls === 'q' ? lab('guardQ') : b.text, b.cls, undefined, 'guard', covered('guard'));
    b = factBadge('safe', short('safe'), '');
    s += badge(405, 160, b.cls === 'q' ? lab('safeQ') : b.text, b.cls, 'mid', 'safe', covered('safe'));
    b = factBadge('police', short('police'), '');
    s += badge(24, 448, pt('fp.police', { v: b.text }, this.lang()), b.cls, undefined, 'police');
    const lb = factBadge('loot', (v) => v, '');
    const pos: Record<string, [number, number]> = { tresor: [476, 80], vitrinen: [320, 214], lager: [476, 214] };
    for (const t of ['tresor', 'vitrinen', 'lager']) {
      if (lb.cls === 'q') s += badge(pos[t][0], pos[t][1], lab('bestQ'), 'q', 'end');
      else if (lb.v === t) s += badge(pos[t][0], pos[t][1], lab('best') + (lb.cls === 'r' ? ' ?' : ''), lb.cls, 'end');
    }
    const bb = factBadge('blind', (v) => v, '');
    const cams: Record<string, [number, number]> = { vorder: [187, 382], liefer: [450, 272], dach: [287, 252] };
    for (const e of ['vorder', 'liefer', 'dach']) {
      const [x, y] = cams[e];
      let labx: string, cls: string;
      if (bb.cls === 'q') {
        labx = lab('camQ');
        cls = 'q';
      } else {
        labx = bb.v === e ? lab('blindspot') : lab('cam');
        cls = bb.cls;
      }
      if (e === 'vorder' && bb.cls !== 'q') {
        labx = lab('cam');
        cls = bb.cls === 'x' ? '' : bb.cls;
      }
      s += badge(x, y - 6, labx, cls, 'mid', 'blind');
    }
    if (P && planShown) {
      const ep: Record<string, number[]> = { vorder: [187, 394], liefer: [474, 302], dach: [287, 279] },
        tp: Record<string, number[]> = { tresor: [405, 118], vitrinen: [150, 240], lager: [400, 300] };
      const entr = R?.entrance ?? P.entrance;
      const pts = [ep[entr]].concat(P.targets.map((t: string) => tp[t]));
      if (pts.length > 1) s += `<polyline class="bp-path" points="${pts.map((q) => q.join(',')).join(' ')}"/>`;
    }
    return s + '</svg>';
  }

  // ------------------------------------------------------------------ input

  private act(a: any) {
    this.s?.intent('plan.act', a);
    this.audio.play('ui');
  }

  private onClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const cb = target.closest('input[data-panel]') as HTMLInputElement | null;
    if (cb) {
      this.act({ t: 'panel', on: cb.checked });
      return;
    }
    const t = target.closest('button') as HTMLButtonElement | null;
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    const d = t.dataset;
    // view-local toggles: nothing is sent
    if (d.local === 'shop-all') {
      this.shopAll = !this.shopAll;
      this.key = '';
      return;
    }
    if (d.act === 'close') {
      const p = this.pub();
      this.dismissed = p?.job ?? -1;
      this.setOpen(false);
      return;
    }
    if (d.act === 'accuse') {
      if (this.accSel) this.act({ t: 'accuse', target: this.accSel });
      return;
    }
    if (d.act === 'confirm') return this.act({ t: 'confirm' });
    if (d.stake) return this.act({ t: 'stake', id: d.stake });
    if (d.scout) return this.act({ t: 'scout', id: d.scout });
    if (d.tool) return this.act({ t: 'tool', id: d.tool });
    if (d.ent) return this.act({ t: 'ent', id: d.ent });
    if (d.tgt) return this.act({ t: 'tgt', id: d.tgt });
    if (d.up) return this.act({ t: 'up', i: Number(d.up) });
    if (d.post) {
      const [role, post] = d.post.split(':');
      return this.act({ t: 'post', role, post });
    }
    if (d.opt) return this.act({ t: 'choose', id: d.opt });
    if (d.ot) {
      this.offerSel.t = d.ot;
      if (this.offerSel.p === d.ot) this.offerSel.p = null;
      this.key = '';
      return;
    }
    if (d.op) {
      this.offerSel.p = d.op;
      this.key = '';
      return;
    }
    if (d.offer) {
      const ans = d.offer === 'accept' ? 'accept' + (this.offerSel.t ? ':' + this.offerSel.t : '') + (this.offerSel.p ? ':' + this.offerSel.p : '') : 'decline';
      return this.act({ t: 'offer', answer: ans });
    }
    if (d.acc) {
      this.accSel = d.acc;
      this.key = '';
      return;
    }
  }
}
