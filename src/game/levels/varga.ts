// Style sample for the job itself: the delivery yard ("Lieferhof") behind the
// Auktionshaus Varga, at night. Only the place, no heist mechanics yet.
//
// World axes: x east, z south, y up. The east wall of the storage wing is the
// plane x = 0 (building at x < 0); the delivery door is centred at z = 0. The
// yard spans x 0..6.5, z -6.6..4.9 (matches the planning screen's floor plan,
// 20 plan units = 1 m). The street runs east-west south of it, the car park
// ("Parkhaus gegenüber") stands across the street.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Builder } from '../build';
import { realMat } from '../realmats';
import { model } from '../models';
import { registerStrings, t } from '../../core/i18n';
import type { Level, LevelDeps } from '../level';
import type { Anchors } from '../mech/skill';
import type { Session } from '../../net/session';
import { buildVargaInterior, VARGA_FLOOR } from './varga-interior';
import { createVargaStage } from '../job/varga-stage';

registerStrings(
  {
    'varga.obj': 'Style sample: have a look around the delivery yard',
    'varga.door': 'Try the delivery door',
    'varga.door.locked': 'Locked. Steel door, no handle on this side.',
    'varga.plan': 'Plan the job',
    'varga.obj.job': 'The van: look at it and press E to plan the job',
  },
  {
    'varga.obj': 'Stilprobe: Seht euch im Lieferhof um',
    'varga.door': 'Liefertür versuchen',
    'varga.door.locked': 'Verschlossen. Stahltür, außen kein Drücker.',
    'varga.plan': 'Einsatz planen',
    'varga.obj.job': 'Der Transporter: hinsehen und E drücken, um den Einsatz zu planen',
  },
);

/** Pavement and yard surface height above the road. */
const KERB = 0.12;
/** Delivery door opening in the east wall (x = 0): sill height, width, height. */
const DOOR_Y = KERB + 0.15;
const DOOR_W = 2.2;
const DOOR_H = 2.4;
/** Sign lettering: a DIN-like narrow grotesque, as on German street furniture. */
const SIGN = '"DIN Alternate", "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

/**
 * Shared positions for other modules (y = floor height, yaw: 0 looks north (-z),
 * +pi/2 looks west (-x)). `cam.liefer` is the camera itself (y = its height).
 */
export const VARGA_ANCHORS: Anchors = {
  van: { x: 1.9, y: 0, z: 8.3, yaw: 0.12, r: 1.4 }, // behind the van's rear doors
  'van.driver': { x: -3.3, y: 0, z: 9.75, yaw: 0 }, // outside the driver's door (street side)
  gate: { x: 2.3, y: KERB, z: 4.8, yaw: 0, r: 1.2 }, // the open half of the yard gate
  'door.liefer': { x: 0.9, y: DOOR_Y, z: 0, yaw: Math.PI / 2, r: 1.2 }, // on the platform, facing the delivery door
  'post.lookout': { x: -1.5, y: KERB, z: 14.2, yaw: -0.39 }, // far pavement by the car park: gate and street in view
  'door.vorder': { x: -14.6, y: KERB, z: 5.7, yaw: 0, r: 1.2 }, // front entrance on the street (only roughly built)
  'cam.liefer': { x: 0.26, y: 3.46, z: -1.45, yaw: -0.62 }, // security camera over the yard, aimed at the gate
};

let doorControl: ((open: boolean) => void) | null = null;
/** Open or close the delivery door of the built Varga level (no-op before it is built). */
export function openDeliveryDoor(open: boolean) {
  doorControl?.(open);
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

/** Deterministic pseudo-random numbers, so the scene looks the same on every peer. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** World-space UVs for custom geometry (same convention as Builder boxes). */
function worldUv(geo: THREE.BufferGeometry, tile: number) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, x / tile, z / tile);
    else if (ax >= az) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  geo.setAttribute('uv', uv);
  return geo;
}

