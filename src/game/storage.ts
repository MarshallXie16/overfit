/** Frame-rate cap in fps; 0 = uncapped (display refresh rate). */
export type FpsCap = 0 | 30 | 60;
export const FPS_CAPS: readonly FpsCap[] = [30, 60, 0];

/** Canvas render resolution policy (see renderResolution). */
export type RenderScale = 'auto' | 'performance' | 'balanced' | 'sharp';
export const RENDER_SCALES: readonly RenderScale[] = ['auto', 'performance', 'balanced', 'sharp'];

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  edgeScroll: boolean;
  quality: number;
  showFps: boolean;
  advisor: boolean;
  difficulty: 'recruit' | 'veteran' | 'nightmare';
  fpsCap: FpsCap;
  renderScale: RenderScale;
}

export interface Progress {
  unlocked: number;
  completed: Record<string, { difficulty: string; time: number }>;
}

export interface EndlessRecord {
  best: Record<string, number>;
  daily: Record<string, { score: number; surges: number; kills: number }>;
}

const DEF_SETTINGS: Settings = { master: 0.8, sfx: 0.8, music: 0.55, edgeScroll: true, quality: 1, showFps: false, advisor: true, difficulty: 'veteran', fpsCap: 60, renderScale: 'auto' };

/** Values that pass load()'s type check but are not valid options fall back to the default. */
function fixSettings(s: Settings): Settings {
  if (!FPS_CAPS.includes(s.fpsCap)) s.fpsCap = DEF_SETTINGS.fpsCap;
  if (!RENDER_SCALES.includes(s.renderScale)) s.renderScale = DEF_SETTINGS.renderScale;
  if (!['recruit', 'veteran', 'nightmare'].includes(s.difficulty)) s.difficulty = DEF_SETTINGS.difficulty;
  return s;
}

/** Auto mode keeps the canvas backing store under this many device pixels (~1.5x of a 1728x1117 window). */
export const AUTO_MAX_PIXELS = 4.5e6;

/**
 * Canvas resolution (device px per CSS px) for a render-scale setting.
 *  performance = 1x · balanced = 1.5x · sharp = native up to 2x, each capped at the display's DPR.
 *  auto = 1.5x, stepping down to 1.25x then 1x while the backing store would exceed AUTO_MAX_PIXELS;
 *  `downgraded` (set by the adaptive frame-time guard) pins auto to 1x.
 */
export function renderResolution(scale: RenderScale, dpr: number, cssW: number, cssH: number, downgraded = false): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const base = Math.min(d, 1);
  switch (scale) {
    case 'performance': return base;
    case 'balanced': return Math.min(d, 1.5);
    case 'sharp': return Math.min(d, 2);
    default: {
      if (downgraded) return base;
      const px = Math.max(1, cssW) * Math.max(1, cssH);
      for (const r of [Math.min(d, 1.5), 1.25]) if (r > base && px * r * r <= AUTO_MAX_PIXELS) return r;
      return base;
    }
  }
}

function load<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(def);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return structuredClone(def);
    const out = structuredClone(def) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) if (v !== null && v !== undefined && (typeof v === typeof out[k] || out[k] === undefined)) out[k] = v;
    return out as T;
  } catch {
    return structuredClone(def);
  }
}

function save(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export const store = {
  settings: fixSettings(load<Settings>('overfit.settings', DEF_SETTINGS)),
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
