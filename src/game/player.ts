// Local first-person controller: look, walk, sprint, jump, crouch, flashlight.
import * as THREE from 'three';
import type { Engine } from '../core/engine';
import type { Physics, CharacterBody } from '../core/physics';
import type { Input } from '../core/input';
import type { AudioEngine } from '../core/audio';
import { settings } from '../core/settings';

const STAND_H = 1.78;
const CROUCH_H = 1.1;
const RADIUS = 0.32;
const EYE_STAND = 1.64;
const EYE_CROUCH = 0.98;
const WALK = 3.5;
const SPRINT = 5.9;
const CROUCH = 1.7;
const GRAVITY = 22;
const JUMP_V = 6.3;

export const FLAG_CROUCH = 1;
export const FLAG_LIGHT = 2;
export const FLAG_MOVING = 4;

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
}

export class Player {
  body: CharacterBody;
  yaw = 0;
  pitch = 0;
  crouching = false;
  flashlightOn = false;
  /** Scripted override: when > 0 the flashlight is forced dark (power surge). */
  flashlightGlitch = 0;
  /** When false the player cannot move or look (menus, cutscenes). */
  control = true;
  readonly eye = new THREE.Vector3();
  readonly forward = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private vy = 0;
  private eyeH = EYE_STAND;
  private bobPhase = 0;
  private lastStep = 0;
  private airTime = 0;
  private dip = 0;
  private roll = 0;
  private fovKick = 0;
  private lightTarget = 0;
  private wasGrounded = true;

  private want = new THREE.Vector3();
  private bobAmt = 0;

  constructor(
    private engine: Engine,
    physics: Physics,
    private input: Input,
    private audio: AudioEngine,
    spawn: THREE.Vector3,
    yaw: number,
    /** Created once at boot so the number of lights in the scene never changes. */
    private flashlight: THREE.SpotLight,
  ) {
    this.body = physics.createCharacter(RADIUS, STAND_H, spawn);
    this.yaw = yaw;
    engine.camera.rotation.order = 'YXZ';
    this.flashlight.intensity = 0;
  }

  /** The local flashlight: lives on the camera for the whole session. */
  static createFlashlight(engine: Engine): THREE.SpotLight {
    const light = new THREE.SpotLight(0xdfe9ff, 0, 24, 0.44, 0.5, 1.5);
    light.position.set(0.18, -0.16, 0.05);
    const target = new THREE.Object3D();
    target.position.set(0.02, -0.02, -1);
    engine.camera.add(light, target);
    light.target = target;
    light.userData.fixedShadow = true;
    const on = engine.quality.shadows && engine.quality.name !== 'medium';
    light.castShadow = on;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.near = 0.2;
    light.shadow.camera.far = 24;
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = 0.04;
    light.shadow.autoUpdate = false;
    return light;
  }

  teleport(pos: THREE.Vector3, yaw?: number) {
    this.body.teleport(pos);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    if (yaw !== undefined) this.yaw = yaw;
    this.pitch = 0;
  }

  get position(): THREE.Vector3 {
    return this.body.position;
  }

  pose(): Pose {
    const p = this.body.position;
    let flags = 0;
    if (this.crouching) flags |= FLAG_CROUCH;
    if (this.flashlightOn && this.flashlightGlitch <= 0) flags |= FLAG_LIGHT;
    if (this.vel.lengthSq() > 0.3) flags |= FLAG_MOVING;
    return { x: p.x, y: p.y, z: p.z, yaw: this.yaw, pitch: this.pitch, flags };
  }

