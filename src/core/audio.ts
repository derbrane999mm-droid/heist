// Fully procedural audio: every sound is synthesised with Web Audio, so the
// game ships without a single audio file.
import * as THREE from 'three';
import { settings } from './settings';

export type Sfx =
  | 'step'
  | 'land'
  | 'ui'
  | 'uiHover'
  | 'key'
  | 'deny'
  | 'ok'
  | 'relayOn'
  | 'relayOff'
  | 'powerDown'
  | 'vaultOpen'
  | 'pickup'
  | 'flashlight'
  | 'join'
  | 'leave'
  | 'blackout'
  | 'scrape'
  | 'stinger'
  | 'lightsOn'
  | 'radio';

export interface PlayOpts {
  pos?: THREE.Vector3;
  vol?: number;
  rate?: number;
}

export interface LoopHandle {
  stop(fade?: number): void;
  setVolume(v: number): void;
}

export class AudioEngine {
  ctx!: AudioContext;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  voiceBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private ambienceNodes: AudioNode[] = [];
  private ambienceTimer: number | null = null;
  ready = false;

  /** Must be called from a user gesture (click) the first time. */
  init() {
    if (this.ready) {
      void this.ctx.resume();
      return;
    }
    const Ctx: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain();
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master.connect(limiter).connect(c.destination);

    this.sfxBus = c.createGain();
    this.musicBus = c.createGain();
    this.voiceBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.voiceBus.connect(this.master);

    this.noise = this.makeNoise(2, false);
    this.brown = this.makeNoise(4, true);

    this.reverb = c.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.2, 2.4);
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.32;
    this.sfxBus.connect(this.reverbSend).connect(this.reverb).connect(this.master);

