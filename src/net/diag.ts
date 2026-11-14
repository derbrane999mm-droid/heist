// Connection check: can this computer play with friends in other homes?
//
//   (a) signalling server reachable (opens a Peer, times it)
//   (b) ICE candidate gathering against the configured servers: host / srflx (public address via STUN) /
//       relay (TURN), IPv6, and a symmetric-NAT hint
//   (c) microphone: permission and live input level
//   (d) WebGL renderer and whether it is software rendering
//
// The report text carries only kinds and counts, never addresses.
import { Peer } from 'peerjs';
import './diag.css';
import { registerStrings, t, onLangChange } from '../core/i18n';
import { iceServers, peerOptions, rtcConfig, relayForced, signalKind } from './netconfig';

export interface IceFindings {
  host: number;
  srflx: number;
  relay: number;
  ipv6: number;
  stun: number; // configured STUN servers
  turn: number; // configured TURN servers
  /** 'yes': two STUN servers saw different public ports for the same socket. */
  symmetric: 'yes' | 'no' | 'unknown';
  gatherMs: number;
  error?: string;
}

export interface DiagResult {
  signal: { ok: boolean; ms: number; kind: 'cloud' | 'custom' | 'local'; error?: string };
  ice: IceFindings;
  mic: { state: 'ok' | 'blocked' | 'none' | 'error'; peak: number };
  gl: { renderer: string; software: boolean; ok: boolean };
  relayForced: boolean;
}

export type StepId = 'signal' | 'ice' | 'mic' | 'gl';
export type StepStatus = 'wait' | 'run' | 'ok' | 'warn' | 'bad';
export interface DiagState {
  steps: Record<StepId, StepStatus>;
  details: Partial<Record<StepId, string>>;
  micLevel: number;
  result: DiagResult | null;
}

export interface Verdict {
  key: string;
  level: 'ok' | 'warn' | 'bad';
  vars?: Record<string, string | number>;
}

// ------------------------------------------------------------------ measurements

function checkSignal(): Promise<DiagResult['signal']> {
  const kind = signalKind();
  return new Promise((resolve) => {
    const t0 = performance.now();
    let done = false;
    let peer: Peer | null = null;
    const finish = (ok: boolean, error?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        peer?.destroy();
      } catch {
        /* ignore */
      }
      resolve({ ok, ms: Math.round(performance.now() - t0), kind, error });
    };
    const timer = window.setTimeout(() => finish(false, 'timeout'), 8000);
    try {
      peer = new Peer(peerOptions());
      peer.on('open', () => finish(true));
      peer.on('error', (e: any) => finish(false, String(e?.type ?? 'error')));
    } catch (e: any) {
      finish(false, String(e?.message ?? 'error'));
    }
  });
}

/** Parse the interesting parts of an ICE candidate line. */
export function parseCandidate(line: string): { type: string; proto: string; addr: string; port: number; baseKey: string } | null {
  const p = line.trim().split(/\s+/);
  const ti = p.indexOf('typ');
  if (p.length < 8 || ti < 0) return null;
  const ri = p.indexOf('raddr');
  const rp = p.indexOf('rport');
  return { type: p[ti + 1], proto: p[2].toLowerCase(), addr: p[4], port: Number(p[5]), baseKey: ri > 0 && rp > 0 ? `${p[ri + 1]}:${p[rp + 1]}` : '' };
}

export function summarizeCandidates(lines: string[], stun: number, turn: number, gatherMs: number): IceFindings {
  const f: IceFindings = { host: 0, srflx: 0, relay: 0, ipv6: 0, stun, turn, symmetric: 'unknown', gatherMs };
  const mapped = new Map<string, Set<number>>(); // base socket -> public ports seen
  for (const line of lines) {
    const c = parseCandidate(line);
    if (!c) continue;
    if (c.type === 'host') f.host++;
    else if (c.type === 'srflx') f.srflx++;
    else if (c.type === 'relay') f.relay++;
    else continue;
    if (c.addr.includes(':') && c.type !== 'relay') f.ipv6++;
    if (c.type === 'srflx' && c.proto === 'udp' && !c.addr.includes(':') && c.baseKey) {
      if (!mapped.has(c.baseKey)) mapped.set(c.baseKey, new Set());
      mapped.get(c.baseKey)!.add(c.port);
    }
  }
  // One socket asked two STUN servers. Chrome reports one candidate per distinct public address: two
  // different ports for the same base mean the router maps by destination (symmetric NAT).
  if ([...mapped.values()].some((s) => s.size > 1)) f.symmetric = 'yes';
  else if (stun >= 2 && mapped.size > 0) f.symmetric = 'no';
  return f;
}

