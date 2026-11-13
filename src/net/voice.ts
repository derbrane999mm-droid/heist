// Built-in voice chat: a mesh of WebRTC audio calls between all crew members.
//
// Everyone always sends one audio track (silence until the mic is live), so a
// player without a microphone can still hear the crew. Muting and push-to-talk
// are a gain node in front of the outgoing track.
import type { MediaConnection, Peer } from 'peerjs';
import * as THREE from 'three';
import type { AudioEngine } from '../core/audio';
import { settings } from '../core/settings';

interface Remote {
  pid: string;
  peerId: string;
  call: MediaConnection | null;
  el: HTMLAudioElement | null;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  gain: GainNode | null;
  panner: PannerNode | null;
  level: number;
  talking: boolean;
  retryAt: number;
}

export type MicState = 'off' | 'live' | 'muted' | 'ptt';

export class Voice {
  private out: MediaStreamAudioDestinationNode;
  private gate: GainNode;
  private micAnalyser: AnalyserNode;
  private micStream: MediaStream | null = null;
  private remotes = new Map<string, Remote>();
  private buf = new Uint8Array(256);
  private talkHeld = false;
  private mode: 'radio' | 'proximity' = 'radio';
  private disposed = false;
  /** True while the local player is audibly speaking. */
  speaking = false;
  hasMic = false;

  constructor(
    private audio: AudioEngine,
    private peer: Peer,
  ) {
    const c = audio.ctx;
    this.out = c.createMediaStreamDestination();
    this.gate = c.createGain();
    this.gate.gain.value = 0;
    this.gate.connect(this.out);
    this.micAnalyser = c.createAnalyser();
    this.micAnalyser.fftSize = 512;
    // keep the outgoing track alive with digital silence
    const silence = c.createConstantSource();
    silence.offset.value = 0;
    silence.connect(this.out);
    silence.start();

    peer.on('call', (call) => {
      if (this.disposed) return;
      const pid = (call.metadata as { pid?: string } | undefined)?.pid;
      const remote = [...this.remotes.values()].find((r) => r.peerId === call.peer) ?? (pid ? this.remotes.get(pid) : undefined);
      call.answer(this.out.stream);
      if (remote) this.wire(remote, call);
      else {
        // roster update has not arrived yet: park the call until it does
        this.orphanCalls.set(call.peer, call);
      }
    });
    this.unsubSettings = settings.onChange((_s, k) => {
      if (k === 'voice' || k === 'master' || k === 'voiceMode' || k === 'micMuted') this.applyGate();
      if (k === 'voice' || k === 'master') this.applyVolumes();
    });
  }

  private orphanCalls = new Map<string, MediaConnection>();
  private unsubSettings: (() => void) | null = null;

