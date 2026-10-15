import type { Entity, World } from '../world';
import { AXIOM, HUMAN, type Team } from '../types';

/** Per-tick caches rebuilt at the start of every tick. */
export class TickCache {
  units: Entity[] = [];
  buildings: Entity[] = [];
  humanBuildings: Entity[] = [];
  axiomBuildings: Entity[] = [];
  resources: Entity[] = [];
  buf: number[] = new Array(512);
}

export function rebuildCache(w: World, c: TickCache): void {
  c.units.length = 0;
  c.buildings.length = 0;
  c.humanBuildings.length = 0;
  c.axiomBuildings.length = 0;
  c.resources.length = 0;
  w.hash.clear();
  for (const e of w.entities) {
    if (!e.alive) continue;
    if (e.cat === 'unit') {
      c.units.push(e);
      w.hash.insert(e.id, e.x, e.y);
    } else if (e.cat === 'building') {
      c.buildings.push(e);
      if (e.team === HUMAN) c.humanBuildings.push(e);
      else if (e.team === AXIOM) c.axiomBuildings.push(e);
    } else {
      c.resources.push(e);
    }
  }
}

/** Distance from point to entity surface (rect for buildings, circle for units). */
export function surfaceDist(x: number, y: number, t: Entity): number {
  if (t.cat === 'building') {
    const cx = Math.max(t.tx, Math.min(x, t.tx + t.size));
    const cy = Math.max(t.ty, Math.min(y, t.ty + t.size));
    return Math.hypot(x - cx, y - cy);
  }
  return Math.max(0, Math.hypot(x - t.x, y - t.y) - t.radius);
}

export function hostile(a: Team, b: Team): boolean {
  return a !== b && a !== 0 && b !== 0;
}

/** Can entity `t` be targeted by team `team`? (humans need vision) */
export function targetable(w: World, team: Team, t: Entity): boolean {
  if (!t.alive || !hostile(team, t.team)) return false;
  if (t.kind === 'server_farm') return false;
  if (team === HUMAN && !w.isVisible(t.x, t.y)) {
    if (t.cat !== 'building') return false;
    // buildings: visible if any footprint tile visible
    for (let y = t.ty; y < t.ty + t.size; y++) for (let x = t.tx; x < t.tx + t.size; x++) if (w.isVisible(x + 0.5, y + 0.5)) return true;
    return false;
  }
  return true;
}

export interface AcquireOpts {
  range: number;
  antiAir: boolean;
  preferBuildings?: boolean;
  unitsOnly?: boolean;
  ignoreWalls?: boolean;
}

/** Find best hostile target near e. Units are preferred over buildings (unless preferBuildings). */
export function acquire(w: World, c: TickCache, e: Entity, o: AcquireOpts): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  const n = w.hash.queryRadius(e.x, e.y, o.range + 1.6, c.buf);
  for (let i = 0; i < n; i++) {
    const t = w.byId.get(c.buf[i]);
    if (!t || !t.alive || t === e) continue;
    if (!hostile(e.team, t.team)) continue;
    if (t.flying && !o.antiAir) continue;
    const d = surfaceDist(e.x, e.y, t);
    if (d > o.range) continue;
    if (!targetable(w, e.team, t)) continue;
    let score = d;
    if (o.preferBuildings) score += 6;
    if (t.kind === 'engineer' || t.kind === 'netrunner') score -= 0.5;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  if (o.unitsOnly) return best;
  const blist = e.team === HUMAN ? c.axiomBuildings : c.humanBuildings;
  for (const t of blist) {
    if (!t.alive) continue;
    const d = surfaceDist(e.x, e.y, t);
    if (d > o.range) continue;
    if (!targetable(w, e.team, t)) continue;
    let score = d + (o.preferBuildings ? 0 : 3);
    if (t.bdef?.wall) score += o.ignoreWalls ? 50 : 4;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return best;
}
