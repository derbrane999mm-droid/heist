// Style sample for the realistic, present-day look: a corner of the Meridian
// casino floor at night, after closing. Static (nothing replicated yet).
import * as THREE from 'three';
import { Builder, FONT } from '../build';
import { realMat } from '../realmats';
import { model } from '../models';
import { registerStrings, t } from '../../core/i18n';
import type { Level, LevelDeps } from '../level';

registerStrings(
  {
    'casino.obj': 'Style sample: have a look around the casino floor',
    'casino.reader': 'Swipe the staff card',
    'casino.reader.no': 'No card. The reader blinks red.',
  },
  {
    'casino.obj': 'Stilprobe: Sieh dich im Spielsaal um',
    'casino.reader': 'Personalkarte durchziehen',
    'casino.reader.no': 'Keine Karte. Der Leser blinkt rot.',
  },
);

const W = 8; // half width (x)
const D = 11; // half depth (z)
const H = 3.4;

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void, repeatMetres?: number) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeatMetres) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2 / repeatMetres, 2 / repeatMetres);
  }
  return tex;
}

/** Loud casino carpet: wine red with gold fans and teal diamonds. */
function carpetPattern(c: CanvasRenderingContext2D, s: number) {
  c.fillStyle = '#3b1420';
  c.fillRect(0, 0, s, s);
  const n = 4;
  const cell = s / n;
  for (let iy = -1; iy <= n; iy++) {
    for (let ix = -1; ix <= n; ix++) {
      const ox = ix * cell + (iy % 2 ? cell / 2 : 0);
      const oy = iy * cell;
      // fan
      for (let r = 5; r >= 1; r--) {
        c.beginPath();
        c.arc(ox + cell / 2, oy + cell, (cell / 2) * (r / 5), Math.PI, 0);
        c.fillStyle = r % 2 ? '#5a1f2c' : '#461826';
        c.fill();
        c.lineWidth = s / 260;
        c.strokeStyle = r === 5 ? '#c19a4a' : '#8f6f35';
        c.stroke();
      }
      // diamond between the fans
      c.save();
      c.translate(ox, oy + cell);
      c.rotate(Math.PI / 4);
      const d = cell * 0.13;
      c.fillStyle = '#1f4d4a';
      c.fillRect(-d, -d, d * 2, d * 2);
      c.lineWidth = s / 340;
      c.strokeStyle = '#c19a4a';
      c.strokeRect(-d, -d, d * 2, d * 2);
      c.restore();
    }
  }
  // wool speckle so it does not look printed
  const img = c.getImageData(0, 0, s, s);
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const k = 0.86 + Math.random() * 0.22;
    p[i] *= k;
    p[i + 1] *= k;
    p[i + 2] *= k;
  }
  c.putImageData(img, 0, 0);
}

function arcText(c: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, spread: number) {
  const step = spread / Math.max(1, text.length - 1);
  for (let i = 0; i < text.length; i++) {
    const phi = -spread / 2 + i * step;
    c.save();
    c.translate(cx + r * Math.sin(phi), cy + r * Math.cos(phi));
    c.rotate(-phi);
    c.fillText(text[i], 0, 0);
    c.restore();
  }
}

