// The hideout: crew hub + the practice-vault "crew check" puzzle.
//
// Puzzle: the decoder screen only works while someone holds the relay in the
// power closet (or for 12 s afterwards). It shows four coloured digits. The
// practice vault's keypad wants them in the colour order shown beside it.
// From the keypad you cannot see the decoder, and from the relay neither.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Builder, FONT, MONO, type ScreenHandle } from '../build';
import type { Level, LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Collider } from '../../core/physics';
import type { LoopHandle } from '../../core/audio';
import { Custodian } from '../custodian';
import { t, onLangChange } from '../../core/i18n';
import { loadCampaign, saveCampaign } from '../../core/save';

interface Tut {
  code: number[]; // digit per colour index (0 red, 1 blue, 2 green, 3 yellow)
  order: number[]; // colour indices in entry order
  slots: number[]; // which colour sits in which decoder cell
  entered: number[];
  strikes: number;
  relayBy: string | null;
  powerUntil: number; // host clock, ms
  seen: boolean;
  open: boolean;
  openAt: number;
  kit: boolean;
  moved: boolean;
  board: boolean;
}

const COLORS = ['#ff4d5e', '#4aa8ff', '#5dff8f', '#ffd84a'];
const COLOR_KEYS = ['c.red', 'c.blue', 'c.green', 'c.yellow'];
const TEAL = 0x35e6d0;
const AMBER = 0xffa23a;
const WARM = 0xffd9a8;
const COOL = 0xcfe6ff;
const POWER_HOLD_MS = 12000;
const H = 4.4;

const RELAY_POS = new THREE.Vector3(8.82, 1.3, -5.5);
const KEYPAD_POS = new THREE.Vector3(-8.94, 1.34, -1.8);
const VAULT_POS = new THREE.Vector3(-9.1, 1.1, 0);
const KIT_POS = new THREE.Vector3(-10.75, 1.02, 0);
const DECODER_POS = new THREE.Vector3(6.0, 1.8, 6.9);
// faces the room centre (forward = (-sin yaw, -cos yaw))
const CUSTODIAN_A = { x: -7.75, z: -6.15, yaw: Math.atan2(-7.75, -6.15) };
const CUSTODIAN_B = { x: -5.3, z: 0.0, yaw: Math.PI / 2 };

function shuffled<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function newPuzzle(): Pick<Tut, 'code' | 'order' | 'slots'> {
  // four different digits, so colours can't be confused by position
  const digits = shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4);
  return { code: digits, order: shuffled([0, 1, 2, 3]), slots: shuffled([0, 1, 2, 3]) };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 3): number {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lineH;
      lines++;
      line = words[i];
      if (lines >= maxLines - 1) {
        // last allowed line: squeeze the rest in
        line = words.slice(i).join(' ');
        break;
      }
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y, maxW);
  return y + lineH;
}

