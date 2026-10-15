export interface Settings {
  master: number;
  sfx: number;
  music: number;
  edgeScroll: boolean;
  quality: number;
  showFps: boolean;
  difficulty: 'recruit' | 'veteran' | 'nightmare';
}

export interface Progress {
  unlocked: number;
  completed: Record<string, { difficulty: string; time: number }>;
}

export interface EndlessRecord {
  best: Record<string, number>;
  daily: Record<string, { score: number; surges: number; kills: number }>;
}

const DEF_SETTINGS: Settings = { master: 0.8, sfx: 0.8, music: 0.55, edgeScroll: true, quality: 1, showFps: false, difficulty: 'veteran' };

function load<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(def);
    return { ...structuredClone(def), ...JSON.parse(raw) };
  } catch {
    return structuredClone(def);
  }
}

function save(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export const store = {
  settings: load<Settings>('overfit.settings', DEF_SETTINGS),
  progress: load<Progress>('overfit.progress', { unlocked: 1, completed: {} }),
  endless: load<EndlessRecord>('overfit.endless', { best: {}, daily: {} }),
  saveSettings(): void { save('overfit.settings', this.settings); },
  saveProgress(): void { save('overfit.progress', this.progress); },
  saveEndless(): void { save('overfit.endless', this.endless); },
};

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dailySeed(key = todayKey()): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000000;
}

/** Days since launch, used as the daily challenge number. */
export function dailyNumber(key = todayKey()): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(2026, 9, 1)) / 86400000) + 1;
}
