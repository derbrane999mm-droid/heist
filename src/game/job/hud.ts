// What a player sees during the first-person job (src/game/job/director.ts decides what happens, this file
// only draws it). Kept deliberately small, for someone who has never seen the game:
//  - one objective, top centre: where to go (arrow + distance) and one line on what happens there;
//  - a world marker at the objective (light column + diamond, seen through walls) and an edge arrow;
//  - the job's events one at a time under the objective (Tab holds the full log);
//  - two meters top left (time against the guard round, noise) and an alarm tag;
//  - decisions and secret offers as a glass pop-up at the bottom, answered with the number keys;
//  - the player's own skill task as a prompt "E  Schloss knacken";
//  - a short intro card once per session.
import * as THREE from 'three';
import './job.css';
import type { Anchor } from '../mech/skill';
import type { Player } from '../player';
import { tx, pt, type Lang } from '../plan/texts';
import { settings } from '../../core/settings';
import { registerStrings, t } from '../../core/i18n';
import type { OpenTask } from './director';

registerStrings(
  {
    'jb.to.van': 'To the van',
    'jb.to.gate': 'To the yard gate',
    'jb.to.door.liefer': 'To the delivery door',
    'jb.to.door.vorder': 'To the front door',
    'jb.to.in.dach': 'To the roof hatch',
    'jb.to.safe': 'To the safe',
    'jb.to.case.0': 'To the display cases',
    'jb.to.lager.goods': 'To the storeroom',
    'jb.to.post.lookout': 'To your lookout post',
    'jb.to.van.driver': 'To the driver seat',
    'jb.at.van': 'At the van',
    'jb.at.gate': 'At the yard gate',
    'jb.at.door.liefer': 'At the delivery door',
    'jb.at.door.vorder': 'At the front door',
    'jb.at.in.dach': 'At the roof hatch',
    'jb.at.safe': 'At the safe',
    'jb.at.case.0': 'At the display cases',
    'jb.at.lager.goods': 'In the storeroom',
    'jb.at.post.lookout': 'On your post',
    'jb.at.van.driver': 'At the wheel',
    'jb.toAny': 'To the objective',
    'jb.atAny': 'At the objective',
    'jb.task.lock': 'pick the lock',
    'jb.task.safe': 'open the safe',
    'jb.task.drill': 'drill the safe',
    'jb.task.any': 'do the job',
    'jb.taskCap.lock': 'Pick the lock',
    'jb.taskCap.safe': 'Open the safe',
    'jb.taskCap.drill': 'Drill the safe',
    'jb.taskCap.any': 'Start',
    'jb.yourTask': 'Your task: {task}',
    'jb.sub.goPress': 'Go there, then press E.',
    'jb.sub.press': 'Press E to start.',
    'jb.sub.working': 'Your turn. Walking away means giving up.',
    'jb.other.lock': '{who} is picking the lock …',
    'jb.other.safe': '{who} is opening the safe …',
    'jb.other.drill': '{who} is drilling the safe …',
    'jb.other.any': '{who} is on it …',
    'jb.sub.wait': 'Wait for the others.',
    'jb.sub.waitGo': 'The job goes on once everyone is there.',
    'jb.sub.lookout': 'You are on watch: keep an eye on the street.',
    'jb.sub.driver': 'You drive: wait at the van until everyone is back.',
    'jb.sub.caught': 'You are out. Watch how it ends.',
    'jb.caughtHead': 'Caught',
    'jb.beat.bt.approach': 'The job starts. Stay together.',
    'jb.beat.bt.in': 'Get inside.',
    'jb.beat.bt.encounter': 'Keep calm.',
    'jb.beat.bt.target': 'Take what you came for.',
    'jb.beat.bt.push': 'Taking a little more.',
    'jb.beat.bt.greed': 'Almost done.',
    'jb.beat.bt.out': 'Get out.',
    'jb.beat.bt.getaway': 'Back to the van, then away.',
    'jb.decidesOther': '{who} decides …',
    'jb.chose': '{who}: {o}',
    'jb.you': 'You',
    'jb.time': 'Time',
    'jb.noiseM': 'Noise',
    'jb.alarmTag': 'Alarm',
    'jb.logKey': 'Log',
    'jb.logTitle': 'So far',
    'jb.youDecide': 'Your decision',
    'jb.onlyYou': 'Only for you',
    'jb.answered': 'Answer given.',
    'jb.intro.1': 'Follow the marker.',
    'jb.intro.2': 'Whoever is up gets a task or a decision.',
    'jb.intro.3': 'Tab shows what has happened so far.',
    'jb.intro.any': 'Any key to continue',
    'jb.open.lock': 'Pick the lock: who does it?',
    'jb.open.safe': 'Open the safe: who does it?',
    'jb.open.drill': 'Drill the safe: who does it?',
    'jb.open.door': 'The door: who opens it?',
    'jb.open.vault': 'The safe: who opens it?',
    'jb.sub.openGo': "Normally {who}'s job. Whoever presses E there first does it.",
    'jb.sub.openAny': 'Whoever presses the key there first does it.',
    'jb.sub.openHere': 'Press the key to start.',
    'jb.sub.standIn': 'You stand in for {who}: a little harder.',
    'jb.key.lock': 'Pick the lock',
    'jb.key.crow': 'Crowbar (loud, sure)',
    'jb.key.safe': 'Open quietly',
    'jb.key.drill': 'Drill (loud)',
    'jb.otherOpen': '{task}: waiting for someone inside',
    'jb.dice': 'Dice decide in {t}',
    'jb.toast.tresor': 'Safe open',
    'jb.toast.vitrinen': 'Display cases emptied',
    'jb.toast.lager': 'Storeroom cleared',
    'jb.toast.shut': 'The safe stays shut',
    'jb.toast.in': 'You are in',
    'jb.cq.ok': '{n} % it works.',
    'jb.cq.unseen': '{n} % nobody sees you.',
    'jb.cq.police': '{n} % you are out before the police.',
    'jb.cq.risk': 'Risk {n} %.',
    'jb.cq.noRisk': 'No risk.',
    'jb.cq.sure': 'Certain.',
    'jb.cq.takes': 'Takes {x}.',
    'jb.goOn': 'Going on without you in {t}',
  },
  {
    'jb.to.van': 'Zum Transporter',
    'jb.to.gate': 'Zum Hoftor',
    'jb.to.door.liefer': 'Zur Liefertür',
    'jb.to.door.vorder': 'Zur Vordertür',
    'jb.to.in.dach': 'Zur Dachluke',
    'jb.to.safe': 'Zum Tresor',
    'jb.to.case.0': 'Zu den Vitrinen',
    'jb.to.lager.goods': 'Ins Lager',
    'jb.to.post.lookout': 'Zu deinem Posten',
    'jb.to.van.driver': 'Zum Fahrersitz',
    'jb.at.van': 'Am Transporter',
    'jb.at.gate': 'Am Hoftor',
    'jb.at.door.liefer': 'An der Liefertür',
    'jb.at.door.vorder': 'An der Vordertür',
    'jb.at.in.dach': 'An der Dachluke',
    'jb.at.safe': 'Am Tresor',
    'jb.at.case.0': 'An den Vitrinen',
    'jb.at.lager.goods': 'Im Lager',
    'jb.at.post.lookout': 'Auf Posten',
    'jb.at.van.driver': 'Am Steuer',
    'jb.toAny': 'Zum Ziel',
    'jb.atAny': 'Am Ziel',
    'jb.task.lock': 'Schloss knacken',
    'jb.task.safe': 'Tresor öffnen',
    'jb.task.drill': 'Tresor aufbohren',
    'jb.task.any': 'Aufgabe erledigen',
    'jb.taskCap.lock': 'Schloss knacken',
    'jb.taskCap.safe': 'Tresor öffnen',
    'jb.taskCap.drill': 'Tresor aufbohren',
    'jb.taskCap.any': 'Loslegen',
    'jb.yourTask': 'Deine Aufgabe: {task}',
    'jb.sub.goPress': 'Geh hin und drück E.',
    'jb.sub.press': 'Drück E, um anzufangen.',
    'jb.sub.working': 'Du bist dran. Weggehen heißt aufgeben.',
    'jb.other.lock': '{who} knackt das Schloss …',
    'jb.other.safe': '{who} öffnet den Tresor …',
    'jb.other.drill': '{who} bohrt den Tresor auf …',
    'jb.other.any': '{who} ist dran …',
    'jb.sub.wait': 'Warte auf die anderen.',
    'jb.sub.waitGo': 'Es geht weiter, wenn alle dort sind.',
    'jb.sub.lookout': 'Du bist auf Posten: halte die Straße im Blick.',
    'jb.sub.driver': 'Du fährst: warte am Wagen, bis alle zurück sind.',
    'jb.sub.caught': 'Du bist raus. Schau zu, wie es ausgeht.',
    'jb.caughtHead': 'Geschnappt',
    'jb.beat.bt.approach': 'Es geht los. Bleibt zusammen.',
    'jb.beat.bt.in': 'Rein ins Haus.',
    'jb.beat.bt.encounter': 'Ruhig bleiben.',
    'jb.beat.bt.target': 'Holt, weswegen ihr hier seid.',
    'jb.beat.bt.push': 'Ihr holt noch etwas mehr.',
    'jb.beat.bt.greed': 'Fast geschafft.',
    'jb.beat.bt.out': 'Raus hier.',
    'jb.beat.bt.getaway': 'Zurück zum Wagen, dann weg.',
    'jb.decidesOther': '{who} entscheidet …',
    'jb.chose': '{who}: {o}',
    'jb.you': 'Du',
    'jb.time': 'Zeit',
    'jb.noiseM': 'Lärm',
    'jb.alarmTag': 'Alarm',
    'jb.logKey': 'Verlauf',
    'jb.logTitle': 'Bisher',
    'jb.youDecide': 'Du entscheidest',
    'jb.onlyYou': 'Nur für dich',
    'jb.answered': 'Antwort gegeben.',
    'jb.intro.1': 'Folgt dem Marker.',
    'jb.intro.2': 'Wer dran ist, bekommt eine Aufgabe oder eine Entscheidung.',
    'jb.intro.3': 'Tab zeigt, was bisher geschah.',
    'jb.intro.any': 'Weiter mit beliebiger Taste',
    'jb.open.lock': 'Schloss knacken: wer macht es?',
    'jb.open.safe': 'Tresor öffnen: wer macht es?',
    'jb.open.drill': 'Tresor aufbohren: wer macht es?',
    'jb.open.door': 'Die Tür: wer macht sie auf?',
    'jb.open.vault': 'Der Tresor: wer macht ihn auf?',
    'jb.sub.openGo': 'Eigentlich Sache von {who}. Wer dort zuerst E drückt, macht es.',
    'jb.sub.openAny': 'Wer dort zuerst die Taste drückt, macht es.',
    'jb.sub.openHere': 'Drück die Taste und leg los.',
    'jb.sub.standIn': 'Du springst für {who} ein: etwas schwerer.',
    'jb.key.lock': 'Schloss knacken',
    'jb.key.crow': 'Aufhebeln (laut, sicher)',
    'jb.key.safe': 'Leise öffnen',
    'jb.key.drill': 'Bohren (laut)',
    'jb.otherOpen': '{task}: wartet auf jemanden drinnen',
    'jb.dice': 'Würfel entscheidet in {t}',
    'jb.toast.tresor': 'Tresor offen',
    'jb.toast.vitrinen': 'Vitrinen leer',
    'jb.toast.lager': 'Lager ausgeräumt',
    'jb.toast.shut': 'Tresor bleibt zu',
    'jb.toast.in': 'Ihr seid drin',
    'jb.cq.ok': 'Klappt zu {n} %.',
    'jb.cq.unseen': 'Zu {n} % sieht euch keiner.',
    'jb.cq.police': 'Zu {n} % vor der Polizei raus.',
    'jb.cq.risk': 'Risiko {n} %.',
    'jb.cq.noRisk': 'Kein Risiko.',
    'jb.cq.sure': 'Sicher.',
    'jb.cq.takes': 'Dauert {x}.',
    'jb.goOn': 'Es geht ohne euch weiter in {t}',
  },
);

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const tOr = (k: string, fb: string, vars?: Record<string, string | number>) => {
  const s = t(k, vars);
  return s === k ? t(fb, vars) : s;
};
/** Seconds one event line stays (never shorter than LINE_MIN; older lines give way when more than QUEUE_MAX wait). */
const LINE_S = 3;
const LINE_MIN = 2.5;
const QUEUE_MAX = 3;
/** Neutral narration stays in the Tab log; the event line shows what the crew must know. */
const SKIP_KINDS = new Set(['info', 'roll', 'trace']);
const TOAST_S = 2;
const TOAST_LINE: Record<string, [string, boolean]> = { 'ln.safeShut': ['jb.toast.shut', true], 'ln.open': ['jb.toast.in', false], 'ln.openSix': ['jb.toast.in', false], 'ln.allDown': ['jb.toast.in', false] };
/** Inside this distance the world marker fades out. */
const FADE_NEAR = 2.2;
const FADE_FAR = 5;
const ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L20 19 L12 15 L4 19 Z"/></svg>';
let introDone = false;
try {
  introDone = sessionStorage.getItem('nv.jb.intro') === '1';
} catch {
  /* private mode */
}