function countServers(): { stun: number; turn: number } {
  let stun = 0;
  let turn = 0;
  for (const s of iceServers()) for (const u of Array.isArray(s.urls) ? s.urls : [s.urls]) /^turns?:/i.test(u) ? turn++ : stun++;
  return { stun, turn };
}

function gatherIce(maxMs = 4000): Promise<IceFindings> {
  const { stun, turn } = countServers();
  return new Promise((resolve) => {
    const t0 = performance.now();
    const lines: string[] = [];
    let pc: RTCPeerConnection | null = null;
    let done = false;
    const finish = (error?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        pc?.close();
      } catch {
        /* ignore */
      }
      const f = summarizeCandidates(lines, stun, turn, Math.round(performance.now() - t0));
      if (error) f.error = error;
      resolve(f);
    };
    const timer = window.setTimeout(() => finish(), maxMs);
    try {
      pc = new RTCPeerConnection(rtcConfig());
      pc.createDataChannel('nd');
      pc.onicecandidate = (e) => {
        if (e.candidate) lines.push(e.candidate.candidate);
        else finish();
      };
      pc.onicegatheringstatechange = () => {
        if (pc?.iceGatheringState === 'complete') finish();
      };
      pc.createOffer()
        .then((o) => pc!.setLocalDescription(o))
        .catch((e) => finish(String(e?.message ?? e)));
    } catch (e: any) {
      finish(String(e?.message ?? e));
    }
  });
}

async function checkMic(onLevel: (l: number) => void, ms = 2500): Promise<DiagResult['mic']> {
  if (!navigator.mediaDevices?.getUserMedia) return { state: 'error', peak: 0 };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  } catch (e: any) {
    const n = String(e?.name ?? '');
    return { state: n === 'NotFoundError' || n === 'OverconstrainedError' ? 'none' : 'blocked', peak: 0 };
  }
  let peak = 0;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      peak = Math.max(peak, rms);
      onLevel(Math.min(1, rms * 4));
      await new Promise((r) => setTimeout(r, 80));
    }
  } catch {
    /* the stream itself works; only the meter failed */
  } finally {
    stream.getTracks().forEach((tr) => tr.stop());
    try {
      void ctx?.close();
    } catch {
      /* ignore */
    }
  }
  return { state: 'ok', peak };
}

function checkGl(): DiagResult['gl'] {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { renderer: '', software: false, ok: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { renderer, software: /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(renderer), ok: true };
  } catch {
    return { renderer: '', software: false, ok: false };
  }
}

// ------------------------------------------------------------------ verdict and report

