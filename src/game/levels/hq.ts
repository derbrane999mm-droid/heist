// The crew's HQ: an empty, rented flat in an old building, at night. Four people
// camp here to plan one job. Static style sample (nothing replicated); two local
// interactions: the planning table and the ceiling-light switch.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Builder, FONT, MONO } from '../build';
import { realMat } from '../realmats';
import { registerStrings, t } from '../../core/i18n';
import type { Level, LevelDeps } from '../level';

registerStrings(
  {
    'hq.obj': 'Plan the job at the table',
    'hq.plan': 'Plan the job',
    'hq.plan.later': 'Planning comes in the next step.',
    'hq.light.on': 'Switch on the ceiling light',
    'hq.light.off': 'Switch off the ceiling light',
    'hq.p.ground': 'GROUND FLOOR',
    'hq.p.basement': 'BASEMENT',
    'hq.p.entrance': 'Entrance',
    'hq.p.yard': 'Yard',
    'hq.p.staff': 'Staff',
    'hq.p.times': 'TIMES',
    'hq.p.shift': 'Shift change',
    'hq.p.delivery': 'Delivery',
    'hq.p.patrol': 'Patrol',
    'hq.p.lights': 'Lights off',
    'hq.p.cleaners': 'Cleaners leave',
    'hq.p.area': 'AREA',
  },
  {
    'hq.obj': 'Plant den Einsatz am Tisch',
    'hq.plan': 'Einsatz planen',
    'hq.plan.later': 'Die Planung kommt im nächsten Schritt.',
    'hq.light.on': 'Deckenlicht einschalten',
    'hq.light.off': 'Deckenlicht ausschalten',
    'hq.p.ground': 'ERDGESCHOSS',
    'hq.p.basement': 'UNTERGESCHOSS',
    'hq.p.entrance': 'Eingang',
    'hq.p.yard': 'Hof',
    'hq.p.staff': 'Personal',
    'hq.p.times': 'ZEITEN',
    'hq.p.shift': 'Schichtwechsel',
    'hq.p.delivery': 'Lieferung',
    'hq.p.patrol': 'Streife',
    'hq.p.lights': 'Licht aus',
    'hq.p.cleaners': 'Reinigung geht',
    'hq.p.area': 'UMGEBUNG',
  },
);

// Main room x [-3.5, 3.5], z [-2.75, 2.75]; hallway x [0, 3.5], z [2.9, 4.4].
const RX = 3.5;
const RZ = 2.75;
const H = 3.2;
const WT = 0.3; // outer wall thickness
const TABLE = new THREE.Vector3(0.6, 0.75, -0.6);

// ------------------------------------------------------------------ canvas helpers
type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

function rnd(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function canvasTex(w: number, h: number, draw: Draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A sheet of paper with a soft drop shadow, rotated around its centre; `inner` draws in sheet space. */
function sheet(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rot: number, inner?: Draw, paper = '#e9e7e1', shadow = 0.35) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  if (shadow > 0) {
    c.fillStyle = `rgba(0,0,0,${shadow})`;
    c.fillRect(-w / 2 + w * 0.012, -h / 2 + h * 0.014, w, h);
  }
  c.fillStyle = paper;
  c.fillRect(-w / 2, -h / 2, w, h);
  if (inner) {
    c.translate(-w / 2, -h / 2);
    inner(c, w, h);
  }
  c.restore();
}

/** Strips of matt tape over the corners of a sheet (call in the same transform as the sheet). */
function tape(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rot: number, s: number) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = 'rgba(226,219,196,0.78)';
  for (const [tx, ty, a] of [
    [-w / 2, -h / 2, -0.7],
    [w / 2, -h / 2, 0.7],
    [-w / 2, h / 2, 0.7],
    [w / 2, h / 2, -0.7],
  ]) {
    c.save();
    c.translate(tx, ty);
    c.rotate(a);
    c.fillRect(-s, -s * 0.28, s * 2, s * 0.56);
    c.restore();
  }
  c.restore();
}

/** Lines of printed "text" (grey bars) for documents seen from a distance. */
function textLines(c: CanvasRenderingContext2D, x: number, y: number, w: number, lh: number, n: number, seed: number, color = 'rgba(40,40,46,0.55)') {
  const r = rnd(seed);
  c.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const len = i % 6 === 5 ? w * (0.2 + r() * 0.3) : w * (0.75 + r() * 0.25);
    c.fillRect(x, y + i * lh, len, lh * 0.42);
  }
}

/** Grainy black-and-white print (photos taken from a car). */
function photo(kind: number, seed: number): Draw {
  return (c, w, h) => {
    const r = rnd(seed);
    const m = w * 0.05;
    const iw = w - m * 2;
    const ih = h - m * 2;
    c.save();
    c.translate(m, m);
    c.beginPath();
    c.rect(0, 0, iw, ih);
    c.clip();
    const g = c.createLinearGradient(0, 0, 0, ih);
    g.addColorStop(0, '#6a6e72');
    g.addColorStop(1, '#2a2d30');
    c.fillStyle = g;
    c.fillRect(0, 0, iw, ih);
    if (kind === 0) {
      // facade with windows and an entrance
      c.fillStyle = '#3b3e42';
      c.fillRect(iw * 0.05, ih * 0.15, iw * 0.9, ih);
      for (let yy = 0; yy < 4; yy++)
        for (let xx = 0; xx < 6; xx++) {
          c.fillStyle = r() > 0.8 ? '#b9b39c' : '#24272a';
          c.fillRect(iw * (0.1 + xx * 0.14), ih * (0.22 + yy * 0.15), iw * 0.08, ih * 0.1);
        }
      c.fillStyle = '#121314';
      c.fillRect(iw * 0.42, ih * 0.8, iw * 0.16, ih * 0.2);
    } else if (kind === 1) {
      // service door with a camera above
      c.fillStyle = '#4a4d50';
      c.fillRect(0, 0, iw, ih);
      c.fillStyle = '#26282a';
      c.fillRect(iw * 0.32, ih * 0.3, iw * 0.36, ih * 0.7);
      c.fillStyle = '#8d8f90';
      c.fillRect(iw * 0.62, ih * 0.38, iw * 0.04, ih * 0.08);
      c.fillStyle = '#d7d7d2';
      c.fillRect(iw * 0.72, ih * 0.12, iw * 0.12, ih * 0.06);
      c.fillRect(iw * 0.76, ih * 0.08, iw * 0.03, ih * 0.05);
    } else if (kind === 2) {
      // loading bay
      c.fillStyle = '#2e3134';
      c.fillRect(0, ih * 0.2, iw, ih * 0.8);
      for (let i = 0; i < 2; i++) {
        c.fillStyle = '#74787c';
        c.fillRect(iw * (0.1 + i * 0.45), ih * 0.35, iw * 0.35, ih * 0.5);
        c.fillStyle = '#56595d';
        for (let s = 0; s < 9; s++) c.fillRect(iw * (0.1 + i * 0.45), ih * (0.36 + s * 0.055), iw * 0.35, ih * 0.012);
      }
    } else {
      // street at night: parked car and a lamp
      c.fillStyle = '#16181a';
      c.fillRect(0, ih * 0.7, iw, ih * 0.3);
      c.fillStyle = '#232628';
      c.beginPath();
      c.roundRect(iw * 0.12, ih * 0.5, iw * 0.6, ih * 0.2, ih * 0.05);
      c.fill();
      c.fillRect(iw * 0.24, ih * 0.38, iw * 0.33, ih * 0.14);
      c.fillStyle = '#ece6c8';
      c.beginPath();
      c.arc(iw * 0.86, ih * 0.16, ih * 0.06, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#0e1011';
      c.fillRect(iw * 0.855, ih * 0.2, iw * 0.012, ih * 0.6);
    }
    for (let i = 0; i < 500; i++) {
      c.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)';
      c.fillRect(r() * iw, r() * ih, 2, 2);
    }
    c.restore();
  };
}

