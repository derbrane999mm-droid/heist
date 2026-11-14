// Interior of the Auktionshaus Varga at night: closed, house lights off, green exit
// signs, moonlight through the high windows, dim display-case lighting.
//
// Built into a Builder the caller owns (the caller calls `b.finalize()` and
// `engine.captureEnvironment` afterwards). World axes as in varga.ts: x east,
// z south; the building spans x -22..0, z -13.1..4.9 and matches the planning
// screen's floor plan (20 plan units = 1 m). Interior floor at y = VARGA_FLOOR.
//
// Light budget: 6 point lights, no shadows. Everything else is emissive + bloom.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Builder, FONT, MONO, type BoxOpts, type ScreenHandle } from '../build';
import { realMat } from '../realmats';
import type { LevelDeps } from '../level';
import type { Anchors } from '../mech/skill';
import type { Collider } from '../../core/physics';

/** Interior floor height (= the delivery door's sill). */
export const VARGA_FLOOR = 0.27;
const F = VARGA_FLOOR;
const C = F + 3.2; // ceiling of the normal rooms
const CL = F + 5.0; // ceiling of the storage room
const ROOF = 6.0; // underside of the roof slab
const T = 0.2; // partition thickness
const DOOR_H = 2.2;
/** Front door centre (x) in the south wall. */
const FD_X = -14.6;

export interface VargaInterior {
  anchors: Anchors;
  update(dt: number, t: number): void;
  openFrontDoor(open: boolean): void;
  openVaultDoor(open: boolean): void;
  openCase(i: number, open: boolean): void;
  setAlarm(on: boolean): void;
  /** Extras: the safe's round door and the roof hatch lid. */
  openSafe(open: boolean): void;
  openHatch(open: boolean): void;
  /** Interaction targets for the job director. */
  objects: {
    cases: THREE.Object3D[];
    safe: THREE.Object3D;
    panel: THREE.Object3D;
    frontDoor: THREE.Object3D;
    vaultDoor: THREE.Object3D;
    monitor: THREE.Object3D;
    hatch: THREE.Object3D;
  };
  /** The interior's real lights (all point lights, no shadows). */
  lights: THREE.Light[];
}

export interface VargaInteriorOpts {
  /** true: the exterior (varga.ts) provides outer walls and roof. false: build a simple shell here. */
  shell?: boolean;
}

// ------------------------------------------------------------------ helpers
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
function worldUv(geo: THREE.BufferGeometry, tile = 2) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    const ax = Math.abs(_n.x);
    const ay = Math.abs(_n.y);
    const az = Math.abs(_n.z);
    if (ay >= ax && ay >= az) uv.setXY(i, _v.x / tile, _v.z / tile);
    else if (ax >= az) uv.setXY(i, _v.z / tile, _v.y / tile);
    else uv.setXY(i, _v.x / tile, _v.y / tile);
  }
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

/** Shelf-packed canvas atlas: many printed things share one texture and one material. */
class Atlas {
  readonly cv = document.createElement('canvas');
  readonly c: CanvasRenderingContext2D;
  private x = 4;
  private y = 4;
  private rowH = 0;
  constructor(
    readonly W: number,
    readonly H: number,
  ) {
    this.cv.width = W;
    this.cv.height = H;
    this.c = this.cv.getContext('2d')!;
  }
  add(w: number, h: number, draw: Draw): Rect {
    const P = 6;
    if (this.x + w + P > this.W) {
      this.x = 4;
      this.y += this.rowH + P;
      this.rowH = 0;
    }
    const r = { x: this.x, y: this.y, w, h };
    if (this.y + h > this.H) console.warn('atlas full');
    this.x += w + P;
    this.rowH = Math.max(this.rowH, h);
    const c = this.c;
    c.save();
    c.translate(r.x, r.y);
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();
    draw(c, w, h);
    c.restore();
    return r;
  }
  texture() {
    const t = new THREE.CanvasTexture(this.cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
}

// ------------------------------------------------------------------ printed things
function grain(c: CanvasRenderingContext2D, w: number, h: number, amt: number, seed: number) {
  const r = rng(seed);
  const img = c.getImageData(0, 0, w, h);
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const k = 1 - amt / 2 + r() * amt;
    p[i] *= k;
    p[i + 1] *= k;
    p[i + 2] *= k;
  }
  c.putImageData(img, 0, 0);
}

/** Oil-paint look: many small translucent dabs in the palette over a base layer. */
function dabs(c: CanvasRenderingContext2D, r: () => number, x0: number, y0: number, w: number, h: number, cols: string[], n: number, size: number, alpha = 0.18) {
  for (let i = 0; i < n; i++) {
    c.globalAlpha = alpha * (0.5 + r());
    c.fillStyle = cols[Math.floor(r() * cols.length)];
    const x = x0 + r() * w;
    const y = y0 + r() * h;
    c.beginPath();
    c.ellipse(x, y, size * (0.5 + r()), size * (0.2 + r() * 0.4), r() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

function varnish(c: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  c.fillStyle = 'rgba(110,80,30,0.16)';
  c.fillRect(0, 0, w, h);
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(10,6,2,0.55)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  grain(c, w, h, 0.14, seed);
}

function hills(c: CanvasRenderingContext2D, r: () => number, w: number, h: number, base: number, amp: number, col: string) {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(0, h);
  for (let x = 0; x <= w; x += w / 40) c.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(x * 0.012 + r() * 0.4) + r() * 0.25));
  c.lineTo(w, h);
  c.fill();
}

const PAINTINGS: Draw[] = [
  // 0 evening landscape
  (c, w, h) => {
    const r = rng(11);
    const g = c.createLinearGradient(0, 0, 0, h * 0.6);
    g.addColorStop(0, '#5c6f86');
    g.addColorStop(0.6, '#d9a65e');
    g.addColorStop(1, '#e8c98a');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    dabs(c, r, 0, 0, w, h * 0.55, ['#e9d2a0', '#8fa0b0', '#c98a4a'], 500, w * 0.03);
    hills(c, r, w, h, h * 0.58, h * 0.1, '#5d6a5a');
    hills(c, r, w, h, h * 0.7, h * 0.12, '#3c4a32');
    hills(c, r, w, h, h * 0.85, h * 0.1, '#2a2f1c');
    dabs(c, r, 0, h * 0.6, w, h * 0.4, ['#4a5a2c', '#2c3518', '#6a6a3a'], 600, w * 0.025, 0.25);
    for (let i = 0; i < 5; i++) {
      const x = w * (0.1 + r() * 0.8);
      c.fillStyle = '#1c2210';
      c.beginPath();
      c.ellipse(x, h * 0.66, w * 0.04, h * 0.1, 0, 0, Math.PI * 2);
      c.fill();
      c.fillRect(x - 2, h * 0.7, 4, h * 0.08);
    }
    varnish(c, w, h, 1);
  },
  // 1 portrait of a man
  (c, w, h) => {
    const r = rng(12);
    const g = c.createRadialGradient(w * 0.5, h * 0.35, 10, w * 0.5, h * 0.4, h * 0.7);
    g.addColorStop(0, '#5a4a30');
    g.addColorStop(1, '#16110a');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#0e0c0a';
    c.beginPath();
    c.moveTo(w * 0.05, h);
    c.quadraticCurveTo(w * 0.1, h * 0.6, w * 0.5, h * 0.58);
    c.quadraticCurveTo(w * 0.9, h * 0.6, w * 0.95, h);
    c.fill();
    c.fillStyle = '#d8d0bc';
    c.beginPath();
    c.moveTo(w * 0.4, h * 0.6);
    c.lineTo(w * 0.5, h * 0.75);
    c.lineTo(w * 0.6, h * 0.6);
    c.fill();
    const s = c.createRadialGradient(w * 0.46, h * 0.36, 4, w * 0.5, h * 0.4, w * 0.2);
    s.addColorStop(0, '#e2b892');
    s.addColorStop(1, '#7a4f34');
    c.fillStyle = s;
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.4, w * 0.15, h * 0.16, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#2a1d12';
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.27, w * 0.16, h * 0.07, 0, Math.PI, 0);
    c.fill();
    c.fillStyle = '#3a2618';
    c.fillRect(w * 0.43, h * 0.38, w * 0.04, h * 0.012);
    c.fillRect(w * 0.53, h * 0.38, w * 0.04, h * 0.012);
    dabs(c, r, 0, 0, w, h, ['#3a2e1c', '#20180e', '#4a3a22'], 400, w * 0.03, 0.12);
    varnish(c, w, h, 2);
  },
  // 2 still life
  (c, w, h) => {
    const r = rng(13);
    c.fillStyle = '#1a140c';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#4a3420';
    c.fillRect(0, h * 0.68, w, h * 0.32);
    c.fillStyle = '#d6cfbe';
    c.beginPath();
    c.moveTo(w * 0.15, h * 0.68);
    c.lineTo(w * 0.7, h * 0.68);
    c.lineTo(w * 0.78, h);
    c.lineTo(w * 0.05, h);
    c.fill();
    c.fillStyle = '#7d8084';
    c.beginPath();
    c.ellipse(w * 0.35, h * 0.5, w * 0.11, h * 0.2, 0, 0, Math.PI * 2);
    c.fill();
    c.fillRect(w * 0.31, h * 0.25, w * 0.08, h * 0.1);
    for (const [x, y, col] of [
      [0.55, 0.64, '#a8321e'],
      [0.63, 0.66, '#c7781e'],
      [0.48, 0.7, '#8a2a18'],
      [0.6, 0.58, '#b8a03a'],
    ] as const) {
      const g = c.createRadialGradient(w * x - 5, h * y - 5, 2, w * x, h * y, w * 0.05);
      g.addColorStop(0, '#f0d0a0');
      g.addColorStop(0.3, col);
      g.addColorStop(1, '#2a0e06');
      c.fillStyle = g;
      c.beginPath();
      c.arc(w * x, h * y, w * 0.05, 0, Math.PI * 2);
      c.fill();
    }
    dabs(c, r, 0, 0, w, h * 0.6, ['#2a2014', '#140e08'], 300, w * 0.04, 0.2);
    varnish(c, w, h, 3);
  },
  // 3 seascape
  (c, w, h) => {
    const r = rng(14);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6f7c88');
    g.addColorStop(0.5, '#b8b4a0');
    g.addColorStop(0.52, '#3c5552');
    g.addColorStop(1, '#1c2a28');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    dabs(c, r, 0, 0, w, h * 0.5, ['#d8d2c0', '#8a96a0', '#5a6670'], 500, w * 0.035);
    dabs(c, r, 0, h * 0.52, w, h * 0.48, ['#e0e4d8', '#2a4440', '#4a6a62'], 600, w * 0.02, 0.22);
    c.fillStyle = '#1a1612';
    c.beginPath();
    c.moveTo(w * 0.58, h * 0.53);
    c.lineTo(w * 0.72, h * 0.53);
    c.lineTo(w * 0.69, h * 0.56);
    c.lineTo(w * 0.6, h * 0.56);
    c.fill();
    c.fillStyle = '#d8ceb4';
    c.beginPath();
    c.moveTo(w * 0.65, h * 0.33);
    c.lineTo(w * 0.65, h * 0.52);
    c.lineTo(w * 0.59, h * 0.52);
    c.fill();
    varnish(c, w, h, 4);
  },
  // 4 modern colour fields
  (c, w, h) => {
    const r = rng(15);
    c.fillStyle = '#5a1a18';
    c.fillRect(0, 0, w, h);
    const field = (y: number, hh: number, col: string) => {
      c.fillStyle = col;
      c.filter = 'blur(3px)';
      c.fillRect(w * 0.08, h * y, w * 0.84, h * hh);
      c.filter = 'none';
    };
    field(0.08, 0.38, '#c0562a');
    field(0.52, 0.12, '#2a0c0c');
    field(0.7, 0.22, '#8a2a20');
    dabs(c, r, 0, 0, w, h, ['#6a2018', '#c06030'], 200, w * 0.05, 0.08);
    grain(c, w, h, 0.1, 5);
  },
  // 5 winter landscape
  (c, w, h) => {
    const r = rng(16);
    c.fillStyle = '#9ea4a6';
    c.fillRect(0, 0, w, h);
    dabs(c, r, 0, 0, w, h * 0.5, ['#b8bcbc', '#8a9094'], 300, w * 0.04);
    hills(c, r, w, h, h * 0.55, h * 0.08, '#c8ccc8');
    hills(c, r, w, h, h * 0.75, h * 0.06, '#e2e2dc');
    for (let i = 0; i < 14; i++) {
      const x = r() * w;
      const y = h * (0.5 + r() * 0.3);
      c.strokeStyle = '#2a2622';
      c.lineWidth = 2 + r() * 3;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (r() - 0.5) * 8, y - h * (0.1 + r() * 0.15));
      c.stroke();
    }
    c.fillStyle = '#3a2a20';
    c.fillRect(w * 0.6, h * 0.5, w * 0.14, h * 0.1);
    c.fillStyle = '#5a2a1c';
    c.beginPath();
    c.moveTo(w * 0.58, h * 0.5);
    c.lineTo(w * 0.67, h * 0.42);
    c.lineTo(w * 0.76, h * 0.5);
    c.fill();
    varnish(c, w, h, 6);
  },
  // 6 town view
  (c, w, h) => {
    const r = rng(17);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#4a5a6a');
    g.addColorStop(0.6, '#c8a878');
    g.addColorStop(1, '#3a3020');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      const x = (i / 12) * w;
      const bh = h * (0.15 + r() * 0.2);
      c.fillStyle = ['#7a5a40', '#8a6a4a', '#5a4030', '#9a7a5a'][i % 4];
      c.fillRect(x, h * 0.75 - bh, w / 12 + 1, bh + h * 0.05);
      c.fillStyle = '#4a2a1a';
      c.beginPath();
      c.moveTo(x, h * 0.75 - bh);
      c.lineTo(x + w / 24, h * 0.75 - bh - h * 0.06);
      c.lineTo(x + w / 12, h * 0.75 - bh);
      c.fill();
    }
    c.fillStyle = '#4a3a2a';
    c.fillRect(w * 0.45, h * 0.15, w * 0.06, h * 0.5);
    c.beginPath();
    c.moveTo(w * 0.44, h * 0.15);
    c.lineTo(w * 0.48, h * 0.04);
    c.lineTo(w * 0.52, h * 0.15);
    c.fill();
    c.fillStyle = '#2a3a3a';
    c.fillRect(0, h * 0.8, w, h * 0.2);
    dabs(c, r, 0, 0, w, h, ['#c8a878', '#3a3020', '#6a7a8a'], 500, w * 0.025, 0.12);
    varnish(c, w, h, 7);
  },
  // 7 portrait of a lady
  (c, w, h) => {
    const r = rng(18);
    c.fillStyle = '#20281e';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#3a1a28';
    c.beginPath();
    c.moveTo(w * 0.08, h);
    c.quadraticCurveTo(w * 0.15, h * 0.62, w * 0.5, h * 0.6);
    c.quadraticCurveTo(w * 0.85, h * 0.62, w * 0.92, h);
    c.fill();
    const s = c.createRadialGradient(w * 0.47, h * 0.38, 4, w * 0.5, h * 0.42, w * 0.2);
    s.addColorStop(0, '#f0d0b8');
    s.addColorStop(1, '#8a6048');
    c.fillStyle = s;
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.42, w * 0.13, h * 0.15, 0, 0, Math.PI * 2);
    c.fill();
    c.fillRect(w * 0.45, h * 0.52, w * 0.1, h * 0.1);
    c.fillStyle = '#3a2416';
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.33, w * 0.17, h * 0.12, 0, Math.PI, 0);
    c.fill();
    c.fillStyle = '#e8e0d0';
    for (let i = 0; i < 9; i++) {
      c.beginPath();
      c.arc(w * (0.42 + i * 0.02), h * (0.62 + Math.sin((i / 8) * Math.PI) * 0.025), w * 0.008, 0, Math.PI * 2);
      c.fill();
    }
    dabs(c, r, 0, 0, w, h, ['#2a3426', '#141a12'], 300, w * 0.035, 0.14);
    varnish(c, w, h, 8);
  },
];

