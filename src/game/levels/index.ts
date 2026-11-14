// Level registry. `?level=<name>` opens a level directly (development and the
// calibration set); without it the game starts in the hideout.
import type { Level, LevelDeps } from '../level';
import { createHideout } from './hideout';
import { createCalibHack } from './calib-hack';
import { createCalibRange } from './calib-range';
import { createCalibGuard } from './calib-guard';
import { createCalibSafe } from './calib-safe';
import { createCalibLock } from './calib-lock';

import { createCasino } from './casino';
import { createHq } from './hq';
import { createVarga } from './varga';
import { createVargaIn } from './varga-in';
import { createCalibJob } from './calib-job';
/** The level the game opens without `?level=` (and that a crew plays in). Change it here only. */
export const DEFAULT_LEVEL = 'hq';
export const LEVELS: Record<string, (deps: LevelDeps) => Level> = {
  hideout: createHideout,
  hack: createCalibHack,
  range: createCalibRange,
  guard: createCalibGuard,
  safe: createCalibSafe,
  lock: createCalibLock,
  casino: createCasino,
  hq: createHq,
  varga: createVarga,
  vargain: createVargaIn,
  job: createCalibJob,
};

/** Props (public/assets/models/<name>.glb) a level needs loaded before it is built. */
export const LEVEL_MODELS: Record<string, string[]> = {
  casino: ['sofa_velvet', 'plant_potted', 'lamp_floor', 'chair_damask'],
  varga: ['trashbag', 'utility_box'],
};
