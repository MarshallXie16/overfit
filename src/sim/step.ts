import { updateAxiom } from './ai/axiom';
import { nearestWalkable } from './path';
import { updateAbilities, updateProjectiles, updateTurrets } from './systems/combat';
import { applyCommands } from './systems/commands';
import { updateEconomy } from './systems/economy';
import { updateCreep, updateFields, updateVision } from './systems/field';
import { rebuildCache, TickCache } from './systems/query';
import { updateUnits } from './systems/units';
import { AXIOM, DT, HUMAN } from './types';
import type { Entity, World } from './world';

const cache = new TickCache();
/** max collision radius vs. terrain / buildings (tiles); must be < 0.5 so every unit fits a 1-tile gap */
const TERRAIN_R = 0.42;
/** separation query padding (max move + push per tick) and contact cap */
const SEP_PAD = 0.35;
const MAX_CONTACTS = 24;
const sepBuf: number[] = [];

export function getCache(): TickCache { return cache; }

/** Advance the simulation by one fixed tick. */
export function step(w: World): void {
  if (w.result) { w.commands.length = 0; return; }
  for (const e of w.entities) { e.px = e.x; e.py = e.y; }
  rebuildCache(w, cache);
  applyCommands(w);
  updateFields(w, cache);
  updateAxiom(w, cache);
  updateEconomy(w, cache);
  updateUnits(w, cache);
  integrate(w, cache.units);
  updateTurrets(w, cache);
  updateProjectiles(w, cache);
  updateAbilities(w, cache);
  if (w.tick % 10 === 5) updateCreep(w, cache);
  if (w.tick % 5 === 0) updateVision(w);
  if (w.script) w.script(w);
  checkRules(w);
  w.cleanup();
  w.tick++;
  w.time += DT;
}

function walkable(w: World, x: number, y: number): boolean {
  return w.isWalkableTile(Math.floor(x), Math.floor(y));
}

/** Apply desired velocities with separation + tile collision. */
export function integrate(w: World, units: Entity[]): void {
  // separation only needs neighbours closer than (own radius + largest radius around); hash points
  // are start-of-tick positions, so pad for this tick's movement
  let maxR = 0;
  for (const u of units) if (u.alive && u.radius > maxR) maxR = u.radius;
  for (const e of units) {
    if (!e.alive) continue;
    let dx = e.vx * DT, dy = e.vy * DT;
    // separation (a jammed unit 'ghosts' past friends for a moment; enemies still collide)
    const n = w.hash.queryRadiusExact(e.x, e.y, e.radius + maxR + SEP_PAD, sepBuf);
    let px = 0, py = 0, touching = 0;
    const ghost = e.ghostUntil > w.time;
    for (let i = 0; i < n; i++) {
      const o = w.byId.get(sepBuf[i]);
      if (!o || o === e || !o.alive || o.flying !== e.flying) continue;
      if ((ghost || o.ghostUntil > w.time) && o.team === e.team) continue;
      const ox = e.x - o.x, oy = e.y - o.y;
      const min = e.radius + o.radius;
      const d2 = ox * ox + oy * oy;
      if (d2 >= min * min) continue;
      // in a pathological pile-up a couple of dozen contacts decide the push anyway
      if (++touching > MAX_CONTACTS) break;
      if (d2 < 1e-6) { px += (w.rng.next() - 0.5) * 0.05; py += (w.rng.next() - 0.5) * 0.05; continue; }
      const d = Math.sqrt(d2);
      const overlap = min - d;
      let k = 0.45;
      if (e.moving && !o.moving) k = 0.18;
      else if (!e.moving && o.moving) k = 0.7;
      if (o.radius > e.radius * 1.5) k *= 1.4;
      else if (e.radius > o.radius * 1.5) k *= 0.5;
      if (e.order?.type === 'hold' || (e.order === null && e.targetId && !e.moving)) k *= 0.35;
      px += (ox / d) * overlap * k;
      py += (oy / d) * overlap * k;
    }
    const pm = Math.hypot(px, py);
    if (pm > 0.12) { px *= 0.12 / pm; py *= 0.12 / pm; }
    dx += px; dy += py;
    // currently inside a blocked tile (spawned / building placed on top / pushed) → escape,
    // even when standing still
    if (!e.flying && !walkable(w, e.x, e.y)) {
      const nw = nearestWalkable(w.grid, Math.floor(e.x), Math.floor(e.y), 6);
      if (nw) {
        const tx = nw.tx + 0.5 - e.x, ty = nw.ty + 0.5 - e.y, td = Math.hypot(tx, ty) || 1;
        const s = Math.min(td, 0.25);
        e.x += (tx / td) * s; e.y += (ty / td) * s;
      }
      continue;
    }
    if (dx === 0 && dy === 0) continue;
    let nx = e.x + dx, ny = e.y + dy;
    if (e.flying) {
      e.x = Math.max(0.5, Math.min(w.w - 0.5, nx));
      e.y = Math.max(0.5, Math.min(w.h - 0.5, ny));
      continue;
    }
    if (!walkable(w, nx, ny)) {
      if (walkable(w, nx, e.y)) ny = e.y;
      else if (walkable(w, e.x, ny)) nx = e.x;
      else { nx = e.x; ny = e.y; }
    }
    // push out of neighbouring blocked tiles (circle vs AABB). Capped so that big units
    // (brutes, tanks, the Colossus) still fit the 1-tile alleys that pathing/flow fields use.
    const r = Math.min(e.radius * 0.85, TERRAIN_R);
    const x0 = Math.floor(nx - r), x1 = Math.floor(nx + r), y0 = Math.floor(ny - r), y1 = Math.floor(ny + r);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (w.isWalkableTile(tx, ty)) continue;
        const cx = Math.max(tx, Math.min(nx, tx + 1)), cy = Math.max(ty, Math.min(ny, ty + 1));
        const ddx = nx - cx, ddy = ny - cy;
        const d = Math.hypot(ddx, ddy);
        if (d >= r || d < 1e-6) continue;
        const push = r - d;
        const qx = nx + (ddx / d) * push, qy = ny + (ddy / d) * push;
        if (walkable(w, qx, qy)) { nx = qx; ny = qy; }
      }
    }
    e.x = Math.max(0.3, Math.min(w.w - 0.3, nx));
    e.y = Math.max(0.3, Math.min(w.h - 0.3, ny));
  }
}

export function checkRules(w: World): void {
  if (w.tick % 10 !== 0) return;
  let hq = 0, core = 0, coreExisted = false;
  for (const e of w.entities) {
    if (!e.alive || !e.isBuilding) continue;
    if (e.team === HUMAN && e.kind === 'hq' && !e.hacked) hq++;
    if (e.kind === 'core') { coreExisted = true; if (e.team === AXIOM) core++; }
  }
  if (hq === 0 && !w.flags.noHqDefeat) {
    w.result = 'defeat';
    w.resultReason = 'Every Command HQ has fallen.';
    w.emit({ t: 'defeat', sfx: 'defeat' });
    return;
  }
  if (w.settings.mode === 'skirmish' && w.flags.hadCore && core === 0) {
    w.result = 'victory';
    w.resultReason = 'The AXIOM Core is offline.';
    w.emit({ t: 'victory', sfx: 'victory' });
  }
  if (coreExisted) w.flags.hadCore = true;
}
