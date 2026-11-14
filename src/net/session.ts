// Crew session: one player hosts and owns the world state; everyone else
// connects to the host peer-to-peer (WebRTC data channels via PeerJS).
//
//  - reliable channel:   hello/welcome, roster, state patches, events, intents
//  - unreliable channel: player poses at 20 Hz (stale packets are dropped)
import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import type { Pose } from '../game/player';

export const PROTOCOL = 1;
const PREFIX = 'nullvault1-';
export const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I/L)

export interface PlayerInfo {
  pid: string;
  name: string;
  color: number;
  peerId: string;
  host: boolean;
}

export type Status = 'online' | 'offline' | 'reconnecting' | 'closed';
export type JoinError = 'not-found' | 'full' | 'version' | 'blocked' | 'no-server' | 'unsupported';

type PoseArr = [number, number, number, number, number, number];

interface Link {
  pid: string;
  peerId: string;
  rel: DataConnection;
  unrel?: DataConnection;
}

/** Extra ICE servers (TURN relay) can be added here once an account exists. */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function peerOptions(): PeerOptions {
  const q = new URLSearchParams(location.search);
  if (q.get('signal') === 'local') {
    // automated tests run their own signalling server
    return { host: '127.0.0.1', port: Number(q.get('sigport') || 9000), path: '/', secure: false, debug: 0, config: { iceServers: [] } };
  }
  return { debug: 0, config: { iceServers: ICE_SERVERS } };
}

export function makeCode(): string {
  let s = '';
  const r = new Uint32Array(5);
  crypto.getRandomValues(r);
  for (let i = 0; i < 5; i++) s += CODE_CHARS[r[i] % CODE_CHARS.length];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
}

function setPath(obj: any, path: string, value: any) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}

