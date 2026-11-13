// Level construction helpers: static geometry is collected per material and
// merged into a handful of draw calls; colliders are created alongside.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Physics, Collider } from '../core/physics';
import type { MaterialLib } from './materials';
import type { QualityPreset } from '../core/engine';

export interface BoxOpts {
  rotY?: number;
  collide?: boolean;
  /** Texture tile size in metres (world-space UVs). */
  tile?: number;
  /** Bevel radius; 0 = sharp box. */
  round?: number;
  shadow?: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Rewrite UVs from world-space positions so textures keep a constant texel density. */
function worldUv(geo: THREE.BufferGeometry, tile: number) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
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

export interface ScreenHandle {
  mesh: THREE.Mesh;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Re-run the draw callback and upload the texture. */
  redraw(): void;
  setBrightness(v: number): void;
}

export class Builder {
  readonly group = new THREE.Group();
  private batches = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }>();
  private lights: { light: THREE.Light; base: number }[] = [];
  private glows = new Map<THREE.MeshStandardMaterial, number>();
  private screens: { mat: THREE.MeshStandardMaterial; base: number }[] = [];
  private cones: THREE.ShaderMaterial[] = [];
  private power = 1;
  private shadowLights: { light: THREE.SpotLight; next: number }[] = [];

  constructor(
    readonly scene: THREE.Scene,
    readonly physics: Physics,
    readonly mats: MaterialLib,
    readonly quality: QualityPreset,
  ) {
    scene.add(this.group);
  }

  private push(mat: THREE.Material, geo: THREE.BufferGeometry, shadow: boolean) {
    let b = this.batches.get(mat);
    if (!b) this.batches.set(mat, (b = { geos: [], shadow }));
    b.geos.push(geo.index ? geo.toNonIndexed() : geo);
  }

  /** Static box (merged). Position is the box centre. */
  box(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, o: BoxOpts = {}) {
    const geo: THREE.BufferGeometry = o.round
      ? new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(o.round, sx / 2, sy / 2, sz / 2))
      : new THREE.BoxGeometry(sx, sy, sz);
    _q.setFromAxisAngle(UP, o.rotY ?? 0);
    _m.compose(_v.set(x, y, z), _q, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(_m);
    worldUv(geo, o.tile ?? 2);
    this.push(mat, geo, o.shadow ?? true);
    if (o.collide ?? true) this.physics.addBox(x, y, z, sx, sy, sz, o.rotY ?? 0);
  }

  /** Static vertical cylinder (merged). */
  cylinder(mat: THREE.Material, radius: number, height: number, x: number, y: number, z: number, o: { collide?: boolean; segments?: number; radiusTop?: number; tile?: number; shadow?: boolean } = {}) {
    const geo = new THREE.CylinderGeometry(o.radiusTop ?? radius, radius, height, o.segments ?? 28);
    geo.translate(x, y, z);
    worldUv(geo, o.tile ?? 2);
    this.push(mat, geo, o.shadow ?? true);
    if (o.collide ?? true) this.physics.addCylinder(x, y, z, radius, height);
  }

  /** Any pre-built static geometry, already in level space. */
  addStatic(mat: THREE.Material, geo: THREE.BufferGeometry, shadow = true) {
    this.push(mat, geo, shadow);
  }

  /** Emissive strip / tube / panel (merged, never casts shadows). */
  glowBox(color: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, intensity = 4, rotY = 0) {
    const mat = this.mats.glow(color, intensity);
    if (!this.glows.has(mat)) this.glows.set(mat, intensity);
    this.box(mat, sx, sy, sz, x, y, z, { collide: false, shadow: false, rotY });
  }

