// Remote crew member: stylised tactical suit, procedurally animated,
// interpolated between network snapshots.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FLAG_CROUCH, FLAG_LIGHT, type Pose } from './player';
import { PLAYER_COLORS } from '../core/settings';
import { FONT } from './build';

interface Snap {
  t: number;
  pose: Pose;
}

const INTERP_DELAY = 0.11;

function lerpAngle(a: number, b: number, k: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

const suitMat = new THREE.MeshStandardMaterial({ color: 0x1a1d23, roughness: 0.62, metalness: 0.25 });
const padMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.45, metalness: 0.5 });
const helmetMat = new THREE.MeshStandardMaterial({ color: 0x0d0f13, roughness: 0.18, metalness: 0.85 });

export class Avatar {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private torso: THREE.Mesh;
  private accent: THREE.MeshStandardMaterial;
  private tag: THREE.Sprite;
  private tagCanvas: HTMLCanvasElement;
  private tagTex: THREE.CanvasTexture;
  private light: THREE.SpotLight;
  private snaps: Snap[] = [];
  private walk = 0;
  private speed = 0;
  private crouch = 0;
  private lastPos = new THREE.Vector3();
  private hasPos = false;
  private talking = false;
  private name = '';
  private lightLevel = 0;
  readonly position = new THREE.Vector3();
  /** World position of the head, for proximity voice. */
  readonly headPos = new THREE.Vector3();

