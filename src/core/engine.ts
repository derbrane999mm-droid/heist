// Renderer, post-processing chain, quality presets and the main loop.
import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { settings, type QualityName } from './settings';

export interface QualityPreset {
  name: QualityName;
  maxDpr: number;
  shadows: boolean;
  shadowSize: number;
  ao: boolean;
  aoMode: 'Low' | 'Medium' | 'High';
  aoHalfRes: boolean;
  smaa: boolean;
  lens: boolean;
  /** 0..1 multiplier for particle counts and decorative lights. */
  detail: number;
  envSize: number;
}

export const PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', maxDpr: 0.8, shadows: false, shadowSize: 512, ao: false, aoMode: 'Low', aoHalfRes: true, smaa: false, lens: false, detail: 0.35, envSize: 128 },
  medium: { name: 'medium', maxDpr: 1, shadows: true, shadowSize: 1024, ao: true, aoMode: 'Low', aoHalfRes: true, smaa: true, lens: true, detail: 0.6, envSize: 256 },
  high: { name: 'high', maxDpr: 1.5, shadows: true, shadowSize: 2048, ao: true, aoMode: 'Medium', aoHalfRes: true, smaa: true, lens: true, detail: 1, envSize: 256 },
  ultra: { name: 'ultra', maxDpr: 2, shadows: true, shadowSize: 2048, ao: true, aoMode: 'High', aoHalfRes: false, smaa: true, lens: true, detail: 1, envSize: 512 },
};
const ORDER: QualityName[] = ['low', 'medium', 'high', 'ultra'];

