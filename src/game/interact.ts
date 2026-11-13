// "Look at it and press E" interactions, with optional hold behaviour.
import * as THREE from 'three';
import type { Physics, Collider } from '../core/physics';
import type { Input } from '../core/input';

export interface Interactable {
  id: string;
  /** Meshes that can be aimed at. */
  object: THREE.Object3D;
  /** Text after "Press E to …" / "Hold E to …"; null hides the prompt and disables use. */
  prompt(): string | null;
  hold?: boolean;
  range?: number;
  onUse?(): void;
  onHoldStart?(): void;
  onHoldEnd?(): void;
  onFocus?(focused: boolean): void;
}

export class Interactions {
  private items = new Map<string, Interactable>();
  private ray = new THREE.Raycaster();
  focused: Interactable | null = null;
  holding: Interactable | null = null;
  /** Prompt for the HUD: `{ text, hold }` or null. */
  promptText: { text: string; hold: boolean } | null = null;

  constructor(
    private physics: Physics,
    private input: Input,
  ) {}

  add(i: Interactable) {
    this.items.set(i.id, i);
    i.object.traverse((o) => (o.userData.interactId = i.id));
  }

  remove(id: string) {
    const i = this.items.get(id);
    if (!i) return;
    if (this.focused === i) this.setFocus(null);
    if (this.holding === i) this.endHold();
    this.items.delete(id);
  }

  get(id: string) {
    return this.items.get(id);
  }

  private setFocus(i: Interactable | null) {
    if (this.focused === i) return;
    this.focused?.onFocus?.(false);
    this.focused = i;
    i?.onFocus?.(true);
  }

  private endHold() {
    if (!this.holding) return;
    const h = this.holding;
    this.holding = null;
    h.onHoldEnd?.();
  }

  update(eye: THREE.Vector3, dir: THREE.Vector3, playerCollider: Collider | undefined, enabled: boolean) {
    let best: Interactable | null = null;
    if (enabled) {
      this.ray.set(eye, dir);
      this.ray.far = 6;
      const targets: THREE.Object3D[] = [];
      for (const i of this.items.values()) if (i.object.visible) targets.push(i.object);
      const hits = this.ray.intersectObjects(targets, true);
      if (hits.length) {
        const wall = this.physics.raycast(eye, dir, 6.2, playerCollider);
        for (const hit of hits) {
          let o: THREE.Object3D | null = hit.object;
          let id: string | undefined;
          while (o && !id) {
            id = o.userData.interactId;
            o = o.parent;
          }
          const item = id ? this.items.get(id) : undefined;
          if (!item) continue;
          if (hit.distance > (item.range ?? 2.4)) break;
          if (wall !== null && wall < hit.distance - 0.2) break; // something solid is in the way
          if (item.prompt() !== null) best = item;
          break;
        }
      }
    }
    this.setFocus(best);

    // hold handling: keep holding only while aiming at it with the key down
    if (this.holding && (this.holding !== best || !this.input.useHeld() || !enabled)) this.endHold();

    if (best && enabled) {
      if (best.hold) {
        if (!this.holding && this.input.usePressed()) {
          this.holding = best;
          best.onHoldStart?.();
        }
      } else if (this.input.usePressed()) {
        best.onUse?.();
      }
      const text = best.prompt();
      this.promptText = text ? { text, hold: !!best.hold } : null;
    } else {
      this.promptText = null;
    }
  }

  /** Test hook: trigger an interaction by id regardless of aim. */
  debugUse(id: string, hold?: boolean) {
    const i = this.items.get(id);
    if (!i || i.prompt() === null) return false;
    if (i.hold) {
      if (hold === false) {
        if (this.holding === i) this.endHold();
        else i.onHoldEnd?.();
      } else {
        i.onHoldStart?.();
      }
    } else i.onUse?.();
    return true;
  }
}