  constructor(parent: THREE.Object3D, name: string, colorIndex: number) {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
    this.accent = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 2.6, roughness: 0.4 });

    const limb = (r: number, len: number, mat: THREE.Material) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - r * 2, 6, 14), mat);
      m.position.y = -len / 2;
      m.castShadow = true;
      g.add(m);
      return g;
    };

    // legs pivot at the hips
    this.legL = limb(0.085, 0.88, suitMat);
    this.legR = limb(0.085, 0.88, suitMat);
    this.legL.position.set(-0.11, 0.9, 0);
    this.legR.position.set(0.11, 0.9, 0);
    for (const leg of [this.legL, this.legR]) {
      const boot = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.12, 0.28, 2, 0.04), padMat);
      boot.position.set(0, -0.84, -0.04);
      boot.castShadow = true;
      leg.add(boot);
      const knee = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.16, 0.08, 2, 0.03), padMat);
      knee.position.set(0, -0.44, -0.08);
      leg.add(knee);
    }

    this.torso = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.58, 0.27, 3, 0.09), suitMat);
    this.torso.position.y = 1.19;
    this.torso.castShadow = true;
    const vest = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.36, 0.31, 3, 0.07), padMat);
    vest.position.set(0, 1.25, 0);
    vest.castShadow = true;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.012), this.accent);
    strip.position.set(0, 1.36, -0.158);
    const pack = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.44, 0.16, 3, 0.05), padMat);
    pack.position.set(0, 1.24, 0.2);
    pack.castShadow = true;
    const packLight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.14, 0.012), this.accent);
    packLight.position.set(0.11, 1.3, 0.283);
    const belt = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.09, 0.29, 2, 0.03), padMat);
    belt.position.y = 0.93;

    this.armL = limb(0.068, 0.62, suitMat);
    this.armR = limb(0.068, 0.62, suitMat);
    this.armL.position.set(-0.3, 1.43, 0);
    this.armR.position.set(0.3, 1.43, 0);
    for (const arm of [this.armL, this.armR]) {
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), padMat);
      shoulder.castShadow = true;
      arm.add(shoulder);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), padMat);
      glove.position.y = -0.6;
      arm.add(glove);
    }

    // head: helmet with a glowing visor band in the player's colour
    this.head.position.y = 1.6;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 28, 20), helmetMat);
    helmet.scale.set(1, 1.08, 1.1);
    helmet.castShadow = true;
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.153, 28, 12, Math.PI * 1.18, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.2), this.accent);
    visor.scale.set(1, 1.08, 1.1);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.1, 12), padMat);
    neck.position.y = -0.14;
    this.head.add(helmet, visor, neck);

    this.body.add(this.legL, this.legR, this.torso, vest, strip, pack, packLight, belt, this.armL, this.armR, this.head);
    this.group.add(this.body);

    // flashlight (no shadows: cost stays flat with four players)
    this.light = new THREE.SpotLight(0xdfe9ff, 0, 18, 0.44, 0.5, 1.5);
    this.light.position.set(0, 0, -0.1);
    const lt = new THREE.Object3D();
    lt.position.set(0, 0, -1);
    this.head.add(this.light, lt);
    this.light.target = lt;

    // name tag
    this.tagCanvas = document.createElement('canvas');
    this.tagCanvas.width = 512;
    this.tagCanvas.height = 96;
    this.tagTex = new THREE.CanvasTexture(this.tagCanvas);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, transparent: true, depthWrite: false, fog: false }));
    this.tag.scale.set(1.15, 0.215, 1);
    this.tag.position.y = 2.02;
    this.tag.renderOrder = 10;
    this.group.add(this.tag);
    this.setName(name, colorIndex);

    this.group.visible = false;
    parent.add(this.group);
  }

  setName(name: string, colorIndex: number) {
    this.name = name;
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
    this.accent.emissive.setHex(color);
    this.drawTag();
  }

  setTalking(t: boolean) {
    if (t === this.talking) return;
    this.talking = t;
    this.drawTag();
  }

  private drawTag() {
    const c = this.tagCanvas;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = `600 44px ${FONT}`;
    ctx.textBaseline = 'middle';
    const text = this.name || '…';
    const tw = Math.min(380, ctx.measureText(text).width);
    const iconW = this.talking ? 54 : 0;
    const w = tw + 56 + iconW;
    const x = (c.width - w) / 2;
    ctx.fillStyle = 'rgba(6,9,13,0.72)';
    ctx.beginPath();
    ctx.roundRect(x, 12, w, 72, 14);
    ctx.fill();
    const col = '#' + this.accent.emissive.getHexString();
    ctx.fillStyle = col;
    ctx.fillRect(x, 12, 6, 72);
    ctx.fillStyle = '#eef4f8';
    ctx.fillText(text, x + 28, 50, 380);
    if (this.talking) {
      const ix = x + 28 + tw + 22;
      ctx.fillStyle = col;
      for (let i = 0; i < 3; i++) {
        const h = [20, 38, 26][i];
        ctx.fillRect(ix + i * 12, 48 - h / 2, 7, h);
      }
    }
    this.tagTex.needsUpdate = true;
  }

  push(pose: Pose, now: number) {
    this.snaps.push({ t: now, pose });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  update(dt: number, now: number, time: number) {
    if (!this.snaps.length) return;
    const rt = now - INTERP_DELAY;
    let a = this.snaps[0];
    let b = this.snaps[this.snaps.length - 1];
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].t <= rt) {
        a = this.snaps[i];
        b = this.snaps[Math.min(i + 1, this.snaps.length - 1)];
        break;
      }
    }
    let k = b.t > a.t ? (rt - a.t) / (b.t - a.t) : 1;
    k = Math.max(0, Math.min(1.25, k));
    const pa = a.pose;
    const pb = b.pose;
    const x = pa.x + (pb.x - pa.x) * k;
    const y = pa.y + (pb.y - pa.y) * k;
    const z = pa.z + (pb.z - pa.z) * k;
    const yaw = lerpAngle(pa.yaw, pb.yaw, Math.min(1, k));
    const pitch = pa.pitch + (pb.pitch - pa.pitch) * Math.min(1, k);

    this.group.visible = true;
    this.group.position.set(x, y, z);
    this.position.set(x, y, z);
    this.body.rotation.y = lerpAngle(this.body.rotation.y, yaw, 1 - Math.exp(-14 * dt));

    if (this.hasPos && dt > 0) {
      const v = Math.hypot(x - this.lastPos.x, z - this.lastPos.z) / dt;
      this.speed += (Math.min(v, 7) - this.speed) * (1 - Math.exp(-10 * dt));
    }
    this.lastPos.set(x, y, z);
    this.hasPos = true;

    const crouching = (pb.flags & FLAG_CROUCH) !== 0;
    this.crouch += ((crouching ? 1 : 0) - this.crouch) * (1 - Math.exp(-10 * dt));

    // procedural walk cycle
    this.walk += this.speed * dt * 2.3;
    const amp = Math.min(1, this.speed / 3.5);
    const swing = Math.sin(this.walk) * 0.62 * amp;
    const bend = this.crouch * 1.05;
    this.legL.rotation.x = swing - bend;
    this.legR.rotation.x = -swing - bend * 0.55;
    this.armL.rotation.x = -swing * 0.7 + Math.sin(time * 1.3) * 0.025;
    this.armR.rotation.x = swing * 0.7 - Math.sin(time * 1.3) * 0.025;
    this.armL.rotation.z = -0.07;
    this.armR.rotation.z = 0.07;
    const bob = Math.abs(Math.sin(this.walk)) * 0.035 * amp + Math.sin(time * 1.6) * 0.004;
    this.body.position.y = bob - this.crouch * 0.52;
    this.legL.position.y = 0.9 + this.crouch * 0.26;
    this.legR.position.y = 0.9 + this.crouch * 0.26;
    this.legL.scale.y = 1 - this.crouch * 0.38;
    this.legR.scale.y = 1 - this.crouch * 0.38;
    this.torso.rotation.x = this.crouch * 0.28 + amp * 0.06;
    this.head.rotation.x = pitch * 0.85;
    this.tag.position.y = 2.02 - this.crouch * 0.52;

    this.head.getWorldPosition(this.headPos);

    const lit = (pb.flags & FLAG_LIGHT) !== 0;
    this.lightLevel += ((lit ? 1 : 0) - this.lightLevel) * (1 - Math.exp(-30 * dt));
    this.light.intensity = 40 * this.lightLevel;
  }

  dispose() {
    this.group.removeFromParent();
    this.tagTex.dispose();
    this.accent.dispose();
  }
}