  /** Ask for the microphone. Resolves false if the user or browser refuses. */
  async enableMic(): Promise<boolean> {
    if (this.hasMic) return true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) return false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: false,
      });
      if (this.disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.micStream = stream;
      const src = this.audio.ctx.createMediaStreamSource(stream);
      src.connect(this.gate);
      src.connect(this.micAnalyser);
      this.hasMic = true;
      this.applyGate();
      return true;
    } catch {
      return false;
    }
  }

  micState(): MicState {
    if (!this.hasMic) return 'off';
    if (settings.get('micMuted')) return 'muted';
    if (settings.get('voiceMode') === 'ptt') return 'ptt';
    return 'live';
  }

  setTalkHeld(held: boolean) {
    if (held === this.talkHeld) return;
    this.talkHeld = held;
    this.applyGate();
  }

  private applyGate() {
    const open = this.hasMic && !settings.get('micMuted') && (settings.get('voiceMode') === 'open' || this.talkHeld);
    this.gate.gain.setTargetAtTime(open ? 1 : 0, this.audio.ctx.currentTime, 0.015);
  }

  private gateOpen(): boolean {
    return this.hasMic && !settings.get('micMuted') && (settings.get('voiceMode') === 'open' || this.talkHeld);
  }

  setMode(mode: 'radio' | 'proximity') {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const r of this.remotes.values()) this.route(r);
  }

  /** Keep calls in step with the crew list. The lower peer id places the call. */
  sync(peers: { pid: string; peerId: string }[]) {
    if (this.disposed) return;
    const wanted = new Map(peers.map((p) => [p.pid, p]));
    for (const [pid, r] of this.remotes) {
      const w = wanted.get(pid);
      if (!w || w.peerId !== r.peerId) {
        this.teardown(r);
        this.remotes.delete(pid);
      }
    }
    for (const p of peers) {
      if (this.remotes.has(p.pid)) continue;
      const r: Remote = { pid: p.pid, peerId: p.peerId, call: null, el: null, source: null, analyser: null, gain: null, panner: null, level: 0, talking: false, retryAt: 0 };
      this.remotes.set(p.pid, r);
      const orphan = this.orphanCalls.get(p.peerId);
      if (orphan) {
        this.orphanCalls.delete(p.peerId);
        this.wire(r, orphan);
      } else this.place(r);
    }
  }

  private place(r: Remote) {
    if (this.disposed || r.call || !this.peer || this.peer.destroyed) return;
    if (this.peer.id >= r.peerId) return; // the other side calls us
    try {
      const call = this.peer.call(r.peerId, this.out.stream, { metadata: { pid: '' } });
      if (call) this.wire(r, call);
    } catch {
      r.retryAt = performance.now() + 3000;
    }
  }

  private wire(r: Remote, call: MediaConnection) {
    if (r.call && r.call !== call) {
      try {
        r.call.close();
      } catch {
        /* ignore */
      }
    }
    r.call = call;
    call.on('stream', (stream) => {
      if (this.disposed || r.call !== call) return;
      this.attach(r, stream);
    });
    const lost = () => {
      if (r.call !== call) return;
      r.call = null;
      this.detach(r);
      r.retryAt = performance.now() + 2500;
    };
    call.on('close', lost);
    call.on('error', lost);
  }

  private attach(r: Remote, stream: MediaStream) {
    this.detach(r);
    const c = this.audio.ctx;
    // The <audio> element plays the voice in radio mode (most reliable path for
    // echo cancellation). It must exist even when muted, or Chrome delivers
    // silence to the Web Audio graph used for levels and proximity.
    const el = new Audio();
    el.autoplay = true;
    el.srcObject = stream;
    (el as any).playsInline = true;
    void el.play().catch(() => {});
    r.el = el;
    r.source = c.createMediaStreamSource(stream);
    r.analyser = c.createAnalyser();
    r.analyser.fftSize = 512;
    r.source.connect(r.analyser);
    r.gain = c.createGain();
    r.panner = this.audio.makePanner(undefined, 2.2, 1.4);
    r.source.connect(r.gain);
    r.gain.connect(r.panner).connect(this.audio.voiceBus);
    this.route(r);
  }

  private route(r: Remote) {
    if (!r.el || !r.gain) return;
    const prox = this.mode === 'proximity';
    r.el.muted = prox;
    r.gain.gain.value = prox ? 1 : 0;
    this.applyVolumes();
  }

  private applyVolumes() {
    const v = Math.max(0, Math.min(1, settings.get('voice') * settings.get('master')));
    for (const r of this.remotes.values()) if (r.el) r.el.volume = v;
  }

  private detach(r: Remote) {
    try {
      r.source?.disconnect();
      r.gain?.disconnect();
      r.panner?.disconnect();
    } catch {
      /* ignore */
    }
    if (r.el) {
      r.el.pause();
      r.el.srcObject = null;
    }
    r.el = null;
    r.source = null;
    r.analyser = null;
    r.gain = null;
    r.panner = null;
    r.talking = false;
  }

  private teardown(r: Remote) {
    try {
      r.call?.close();
    } catch {
      /* ignore */
    }
    r.call = null;
    this.detach(r);
  }

  private rms(an: AnalyserNode): number {
    an.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.buf.length);
  }

  isTalking(pid: string): boolean {
    return this.remotes.get(pid)?.talking ?? false;
  }

  setPosition(pid: string, pos: THREE.Vector3) {
    const p = this.remotes.get(pid)?.panner;
    if (!p) return;
    const t = this.audio.ctx.currentTime;
    p.positionX.setTargetAtTime(pos.x, t, 0.03);
    p.positionY.setTargetAtTime(pos.y, t, 0.03);
    p.positionZ.setTargetAtTime(pos.z, t, 0.03);
  }

  /** Call ~10x per second. */
  update() {
    if (this.disposed) return;
    const now = performance.now();
    if (this.hasMic) {
      const level = this.rms(this.micAnalyser);
      this.speaking = this.gateOpen() && level > 0.02;
    } else this.speaking = false;
    for (const r of this.remotes.values()) {
      if (r.analyser) {
        const l = this.rms(r.analyser);
        r.level = r.level * 0.6 + l * 0.4;
        r.talking = r.level > 0.012;
      }
      if (!r.call && r.retryAt && now > r.retryAt) {
        r.retryAt = now + 4000;
        this.place(r);
      }
    }
  }

  connectedCount(): number {
    let n = 0;
    for (const r of this.remotes.values()) if (r.el) n++;
    return n;
  }

  dispose() {
    this.disposed = true;
    this.unsubSettings?.();
    for (const r of this.remotes.values()) this.teardown(r);
    this.remotes.clear();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    try {
      this.gate.disconnect();
    } catch {
      /* ignore */
    }
  }
}
