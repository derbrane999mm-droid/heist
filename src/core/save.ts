// Campaign progress. The host's copy is authoritative during a session, but
// every crew member keeps a mirror so anyone can host the next evening.

export interface Campaign {
  v: 1;
  /** Crew check (practice vault) finished. */
  crewReady: boolean;
  /** Per-mission results, filled in as missions ship. */
  missions: Record<string, { stars: number; best: number }>;
  /** Lineup result: player id -> role id. */
  roles: Record<string, 'brain' | 'gambler' | 'hands' | 'bait'>;
}

const KEY = 'nullvault.campaign.v1';

export function emptyCampaign(): Campaign {
  return { v: 1, crewReady: false, missions: {}, roles: {} };
}

export function loadCampaign(): Campaign {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Campaign;
      if (c && c.v === 1) return { ...emptyCampaign(), ...c };
    }
  } catch {
    /* storage unavailable */
  }
  return emptyCampaign();
}

export function saveCampaign(c: Campaign) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function resetCampaign() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
