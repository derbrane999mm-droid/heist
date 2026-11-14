// Calibration sample "hack": a small server room with three two-terminal
// puzzles (Trace, Signal, Cipher). Solving all three opens the exit door.
//
// Each station has its input terminal (teal) and its information terminal
// (amber) on opposite sides of a rack row or a wall, so neither screen can be
// read from the other. Works alone (walk between the two) and with 2-4.
//
// Open with ?level=hack&diff=1..3 (optional &seed=<number> for a fixed puzzle).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Builder, FONT, MONO } from '../build';
import type { Level, LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Input } from '../../core/input';
import type { LoopHandle } from '../../core/audio';
import { t, registerStrings, onLangChange } from '../../core/i18n';
import { h } from '../../ui/ui';
import { HackSystem } from '../mech/hack';
import { rng, toDiff, type Diff } from '../mech/hack-logic';

registerStrings(
  {
    'hkl.obj.main': 'Breach all three systems to open the exit ({n}/3)',
    'hkl.obj.left': 'Still locked: {list}',
    'hkl.obj.tip': 'Every system has two terminals, and one shows what the other needs: talk',
    'hkl.obj.done': 'The exit is open',
    'hkl.sub.intro': 'BROKER: Three systems hold that door shut. Each has two terminals, and neither shows the whole picture. So talk.',
    'hkl.sub.one': 'BROKER: One system down. Keep going.',
    'hkl.sub.two': 'BROKER: Two down. One to go.',
    'hkl.sub.open': 'BROKER: That was the last one. Door is open.',
    'hkl.sys.trace': 'TRACE',
    'hkl.sys.signal': 'SIGNAL',
    'hkl.sys.cipher': 'CIPHER',
    'hkl.exit': 'EXIT',
    'hkl.hall': 'SERVER HALL B2',
    'hkl.hallSub': 'NULL VAULT DATA SERVICES · RESTRICTED AREA',
    'hkl.end.label': 'CALIBRATION · HACKING',
    'hkl.end.title': 'SYSTEMS BREACHED',
    'hkl.end.time': 'TIME',
    'hkl.end.fails': 'STRIKES',
    'hkl.end.diff': 'DIFFICULTY',
  },
  {
    'hkl.obj.main': 'Knackt alle drei Systeme, dann öffnet sich der Ausgang ({n}/3)',
    'hkl.obj.left': 'Noch gesperrt: {list}',
    'hkl.obj.tip': 'Jedes System hat zwei Terminals, und eins zeigt, was das andere braucht: Redet miteinander',
    'hkl.obj.done': 'Der Ausgang ist offen',
    'hkl.sub.intro': 'BROKER: Drei Systeme halten diese Tür zu. Jedes hat zwei Terminals, und keins zeigt das ganze Bild. Also redet.',
    'hkl.sub.one': 'BROKER: Ein System ist durch. Weiter.',
    'hkl.sub.two': 'BROKER: Zwei sind durch. Eins fehlt noch.',
    'hkl.sub.open': 'BROKER: Das war das letzte. Die Tür ist offen.',
    'hkl.sys.trace': 'TRACE',
    'hkl.sys.signal': 'SIGNAL',
    'hkl.sys.cipher': 'CIPHER',
    'hkl.exit': 'AUSGANG',
    'hkl.hall': 'SERVERHALLE B2',
    'hkl.hallSub': 'NULL VAULT DATA SERVICES · ZUTRITT NUR FÜR BEFUGTE',
    'hkl.end.label': 'KALIBRIERUNG · HACKING',
    'hkl.end.title': 'SYSTEME GEKNACKT',
    'hkl.end.time': 'ZEIT',
    'hkl.end.fails': 'FEHLER',
    'hkl.end.diff': 'SCHWIERIGKEIT',
  },
);