export function verdicts(r: DiagResult): Verdict[] {
  const v: Verdict[] = [];
  const { ice, signal } = r;
  if (!signal.ok) v.push({ key: 'nd.v.signalDown', level: 'bad' });
  else if (signal.ms > 2500) v.push({ key: 'nd.v.signalSlow', level: 'warn', vars: { ms: signal.ms } });
  if (ice.error) v.push({ key: 'nd.v.iceError', level: 'bad' });
  else if (ice.relay > 0) v.push({ key: 'nd.v.relayOk', level: 'ok' });
  else if (ice.turn > 0) v.push({ key: r.relayForced ? 'nd.v.relayForcedFail' : 'nd.v.relayFail', level: 'bad' });
  else if (ice.stun === 0) v.push({ key: 'nd.v.localOnly', level: 'warn' });
  else if (ice.srflx === 0) v.push({ key: 'nd.v.noStun', level: 'bad' });
  else if (ice.symmetric === 'yes') v.push({ key: 'nd.v.strict', level: 'warn' });
  else v.push({ key: 'nd.v.direct', level: 'ok' });
  if (!ice.error && ice.turn === 0 && ice.stun > 0) v.push({ key: 'nd.v.noRelay', level: 'warn' });
  if (!ice.error && ice.ipv6 > 0) v.push({ key: 'nd.v.ipv6', level: 'ok' });
  if (r.mic.state === 'ok') v.push({ key: r.mic.peak < 0.004 ? 'nd.v.micQuiet' : 'nd.v.micOk', level: r.mic.peak < 0.004 ? 'warn' : 'ok' });
  else if (r.mic.state === 'none') v.push({ key: 'nd.v.micNone', level: 'warn' });
  else v.push({ key: 'nd.v.micBlocked', level: 'bad' });
  if (!r.gl.ok) v.push({ key: 'nd.v.glNone', level: 'bad' });
  else if (r.gl.software) v.push({ key: 'nd.v.glSoft', level: 'warn' });
  return v;
}

/** Short text a friend can paste into a chat. No addresses: only kinds and counts. */
export function report(r: DiagResult): string {
  const sig = t('nd.rep.sig.' + r.signal.kind);
  const lines = [
    t('nd.rep.title'),
    `${t('nd.rep.signal')}: ${r.signal.ok ? `OK, ${r.signal.ms} ms` : t('nd.rep.fail') + (r.signal.error ? ` (${r.signal.error})` : '')} (${sig})`,
    `${t('nd.rep.servers')}: ${r.ice.stun} STUN, ${r.ice.turn} TURN${r.relayForced ? ', relay-only' : ''}`,
    `${t('nd.rep.cands')}: host ${r.ice.host}, srflx ${r.ice.srflx}, relay ${r.ice.relay}, IPv6 ${r.ice.ipv6}`,
    `${t('nd.rep.sym')}: ${t('nd.rep.sym.' + r.ice.symmetric)}`,
    `${t('nd.rep.mic')}: ${r.mic.state}${r.mic.state === 'ok' ? `, ${t('nd.rep.level')} ${Math.round(Math.min(1, r.mic.peak * 4) * 100)} %` : ''}`,
    `WebGL: ${r.gl.ok ? r.gl.renderer.replace(/[0-9a-f]*:[0-9a-f:]+/gi, '') : t('nd.rep.fail')}${r.gl.software ? ' (software)' : ''}`,
    `${t('nd.rep.verdict')}: ${verdicts(r)
      .map((x) => t(x.key, x.vars))
      .join(' | ')}`,
  ];
  return lines.join('\n');
}

// ------------------------------------------------------------------ run

const STEPS: StepId[] = ['signal', 'ice', 'mic', 'gl'];

export function initialState(): DiagState {
  return { steps: { signal: 'wait', ice: 'wait', mic: 'wait', gl: 'wait' }, details: {}, micLevel: 0, result: null };
}

export async function runDiag(update: (s: DiagState) => void): Promise<DiagResult> {
  const st = initialState();
  const push = () => update({ ...st, steps: { ...st.steps }, details: { ...st.details } });
  const set = (id: StepId, status: StepStatus, detail?: string) => {
    st.steps[id] = status;
    if (detail !== undefined) st.details[id] = detail;
    push();
  };
  set('signal', 'run');
  set('ice', 'run');
  const sigP = checkSignal().then((s) => {
    set('signal', s.ok ? (s.ms > 2500 ? 'warn' : 'ok') : 'bad', s.ok ? t('nd.d.signalOk', { ms: s.ms }) : t('nd.d.signalFail'));
    return s;
  });
  const iceP = gatherIce().then((f) => {
    const bad = !!f.error || (f.stun > 0 && f.srflx === 0 && f.relay === 0 && f.turn === 0) || (f.turn > 0 && f.relay === 0);
    set('ice', bad ? 'bad' : f.relay === 0 && (f.symmetric === 'yes' || f.turn === 0) ? 'warn' : 'ok', t('nd.d.ice', { host: f.host, srflx: f.srflx, relay: f.relay }));
    return f;
  });
  const [signal, ice] = await Promise.all([sigP, iceP]);
  set('mic', 'run', t('nd.d.micSpeak'));
  const mic = await checkMic((l) => {
    st.micLevel = l;
    push();
  });
  st.micLevel = 0;
  set('mic', mic.state === 'ok' ? (mic.peak < 0.004 ? 'warn' : 'ok') : mic.state === 'none' ? 'warn' : 'bad', t('nd.d.mic.' + mic.state));
  set('gl', 'run');
  const gl = checkGl();
  set('gl', !gl.ok ? 'bad' : gl.software ? 'warn' : 'ok', gl.ok ? gl.renderer.replace(/^ANGLE \((.*)\)$/, '$1') : t('nd.d.glNone'));
  const result: DiagResult = { signal, ice, mic, gl, relayForced: relayForced() };
  st.result = result;
  push();
  return result;
}