function getPath(obj: any, path: string): any {
  let o = obj;
  for (const p of path.split('.')) {
    if (o == null) return undefined;
    o = o[p];
  }
  return o;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const packPose = (p: Pose): PoseArr => [r3(p.x), r3(p.y), r3(p.z), r3(p.yaw), r3(p.pitch), p.flags];
const unpackPose = (a: PoseArr): Pose => ({ x: a[0], y: a[1], z: a[2], yaw: a[3], pitch: a[4], flags: a[5] });

export class Session {
  isHost = false;
  code = '';
  pid: string;
  name: string;
  color: number;
  players = new Map<string, PlayerInfo>();
  /** Replicated world state. Only the host writes (via `set`). */
  state: Record<string, any> = {};
  peer: Peer | null = null;
  status: Status = 'online';
  /** Round-trip time to the host in ms (0 for the host). */
  ping = 0;

  onRoster: ((joined: PlayerInfo | null, left: PlayerInfo | null) => void) | null = null;
  onPose: ((pid: string, pose: Pose) => void) | null = null;
  onStatus: ((s: Status) => void) | null = null;
  private stateListeners = new Set<(path: string, value: any) => void>();
  private eventListeners = new Set<(name: string, args: any) => void>();
  private castListeners = new Set<(name: string, data: any) => void>();
  private privateListeners = new Set<(name: string, args: any) => void>();
  private lastPoses = new Map<string, Pose>();
  private intents = new Map<string, (pid: string, args: any) => void>();

  // host
  private links = new Map<string, Link>();
  private pendingUnrel = new Map<string, DataConnection>();
  private poses = new Map<string, PoseArr>();
  private poseSeq = 0;
  // client
  private rel: DataConnection | null = null;
  private unrel: DataConnection | null = null;
  private lastPoseSeq = -1;
  private clockOffset = 0;
  private bestRtt = Infinity;
  private timers: number[] = [];
  private closed = false;
  private reconnectAttempts = 0;
  private myPose: PoseArr | null = null;

  private constructor(pid: string, name: string, color: number) {
    this.pid = pid;
    this.name = name;
    this.color = color;
  }

  get me(): PlayerInfo {
    return this.players.get(this.pid)!;
  }

  /** Time on the host's clock in ms: use for anything that must expire in sync. */
  hostNow(): number {
    return performance.now() + this.clockOffset;
  }

  // ------------------------------------------------------------------ hosting

  static host(pid: string, name: string, color: number): Promise<Session> {
    const s = new Session(pid, name, color);
    s.isHost = true;
    return new Promise((resolve) => {
      let attempts = 0;
      let settled = false;
      const goOffline = () => {
        if (settled) return;
        settled = true;
        try {
          s.peer?.destroy();
        } catch {
          /* ignore */
        }
        s.peer = null;
        s.status = 'offline';
        s.code = '';
        s.players.set(pid, { pid, name, color, peerId: '', host: true });
        resolve(s);
      };
      const tryOpen = () => {
        attempts++;
        const code = makeCode();
        let peer: Peer;
        try {
          peer = new Peer(PREFIX + code, peerOptions());
        } catch {
          goOffline();
          return;
        }
        s.peer = peer;
        peer.on('open', () => {
          if (settled) return;
          settled = true;
          s.code = code;
          s.players.set(pid, { pid, name, color, peerId: peer.id, host: true });
          s.startHost();
          resolve(s);
        });
        peer.on('error', (err: any) => {
          if (settled) {
            // Runtime errors (e.g. a peer that vanished) are expected: nothing to do.
            return;
          }
          if (err?.type === 'unavailable-id' && attempts < 5) {
            peer.destroy();
            tryOpen();
          } else goOffline();
        });
      };
      tryOpen();
      window.setTimeout(goOffline, 9000);
    });
  }

  private startHost() {
    const peer = this.peer!;
    peer.on('connection', (conn) => this.hostAccept(conn));
    peer.on('disconnected', () => {
      // Lost the matchmaking server: existing links keep working, new joins need it back.
      if (this.closed) return;
      const retry = () => {
        if (this.closed || !this.peer || this.peer.destroyed || !this.peer.disconnected) return;
        try {
          this.peer.reconnect();
        } catch {
          /* ignore */
        }
        this.timers.push(window.setTimeout(retry, 5000));
      };
      this.timers.push(window.setTimeout(retry, 1500));
    });
    this.timers.push(window.setInterval(() => this.hostBroadcastPoses(), 50));
  }

  private hostAccept(conn: DataConnection) {
    const meta = (conn.metadata ?? {}) as { pid?: string };
    const pid = String(meta.pid ?? '');
    if (!pid) {
      conn.close();
      return;
    }
    if (conn.label === 'unrel') {
      const attach = () => {
        const link = this.links.get(pid);
        if (link) link.unrel = conn;
        else this.pendingUnrel.set(pid, conn); // hello has not arrived yet
      };
      if (conn.open) attach();
      else conn.on('open', attach);
      conn.on('data', (d: any) => {
        if (d && d.t === 'p' && Array.isArray(d.a) && this.links.get(pid)?.unrel === conn) {
          this.poses.set(pid, d.a);
          const pose = unpackPose(d.a);
          this.lastPoses.set(pid, pose);
          this.onPose?.(pid, pose);
        }
      });
      return;
    }
    conn.on('data', (d: any) => this.hostMessage(pid, conn, d));
    const drop = () => {
      const link = this.links.get(pid);
      if (!link || link.rel !== conn) return;
      this.links.delete(pid);
      this.pendingUnrel.delete(pid);
      this.poses.delete(pid);
      const left = this.players.get(pid) ?? null;
      this.players.delete(pid);
      this.sendRoster();
      this.onRoster?.(null, left);
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  private hostMessage(pid: string, conn: DataConnection, d: any) {
    if (!d || typeof d.t !== 'string') return;
    switch (d.t) {
      case 'h': {
        if (d.v !== PROTOCOL) {
          conn.send({ t: 'ver' });
          window.setTimeout(() => conn.close(), 300);
          return;
        }
        const existing = this.links.get(pid);
        if (!existing && this.players.size >= MAX_PLAYERS) {
          conn.send({ t: 'full' });
          window.setTimeout(() => conn.close(), 300);
          return;
        }
        if (existing && existing.rel !== conn) {
          // same player reconnecting: swap the link, keep their seat
          const old = existing.rel;
          // the fast channel of the new connection may have opened before this hello
          const carried = existing.unrel && existing.unrel.peer === conn.peer ? existing.unrel : undefined;
          this.links.set(pid, { pid, peerId: conn.peer, rel: conn, unrel: carried });
          try {
            old.close();
          } catch {
            /* ignore */
          }
        } else if (!existing) {
          this.links.set(pid, { pid, peerId: conn.peer, rel: conn });
        }
        const pending = this.pendingUnrel.get(pid);
        if (pending) {
          this.links.get(pid)!.unrel = pending;
          this.pendingUnrel.delete(pid);
        }
        const isNew = !this.players.has(pid);
        const info: PlayerInfo = { pid, name: String(d.name || 'Crew').slice(0, 16), color: Number(d.color) || 0, peerId: conn.peer, host: false };
        this.players.set(pid, info);
        conn.send({ t: 'w', v: PROTOCOL, code: this.code, roster: [...this.players.values()], state: this.state, now: this.hostNow() });
        this.sendRoster();
        this.onRoster?.(isNew ? info : null, null);
        break;
      }
      case 'i': {
        if (!this.links.has(pid)) return;
        this.intents.get(String(d.n))?.(pid, d.a);
        break;
      }
      case 'pg':
        conn.send({ t: 'po', c: d.c, h: this.hostNow() });
        break;
      case 'bye':
        conn.close();
        break;
    }
  }

  private sendRoster() {
    this.hostSendAll({ t: 'r', roster: [...this.players.values()] });
  }

  private hostSendAll(msg: any) {
    for (const link of this.links.values()) {
      if (link.rel.open) {
        try {
          link.rel.send(msg);
        } catch {
          /* link is closing */
        }
      }
    }
  }

  private hostBroadcastPoses() {
    if (!this.links.size) return;
    if (this.myPose) this.poses.set(this.pid, this.myPose);
    const l: [string, PoseArr][] = [...this.poses.entries()];
    const msg = { t: 'ps', s: this.poseSeq++, l };
    for (const link of this.links.values()) {
      const c = link.unrel?.open ? link.unrel : link.rel.open ? link.rel : null;
      if (!c) continue;
      try {
        c.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  // ------------------------------------------------------------------ joining

  static join(codeRaw: string, pid: string, name: string, color: number): Promise<Session> {
    const s = new Session(pid, name, color);
    s.code = codeRaw;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (e: JoinError) => {
        if (settled) return;
        settled = true;
        s.leave();
        reject(e);
      };
      let peer: Peer;
      try {
        peer = new Peer(peerOptions());
      } catch {
        reject('unsupported' as JoinError);
        return;
      }
      s.peer = peer;
      // If the matchmaking server answered but no link opened, the network blocked
      // the peer-to-peer connection (a missing crew is reported within ~5 s).
      let signalOpen = false;
      const timeout = window.setTimeout(() => fail(signalOpen ? 'blocked' : 'no-server'), 20000);
      peer.on('error', (err: any) => {
        if (settled) return;
        if (err?.type === 'peer-unavailable') fail('not-found');
        else if (err?.type === 'browser-incompatible') fail('unsupported');
        else if (!signalOpen && ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err?.type)) fail('no-server');
      });
      peer.on('open', () => {
        signalOpen = true;
        s.clientConnect(
          () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            s.startClient();
            resolve(s);
          },
          (e) => {
            clearTimeout(timeout);
            fail(e);
          },
        );
      });
    });
  }

  private clientConnect(onWelcome: () => void, onFail: (e: JoinError) => void) {
    const peer = this.peer!;
    const hostId = PREFIX + this.code;
    const rel = peer.connect(hostId, { reliable: true, label: 'rel', metadata: { pid: this.pid }, serialization: 'json' });
    const unrel = peer.connect(hostId, { reliable: false, label: 'unrel', metadata: { pid: this.pid }, serialization: 'json' });
    this.rel = rel;
    this.unrel = unrel;
    this.lastPoseSeq = -1;
    let welcomed = false;
    rel.on('open', () => rel.send({ t: 'h', v: PROTOCOL, name: this.name, color: this.color }));
    rel.on('iceStateChanged', (state) => {
      if (!welcomed && state === 'failed') onFail('blocked');
    });
    rel.on('data', (d: any) => {
      if (!d || typeof d.t !== 'string') return;
      switch (d.t) {
        case 'w':
          welcomed = true;
          this.applyRoster(d.roster, true);
          this.state = d.state ?? {};
          this.clockOffset = d.now - performance.now();
          this.bestRtt = Infinity;
          for (const l of this.stateListeners) l('', this.state);
          onWelcome();
          break;
        case 'full':
          onFail('full');
          break;
        case 'ver':
          onFail('version');
          break;
        case 'r':
          this.applyRoster(d.roster, false);
          break;
        case 's':
          for (const [path, value] of d.p as [string, any][]) {
            setPath(this.state, path, value);
            for (const l of this.stateListeners) l(path, value);
          }
          break;
        case 'e':
          for (const l of this.eventListeners) l(d.n, d.a);
          break;
        case 'po': {
          const rtt = performance.now() - d.c;
          this.ping = this.ping ? this.ping * 0.7 + rtt * 0.3 : rtt;
          // the sample with the lowest round trip gives the best clock estimate
          if (rtt <= this.bestRtt * 1.2) {
            this.bestRtt = Math.min(this.bestRtt, rtt);
            this.clockOffset = d.h + rtt / 2 - performance.now();
          }
          break;
        }
        case 'ps':
          this.clientPoses(d);
          break;
        case 'c':
          for (const l of this.castListeners) l(d.n, d.a);
          break;
        case 'pm':
          for (const l of this.privateListeners) l(d.n, d.a);
          break;
      }
    });
    unrel.on('data', (d: any) => {
      if (!d) return;
      if (d.t === 'ps') this.clientPoses(d);
      else if (d.t === 'c') for (const l of this.castListeners) l(d.n, d.a);
    });
    const lost = () => {
      if (this.closed || this.rel !== rel) return;
      if (!welcomed) return; // join() handles its own timeout
      this.beginReconnect();
    };
    rel.on('close', lost);
    rel.on('error', lost);
  }

  private clientPoses(d: { s: number; l: [string, PoseArr][] }) {
    if (d.s <= this.lastPoseSeq) return; // out-of-order packet on the unreliable channel
    this.lastPoseSeq = d.s;
    for (const [pid, arr] of d.l) {
      if (pid === this.pid) continue;
      const pose = unpackPose(arr);
      this.lastPoses.set(pid, pose);
      this.onPose?.(pid, pose);
    }
  }

  private applyRoster(list: PlayerInfo[], initial: boolean) {
    const before = new Map(this.players);
    this.players = new Map(list.map((p) => [p.pid, p]));
    if (initial) {
      this.onRoster?.(null, null);
      return;
    }
    let any = false;
    for (const p of list) {
      if (!before.has(p.pid)) {
        any = true;
        this.onRoster?.(p, null);
      }
    }
    for (const p of before.values()) {
      if (!this.players.has(p.pid)) {
        any = true;
        this.onRoster?.(null, p);
      }
    }
    if (!any) this.onRoster?.(null, null);
  }

  private startClient() {
    const pingNow = () => {
      if (this.rel?.open) {
        try {
          this.rel.send({ t: 'pg', c: performance.now() });
        } catch {
          /* ignore */
        }
      }
    };
    pingNow();
    this.timers.push(window.setInterval(pingNow, 2000));
    this.timers.push(
      window.setInterval(() => {
        if (!this.myPose) return;
        const c = this.unrel?.open ? this.unrel : null;
        if (!c) return;
        try {
          c.send({ t: 'p', a: this.myPose });
        } catch {
          /* ignore */
        }
      }, 50),
    );
  }

  private beginReconnect() {
    if (this.closed || this.status === 'reconnecting') return;
    this.status = 'reconnecting';
    this.reconnectAttempts = 0;
    this.onStatus?.('reconnecting');
    const attempt = () => {
      if (this.closed) return;
      this.reconnectAttempts++;
      if (this.reconnectAttempts > 8) {
        this.status = 'closed';
        this.onStatus?.('closed');
        return;
      }
      let done = false;
      const next = window.setTimeout(() => {
        if (!done) attempt();
      }, 3500);
      this.timers.push(next);
      const go = () => {
        try {
          this.rel?.close();
          this.unrel?.close();
        } catch {
          /* ignore */
        }
        this.clientConnect(
          () => {
            done = true;
            clearTimeout(next);
            this.status = 'online';
            this.onStatus?.('online');
          },
          () => {
            /* full / version on reconnect: let the retry loop run out */
          },
        );
      };
      const peer = this.peer;
      if (!peer || peer.destroyed) {
        try {
          this.peer = new Peer(peerOptions());
          this.peer.on('open', go);
          this.peer.on('error', () => {});
        } catch {
          /* retry on the next tick */
        }
      } else if (peer.disconnected) {
        try {
          peer.reconnect();
        } catch {
          /* ignore */
        }
        peer.once('open', go);
      } else go();
    };
    attempt();
  }

  // ------------------------------------------------------------------ shared API

  /** Host only: change replicated state and tell everyone. */
  set(path: string, value: any) {
    if (!this.isHost) return;
    setPath(this.state, path, value);
    for (const l of this.stateListeners) l(path, value);
    this.hostSendAll({ t: 's', p: [[path, value]] });
  }

  get<T = any>(path: string): T {
    return getPath(this.state, path) as T;
  }

  onState(fn: (path: string, value: any) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  /** Host only: one-shot event for everyone (including the host). */
  emit(name: string, args?: any) {
    if (!this.isHost) return;
    for (const l of this.eventListeners) l(name, args);
    this.hostSendAll({ t: 'e', n: name, a: args });
  }

  onEvent(fn: (name: string, args: any) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /**
   * Host only: one-shot message for one crew member (reliable). Nobody else
   * receives it, so it can carry secrets. Answers go back as intents, which
   * only the host sees.
   */
  sendTo(pid: string, name: string, args?: any) {
    if (!this.isHost) return;
    if (pid === this.pid) {
      for (const l of this.privateListeners) l(name, args);
      return;
    }
    const link = this.links.get(pid);
    if (!link?.rel.open) return;
    try {
      link.rel.send({ t: 'pm', n: name, a: args });
    } catch {
      /* link is closing */
    }
  }

  onPrivate(fn: (name: string, args: any) => void): () => void {
    this.privateListeners.add(fn);
    return () => this.privateListeners.delete(fn);
  }

  /**
   * Host only: fast-changing data for everyone else (enemy positions, vehicle
   * state). Unreliable and unordered: send absolute state, packets may drop.
   */
  cast(name: string, data: any) {
    if (!this.isHost) return;
    const msg = { t: 'c', n: name, a: data };
    for (const link of this.links.values()) {
      const c = link.unrel?.open ? link.unrel : link.rel.open ? link.rel : null;
      if (!c) continue;
      try {
        c.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  onCast(fn: (name: string, data: any) => void): () => void {
    this.castListeners.add(fn);
    return () => this.castListeners.delete(fn);
  }

  /** Ask the host to do something. Runs immediately if we are the host. */
  intent(name: string, args?: any) {
    if (this.isHost) this.intents.get(name)?.(this.pid, args);
    else if (this.rel?.open) {
      try {
        this.rel.send({ t: 'i', n: name, a: args });
      } catch {
        /* dropped while reconnecting */
      }
    }
  }

  handle(name: string, fn: (pid: string, args: any) => void) {
    this.intents.set(name, fn);
  }

  sendPose(pose: Pose) {
    this.myPose = packPose(pose);
    this.lastPoses.set(this.pid, pose);
  }

  /** Latest known pose of any crew member (feet position, yaw, pitch, flags), on every peer. */
  poseOf(pid: string): Pose | undefined {
    return this.players.has(pid) ? this.lastPoses.get(pid) : undefined;
  }

  /** Peer ids of everyone else, for the voice mesh. */
  remotePeers(): { pid: string; peerId: string }[] {
    const out: { pid: string; peerId: string }[] = [];
    for (const p of this.players.values()) if (p.pid !== this.pid && p.peerId) out.push({ pid: p.pid, peerId: p.peerId });
    return out;
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) {
      clearInterval(t);
      clearTimeout(t);
    }
    this.timers = [];
    try {
      if (this.rel?.open) this.rel.send({ t: 'bye' });
    } catch {
      /* ignore */
    }
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
    this.status = 'closed';
  }
}
