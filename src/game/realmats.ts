// Photo-based PBR materials loaded from public/assets (sources and licences: public/assets/ASSETS.md).
//
// The manifest is fetched once at boot (`initRealMats`). After that `realMat()` is
// synchronous: it returns a material whose textures fill in as the images arrive,
// so shaders compile with the right set of maps behind the loading screen.
import * as THREE from 'three';

interface TexSet {
  color?: string;
  normal?: string;
  rough?: string;
  ao?: string;
  bump?: string;
}

const BASE = `${import.meta.env.BASE_URL}assets/`;
let sets: Record<string, TexSet> = {};
let aniso = 4;
let pending = 0;
let idle: (() => void)[] = [];
const cache = new Map<string, THREE.Texture>();

export async function initRealMats(maxAniso: number) {
  aniso = maxAniso;
  try {
    const r = await fetch(`${BASE}manifest.json`);
    if (r.ok) sets = ((await r.json()) as { tex?: Record<string, TexSet> }).tex ?? {};
  } catch {
    sets = {}; // no assets: every material falls back to its plain colour
  }
}

export function hasTex(name: string) {
  return !!sets[name];
}

function settle() {
  if (--pending <= 0) {
    pending = 0;
    for (const f of idle) f();
    idle = [];
  }
}

function load(name: string, file: string, srgb: boolean, size: number): THREE.Texture {
  const path = file.includes('/') ? file : `tex/${name}/${file}`;
  const key = `${path}|${size}`;
  let t = cache.get(key);
  if (t) return t;
  pending++;
  t = new THREE.TextureLoader().load(BASE + path, settle, undefined, settle);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2 / size, 2 / size); // Builder UVs are in units of 2 m
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  cache.set(key, t);
  return t;
}

/** Resolves when every requested texture has loaded (or failed), or after the timeout. */
export function texturesReady(timeoutMs = 20000): Promise<void> {
  if (pending === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, timeoutMs);
    idle.push(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

export interface RealOpts {
  /** Real-world size of one texture repeat in metres. */
  size?: number;
  /** Tint (multiplied with the photo). */
  color?: number;
  rough?: number;
  metal?: number;
  normalScale?: number;
  /** Use this colour map instead of the photo (e.g. a drawn carpet pattern). */
  map?: THREE.Texture;
  /** Keep only the surface detail (normal/roughness), not the photo colour. */
  noColor?: boolean;
  env?: number;
}

/** First texture set that exists wins; with none, a plain material in `color`. */
export function realMat(names: string | string[], o: RealOpts = {}): THREE.MeshStandardMaterial {
  const name = (Array.isArray(names) ? names : [names]).find((n) => sets[n]);
  const s: TexSet = name ? sets[name] : {};
  const size = o.size ?? 2;
  const m = new THREE.MeshStandardMaterial({ color: o.color ?? 0xffffff, roughness: o.rough ?? 1, metalness: o.metal ?? 0 });
  if (o.map) m.map = o.map;
  else if (name && s.color && !o.noColor) m.map = load(name, s.color, true, size);
  if (name && s.normal) {
    m.normalMap = load(name, s.normal, false, size);
    m.normalScale.setScalar(o.normalScale ?? 1);
  } else if (name && s.bump) {
    m.bumpMap = load(name, s.bump, false, size);
    m.bumpScale = (o.normalScale ?? 1) * 1.5;
  }
  if (name && s.rough) m.roughnessMap = load(name, s.rough, false, size);
  if (name && s.ao) {
    m.aoMap = load(name, s.ao, false, size);
    m.aoMapIntensity = 0.8;
  }
  if (o.env !== undefined) m.envMapIntensity = o.env;
  return m;
}
