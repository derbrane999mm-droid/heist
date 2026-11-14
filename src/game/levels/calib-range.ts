// Calibration sample for SHOOTING: the indoor test range of a security
// contractor. Three short lanes in a row, each with a checkpoint:
//
//   A  stealth   reach the console past three patrolling scouts. Being seen
//                does not fail the lane, it just turns loud.
//   B  arcade    start the uplink and hold the ring for about a minute while
//                scouts pour out of the vents.
//   C  tactical  two sentinels and a few scouts guard the door switch.
//
// A crew wipe sends everyone back to the lane's start and counts a fail. On
// completion the host writes `calib.result`. All gunplay lives in
// ../mech/shooting.ts: this file is the room, the stage script and the texts.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import './calib-range.css';
import { Builder, FONT, MONO } from '../build';
import type { Level, LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Collider } from '../../core/physics';
import { registerStrings, t, onLangChange } from '../../core/i18n';
import { h } from '../../ui/ui';
import { createShooting, type Shooting, type SpawnSpec } from '../mech/shooting';
import { clampDiff, wavePlan, waveSize, spawnCount, stars, yawTo } from '../mech/shooting-logic';

registerStrings(
  {
    'rng.obj.s1': 'Lane A: reach the control console at the far end',
    'rng.obj.s1hint': 'Three scouts patrol. The floor shows what they see: stay out of it, crouch to move silently, or shut one down from behind (hold E)',
    'rng.obj.s1loud': 'You have been spotted: fight your way to the console',
    'rng.obj.s2go': 'Lane B: start the uplink at the beacon inside the ring',
    'rng.obj.s2hold': 'Hold the ring: {s} s left',
    'rng.obj.s2in': 'Uplink running. Keep at least one of you inside the ring',
    'rng.obj.s2out': 'Uplink paused: nobody is inside the ring',
    'rng.obj.s3': 'Lane C: take out the sentinels ({n} left), then throw the door switch',
    'rng.obj.s3hint': 'Their front shield swallows your shots. Hit the glowing core at the back, or overload the shield with sustained fire',
    'rng.obj.s3switch': 'Sentinels down. Throw the door switch on the far wall',
    'rng.obj.done': 'Range cleared',
    'rng.prompt.console': 'Shut lane A down',
    'rng.prompt.beacon': 'Start the uplink',
    'rng.prompt.switch': 'Throw the door switch',
    'rng.lock.switch': 'Locked: sentinels still active ({n})',
    'rng.sub.intro': 'CONTROL: Calibration run, three lanes. Lane A: get to the console at the far end. The scouts do not have to notice you.',
    'rng.sub.controls': 'CONTROL: Left mouse fires, R recharges the pistol. Crouched (C) you make no sound.',
    'rng.sub.loud': 'CONTROL: They have seen you. So much for quiet.',
    'rng.sub.s1done': 'CONTROL: Lane A is down. Through the door.',
    'rng.sub.hold': 'CONTROL: Uplink running. Stay inside the ring. They are coming through the vents.',
    'rng.sub.s2done': 'CONTROL: Uplink complete. Lane C has sentinels: do not stand in front of them.',
    'rng.sub.fail': 'CONTROL: Whole crew down. Resetting the lane.',
    'rng.sub.done': 'CONTROL: Range cleared. I have the numbers I need.',
    'rng.card.label': 'Calibration · shooting',
    'rng.card.title': 'Range cleared',
    'rng.card.time': 'Time',
    'rng.card.fails': 'Restarts',
    'rng.card.diff': 'Difficulty',
    'rng.label.a': 'LANE A · SENSOR HALL',
    'rng.label.b': 'LANE B · HOLD POINT',
    'rng.label.c': 'LANE C · VAULT MOCK-UP',
    'rng.label.exit': 'EXIT',
    'rng.label.range': 'CALIBRATION RANGE 03',
    'rng.scr.armed': 'LANE A ARMED',
    'rng.scr.off': 'LANE A OFFLINE',
    'rng.scr.console': 'PATROL CONTROL',
    'rng.scr.uplink': 'UPLINK',
    'rng.scr.standby': 'STANDBY',
    'rng.scr.done': 'COMPLETE',
    'rng.scr.paused': 'PAUSED',
    'rng.scr.locked': 'LOCKED',
    'rng.scr.ready': 'READY',
    'rng.scr.open': 'OPEN',
    'rng.scr.sent': 'SENTINELS ACTIVE: {n}',
    'rng.scr.door': 'EXIT DOOR',
  },
  {
    'rng.obj.s1': 'Bahn A: Erreicht die Steuerkonsole am anderen Ende',
    'rng.obj.s1hint': 'Drei Scouts patrouillieren. Am Boden seht ihr, was sie sehen: Bleibt draußen, schleicht geduckt (lautlos) oder schaltet einen von hinten ab (E halten)',
    'rng.obj.s1loud': 'Ihr seid entdeckt: Kämpft euch zur Konsole durch',
    'rng.obj.s2go': 'Bahn B: Startet den Uplink an der Bake im Ring',
    'rng.obj.s2hold': 'Haltet den Ring: noch {s} s',
    'rng.obj.s2in': 'Uplink läuft. Mindestens einer von euch bleibt im Ring',
    'rng.obj.s2out': 'Uplink pausiert: Niemand steht im Ring',
    'rng.obj.s3': 'Bahn C: Schaltet die Sentinels aus (noch {n}), dann legt den Türschalter um',
    'rng.obj.s3hint': 'Ihr Frontschild schluckt eure Schüsse. Trefft den leuchtenden Kern am Heck oder überlastet den Schild mit Dauerfeuer',
    'rng.obj.s3switch': 'Sentinels erledigt. Legt den Türschalter an der Rückwand um',
    'rng.obj.done': 'Schießbahn geschafft',
    'rng.prompt.console': 'Bahn A abschalten',
    'rng.prompt.beacon': 'Uplink starten',
    'rng.prompt.switch': 'Türschalter umlegen',
    'rng.lock.switch': 'Gesperrt: Sentinels noch aktiv ({n})',
    'rng.sub.intro': 'LEITSTAND: Kalibrierlauf, drei Bahnen. Bahn A: Kommt zur Konsole am anderen Ende. Die Scouts müssen euch dabei nicht bemerken.',
    'rng.sub.controls': 'LEITSTAND: Linke Maustaste schießt, R lädt die Pistole auf. Geduckt (C) seid ihr lautlos.',
    'rng.sub.loud': 'LEITSTAND: Sie haben euch gesehen. Das war’s mit leise.',
    'rng.sub.s1done': 'LEITSTAND: Bahn A ist aus. Durch die Tür.',
    'rng.sub.hold': 'LEITSTAND: Uplink läuft. Bleibt im Ring. Sie kommen durch die Lüftung.',
    'rng.sub.s2done': 'LEITSTAND: Uplink fertig. In Bahn C warten Sentinels: Stellt euch nicht vor sie.',
    'rng.sub.fail': 'LEITSTAND: Die ganze Crew liegt. Ich setze die Bahn zurück.',
    'rng.sub.done': 'LEITSTAND: Schießbahn geschafft. Ich habe die Werte, die ich brauche.',
    'rng.card.label': 'Kalibrierung · Schießen',
    'rng.card.title': 'Schießbahn geschafft',
    'rng.card.time': 'Zeit',
    'rng.card.fails': 'Neustarts',
    'rng.card.diff': 'Stufe',
    'rng.label.a': 'BAHN A · SENSORHALLE',
    'rng.label.b': 'BAHN B · HALTEPUNKT',
    'rng.label.c': 'BAHN C · TRESOR-ATTRAPPE',
    'rng.label.exit': 'AUSGANG',
    'rng.label.range': 'KALIBRIERBAHN 03',
    'rng.scr.armed': 'BAHN A SCHARF',
    'rng.scr.off': 'BAHN A AUS',
    'rng.scr.console': 'PATROUILLEN-STEUERUNG',
    'rng.scr.uplink': 'UPLINK',
    'rng.scr.standby': 'BEREIT',
    'rng.scr.done': 'FERTIG',
    'rng.scr.paused': 'PAUSIERT',
    'rng.scr.locked': 'GESPERRT',
    'rng.scr.ready': 'FREI',
    'rng.scr.open': 'OFFEN',
    'rng.scr.sent': 'SENTINELS AKTIV: {n}',
    'rng.scr.door': 'AUSGANGSTÜR',
  },
);

