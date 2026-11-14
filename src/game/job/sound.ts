// Sound of the first-person job: two ambience beds (outside / inside, cross-faded by where the listener
// stands), short dry stingers tied to real events of the run, and the footsteps of the other crew members.
// Everything is synthesised (src/core/audio.ts helpers), no files. Nothing here is heard before `audio.ready`.
//
// Sources of events, all of them on every client:
//   - the replicated plan state (`session.get('plan')`): run start, lines of the beats (good / bad / skill
//     result), decisions, alarm known, getaway beat, debrief (job ends);
//   - the guard system's `onEvent` (suspicious / alert), registered once at creation;
//   - the poses of the other players (`session.poseOf`) for footsteps.
// The player's own footsteps, landing and the guards' footsteps are already made by player.ts / guard.ts.
//
// Wiring: `const sound = createJobSound(deps, { guards, anchors })`, then attach(s) / detach() / update(dt, t).
import * as THREE from 'three';
import type { LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Anchors } from '../mech/skill';
import { settings } from '../../core/settings';
import { FLAG_CROUCH } from '../player';

export interface JobSoundOpts {
  /** Is (x, z) inside the building? Default: the Varga auction house. */
  inside?(x: number, z: number): boolean;
  /** The stage's guard system: `suspicious` / `alert` events. Optional. */
  guards?: { onEvent?(cb: (e: { type: string; pid?: string; x?: number; z?: number }) => void): void } | null;
  /** Places of the stage; 'van' is where the engine starts. */
  anchors?: Anchors;
  /** Is anybody (me or a crew member) talking right now? Default: read from the voice chat if it runs. */
  talking?(): boolean;
}

export interface JobSound {
  attach(s: Session): void;
  detach(): void;
  update(dt: number, time: number): void;
  /** Test hook. */
  debug: {
    counts(): Record<string, number>;
    bed(): 'out' | 'in' | 'none';
    alarmLoop(): boolean;
    ducked(): boolean;
    attached(): boolean;
    built(): boolean;
    /** the same code path as a guard event */
    guardEvent(e: { type: string; pid?: string }): void;
    /** run a (synthetic) plan state through the same code path as the replicated one */
    feedPlan(p: unknown): void;
    reset(): void;
  };
}

type Plan = any;

const VARGA_INSIDE = (x: number, z: number) => x > -22 && x < 0 && z > -13.1 && z < 4.9;
const DUCK = 0.6;
const STEP_RANGE = 26;
const STRIDE = 0.78;
const lineKey = (l: any): string => (l?.x?.k ?? l?.roll?.label?.k ?? '') as string;

