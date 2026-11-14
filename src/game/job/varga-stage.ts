// Wires the real Varga location into the first-person job: lock and safe games, the night watchmen and
// the doors. The level (src/game/levels/varga.ts) calls this once in its factory and forwards
// attach / detach / update; nothing else is needed. Without it the job stays at the planning table.
//
//   const stage = createVargaStage(deps, { exterior: VARGA_ANCHORS, openDeliveryDoor: setDoor, interior });
//   attach(s) { stage.attach(s) }   detach() { stage.detach() }   update(dt, t) { stage.update(dt, t) }
//
// Skill games are updated by the job director, the guards by `stage.update` (the level must not do either twice).
import type { LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Anchor, Anchors, SkillGame } from '../mech/skill';
import { createLockGame } from '../mech/lock';
import { createSafeGame } from '../mech/safe';
import { createGuards, type GuardSystem } from '../mech/guard';

/** The parts of the interior (varga-interior.ts) the job uses; all optional so a half-built interior works. */
export interface VargaInteriorLike {
  anchors: Anchors;
  openFrontDoor?(open: boolean): void;
  openHatch?(open: boolean): void;
  openSafe?(open: boolean): void;
}

export interface VargaStageOpts {
  /** VARGA_ANCHORS of the exterior (van, van.driver, gate, door.liefer, door.vorder, post.lookout) */
  exterior: Anchors;
  openDeliveryDoor?(open: boolean): void;
  interior?: VargaInteriorLike | null;
  /** no guards (e.g. while the interior has no routes yet) */
  noGuards?: boolean;
}

export interface VargaStage {
  games: Record<string, SkillGame>;
  guards: GuardSystem | null;
  anchors: Anchors;
  attach(s: Session): void;
  detach(): void;
  update(dt: number, t: number): void;
  unregister(): void;
}

/** Numbered anchors `prefix.0`, `prefix.1`, ... in order. */
function numbered(a: Anchors, prefix: string): Anchor[] {
  const out: Anchor[] = [];
  for (let i = 0; a[prefix + '.' + i]; i++) out.push(a[prefix + '.' + i]);
  return out;
}

export function createVargaStage(deps: LevelDeps, o: VargaStageOpts): VargaStage {
  const inA = o.interior?.anchors ?? {};
  // exterior places first; the interior adds the rooms. The roof entrance is the interior's hatch.
  const anchors: Anchors = { ...inA, ...o.exterior };
  if (inA['in.dach'] && !o.exterior['in.dach']) anchors['in.dach'] = inA['in.dach'];
  const games: Record<string, SkillGame> = { lock: createLockGame(deps), safe: createSafeGame(deps) };
  const routes = numbered(inA, 'guard');
  const guards = !o.noGuards && routes.length >= 2 ? createGuards(deps, { routes: [routes], hide: numbered(inA, 'hide') }) : null;
  const unregister =
    deps.plan?.registerStage?.({
      anchors,
      games,
      guards: guards ?? undefined,
      openDoor(id, open) {
        if (id === 'liefer') o.openDeliveryDoor?.(open);
        else if (id === 'vorder') o.interior?.openFrontDoor?.(open);
        else if (id === 'dach') o.interior?.openHatch?.(open);
      },
    }) ?? (() => {});
  return {
    games,
    guards,
    anchors,
    attach(s) {
      guards?.attach(s);
    },
    detach() {
      guards?.detach();
      for (const k in games) games[k].cancel();
    },
    update(dt, t) {
      guards?.update(dt, t);
    },
    unregister,
  };
}