interface Hold {
  started: boolean;
  /** Someone is inside the ring right now. */
  on: boolean;
  /** Milliseconds held up to `at` (host clock). */
  ms: number;
  at: number;
  total: number;
}

interface Rng {
  /** 1..3 while playing, 4 = finished. */
  stage: number;
  fails: number;
  /** Host clock when the run started. */
  t0: number;
  /** The current lane went loud. */
  loud: boolean;
  hold: Hold;
  /** Sentinels still working in lane C. */
  sent: number;
}

interface CalibResult {
  level: string;
  diff: number;
  timeMs: number;
  fails: number;
  stars: number;
}

const TEAL = 0x35e6d0;
const AMBER = 0xffa23a;
const RED = 0xff3040;
const GREEN = 0x5dff8f;
const WARM = 0xffd9a8;
const COOL = 0xcfe6ff;
const H = 4.6;
const DOOR_H = 2.8;
const PAR_MS = 6 * 60 * 1000;

// lane B: the ring
const ZX = 0;
const ZZ = -3;
const ZONE_R = 4.2;

const CONSOLE = new THREE.Vector3(-4.6, 1.1, 8.75);
const BEACON = new THREE.Vector3(ZX, 1.1, ZZ);
const SWITCH = new THREE.Vector3(2.9, 1.35, -37.8);

const CHECKPOINTS: Record<number, [number, number][]> = {
  1: [[-1.5, 30.4], [0, 30.9], [1.5, 30.4], [0, 29.6]],
  2: [[-0.8, 6.4], [0.8, 6.4], [-0.8, 5.3], [0.8, 5.3]],
  3: [[-0.8, -15.3], [0.8, -15.3], [-0.8, -16.3], [0.8, -16.3]],
};

const VENTS: [number, number, number][] = [
  [-9.3, 3.4, -9],
  [9.3, 3.4, 3],
  [-5, 3.4, -13.3],
  [9.3, 3.4, -9],
  [-9.3, 3.4, 3],
  [5, 3.4, -13.3],
];