export function createJobSound(deps: LevelDeps, opts: JobSoundOpts = {}): JobSound {
  const audio = deps.audio;
  const isInside = opts.inside ?? VARGA_INSIDE;
  let session: Session | null = null;
  const counts: Record<string, number> = {};

  // ---------------------------------------------------------------- graph (built once, on first use)
  interface Graph {
    c: AudioContext;
    dry: GainNode; // own sfx-volume bus straight to the master (no reverb)
    amb: GainNode; // all ambience (ducking)
    gOut: GainNode;
    gIn: GainNode;
    alarmGain: GainNode | null;
    alarmLp: BiquadFilterNode | null;
    alarmNodes: AudioScheduledSourceNode[];
    sources: AudioScheduledSourceNode[];
    white: AudioBuffer;
  }
  let g: Graph | null = null;
  let building = false;

  const ready = () => audio.ready && !!audio.ctx && audio.ctx.state === 'running';

  const noiseBuf = (c: AudioContext, seconds: number, brown: boolean) => {
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
  };

  function build(): Graph | null {
    if (g || building || !audio.ready) return g;
    building = true;
    const c = audio.ctx;
    const dry = c.createGain();
    dry.gain.value = settings.values.sfx;
    dry.connect(audio.master);
    const amb = c.createGain();
    amb.gain.value = 0.0001;
    amb.connect(dry);
    const gOut = c.createGain();
    const gIn = c.createGain();
    gOut.gain.value = 0.0001;
    gIn.gain.value = 0.0001;
    gOut.connect(amb);
    gIn.connect(amb);
    const brown = noiseBuf(c, 5, true);
    const white = noiseBuf(c, 2, false);
    const sources: AudioScheduledSourceNode[] = [];
    const src = (buf: AudioBuffer) => {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      sources.push(s);
      return s;
    };
    const osc = (type: OscillatorType, f: number) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      sources.push(o);
      return o;
    };
    const lp = (f: number, q = 0.7) => {
      const n = c.createBiquadFilter();
      n.type = 'lowpass';
      n.frequency.value = f;
      n.Q.value = q;
      return n;
    };
    const bp = (f: number, q: number) => {
      const n = c.createBiquadFilter();
      n.type = 'bandpass';
      n.frequency.value = f;
      n.Q.value = q;
      return n;
    };
    const gain = (v: number) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };

    // OUTSIDE: city hum (brown noise, low), a thin band of wind that swells slowly
    src(brown).connect(lp(150)).connect(gain(0.06)).connect(gOut);
    const wind = gain(0.035); // was 0.5: far too loud as a constant hiss
    src(white).connect(bp(520, 0.6)).connect(wind).connect(gOut);
    const windLfo = osc('sine', 0.07);
    windLfo.connect(gain(0.025)).connect(wind.gain);
    // a very low mains-like tone far away
    osc('sine', 50).connect(gain(0.012)).connect(gOut);

    // INSIDE: room tone, ventilation (two hums and a narrow band of air), nothing else
    src(brown).connect(lp(95)).connect(gain(0.1)).connect(gIn);
    const vent = gain(0.006);
    osc('sine', 118).connect(gain(0.012)).connect(gIn);
    osc('sine', 236.7).connect(gain(0.005)).connect(gIn);
    src(white).connect(bp(640, 5)).connect(vent).connect(gIn);
    const ventLfo = osc('sine', 0.11);
    ventLfo.connect(gain(0.003)).connect(vent.gain);

    for (const s of sources) s.start(c.currentTime);
    g = { c, dry, amb, gOut, gIn, alarmGain: null, alarmLp: null, alarmNodes: [], sources, white };
    building = false;
    return g;
  }

  /** Fade the beds out, stop every source, free the graph (a new attach builds it again). */
  function teardown() {
    const old = g;
    if (!old) return;
    g = null;
    const t = old.c.currentTime;
    old.amb.gain.setTargetAtTime(0.0001, t, 0.12);
    for (const s of old.sources) {
      try {
        s.stop(t + 0.7);
      } catch {
        /* already stopped */
      }
    }
    // one-shots still ringing out keep their bus for a few seconds
    window.setTimeout(() => {
      try {
        old.amb.disconnect();
        old.dry.disconnect();
      } catch {
        /* gone */
      }
    }, 4000);
  }

  // ---------------------------------------------------------------- one-shots
  /** Output of a one-shot: positional (sfx bus) or dry. */
  const outNode = (vol: number, pos?: THREE.Vector3): GainNode => {
    if (pos) return audio.out({ pos }, vol);
    const n = g!.c.createGain();
    n.gain.value = vol;
    n.connect(g!.dry);
    return n;
  };
  const filt = (type: BiquadFilterType, f: number, dest: AudioNode): BiquadFilterNode => {
    const n = g!.c.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.connect(dest);
    return n;
  };

  /** Count and play a one-shot (only once the audio runs and a session is attached). */
  const shot = (name: string, fn: (t: number) => void) => {
    if (!session || !ready() || !build()) return;
    counts[name] = (counts[name] || 0) + 1;
    fn(g!.c.currentTime + 0.01);
  };

  const S = {
    suspicious(mine: boolean) {
      shot('suspicious', (t) => {
        const o = outNode(mine ? 0.34 : 0.22);
        audio.tone(o, 'triangle', 110, 107, t, 0.34, 0.9, 0.01);
        audio.tone(o, 'sine', 55, 53, t, 0.34, 0.8, 0.01);
        audio.tone(o, 'triangle', 82.4, 80, t + 0.3, 0.6, 0.9, 0.01);
        audio.tone(o, 'sine', 41.2, 40, t + 0.3, 0.6, 0.8, 0.01);
      });
    },
    alertHit(inside: boolean) {
      shot('alert', (t) => {
        const o = outNode(inside ? 0.5 : 0.28);
        audio.burst(o, 'lowpass', 280, 0.8, t, 0.4, 1, 0.002);
        audio.tone(o, 'sine', 78, 32, t, 0.7, 1, 0.002);
        const lp = filt('lowpass', 420, o);
        audio.tone(lp, 'sawtooth', 150, 62, t, 0.28, 0.5, 0.002);
        audio.burst(o, 'highpass', 2600, 0.7, t, 0.03, 0.5, 0.001);
      });
    },
    skillOk(game: string) {
      if (game === 'safe') {
        shot('skillSafe', (t) => {
          const o = outNode(0.4);
          audio.burst(o, 'lowpass', 420, 1, t, 0.14, 1, 0.002);
          audio.tone(o, 'sine', 92, 38, t, 0.38, 1, 0.002);
          audio.burst(o, 'bandpass', 1300, 4, t, 0.05, 0.45, 0.001);
          audio.burst(o, 'lowpass', 600, 1, t + 0.19, 0.1, 0.6, 0.002);
          audio.tone(o, 'sine', 120, 55, t + 0.19, 0.2, 0.6, 0.002);
        });
      } else {
        shot('skillLock', (t) => {
          const o = outNode(0.3);
          audio.burst(o, 'lowpass', 1000, 2, t, 0.07, 0.9, 0.001);
          audio.tone(o, 'sine', 160, 72, t, 0.12, 1, 0.001);
          audio.tone(o, 'triangle', 1900, 1500, t, 0.03, 0.18, 0.001);
        });
      }
    },
    taskFail(dice: boolean) {
      shot(dice ? 'taskDice' : 'taskFail', (t) => {
        const o = outNode(0.3);
        audio.burst(o, 'lowpass', 650, 1, t, 0.07, 0.9, 0.001);
        audio.tone(o, 'sine', 190, 78, t, 0.11, 0.9, 0.001);
      });
    },
    badLine() {
      shot('badLine', (t) => {
        const o = outNode(0.22);
        audio.tone(o, 'sine', 72, 44, t, 0.24, 0.9, 0.004);
        audio.burst(o, 'lowpass', 210, 0.8, t, 0.1, 0.7, 0.002);
      });
    },
    goodLine() {
      shot('goodLine', (t) => {
        const o = outNode(0.08);
        audio.tone(o, 'sine', 1400, 1380, t, 0.04, 0.6, 0.002);
        audio.burst(o, 'highpass', 3500, 0.7, t, 0.012, 0.4, 0.001);
      });
    },
    attention() {
      shot('decision', (t) => {
        const o = outNode(0.14);
        audio.tone(o, 'triangle', 740, 740, t, 0.1, 0.9, 0.004);
        audio.tone(o, 'triangle', 988, 988, t + 0.1, 0.16, 0.9, 0.004);
      });
    },
    decisionTick() {
      shot('decisionTick', (t) => {
        const o = outNode(0.06);
        audio.tone(o, 'sine', 1000, 1000, t, 0.03, 0.9, 0.002);
      });
    },
    runStart() {
      shot('runStart', (t) => {
        const o = outNode(0.3);
        const t1 = t + 1.3; // one breath of silence first
        audio.tone(o, 'sine', 55, 52, t1, 2.6, 0.9, 0.06);
        audio.tone(o, 'sine', 110, 104, t1, 2.2, 0.28, 0.06);
      });
    },
    getaway() {
      shot('getaway', (t) => {
        const van = opts.anchors?.van;
        const pos = van ? new THREE.Vector3(van.x, (van.y ?? 0) + 0.6, van.z) : undefined;
        const o = outNode(0.5, pos);
        const lp = filt('lowpass', 300, o);
        for (let i = 0; i < 5; i++) {
          audio.tone(lp, 'sawtooth', 40, 34, t + i * 0.12, 0.1, 0.8, 0.004);
          audio.burst(o, 'lowpass', 320, 1, t + i * 0.12, 0.06, 0.4, 0.002);
        }
        const t2 = t + 0.65;
        audio.burst(o, 'lowpass', 220, 0.8, t2, 0.35, 0.8, 0.02);
        audio.tone(lp, 'sawtooth', 30, 34, t2, 2.8, 0.7, 0.3);
        audio.tone(lp, 'sawtooth', 61, 68, t2, 2.6, 0.22, 0.3);
        audio.tone(o, 'sine', 46, 50, t2, 2.8, 0.5, 0.3);
      });
    },
    ending(good: boolean) {
      shot(good ? 'endGood' : 'endBad', (t) => {
        const o = outNode(0.16);
        if (good) {
          // open fifth, rising: settled, not a fanfare
          audio.tone(o, 'triangle', 196, 196, t, 0.45, 0.9, 0.01);
          audio.tone(o, 'triangle', 261.6, 261.6, t + 0.32, 0.45, 0.8, 0.01);
          audio.tone(o, 'triangle', 392, 392, t + 0.64, 1.3, 0.8, 0.01);
          audio.tone(o, 'sine', 98, 98, t + 0.64, 1.3, 0.7, 0.01);
        } else {
          // falling, dark and short
          audio.tone(o, 'triangle', 220, 218, t, 0.45, 0.9, 0.01);
          audio.tone(o, 'triangle', 164.8, 163, t + 0.38, 0.5, 0.9, 0.01);
          audio.tone(o, 'sine', 110, 103, t + 0.76, 1.4, 1, 0.01);
          audio.tone(o, 'sine', 55, 50, t + 0.76, 1.4, 0.8, 0.01);
        }
      });
    },
    step(pos: THREE.Vector3, loud: number, inside: boolean) {
      if (!session || !ready() || !build()) return;
      counts.crewStep = (counts.crewStep || 0) + 1;
      const t = g!.c.currentTime + 0.005;
      const r = 0.9 + Math.random() * 0.2;
      const o = audio.out({ pos }, 0.11 * loud);
      if (inside) {
        audio.burst(o, 'bandpass', 1500 * r, 1.5, t, 0.05, 0.7, 0.001);
        audio.tone(o, 'sine', 120, 70, t, 0.07, 0.5, 0.002);
        audio.burst(o, 'highpass', 4000, 0.7, t, 0.012, 0.2, 0.001);
      } else {
        audio.burst(o, 'lowpass', 700 * r, 0.8, t, 0.1, 0.6, 0.002);
        audio.burst(o, 'bandpass', 3200, 1, t, 0.035, 0.14, 0.001);
        audio.tone(o, 'sine', 80, 55, t, 0.07, 0.5, 0.002);
      }
    },
  };

  // ---------------------------------------------------------------- alarm loop (inside, muffled)
  let alarmOn = false;
  const startAlarm = () => {
    if (!g || g.alarmGain) return;
    const c = g.c;
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 660;
    const lfo = c.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 0.85;
    const lg = c.createGain();
    lg.gain.value = 170;
    lfo.connect(lg).connect(o.frequency);
    // a second, bell-like partial keeps it from sounding like a plain siren
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 1320;
    const g2 = c.createGain();
    g2.gain.value = 0.25;
    o.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(gain).connect(g!.dry);
    o.start();
    o2.start();
    lfo.start();
    g.alarmGain = gain;
    g.alarmLp = lp;
    g.alarmNodes = [o, o2, lfo];
    mixDirty = true;
  };
  const stopAlarm = () => {
    if (!g || !g.alarmGain) return;
    const c = g.c;
    const gain = g.alarmGain;
    gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.12);
    for (const n of g.alarmNodes) {
      try {
        n.stop(c.currentTime + 0.7);
      } catch {
        /* already stopped */
      }
    }
    const nodes = g.alarmNodes;
    nodes[0].onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* gone */
      }
    };
    g.alarmGain = null;
    g.alarmLp = null;
    g.alarmNodes = [];
  };

  // ---------------------------------------------------------------- mix (beds, duck, alarm level)
  let bedName: 'out' | 'in' | 'none' = 'none';
  let insideNow = false;
  let ducked = false;
  let mixDirty = true;
  let sfxSeen = -1;
  const mix = () => {
    if (!g) return;
    const c = g.c;
    const t = c.currentTime;
    const on = !!session;
    g.gOut.gain.setTargetAtTime(on && !insideNow ? 0.5 : 0.0001, t, 0.7);
    g.gIn.gain.setTargetAtTime(on && insideNow ? 1 : 0.0001, t, 0.7);
    g.amb.gain.setTargetAtTime(on ? (ducked ? DUCK : 1) * (breath ? 0.15 : 1) : 0.0001, t, ducked || breath ? 0.15 : 0.6);
    if (g.alarmGain && g.alarmLp) {
      g.alarmGain.gain.setTargetAtTime(insideNow ? 0.05 : 0.013, t, 0.3);
      g.alarmLp.frequency.setTargetAtTime(insideNow ? 650 : 380, t, 0.3);
    }
    bedName = on ? (insideNow ? 'in' : 'out') : 'none';
  };

  // ambient one-shots
  let nextCar = 14;
  let nextCreak = 9;
  const car = () => {
    shot('car', (t) => {
      const c = g!.c;
      const dur = 5 + Math.random() * 2;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const pan = c.createStereoPanner();
      pan.pan.setValueAtTime(-0.85 * dir, t);
      pan.pan.linearRampToValueAtTime(0.85 * dir, t + dur);
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.5);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      pan.connect(g!.gOut);
      env.connect(pan);
      // engine / road noise: one bandpass that rises and falls with the pass-by
      const s = c.createBufferSource();
      s.buffer = g!.white;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.9;
      f.frequency.setValueAtTime(260, t);
      f.frequency.linearRampToValueAtTime(620, t + dur * 0.5);
      f.frequency.linearRampToValueAtTime(240, t + dur);
      s.connect(f).connect(env);
      s.start(t, Math.random());
      s.stop(t + dur + 0.05);
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(52, t);
      o.frequency.linearRampToValueAtTime(70, t + dur * 0.5);
      o.frequency.linearRampToValueAtTime(48, t + dur);
      const og = c.createGain();
      og.gain.value = 0.18;
      const olp = c.createBiquadFilter();
      olp.type = 'lowpass';
      olp.frequency.value = 220;
      o.connect(olp).connect(og).connect(env);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  };
  const creak = () => {
    shot('creak', (t) => {
      const c = g!.c;
      const pan = c.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      pan.connect(g!.gIn);
      const env = c.createGain();
      env.gain.value = 0.9;
      env.connect(pan);
      if (Math.random() < 0.55) {
        // a tick, like a cooling pipe
        audio.burst(env, 'bandpass', 1800 + Math.random() * 900, 6, t, 0.03, 0.12, 0.001);
        audio.tone(env, 'sine', 640, 560, t, 0.05, 0.05, 0.001);
      } else {
        // a slow creak of wood or metal
        audio.burst(env, 'bandpass', 420 + Math.random() * 300, 12, t, 0.9, 0.1, 0.25, 260 + Math.random() * 200);
      }
    });
  };

  // ---------------------------------------------------------------- plan state -> stingers
  let curJob: unknown = null;
  let lastVersion = -1;
  const seen = new Map<number, number>();
  let lastGame = 'lock';
  let awaiting: string | null = null;
  let awaitT = 0;
  let hadSkill = false;
  let getawayDone = false;
  let endedJob: unknown = null;
  let decKey = '';
  let decDeadline = 0;
  let decTickSec = -1;
  let alertAt = -99;
  let suspiciousAt = -99;
  let breath = false;
  let breathUntil = 0;
  let nowT = 0;
  let curPlan: Plan | null = null;

  const myRole = (p: Plan): string | null => p?.seats?.find((x: any) => x.pid === session?.pid)?.role ?? null;
  const inRun = (p: Plan) => !!p && !!p.run && (p.phase === 'run' || (p.phase === 'offer' && !!p.mid));

  const process = (p: Plan) => {
    const job = p.job ?? 0;
    if (inRun(p)) {
      const R = p.run;
      if (curJob !== job) {
        // a new run: lines already there (late joiner) stay silent
        curJob = job;
        seen.clear();
        for (let i = 0; i < R.beats.length; i++) seen.set(i, R.beats[i].lines.length);
        lastGame = 'lock';
        awaiting = null;
        hadSkill = false;
        getawayDone = R.beats.some((b: any) => b.title?.k === 'bt.getaway');
        decKey = '';
        decDeadline = 0;
        alarmOn = !!R.alarmKnown;
        if (R.beats.length <= 1) {
          S.runStart();
          breath = true;
          breathUntil = nowT + 1.3;
          mixDirty = true;
        }
        if (alarmOn) startAlarm();
      }
      // skill requests: remember which game it is, notice when it ends
      if (R.skill) {
        lastGame = R.skill.game || lastGame;
        hadSkill = true;
      } else if (hadSkill) {
        hadSkill = false;
        awaiting = lastGame;
        awaitT = nowT;
      }
      // new lines of the beats
      let bad = false;
      let good = false;
      for (let i = 0; i < R.beats.length; i++) {
        const lines = R.beats[i].lines;
        const from = seen.get(i) ?? 0;
        for (let k = from; k < lines.length; k++) {
          const l = lines[k];
          const key = lineKey(l);
          if (key === 'ln.skillOk') {
            S.skillOk(awaiting ?? lastGame);
            awaiting = null;
          } else if (key === 'ln.skillNo') {
            S.taskFail(false);
            awaiting = null;
          } else if (awaiting && l.roll) {
            S.taskFail(true); // the dice decided instead of a played check
            awaiting = null;
          } else if (l.kind === 'bad') bad = true;
          else if (l.kind === 'good') good = true;
        }
        seen.set(i, lines.length);
      }
      if (awaiting && nowT - awaitT > 25) awaiting = null;
      if (bad) S.badLine();
      else if (good) S.goodLine();
      // alarm known: hit once (unless a guard's own alert just did it) and loop
      const want = !!R.alarmKnown;
      if (want !== alarmOn) {
        alarmOn = want;
        if (want) {
          if (nowT - alertAt > 3) S.alertHit(insideNow);
          alertAt = nowT;
          if (ready() && build()) startAlarm();
        } else stopAlarm();
      }
      // getaway beat: the engine starts at the van
      if (!getawayDone && R.beats.some((b: any) => b.title?.k === 'bt.getaway')) {
        getawayDone = true;
        S.getaway();
      }
      // my decision pop-up
      const d = R.decision;
      const me = myRole(p);
      const mine = !!d && !!me && d.who === me && !d.bot;
      const key = mine ? `${job}:${R.shown}` : '';
      if (key !== decKey) {
        decKey = key;
        decTickSec = -1;
        if (mine) S.attention();
      }
      decDeadline = mine ? Number(p.deadline) || 0 : 0;
    } else {
      decKey = '';
      decDeadline = 0;
      if (alarmOn) {
        alarmOn = false;
        stopAlarm();
      }
      if (p.phase === 'debrief' && p.result && curJob === job && endedJob !== job) {
        endedJob = job;
        S.ending(!!p.result.success);
      }
    }
  };

  const onGuard = (e: { type: string; pid?: string }) => {
    if (!session || !ready() || !build()) return;
    const p = curPlan;
    if (!inRun(p)) return;
    if (e.type === 'suspicious') {
      if (nowT - suspiciousAt < 2.5 || !insideNow) return;
      suspiciousAt = nowT;
      S.suspicious(e.pid === session.pid);
    } else if (e.type === 'alert') {
      if (nowT - alertAt < 3) return;
      alertAt = nowT;
      S.alertHit(insideNow);
    }
  };
  opts.guards?.onEvent?.((e) => onGuard(e));

  // ---------------------------------------------------------------- crew footsteps
  interface Walker {
    x: number;
    z: number;
    acc: number;
    has: boolean;
  }
  const walkers = new Map<string, Walker>();
  const stepPos = new THREE.Vector3();
  const footsteps = (dt: number) => {
    const s = session!;
    const me = deps.player();
    if (!me) return;
    for (const pl of s.players.values()) {
      if (pl.pid === s.pid) continue;
      const pose = s.poseOf(pl.pid);
      if (!pose) continue;
      let w = walkers.get(pl.pid);
      if (!w) {
        w = { x: pose.x, z: pose.z, acc: 0, has: false };
        walkers.set(pl.pid, w);
      }
      const d = Math.hypot(pose.x - w.x, pose.z - w.z);
      w.x = pose.x;
      w.z = pose.z;
      if (!w.has) {
        w.has = true;
        continue;
      }
      if (d > 3 || dt <= 0 || pose.y < -2) {
        w.acc = 0; // teleport
        continue;
      }
      w.acc += d;
      if (w.acc < STRIDE) continue;
      w.acc -= STRIDE;
      if (Math.hypot(pose.x - me.position.x, pose.z - me.position.z) > STEP_RANGE) continue;
      const speed = d / dt;
      const crouch = (pose.flags & FLAG_CROUCH) !== 0;
      stepPos.set(pose.x, pose.y + 0.05, pose.z);
      S.step(stepPos, crouch ? 0.35 : speed > 4.6 ? 1.3 : 1, isInside(pose.x, pose.z));
    }
  };

  // ---------------------------------------------------------------- talking duck
  const defaultTalking = (): boolean => {
    const v = (window as any).__nv?.voice;
    if (!v) return false;
    if (v.speaking) return true;
    const s = session;
    if (s) for (const pl of s.players.values()) if (pl.pid !== s.pid && v.isTalking?.(pl.pid)) return true;
    return false;
  };
  const talking = opts.talking ?? defaultTalking;

  // ---------------------------------------------------------------- per frame
  let slow = 0;
  return {
    attach(s) {
      session = s;
      lastVersion = -1;
      curJob = null;
      endedJob = null;
      curPlan = null;
      walkers.clear();
      mixDirty = true;
    },
    detach() {
      session = null;
      curPlan = null;
      curJob = null;
      alarmOn = false;
      stopAlarm();
      walkers.clear();
      decKey = '';
      decDeadline = 0;
      breath = false;
      mixDirty = true;
      teardown();
      bedName = 'none';
    },
    update(dt, time) {
      nowT = time;
      if (!session || !ready()) return;
      if (!build()) return;
      const c = g!.c;
      // where am I
      const pl = deps.player();
      if (pl) {
        const ins = isInside(pl.position.x, pl.position.z);
        if (ins !== insideNow) {
          insideNow = ins;
          mixDirty = true;
        }
      }
      if (breath && nowT >= breathUntil) {
        breath = false;
        mixDirty = true;
      }
      // sfx volume (own bus)
      if (settings.values.sfx !== sfxSeen) {
        sfxSeen = settings.values.sfx;
        g!.dry.gain.setTargetAtTime(sfxSeen, c.currentTime, 0.05);
      }
      // voice duck, a few times a second
      slow += dt;
      if (slow >= 0.12) {
        slow = 0;
        const tk = talking();
        if (tk !== ducked) {
          ducked = tk;
          mixDirty = true;
        }
      }
      if (mixDirty) {
        mixDirty = false;
        mix();
      }
      // plan state
      const p = session.get<Plan>('plan');
      if (p) curPlan = p;
      if (p && p.v !== lastVersion) {
        lastVersion = p.v;
        process(p);
      }
      // quiet ticks in the last five seconds of my decision
      if (decDeadline > 0) {
        const left = decDeadline - session.hostNow();
        if (left > 0 && left <= 5000) {
          const sec = Math.ceil(left / 1000);
          if (sec !== decTickSec) {
            decTickSec = sec;
            S.decisionTick();
          }
        }
      }
      // ambience events
      nextCar -= dt;
      nextCreak -= dt;
      if (nextCar <= 0) {
        nextCar = 22 + Math.random() * 30;
        if (!insideNow) car();
      }
      if (nextCreak <= 0) {
        nextCreak = 12 + Math.random() * 20;
        if (insideNow) creak();
      }
      footsteps(dt);
    },
    debug: {
      counts: () => ({ ...counts }),
      bed: () => bedName,
      alarmLoop: () => !!g?.alarmGain,
      ducked: () => ducked,
      attached: () => !!session,
      built: () => !!g,
      guardEvent: onGuard,
      feedPlan: (p) => {
        curPlan = p as Plan;
        process(p as Plan);
      },
      reset: () => {
        for (const k of Object.keys(counts)) delete counts[k];
      },
    },
  };
}
