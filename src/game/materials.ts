// Procedural PBR materials. All textures are generated on a canvas at load
// time (tileable noise -> albedo / roughness / normal), so there are no image
// downloads and the look stays consistent across the whole game.
import * as THREE from 'three';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value-noise fBm in [0,1]. */
function fbmField(size: number, basePeriod: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const rnd = mulberry(seed + o * 977);
    const lattice = new Float32Array(period * period);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    const cell = size / period;
    for (let y = 0; y < size; y++) {
      const fy = y / cell;
      const y0 = Math.floor(fy) % period;
      const y1 = (y0 + 1) % period;
      let ty = fy - Math.floor(fy);
      ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = x / cell;
        const x0 = Math.floor(fx) % period;
        const x1 = (x0 + 1) % period;
        let tx = fx - Math.floor(fx);
        tx = tx * tx * (3 - 2 * tx);
        const a = lattice[y0 * period + x0];
        const b = lattice[y0 * period + x1];
        const c = lattice[y1 * period + x0];
        const d = lattice[y1 * period + x1];
        out[y * size + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    total += amp;
    amp *= 0.5;
    period *= 2;
    if (period > size) break;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

interface Layers {
  size: number;
  color: Uint8ClampedArray; // rgba
  rough: Float32Array; // 0..1
  height: Float32Array; // 0..1
}

function newLayers(size: number): Layers {
  return { size, color: new Uint8ClampedArray(size * size * 4), rough: new Float32Array(size * size), height: new Float32Array(size * size) };
}

function toTexture(data: Uint8ClampedArray, size: number, srgb: boolean, anisotropy: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(data as unknown as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function buildMaps(l: Layers, normalStrength: number, anisotropy: number) {
  const { size } = l;
  const rough = new Uint8ClampedArray(size * size * 4);
  const normal = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const yu = ((y - 1 + size) % size) * size;
    const yd = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const dx = (l.height[y * size + xr] - l.height[y * size + xl]) * normalStrength;
      const dy = (l.height[yd + x] - l.height[yu + x]) * normalStrength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      normal[i * 4] = (-dx * inv * 0.5 + 0.5) * 255;
      normal[i * 4 + 1] = (dy * inv * 0.5 + 0.5) * 255;
      normal[i * 4 + 2] = (inv * 0.5 + 0.5) * 255;
      normal[i * 4 + 3] = 255;
      const r = Math.max(0, Math.min(1, l.rough[i])) * 255;
      // three.js reads roughness from G and metalness from B
      rough[i * 4] = 255;
      rough[i * 4 + 1] = r;
      rough[i * 4 + 2] = 255;
      rough[i * 4 + 3] = 255;
    }
  }
  return {
    map: toTexture(l.color, size, true, anisotropy),
    roughnessMap: toTexture(rough, size, false, anisotropy),
    normalMap: toTexture(normal, size, false, anisotropy),
  };
}

function setPx(l: Layers, i: number, r: number, g: number, b: number) {
  l.color[i * 4] = r;
  l.color[i * 4 + 1] = g;
  l.color[i * 4 + 2] = b;
  l.color[i * 4 + 3] = 255;
}

// ---------------------------------------------------------------------------

function genFloor(size: number): Layers {
  const l = newLayers(size);
  const big = fbmField(size, 4, 5, 11);
  const smudge = fbmField(size, 3, 4, 23);
  const fine = fbmField(size, 64, 2, 37);
  const rnd = mulberry(5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = 0.72 + big[i] * 0.4 + (fine[i] - 0.5) * 0.12;
      setPx(l, i, 30 * v, 34 * v, 41 * v);
      // polished with dull worn patches: this is what makes reflections interesting
      const worn = Math.max(0, smudge[i] - 0.52) * 2.4;
      l.rough[i] = 0.16 + worn * 0.42 + (fine[i] - 0.5) * 0.06;
      l.height[i] = fine[i] * 0.25 + big[i] * 0.1;
    }
  }
  // expansion joints: a cross through the tile, so every tile is a 2x2 slab grid
  const joint = Math.max(2, Math.round(size / 256));
  for (const pos of [0, size / 2]) {
    for (let k = -joint; k <= joint; k++) {
      const p = (Math.round(pos) + k + size) % size;
      for (let a = 0; a < size; a++) {
        for (const i of [p * size + a, a * size + p]) {
          setPx(l, i, 9, 10, 12);
          l.rough[i] = 0.9;
          l.height[i] = -0.6;
        }
      }
    }
  }
  // a few scuffs
  for (let s = 0; s < 26; s++) {
    let x = rnd() * size;
    let y = rnd() * size;
    const ang = rnd() * Math.PI * 2;
    const len = 30 + rnd() * 140;
    for (let k = 0; k < len; k++) {
      x = (x + Math.cos(ang) + size) % size;
      y = (y + Math.sin(ang) + size) % size;
      const i = Math.floor(y) * size + Math.floor(x);
      l.rough[i] = Math.min(1, l.rough[i] + 0.25);
    }
  }
  return l;
}

function genConcrete(size: number): Layers {
  const l = newLayers(size);
  const big = fbmField(size, 3, 5, 101);
  const stain = fbmField(size, 5, 4, 131);
  const fine = fbmField(size, 96, 2, 151);
  const rnd = mulberry(77);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // drip stains get stronger towards the bottom of the tile
      const drip = Math.max(0, stain[(y % size) * size + ((x * 3) % size)] - 0.55) * (y / size) * 1.4;
      const v = 0.78 + big[i] * 0.36 + (fine[i] - 0.5) * 0.2 - drip * 0.5;
      setPx(l, i, 86 * v, 88 * v, 92 * v);
      l.rough[i] = 0.78 + (fine[i] - 0.5) * 0.25 - drip * 0.2;
      l.height[i] = fine[i] * 0.6 + big[i] * 0.4;
    }
  }
  // formwork seams + tie holes, like cast-in-place concrete
  const seam = Math.max(1, Math.round(size / 400));
  for (const p of [0, Math.round(size / 2)]) {
    for (let k = 0; k <= seam; k++) {
      for (let a = 0; a < size; a++) {
        const i = ((p + k) % size) * size + a;
        l.height[i] -= 0.5;
        setPx(l, i, 52, 53, 56);
      }
    }
  }
  for (let hx = 0; hx < 4; hx++) {
    for (let hy = 0; hy < 2; hy++) {
      const cx = (hx + 0.5) * (size / 4);
      const cy = (hy + 0.5) * (size / 2);
      const r = size / 90;
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          if (x * x + y * y > r * r) continue;
          const i = Math.floor(cy + y) * size + Math.floor(cx + x);
          l.height[i] -= 0.9;
          setPx(l, i, 38, 39, 42);
        }
      }
    }
  }
  for (let s = 0; s < 500; s++) {
    const i = Math.floor(rnd() * size * size);
    l.height[i] -= 0.5;
  }
  return l;
}