export function createVarga(deps: LevelDeps): Level {
  const { engine, physics, mats, interactions, audio, ui } = deps;
  const b = new Builder(engine.scene, physics, mats, engine.quality);
  engine.setBloomIntensity(0.5);
  const scene = engine.scene;
  const N = { collide: false } as const;
  const NS = { collide: false, shadow: false } as const;

  // ---------------------------------------------------------------- materials
  const plastic = (color: number, rough = 0.62) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  const M = {
    yard: realMat('concrete_yard_stained', { size: 2.6, color: 0x8e8a84, rough: 0.92 }),
    road: realMat('asphalt_cracked', { size: 3.2, color: 0x7a7a7a, rough: 0.78 }),
    pave: realMat('pavers_concrete', { size: 1.6, color: 0x9c988f, rough: 0.95 }),
    kerb: realMat('concrete_yard_stained', { size: 1.0, color: 0x76736e, rough: 0.9 }),
    step: realMat('concrete_yard_stained', { size: 1.8, color: 0xa7a59f, rough: 0.85 }),
    facade: realMat('plaster_grey_dirty', { size: 2.6, color: 0xaeb2b2, rough: 1 }),
    plinth: realMat('concrete_wall_panels', { size: 1.6, color: 0x5f5c57 }),
    yardWall: realMat('concrete_wall_panels', { size: 2.6, color: 0x98948c }),
    coping: realMat('concrete_yard_stained', { size: 1.2, color: 0x7c7975 }),
    neigh: realMat('plaster_grey_dirty', { size: 3, color: 0x9b8d7c }),
    neighW: realMat('plaster_grey_dirty', { size: 3.4, color: 0x8b8a86 }),
    firewall: realMat('plaster_grey_dirty', { size: 3.6, color: 0x77726b }),
    rear: realMat('plaster_grey_dirty', { size: 3, color: 0x8f8a80 }),
    carpark: realMat('concrete_wall_panels', { size: 3, color: 0x8c8982 }),
    carparkIn: realMat('concrete_light', { size: 3, color: 0x3e3d3a }),
    shutter: realMat('metal_shutter_painted', { size: 1.8, color: 0x8e9496, metal: 0.25 }),
    corr: realMat('metal_corrugated', { size: 1.4, color: 0x9a9ea0, metal: 0.45, rough: 0.85 }),
    rust: realMat('metal_rusty', { size: 1.2, color: 0xb8b0a6 }),
    door: realMat('metal_rusty', { size: 1.6, noColor: true, color: 0x46504c, rough: 0.6, normalScale: 0.25, metal: 0.35 }),
    galv: realMat('metal_brushed_steel', { size: 0.6, color: 0x9a9ea2, metal: 0.85, rough: 0.6, normalScale: 0.3 }),
    darkSteel: realMat('metal_brushed_steel', { size: 0.6, color: 0x34383b, metal: 0.7, rough: 0.55, normalScale: 0.3 }),
    pallet: realMat('wood_floor_planks', { size: 1.0, color: 0xcbb592, rough: 0.95 }),
    ply: realMat('wood_floor_planks', { size: 1.4, noColor: true, color: 0xb0956e, rough: 0.9, normalScale: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.1, metalness: 0.5, envMapIntensity: 1.4 }),
    black: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.8 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.9 }),
    binGrey: plastic(0x2e3234, 0.7),
    binDark: plastic(0x17191a, 0.7),
    binBlue: plastic(0x163a66, 0.65),
    binYellow: plastic(0x9c7a1a, 0.65),
    jack: realMat('metal_rusty', { size: 0.8, noColor: true, color: 0x8c4f16, rough: 0.7, normalScale: 0.3, metal: 0.2 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xd2d4d0, roughness: 0.34, metalness: 0.15, envMapIntensity: 1.3 }),
    vanTrim: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.72 }),
    vanGlass: new THREE.MeshStandardMaterial({ color: 0x07090b, roughness: 0.05, metalness: 0.4, envMapIntensity: 2 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x8c8f92, roughness: 0.45, metalness: 0.8 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x5a0a0a, roughness: 0.25, emissive: 0x5a0606, emissiveIntensity: 0.25 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.1, metalness: 0.6 }),
  };

  // ---------------------------------------------------------------- sky and fog
  // Overcast city night: the cloud deck picks up the sodium glow of the town.
  {
    const tex = canvasTex(8, 512, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0c0d11');
      g.addColorStop(0.25, '#15151a');
      g.addColorStop(0.42, '#2a241f');
      g.addColorStop(0.5, '#3c3027');
      g.addColorStop(0.53, '#1a1816');
      g.addColorStop(1, '#0b0b0c');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(95, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);
    scene.background = new THREE.Color(0x0b0b0c);
    scene.fog = new THREE.FogExp2(0x1d1a1a, 0.024);
  }

  // ---------------------------------------------------------------- helpers
  /** Tilted static box collider: a ramp whose top face rises from (a0, y0) to (a1, y1) along x or z. */
  const ramp = (axis: 'x' | 'z', a0: number, y0: number, a1: number, y1: number, c: number, width: number) => {
    const run = a1 - a0;
    const len = Math.hypot(run, y1 - y0);
    const ang = Math.atan2(y1 - y0, Math.abs(run)) * Math.sign(run);
    const th = 0.2;
    const q = new THREE.Quaternion();
    const n = new THREE.Vector3(0, 1, 0);
    if (axis === 'x') {
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang);
      n.set(-Math.sin(ang), Math.cos(ang), 0);
    } else {
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ang);
      n.set(0, Math.cos(ang), -Math.sin(ang));
    }
    const mid = (a0 + a1) / 2;
    const my = (y0 + y1) / 2;
    const cx = axis === 'x' ? mid - n.x * th / 2 : c;
    const cz = axis === 'z' ? mid - n.z * th / 2 : c;
    const d = axis === 'x' ? RAPIER.ColliderDesc.cuboid(len / 2, th / 2, width / 2) : RAPIER.ColliderDesc.cuboid(width / 2, th / 2, len / 2);
    d.setTranslation(cx, my - n.y * th / 2, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    physics.world.createCollider(d);
  };

  /** Box in a local frame rotated by `rot` about y around (ox, oz). */
  const rbox = (mat: THREE.Material, sx: number, sy: number, sz: number, ox: number, oz: number, rot: number, lx: number, y: number, lz: number, o: { collide?: boolean; round?: number; tile?: number; shadow?: boolean } = {}) => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    b.box(mat, sx, sy, sz, ox + lx * c + lz * s, y, oz - lx * s + lz * c, { collide: false, ...o, rotY: rot });
  };

  /** Flat decal on the ground (stains, markings). */
  const groundDecal = (w: number, h: number, x: number, y: number, z: number, rot: number, px: number, draw: Draw) => {
    const d = b.decal(w, h, x, y, z, 0, px, draw);
    d.mesh.rotation.set(-Math.PI / 2, 0, rot);
    d.mesh.receiveShadow = true;
    return d;
  };

  const stain = (seed: number, alpha: number, tint = '8,7,6'): Draw => (c, w, h) => {
    const r = rng(seed);
    for (let i = 0; i < 26; i++) {
      const x = w * (0.2 + r() * 0.6);
      const y = h * (0.2 + r() * 0.6);
      const rad = Math.min(w, h) * (0.06 + r() * 0.22);
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${tint},${alpha * (0.4 + r() * 0.6)})`);
      g.addColorStop(1, `rgba(${tint},0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
  };

  // Wet patches: glossy dark planes that mirror the lamps (the asphalt is still damp).
  const puddleAlpha = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 40; i++) {
      const x = w * (0.25 + r() * 0.5);
      const y = h * (0.25 + r() * 0.5);
      const rad = w * (0.05 + r() * 0.18);
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.15)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
  });
  puddleAlpha.colorSpace = THREE.NoColorSpace;
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.04, metalness: 0.1, transparent: true, alphaMap: puddleAlpha, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, envMapIntensity: 1.6 });
  const puddle = (w: number, d: number, x: number, y: number, z: number, rot = 0) => {
    const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateY(rot).translate(x, y + 0.004, z);
    b.addStatic(puddleMat, g, false);
  };

  // Contact shadows: soft dark rectangles under things standing on the ground
  // (one shared material, merged), so props do not look like they float.
  const softRect = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    c.filter = 'blur(14px)';
    c.fillStyle = '#fff';
    c.fillRect(w * 0.18, h * 0.18, w * 0.64, h * 0.64);
  });
  softRect.colorSpace = THREE.NoColorSpace;
  const contactMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75, alphaMap: softRect, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const contact = (x: number, y: number, z: number, w: number, d: number, rot = 0) => {
    const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateY(rot).translate(x, y + 0.006, z);
    b.addStatic(contactMat, g, false);
  };

  // ================================================================ ground
  // road (y 0), pavements and yard (y KERB)
  b.box(M.road, 130, 0.4, 6, 0, -0.2, 10);
  b.box(M.pave, 130, 0.42, 1.95, 0, KERB - 0.21, 5.875); // our side, z 4.9..6.85
  b.box(M.kerb, 130, 0.44, 0.15, 0, KERB + 0.01 - 0.22, 6.925, N);
  b.box(M.kerb, 130, 0.44, 0.15, 0, KERB + 0.01 - 0.22, 13.075, N);
  b.box(M.pave, 130, 0.42, 2.6, 0, KERB - 0.21, 14.45); // far side, z 13.15..15.75
  ramp('z', 7.2, 0, 6.65, KERB, 0, 130);
  ramp('z', 12.8, 0, 13.35, KERB, 0, 130);
  b.box(M.yard, 6.5, 0.42, 11.6, 3.25, KERB - 0.21, -0.9); // yard x 0..6.5, z -6.7..4.9
  // a darker, damp gutter line along both kerbs
  for (const z of [7.13, 12.87]) {
    const g = new THREE.PlaneGeometry(130, 0.28).rotateX(-Math.PI / 2).translate(0, 0.003, z);
    b.addStatic(puddleMat, g, false);
  }
  // manhole and gully grates in the road
  b.cylinder(M.darkSteel, 0.33, 0.02, 3.6, 0.0, 10.4, { collide: false, segments: 32, tile: 0.6 });
  for (const gx of [-7.5, 10.5]) {
    b.box(M.darkSteel, 0.56, 0.02, 0.36, gx, 0.0, 7.26, N);
    for (let i = 0; i < 6; i++) b.box(M.black, 0.04, 0.022, 0.28, gx - 0.22 + i * 0.088, 0.001, 7.26, N);
  }
  puddle(3.2, 1.6, 6.5, 0, 7.8, -0.4);
  puddle(5, 2.4, 3.0, 0, 11.6, 0.6);
  puddle(2.4, 1.6, 2.8, KERB, 2.6, 0.3);
  puddle(2.2, 2.0, 3.4, KERB, -2.0, 1.1);
  groundDecal(2.4, 3.4, 2.3, KERB + 0.003, 3.4, 0.1, 120, stain(9, 0.45));
  groundDecal(2.0, 2.0, 5.6, KERB + 0.003, -0.4, 0, 120, stain(12, 0.35, '14,11,6'));
  groundDecal(2.2, 1.6, 1.4, KERB + 0.003, -4.8, 0.7, 120, stain(17, 0.35));
  groundDecal(3.2, 1.2, 3.2, KERB + 0.003, 5.9, 0, 100, stain(25, 0.3)); // tyre dirt at the gate

  // ================================================================ the auction house
  // block x -22..0, z -13.1..4.9, 6 m high; only the south-east corner is seen up close
  // Hollow shell (walls 0.3 m, roof slab 6.0..6.2): the interior is built by
  // varga-interior.ts in the same coordinates. Inner faces: x = -0.3 (east),
  // z = 4.6 (south), x = -21.7 (west), z = -12.8 (north). No interior floor here.
  {
    const T = 0.3;
    const OH = DOOR_Y + DOOR_H; // top of the delivery-door opening
    /** Wall from a0 to a1 along z ('x' wall at x = c) or along x ('z' wall at z = c), height 0..6.2, with rectangular holes. */
    const holed = (ax: 'x' | 'z', c: number, a0: number, a1: number, holes: { a0: number; a1: number; y0: number; y1: number }[]) => {
      const put = (s0: number, s1: number, y0: number, y1: number) => {
        if (s1 - s0 < 0.005 || y1 - y0 < 0.005) return;
        if (ax === 'x') b.box(M.facade, T, y1 - y0, s1 - s0, c, (y0 + y1) / 2, (s0 + s1) / 2);
        else b.box(M.facade, s1 - s0, y1 - y0, T, (s0 + s1) / 2, (y0 + y1) / 2, c);
      };
      let cur = a0;
      for (const h of holes.slice().sort((p, q) => p.a0 - q.a0)) {
        put(cur, h.a0, 0, 6.2);
        put(h.a0, h.a1, 0, h.y0);
        put(h.a0, h.a1, h.y1, 6.2);
        cur = h.a1;
      }
      put(cur, a1, 0, 6.2);
    };
    // window holes match the interior's linings (varga-interior.ts WINDOWS), so its window panels show from inside
    const hi = (a: number, w = 0.9) => ({ a0: a - w / 2, a1: a + w / 2, y0: 4.5, y1: 5.0 });
    const tall = (a: number) => ({ a0: a - 0.65, a1: a + 0.65, y0: 1.8, y1: VARGA_FLOOR + 3.2 - 0.12 });
    holed('x', -T / 2, -13.1, -1.1, [hi(-5.6), hi(-3.6)]); // east wall north of the opening
    holed('x', -T / 2, 1.1, 4.9, [hi(1.8), hi(3.6)]); // east wall south of the opening
    b.box(M.facade, T, 6.2 - OH, DOOR_W, -T / 2, (OH + 6.2) / 2, 0); // lintel
    b.box(M.step, T, DOOR_Y, DOOR_W, -T / 2, DOOR_Y / 2, 0); // threshold
    // street facade with the front door opening (x -15.7..-13.5, sill at the interior floor)
    holed('z', 4.9 - T / 2, -22, -0.3, [hi(-1.8), hi(-4.6), tall(-9.0), tall(-11.4), tall(-17.8), tall(-20.2), { a0: -15.7, a1: -13.5, y0: 0, y1: VARGA_FLOOR + 2.4 }]);
    b.box(M.step, 2.2, VARGA_FLOOR, T, -14.6, VARGA_FLOOR / 2, 4.9 - T / 2); // front door sill
    b.box(M.facade, T, 6.2, 17.4, -22 + T / 2, 3.1, -4.1); // west
    b.box(M.facade, 21.7, 6.2, T, -11.15, 3.1, -13.1 + T / 2); // north
    b.box(M.facade, 22, 0.2, 18, -11, 6.1, -4.1); // roof slab
  }
  b.box(M.coping, 22.12, 0.14, 18.12, -11, 6.27, -4.1, N);
  b.box(M.plinth, 6.3, 0.55, 0.05, -18.85, KERB + 0.27, 4.925, N); // street plinth, interrupted by the front door
  b.box(M.plinth, 13.5, 0.55, 0.05, -6.75, KERB + 0.27, 4.925, N);
  b.box(M.plinth, 0.05, 0.55, 11.6, 0.025, KERB + 0.27, -0.9, N);

  /** Window in the east wall (x = 0), facing +x. */
  const windowE = (z: number, y: number, w: number, h: number, bars: number) => {
    b.box(M.glass, 0.03, h, w, 0.012, y, z, N);
    b.box(M.facade, 0.1, 0.07, w + 0.14, 0.05, y + h / 2 + 0.035, z, N);
    b.box(M.facade, 0.1, h + 0.14, 0.07, 0.05, y, z - w / 2 - 0.035, N);
    b.box(M.facade, 0.1, h + 0.14, 0.07, 0.05, y, z + w / 2 + 0.035, N);
    b.box(M.coping, 0.16, 0.05, w + 0.2, 0.08, y - h / 2 - 0.03, z, N);
    for (let i = 0; i < bars; i++) b.cylinder(M.darkSteel, 0.011, h + 0.06, 0.13, y, z - w / 2 + ((i + 0.5) * w) / bars, { collide: false, segments: 8 });
    b.box(M.darkSteel, 0.03, 0.03, w + 0.06, 0.13, y + h / 2 - 0.04, z, N);
    b.box(M.darkSteel, 0.03, 0.03, w + 0.06, 0.13, y - h / 2 + 0.04, z, N);
  };
  /** Window in the street facade (z = 4.9), facing +z. */
  const windowS = (x: number, y: number, w: number, h: number, bars: number, lit = 0) => {
    if (lit > 0) b.glowBox(0xffc58a, w, h, 0.02, x, y, 4.905, lit);
    else b.box(M.glass, w, h, 0.03, x, y, 4.912, N);
    b.box(M.facade, w + 0.14, 0.07, 0.1, x, y + h / 2 + 0.035, 4.95, N);
    b.box(M.facade, 0.07, h + 0.14, 0.1, x - w / 2 - 0.035, y, 4.95, N);
    b.box(M.facade, 0.07, h + 0.14, 0.1, x + w / 2 + 0.035, y, 4.95, N);
    b.box(M.coping, w + 0.2, 0.05, 0.16, x, y - h / 2 - 0.03, 4.98, N);
    for (let i = 0; i < bars; i++) b.cylinder(M.darkSteel, 0.011, h + 0.06, x - w / 2 + ((i + 0.5) * w) / bars, y, 5.03, { collide: false, segments: 8 });
    b.box(M.darkSteel, w + 0.06, 0.03, 0.03, x, y + h / 2 - 0.04, 5.03, N);
    b.box(M.darkSteel, w + 0.06, 0.03, 0.03, x, y - h / 2 + 0.04, 5.03, N);
  };
  // storage wing: a row of small barred high windows
  for (const z of [-5.6, -3.6, 1.8, 3.6]) windowE(z, 4.75, 0.9, 0.5, 5);
  for (const x of [-1.8, -4.6]) windowS(x, 4.75, 0.9, 0.5, 5);
  // front part: tall barred windows, one with a faint night light behind the blind
  for (const [x, lit] of [
    [-9.0, 0],
    [-11.4, 0.18],
    [-17.8, 0],
    [-20.2, 0],
  ] as const)
    windowS(x, 3.05, 1.3, 2.5, 7, lit);
  // main entrance (far west, x about -14.6): glass doors, canopy, plaque
  {
    const x = -14.6;
    // the opening itself: the interior's wooden double door stands in it (varga-interior.ts)
    b.box(M.darkSteel, 2.3, 0.06, 0.08, x, KERB + 2.63, 4.93, N);
    b.box(M.darkSteel, 3.2, 0.12, 1.3, x, 3.2, 5.55, N);
    b.glowBox(0xffd9a8, 0.18, 0.012, 0.18, x - 0.8, 3.135, 5.55, 2.2);
    b.glowBox(0xffd9a8, 0.18, 0.012, 0.18, x + 0.8, 3.135, 5.55, 2.2);
    b.glowBox(0x2bd46a, 0.36, 0.13, 0.02, x, KERB + 2.85, 4.9, 1.6); // exit sign inside
    b.box(M.step, 3.2, 0.14, 0.5, x, KERB + 0.07, 5.15, N);
    ramp('z', 5.45, KERB, 4.9, VARGA_FLOOR, x, 3.2); // walkable: pavement -> step -> sill
    b.decal(0.62, 0.42, x + 1.65, 1.65, 4.93, 0, 400, (c, w, h) => {
      c.fillStyle = '#b39a66';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#2a2116';
      c.textAlign = 'center';
      c.font = `600 ${h * 0.2}px Georgia, serif`;
      c.fillText('AUKTIONSHAUS', w / 2, h * 0.36);
      c.font = `600 ${h * 0.3}px Georgia, serif`;
      c.fillText('VARGA', w / 2, h * 0.7);
      c.font = `400 ${h * 0.09}px Georgia, serif`;
      c.fillText('seit 1952', w / 2, h * 0.88);
    });
  }
  // halo-lit facade lettering
  {
    const d = b.decal(7.2, 0.9, -12.0, 4.95, 4.93, 0, 160, (c, w, h) => {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `500 ${h * 0.5}px Georgia, "Times New Roman", serif`;
      const text = 'A U K T I O N S H A U S   V A R G A';
      c.shadowColor = 'rgba(255,190,120,0.9)';
      c.shadowBlur = h * 0.18;
      c.fillStyle = 'rgba(255,200,140,0.55)';
      c.fillText(text, w / 2, h / 2);
      c.shadowBlur = 0;
      c.fillStyle = '#2b2722';
      c.fillText(text, w / 2, h / 2);
    }, 0.9);
    void d;
  }
  // a street name plate on the corner
  b.decal(0.62, 0.15, -0.5, 3.2, 4.93, 0, 500, (c, w, h) => {
    c.fillStyle = '#f0f0ea';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#111';
    c.lineWidth = h * 0.06;
    c.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h * 0.84);
    c.fillStyle = '#111';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `600 ${h * 0.56}px ${SIGN}`;
    c.fillText('Färbergasse', w / 2, h * 0.54);
  });

  // downpipes and cable tray on the storage wall
  const downpipe = (x: number, z: number) => {
    b.cylinder(M.galv, 0.05, 5.9, x, KERB + 3.2, z, { collide: false, segments: 14 });
    b.box(M.galv, 0.14, 0.18, 0.14, x, 6.15, z, N);
    b.cylinder(M.galv, 0.055, 0.25, x, KERB + 0.15, z, { collide: false, segments: 14 });
    for (const y of [1.2, 2.6, 4.0, 5.4]) b.box(M.darkSteel, 0.1, 0.03, 0.16, x - 0.04, y, z, N);
  };
  downpipe(0.09, -6.25);
  downpipe(0.09, 4.42);
  b.box(M.galv, 0.24, 0.06, 10.6, 0.14, 3.6, -1.25, N); // cable tray
  b.box(M.galv, 0.24, 0.1, 0.02, 0.14, 3.63, -6.55, N);
  for (let z = -6.2; z <= 4; z += 1.2) b.box(M.darkSteel, 0.24, 0.03, 0.04, 0.14, 3.555, z, N);
  b.cylinder(M.binDark, 0.035, 3.3, 0.14, 3.6, -6.0, { collide: false, segments: 10, radiusTop: 0.035 });
  // conduits down to the camera and the intercom
  b.box(M.galv, 0.03, 0.18, 0.03, 0.06, 3.47, -1.45, N);
  b.box(M.galv, 0.03, 2.15, 0.03, 0.04, 2.48, 1.48, N);

  // ---------------------------------------------------------------- delivery door
  const PLAT = DOOR_Y;
  const doorLeaves: { hinge: THREE.Group; side: number }[] = [];
  let doorCollider: ReturnType<Builder['collider']> | null = null;
  let doorTarget01 = 0; // 0 closed, 1 open
  let doorOpen01 = 0;
  {
    // loading platform with a ramp down to the yard
    b.box(M.step, 1.2, 0.4, 3.0, 0.6, PLAT - 0.2, 0);
    const wedge = new THREE.BoxGeometry(1.4, 0.4, 3.0, 1, 1, 1);
    const p = wedge.attributes.position;
    // drop the outer top edge to the yard surface (local y, before translating)
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getX(i) > 0) p.setY(i, KERB - (PLAT - 0.2) - 0.005);
    wedge.computeVertexNormals();
    wedge.translate(1.9, PLAT - 0.2, 0);
    b.addStatic(M.step, worldUv(wedge.toNonIndexed(), 1.4));
    ramp('x', 2.6, KERB, 1.2, PLAT, 0, 3.0);
    for (const s of [-1, 1]) {
      b.box(mats.hazard, 1.2, 0.15, 0.01, 0.6, PLAT - 0.075, s * 1.505, NS);
      b.box(M.galv, 1.2, 0.02, 0.05, 0.6, PLAT - 0.01, s * 1.475, N); // steel edge angle
    }

    const DY = PLAT; // door sill
    // frame and leaves
    b.box(M.darkSteel, 0.08, 0.08, DOOR_W + 0.16, 0.04, DY + DOOR_H + 0.04, 0, N);
    b.box(M.darkSteel, 0.08, DOOR_H + 0.08, 0.08, 0.04, DY + DOOR_H / 2, -DOOR_W / 2 - 0.04, N);
    b.box(M.darkSteel, 0.08, DOOR_H + 0.08, 0.08, 0.04, DY + DOOR_H / 2, DOOR_W / 2 + 0.04, N);
    // two leaves (separate meshes, hinged at the jambs, opening inwards)
    for (const s of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(-0.03, DY, s * (DOOR_W / 2 - 0.01));
      b.group.add(hinge);
      const lz = -s * 0.545; // leaf centre relative to the hinge
      const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => b.mesh(geo, mat, x, y, z, hinge);
      part(new THREE.BoxGeometry(0.05, DOOR_H - 0.01, 1.08), M.door, 0, DOOR_H / 2, lz);
      part(new THREE.BoxGeometry(0.012, 0.32, 0.98), M.galv, 0.031, 0.18, lz); // kick plate
      part(new THREE.BoxGeometry(0.01, 0.012, 1.0), M.darkSteel, 0.03, 1.55, lz); // panel crease
      if (s > 0) {
        // knob plate and lock cylinder on the right leaf (no lever outside)
        part(new THREE.BoxGeometry(0.012, 0.24, 0.05), M.galv, 0.031, 1.05, lz - s * 0.4);
        part(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12).rotateZ(Math.PI / 2), M.galv, 0.04, 0.98, lz - s * 0.4);
      }
      doorLeaves.push({ hinge, side: s });
    }
    doorCollider = b.collider(-0.03, DY + DOOR_H / 2, 0, 0.06, DOOR_H, DOOR_W);
    for (const s of [-1, 1]) b.box(M.darkSteel, 0.06, 0.05, 0.42, 0.06, DY + 2.48, s * 0.42, N); // door closers on the frame
    // no-step sign is redundant; a delivery sign instead
    b.decal(0.62, 0.36, 0.06, 1.75, -1.85, Math.PI / 2, 520, (c, w, h) => {
      c.fillStyle = '#16324f';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#e8ecef';
      c.lineWidth = h * 0.03;
      c.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h * 0.9);
      c.fillStyle = '#eef1f3';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${h * 0.3}px ${SIGN}`;
      c.fillText('Anlieferung', w / 2, h * 0.36);
      c.font = `500 ${h * 0.12}px ${SIGN}`;
      c.fillText('Auktionshaus Varga · Lager', w / 2, h * 0.62);
      c.fillText('Bitte klingeln', w / 2, h * 0.8);
    });
    // intercom
    b.box(M.galv, 0.03, 0.3, 0.15, 0.015, 1.45, 1.48, { collide: false, round: 0.008 });
    b.box(M.black, 0.01, 0.07, 0.08, 0.032, 1.53, 1.48, N);
    for (let i = 0; i < 4; i++) b.box(M.black, 0.01, 0.006, 0.08, 0.032, 1.42 - i * 0.018, 1.48, N);
    b.glowBox(0xdde8ff, 0.012, 0.03, 0.05, 0.033, 1.33, 1.48, 0.9);

    // caged bulkhead lamp above the door
    const LY = DY + 2.82;
    b.box(M.darkSteel, 0.04, 0.24, 0.24, 0.02, LY, 0, N);
    const globe = new THREE.CylinderGeometry(0.075, 0.075, 0.2, 20).rotateZ(Math.PI / 2).translate(0.15, LY, 0);
    b.addStatic(mats.glow(0xe2ecff, 3.2), globe, false);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.box(M.darkSteel, 0.24, 0.01, 0.01, 0.15, LY + Math.cos(a) * 0.09, Math.sin(a) * 0.09, N);
    }
    for (const x of [0.08, 0.17, 0.26]) {
      const ring = new THREE.TorusGeometry(0.09, 0.006, 6, 20).rotateY(Math.PI / 2).translate(x, LY, 0);
      b.addStatic(M.darkSteel, ring);
    }
  }
  // the door as one interactable target (invisible proxy in front of the leaves)
  const doorTarget = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 2.2), new THREE.MeshBasicMaterial({ visible: false }));
  doorTarget.position.set(0.04, PLAT + 1.2, 0);
  b.group.add(doorTarget);

  // security camera on a wall arm, looking at the gate
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff1a1a, emissiveIntensity: 5, roughness: 0.5 });
  b.trackGlow(ledMat);
  {
    b.box(M.darkSteel, 0.03, 0.14, 0.1, 0.015, 3.5, -1.45, N);
    b.box(M.darkSteel, 0.24, 0.04, 0.04, 0.12, 3.5, -1.45, N);
    const cam = new THREE.Group();
    cam.position.set(0.26, 3.46, -1.45);
    cam.rotation.set(0, -0.62, -0.32, 'YZX');
    const camWhite = plastic(0xd8d8d2, 0.45);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.11, 0.12), camWhite);
    housing.position.x = 0.12;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.15), camWhite);
    hood.position.set(0.14, 0.064, 0);
    const lensRing = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 20).rotateZ(Math.PI / 2), M.black);
    lensRing.position.set(0.276, 0, 0);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.004, 20).rotateZ(Math.PI / 2), M.vanGlass);
    lens.position.set(0.283, 0, 0);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.008, 0.008), ledMat);
    led.position.set(0.272, -0.04, 0.04);
    for (const m of [housing, hood, lensRing, lens, led]) {
      m.castShadow = m !== led;
      m.receiveShadow = true;
      cam.add(m);
    }
    b.group.add(cam);
  }

  // ================================================================ yard walls and gate
  const WH = 2.6; // wall height above the yard
  // south wall, in line with the building's street facade (z 4.66..4.9), gate x 1.38..5.02
  b.box(M.yardWall, 1.2, WH, 0.24, 0.6, KERB + WH / 2, 4.78, { tile: 2.6 });
  b.box(M.yardWall, 1.36, WH, 0.24, 5.88 + 0.0, KERB + WH / 2, 4.78, { tile: 2.6 });
  b.box(M.coping, 1.26, 0.07, 0.32, 0.63, KERB + WH + 0.035, 4.78, N);
  b.box(M.coping, 1.42, 0.07, 0.32, 5.88, KERB + WH + 0.035, 4.78, N);
  // gate pillars
  for (const px of [1.2, 5.2]) {
    b.box(M.plinth, 0.36, 2.9, 0.36, px, KERB + 1.45, 4.78, { tile: 1.6 });
    b.box(M.coping, 0.44, 0.08, 0.44, px, KERB + 2.94, 4.78, N);
  }
  b.box(M.plinth, 6.74, 0.3, 0.025, 3.37, KERB + 0.15, 4.912, N); // dirty foot of the wall
  // north wall (z -6.84..-6.6)
  b.box(M.yardWall, 6.74, WH, 0.24, 3.37, KERB + WH / 2, -6.72, { tile: 2.6 });
  b.box(M.coping, 6.8, 0.07, 0.32, 3.37, KERB + WH + 0.035, -6.72, N);

  // gate: two steel leaves with corrugated infill; the west leaf stands open into the yard
  const leaf = (hx: number, hz: number, rot: number, len: number) => {
    const y0 = KERB + 0.08;
    const H = 1.95;
    rbox(M.darkSteel, len, 0.06, 0.06, hx, hz, rot, len / 2, y0 + 0.03, 0);
    rbox(M.darkSteel, len, 0.06, 0.06, hx, hz, rot, len / 2, y0 + H - 0.03, 0);
    rbox(M.darkSteel, len, 0.05, 0.05, hx, hz, rot, len / 2, y0 + H * 0.5, 0);
    rbox(M.darkSteel, 0.06, H, 0.06, hx, hz, rot, 0.03, y0 + H / 2, 0);
    rbox(M.darkSteel, 0.06, H, 0.06, hx, hz, rot, len - 0.03, y0 + H / 2, 0);
    rbox(M.corr, len - 0.08, H - 0.1, 0.02, hx, hz, rot, len / 2, y0 + H / 2, 0, { tile: 1.4 });
    for (const y of [0.4, 1.6]) rbox(M.darkSteel, 0.08, 0.1, 0.04, hx, hz, rot, -0.02, y0 + y, 0); // hinges
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    b.collider(hx + (len / 2) * c, y0 + H / 2, hz - (len / 2) * s, len, H, 0.1, rot);
  };
  leaf(1.38, 4.78, 1.42, 1.82); // open, swung north
  leaf(3.2, 4.78, 0, 1.82); // closed, spans x 3.2..5.02
  b.box(M.darkSteel, 0.04, 0.6, 0.04, 3.16, KERB + 0.4, 4.78, N); // drop bolt
  b.cylinder(M.darkSteel, 0.05, 0.012, 3.16, KERB + 0.004, 4.78, { collide: false, segments: 10 });
  // signs on the east pillar (street side)
  b.decal(0.42, 0.56, 5.2, 1.65, 4.965, 0, 500, (c, w, h) => {
    c.fillStyle = '#f2f2ec';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#c3161c';
    c.beginPath();
    c.arc(w / 2, h * 0.33, w * 0.32, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1b4fa0';
    c.beginPath();
    c.arc(w / 2, h * 0.33, w * 0.24, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#c3161c';
    c.lineWidth = w * 0.08;
    c.beginPath();
    c.moveTo(w / 2 - w * 0.17, h * 0.33 - w * 0.17);
    c.lineTo(w / 2 + w * 0.17, h * 0.33 + w * 0.17);
    c.stroke();
    c.fillStyle = '#111';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${h * 0.085}px ${SIGN}`;
    c.fillText('Einfahrt', w / 2, h * 0.73);
    c.fillText('freihalten', w / 2, h * 0.84);
    c.font = `500 ${h * 0.05}px ${SIGN}`;
    c.fillText('Auktionshaus Varga · Anlieferung', w / 2, h * 0.94);
  });

  // ================================================================ yard props
  const VXC = -2.4; // van centre (the van itself is built further down)
  const VZC = 8.25;
  // bins along the neighbour's fire wall
  const container = (x: number, z: number, lid: THREE.Material, rot = 0) => {
    // 1100 l container: tapered body, flat lid, four castors
    const body = new THREE.CylinderGeometry(0.94, 0.86, 1.18, 4, 1).rotateY(Math.PI / 4);
    body.scale(1.37 / (0.94 * Math.SQRT2), 1, 1.05 / (0.94 * Math.SQRT2));
    body.rotateY(rot).translate(x, KERB + 0.2 + 0.59, z);
    b.addStatic(M.binGrey, body.toNonIndexed());
    rbox(lid, 1.42, 0.07, 1.12, x, z, rot, 0, KERB + 1.42, 0, { round: 0.03 });
    rbox(M.binGrey, 1.38, 0.06, 0.06, x, z, rot, 0, KERB + 1.36, -0.55);
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.36, 0.36]) {
      rbox(M.rubber, 0.06, 0.16, 0.16, x, z, rot, sx, KERB + 0.08, sz, { round: 0.05 });
      rbox(M.darkSteel, 0.1, 0.06, 0.1, x, z, rot, sx, KERB + 0.19, sz);
    }
    for (const sx of [-0.45, 0.45]) rbox(M.galv, 0.05, 0.05, 0.3, x, z, rot, sx, KERB + 1.1, 0.55); // handles
    b.collider(x, KERB + 0.75, z, Math.abs(Math.cos(rot)) * 1.42 + Math.abs(Math.sin(rot)) * 1.12, 1.5, Math.abs(Math.sin(rot)) * 1.42 + Math.abs(Math.cos(rot)) * 1.12);
  };
  container(5.85, -1.1, M.binDark, Math.PI / 2);
  container(5.85, 0.45, M.binBlue, Math.PI / 2);
  const wheelie = (x: number, z: number, lid: THREE.Material, rot: number) => {
    // 240 l bin
    const body = new THREE.CylinderGeometry(0.42, 0.36, 0.95, 4, 1).rotateY(Math.PI / 4);
    body.scale(0.58 / (0.42 * Math.SQRT2), 1, 0.72 / (0.42 * Math.SQRT2));
    body.rotateY(rot).translate(x, KERB + 0.07 + 0.475, z);
    b.addStatic(M.binGrey, body.toNonIndexed());
    rbox(lid, 0.62, 0.05, 0.78, x, z, rot, 0, KERB + 1.05, 0.02, { round: 0.02 });
    rbox(M.binGrey, 0.6, 0.06, 0.06, x, z, rot, 0, KERB + 1.0, 0.39);
    for (const sx of [-0.24, 0.24]) {
      const wheel = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16).rotateZ(Math.PI / 2);
      wheel.translate(sx, 0, 0).rotateY(rot).translate(x + 0.36 * Math.sin(rot), KERB + 0.1, z + 0.36 * Math.cos(rot));
      b.addStatic(M.rubber, wheel);
    }
    b.collider(x, KERB + 0.55, z, 0.7, 1.1, 0.7);
  };
  wheelie(6.0, 1.75, M.binDark, Math.PI / 2 + 0.06);
  wheelie(6.02, 2.5, M.binYellow, Math.PI / 2 - 0.05);
  wheelie(6.0, 3.25, M.binBlue, Math.PI / 2 + 0.1);

  // euro pallets (1.2 x 0.8 x 0.144)
  const pallet = (x: number, y: number, z: number, rot: number) => {
    for (let i = 0; i < 5; i++) rbox(M.pallet, 1.2, 0.022, i % 2 ? 0.1 : 0.145, x, z, rot, 0, y + 0.133, -0.33 + i * 0.165, { shadow: true });
    for (const lx of [-0.53, 0, 0.53]) rbox(M.pallet, 0.145, 0.022, 0.8, x, z, rot, lx, y + 0.111, 0); // cross boards
    for (const lz of [-0.33, 0, 0.33]) {
      rbox(M.pallet, 1.2, 0.022, 0.145, x, z, rot, 0, y + 0.011, lz); // bottom boards
      for (const lx of [-0.53, 0, 0.53]) rbox(M.pallet, 0.145, 0.078, lz ? 0.145 : 0.1, x, z, rot, lx, y + 0.061, lz); // blocks
    }
  };
  const stack = (x: number, z: number, n: number, rot: number) => {
    for (let i = 0; i < n; i++) pallet(x + Math.sin(i * 2.1) * 0.03, KERB + i * 0.144, z + Math.cos(i * 1.7) * 0.03, rot + Math.sin(i * 3.3) * 0.025);
    b.collider(x, KERB + n * 0.072, z, Math.abs(Math.cos(rot)) * 1.2 + Math.abs(Math.sin(rot)) * 0.8, n * 0.144, Math.abs(Math.sin(rot)) * 1.2 + Math.abs(Math.cos(rot)) * 0.8);
  };
  stack(5.75, -5.85, 9, Math.PI / 2);
  stack(4.6, -6.0, 6, 0.04);
  stack(3.25, -6.05, 3, -0.03);

  // art shipping crates (plywood with battens), stencilled
  const stencil = (lines: string[], arrows: boolean): Draw => (c, w, h) => {
    c.fillStyle = 'rgba(25,22,18,0.82)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${h * 0.11}px ${SIGN}`;
    lines.forEach((l, i) => c.fillText(l, w / 2, h * (0.3 + i * 0.16)));
    if (arrows) {
      for (const ax of [0.2, 0.8]) {
        c.beginPath();
        c.moveTo(w * ax, h * 0.62);
        c.lineTo(w * ax - h * 0.07, h * 0.74);
        c.lineTo(w * ax + h * 0.07, h * 0.74);
        c.closePath();
        c.fill();
        c.fillRect(w * ax - h * 0.02, h * 0.74, h * 0.04, h * 0.12);
      }
    }
  };
  const crate = (x: number, z: number, sx: number, sy: number, sz: number, rot: number, label: string[], y0 = KERB) => {
    rbox(M.ply, sx, sy, sz, x, z, rot, 0, y0 + sy / 2, 0, { tile: 1.4 });
    const bt = 0.06;
    for (const lz of [-1, 1]) {
      rbox(M.pallet, sx + 0.02, bt, 0.025, x, z, rot, 0, y0 + bt / 2 + 0.02, lz * (sz / 2 + 0.012));
      rbox(M.pallet, sx + 0.02, bt, 0.025, x, z, rot, 0, y0 + sy - bt / 2 - 0.02, lz * (sz / 2 + 0.012));
      rbox(M.pallet, bt, sy - 0.04, 0.025, x, z, rot, -sx / 2 + bt / 2, y0 + sy / 2, lz * (sz / 2 + 0.012));
      rbox(M.pallet, bt, sy - 0.04, 0.025, x, z, rot, sx / 2 - bt / 2, y0 + sy / 2, lz * (sz / 2 + 0.012));
    }
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const fz = sz / 2 + 0.03;
    const d = b.decal(sx * 0.8, sy * 0.8, x + fz * s, y0 + sy / 2, z + fz * c, rot, 260, stencil(label, true));
    void d;
    b.collider(x, y0 + sy / 2, z, Math.abs(c) * sx + Math.abs(s) * sz, sy, Math.abs(s) * sx + Math.abs(c) * sz);
  };
  crate(0.42, -4.3, 2.0, 1.55, 0.32, Math.PI / 2, ['AV 24-0917', 'VORSICHT GLAS', 'NICHT KIPPEN']);
  crate(0.75, -4.6, 1.6, 1.2, 0.28, Math.PI / 2 + 0.05, ['AV 24-0921', 'GEMÄLDE']);
  crate(1.6, -5.9, 0.9, 0.75, 0.8, 0.12, ['AV 24-0933', 'OBEN']);
  crate(1.55, -5.85, 0.6, 0.45, 0.55, -0.2, ['AV 24-0934'], KERB + 0.75);

  // hand pallet truck left near the ramp
  {
    const x = 2.2;
    const z = 2.2;
    const r = 2.6;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const at = (lx: number, lz: number) => [x + lx * c + lz * s, z - lx * s + lz * c] as const;
    for (const lz of [-0.27, 0.27]) {
      rbox(M.jack, 1.15, 0.06, 0.16, x, z, r, 0.2, KERB + 0.075, lz, { round: 0.01 });
      rbox(M.jack, 0.12, 0.03, 0.12, x, z, r, 0.72, KERB + 0.04, lz);
    }
    rbox(M.jack, 0.3, 0.12, 0.7, x, z, r, -0.42, KERB + 0.12, 0, { round: 0.02 }); // chassis
    rbox(M.jack, 0.2, 0.16, 0.24, x, z, r, -0.45, KERB + 0.26, 0, { round: 0.02 }); // pump housing
    const pump = new THREE.CylinderGeometry(0.045, 0.05, 0.2, 14);
    const [px, pz] = at(-0.45, 0);
    b.addStatic(M.galv, pump.translate(px, KERB + 0.44, pz));
    const handle = new THREE.CylinderGeometry(0.017, 0.017, 1.0, 8).translate(0, 0.5, 0).rotateZ(0.32).translate(-0.47, KERB + 0.5, 0).rotateY(r).translate(x, 0, z);
    b.addStatic(M.jack, handle);
    const top = -0.47 - Math.sin(0.32) * 1.0;
    const grip = new THREE.CylinderGeometry(0.022, 0.022, 0.32, 10).rotateX(Math.PI / 2).translate(top, KERB + 0.5 + Math.cos(0.32), 0).rotateY(r).translate(x, 0, z);
    b.addStatic(M.rubber, grip);
    for (const lz of [-0.12, 0.12]) {
      const w = new THREE.CylinderGeometry(0.085, 0.085, 0.05, 16).rotateX(Math.PI / 2).translate(-0.42, 0.085, lz).rotateY(r).translate(x, KERB, z);
      b.addStatic(M.rubber, w);
    }
    for (const lz of [-0.27, 0.27]) {
      const w = new THREE.CylinderGeometry(0.035, 0.035, 0.08, 12).rotateX(Math.PI / 2).translate(0.66, 0.035, lz).rotateY(r).translate(x, KERB, z);
      b.addStatic(M.rubber, w);
    }
    const [cx, cz] = at(0.05, 0);
    contact(cx, KERB, cz, 1.6, 0.85, r);
    b.collider(cx, KERB + 0.15, cz, 1.4, 0.3, 0.7, r);
  }

  // contact shadows under the larger props
  contact(VXC, 0, VZC, 6.4, 2.3, 0);
  contact(5.85, KERB, -1.1, 1.3, 1.6);
  contact(5.85, KERB, 0.45, 1.3, 1.6);
  for (const zz of [1.75, 2.5, 3.25]) contact(6.0, KERB, zz, 0.85, 0.7);
  contact(5.75, KERB, -5.85, 1.05, 1.45);
  contact(4.6, KERB, -6.0, 1.45, 1.0);
  contact(3.25, KERB, -6.05, 1.45, 1.0);
  contact(0.55, KERB, -4.45, 0.75, 2.3);
  contact(1.6, KERB, -5.9, 1.1, 1.0);
  contact(6.35, KERB, 5.18, 0.75, 0.65);

  // floor drain in the middle of the yard
  {
    const x = 3.2;
    const z = -2.2;
    b.box(M.black, 0.5, 0.01, 0.5, x, KERB + 0.001, z, N);
    b.box(M.darkSteel, 0.54, 0.012, 0.03, x, KERB + 0.006, z - 0.26, N);
    b.box(M.darkSteel, 0.54, 0.012, 0.03, x, KERB + 0.006, z + 0.26, N);
    for (let i = 0; i < 9; i++) b.box(M.darkSteel, 0.025, 0.012, 0.5, x - 0.24 + i * 0.06, KERB + 0.006, z, N);
  }
  // rubbish bags next to the bins, a hose bib on the wall
  for (const [x, z, r, s] of [
    [6.05, 4.0, 0.4, 1],
    [5.55, 3.85, 2.1, 0.85],
    [5.1, -2.15, 1.0, 0.9],
  ] as const) {
    const o = model('trashbag', x, KERB, z, r, s);
    if (o) b.group.add(o);
  }
  b.box(M.galv, 0.06, 0.06, 0.06, 0.04, 0.75, -2.6, N);
  b.cylinder(M.galv, 0.02, 0.1, 0.09, 0.72, -2.6, { collide: false, segments: 8 });

  // ================================================================ neighbours
  // east: a five-storey block whose blank fire wall closes the yard
  b.box(M.neigh, 33.3, 15, 30, 6.74 + 16.65, 7.5, -10.1);
  b.box(M.firewall, 0.02, 15, 11.6, 6.735, 7.5, -0.9, N);
  b.box(M.coping, 33.4, 0.2, 30.1, 6.74 + 16.65, 15.1, -10.1, N);
  b.box(M.plinth, 33.3, 0.6, 0.05, 6.74 + 16.65, KERB + 0.3, 4.925, N);
  const neighWindows = (x0: number, x1: number, floors: number[], lit: Set<string>, frame: THREE.Material) => {
    for (const y of floors) {
      for (let x = x0; x <= x1; x += 3.1) {
        const key = `${Math.round(x)}:${y}`;
        const l = lit.has(key);
        if (l) b.glowBox(0xffbf7d, 1.2, 1.5, 0.02, x, y, 4.905, 0.55);
        else b.box(M.glass, 1.2, 1.5, 0.03, x, y, 4.912, N);
        b.box(frame, 1.3, 0.05, 0.08, x, y + 0.77, 4.94, N);
        b.box(frame, 0.05, 1.55, 0.08, x - 0.62, y, 4.94, N);
        b.box(frame, 0.05, 1.55, 0.08, x + 0.62, y, 4.94, N);
        b.box(frame, 0.05, 1.5, 0.04, x, y, 4.93, N);
        b.box(M.coping, 1.45, 0.05, 0.18, x, y - 0.79, 4.99, N);
        if (l) b.box(M.black, 1.2, 0.5, 0.01, x, y + 0.5, 4.925, NS); // half-drawn blind
      }
    }
  };
  neighWindows(9.0, 30, [4.6, 7.6, 10.6, 13.4], new Set(['12:7.6', '22:10.6', '28:4.6']), M.coping);
  // ground floor: a garage shutter and a front door
  b.box(M.shutter, 2.8, 2.5, 0.06, 9.4, KERB + 1.25, 4.93, N);
  b.box(M.darkSteel, 3.0, 0.32, 0.22, 9.4, KERB + 2.65, 4.99, N);
  b.box(M.darkSteel, 0.08, 2.5, 0.1, 7.96, KERB + 1.25, 4.95, N);
  b.box(M.darkSteel, 0.08, 2.5, 0.1, 10.84, KERB + 1.25, 4.95, N);
  b.box(M.glass, 1.1, 2.2, 0.03, 13.6, KERB + 1.1, 4.912, N);
  b.box(M.galv, 0.2, 0.32, 0.03, 14.4, 1.4, 4.92, N);
  b.glowBox(0xfff0d0, 0.12, 0.2, 0.02, 14.4, 1.42, 4.935, 0.45); // lit bell board
  b.glowBox(0xfff3dc, 0.9, 0.5, 0.02, 13.6, KERB + 2.55, 4.905, 0.25); // stairwell light over the door
  // utility cabinet at the foot of the yard wall, street side
  {
    const o = model('utility_box', 6.35, KERB, 5.18, Math.PI, 1);
    if (o) b.group.add(o);
    b.collider(6.35, KERB + 0.56, 5.18, 0.55, 1.12, 0.45);
  }
  // west: a taller residential block, then the street fades out
  b.box(M.neighW, 40, 17, 30, -22 - 20, 8.5, -10.1);
  b.box(M.coping, 40.1, 0.2, 30.1, -42, 17.1, -10.1, N);
  neighWindows(-58, -23.5, [1.9, 5.1, 8.1, 11.1, 14.1], new Set(['-27:8.1', '-36:5.1', '-24:14.1', '-45:11.1']), M.coping);
  // north: the yard's back wall, with a dark rear building behind it
  b.box(M.rear, 12, 9.5, 12, 1.0, 4.75, -14.0);
  for (const [x, y, lit] of [
    [1.0, 4.2, false],
    [3.6, 4.2, false],
    [1.0, 7.2, true],
    [3.6, 7.2, false],
    [-1.6, 7.2, false],
  ] as const) {
    if (lit) {
      b.glowBox(0xffc88f, 1.0, 1.3, 0.02, x, y, -7.995, 0.16);
      b.box(M.black, 1.0, 0.7, 0.01, x, y + 0.3, -7.98, NS); // blind half down
    }
    else b.box(M.glass, 1.0, 1.3, 0.03, x, y, -7.99, N);
    b.box(M.coping, 1.15, 0.05, 0.15, x, y - 0.68, -7.94, N);
  }

  // ================================================================ car park across the street
  {
    const Z = 16.0; // facade line
    const D = 30;
    const front = (sx: number, sy: number, x: number, y: number, mat: THREE.Material = M.carpark) => b.box(mat, sx, sy, 0.3, x, y, Z + 0.15, N);
    // decks, interior, back wall
    // decks and ground slab start behind the 0.3 m spandrel bands: flush with the bands, their
    // front and under faces z-fought along the whole facade (visible flicker from the street)
    for (const y of [3, 6, 9, 12]) b.box(M.carparkIn, 90, 0.3, D - 0.3, 0, y - 0.15, Z + 0.3 + (D - 0.3) / 2, N);
    b.box(M.carparkIn, 90, 13, 0.4, 0, 6.5, Z + D, N);
    b.box(M.carparkIn, 90, 0.2, D - 0.3, 0, KERB - 0.1, Z + 0.3 + (D - 0.3) / 2, N);
    // spandrel bands: slab edge + parapet at every level, roof parapet
    for (const y of [3, 6, 9]) front(90, 1.35, 0, y + 0.375);
    front(90, 1.3, 0, 12.5);
    front(90, 1.0, 0, KERB + 0.5); // ground level low wall
    // columns
    for (let x = -37.5; x <= 37.5; x += 7.5) {
      b.box(M.carpark, 0.5, 13.1, 0.5, x, 6.55, Z + 0.3, N);
      for (let zz = Z + 7.5; zz < Z + D - 1; zz += 7.5) b.box(M.carparkIn, 0.5, 12, 0.5, x, 6, zz, N);
    }
    // fluorescent tubes under the decks, only some bays lit (night mode)
    const r = rng(42);
    for (const y of [3, 6, 9, 12]) {
      for (let x = -33.75; x <= 33.75; x += 7.5) {
        if (r() < 0.45) continue;
        for (const zz of [Z + 2.5, Z + 8]) b.glowBox(0xd8f2e6, 1.4, 0.04, 0.1, x + (r() - 0.5) * 2, y - 0.33, zz, 1.6);
      }
    }
    // entrance lane with barrier and the P sign
    b.box(M.carparkIn, 6, 0.9, 0.32, 10.0, KERB + 0.5, Z + 0.15, N); // gap in the low wall is closed by the barrier
    b.box(mats.hazard, 3.6, 0.07, 0.07, 9.4, KERB + 1.0, Z - 0.3, NS);
    b.box(M.binYellow, 0.32, 1.05, 0.3, 7.4, KERB + 0.52, Z - 0.3, N);
    b.box(M.darkSteel, 0.4, 0.35, 0.3, 12.6, KERB + 1.25, Z - 0.35, N);
    b.glowBox(0xff3322, 0.08, 0.08, 0.02, 12.6, KERB + 1.3, Z - 0.51, 3);
    b.screen(0.8, 0.8, 9.5, 3.9, Z - 0.02, 0, 160, (c, w, h) => {
      c.fillStyle = '#1d4f9e';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#f2f2f2';
      c.lineWidth = w * 0.04;
      c.strokeRect(w * 0.06, h * 0.06, w * 0.88, h * 0.88);
      c.fillStyle = '#f5f5f5';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${h * 0.7}px ${SIGN}`;
      c.fillText('P', w / 2, h * 0.54);
    }, 0.9);
    b.screen(2.6, 0.4, 0, 4.0, Z - 0.02, 0, 120, (c, w, h) => {
      c.fillStyle = '#121416';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e9ecef';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `600 ${h * 0.56}px ${SIGN}`;
      c.fillText('PARKHAUS  FÄRBERGASSE', w / 2, h * 0.54);
    }, 0.55);
    b.screen(0.9, 0.3, 14.4, 2.4, Z - 0.02, 0, 160, (c, w, h) => {
      c.fillStyle = '#050505';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#3cff6a';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${h * 0.62}px ${SIGN}`;
      c.fillText('FREI  214', w / 2, h * 0.54);
    }, 0.9);
    b.collider(0, 2, Z + 0.1, 90, 4, 0.4);
  }

  // ================================================================ street lamps
  const streetLamp = (x: number, z: number) => {
    const y0 = KERB;
    b.cylinder(M.darkSteel, 0.11, 6.7, x, y0 + 3.35, z, { segments: 16, radiusTop: 0.065 });
    b.cylinder(M.darkSteel, 0.14, 0.9, x, y0 + 0.45, z, { collide: false, segments: 16 });
    b.box(M.darkSteel, 0.06, 0.06, 1.05, x, y0 + 6.62, z + 0.5, N);
    b.box(M.darkSteel, 0.34, 0.11, 0.7, x, y0 + 6.58, z + 1.15, { collide: false, round: 0.03 });
    b.glowBox(0xffbb78, 0.26, 0.015, 0.52, x, y0 + 6.52, z + 1.15, 7);
  };
  streetLamp(5.75, 6.6);
  streetLamp(-11.5, 6.6);
  streetLamp(28, 6.6);
  streetLamp(-36, 6.6);
  // bollards keeping cars off the pavement in front of the auction house
  for (let x = -12.5; x <= -4; x += 1.8) {
    b.cylinder(M.darkSteel, 0.05, 0.9, x, KERB + 0.45, 6.6, { collide: true, segments: 12 });
    b.box(M.galv, 0.11, 0.05, 0.11, x, KERB + 0.78, 6.6, N);
  }

  // ================================================================ the crew's van
  // A present-day panel van, parked on our side of the street facing west (its
  // sliding door is on the pavement side). Local frame: front at +x, origin on
  // the road under its centre.
  const VX = -2.4;
  const VZ = 8.25;
  const vanM = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(VX, 0, VZ);
  const vadd = (mat: THREE.Material, geo: THREE.BufferGeometry, shadow = true) => {
    geo.applyMatrix4(vanM);
    b.addStatic(mat, geo, shadow);
  };
  const vbox = (mat: THREE.Material, sx: number, sy: number, sz: number, lx: number, ly: number, lz: number, round = 0) =>
    b.box(mat, sx, sy, sz, VX - lx, ly, VZ - lz, { collide: false, round });
  {
    const L = 5.9;
    const W = 1.84; // extrusion depth (bevel adds 0.05 per side)
    const BV = 0.05;
    const ox = -L / 2;
    const s = new THREE.Shape();
    const P = (x: number, y: number) => [x + ox, y] as const;
    s.moveTo(...P(0, 0.44));
    s.lineTo(...P(0, 2.4));
    s.quadraticCurveTo(...P(0, 2.47), ...P(0.12, 2.47));
    s.lineTo(...P(3.7, 2.47));
    s.quadraticCurveTo(...P(4.0, 2.46), ...P(4.12, 2.3));
    s.lineTo(...P(4.88, 1.42));
    s.quadraticCurveTo(...P(4.95, 1.33), ...P(5.1, 1.3));
    s.lineTo(...P(5.62, 1.17));
    s.quadraticCurveTo(...P(5.86, 1.1), ...P(5.88, 0.95));
    s.lineTo(...P(5.9, 0.44));
    s.lineTo(...P(5.38, 0.44));
    s.absarc(4.92 + ox, 0.44, 0.46, 0, Math.PI, false);
    s.lineTo(...P(1.7, 0.44));
    s.absarc(1.24 + ox, 0.44, 0.46, 0, Math.PI, false);
    s.lineTo(...P(0, 0.44));
    const body = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelThickness: BV, bevelSize: BV, bevelSegments: 3, curveSegments: 10 });
    body.translate(0, 0, -W / 2);
    vadd(M.paint, body);
    const sideZ = W / 2 + BV + 0.004;
    // glass: windscreen on the sloped front, cab side windows
    {
      const a = new THREE.Vector2(4.12 + ox, 2.3);
      const c = new THREE.Vector2(4.88 + ox, 1.42);
      const dir = c.clone().sub(a).normalize();
      const n = new THREE.Vector2(-dir.y, dir.x);
      if (n.x < 0) n.multiplyScalar(-1);
      const off = BV + 0.006;
      const p0 = a.clone().addScaledVector(dir, 0.06).addScaledVector(n, off);
      const p1 = c.clone().addScaledVector(dir, -0.04).addScaledVector(n, off);
      const hz = W / 2 - 0.02;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([p0.x, p0.y, -hz, p1.x, p1.y, -hz, p1.x, p1.y, hz, p0.x, p0.y, -hz, p1.x, p1.y, hz, p0.x, p0.y, hz], 3));
      g.computeVertexNormals();
      if (g.attributes.normal.getX(0) < 0) g.scale(1, 1, -1);
      g.computeVertexNormals();
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
      vadd(M.vanGlass, g, false);
    }
    const sideWin = (pts: [number, number][], side: 1 | -1) => {
      const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(side > 0 ? x + ox : -(x + ox), y)));
      const g = new THREE.ShapeGeometry(sh);
      if (side < 0) g.rotateY(Math.PI);
      g.translate(0, 0, side * sideZ);
      return g;
    };
    const cabWin: [number, number][] = [
      [3.42, 1.5],
      [3.42, 2.22],
      [4.02, 2.24],
      [4.1, 2.16],
      [4.7, 1.5],
    ];
    for (const sd of [1, -1] as const) {
      vadd(M.vanGlass, sideWin(cabWin, sd), false);
      // door seams: cab door, sliding door (pavement side) or panel joint
      const z = sd * (sideZ + 0.001);
      const seam = (lx: number, ly: number, h: number) => vbox(M.black, 0.012, h, 0.004, lx, ly, z);
      const seamH = (lx: number, ly: number, w: number) => vbox(M.black, w, 0.012, 0.004, lx, ly, z);
      seam(3.35 + ox, 1.5, 1.5);
      seam(4.72 + ox, 1.02, 0.95);
      if (sd > 0) {
        seam(1.82 + ox, 1.42, 1.85);
        seam(3.3 + ox, 1.42, 1.85);
        seamH(2.56 + ox, 2.35, 1.48);
        vbox(M.vanTrim, 0.03, 0.04, 1.4, 2.56 + ox, 2.42, z + sd * 0.01); // sliding door rail cover
        vbox(M.vanTrim, 0.18, 0.04, 0.03, 3.1 + ox, 1.4, z + sd * 0.012, 0.01); // handle
      } else seam(1.8 + ox, 1.42, 1.85);
      vbox(M.vanTrim, 0.16, 0.04, 0.03, 4.25 + ox, 1.38, z + sd * 0.012, 0.01); // cab door handle
      // mirror on an arm
      vbox(M.vanTrim, 0.08, 0.06, 0.16, 4.2 + ox, 1.62, sd * (sideZ + 0.06));
      vbox(M.vanTrim, 0.1, 0.24, 0.07, 4.2 + ox, 1.72, sd * (sideZ + 0.17), 0.02);
      // protective side strip
      vbox(M.vanTrim, 4.0, 0.12, 0.03, 2.75 + ox, 0.72, sd * (sideZ + 0.008));
      // wheels
      for (const wx of [1.24 + ox, 4.92 + ox]) {
        const tire = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 28).rotateX(Math.PI / 2).translate(wx, 0.36, sd * 0.84);
        vadd(M.rubber, tire);
        const rim = new THREE.CylinderGeometry(0.21, 0.21, 0.02, 20).rotateX(Math.PI / 2).translate(wx, 0.36, sd * 0.965);
        vadd(M.rim, rim);
        const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12).rotateX(Math.PI / 2).translate(wx, 0.36, sd * 0.975);
        vadd(M.vanTrim, hub);
      }
    }
    // front: bumper, grille, lamps
    vbox(M.vanTrim, 0.22, 0.32, 2.0, L / 2 + 0.04, 0.52, 0, 0.05);
    vbox(M.vanTrim, 0.04, 0.26, 1.0, L / 2 + 0.035, 0.84, 0, 0.01);
    for (const sd of [-1, 1]) vbox(M.lens, 0.05, 0.16, 0.36, L / 2 + 0.02, 0.97, sd * 0.68, 0.02);
    // rear: bumper, door seam, tail lights, handle, step
    vbox(M.vanTrim, 0.2, 0.28, 2.0, -L / 2 - 0.04, 0.52, 0, 0.05);
    vbox(M.black, 0.004, 1.75, 0.012, -L / 2 - BV - 0.002, 1.5, 0);
    for (const sd of [-1, 1]) vbox(M.tail, 0.03, 0.5, 0.14, -L / 2 - BV + 0.005, 1.12, sd * 0.86, 0.01);
    vbox(M.vanTrim, 0.03, 0.04, 0.16, -L / 2 - BV - 0.01, 1.32, 0.12, 0.01);
    // licence plates
    const plate = (lx: number, rot: number) => {
      const wx = VX - lx;
      const d = b.decal(0.52, 0.11, wx, 0.6, VZ, rot, 600, (c, w, h) => {
        c.fillStyle = '#f4f4ef';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#1b3f99';
        c.fillRect(0, 0, w * 0.09, h);
        c.strokeStyle = '#111';
        c.lineWidth = h * 0.05;
        c.strokeRect(0, 0, w, h);
        c.fillStyle = '#111';
        c.textBaseline = 'middle';
        c.font = `600 ${h * 0.72}px ${SIGN}`;
        c.textAlign = 'center';
        c.fillText('K · RV 2814', w * 0.55, h * 0.56);
      });
      void d;
    };
    plate(L / 2 + 0.16, Math.PI / 2 + Math.PI); // front faces west (-x)
    plate(-L / 2 - 0.15, Math.PI / 2); // rear faces east (+x)
    b.collider(VX, 1.25, VZ, 6.1, 2.5, 2.05);
  }

  // ================================================================ interior
  // The auction house's rooms in the same scene (6 point lights, no shadows); the shell above is its outer walls.
  const interior = buildVargaInterior(b, deps, { shell: true });

  // ================================================================ lights
  // Exterior budget: 4 lights (2 with shadows). The interior (varga-interior.ts)
  // shares the scene and uses the rest; the far street lamps, the car park tubes
  // and the windows are emissive only.
  b.hemisphere(0x3a465e, 0x1a1510, 1.0);
  // sodium-coloured street lamp by the gate
  b.spot(0xffbb78, 150, 5.75, KERB + 6.45, 7.75, 4.0, 0, 6.2, { angle: 1.1, penumbra: 0.75, distance: 20, shadow: true });
  // cool bulkhead lamp over the delivery door
  b.spot(0xd6e4ff, 34, 0.32, PLAT + 2.78, 0, 3.4, 0, 0.3, { angle: 1.15, penumbra: 0.8, distance: 11, shadow: true });
  // car park spill across the street (also lifts the van and the street a little)
  b.point(0xc8e8da, 26, 1.0, 4.4, 16.6, 16, 1.5);

  b.finalize();
  engine.captureEnvironment(new THREE.Vector3(2.5, 1.6, 4.5), 0.7);

  // planning at the van: the same start as the HQ table (lineup first for a crew without roles)
  const vanProxy = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.7, 2.45), new THREE.MeshBasicMaterial({ visible: false }));
  vanProxy.position.set(VX, 1.3, VZ);
  b.group.add(vanProxy);
  interactions.add({
    id: 'varga.plan',
    object: vanProxy,
    range: 2.6,
    prompt: () => (deps.plan && session && !deps.plan.running() ? t('varga.plan') : null),
    onUse: () => deps.plan?.start(),
  });

  interactions.add({
    id: 'varga.door',
    object: doorTarget,
    range: 2.4,
    prompt: () => (doorTarget01 > 0 ? null : t('varga.door')),
    onUse: () => {
      audio.play('deny', { pos: doorTarget.position });
      ui.toast(t('varga.door.locked'), 'warn');
    },
  });

  // behind the van's rear doors, on the road, facing the gate
  const spawns = [
    [1.5, 8.0],
    [1.5, 8.9],
    [2.4, 7.7],
    [2.4, 8.6],
  ];
  const setDoor = (open: boolean) => {
    doorTarget01 = open ? 1 : 0;
    if (doorCollider) physics.setEnabled(doorCollider, !open);
  };
  doorControl = setDoor;
  // the first-person job on this location (src/game/job): lock, safe, guards, doors
  const stage = createVargaStage(deps, { exterior: VARGA_ANCHORS, openDeliveryDoor: setDoor, interior });
  let session: Session | null = null;
  const level: Level & Record<string, unknown> & { openDeliveryDoor(open: boolean): void } = {
    openDeliveryDoor: setDoor,
    /** test hooks */
    interior,
    stage,
    games: stage.games,
    guards: stage.guards,
    anchors: stage.anchors,
    spawn(index) {
      const [x, z] = spawns[index % 4];
      return { pos: new THREE.Vector3(x, 0, z), yaw: 0.12 };
    },
    menuCamera(time, cam) {
      // slow dolly along the far pavement, looking across at the gate and the van
      const s = Math.sin(time * 0.04);
      cam.position.set(5.5 + s * 2.5, 2.1, 14.2);
      cam.lookAt(0.8 + s * 1.2, 1.5, 3.2);
    },
    attach(s) {
      session = s;
      stage.attach(s);
    },
    detach() {
      stage.detach();
      session = null;
    },
    update(_dt, time) {
      b.updateShadows(time);
      interior.update(_dt, time);
      stage.update(_dt, time);
      // fell out of the world outside a job (the job director handles it during a run)
      const pl = deps.player();
      if (pl && session && pl.position.y < -8 && !deps.plan?.running()) {
        const sp = level.spawn(0);
        pl.teleport(sp.pos, sp.yaw);
      }
      // the camera LED blinks once every two seconds
      ledMat.emissiveIntensity = (time % 2 < 0.12 ? 7 : 1.2) * b.getPower();
      if (doorOpen01 !== doorTarget01) {
        doorOpen01 += Math.sign(doorTarget01 - doorOpen01) * Math.min(Math.abs(doorTarget01 - doorOpen01), _dt * 0.8);
        const e = doorOpen01 * doorOpen01 * (3 - 2 * doorOpen01);
        for (const l of doorLeaves) l.hinge.rotation.y = l.side * e * 1.6; // swings inwards (-x)
      }
    },
    objective() {
      return deps.plan?.running() ? [] : [t(deps.plan ? 'varga.obj.job' : 'varga.obj')];
    },
    redraw() {},
  };
  return level;
}
