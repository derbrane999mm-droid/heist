// Connection settings: built-in defaults, an optional `net.json` next to index.html (no rebuild needed)
// and URL parameters for quick tests. Used by the data channels (session.ts), the voice mesh (voice.ts
// shares the session's Peer, so it gets the same signalling server and ICE servers) and the connection
// check (diag.ts).
//
//   net.json   { "iceServers": [...], "replaceDefaults": false, "peer": { "host", "port", "path", "secure", "key" } }
//   ?turn=<url>&turnuser=<u>&turnpass=<p>   adds one TURN server
//   ?relay=1                                forces iceTransportPolicy 'relay' (proves a relay really works)
//   ?signal=local[&sigport=9000]            test signalling server on 127.0.0.1 (automated tests)
import type { PeerOptions } from 'peerjs';

/** Built-in STUN servers. A TURN relay is added through net.json or ?turn= (see docs/NETWORK.md). */
export const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // No relay by default: PeerJS's shared public relay (eu-0/us-0.turn.peerjs.com) no longer resolves
  // (checked 2026-11-14). A relay has to come from public/net.json.
];

export interface PeerServerConfig {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
  key?: string;
}

interface Loaded {
  iceServers: RTCIceServer[];
  replaceDefaults: boolean;
  peer: PeerServerConfig | null;
}

let loaded: Loaded = { iceServers: [], replaceDefaults: false, peer: null };

const ICE_URL = /^(stun|stuns|turn|turns):[^\s]+$/i;

/** Keep only well-formed ICE server entries; anything else is dropped silently. */
export function cleanIceServers(raw: unknown): RTCIceServer[] {
  if (!Array.isArray(raw)) return [];
  const out: RTCIceServer[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const urls = (e as any).urls;
    const list = (Array.isArray(urls) ? urls : [urls]).filter((u) => typeof u === 'string' && ICE_URL.test(u.trim())).map((u: string) => u.trim());
    if (!list.length) continue;
    const s: RTCIceServer = { urls: list.length === 1 ? list[0] : list };
    if (typeof (e as any).username === 'string') s.username = (e as any).username;
    if (typeof (e as any).credential === 'string') s.credential = (e as any).credential;
    out.push(s);
  }
  return out;
}

export function cleanPeer(raw: unknown): PeerServerConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const p: PeerServerConfig = {};
  if (typeof r.host === 'string' && r.host.trim()) p.host = r.host.trim();
  if (typeof r.port === 'number' && r.port > 0 && r.port < 65536) p.port = Math.floor(r.port);
  if (typeof r.path === 'string' && r.path.trim()) p.path = r.path.trim();
  if (typeof r.secure === 'boolean') p.secure = r.secure;
  if (typeof r.key === 'string' && r.key.trim()) p.key = r.key.trim();
  return p.host ? p : null; // without a host the entry means nothing
}

/** Parse the content of net.json. Never throws; invalid input gives defaults. */
export function parseNetConfig(text: string): Loaded {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== 'object') throw 0;
    return { iceServers: cleanIceServers(j.iceServers), replaceDefaults: j.replaceDefaults === true, peer: cleanPeer(j.peer) };
  } catch {
    return { iceServers: [], replaceDefaults: false, peer: null };
  }
}

/** Fetch `${BASE_URL}net.json` once at boot. Missing, slow or invalid means defaults, never an error. */
export async function loadNetConfig(): Promise<void> {
  try {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 3000);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}net.json`, { cache: 'no-store', signal: ctl.signal });
      if (res.ok) loaded = parseNetConfig(await res.text());
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* defaults */
  }
}

function query(): URLSearchParams {
  return new URLSearchParams(location.search);
}

export function isLocalSignal(): boolean {
  return query().get('signal') === 'local';
}

/** Servers from net.json and ?turn=, without the built-in ones. */
function extraIce(): RTCIceServer[] {
  const out = [...loaded.iceServers];
  const q = query();
  const turn = q.get('turn');
  if (turn) {
    const s = cleanIceServers([{ urls: turn, username: q.get('turnuser') ?? undefined, credential: q.get('turnpass') ?? undefined }]);
    out.push(...s);
  }
  return out;
}

/** Every ICE server the game uses. The local test mode uses none of the public ones. */
export function iceServers(): RTCIceServer[] {
  const extra = extraIce();
  if (isLocalSignal()) return extra;
  return loaded.replaceDefaults && extra.length ? extra : [...DEFAULT_ICE, ...extra];
}

export function relayForced(): boolean {
  return query().get('relay') === '1';
}

/** The RTCConfiguration for every peer connection (data and voice). */
export function rtcConfig(): RTCConfiguration {
  const c: RTCConfiguration = { iceServers: iceServers() };
  if (relayForced()) c.iceTransportPolicy = 'relay';
  return c;
}

export function hasRelay(): boolean {
  return iceServers().some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/i.test(u)));
}

export function signalKind(): 'local' | 'custom' | 'cloud' {
  if (isLocalSignal()) return 'local';
  return loaded.peer ? 'custom' : 'cloud';
}

export function peerOptions(): PeerOptions {
  const q = query();
  const config = rtcConfig();
  if (isLocalSignal()) {
    // automated tests run their own signalling server
    return { host: '127.0.0.1', port: Number(q.get('sigport') || 9000), path: '/', secure: false, debug: 0, config };
  }
  const o: PeerOptions = { debug: 0, config };
  if (loaded.peer) Object.assign(o, loaded.peer);
  return o;
}
