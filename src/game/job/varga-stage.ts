// Wires the real Varga location into the first-person job: lock and safe games, the night watchmen and
// the doors. The level (src/game/levels/varga.ts) calls this once in its factory and forwards
// attach / detach / update; nothing else is needed. Without it the job stays at the planning table.
//
//   const stage = createVargaStage(deps, { exterior: VARGA_ANCHORS, openDeliveryDoor: setDoor, interior });
//   attach(s) { stage.attach(s) }   detach() { stage.detach() }   update(dt, t) { stage.update(dt, t) }
//
// Skill games are updated by the job director, the guards by `stage.update` (the level must not do either twice).
// Everything the location shows (entrance, vault door, display cases, safe door, alarm beacons) is derived
// from the replicated plan state every frame, so late joiners see the same as everyone else.
import type { LevelDeps } from '../level';
import type { Session } from '../../net/session';
import type { Anchor, Anchors, SkillGame } from '../mech/skill';
import { createLockGame } from '../mech/lock';
import { createSafeGame } from '../mech/safe';
import { createGuards, type GuardSystem } from '../mech/guard';
import { entranceOpen } from './director';
import { createJobSound, type JobSound } from './sound';
import { createRoles, VARGA_MAP, type Roles } from './roles';

/** The parts of the interior (varga-interior.ts) the job uses; all optional so a half-built interior works. */
export interface VargaInteriorLike {
  anchors: Anchors;
  openFrontDoor?(open: boolean): void;
  openVaultDoor?(open: boolean): void;
  openCase?(i: number, open: boolean): void;
  setAlarm?(on: boolean): void;
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
  /** test hook: what the location shows right now */
  debugProps(): Record<string, unknown>;
  /** sound of the job (sound.ts); test hook `sound.debug` */
  sound: JobSound;
  /** lookout map, driver clock, coin (roles.ts) */
  roles: Roles;
}

/** Numbered anchors `prefix.0`, `prefix.1`, ... in order. */
function numbered(a: Anchors, prefix: string): Anchor[] {
  const out: Anchor[] = [];
  for (let i = 0; a[prefix + '.' + i]; i++) out.push(a[prefix + '.' + i]);
  return out;
}

/** Noise radius (m) of one slip at a lock or safe, and of drilling per second of it. */
const SLIP_R = 9;
const DRILL_R = 14;

export function createVargaStage(deps: LevelDeps, o: VargaStageOpts): VargaStage {
  const inA = o.interior?.anchors ?? {};
  // exterior places first; the interior adds the rooms. The roof entrance is the interior's hatch.
  const anchors: Anchors = { ...inA, ...o.exterior };
  if (inA['in.dach'] && !o.exterior['in.dach']) anchors['in.dach'] = inA['in.dach'];
  const games: Record<string, SkillGame> = { lock: createLockGame(deps), safe: createSafeGame(deps) };
  const routes = numbered(inA, 'guard');
  const guards = !o.noGuards && routes.length >= 2 ? createGuards(deps, { routes: [routes], hide: numbered(inA, 'hide') }) : null;
  const I = o.interior;
  let session: Session | null = null;
  const sound = createJobSound(deps, { guards, anchors });
  const roles = createRoles(deps, { anchors, guards, map: VARGA_MAP });

  // what the location shows; applied only on change
  const shown = { liefer: false, vorder: false, dach: false, vault: false, cases: false, safe: false, alarm: false };
  const setDoor = (id: string, open: boolean) => {
    if (id === 'liefer') o.openDeliveryDoor?.(open);
    else if (id === 'vorder') I?.openFrontDoor?.(open);
    else if (id === 'dach') I?.openHatch?.(open);
    else if (id === 'vault') I?.openVaultDoor?.(open);
    else if (id === 'safe') I?.openSafe?.(open);
    else if (id === 'cases') for (let i = 0; i < 4; i++) I?.openCase?.(i, open);
    else if (id === 'alarm') I?.setAlarm?.(open);
  };
  const want = { ...shown };
  const apply = () => {
    for (const k of Object.keys(shown) as (keyof typeof shown)[]) {
      if (shown[k] === want[k]) continue;
      shown[k] = want[k];
      setDoor(k, want[k]);
    }
  };

  const unregister =
    deps.plan?.registerStage?.({
      anchors,
      games,
      guards: guards ?? undefined,
      // roof: no climbing. The 'in' beat waits in the yard, then the inside crew is placed under the hatch.
      climb: inA['in.dach'] ? { dach: { wait: 'gate', exit: 'gate' } } : undefined,
      openDoor(id, open) {
        // the director opens the entrance; the stage keeps it in its derived state as well
        if (id in want) (want as Record<string, boolean>)[id] = open;
        apply();
      },
    }) ?? (() => {});

  // ---------------------------------------------------------------- noise of the skill games
  // Slips and drilling reach the guards where they happen (the player's position). Read from the games' debug state.
  let lastSlips = -1;
  let drillAcc = 0;
  const noiseAt = (r: number) => {
    const pl = deps.player();
    if (!guards || !pl) return;
    guards.noise(pl.position.x, pl.position.z, r);
  };
  const gameNoise = (dt: number) => {
    const lock = (games.lock as any).debug?.state?.() ?? null;
    const safe = (games.safe as any).debug?.state?.() ?? null;
    const st = games.lock.active() ? lock : games.safe.active() ? safe : null;
    if (!st) {
      lastSlips = -1;
      drillAcc = 0;
      return;
    }
    const slips = Number(st.slips ?? st.fumbles ?? 0) || 0;
    if (lastSlips >= 0 && slips > lastSlips) noiseAt(SLIP_R);
    lastSlips = slips;
    if (st.drilling) {
      drillAcc += dt;
      if (drillAcc >= 1) {
        drillAcc = 0;
        noiseAt(DRILL_R);
      }
    } else drillAcc = 0;
  };

  // ---------------------------------------------------------------- props from the plan state
  const derive = () => {
    const p = session?.get<any>('plan');
    const R = p?.run;
    const live = !!R && (p.phase === 'run' || (p.phase === 'offer' && !!p.mid));
    for (const k of Object.keys(want) as (keyof typeof want)[]) want[k] = false;
    if (!live) return;
    const open = entranceOpen(R);
    if (open) {
      (want as Record<string, boolean>)[R.entrance] = true;
      // from the inside the crew opens the vault room (if the safe is a target) and works the cases
      want.vault = (p.plan?.targets ?? []).includes('tresor');
    }
    const shownTargets = new Set<string>((R.beats ?? []).map((b: any) => b.target).filter(Boolean));
    want.cases = open && shownTargets.has('vitrinen');
    want.safe = (R.doneTargets ?? []).includes('tresor') && (R.beats ?? []).some((b: any) => b.lines.some((l: any) => ['ln.safeDecoder', 'ln.safeEar', 'ln.drilled'].includes(l?.x?.k)));
    want.alarm = !!R.alarmKnown;
  };

  return {
    games,
    guards,
    anchors,
    attach(s) {
      session = s;
      guards?.attach(s);
      sound.attach(s);
      roles.attach(s);
    },
    detach() {
      guards?.detach();
      sound.detach();
      roles.detach();
      for (const k in games) games[k].cancel();
      session = null;
      for (const k of Object.keys(want) as (keyof typeof want)[]) want[k] = false;
      apply();
    },
    update(dt, t) {
      derive();
      apply();
      gameNoise(dt);
      guards?.update(dt, t);
      sound.update(dt, t);
      roles.update(dt, t);
    },
    unregister,
    sound,
    roles,
    debugProps: () => ({ ...shown }),
  };
}