    this.applyVolumes();
    settings.onChange(() => this.applyVolumes());
    this.ready = true;
    void c.resume();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const s = settings.values;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music, t, 0.05);
    this.voiceBus.gain.setTargetAtTime(s.voice * 1.4, t, 0.05);
  }

  private makeNoise(seconds: number, brown: boolean): AudioBuffer {
    const c = this.ctx;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const tt = i / len;
        const w = Math.random() * 2 - 1;
        // darker tail: one-pole lowpass that closes over time
        const a = 0.55 - 0.45 * tt;
        lp = lp + a * (w - lp);
        d[i] = lp * Math.pow(1 - tt, decay) * (i < 400 ? i / 400 : 1);
      }
    }
    return buf;
  }

  setListener(pos: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      (l as any).setPosition(pos.x, pos.y, pos.z);
      (l as any).setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  makePanner(pos?: THREE.Vector3, ref = 2, rolloff = 1.1): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 60;
    if (pos) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    }
    return p;
  }

  /** Output node for a one-shot: either positional or straight to the sfx bus. */
  private out(opts: PlayOpts | undefined, vol: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = vol * (opts?.vol ?? 1);
    if (opts?.pos) g.connect(this.makePanner(opts.pos)).connect(this.sfxBus);
    else g.connect(this.sfxBus);
    return g;
  }

  private tone(
    dest: AudioNode,
    type: OscillatorType,
    f0: number,
    f1: number,
    t0: number,
    dur: number,
    peak: number,
    attack = 0.005,
  ) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private burst(
    dest: AudioNode,
    filter: BiquadFilterType,
    freq: number,
    q: number,
    t0: number,
    dur: number,
    peak: number,
    attack = 0.002,
    freqEnd?: number,
  ) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.02);
  }

  play(name: Sfx, opts?: PlayOpts) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const c = this.ctx;
    const t = c.currentTime + 0.001;
    const r = opts?.rate ?? 1;
    switch (name) {
      case 'step': {
        const o = this.out(opts, 0.16);
        this.burst(o, 'bandpass', (420 + Math.random() * 500) * r, 1.2, t, 0.07, 0.9);
        this.tone(o, 'sine', 95, 55, t, 0.07, 0.6);
        break;
      }
      case 'land': {
        const o = this.out(opts, 0.3);
        this.burst(o, 'lowpass', 500, 0.7, t, 0.14, 1);
        this.tone(o, 'sine', 110, 42, t, 0.16, 0.9);
        break;
      }
      case 'ui': {
        const o = this.out(opts, 0.12);
        this.tone(o, 'triangle', 880, 1320, t, 0.06, 1);
        break;
      }
      case 'uiHover': {
        const o = this.out(opts, 0.05);
        this.tone(o, 'sine', 1500, 1500, t, 0.025, 1);
        break;
      }
      case 'key': {
        const o = this.out(opts, 0.16);
        this.tone(o, 'square', 1180 * r, 1180 * r, t, 0.06, 0.5);
        this.tone(o, 'sine', 2360 * r, 2360 * r, t, 0.05, 0.4);
        this.burst(o, 'highpass', 3000, 0.7, t, 0.015, 0.6);
        break;
      }
      case 'deny': {
        const o = this.out(opts, 0.22);
        this.tone(o, 'sawtooth', 150, 140, t, 0.13, 0.8);
        this.tone(o, 'sawtooth', 150, 130, t + 0.17, 0.2, 0.8);
        break;
      }
      case 'ok': {
        const o = this.out(opts, 0.16);
        this.tone(o, 'sine', 660, 660, t, 0.12, 0.9);
        this.tone(o, 'sine', 880, 880, t + 0.09, 0.12, 0.9);
        this.tone(o, 'sine', 1320, 1320, t + 0.18, 0.3, 0.9);
        break;
      }
      case 'relayOn': {
        const o = this.out(opts, 0.4);
        this.burst(o, 'lowpass', 900, 1, t, 0.09, 1);
        this.tone(o, 'sine', 70, 48, t, 0.2, 1);
        this.tone(o, 'sawtooth', 40, 110, t + 0.05, 0.5, 0.35, 0.2);
        break;
      }
      case 'relayOff': {
        const o = this.out(opts, 0.3);
        this.burst(o, 'lowpass', 700, 1, t, 0.07, 0.9);
        this.tone(o, 'sawtooth', 110, 38, t, 0.4, 0.3);
        break;
      }
      case 'powerDown': {
        const o = this.out(opts, 0.3);
        this.tone(o, 'sawtooth', 420, 36, t, 0.9, 0.5);
        this.tone(o, 'sine', 210, 30, t, 1.0, 0.7);
        break;
      }
      case 'vaultOpen': {
        const o = this.out(opts, 0.55);
        // lock bolts
        for (let i = 0; i < 4; i++) {
          this.burst(o, 'lowpass', 1400, 2, t + i * 0.16, 0.08, 0.9);
          this.tone(o, 'sine', 140, 60, t + i * 0.16, 0.12, 0.8);
        }
        // servo
        const o2 = c.createBiquadFilter();
        o2.type = 'bandpass';
        o2.frequency.value = 600;
        o2.Q.value = 2;
        o2.connect(o);
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, t + 0.7);
        osc.frequency.linearRampToValueAtTime(260, t + 1.3);
        osc.frequency.linearRampToValueAtTime(230, t + 2.6);
        osc.frequency.linearRampToValueAtTime(70, t + 3.1);
        const og = c.createGain();
        og.gain.setValueAtTime(0.0001, t + 0.7);
        og.gain.exponentialRampToValueAtTime(0.5, t + 0.9);
        og.gain.setValueAtTime(0.5, t + 2.7);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 3.15);
        osc.connect(og).connect(o2);
        osc.start(t + 0.7);
        osc.stop(t + 3.2);
        // final clunk
        this.burst(o, 'lowpass', 300, 0.8, t + 3.1, 0.35, 1);
        this.tone(o, 'sine', 62, 34, t + 3.1, 0.5, 1);
        this.tone(o, 'triangle', 523, 520, t + 3.12, 1.2, 0.08);
        break;
      }
      case 'pickup': {
        const o = this.out(opts, 0.16);
        [1318, 1760, 2637, 3520].forEach((f, i) => this.tone(o, 'sine', f, f, t + i * 0.06, 0.5, 0.7));
        break;
      }
      case 'flashlight': {
        const o = this.out(opts, 0.2);
        this.burst(o, 'highpass', 2500, 0.8, t, 0.02, 1);
        this.tone(o, 'square', 320, 300, t, 0.02, 0.3);
        break;
      }
      case 'join': {
        const o = this.out(opts, 0.14);
        this.tone(o, 'triangle', 523, 523, t, 0.1, 0.9);
        this.tone(o, 'triangle', 784, 784, t + 0.1, 0.18, 0.9);
        break;
      }
      case 'leave': {
        const o = this.out(opts, 0.14);
        this.tone(o, 'triangle', 784, 784, t, 0.1, 0.9);
        this.tone(o, 'triangle', 466, 466, t + 0.1, 0.2, 0.9);
        break;
      }
      case 'blackout': {
        const o = this.out(opts, 0.7);
        this.burst(o, 'lowpass', 180, 0.7, t, 0.9, 1, 0.004);
        this.tone(o, 'sine', 58, 26, t, 1.2, 1);
        this.burst(o, 'highpass', 4000, 0.7, t, 0.05, 0.7);
        break;
      }
      case 'scrape': {
        const o = this.out(opts, 0.5);
        for (let i = 0; i < 3; i++) {
          const tt = t + i * 0.28 + Math.random() * 0.05;
          this.burst(o, 'bandpass', 1400 + Math.random() * 900, 9, tt, 0.26, 0.9, 0.03, 2600 + Math.random() * 800);
          this.burst(o, 'bandpass', 380, 4, tt, 0.22, 0.5, 0.02, 240);
        }
        this.tone(o, 'sine', 70, 45, t + 0.8, 0.3, 0.9);
        break;
      }
      case 'stinger': {
        const o = this.out(opts, 0.34);
        [1108, 1175, 1245, 1661, 1760].forEach((f) => {
          this.tone(o, 'sawtooth', f * 0.98, f * 1.03, t, 1.4, 0.16, 0.12);
        });
        this.tone(o, 'sine', 46, 30, t + 0.1, 1.5, 1, 0.02);
        this.burst(o, 'lowpass', 240, 0.7, t + 0.1, 0.6, 0.9);
        break;
      }
      case 'lightsOn': {
        const o = this.out(opts, 0.22);
        for (let i = 0; i < 5; i++) this.burst(o, 'highpass', 5000, 0.8, t + i * 0.07 + Math.random() * 0.03, 0.02, 0.8);
        this.tone(o, 'sawtooth', 100, 100, t + 0.3, 0.5, 0.12, 0.2);
        break;
      }
      case 'radio': {
        const o = this.out(opts, 0.1);
        this.burst(o, 'bandpass', 2200, 1.5, t, 0.09, 1);
        this.tone(o, 'square', 1400, 1400, t + 0.02, 0.05, 0.25);
        break;
      }
    }
  }

  /** Positional electric hum that follows the given object's position. */
  hum(pos: THREE.Vector3, vol = 0.25): LoopHandle {
    if (!this.ready) return { stop() {}, setVolume() {} };
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(vol, c.currentTime, 0.15);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const oscs: OscillatorNode[] = [];
    for (const [f, type, a] of [
      [50, 'sawtooth', 0.6],
      [100.4, 'sawtooth', 0.35],
      [150, 'square', 0.12],
    ] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = a;
      o.connect(og).connect(lp);
      o.start();
      oscs.push(o);
    }
    lp.connect(g).connect(this.makePanner(pos, 1.5, 1.6)).connect(this.sfxBus);
    return {
      stop: (fade = 0.2) => {
        g.gain.setTargetAtTime(0.0001, c.currentTime, fade / 3);
        for (const o of oscs) o.stop(c.currentTime + fade + 0.1);
      },
      setVolume: (v) => g.gain.setTargetAtTime(v, c.currentTime, 0.1),
    };
  }

  /** Low, slow, uneasy room tone plus a sparse pad. */
  startAmbience() {
    if (!this.ready || this.ambienceNodes.length) return;
    const c = this.ctx;
    const t = c.currentTime;
    const bus = c.createGain();
    bus.gain.value = 0.0001;
    bus.gain.exponentialRampToValueAtTime(1, t + 4);
    bus.connect(this.musicBus);
    this.ambienceNodes.push(bus);

    // air handling rumble
    const rumble = c.createBufferSource();
    rumble.buffer = this.brown;
    rumble.loop = true;
    const rlp = c.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 160;
    const rg = c.createGain();
    rg.gain.value = 0.55;
    rumble.connect(rlp).connect(rg).connect(bus);
    rumble.start();
    this.ambienceNodes.push(rumble);

    // vent hiss
    const hiss = c.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    const hbp = c.createBiquadFilter();
    hbp.type = 'bandpass';
    hbp.frequency.value = 2400;
    hbp.Q.value = 0.6;
    const hg = c.createGain();
    hg.gain.value = 0.012;
    hiss.connect(hbp).connect(hg).connect(bus);
    hiss.start();
    this.ambienceNodes.push(hiss);

    // pad: Am(add9) voiced low, saws through a slowly breathing filter
    const padFilter = c.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 420;
    padFilter.Q.value = 0.8;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(padFilter.frequency);
    lfo.start();
    const padGain = c.createGain();
    padGain.gain.value = 0.05;
    padFilter.connect(padGain).connect(bus);
    padGain.connect(this.reverb);
    for (const f of [55, 82.41, 110.3, 123.47, 164.81, 196.2]) {
      for (const det of [-4, 5]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = c.createGain();
        g.gain.value = f < 100 ? 0.5 : 0.22;
        o.connect(g).connect(padFilter);
        o.start();
        this.ambienceNodes.push(o);
      }
    }
    this.ambienceNodes.push(lfo);

    // sparse distant events
    const schedule = () => {
      this.ambienceTimer = window.setTimeout(
        () => {
          if (this.ctx.state === 'running') {
            const tt = this.ctx.currentTime;
            const g = c.createGain();
            g.gain.value = 0.05 + Math.random() * 0.05;
            const pan = c.createStereoPanner();
            pan.pan.value = Math.random() * 2 - 1;
            g.connect(pan).connect(bus);
            g.connect(this.reverb);
            if (Math.random() < 0.5) {
              // pipe knock
              const n = 1 + Math.floor(Math.random() * 3);
              for (let i = 0; i < n; i++) this.tone(g, 'sine', 180 + Math.random() * 60, 120, tt + i * 0.22, 0.25, 0.9);
            } else {
              // metal creak
              this.burst(g, 'bandpass', 500 + Math.random() * 400, 14, tt, 1.1, 0.8, 0.3, 300 + Math.random() * 300);
            }
          }
          schedule();
        },
        14000 + Math.random() * 26000,
      );
    };
    schedule();
  }

  stopAmbience() {
    for (const n of this.ambienceNodes) {
      try {
        if (n instanceof AudioScheduledSourceNode) n.stop();
        n.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.ambienceNodes = [];
    if (this.ambienceTimer !== null) clearTimeout(this.ambienceTimer);
    this.ambienceTimer = null;
  }
}
