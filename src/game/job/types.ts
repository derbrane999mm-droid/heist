// The first-person job: what a level hands to the job director (src/game/job/director.ts).
import type { Anchors, SkillGame } from '../mech/skill';

/** Anything with this shape can be the stage's guard system (src/game/mech/guard.ts or a test dummy). */
export interface GuardSystemLike {
  /** start/stop patrolling (src/game/mech/guard.ts: `setActive`, host decides; a test dummy may use `activate`) */
  setActive?(on: boolean): void;
  activate?(on: boolean): void;
  /** guard events, fired on every peer (guard.ts): the director acts on `alert` on the host only */
  onEvent?(cb: (e: { type: string; pid?: string }) => void): void;
  /** alternative for local dummies: a callback the director sets, reported from whichever client fires it */
  onAlert?: ((e?: unknown) => void) | null;
}

export type JobPhaseEvent = { phase: string; beat: number; anchor: string | null };

export interface JobStage {
  /** named places: 'van', 'gate', 'door.liefer' | 'door.vorder' | 'in.dach', 'safe', 'case.0'.., 'lager.goods', 'post.lookout', 'van.driver' */
  anchors: Anchors;
  /** skill games by SkillRequest.game ('lock', 'safe', ...) */
  games: Record<string, SkillGame>;
  guards?: GuardSystemLike;
  /** open or close a door of the location: id 'liefer' | 'vorder' | 'dach' */
  openDoor?(id: string, open: boolean): void;
  /** every phase / beat change on this client while the stage is registered */
  onPhase?(e: JobPhaseEvent): void;
}