/** Dark metal plates with seams and rivets. */
function genPanel(size: number, tint: [number, number, number], brushed: boolean, cols: number, rows: number): Layers {
  const l = newLayers(size);
  const big = fbmField(size, 4, 4, 211);
  const fine = fbmField(size, 128, 1, 223);
  const rnd = mulberry(311);
  const streak = new Float32Array(size);
  for (let i = 0; i < size; i++) streak[i] = rnd();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const br = brushed ? (streak[x] - 0.5) * 0.16 + (fine[i] - 0.5) * 0.08 : (fine[i] - 0.5) * 0.06;
      const v = 0.86 + big[i] * 0.22 + br;
      setPx(l, i, tint[0] * v, tint[1] * v, tint[2] * v);
      l.rough[i] = (brushed ? 0.34 : 0.48) + big[i] * 0.18 + br * 0.8;
      l.height[i] = 0.5 + br * 0.4;
    }
  }
  const seam = Math.max(2, Math.round(size / 256));
  const cw = size / cols;
  const rh = size / rows;
  for (let c = 0; c < cols; c++) {
    const px = Math.round(c * cw);
    for (let k = -seam; k <= seam; k++) {
      const xx = (px + k + size) % size;
      for (let y = 0; y < size; y++) {
        const i = y * size + xx;
        l.height[i] = 0.5 - 0.5 * (1 - Math.abs(k) / (seam + 1));
        setPx(l, i, tint[0] * 0.35, tint[1] * 0.35, tint[2] * 0.35);
        l.rough[i] = 0.8;
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    const py = Math.round(r * rh);
    for (let k = -seam; k <= seam; k++) {
      const yy = (py + k + size) % size;
      for (let x = 0; x < size; x++) {
        const i = yy * size + x;
        l.height[i] = 0.5 - 0.5 * (1 - Math.abs(k) / (seam + 1));
        setPx(l, i, tint[0] * 0.35, tint[1] * 0.35, tint[2] * 0.35);
        l.rough[i] = 0.8;
      }
    }
  }
  // rivets in the plate corners
  const rr = size / 110;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      for (const [ox, oy] of [
        [0.08, 0.08],
        [0.92, 0.08],
        [0.08, 0.92],
        [0.92, 0.92],
      ]) {
        const cx = (c + ox) * cw;
        const cy = (r + oy) * rh;
        for (let y = -rr; y <= rr; y++) {
          for (let x = -rr; x <= rr; x++) {
            const d = Math.hypot(x, y) / rr;
            if (d > 1) continue;
            const i = ((Math.floor(cy + y) + size) % size) * size + ((Math.floor(cx + x) + size) % size);
            l.height[i] = 0.5 + 0.5 * Math.sqrt(1 - d * d);
            l.rough[i] = 0.3;
          }
        }
      }
    }
  }
  return l;
}