// ------------------------------------------------------------------ panel

type K = Node | string | null | undefined | false;
function el<T extends keyof HTMLElementTagNameMap>(tag: T, cls: string, ...kids: K[]): HTMLElementTagNameMap[T] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k) e.append(k);
  return e;
}

export interface DiagPanel {
  el: HTMLElement;
  start(): void;
}

/** The dialog content: progress list, verdict, copy button. One instance lives as long as the menu. */
export function createDiagPanel(onSound?: () => void): DiagPanel {
  const root = el('div', 'nd-panel');
  let state: DiagState = initialState();
  let running = false;
  let copied = false;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = el('textarea', '');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-999px;top:0';
      document.body.append(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* nothing more to try */
      }
      ta.remove();
    }
    copied = true;
    render();
    window.setTimeout(() => {
      copied = false;
      render();
    }, 2000);
  };

  function render() {
    const steps = el('ul', 'nd-steps');
    for (const id of STEPS) {
      const li = el('li', 'nd-step ' + (state.steps[id] === 'wait' ? '' : state.steps[id]), el('i', 'nd-mark'), el('span', 'nd-label', t('nd.step.' + id)));
      const d = state.details[id];
      if (d) li.append(el('span', 'nd-detail', d));
      if (id === 'mic' && state.steps.mic === 'run') {
        const bar = el('div', 'nd-level', el('i', ''));
        (bar.firstChild as HTMLElement).style.width = `${Math.round(state.micLevel * 100)}%`;
        li.append(bar);
      }
      steps.append(li);
    }
    const verdict = el('div', 'nd-verdict');
    const r = state.result;
    if (r) for (const v of verdicts(r)) verdict.append(el('div', 'nd-v ' + v.level, t(v.key, v.vars)));
    const actions = el('div', 'nd-actions');
    const again = el('button', 'btn ghost', t(running ? 'nd.running' : r ? 'nd.again' : 'nd.start'));
    again.type = 'button';
    again.disabled = running;
    again.addEventListener('click', () => {
      onSound?.();
      start();
    });
    actions.append(again);
    if (r) {
      const c = el('button', 'btn ghost', t(copied ? 'nd.copied' : 'nd.copy'));
      c.type = 'button';
      c.addEventListener('click', () => {
        onSound?.();
        void copy(report(r));
      });
      actions.append(c);
    }
    root.replaceChildren(el('p', 'nd-lede', t('nd.lede')), steps, verdict, actions);
    root.dataset.state = running ? 'running' : r ? 'done' : 'idle';
  }

  function start() {
    if (running) return;
    running = true;
    state = initialState();
    render();
    runDiag((s) => {
      state = s;
      render();
    })
      .then((res) => {
        (window as any).__nvDiag = { result: res, report: report(res), verdicts: verdicts(res) };
      })
      .catch(() => {})
      .finally(() => {
        running = false;
        render();
      });
  }

  onLangChange(render);
  render();
  return { el: root, start };
}

// ------------------------------------------------------------------ texts

