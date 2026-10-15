import type { MapGenOptions } from '../sim/mapgen';
import type { Difficulty } from '../sim/types';
import type { World } from '../sim/world';

export interface MissionDef {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  briefing: string[];
  seed: number;
  mapSize: number;
  gen: MapGenOptions;
  /** called once after world generation */
  setup(w: World): void;
  /** called every tick; set w.result to finish */
  script(w: World): void;
  /** difficulty override (tutorial forces recruit pacing) */
  difficulty?: Difficulty;
}

/** Helper for scripts: run `fn` once when `cond` first holds. */
export function once(w: World, key: string, cond: boolean, fn: () => void): void {
  if (cond && !w.flags['once:' + key]) { w.flags['once:' + key] = true; fn(); }
}

export function at(w: World, seconds: number): boolean {
  return w.time >= seconds;
}

export function setObjective(w: World, id: string, text: string, progress?: string): void {
  const o = w.objectives.find((x) => x.id === id);
  if (o) { o.text = text; if (progress !== undefined) o.progress = progress; }
  else w.objectives.push({ id, text, done: false, progress });
  w.emit({ t: 'objective', id });
}

export function completeObjective(w: World, id: string): void {
  const o = w.objectives.find((x) => x.id === id);
  if (o && !o.done) { o.done = true; o.progress = undefined; w.emit({ t: 'objective', id, done: true, sfx: 'research_done' }); }
}

export function win(w: World, reason: string): void {
  if (w.result) return;
  w.result = 'victory';
  w.resultReason = reason;
  w.emit({ t: 'victory', sfx: 'victory' });
}

export function lose(w: World, reason: string): void {
  if (w.result) return;
  w.result = 'defeat';
  w.resultReason = reason;
  w.emit({ t: 'defeat', sfx: 'defeat' });
}

// Missions are registered by src/game/campaign.ts
export const MISSIONS: MissionDef[] = [];
