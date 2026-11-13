// Level registry. `?level=<name>` opens a level directly (development and the
// calibration set); without it the game starts in the hideout.
import type { Level, LevelDeps } from '../level';
import { createHideout } from './hideout';

export const LEVELS: Record<string, (deps: LevelDeps) => Level> = {
  hideout: createHideout,
};
