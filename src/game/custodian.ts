// The Custodian: a decommissioned maintenance android that came with the
// building. It never moves while anyone is looking at it.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Physics, Collider } from '../core/physics';

function wrap(a: number) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export class Custodian {
  readonly group = new THREE.Group();
  private head = new THREE.Group();
  private chest = new THREE.Group();
  private eyeMat: THREE.MeshStandardMaterial;
  private headYaw = 0;
  private headPitch = 0.42;
  private unseenFor = 0;
  private eyeGlow = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  /** When true the head follows the local player whenever it is not being watched. */
  awake = false;
  bodyYaw = 0;

  constructor(parent: THREE.Object3D) {
    const shell = new THREE.MeshStandardMaterial({ color: 0xc9cdd0, roughness: 0.46, metalness: 0.08 });
    const joint = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.7 });
    const glassy = new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.06, metalness: 0.9, envMapIntensity: 1.6 });
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff7a2a, emissiveIntensity: 0 });

    const add = (parentObj: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parentObj.add(m);
      return m;
    };

    // legs: long and thin, slightly apart
    for (const s of [-1, 1]) {
      add(this.group, new THREE.CapsuleGeometry(0.062, 0.46, 6, 14), shell, s * 0.12, 0.82, 0.01);
      add(this.group, new THREE.SphereGeometry(0.072, 14, 10), joint, s * 0.12, 0.54, 0);
      add(this.group, new THREE.CapsuleGeometry(0.052, 0.42, 6, 14), shell, s * 0.12, 0.28, 0.0);
      add(this.group, new RoundedBoxGeometry(0.13, 0.07, 0.3, 2, 0.03), joint, s * 0.12, 0.035, -0.05);
    }
    add(this.group, new RoundedBoxGeometry(0.36, 0.16, 0.2, 3, 0.06), joint, 0, 1.13, 0);

    // torso leans forward a little: reads as "slumped", then as "leaning in"
    this.chest.position.set(0, 1.2, 0);
    this.chest.rotation.x = -0.1;
    this.group.add(this.chest);
    add(this.chest, new THREE.CylinderGeometry(0.075, 0.1, 0.2, 14), joint, 0, 0.1, 0);
    const rib = add(this.chest, new THREE.CapsuleGeometry(0.2, 0.34, 8, 20), shell, 0, 0.44, 0);
    rib.scale.set(1.08, 1, 0.74);
    add(this.chest, new THREE.CylinderGeometry(0.07, 0.07, 0.02, 20).rotateX(Math.PI / 2), glassy, 0, 0.5, -0.15);
    for (const s of [-1, 1]) {
      add(this.chest, new THREE.SphereGeometry(0.095, 16, 12), joint, s * 0.3, 0.66, 0);
      // arms hang past the knees
      const upper = add(this.chest, new THREE.CapsuleGeometry(0.05, 0.4, 6, 12), shell, s * 0.33, 0.38, 0);
      upper.rotation.z = s * 0.05;
      add(this.chest, new THREE.SphereGeometry(0.058, 12, 10), joint, s * 0.345, 0.11, 0);
      const lower = add(this.chest, new THREE.CapsuleGeometry(0.042, 0.44, 6, 12), shell, s * 0.35, -0.17, -0.03);
      lower.rotation.x = 0.12;
      const hand = add(this.chest, new THREE.SphereGeometry(0.055, 12, 10), joint, s * 0.355, -0.47, -0.07);
      hand.scale.set(0.8, 1.3, 0.55);
      for (let f = 0; f < 3; f++) {
        const finger = add(this.chest, new THREE.CapsuleGeometry(0.012, 0.13, 4, 8), shell, s * 0.355 + (f - 1) * 0.026, -0.6, -0.085);
        finger.rotation.x = 0.18;
      }
    }
    add(this.chest, new THREE.CylinderGeometry(0.036, 0.045, 0.16, 12), joint, 0, 0.8, 0);

    // head: smooth shell with a black glass face
    this.head.position.set(0, 0.95, 0);
    this.chest.add(this.head);
    const skull = add(this.head, new THREE.SphereGeometry(0.15, 32, 24), shell, 0, 0, 0);
    skull.scale.set(0.9, 1.2, 1.02);
    const face = add(this.head, new THREE.SphereGeometry(0.152, 32, 20, Math.PI * 1.2, Math.PI * 0.6, Math.PI * 0.26, Math.PI * 0.46), glassy, 0, 0, 0);
    face.scale.set(0.9, 1.2, 1.02);
    face.castShadow = false;
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), this.eyeMat);
      eye.position.set(s * 0.045, 0.02, -0.152);
      this.head.add(eye);
    }
    this.head.rotation.x = -this.headPitch;
    parent.add(this.group);
  }

  place(x: number, z: number, yaw: number) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
    this.bodyYaw = yaw;
  }

  /** Wake it: head comes up. */
  setAwake(awake: boolean) {
    this.awake = awake;
    if (awake) {
      this.headPitch = 0;
      this.head.rotation.x = 0;
      this.chest.rotation.x = -0.16;
    }
  }

  flashEyes() {
    this.eyeGlow = 1;
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.head.getWorldPosition(out);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, physics: Physics, playerCollider: Collider | undefined) {
    if (this.eyeGlow > 0) {
      this.eyeGlow = Math.max(0, this.eyeGlow - dt / 2.6);
      // two uneven pulses, then nothing
      const p = this.eyeGlow;
      this.eyeMat.emissiveIntensity = 9 * p * p * (0.6 + 0.4 * Math.sin(p * 40));
    }
    if (!this.awake) return;
    const head = this.headWorld(this.tmp);
    const eye = camera.getWorldPosition(this.tmp2);
    const dist = head.distanceTo(eye);

    // is the local player looking at it?
    let seen = false;
    const ndc = head.clone().project(camera);
    if (ndc.z < 1 && Math.abs(ndc.x) < 1.12 && Math.abs(ndc.y) < 1.15) {
      const dir = head.clone().sub(eye).normalize();
      const hit = physics.raycast(eye, dir, dist, playerCollider);
      seen = hit === null || hit > dist - 0.7;
    }
    if (seen) {
      this.unseenFor = 0;
      return; // frozen
    }
    this.unseenFor += dt;
    if (this.unseenFor < 0.35 || dist > 11) return;

    const dx = eye.x - head.x;
    const dz = eye.z - head.z;
    const want = wrap(Math.atan2(-dx, -dz) - this.bodyYaw);
    const clamped = Math.max(-1.35, Math.min(1.35, want));
    const step = 3.2 * dt;
    const d = wrap(clamped - this.headYaw);
    this.headYaw += Math.max(-step, Math.min(step, d));
    const wantPitch = Math.max(-0.5, Math.min(0.5, Math.atan2(eye.y - head.y, Math.hypot(dx, dz))));
    this.headPitch += Math.max(-step, Math.min(step, -wantPitch - this.headPitch));
    this.head.rotation.set(-this.headPitch, this.headYaw, 0, 'YXZ');
  }
}
