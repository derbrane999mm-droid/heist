// Persisted per-player settings. Everything here is local to one browser.

export type QualityName = 'low' | 'medium' | 'high' | 'ultra';
export type Lang = 'en' | 'de';

export interface Settings {
  lang: Lang;
  quality: QualityName | 'auto';
  sensitivity: number; // 0.2 .. 3
  fov: number; // 60 .. 100
  invertY: boolean;
  master: number; // 0..1
  sfx: number;
  music: number;
  voice: number;
  voiceMode: 'open' | 'ptt';
  micMuted: boolean;
  name: string;
  color: number; // index into PLAYER_COLORS
  showFps: boolean;
}

export const PLAYER_COLORS = [0x35e6d0, 0xffa23a, 0xb38cff, 0xff5c7a, 0x8dff6a, 0x4aa8ff];

const KEY = 'nullvault.settings.v1';

function detectLang(): Lang {
  const l = (navigator.language || 'en').toLowerCase();
  return l.startsWith('de') ? 'de' : 'en';
}

const defaults: Settings = {
  lang: detectLang(),
  quality: 'auto',
  sensitivity: 1,
  fov: 78,
  invertY: false,
  master: 0.9,
  sfx: 0.9,
  music: 0.6,
  voice: 1,
  voiceMode: 'open',
  micMuted: false,
  name: '',
  color: Math.floor(Math.random() * PLAYER_COLORS.length),
  showFps: false,
};

type Listener = (s: Settings, key: keyof Settings | null) => void;

class SettingsStore {
  values: Settings = { ...defaults };
  private listeners = new Set<Listener>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        this.values = { ...defaults, ...parsed };
      }
    } catch {
      /* storage unavailable: run with defaults */
    }
  }

  get<K extends keyof Settings>(k: K): Settings[K] {
    return this.values[k];
  }

  set<K extends keyof Settings>(k: K, v: Settings[K]) {
    if (this.values[k] === v) return;
    this.values[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l(this.values, k);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const settings = new SettingsStore();

/** Stable id for this browser so a player can rejoin a crew as the same person. */
export function playerId(): string {
  const k = 'nullvault.pid';
  try {
    let id = localStorage.getItem(k);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      localStorage.setItem(k, id);
    }
    return id;
  } catch {
    return (playerIdFallback ??= Math.random().toString(36).slice(2, 18));
  }
}
let playerIdFallback: string | undefined;