export type TaskKind = 'lock' | 'safe' | 'drill' | 'any';
export const taskKind = (game: string, variant?: string): TaskKind =>
  game === 'lock' ? 'lock' : game === 'safe' ? (variant === 'drill' ? 'drill' : 'safe') : 'any';

/** Everything the HUD needs for one frame (the director computes it). */
export interface HudFrame {
  p: any;
  me: string | null;
  priv: any;
  hostNow: number;
  /** the objective's anchor key and place (null: no place) */
  key: string | null;
  anchor: Anchor | null;
  /** within the anchor's radius */
  here: boolean;
  /** this player's own skill request, if any (standIn: he does a bot seat's job, `holder` = that seat) */
  mySkill: { game: string; variant: string; standIn?: boolean; holder?: string | null } | null;
  /** a task open to everyone inside, or a "which way" choice at a place, that this player may start */
  openTask: OpenTask | null;
  /** ... and he stands there now: show its keys */
  openHere: OpenTask | null;
  /** this player carries a bag (loot.ts) */
  carrying?: boolean;
  /** the skill game is open on this client */
  gameOpen: boolean;
  /** standing at the task's place, game not open yet: show "E ..." */
  prompt: boolean;
  player: Player | null;
}

export interface HudDeps {
  root: HTMLElement;
  camera: THREE.Camera;
  /** send a plan action (intent 'plan.act') */
  act: (a: any) => void;
}