function genHazard(size: number): Layers {
  const l = newLayers(size);
  const fine = fbmField(size, 32, 3, 401);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const band = Math.floor(((x + y) / size) * 8) % 2 === 0;
      const wear = 0.75 + fine[i] * 0.35;
      if (band) setPx(l, i, 214 * wear, 150 * wear, 22 * wear);
      else setPx(l, i, 16 * wear, 16 * wear, 18 * wear);
      l.rough[i] = 0.55 + fine[i] * 0.3;
      l.height[i] = 0.5 + fine[i] * 0.1;
    }
  }
  return l;
}

export interface MaterialLib {
  floor: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  vault: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  /** Emissive material in a given colour (shared per colour+intensity). */
  glow(color: number, intensity?: number): THREE.MeshStandardMaterial;
}

export function createMaterials(anisotropy: number, hiRes: boolean): MaterialLib {
  const S = hiRes ? 1024 : 512;
  const floorMaps = buildMaps(genFloor(S), 2.2, anisotropy);
  const concMaps = buildMaps(genConcrete(S), 3.0, anisotropy);
  const panelMaps = buildMaps(genPanel(S, [58, 64, 74], false, 2, 2), 5, anisotropy);
  const steelMaps = buildMaps(genPanel(S / 2, [150, 156, 166], true, 1, 1), 3, anisotropy);
  const darkMaps = buildMaps(genPanel(S / 2, [34, 37, 43], false, 1, 2), 4, anisotropy);
  const ceilMaps = buildMaps(genPanel(S / 2, [26, 28, 33], false, 2, 2), 5, anisotropy);
  const hazMaps = buildMaps(genHazard(256), 1, anisotropy);

  const glowCache = new Map<string, THREE.MeshStandardMaterial>();

  return {
    floor: new THREE.MeshStandardMaterial({ ...floorMaps, metalness: 0.35, roughness: 1, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 1.25 }),
    concrete: new THREE.MeshStandardMaterial({ ...concMaps, metalness: 0, roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9) }),
    panel: new THREE.MeshStandardMaterial({ ...panelMaps, metalness: 0.85, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }),
    steel: new THREE.MeshStandardMaterial({ ...steelMaps, metalness: 1, roughness: 1, normalScale: new THREE.Vector2(0.5, 0.5) }),
    darkMetal: new THREE.MeshStandardMaterial({ ...darkMaps, metalness: 0.8, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) }),
    vault: new THREE.MeshStandardMaterial({ ...steelMaps, color: 0x9fb4c8, metalness: 1, roughness: 0.85, normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 1.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0, roughness: 0.92 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.1, roughness: 0.45 }),
    hazard: new THREE.MeshStandardMaterial({ ...hazMaps, metalness: 0.2, roughness: 1 }),
    ceiling: new THREE.MeshStandardMaterial({ ...ceilMaps, metalness: 0.6, roughness: 1, normalScale: new THREE.Vector2(0.7, 0.7) }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd8e0, metalness: 0.9, roughness: 0.06, transparent: true, opacity: 0.16, envMapIntensity: 2, depthWrite: false }),
    black: new THREE.MeshStandardMaterial({ color: 0x030405, metalness: 0.2, roughness: 0.7 }),
    glow(color: number, intensity = 4) {
      const key = color + ':' + intensity;
      let m = glowCache.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.6, metalness: 0 });
        glowCache.set(key, m);
      }
      return m;
    },
  };
}