registerStrings(
  {
    'nd.open': 'Test connection',
    'nd.title': 'Connection check',
    'nd.lede': 'Checks whether you can play with friends in other homes: matchmaking server, network type, microphone, graphics.',
    'nd.start': 'Start check',
    'nd.again': 'Check again',
    'nd.running': 'Checking…',
    'nd.copy': 'Copy',
    'nd.copied': 'Copied',
    'nd.step.signal': 'Matchmaking server',
    'nd.step.ice': 'Network path',
    'nd.step.mic': 'Microphone',
    'nd.step.gl': 'Graphics',
    'nd.d.signalOk': 'Reachable in {ms} ms',
    'nd.d.signalFail': 'Not reachable',
    'nd.d.ice': 'Found: {host} local, {srflx} public (STUN), {relay} relay',
    'nd.d.micSpeak': 'Say something…',
    'nd.d.mic.ok': 'Works',
    'nd.d.mic.blocked': 'Blocked',
    'nd.d.mic.none': 'No microphone found',
    'nd.d.mic.error': 'Not available in this browser',
    'nd.d.glNone': 'WebGL missing',
    'nd.v.direct': 'Direct connection should work.',
    'nd.v.strict': 'Your network is strict: without a relay it only works if the host has an open network.',
    'nd.v.noStun': 'No public address found (STUN blocked or no internet). Direct connections will probably fail; try another network.',
    'nd.v.noRelay': 'No relay set up.',
    'nd.v.relayOk': 'Relay reachable: connections should work even in strict networks.',
    'nd.v.relayFail': 'A relay is set up but not reachable. Check address and login in net.json.',
    'nd.v.relayForcedFail': 'Relay-only test failed: the relay is not reachable or the login is wrong.',
    'nd.v.localOnly': 'Test mode without public servers: only local addresses were checked.',
    'nd.v.iceError': 'The browser could not gather network addresses (WebRTC blocked?).',
    'nd.v.ipv6': 'IPv6 address found. It helps if your friends have IPv6 too.',
    'nd.v.signalDown': 'Matchmaking server not reachable: nobody can create or join a crew. Check your internet connection.',
    'nd.v.signalSlow': 'Matchmaking server answers slowly ({ms} ms). Joining may take a while.',
    'nd.v.micOk': 'Microphone works.',
    'nd.v.micQuiet': 'Microphone works, but heard nothing. Speak or check that it is not muted.',
    'nd.v.micNone': 'No microphone found. You can still hear the crew.',
    'nd.v.micBlocked': 'Microphone blocked: allow it in the browser (lock icon next to the address).',
    'nd.v.glSoft': 'Software rendering: the game will run slowly. Turn on hardware acceleration in the browser.',
    'nd.v.glNone': 'WebGL is missing: the game cannot run in this browser.',
    'nd.rep.title': 'Connection check',
    'nd.rep.signal': 'Matchmaking',
    'nd.rep.sig.cloud': 'public cloud',
    'nd.rep.sig.custom': 'own server',
    'nd.rep.sig.local': 'test',
    'nd.rep.fail': 'failed',
    'nd.rep.servers': 'ICE servers',
    'nd.rep.cands': 'Candidates',
    'nd.rep.sym': 'Symmetric NAT',
    'nd.rep.sym.yes': 'likely',
    'nd.rep.sym.no': 'no sign',
    'nd.rep.sym.unknown': 'unknown',
    'nd.rep.mic': 'Microphone',
    'nd.rep.level': 'level',
    'nd.rep.verdict': 'Verdict',
    'hud.noVoice': 'no sound',
  },
  {
    'nd.open': 'Verbindung testen',
    'nd.title': 'Verbindungstest',
    'nd.lede': 'Prüft, ob du mit Freunden in anderen Wohnungen spielen kannst: Matchmaking-Server, Netzwerkart, Mikrofon, Grafik.',
    'nd.start': 'Test starten',
    'nd.again': 'Nochmal testen',
    'nd.running': 'Prüfe…',
    'nd.copy': 'Kopieren',
    'nd.copied': 'Kopiert',
    'nd.step.signal': 'Matchmaking-Server',
    'nd.step.ice': 'Netzwerkweg',
    'nd.step.mic': 'Mikrofon',
    'nd.step.gl': 'Grafik',
    'nd.d.signalOk': 'Erreichbar in {ms} ms',
    'nd.d.signalFail': 'Nicht erreichbar',
    'nd.d.ice': 'Gefunden: {host} lokal, {srflx} öffentlich (STUN), {relay} Relay',
    'nd.d.micSpeak': 'Sag etwas…',
    'nd.d.mic.ok': 'Funktioniert',
    'nd.d.mic.blocked': 'Blockiert',
    'nd.d.mic.none': 'Kein Mikrofon gefunden',
    'nd.d.mic.error': 'In diesem Browser nicht verfügbar',
    'nd.d.glNone': 'WebGL fehlt',
    'nd.v.direct': 'Direktverbindung sollte klappen.',
    'nd.v.strict': 'Dein Netz ist streng: ohne Relay klappt es nur, wenn der Host ein offenes Netz hat.',
    'nd.v.noStun': 'Keine öffentliche Adresse gefunden (STUN blockiert oder kein Internet). Direktverbindungen scheitern vermutlich; probier ein anderes Netz.',
    'nd.v.noRelay': 'Kein Relay eingerichtet.',
    'nd.v.relayOk': 'Relay erreichbar: Verbindungen sollten auch in strengen Netzen klappen.',
    'nd.v.relayFail': 'Ein Relay ist eingerichtet, aber nicht erreichbar. Adresse und Zugangsdaten in net.json prüfen.',
    'nd.v.relayForcedFail': 'Relay-Test fehlgeschlagen: Das Relay ist nicht erreichbar oder die Zugangsdaten stimmen nicht.',
    'nd.v.localOnly': 'Testmodus ohne öffentliche Server: Es wurden nur lokale Adressen geprüft.',
    'nd.v.iceError': 'Der Browser konnte keine Netzwerkadressen sammeln (WebRTC blockiert?).',
    'nd.v.ipv6': 'IPv6-Adresse gefunden. Das hilft, wenn deine Freunde auch IPv6 haben.',
    'nd.v.signalDown': 'Matchmaking-Server nicht erreichbar: Niemand kann eine Crew erstellen oder beitreten. Prüfe deine Internetverbindung.',
    'nd.v.signalSlow': 'Matchmaking-Server antwortet langsam ({ms} ms). Das Beitreten kann dauern.',
    'nd.v.micOk': 'Mikrofon funktioniert.',
    'nd.v.micQuiet': 'Mikrofon funktioniert, hat aber nichts gehört. Sprich oder prüfe, ob es stummgeschaltet ist.',
    'nd.v.micNone': 'Kein Mikrofon gefunden. Du hörst die Crew trotzdem.',
    'nd.v.micBlocked': 'Mikrofon blockiert: im Browser erlauben (Schloss-Symbol neben der Adresse).',
    'nd.v.glSoft': 'Software-Rendering: Das Spiel läuft zäh. Hardware-Beschleunigung im Browser einschalten.',
    'nd.v.glNone': 'WebGL fehlt: Das Spiel läuft in diesem Browser nicht.',
    'nd.rep.title': 'Verbindungstest',
    'nd.rep.signal': 'Matchmaking',
    'nd.rep.sig.cloud': 'öffentliche Cloud',
    'nd.rep.sig.custom': 'eigener Server',
    'nd.rep.sig.local': 'Test',
    'nd.rep.fail': 'fehlgeschlagen',
    'nd.rep.servers': 'ICE-Server',
    'nd.rep.cands': 'Kandidaten',
    'nd.rep.sym': 'Symmetrisches NAT',
    'nd.rep.sym.yes': 'wahrscheinlich',
    'nd.rep.sym.no': 'kein Hinweis',
    'nd.rep.sym.unknown': 'unbekannt',
    'nd.rep.mic': 'Mikrofon',
    'nd.rep.level': 'Pegel',
    'nd.rep.verdict': 'Urteil',
    'hud.noVoice': 'kein Ton',
  },
);