interface Room {
  /** Host clock (ms) when the run started and when the last system fell. */
  t0: number;
  doneAt: number | null;
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
const COOL = 0xcfe6ff;
const BLUE = 0x4a7dff;
const GREEN = 0x5dff8f;
const RED = 0xff3040;

// room: x -9..9, z -6.5 (north, exit door) .. 6.5 (south, spawn)
const HX = 9;
const HZ = 6.5;
const H = 3.8;
// four rack rows, two either side of the central corridor
const ROW_N = -2.4;
const ROW_S = 2.0;
const RACK_W = 0.78;
const RACK_H = 2.3;
const RACK_D = 1.0;
const RACKS = 7;
const ROW_X0 = 2.2;
const ROW_LEN = RACK_W * RACKS;
const ROW_CX = ROW_X0 + ROW_LEN / 2;
const DOOR_W = 2.6;
const DOOR_H = 2.6;
const DOOR_Z = -HZ - 0.2;
const DOOR_SLIDE = 1.24;
const STATIONS = ['trace', 'signal', 'cipher'] as const;
/** Time for three stars, per difficulty. */
const PAR_MS: Record<Diff, number> = { 1: 4 * 60000, 2: 6 * 60000, 3: 9 * 60000 };

export function createCalibHack(deps: LevelDeps): Level {
  const { engine, physics, audio, mats, interactions, ui } = deps;
  const m = mats;
  const b = new Builder(engine.scene, physics, mats, engine.quality);
  const diff = toDiff(deps.options.diff);
  // LevelDeps has no input yet: the interaction system holds the same instance
  const input: Input = (deps as unknown as { input?: Input }).input ?? (interactions as unknown as { input: Input }).input;
  const seed = Number(deps.options.seed);
  const hack = new HackSystem({ builder: b, mats, interactions, audio, input, player: deps.player, diff, seed: Number.isFinite(seed) && deps.options.seed !== '' && deps.options.seed !== undefined ? seed >>> 0 : undefined });
  let session: Session | null = null;
  const unsubs: (() => void)[] = [];
  let introShown = false;
  let doorShut = true;
  let hums: LoopHandle[] = [];

  engine.scene.background = new THREE.Color(0x020406);
  engine.scene.fog = new THREE.FogExp2(0x04070c, 0.03);

  // ======================================================================
  // Shell
  // ======================================================================
  const floor = m.floor.clone(); // same tiles, polished: the rack lights mirror in it
  floor.roughness = 0.42;
  floor.metalness = 0.6;
  floor.envMapIntensity = 1.7;
  b.box(floor, HX * 2 + 0.8, 0.3, HZ * 2 + 0.8, 0, -0.15, 0, { tile: 3 });
  b.box(floor, 4.4, 0.3, 3.4, 0, -0.15, -HZ - 0.4 - 1.7, { tile: 3 });
  b.box(m.ceiling, HX * 2 + 0.8, 0.3, HZ * 2 + 0.8, 0, H + 0.15, 0, { tile: 3 });
  b.box(m.concrete, HX * 2 + 0.8, H, 0.4, 0, H / 2, HZ + 0.2, { tile: 3 });
  b.box(m.concrete, 0.4, H, HZ * 2 + 0.8, HX + 0.2, H / 2, 0, { tile: 3 });
  b.box(m.concrete, 0.4, H, HZ * 2 + 0.8, -HX - 0.2, H / 2, 0, { tile: 3 });
  const seg = HX + 0.4 - DOOR_W / 2;
  for (const sx of [-1, 1]) b.box(m.concrete, seg, H, 0.4, sx * (DOOR_W / 2 + seg / 2), H / 2, DOOR_Z, { tile: 3 });
  b.box(m.concrete, DOOR_W, H - DOOR_H, 0.4, 0, DOOR_H + (H - DOOR_H) / 2, DOOR_Z, { tile: 3 });

  // wainscot and a thin line of light around the room
  b.box(m.panel, HX * 2, 1.1, 0.06, 0, 0.55, HZ - 0.03, { tile: 2, collide: false });
  for (const sx of [-1, 1]) {
    b.box(m.panel, 0.06, 1.1, HZ * 2, sx * (HX - 0.03), 0.55, 0, { tile: 2, collide: false });
    b.glowBox(TEAL, 0.02, 0.022, HZ * 2 - 0.2, sx * (HX - 0.07), 1.12, 0, 1.8);
    b.box(m.panel, seg - 0.6, 1.1, 0.06, sx * (DOOR_W / 2 + 0.4 + (seg - 0.6) / 2), 0.55, -HZ + 0.03, { tile: 2, collide: false });
  }
  b.glowBox(TEAL, HX * 2 - 0.2, 0.022, 0.02, 0, 1.12, HZ - 0.07, 1.8);

  // ceiling: beams over the rows, cross beams, hanging light bars, two pipes
  for (const z of [ROW_N, ROW_S]) b.box(m.darkMetal, HX * 2, 0.3, 0.42, 0, H - 0.15, z, { tile: 2, collide: false });
  for (const x of [-7.7, -2.2, 2.2, 7.7]) b.box(m.darkMetal, 0.26, 0.22, HZ * 2, x, H - 0.11, 0, { tile: 2, collide: false });
  const bars: [number, number][] = [
    [-5, 4.3],
    [5, 4.3],
    [0, 1.2],
    [-5, -0.2],
    [5, -0.2],
    [-5, -4.5],
    [5, -4.5],
  ];
  for (const [x, z] of bars) {
    b.box(m.black, 2.6, 0.07, 0.2, x, 3.42, z, { collide: false, shadow: false });
    b.glowBox(COOL, 2.5, 0.03, 0.11, x, 3.375, z, 3.6);
    for (const dx of [-1.1, 1.1]) b.box(m.black, 0.012, H - 3.45, 0.012, x + dx, 3.45 + (H - 3.45) / 2, z, { collide: false, shadow: false });
  }
  for (const [y, z, r] of [
    [3.5, HZ - 0.22, 0.08],
    [3.3, HZ - 0.2, 0.05],
  ]) {
    b.addStatic(m.steel, new THREE.CylinderGeometry(r, r, HX * 2, 14).rotateZ(Math.PI / 2).translate(0, y, z));
  }

  // ======================================================================
  // Server racks
  // ======================================================================
  const rnd = rng(0xb2);
  type Blink = 0 | 1 | 2 | 3; // steady, slow, fast, flicker
  const leds: { mat: THREE.MeshStandardMaterial; mode: Blink; base: number }[] = [];
  const ledMats = new Map<string, THREE.MeshStandardMaterial>();
  const ledMat = (color: number, mode: Blink) => {
    const key = color + ':' + mode;
    let mat = ledMats.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 3.2, roughness: 0.6, metalness: 0 });
      ledMats.set(key, mat);
      leds.push({ mat, mode, base: 3.2 });
    }
    return mat;
  };
  const ledChance = 0.45 + 0.3 * engine.quality.detail;
  const rackRow = (side: number, z: number) => {
    const cx = side * ROW_CX;
    for (let i = 0; i < RACKS; i++) {
      const x = side * (ROW_X0 + (i + 0.5) * RACK_W);
      b.box(m.darkMetal, RACK_W - 0.015, RACK_H, RACK_D, x, RACK_H / 2, z, { tile: 1, round: 0.015, collide: false });
      for (const f of [-1, 1]) {
        const fz = z + f * (RACK_D / 2 + 0.004);
        b.box(m.black, RACK_W - 0.13, RACK_H - 0.26, 0.012, x, RACK_H / 2 + 0.03, fz, { collide: false, shadow: false });
        b.box(m.steel, 0.018, 0.42, 0.02, x + 0.3, 1.12, fz + f * 0.012, { collide: false, shadow: false });
        // one row of status lights per server unit
        for (let u = 0; u < 16; u++) {
          if (rnd() > ledChance) continue;
          const count = 1 + Math.floor(rnd() * 3);
          for (let k = 0; k < count; k++) {
            const pick = rnd();
            const color = pick < 0.55 ? GREEN : pick < 0.75 ? TEAL : pick < 0.93 ? AMBER : RED;
            const mp = rnd();
            const mode: Blink = mp < 0.45 ? 0 : mp < 0.65 ? 1 : mp < 0.85 ? 2 : 3;
            b.addStatic(ledMat(color, mode), new THREE.BoxGeometry(0.018, 0.012, 0.008).translate(x - 0.27 + k * 0.036, 0.34 + u * 0.118, fz + f * 0.01), false);
          }
        }
      }
    }
    physics.addBox(cx, RACK_H / 2, z, ROW_LEN, RACK_H, RACK_D);
    // cable tray above, light along the top edges, a lit cap at the corridor end
    b.box(m.darkMetal, ROW_LEN + 0.2, 0.06, 0.62, cx, RACK_H + 0.44, z, { tile: 1, collide: false });
    for (const dz of [-0.16, 0, 0.16]) b.box(m.rubber, ROW_LEN + 0.1, 0.05, 0.07, cx, RACK_H + 0.495, z + dz, { collide: false, shadow: false });
    for (const dx of [-2.2, 0, 2.2]) b.box(m.black, 0.02, H - RACK_H - 0.47, 0.02, cx + dx, RACK_H + 0.47 + (H - RACK_H - 0.47) / 2, z, { collide: false, shadow: false });
    for (const f of [-1, 1]) b.glowBox(TEAL, ROW_LEN, 0.012, 0.012, cx, RACK_H + 0.012, z + f * (RACK_D / 2 - 0.01), 2.2);
    const capX = side * (ROW_X0 - 0.03);
    b.box(m.panel, 0.06, RACK_H, RACK_D + 0.04, capX, RACK_H / 2, z, { tile: 1, collide: false });
    b.glowBox(TEAL, 0.012, 1.7, 0.04, capX - side * 0.034, 1.2, z, 3);
    b.box(m.panel, 0.06, RACK_H, RACK_D + 0.04, side * (ROW_X0 + ROW_LEN + 0.03), RACK_H / 2, z, { tile: 1, collide: false });
  };
  for (const side of [-1, 1]) for (const z of [ROW_N, ROW_S]) rackRow(side, z);

  // ======================================================================
  // The three stations. Input terminals are teal ('a'), information terminals amber ('b').
  // ======================================================================
  hack.addStation('trace', 'trace');
  hack.addStation('signal', 'signal');
  hack.addStation('cipher', 'cipher');
  // Trace: either side of the south-west row (the router is in view from the spawn)
  hack.addTerminal('trace', 'a', -3.7, ROW_S + RACK_D / 2, 0);
  hack.addTerminal('trace', 'b', -6.3, ROW_S - RACK_D / 2, Math.PI);
  // Signal: either side of the south-east row
  hack.addTerminal('signal', 'a', 3.7, ROW_S + RACK_D / 2, 0);
  hack.addTerminal('signal', 'b', 5.7, ROW_S - RACK_D / 2, Math.PI);
  // Cipher: keypad beside the exit door, key table behind the north-west row
  hack.addTerminal('cipher', 'a', -3.5, -HZ, 0);
  hack.addTerminal('cipher', 'b', -4.4, ROW_N + RACK_D / 2, 0);
  // a cable run from the keypad to the door it belongs to
  b.glowBox(TEAL, 1.0, 0.012, 0.012, -2.3, 2.02, -HZ + 0.02, 1.6);

  // ======================================================================
  // Exit door (north) and the way out behind it
  // ======================================================================
  for (const sx of [-1, 1]) b.box(m.vault, 0.24, DOOR_H + 0.12, 0.22, sx * (DOOR_W / 2 + 0.12), (DOOR_H + 0.12) / 2, -HZ + 0.04, { tile: 1, round: 0.02 });
  b.box(m.vault, DOOR_W + 0.48, 0.24, 0.22, 0, DOOR_H + 0.12, -HZ + 0.04, { tile: 1, round: 0.02, collide: false });
  b.box(m.hazard, DOOR_W, 0.012, 0.45, 0, 0.006, -HZ + 0.4, { tile: 0.8, collide: false, shadow: false });
  const doorGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: RED, emissiveIntensity: 3 });
  const leafGeo = new RoundedBoxGeometry(DOOR_W / 2, DOOR_H, 0.14, 3, 0.02);
  const insetGeo = new THREE.BoxGeometry(DOOR_W / 2 - 0.34, DOOR_H - 0.6, 0.02);
  const seamGeo = new THREE.BoxGeometry(0.03, DOOR_H - 0.3, 0.02);
  const leaves = [-1, 1].map((sx) => {
    const leaf = b.mesh(leafGeo, m.vault, (sx * DOOR_W) / 4, DOOR_H / 2, DOOR_Z);
    b.mesh(insetGeo, m.darkMetal, 0, 0, 0.066, leaf);
    b.mesh(seamGeo, doorGlow, (-sx * DOOR_W) / 4 + sx * 0.06, 0, 0.068, leaf).castShadow = false;
    return leaf;
  });
  const doorCol = b.collider(0, DOOR_H / 2, DOOR_Z, DOOR_W, DOOR_H, 0.3);
  // one lamp per system above the door
  const lampMats = STATIONS.map(() => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: RED, emissiveIntensity: 3.4 }));
  const lampGeo = new THREE.BoxGeometry(0.42, 0.06, 0.03);
  lampMats.forEach((mat, i) => (b.mesh(lampGeo, mat, (i - 1) * 0.8, 3.3, -HZ + 0.02).castShadow = false));
  const lampLabel = b.decal(
    2.4,
    0.15,
    0,
    3.14,
    -HZ + 0.012,
    0,
    300,
    (ctx, w, hh) => {
      ctx.fillStyle = 'rgba(230,238,242,0.85)';
      ctx.font = `600 ${hh * 0.72}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      STATIONS.forEach((id, i) => ctx.fillText(t('hkl.sys.' + id), w / 2 + (i - 1) * (w / 3), hh / 2, w / 3 - 10));
    },
    1.2,
  );
  // vestibule
  b.box(m.panel, 0.2, 3.2, 3.4, -2.2, 1.6, -HZ - 2.1, { tile: 1.2 });
  b.box(m.panel, 0.2, 3.2, 3.4, 2.2, 1.6, -HZ - 2.1, { tile: 1.2 });
  b.box(m.panel, 4.6, 3.2, 0.2, 0, 1.6, -HZ - 3.9, { tile: 1.2 });
  b.box(m.ceiling, 4.6, 0.2, 3.6, 0, 3.3, -HZ - 2.1, { tile: 1.2, collide: false });
  for (const sx of [-1, 1]) b.glowBox(COOL, 0.04, 2.5, 0.03, sx * 1.5, 1.45, -HZ - 3.77, 5);
  b.glowBox(GREEN, 2.2, 0.03, 0.03, 0, 2.62, -HZ - 3.77, 4);
  const exitSign = b.decal(
    2.0,
    0.56,
    0,
    2.2,
    -HZ - 3.79,
    0,
    220,
    (ctx, w, hh) => {
      ctx.fillStyle = '#5dff8f';
      ctx.font = `700 ${hh * 0.78}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t('hkl.exit'), w / 2, hh / 2 + 2, w - 12);
    },
    2.4,
  );

  // ======================================================================
  // South wall: cooling units and the hall sign
  // ======================================================================
  for (const sx of [-1, 1]) {
    const x = sx * 6.2;
    b.box(m.steel, 2.0, 2.4, 0.7, x, 1.2, HZ - 0.35, { tile: 1.5, round: 0.03 });
    for (let i = 0; i < 9; i++) b.box(m.black, 1.6, 0.06, 0.02, x, 0.45 + i * 0.15, HZ - 0.705, { collide: false, shadow: false });
    b.glowBox(AMBER, 0.06, 0.03, 0.012, x + 0.82, 2.14, HZ - 0.705, 2.6);
    b.glowBox(GREEN, 0.06, 0.03, 0.012, x + 0.7, 2.14, HZ - 0.705, 2.6);
  }
  b.box(m.darkMetal, 4.4, 1.3, 0.08, 0, 2.15, HZ - 0.04, { tile: 1.5, round: 0.02, collide: false });
  b.glowBox(AMBER, 0.03, 1.1, 0.03, -2.26, 2.15, HZ - 0.09, 2.6);
  b.glowBox(AMBER, 0.03, 1.1, 0.03, 2.26, 2.15, HZ - 0.09, 2.6);
  const hallSign = b.decal(
    4.0,
    1.0,
    0,
    2.15,
    HZ - 0.085,
    Math.PI,
    180,
    (ctx, w, hh) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#35e6d0';
      ctx.font = `700 ${hh * 0.4}px ${FONT}`;
      ctx.fillText(t('hkl.hall'), w / 2, hh * 0.4, w - 20);
      ctx.fillStyle = '#7f95a3';
      ctx.font = `500 ${hh * 0.13}px ${MONO}`;
      ctx.fillText(t('hkl.hallSub'), w / 2, hh * 0.74, w - 20);
    },
    1.1,
  );

  // ======================================================================
  // Lights: two shadow spots, nine points, all fixed
  // ======================================================================
  b.hemisphere(0x7a8fb8, 0x10131a, 0.27);
  b.spot(COOL, 170, 0, H - 0.1, 3.9, 0, 0, 3.6, { angle: 0.72, penumbra: 0.8, distance: 9, shadow: true });
  b.cone(COOL, 0, H - 0.15, 3.9, 2.4, 3.3, 0.045);
  b.spot(COOL, 150, 0, H - 0.1, -4.4, 0, 0.8, -6.3, { angle: 0.62, penumbra: 0.75, distance: 9, shadow: true });
  b.cone(COOL, 0, H - 0.15, -4.4, 1.7, 3.0, 0.035).rotation.x = -0.5;
  b.point(TEAL, 7, -3.9, 2.3, 3.7, 6);
  b.point(TEAL, 7, 3.9, 2.3, 3.7, 6);
  b.point(AMBER, 11, -5.3, 2.5, -0.2, 7.5);
  b.point(AMBER, 11, 5.2, 2.5, -0.2, 7.5);
  b.point(BLUE, 9, -5.4, 2.8, -4.6, 8);
  b.point(BLUE, 9, 5.4, 2.8, -4.6, 8);
  b.point(COOL, 6, 0, 3.0, -0.4, 8);
  const doorLight = b.point(RED, 6, 0, 2.9, -5.6, 5);
  const exitLight = b.point(COOL, 0, 0, 2.4, -HZ - 2.2, 9);
  const dustA = b.dust(0, 2.1, 3.9, 6, 3.4, 4, 240);
  const dustB = b.dust(0, 2.1, -4.6, 5, 3.4, 3.4, 160);

  b.finalize();
  engine.captureEnvironment(new THREE.Vector3(0, 1.7, 1.4), 1.0);

  // ======================================================================
  // End card
  // ======================================================================
  const endEl = h('div', { class: 'hk-end hidden' });
  document.getElementById('ui')?.append(endEl);
  const renderEnd = () => {
    const r = session?.get<CalibResult>('calib.result');
    if (!r) {
      endEl.classList.add('hidden');
      return;
    }
    const sec = Math.round(r.timeMs / 1000);
    const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const stars = h('div', { class: 'hk-end-stars' });
    for (let i = 0; i < 3; i++) stars.append(i < r.stars ? '★' : h('i', {}, '★'));
    const cell = (label: string, value: string) => h('div', { class: 'hk-end-cell' }, h('span', { class: 'label' }, t(label)), h('b', {}, value));
    endEl.replaceChildren(
      h('span', { class: 'label' }, t('hkl.end.label')),
      h('div', { class: 'hk-end-title' }, t('hkl.end.title')),
      stars,
      h('div', { class: 'hk-end-grid' }, cell('hkl.end.time', time), cell('hkl.end.fails', String(r.fails)), cell('hkl.end.diff', String(r.diff))),
    );
    endEl.classList.remove('hidden');
  };

  const redraw = () => {
    hack.redraw();
    lampLabel.redraw();
    exitSign.redraw();
    hallSign.redraw();
    renderEnd();
  };
  onLangChange(redraw);

  // ======================================================================
  // Session
  // ======================================================================
  hack.onSolved = () => {
    const n = hack.solvedCount();
    ui.say(n >= STATIONS.length ? 'hkl.sub.open' : n === 2 ? 'hkl.sub.two' : 'hkl.sub.one');
    audio.play('radio');
    if (n >= STATIONS.length) audio.play('vaultOpen', { pos: doorLight.position });
  };
  hack.onHostSolved = () => {
    const s = session;
    if (!s || !s.isHost || !hack.allSolved()) return;
    const room = s.get<Room>('hackroom');
    if (!room || room.doneAt !== null) return;
    const now = s.hostNow();
    const timeMs = Math.round(now - room.t0);
    const fails = hack.strikes();
    const par = PAR_MS[diff];
    const stars = fails <= 1 && timeMs <= par ? 3 : fails <= 4 && timeMs <= par * 2 ? 2 : 1;
    s.set('hackroom.doneAt', now);
    const result: CalibResult = { level: 'hack', diff, timeMs, fails, stars };
    s.set('calib.result', result);
  };

  const attach = (s: Session) => {
    session = s;
    introShown = false;
    hack.attach(s);
    if (s.isHost && !s.get('hackroom')) {
      const room: Room = { t0: s.hostNow(), doneAt: null };
      s.set('hackroom', room);
    }
    unsubs.push(
      s.onState((path) => {
        if (path === '' || path.startsWith('calib')) renderEnd();
      }),
    );
    renderEnd();
    hums = [audio.hum(new THREE.Vector3(-ROW_CX, 1.2, ROW_N), 0.11), audio.hum(new THREE.Vector3(ROW_CX, 1.2, ROW_N), 0.11)];
  };

  const detach = () => {
    hack.detach();
    for (const u of unsubs) u();
    unsubs.length = 0;
    for (const l of hums) l.stop();
    hums = [];
    session = null;
    renderEnd();
  };

  const update = (dt: number, time: number) => {
    dustA(time);
    dustB(time);
    b.updateShadows(time);
    for (const l of leds) {
      if (l.mode === 1) l.mat.emissiveIntensity = l.base * (Math.sin(time * 2.6) > 0 ? 1 : 0.12);
      else if (l.mode === 2) l.mat.emissiveIntensity = l.base * (Math.sin(time * 11.3) > 0.2 ? 1 : 0.1);
      else if (l.mode === 3) l.mat.emissiveIntensity = l.base * (0.25 + 0.75 * Math.abs(Math.sin(time * 23.7 + Math.sin(time * 5.1) * 3)));
    }
    hack.update(dt, time);

    const s = session;
    const room = s?.state.hackroom as Room | undefined;
    let open = 0;
    if (s && room && room.doneAt !== null) open = Math.max(0, Math.min(1, (s.hostNow() - room.doneAt - 600) / 1900));
    if (s && !introShown) {
      introShown = true;
      if (!room || room.doneAt === null) ui.say('hkl.sub.intro');
    }
    for (let i = 0; i < STATIONS.length; i++) lampMats[i].emissive.setHex(s && hack.solved(STATIONS[i]) ? GREEN : RED);
    const done = !!room && room.doneAt !== null;
    doorGlow.emissive.setHex(done ? GREEN : RED);
    doorLight.color.setHex(done ? GREEN : RED);
    const e = open * open * (3 - 2 * open);
    leaves[0].position.x = -DOOR_W / 4 - e * DOOR_SLIDE;
    leaves[1].position.x = DOOR_W / 4 + e * DOOR_SLIDE;
    exitLight.intensity = 16 * e;
    const shut = open < 0.55;
    if (shut !== doorShut) {
      doorShut = shut;
      physics.setEnabled(doorCol, shut);
    }
  };

  const spawns: [number, number][] = [
    [-1.1, 4.7],
    [0, 5.2],
    [1.1, 4.7],
    [0, 4.1],
  ];

  const level: Level & { hack: HackSystem['debug'] } = {
    spawn(index: number) {
      const [x, z] = spawns[index % spawns.length];
      return { pos: new THREE.Vector3(x, 0.02, z), yaw: 0 };
    },
    menuCamera(time, cam) {
      cam.position.set(0.9 + Math.sin(time * 0.07) * 0.7, 1.68 + Math.sin(time * 0.11) * 0.05, 5.3 + Math.cos(time * 0.05) * 0.3);
      cam.lookAt(-0.8, 1.45, -3);
    },
    attach,
    detach,
    update,
    objective() {
      if (!session) return [];
      const room = session.get<Room>('hackroom');
      if (room && room.doneAt !== null) return [t('hkl.obj.done')];
      const left = STATIONS.filter((id) => !hack.solved(id)).map((id) => t('hkl.sys.' + id));
      return [t('hkl.obj.main', { n: STATIONS.length - left.length }), t('hkl.obj.left', { list: left.join(' · ') }), t('hkl.obj.tip')];
    },
    redraw,
    /** Test and debug hooks of the terminal system (`window.__nv.level.hack`). */
    hack: hack.debug,
  };
  return level;
}
