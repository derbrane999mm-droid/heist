// Ready-made props (glTF) from public/assets/models. Preloaded at boot so that
// placing one in a level factory is synchronous and compiles behind the loading screen.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const cache = new Map<string, THREE.Object3D>();

export async function preloadModels(names: string[]) {
  const loader = new GLTFLoader();
  await Promise.all(
    names.map(async (n) => {
      if (cache.has(n)) return;
      try {
        const g = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/models/${n}.glb`);
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        cache.set(n, g.scene);
      } catch (err) {
        console.error(`[models] ${n} failed to load`, err);
      }
    }),
  );
}

/** A fresh copy of a preloaded prop, or null if it is missing. */
export function model(name: string, x: number, y: number, z: number, rotY = 0, scale = 1): THREE.Object3D | null {
  const src = cache.get(name);
  if (!src) return null;
  const o = src.clone(true);
  o.position.set(x, y, z);
  o.rotation.y = rotY;
  o.scale.setScalar(scale);
  return o;
}