function exitSign(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = '#0d8a3c';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#ffffff';
  // door
  const s = h * 0.7;
  const x0 = w * 0.08;
  const y0 = h * 0.15;
  c.fillRect(x0 + s * 0.55, y0, s * 0.42, s);
  c.fillStyle = '#0d8a3c';
  c.fillRect(x0 + s * 0.6, y0 + s * 0.06, s * 0.32, s * 0.94);
  // running man
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#ffffff';
  c.lineCap = 'round';
  c.lineWidth = s * 0.1;
  c.beginPath();
  c.arc(x0 + s * 0.36, y0 + s * 0.12, s * 0.08, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(x0 + s * 0.32, y0 + s * 0.25);
  c.lineTo(x0 + s * 0.22, y0 + s * 0.58);
  c.lineTo(x0 + s * 0.38, y0 + s * 0.78);
  c.lineTo(x0 + s * 0.34, y0 + s * 0.98);
  c.moveTo(x0 + s * 0.22, y0 + s * 0.58);
  c.lineTo(x0 + s * 0.05, y0 + s * 0.95);
  c.moveTo(x0 + s * 0.3, y0 + s * 0.3);
  c.lineTo(x0 + s * 0.48, y0 + s * 0.45);
  c.moveTo(x0 + s * 0.3, y0 + s * 0.3);
  c.lineTo(x0 + s * 0.1, y0 + s * 0.4);
  c.stroke();
  // arrow
  const ax = w * 0.62;
  const ay = h * 0.5;
  c.lineWidth = h * 0.11;
  c.beginPath();
  c.moveTo(ax, ay);
  c.lineTo(ax + w * 0.25, ay);
  c.stroke();
  c.beginPath();
  c.moveTo(ax + w * 0.3, ay);
  c.lineTo(ax + w * 0.2, ay - h * 0.22);
  c.lineTo(ax + w * 0.2, ay + h * 0.22);
  c.fill();
}

function label(text: string, sub?: string, bg = '#e8e2d2', fg = '#1a1612'): Draw {
  return (c, w, h) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `600 ${h * (sub ? 0.36 : 0.55)}px Georgia, serif`;
    c.fillText(text, w / 2, h * (sub ? 0.36 : 0.54));
    if (sub) {
      c.font = `400 ${h * 0.22}px Georgia, serif`;
      c.fillText(sub, w / 2, h * 0.74);
    }
  };
}

function noticeBoard(c: CanvasRenderingContext2D, w: number, h: number) {
  const r = rng(21);
  c.fillStyle = '#8a6a44';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) {
    c.fillStyle = r() > 0.5 ? 'rgba(60,40,20,0.25)' : 'rgba(180,140,90,0.25)';
    c.fillRect(r() * w, r() * h, 2, 2);
  }
  const papers: [number, number, number, number, string, string, string][] = [
    [0.05, 0.08, 0.36, 0.5, '#efe9dc', 'HERBSTAUKTION', 'Sa 21. November · 11 Uhr'],
    [0.46, 0.06, 0.26, 0.36, '#f4f0e6', 'Vorbesichtigung', 'Do–Fr 10–18 Uhr'],
    [0.76, 0.1, 0.2, 0.3, '#e6e8ee', 'Katalog', 'online & am Empfang'],
    [0.48, 0.48, 0.3, 0.44, '#f2ead0', 'Schmuck · Uhren', 'Münzen · Gemälde'],
    [0.08, 0.62, 0.3, 0.32, '#ffffff', 'Hausordnung', 'Taschen an der Garderobe'],
    [0.8, 0.5, 0.16, 0.22, '#f0d8d0', 'Lieferungen', 'nur über den Hof'],
  ];
  for (const [x, y, pw, ph, col, t1, t2] of papers) {
    c.save();
    c.translate(w * (x + pw / 2), h * (y + ph / 2));
    c.rotate((r() - 0.5) * 0.06);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect((-w * pw) / 2 + 3, (-h * ph) / 2 + 4, w * pw, h * ph);
    c.fillStyle = col;
    c.fillRect((-w * pw) / 2, (-h * ph) / 2, w * pw, h * ph);
    c.fillStyle = '#1a1a1a';
    c.textAlign = 'center';
    c.font = `700 ${h * 0.055}px Georgia, serif`;
    c.fillText(t1, 0, -h * ph * 0.25);
    c.font = `400 ${h * 0.035}px Georgia, serif`;
    c.fillText(t2, 0, -h * ph * 0.05);
    c.fillStyle = 'rgba(30,30,30,0.35)';
    for (let i = 0; i < 4; i++) c.fillRect(-w * pw * 0.38, h * ph * (0.08 + i * 0.09), w * pw * (0.5 + r() * 0.26), 2);
    c.fillStyle = ['#c0302a', '#2a5ac0', '#e0b020'][Math.floor(r() * 3)];
    c.beginPath();
    c.arc(0, -h * ph * 0.44, 4, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
}

function depositGrid(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = '#6a6e70';
  c.fillRect(0, 0, w, h);
  const cols = 16;
  const rows = 6;
  const cw = w / cols;
  const rh = h / rows;
  c.font = `600 ${rh * 0.13}px ${MONO}`;
  c.textAlign = 'center';
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const big = j >= 4;
      if (big && i % 2 === 1) continue;
      const x = i * cw;
      const y = j * rh;
      const ww = big ? cw * 2 : cw;
      const g = c.createLinearGradient(x, y, x + ww, y + rh);
      g.addColorStop(0, '#9a9ea0');
      g.addColorStop(1, '#5e6264');
      c.fillStyle = g;
      c.fillRect(x + 3, y + 3, ww - 6, rh - 6);
      c.strokeStyle = '#2a2c2e';
      c.lineWidth = 3;
      c.strokeRect(x + 1.5, y + 1.5, ww - 3, rh - 3);
      c.fillStyle = '#c8b070';
      c.fillRect(x + ww / 2 - cw * 0.16, y + rh * 0.14, cw * 0.32, rh * 0.16);
      c.fillStyle = '#2a2010';
      c.fillText(String(100 + j * cols + i), x + ww / 2, y + rh * 0.26);
      c.fillStyle = '#1a1a1a';
      c.beginPath();
      c.arc(x + ww / 2, y + rh * 0.6, rh * 0.07, 0, Math.PI * 2);
      c.fill();
      c.fillRect(x + ww / 2 - 1.5, y + rh * 0.6, 3, rh * 0.12);
    }
  }
}