type QItem = { text: string; cls: string };

export class JobHud {
  private readonly top: HTMLElement;
  private readonly objMain: HTMLElement;
  private readonly objArrow: HTMLElement;
  private readonly objText: HTMLElement;
  private readonly objDist: HTMLElement;
  private readonly objSub: HTMLElement;
  private readonly event: HTMLElement;
  private readonly meters: HTMLElement;
  private readonly timeBar: HTMLElement;
  private readonly timeRow: HTMLElement;
  private readonly noiseBar: HTMLElement;
  private readonly noiseRow: HTMLElement;
  private readonly alarm: HTMLElement;
  private readonly pop: HTMLElement;
  private readonly log: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly edge: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly rescueEl: HTMLElement;
  private readonly diceEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private toastLeft = 0;
  // 3D marker (built once, see ENGINE.md rule 2: no new materials while playing)
  private readonly mk = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly gem: THREE.Mesh;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly gemMat: THREE.MeshBasicMaterial;
  private v = new THREE.Vector3();
  private fwd = new THREE.Vector3();

  private shown = false;
  private job: unknown = null;
  private seen = 0;
  private queue: QItem[] = [];
  private cur: QItem | null = null;
  private curLeft = 0;
  private sticky = '';
  private lastDecider: string | null = null;
  private popKind: 'decision' | 'offer' | null = null;
  private popKey = '';
  private popSpan = 0;
  private popDeadline = 0;
  private offerStep: 'main' | 't' | 'p' = 'main';
  private offerT: string | null = null;
  private offerP: string | null = null;
  private offerId = '';
  private sentKey = '';
  private logOpen = false;
  private logKey = '';
  private introLeft = 0;
  private ePressed = false;
  private fPressed = false;
  private last: HudFrame | null = null;
  private stuckBest = Infinity;
  private stuckT = 0;
  private rescueHeld = false;
  /** for tests */
  introCount = 0;