/** Blackjack layout, drawn as the player sees it (dealer edge at the top). */
function blackjackFelt(c: CanvasRenderingContext2D, s: number) {
  c.fillStyle = '#17503a';
  c.fillRect(0, 0, s, s);
  c.save();
  c.translate(s, s / 2);
  c.rotate(Math.PI);
  const cx = s / 2;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.strokeStyle = '#d9c88a';
  c.fillStyle = '#d9c88a';
  c.lineWidth = s / 300;
  c.beginPath();
  c.arc(cx, 0, s * 0.3, 0.12 * Math.PI, 0.88 * Math.PI);
  c.stroke();
  c.font = `700 ${s * 0.034}px ${FONT}`;
  arcText(c, 'BLACKJACK PAYS 3 TO 2', cx, 0, s * 0.215, 1.5);
  c.font = `600 ${s * 0.02}px ${FONT}`;
  arcText(c, 'DEALER MUST STAND ON 17 AND DRAW TO 16', cx, 0, s * 0.265, 1.9);
  for (let i = 0; i < 5; i++) {
    const phi = -1.02 + i * 0.51;
    const x = cx + s * 0.385 * Math.sin(phi);
    const y = s * 0.385 * Math.cos(phi);
    c.beginPath();
    c.arc(x, y, s * 0.034, 0, Math.PI * 2);
    c.stroke();
  }
  // card shoe outline + chip tray
  c.strokeRect(cx - s * 0.11, s * 0.012, s * 0.22, s * 0.05);
  c.restore();
  const img = c.getImageData(0, 0, s, s);
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const k = 0.9 + Math.random() * 0.16;
    p[i] *= k;
    p[i + 1] *= k;
    p[i + 2] *= k;
  }
  c.putImageData(img, 0, 0);
}

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function rouletteFelt(c: CanvasRenderingContext2D, s: number) {
  c.fillStyle = '#17503a';
  c.fillRect(0, 0, s, s);
  const x0 = s * 0.1;
  const cw = (s * 0.8) / 13;
  const y0 = s * 0.3;
  const ch = s * 0.11;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = s / 360;
  c.strokeStyle = '#e6dcb4';
  c.font = `700 ${cw * 0.5}px ${FONT}`;
  c.fillStyle = '#1b6a44';
  c.fillRect(x0, y0, cw, ch * 3);
  c.strokeRect(x0, y0, cw, ch * 3);
  c.fillStyle = '#e6dcb4';
  c.fillText('0', x0 + cw / 2, y0 + ch * 1.5);
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 3; row++) {
      const n = col * 3 + (3 - row);
      const x = x0 + cw * (col + 1);
      const y = y0 + ch * row;
      c.fillStyle = REDS.has(n) ? '#a3202a' : '#141414';
      c.fillRect(x, y, cw, ch);
      c.strokeRect(x, y, cw, ch);
      c.fillStyle = '#e6dcb4';
      c.fillText(String(n), x + cw / 2, y + ch / 2);
    }
  }
  c.font = `600 ${cw * 0.34}px ${FONT}`;
  ['1st 12', '2nd 12', '3rd 12'].forEach((label, i) => {
    const x = x0 + cw + cw * 4 * i;
    c.strokeRect(x, y0 + ch * 3, cw * 4, ch * 0.8);
    c.fillText(label, x + cw * 2, y0 + ch * 3.4);
  });
  ['1–18', 'EVEN', 'RED', 'BLACK', 'ODD', '19–36'].forEach((label, i) => {
    const x = x0 + cw + cw * 2 * i;
    c.strokeRect(x, y0 + ch * 3.8, cw * 2, ch * 0.8);
    c.fillText(label, x + cw, y0 + ch * 4.2);
  });
}

const GAMES = [
  { name: 'LUCKY 7s', hue: '#ff3b6b', glow: 0xff3b6b, sym: ['7', 'BAR', '7'] },
  { name: 'NILE QUEEN', hue: '#f2b33d', glow: 0xf2b33d, sym: ['◆', '7', '◆'] },
  { name: 'WILD STAR', hue: '#37c8ff', glow: 0x37c8ff, sym: ['★', '★', 'BAR'] },
];

function slotScreen(game: (typeof GAMES)[number]) {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#07080c');
    g.addColorStop(1, '#141018');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = game.hue;
    c.font = `700 ${h * 0.085}px ${FONT}`;
    c.fillText(game.name, w / 2, h * 0.09);
    const rw = w * 0.27;
    for (let i = 0; i < 3; i++) {
      const x = w * 0.075 + i * (rw + w * 0.02);
      c.fillStyle = '#e9e4d6';
      c.fillRect(x, h * 0.2, rw, h * 0.5);
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.fillRect(x, h * 0.2, rw, h * 0.07);
      c.fillRect(x, h * 0.63, rw, h * 0.07);
      const s = game.sym[i];
      c.fillStyle = s === 'BAR' ? '#15151a' : game.hue;
      c.font = `700 ${s === 'BAR' ? h * 0.085 : h * 0.2}px ${FONT}`;
      c.fillText(s, x + rw / 2, h * 0.455);
    }
    c.strokeStyle = game.hue;
    c.lineWidth = Math.max(2, h * 0.008);
    c.strokeRect(w * 0.05, h * 0.18, w * 0.9, h * 0.54);
    c.fillStyle = '#9aa0a8';
    c.font = `500 ${h * 0.05}px ${FONT}`;
    c.fillText('CREDIT 0      BET 0', w / 2, h * 0.82);
    c.fillStyle = '#5d636b';
    c.font = `500 ${h * 0.04}px ${FONT}`;
    c.fillText('INSERT TICKET OR CARD', w / 2, h * 0.92);
  };
}