  update(dt: number) {
    const input = this.input;
    const active = this.control && input.enabled;

    // --- look
    const [mx, my] = input.consumeMouse();
    if (active && input.locked) {
      const s = 0.0021 * settings.get('sensitivity');
      this.yaw -= mx * s;
      this.pitch -= my * s * (settings.get('invertY') ? -1 : 1);
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    }

    // --- crouch
    const wantCrouch = active && input.held('crouch');
    if (wantCrouch && !this.crouching) {
      this.crouching = true;
      this.body.setHeight(CROUCH_H);
    } else if (!wantCrouch && this.crouching && this.body.canStand(STAND_H)) {
      this.crouching = false;
      this.body.setHeight(STAND_H);
    }

    // --- wish direction
    let fx = 0;
    let fz = 0;
    if (active) {
      if (input.held('forward')) fz -= 1;
      if (input.held('back')) fz += 1;
      if (input.held('left')) fx -= 1;
      if (input.held('right')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) {
      fx /= len;
      fz /= len;
    }
    const sprinting = active && input.held('sprint') && fz < 0 && !this.crouching;
    const speed = this.crouching ? CROUCH : sprinting ? SPRINT : WALK;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const tx = (fx * cos + fz * sin) * speed;
    const tz = (-fx * sin + fz * cos) * speed;

    const grounded = this.body.grounded;
    const accel = grounded ? (len > 0 ? 11 : 14) : 2.2;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;

    // --- vertical
    // On the ground there is no downward push at all: pressing the capsule into
    // the floor makes the character controller drop horizontal movement on some
    // frames (stutter). Snap-to-ground keeps the feet planted on slopes instead.
    if (grounded) {
      this.airTime = 0;
      if (this.vy < 0) this.vy = 0;
    } else {
      this.airTime += dt;
    }
    if (active && input.justPressed('jump') && this.airTime < 0.12 && !this.crouching && this.vy <= 0.01) {
      this.vy = JUMP_V;
      this.airTime = 1;
    }
    let dy = 0;
    if (!grounded || this.vy > 0) {
      this.vy = Math.max(-40, this.vy - GRAVITY * dt);
      dy = this.vy * dt;
    }
    const fallSpeed = this.vy;

    const want = this.want.set(this.vel.x * dt, dy, this.vel.z * dt);
    const moved = this.body.move(want);
    if (this.vy > 0 && moved.y < want.y * 0.5) this.vy = 0; // bumped the ceiling

    const nowGrounded = this.body.grounded;
    if (nowGrounded && !this.wasGrounded && fallSpeed < -5) {
      this.audio.play('land', { vol: Math.min(1, -fallSpeed / 12) });
      this.dip = Math.min(0.16, -fallSpeed * 0.012);
    }
    this.wasGrounded = nowGrounded;

    // --- head bob + footsteps
    const hSpeed = Math.hypot(moved.x, moved.z) / Math.max(dt, 1e-4);
    if (nowGrounded && hSpeed > 0.4) {
      this.bobPhase += hSpeed * dt * (this.crouching ? 2.6 : 1.75);
      const step = Math.floor(this.bobPhase / Math.PI);
      if (step !== this.lastStep) {
        this.lastStep = step;
        this.audio.play('step', { vol: this.crouching ? 0.35 : sprinting ? 1.25 : 0.8 });
      }
    }
    // eased, so starting, stopping and landing never pop the camera
    this.bobAmt += (Math.min(1, hSpeed / SPRINT) * (nowGrounded ? 1 : 0) - this.bobAmt) * (1 - Math.exp(-10 * dt));
    const bobY = Math.sin(this.bobPhase * 2) * 0.03 * this.bobAmt;
    const bobX = Math.cos(this.bobPhase) * 0.018 * this.bobAmt;

    // --- camera
    const eyeTarget = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeH += (eyeTarget - this.eyeH) * (1 - Math.exp(-12 * dt));
    this.dip += (0 - this.dip) * (1 - Math.exp(-9 * dt));
    this.roll += (-fx * 0.014 - this.roll) * (1 - Math.exp(-8 * dt));
    this.fovKick += ((sprinting && hSpeed > WALK ? 7 : 0) - this.fovKick) * (1 - Math.exp(-6 * dt));

    const cam = this.engine.camera;
    const p = this.body.position;
    cam.position.set(p.x + bobX * cos, p.y + this.eyeH + bobY - this.dip, p.z - bobX * sin);
    cam.rotation.set(this.pitch, this.yaw, this.roll);
    const fov = settings.get('fov') + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.eye.copy(cam.position);
    cam.getWorldDirection(this.forward);

    // --- flashlight
    if (active && input.justPressed('flashlight')) {
      this.flashlightOn = !this.flashlightOn;
      this.audio.play('flashlight');
    }
    if (this.flashlightGlitch > 0) this.flashlightGlitch -= dt;
    const lit = this.flashlightOn && this.flashlightGlitch <= 0;
    this.lightTarget += ((lit ? 1 : 0) - this.lightTarget) * (1 - Math.exp(-30 * dt));
    this.flashlight.intensity = 46 * this.lightTarget;
    if (this.flashlight.castShadow) this.flashlight.shadow.autoUpdate = this.lightTarget > 0.01;
  }
}