  /** Standalone (non-merged) mesh for things that move or change. */
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.group): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  collider(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0): Collider {
    return this.physics.addBox(x, y, z, sx, sy, sz, rotY);
  }

  point(color: number, intensity: number, x: number, y: number, z: number, distance = 8, decay = 1.8): THREE.PointLight {
    const l = new THREE.PointLight(color, intensity, distance, decay);
    l.position.set(x, y, z);
    this.group.add(l);
    this.lights.push({ light: l, base: intensity });
    return l;
  }

  spot(color: number, intensity: number, x: number, y: number, z: number, tx: number, ty: number, tz: number, o: { angle?: number; penumbra?: number; distance?: number; shadow?: boolean } = {}): THREE.SpotLight {
    const l = new THREE.SpotLight(color, intensity, o.distance ?? 14, o.angle ?? 0.6, o.penumbra ?? 0.6, 1.6);
    l.position.set(x, y, z);
    l.target.position.set(tx, ty, tz);
    this.group.add(l, l.target);
    if (o.shadow) {
      l.castShadow = true;
      l.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
      l.shadow.camera.near = 0.3;
      l.shadow.camera.far = o.distance ?? 14;
      l.shadow.bias = -0.0004;
      l.shadow.normalBias = 0.03;
      l.shadow.radius = 3;
      // The room is static: refreshing these maps 30x per second (staggered)
      // instead of every frame saves a full scene pass per light per frame.
      l.shadow.autoUpdate = false;
      l.shadow.needsUpdate = true;
      this.shadowLights.push({ light: l, next: this.shadowLights.length / 60 });
    }
    this.lights.push({ light: l, base: intensity });
    return l;
  }

  hemisphere(sky: number, ground: number, intensity: number) {
    const l = new THREE.HemisphereLight(sky, ground, intensity);
    this.group.add(l);
    this.lights.push({ light: l, base: intensity });
    return l;
  }

  /** Fake volumetric light shaft: an additive cone that fades with height and view angle. */
  cone(color: number, x: number, y: number, z: number, radius: number, height: number, opacity = 0.16) {
    const geo = new THREE.ConeGeometry(radius, height, 40, 1, true);
    geo.translate(0, -height / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uPower: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying float vH;
        void main() {
          vH = uv.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; uniform float uPower;
        varying vec3 vN; varying vec3 vV; varying float vH;
        void main() {
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          float fall = pow(vH, 1.4) * smoothstep(0.0, 0.12, vH);
          gl_FragColor = vec4(uColor * edge * fall * uOpacity * uPower, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 5;
    this.group.add(m);
    this.cones.push(mat);
    return m;
  }

  /** Drifting dust in a box volume; returns an updater. */
  dust(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, count: number): (t: number) => void {
    const n = Math.max(20, Math.floor(count * this.quality.detail));
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = cx + (Math.random() - 0.5) * sx;
      pos[i * 3 + 1] = cy + (Math.random() - 0.5) * sy;
      pos[i * 3 + 2] = cz + (Math.random() - 0.5) * sz;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPower: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.11 + aSeed) * 0.35;
          p.y += sin(uTime * 0.07 + aSeed * 1.7) * 0.25;
          p.z += cos(uTime * 0.09 + aSeed * 0.6) * 0.35;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(9.0 / -mv.z, 1.0, 2.6);
          vA = (0.25 + 0.75 * fract(aSeed * 7.31)) * smoothstep(0.4, 1.6, -mv.z) * smoothstep(14.0, 6.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uPower; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA * 0.2 * uPower;
          gl_FragColor = vec4(vec3(0.75, 0.86, 1.0) * a, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    this.group.add(pts);
    this.cones.push(mat);
    return (t: number) => (mat.uniforms.uTime.value = t);
  }

  /** Flat emissive screen driven by a 2D canvas. */
  screen(w: number, h: number, x: number, y: number, z: number, rotY: number, pxPerMeter: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, brightness = 1.35): ScreenHandle {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * pxPerMeter);
    canvas.height = Math.round(h * pxPerMeter);
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: brightness, roughness: 0.82, metalness: 0 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    this.group.add(mesh);
    const entry = { mat, base: brightness };
    this.screens.push(entry);
    const handle: ScreenHandle = {
      mesh,
      ctx,
      width: canvas.width,
      height: canvas.height,
      redraw: () => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        draw(ctx, canvas.width, canvas.height);
        tex.needsUpdate = true;
      },
      setBrightness: (v) => {
        entry.base = v;
        mat.emissiveIntensity = v * this.power;
      },
    };
    handle.redraw();
    return handle;
  }

  /** Text / graphics decal on a transparent plane. */
  decal(w: number, h: number, x: number, y: number, z: number, rotY: number, pxPerMeter: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, emissive = 0): { redraw(): void; mesh: THREE.Mesh } {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * pxPerMeter);
    canvas.height = Math.round(h * pxPerMeter);
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    if (emissive > 0) {
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveMap = tex;
      mat.emissiveIntensity = emissive;
      this.screens.push({ mat, base: emissive });
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    const redraw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      draw(ctx, canvas.width, canvas.height);
      tex.needsUpdate = true;
    };
    redraw();
    return { redraw, mesh };
  }

  /** Call every frame: schedules the throttled shadow-map refreshes. */
  updateShadows(time: number) {
    for (const s of this.shadowLights) {
      if (time >= s.next) {
        s.next = time + 1 / 30;
        s.light.shadow.needsUpdate = true;
      }
    }
  }

  /** Register a non-merged emissive material so blackouts affect it too. */
  trackGlow(mat: THREE.MeshStandardMaterial) {
    if (!this.glows.has(mat)) this.glows.set(mat, mat.emissiveIntensity);
  }

  /** Global power factor: 1 = normal, 0 = blackout. Scales lights, strips, screens and shafts. */
  setPower(f: number) {
    this.power = f;
    for (const l of this.lights) l.light.intensity = l.base * f;
    for (const [m, base] of this.glows) m.emissiveIntensity = base * f;
    for (const s of this.screens) s.mat.emissiveIntensity = s.base * f;
    for (const c of this.cones) c.uniforms.uPower.value = f;
  }

  getPower() {
    return this.power;
  }

  /** Merge everything collected so far into one mesh per material. */
  finalize() {
    for (const [mat, b] of this.batches) {
      if (!b.geos.length) continue;
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.batches.clear();
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

/** Font stack used for all in-world canvas text. */
export const FONT = '"Chakra Petch", "Segoe UI", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
