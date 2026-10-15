import { FlowField } from '../path';
import { HUMAN, T_RUIN, T_WATER } from '../types';
import type { World } from '../world';
import type { TickCache } from './query';

// ------------------------------------------------------------------ AXIOM Grid (creep)
/** Called every 10 ticks (0.5 s). */
export function updateCreep(w: World, c: TickCache): void {
  const W = w.w, H = w.h;
  const src = w.creepSrc;
  src.fill(0);
  for (const b of c.axiomBuildings) {
    const r = b.bdef?.creepRadius;
    if (!r || !b.built || b.hacked) continue;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(b.x - r)), x1 = Math.min(W - 1, Math.ceil(b.x + r));
    const y0 = Math.max(0, Math.floor(b.y - r)), y1 = Math.min(H - 1, Math.ceil(b.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - b.x, dy = y + 0.5 - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        // inner core seeds directly; outer ring needs neighbours (organic spread)
        src[y * W + x] = d2 < 4 ? 2 : 1;
      }
    }
  }
  let count = 0;
  const cr = w.creep;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = w.terrain[i];
      if (t === T_WATER || t === T_RUIN) { cr[i] = 0; continue; }
      const s = src[i];
      let v = cr[i];
      if (s) {
        const occ = w.occ[i];
        const blockedByHuman = occ !== 0 && w.byId.get(occ)?.team === HUMAN;
        if (blockedByHuman) v = Math.max(0, v - 0.1);
        else if (s === 2) v = Math.min(1, v + 0.35);
        else {
          // spread only from neighbours that already have creep
          let nb = 0;
          if (x > 0 && cr[i - 1] > 0.6) nb++;
          if (x < W - 1 && cr[i + 1] > 0.6) nb++;
          if (y > 0 && cr[i - W] > 0.6) nb++;
          if (y < H - 1 && cr[i + W] > 0.6) nb++;
          if (nb > 0 || v > 0) v = Math.min(1, v + 0.06 + nb * 0.05 + ((x * 7 + y * 13 + w.tick) % 5) * 0.01);
        }
      } else if (v > 0) {
        v = Math.max(0, v - 0.04);
      }
      cr[i] = v;
      if (v > 0.5) count++;
    }
  }
  w.axiom.creepTiles = count;
}

// ------------------------------------------------------------------ vision
const circleCache = new Map<number, Int16Array>();
function circle(r: number): Int16Array {
  const key = Math.round(r * 2);
  let c = circleCache.get(key);
  if (c) return c;
  const rr = key / 2;
  const pts: number[] = [];
  const ri = Math.ceil(rr);
  for (let y = -ri; y <= ri; y++) for (let x = -ri; x <= ri; x++) if (x * x + y * y <= rr * rr + 0.5) pts.push(x, y);
  c = new Int16Array(pts);
  circleCache.set(key, c);
  return c;
}

/** Called every 5 ticks. */
export function updateVision(w: World): void {
  const vis = w.vis, exp = w.explored, W = w.w, H = w.h;
  vis.fill(0);
  for (const e of w.entities) {
    if (!e.alive || e.team !== HUMAN) continue;
    if (e.isBuilding && !e.built) { stamp(e.x, e.y, 2.5); continue; }
    stamp(e.x, e.y, e.sight);
  }
  function stamp(cx: number, cy: number, r: number): void {
    const pts = circle(r);
    const tx = cx | 0, ty = cy | 0;
    for (let k = 0; k < pts.length; k += 2) {
      const x = tx + pts[k], y = ty + pts[k + 1];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (vis[i] < 255) vis[i]++;
      exp[i] = 1;
    }
  }
}

/** Reveal an area (scripted events, supply drops). */
export function revealArea(w: World, x: number, y: number, r: number): void {
  const pts = circle(r);
  for (let k = 0; k < pts.length; k += 2) {
    const tx = (x | 0) + pts[k], ty = (y | 0) + pts[k + 1];
    if (w.inBounds(tx, ty)) w.explored[ty * w.w + tx] = 1;
  }
}

// ------------------------------------------------------------------ flow fields
/** Rebuild the main 'human' siege field toward all human structures (debounced). */
export function updateFields(w: World, c: TickCache): void {
  if (!w.fieldDirty) return;
  if (w.tick % 10 !== 0 && w.fields.has('human')) return;
  w.fieldDirty = false;
  let f = w.fields.get('human');
  if (!f) { f = new FlowField(w.w, w.h); w.fields.set('human', f); }
  const goals: number[] = [];
  for (const b of c.humanBuildings) {
    if (!b.alive) continue;
    for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) goals.push(y * w.w + x);
  }
  if (goals.length === 0) {
    // no structures: chase the nearest human unit cluster
    for (const u of c.units) if (u.team === HUMAN) goals.push((u.y | 0) * w.w + (u.x | 0));
  }
  if (goals.length) f.build(w.grid, goals, 'siege');
  // per-target fields for raids are cached by key and invalidated here
  for (const k of [...w.fields.keys()]) if (k !== 'human') w.fields.delete(k);
}

export function fieldTo(w: World, key: string, goals: number[]): FlowField {
  let f = w.fields.get(key);
  if (f) return f;
  f = new FlowField(w.w, w.h);
  f.build(w.grid, goals, 'siege');
  w.fields.set(key, f);
  return f;
}

