// Standalone test level `vargain`: only the interior of the Auktionshaus Varga,
// closed by a simple stand-in shell, so it can be walked and checked alone.
import * as THREE from 'three';
import { Builder } from '../build';
import { realMat } from '../realmats';
import { registerStrings, t } from '../../core/i18n';
import type { Level, LevelDeps } from '../level';
import { buildVargaInterior, VARGA_FLOOR } from './varga-interior';

registerStrings({ 'vargain.obj': 'Test: walk through the auction house at night' }, { 'vargain.obj': 'Test: Geht nachts durch das Auktionshaus' });

export function createVargaIn(deps: LevelDeps): Level & { interior: ReturnType<typeof buildVargaInterior> } {
  const { engine, physics, mats } = deps;
  const b = new Builder(engine.scene, physics, mats, engine.quality);
  engine.setBloomIntensity(0.55);
  // ground around the building
  b.box(realMat('asphalt_cracked', { size: 4, color: 0x5a5a5a }), 60, 0.2, 50, -8, -0.1, -4, { shadow: false });
  const interior = buildVargaInterior(b, deps, { shell: false });
  // the exterior's ambient (same as varga.ts), so the look matches the combined scene
  b.hemisphere(0x3a465e, 0x1a1510, 1.0);
  b.finalize();
  engine.captureEnvironment(new THREE.Vector3(-12, 1.8, -2), 0.5);
  const F = VARGA_FLOOR;
  const a = interior.anchors['in.liefer'];
  return {
    interior,
    spawn(i) {
      return { pos: new THREE.Vector3(a.x - (i % 2) * 0.6, F, a.z - 0.5 + Math.floor(i / 2)), yaw: a.yaw ?? 0 };
    },
    menuCamera(time, cam) {
      cam.position.set(-9 + Math.sin(time * 0.05) * 1.5, F + 1.65, 0.2);
      cam.lookAt(-17, F + 1.0, -3.5);
    },
    attach() {},
    detach() {},
    update(dt, time) {
      b.updateShadows(time);
      interior.update(dt, time);
    },
    objective() {
      return [t('vargain.obj')];
    },
    redraw() {},
  };
}