function stencil(text: string, sub: string): Draw {
  return (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(25,20,15,1)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${h * 0.38}px "Arial Narrow", Arial, sans-serif`;
    c.fillText(text, w / 2, h * 0.33);
    c.font = `700 ${h * 0.2}px "Arial Narrow", Arial, sans-serif`;
    c.fillText(sub, w / 2, h * 0.75);
  };
}

function goldLetters(text: string, sub: string): Draw {
  return (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#e8cc88');
    g.addColorStop(0.5, '#a07a3a');
    g.addColorStop(1, '#d8b870');
    c.fillStyle = g;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `600 ${h * 0.42}px Georgia, serif`;
    c.fillText(text, w / 2, h * 0.36);
    c.font = `400 ${h * 0.2}px Georgia, serif`;
    c.fillText(sub, w / 2, h * 0.82);
  };
}

// ------------------------------------------------------------------ the interior
export function buildVargaInterior(b: Builder, deps: LevelDeps, opts: VargaInteriorOpts = {}): VargaInterior {
  const { physics } = deps;
  const shell = opts.shell ?? true;
  const N = { collide: false } as const;
  const bx = (m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, o: BoxOpts = {}) => b.box(m, sx, sy, sz, x, y, z, { shadow: false, ...o });
  const cyl = (m: THREE.Material, r: number, h: number, x: number, y: number, z: number, o: { collide?: boolean; segments?: number; radiusTop?: number } = {}) =>
    b.cylinder(m, r, h, x, y, z, { shadow: false, collide: false, segments: 16, ...o });
  const geo = (m: THREE.Material, g: THREE.BufferGeometry, uv = true) => {
    if (uv) worldUv(g);
    b.addStatic(m, g, false);
  };
  const _q = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  /** Cylinder between two points. */
  const tube = (m: THREE.Material, r: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, seg = 8) => {
    const d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    _q.setFromUnitVectors(_up, d.normalize());
    g.applyQuaternion(_q);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    geo(m, g);
  };
  /** Box with a full rotation. */
  const boxR = (m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')));
    g.translate(x, y, z);
    geo(m, g);
  };

  // ---------------------------------------------------------------- materials
  const paint = (color: number, rough = 0.85) => realMat('plaster_beige', { size: 2, color, rough, noColor: true, normalScale: 0.2 });
  const M = {
    parquet: realMat('parquet_herringbone', { size: 1.3, color: 0xa88c70, rough: 0.5, normalScale: 0.8 }),
    marble: realMat('marble_tiles_beige', { size: 2.4, color: 0xb8ae9e, rough: 0.35 }),
    terrazzo: realMat('terrazzo_tiles', { size: 1.8, color: 0x9a968e, rough: 0.5 }),
    carpet: realMat('carpet_office_grey', { size: 1.2, color: 0x8a8c90 }),
    concFloor: realMat('concrete_floor_worn', { size: 4, color: 0x8c8a86, rough: 0.8 }),
    vaultFloor: realMat('concrete_light', { size: 3, color: 0x7c7e80, rough: 0.55 }),
    saalWall: paint(0x2c3a33),
    foyerWall: paint(0xb8ae9c),
    flurWall: paint(0xa8a69e),
    wachWall: paint(0x9aa0a0),
    vaultWall: paint(0x7a7e82),
    lagerWall: realMat('concrete_wall_panels', { size: 3, color: 0x8e8e8a }),
    core: paint(0x8a8680),
    ceiling: realMat('plaster_beige', { size: 2.4, color: 0x8a8680, rough: 1 }),
    ceilTile: realMat('ceiling_tile', { size: 1.2, color: 0x9a9894 }),
    concCeil: realMat('concrete_light', { size: 3, color: 0x6a6a68 }),
    wood: realMat('wood_veneer_dark', { size: 1.4, color: 0xb09078, rough: 0.6 }),
    woodDark: realMat('wood_veneer_dark', { size: 1.0, color: 0x6a5446, rough: 0.55 }),
    mahogany: realMat('wood_veneer_mahogany', { size: 1.2, color: 0xa88a7a, rough: 0.5 }),
    plank: realMat('wood_floor_planks', { size: 0.9, color: 0xc0a07a, rough: 0.85 }),
    cardboard: realMat('wood_floor_planks', { size: 0.6, color: 0x9c7f58, rough: 0.95, noColor: true, normalScale: 0.2 }),
    gilt: realMat('metal_gold', { size: 0.5, color: 0xc8a868, metal: 1, rough: 0.45, normalScale: 0.4 }),
    gold: realMat('metal_gold', { size: 0.3, color: 0xffd890, metal: 0.7, rough: 0.3, normalScale: 0.2 }),
    brass: realMat('metal_gold', { size: 0.5, color: 0xd8b880, metal: 1, rough: 0.5, normalScale: 0.4 }),
    bronze: realMat('metal_gold', { size: 0.6, color: 0x6a4a30, metal: 1, rough: 0.5, normalScale: 0.6 }),
    steel: realMat('metal_brushed_steel', { size: 0.5, color: 0xc0c4c8, metal: 1, rough: 0.4, normalScale: 0.4 }),
    silver: realMat('metal_brushed_steel', { size: 0.2, color: 0xe8ecf0, metal: 1, rough: 0.2, normalScale: 0.2 }),
    greySteel: realMat('metal_brushed_steel', { size: 1, color: 0x6a6e72, metal: 0.4, rough: 0.55, noColor: true, normalScale: 0.15 }),
    safe: realMat('plaster_beige', { size: 2, color: 0x4e5a55, metal: 0.15, rough: 0.55, noColor: true, normalScale: 0.1 }),
    safeDoor: realMat('metal_brushed_steel', { size: 0.8, color: 0x8a9094, metal: 0.55, rough: 0.4, normalScale: 0.5 }),
    blue: paint(0x2a4a7a, 0.6),
    orange: paint(0xc4581f, 0.6),
    yellow: paint(0xd8b020, 0.7),
    velvet: realMat('carpet_red', { size: 0.4, color: 0x3a1018, rough: 0.95, noColor: true, normalScale: 0.6 }),
    velvetBlue: realMat('carpet_red', { size: 0.4, color: 0x14203a, rough: 0.95, noColor: true, normalScale: 0.6 }),
    leather: realMat('leather_brown', { size: 0.4, color: 0x3a3a3a, rough: 0.5 }),
    fabric: realMat('felt_green', { size: 0.4, color: 0x30343a, rough: 0.9, noColor: true }),
    black: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.5, metalness: 0.2 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.45, metalness: 0.05 }),
    beige: new THREE.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.5 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xa88a5c, roughness: 0.95 }),
    wrap: new THREE.MeshStandardMaterial({ color: 0x8a8e94, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.85 }),
    blanket: realMat('felt_green', { size: 0.5, color: 0x3a4250, rough: 0.95, noColor: true }),
    gem: new THREE.MeshStandardMaterial({ color: 0x8a0a18, roughness: 0.08, metalness: 0.3, emissive: 0x200004 }),
    enamel: new THREE.MeshStandardMaterial({ color: 0x1a3a8a, roughness: 0.15, metalness: 0.4 }),
    pearl: new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.25, metalness: 0.1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9aa8b0, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.08, depthWrite: false, envMapIntensity: 0.5 }),
    winGlass: new THREE.MeshStandardMaterial({ color: 0x1a222c, roughness: 0.1, metalness: 0.5, emissive: 0x2a3e60, emissiveIntensity: 1.2 }),
    winSodium: new THREE.MeshStandardMaterial({ color: 0x201810, roughness: 0.1, metalness: 0.4, emissive: 0x7a4c22, emissiveIntensity: 1.2 }),
    plant: new THREE.MeshStandardMaterial({ color: 0x24341c, roughness: 0.8 }),
  };
  // small valuables: a faint self-glow so they read under the case strips
  M.gold.emissive.set(0x3a2a0c);
  M.silver.emissive.set(0x1c2026);
  b.trackGlow(M.winGlass);
  b.trackGlow(M.winSodium);
  const caseLight = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffe0b0, emissiveIntensity: 3 });
  b.trackGlow(caseLight);
  const alarmMat = new THREE.MeshStandardMaterial({ color: 0x3a0606, roughness: 0.3, emissive: 0xff1a10, emissiveIntensity: 0 });
  const ledRed = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff2010, emissiveIntensity: 0.2 });
  const ledGreen = new THREE.MeshStandardMaterial({ color: 0x002000, emissive: 0x20ff50, emissiveIntensity: 3 });
  const ledAmber = new THREE.MeshStandardMaterial({ color: 0x201000, emissive: 0xffa020, emissiveIntensity: 2 });
  const ledBlue = new THREE.MeshStandardMaterial({ color: 0x000820, emissive: 0x4080ff, emissiveIntensity: 2 });

  // printed atlas (paintings, notices, labels, stencils): one material, alpha-tested
  const atlas = new Atlas(2048, 2048);
  const pRects = PAINTINGS.map((d, i) => atlas.add(i === 4 || i === 1 || i === 7 ? 380 : 512, i === 4 || i === 1 || i === 7 ? 500 : 380, d));
  const rNotice = atlas.add(640, 480, noticeBoard);
  const rDeposit = atlas.add(1280, 440, depositGrid);
  const rLots = [0, 1, 2, 3].map((i) => atlas.add(160, 80, label(`Los ${112 + i * 7}`, ['Collier, um 1910', 'Taschenuhren', 'Goldmünzen', 'Ziergefäß, Emaille'][i])));
  const rArtLabels = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => atlas.add(120, 60, label(`Los ${40 + i * 3}`, ['Öl auf Leinwand', 'Öl auf Holz', 'Öl auf Leinwand', 'Öl', 'Acryl', 'Öl', 'Öl auf Leinwand', 'Öl'][i], '#f0ece2')));
  const rStencilA = atlas.add(300, 140, stencil('VORSICHT GLAS', 'NICHT KIPPEN  ↑↑'));
  const rStencilB = atlas.add(300, 140, stencil('VARGA 2214', 'KUNSTTRANSPORT'));
  const rName = atlas.add(900, 200, goldLetters('AUKTIONSHAUS VARGA', 'seit 1952'));
  const rCalendar = atlas.add(200, 260, (c, w, h) => {
    c.fillStyle = '#f4f2ec';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#b02020';
    c.fillRect(0, 0, w, h * 0.18);
    c.fillStyle = '#fff';
    c.font = `700 ${h * 0.1}px ${FONT}`;
    c.textAlign = 'center';
    c.fillText('NOVEMBER', w / 2, h * 0.12);
    c.fillStyle = '#222';
    c.font = `500 ${h * 0.05}px ${FONT}`;
    for (let d = 0; d < 30; d++) c.fillText(String(d + 1), w * (0.1 + (d % 7) * 0.13), h * (0.3 + Math.floor(d / 7) * 0.13));
  });
  const rPlan = atlas.add(300, 200, (c, w, h) => {
    c.fillStyle = '#ece8dc';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2a2a2a';
    c.lineWidth = 3;
    c.strokeRect(20, 30, w - 40, h - 50);
    c.beginPath();
    c.moveTo(w * 0.35, 30);
    c.lineTo(w * 0.35, h * 0.55);
    c.moveTo(20, h * 0.55);
    c.lineTo(w - 20, h * 0.55);
    c.moveTo(w * 0.68, 30);
    c.lineTo(w * 0.68, h - 20);
    c.stroke();
    c.fillStyle = '#108040';
    c.font = `700 ${h * 0.09}px ${FONT}`;
    c.fillText('FLUCHTPLAN', 22, 22);
    c.fillStyle = '#c02020';
    c.beginPath();
    c.arc(w * 0.5, h * 0.7, 6, 0, Math.PI * 2);
    c.fill();
  });
  const rZentrale = atlas.add(320, 60, label('ALARMZENTRALE', undefined, '#d8d8d4', '#202020'));
  const rPrivat = atlas.add(240, 60, label('PRIVAT', undefined, '#c8c4bc', '#202020'));
  const rLager = atlas.add(240, 60, label('LAGER', undefined, '#c8c4bc', '#202020'));
  const rEmpfang = atlas.add(240, 60, label('Empfang', undefined, '#2a2620', '#d8c088'));
  const atlasMat = new THREE.MeshStandardMaterial({ map: atlas.texture(), roughness: 0.7, metalness: 0, alphaTest: 0.5 });
  const signAtlas = new Atlas(512, 128);
  const rExit = signAtlas.add(300, 110, exitSign);
  const signTex = signAtlas.texture();
  const signMat = new THREE.MeshStandardMaterial({ color: 0x0a1a10, map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 1.4, roughness: 0.4 });
  b.trackGlow(signMat);

  /** Plane showing an atlas cell; rotY 0 faces +z (south), PI north, PI/2 east, -PI/2 west. */
  const print = (mat: THREE.Material, A: Atlas, r: Rect, w: number, h: number, x: number, y: number, z: number, rotY: number, rx = 0) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, (r.x + u * r.w) / A.W, 1 - (r.y + (1 - v) * r.h) / A.H);
    }
    if (rx) g.rotateX(rx);
    g.rotateY(rotY);
    g.translate(x, y, z);
    b.addStatic(mat, g, false);
  };
  const pr = (r: Rect, w: number, h: number, x: number, y: number, z: number, rotY: number, rx = 0) => print(atlasMat, atlas, r, w, h, x, y, z, rotY, rx);

  // ---------------------------------------------------------------- layout
  type Ax = 'x' | 'z';
  interface Opening {
    ax: Ax; // 'x': the wall is the plane x = at (runs along z)
    at: number;
    a0: number;
    a1: number;
    top: number;
    casing?: boolean;
  }
  const OPEN: Opening[] = [
    { ax: 'x', at: -15, a0: -9.2, a1: -8.0, top: F + DOOR_H }, // Wachraum - Flur
    { ax: 'z', at: -6.6, a0: -11.85, a1: -10.65, top: F + DOOR_H }, // Flur - Saal
    { ax: 'x', at: -7.5, a0: -9.85, a1: -8.65, top: F + DOOR_H }, // Flur - Tresorraum (steel door), facing the safe
    { ax: 'x', at: -7.5, a0: -5.4, a1: -4.2, top: F + DOOR_H }, // Saal - Lager
    { ax: 'x', at: -7.5, a0: 2.3, a1: 3.5, top: F + DOOR_H }, // Lager - Foyer
    { ax: 'z', at: 0.9, a0: FD_X - 0.6, a1: FD_X + 0.6, top: F + DOOR_H }, // Saal - Foyer
    { ax: 'x', at: 0, a0: -1.1, a1: 1.1, top: F + 2.4 }, // delivery door (exterior)
    { ax: 'z', at: 4.9, a0: FD_X - 1.1, a1: FD_X + 1.1, top: F + 2.4 }, // front door
  ];
  interface Finish {
    wall: THREE.Material;
    ceil: THREE.Material;
    floor: THREE.Material;
    base?: THREE.Material;
    wain?: { mat: THREE.Material; h: number; rail: THREE.Material };
    picture?: THREE.Material;
    crown?: THREE.Material;
    casing: THREE.Material;
  }
  interface Room {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
    h: number;
    f: Finish;
  }
  const ROOMS: Record<string, Room> = {
    wach: { x0: -22, x1: -15, z0: -13.1, z1: -6.6, h: C, f: { wall: M.wachWall, ceil: M.ceilTile, floor: M.carpet, base: M.rubber, casing: M.greySteel } },
    flur: { x0: -15, x1: -7.5, z0: -13.1, z1: -6.6, h: C, f: { wall: M.flurWall, ceil: M.ceilTile, floor: M.terrazzo, base: M.rubber, casing: M.greySteel } },
    tresor: { x0: -7.5, x1: 0, z0: -13.1, z1: -6.6, h: C, f: { wall: M.vaultWall, ceil: M.concCeil, floor: M.vaultFloor, base: M.rubber, casing: M.greySteel } },
    saal: {
      x0: -22,
      x1: -7.5,
      z0: -6.6,
      z1: 0.9,
      h: C,
      f: { wall: M.saalWall, ceil: M.ceiling, floor: M.parquet, base: M.woodDark, wain: { mat: M.woodDark, h: 0.9, rail: M.woodDark }, picture: M.gilt, crown: M.beige, casing: M.woodDark },
    },
    lager: { x0: -7.5, x1: 0, z0: -6.6, z1: 4.9, h: CL, f: { wall: M.lagerWall, ceil: M.concCeil, floor: M.concFloor, casing: M.greySteel } },
    foyer: {
      x0: -22,
      x1: -7.5,
      z0: 0.9,
      z1: 4.9,
      h: C,
      f: { wall: M.foyerWall, ceil: M.ceiling, floor: M.marble, base: M.woodDark, wain: { mat: M.wood, h: 1.0, rail: M.woodDark }, crown: M.beige, casing: M.woodDark },
    },
  };
  const OUT = { x0: -22, x1: 0, z0: -13.1, z1: 4.9 };
  const isOuter = (ax: Ax, at: number) => (ax === 'x' ? at === OUT.x0 || at === OUT.x1 : at === OUT.z0 || at === OUT.z1);
  /** Inner face of a boundary line seen from the room side (dir = into the room). */
  const face = (ax: Ax, at: number, dir: number) => (isOuter(ax, at) ? at + dir * 0.3 : at + dir * (T / 2));

  // ---------------------------------------------------------------- floor + collision slab
  b.collider(-11, F / 2, -4.1, 22, F, 18);
  // finishes run to the partition centre lines but stop at the outer walls' inner faces
  // (the exterior's door sills sit exactly at floor height and must not z-fight)
  for (const r of Object.values(ROOMS)) {
    const x0 = r.x0 === OUT.x0 ? OUT.x0 + 0.3 : r.x0;
    const x1 = r.x1 === OUT.x1 ? OUT.x1 - 0.3 : r.x1;
    const z0 = r.z0 === OUT.z0 ? OUT.z0 + 0.3 : r.z0;
    const z1 = r.z1 === OUT.z1 ? OUT.z1 - 0.3 : r.z1;
    bx(r.f.floor, x1 - x0, 0.06, z1 - z0, (x0 + x1) / 2, F - 0.03, (z0 + z1) / 2, N);
  }
  // thresholds in the doorways
  for (const o of OPEN.slice(0, 6)) {
    const len = o.a1 - o.a0;
    if (o.ax === 'x') bx(M.brass, T + 0.04, 0.008, len, o.at, F + 0.002, (o.a0 + o.a1) / 2, N);
    else bx(M.brass, len, 0.008, T + 0.04, (o.a0 + o.a1) / 2, F + 0.002, o.at, N);
  }

  // ---------------------------------------------------------------- walls
  const opsOn = (ax: Ax, at: number, a0: number, a1: number) => OPEN.filter((o) => o.ax === ax && o.at === at && o.a1 > a0 && o.a0 < a1).sort((p, q) => p.a0 - q.a0);
  /** Solid wall along a line with door openings cut out; thickness th, centred at `c`. */
  const wallLine = (mat: THREE.Material, ax: Ax, at: number, c: number, th: number, a0: number, a1: number, top: number, y0 = F, cut = true) => {
    const put = (s0: number, s1: number, b0: number, b1: number) => {
      if (s1 - s0 < 0.005 || b1 - b0 < 0.005) return;
      if (ax === 'x') bx(mat, th, b1 - b0, s1 - s0, c, (b0 + b1) / 2, (s0 + s1) / 2);
      else bx(mat, s1 - s0, b1 - b0, th, (s0 + s1) / 2, (b0 + b1) / 2, c);
    };
    let cur = a0;
    for (const o of cut ? opsOn(ax, at, a0, a1) : []) {
      put(cur, o.a0, y0, top);
      put(o.a0, o.a1, o.top, top);
      cur = o.a1;
    }
    put(cur, a1, y0, top);
  };
  // partitions
  wallLine(M.core, 'x', -15, -15, T, -12.8, -6.6, C);
  wallLine(M.core, 'x', -7.5, -7.5, T, -12.8, -6.6, C);
  wallLine(M.core, 'x', -7.5, -7.5, T, -6.6, 4.6, CL);
  wallLine(M.core, 'z', -6.6, -6.6, T, -21.7, -7.5, C);
  wallLine(M.core, 'z', -6.6, -6.6, T, -7.5, -0.3, CL);
  wallLine(M.core, 'z', 0.9, 0.9, T, -21.7, -7.5, C);
  // above the lower ceilings next to the tall storage room nothing is visible
  // reveals: line the cut faces of every partition opening
  for (const o of OPEN.slice(0, 6)) {
    const h = o.top - F;
    for (const a of [o.a0 + 0.015, o.a1 - 0.015]) {
      if (o.ax === 'x') bx(M.greySteel, T + 0.02, h, 0.03, o.at, F + h / 2, a, N);
      else bx(M.greySteel, 0.03, h, T + 0.02, a, F + h / 2, o.at, N);
    }
    if (o.ax === 'x') bx(M.greySteel, T + 0.02, 0.03, o.a1 - o.a0, o.at, o.top - 0.015, (o.a0 + o.a1) / 2, N);
    else bx(M.greySteel, o.a1 - o.a0, 0.03, T + 0.02, (o.a0 + o.a1) / 2, o.top - 0.015, o.at, N);
  }
  if (!shell) {
    // stand-in shell for the standalone test level (varga.ts builds the real one)
    const sh = paint(0x6a6660);
    wallLine(sh, 'x', 0, -0.15, 0.3, -13.1, 4.9, ROOF + 0.2, 0);
    wallLine(sh, 'z', 4.9, 4.75, 0.3, -22, 0, ROOF + 0.2, 0);
    wallLine(sh, 'x', -22, -21.85, 0.3, -13.1, 4.9, ROOF + 0.2, 0);
    wallLine(sh, 'z', -13.1, -12.95, 0.3, -22, 0, ROOF + 0.2, 0);
    bx(sh, 22, 0.2, 18, -11, ROOF + 0.1, -4.1);
    bx(sh, 0.3, F, 2.2, -0.15, F / 2, 0); // delivery sill
    bx(sh, 2.2, F - 0.01, 0.3, FD_X, (F - 0.01) / 2, 4.75); // front door sill
  }

  // ---------------------------------------------------------------- linings (per room side)
  type Win = { ax: Ax; at: number; c: number; y0: number; y1: number; w: number; mat: THREE.Material; bars: number; blind?: boolean };
  const WINDOWS: Win[] = [
    ...[-5.6, -3.6, 1.8, 3.6].map((z) => ({ ax: 'x' as Ax, at: 0, c: z, y0: 4.5, y1: 5.0, w: 0.9, mat: M.winGlass, bars: 5 })),
    ...[-1.8, -4.6].map((x) => ({ ax: 'z' as Ax, at: 4.9, c: x, y0: 4.5, y1: 5.0, w: 0.9, mat: M.winGlass, bars: 5 })),
    ...[-9.0, -11.4, -17.8, -20.2].map((x) => ({ ax: 'z' as Ax, at: 4.9, c: x, y0: 1.8, y1: C - 0.12, w: 1.3, mat: M.winSodium, bars: 0, blind: true })),
  ];
  const along = (ax: Ax, f: number, a: number, off: number, dir: number) => (ax === 'x' ? { x: f + dir * off, z: a } : { x: a, z: f + dir * off });
  /** Box flat against a wall: w along the wall, d out of it (from the face), centre height y. */
  const onWall = (m: THREE.Material, ax: Ax, f: number, dir: number, a: number, y: number, w: number, h: number, d: number, off = 0, o: BoxOpts = N) => {
    const p = along(ax, f, a, off + d / 2, dir);
    if (ax === 'x') bx(m, d, h, w, p.x, y, p.z, o);
    else bx(m, w, h, d, p.x, y, p.z, o);
  };
  const rotFor = (ax: Ax, dir: number) => (ax === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI);

  const sides = (r: Room) =>
    [
      { ax: 'x' as Ax, at: r.x0, dir: 1, a0: face('z', r.z0, 1), a1: face('z', r.z1, -1) },
      { ax: 'x' as Ax, at: r.x1, dir: -1, a0: face('z', r.z0, 1), a1: face('z', r.z1, -1) },
      { ax: 'z' as Ax, at: r.z0, dir: 1, a0: face('x', r.x0, 1), a1: face('x', r.x1, -1) },
      { ax: 'z' as Ax, at: r.z1, dir: -1, a0: face('x', r.x0, 1), a1: face('x', r.x1, -1) },
    ] as const;

  for (const r of Object.values(ROOMS)) {
    const f = r.f;
    for (const s of sides(r)) {
      const fc = face(s.ax, s.at, s.dir);
      const outer = isOuter(s.ax, s.at);
      const off = outer ? 0.02 : 0.004; // linings sit a little inside the exterior's inner faces
      const ops = opsOn(s.ax, s.at, s.a0, s.a1);
      // paint skin (with the openings cut out) and, on outer walls, the window holes
      const skin = (a0: number, a1: number, y0: number, y1: number) => {
        if (a1 - a0 < 0.005 || y1 - y0 < 0.005) return;
        onWall(f.wall, s.ax, fc, s.dir, (a0 + a1) / 2, (y0 + y1) / 2, a1 - a0, y1 - y0, 0.02, off);
      };
      const wins = WINDOWS.filter((w) => w.ax === s.ax && w.at === s.at && w.c > s.a0 && w.c < s.a1);
      const holes = [...ops.map((o) => ({ a0: o.a0, a1: o.a1, y0: F, y1: o.top })), ...wins.map((w) => ({ a0: w.c - w.w / 2, a1: w.c + w.w / 2, y0: w.y0, y1: w.y1 }))].sort((p, q) => p.a0 - q.a0);
      let cur = s.a0;
      for (const h of holes) {
        skin(cur, h.a0, F, r.h);
        skin(h.a0, h.a1, F, h.y0);
        skin(h.a0, h.a1, h.y1, r.h);
        cur = h.a1;
      }
      skin(cur, s.a1, F, r.h);
      // trims along the solid parts
      const runs: [number, number][] = [];
      cur = s.a0;
      for (const o of ops) {
        runs.push([cur, o.a0]);
        cur = o.a1;
      }
      runs.push([cur, s.a1]);
      for (const [a0, a1] of runs) {
        const L = a1 - a0;
        if (L < 0.02) continue;
        const m = (a0 + a1) / 2;
        if (f.wain) {
          onWall(f.wain.mat, s.ax, fc, s.dir, m, F + f.wain.h / 2, L, f.wain.h, 0.025, off + 0.02);
          onWall(f.wain.rail, s.ax, fc, s.dir, m, F + f.wain.h, L, 0.06, 0.05, off + 0.02);
          const n = Math.max(1, Math.round(L / 1.1));
          for (let i = 0; i <= n; i++) onWall(f.wain.rail, s.ax, fc, s.dir, a0 + (i / n) * L, F + f.wain.h / 2, 0.06, f.wain.h - 0.1, 0.012, off + 0.045);
        }
        if (f.base) onWall(f.base, s.ax, fc, s.dir, m, F + 0.06, L, 0.12, 0.03, off + (f.wain ? 0.045 : 0.02));
        if (f.picture) onWall(f.picture, s.ax, fc, s.dir, m, r.h - 0.42, L, 0.03, 0.025, off + 0.02);
      }
      if (f.crown) onWall(f.crown, s.ax, fc, s.dir, (s.a0 + s.a1) / 2, r.h - 0.07, s.a1 - s.a0, 0.14, 0.08, off + 0.02);
      // door casings on this face
      for (const o of ops) {
        if (o.ax === 'x' && o.at === 0) continue; // the exterior frames the delivery door
        const h = o.top - F;
        for (const a of [o.a0 - 0.04, o.a1 + 0.04]) onWall(f.casing, s.ax, fc, s.dir, a, F + h / 2 + 0.04, 0.08, h + 0.08, 0.025, off + 0.02);
        onWall(f.casing, s.ax, fc, s.dir, (o.a0 + o.a1) / 2, o.top + 0.04, o.a1 - o.a0 + 0.16, 0.08, 0.025, off + 0.02);
      }
    }
    // ceiling (the hall has the roof hatch). It ends inside the outer walls (0.15 m in): run out to
    // the facade plane, its edge z-fought with the facade as a flickering band on every side.
    const rx0 = r.x0 === OUT.x0 ? OUT.x0 + 0.15 : r.x0;
    const rx1 = r.x1 === OUT.x1 ? OUT.x1 - 0.15 : r.x1;
    const rz0 = r.z0 === OUT.z0 ? OUT.z0 + 0.15 : r.z0;
    const rz1 = r.z1 === OUT.z1 ? OUT.z1 - 0.15 : r.z1;
    const cx = (rx0 + rx1) / 2;
    const cz = (rz0 + rz1) / 2;
    if (r === ROOMS.saal) {
      const hx0 = -10.5,
        hx1 = -8.8,
        hz0 = -2.0,
        hz1 = -0.3;
      bx(f.ceil, hx0 - rx0, 0.12, rz1 - rz0, (rx0 + hx0) / 2, r.h + 0.06, cz, N);
      bx(f.ceil, rx1 - hx1, 0.12, rz1 - rz0, (hx1 + rx1) / 2, r.h + 0.06, cz, N);
      bx(f.ceil, hx1 - hx0, 0.12, hz0 - rz0, (hx0 + hx1) / 2, r.h + 0.06, (rz0 + hz0) / 2, N);
      bx(f.ceil, hx1 - hx0, 0.12, rz1 - hz1, (hx0 + hx1) / 2, r.h + 0.06, (hz1 + rz1) / 2, N);
    } else bx(f.ceil, rx1 - rx0, 0.12, rz1 - rz0, cx, r.h + 0.06, cz, N);
  }

  // windows: dark glass with a faint glow, deep reveal, bars or a blind
  for (const w of WINDOWS) {
    const fc = face(w.ax, w.at, -1);
    const dir = -1;
    const yc = (w.y0 + w.y1) / 2;
    const h = w.y1 - w.y0;
    onWall(w.mat, w.ax, fc, dir, w.c, yc, w.w, h, 0.02, -0.08);
    onWall(M.beige, w.ax, fc, dir, w.c, w.y0 - 0.03, w.w + 0.1, 0.06, 0.2, -0.08);
    for (const a of [w.c - w.w / 2 - 0.03, w.c + w.w / 2 + 0.03]) onWall(M.foyerWall, w.ax, fc, dir, a, yc, 0.06, h, 0.12, -0.08);
    onWall(M.foyerWall, w.ax, fc, dir, w.c, w.y1 + 0.02, w.w + 0.12, 0.04, 0.12, -0.08);
    if (w.blind) {
      for (let y = w.y1 - 0.06; y > w.y0 + 0.5; y -= 0.07) onWall(M.beige, w.ax, fc, dir, w.c, y, w.w - 0.04, 0.05, 0.008, 0.015);
      onWall(M.beige, w.ax, fc, dir, w.c, w.y1 - 0.03, w.w, 0.06, 0.06, 0.0);
    } else {
      for (let i = 0; i < w.bars; i++) {
        const p = along(w.ax, fc, w.c - w.w / 2 + ((i + 0.5) * w.w) / w.bars, -0.04, dir);
        cyl(M.black, 0.012, h, p.x, yc, p.z, { segments: 6 });
      }
    }
  }

  // ---------------------------------------------------------------- exit signs + alarm beacons
  const exit = (x: number, y: number, z: number, rotY: number) => {
    const dx = Math.sin(rotY);
    const dz = Math.cos(rotY);
    bx(M.white, Math.abs(dz) * 0.42 + Math.abs(dx) * 0.06, 0.18, Math.abs(dx) * 0.42 + Math.abs(dz) * 0.06, x - dx * 0.03, y, z - dz * 0.03, N);
    print(signMat, signAtlas, rExit, 0.38, 0.14, x + dx * 0.002, y, z + dz * 0.002, rotY);
  };
  exit(FD_X, F + 2.62, face('z', 4.9, -1) - 0.03, Math.PI); // over the front door
  exit(-0.33, F + 2.65, 0, -Math.PI / 2); // over the delivery door
  exit(-11.25, F + 2.5, -6.7, Math.PI); // corridor, over the door to the hall
  exit(-7.62, F + 2.5, -4.8, -Math.PI / 2); // hall, over the door to the storage room
  exit(FD_X, F + 2.5, 0.8, Math.PI); // hall, over the door to the foyer
  exit(-15.12, F + 2.5, -8.6, -Math.PI / 2); // guard room
  const beacon = (x: number, y: number, z: number) => {
    cyl(M.plastic, 0.07, 0.04, x, y, z);
    const g = new THREE.SphereGeometry(0.06, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    g.rotateX(Math.PI);
    g.translate(x, y - 0.02, z);
    b.addStatic(alarmMat, g, false);
  };
  beacon(-18.5, C - 0.02, -7.2);
  beacon(-11.25, C - 0.02, -9.5);
  beacon(-3.75, C - 0.02, -7.3);
  beacon(-14.6, C - 0.02, -3.0);
  beacon(-3.6, CL - 0.02, -1.0);
  beacon(-11.0, C - 0.02, 2.6);

  // ---------------------------------------------------------------- doors
  const doorMeshes: THREE.Object3D[] = [];
  const noShadow = (o: THREE.Object3D) => o.traverse((c) => ((c as THREE.Mesh).castShadow = false));
  const mergeInto = (parts: { g: THREE.BufferGeometry; m: THREE.Material }[], parent: THREE.Object3D) => {
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const p of parts) {
      const list = byMat.get(p.m) ?? [];
      list.push(p.g.index ? p.g.toNonIndexed() : p.g);
      byMat.set(p.m, list);
    }
    for (const [m, gs] of byMat) {
      const g = mergeGeometries(gs, false)!;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  };
  const part = (m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, uvTile = 2) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(x, y, z);
    worldUv(g, uvTile);
    return { g, m };
  };

  // front door: two wooden leaves with glass panes, swinging into the foyer
  const frontLeaves: { hinge: THREE.Group; side: number }[] = [];
  const fdZ = face('z', 4.9, -1) - 0.05;
  for (const side of [1, -1]) {
    const hinge = new THREE.Group();
    hinge.position.set(FD_X - side * 1.08, F, fdZ);
    b.group.add(hinge);
    const w = 1.06;
    const s = side; // leaf extends along +x*side from the hinge
    const parts = [
      part(M.mahogany, w, 2.36, 0.06, (s * w) / 2, 1.18, 0),
      part(M.brass, 0.03, 0.2, 0.05, s * (w - 0.1), 1.05, -0.05),
      part(M.brass, 0.14, 0.02, 0.03, s * (w - 0.16), 1.15, -0.06),
      part(M.brass, w - 0.04, 0.18, 0.064, (s * w) / 2, 0.11, 0),
    ];
    // glazing: frame + pane in the upper two thirds
    parts.push(part(M.winSodium, w - 0.3, 1.25, 0.065, (s * w) / 2, 1.55, 0));
    for (const yy of [0.88, 2.22]) parts.push(part(M.woodDark, w - 0.24, 0.05, 0.075, (s * w) / 2, yy, 0));
    parts.push(part(M.woodDark, 0.03, 1.3, 0.075, (s * w) / 2, 1.55, 0));
    mergeInto(parts, hinge);
    frontLeaves.push({ hinge, side });
    doorMeshes.push(hinge);
  }
  const frontCol = b.collider(FD_X, F + 1.2, fdZ, 2.2, 2.4, 0.1);
  // door mat
  bx(M.carpet, 2.0, 0.012, 0.9, FD_X, F + 0.006, face('z', 4.9, -1) - 0.75, N);

  // vault-room door: heavy steel leaf, hinged at the north jamb, opens into the vault room
  const vaultHinge = new THREE.Group();
  vaultHinge.position.set(-7.5 + 0.06, F, -9.85 + 0.02);
  b.group.add(vaultHinge);
  {
    const parts = [part(M.safeDoor, 0.09, DOOR_H - 0.02, 1.16, 0, (DOOR_H - 0.02) / 2, 0.58, 1), part(M.greySteel, 0.1, 0.08, 1.0, 0, 0.3, 0.58)];
    for (const sx of [-1, 1]) {
      parts.push(part(M.steel, 0.04, 0.04, 0.2, sx * 0.07, 1.05, 1.0));
      parts.push(part(M.steel, 0.04, 0.12, 0.04, sx * 0.07, 1.05, 1.1));
    }
    mergeInto(parts, vaultHinge);
  }
  const vaultCol = b.collider(-7.5, F + DOOR_H / 2, -9.25, 0.14, DOOR_H, 1.2);
  // card reader + keypad on the corridor side
  bx(M.plastic, 0.03, 0.16, 0.09, -7.62, F + 1.25, -8.45, N);
  bx(ledRed, 0.01, 0.01, 0.03, -7.64, F + 1.31, -8.45, N);
  doorMeshes.push(vaultHinge);

  // ---------------------------------------------------------------- Ausstellungssaal
  const SZ = -2.15; // case centre z
  const caseX = [-20.1, -17.7, -15.3, -12.9];
  const hoods: { g: THREE.Group; col: Collider; open: number; target: number }[] = [];
  caseX.forEach((cx, i) => {
    bx(M.woodDark, 1.6, 0.8, 0.9, cx, F + 0.4, SZ, { shadow: false });
    bx(M.black, 1.52, 0.08, 0.82, cx, F + 0.04, SZ, N);
    bx(M.brass, 1.62, 0.02, 0.92, cx, F + 0.81, SZ, N);
    bx(i % 2 ? M.velvetBlue : M.velvet, 1.5, 0.03, 0.8, cx, F + 0.835, SZ, N);
    pr(rLots[i], 0.16, 0.08, cx + 0.55, F + 0.86, SZ + 0.32, 0, -Math.PI / 2 + 0.35);
    // contents
    const top = F + 0.85;
    if (i === 0) {
      for (const dx of [-0.35, 0.3]) {
        cyl(M.velvet, 0.07, 0.24, cx + dx, top + 0.12, SZ, { radiusTop: 0.05 });
        const tor = new THREE.TorusGeometry(0.075, 0.006, 6, 28);
        tor.rotateX(Math.PI / 2 - 0.5);
        tor.translate(cx + dx, top + 0.17, SZ + 0.02);
        geo(M.gold, tor);
        const gem = new THREE.SphereGeometry(0.014, 10, 8);
        gem.translate(cx + dx, top + 0.13, SZ + 0.07);
        geo(dx < 0 ? M.gem : M.pearl, gem, false);
      }
      for (let k = 0; k < 3; k++) {
        const ring = new THREE.TorusGeometry(0.012, 0.003, 6, 16);
        ring.translate(cx - 0.02 + k * 0.05, top + 0.03, SZ + 0.22);
        geo(M.gold, ring);
      }
    } else if (i === 1) {
      for (let k = 0; k < 4; k++) {
        const x = cx - 0.5 + k * 0.33;
        bx(M.velvetBlue, 0.14, 0.04, 0.14, x, top + 0.02, SZ, N);
        cyl(k % 2 ? M.silver : M.gold, 0.035, 0.012, x, top + 0.046, SZ, { segments: 20 });
        cyl(M.white, 0.03, 0.002, x, top + 0.053, SZ, { segments: 20 });
        bx(M.gold, 0.008, 0.006, 0.03, x, top + 0.06, SZ - 0.04, N);
      }
    } else if (i === 2) {
      bx(M.woodDark, 0.9, 0.03, 0.5, cx, top + 0.015, SZ, N);
      for (let k = 0; k < 15; k++) cyl(k % 4 ? M.gold : M.silver, 0.022, 0.006, cx - 0.36 + (k % 5) * 0.18, top + 0.034, SZ - 0.14 + Math.floor(k / 5) * 0.14, { segments: 16 });
    } else {
      cyl(M.gold, 0.05, 0.08, cx, top + 0.04, SZ, { radiusTop: 0.025 });
      const egg = new THREE.SphereGeometry(0.075, 20, 14);
      egg.scale(1, 1.3, 1);
      egg.translate(cx, top + 0.18, SZ);
      geo(M.enamel, egg, false);
      const band = new THREE.TorusGeometry(0.076, 0.005, 6, 32);
      band.rotateX(Math.PI / 2);
      band.translate(cx, top + 0.18, SZ);
      geo(M.gold, band);
      cyl(M.silver, 0.035, 0.18, cx + 0.45, top + 0.09, SZ, { radiusTop: 0.02 });
      const head = new THREE.SphereGeometry(0.03, 10, 8);
      head.translate(cx + 0.45, top + 0.21, SZ);
      geo(M.silver, head, false);
    }
    // glass hood, hinged at its back edge
    const g = new THREE.Group();
    g.position.set(cx, F + 0.82, SZ - 0.45);
    b.group.add(g);
    const parts = [];
    const hw = 1.58;
    const hh = 0.5;
    const hd = 0.88;
    for (const [sx, sy, sz, x, y, z] of [
      [hw, 0.025, 0.025, 0, hh, 0.012],
      [hw, 0.025, 0.025, 0, hh, hd - 0.012],
      [hw, 0.025, 0.025, 0, 0.012, hd - 0.012],
      [0.025, 0.025, hd, -hw / 2 + 0.012, hh, hd / 2],
      [0.025, 0.025, hd, hw / 2 - 0.012, hh, hd / 2],
      [0.025, hh, 0.025, -hw / 2 + 0.012, hh / 2, 0.012],
      [0.025, hh, 0.025, hw / 2 - 0.012, hh / 2, 0.012],
      [0.025, hh, 0.025, -hw / 2 + 0.012, hh / 2, hd - 0.012],
      [0.025, hh, 0.025, hw / 2 - 0.012, hh / 2, hd - 0.012],
    ])
      parts.push(part(M.brass, sx, sy, sz, x, y, z));
    parts.push(part(caseLight, hw - 0.1, 0.012, 0.03, 0, hh - 0.02, 0.06));
    mergeInto(parts, g);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(hw - 0.01, hh, hd - 0.01).translate(0, hh / 2, hd / 2), M.glass);
    glass.renderOrder = 3;
    g.add(glass);
    const col = b.collider(cx, F + 1.07, SZ, 1.6, 0.5, 0.9);
    hoods.push({ g, col, open: 0, target: 0 });
  });
  // painting with gilt frame on a wall side
  const painting = (ax: Ax, at: number, dir: number, a: number, y: number, w: number, h: number, pi: number, lot = -1) => {
    const fc = face(ax, at, dir) + dir * 0.02;
    const fw = 0.09;
    onWall(M.gilt, ax, fc, dir, a, y + h / 2 + fw / 2, w + fw * 2, fw, 0.06);
    onWall(M.gilt, ax, fc, dir, a, y - h / 2 - fw / 2, w + fw * 2, fw, 0.06);
    onWall(M.gilt, ax, fc, dir, a - w / 2 - fw / 2, y, fw, h, 0.06);
    onWall(M.gilt, ax, fc, dir, a + w / 2 + fw / 2, y, fw, h, 0.06);
    onWall(M.black, ax, fc, dir, a, y, w + 0.02, h + 0.02, 0.03);
    const p = along(ax, fc, a, 0.035, dir);
    pr(pRects[pi], w, h, p.x, y, p.z, rotFor(ax, dir));
    if (lot >= 0) {
      const q = along(ax, fc, a + w / 2 + 0.25, 0.006, dir);
      pr(rArtLabels[lot], 0.12, 0.06, q.x, F + 1.45, q.z, rotFor(ax, dir));
    }
    // picture hooks/wires up to the rail
    const top = ROOMS.saal.h - 0.42;
    for (const s of [-1, 1]) {
      const q0 = along(ax, fc, a + s * w * 0.3, 0.012, dir);
      const q1 = along(ax, fc, a + s * w * 0.05, 0.012, dir);
      tube(M.steel, 0.002, q1.x, top, q1.z, q0.x, y + h / 2 + fw, q0.z, 4);
    }
  };
  // north wall (Saal side of z=-6.6)
  painting('z', -6.6, 1, -19.2, F + 1.75, 1.4, 1.04, 0, 0);
  painting('z', -6.6, 1, -15.6, F + 1.8, 0.8, 1.05, 1, 1);
  painting('z', -6.6, 1, -13.3, F + 1.7, 0.95, 0.7, 2, 2);
  painting('z', -6.6, 1, -9.1, F + 1.75, 1.2, 0.9, 3, 3);
  // west wall
  painting('x', -22, 1, -4.4, F + 1.85, 1.0, 1.3, 4, 4);
  painting('x', -22, 1, -0.6, F + 1.75, 0.95, 0.7, 5, 5);
  // south wall (Saal side of z=0.9)
  painting('z', 0.9, -1, -19.0, F + 1.75, 1.3, 0.97, 6, 6);
  painting('z', 0.9, -1, -11.0, F + 1.8, 0.8, 1.05, 7, 7);
  // east wall: a large one
  painting('x', -7.5, -1, -1.6, F + 1.75, 1.3, 0.97, 0);

  // plinths with sculptures
  const plinth = (x: number, z: number, w: number, h: number) => {
    bx(M.white, w, h, w, x, F + h / 2, z, { shadow: false });
    bx(M.beige, w + 0.04, 0.04, w + 0.04, x, F + h + 0.02, z, N);
    bx(M.black, w - 0.04, 0.05, w - 0.04, x, F + 0.025, z, N);
    return F + h + 0.04;
  };
  {
    // bronze bust
    const y = plinth(-17.0, -5.4, 0.45, 1.15);
    cyl(M.bronze, 0.09, 0.04, -17.0, y + 0.02, -5.4);
    const chest = new THREE.SphereGeometry(0.16, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    chest.scale(1.2, 0.9, 0.7);
    chest.translate(-17.0, y + 0.04, -5.4);
    geo(M.bronze, chest, false);
    cyl(M.bronze, 0.05, 0.12, -17.0, y + 0.2, -5.4);
    const head = new THREE.SphereGeometry(0.1, 16, 12);
    head.scale(0.85, 1.1, 0.95);
    head.translate(-17.0, y + 0.34, -5.39);
    geo(M.bronze, head, false);
    // urn
    const y2 = plinth(-13.6, -5.5, 0.5, 0.9);
    const pts = [
      [0.0, 0],
      [0.09, 0],
      [0.1, 0.03],
      [0.06, 0.07],
      [0.14, 0.2],
      [0.17, 0.32],
      [0.12, 0.45],
      [0.07, 0.5],
      [0.1, 0.55],
      [0.0, 0.55],
    ].map(([r, h]) => new THREE.Vector2(r, h));
    const urn = new THREE.LatheGeometry(pts, 24);
    urn.translate(-13.6, y2, -5.5);
    geo(realMat('marble_black', { size: 0.6, rough: 0.3 }), urn, true);
    // big abstract bronze on a wide plinth (hiding spot behind it)
    const y3 = plinth(-9.0, -3.6, 0.9, 0.55);
    const tk = new THREE.TorusKnotGeometry(0.22, 0.06, 80, 10, 2, 3);
    tk.scale(1, 1.4, 1);
    tk.translate(-9.0, y3 + 0.38, -3.6);
    geo(M.bronze, tk, true);
    b.collider(-9.0, y3 + 0.38, -3.6, 0.6, 0.76, 0.3);
  }
  // rope barrier in front of the big north painting
  const ropeLine = (pts: [number, number][]) => {
    for (const [px, pz] of pts) {
      cyl(M.brass, 0.14, 0.03, px, F + 0.015, pz);
      cyl(M.brass, 0.02, 0.9, px, F + 0.46, pz);
      cyl(M.brass, 0.04, 0.05, px, F + 0.93, pz, { radiusTop: 0.02 });
      b.collider(px, F + 0.5, pz, 0.12, 1, 0.12);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [cx2, cz2] = pts[i + 1];
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(ax, F + 0.9, az), new THREE.Vector3((ax + cx2) / 2, F + 0.66, (az + cz2) / 2), new THREE.Vector3(cx2, F + 0.9, cz2));
      b.addStatic(M.velvet, new THREE.TubeGeometry(curve, 12, 0.016, 6), false);
    }
  };
  ropeLine([
    [-20.3, -5.75],
    [-19.2, -5.75],
    [-18.1, -5.75],
  ]);
  ropeLine([
    [-21.2, -5.3],
    [-21.2, -3.5],
  ]);
  // catalogue stand
  {
    const x = -16.6,
      z = 0.3;
    cyl(M.brass, 0.18, 0.02, x, F + 0.01, z);
    cyl(M.brass, 0.025, 1.0, x, F + 0.51, z);
    boxR(M.woodDark, 0.5, 0.03, 0.38, x, F + 1.05, z, -0.45, Math.PI, 0);
    boxR(M.paper, 0.42, 0.012, 0.3, x, F + 1.07, z + 0.008, -0.45, Math.PI, 0);
    boxR(M.white, 0.2, 0.004, 0.28, x - 0.1, F + 1.08, z + 0.004, -0.45, Math.PI, 0);
    b.collider(x, F + 0.5, z, 0.4, 1, 0.4);
  }
  // track lights (off) over the cases and the walls
  bx(M.black, 11.5, 0.03, 0.05, -15.0, C - 0.02, -2.15, N);
  bx(M.black, 11.5, 0.03, 0.05, -15.0, C - 0.02, -5.4, N);
  for (let i = 0; i < 9; i++) {
    for (const z of [-2.15, -5.4]) {
      const x = -20.4 + i * 1.3;
      cyl(M.black, 0.04, 0.12, x, C - 0.1, z + (z === -5.4 ? -0.05 : 0));
    }
  }
  // the hatch shaft and lid
  {
    const hx0 = -10.5,
      hx1 = -8.8,
      hz0 = -2.0,
      hz1 = -0.3;
    const sh = ROOF - C;
    const my = (C + ROOF) / 2;
    bx(M.concCeil, 0.06, sh, hz1 - hz0 + 0.12, hx0 - 0.03, my, (hz0 + hz1) / 2, N);
    bx(M.concCeil, 0.06, sh, hz1 - hz0 + 0.12, hx1 + 0.03, my, (hz0 + hz1) / 2, N);
    bx(M.concCeil, hx1 - hx0, sh, 0.06, (hx0 + hx1) / 2, my, hz0 - 0.03, N);
    bx(M.concCeil, hx1 - hx0, sh, 0.06, (hx0 + hx1) / 2, my, hz1 + 0.03, N);
    // ceiling trim
    for (const [sx, sz, x, z] of [
      [hx1 - hx0 + 0.16, 0.08, (hx0 + hx1) / 2, hz0 - 0.04],
      [hx1 - hx0 + 0.16, 0.08, (hx0 + hx1) / 2, hz1 + 0.04],
      [0.08, hz1 - hz0, hx0 - 0.04, (hz0 + hz1) / 2],
      [0.08, hz1 - hz0, hx1 + 0.04, (hz0 + hz1) / 2],
    ])
      bx(M.greySteel, sx, 0.03, sz, x, C - 0.015, z, N);
    // fixed steel ladder on the north side of the shaft
    for (const s of [-0.22, 0.22]) bx(M.greySteel, 0.04, sh + 0.2, 0.04, -9.65 + s, my + 0.1, hz0 + 0.1, N);
    for (let y = C + 0.15; y < ROOF - 0.1; y += 0.3) tube(M.steel, 0.012, -9.87, y, hz0 + 0.1, -9.43, y, hz0 + 0.1, 6);
  }
  const hatch = new THREE.Group();
  hatch.position.set(-10.5 + 0.02, ROOF - 0.08, -1.15);
  b.group.add(hatch);
  mergeInto(
    [
      part(M.greySteel, 1.66, 0.06, 1.66, 0.83, 0, 0),
      part(M.winGlass, 0.8, 0.065, 0.8, 0.83, 0, 0),
      part(M.steel, 0.3, 0.04, 0.04, 1.4, -0.05, 0),
    ],
    hatch,
  );
  // moonlight through the hatch glazing and the storage room's high windows
  b.cone(0x8fa8d8, -9.65, ROOF - 0.12, -1.15, 0.9, ROOF - F - 0.2, 0.07);
  for (const z of [-5.6, -3.6, 1.8, 3.6]) {
    const m = b.cone(0x8fa8d8, -0.4, 4.85, z, 0.7, 4.6, 0.05);
    m.rotation.z = -0.55;
  }

  // ---------------------------------------------------------------- Foyer
  {
    // reception desk: tall front counter, lower work top behind, L return
    const x = -20.1;
    bx(M.mahogany, 0.08, 1.1, 2.3, x + 0.3, F + 0.55, 2.75); // front panel
    bx(M.woodDark, 0.4, 0.04, 2.4, x + 0.25, F + 1.12, 2.75, N); // counter top
    bx(M.mahogany, 1.3, 1.1, 0.08, x - 0.4, F + 0.55, 1.6); // return
    bx(M.woodDark, 1.38, 0.04, 0.3, x - 0.38, F + 1.12, 1.62, N);
    bx(M.wood, 0.7, 0.04, 2.2, x - 0.1, F + 0.74, 2.8, N); // work top
    bx(M.woodDark, 0.04, 0.72, 0.6, x - 0.42, F + 0.37, 3.6, N);
    bx(M.brass, 0.012, 0.02, 2.3, x + 0.345, F + 0.95, 2.75, N);
    pr(rEmpfang, 0.4, 0.1, x + 0.346, F + 0.82, 2.75, Math.PI / 2);
    // monitor, phone, bell, catalogues
    bx(M.plastic, 0.04, 0.3, 0.48, x - 0.25, F + 0.98, 2.3, N);
    bx(M.plastic, 0.12, 0.02, 0.18, x - 0.22, F + 0.77, 2.3, N);
    bx(M.plastic, 0.16, 0.02, 0.4, x + 0.0, F + 0.77, 2.3, N);
    bx(M.plastic, 0.18, 0.06, 0.2, x - 0.1, F + 0.79, 3.3, N);
    for (let k = 0; k < 5; k++) bx(k % 2 ? M.white : M.beige, 0.22, 0.012, 0.3, x + 0.25, F + 1.15 + k * 0.012, 3.5, N);
    cyl(M.brass, 0.04, 0.03, x + 0.25, F + 1.155, 2.2);
    // chair behind the desk
    officeChair(x - 0.9, 2.6, -Math.PI / 2);
    // name lettering on the wall behind
    pr(rName, 2.4, 0.53, face('x', -22, 1) + 0.03, F + 2.15, 2.8, Math.PI / 2);
    // bench under the windows, coat rack, plant, umbrella stand
    const benchX = -10.2;
    const bz = face('z', 4.9, -1) - 0.3;
    bx(M.wood, 1.7, 0.05, 0.42, benchX, F + 0.45, bz);
    for (const s of [-0.75, 0.75]) bx(M.black, 0.05, 0.43, 0.38, benchX + s, F + 0.215, bz, N);
    bx(M.leather, 1.6, 0.05, 0.38, benchX, F + 0.495, bz, N);
    cyl(M.black, 0.22, 0.02, -8.2, F + 0.01, 1.5);
    cyl(M.black, 0.02, 1.75, -8.2, F + 0.88, 1.5, { collide: true });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      tube(M.black, 0.01, -8.2, F + 1.65, 1.5, -8.2 + Math.cos(a) * 0.2, F + 1.75, 1.5 + Math.sin(a) * 0.2, 5);
    }
    const coat = new THREE.CapsuleGeometry(0.16, 0.7, 4, 10);
    coat.scale(1, 1, 0.5);
    coat.translate(-8.06, F + 1.25, 1.52);
    geo(M.blanket, coat, false);
    const potPts = [
      [0, 0],
      [0.16, 0],
      [0.2, 0.45],
      [0.18, 0.45],
      [0, 0.42],
    ].map(([r, h]) => new THREE.Vector2(r, h));
    const pot = new THREE.LatheGeometry(potPts, 16);
    pot.translate(-8.1, F, 4.1);
    geo(M.black, pot);
    const rr = rng(5);
    for (let k = 0; k < 14; k++) {
      const s = new THREE.IcosahedronGeometry(0.16 + rr() * 0.1, 0);
      s.translate(-8.1 + (rr() - 0.5) * 0.5, F + 0.7 + rr() * 0.9, 4.1 + (rr() - 0.5) * 0.4);
      geo(M.plant, s, false);
    }
    cyl(M.black, 0.04, 1.0, -8.1, F + 0.9, 4.1);
    b.collider(-8.1, F + 0.6, 4.1, 0.45, 1.2, 0.45);
    cyl(M.greySteel, 0.12, 0.5, FD_X - 1.55, F + 0.25, 4.2, { collide: true, radiusTop: 0.13 });
    // notice board on the foyer side of the hall wall, east of the door
    const nf = face('z', 0.9, 1);
    bx(M.woodDark, 1.36, 1.0, 0.04, -10.6, F + 1.6, nf + 0.03, N);
    pr(rNotice, 1.28, 0.92, -10.6, F + 1.6, nf + 0.052, 0);
    pr(rPlan, 0.3, 0.2, -8.3, F + 1.55, nf + 0.03, 0);
    // ceiling pendants (off)
    for (const x of [-18.5, -14.6, -10.6]) {
      cyl(M.brass, 0.05, 0.03, x, C - 0.015, 2.9);
      cyl(M.black, 0.006, 0.7, x, C - 0.36, 2.9);
      const sh = new THREE.SphereGeometry(0.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      sh.translate(x, C - 0.85, 2.9);
      geo(M.white, sh, false);
    }
  }

  // ---------------------------------------------------------------- Wachraum
  function officeChair(x: number, z: number, rot: number) {
    for (let k = 0; k < 5; k++) {
      const a = rot + (k / 5) * Math.PI * 2;
      tube(M.plastic, 0.015, x, F + 0.06, z, x + Math.sin(a) * 0.3, F + 0.05, z + Math.cos(a) * 0.3, 6);
      cyl(M.rubber, 0.025, 0.05, x + Math.sin(a) * 0.3, F + 0.025, z + Math.cos(a) * 0.3, { segments: 8 });
    }
    cyl(M.steel, 0.025, 0.4, x, F + 0.26, z);
    const sx = Math.sin(rot);
    const sz = Math.cos(rot);
    bx(M.fabric, 0.48, 0.08, 0.46, x, F + 0.48, z, { collide: false, rotY: rot, round: 0.03 });
    bx(M.fabric, 0.46, 0.55, 0.07, x - sx * 0.23, F + 0.85, z - sz * 0.23, { collide: false, rotY: rot, round: 0.03 });
    tube(M.plastic, 0.015, x - sx * 0.15, F + 0.5, z - sz * 0.15, x - sx * 0.25, F + 0.6, z - sz * 0.25, 6);
    b.collider(x, F + 0.45, z, 0.55, 0.9, 0.55);
  }
  const screens: ScreenHandle[] = [];
  let feedTime = 0;
  const feed = (title: string, kind: number) => (c: CanvasRenderingContext2D, w: number, h: number) => {
    const r = rng(kind * 7 + 1);
    c.fillStyle = '#1c2024';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#4a5258';
    c.lineWidth = 2;
    c.fillStyle = '#2c3236';
    if (kind === 0) {
      c.fillRect(0, h * 0.62, w, h);
      c.strokeRect(w * 0.3, h * 0.2, w * 0.25, h * 0.45);
      c.fillStyle = '#3a4246';
      c.fillRect(w * 0.65, h * 0.5, w * 0.3, h * 0.2);
    } else if (kind === 1) {
      c.beginPath();
      c.moveTo(0, h);
      c.lineTo(w * 0.4, h * 0.45);
      c.lineTo(w * 0.6, h * 0.45);
      c.lineTo(w, h);
      c.fill();
      c.strokeRect(w * 0.4, h * 0.2, w * 0.2, h * 0.25);
    } else if (kind === 2) {
      c.fillRect(0, h * 0.55, w, h);
      for (let k = 0; k < 4; k++) c.strokeRect(w * (0.1 + k * 0.22), h * 0.45, w * 0.14, h * 0.12);
    } else {
      c.fillRect(0, h * 0.6, w, h);
      c.fillStyle = '#3a4044';
      c.fillRect(w * 0.1, h * 0.35, w * 0.35, h * 0.3);
      c.fillRect(w * 0.55, h * 0.25, w * 0.3, h * 0.4);
    }
    const img = c.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const k = (r() - 0.5) * 26;
      img.data[i] += k;
      img.data[i + 1] += k;
      img.data[i + 2] += k;
    }
    c.putImageData(img, 0, 0);
    c.fillStyle = '#e8e8e8';
    c.font = `600 ${h * 0.075}px ${MONO}`;
    c.textAlign = 'left';
    c.fillText(title, w * 0.03, h * 0.1);
    const s = Math.floor(feedTime) % 60;
    const m = (14 + Math.floor(feedTime / 60)) % 60;
    c.textAlign = 'right';
    c.fillText(`02:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, w * 0.97, h * 0.95);
  };
  const deskZ = face('z', -13.1, 1);
  {
    // desk along the north wall
    bx(M.wood, 3.2, 0.04, 0.8, -19.0, F + 0.74, deskZ + 0.4);
    bx(M.greySteel, 0.04, 0.72, 0.76, -20.56, F + 0.36, deskZ + 0.4, N);
    bx(M.greySteel, 0.04, 0.72, 0.76, -17.44, F + 0.36, deskZ + 0.4, N);
    bx(M.greySteel, 0.45, 0.6, 0.7, -17.75, F + 0.32, deskZ + 0.38, N); // drawer unit
    b.collider(-19.0, F + 0.38, deskZ + 0.4, 3.2, 0.76, 0.8);
    const titles = ['CAM 01  LIEFERHOF', 'CAM 02  FOYER', 'CAM 03  SAAL', 'CAM 04  LAGER'];
    for (let k = 0; k < 3; k++) {
      const x = -20.0 + k * 0.95;
      bx(M.plastic, 0.2, 0.015, 0.16, x, F + 0.77, deskZ + 0.18, N);
      bx(M.plastic, 0.05, 0.2, 0.04, x, F + 0.86, deskZ + 0.16, N);
      bx(M.plastic, 0.62, 0.39, 0.035, x, F + 1.12, deskZ + 0.2, N);
      screens.push(b.screen(0.58, 0.34, x, F + 1.12, deskZ + 0.219, 0, 400, feed(titles[k], k), 0.9));
    }
    // wall-mounted overview screen
    bx(M.plastic, 1.04, 0.62, 0.05, -19.0, F + 1.85, deskZ + 0.04, N);
    screens.push(b.screen(1.0, 0.58, -19.0, F + 1.85, deskZ + 0.066, 0, 300, feed('CAM 05  TRESOR', 3), 0.8));
    bx(M.plastic, 0.45, 0.02, 0.16, -19.0, F + 0.77, deskZ + 0.5, N); // keyboard
    bx(M.plastic, 0.06, 0.02, 0.1, -18.6, F + 0.77, deskZ + 0.52, N); // mouse
    bx(M.plastic, 0.2, 0.08, 0.18, -20.3, F + 0.8, deskZ + 0.55, N); // phone
    bx(M.black, 0.08, 0.2, 0.06, -17.85, F + 0.86, deskZ + 0.25, N); // radio in charger
    bx(ledGreen, 0.01, 0.01, 0.005, -17.85, F + 0.97, deskZ + 0.283, N);
    cyl(M.white, 0.04, 0.1, -18.3, F + 0.81, deskZ + 0.6); // mug
    bx(M.beige, 0.24, 0.03, 0.32, -19.7, F + 0.775, deskZ + 0.55, N); // log book
    officeChair(-19.0, deskZ + 1.35, Math.PI);
    pr(rCalendar, 0.3, 0.39, -21.1, F + 1.7, deskZ + 0.022, 0);
    // lockers along the west wall
    const lx = face('x', -22, 1);
    for (let k = 0; k < 4; k++) {
      const z = -11.35 + k * 0.5;
      bx(M.greySteel, 0.5, 1.85, 0.48, lx + 0.27, F + 0.925, z, { shadow: false });
      bx(M.black, 0.005, 0.03, 0.3, lx + 0.522, F + 1.6, z, N);
      bx(M.black, 0.005, 0.03, 0.3, lx + 0.522, F + 1.55, z, N);
      bx(M.steel, 0.02, 0.12, 0.03, lx + 0.53, F + 1.05, z + 0.17, N);
      bx(M.black, 0.004, 1.85, 0.008, lx + 0.521, F + 0.925, z + 0.244, N);
    }
    // sideboard with coffee machine by the south wall
    const sz2 = face('z', -6.6, -1);
    bx(M.white, 1.4, 0.88, 0.55, -20.9, F + 0.44, sz2 - 0.28);
    bx(M.woodDark, 1.44, 0.03, 0.58, -20.9, F + 0.895, sz2 - 0.29, N);
    bx(M.black, 0.32, 0.4, 0.36, -21.3, F + 1.11, sz2 - 0.28, N);
    bx(M.steel, 0.22, 0.02, 0.12, -21.3, F + 0.93, sz2 - 0.42, N);
    bx(M.steel, 0.3, 0.06, 0.02, -21.3, F + 1.25, sz2 - 0.465, N);
    bx(ledBlue, 0.03, 0.01, 0.005, -21.22, F + 1.18, sz2 - 0.462, N);
    cyl(M.white, 0.04, 0.09, -20.85, F + 0.955, sz2 - 0.3);
    cyl(M.white, 0.04, 0.09, -20.72, F + 0.955, sz2 - 0.2);
    bx(M.beige, 0.25, 0.3, 0.2, -20.35, F + 1.06, sz2 - 0.3, N); // kettle-ish box: packs of coffee
    // small table with two chairs
    bx(M.wood, 0.8, 0.03, 0.8, -17.4, F + 0.74, -7.5);
    cyl(M.steel, 0.03, 0.72, -17.4, F + 0.37, -7.5);
    cyl(M.steel, 0.25, 0.02, -17.4, F + 0.01, -7.5);
    b.collider(-17.4, F + 0.38, -7.5, 0.8, 0.76, 0.8);
    for (const dx of [-0.6, 0.6]) {
      bx(M.plastic, 0.42, 0.04, 0.42, -17.4 + dx, F + 0.46, -7.5, N);
      bx(M.plastic, 0.04, 0.42, 0.42, -17.4 + dx * 1.35, F + 0.7, -7.5, N);
      for (const [ox, oz] of [
        [-0.18, -0.18],
        [0.18, -0.18],
        [-0.18, 0.18],
        [0.18, 0.18],
      ])
        cyl(M.steel, 0.012, 0.45, -17.4 + dx + ox, F + 0.225, -7.5 + oz, { segments: 6 });
      b.collider(-17.4 + dx, F + 0.45, -7.5, 0.45, 0.9, 0.45);
    }
    // key cabinet
    bx(M.greySteel, 0.04, 0.5, 0.4, face('x', -15, -1) - 0.02, F + 1.6, -11.5, N);
    // plan of the building on the wall
    pr(rPlan, 0.6, 0.4, face('x', -15, -1) - 0.003, F + 1.65, -10.5, -Math.PI / 2);
    pr(rPrivat, 0.3, 0.075, -15.12 + 0.24, F + 2.05, -8.6, Math.PI / 2);
  }

  // ---------------------------------------------------------------- Flur
  {
    const nz = face('z', -13.1, 1);
    // stacked auction chairs along the north wall
    for (let s = 0; s < 3; s++) {
      const x = -13.6 + s * 0.7;
      for (let k = 0; k < 6; k++) {
        bx(M.woodDark, 0.44, 0.03, 0.42, x, F + 0.45 + k * 0.07, nz + 0.35, N);
        bx(M.woodDark, 0.44, 0.4, 0.03, x, F + 0.75 + k * 0.07, nz + 0.14, N);
      }
      for (const [ox, oz] of [
        [-0.2, 0.17],
        [0.2, 0.17],
        [-0.2, 0.53],
        [0.2, 0.53],
      ])
        bx(M.woodDark, 0.03, 0.45, 0.03, x + ox, F + 0.225, nz + oz, N);
      b.collider(x, F + 0.6, nz + 0.35, 0.5, 1.2, 0.5);
    }
    // folding tables leaning against the wall
    for (let k = 0; k < 3; k++) boxR(M.wood, 1.6, 0.04, 0.75, -9.4 + k * 0.05, F + 0.4, nz + 0.12, 0, Math.PI / 2, 1.35 + k * 0.03);
    b.collider(-9.35, F + 0.4, nz + 0.4, 0.5, 0.8, 1.6);
    // fire extinguisher, fuse box, cleaning trolley
    const wx = face('x', -15, -1);
    cyl(M.orange, 0.08, 0.5, wx + 0.12, F + 0.55, -12.1, { segments: 12 });
    cyl(M.black, 0.025, 0.1, wx + 0.12, F + 0.85, -12.1);
    bx(M.greySteel, 0.6, 0.8, 0.15, -12.2, F + 1.7, nz + 0.075, N);
    bx(M.yellow, 0.1, 0.1, 0.005, -12.2, F + 1.95, nz + 0.152, N);
    bx(M.blue, 0.8, 0.04, 0.45, -8.4, F + 0.75, -9.4);
    bx(M.blue, 0.8, 0.04, 0.45, -8.4, F + 0.25, -9.4, N);
    for (const [ox, oz] of [
      [-0.38, -0.2],
      [0.38, -0.2],
      [-0.38, 0.2],
      [0.38, 0.2],
    ])
      cyl(M.steel, 0.012, 0.75, -8.4 + ox, F + 0.42, -9.4 + oz, { segments: 6 });
    cyl(M.yellow, 0.17, 0.32, -8.65, F + 0.43, -9.4);
    cyl(M.white, 0.1, 0.2, -8.2, F + 0.87, -9.4);
    b.collider(-8.4, F + 0.4, -9.4, 0.85, 0.8, 0.5);
    // ceiling tube lights (off)
    for (const z of [-11.5, -8.6]) for (const x of [-13.0, -9.6]) bx(M.white, 1.25, 0.06, 0.18, x, C - 0.03, z, N);
    pr(rLager, 0.3, 0.075, -7.62, F + 2.05, -4.8, -Math.PI / 2);
  }

  // ---------------------------------------------------------------- Tresorraum
  const SAFE = { x0: -5.4, x1: -2.1, z0: -10.6, z1: -7.9, h: 2.3 };
  const safeCZ = (SAFE.z0 + SAFE.z1) / 2;
  const safeDoor = new THREE.Group();
  {
    const cx = (SAFE.x0 + SAFE.x1) / 2;
    const w = SAFE.x1 - SAFE.x0;
    const d = SAFE.z1 - SAFE.z0;
    bx(M.black, w - 0.1, 0.1, d - 0.1, cx, F + 0.05, safeCZ, N);
    bx(M.safe, w, SAFE.h - 0.1, d, cx, F + 0.1 + (SAFE.h - 0.1) / 2, safeCZ, { shadow: false, round: 0.04 });
    bx(M.safe, w + 0.08, 0.08, d + 0.08, cx, F + SAFE.h - 0.04, safeCZ, N);
    // seams and rivets on the side walls
    for (let k = 1; k < 4; k++) {
      bx(M.black, 0.004, SAFE.h - 0.3, 0.01, SAFE.x1 + 0.002, F + SAFE.h / 2, SAFE.z0 + (k * d) / 4, N);
      bx(M.black, (w * 3) / 4 / 3, 0.004, 0.004, cx, F + 0.2, SAFE.z1 + 0.002, N);
    }
    for (let k = 1; k < 6; k++) bx(M.black, 0.01, SAFE.h - 0.3, 0.004, SAFE.x0 + (k * w) / 6, F + SAFE.h / 2, SAFE.z1 + 0.002, N);
    // door frame ring on the west face
    const dy = F + 1.2;
    const ring = new THREE.TorusGeometry(0.88, 0.07, 10, 48);
    ring.rotateY(Math.PI / 2);
    ring.translate(SAFE.x0 - 0.02, dy, safeCZ);
    geo(M.safeDoor, ring);
    const recess = new THREE.CylinderGeometry(0.84, 0.84, 0.04, 40);
    recess.rotateZ(Math.PI / 2);
    recess.translate(SAFE.x0 + 0.005, dy, safeCZ);
    geo(M.black, recess, false);
    // nameplate
    bx(M.brass, 0.01, 0.12, 0.6, SAFE.x0 - 0.005, F + SAFE.h - 0.22, safeCZ, N);
    // the round door, hinged at its south edge
    safeDoor.position.set(SAFE.x0 - 0.06, dy, safeCZ + 0.86);
    b.group.add(safeDoor);
    const parts: { g: THREE.BufferGeometry; m: THREE.Material }[] = [];
    const disc = new THREE.CylinderGeometry(0.82, 0.82, 0.16, 48);
    disc.rotateZ(Math.PI / 2);
    disc.translate(0.02, 0, -0.86);
    worldUv(disc, 1);
    parts.push({ g: disc, m: M.safeDoor });
    const face2 = new THREE.CylinderGeometry(0.62, 0.66, 0.03, 40);
    face2.rotateZ(Math.PI / 2);
    face2.translate(-0.07, 0, -0.86);
    parts.push({ g: face2, m: M.steel });
    const wheel = new THREE.TorusGeometry(0.26, 0.022, 8, 32);
    wheel.rotateY(Math.PI / 2);
    wheel.translate(-0.2, 0, -0.86);
    parts.push({ g: wheel, m: M.silver });
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.CylinderGeometry(0.014, 0.014, 0.52, 6);
      sp.rotateX((k * Math.PI) / 3);
      sp.translate(-0.2, 0, -0.86);
      parts.push({ g: sp, m: M.silver });
    }
    const hub = new THREE.CylinderGeometry(0.06, 0.07, 0.14, 16);
    hub.rotateZ(Math.PI / 2);
    hub.translate(-0.15, 0, -0.86);
    parts.push({ g: hub, m: M.silver });
    const dial = new THREE.CylinderGeometry(0.09, 0.1, 0.05, 32);
    dial.rotateZ(Math.PI / 2);
    dial.translate(-0.11, 0.42, -0.86);
    parts.push({ g: dial, m: M.black });
    parts.push(part(M.white, 0.01, 0.03, 0.006, -0.14, 0.52, -0.86));
    for (const hy of [-0.45, 0.45]) {
      const hg = new THREE.CylinderGeometry(0.06, 0.06, 0.24, 16);
      hg.translate(0.0, hy, 0.0);
      parts.push({ g: hg, m: M.safeDoor });
    }
    // locking bolts on the rim
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const bolt = new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10);
      bolt.translate(0.02, Math.sin(a) * 0.86, -0.86 + Math.cos(a) * 0.86);
      bolt.rotateX(0);
      parts.push({ g: bolt, m: M.silver });
    }
    mergeInto(parts, safeDoor);
    // inside the safe (seen when open): shelves with cash boxes
    bx(M.black, 0.6, 1.6, 1.6, SAFE.x0 + 0.33, dy, safeCZ, N);
    // deposit boxes on the north wall
    const dz = face('z', -13.1, 1);
    bx(M.greySteel, 6.6, 2.2, 0.42, -3.85, F + 1.1, dz + 0.21);
    pr(rDeposit, 6.4, 2.0, -3.85, F + 1.12, dz + 0.422, 0);
    bx(M.greySteel, 6.7, 0.08, 0.46, -3.85, F + 2.24, dz + 0.23, N);
    // steel table and a document trolley
    bx(M.steel, 1.4, 0.03, 0.7, -1.1, F + 0.9, -11.6);
    for (const [ox, oz] of [
      [-0.65, -0.3],
      [0.65, -0.3],
      [-0.65, 0.3],
      [0.65, 0.3],
    ])
      bx(M.greySteel, 0.04, 0.88, 0.04, -1.1 + ox, F + 0.44, -11.6 + oz, N);
    b.collider(-1.1, F + 0.45, -11.6, 1.4, 0.9, 0.7);
    bx(M.black, 0.3, 0.06, 0.4, -1.3, F + 0.945, -11.6, N); // cash box
    bx(M.brass, 0.25, 0.01, 0.03, -0.8, F + 0.92, -11.5, N);
    // corner camera
    const cam = new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    cam.translate(-0.7, C - 0.02, -7.2);
    geo(M.black, cam, false);
    bx(ledRed, 0.012, 0.012, 0.012, -0.72, C - 0.09, -7.15, N);
  }
  b.collider((SAFE.x0 + SAFE.x1) / 2, F + SAFE.h / 2, safeCZ, SAFE.x1 - SAFE.x0, SAFE.h, SAFE.z1 - SAFE.z0);

  // ---------------------------------------------------------------- Lager
  const panelObj = new THREE.Object3D();
  {
    // floor markings
    bx(M.yellow, 0.08, 0.004, 3.0, -1.4, F + 0.002, 0, N);
    bx(M.yellow, 5.6, 0.004, 0.08, -4.2, F + 0.002, -4.9, N);
    // heavy pallet racking along the north wall
    const rz0 = face('z', -6.6, 1) + 0.05;
    const depth = 0.95;
    const bays = [-7.2, -5.0, -2.8, -0.6];
    for (const x of bays) {
      for (const z of [rz0 + 0.05, rz0 + depth - 0.05]) bx(M.blue, 0.08, 3.7, 0.08, x, F + 1.85, z, N);
      for (let y = 0.5; y < 3.7; y += 0.6) bx(M.blue, 0.03, 0.03, depth - 0.1, x, F + y, rz0 + depth / 2, N);
    }
    b.collider(-3.9, F + 1.85, rz0 + depth / 2, 6.7, 3.7, depth);
    const levels = [0.12, 1.3, 2.5, 3.6];
    for (const y of levels) {
      for (const z of [rz0 + 0.05, rz0 + depth - 0.05]) bx(M.orange, 6.6, 0.12, 0.05, -3.9, F + y, z, N);
      if (y > 0.2) bx(M.plank, 6.6, 0.025, depth - 0.1, -3.9, F + y + 0.07, rz0 + depth / 2, N);
    }
    const rr = rng(77);
    for (let li = 0; li < levels.length; li++) {
      const y = F + levels[li] + (li ? 0.085 : 0.06);
      let x = -7.05;
      while (x < -0.9) {
        const kind = rr();
        const w = 0.35 + rr() * 0.6;
        if (x + w > -0.7) break;
        const h = Math.min(0.25 + rr() * 0.6, li < 3 ? 0.95 : 1.2);
        const dd = 0.4 + rr() * 0.4;
        const zc = rz0 + depth / 2 + (rr() - 0.5) * 0.1;
        if (kind < 0.45) bx(M.cardboard, w, h, dd, x + w / 2, y + h / 2, zc, N);
        else if (kind < 0.7) bx(M.plank, w, h, dd, x + w / 2, y + h / 2, zc, N);
        else if (kind < 0.85) {
          // wrapped flat item (a painting in a blanket), standing
          bx(M.blanket, 0.08, Math.min(0.9, h + 0.3), dd + 0.2, x + 0.05, y + Math.min(0.9, h + 0.3) / 2, zc, N);
          x += 0.1;
          continue;
        } else bx(M.wrap, w, h, dd, x + w / 2, y + h / 2, zc, N);
        x += w + 0.04 + rr() * 0.12;
      }
    }
    // rolled carpets on the bottom level
    for (let k = 0; k < 2; k++) {
      const g = new THREE.CylinderGeometry(0.13, 0.13, 2.0, 14);
      g.rotateZ(Math.PI / 2);
      g.translate(-1.9, F + 0.3 + k * 0.25, rz0 + 0.3 + k * 0.2);
      geo(k ? M.velvet : M.paper, g);
    }

    // the goods: three crates (plan: x -6.7..-2.5, z -3.3..-2.2)
    const crate = (x0: number, x1: number, z0: number, z1: number, h: number, y0 = F, st = -1) => {
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const w = x1 - x0;
      const d = z1 - z0;
      bx(M.plank, w, h, d, cx, y0 + h / 2, cz, { shadow: false });
      const e = 0.07;
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        bx(M.woodDark, e, h + 0.01, e, cx + (sx * (w - e)) / 2 + sx * 0.012, y0 + h / 2, cz + (sz * (d - e)) / 2 + sz * 0.012, N);
      for (const yy of [y0 + 0.05, y0 + h - 0.05]) {
        bx(M.woodDark, w + 0.03, 0.08, 0.025, cx, yy, z0 - 0.005, N);
        bx(M.woodDark, w + 0.03, 0.08, 0.025, cx, yy, z1 + 0.005, N);
        bx(M.woodDark, 0.025, 0.08, d + 0.03, x0 - 0.005, yy, cz, N);
        bx(M.woodDark, 0.025, 0.08, d + 0.03, x1 + 0.005, yy, cz, N);
      }
      if (st >= 0) pr(st ? rStencilB : rStencilA, Math.min(0.8, w - 0.2), Math.min(0.8, w - 0.2) * 0.46, cx, y0 + h * 0.55, z1 + 0.02, 0);
      return y0 + h;
    };
    crate(-6.7, -5.6, -3.3, -2.2, 1.1, F, 0);
    const t2 = crate(-5.25, -4.1, -3.3, -2.2, 0.8, F, 1);
    crate(-4.95, -4.4, -3.05, -2.45, 0.45, t2);
    crate(-3.75, -2.7, -3.3, -2.2, 1.3, F, 0);
    // pallet under nothing: a loaded pallet in the south-east
    const pallet = (cx: number, cz: number) => {
      for (const dz of [-0.5, 0, 0.5]) bx(M.plank, 1.2, 0.1, 0.1, cx, F + 0.05, cz + dz, N);
      for (let k = 0; k < 6; k++) bx(M.plank, 0.12, 0.025, 1.1, cx - 0.53 + k * 0.212, F + 0.112, cz, N);
      return F + 0.125;
    };
    const py = pallet(-2.75, 4.0);
    bx(M.cardboard, 1.1, 0.5, 0.95, -2.75, py + 0.25, 4.0);
    bx(M.cardboard, 0.7, 0.4, 0.6, -2.85, py + 0.7, 4.05, N);
    bx(M.wrap, 1.14, 0.92, 1.0, -2.75, py + 0.45, 4.0, N);
    b.collider(-2.75, F + 0.6, 4.0, 1.2, 1.2, 1.1);
    // light steel shelving along the south wall
    const sz = face('z', 4.9, -1);
    for (const x of [-7.15, -5.75, -4.35]) for (const dz of [-0.04, -0.5]) bx(M.greySteel, 0.04, 2.0, 0.04, x, F + 1.0, sz + dz, N);
    for (const y of [0.15, 0.7, 1.25, 1.8]) {
      bx(M.greySteel, 2.86, 0.025, 0.52, -5.75, F + y, sz - 0.27, N);
      const r2 = rng(Math.floor(y * 100));
      let x = -7.05;
      while (x < -4.6) {
        const w = 0.25 + r2() * 0.4;
        const h = 0.15 + r2() * 0.3;
        if (x + w > -4.45) break;
        bx(r2() < 0.7 ? M.cardboard : M.white, w, h, 0.4, x + w / 2, F + y + 0.0125 + h / 2, sz - 0.27, N);
        x += w + 0.05;
      }
    }
    b.collider(-5.75, F + 1.0, sz - 0.27, 2.9, 2.0, 0.55);
    // packing table along the west wall
    const wx = face('x', -7.5, -1);
    bx(M.plank, 0.8, 0.05, 2.0, wx - 0.42, F + 0.9, 0.2);
    for (const oz of [-0.9, 0.9]) for (const ox of [-0.35, 0.35]) bx(M.greySteel, 0.05, 0.88, 0.05, wx - 0.42 + ox, F + 0.44, 0.2 + oz, N);
    bx(M.greySteel, 0.75, 0.025, 1.9, wx - 0.42, F + 0.25, 0.2, N);
    b.collider(wx - 0.42, F + 0.46, 0.2, 0.8, 0.92, 2.0);
    const roll = new THREE.CylinderGeometry(0.08, 0.08, 0.75, 14);
    roll.rotateX(Math.PI / 2);
    roll.rotateY(Math.PI / 2);
    roll.translate(wx - 0.42, F + 1.01, -0.6);
    geo(M.paper, roll);
    bx(M.paper, 0.7, 0.004, 1.0, wx - 0.42, F + 0.927, -0.05, N);
    bx(M.cardboard, 0.45, 0.3, 0.35, wx - 0.45, F + 1.075, 0.7, N);
    for (let k = 0; k < 6; k++) bx(M.cardboard, 0.7, 0.012, 0.9, wx - 0.42, F + 0.27 + k * 0.012, 0.2, N);
    cyl(M.beige, 0.05, 0.05, wx - 0.2, F + 0.95, 0.25);
    bx(M.plastic, 0.12, 0.1, 0.2, wx - 0.55, F + 0.98, 0.35, N); // tape gun
    // hand truck leaning by the table
    {
      const x = wx - 0.35;
      const z = 1.75;
      const lean = 0.35;
      for (const s of [-0.18, 0.18]) tube(M.greySteel, 0.016, x, F + 0.12, z + s, x - lean, F + 1.25, z + s);
      tube(M.greySteel, 0.014, x - lean, F + 1.25, z - 0.18, x - lean, F + 1.25, z + 0.18);
      tube(M.greySteel, 0.012, x - lean * 0.5, F + 0.7, z - 0.18, x - lean * 0.5, F + 0.7, z + 0.18);
      bx(M.greySteel, 0.25, 0.012, 0.4, x + 0.12, F + 0.02, z, N);
      for (const s of [-0.24, 0.24]) {
        const wh = new THREE.CylinderGeometry(0.11, 0.11, 0.06, 16);
        wh.rotateX(Math.PI / 2);
        wh.translate(x - 0.05, F + 0.11, z + s);
        geo(M.rubber, wh, false);
      }
      b.collider(x - 0.1, F + 0.6, z, 0.5, 1.2, 0.6);
    }
    // ceiling: steel beams and dark high-bay lamps
    for (const z of [-4.0, -1.0, 2.0]) bx(M.greySteel, 7.2, 0.3, 0.14, -3.75, CL - 0.15, z, N);
    for (const [x, z] of [
      [-5.2, -2.5],
      [-2.2, -2.5],
      [-5.2, 1.0],
      [-2.2, 1.0],
    ]) {
      cyl(M.black, 0.006, 0.8, x, CL - 0.4, z);
      cyl(M.greySteel, 0.25, 0.25, x, CL - 0.9, z, { radiusTop: 0.08 });
    }

    // the alarm centre ("Zentrale"): wall cabinet with keypad and status lights on the east wall
    const ex = face('x', 0, -1) - 0.02;
    const pz = 2.55;
    const py2 = F + 1.45;
    bx(M.beige, 0.2, 0.9, 1.2, ex - 0.1, py2, pz);
    bx(M.greySteel, 0.012, 0.86, 1.16, ex - 0.206, py2, pz, N);
    bx(M.black, 0.01, 0.003, 1.0, ex - 0.213, py2 + 0.36, pz, N);
    // keypad unit
    bx(M.plastic, 0.03, 0.26, 0.2, ex - 0.225, py2 + 0.05, pz + 0.3, N);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) bx(M.white, 0.01, 0.035, 0.045, ex - 0.243, py2 + 0.0 - r * 0.045, pz + 0.24 + c * 0.06, N);
    // status lights
    const leds: [THREE.Material, number][] = [
      [ledGreen, 0],
      [ledAmber, 1],
      [ledRed, 2],
      [ledGreen, 3],
      [ledGreen, 4],
    ];
    for (const [m, k] of leds) bx(m, 0.01, 0.022, 0.022, ex - 0.214, py2 + 0.25, pz - 0.45 + k * 0.07, N);
    // conduits up the wall
    for (const dz of [-0.4, -0.2, 0.3]) tube(M.greySteel, 0.016, ex - 0.03, py2 + 0.45, pz + dz, ex - 0.03, CL - 0.1, pz + dz, 8);
    tube(M.greySteel, 0.016, ex - 0.03, py2 - 0.45, pz - 0.3, ex - 0.03, F + 0.1, pz - 0.3, 8);
    pr(rZentrale, 0.5, 0.094, ex - 0.214, py2 + 0.55, pz, -Math.PI / 2);
    // siren box above
    bx(M.white, 0.12, 0.3, 0.24, ex - 0.06, F + 3.2, pz, N);
    bx(alarmMat, 0.02, 0.08, 0.16, ex - 0.13, F + 3.2, pz, N);
    panelObj.position.set(ex - 0.22, py2, pz);
    b.group.add(panelObj);
  }
  let alarm = false;
  const lcd = b.screen(0.17, 0.07, face('x', 0, -1) - 0.02 - 0.244, F + 1.45 + 0.28, 2.55 + 0.3, -Math.PI / 2, 900, (c, w, h) => {
    c.fillStyle = alarm ? '#3a0a08' : '#0a2a18';
    c.fillRect(0, 0, w, h);
    c.fillStyle = alarm ? '#ff6a50' : '#7aff9a';
    c.font = `600 ${h * 0.36}px ${MONO}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(alarm ? 'ALARM' : 'SCHARF', w / 2, h * 0.32);
    c.font = `500 ${h * 0.24}px ${MONO}`;
    c.fillText(alarm ? 'ZONE 03 LAGER' : 'ALLE ZONEN OK', w / 2, h * 0.74);
  }, 0.9);

  // dust in the hall and the storage room
  const dustSaal = b.dust(-14.5, F + 1.6, -2.8, 13, 2.6, 6.6, 160);
  const dustLager = b.dust(-3.8, F + 2.2, -1.0, 6.5, 4, 10, 120);

  // ---------------------------------------------------------------- lights (6, no shadows)
  const lights: THREE.Light[] = [];
  const pointL = (color: number, i: number, x: number, y: number, z: number, d: number, decay = 1.8) => {
    const l = b.point(color, i, x, y, z, d, decay);
    l.castShadow = false;
    lights.push(l);
    return l;
  };
  const lCases = pointL(0xffd8a8, 5.0, -16.5, F + 2.4, -2.4, 7); // display cases (the hood strips glow too)
  const lLager = pointL(0x9ab4e0, 7.0, -2.6, F + 4.0, 0.0, 10, 1.5); // moonlight spill from the high windows
  const lWach = pointL(0x9cc4ff, 1.8, -19.0, F + 1.3, deskZ + 0.9, 5.5); // monitors
  const lFoyer = pointL(0xffc890, 2.4, -14.6, F + 2.4, 3.9, 5.5, 1.6); // street light through the front door glass
  const lVault = pointL(0xb8c8e8, 2.6, -3.8, C - 0.3, -7.2, 6.5); // night light in the vault room
  void lVault;
  const lExit = pointL(0x40ff90, 0.9, -11.25, F + 2.3, -7.6, 3.5); // corridor exit sign
  const baseCol = lights.map((l) => l.color.clone());
  void lCases;
  void lLager;
  void lWach;
  void lFoyer;
  void lExit;

  for (const d of doorMeshes) noShadow(d);
  for (const h of hoods) noShadow(h.g);
  noShadow(safeDoor);
  noShadow(hatch);

  // ---------------------------------------------------------------- anchors
  const H = Math.PI / 2;
  const anchors: Anchors = {
    'in.liefer': { x: -1.4, y: F, z: 0, yaw: H, r: 1.0 },
    'in.vorder': { x: FD_X, y: F, z: 3.6, yaw: 0, r: 1.0 },
    'in.dach': { x: -9.65, y: F, z: -1.15, yaw: 0, r: 0.8 },
    panel: { x: -1.05, y: F, z: 2.55, yaw: -H, r: 0.8 },
    safe: { x: -6.35, y: F, z: safeCZ, yaw: -H, r: 0.9 },
    'lager.goods': { x: -4.7, y: F, z: -1.5, yaw: 0, r: 1.2 },
    monitor: { x: -19.0, y: F, z: deskZ + 1.2, yaw: 0, r: 0.8 },
  };
  caseX.forEach((x, i) => (anchors[`case.${i}`] = { x, y: F, z: -1.1, yaw: 0, r: 0.8 }));
  const guard: [number, number][] = [
    [-18.3, -9.0], // Wachraum
    [-12.0, -8.2], // Flur
    [-11.25, -5.0], // Saal
    [-6.4, -4.8], // Lager
    [-1.6, -4.2], // Lager, east
    [-4.6, 2.9], // Lager, south
    [FD_X, 2.3], // Foyer
    [FD_X, -0.4], // Saal, south
    [-11.2, -0.9], // Saal, under the hatch side
    [-11.25, -8.6], // Flur
  ];
  guard.forEach(([x, z], i) => {
    const [nx, nz] = guard[(i + 1) % guard.length];
    anchors[`guard.${i}`] = { x, y: F, z, yaw: Math.atan2(-(nx - x), -(nz - z)), r: 0.5 };
  });
  const hides: [number, number, number][] = [
    [-7.0, -2.75, 0.4], // behind the first crate
    [-20.9, 2.9, 0.5], // under / behind the reception desk
    [-8.25, -3.6, 0.45], // behind the big bronze
    [-1.2, safeCZ, 0.7], // behind the safe
    [-6.9, 3.95, 0.4], // corner behind the storage shelving end
  ];
  hides.forEach(([x, z, r], i) => (anchors[`hide.${i}`] = { x, y: F, z, r }));

  // ---------------------------------------------------------------- runtime
  let front = 0,
    frontT = 0,
    vault = 0,
    vaultT = 0,
    safeO = 0,
    safeT = 0,
    hatchO = 0,
    hatchT = 0;
  let screenClock = 0;
  const ease = (x: number) => x * x * (3 - 2 * x);
  const step = (cur: number, target: number, speed: number, dt: number) => cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), dt * speed);

  return {
    anchors,
    lights,
    objects: { cases: hoods.map((h) => h.g), safe: safeDoor, panel: panelObj, frontDoor: frontLeaves[0].hinge, vaultDoor: vaultHinge, monitor: screens[3].mesh, hatch },
    update(dt, t) {
      dustSaal(t);
      dustLager(t);
      if (front !== frontT) {
        front = step(front, frontT, 0.9, dt);
        for (const l of frontLeaves) l.hinge.rotation.y = l.side * ease(front) * 1.5;
      }
      if (vault !== vaultT) {
        vault = step(vault, vaultT, 0.5, dt);
        vaultHinge.rotation.y = ease(vault) * 1.45;
      }
      if (safeO !== safeT) {
        safeO = step(safeO, safeT, 0.35, dt);
        safeDoor.rotation.y = ease(safeO) * 1.75;
      }
      if (hatchO !== hatchT) {
        hatchO = step(hatchO, hatchT, 0.8, dt);
        hatch.rotation.z = -ease(hatchO) * 1.5;
      }
      for (const h of hoods) {
        if (h.open !== h.target) {
          h.open = step(h.open, h.target, 1.6, dt);
          h.g.rotation.x = -ease(h.open) * 1.0;
        }
      }
      const p = b.getPower();
      if (alarm) {
        const ph = (t * 1.6) % 1;
        const s = ph < 0.12 || (ph > 0.24 && ph < 0.34) ? 1 : 0;
        alarmMat.emissiveIntensity = (0.4 + s * 14) * p;
        ledRed.emissiveIntensity = (s ? 6 : 1) * p;
        // the room lights take on a little of the strobe (colour only, no new lights)
        lights.forEach((l, i) => l.color.copy(baseCol[i]).lerp(RED, 0.25 + s * 0.5));
      } else {
        alarmMat.emissiveIntensity = 0;
        ledRed.emissiveIntensity = 0.2 * p;
      }
      ledAmber.emissiveIntensity = (t % 1.5 < 0.1 ? 4 : 0.4) * p;
      ledGreen.emissiveIntensity = 2.5 * p;
      screenClock += dt;
      if (screenClock > 1) {
        screenClock = 0;
        feedTime = t;
        screens[0]?.redraw();
      }
    },
    openFrontDoor(open) {
      frontT = open ? 1 : 0;
      physics.setEnabled(frontCol, !open);
    },
    openVaultDoor(open) {
      vaultT = open ? 1 : 0;
      physics.setEnabled(vaultCol, !open);
    },
    openCase(i, open) {
      const h = hoods[i];
      if (!h) return;
      h.target = open ? 1 : 0;
      physics.setEnabled(h.col, !open);
    },
    setAlarm(on) {
      if (alarm === on) return;
      alarm = on;
      lcd.redraw();
      if (!on) lights.forEach((l, i) => l.color.copy(baseCol[i]));
    },
    openSafe(open) {
      safeT = open ? 1 : 0;
    },
    openHatch(open) {
      hatchT = open ? 1 : 0;
    },
  };
}
const RED = new THREE.Color(0xff2010);
