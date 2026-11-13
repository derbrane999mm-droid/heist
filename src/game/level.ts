import type * as THREE from 'three';
import type { Engine } from '../core/engine';
import type { Physics } from '../core/physics';
import type { AudioEngine } from '../core/audio';
import type { Interactions } from './interact';
import type { MaterialLib } from './materials';
import type { Player } from './player';
import type { Session } from '../net/session';
import type { UI } from '../ui/ui';

export interface LevelDeps {
  engine: Engine;
  physics: Physics;
  audio: AudioEngine;
  mats: MaterialLib;
  interactions: Interactions;
  ui: UI;
  player(): Player | null;
}

export interface Level {
  spawn(index: number): { pos: THREE.Vector3; yaw: number };
  /** Camera placement while the main menu is showing. */
  menuCamera(t: number, cam: THREE.PerspectiveCamera): void;
  /** Called when a crew session starts (host or client). */
  attach(session: Session): void;
  detach(): void;
  update(dt: number, t: number): void;
  objective(): string[];
  /** Redraw every text surface (after fonts load or the language changes). */
  redraw(): void;
}