function topperScreen(game: (typeof GAMES)[number]) {
  return (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.fillStyle = '#0a0a0e';
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = game.hue;
    c.font = `700 ${h * 0.34}px ${FONT}`;
    c.fillText(game.name, w / 2, h * 0.42);
    c.fillStyle = '#d8d2c0';
    c.font = `600 ${h * 0.16}px ${FONT}`;
    c.fillText('JACKPOT  € 48.213', w / 2, h * 0.78);
  };
}

export function createCasino(deps: LevelDeps): Level {
  const { engine, physics, mats, interactions, audio, ui } = deps;
  const b = new Builder(engine.scene, physics, mats, engine.quality);
  engine.setBloomIntensity(0.55);

  // ---------------------------------------------------------------- materials
  const carpetMap = canvasTex(1024, carpetPattern, 2.4);
  const M = {
    carpet: realMat('carpet_red', { size: 0.5, map: carpetMap, normalScale: 0.9 }),
    wood: realMat('wood_veneer_dark', { size: 1.6, color: 0xd9cbbd, rough: 0.8 }),
    woodTrim: realMat('wood_veneer_dark', { size: 1.0, color: 0x8d7c6e, rough: 0.7 }),
    wall: realMat('fabric_damask', { size: 1.3, color: 0xe8e0d8 }),
    column: realMat('plaster_beige', { size: 2, color: 0x6c5b50 }),
    ceiling: realMat('plaster_beige', { size: 2.4, color: 0x4a443f }),
    marble: realMat('marble_black', { size: 1.4, rough: 0.5 }),
    stone: realMat('marble_tiles_beige', { size: 2, color: 0xcfc4b4, rough: 0.6 }),
    brass: realMat('metal_gold', { size: 0.6, color: 0xe9cd96, metal: 1, rough: 0.75, normalScale: 0.5 }),
    chrome: realMat('metal_brushed_steel', { size: 0.5, color: 0xd4d7dc, metal: 1, rough: 0.7, normalScale: 0.4 }),
    leather: realMat('leather_brown', { size: 0.4, color: 0x8c3232, rough: 0.5 }),
    felt: realMat('felt_green', { size: 0.5 }),
    gloss: new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.22, metalness: 0.35 }),
    matte: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7, metalness: 0.1 }),
    rope: new THREE.MeshStandardMaterial({ color: 0x6d1420, roughness: 0.95 }),
    dome: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.08, metalness: 0.6 }),
    door: realMat('wood_veneer_mahogany', { size: 1.2, color: 0xcbb8a8, rough: 0.75 }),
  };
  const N = { collide: false } as const;

  // ---------------------------------------------------------------- shell
  b.box(M.carpet, W * 2, 0.2, D * 2, 0, -0.1, 0);
  b.box(M.ceiling, W * 2, 0.2, D * 2, 0, H + 0.1, 0, N);
  // walls: baseboard, wood wainscot with stiles, brass rail, painted wall, crown
  const wall = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const alongX = Math.abs(x1 - x0) > 0.01;
    const sx = (t: number, l: number) => (alongX ? l : t);
    const sz = (t: number, l: number) => (alongX ? t : l);
    b.box(M.wall, sx(0.3, len), H, sz(0.3, len), cx - nx * 0.15, H / 2, cz - nz * 0.15);
    b.box(M.wood, sx(0.05, len), 1.1, sz(0.05, len), cx + nx * 0.025, 0.67, cz + nz * 0.025, N);
    b.box(M.woodTrim, sx(0.08, len), 0.14, sz(0.08, len), cx + nx * 0.04, 0.07, cz + nz * 0.04, N);
    b.box(M.woodTrim, sx(0.09, len), 0.06, sz(0.09, len), cx + nx * 0.045, 1.25, cz + nz * 0.045, N);
    b.box(M.brass, sx(0.1, len), 0.018, sz(0.1, len), cx + nx * 0.05, 1.29, cz + nz * 0.05, N);
    b.box(M.woodTrim, sx(0.14, len), 0.16, sz(0.14, len), cx + nx * 0.07, H - 0.08, cz + nz * 0.07, N);
    const n = Math.round(len / 1.25);
    for (let i = 0; i <= n; i++) {
      const f = i / n - 0.5;
      b.box(M.woodTrim, sx(0.07, 0.09), 1.1, sz(0.07, 0.09), cx + (alongX ? f * len : nx * 0.035), 0.67, cz + (alongX ? nz * 0.035 : f * len), N);
    }
  };
  wall(-W, -D, W, -D, 0, 1);
  wall(-W, D, W, D, 0, -1);
  wall(-W, -D, -W, D, 1, 0);
  wall(W, -D, W, D, -1, 0);
  // coffered ceiling with small night lights
  for (let x = -6; x <= 6; x += 4) b.box(M.woodTrim, 0.28, 0.22, D * 2, x, H - 0.11, 0, N);
  for (let z = -10; z <= 10; z += 4) b.box(M.woodTrim, W * 2, 0.22, 0.28, 0, H - 0.11, z, N);
  for (let x = -4; x <= 4; x += 4) for (let z = -8; z <= 8; z += 4) b.glowBox(0xffd9a0, 0.16, 0.02, 0.16, x, H - 0.012, z, 0.9);
  // columns
  for (const [cx, cz] of [
    [-3.6, 3.2],
    [4.2, 3.2],
    [-3.6, -4.8],
    [4.2, -4.8],
  ]) {
    b.box(M.column, 0.62, H, 0.62, cx, H / 2, cz);
    b.box(M.wood, 0.7, 1.2, 0.7, cx, 0.6, cz, N);
    b.box(M.brass, 0.74, 0.02, 0.74, cx, 1.21, cz, N);
    b.box(M.woodTrim, 0.76, 0.14, 0.76, cx, 0.07, cz, N);
    b.box(M.woodTrim, 0.78, 0.16, 0.78, cx, H - 0.08, cz, N);
  }

  // ---------------------------------------------------------------- props
  const stool = (x: number, z: number) => {
    b.cylinder(M.chrome, 0.2, 0.025, x, 0.0125, z, N);
    b.cylinder(M.chrome, 0.028, 0.6, x, 0.31, z, N);
    b.cylinder(M.leather, 0.185, 0.08, x, 0.65, z, { collide: false, segments: 24 });
    b.collider(x, 0.34, z, 0.3, 0.68, 0.3);
  };

  const pulses: { light: THREE.PointLight; base: number; rate: number }[] = [];
  /** A slot machine at (x, z) whose front faces `dir` along x (+1 or -1). */
  const slot = (x: number, z: number, dir: 1 | -1, game: (typeof GAMES)[number]) => {
    const P = (mat: THREE.Material, d: number, h: number, w: number, lx: number, y: number, o: object = N) => b.box(mat, d, h, w, x + dir * lx, y, z, { ...o, round: 0.012 });
    P(M.gloss, 0.56, 0.74, 0.62, 0, 0.37);
    P(M.chrome, 0.58, 0.05, 0.64, 0, 0.025);
    P(M.matte, 0.3, 0.07, 0.6, 0.3, 0.77);
    P(M.gloss, 0.42, 0.86, 0.62, -0.05, 1.19);
    P(M.gloss, 0.36, 0.38, 0.62, -0.08, 1.81);
    P(M.chrome, 0.03, 0.86, 0.03, 0.17, 1.19);
    for (const s of [-1, 1]) b.box(M.chrome, 0.035, 0.86, 0.03, x + dir * 0.165, 1.19, z + s * 0.3, N);
    for (let i = 0; i < 4; i++) b.glowBox([0xffb23a, 0x49d67a, 0x49d67a, 0xff4a4a][i], 0.05, 0.016, 0.07, x + dir * 0.36, 0.812, z - 0.2 + i * 0.133, 0.7);
    b.glowBox(game.glow, 0.012, 0.012, 0.56, x + dir * 0.165, 0.775, z, 1.1);
    const rot = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    b.screen(0.52, 0.66, x + dir * 0.163, 1.2, z, rot, 420, slotScreen(game), 0.55);
    b.screen(0.54, 0.26, x + dir * 0.103, 1.81, z, rot, 420, topperScreen(game), 0.8);
    b.collider(x, 1, z, 0.62, 2, 0.64);
    stool(x + dir * 0.78, z);
  };
  for (let i = 0; i < 6; i++) slot(-W + 0.42, 6.4 - i * 1.15, 1, GAMES[i % 3]);
  // an island of machines, back to back
  for (let i = 0; i < 3; i++) {
    slot(5.05, 6.2 - i * 1.15, -1, GAMES[(i + 1) % 3]);
    slot(5.65, 6.2 - i * 1.15, 1, GAMES[(i + 2) % 3]);
  }
  pulses.push({ light: b.point(0xff4a7a, 2.2, -6.5, 1.3, 5.2, 5.5), base: 2.2, rate: 0.7 });
  pulses.push({ light: b.point(0xf2b33d, 2.0, -6.5, 1.3, 1.6, 5.5), base: 2.0, rate: 0.5 });
  pulses.push({ light: b.point(0x37c8ff, 2.0, 4.1, 1.3, 5.0, 5), base: 2.0, rate: 0.6 });

  // blackjack tables (own groups, so they can be turned freely)
  const feltTex = canvasTex(1024, blackjackFelt);
  const feltTop = M.felt.clone();
  feltTop.map = feltTex;
  const blackjack = (x: number, z: number, rotY: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    engine.scene.add(g);
    const R = 1.08;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.07, 48, 1, false, Math.PI / 2, Math.PI), M.wood);
    top.position.y = 0.9;
    const felt = new THREE.Mesh(new THREE.CircleGeometry(R - 0.1, 48, 0, Math.PI), feltTop);
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = 0.937;
    const rail = new THREE.Mesh(new THREE.TorusGeometry(R - 0.045, 0.055, 12, 48, Math.PI), M.leather);
    rail.rotation.x = -Math.PI / 2;
    rail.position.y = 0.945;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(R * 2, 0.07, 0.05), M.wood);
    edge.position.set(0, 0.9, 0.02);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.86, 20), M.woodTrim);
    leg.position.set(0, 0.43, -0.42);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.05, 28), M.brass);
    foot.position.set(0, 0.025, -0.42);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.12), M.matte);
    shoe.position.set(0.6, 0.98, -0.12);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.14), M.chrome);
    tray.position.set(0, 0.95, -0.1);
    for (const m of [top, felt, rail, edge, leg, foot, shoe, tray]) {
      m.castShadow = m !== felt;
      m.receiveShadow = true;
      g.add(m);
    }
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    b.collider(x - sin * -0.5, 0.47, z - cos * 0.5, 2.1, 0.94, 1.2, rotY);
    for (let i = 0; i < 5; i++) {
      const phi = -1.02 + i * 0.51;
      const lx = Math.sin(phi) * 1.42;
      const lz = -Math.cos(phi) * 1.42;
      stool(x + lx * cos + lz * sin, z - lx * sin + lz * cos);
    }
  };
  blackjack(-0.9, 2.2, Math.PI);
  blackjack(1.9, -2.6, Math.PI + 0.5);

  // roulette table
  {
    const x = -1.4;
    const z = -6.6;
    b.box(M.wood, 2.9, 0.1, 1.5, x, 0.86, z, { round: 0.02 });
    b.box(M.woodTrim, 2.6, 0.72, 1.1, x, 0.42, z, N);
    b.box(M.woodTrim, 2.96, 0.07, 0.09, x, 0.93, z - 0.73, N);
    b.box(M.woodTrim, 2.96, 0.07, 0.09, x, 0.93, z + 0.73, N);
    b.box(M.woodTrim, 0.09, 0.07, 1.5, x - 1.46, 0.93, z, N);
    b.box(M.woodTrim, 0.09, 0.07, 1.5, x + 1.46, 0.93, z, N);
    const layout = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 1.34), feltTop.clone());
    (layout.material as THREE.MeshStandardMaterial).map = canvasTex(1024, rouletteFelt);
    layout.rotation.x = -Math.PI / 2;
    layout.position.set(x + 0.46, 0.912, z);
    layout.receiveShadow = true;
    engine.scene.add(layout);
    b.cylinder(M.wood, 0.46, 0.13, x - 0.93, 0.975, z, { collide: false, segments: 40 });
    b.cylinder(M.matte, 0.4, 0.02, x - 0.93, 1.045, z, { collide: false, segments: 40 });
    b.cylinder(M.brass, 0.2, 0.05, x - 0.93, 1.06, z, { collide: false, segments: 32, radiusTop: 0.12 });
    b.cylinder(M.brass, 0.022, 0.16, x - 0.93, 1.15, z, N);
    for (const s of [-1, 0, 1]) stool(x + 0.5 + s * 0.75, z + 1.25);
  }

  // stone apron in front of the cashier, and a lounge corner by the entrance
  b.box(M.stone, W * 2 - 0.1, 0.02, 3.4, 0, 0.011, -D + 1.75, N);
  b.box(M.brass, W * 2 - 0.1, 0.022, 0.03, 0, 0.012, -D + 3.46, N);
  for (const [name, x, z, rot, sc] of [
    ['sofa_velvet', 6.9, 9.4, -Math.PI / 2, 1],
    ['plant_potted', 7.3, 10.4, 0, 1.5],
    ['lamp_floor', 7.2, 8.0, 0, 1],
    ['chair_damask', 5.4, 10.2, Math.PI, 1],
  ] as const) {
    const o = model(name, x, 0, z, rot, sc);
    if (o) engine.scene.add(o);
  }
  b.collider(6.9, 0.4, 9.4, 1.0, 0.8, 2.0);

  // cashier cage at the far wall
  {
    const cx = 4.2;
    const z = -D + 0.75;
    b.box(M.wood, 5.2, 1.0, 0.5, cx, 0.5, z);
    b.box(M.marble, 5.36, 0.05, 0.66, cx, 1.03, z, N);
    b.box(M.woodTrim, 5.36, 0.42, 0.3, cx, 2.5, z, N);
    b.box(M.brass, 5.36, 0.02, 0.32, cx, 2.28, z, N);
    for (let i = 0; i <= 46; i++) {
      const x = cx - 2.6 + i * 0.113;
      if (Math.abs(((x - cx + 5.2) % 1.3) - 0.65) < 0.2) continue; // pay windows
      b.cylinder(M.brass, 0.008, 1.22, x, 1.665, z + 0.12, { collide: false, segments: 8 });
    }
    for (let i = 0; i < 4; i++) b.box(M.brass, 0.42, 0.014, 0.02, cx - 1.95 + i * 1.3, 1.36, z + 0.12, N);
    b.decal(2.2, 0.26, cx, 2.5, z + 0.152, 0, 300, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#c9a25a';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${h * 0.7}px ${FONT}`;
      c.fillText('C A S H I E R', w / 2, h * 0.54);
    });
    // a banker's lamp left on inside the cage
    b.cylinder(M.brass, 0.07, 0.02, cx + 1.3, 1.065, z - 0.1, N);
    b.cylinder(M.brass, 0.012, 0.3, cx + 1.3, 1.2, z - 0.1, N);
    b.glowBox(0x2f9d63, 0.3, 0.07, 0.11, cx + 1.3, 1.36, z - 0.1, 1.6);
    b.point(0xffcf8a, 2.6, cx + 1.3, 1.26, z - 0.02, 4.5);
    // velvet rope in front
    const posts: [number, number][] = [];
    for (let i = 0; i < 5; i++) posts.push([cx - 2.6 + i * 1.3, z + 1.9]);
    for (const [px, pz] of posts) {
      b.cylinder(M.brass, 0.16, 0.03, px, 0.015, pz, N);
      b.cylinder(M.brass, 0.022, 0.94, px, 0.48, pz, N);
      b.cylinder(M.brass, 0.045, 0.05, px, 0.97, pz, { collide: false, radiusTop: 0.02 });
      b.collider(px, 0.5, pz, 0.12, 1, 0.12);
    }
    for (let i = 0; i < posts.length - 1; i++) {
      const [ax, az] = posts[i];
      const [bx] = posts[i + 1];
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(ax, 0.92, az), new THREE.Vector3((ax + bx) / 2, 0.66, az), new THREE.Vector3(bx, 0.92, az));
      b.addStatic(M.rope, new THREE.TubeGeometry(curve, 14, 0.017, 8));
    }
  }

  // staff door with card reader (far wall, left)
  const reader = new THREE.Group();
  {
    const x = -4.4;
    const z = -D + 0.05;
    b.box(M.woodTrim, 1.24, 2.3, 0.12, x, 1.15, z, N);
    b.box(M.door, 1.02, 2.14, 0.08, x, 1.09, z + 0.045, N);
    b.box(M.brass, 0.9, 0.24, 0.012, x, 0.16, z + 0.09, N);
    b.box(M.brass, 0.03, 0.14, 0.05, x + 0.4, 1.05, z + 0.1, N);
    b.decal(0.42, 0.1, x, 1.72, z + 0.092, 0, 500, (c, w, h) => {
      c.fillStyle = '#b9914f';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#1a1512';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${h * 0.56}px ${FONT}`;
      c.fillText('STAFF ONLY', w / 2, h * 0.54);
    });
    b.decal(0.62, 0.2, x, 2.58, z + 0.02, 0, 300, (c, w, h) => {
      c.fillStyle = '#0b3d22';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#b8ffd2';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${h * 0.62}px ${FONT}`;
      c.fillText('EXIT', w / 2, h * 0.54);
    }, 2.2);
    b.point(0x3dff8a, 1.6, x, 2.45, z + 0.5, 4.5);
    reader.position.set(x + 0.86, 1.22, z + 0.07);
    engine.scene.add(reader);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.13, 0.03), M.matte);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.004), mats.glow(0xff3030, 2.4));
    led.position.set(0, 0.045, 0.016);
    reader.add(body, led);
  }

  // ceiling cameras
  for (const [x, z] of [
    [-2, 6],
    [2.4, 0.4],
    [-1.6, -8.4],
  ]) {
    const dome = new THREE.SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    dome.translate(x, H - 0.03, z);
    b.addStatic(M.dome, dome, false);
    b.cylinder(M.matte, 0.13, 0.03, x, H - 0.015, z, N);
    b.glowBox(0xff2a2a, 0.012, 0.012, 0.012, x + 0.09, H - 0.075, z + 0.06, 3);
  }

  // ---------------------------------------------------------------- light
  b.hemisphere(0x8a90a0, 0x2a1f18, 0.5);
  // the house lights are off: a few dimmed night lights keep the floor readable
  for (const z of [5.5, -0.5, -5.5]) b.point(0xffd2a0, 5.5, 0, H - 0.35, z, 11, 1.5);
  b.spot(0xffd6a6, 70, 3.6, H - 0.15, -7.2, 4.2, 0, -9.6, { angle: 0.75, penumbra: 0.8, distance: 12, shadow: true });
  b.spot(0xcfdcff, 46, -1.5, H - 0.15, 8.2, -0.6, 0, 3.4, { angle: 0.8, penumbra: 0.9, distance: 13, shadow: true });
  const dust = b.dust(0, 1.7, 0, 7, 3, 9, 220);

  b.finalize();
  engine.captureEnvironment(new THREE.Vector3(0.5, 1.6, 2.5), 0.9);

  interactions.add({
    id: 'casino.reader',
    object: reader,
    range: 2.2,
    prompt: () => t('casino.reader'),
    onUse: () => {
      audio.play('deny', { pos: reader.position });
      ui.toast(t('casino.reader.no'), 'warn');
    },
  });

  return {
    spawn(index) {
      return { pos: new THREE.Vector3(-0.6 + (index % 4) * 0.8, 0, 8.6), yaw: 0 };
    },
    menuCamera(time, cam) {
      cam.position.set(-1.2 + Math.sin(time * 0.06) * 1.6, 1.62, 8.4);
      cam.lookAt(1.2, 1.15, -5);
    },
    attach() {},
    detach() {},
    update(_dt, time) {
      b.updateShadows(time);
      dust(time);
      for (const p of pulses) p.light.intensity = p.base * (0.82 + 0.18 * Math.sin(time * p.rate * 2));
    },
    objective() {
      return [t('casino.obj')];
    },
    redraw() {},
  };
}