export function createHideout(deps: LevelDeps): Level {
  const { engine, physics, audio, mats, interactions, ui } = deps;
  const b = new Builder(engine.scene, physics, mats, engine.quality);
  const m = mats;
  let session: Session | null = null;
  const unsubs: (() => void)[] = [];

  // --- state shared by the draw callbacks below (declared first: screens draw once on creation)
  const keyRedraws: (() => void)[] = [];
  let padFlash = 0;
  let poweredLocal = false;
  let relayHum: LoopHandle | null = null;
  let doorProgress = 0;
  let lastDecoderDraw = 0;
  let blackoutAt = -1;
  let blackoutStage = 0;
  let flickerT = -1;
  let introShown = false;
  let lastRelayBy: string | null = null;

  const tut = (): Tut | undefined => session?.get<Tut>('tut');
  const isPowered = (): boolean => {
    const s = tut();
    if (!s || !session) return false;
    return s.relayBy !== null || session.hostNow() < s.powerUntil;
  };


  engine.scene.background = new THREE.Color(0x030508);
  engine.scene.fog = new THREE.FogExp2(0x05080d, 0.024);

  // ======================================================================
  // Shell
  // ======================================================================
  b.box(m.floor, 21.6, 0.3, 14.8, -1.4, -0.15, 0, { tile: 4 });
  b.box(m.ceiling, 18.8, 0.3, 14.8, 0, H + 0.15, 0, { tile: 3 });
  b.box(m.concrete, 18.8, H, 0.4, 0, H / 2, -7.2, { tile: 3 }); // north
  b.box(m.concrete, 18.8, H, 0.4, 0, H / 2, 7.2, { tile: 3 }); // south
  b.box(m.concrete, 0.4, H, 14.8, 9.2, H / 2, 0, { tile: 3 }); // east
  // west wall with the vault opening
  b.box(m.concrete, 0.4, H, 6.25, -9.2, H / 2, -4.075, { tile: 3 });
  b.box(m.concrete, 0.4, H, 6.25, -9.2, H / 2, 4.075, { tile: 3 });
  b.box(m.concrete, 0.4, H - 2.2, 1.9, -9.2, 2.2 + (H - 2.2) / 2, 0, { tile: 3 });

  // dark metal wainscot + kick rail along the long walls
  b.box(m.panel, 18, 1.1, 0.06, 0, 0.55, -6.97, { tile: 2, collide: false });
  b.box(m.panel, 5.6, 1.1, 0.06, 0.0, 0.55, 6.97, { tile: 2, collide: false });
  b.glowBox(TEAL, 18, 0.025, 0.02, 0, 1.12, -6.93, 2.2);

  // columns with base wraps and a light slot facing the table
  for (const [px, pz] of [
    [-3.2, -3.2],
    [3.2, -3.2],
    [-3.2, 3.2],
    [3.2, 3.2],
  ]) {
    b.box(m.concrete, 0.62, H, 0.62, px, H / 2, pz, { tile: 2 });
    b.box(m.darkMetal, 0.74, 0.55, 0.74, px, 0.275, pz, { tile: 1, round: 0.03, collide: false });
    b.box(m.darkMetal, 0.7, 0.18, 0.7, px, H - 0.09, pz, { tile: 1, collide: false });
    const sx = px > 0 ? -1 : 1;
    const sz = pz > 0 ? -1 : 1;
    b.glowBox(TEAL, 0.03, 2.3, 0.05, px + sx * 0.32, 1.9, pz + sz * 0.16, 3.2);
  }

  // ceiling structure: beams, hanging light bars, duct, pipes
  for (const z of [-3.2, 3.2]) b.box(m.darkMetal, 18.4, 0.36, 0.42, 0, H - 0.18, z, { tile: 2, collide: false });
  for (const x of [-6.4, -3.2, 0, 3.2, 6.4]) b.box(m.darkMetal, 0.3, 0.26, 14.4, x, H - 0.13, 0, { tile: 2, collide: false });
  const bars: [number, number][] = [
    [-5.6, -1.2],
    [-5.6, 2.4],
    [5.0, -1.2],
    [0, -4.9],
    [0, 4.6],
    [5.6, 1.4],
  ];
  for (const [x, z] of bars) {
    b.box(m.black, 2.5, 0.07, 0.2, x, 3.56, z, { collide: false, shadow: false });
    b.glowBox(WARM, 2.4, 0.03, 0.12, x, 3.515, z, 5.5);
    for (const dx of [-1.05, 1.05]) b.box(m.black, 0.012, H - 3.6, 0.012, x + dx, 3.6 + (H - 3.6) / 2, z, { collide: false, shadow: false });
  }
  b.box(m.steel, 11.2, 0.46, 0.62, -3.0, 3.86, 5.7, { tile: 1.5, collide: false, round: 0.04 });
  for (const x of [-7.5, -4.5, -1.5, 1.5]) b.box(m.black, 0.9, 0.05, 0.36, x, 3.62, 5.7, { collide: false, shadow: false });
  for (const [y, z, r] of [
    [4.05, -6.78, 0.07],
    [3.86, -6.8, 0.045],
  ]) {
    const pipe = new THREE.CylinderGeometry(r, r, 18, 14).rotateZ(Math.PI / 2).translate(0, y, z);
    b.addStatic(m.steel, pipe);
  }

  // ======================================================================
  // Planning table + hologram (centre)
  // ======================================================================
  b.cylinder(m.darkMetal, 0.5, 0.82, 0, 0.41, 0, { radiusTop: 0.36, segments: 36, tile: 1 });
  b.cylinder(m.panel, 1.28, 0.1, 0, 0.87, 0, { segments: 64, tile: 1, collide: false });
  physics.addCylinder(0, 0.46, 0, 1.28, 0.92);
  b.cylinder(m.black, 1.02, 0.012, 0, 0.927, 0, { segments: 64, collide: false, shadow: false });
  const ring = new THREE.TorusGeometry(1.29, 0.014, 8, 96).rotateX(Math.PI / 2).translate(0, 0.9, 0);
  b.addStatic(m.glow(TEAL, 4.5), ring, false);
  const ringIn = new THREE.TorusGeometry(0.42, 0.008, 8, 64).rotateX(Math.PI / 2).translate(0, 0.935, 0);
  b.addStatic(m.glow(TEAL, 3), ringIn, false);

  const holo = new THREE.Group();
  holo.position.set(0, 0.96, 0);
  b.group.add(holo);
  const holoMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.25, 1.9, 1.7), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const holoDim = new THREE.LineBasicMaterial({ color: new THREE.Color(0.1, 0.75, 0.68), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const edges = (geo: THREE.BufferGeometry, mat: THREE.LineBasicMaterial, x: number, y: number, z: number) => {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat);
    l.position.set(x, y, z);
    holo.add(l);
    return l;
  };
  const GROUND = 0.62; // hologram "street level"
  edges(new THREE.BoxGeometry(0.62, 0.05, 0.62), holoMat, 0, GROUND + 0.025, 0);
  edges(new THREE.BoxGeometry(0.3, 0.42, 0.3), holoMat, 0, GROUND + 0.26, 0);
  edges(new THREE.BoxGeometry(0.24, 0.3, 0.24), holoMat, 0, GROUND + 0.62, 0);
  edges(new THREE.BoxGeometry(0.16, 0.2, 0.16), holoMat, 0, GROUND + 0.87, 0);
  edges(new THREE.BoxGeometry(0.02, 0.16, 0.02), holoMat, 0, GROUND + 1.05, 0);
  for (let i = 1; i < 7; i++) edges(new THREE.BoxGeometry(0.3, 0.001, 0.3), holoDim, 0, GROUND + 0.05 + i * 0.06, 0);
  // surrounding blocks
  for (const [x, z, w, hh] of [
    [0.42, 0.3, 0.14, 0.2],
    [-0.44, 0.22, 0.16, 0.12],
    [0.34, -0.42, 0.18, 0.28],
    [-0.36, -0.38, 0.12, 0.16],
    [0.0, 0.5, 0.2, 0.09],
  ]) {
    edges(new THREE.BoxGeometry(w, hh, w), holoDim, x, GROUND + hh / 2, z);
  }
  // street plane and the shaft down to the vault
  const disc = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CircleGeometry(0.78, 48).rotateX(-Math.PI / 2)), holoDim);
  disc.position.y = GROUND;
  holo.add(disc);
  edges(new THREE.BoxGeometry(0.07, 0.5, 0.07), holoMat, 0, GROUND - 0.25, 0);
  for (let i = 0; i < 3; i++) edges(new THREE.BoxGeometry(0.34 - i * 0.06, 0.001, 0.34 - i * 0.06), holoDim, 0, GROUND - 0.12 - i * 0.14, 0);
  const vaultNodeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.7, 0.15), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true });
  const vaultNode = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 1), vaultNodeMat);
  vaultNode.position.y = 0.09;
  holo.add(vaultNode);
  const holoBeam = b.cone(TEAL, 0, 0.94, 0, 0.95, 1.9, 0.07);
  holoBeam.rotation.x = Math.PI;

  // ======================================================================
  // Job board (north wall)
  // ======================================================================
  b.box(m.darkMetal, 6.7, 2.95, 0.14, 0, 2.08, -6.93, { tile: 1.5, round: 0.03, collide: false });
  b.glowBox(AMBER, 0.03, 2.6, 0.03, -3.42, 2.08, -6.84, 3);
  b.glowBox(AMBER, 0.03, 2.6, 0.03, 3.42, 2.08, -6.84, 3);
  b.box(m.darkMetal, 3.2, 0.9, 0.5, 0, 0.45, -6.7, { tile: 1, round: 0.03 }); // console under the board
  b.glowBox(TEAL, 2.8, 0.015, 0.02, 0, 0.78, -6.44, 2.5);

  const missions = [1, 2, 3, 4, 5, 6, 7];
  const board = b.screen(6.3, 2.55, 0, 2.08, -6.855, 0, 250, (ctx, w, h) => {
    const s = tut();
    const unlocked = !!s?.kit;
    ctx.fillStyle = '#04080c';
    ctx.fillRect(0, 0, w, h);
    // scanline texture
    ctx.fillStyle = 'rgba(53,230,208,0.03)';
    for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#35e6d0';
    ctx.font = `700 64px ${FONT}`;
    ctx.fillText(t('board.title'), 48, 92);
    ctx.fillStyle = '#7f95a3';
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(t('board.sub'), 50, 134);
    ctx.fillStyle = '#35e6d0';
    ctx.fillRect(48, 156, w - 96, 2);

    const gx = 48;
    const gy = 184;
    const gap = 18;
    const finaleW = 380;
    const cw = (w - 96 - finaleW - gap * 3) / 3;
    const chh = (h - gy - 44 - gap) / 2;
    const card = (i: number, x: number, y: number, cwid: number, chei: number, finale: boolean) => {
      ctx.fillStyle = finale ? 'rgba(255,162,58,0.07)' : 'rgba(255,255,255,0.035)';
      ctx.fillRect(x, y, cwid, chei);
      ctx.strokeStyle = finale ? 'rgba(255,162,58,0.55)' : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cwid - 2, chei - 2);
      ctx.fillStyle = finale ? '#ffa23a' : '#35e6d0';
      ctx.font = `600 20px ${MONO}`;
      ctx.fillText(finale ? t('board.finale') : `${t('board.prep')} 0${i}`, x + 20, y + 36);
      ctx.fillStyle = '#eef4f8';
      ctx.font = `600 36px ${FONT}`;
      ctx.fillText(t(`m${i}.name`), x + 20, y + 80, cwid - 40);
      ctx.fillStyle = '#94a4b0';
      ctx.font = `400 22px ${FONT}`;
      wrapText(ctx, t(`m${i}.desc`), x + 20, y + 114, cwid - 40, 28, finale ? 5 : 2);
      ctx.fillStyle = '#6f8090';
      ctx.font = `500 19px ${FONT}`;
      ctx.fillText(`${t('board.reward')}: ${t(`m${i}.reward`)}`, x + 20, y + chei - 20, cwid - 150);
      // status chip
      const chip = t('board.soon');
      ctx.font = `600 16px ${MONO}`;
      const tw = ctx.measureText(chip).width + 20;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + cwid - tw - 14, y + 16, tw, 28);
      ctx.fillStyle = '#b8c4cc';
      ctx.fillText(chip, x + cwid - tw - 4, y + 36);
    };
    for (let i = 0; i < 6; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      card(missions[i], gx + col * (cw + gap), gy + row * (chh + gap), cw, chh, false);
    }
    card(7, w - 48 - finaleW, gy, finaleW, chh * 2 + gap, true);

    if (!unlocked) {
      ctx.fillStyle = 'rgba(2,5,8,0.86)';
      ctx.fillRect(0, 168, w, h - 168);
      ctx.fillStyle = '#ffa23a';
      ctx.font = `700 54px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(t('board.locked'), w / 2, h / 2 + 70);
      ctx.textAlign = 'left';
    }
  });

  // ======================================================================
  // Practice vault (west)
  // ======================================================================
  // chamber behind the wall
  b.box(m.panel, 0.2, 2.7, 3.0, -11.75, 1.35, 0, { tile: 1.2 });
  b.box(m.panel, 2.5, 2.7, 0.2, -10.5, 1.35, -1.45, { tile: 1.2 });
  b.box(m.panel, 2.5, 2.7, 0.2, -10.5, 1.35, 1.45, { tile: 1.2 });
  b.box(m.panel, 2.7, 0.2, 3.0, -10.5, 2.7, 0, { tile: 1.2 });
  // steel frame around the door
  b.box(m.vault, 0.6, 2.45, 0.32, -9.15, 1.225, -1.11, { tile: 1, round: 0.03 });
  b.box(m.vault, 0.6, 2.45, 0.32, -9.15, 1.225, 1.11, { tile: 1, round: 0.03 });
  b.box(m.vault, 0.6, 0.32, 2.54, -9.15, 2.36, 0, { tile: 1, round: 0.03 });
  // hazard threshold on the floor
  b.box(m.hazard, 0.5, 0.012, 2.6, -8.6, 0.006, 0, { tile: 0.8, collide: false, shadow: false });
  b.box(m.hazard, 0.12, 0.012, 2.6, -7.2, 0.006, 0, { tile: 0.8, collide: false, shadow: false });

  // the door (animated, hinged on the south jamb)
  const door = new THREE.Group();
  door.position.set(-8.95, 0, 0.95);
  b.group.add(door);
  const slab = b.mesh(new RoundedBoxGeometry(0.3, 2.2, 1.9, 3, 0.03), m.vault, -0.15, 1.1, -0.95, door);
  void slab;
  b.mesh(new RoundedBoxGeometry(0.05, 1.7, 1.4, 2, 0.02), m.steel, 0.02, 1.1, -0.95, door);
  const wheel = new THREE.Group();
  wheel.position.set(0.1, 1.15, -0.95);
  door.add(wheel);
  b.mesh(new THREE.TorusGeometry(0.33, 0.028, 12, 48).rotateY(Math.PI / 2), m.steel, 0, 0, 0, wheel);
  for (let i = 0; i < 4; i++) {
    const spoke = b.mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.66, 10), m.steel, 0, 0, 0, wheel);
    spoke.rotation.x = (i * Math.PI) / 4;
  }
  b.mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.12, 20).rotateZ(Math.PI / 2), m.darkMetal, -0.02, 0, 0, wheel);
  for (const y of [0.45, 1.1, 1.75]) {
    b.mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 12).rotateX(Math.PI / 2), m.steel, -0.15, y, -1.88, door);
  }
  for (const y of [0.5, 1.7]) b.mesh(new RoundedBoxGeometry(0.1, 0.34, 0.12, 2, 0.02), m.darkMetal, -0.02, y, -0.06, door); // hinges
  const doorClosedCol: Collider = b.collider(VAULT_POS.x, 1.1, 0, 0.3, 2.2, 1.9);
  const doorOpenCol: Collider = b.collider(-8.006, 1.1, 1.134, 0.3, 2.2, 1.9, (-110 * Math.PI) / 180);
  physics.setEnabled(doorOpenCol, false);

  // status light above the door
  const statusMat = new THREE.MeshStandardMaterial({ color: 0, emissive: 0xff3040, emissiveIntensity: 2 });
  b.mesh(new THREE.BoxGeometry(0.03, 0.028, 1.3), statusMat, -8.84, 2.36, 0).castShadow = false;
  b.trackGlow(statusMat);
  const vaultLabel = b.decal(1.9, 0.24, -8.835, 2.68, 0, Math.PI / 2, 300, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(230,238,242,0.82)';
    ctx.font = `600 ${h * 0.62}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('vault.label'), w / 2, h / 2, w - 10);
  });

  // inside: pedestal + the comms kit
  b.cylinder(m.darkMetal, 0.24, 0.9, KIT_POS.x, 0.45, 0, { radiusTop: 0.2, segments: 28, tile: 1 });
  b.glowBox(COOL, 2.2, 0.02, 0.04, -10.5, 2.58, -1.3, 5);
  b.glowBox(COOL, 2.2, 0.02, 0.04, -10.5, 2.58, 1.3, 5);
  b.glowBox(TEAL, 0.02, 2.2, 0.04, -11.62, 1.3, 0, 3);
  const kit = new THREE.Group();
  kit.position.copy(KIT_POS);
  b.group.add(kit);
  b.mesh(new RoundedBoxGeometry(0.44, 0.13, 0.3, 3, 0.03), m.plastic, 0, 0, 0, kit);
  const kitGlow = new THREE.MeshStandardMaterial({ color: 0, emissive: TEAL, emissiveIntensity: 5 });
  b.trackGlow(kitGlow);
  b.mesh(new THREE.BoxGeometry(0.36, 0.008, 0.012), kitGlow, 0, 0.068, 0.09, kit).castShadow = false;
  b.mesh(new THREE.BoxGeometry(0.36, 0.008, 0.012), kitGlow, 0, 0.068, -0.09, kit).castShadow = false;
  b.mesh(new THREE.BoxGeometry(0.06, 0.02, 0.06), kitGlow, 0, 0.07, 0, kit).castShadow = false;
  const vaultLight = b.point(0xbfe8ff, 9, -10.5, 2.1, 0, 5, 1.6);

  // keypad (north of the door, facing east into the room)
  b.box(m.darkMetal, 0.07, 0.72, 0.42, -8.965, KEYPAD_POS.y + 0.06, KEYPAD_POS.z, { tile: 0.6, round: 0.015, collide: false });
  const keyMeshes: { mesh: THREE.Mesh; press: number; id: string; mat: THREE.MeshStandardMaterial }[] = [];
  const keyLayout: (number | 'c' | null)[][] = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    ['c', 0, null],
  ];
  const keyGeo = new RoundedBoxGeometry(0.024, 0.078, 0.078, 2, 0.008);
  keyLayout.forEach((row, r) =>
    row.forEach((k, c) => {
      if (k === null) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const drawKey = () => {
        ctx.fillStyle = '#0a0e13';
        ctx.fillRect(0, 0, 96, 96);
        ctx.fillStyle = k === 'c' ? '#ffa23a' : '#d9f6f2';
        ctx.font = `600 60px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(k === 'c' ? 'C' : String(k), 48, 53);
        tex.needsUpdate = true;
      };
      drawKey();
      keyRedraws.push(drawKey);
      const face = new THREE.MeshStandardMaterial({ color: 0x0c1015, roughness: 0.4, metalness: 0.3, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9 });
      b.trackGlow(face);
      // only the +x face shows the legend
      const mesh = new THREE.Mesh(keyGeo, [face, m.plastic, m.plastic, m.plastic, m.plastic, m.plastic]);
      mesh.position.set(-8.92, KEYPAD_POS.y + 0.14 - r * 0.096, KEYPAD_POS.z + (1 - c) * 0.096);
      b.group.add(mesh);
      const id = 'key-' + k;
      const entry = { mesh, press: 0, id, mat: face };
      keyMeshes.push(entry);
      interactions.add({
        id,
        object: mesh,
        range: 1.9,
        prompt: () => (!session || tut()?.open ? null : k === 'c' ? t('prompt.clear') : t('prompt.key', { k: String(k) })),
        onUse: () => {
          entry.press = 1;
          session?.intent('key', { k });
        },
        onFocus: (f) => (face.emissiveIntensity = (f ? 2.2 : 0.9) * b.getPower()),
      });
    }),
  );
  const padDisplay = b.screen(0.3, 0.085, -8.925, KEYPAD_POS.y + 0.275, KEYPAD_POS.z, Math.PI / 2, 900, (ctx, w, h) => {
    const s = tut();
    ctx.fillStyle = '#02060a';
    ctx.fillRect(0, 0, w, h);
    const flash = padFlash > 0;
    ctx.fillStyle = s?.open ? '#5dff8f' : flash ? '#ff4d5e' : '#35e6d0';
    ctx.font = `600 ${h * 0.7}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let text = '';
    if (s?.open) text = 'OPEN';
    else if (flash) text = 'ERROR';
    else for (let i = 0; i < 4; i++) text += (s && i < s.entered.length ? '●' : '○') + (i < 3 ? ' ' : '');
    ctx.fillText(text, w / 2, h / 2 + 2);
    // strikes
    if (s && !s.open) {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < s.strikes ? '#ff4d5e' : 'rgba(255,255,255,0.15)';
        ctx.fillRect(w - 14, 8 + i * 20, 6, 14);
      }
    }
  });
  // entry-order legend, next to the keypad
  b.box(m.darkMetal, 0.06, 0.78, 0.6, -8.97, 1.42, -2.72, { tile: 0.6, round: 0.015, collide: false });
  const legend = b.screen(0.52, 0.7, -8.935, 1.42, -2.72, Math.PI / 2, 520, (ctx, w, h) => {
    const s = tut();
    ctx.fillStyle = '#03070b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7f95a3';
    ctx.font = `600 ${w * 0.1}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('legend.title'), w * 0.08, h * 0.09, w * 0.84);
    if (!s) return;
    const rowH = h * 0.2;
    s.order.forEach((c, i) => {
      const y = h * 0.2 + i * rowH;
      ctx.fillStyle = '#9fb0bc';
      ctx.font = `600 ${rowH * 0.5}px ${MONO}`;
      ctx.fillText(String(i + 1), w * 0.08, y + rowH / 2);
      ctx.fillStyle = COLORS[c];
      ctx.fillRect(w * 0.25, y + rowH * 0.18, rowH * 0.64, rowH * 0.64);
      ctx.font = `600 ${rowH * 0.44}px ${FONT}`;
      ctx.fillText(t(COLOR_KEYS[c]), w * 0.25 + rowH * 0.86, y + rowH / 2, w * 0.46);
    });
  });

  // ======================================================================
  // Decoder nook (south-east)
  // ======================================================================
  b.box(m.panel, 0.3, H, 3.5, 3.05, H / 2, 5.25, { tile: 2 });
  b.box(m.darkMetal, 2.9, 1.7, 0.12, DECODER_POS.x, DECODER_POS.y, 6.94, { tile: 1, round: 0.03, collide: false });
  b.box(m.darkMetal, 3.1, 0.82, 0.7, DECODER_POS.x, 0.41, 6.6, { tile: 1, round: 0.03 });
  b.box(m.black, 2.8, 0.02, 0.5, DECODER_POS.x, 0.83, 6.55, { collide: false, shadow: false });
  for (let i = 0; i < 9; i++) b.glowBox(i % 4 === 0 ? AMBER : TEAL, 0.06, 0.012, 0.03, DECODER_POS.x - 1.2 + i * 0.3, 0.846, 6.4, 2.4);
  const decoder = b.screen(2.6, 1.42, DECODER_POS.x, DECODER_POS.y, 6.87, Math.PI, 300, (ctx, w, h) => {
    const s = tut();
    ctx.fillStyle = '#03060a';
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    if (!s || !isPowered()) {
      ctx.fillStyle = 'rgba(255,77,94,0.5)';
      ctx.font = `600 ${h * 0.13}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(t('decoder.nopower'), w / 2, h / 2);
      return;
    }
    ctx.fillStyle = '#7f95a3';
    ctx.font = `600 ${h * 0.085}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(t('decoder.title'), w * 0.04, h * 0.1);
    const cellW = w * 0.215;
    s.slots.forEach((c, i) => {
      const x = w * 0.04 + i * (cellW + w * 0.02);
      const y = h * 0.2;
      ctx.strokeStyle = COLORS[c];
      ctx.lineWidth = 5;
      ctx.strokeRect(x, y, cellW, h * 0.6);
      ctx.fillStyle = COLORS[c];
      ctx.textAlign = 'center';
      ctx.font = `700 ${h * 0.4}px ${MONO}`;
      ctx.fillText(String(s.code[c]), x + cellW / 2, y + h * 0.26);
      ctx.font = `600 ${h * 0.085}px ${FONT}`;
      ctx.fillText(t(COLOR_KEYS[c]), x + cellW / 2, y + h * 0.52, cellW - 12);
    });
    // capacitor bar (only drains once the relay is released)
    const frac = s.relayBy ? 1 : Math.max(0, Math.min(1, (s.powerUntil - (session?.hostNow() ?? 0)) / POWER_HOLD_MS));
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(w * 0.04, h * 0.88, w * 0.92, h * 0.045);
    ctx.fillStyle = frac > 0.3 ? '#35e6d0' : '#ff4d5e';
    ctx.fillRect(w * 0.04, h * 0.88, w * 0.92 * frac, h * 0.045);
  });
  const decoderLight = b.point(0x7fe8ff, 0, DECODER_POS.x, 1.9, 5.9, 5, 1.8);

  // ======================================================================
  // Power closet (north-east)
  // ======================================================================
  b.box(m.panel, 3.0, H, 0.25, 7.5, H / 2, -3.875, { tile: 2 });
  b.box(m.panel, 0.25, H, 1.0, 5.975, H / 2, -6.5, { tile: 2 });
  b.box(m.panel, 0.25, H, 0.95, 5.975, H / 2, -4.475, { tile: 2 });
  b.box(m.panel, 0.25, H - 2.25, 1.05, 5.975, 2.25 + (H - 2.25) / 2, -5.475, { tile: 2 });
  b.box(m.hazard, 0.27, 0.12, 1.05, 5.975, 2.19, -5.475, { tile: 0.5, collide: false });
  b.box(m.hazard, 0.5, 0.012, 1.05, 5.9, 0.006, -5.475, { tile: 0.8, collide: false, shadow: false });
  const closetLabel = b.decal(0.9, 0.3, 5.845, 2.62, -5.475, -Math.PI / 2, 300, (ctx, w, h) => {
    ctx.fillStyle = '#ffa23a';
    ctx.font = `700 ${h * 0.7}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡ ' + t('closet.label'), w / 2, h / 2, w - 8);
  }, 1.6);
  // breaker cabinets
  for (const x of [6.7, 7.6, 8.5]) {
    b.box(m.darkMetal, 0.8, 2.0, 0.45, x, 1.0, -6.76, { tile: 1, round: 0.02 });
    for (let i = 0; i < 4; i++) b.glowBox(i === 1 ? AMBER : 0x5dff8f, 0.03, 0.03, 0.01, x - 0.24 + i * 0.16, 1.65, -6.53, 2.5);
  }
  // relay housing + lever
  b.box(m.darkMetal, 0.16, 0.74, 0.5, 8.92, RELAY_POS.y, RELAY_POS.z, { tile: 0.6, round: 0.02, collide: false });
  b.box(m.hazard, 0.165, 0.08, 0.5, 8.92, RELAY_POS.y + 0.41, RELAY_POS.z, { tile: 0.4, collide: false });
  const lever = new THREE.Group();
  lever.position.set(8.83, RELAY_POS.y - 0.05, RELAY_POS.z);
  b.group.add(lever);
  b.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 10).translate(0, 0.18, 0), m.steel, 0, 0, 0, lever);
  const gripMat = new THREE.MeshStandardMaterial({ color: 0xb3202c, roughness: 0.5, metalness: 0.1 });
  const grip = b.mesh(new THREE.CapsuleGeometry(0.034, 0.1, 6, 12).rotateX(Math.PI / 2).translate(0, 0.38, 0), gripMat, 0, 0, 0, lever);
  b.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 14).rotateX(Math.PI / 2), m.darkMetal, 0, 0, 0, lever);
  lever.rotation.z = 0.5; // off: handle up, leaning into the room
  const relayLamp = new THREE.MeshStandardMaterial({ color: 0, emissive: 0xff3040, emissiveIntensity: 3.5 });
  b.trackGlow(relayLamp);
  b.mesh(new THREE.SphereGeometry(0.03, 12, 10), relayLamp, 8.83, RELAY_POS.y + 0.27, RELAY_POS.z).castShadow = false;
  // a big invisible-ish target so the lever is easy to aim at
  const relayTarget = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.56), new THREE.MeshBasicMaterial({ visible: false }));
  relayTarget.position.set(8.8, RELAY_POS.y, RELAY_POS.z);
  b.group.add(relayTarget);
  void grip;

  // ======================================================================
  // East wall: lockers + crates
  // ======================================================================
  for (let i = 0; i < 5; i++) {
    const z = -3.1 + i * 0.98;
    b.box(m.darkMetal, 0.62, 2.15, 0.92, 8.68, 1.075, z, { tile: 1, round: 0.025 });
    b.box(m.black, 0.02, 1.9, 0.02, 8.365, 1.1, z + 0.46, { collide: false, shadow: false });
    b.glowBox(i === 0 ? TEAL : AMBER, 0.012, 0.035, 0.26, 8.365, 1.72, z, i === 0 ? 3 : 1.2);
    b.box(m.steel, 0.03, 0.16, 0.03, 8.35, 1.05, z - 0.32, { collide: false });
  }
  const crate = (x: number, y: number, z: number, s: number, rot: number) => {
    b.box(m.plastic, s, s * 0.72, s * 1.25, x, y + s * 0.36, z, { rotY: rot, round: 0.04, tile: 1 });
    b.box(m.steel, s * 1.02, 0.03, s * 0.08, x, y + s * 0.5, z, { rotY: rot, collide: false });
  };
  crate(-5.9, 0, -6.1, 0.95, 0.12);
  crate(-5.95, 0.69, -6.15, 0.8, -0.2);
  crate(-4.7, 0, -6.3, 0.85, -0.5);
  crate(7.9, 0, 2.55, 0.9, 0.05);
  crate(8.0, 0.65, 2.6, 0.7, 0.4);
  crate(4.2, 0, -6.3, 0.9, 0.3);

  // ======================================================================
  // Garage bay + van (south-west)
  // ======================================================================
  for (let i = 0; i < 15; i++) b.box(m.steel, 4.3, 0.2, 0.05, -5.0, 0.12 + i * 0.212, 6.97, { tile: 1.2, collide: false });
  b.box(m.hazard, 0.16, 3.3, 0.16, -7.25, 1.65, 6.92, { tile: 0.5, collide: false });
  b.box(m.hazard, 0.16, 3.3, 0.16, -2.75, 1.65, 6.92, { tile: 0.5, collide: false });
  b.box(m.darkMetal, 4.8, 0.3, 0.3, -5.0, 3.4, 6.88, { tile: 1, collide: false });
  b.glowBox(0xff3040, 0.5, 0.08, 0.05, -5.0, 3.4, 6.71, 1.8);

  const paint = new THREE.MeshStandardMaterial({ color: 0x171b22, roughness: 0.3, metalness: 0.7, envMapIntensity: 1.5 });
  const tint = new THREE.MeshStandardMaterial({ color: 0x04070a, roughness: 0.04, metalness: 0.95, envMapIntensity: 2 });
  const VX = -5.0;
  const VZ = 3.5;
  const van = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material = paint, round = 0.1) =>
    b.box(mat, sx, sy, sz, VX + x, y, VZ + z, { round, collide: false, tile: 2 });
  van(2.05, 1.55, 3.1, 0, 1.3, -0.75, paint, 0.12); // cargo box
  van(1.96, 1.2, 1.5, 0, 1.12, 1.45, paint, 0.2); // cab
  van(1.9, 0.62, 0.95, 0, 0.83, 2.4, paint, 0.16); // hood
  van(1.74, 0.5, 0.05, 0, 1.42, 2.215, tint, 0.01); // windshield
  van(2.08, 0.16, 0.16, 0, 0.5, 2.86, m.rubber, 0.04); // bumpers
  van(2.08, 0.16, 0.16, 0, 0.5, -2.3, m.rubber, 0.04);
  van(1.3, 0.2, 0.03, 0, 0.8, 2.88, m.black, 0.01); // grille
  van(0.02, 1.42, 0.012, 0, 1.3, -2.306, m.black, 0); // rear door seam
  for (const sx of [-1, 1]) {
    van(0.03, 0.42, 0.95, sx * 0.975, 1.42, 1.48, tint, 0.01); // cab side window
    van(0.012, 1.34, 0.02, sx * 1.028, 1.3, 0.35, m.black, 0); // sliding door seams
    van(0.012, 1.34, 0.02, sx * 1.028, 1.3, -1.0, m.black, 0);
    van(0.012, 0.02, 1.36, sx * 1.028, 1.97, -0.33, m.black, 0);
    van(0.03, 0.04, 0.17, sx * 1.035, 1.16, 0.18, m.steel, 0.01); // handle
    van(0.06, 0.09, 1.02, sx * 1.02, 0.83, 1.9, m.rubber, 0.02); // wheel arch trims
    van(0.06, 0.09, 1.02, sx * 1.02, 0.83, -1.45, m.rubber, 0.02);
    van(0.16, 0.2, 0.08, sx * 1.08, 1.36, 2.02, m.plastic, 0.03); // mirror
    van(0.04, 0.04, 2.8, sx * 0.7, 2.11, -0.8, m.steel, 0.01); // roof rails
    van(0.14, 0.04, 0.03, sx * 0.13, 1.2, -2.312, m.steel, 0.01); // rear handles
    for (const wz of [1.9, -1.45]) {
      const tire = new THREE.CylinderGeometry(0.39, 0.39, 0.28, 28).rotateZ(Math.PI / 2).translate(VX + sx * 0.93, 0.39, VZ + wz);
      b.addStatic(m.rubber, tire);
      const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 20).rotateZ(Math.PI / 2).translate(VX + sx * 0.94, 0.39, VZ + wz);
      b.addStatic(m.steel, hub);
    }
    b.glowBox(0xff2030, 0.1, 0.42, 0.02, VX + sx * 0.85, 1.05, VZ - 2.31, 2.2);
    b.glowBox(0xfff1d0, 0.3, 0.1, 0.02, VX + sx * 0.65, 0.86, VZ + 2.885, 0.25);
  }
  for (const rz of [-2.0, -1.2, -0.4, 0.4]) van(1.44, 0.03, 0.04, 0, 2.12, rz, m.steel, 0.01);
  b.glowBox(TEAL, 0.012, 0.012, 2.9, VX + 1.032, 0.62, VZ - 0.75, 1.6);
  b.glowBox(TEAL, 0.012, 0.012, 2.9, VX - 1.032, 0.62, VZ - 0.75, 1.6);
  b.collider(VX, 1.1, VZ + 0.25, 2.1, 2.2, 5.5);
  const bay = b.decal(2.2, 0.7, -2.2, 0.012, 5.2, 0, 160, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(214,150,22,0.55)';
    ctx.font = `700 ${h * 0.8}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BAY 01', w / 2, h / 2);
  });
  bay.mesh.rotation.set(-Math.PI / 2, 0, Math.PI); // readable when walking towards the door

  // ======================================================================
  // Custodian dock (north-west) + the unit itself
  // ======================================================================
  b.box(m.darkMetal, 1.3, 2.6, 0.12, CUSTODIAN_A.x, 1.3, -6.93, { tile: 1, round: 0.03, collide: false });
  b.box(m.darkMetal, 1.3, 0.1, 0.9, CUSTODIAN_A.x, 0.05, -6.55, { tile: 1, round: 0.02, collide: false });
  b.box(m.darkMetal, 0.1, 2.6, 0.5, CUSTODIAN_A.x - 0.65, 1.3, -6.72, { tile: 1, collide: false });
  b.box(m.darkMetal, 0.1, 2.6, 0.5, CUSTODIAN_A.x + 0.65, 1.3, -6.72, { tile: 1, collide: false });
  b.glowBox(0xff3040, 0.04, 0.04, 0.02, CUSTODIAN_A.x + 0.5, 2.4, -6.85, 1.4);
  const custodian = new Custodian(b.group);
  custodian.place(CUSTODIAN_A.x, CUSTODIAN_A.z, CUSTODIAN_A.yaw);
  const custColA = physics.addCylinder(CUSTODIAN_A.x, 1.05, CUSTODIAN_A.z, 0.34, 2.1);
  const custColB = physics.addCylinder(CUSTODIAN_B.x, 1.05, CUSTODIAN_B.z, 0.34, 2.1);
  physics.setEnabled(custColB, false);
  let custodianAtB = false;
  const setCustodian = (atB: boolean) => {
    if (atB === custodianAtB) return;
    custodianAtB = atB;
    const p = atB ? CUSTODIAN_B : CUSTODIAN_A;
    custodian.place(p.x, p.z, p.yaw);
    custodian.setAwake(atB);
    physics.setEnabled(custColA, !atB);
    physics.setEnabled(custColB, atB);
  };
  interactions.add({
    id: 'custodian',
    object: custodian.group,
    range: 2.6,
    prompt: () => t('prompt.custodian'),
    onUse: () => ui.say('sub.custodian'),
  });

  // ======================================================================
  // Lights
  // ======================================================================
  b.hemisphere(0x8fa6c8, 0x1a1410, 0.32);
  b.spot(COOL, 190, 0, H - 0.1, 0, 0, 0, 0, { angle: 0.62, penumbra: 0.75, distance: 9, shadow: true });
  b.cone(COOL, 0, H - 0.15, 0, 2.6, 3.4, 0.05);
  b.spot(COOL, 150, -6.3, H - 0.1, 0, -8.9, 0.9, 0, { angle: 0.55, penumbra: 0.7, distance: 10, shadow: true });
  b.cone(COOL, -6.3, H - 0.15, 0, 1.5, 2.8, 0.035).rotation.z = -0.62;
  b.point(AMBER, 14, 0, 3.0, -5.3, 9);
  b.point(WARM, 16, -5.2, 3.3, 3.2, 9);
  b.point(AMBER, 9, 7.3, 2.9, -0.6, 7);
  b.point(0xff4030, 7, 7.5, 2.9, -5.5, 5);
  b.glowBox(0xff3040, 0.5, 0.05, 0.16, 7.5, H - 0.03, -5.5, 4);
  b.point(0x9fc0ff, 2.2, CUSTODIAN_A.x, 2.5, -5.4, 5);
  b.point(TEAL, 7, 0, 1.75, 0, 5.5);
  b.point(WARM, 12, 5.4, 3.2, 1.2, 8);
  const dustA = b.dust(0, 2.2, 0, 6, 4, 6, 320);
  const dustB = b.dust(-6.6, 2.0, 0, 4, 3.5, 4, 160);

  b.finalize();

  // ======================================================================
  // State helpers
  // ======================================================================
  const redrawPuzzle = () => {
    board.redraw();
    padDisplay.redraw();
    legend.redraw();
    decoder.redraw();
  };

  const redraw = () => {
    redrawPuzzle();
    vaultLabel.redraw();
    closetLabel.redraw();
    bay.redraw();
    for (const r of keyRedraws) r();
  };
  unsubs.push(onLangChange(redraw));

  interactions.add({
    id: 'relay',
    object: relayTarget,
    hold: true,
    range: 2.2,
    prompt: () => {
      const s = tut();
      if (!s || s.open) return null;
      if (s.relayBy && s.relayBy !== session!.pid) return null;
      return s.relayBy === session!.pid ? t('prompt.relay.held') : t('prompt.relay');
    },
    onHoldStart: () => session?.intent('relay', { down: true }),
    onHoldEnd: () => session?.intent('relay', { down: false }),
  });
  interactions.add({
    id: 'kit',
    object: kit,
    range: 2.4,
    prompt: () => {
      const s = tut();
      return s && s.open && !s.kit && doorProgress >= 1 ? t('prompt.kit') : null;
    },
    onUse: () => session?.intent('kit'),
  });
  interactions.add({
    id: 'board',
    object: board.mesh,
    range: 5,
    prompt: () => {
      const s = tut();
      if (!s) return null;
      return s.kit ? (s.board ? null : t('prompt.board')) : null;
    },
    onUse: () => session?.intent('board'),
  });

  // ---------------------------------------------------------------- host logic
  const installHost = (s: Session) => {
    const campaign = loadCampaign();
    if (!s.get('tut')) {
      const done = campaign.crewReady;
      const init: Tut = {
        ...newPuzzle(),
        entered: [],
        strikes: 0,
        relayBy: null,
        powerUntil: 0,
        seen: done,
        open: done,
        openAt: done ? -1e9 : 0,
        kit: done,
        moved: done,
        board: false,
      };
      s.set('tut', init);
    }
    const release = () => {
      s.set('tut.relayBy', null);
      s.set('tut.powerUntil', s.hostNow() + POWER_HOLD_MS);
      s.emit('sfx', { n: 'relayOff', p: RELAY_POS.toArray() });
    };
    s.handle('relay', (pid, a) => {
      const cur = s.get<Tut>('tut');
      if (cur.open) return;
      if (a?.down) {
        if (cur.relayBy) return;
        s.set('tut.relayBy', pid);
        s.emit('sfx', { n: 'relayOn', p: RELAY_POS.toArray() });
        if (!cur.seen) {
          s.set('tut.seen', true);
          s.emit('say', { k: 'sub.power' });
        }
      } else if (cur.relayBy === pid) release();
    });
    s.handle('key', (_pid, a) => {
      const cur = s.get<Tut>('tut');
      if (cur.open) return;
      const k = a?.k;
      s.emit('sfx', { n: 'key', p: KEYPAD_POS.toArray(), r: k === 'c' ? 0.7 : 1 + (Number(k) % 5) * 0.03 });
      if (k === 'c') {
        s.set('tut.entered', []);
        return;
      }
      if (typeof k !== 'number' || k < 0 || k > 9 || cur.entered.length >= 4) return;
      const entered = [...cur.entered, k];
      if (entered.length < 4) {
        s.set('tut.entered', entered);
        return;
      }
      const solution = cur.order.map((c) => cur.code[c]);
      if (entered.every((d, i) => d === solution[i])) {
        s.set('tut.entered', entered);
        s.set('tut.relayBy', null);
        s.set('tut.powerUntil', 0);
        s.set('tut.openAt', s.hostNow());
        s.set('tut.open', true);
        s.emit('vault');
        s.emit('say', { k: 'sub.open' });
      } else {
        s.set('tut.entered', []);
        const strikes = cur.strikes + 1;
        s.emit('wrong');
        if (strikes >= 3) {
          const p = newPuzzle();
          s.set('tut.code', p.code);
          s.set('tut.order', p.order);
          s.set('tut.slots', p.slots);
          s.set('tut.strikes', 0);
          s.emit('flicker');
          s.emit('say', { k: 'sub.reroll' });
        } else {
          s.set('tut.strikes', strikes);
          s.emit('say', { k: 'sub.wrong' });
        }
      }
    });
    s.handle('kit', () => {
      const cur = s.get<Tut>('tut');
      if (!cur.open || cur.kit) return;
      s.set('tut.kit', true);
      s.emit('sfx', { n: 'pickup', p: KIT_POS.toArray() });
      s.emit('say', { k: 'sub.kit' });
      const at = s.hostNow() + 9500;
      s.emit('blackout', { at });
      window.setTimeout(() => s.set('tut.moved', true), 9500 + 700);
      window.setTimeout(() => s.emit('say', { k: 'sub.dark' }), 9500 + 4200);
      const c = loadCampaign();
      c.crewReady = true;
      saveCampaign(c);
    });
    s.handle('board', () => {
      const cur = s.get<Tut>('tut');
      if (cur.kit && !cur.board) {
        s.set('tut.board', true);
        s.emit('sfx', { n: 'ok', p: [0, 2, -6.8] });
      }
    });
    // if whoever holds the relay drops out, let go for them
    const prevRoster = s.onRoster;
    s.onRoster = (joined, left) => {
      prevRoster?.(joined, left);
      if (left && s.get<Tut>('tut')?.relayBy === left.pid) release();
    };
  };

  const attach = (s: Session) => {
    session = s;
    introShown = false;
    blackoutAt = -1;
    blackoutStage = 0;
    if (s.isHost) installHost(s);
    unsubs.push(
      s.onState((path) => {
        if (path === '' || path.startsWith('tut')) {
          const cur = tut();
          if (cur && path === '') {
            // joined mid-session: snap to the current world
            doorProgress = cur.open && s.hostNow() - cur.openAt > 4000 ? 1 : 0;
          }
          if (cur?.moved) setCustodian(true);
          if (cur?.kit) {
            const c = loadCampaign();
            if (!c.crewReady) {
              c.crewReady = true;
              saveCampaign(c); // mirror, so any crew member can host next time
            }
          }
          redrawPuzzle();
        }
      }),
      s.onEvent((name, a) => {
        switch (name) {
          case 'sfx':
            audio.play(a.n, { pos: a.p ? new THREE.Vector3().fromArray(a.p) : undefined, rate: a.r });
            break;
          case 'say':
            ui.say(a.k);
            audio.play('radio');
            break;
          case 'vault':
            audio.play('vaultOpen', { pos: VAULT_POS });
            break;
          case 'wrong':
            padFlash = 0.9;
            audio.play('deny', { pos: KEYPAD_POS });
            padDisplay.redraw();
            break;
          case 'flicker':
            flickerT = 0;
            break;
          case 'blackout':
            blackoutAt = a.at;
            blackoutStage = 0;
            break;
        }
      }),
    );
    const cur = tut();
    if (cur) {
      doorProgress = cur.open && s.hostNow() - cur.openAt > 4000 ? 1 : 0;
      setCustodian(cur.moved);
    }
    redrawPuzzle();
  };

  const detach = () => {
    session = null;
    relayHum?.stop();
    relayHum = null;
    poweredLocal = false;
    lastRelayBy = null;
    doorProgress = 0;
    blackoutAt = -1;
    flickerT = -1;
    b.setPower(1);
    engine.scene.environmentIntensity = ENV_INTENSITY;
    ui.setVeil(0);
    setCustodian(false);
    custodian.setAwake(false);
    redrawPuzzle();
  };

  const ENV_INTENSITY = 1.0;
  engine.captureEnvironment(new THREE.Vector3(0.6, 1.7, 1.6), ENV_INTENSITY);

  const applyPower = (f: number) => {
    b.setPower(f);
    engine.scene.environmentIntensity = ENV_INTENSITY * f;
  };

  const tmpV = new THREE.Vector3();

  const update = (dt: number, time: number) => {
    // ambient motion (also runs behind the main menu)
    holo.rotation.y = time * 0.22;
    vaultNode.rotation.y = -time * 0.9;
    vaultNode.rotation.x = time * 0.5;
    const pulse = 0.75 + 0.25 * Math.sin(time * 3.1);
    vaultNodeMat.color.setRGB(2.6 * pulse, 0.7 * pulse, 0.15 * pulse);
    holoMat.opacity = 0.8 + 0.08 * Math.sin(time * 17) * Math.sin(time * 2.3);
    dustA(time);
    dustB(time);
    b.updateShadows(time);

    for (const k of keyMeshes) {
      if (k.press > 0) {
        k.press = Math.max(0, k.press - dt * 7);
        k.mesh.position.x = -8.92 - 0.011 * Math.sin(k.press * Math.PI);
      }
    }

    const player = deps.player();
    custodian.update(dt, engine.camera, physics, player?.body.collider);

    const s = tut();
    if (!session || !s) {
      statusMat.emissive.setHex(0xff3040);
      return;
    }
    const now = session.hostNow();

    // intro lines, once per session, only while the puzzle is still unsolved
    if (!introShown) {
      introShown = true;
      if (!s.open) {
        ui.say('sub.intro1');
        ui.say('sub.intro2');
      }
    }

    // --- relay + decoder power
    if (s.relayBy !== lastRelayBy) {
      lastRelayBy = s.relayBy;
      if (s.relayBy) relayHum ??= audio.hum(RELAY_POS, 0.3);
      else {
        relayHum?.stop(0.4);
        relayHum = null;
      }
    }
    const targetLever = s.relayBy ? 2.35 : 0.5; // on: pulled down
    lever.rotation.z += (targetLever - lever.rotation.z) * (1 - Math.exp(-16 * dt));
    relayLamp.emissive.setHex(s.relayBy ? 0x5dff8f : 0xff3040);

    const powered = isPowered();
    if (powered !== poweredLocal) {
      poweredLocal = powered;
      if (!powered) audio.play('powerDown', { pos: DECODER_POS });
      else audio.play('lightsOn', { pos: DECODER_POS, vol: 0.6 });
      decoder.redraw();
    }
    decoderLight.intensity = (powered ? 10 : 0) * b.getPower();
    if (powered && !s.relayBy && time - lastDecoderDraw > 0.2) {
      lastDecoderDraw = time;
      decoder.redraw(); // capacitor bar draining
    }

    // --- keypad feedback
    if (padFlash > 0) {
      padFlash -= dt;
      if (padFlash <= 0) padDisplay.redraw();
    }

    // --- vault door
    if (s.open) {
      const tt = (now - s.openAt) / 1000;
      const target = Math.max(0, Math.min(1, (tt - 0.75) / 2.35));
      if (target > doorProgress) doorProgress = target;
      statusMat.emissive.setHex(0x5dff8f);
    } else {
      doorProgress = 0;
      statusMat.emissive.setHex(0xff3040);
    }
    const ease = doorProgress * doorProgress * (3 - 2 * doorProgress);
    door.rotation.y = (-110 * Math.PI) / 180 * ease;
    wheel.rotation.x = s.open ? Math.min(1, Math.max(0, (now - s.openAt) / 700)) * Math.PI * 1.5 : 0;
    physics.setEnabled(doorClosedCol, doorProgress < 0.55);
    physics.setEnabled(doorOpenCol, doorProgress >= 1);
    kit.visible = !s.kit;
    if (!s.kit) {
      kit.position.y = KIT_POS.y + Math.sin(time * 1.6) * 0.012;
      kit.rotation.y = time * 0.4;
    }
    vaultLight.intensity = (s.open ? 9 : 0) * b.getPower();

    // --- flicker (code re-roll)
    if (flickerT >= 0) {
      flickerT += dt;
      const pattern = [0.15, 1, 0.05, 0.8, 0.1, 1, 0.3, 1];
      const i = Math.floor(flickerT / 0.07);
      if (i >= pattern.length) {
        flickerT = -1;
        applyPower(1);
      } else applyPower(pattern[i]);
    }

    // --- the blackout: lights die, something moves, lights return
    if (blackoutAt >= 0) {
      const bt = (now - blackoutAt) / 1000;
      if (blackoutStage === 0 && bt >= 0) {
        blackoutStage = 1;
        applyPower(0);
        ui.setVeil(0.55, true);
        if (player) player.flashlightGlitch = 2.3;
        audio.play('blackout');
      }
      if (blackoutStage === 1 && bt >= 0.7) {
        blackoutStage = 2;
        setCustodian(true);
        audio.play('scrape', { pos: tmpV.set(CUSTODIAN_B.x, 1.2, CUSTODIAN_B.z) });
      }
      if (blackoutStage === 2 && bt >= 1.95) {
        blackoutStage = 3;
        audio.play('lightsOn');
        ui.setVeil(0, true);
      }
      if (blackoutStage === 3) {
        // stutter back on
        const k = bt - 1.95;
        const pattern = [0.5, 0, 0.8, 0.15, 1];
        const i = Math.floor(k / 0.07);
        if (i >= pattern.length) {
          blackoutStage = 4;
          applyPower(1);
          custodian.flashEyes();
          audio.play('stinger', { vol: 0.8 });
        } else applyPower(pattern[i]);
      }
      if (blackoutStage === 4 && bt > 6) blackoutAt = -1;
    }
  };

  const spawnPoints: [number, number][] = [
    [-1.3, 4.3],
    [0.1, 4.8],
    [1.4, 4.3],
    [0.0, 3.5],
  ];

  return {
    spawn(index: number) {
      const [x, z] = spawnPoints[index % spawnPoints.length];
      return { pos: new THREE.Vector3(x, 0.02, z), yaw: 0 };
    },
    menuCamera(time, cam) {
      cam.position.set(1.2 + Math.sin(time * 0.09) * 0.6, 1.72 + Math.sin(time * 0.13) * 0.06, 5.5 + Math.cos(time * 0.07) * 0.35);
      cam.lookAt(-1.9, 1.55, -2.5);
    },
    attach,
    detach,
    update,
    objective() {
      const s = tut();
      if (!s) return [];
      if (!s.open) return s.seen ? [t('obj.read'), t('obj.enter')] : [t('obj.relay')];
      if (!s.kit) return [t('obj.kit')];
      if (!s.board) return [t('obj.board')];
      return [t('obj.done')];
    },
    redraw,
  };
}
