// First-person hands: gloved hands, jacket sleeves and the flashlight.
//
// The hand meshes are the MIT-licensed generic WebXR hands. Their bones come as a
// flat list in model space, so on load they are chained (wrist -> finger joints)
// and the whole hand is re-based so that the rig's origin is the wrist with
// fingers along -Z, back of the hand +Y (thumb at -X on the right hand).
//
// Everything here is created at boot: no light, material or mesh appears later.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Engine } from '../core/engine';
import type { Physics } from '../core/physics';
import type { Player } from './player';
import type { Interactions } from './interact';

const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'] as const;
/** Flexion per joint (radians) at curl = 1, from the knuckle outwards. */
const FLEX_FINGER = [1.45, 1.7, 1.0];
const FLEX_THUMB = [0.45, 0.6, 0.9];

type V3 = [number, number, number];
type Curl = [number, number, number, number, number];

/** Tunable pose data (camera space, metres). `__nv.viewmodel.tune({...})` changes it live. */
export const VM = {
  // right hand: tactical grip (lens at the little-finger side, thumb on the tail
  // cap), fist beside the cheek, forearm coming up from below
  rPos: [0.3, -0.235, -0.42] as V3,
  rBack: [0.966, 0.26, 0] as V3, // direction the back of the hand faces
  rArm: [0.24, -0.9, 0.3] as V3, // wrist -> elbow
  rCurl: [0.55, 0.9, 0.92, 0.94, 0.96] as Curl,
  toolPos: [0.02, -0.03, -0.072] as V3, // flashlight centre in the hand frame
  // left hand: hidden at rest, reaches forward to press / hold things
  lRest: [-0.26, -0.56, -0.2] as V3,
  lReach: [-0.13, -0.2, -0.43] as V3,
  lRun: [-0.24, -0.33, -0.34] as V3,
  lBack: [-0.3, 0.9, 0.3] as V3,
  lArm: [-0.36, -0.46, 0.81] as V3,
  lCurlPress: [0.45, 0.02, 0.82, 0.9, 0.95] as Curl,
  lCurlHold: [0.2, 0.12, 0.14, 0.18, 0.24] as Curl,
  lCurlFist: [0.5, 0.8, 0.85, 0.9, 0.92] as Curl,
  fill: 0.4,
  flexSign: -1,
  thumbSign: -1,
};

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Orientation of a hand from "where the back faces" and "where the forearm goes". */
function basisQuat(out: THREE.Quaternion, back: V3, arm: V3) {
  _z.set(arm[0], arm[1], arm[2]).normalize();
  _y.set(back[0], back[1], back[2]);
  _x.crossVectors(_y, _z).normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

class HandRig {
  readonly group = new THREE.Group();
  private inner = new THREE.Group();
  private chains: { joint: THREE.Object3D; rest: THREE.Quaternion }[][] = [];
  readonly curl: Curl = [0, 0, 0, 0, 0];
  mesh: THREE.SkinnedMesh | null = null;

  constructor(
    readonly side: 'left' | 'right',
    private glove: THREE.Material,
    sleeve: THREE.Material,
    cuff: THREE.Material,
  ) {
    this.group.add(this.inner);
    // glove cuff, jacket cuff and sleeve run from the wrist towards the elbow (+Z)
    const seg = (mat: THREE.Material, r0: number, r1: number, z0: number, z1: number, wide: number, flat: number) => {
      const geo = new THREE.CylinderGeometry(r1, r0, z1 - z0, 22, 1, true);
      geo.rotateX(Math.PI / 2);
      geo.translate(0, 0, (z0 + z1) / 2);
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(wide, flat, 1);
      m.castShadow = false;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    seg(glove, 0.0285, 0.031, 0.004, 0.075, 1.14, 0.84);
    seg(cuff, 0.0345, 0.0355, 0.042, 0.082, 1.1, 0.9);
    seg(sleeve, 0.0365, 0.052, 0.078, 0.46, 1.08, 0.94);
  }

  setModel(scene: THREE.Object3D) {
    const arm = scene.getObjectByName('Armature') ?? scene;
    this.inner.add(arm);
    const wrist = arm.getObjectByName('wrist');
    if (!wrist) return;
    // re-base: wrist at the origin, wrist axes = rig axes
    _q.copy(wrist.quaternion).invert();
    this.inner.quaternion.copy(_q);
    this.inner.position.copy(wrist.position).applyQuaternion(_q).negate();
    this.group.updateMatrixWorld(true);
    // chain the flat bone list so a finger curls as a whole
    for (const f of FINGERS) {
      const names =
        f === 'thumb'
          ? ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
          : [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`];
      let parent: THREE.Object3D = wrist;
      const bones: THREE.Object3D[] = [];
      for (const n of names) {
        const b = arm.getObjectByName(n);
        if (!b) continue;
        parent.attach(b);
        parent = b;
        bones.push(b);
      }
      const flexed = f === 'thumb' ? bones.slice(0, 3) : bones.slice(1, 4);
      this.chains.push(flexed.map((joint) => ({ joint, rest: joint.quaternion.clone() })));
    }
    arm.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) {
        sm.material = this.glove;
        sm.frustumCulled = false;
        sm.castShadow = false;
        sm.receiveShadow = false;
        this.mesh = sm;
      }
    });
    this.applyCurl();
  }

  applyCurl() {
    for (let f = 0; f < this.chains.length; f++) {
      const chain = this.chains[f];
      const flex = f === 0 ? FLEX_THUMB : FLEX_FINGER;
      const sign = f === 0 ? VM.thumbSign : VM.flexSign;
      for (let j = 0; j < chain.length; j++) {
        _q.setFromAxisAngle(X_AXIS, sign * flex[j] * this.curl[f]);
        chain[j].joint.quaternion.copy(chain[j].rest).multiply(_q);
      }
    }
  }

  setCurl(c: readonly number[]) {
    let changed = false;
    for (let i = 0; i < 5; i++) {
      if (Math.abs(this.curl[i] - c[i]) > 1e-4) {
        this.curl[i] = c[i];
        changed = true;
      }
    }
    if (changed) this.applyCurl();
  }
}

function makeFlashlight(body: THREE.Material, lens: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  // profile (radius, position along the torch): tail cap -> body -> head -> bezel
  const pts = [
    [0.0, 0.078],
    [0.0118, 0.078],
    [0.0132, 0.074],
    [0.0132, 0.058],
    [0.0122, 0.055],
    [0.0122, -0.03],
    [0.0135, -0.034],
    [0.0185, -0.05],
    [0.0195, -0.054],
    [0.0195, -0.078],
    [0.0178, -0.081],
    [0.0165, -0.081],
    [0.0165, -0.076],
  ].map(([r, z]) => new THREE.Vector2(r, -z));
  const geo = new THREE.LatheGeometry(pts, 28);
  geo.rotateX(-Math.PI / 2); // lathe axis (+Y, the head) -> -Z is the lens end
  geo.computeVertexNormals();
  const tube = new THREE.Mesh(geo, body);
  tube.castShadow = false;
  tube.frustumCulled = false;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.0165, 24), lens);
  glass.rotation.y = Math.PI;
  glass.position.z = -0.0765;
  glass.frustumCulled = false;
  g.add(tube, glass);
  return g;
}

export class Viewmodel {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  readonly params = VM;
  /** Test hook: force animation amounts (0..1). */
  force: { reach?: number; hold?: number; sprint?: number; retract?: number } = {};

  private right: HandRig;
  private left: HandRig;
  private tool: THREE.Group;
  private lensMat: THREE.MeshStandardMaterial;
  private fill: THREE.PointLight;
  private target: THREE.Object3D;

  private t = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private retract = 0;
  private sprint = 0;
  private reach = 0;
  private hold = 0;
  private reachT = 0;
  private lastUse = 0;
  private qR = new THREE.Quaternion();
  private qL = new THREE.Quaternion();
  private pL = new THREE.Vector3();
  private curlL: Curl = [0, 0, 0, 0, 0];

  constructor(
    private engine: Engine,
    private flashlight: THREE.SpotLight,
  ) {
    const glove = new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 0.46, metalness: 0.0 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x262d37, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
    const cuff = new THREE.MeshStandardMaterial({ color: 0x1c2129, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide });
    const metal = new THREE.MeshStandardMaterial({ color: 0x34363b, roughness: 0.3, metalness: 0.9 });
    this.lensMat = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.1, metalness: 0.2, emissive: 0xeaf1ff, emissiveIntensity: 0 });

    this.right = new HandRig('right', glove, sleeve, cuff);
    this.left = new HandRig('left', glove, sleeve, cuff);
    this.tool = makeFlashlight(metal, this.lensMat);
    this.right.group.add(this.tool);
    this.root.add(this.right.group, this.left.group);
    engine.camera.add(this.root);

    // a faint near-field fill so dark gloves still read in a dark room
    this.fill = new THREE.PointLight(0xc9d6ee, 0, 0.95, 2);
    this.fill.position.set(0.05, 0.12, 0.02);
    engine.camera.add(this.fill);

    // the beam leaves the torch lens and lands on the crosshair
    this.target = flashlight.target;
    this.target.position.set(0, -0.02, -8);

    const loader = new GLTFLoader();
    const base = import.meta.env.BASE_URL;
    this.ready = Promise.all([
      loader.loadAsync(`${base}assets/models/hand-right.glb`).then((g) => this.right.setModel(g.scene)),
      loader.loadAsync(`${base}assets/models/hand-left.glb`).then((g) => this.left.setModel(g.scene)),
    ]).then(
      () => undefined,
      (err) => console.error('[viewmodel] hand models failed to load', err),
    );
    this.pose(0, null, 0, 0, 0);
  }

  tune(p: Partial<typeof VM>) {
    Object.assign(VM, p);
    this.right.applyCurl();
    this.left.applyCurl();
  }

  setVisible(v: boolean) {
    this.root.visible = v;
    if (!v) this.fill.intensity = 0;
  }

  update(dt: number, p: Player, inter: Interactions, physics: Physics) {
    this.t += dt;
    const k = (rate: number) => 1 - Math.exp(-rate * dt);

    // look sway: the hands lag a little behind the view
    let dyaw = p.yaw - this.lastYaw;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dpitch = p.pitch - this.lastPitch;
    this.lastYaw = p.yaw;
    this.lastPitch = p.pitch;
    const inv = 1 / Math.max(dt, 1e-3);
    this.swayYaw += (THREE.MathUtils.clamp(dyaw * inv, -5, 5) * 0.011 - this.swayYaw) * k(9);
    this.swayPitch += (THREE.MathUtils.clamp(dpitch * inv, -5, 5) * 0.011 - this.swayPitch) * k(9);

    // tuck the torch in when a wall is right in front of the face
    const d = physics.raycast(p.eye, p.forward, 1.0, p.body.collider);
    const wantRetract = this.force.retract ?? (d === null ? 0 : THREE.MathUtils.clamp((0.85 - d) / 0.45, 0, 1));
    this.retract += (wantRetract - this.retract) * k(10);

    const wantSprint = this.force.sprint ?? (p.sprinting && p.bobAmt > 0.45 ? 1 : 0);
    this.sprint += (wantSprint - this.sprint) * k(7);

    if (inter.useCount !== this.lastUse) {
      this.lastUse = inter.useCount;
      this.reachT = 0.36;
    }
    this.reachT = Math.max(0, this.reachT - dt);
    const holding = this.force.hold ?? (inter.holding ? 1 : 0);
    const wantReach = this.force.reach ?? (holding > 0 || this.reachT > 0 ? 1 : 0);
    this.reach += (wantReach - this.reach) * k(wantReach ? 17 : 8);
    this.hold += (holding - this.hold) * k(10);

    this.pose(p.lightLevel, p, this.reach, this.hold, this.sprint);
    this.lensMat.emissiveIntensity = 7 * p.lightLevel;
    this.fill.intensity = VM.fill;
  }

  private pose(lit: number, p: Player | null, reach: number, hold: number, sprint: number) {
    const bob = p ? p.bobAmt : 0;
    const ph = p ? p.bobPhase : 0;
    const dip = p ? p.dip : 0;
    const breathe = Math.sin(this.t * 1.25);
    const bobY = Math.sin(ph * 2) * (0.011 + 0.012 * sprint) * bob;
    const bobX = Math.cos(ph) * (0.008 + 0.012 * sprint) * bob;
    const low = 1 - lit;

    // ---- right hand + torch
    const R = this.right;
    basisQuat(this.qR, VM.rBack, VM.rArm);
    _e.set(
      this.swayPitch * 0.9 + this.retract * 0.5 - low * 0.32 - sprint * 0.38 + breathe * 0.006,
      this.swayYaw * 0.9 + sprint * 0.3 + low * 0.1,
      -this.swayYaw * 0.5 + Math.cos(ph) * 0.03 * bob,
    );
    _q2.setFromEuler(_e);
    R.group.quaternion.copy(_q2).multiply(this.qR);
    R.group.position.set(
      VM.rPos[0] + bobX - this.swayYaw * 0.35 + sprint * 0.03,
      VM.rPos[1] + bobY - dip * 0.5 + breathe * 0.0022 - low * 0.075 - this.retract * 0.05 - sprint * 0.07 + this.swayPitch * 0.25,
      VM.rPos[2] + this.retract * 0.2 + low * 0.03 + Math.sin(ph) * 0.03 * sprint * bob,
    );
    R.setCurl(VM.rCurl);

    // torch lies diagonally across the palm, lens towards the thumb side and forwards
    const tool = this.tool;
    tool.position.set(VM.toolPos[0], VM.toolPos[1], VM.toolPos[2]);
    // camera-forward expressed in the (un-swayed) hand frame = the torch axis
    _q.copy(this.qR).invert();
    tool.quaternion.copy(_q); // torch keeps the camera's orientation inside the hand

    // beam origin = lens, in camera space (the light itself stays a camera child)
    R.group.updateMatrix();
    tool.updateMatrix();
    _v.set(0, 0, -0.085).applyMatrix4(tool.matrix).applyMatrix4(R.group.matrix);
    this.flashlight.position.copy(_v);
    this.target.position.set(-this.swayYaw * 2.2, -0.02 + this.swayPitch * 2.2 + this.retract * 1.2, -8);

    // ---- left hand
    const L = this.left;
    const run = sprint * (1 - reach);
    basisQuat(this.qL, VM.lBack, VM.lArm);
    _e.set(this.swayPitch * 0.8 - run * 0.5 + hold * 0.25, this.swayYaw * 0.8 - run * 0.2, this.swayYaw * 0.4 + run * 0.5);
    _q2.setFromEuler(_e);
    L.group.quaternion.copy(_q2).multiply(this.qL);
    this.pL.set(VM.lRest[0], VM.lRest[1], VM.lRest[2]);
    _v.set(VM.lRun[0] - bobX, VM.lRun[1] + bobY * 1.4, VM.lRun[2] - Math.sin(ph) * 0.05 * bob);
    this.pL.lerp(_v, run);
    const ease = reach * reach * (3 - 2 * reach);
    _v.set(VM.lReach[0] - this.swayYaw * 0.3, VM.lReach[1] + breathe * 0.002 + this.swayPitch * 0.2, VM.lReach[2] - 0.04 * Math.sin(Math.min(1, reach) * Math.PI) + hold * 0.02);
    this.pL.lerp(_v, ease);
    L.group.position.copy(this.pL);
    for (let i = 0; i < 5; i++) {
      const pressed = VM.lCurlPress[i] + (VM.lCurlHold[i] - VM.lCurlPress[i]) * hold;
      this.curlL[i] = VM.lCurlFist[i] + (pressed - VM.lCurlFist[i]) * ease;
    }
    L.setCurl(this.curlL);
    L.group.visible = ease > 0.01 || run > 0.01;
  }
}
