// Shared contract for the first-person job (2026-11-14). Everything that turns a step of the job into
// something a player does with his own hands plugs in through these types, so the pieces can be built
// in parallel and wired together by the job director (src/game/job).
//
// The planning machine (src/game/plan/logic.ts) stays the authority for the job: it runs the beats,
// the decisions, the secret offers and the settlement. Where it used to roll dice for a step, the
// director may ask a player to do it instead: a "skill check". No skill game ready, no player present
// (a bot seat), or a player who gives up: the dice roll stays. That is the fallback for everything.
import type { LevelDeps } from '../level';

/** What the host tells the player's client when it is his turn. */
export interface SkillRequest {
  /** which game: 'lock' (door locks), 'safe' (the vault), later more */
  game: string;
  /** e.g. 'mech' | 'elek' | 'zeit' for the safe, 'door' | 'case' for locks */
  variant: string;
  /** 1 easy .. 3 hard; derived from the dice chance the step would have had */
  difficulty: 1 | 2 | 3;
  /** same puzzle for everyone who watches or retries */
  seed: number;
  /** tools the crew bought that matter here (ids from VARGA.tools) */
  tools: string[];
  /** seconds until the step fails by itself; 0 = no limit */
  timeLimit: number;
}

/** What the player's client reports back. The host turns it into the step's outcome. */
export interface SkillResult {
  ok: boolean;
  /** how long the player needed, in seconds */
  seconds: number;
  /** 0..10 extra noise the attempt made (slips, drilling) */
  noise: number;
  /** number of slips; the hands' weakness "fumbles under pressure" reads this */
  fumbles: number;
  /** the player walked away or closed the game: the director falls back to the dice */
  gaveUp?: boolean;
}

/**
 * One skill game. It is local to the player who plays it: keyboard-driven overlay or in-world prop,
 * pointer stays locked, movement frozen while it is open (see ENGINE.md, "Player"). It never touches
 * the network itself; the director sends the request and collects the result.
 */
export interface SkillGame {
  readonly id: string;
  /** Open the game. Calls `done` exactly once. */
  start(req: SkillRequest, done: (r: SkillResult) => void): void;
  /** Close without a result (the step was resolved another way, the session ended). */
  cancel(): void;
  active(): boolean;
  /** Called every frame while the level is running. */
  update(dt: number, time: number): void;
  /** For tests: finish the open game right now as a success or a failure. */
  debugFinish(ok: boolean): void;
}

/** Every skill game module exports a factory of this shape. Build all DOM, materials and sounds here. */
export type SkillGameFactory = (deps: LevelDeps) => SkillGame;

/** Named places of a job location, in world coordinates (y = floor). The level provides them, the director uses them. */
export interface Anchor {
  x: number;
  y: number;
  z: number;
  /** facing for a player or prop standing there, radians */
  yaw?: number;
  /** for trigger zones: radius in metres */
  r?: number;
}
export type Anchors = Record<string, Anchor>;