/** Architect-style floor plan of the target building (generic). */
function floorPlan(title: string, seed: number): Draw {
  return (c, w, h) => {
    const r = rnd(seed);
    c.fillStyle = '#ecebe6';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2b2d33';
    const lw = Math.max(1.5, w * 0.009);
    const R = (x: number, y: number, rw: number, rh: number, k = 1) => {
      c.lineWidth = lw * k;
      c.strokeRect(w * x, h * y, w * rw, h * rh);
    };
    R(0.08, 0.14, 0.84, 0.72, 1.6);
    R(0.08, 0.14, 0.28, 0.32);
    R(0.36, 0.14, 0.3, 0.32);
    R(0.66, 0.14, 0.26, 0.2);
    R(0.66, 0.34, 0.26, 0.52);
    R(0.08, 0.46, 0.2, 0.4);
    // stair
    c.lineWidth = lw * 0.5;
    for (let i = 0; i < 7; i++) {
      c.beginPath();
      c.moveTo(w * (0.3 + i * 0.03), h * 0.52);
      c.lineTo(w * (0.3 + i * 0.03), h * 0.7);
      c.stroke();
    }
    // door gaps with swing arcs
    c.fillStyle = '#ecebe6';
    for (const [x, y, rw, rh] of [
      [0.47, 0.84, 0.08, 0.04],
      [0.2, 0.44, 0.06, 0.04],
      [0.64, 0.58, 0.04, 0.07],
    ]) {
      c.fillRect(w * x, h * y, w * rw, h * rh);
      c.beginPath();
      c.arc(w * x, h * (y + rh / 2), w * rw, -Math.PI / 2, 0);
      c.stroke();
    }
    // dimensions
    c.lineWidth = lw * 0.4;
    c.beginPath();
    c.moveTo(w * 0.08, h * 0.92);
    c.lineTo(w * 0.92, h * 0.92);
    c.stroke();
    c.font = `500 ${h * 0.035}px ${MONO}`;
    c.fillStyle = '#2b2d33';
    c.textAlign = 'center';
    c.fillText('24.60', w * 0.5, h * 0.965);
    c.font = `700 ${h * 0.05}px ${FONT}`;
    c.textAlign = 'left';
    c.fillText(title, w * 0.08, h * 0.09);
    c.font = `500 ${h * 0.035}px ${FONT}`;
    c.textAlign = 'center';
    c.fillText(t('hq.p.entrance'), w * 0.51, h * 0.8);
    c.fillText(t('hq.p.staff'), w * 0.18, h * 0.7);
    c.fillText(t('hq.p.yard'), w * 0.79, h * 0.24);
    c.fillText('A', w * 0.22, h * 0.3);
    c.fillText('B', w * 0.51, h * 0.3);
    c.fillText('C', w * 0.79, h * 0.62);
    // a few pencil notes, matter-of-fact
    c.strokeStyle = 'rgba(30,60,140,0.8)';
    c.lineWidth = lw * 0.6;
    c.beginPath();
    c.ellipse(w * 0.79, h * 0.62, w * 0.07, h * 0.06, 0.1 + r() * 0.2, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([lw * 2, lw * 1.5]);
    c.beginPath();
    c.moveTo(w * 0.51, h * 0.9);
    c.lineTo(w * 0.51, h * 0.62);
    c.lineTo(w * 0.72, h * 0.62);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(30,60,140,0.85)';
    c.font = `600 ${h * 0.04}px ${FONT}`;
    c.fillText('?', w * 0.6, h * 0.42);
    c.fillText('2×', w * 0.86, h * 0.47);
  };
}

/** Printed street map of the area around the target. */
function streetMap(c: CanvasRenderingContext2D, w: number, h: number) {
  const r = rnd(11);
  c.fillStyle = '#e4e2da';
  c.fillRect(0, 0, w, h);
  // river
  c.fillStyle = '#b9c6cf';
  c.beginPath();
  c.moveTo(w * 0.78, 0);
  c.bezierCurveTo(w * 0.7, h * 0.4, w * 0.95, h * 0.6, w * 0.82, h);
  c.lineTo(w, h);
  c.lineTo(w, 0);
  c.fill();
  // blocks between streets
  c.save();
  c.translate(w * 0.38, h * 0.5);
  c.rotate(-0.12);
  for (let iy = -5; iy <= 5; iy++)
    for (let ix = -5; ix <= 4; ix++) {
      const bw = w * (0.09 + r() * 0.03);
      const bh = h * (0.085 + r() * 0.03);
      c.fillStyle = ix === 1 && iy === 0 ? '#c9b9a8' : '#cfccc3';
      c.fillRect(ix * w * 0.13, iy * h * 0.12, bw, bh);
    }
  c.restore();
  // main road
  c.strokeStyle = '#f6f3ea';
  c.lineWidth = w * 0.03;
  c.beginPath();
  c.moveTo(0, h * 0.82);
  c.lineTo(w * 0.72, h * 0.66);
  c.stroke();
  c.strokeStyle = '#c7a24f';
  c.lineWidth = w * 0.004;
  c.stroke();
  // target block and route, in pen
  c.strokeStyle = 'rgba(30,60,140,0.85)';
  c.lineWidth = w * 0.006;
  c.beginPath();
  c.ellipse(w * 0.55, h * 0.5, w * 0.08, h * 0.08, 0, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([w * 0.012, w * 0.01]);
  c.beginPath();
  c.moveTo(w * 0.05, h * 0.2);
  c.lineTo(w * 0.3, h * 0.24);
  c.lineTo(w * 0.36, h * 0.48);
  c.lineTo(w * 0.49, h * 0.5);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = '#2b2d33';
  c.font = `700 ${h * 0.045}px ${FONT}`;
  c.textAlign = 'left';
  c.fillText(t('hq.p.area'), w * 0.04, h * 0.07);
  c.font = `500 ${h * 0.03}px ${MONO}`;
  c.fillText('1:5000', w * 0.04, h * 0.95);
  // scale bar
  c.fillRect(w * 0.2, h * 0.935, w * 0.1, h * 0.008);
}

/** Printed timetable. */
function timesSheet(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = '#2b2d33';
  c.font = `700 ${h * 0.06}px ${FONT}`;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillText(t('hq.p.times'), w * 0.1, h * 0.12);
  const rows: [string, string][] = [
    ['21:30', t('hq.p.cleaners')],
    ['22:00', t('hq.p.lights')],
    ['22:40', t('hq.p.shift')],
    ['23:15', t('hq.p.patrol')],
    ['00:20', t('hq.p.patrol')],
    ['05:45', t('hq.p.delivery')],
  ];
  c.lineWidth = Math.max(1, h * 0.003);
  c.strokeStyle = 'rgba(40,40,46,0.4)';
  rows.forEach(([time, label], i) => {
    const y = h * (0.22 + i * 0.1);
    c.font = `600 ${h * 0.04}px ${MONO}`;
    c.fillText(time, w * 0.1, y);
    c.font = `500 ${h * 0.04}px ${FONT}`;
    c.fillText(label, w * 0.36, y);
    c.beginPath();
    c.moveTo(w * 0.1, y + h * 0.025);
    c.lineTo(w * 0.9, y + h * 0.025);
    c.stroke();
  });
  // handwritten tick marks
  c.strokeStyle = 'rgba(30,60,140,0.85)';
  c.lineWidth = Math.max(1.5, h * 0.006);
  for (const i of [1, 2, 3]) {
    const y = h * (0.21 + i * 0.1);
    c.beginPath();
    c.moveTo(w * 0.85, y - h * 0.01);
    c.lineTo(w * 0.87, y + h * 0.005);
    c.lineTo(w * 0.91, y - h * 0.03);
    c.stroke();
  }
  textLines(c, w * 0.1, h * 0.84, w * 0.8, h * 0.035, 3, 5);
}

function sticky(lines: string[], color: string): Draw {
  return (c, w, h) => {
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,0.07)';
    c.fillRect(0, 0, w, h * 0.12);
    c.fillStyle = '#23232a';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `600 ${h * 0.2}px ${FONT}`;
    lines.forEach((l, i) => c.fillText(l, w / 2, h * (0.4 + i * 0.26)));
  };
}

/** The taped-up wall: plans, map, photos, times. 2.6 x 1.2 m. */
function wallBoard(c: CanvasRenderingContext2D, w: number, h: number) {
  const s = w / 2.6; // px per metre
  const items: [number, number, number, number, number, Draw][] = [
    [0.42, 0.42, 0.594, 0.42, -0.01, floorPlan(t('hq.p.ground'), 3)],
    [0.42, 0.92, 0.42, 0.297, 0.015, floorPlan(t('hq.p.basement'), 8)],
    [1.15, 0.38, 0.42, 0.297, 0.008, streetMap],
    [1.86, 0.3, 0.15, 0.1, -0.02, photo(0, 2)],
    [2.04, 0.31, 0.15, 0.1, 0.012, photo(1, 5)],
    [2.22, 0.3, 0.15, 0.1, -0.006, photo(2, 9)],
    [1.86, 0.43, 0.15, 0.1, 0.01, photo(3, 13)],
    [2.04, 0.44, 0.15, 0.1, -0.015, photo(0, 17)],
    [1.13, 0.87, 0.21, 0.297, -0.006, timesSheet],
    [1.45, 0.86, 0.21, 0.297, 0.01, (c2, w2, h2) => textLines(c2, w2 * 0.12, h2 * 0.1, w2 * 0.76, h2 * 0.034, 22, 4)],
    [2.1, 0.78, 0.38, 0.27, -0.01, floorPlan('C', 21)],
    [1.72, 0.6, 0.076, 0.076, 0.04, sticky(['B?'], '#e9d97a')],
  ];
  for (const [x, y, sw, sh, rot, draw] of items) {
    sheet(c, x * s, y * s, sw * s, sh * s, rot, draw, '#e9e7e1', 0.28);
    if (sw > 0.1) tape(c, x * s, y * s, sw * s, sh * s, rot, s * 0.022);
  }
}

/** Papers spread on the table top (1.9 x 0.95 m). */
function tablePapers(c: CanvasRenderingContext2D, w: number, h: number) {
  const s = w / 1.9;
  sheet(c, 0.92 * s, 0.48 * s, 0.84 * s, 0.594 * s, 0.03, floorPlan(t('hq.p.ground'), 3), '#e6e4dd', 0.3);
  sheet(c, 0.33 * s, 0.32 * s, 0.297 * s, 0.21 * s, -0.25, streetMap, '#e6e4dd', 0.3);
  sheet(c, 0.3 * s, 0.68 * s, 0.21 * s, 0.297 * s, 0.12, (c2, w2, h2) => textLines(c2, w2 * 0.12, h2 * 0.1, w2 * 0.76, h2 * 0.034, 22, 9), '#ebe9e3', 0.3);
  sheet(c, 0.42 * s, 0.74 * s, 0.21 * s, 0.297 * s, -0.08, timesSheet, '#ebe9e3', 0.3);
  sheet(c, 1.5 * s, 0.75 * s, 0.15 * s, 0.1 * s, 0.3, photo(1, 5), '#f1f0ec', 0.35);
  sheet(c, 1.58 * s, 0.82 * s, 0.15 * s, 0.1 * s, -0.12, photo(3, 13), '#f1f0ec', 0.35);
  sheet(c, 1.32 * s, 0.2 * s, 0.076 * s, 0.076 * s, 0.1, sticky(['22:40'], '#e9d97a'), '#e9d97a', 0.25);
  // pen and pencil
  c.save();
  c.translate(1.15 * s, 0.86 * s);
  c.rotate(0.5);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(-0.07 * s + 3, -0.0045 * s + 3, 0.14 * s, 0.009 * s);
  c.fillStyle = '#1d2c5a';
  c.fillRect(-0.07 * s, -0.0045 * s, 0.14 * s, 0.009 * s);
  c.restore();
  c.save();
  c.translate(0.66 * s, 0.17 * s);
  c.rotate(-1.2);
  c.fillStyle = '#c99a2e';
  c.fillRect(-0.085 * s, -0.004 * s, 0.17 * s, 0.008 * s);
  c.restore();
}

function laptopScreen(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = '#15181d';
  c.fillRect(0, 0, w, h);
  // title bar
  c.fillStyle = '#23272e';
  c.fillRect(0, 0, w, h * 0.06);
  // map / satellite-like view on the left
  const mx = w * 0.02;
  const my = h * 0.09;
  const mw = w * 0.62;
  const mh = h * 0.86;
  c.fillStyle = '#2b3036';
  c.fillRect(mx, my, mw, mh);
  const r = rnd(4);
  for (let i = 0; i < 70; i++) {
    c.fillStyle = `rgba(${150 + r() * 60},${150 + r() * 60},${150 + r() * 50},${0.15 + r() * 0.2})`;
    c.fillRect(mx + r() * mw * 0.95, my + r() * mh * 0.95, mw * (0.04 + r() * 0.08), mh * (0.04 + r() * 0.08));
  }
  c.strokeStyle = '#d9dde3';
  c.lineWidth = h * 0.012;
  c.beginPath();
  c.moveTo(mx, my + mh * 0.7);
  c.lineTo(mx + mw, my + mh * 0.55);
  c.stroke();
  c.strokeStyle = '#4ea3ff';
  c.lineWidth = h * 0.01;
  c.strokeRect(mx + mw * 0.52, my + mh * 0.28, mw * 0.18, mh * 0.2);
  // list on the right
  c.fillStyle = '#c9ced6';
  c.font = `600 ${h * 0.05}px ${FONT}`;
  c.textAlign = 'left';
  c.fillText('22:40', w * 0.68, h * 0.17);
  textLines(c, w * 0.68, h * 0.24, w * 0.28, h * 0.06, 10, 7, 'rgba(200,206,214,0.55)');
}

/** Opposite building across the street, at night (30 x 18 m, drawn 1:1 in metres). */
function facade(c: CanvasRenderingContext2D, w: number, h: number) {
  const s = w / 30;
  const r = rnd(31);
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0a0c10');
  g.addColorStop(1, '#14161a');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // facade: rendered stucco, cornices per storey
  c.fillStyle = '#2b2a28';
  c.fillRect(0, h - 16 * s, w, 16 * s);
  for (let fl = 0; fl < 4; fl++) {
    const y = h - (3 + fl * 3.6) * s;
    c.fillStyle = '#353330';
    c.fillRect(0, y - 3.4 * s, w, 0.18 * s);
    for (let i = 0; i < 11; i++) {
      const x = (1 + i * 2.7) * s;
      const lit = r() > 0.82;
      const wy = y - 2.6 * s;
      c.fillStyle = '#3a3835';
      c.fillRect(x - 0.12 * s, wy - 0.12 * s, 1.44 * s, 2.24 * s);
      c.fillStyle = lit ? (r() > 0.5 ? '#b58a52' : '#8a7a62') : '#0d0f12';
      c.fillRect(x, wy, 1.2 * s, 2 * s);
      if (lit) {
        // curtain and cross bars
        c.fillStyle = 'rgba(40,30,20,0.35)';
        c.fillRect(x, wy, 0.35 * s, 2 * s);
      }
      c.fillStyle = '#2f2d2a';
      c.fillRect(x + 0.57 * s, wy, 0.06 * s, 2 * s);
      c.fillRect(x, wy + 0.7 * s, 1.2 * s, 0.06 * s);
    }
  }
  // street level: shop shutters and wet pavement glow
  c.fillStyle = '#1c1c1d';
  c.fillRect(0, h - 3 * s, w, 3 * s);
  for (let i = 0; i < 5; i++) {
    c.fillStyle = '#2c2d2f';
    c.fillRect((1.5 + i * 6) * s, h - 2.6 * s, 3.4 * s, 2.6 * s);
  }
  const lg = c.createRadialGradient(w * 0.5, h - 8 * s, 0, w * 0.5, h - 8 * s, 9 * s);
  lg.addColorStop(0, 'rgba(170,190,220,0.22)');
  lg.addColorStop(1, 'rgba(170,190,220,0)');
  c.fillStyle = lg;
  c.fillRect(0, 0, w, h);
}

function rainDrops(seed: number, streaks: boolean): Draw {
  return (c, w, h) => {
    const r = rnd(seed);
    c.clearRect(0, 0, w, h);
    const n = streaks ? 28 : 420;
    for (let i = 0; i < n; i++) {
      const x = r() * w;
      const y = r() * h;
      if (streaks) {
        const len = h * (0.08 + r() * 0.2);
        const g = c.createLinearGradient(x, y, x, y + len);
        g.addColorStop(0, 'rgba(210,225,240,0)');
        g.addColorStop(1, 'rgba(210,225,240,0.5)');
        c.strokeStyle = g;
        c.lineWidth = 1.5 + r() * 1.5;
        c.beginPath();
        c.moveTo(x, y);
        c.quadraticCurveTo(x + (r() - 0.5) * 6, y + len / 2, x + (r() - 0.5) * 4, y + len);
        c.stroke();
        c.fillStyle = 'rgba(220,232,245,0.6)';
        c.beginPath();
        c.arc(x, y + len, 2.4, 0, Math.PI * 2);
        c.fill();
      } else {
        const rad = 0.8 + r() * r() * 3.2;
        c.fillStyle = `rgba(215,228,242,${0.18 + r() * 0.3})`;
        c.beginPath();
        c.ellipse(x, y, rad, rad * 1.15, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.45)';
        c.fillRect(x - rad * 0.3, y - rad * 0.4, Math.max(1, rad * 0.4), Math.max(1, rad * 0.4));
      }
    }
  };
}

// ------------------------------------------------------------------ level
export function createHq(deps: LevelDeps): Level {
  const { engine, physics, mats, interactions, audio, ui } = deps;
  const b = new Builder(engine.scene, physics, mats, engine.quality);
  engine.setBloomIntensity(0.45);
  const N = { collide: false } as const;
  const paperRedraws: (() => void)[] = [];
  const NS = { collide: false, shadow: false } as const;

  // ---------------------------------------------------------------- materials
  const quilt = (base: string, line: string, diamond: boolean, size: number) => {
    const tex = canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = base;
      c.fillRect(0, 0, w, h);
      c.strokeStyle = line;
      c.lineWidth = diamond ? 3 : 7;
      c.beginPath();
      if (diamond) {
        for (let i = -4; i <= 4; i++) {
          c.moveTo((i * w) / 4, 0);
          c.lineTo((i * w) / 4 + w, h);
          c.moveTo((i * w) / 4 + w, 0);
          c.lineTo((i * w) / 4, h);
        }
      } else for (let i = 0; i < 4; i++) {
        c.moveTo(0, (i * h) / 4 + 2);
        c.lineTo(w, (i * h) / 4 + 2);
      }
      c.stroke();
      const img = c.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const k = 0.93 + Math.random() * 0.1;
        img.data[i] *= k;
        img.data[i + 1] *= k;
        img.data[i + 2] *= k;
      }
      c.putImageData(img, 0, 0);
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2 / size, 2 / size);
    return tex;
  };
  const fabric = (color: number, size = 0.5, rough = 0.95) => realMat('carpet_red', { size, color, rough, noColor: true, normalScale: 0.7 });
  const weave = (color: number, size = 0.4, rough = 0.85) => realMat('felt_green', { size, color, rough, noColor: true, normalScale: 0.8 });
  const paint = (color: number, rough = 0.55) => realMat('plaster_beige', { size: 2, color, rough, noColor: true, normalScale: 0.15 });
  const M = {
    floor: realMat('parquet_herringbone', { size: 1.2, color: 0xcab8a6, normalScale: 0.8 }),
    tiles: realMat('stone_tiles_checker', { size: 1.2, color: 0xb8b2aa }),
    wall: realMat('plaster_beige', { size: 2, color: 0xaebbd0, rough: 0.95 }),
    ceiling: realMat('plaster_beige', { size: 2.4, color: 0xb5bdc8, rough: 1 }),
    trim: paint(0xe6e3dc, 0.45),
    door: paint(0xdedbd2, 0.4),
    entryDoor: realMat('wood_veneer_mahogany', { size: 1.4, color: 0x8a6e5e, rough: 0.55 }),
    oak: realMat('wood_floor_planks', { size: 1.6, color: 0xb59a7e, rough: 0.6 }),
    tableTop: realMat('wood_veneer_dark', { size: 1.4, color: 0xb6a593, rough: 0.55 }),
    chairWood: realMat('wood_veneer_dark', { size: 0.8, color: 0x9e8a78, rough: 0.6 }),
    chairPine: realMat('wood_floor_planks', { size: 0.8, color: 0xc9b08e, rough: 0.6 }),
    splash: realMat('tiles_white_small', { size: 1.0, color: 0xe2e2de, rough: 0.25 }),
    counter: realMat('wood_floor_planks', { size: 1.2, color: 0x9c8a74, rough: 0.5 }),
    laminate: paint(0xe8e6e0, 0.35),
    steel: realMat('metal_brushed_steel', { size: 0.4, color: 0xc8ccd0, metal: 1, rough: 0.35, normalScale: 0.4 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x2c2e31, roughness: 0.45, metalness: 0.6 }),
    blackGlass: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.12, metalness: 0.2 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0xe8e6e1, roughness: 0.4 }),
    plasticDark: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.5 }),
    alu: new THREE.MeshStandardMaterial({ color: 0x8d9095, roughness: 0.35, metalness: 0.85 }),
    radiator: paint(0xdcd8cf, 0.35),
    sofa: fabric(0x6b6358, 0.6),
    mattress: realMat('felt_green', { size: 0.35, rough: 0.9, normalScale: 0.6, map: quilt('#d6d3cb', 'rgba(120,118,112,0.55)', true, 0.6) }),
    pillow: weave(0xc8ccd2, 0.3, 0.9),
    bagA: weave(0x25272a, 0.3, 0.7),
    bagB: weave(0x4a5236, 0.3, 0.8),
    bagC: weave(0x24304a, 0.3, 0.75),
    bagD: weave(0x5b2f2a, 0.3, 0.8),
    sleepA: realMat('carpet_red', { size: 0.3, rough: 0.55, normalScale: 0.5, map: quilt('#7a2a24', 'rgba(30,8,6,0.6)', false, 0.9) }),
    sleepB: realMat('carpet_red', { size: 0.3, rough: 0.55, normalScale: 0.5, map: quilt('#2f4a5e', 'rgba(8,16,24,0.6)', false, 0.9) }),
    sleepC: realMat('carpet_red', { size: 0.3, rough: 0.55, normalScale: 0.5, map: quilt('#55603c', 'rgba(16,20,8,0.6)', false, 0.9) }),
    sleepD: realMat('carpet_red', { size: 0.3, rough: 0.55, normalScale: 0.5, map: quilt('#3b3f47', 'rgba(10,10,14,0.6)', false, 0.9) }),
    mat: new THREE.MeshStandardMaterial({ color: 0x2f5a3a, roughness: 0.8 }),
    webbing: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.8 }),
    cardboard: realMat('wood_floor_planks', { size: 0.6, color: 0x9c7f58, rough: 0.95, noColor: true, normalScale: 0.2 }),
    cardboardPrint: new THREE.MeshStandardMaterial({ color: 0xd8c6a8, roughness: 0.95 }),
    takeaway: new THREE.MeshStandardMaterial({ color: 0xece9e2, roughness: 0.8 }),
    glassBrown: new THREE.MeshStandardMaterial({ color: 0x3a1e08, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }),
    glassGreen: new THREE.MeshStandardMaterial({ color: 0x14361c, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }),
    pet: new THREE.MeshStandardMaterial({ color: 0xa9c3d6, roughness: 0.08, transparent: true, opacity: 0.35, depthWrite: false }),
    cap: new THREE.MeshStandardMaterial({ color: 0x2a62b8, roughness: 0.4 }),
    can: realMat('metal_brushed_steel', { size: 0.3, color: 0x9a2a2a, metal: 0.8, rough: 0.35, normalScale: 0.2 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xece9e3, roughness: 0.2 }),
    ceramicDark: new THREE.MeshStandardMaterial({ color: 0x2c3a48, roughness: 0.25 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xa8b8c8, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false }),
    mirror: new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.03, metalness: 1 }),
    cord: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }),
    jacketA: weave(0x2a2d31, 0.35, 0.75),
    jacketB: weave(0x3f4434, 0.35, 0.9),
    jacketC: weave(0x3d4654, 0.35, 0.7),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.9 }),
    shoeA: new THREE.MeshStandardMaterial({ color: 0xd6d4cf, roughness: 0.7 }),
    shoeB: realMat('leather_brown', { size: 0.3, color: 0x6a4a34, rough: 0.5 }),
  };
  const bulbGlass = new THREE.MeshStandardMaterial({ color: 0xfff2dc, emissive: 0xffd9a0, emissiveIntensity: 0.05, roughness: 0.2 });
  const lampInside = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd7a0, emissiveIntensity: 2.2, roughness: 0.5, side: THREE.BackSide });
  const lampShade = new THREE.MeshStandardMaterial({ color: 0x1f2a24, roughness: 0.4, metalness: 0.5 });
  b.trackGlow(lampInside);
  b.trackGlow(bulbGlass);

  // ---------------------------------------------------------------- geometry helpers
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _m = new THREE.Matrix4();
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();
  /** Add any geometry with a full transform (no collision). */
  const put = (mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, shadow = true) => {
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    geo.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)));
    b.addStatic(mat, geo, shadow);
  };
  /** Cylinder between two points. */
  const rod = (mat: THREE.Material, a: THREE.Vector3, c: THREE.Vector3, r: number, seg = 10) => {
    const d = new THREE.Vector3().subVectors(c, a);
    const geo = new THREE.CylinderGeometry(r, r, d.length(), seg);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    geo.applyMatrix4(_m.compose(_p.addVectors(a, c).multiplyScalar(0.5), _q, _s.set(1, 1, 1)));
    b.addStatic(mat, geo);
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  /** Local frame for furniture: (lx, lz) relative to (x, z) turned by rot. */
  const frame = (x: number, z: number, rot: number) => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  };

  // ---------------------------------------------------------------- shell
  // floors (top at y = 0)
  b.box(M.floor, RX * 2 + 0.6, 0.2, RZ * 2 + 0.3, 0, -0.1, -0.15);
  b.box(M.tiles, 3.8, 0.2, 1.8, 1.75, -0.1, 3.8);
  b.box(M.oak, 0.9, 0.02, 0.15, 2.3, 0.0, 2.825, N); // threshold
  b.box(M.ceiling, RX * 2 + 0.6, 0.2, 8, 0, H + 0.1, 0.8, N);

  // window openings in the north wall: x ranges, sill and head height
  const WIN = [
    { x0: -2.25, x1: -0.95 },
    { x0: 0.75, x1: 2.05 },
  ];
  const SILL = 0.9;
  const HEAD = 2.9;
  const nz = -RZ - WT / 2;
  {
    const xs = [-RX - WT, WIN[0].x0, WIN[0].x1, WIN[1].x0, WIN[1].x1, RX + WT];
    for (let i = 0; i < xs.length; i += 2) b.box(M.wall, xs[i + 1] - xs[i], H, WT, (xs[i] + xs[i + 1]) / 2, H / 2, nz);
    for (const w of WIN) {
      const cx = (w.x0 + w.x1) / 2;
      const ww = w.x1 - w.x0;
      b.box(M.wall, ww, SILL, WT, cx, SILL / 2, nz);
      b.box(M.wall, ww, H - HEAD, WT, cx, (H + HEAD) / 2, nz);
    }
  }
  // west, east (main room + hallway), south wall of the main room with the doorway
  b.box(M.wall, WT, H, RZ * 2 + WT + 0.15, -RX - WT / 2, H / 2, -WT / 2 + 0.075);
  b.box(M.wall, WT, H, 7.75, RX + WT / 2, H / 2, 0.825);
  b.box(M.wall, 1.85 + RX, H, 0.15, (-RX + 1.85) / 2, H / 2, RZ + 0.075);
  b.box(M.wall, RX - 2.75, H, 0.15, (2.75 + RX) / 2, H / 2, RZ + 0.075);
  b.box(M.wall, 0.9, H - 2.0, 0.15, 2.3, (H + 2.0) / 2, RZ + 0.075);
  // hallway: west end and south wall
  b.box(M.wall, WT, H, 1.8, -WT / 2, H / 2, 3.8);
  b.box(M.wall, RX + WT, H, WT, RX / 2, H / 2, 4.4 + WT / 2);

  // skirting boards and cornice: segments as [x0, z0, x1, z1, normal x, normal z]
  const runs: [number, number, number, number, number, number][] = [
    [-RX, -RZ, RX, -RZ, 0, 1],
    [-RX, -RZ, -RX, RZ, 1, 0],
    [RX, -RZ, RX, RZ, -1, 0],
    [-RX, RZ, 1.85, RZ, 0, -1],
    [2.75, RZ, RX, RZ, 0, -1],
    [0, 2.9, 1.85, 2.9, 0, 1],
    [2.75, 2.9, RX, 2.9, 0, 1],
    [0, 2.9, 0, 4.4, 1, 0],
    [RX, 2.9, RX, 4.4, -1, 0],
    [0, 4.4, RX, 4.4, 0, -1],
  ];
  for (const [x0, z0, x1, z1, nx, nzz] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = Math.abs(x1 - x0) > 0.01;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const sx = (th: number) => (alongX ? len : th);
    const sz = (th: number) => (alongX ? th : len);
    b.box(M.trim, sx(0.022), 0.12, sz(0.022), cx + nx * 0.011, 0.06, cz + nzz * 0.011, N);
    b.box(M.trim, sx(0.03), 0.012, sz(0.03), cx + nx * 0.015, 0.126, cz + nzz * 0.015, N);
    // cornice: two stepped profiles
    b.box(M.trim, sx(0.06), 0.1, sz(0.06), cx + nx * 0.03, H - 0.05, cz + nzz * 0.03, NS);
    b.box(M.trim, sx(0.11), 0.035, sz(0.11), cx + nx * 0.055, H - 0.0175, cz + nzz * 0.055, NS);
  }

  // ---------------------------------------------------------------- windows (double box windows of an old building)
  const rainMats: THREE.MeshStandardMaterial[] = [];
  for (const w of WIN) {
    const cx = (w.x0 + w.x1) / 2;
    const ww = w.x1 - w.x0;
    const hh = HEAD - SILL;
    const cy = (SILL + HEAD) / 2;
    // inside sill board and architrave around the reveal
    b.box(M.trim, ww + 0.14, 0.04, WT + 0.06, cx, SILL + 0.02, nz + 0.03, N);
    for (const s of [-1, 1]) b.box(M.trim, 0.08, hh + 0.08, 0.02, cx + s * (ww / 2 + 0.04), cy + 0.04, -RZ + 0.01, N);
    b.box(M.trim, ww + 0.24, 0.08, 0.02, cx, HEAD + 0.04, -RZ + 0.01, N);
    // two casement layers, inner and outer
    for (const z of [-RZ - 0.06, -RZ - WT + 0.05]) {
      const f = 0.06;
      b.box(M.trim, ww, f, 0.06, cx, SILL + 0.04 + f / 2, z, N);
      b.box(M.trim, ww, f, 0.06, cx, HEAD - f / 2, z, N);
      for (const s of [-1, 1]) b.box(M.trim, f, hh, 0.06, cx + s * (ww / 2 - f / 2), cy, z, N);
      b.box(M.trim, 0.09, hh, 0.065, cx, cy, z, N); // meeting stiles
      b.box(M.trim, ww, 0.07, 0.065, cx, HEAD - 0.62, z, N); // transom
      b.box(M.glass, ww - 0.1, hh - 0.1, 0.006, cx, cy, z, NS);
    }
    // handle on the inner casement
    b.box(M.alu, 0.02, 0.12, 0.02, cx + 0.06, 1.5, -RZ - 0.02, N);
    // rain on the inner face of the outer glass: static drops + slowly sliding streaks
    for (const streaks of [false, true]) {
      const tex = canvasTex(256, 512, rainDrops(streaks ? 7 + cx * 10 : 3 + cx * 10, streaks));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.1, metalness: 0, emissive: 0x9fb4d0, emissiveMap: tex, emissiveIntensity: 0.25 });
      for (const half of [-1, 1]) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ww / 2 - 0.1, hh - 0.12), m);
        mesh.position.set(cx + (half * ww) / 4, cy, -RZ - WT + 0.085 + (streaks ? 0.002 : 0));
        mesh.renderOrder = 3;
        b.group.add(mesh);
      }
      if (streaks) rainMats.push(m);
    }
    b.collider(cx, (SILL + HEAD) / 2, nz, ww, HEAD - SILL, WT);
  }
  // the street outside: opposite facade and a street lamp
  {
    const tex = canvasTex(1024, 614, facade);
    const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 1 });
    b.trackGlow(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 18), m);
    mesh.position.set(0, -1.0, -16);
    b.group.add(mesh);
    rod(M.darkSteel, V(-0.6, -7, -8.6), V(-0.6, 3.9, -8.6), 0.07);
    rod(M.darkSteel, V(-0.6, 3.9, -8.6), V(-0.1, 4.0, -8.6), 0.04);
    b.glowBox(0xdfe8ff, 0.36, 0.06, 0.18, 0.05, 3.96, -8.6, 3);
  }

  // radiator under the east window: cast-iron column type
  {
    const w = WIN[1];
    const cx = (w.x0 + w.x1) / 2;
    const n = 14;
    for (let i = 0; i < n; i++) b.box(M.radiator, 0.055, 0.6, 0.13, cx - 0.42 + i * 0.065, 0.45, -RZ + 0.13, { collide: false, round: 0.02 });
    b.box(M.radiator, 0.92, 0.04, 0.05, cx, 0.7, -RZ + 0.13, N);
    b.box(M.radiator, 0.92, 0.04, 0.05, cx, 0.2, -RZ + 0.13, N);
    rod(M.radiator, V(cx - 0.5, 0.2, -RZ + 0.13), V(cx - 0.5, 0, -RZ + 0.13), 0.012);
    rod(M.radiator, V(cx + 0.5, 0.7, -RZ + 0.13), V(cx + 0.5, 0, -RZ + 0.13), 0.012);
    rod(M.radiator, V(cx - 0.5, 0.2, -RZ + 0.13), V(cx - 0.45, 0.2, -RZ + 0.13), 0.012);
    rod(M.radiator, V(cx + 0.5, 0.7, -RZ + 0.13), V(cx + 0.45, 0.7, -RZ + 0.13), 0.012);
    b.cylinder(M.steel, 0.025, 0.05, cx + 0.5, 0.76, -RZ + 0.13, N);
    b.collider(cx, 0.4, -RZ + 0.12, 1.0, 0.8, 0.24);
  }

  // ---------------------------------------------------------------- doorway to the hallway (door open, folded against the hallway wall)
  {
    const x = 2.3;
    for (const z of [RZ - 0.01, 2.91]) {
      for (const s of [-1, 1]) b.box(M.trim, 0.08, 2.04, 0.02, x + s * 0.49, 1.02, z, N);
      b.box(M.trim, 1.06, 0.08, 0.02, x, 2.04, z, N);
    }
    b.box(M.trim, 0.03, 2.0, 0.17, x - 0.435, 1.0, RZ + 0.075, N); // jambs (inside the opening)
    b.box(M.trim, 0.03, 2.0, 0.17, x + 0.435, 1.0, RZ + 0.075, N);
    b.box(M.trim, 0.84, 0.03, 0.17, x, 1.985, RZ + 0.075, N);
    // leaf: panel door opened 90 degrees into the hallway, against its north wall
    const lz = 2.9 + 0.045;
    b.box(M.door, 0.86, 1.98, 0.04, 1.4, 0.99, lz + 0.01, N);
    for (const py of [0.5, 1.45]) b.box(M.door, 0.6, 0.62, 0.015, 1.4, py, lz + 0.035, N);
    b.box(M.alu, 0.12, 0.02, 0.05, 1.07, 1.02, lz + 0.05, N);
  }

  // ---------------------------------------------------------------- hallway: entrance door, coats, shoes, fuse box, mirror
  // entrance door on the east wall (closed): leaf and frame on the wall face
  {
    const x = RX - 0.01;
    const z = 3.65;
    for (const s of [-1, 1]) b.box(M.trim, 0.025, 2.1, 0.09, x - 0.005, 1.05, z + s * 0.5, N);
    b.box(M.trim, 0.025, 0.09, 1.09, x - 0.005, 2.08, z, N);
    b.box(M.entryDoor, 0.05, 2.0, 0.9, x - 0.02, 1.0, z, N);
    for (const py of [0.55, 1.5]) b.box(M.entryDoor, 0.02, 0.7, 0.62, x - 0.05, py, z, N);
    b.box(M.alu, 0.03, 0.22, 0.05, x - 0.06, 1.05, z - 0.36, N); // escutcheon
    b.box(M.alu, 0.12, 0.022, 0.03, x - 0.1, 1.1, z - 0.36, N); // lever
    b.cylinder(M.alu, 0.012, 0.03, x - 0.06, 1.55, z, N); // peephole (vertical cylinder reads as a stud)
    b.box(M.alu, 0.03, 0.06, 0.12, x - 0.05, 1.35, z - 0.36, N); // extra lock
  }
  // bathroom door on the hallway south wall (closed)
  {
    const x = 0.75;
    const z = 4.4 - 0.01;
    for (const s of [-1, 1]) b.box(M.trim, 0.09, 2.08, 0.025, x + s * 0.49, 1.04, z, N);
    b.box(M.trim, 1.07, 0.09, 0.025, x, 2.06, z, N);
    b.box(M.door, 0.86, 1.98, 0.04, x, 0.99, z - 0.02, N);
    // frosted glass panel at the top, dark behind
    b.box(new THREE.MeshStandardMaterial({ color: 0x40454c, roughness: 0.3 }), 0.5, 0.6, 0.01, x, 1.5, z - 0.042, N);
    b.box(M.door, 0.6, 0.62, 0.015, x, 0.5, z - 0.045, N);
    b.box(M.alu, 0.12, 0.02, 0.05, x - 0.33, 1.02, z - 0.07, N);
  }
  // coat rail with hooks and jackets
  {
    const z = 4.4;
    b.box(M.oak, 1.2, 0.1, 0.025, 2.2, 1.72, z - 0.012, N);
    for (let i = 0; i < 5; i++) {
      const x = 1.72 + i * 0.24;
      rod(M.alu, V(x, 1.72, z - 0.025), V(x, 1.76, z - 0.09), 0.007, 6);
    }
    const jacket = (mat: THREE.Material, x: number, len: number, rot: number, dz: number) => {
      const top = 1.74;
      const zz = z - 0.09 - dz;
      // body hangs from the hook and leans out at the bottom; sleeves hang in front, collar on top
      const tilt = 0.09;
      const by = top - len / 2 - 0.04;
      const bz = zz - Math.sin(tilt) * len * 0.5;
      put(mat, new RoundedBoxGeometry(0.42, len, 0.07, 3, 0.03), x, by, bz, tilt, rot, 0, 1, 1, 1);
      put(mat, new RoundedBoxGeometry(0.5, 0.12, 0.09, 3, 0.04), x, top - 0.08, zz + 0.005, 0, rot, 0, 1, 1, 1); // shoulders
      put(mat, new RoundedBoxGeometry(0.17, 0.09, 0.08, 3, 0.035), x, top - 0.02, zz + 0.01, -0.2, rot, 0, 1, 1, 1); // collar / hood
      for (const s of [-1, 1]) put(mat, new RoundedBoxGeometry(0.075, len * 0.75, 0.075, 3, 0.035), x + s * 0.2, top - 0.12 - len * 0.37, bz - 0.035, tilt * 0.7, rot, -s * 0.05, 1, 1, 1);
      put(M.webbing, new THREE.BoxGeometry(0.008, len * 0.9, 0.003), x, by, bz - 0.037, tilt, rot, 0, 1, 1, 1, false); // zip
    };
    jacket(M.jacketA, 1.74, 0.72, 0.04, 0);
    jacket(M.jacketB, 2.2, 0.6, -0.06, 0.02);
    jacket(M.jacketC, 2.62, 0.78, 0.08, 0.0);
    // shoe rack with a few pairs
    const rack = 2.2;
    b.box(M.oak, 1.0, 0.025, 0.28, rack, 0.32, z - 0.15, N);
    b.box(M.oak, 1.0, 0.025, 0.28, rack, 0.06, z - 0.15, N);
    for (const s of [-1, 1]) b.box(M.oak, 0.025, 0.36, 0.28, rack + s * 0.49, 0.18, z - 0.15, N);
    const shoe = (mat: THREE.Material, x: number, y: number, rot: number) => {
      put(mat, new THREE.CapsuleGeometry(0.045, 0.18, 4, 8), x, y + 0.045, z - 0.16, Math.PI / 2, rot, 0, 1.05, 1, 0.75);
      b.box(M.rubber, 0.1, 0.012, 0.27, x, y + 0.006, z - 0.16, { collide: false, rotY: rot });
    };
    shoe(M.shoeA, rack - 0.35, 0.335, 0.05);
    shoe(M.shoeA, rack - 0.23, 0.335, -0.03);
    shoe(M.shoeB, rack + 0.05, 0.075, 0.02);
    shoe(M.shoeB, rack + 0.17, 0.075, 0.06);
    shoe(M.plasticDark, rack + 0.3, 0.335, -0.05);
    shoe(M.plasticDark, rack + 0.42, 0.335, 0.02);
    shoe(M.shoeA, 3.0, 0.0, 0.5); // kicked off by the door
    b.collider(rack, 0.2, z - 0.15, 1.0, 0.4, 0.3);
  }
  // fuse box (on the hallway north wall, next to the entrance)
  {
    const x = 3.1;
    const z = 2.9;
    b.box(M.plastic, 0.4, 0.5, 0.1, x, 1.85, z + 0.05, { collide: false, round: 0.01 });
    b.box(M.plastic, 0.36, 0.46, 0.01, x, 1.85, z + 0.104, N);
    b.box(M.plasticDark, 0.02, 0.08, 0.015, x + 0.15, 1.85, z + 0.11, N);
    b.decal(0.12, 0.04, x - 0.08, 2.03, z + 0.111, 0, 600, (c, w, h) => {
      c.fillStyle = '#f2e7a0';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#222';
      c.font = `700 ${h * 0.6}px ${FONT}`;
      c.textBaseline = 'middle';
      c.fillText('⚡ 230V', w * 0.06, h * 0.55);
    });
    // a meter-reading sticker and the doorbell transformer cable
    rod(M.cord, V(x, 2.1, z + 0.02), V(x, H, z + 0.02), 0.006, 6);
  }
  // mirror on the hallway west wall
  {
    const x = 0.0;
    b.box(M.oak, 0.03, 0.9, 0.55, x + 0.015, 1.5, 3.65, N);
    b.box(M.mirror, 0.006, 0.84, 0.49, x + 0.033, 1.5, 3.65, NS);
  }

  // ---------------------------------------------------------------- planning table
  {
    const { x, z } = TABLE;
    const tw = 2.0;
    const td = 1.0;
    b.box(M.tableTop, tw, 0.04, td, x, 0.73, z, { collide: false, round: 0.006 });
    b.box(M.tableTop, tw - 0.12, 0.08, td - 0.12, x, 0.67, z, N);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(M.tableTop, 0.06, 0.71, 0.06, x + sx * (tw / 2 - 0.08), 0.355, z + sz * (td / 2 - 0.08), N);
    b.collider(x, 0.375, z, tw, 0.75, td);
    const papers = b.decal(1.9, 0.95, x, 0.7515, z, 0, 600, tablePapers);
    papers.mesh.rotation.set(-Math.PI / 2, 0, 0);
    papers.mesh.receiveShadow = true;
    paperRedraws.push(papers.redraw);
  }
  // laptop (lid tilted back, screen towards the south side of the table)
  const laptop = new THREE.Group();
  {
    laptop.position.set(TABLE.x + 0.2, 0.75, TABLE.z + 0.05);
    laptop.rotation.y = -0.15;
    engine.scene.add(laptop);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.016, 0.23), M.alu);
    base.position.set(0, 0.008, 0);
    const keys = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.002, 0.1), M.plasticDark);
    keys.position.set(0, 0.017, -0.03);
    const lid = new THREE.Group();
    lid.position.set(0, 0.016, -0.115);
    lid.rotation.x = -0.32;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.22, 0.008), M.alu);
    back.position.set(0, 0.11, -0.004);
    const bezel = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.22), M.plasticDark);
    bezel.position.set(0, 0.11, 0.0005);
    lid.add(back, bezel);
    const scr = b.screen(0.3, 0.19, 0, 0.115, 0.001, 0, 1400, laptopScreen, 0.9);
    lid.add(scr.mesh);
    laptop.add(base, keys, lid);
    for (const m of [base, keys, back]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    // charger cable to the floor
    rod(M.cord, V(TABLE.x + 0.4, 0.755, TABLE.z + 0.1), V(TABLE.x + 0.95, 0.755, TABLE.z + 0.2), 0.003, 5);
  }
  // desk lamp (anglepoise) at the north-east corner of the table
  const shadePos = new THREE.Vector3(TABLE.x + 0.15, 1.24, TABLE.z - 0.12);
  {
    const bx = TABLE.x + 0.75;
    const bz = TABLE.z - 0.35;
    b.cylinder(lampShade, 0.08, 0.025, bx, 0.7625, bz, N);
    const elbow = V(bx - 0.12, 1.28, bz - 0.04);
    rod(lampShade, V(bx, 0.77, bz), elbow, 0.009);
    rod(lampShade, V(bx + 0.02, 0.77, bz), V(elbow.x + 0.02, elbow.y, elbow.z), 0.006);
    rod(lampShade, elbow, V(shadePos.x + 0.06, shadePos.y + 0.08, shadePos.z + 0.03), 0.009);
    b.cylinder(lampShade, 0.02, 0.05, elbow.x, elbow.y, elbow.z, N);
    // cone shade, opening tilted towards the papers
    const outer = new THREE.CylinderGeometry(0.035, 0.085, 0.15, 24, 1, true);
    put(lampShade, outer, shadePos.x, shadePos.y, shadePos.z, -0.15, 0, -0.35);
    put(lampInside, new THREE.CylinderGeometry(0.034, 0.084, 0.149, 24, 1, true), shadePos.x, shadePos.y - 0.001, shadePos.z, -0.15, 0, -0.35, 1, 1, 1, false);
    put(lampShade, new THREE.SphereGeometry(0.04, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shadePos.x - 0.02, shadePos.y + 0.07, shadePos.z - 0.01, -0.15, 0, -0.35);
    rod(M.cord, V(bx, 0.77, bz + 0.07), V(bx + 0.25, 0.755, bz + 0.3), 0.003, 5);
  }
  // mugs, a pizza box and a bottle on the table
  const mug = (mat: THREE.Material, x: number, y: number, z: number, rot: number) => {
    b.cylinder(mat, 0.042, 0.095, x, y + 0.0475, z, { collide: false, segments: 18 });
    b.cylinder(M.plasticDark, 0.037, 0.003, x, y + 0.094, z, { collide: false, segments: 18 }); // coffee
    put(mat, new THREE.TorusGeometry(0.028, 0.008, 6, 12, Math.PI), x + Math.cos(rot) * 0.042, y + 0.048, z - Math.sin(rot) * 0.042, 0, rot, -Math.PI / 2);
  };
  mug(M.ceramic, TABLE.x - 0.45, 0.75, TABLE.z + 0.3, 0.4);
  mug(M.ceramicDark, TABLE.x + 0.62, 0.75, TABLE.z + 0.32, -0.6);
  const pizzaBox = (x: number, y: number, z: number, rot: number, open = false) => {
    b.box(M.cardboard, 0.33, 0.04, 0.33, x, y + 0.02, z, { collide: false, rotY: rot });
    b.box(M.cardboardPrint, 0.2, 0.002, 0.2, x, y + 0.041, z, { collide: false, rotY: rot + 0.785 });
    if (open) put(M.cardboard, new THREE.BoxGeometry(0.33, 0.004, 0.33), x, y + 0.05, z, -0.2, rot, 0);
  };
  pizzaBox(TABLE.x + 0.82, 0.75, TABLE.z + 0.28, 0.2);
  pizzaBox(TABLE.x + 0.84, 0.79, TABLE.z + 0.26, 0.05);
  const bottle = (mat: THREE.Material, x: number, y: number, z: number, h = 0.24, r = 0.032) => {
    b.cylinder(mat, r, h * 0.62, x, y + h * 0.31, z, { collide: false, segments: 14 });
    b.cylinder(mat, r, h * 0.14, x, y + h * 0.69, z, { collide: false, segments: 14, radiusTop: r * 0.4 });
    b.cylinder(mat, r * 0.38, h * 0.24, x, y + h * 0.88, z, { collide: false, segments: 10 });
  };
  const pet = (x: number, y: number, z: number) => {
    bottle(M.pet, x, y, z, 0.3, 0.04);
    b.cylinder(M.cap, 0.016, 0.02, x, y + 0.31, z, { collide: false, segments: 10 });
  };
  pet(TABLE.x - 0.85, 0.75, TABLE.z - 0.35);
  bottle(M.glassBrown, TABLE.x - 0.72, 0.75, TABLE.z - 0.38);

  // chairs: four mismatched kitchen chairs
  const chair = (x: number, z: number, rot: number, wood: THREE.Material, back: 'slats' | 'board') => {
    const L = frame(x, z, rot);
    const h = 0.46;
    const [sx, sz] = L(0, 0);
    b.box(wood, 0.42, 0.03, 0.42, sx, h, sz, { collide: false, rotY: rot, round: 0.006 });
    for (const lx of [-0.18, 0.18])
      for (const lz of [-0.18, 0.18]) {
        const [px, pz] = L(lx, lz);
        b.box(wood, 0.032, h - 0.015, 0.032, px, (h - 0.015) / 2, pz, { collide: false, rotY: rot });
      }
    for (const lx of [-0.18, 0.18]) {
      const [px, pz] = L(lx, 0.19);
      b.box(wood, 0.032, 0.44, 0.03, px, h + 0.22, pz, { collide: false, rotY: rot });
    }
    const [tx, tz] = L(0, 0.19);
    if (back === 'board') b.box(wood, 0.4, 0.14, 0.022, tx, h + 0.36, tz, { collide: false, rotY: rot, round: 0.008 });
    else for (const yy of [0.2, 0.31, 0.42]) b.box(wood, 0.36, 0.04, 0.018, tx, h + yy, tz, { collide: false, rotY: rot });
    const [rx, rz] = L(0, 0);
    for (const lz of [-0.18, 0.18]) {
      const [px, pz] = L(0, lz);
      b.box(wood, 0.36, 0.02, 0.02, px, 0.16, pz, { collide: false, rotY: rot });
    }
    b.collider(rx, 0.45, rz, 0.44, 0.9, 0.44, rot);
  };
  chair(TABLE.x - 0.45, TABLE.z + 0.78, 0.08, M.chairWood, 'slats');
  chair(TABLE.x + 0.45, TABLE.z + 0.9, -0.25, M.chairPine, 'board');
  chair(TABLE.x - 0.1, TABLE.z - 0.92, Math.PI + 0.1, M.chairWood, 'board');
  chair(TABLE.x + 1.42, TABLE.z - 0.05, Math.PI / 2 + 0.2, M.chairPine, 'slats');

  // ---------------------------------------------------------------- taped wall (east)
  const board = b.decal(2.6, 1.2, RX - 0.004, 1.55, -0.6, -Math.PI / 2, 520, wallBoard);
  board.mesh.receiveShadow = true;
  paperRedraws.push(board.redraw);

  // ---------------------------------------------------------------- four duffel bags along the east wall (one per crew member)
  {
    const bags = [M.bagA, M.bagB, M.bagC, M.bagD];
    const r = 0.165;
    const L = 0.6;
    // lathe profile: flat round ends with a soft rim, slightly bulging body
    const prof: THREE.Vector2[] = [];
    prof.push(new THREE.Vector2(0, -L / 2));
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      prof.push(new THREE.Vector2(r - 0.035 + Math.sin(a) * 0.035, -L / 2 + 0.035 - Math.cos(a) * 0.035));
    }
    prof.push(new THREE.Vector2(r * 1.04, 0));
    for (let i = 6; i >= 0; i--) {
      const a = (i / 6) * (Math.PI / 2);
      prof.push(new THREE.Vector2(r - 0.035 + Math.sin(a) * 0.035, L / 2 - 0.035 + Math.cos(a) * 0.035));
    }
    prof.push(new THREE.Vector2(0, L / 2));
    const sq = 0.72;
    bags.forEach((mat, i) => {
      const z = 0.0 + i * 0.7;
      const x = RX - 0.21 - (i % 2) * 0.03;
      const yaw = [0.04, -0.05, 0.02, -0.07][i];
      const y = r * sq;
      put(mat, new THREE.LatheGeometry(prof, 20), x, y, z, Math.PI / 2, yaw, 0, 1.08, 1, sq);
      // straps around the body and carrying handles on top
      for (const s of [-1, 1]) {
        put(M.webbing, new THREE.TorusGeometry(r * 1.03, 0.007, 4, 24), x + Math.sin(yaw) * s * 0.17, y, z + s * 0.17, 0, yaw, 0, 1, sq, 1);
        put(M.webbing, new THREE.TorusGeometry(0.07, 0.009, 4, 10, Math.PI), x + Math.sin(yaw) * s * 0.17, y + r * sq - 0.005, z + s * 0.17, 0, yaw + Math.PI / 2, 0, 1, 0.9, 1);
      }
      // zip along the top and an end pocket
      b.box(M.webbing, 0.014, 0.01, L - 0.08, x, y + r * sq + 0.002, z, { collide: false, shadow: false, rotY: yaw });
    });
    b.collider(RX - 0.22, 0.15, 1.05, 0.42, 0.3, 2.8);
  }

  // ---------------------------------------------------------------- sleeping places
  const mattress = (x: number, z: number, rot: number, sleep: THREE.Material, rolled: boolean) => {
    b.box(M.mattress, 0.9, 0.2, 2.0, x, 0.1, z, { collide: false, rotY: rot, round: 0.06 });
    const L = frame(x, z, rot);
    const [px, pz] = L(0.02, -0.78);
    b.box(M.pillow, 0.6, 0.11, 0.38, px, 0.225, pz, { collide: false, rotY: rot + 0.06, round: 0.05 });
    if (rolled) {
      const [qx, qz] = L(0, 0.72);
      put(sleep, new THREE.CylinderGeometry(0.15, 0.15, 0.72, 16), qx, 0.33, qz, 0, rot, Math.PI / 2);
    } else {
      const [qx, qz] = L(0.02, 0.18);
      b.box(sleep, 0.8, 0.12, 1.55, qx, 0.25, qz, { collide: false, rotY: rot + 0.03, round: 0.058 });
      const [fx, fz] = L(0.07, -0.5);
      b.box(sleep, 0.74, 0.14, 0.32, fx, 0.29, fz, { collide: false, rotY: rot - 0.1, round: 0.065 }); // folded-back top
    }
  };
  mattress(-RX + 0.5, -1.55, 0.02, M.sleepA, false);
  mattress(-RX + 0.5, 0.65, -0.03, M.sleepB, true);
  // camping mat with a sleeping bag under the west window
  {
    const x = -2.05;
    const z = -1.6;
    b.box(M.mat, 0.55, 0.025, 1.8, x, 0.0125, z, { collide: false, rotY: 0.05 });
    b.box(M.sleepC, 0.62, 0.1, 1.7, x + 0.02, 0.075, z + 0.05, { collide: false, rotY: 0.08, round: 0.045 });
    b.box(M.pillow, 0.42, 0.08, 0.3, x, 0.12, z - 0.7, { collide: false, rotY: 0.1, round: 0.035 });
  }
  // old sofa on the south wall, with the fourth sleeping bag
  {
    const x = -0.45;
    const z = RZ - 0.43;
    b.box(M.sofa, 2.0, 0.3, 0.84, x, 0.21, z, { collide: false, round: 0.04 });
    for (const s of [-1, 1]) b.box(M.sofa, 0.2, 0.62, 0.86, x + s * 0.9, 0.37, z, { collide: false, round: 0.07 });
    b.box(M.sofa, 1.62, 0.5, 0.22, x, 0.62, z + 0.3, { collide: false, round: 0.08 });
    for (const s of [-1, 1]) b.box(M.sofa, 0.8, 0.14, 0.6, x + s * 0.405, 0.43, z - 0.08, { collide: false, round: 0.06 });
    for (const s of [-1, 1]) b.cylinder(M.plasticDark, 0.025, 0.06, x + s * 0.92, 0.03, z - 0.35, N);
    b.box(M.sleepD, 1.5, 0.08, 0.66, x + 0.05, 0.53, z - 0.1, { collide: false, rotY: 0.03, round: 0.035 });
    b.box(M.pillow, 0.4, 0.14, 0.34, x - 0.62, 0.6, z - 0.05, { collide: false, rotY: -0.2, round: 0.06 });
    b.collider(x, 0.4, z, 2.0, 0.8, 0.86);
  }
  // takeaway and bottles on the floor
  {
    pizzaBox(-2.55, 0, -0.35, 0.4);
    const noodle = (x: number, z: number, y = 0) => {
      b.cylinder(M.takeaway, 0.06, 0.09, x, y + 0.045, z, { collide: false, segments: 4, radiusTop: 0.075 });
    };
    noodle(-2.48, 0.05);
    noodle(-2.3, -0.1);
    noodle(0.75, 1.75);
    bottle(M.glassGreen, -2.6, 0, 1.75);
    bottle(M.glassBrown, -2.48, 0, 1.86);
    pet(-2.7, 0, -2.4);
    // a laid-down empty bottle
    put(M.glassBrown, new THREE.CylinderGeometry(0.032, 0.032, 0.16, 12), 0.55, 0.032, 1.6, 0, 0.7, Math.PI / 2);
    // phone charger and power strip at the wall
    b.box(M.plastic, 0.3, 0.04, 0.06, -RX + 0.05, 0.02, -0.28, { collide: false, rotY: Math.PI / 2 });
    b.box(M.plasticDark, 0.07, 0.008, 0.15, -2.95, 0.004, -0.3, { collide: false, rotY: 0.3 });
  }

  // ---------------------------------------------------------------- kitchenette (south-west corner)
  {
    const x0 = -RX;
    const x1 = -1.85;
    const cx = (x0 + x1) / 2;
    const len = x1 - x0;
    const z = RZ - 0.3;
    b.box(M.laminate, len, 0.82, 0.58, cx, 0.49, z + 0.01, N);
    b.box(M.plasticDark, len, 0.08, 0.5, cx, 0.04, z + 0.04, N); // plinth
    // doors with gaps and bar handles
    const doors = 3;
    for (let i = 0; i < doors; i++) {
      const dx = x0 + (len / doors) * (i + 0.5);
      b.box(M.laminate, len / doors - 0.006, 0.78, 0.02, dx, 0.49, z - 0.29, { collide: false, round: 0.004 });
      b.box(M.steel, 0.012, 0.012, 0.15, dx + (i % 2 ? -0.18 : 0.18), 0.82, z - 0.31, { collide: false, rotY: Math.PI / 2 });
    }
    b.box(M.counter, len + 0.02, 0.04, 0.62, cx, 0.92, z, { collide: false, round: 0.004 });
    b.collider(cx, 0.47, z, len, 0.94, 0.62);
    // sink
    const sx = -2.35;
    b.box(M.steel, 0.5, 0.012, 0.44, sx, 0.942, z - 0.02, N);
    b.box(M.darkSteel, 0.4, 0.004, 0.34, sx, 0.949, z - 0.02, N);
    rod(M.steel, V(sx, 0.95, z + 0.2), V(sx, 1.22, z + 0.2), 0.013);
    rod(M.steel, V(sx, 1.22, z + 0.2), V(sx, 1.2, z + 0.03), 0.011);
    rod(M.steel, V(sx + 0.06, 1.0, z + 0.2), V(sx + 0.06, 1.1, z + 0.12), 0.006);
    // two-plate hob
    const hx = -3.05;
    b.box(M.blackGlass, 0.3, 0.008, 0.5, hx, 0.944, z - 0.02, N);
    for (const dz of [-0.12, 0.12]) b.cylinder(M.darkSteel, 0.085, 0.003, hx, 0.949, z - 0.02 + dz, { collide: false, segments: 24 });
    // kettle and mugs
    const kx = -2.75;
    const kz = z + 0.12;
    b.cylinder(M.plasticDark, 0.085, 0.02, kx, 0.95, kz, { collide: false, segments: 20 });
    b.cylinder(M.steel, 0.08, 0.2, kx, 1.06, kz, { collide: false, segments: 20, radiusTop: 0.065 });
    b.cylinder(M.plasticDark, 0.05, 0.02, kx, 1.17, kz, { collide: false, segments: 14 });
    put(M.plasticDark, new THREE.TorusGeometry(0.07, 0.012, 6, 12, Math.PI), kx + 0.05, 1.08, kz, 0, 0, -Math.PI / 2, 1.2, 1, 1);
    rod(M.steel, V(kx - 0.07, 1.12, kz), V(kx - 0.12, 1.15, kz), 0.012, 8);
    mug(M.ceramic, -2.95, 0.94, z - 0.18, 0.5);
    mug(M.ceramicDark, -2.82, 0.94, z - 0.22, 2.2);
    mug(M.ceramic, -2.66, 0.94, z - 0.17, -0.3);
    mug(new THREE.MeshStandardMaterial({ color: 0x8a3b2e, roughness: 0.3 }), -2.0, 0.94, z - 0.05, 1.2);
    // a stack of plastic cups and a bag of bread, a few cans
    b.cylinder(M.can, 0.033, 0.12, -2.05, 1.0, z + 0.18, { collide: false, segments: 14 });
    b.cylinder(M.can, 0.033, 0.12, -1.98, 1.0, z + 0.1, { collide: false, segments: 14 });
    // tiled splashback and a wall cabinet with an LED strip underneath
    b.box(M.splash, len, 0.62, 0.012, cx, 0.94 + 0.31, RZ - 0.006, N);
    b.box(M.laminate, len - 0.3, 0.7, 0.34, cx - 0.15, 1.95, RZ - 0.17, { collide: false, round: 0.004 });
    for (let i = 0; i < 2; i++) b.box(M.steel, 0.012, 0.15, 0.012, cx - 0.15 + (i ? 0.03 : -0.03), 1.67, RZ - 0.345, N);
    b.glowBox(0xfff0d8, len - 0.4, 0.008, 0.02, cx - 0.15, 1.596, RZ - 0.3, 2.2);
    // electric socket
    b.box(M.plastic, 0.08, 0.08, 0.012, -2.0, 1.15, RZ - 0.018, N);
  }

  // ---------------------------------------------------------------- traces of the previous tenant: paler patches where pictures hung, sockets
  const patch = (w: number, h: number, x: number, y: number, z: number, rot: number) => {
    b.decal(w + 0.1, h + 0.1, x, y, z, rot, 200, (c, cw, ch) => {
      const m = cw * (0.05 / (w + 0.1));
      c.filter = `blur(${m * 0.35}px)`;
      c.fillStyle = 'rgba(235,235,228,0.09)';
      c.fillRect(m, m, cw - m * 2, ch - m * 2);
      c.strokeStyle = 'rgba(30,26,22,0.12)';
      c.lineWidth = m * 0.3;
      c.strokeRect(m, m, cw - m * 2, ch - m * 2);
      c.filter = 'none';
      c.fillStyle = 'rgba(20,20,20,0.8)';
      c.beginPath();
      c.arc(cw / 2, m * 0.6, Math.max(1.5, m * 0.12), 0, Math.PI * 2);
      c.fill();
    });
  };
  patch(0.62, 0.84, -RX + 0.004, 1.72, -0.5, Math.PI / 2);
  patch(0.4, 0.5, -RX + 0.004, 1.62, 0.45, Math.PI / 2);
  patch(0.5, 0.36, -0.1, 1.95, -RZ + 0.004, 0);
  const socket = (x: number, z: number, rot: number) => {
    b.box(M.plastic, 0.075, 0.075, 0.014, x, 0.3, z, { collide: false, rotY: rot, round: 0.004 });
    b.box(M.plastic, 0.075, 0.075, 0.014, x + Math.cos(rot) * 0.075, 0.3, z - Math.sin(rot) * 0.075, { collide: false, rotY: rot, round: 0.004 });
  };
  socket(-RX + 0.007, -0.3, Math.PI / 2);
  socket(-0.6, -RZ + 0.007, 0);
  socket(RX - 0.007, -1.6, -Math.PI / 2);

  // ---------------------------------------------------------------- ceiling bulbs, switch
  const bulb = (x: number, z: number, drop: number) => {
    b.cylinder(M.plastic, 0.06, 0.03, x, H - 0.015, z, N);
    rod(M.cord, V(x, H - 0.03, z), V(x, H - drop, z), 0.004, 6);
    b.cylinder(M.plasticDark, 0.018, 0.05, x, H - drop - 0.02, z, N);
    put(bulbGlass, new THREE.SphereGeometry(0.032, 14, 10), x, H - drop - 0.07, z, 0, 0, 0, 1, 1.25, 1, false);
  };
  bulb(0.2, -0.2, 0.6);
  bulb(1.8, 3.65, 0.45);
  const switchPlate = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.012), M.plastic);
  switchPlate.position.set(1.6, 1.05, RZ - 0.006);
  engine.scene.add(switchPlate);
  const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.01), M.plastic);
  rocker.position.set(0, 0, 0.008);
  switchPlate.add(rocker);

  // ---------------------------------------------------------------- light
  b.hemisphere(0x5a6a86, 0x221c16, 0.62);
  // street lamp outside: cold light through both windows, with the window bars' shadows
  b.spot(0xbcd0ff, 140, 0.05, 3.9, -8.4, 0.2, 0, 0.4, { angle: 0.42, penumbra: 0.5, distance: 18, shadow: true });
  // night sky / street glow near the windows
  b.point(0x8fa3c8, 2.2, 0.0, 2.2, -2.2, 5, 1.6);
  // desk lamp: warm pool on the table, plus a little bounce
  const lampSpot = b.spot(0xffc58a, 22, shadePos.x, shadePos.y - 0.03, shadePos.z, TABLE.x - 0.05, 0.75, TABLE.z + 0.1, { angle: 0.85, penumbra: 0.7, distance: 6, shadow: true });
  b.point(0xffb877, 1.4, shadePos.x, shadePos.y + 0.25, shadePos.z + 0.2, 4.5, 1.8);
  // laptop glow
  b.point(0x9fc0ff, 0.5, TABLE.x + 0.15, 0.95, TABLE.z + 0.25, 1.8, 2);
  // the bare bulbs
  const ceilingLight = b.point(0xffd9a8, 0, 0.2, H - 0.7, -0.2, 9, 1.6);
  b.point(0xffd2a0, 2.6, 1.8, H - 0.6, 3.65, 5, 1.7);
  // LED strip under the kitchen cabinet
  b.point(0xffeedd, 0.9, -2.75, 1.45, RZ - 0.4, 2.6, 2);
  void lampSpot;
  const dust = b.dust(0.5, 1.6, -0.6, 3, 1.4, 2, 90);

  b.finalize();
  engine.captureEnvironment(new THREE.Vector3(0.4, 1.6, 0.6), 0.6);

  // ---------------------------------------------------------------- interactions
  const planProxy = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 1.0), new THREE.MeshBasicMaterial({ visible: false }));
  planProxy.position.set(TABLE.x, 0.78, TABLE.z);
  engine.scene.add(planProxy);
  interactions.add({
    id: 'hq.plan',
    object: planProxy,
    range: 2.4,
    prompt: () => t('hq.plan'),
    onUse: () => {
      const plan = (deps as { plan?: { start(): void } }).plan;
      if (plan) plan.start();
      else ui.toast(t('hq.plan.later'));
    },
  });
  let lightOn = false;
  const setLight = (on: boolean) => {
    lightOn = on;
    ceilingLight.intensity = on ? 14 * b.getPower() : 0;
    bulbGlass.emissiveIntensity = on ? 6 : 0.05;
    rocker.rotation.x = on ? -0.25 : 0.25;
  };
  setLight(false);
  interactions.add({
    id: 'hq.switch',
    object: switchPlate,
    range: 2.0,
    prompt: () => t(lightOn ? 'hq.light.off' : 'hq.light.on'),
    onUse: () => {
      setLight(!lightOn);
      audio.play('ui', { pos: switchPlate.position });
    },
  });

  // ---------------------------------------------------------------- level api
  const look = new THREE.Vector3();
  return {
    spawn(index) {
      return { pos: new THREE.Vector3(0.75 + (index % 4) * 0.62, 0, 3.7), yaw: -0.15 };
    },
    menuCamera(time, cam) {
      const w = (Math.PI * 2) / 52;
      const a = time * w;
      cam.position.set(-1.25 + Math.sin(a) * 0.6, 1.32 + Math.sin(a * 2 + 1) * 0.04, 1.1 + Math.cos(a) * 0.25);
      const tx = TABLE.x + Math.sin(a + 0.6) * 0.15;
      const tz = TABLE.z + Math.cos(a) * 0.1;
      const dx = tx - cam.position.x;
      const dz = tz - cam.position.z;
      const len = Math.hypot(dx, dz) || 1;
      // aim to the left of the table so it sits in the right part of the frame;
      // no local yaw afterwards, which would roll the horizon and tilt the windows
      look.set(tx + (dz / len) * 0.95, 1.02, tz - (dx / len) * 0.95);
      cam.up.set(0, 1, 0);
      cam.lookAt(look);
    },
    attach() {},
    detach() {
      setLight(false);
    },
    update(_dt, time) {
      b.updateShadows(time);
      dust(time);
      for (let i = 0; i < rainMats.length; i++) rainMats[i].map!.offset.y = -((time * (0.018 + i * 0.006)) % 1);
    },
    objective() {
      return [t('hq.obj')];
    },
    redraw() {
      for (const r of paperRedraws) r();
    },
  };
}
