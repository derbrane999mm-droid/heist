// Level registry. `?level=<name>` opens a level directly (development and the
// calibration set); without it the game starts in the hideout.
import type { Level, LevelDeps } from '../level';
import { createHideout } from './hideout';
import { createCalibHack } from './calib-hack';
import { createCalibRange } from './calib-range';

import { createCasino } from './casino';
export const LEVELS: Record<string, (deps: LevelDeps) => Level> = {
  hideout: createHideout,
  hack: createCalibHack,
  range: createCalibRange,
  casino: createCasino,
};

/** Props (public/assets/models/<name>.glb) a level needs loaded before it is built. */
export const LEVEL_MODELS: Record<string, string[]> = {
  casino: ['sofa_velvet', 'plant_potted', 'lamp_floor', 'chair_damask'],
};
