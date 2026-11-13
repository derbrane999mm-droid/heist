import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type Collider = RAPIER.Collider;

let initPromise: Promise<void> | null = null;

/** Static-world collision + a kinematic character controller, backed by Rapier. */
export class Physics {
  world!: RAPIER.World;

  static async create(): Promise<Physics> {
    initPromise ??= RAPIER.init();
    await initPromise;
    const p = new Physics();
    p.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    return p;
  }

  /** Axis-aligned (optionally yaw-rotated) static box. Sizes are full extents. */
  addBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0): Collider {
    const d = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(cx, cy, cz);
    if (rotY) d.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    return this.world.createCollider(d);
  }

  addCylinder(cx: number, cy: number, cz: number, radius: number, height: number): Collider {
    const d = RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(cx, cy, cz);
    return this.world.createCollider(d);
  }

  remove(c: Collider) {
    this.world.removeCollider(c, false);
  }

  setEnabled(c: Collider, enabled: boolean) {
    c.setEnabled(enabled);
  }

  step() {
    this.world.step();
  }

  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  /** Distance to the first solid surface along a ray, or null if nothing is hit. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: Collider): number | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRay(this.ray, maxDist, true, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : null;
  }

  createCharacter(radius: number, height: number, pos: THREE.Vector3): CharacterBody {
    return new CharacterBody(this, radius, height, pos);
  }
}

/** Capsule character moved with Rapier's kinematic character controller. */
export class CharacterBody {
  private body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  grounded = false;
  height: number;
  /** Feet position (bottom of the capsule). */
  readonly position = new THREE.Vector3();

  constructor(
    private physics: Physics,
    readonly radius: number,
    height: number,
    pos: THREE.Vector3,
  ) {
    this.height = height;
    const w = physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + height / 2, pos.z),
    );
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(height / 2 - radius, radius), this.body);
    this.controller = w.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.32, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    this.controller.setSlideEnabled(true);
    this.position.copy(pos);
  }

  private moved = new THREE.Vector3();

  /**
   * Try to move by `delta`; returns the movement that was actually possible
   * (a shared vector: copy it if you need to keep it).
   */
  move(delta: THREE.Vector3): THREE.Vector3 {
    this.controller.computeColliderMovement(this.collider, delta);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    const nx = t.x + m.x;
    const ny = t.y + m.y;
    const nz = t.z + m.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.position.set(nx, ny - this.height / 2, nz);
    return this.moved.set(m.x, m.y, m.z);
  }

  teleport(pos: THREE.Vector3) {
    this.body.setTranslation({ x: pos.x, y: pos.y + this.height / 2, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + this.height / 2, z: pos.z });
    this.position.copy(pos);
  }

  /** Change capsule height keeping the feet planted (crouch / stand). */
  setHeight(h: number) {
    if (Math.abs(h - this.height) < 1e-4) return;
    const feetY = this.position.y;
    this.height = h;
    this.collider.setShape(new RAPIER.Capsule(h / 2 - this.radius, this.radius));
    const t = this.body.translation();
    const p = { x: t.x, y: feetY + h / 2, z: t.z };
    this.body.setTranslation(p, true);
    this.body.setNextKinematicTranslation(p);
  }

  /** True if there is headroom to stand up to `h`. */
  canStand(h: number): boolean {
    const origin = new THREE.Vector3(this.position.x, this.position.y + this.height - this.radius, this.position.z);
    const d = this.physics.raycast(origin, new THREE.Vector3(0, 1, 0), h - this.height + this.radius + 0.05, this.collider);
    return d === null;
  }

  dispose() {
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
  }
}