  constructor(private d: HudDeps) {
    const el = (cls: string, html = '') => {
      const e = document.createElement('div');
      e.className = cls;
      if (html) e.innerHTML = html;
      return e;
    };
    this.top = el('jb-top hidden');
    this.objMain = el('jb-obj');
    this.objArrow = el('jb-arrow', ARROW_SVG);
    this.objText = document.createElement('span');
    this.objDist = document.createElement('span');
    this.objDist.className = 'jb-dist';
    this.objMain.append(this.objArrow, this.objText, this.objDist);
    this.objSub = el('jb-sub');
    this.event = el('jb-event');
    this.diceEl = el('jb-dice hidden');
    this.top.append(this.objMain, this.objSub, this.event, this.diceEl);

    this.meters = el('jb-meters hidden');
    this.timeRow = el('jb-m jb-m-time', `<span class="jb-ml"></span><div class="jb-bar"><i></i></div>`);
    this.noiseRow = el('jb-m jb-m-noise', `<span class="jb-ml"></span><div class="jb-bar"><i></i></div>`);
    this.timeBar = this.timeRow.querySelector('i')!;
    this.noiseBar = this.noiseRow.querySelector('i')!;
    this.alarm = el('jb-alarm hidden');
    const tab = el('jb-tabhint');
    this.meters.append(this.timeRow, this.noiseRow, this.alarm, tab);

    this.pop = el('jb-pop interactive hidden');
    this.pop.addEventListener('click', (e) => this.onClick(e));
    this.log = el('jb-log hidden');
    this.intro = el('jb-intro hidden');
    this.edge = el('jb-edge hidden', ARROW_SVG);
    this.promptEl = el('jb-prompt hidden');
    this.promptEl.setAttribute('data-jb-skill', '');
    this.rescueEl = el('jb-rescue hidden');
    this.toastEl = el('jb-toast hidden');
    d.root.append(this.toastEl);
    d.root.append(this.top, this.meters, this.edge, this.promptEl, this.pop, this.log, this.intro, this.rescueEl);

    // the world marker: a soft light column and a floating diamond, drawn last and through walls
    const cv = document.createElement('canvas');
    cv.width = 32;
    cv.height = 128;
    const c = cv.getContext('2d')!;
    for (let x = 0; x < 32; x++) {
      const k = Math.exp(-Math.pow((x - 15.5) / 6, 2));
      const g = c.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, `rgba(255,214,120,0)`);
      g.addColorStop(0.55, `rgba(255,214,120,${0.35 * k})`);
      g.addColorStop(1, `rgba(255,214,120,${0.75 * k})`);
      c.fillStyle = g;
      c.fillRect(x, 0, 1, 128);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const common = { transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false } as const;
    this.beamMat = new THREE.MeshBasicMaterial({ ...common, map: tex, side: THREE.DoubleSide });
    this.gemMat = new THREE.MeshBasicMaterial({ ...common, color: 0xffcf5a });
    const bg = new THREE.PlaneGeometry(1.1, 7);
    bg.translate(0, 3.5, 0);
    this.beam = new THREE.Mesh(bg, this.beamMat);
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), this.gemMat);
    this.gem.scale.set(1, 1.5, 1);
    this.beam.renderOrder = 998;
    this.gem.renderOrder = 999;
    this.beam.frustumCulled = this.gem.frustumCulled = false;
    this.mk.add(this.beam, this.gem);
    this.mk.name = 'jb-marker';
    // in the scene from the start (visible) so the warm-up compiles its shaders behind the loading screen
    this.mk.position.set(0, -500, 0);
    d.camera.parent?.add(this.mk);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.setLog(false));
  }

  private lang(): Lang {
    return settings.get('lang') === 'en' ? 'en' : 'de';
  }
  private ctx(p: any) {
    return { lang: this.lang(), name: (r: string) => p?.seats?.find((x: any) => x.role === r)?.name ?? pt('role.' + r + '.name', undefined, this.lang()) };
  }
  private P(k: string, vars?: Record<string, string | number>) {
    return pt(k, vars, this.lang());
  }

  // ------------------------------------------------------------------ input

  private typing(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.shown || this.typing(e)) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!e.repeat || !down) this.setLog(down);
      return;
    }
    if (!down || e.repeat) return;
    if (this.introLeft > 0) {
      this.introLeft = 0;
      this.intro.classList.add('hidden');
    }
    if (e.code === 'KeyE') this.ePressed = true;
    if (e.code === 'KeyF') this.fPressed = true;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m && this.popKind) {
      e.preventDefault();
      this.pick(Number(m[1]));
    }
  }

  /** E was pressed since the last call (the director opens the skill game on it). */
  takeE(): boolean {
    const v = this.ePressed;
    this.ePressed = false;
    return v;
  }

  /** F was pressed since the last call (second way of a task: drill, crowbar). */
  takeF(): boolean {
    const v = this.fPressed;
    this.fPressed = false;
    return v;
  }

  popupOpen() {
    return this.popKind !== null;
  }

  private onClick(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('[data-n]') as HTMLElement | null;
    if (b) this.pick(Number(b.dataset.n));
  }

  /** Number key n (1-based) or a click on the card with that number. */
  private pick(n: number) {
    const f = this.last;
    if (!f || !this.popKind) return;
    const R = f.p?.run;
    if (this.popKind === 'decision') {
      const d = R?.decision;
      const o = d?.options?.[n - 1];
      if (!o) return;
      const k = 'd' + f.p.job + ':' + R.shown + ':' + o.id;
      if (this.sentKey.startsWith('d' + f.p.job + ':' + R.shown + ':')) return;
      this.sentKey = k;
      this.flash(n);
      this.d.act({ t: 'choose', id: o.id });
      return;
    }
    const o = f.priv?.offer;
    if (!o || o.answered) return;
    const targets: string[] = o.targets ?? [];
    if (this.offerStep === 'main') {
      if (n === 2) return this.sendOffer('decline', n);
      if (n !== 1) return;
      if (!o.need) return this.sendOffer('accept', n);
      this.offerStep = 't';
      this.popKey = '';
      return;
    }
    if (this.offerStep === 't') {
      const r = targets[n - 1];
      if (!r) return;
      this.offerT = r;
      if (o.need === 'two') {
        this.offerStep = 'p';
        this.popKey = '';
        return;
      }
      return this.sendOffer('accept:' + r, n);
    }
    const rest = targets.filter((x) => x !== this.offerT);
    const r = rest[n - 1];
    if (!r) return;
    this.offerP = r;
    this.sendOffer('accept:' + this.offerT + ':' + r, n);
  }

  private sendOffer(answer: string, n: number) {
    const k = 'o' + this.offerId;
    if (this.sentKey === k) return;
    this.sentKey = k;
    this.flash(n);
    this.d.act({ t: 'offer', answer });
  }

  private flash(n: number) {
    this.pop.querySelector(`[data-n="${n}"]`)?.classList.add('on');
  }

  private setLog(on: boolean) {
    if (on === this.logOpen) return;
    this.logOpen = on;
    this.logKey = '';
    this.log.classList.toggle('hidden', !on);
  }

  // ------------------------------------------------------------------ per frame

  /** A new run started on this client. */
  startRun(p: any) {
    this.job = p.job;
    this.queue = [];
    this.cur = null;
    this.curLeft = 0;
    this.sticky = '';
    this.lastDecider = null;
    this.sentKey = '';
    this.stuckBest = Infinity;
    this.stuckT = 0;
    // a late joiner does not replay the whole job: only the last line
    const n = (p.run?.beats ?? []).reduce((s: number, b: any) => s + b.lines.length, 0);
    this.seen = Math.max(0, n - 1);
    if (!introDone) {
      introDone = true;
      try {
        sessionStorage.setItem('nv.jb.intro', '1');
      } catch {
        /* private mode */
      }
      this.introCount++;
      this.introLeft = 9;
      this.intro.innerHTML = `<p>${esc(t('jb.intro.1'))}</p><p>${esc(t('jb.intro.2'))}</p><p>${esc(t('jb.intro.3'))}</p><small>${esc(t('jb.intro.any'))}</small>`;
      this.intro.classList.remove('hidden');
    }
  }

  frame(f: HudFrame, dt: number) {
    this.last = f;
    const p = f.p;
    const R = p.run;
    if (!this.shown) {
      this.shown = true;
      this.top.classList.remove('hidden');
      this.meters.classList.remove('hidden');
      this.d.root.classList.add('jb-run');
    }
    if (this.job !== p.job) this.startRun(p);
    if (this.introLeft > 0) {
      this.introLeft -= dt;
      if (this.introLeft <= 0) this.intro.classList.add('hidden');
    }
    const ctx = this.ctx(p);
    this.drawObjective(f, ctx, dt);
    this.drawEvents(f, ctx, dt);
    this.drawMeters(R);
    this.drawPopup(f, ctx);
    this.drawPrompt(f);
    this.drawMarker(f);
    if (this.logOpen) this.drawLog(p, ctx);
    this.drawDice(f);
    // E counts only for the frame it was pressed in (the director reads it before this)
    this.ePressed = false;
    this.fPressed = false;
  }

  private setText(el: HTMLElement, s: string) {
    if (el.textContent !== s) el.textContent = s;
  }

  private drawObjective(f: HudFrame, ctx: ReturnType<JobHud['ctx']>, dt: number) {
    const p = f.p;
    const R = p.run;
    const me = f.me;
    let main = '';
    let sub = '';
    const pl = f.player;
    const dist = f.anchor && pl ? Math.hypot(pl.position.x - f.anchor.x, pl.position.z - f.anchor.z) : 0;
    const showDist = !!f.anchor && !f.here && dist >= 1.5;
    const placeTo = (k: string | null) => (k ? tOr('jb.to.' + k, 'jb.toAny') : t('jb.toAny'));
    const placeAt = (k: string | null) => (k ? tOr('jb.at.' + k, 'jb.atAny') : t('jb.atAny'));
    if (!me) {
      main = '';
    } else if (R.status[me] === 'caught') {
      main = t('jb.caughtHead');
      sub = t('jb.sub.caught');
    } else if (f.mySkill) {
      const k = taskKind(f.mySkill.game, f.mySkill.variant);
      main = t('jb.yourTask', { task: t('jb.task.' + k) });
      sub = f.gameOpen ? t('jb.sub.working') : f.prompt || f.here || !f.anchor ? t('jb.sub.press') : t('jb.sub.goPress');
      if (f.mySkill.standIn && f.mySkill.holder && !f.gameOpen) sub = t('jb.sub.standIn', { who: ctx.name(f.mySkill.holder) }) + ' ' + sub;
    } else if (f.openTask) {
      const o = f.openTask;
      const task = o.opts[0]?.task ?? 'any';
      main = o.kind === 'choice' ? t(task === 'lock' || task === 'crow' ? 'jb.open.door' : 'jb.open.vault') : tOr('jb.open.' + task, 'jb.open.lock');
      sub = f.openHere ? t('jb.sub.openHere') : o.holder && p.seats?.find((x: any) => x.role === o.holder)?.bot !== false ? t('jb.sub.openGo', { who: ctx.name(o.holder) }) : t('jb.sub.openAny');
    } else {
      const post = p.plan?.posts?.[me];
      main = f.here || !f.anchor ? placeAt(f.key) : placeTo(f.key);
      if (f.carrying) sub = t('jb.sub.carry');
      else if (f.key === 'loot') sub = t('jb.sub.loot');
      else if (post === 'lookout') sub = t('jb.sub.lookout');
      else if (post === 'driver') sub = t('jb.sub.driver');
      else if (R.waitAt) sub = t(f.here ? 'jb.sub.wait' : 'jb.sub.waitGo');
      else {
        const b = R.beats[R.beats.length - 1];
        sub = b ? tOr('jb.beat.' + b.title.k, 'jb.sub.waitGo') : '';
      }
    }
    // skill of someone else seen by a lookout or driver: still say who works
    if (me && !f.mySkill && !f.openTask && R.skill && R.skill.who !== me && R.status[me] !== 'caught') {
      const k = R.skill.kind === 'lock' || R.skill.kind === 'safe' || R.skill.kind === 'drill' ? R.skill.kind : R.skill.game === 'lock' ? 'lock' : R.skill.game === 'safe' ? 'safe' : 'any';
      sub = R.skill.who ? t('jb.other.' + k, { who: ctx.name(R.skill.who) }) : t('jb.otherOpen', { task: t('jb.taskCap.' + k) });
    }
    this.setText(this.objText, main);
    this.setText(this.objDist, showDist ? `${Math.round(dist)} m` : '');
    this.objMain.classList.toggle('far', showDist);
    this.objMain.classList.toggle('task', !!f.mySkill);
    this.objMain.classList.toggle('hidden', !main);
    this.setText(this.objSub, sub);
    // the arrow turns with the player: up = straight ahead
    if (showDist && pl && f.anchor) {
      this.d.camera.getWorldDirection(this.fwd);
      const bx = f.anchor.x - pl.position.x;
      const bz = f.anchor.z - pl.position.z;
      const a = Math.atan2(this.fwd.x * bz - this.fwd.z * bx, this.fwd.x * bx + this.fwd.z * bz);
      this.objArrow.style.transform = `rotate(${(a * 180) / Math.PI}deg)`;
    }
    // stuck: no progress towards the objective for 20 s
    if (showDist && dist > 4 && !pl?.frozen) {
      if (dist < this.stuckBest - 1) {
        this.stuckBest = dist;
        this.stuckT = 0;
      } else this.stuckT += dt;
    } else {
      this.stuckBest = Infinity;
      this.stuckT = 0;
    }
  }

  /** "Stuck? Hold R": always there but quiet; brighter while holding R or after 20 s without progress. */
  setRescue(text: string | null, holding: boolean) {
    this.rescueHeld = holding;
    const on = !!text;
    this.rescueEl.classList.toggle('hold', holding || this.stuckT > 20);
    this.rescueEl.classList.toggle('hidden', !on);
    if (on) this.setText(this.rescueEl, text!);
  }

  private lineText(l: any, ctx: ReturnType<JobHud['ctx']>, me: string | null): QItem {
    if (l.kind === 'roll') return { text: `${tx(l.roll.label, ctx)}: ${this.P(l.roll.ok ? 'rl.yes' : 'rl.no')}`, cls: l.roll.ok ? 'good' : 'bad' };
    if (l.kind === 'choice' && l.x?.p?.o && this.lastDecider) {
      const who = this.lastDecider === me ? t('jb.you') : ctx.name(this.lastDecider);
      return { text: t('jb.chose', { who, o: tx(l.x.p.o, ctx) }), cls: 'choice' };
    }
    const cls = l.kind === 'good' ? 'good' : l.kind === 'bad' || l.kind === 'warn' ? 'bad' : '';
    return { text: tx(l.x, ctx), cls };
  }

  private drawEvents(f: HudFrame, ctx: ReturnType<JobHud['ctx']>, dt: number) {
    const R = f.p.run;
    const d = R.decision;
    if (d) this.lastDecider = d.who;
    let n = 0;
    for (const b of R.beats) {
      for (const l of b.lines) {
        if (n++ < this.seen) continue;
        const k = l?.x?.k ?? '';
        // a target done: a short centred toast
        if ((k === 'ln.loot' || k === 'ln.lootBest') && b.target) this.toast(t('jb.toast.' + b.target), false);
        else if (TOAST_LINE[k]) this.toast(t(TOAST_LINE[k][0]), TOAST_LINE[k][1]);
        if (SKIP_KINDS.has(l.kind) && !(l.kind === 'info' && /^ln\.(cases|crates)$/.test(k))) continue;
        // a way chosen at the place (E / F) needs no line: the player did it himself, the result follows
        if (l.kind === 'choice' && !this.lastDecider) continue;
        this.queue.push(this.lineText(l, ctx, f.me));
        if (l.kind === 'choice') this.lastDecider = null;
      }
    }
    this.seen = n;
    // falling behind: drop the oldest neutral lines first, never bad news
    while (this.queue.length > QUEUE_MAX) {
      const i = this.queue.findIndex((q) => q.cls !== 'bad');
      this.queue.splice(i >= 0 ? i : 0, 1);
    }
    if (this.toastLeft > 0) {
      this.toastLeft -= dt;
      if (this.toastLeft <= 0) this.toastEl.classList.add('hidden');
    }
    // somebody else decides: one line, no cards
    this.sticky = d && !(d.who === f.me && !d.bot) ? t('jb.decidesOther', { who: ctx.name(d.who) }) : '';
    // somebody decides now: that is the one line; older lines give way (they stay in the Tab log)
    if (this.sticky) {
      this.queue.length = 0;
      this.cur = null;
      this.curLeft = 0;
    }
    if (this.cur) this.curLeft -= dt;
    if (!this.cur || this.curLeft <= 0) {
      this.cur = this.queue.shift() ?? null;
      // keep up when lines come faster than they can be read
      this.curLeft = this.cur ? Math.max(LINE_MIN, LINE_S - 0.25 * this.queue.length) : 0;
      if (!this.cur && this.event.dataset.k !== 's' + this.sticky) {
        this.event.dataset.k = 's' + this.sticky;
        this.event.className = 'jb-event' + (this.sticky ? ' wait' : ' empty');
        this.event.textContent = this.sticky;
      }
      if (this.cur) {
        this.event.dataset.k = 'q';
        this.event.className = 'jb-event in ' + this.cur.cls;
        this.event.textContent = this.cur.text;
      }
    }
  }

  private toast(text: string, bad: boolean) {
    this.toastEl.textContent = text;
    this.toastEl.className = 'jb-toast' + (bad ? ' bad' : '');
    this.toastLeft = TOAST_S;
  }

  private drawMeters(R: any) {
    this.setText(this.timeRow.firstElementChild as HTMLElement, t('jb.time'));
    this.setText(this.noiseRow.firstElementChild as HTMLElement, t('jb.noiseM'));
    const tab = this.meters.lastElementChild as HTMLElement;
    const tabTxt = `<kbd>Tab</kbd> ${esc(t('jb.logKey'))}`;
    if (tab.innerHTML !== tabTxt) tab.innerHTML = tabTxt;
    const w = Math.max(1, R.windowEnd);
    const left = R.windowEnd - R.t;
    const st = R.alarmKnown || left <= 0 ? 'open' : left <= 3 ? 'warn' : 'ok';
    this.timeRow.dataset.st = st;
    this.timeBar.style.width = clamp((R.t / w) * 100, 2, 100) + '%';
    const nz = clamp(R.noise, 0, 10);
    this.noiseRow.dataset.st = nz >= 7 ? 'open' : nz >= 4 ? 'warn' : 'ok';
    this.noiseBar.style.width = Math.max(2, nz * 10) + '%';
    this.alarm.classList.toggle('hidden', !R.alarmKnown);
    this.setText(this.alarm, t('jb.alarmTag'));
  }

  // ------------------------------------------------------------------ pop-up

  private drawPopup(f: HudFrame, ctx: ReturnType<JobHud['ctx']>) {
    const p = f.p;
    const R = p.run;
    const d = R.decision;
    const o = f.priv?.offer && f.priv.job === p.job && p.phase === 'offer' && p.mid && !f.priv.offer.answered ? f.priv.offer : null;
    let kind: 'decision' | 'offer' | null = null;
    if (p.phase === 'run' && d && d.who === f.me && !d.bot && !f.gameOpen) kind = 'decision';
    else if (o && !f.gameOpen) kind = 'offer';
    if (kind === 'offer') {
      const id = o.id + ':' + o.when + ':' + o.deadline;
      if (id !== this.offerId) {
        this.offerId = id;
        this.offerStep = 'main';
        this.offerT = this.offerP = null;
      }
    }
    const lang = this.lang();
    const key = kind ? [kind, p.job, R.shown, this.offerStep, this.offerT, lang, kind === 'offer' ? this.offerId : ''].join('|') : '';
    if (kind !== this.popKind || key !== this.popKey) {
      this.popKind = kind;
      this.popKey = key;
      this.pop.classList.toggle('hidden', !kind);
      if (!kind) {
        this.pop.innerHTML = '';
      } else {
        const dl = p.deadline || (o?.deadline ?? 0);
        if (dl !== this.popDeadline) {
          this.popDeadline = dl;
          this.popSpan = Math.max(1000, dl - f.hostNow);
        }
        this.pop.className = 'jb-pop interactive ' + kind;
        this.pop.innerHTML = kind === 'decision' ? this.decisionHtml(d, ctx) : this.offerHtml(o, ctx);
      }
    }
    if (kind) {
      const bar = this.pop.querySelector('.jb-timer i') as HTMLElement | null;
      if (bar) bar.style.width = clamp(((this.popDeadline - f.hostNow) / this.popSpan) * 100, 0, 100) + '%';
    }
  }

  private card(n: number, label: string, extra = '', cls = '', data = '') {
    return `<button type="button" class="jb-opt ${cls}" data-n="${n}" ${data}><kbd>${n}</kbd><span class="jb-ol">${label}</span>${extra}</button>`;
  }

  private decisionHtml(d: any, ctx: ReturnType<JobHud['ctx']>) {
    let h = `<div class="jb-ph">${esc(t('jb.youDecide'))}</div><div class="jb-q">${esc(tx(d.title, ctx))}</div>`;
    const sub = tx(d.text, ctx);
    if (sub) h += `<div class="jb-qs">${esc(sub)}</div>`;
    h += `<div class="jb-opts n${d.options.length}">`;
    d.options.forEach((o: any, i: number) => {
      h += this.card(i + 1, `<b>${esc(tx(o.label, ctx))}</b><span class="jb-cq">${esc(this.consequence(o, ctx))}</span>`, '', '', `data-jb-opt="${esc(o.id)}"`);
    });
    return h + `</div><div class="jb-timer"><i></i></div>`;
  }

  /** One short line per option: the chance in words, then what happens otherwise (the option's details). */
  private consequence(o: any, ctx: ReturnType<JobHud['ctx']>): string {
    const n = Math.round(Number(o.pct) || 0);
    const pl = o.pctLabel?.k ?? '';
    let a: string;
    if (pl === 'pl.sure' || n >= 100) a = t('jb.cq.sure');
    else if (pl === 'pl.risk') a = n > 0 ? t('jb.cq.risk', { n }) : t('jb.cq.noRisk');
    else if (pl === 'pl.unseen') a = t('jb.cq.unseen', { n });
    else if (pl === 'pl.beforePolice') a = t('jb.cq.police', { n });
    else a = t('jb.cq.ok', { n });
    const tag0 = o.tags?.[0];
    const det = o.details ? tx(o.details, ctx) : tag0?.k === 'tag.min' ? t('jb.cq.takes', { x: tx(tag0, ctx) }) : tag0 ? tx(tag0, ctx) : '';
    return det ? `${a} ${det}` : a;
  }

  private offerHtml(o: any, ctx: ReturnType<JobHud['ctx']>) {
    let h = `<div class="jb-ph acc">${esc(t('jb.onlyYou'))}</div>`;
    const targets: string[] = o.targets ?? [];
    if (this.offerStep === 'main') {
      h += `<div class="jb-q">${esc(this.P('of.' + o.id + '.title'))}</div><div class="jb-qs">${esc(this.P('of.' + o.id + '.text'))}</div>`;
      h += `<div class="jb-tags"><span class="jb-tag ok">${esc(this.P('of.' + o.id + '.gain'))}</span><span class="jb-tag bad">${esc(this.P('of.' + o.id + '.cost'))}</span></div>`;
      h += `<div class="jb-opts n2">${this.card(1, `<b>${esc(this.P('pv.accept'))}</b>`, '', 'pri', 'data-jb-offer="accept"')}${this.card(2, `<b>${esc(this.P('pv.decline'))}</b>`, '', '', 'data-jb-offer="decline"')}</div>`;
    } else {
      const list = this.offerStep === 't' ? targets : targets.filter((x) => x !== this.offerT);
      const q = this.offerStep === 't' ? (o.need === 'two' ? 'pv.pickSlow' : 'pv.pickOne') : 'pv.pickPartner';
      h += `<div class="jb-q">${esc(this.P(q))}</div><div class="jb-qs">${esc(this.P('of.' + o.id + '.title'))}</div>`;
      h += `<div class="jb-opts n${list.length}">${list.map((r, i) => this.card(i + 1, `<b>${esc(ctx.name(r))}</b>`, '', '', `data-jb-target="${esc(r)}"`)).join('')}</div>`;
    }
    return h + `<div class="jb-timer"><i></i></div>`;
  }

  // ------------------------------------------------------------------ task prompt, marker, log

  private drawPrompt(f: HudFrame) {
    const mine = f.prompt && !!f.mySkill && !this.popKind;
    const open = !mine && !!f.openHere && !this.popKind && !f.gameOpen;
    this.promptEl.classList.toggle('hidden', !mine && !open);
    let html = '';
    if (mine) html = `<kbd>E</kbd><span>${esc(t('jb.taskCap.' + taskKind(f.mySkill!.game, f.mySkill!.variant)))}</span>`;
    else if (open) {
      const o = f.openHere!;
      html = o.opts.map((x) => `<span class="jb-pk"><kbd>${x.key}</kbd><span>${esc(o.kind === 'choice' ? tOr('jb.key.' + x.task, 'jb.taskCap.any') : tOr('jb.taskCap.' + x.task, 'jb.taskCap.any'))}</span></span>`).join('');
    }
    if (html && this.promptEl.innerHTML !== html) this.promptEl.innerHTML = html;
  }

  /** The last 20 s of a task, a choice at a place, or a wait for the crew: say that the dice (or the job) go on without them. */
  private drawDice(f: HudFrame) {
    const R = f.p.run;
    let until = 0,
      key = 'jb.dice';
    if (R.skill && !f.gameOpen) until = R.skill.until ?? f.p.deadline;
    else if (R.choice) until = R.choice.until ?? f.p.deadline;
    else if (R.waitAt) {
      until = R.waitAt.until;
      key = 'jb.goOn';
    }
    const left = until ? until - f.hostNow : Infinity;
    const on = left <= 20000 && left > -1000;
    this.diceEl.classList.toggle('hidden', !on);
    if (on) {
      const sec = Math.max(0, Math.ceil(left / 1000));
      this.setText(this.diceEl, t(key, { t: `0:${String(sec).padStart(2, '0')}` }));
    }
  }

  private drawMarker(f: HudFrame) {
    const a = f.anchor;
    const pl = f.player;
    if (this.mk.parent !== this.d.camera.parent) this.d.camera.parent?.add(this.mk);
    if (!a || !pl) {
      this.mk.visible = false;
      this.edge.classList.add('hidden');
      return;
    }
    const dist = Math.hypot(pl.position.x - a.x, pl.position.z - a.z);
    const fade = clamp((dist - FADE_NEAR) / (FADE_FAR - FADE_NEAR), 0, 1);
    this.mk.visible = fade > 0.01;
    this.mk.position.set(a.x, a.y, a.z);
    const cam = this.d.camera;
    cam.getWorldPosition(this.v);
    this.beam.rotation.y = Math.atan2(this.v.x - a.x, this.v.z - a.z);
    const tm = performance.now() / 1000;
    this.gem.rotation.y = tm * 1.2;
    // about the same size on screen near and far
    const k = clamp(dist * 0.07, 0.7, 3.5);
    this.gem.scale.set(k, 1.5 * k, k);
    this.gem.position.y = 2.3 + (k - 1) * 0.5 + Math.sin(tm * 2) * 0.08;
    this.beam.scale.set(clamp(dist * 0.06, 0.6, 3), 1, 1);
    const task = !!f.mySkill;
    this.gemMat.color.setHex(task ? 0xffe08a : 0xffcf5a);
    this.beamMat.opacity = fade * (task ? 1 : 0.85);
    this.gemMat.opacity = 0.95 * fade;
    // edge arrow when the place is off-screen
    this.v.set(a.x, a.y + 1.4, a.z).applyMatrix4(cam.matrixWorldInverse);
    const behind = this.v.z > 0;
    let nx = 0,
      ny = 0;
    if (!behind) {
      this.v.applyMatrix4((cam as THREE.PerspectiveCamera).projectionMatrix);
      nx = this.v.x;
      ny = this.v.y;
    }
    const off = fade > 0.01 && (behind || Math.abs(nx) > 0.92 || Math.abs(ny) > 0.92);
    this.edge.classList.toggle('hidden', !off);
    if (!off) return;
    // direction on screen (behind: to the side the target is on)
    this.v.set(a.x, a.y + 1.4, a.z).applyMatrix4(cam.matrixWorldInverse);
    let dx = this.v.x,
      dy = this.v.y;
    if (behind) {
      dy = -Math.abs(dy) * 0.2;
      if (Math.abs(dx) < 0.3) dx = dx < 0 ? -1 : 1;
    }
    const ang = Math.atan2(dy, dx);
    const x = 50 + Math.cos(ang) * 44;
    const y = 50 - Math.sin(ang) * 40;
    this.edge.style.left = x + '%';
    this.edge.style.top = y + '%';
    this.edge.style.transform = `translate(-50%,-50%) rotate(${90 - (ang * 180) / Math.PI}deg)`;
  }

  private drawLog(p: any, ctx: ReturnType<JobHud['ctx']>) {
    const R = p.run;
    const key = [p.job, R.beats.length, R.beats.reduce((s: number, b: any) => s + b.lines.length, 0), this.lang()].join('|');
    if (key === this.logKey) return;
    this.logKey = key;
    let h = `<div class="jb-lt">${esc(t('jb.logTitle'))}</div><div class="jb-lb">`;
    for (const b of R.beats) {
      h += `<div class="jb-lbeat"><h4>${esc(tx(b.title, ctx))}</h4>`;
      for (const l of b.lines) {
        const q = this.lineText(l, ctx, null);
        h += `<div class="jb-ll ${q.cls}">${esc(q.text)}</div>`;
      }
      h += '</div>';
    }
    h += `</div><div class="jb-lf">${esc(t('jb.rescue'))}</div>`;
    this.log.innerHTML = h;
    const lb = this.log.querySelector('.jb-lb') as HTMLElement | null;
    if (lb) lb.scrollTop = lb.scrollHeight;
  }

  hide() {
    if (!this.shown && this.mk.visible === false) return;
    this.shown = false;
    this.top.classList.add('hidden');
    this.meters.classList.add('hidden');
    this.pop.classList.add('hidden');
    this.promptEl.classList.add('hidden');
    this.diceEl.classList.add('hidden');
    this.toastEl.classList.add('hidden');
    this.toastLeft = 0;
    this.edge.classList.add('hidden');
    this.rescueEl.classList.add('hidden');
    this.intro.classList.add('hidden');
    this.introLeft = 0;
    this.setLog(false);
    this.popKind = null;
    this.popKey = '';
    this.mk.visible = false;
    this.d.root.classList.remove('jb-run');
  }

  isShown() {
    return this.shown;
  }

  debug() {
    return {
      obj: this.objText.textContent ?? '',
      dist: this.objDist.textContent ?? '',
      sub: this.objSub.textContent ?? '',
      event: this.event.textContent ?? '',
      eventCls: this.event.className,
      popup: this.popKind,
      popText: this.popKind ? (this.pop.textContent ?? '') : '',
      offerStep: this.offerStep,
      prompt: !this.promptEl.classList.contains('hidden'),
      dice: this.diceEl.classList.contains('hidden') ? '' : (this.diceEl.textContent ?? ''),
      toast: this.toastEl.classList.contains('hidden') ? '' : (this.toastEl.textContent ?? ''),
      promptText: this.promptEl.textContent ?? '',
      intro: !this.intro.classList.contains('hidden'),
      introCount: this.introCount,
      log: this.logOpen,
      logText: this.logOpen ? (this.log.textContent ?? '') : '',
      edge: !this.edge.classList.contains('hidden'),
      marker3d: this.mk.visible,
      alarm: !this.alarm.classList.contains('hidden'),
      rescue: !this.rescueEl.classList.contains('hidden'),
      rescueHeld: this.rescueHeld,
      text: (this.meters.textContent ?? '') + ' | ' + (this.top.textContent ?? ''),
    };
  }
}