type Updater = (dt: number, time: number) => void;

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer!: EffectComposer;
  quality: QualityPreset = PRESETS.high;
  /** Set when quality was changed automatically (shown as a toast by the UI). */
  onAutoQuality: ((q: QualityName) => void) | null = null;
  onQualityApplied: ((q: QualityPreset) => void) | null = null;
  fps = 60;
  time = 0;

  private updaters: Updater[] = [];
  private lateUpdaters: Updater[] = [];
  private running = false;
  private last = 0;
  private dynScale = 1;
  private frameAcc = 0;
  private frameCount = 0;
  private slowPeriods = 0;
  private fastPeriods = 0;
  private bloom!: BloomEffect;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('webgl2-unavailable');
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post chain
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = true;
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 16 / 9, 0.05, 120);
    this.scene.add(this.camera);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    const initial = settings.get('quality');
    this.quality = PRESETS[initial === 'auto' ? this.guessQuality() : initial];
    this.applyQuality();

    window.addEventListener('resize', () => this.resize());
    settings.onChange((_s, key) => {
      if (key === 'quality') {
        const q = settings.get('quality');
        this.setQuality(q === 'auto' ? this.guessQuality() : q);
      }
      if (key === 'fov') {
        this.camera.fov = settings.get('fov');
        this.camera.updateProjectionMatrix();
      }
    });
  }

  /** Starting point for "auto": conservative for integrated GPUs, adjusted live afterwards. */
  private guessQuality(): QualityName {
    let name = '';
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    } catch {
      /* ignore */
    }
    if (/swiftshader|llvmpipe|software/.test(name)) return 'low';
    if (/rtx|radeon rx|geforce gtx 1[06-9]|geforce gtx [2-9]|arc a|apple m[2-9]|apple m1 (pro|max|ultra)/.test(name)) return 'high';
    if (/intel|uhd|iris|mali|adreno/.test(name)) return 'medium';
    return 'high';
  }

  setQuality(name: QualityName) {
    if (this.quality.name === name) return;
    this.quality = PRESETS[name];
    this.dynScale = 1;
    this.applyQuality();
  }

  private applyQuality() {
    const q = this.quality;
    const hadShadows = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = q.shadows;
    if (hadShadows !== q.shadows) {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
    this.scene.traverse((o) => {
      const l = o as THREE.SpotLight;
      if (l.isLight && l.shadow && l.castShadow && l.userData.fixedShadow !== true) {
        if (l.shadow.mapSize.x !== q.shadowSize) {
          l.shadow.mapSize.set(q.shadowSize, q.shadowSize);
          l.shadow.map?.dispose();
          l.shadow.map = null;
        }
      }
    });
    this.buildComposer();
    this.resize();
    this.onQualityApplied?.(q);
  }

  private buildComposer() {
    this.composer?.dispose();
    const q = this.quality;
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (q.ao) {
      const ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      ao.configuration.aoRadius = 0.85;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.4;
      ao.configuration.halfRes = q.aoHalfRes;
      ao.configuration.depthAwareUpsampling = true;
      ao.setQualityMode(q.aoMode);
      composer.addPass(ao);
    }
    this.bloom = new BloomEffect({
      intensity: 0.85,
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.78,
      levels: 7,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vignette = new VignetteEffect({ darkness: 0.52, offset: 0.28 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    noise.blendMode.opacity.value = 0.09;
    if (q.smaa) {
      composer.addPass(new EffectPass(this.camera, this.bloom, tone, vignette));
      // SMAA and chromatic aberration are both convolutions: each needs its own pass
      composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: q.name === 'ultra' ? SMAAPreset.ULTRA : SMAAPreset.HIGH })));
      if (q.lens) {
        const ca = new ChromaticAberrationEffect({
          offset: new THREE.Vector2(0.0007, 0.0007),
          radialModulation: true,
          modulationOffset: 0.32,
        });
        composer.addPass(new EffectPass(this.camera, ca, noise));
      } else composer.addPass(new EffectPass(this.camera, noise));
    } else {
      composer.addPass(new EffectPass(this.camera, this.bloom, tone, vignette, noise));
    }
    this.composer = composer;
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr) * this.dynScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, true);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  onUpdate(fn: Updater): () => void {
    this.updaters.push(fn);
    return () => (this.updaters = this.updaters.filter((f) => f !== fn));
  }
  onLateUpdate(fn: Updater): () => void {
    this.lateUpdaters.push(fn);
    return () => (this.lateUpdaters = this.lateUpdaters.filter((f) => f !== fn));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop((now: number) => this.frame(now));
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private skipCount = 0;

  private frame(now: number) {
    const rawDt = (now - this.last) / 1000;
    this.last = now;
    // Simulate in steps of at most 1/30 s so slow machines stay in real time
    // (down to 5 fps) and a tab switch cannot make anything tunnel or explode.
    let remaining = Math.min(rawDt, 0.2);
    let steps = 0;
    while (remaining > 1e-5 && steps < 6) {
      const dt = Math.min(remaining, 1 / 30);
      remaining -= dt;
      steps++;
      this.time += dt;
      for (const u of this.updaters) u(dt, this.time);
      for (const u of this.lateUpdaters) u(dt, this.time);
    }
    // test hook: render only every Nth frame to keep software-GL test runs fast
    const skip = (window as any).__nvRenderSkip as number | undefined;
    if (!skip || this.skipCount++ % skip === 0) this.composer.render(Math.min(rawDt, 0.2));
    this.tune(rawDt);
  }

  /** Dynamic resolution: trade pixels for frame rate before anything stutters. */
  private tune(rawDt: number) {
    if (rawDt > 0.25 || document.hidden) return;
    this.frameAcc += rawDt;
    this.frameCount++;
    if (this.frameAcc < 1.5) return;
    const avg = this.frameAcc / this.frameCount;
    this.fps = 1 / avg;
    this.frameAcc = 0;
    this.frameCount = 0;
    if ((window as any).__nvNoTune) return;
    if (avg > 1 / 48) {
      this.fastPeriods = 0;
      this.slowPeriods++;
      if (this.dynScale > 0.62) {
        this.dynScale = Math.max(0.6, this.dynScale - (avg > 1 / 30 ? 0.15 : 0.08));
        this.resize();
      } else if (this.slowPeriods >= 3 && settings.get('quality') === 'auto') {
        const i = ORDER.indexOf(this.quality.name);
        if (i > 0) {
          this.slowPeriods = 0;
          this.setQuality(ORDER[i - 1]);
          this.onAutoQuality?.(ORDER[i - 1]);
        }
      }
    } else if (avg < 1 / 58) {
      this.slowPeriods = 0;
      this.fastPeriods++;
      if (this.fastPeriods >= 3 && this.dynScale < 1) {
        this.dynScale = Math.min(1, this.dynScale + 0.05);
        this.fastPeriods = 0;
        this.resize();
      }
    } else {
      this.slowPeriods = 0;
      this.fastPeriods = 0;
    }
  }

  /**
   * Bake the lit scene around `pos` into the environment map, so glossy surfaces
   * reflect the actual room (light strips, screens) instead of a generic sky.
   */
  captureEnvironment(pos: THREE.Vector3, intensity = 1) {
    const size = this.quality.envSize;
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cubeCam = new THREE.CubeCamera(0.1, 80, rt);
    cubeCam.position.copy(pos);
    const prevEnv = this.scene.environment;
    this.scene.environment = null;
    const shadowAuto = this.renderer.shadowMap.autoUpdate;
    cubeCam.update(this.renderer, this.scene);
    this.renderer.shadowMap.autoUpdate = shadowAuto;
    const env = this.pmrem.fromCubemap(rt.texture);
    rt.dispose();
    this.envTarget?.dispose();
    this.envTarget = env;
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = intensity;
    void prevEnv;
  }

  /** Short-lived boost used for scripted flashes (blackout, power surge). */
  setBloomIntensity(v: number) {
    this.bloom.intensity = v;
  }

  screenshotInfo() {
    return { fps: this.fps, scale: this.dynScale, quality: this.quality.name, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles };
  }
}