export function createCalibRange(deps: LevelDeps): Level {
  const { engine, physics, audio, mats, interactions, ui } = deps;
  const b = new Builder(engine.scene, physics, mats, engine.quality);
  const m = mats;
  const diff = clampDiff(deps.options.diff);
  let session: Session | null = null;
  const unsubs: (() => void)[] = [];
  // replicated state, re-read when it changes (see attach)
  let rngState: Rng | undefined;
  let calibResult: CalibResult | undefined;
  const readState = () => {
    rngState = session?.get<Rng>('rng');
    calibResult = session?.get<CalibResult>('calib.result');
  };
  const st = (): Rng | undefined => rngState;
  const result = (): CalibResult | undefined => calibResult;

  engine.scene.background = new THREE.Color(0x030508);
  engine.scene.fog = new THREE.FogExp2(0x05080d, 0.02);

  // ======================================================================
  // Shell: three rooms in a row, north is -z
  //   A  x -8..8    z   8..32
  //   B  x -10..10  z -14..8
  //   C  x -9..9    z -38..-14
  // ======================================================================
  b.box(m.floor, 21.4, 0.3, 76, 0, -0.15, -5.2, { tile: 4 });
  b.box(m.ceiling, 21.4, 0.3, 76, 0, H + 0.15, -5.2, { tile: 3 });
  b.box(m.concrete, 16.9, H, 0.5, 0, H / 2, 32.25, { tile: 3 });
  for (const sx of [-1, 1]) {
    b.box(m.concrete, 0.5, H, 24.6, sx * 8.25, H / 2, 20.2, { tile: 3 });
    b.box(m.concrete, 0.5, H, 22.5, sx * 10.25, H / 2, -3, { tile: 3 });
    b.box(m.concrete, 0.5, H, 24.6, sx * 9.25, H / 2, -26.2, { tile: 3 });
    // exit corridor behind lane C
    b.box(m.panel, 0.3, H, 4.4, sx * 1.9, H / 2, -40.5, { tile: 2 });
  }
  b.box(m.panel, 4.1, H, 0.3, 0, H / 2, -42.6, { tile: 2 });
  /** A wall across the building with a door opening in the middle. */
  const divider = (z: number) => {
    b.box(m.concrete, 8.9, H, 0.5, -6.05, H / 2, z, { tile: 3 });
    b.box(m.concrete, 8.9, H, 0.5, 6.05, H / 2, z, { tile: 3 });
    b.box(m.concrete, 3.2, H - DOOR_H, 0.5, 0, DOOR_H + (H - DOOR_H) / 2, z, { tile: 3 });
    for (const sx of [-1, 1]) b.box(m.vault, 0.22, DOOR_H, 0.6, sx * 1.71, DOOR_H / 2, z, { tile: 1, round: 0.03, collide: false });
    b.box(m.vault, 3.64, 0.22, 0.6, 0, DOOR_H + 0.11, z, { tile: 1, round: 0.03, collide: false });
    for (const dz of [-0.9, 0.9]) b.box(m.hazard, 3.2, 0.012, 0.5, 0, 0.006, z + dz, { tile: 0.8, collide: false, shadow: false });
  };
  divider(8);
  divider(-14);
  divider(-38);

  // sliding double doors
  interface Door {
    left: THREE.Mesh;
    right: THREE.Mesh;
    col: Collider;
    lamp: THREE.MeshStandardMaterial;
    open: number;
  }
  const doorGeo = new RoundedBoxGeometry(1.6, DOOR_H, 0.16, 2, 0.02);
  const doorTrim = new THREE.BoxGeometry(0.03, DOOR_H - 0.5, 0.17);
  const makeDoor = (z: number): Door => {
    const left = b.mesh(doorGeo, m.vault, -0.8, DOOR_H / 2, z);
    const right = b.mesh(doorGeo, m.vault, 0.8, DOOR_H / 2, z);
    const lamp = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: RED, emissiveIntensity: 3.2, roughness: 0.5 });
    b.trackGlow(lamp);
    // seam lights travel with the panels, a bar above the frame faces both rooms
    b.mesh(doorTrim, lamp, 0.74, 0, 0, left).castShadow = false;
    b.mesh(doorTrim, lamp, -0.74, 0, 0, right).castShadow = false;
    for (const dz of [-0.31, 0.31]) b.mesh(new THREE.BoxGeometry(2.4, 0.05, 0.02), lamp, 0, DOOR_H + 0.11, z + dz).castShadow = false;
    const col = b.collider(0, DOOR_H / 2, z, 3.2, DOOR_H, 0.5);
    return { left, right, col, lamp, open: 0 };
  };
  const doors = [makeDoor(8), makeDoor(-14), makeDoor(-38)];

  // wainscot with a light line along every long wall
  const wainscot = (x: number, z0: number, z1: number, face: number) => {
    const len = Math.abs(z1 - z0);
    const cz = (z0 + z1) / 2;
    b.box(m.panel, 0.06, 1.1, len, x, 0.55, cz, { tile: 2, collide: false });
    b.glowBox(TEAL, 0.02, 0.025, len, x + face * 0.035, 1.12, cz, 2.2);
  };
  wainscot(-7.97, 8.3, 32, 1);
  wainscot(7.97, 8.3, 32, -1);
  wainscot(-9.97, -13.7, 7.7, 1);
  wainscot(9.97, -13.7, 7.7, -1);
  wainscot(-8.97, -37.7, -14.3, 1);
  wainscot(8.97, -37.7, -14.3, -1);

  // ceiling beams and hanging light bars
  for (let z = 29; z > -38; z -= 5.5) b.box(m.darkMetal, 20.4, 0.34, 0.4, 0, H - 0.17, z, { tile: 2, collide: false });
  const lightBar = (x: number, z: number, color: number, intensity: number, alongX = true) => {
    const sx = alongX ? 2.4 : 0.12;
    const sz = alongX ? 0.12 : 2.4;
    b.box(m.black, sx + 0.1, 0.07, sz + 0.08, x, 3.86, z, { collide: false, shadow: false });
    b.glowBox(color, sx, 0.03, sz, x, 3.815, z, intensity);
    for (const d of [-1.05, 1.05]) b.box(m.black, 0.012, H - 3.9, 0.012, x + (alongX ? d : 0), 3.9 + (H - 3.9) / 2, z + (alongX ? 0 : d), { collide: false, shadow: false });
  };
  for (const pipe of [
    [4.2, -7.6, 0.07],
    [4.02, -7.45, 0.045],
  ]) {
    b.addStatic(m.steel, new THREE.CylinderGeometry(pipe[2], pipe[2], 23.4, 12).rotateX(Math.PI / 2).translate(pipe[1], pipe[0], 20));
  }

  // ---------------------------------------------------------------- helpers
  /** Tall partition: blocks sight completely. */
  const partition = (x0: number, x1: number, z: number) => {
    const len = x1 - x0;
    const cx = (x0 + x1) / 2;
    b.box(m.panel, len, 2.6, 0.35, cx, 1.3, z, { tile: 2 });
    b.box(m.darkMetal, len + 0.06, 0.08, 0.43, cx, 2.64, z, { tile: 1, collide: false });
    b.glowBox(TEAL, len - 0.3, 0.02, 0.37, cx, 2.59, z, 1.8);
    b.box(m.darkMetal, len + 0.04, 0.16, 0.41, cx, 0.08, z, { tile: 1, collide: false });
  };
  /** Low cover: crouch behind it. */
  const cover = (x: number, z: number, w: number, d: number, rot = 0) => {
    b.box(m.darkMetal, w, 1.15, d, x, 0.575, z, { rotY: rot, round: 0.04, tile: 1 });
    b.box(m.hazard, w + 0.012, 0.09, d + 0.012, x, 1.03, z, { rotY: rot, tile: 0.5, collide: false });
  };
  const pillar = (x: number, z: number, s: number, color: number) => {
    b.box(m.concrete, s, H, s, x, H / 2, z, { tile: 2 });
    b.box(m.darkMetal, s + 0.12, 0.5, s + 0.12, x, 0.25, z, { tile: 1, round: 0.03, collide: false });
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      b.glowBox(color, dx ? 0.02 : 0.05, 2.0, dx ? 0.05 : 0.02, x + dx * (s / 2 + 0.008), 1.9, z + dz * (s / 2 + 0.008), 2.6);
    }
  };
  const label = (key: string, x: number, y: number, z: number, rotY: number, w = 3.4, color = '#35e6d0') =>
    b.decal(
      w,
      0.34,
      x,
      y,
      z,
      rotY,
      200,
      (ctx, cw, ch) => {
        ctx.fillStyle = color;
        ctx.font = `600 ${ch * 0.62}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t(key), cw / 2, ch / 2, cw - 12);
      },
      1.5,
    );

  // ======================================================================
  // Lane A: sensor hall (stealth)
  // ======================================================================
  partition(-8, -5.2, 26.5);
  partition(-2.6, 2.6, 26.5);
  partition(5.2, 8, 26.5);
  partition(-6.2, -1.2, 21);
  partition(1.2, 6.2, 21);
  partition(-8, -4.6, 14.5);
  partition(-2, 2, 14.5);
  partition(4.6, 8, 14.5);
  // the sensor rack in the middle of the hall
  b.box(m.darkMetal, 4.4, 2.6, 2.4, 0, 1.3, 17.8, { tile: 1.2, round: 0.03 });
  b.box(m.black, 4.44, 0.5, 2.44, 0, 2.2, 17.8, { collide: false, shadow: false });
  for (let i = 0; i < 12; i++) {
    const x = -1.925 + i * 0.35;
    for (const sz of [-1, 1]) {
      b.glowBox(i % 5 === 2 ? AMBER : TEAL, 0.05, 0.9 + (i % 3) * 0.25, 0.012, x, 1.15, 17.8 + sz * 1.207, i % 5 === 2 ? 2.6 : 1.7);
    }
  }
  cover(-0.9, 24.8, 1.8, 0.7);
  cover(4.2, 22.1, 1.4, 0.7);
  cover(-7.1, 24.6, 1.2, 0.8);
  cover(-6.3, 17.9, 0.8, 1.9);
  cover(6.3, 18.6, 0.8, 1.9);
  cover(-5.0, 15.5, 1.4, 0.7);
  cover(1.9, 12.9, 1.6, 0.7);
  cover(6.6, 9.6, 1.4, 0.8);
  cover(-7.1, 11.9, 0.8, 1.4);
  // spawn bay: lockers and a bench
  for (let i = 0; i < 4; i++) {
    b.box(m.darkMetal, 0.9, 2.1, 0.55, -6.9 + i * 0.95, 1.05, 31.7, { tile: 1, round: 0.02 });
    b.glowBox(i === 1 ? AMBER : TEAL, 0.26, 0.035, 0.012, -6.9 + i * 0.95, 1.72, 31.42, 1.6);
  }
  b.box(m.darkMetal, 2.6, 0.45, 0.5, 5.6, 0.225, 31.6, { tile: 1, round: 0.03 });
  b.box(m.plastic, 1.0, 0.7, 1.2, 7.2, 0.35, 29.4, { rotY: 0.2, round: 0.04, tile: 1 });
  // control console (north-west corner, next to the door to lane B)
  b.box(m.darkMetal, 2.2, 0.95, 0.62, CONSOLE.x, 0.475, 8.58, { tile: 1, round: 0.03 });
  b.box(m.black, 2.0, 0.02, 0.44, CONSOLE.x, 0.96, 8.6, { collide: false, shadow: false });
  for (let i = 0; i < 7; i++) b.glowBox(i % 3 === 0 ? AMBER : TEAL, 0.07, 0.012, 0.03, CONSOLE.x - 0.84 + i * 0.28, 0.975, 8.72, 2.4);
  b.box(m.darkMetal, 2.0, 1.06, 0.08, CONSOLE.x, 1.78, 8.3, { tile: 1, round: 0.02, collide: false });
  const consoleScreen = b.screen(1.8, 0.86, CONSOLE.x, 1.78, 8.35, 0, 300, (ctx, w, hh) => {
    const off = (st()?.stage ?? 1) > 1;
    ctx.fillStyle = '#03070b';
    ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = off ? 'rgba(93,255,143,0.05)' : 'rgba(255,48,64,0.05)';
    for (let y = 0; y < hh; y += 6) ctx.fillRect(0, y, w, 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#7f95a3';
    ctx.font = `600 ${hh * 0.11}px ${FONT}`;
    ctx.fillText(t('rng.scr.console'), w * 0.06, hh * 0.2, w * 0.88);
    ctx.fillStyle = off ? '#5dff8f' : '#ff4d5e';
    ctx.font = `700 ${hh * 0.27}px ${FONT}`;
    ctx.fillText(t(off ? 'rng.scr.off' : 'rng.scr.armed'), w * 0.06, hh * 0.56, w * 0.88);
    // three patrol units
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = off ? 'rgba(93,255,143,0.25)' : '#ff4d5e';
      ctx.fillRect(w * 0.06 + i * w * 0.12, hh * 0.72, w * 0.09, hh * 0.12);
    }
    ctx.fillStyle = '#7f95a3';
    ctx.font = `500 ${hh * 0.09}px ${MONO}`;
    ctx.fillText('SCOUT ×3', w * 0.46, hh * 0.82);
  });
  const consoleTarget = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.9, 0.7), new THREE.MeshBasicMaterial({ visible: false }));
  consoleTarget.position.set(CONSOLE.x, 1.3, 8.6);
  b.group.add(consoleTarget);

  // ======================================================================
  // Lane B: hold point (arcade)
  // ======================================================================
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: AMBER, emissiveIntensity: 3, roughness: 0.6 });
  b.trackGlow(ringMat);
  b.mesh(new THREE.TorusGeometry(ZONE_R, 0.04, 6, 96).rotateX(Math.PI / 2), ringMat, ZX, 0.03, ZZ).castShadow = false;
  b.mesh(new THREE.TorusGeometry(ZONE_R - 0.35, 0.012, 6, 96).rotateX(Math.PI / 2), ringMat, ZX, 0.022, ZZ).castShadow = false;
  b.cylinder(m.black, ZONE_R - 0.4, 0.012, ZX, 0.006, ZZ, { segments: 64, collide: false, shadow: false });
  // beacon in the middle
  b.cylinder(m.darkMetal, 0.36, 0.95, ZX, 0.475, ZZ, { radiusTop: 0.26, segments: 28, tile: 1 });
  b.cylinder(m.steel, 0.3, 0.06, ZX, 0.98, ZZ, { segments: 28, tile: 1, collide: false });
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: AMBER, emissiveIntensity: 3.5, roughness: 0.4 });
  b.trackGlow(beaconMat);
  const beaconCore = b.mesh(new THREE.OctahedronGeometry(0.14, 0), beaconMat, ZX, 1.24, ZZ);
  beaconCore.castShadow = false;
  b.mesh(new THREE.TorusGeometry(0.27, 0.012, 6, 32).rotateX(Math.PI / 2), beaconMat, ZX, 1.02, ZZ).castShadow = false;
  const beaconTarget = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.7, 12), new THREE.MeshBasicMaterial({ visible: false }));
  beaconTarget.position.set(ZX, 0.85, ZZ);
  b.group.add(beaconTarget);
  // barricades around the ring, pillars in the corners
  cover(ZX, ZZ - 3.3, 2.6, 0.5);
  cover(ZX, ZZ + 3.3, 2.6, 0.5);
  cover(ZX - 3.3, ZZ, 0.5, 2.6);
  cover(ZX + 3.3, ZZ, 0.5, 2.6);
  cover(-7.2, -10.6, 1.6, 0.7, 0.5);
  cover(7.3, 4.2, 1.6, 0.7, 0.4);
  for (const [px, pz] of [
    [-6.4, -9.4],
    [6.4, -9.4],
    [-6.4, 3.4],
    [6.4, 3.4],
  ]) {
    pillar(px, pz, 0.8, AMBER);
  }
  // vents the scouts come out of
  for (const [vx, vy, vz] of VENTS) {
    const onNorth = Math.abs(vz) > 13;
    const sx = onNorth ? 1.5 : 0.16;
    const sz = onNorth ? 0.16 : 1.5;
    const wx = onNorth ? vx : Math.sign(vx) * 9.92;
    const wz = onNorth ? -13.67 : vz;
    b.box(m.darkMetal, sx + (onNorth ? 0.24 : 0), 1.1, sz + (onNorth ? 0 : 0.24), wx, vy, wz, { tile: 1, round: 0.03, collide: false });
    b.box(m.black, onNorth ? 1.3 : 0.18, 0.86, onNorth ? 0.18 : 1.3, wx + (onNorth ? 0 : -Math.sign(vx) * 0.01), vy, wz + (onNorth ? 0.01 : 0), { collide: false, shadow: false });
    for (let i = 0; i < 4; i++) {
      b.glowBox(RED, onNorth ? 1.2 : 0.02, 0.03, onNorth ? 0.02 : 1.2, wx + (onNorth ? 0 : -Math.sign(vx) * 0.1), vy - 0.3 + i * 0.2, wz + (onNorth ? 0.1 : 0), 2.4);
    }
  }
  // uplink display above the door to lane C
  b.box(m.darkMetal, 4.7, 1.2, 0.1, 0, 3.62, -13.7, { tile: 1, round: 0.03, collide: false });
  const holdScreen = b.screen(4.4, 0.96, 0, 3.62, -13.64, 0, 170, (ctx, w, hh) => {
    const s = st();
    ctx.fillStyle = '#03070b';
    ctx.fillRect(0, 0, w, hh);
    const hold = s?.hold;
    const done = !!s && s.stage > 2;
    const elapsed = !hold ? 0 : done ? hold.total : hold.ms + (hold.on && session ? session.hostNow() - hold.at : 0);
    const frac = hold ? Math.max(0, Math.min(1, elapsed / hold.total)) : 0;
    const left = hold ? Math.max(0, Math.ceil((hold.total - elapsed) / 1000)) : 0;
    const active = !!hold?.started && !done;
    const color = done ? '#5dff8f' : active ? (hold!.on ? '#35e6d0' : '#ffa23a') : '#7f95a3';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7f95a3';
    ctx.font = `600 ${hh * 0.2}px ${FONT}`;
    ctx.fillText(t('rng.scr.uplink'), w * 0.04, hh * 0.26);
    ctx.fillStyle = color;
    ctx.font = `700 ${hh * 0.42}px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(done ? t('rng.scr.done') : active ? (hold!.on ? `${left} s` : t('rng.scr.paused')) : t('rng.scr.standby'), w * 0.96, hh * 0.3, w * 0.62);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(w * 0.04, hh * 0.62, w * 0.92, hh * 0.2);
    ctx.fillStyle = color;
    ctx.fillRect(w * 0.04, hh * 0.62, w * 0.92 * frac, hh * 0.2);
  });

  // ======================================================================
  // Lane C: vault mock-up (tactical)
  // ======================================================================
  // baffle wall that hides the entrance from the room
  b.box(m.panel, 6.4, 2.9, 0.4, 0, 1.45, -17.6, { tile: 2 });
  b.box(m.darkMetal, 6.46, 0.1, 0.48, 0, 2.95, -17.6, { tile: 1, collide: false });
  b.glowBox(COOL, 6.1, 0.02, 0.42, 0, 2.89, -17.6, 1.8);
  cover(-5.6, -21.6, 2.6, 0.5);
  cover(5.6, -21.6, 2.6, 0.5);
  cover(0, -23.8, 3.2, 0.5);
  cover(-2.7, -28.3, 2.4, 0.5);
  cover(2.7, -28.3, 2.4, 0.5);
  cover(-6.9, -26.2, 0.5, 2.4);
  cover(6.9, -26.2, 0.5, 2.4);
  cover(0, -32.2, 2.2, 0.5);
  pillar(-4.2, -25, 0.9, COOL);
  pillar(4.2, -25, 0.9, COOL);
  // the "vault" the sentinels guard: a raised steel frame around the exit
  for (const sx of [-1, 1]) {
    b.box(m.vault, 0.5, 3.4, 0.5, sx * 4.4, 1.7, -37.5, { tile: 1, round: 0.04 });
    b.glowBox(AMBER, 0.03, 3.0, 0.03, sx * 4.4, 1.7, -37.23, 2.6);
  }
  b.box(m.vault, 9.3, 0.4, 0.5, 0, 3.6, -37.5, { tile: 1, round: 0.04, collide: false });
  // door switch: housing, lever, status display
  b.box(m.darkMetal, 0.56, 0.8, 0.16, SWITCH.x, SWITCH.y, -37.67, { tile: 0.6, round: 0.02, collide: false });
  b.box(m.hazard, 0.56, 0.08, 0.165, SWITCH.x, SWITCH.y + 0.44, -37.67, { tile: 0.4, collide: false });
  const lever = new THREE.Group();
  lever.position.set(SWITCH.x, SWITCH.y - 0.05, -37.58);
  b.group.add(lever);
  b.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 10).translate(0, 0.18, 0), m.steel, 0, 0, 0, lever);
  b.mesh(new THREE.CapsuleGeometry(0.034, 0.1, 6, 12).rotateZ(Math.PI / 2).translate(0, 0.38, 0), new THREE.MeshStandardMaterial({ color: 0xb3202c, roughness: 0.5, metalness: 0.1 }), 0, 0, 0, lever);
  b.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 14).rotateZ(Math.PI / 2), m.darkMetal, 0, 0, 0, lever);
  lever.rotation.x = 0.5;
  const switchTarget = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
  switchTarget.position.set(SWITCH.x, SWITCH.y, -37.6);
  b.group.add(switchTarget);
  b.box(m.darkMetal, 1.5, 0.6, 0.06, SWITCH.x + 0.05, 2.25, -37.72, { tile: 1, round: 0.02, collide: false });
  const switchScreen = b.screen(1.36, 0.48, SWITCH.x + 0.05, 2.25, -37.68, 0, 380, (ctx, w, hh) => {
    const s = st();
    ctx.fillStyle = '#03070b';
    ctx.fillRect(0, 0, w, hh);
    const stage = s?.stage ?? 1;
    const open = stage > 3;
    const ready = stage === 3 && s!.sent === 0;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7f95a3';
    ctx.font = `600 ${hh * 0.17}px ${FONT}`;
    ctx.fillText(t('rng.scr.door'), w * 0.06, hh * 0.2, w * 0.88);
    ctx.fillStyle = open ? '#5dff8f' : ready ? '#35e6d0' : '#ff4d5e';
    ctx.font = `700 ${hh * 0.34}px ${FONT}`;
    ctx.fillText(t(open ? 'rng.scr.open' : ready ? 'rng.scr.ready' : 'rng.scr.locked'), w * 0.06, hh * 0.54, w * 0.88);
    if (stage === 3 && !ready) {
      ctx.fillStyle = '#ffa23a';
      ctx.font = `500 ${hh * 0.15}px ${MONO}`;
      ctx.fillText(t('rng.scr.sent', { n: s!.sent }), w * 0.06, hh * 0.84, w * 0.88);
    }
  });
  // exit corridor: bright, so the open door reads from across the room
  b.glowBox(COOL, 0.03, 3.6, 0.06, -1.72, 2.0, -41.4, 6);
  b.glowBox(COOL, 0.03, 3.6, 0.06, 1.72, 2.0, -41.4, 6);
  b.glowBox(TEAL, 3.2, 0.05, 0.03, 0, 3.2, -42.42, 7);
  b.glowBox(COOL, 3.2, 0.03, 0.4, 0, H - 0.02, -40.4, 6);

  // signs
  const labels = [
    label('rng.label.range', 0, 3.3, 31.98, Math.PI, 5.2, '#ffa23a'),
    label('rng.label.a', 0, 3.3, 26.545, 0),
    label('rng.label.b', 0, 3.4, 8.262, 0, 3.4, '#ffa23a'),
    label('rng.label.c', 0, 2.2, -17.39, 0, 3.6, '#cfe6ff'),
    label('rng.label.exit', 0, 3.6, -37.24, 0, 1.6, '#5dff8f'),
  ];
  // the lane A sign hangs above the first partition, facing the spawn bay
  b.box(m.darkMetal, 3.8, 0.5, 0.06, 0, 3.3, 26.5, { collide: false, tile: 1 });
  for (const sx of [-1.7, 1.7]) b.box(m.black, 0.02, H - 3.55, 0.02, sx, 3.55 + (H - 3.55) / 2, 26.5, { collide: false, shadow: false });

  // ======================================================================
  // Lights: 2 shadow spots + 8 points for the whole building
  // ======================================================================
  b.hemisphere(0x8fa6c8, 0x1a1410, 0.36);
  // lane A
  b.spot(COOL, 190, 0, H - 0.1, 23.7, 0, 0, 23.7, { angle: 0.82, penumbra: 0.8, distance: 9.5, shadow: true });
  b.cone(COOL, 0, H - 0.15, 23.7, 3.4, 3.6, 0.04);
  b.point(WARM, 17, 0, 3.3, 29.6, 9.5);
  b.point(AMBER, 11, 5.4, 3.2, 17.6, 9.5);
  b.point(TEAL, 10, -4.2, 2.7, 10.8, 8.5);
  lightBar(0, 29.6, WARM, 5);
  lightBar(-4, 23.7, COOL, 3.2);
  lightBar(4, 23.7, COOL, 3.2);
  lightBar(5.4, 17.6, AMBER, 4, false);
  lightBar(-5.4, 17.6, COOL, 2.4, false);
  lightBar(-4.2, 11.2, TEAL, 4.2);
  lightBar(4.2, 11.2, COOL, 2.6);
  // lane B
  b.spot(WARM, 220, 0, H - 0.1, ZZ, 0, 0, ZZ, { angle: 0.86, penumbra: 0.75, distance: 9.5, shadow: true });
  b.cone(WARM, 0, H - 0.15, ZZ, 3.6, 3.6, 0.045);
  b.point(0xff4030, 12, -7.6, 3.2, ZZ, 11);
  b.point(0xff4030, 12, 7.6, 3.2, ZZ, 11);
  lightBar(0, ZZ - 6.6, AMBER, 4.5);
  lightBar(0, ZZ + 6.6, AMBER, 4.5);
  lightBar(-7.2, ZZ, 0xff5040, 3.4, false);
  lightBar(7.2, ZZ, 0xff5040, 3.4, false);
  // lane C
  b.point(COOL, 12, 0, 3.4, -20.2, 10);
  b.point(COOL, 15, 0, 3.6, -27.2, 11.5);
  b.point(AMBER, 13, 0, 3.1, -35.2, 9.5);
  lightBar(0, -16, COOL, 4);
  lightBar(-4.6, -22.4, COOL, 4);
  lightBar(4.6, -22.4, COOL, 4);
  lightBar(-4.6, -30, COOL, 3.6);
  lightBar(4.6, -30, COOL, 3.6);
  lightBar(0, -35.4, AMBER, 4.6);

  const dustA = b.dust(0, 2.2, 22, 12, 4, 14, 300);
  const dustB = b.dust(0, 2.2, ZZ, 12, 4, 12, 280);
  const dustC = b.dust(0, 2.2, -27, 12, 4, 14, 260);

  b.finalize();
  engine.captureEnvironment(new THREE.Vector3(0.5, 1.7, 23.4), 1.0);

  // ======================================================================
  // Gunplay
  // ======================================================================
  const sh: Shooting = createShooting(deps, { scouts: 12, sentinels: 2, diff, ceiling: 3.5 });

  const stageSpecs = (stage: number): SpawnSpec[] => {
    if (stage === 1) {
      return [
        { type: 'scout', x: 6.4, z: 23.7, yaw: Math.PI / 2, route: [[-6.4, 23.7], [6.4, 23.7]], pause: 2.2, group: 1 },
        { type: 'scout', x: 3.7, z: 15.65, yaw: Math.PI / 2, route: [[-3.7, 15.65], [-3.7, 19.9], [3.7, 19.9], [3.7, 15.65]], pause: 0.9, group: 1 },
        { type: 'scout', x: 5.6, z: 11.4, yaw: Math.PI / 2, route: [[-5.6, 11.4], [5.6, 11.4]], pause: 2.4, group: 1 },
      ];
    }
    if (stage === 3) {
      const specs: SpawnSpec[] = [
        { type: 'sentinel', x: -5, z: -34.2, yaw: Math.PI, route: [[-5, -29.6], [-5, -34.2]], pause: 2.6, group: 3 },
        { type: 'sentinel', x: 5, z: -29.6, yaw: 0, route: [[5, -34.2], [5, -29.6]], pause: 2.6, group: 3 },
        { type: 'scout', x: 7.5, z: -19.7, yaw: Math.PI / 2, route: [[-7.5, -19.7], [7.5, -19.7]], pause: 1.8, group: 3 },
        { type: 'scout', x: -7.5, z: -30.9, y: 2.55, yaw: -Math.PI / 2, route: [[7.5, -30.9], [-7.5, -30.9]], pause: 1.8, group: 3 },
      ];
      if (diff >= 2) specs.push({ type: 'scout', x: 3, z: -26.6, yaw: Math.PI / 2, route: [[-3, -26.6], [-3, -22.4], [3, -22.4], [3, -26.6]], pause: 1.0, group: 3 });
      if (diff >= 3) specs.push({ type: 'scout', x: 2.6, z: -36.2, y: 2.3, yaw: Math.PI / 2, route: [[-2.6, -36.2], [2.6, -36.2]], pause: 2.0, group: 3 });
      return specs;
    }
    return [];
  };

  // host-only script state
  let wave = 0;
  let waveT = 0;
  let ventNext = 0;
  let pendingStage = 0;
  let pendingT = 0;
  let sentT = 0;
  let stage3Ready = false;
  let holdOverride = 0;

  /** (Re)populate a lane. Also runs without a session, as the menu backdrop. */
  const populate = (stage: number) => {
    sh.clear();
    wave = 0;
    waveT = 0;
    pendingStage = 0;
    stage3Ready = stage === 3;
    for (const spec of stageSpecs(stage)) sh.spawn(spec);
  };

  const players = () => Math.max(1, session?.players.size ?? 1);
  const freshHold = (): Hold => ({ started: false, on: false, ms: 0, at: 0, total: holdOverride || wavePlan(diff, players()).holdMs });

  const near = (s: Session, pid: string, p: THREE.Vector3, range: number): boolean => {
    const pose = s.poseOf(pid);
    return !!pose && !sh.isDown(pid) && Math.hypot(pose.x - p.x, pose.z - p.z) <= range;
  };

  const installHost = (s: Session) => {
    if (!s.get('rng')) {
      const init: Rng = { stage: 1, fails: 0, t0: s.hostNow(), loud: false, hold: freshHold(), sent: 0 };
      s.set('rng', init);
    }
    readState();
    populate(s.get<Rng>('rng').stage);

    sh.onAlert = () => {
      const cur = st();
      if (cur && !cur.loud && (cur.stage === 1 || cur.stage === 3)) {
        s.set('rng.loud', true);
        s.emit('say', { k: 'rng.sub.loud' });
      }
    };
    sh.onWipe = () => {
      const cur = st();
      if (!cur || cur.stage > 3) {
        sh.resetPlayers();
        return;
      }
      // back to the lane's start: same lane, fresh drones, one more fail
      s.set('rng.fails', cur.fails + 1);
      s.set('rng.loud', false);
      if (cur.stage === 2) s.set('rng.hold', freshHold());
      if (cur.stage === 3) s.set('rng.sent', 2);
      populate(cur.stage);
      sh.resetPlayers();
      s.emit('rng.restart', { stage: cur.stage });
      s.emit('say', { k: 'rng.sub.fail' });
    };

    s.handle('rng.console', (pid) => {
      const cur = st();
      if (!cur || cur.stage !== 1 || !near(s, pid, CONSOLE, 4.5)) return;
      sh.shutdown();
      s.set('rng.loud', false);
      s.set('rng.hold', freshHold());
      s.set('rng.stage', 2);
      s.emit('sfx', { n: 'ok', p: CONSOLE.toArray() });
      s.emit('say', { k: 'rng.sub.s1done' });
    });
    s.handle('rng.beacon', (pid) => {
      const cur = st();
      if (!cur || cur.stage !== 2 || cur.hold.started || !near(s, pid, BEACON, 4.5)) return;
      wave = 0;
      waveT = 2;
      s.set('rng.hold', { ...freshHold(), started: true, at: s.hostNow() });
      s.emit('sfx', { n: 'relayOn', p: BEACON.toArray() });
      s.emit('say', { k: 'rng.sub.hold' });
    });
    s.handle('rng.switch', (pid) => {
      const cur = st();
      if (!cur || cur.stage !== 3 || !stage3Ready || sh.alive('sentinel') > 0 || !near(s, pid, SWITCH, 4.5)) return;
      const timeMs = Math.round(s.hostNow() - cur.t0);
      const res: CalibResult = { level: 'range', diff, timeMs, fails: cur.fails, stars: stars(cur.fails, timeMs, PAR_MS) };
      sh.killAll();
      s.set('rng.stage', 4);
      s.set('calib.result', res);
      s.emit('sfx', { n: 'vaultOpen', p: [0, 1.4, -38] });
      s.emit('say', { k: 'rng.sub.done' });
    });
  };

  /** Host: the stage script that runs every frame. */
  const hostScript = (s: Session, dt: number) => {
    const cur = st();
    if (!cur) return;
    if (pendingStage) {
      pendingT -= dt;
      if (pendingT <= 0) {
        const stage = pendingStage;
        if (cur.stage === stage) populate(stage);
        else pendingStage = 0;
      }
    }
    if (cur.stage === 2 && cur.hold.started) {
      const hold = cur.hold;
      const tNow = s.hostNow();
      let occupied = false;
      for (const pid of s.players.keys()) {
        if (near(s, pid, BEACON, ZONE_R)) {
          occupied = true;
          break;
        }
      }
      const elapsed = hold.ms + (hold.on ? tNow - hold.at : 0);
      if (elapsed >= hold.total) {
        // held long enough: the wave dies with the uplink, lane C opens
        sh.killAll();
        s.set('rng.hold', { ...hold, on: false, ms: hold.total, at: tNow });
        s.set('rng.sent', 2);
        s.set('rng.loud', false);
        s.set('rng.stage', 3);
        stage3Ready = false;
        pendingStage = 3; // once the wrecks have cleared the pool
        pendingT = 1.6;
        s.emit('sfx', { n: 'ok', p: BEACON.toArray() });
        s.emit('say', { k: 'rng.sub.s2done' });
        return;
      }
      if (occupied !== hold.on) s.set('rng.hold', { ...hold, on: occupied, ms: elapsed, at: tNow });
      waveT -= dt;
      if (waveT <= 0) {
        const plan = wavePlan(diff, players());
        const n = spawnCount(waveSize(wave, diff, players()), sh.alive('scout'), plan.cap);
        for (let i = 0; i < n; i++) {
          const [vx, vy, vz] = VENTS[ventNext];
          ventNext = (ventNext + 1) % VENTS.length;
          sh.spawn({ type: 'scout', x: vx + (Math.random() - 0.5) * 0.8, z: vz + (Math.random() - 0.5) * 0.8, fromY: vy, y: 1.5 + Math.random() * 0.9, yaw: yawTo(ZX - vx, ZZ - vz), alert: true, group: 2, dmg: 0.5 });
        }
        wave++;
        waveT = plan.gap;
      }
    }
    if (cur.stage === 3 && stage3Ready) {
      sentT -= dt;
      if (sentT <= 0) {
        sentT = 0.25;
        const n = sh.alive('sentinel');
        if (n !== cur.sent) s.set('rng.sent', n);
      }
    }
  };

  // ======================================================================
  // Interactions
  // ======================================================================
  interactions.add({
    id: 'rng-console',
    object: consoleTarget,
    range: 2.8,
    prompt: () => (st()?.stage === 1 ? t('rng.prompt.console') : null),
    onUse: () => session?.intent('rng.console'),
  });
  interactions.add({
    id: 'rng-beacon',
    object: beaconTarget,
    range: 2.8,
    prompt: () => {
      const s = st();
      return s && s.stage === 2 && !s.hold.started ? t('rng.prompt.beacon') : null;
    },
    onUse: () => session?.intent('rng.beacon'),
  });
  interactions.add({
    id: 'rng-switch',
    object: switchTarget,
    range: 2.6,
    prompt: () => (st()?.stage === 3 ? t('rng.prompt.switch') : null),
    locked: () => {
      const s = st();
      return s && s.stage === 3 && s.sent > 0 ? t('rng.lock.switch', { n: s.sent }) : null;
    },
    onUse: () => session?.intent('rng.switch'),
  });

  // ======================================================================
  // End card
  // ======================================================================
  const cardStars = h('div', { class: 'rng-stars' });
  const cardTime = h('b');
  const cardFails = h('b');
  const cardDiff = h('b');
  const cardLabel = h('div', { class: 'label' });
  const cardTitle = h('h2');
  const cardTexts = [h('span'), h('span'), h('span')];
  const card = h(
    'div',
    { class: 'rng-card hidden' },
    cardLabel,
    cardTitle,
    cardStars,
    h('div', { class: 'rng-stats' }, h('div', {}, cardTime, cardTexts[0]), h('div', {}, cardFails, cardTexts[1]), h('div', {}, cardDiff, cardTexts[2])),
  );
  {
    const uiRoot = document.getElementById('ui');
    if (uiRoot) uiRoot.insertBefore(card, uiRoot.querySelector('.menu'));
  }
  let cardKey = '';
  const showCard = () => {
    const r = result();
    const key = r ? JSON.stringify(r) : '';
    if (key === cardKey) return;
    cardKey = key;
    card.classList.toggle('hidden', !r);
    if (!r) return;
    cardLabel.textContent = t('rng.card.label');
    cardTitle.textContent = t('rng.card.title');
    cardStars.replaceChildren('★'.repeat(r.stars), h('i', {}, '★'.repeat(3 - r.stars)));
    const sec = Math.round(r.timeMs / 1000);
    cardTime.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    cardFails.textContent = String(r.fails);
    cardDiff.textContent = String(r.diff);
    cardTexts[0].textContent = t('rng.card.time');
    cardTexts[1].textContent = t('rng.card.fails');
    cardTexts[2].textContent = t('rng.card.diff');
  };

  // ======================================================================
  // Session wiring
  // ======================================================================
  const redrawScreens = () => {
    consoleScreen.redraw();
    holdScreen.redraw();
    switchScreen.redraw();
  };
  const redraw = () => {
    redrawScreens();
    for (const l of labels) l.redraw();
    cardKey = '\0';
    showCard();
  };
  onLangChange(redraw);

  const toCheckpoint = (stage: number) => {
    const s = session;
    const player = deps.player();
    if (!s || !player) return;
    const pts = CHECKPOINTS[Math.min(3, Math.max(1, stage))];
    const index = Math.max(0, [...s.players.keys()].indexOf(s.pid));
    const [x, z] = pts[index % pts.length];
    player.teleport(new THREE.Vector3(x, 0.02, z), 0);
  };

  const attach = (s: Session) => {
    session = s;
    sh.attach(s);
    unsubs.push(
      s.onState((path) => {
        if (path === '' || path.startsWith('rng') || path.startsWith('calib')) {
          readState();
          redrawScreens();
          showCard();
        }
      }),
    );
    if (s.isHost) installHost(s);
    readState();
    unsubs.push(
      s.onEvent((name, a) => {
        switch (name) {
          case 'sfx':
            audio.play(a.n, { pos: a.p ? new THREE.Vector3().fromArray(a.p) : undefined, rate: a.r });
            break;
          case 'say':
            ui.say(a.k);
            audio.play('radio');
            break;
          case 'rng.restart':
            toCheckpoint(a.stage);
            break;
        }
      }),
    );
    const cur = st();
    if (cur && cur.stage > 1) {
      // joined a run in progress: start at the current lane, doors already open
      toCheckpoint(cur.stage);
      for (let i = 0; i < doors.length; i++) doors[i].open = cur.stage > i + 1 ? 1 : 0;
    } else {
      ui.say('rng.sub.intro');
      ui.say('rng.sub.controls');
    }
    redrawScreens();
    showCard();
  };

  const detach = () => {
    for (const u of unsubs) u();
    unsubs.length = 0;
    sh.onWipe = null;
    sh.onAlert = null;
    sh.detach();
    session = null;
    readState();
    for (const d of doors) d.open = 0;
    cardKey = '';
    card.classList.add('hidden');
    card.classList.remove('mini');
    redrawScreens();
    populate(1); // scouts patrol behind the main menu again
  };

  // ======================================================================
  // Per frame
  // ======================================================================
  let lastHoldDraw = 0;
  let cardMini = false;
  let populated = false;

  const update = (dt: number, time: number) => {
    if (!populated) {
      populated = true;
      if (!session) populate(1);
    }
    dustA(time);
    dustB(time);
    dustC(time);
    b.updateShadows(time);

    const s = session;
    const cur = st();
    if (s && s.isHost) hostScript(s, dt);

    // doors follow the stage
    const stage = cur?.stage ?? 1;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const want = stage > i + 1 ? 1 : 0;
      if (d.open !== want) {
        d.open += Math.sign(want - d.open) * Math.min(Math.abs(want - d.open), dt / 1.4);
        if (want === 1 && d.open - dt / 1.4 <= 0) audio.play('relayOn', { pos: d.left.position, vol: 0.8 });
      }
      const e = d.open * d.open * (3 - 2 * d.open);
      d.left.position.x = -0.8 - 1.52 * e;
      d.right.position.x = 0.8 + 1.52 * e;
      physics.setEnabled(d.col, d.open < 0.5);
      d.lamp.emissive.setHex(want ? GREEN : RED);
    }

    // lane B: ring, beacon, countdown display
    const hold = cur?.hold;
    const holding = !!cur && cur.stage === 2 && !!hold?.started;
    const ringColor = !cur || cur.stage < 2 ? AMBER : cur.stage > 2 ? GREEN : holding ? (hold!.on ? TEAL : AMBER) : AMBER;
    ringMat.emissive.setHex(ringColor);
    beaconMat.emissive.setHex(ringColor);
    const pulse = holding && !hold!.on ? 0.5 + 0.5 * Math.sin(time * 9) : 1;
    ringMat.emissiveIntensity = (holding ? 4.5 : 2.6) * pulse * b.getPower();
    beaconMat.emissiveIntensity = (3 + Math.sin(time * 3) * 0.8) * b.getPower();
    beaconCore.rotation.y = time * (holding ? 3 : 0.8);
    beaconCore.position.y = 1.24 + Math.sin(time * 2) * 0.03;
    if (holding && time - lastHoldDraw > 0.25) {
      lastHoldDraw = time;
      holdScreen.redraw();
    }

    // lane C: the lever
    const thrown = stage > 3;
    lever.rotation.x += ((thrown ? 2.3 : 0.5) - lever.rotation.x) * (1 - Math.exp(-14 * dt));

    // the end card shrinks after a while
    const r = result();
    const mini = !!r && !!cur && !!s && s.hostNow() - (cur.t0 + r.timeMs) > 14000;
    if (mini !== cardMini) {
      cardMini = mini;
      card.classList.toggle('mini', mini);
    }

    sh.update(dt, time);
  };

  const level: Level & { debug: Record<string, unknown> } = {
    spawn(index: number) {
      const [x, z] = CHECKPOINTS[1][index % CHECKPOINTS[1].length];
      return { pos: new THREE.Vector3(x, 0.02, z), yaw: 0 };
    },
    menuCamera(time, cam) {
      cam.position.set(6.6 + Math.sin(time * 0.08) * 0.5, 3.15 + Math.sin(time * 0.11) * 0.08, 30.6 + Math.cos(time * 0.07) * 0.4);
      cam.lookAt(-1.6, 1.3, 19.5);
    },
    attach,
    detach,
    update,
    objective() {
      const s = st();
      if (!s || !session) return [];
      if (s.stage === 1) return [t('rng.obj.s1'), t(s.loud ? 'rng.obj.s1loud' : 'rng.obj.s1hint')];
      if (s.stage === 2) {
        if (!s.hold.started) return [t('rng.obj.s2go')];
        const elapsed = s.hold.ms + (s.hold.on ? session.hostNow() - s.hold.at : 0);
        return [t('rng.obj.s2hold', { s: Math.max(0, Math.ceil((s.hold.total - elapsed) / 1000)) }), t(s.hold.on ? 'rng.obj.s2in' : 'rng.obj.s2out')];
      }
      if (s.stage === 3) return s.sent > 0 ? [t('rng.obj.s3', { n: s.sent }), t('rng.obj.s3hint')] : [t('rng.obj.s3switch')];
      return [t('rng.obj.done')];
    },
    redraw,
    // hooks for tests/range.mjs and for poking around in the console
    debug: {
      sh,
      diff,
      checkpoints: CHECKPOINTS,
      spots: {
        // a drone here sees a player standing there
        open: { drone: [4, 23.7, Math.PI / 2], player: [-2, 23.7] },
        // a tall partition stands between the two
        cover: { drone: [0, 23.7, Math.PI], player: [0, 28.4] },
        console: [CONSOLE.x, CONSOLE.z + 1.4],
        beacon: [BEACON.x, BEACON.z + 1.2],
        switch: [SWITCH.x, SWITCH.z + 1.4],
      },
      state: () => st(),
      drones: () => sh.drones(),
      clear: () => sh.clear(),
      spawn: (spec: SpawnSpec) => sh.spawn(spec),
      freeze: (on: boolean) => (sh.frozen = on),
      hurt: (pid: string, dmg: number) => sh.hurt(pid, dmg, 0, 0),
      kill: (id: number) => sh.kill(id),
      fire: () => sh.debugFire(),
      /** Host: repopulate the current lane without counting a fail. */
      repopulate: () => {
        const cur = st();
        if (session?.isHost && cur) populate(cur.stage);
      },
      /** Host: shorten the hold of lane B (set before the uplink starts). */
      setHoldMs: (ms: number) => {
        holdOverride = ms;
        const cur = st();
        if (session?.isHost && cur && !cur.hold.started) session.set('rng.hold', freshHold());
      },
    },
  };
  return level;
}
