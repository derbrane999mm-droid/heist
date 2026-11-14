// Level registry. `?level=<name>` opens a level directly (development and the
// calibration set); without it the game starts in the hideout.
import type { Level, LevelDeps } from '../level';
import { createHideout } from './hideout';
import { createCalibHack } from './calib-hack';

export const LEVELS: Record<string, (deps: LevelDeps) => Level> = {
  hideout: createHideout,
  hack: createCalibHack,
};
