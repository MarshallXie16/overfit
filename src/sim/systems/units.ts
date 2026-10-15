import type { WeaponDef } from '../data/defs';
import { findPath, lineWalkable } from '../path';
import { AXIOM, DT, HUMAN, T_RUBBLE } from '../types';
import type { Entity, World } from '../world';
import { fire, convertUnit } from './combat';
import { acquire, surfaceDist, targetable, type TickCache } from './query';
import { angDiff, turnToward } from '../util';
export { turnToward };

export const CARRY_CAP = 10;
export const GATHER_TIME = 1.6;
const PATH_BUDGET = 14;
let pathsThisTick = 0;

export function updateUnits(w: World, c: TickCache): void {
  pathsThisTick = 0;
  for (const e of c.units) {
    if (!e.alive) continue;
    if (e.cd > 0) e.cd -= DT;
    e.vx = 0; e.vy = 0; e.moving = false;
    if (e.stunUntil > w.time) continue;
    runOrder(w, c, e);
  }
}

// ------------------------------------------------------------------ helpers
export function nextOrder(e: Entity): void {
  e.order = e.queue.shift() ?? null;
  e.path = null;
  e.targetId = 0;
  e.stuckT = 0;
  e.hackT = 0;
  e.hackTarget = 0;
  if (!e.order) { e.ax = e.x; e.ay = e.y; }
}

export function setOrder(e: Entity, o: Entity['order'], queue = false): void {
  if (queue && (e.order || e.queue.length)) { e.queue.push(o!); return; }
  e.queue.length = 0;
  e.order = o;
  e.path = null;
  e.targetId = 0;
  e.stuckT = 0;
  e.hackT = 0;
  e.hackTarget = 0;
  if (!o) { e.ax = e.x; e.ay = e.y; }
}


function turnRate(e: Entity): number {
  return e.udef && e.udef.armor === 'armored' ? 5 : 12;
}

function speedOf(w: World, e: Entity): number {
  let s = e.udef!.speed;
  if (!e.flying) {
    const tx = e.x | 0, ty = e.y | 0;
    if (w.inBounds(tx, ty)) {
      const i = ty * w.w + tx;
      if (w.terrain[i] === T_RUBBLE) s *= 0.7;
      if (e.team === AXIOM && w.creep[i] > 0.5) s *= 1.25;
    }
  }
  return s;
}

function setVel(w: World, e: Entity, dx: number, dy: number, mul = 1): void {
  const s = speedOf(w, e) * mul;
  e.vx = dx * s;
  e.vy = dy * s;
  e.moving = true;
  e.angle = turnToward(e.angle, Math.atan2(dy, dx), turnRate(e) * DT);
  if (!e.udef?.turret) e.turretAngle = e.angle;
}

/** Steer toward (gx,gy) using A*; returns true when arrived. */
export function moveTo(w: World, e: Entity, gx: number, gy: number, arrive = 0.3): boolean {
  const dx = gx - e.x, dy = gy - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= arrive) { e.path = null; e.stuckT = 0; return true; }
  if (e.flying) {
    setVel(w, e, dx / dist, dy / dist, dist < 1 ? Math.max(0.3, dist) : 1);
    return false;
  }
  const goalMoved = !e.path || Math.abs(e.pathGX - gx) + Math.abs(e.pathGY - gy) > 0.75;
  if (goalMoved || w.time >= e.repathAt) {
    if (dist < 24 && lineWalkable(w.grid, e.x, e.y, gx, gy, e.radius * 0.8)) {
      e.path = [{ x: gx, y: gy }];
      e.pathI = 0; e.pathGX = gx; e.pathGY = gy;
      e.repathAt = w.time + 1.5;
      e.lastDist = Infinity;
    } else if (pathsThisTick < PATH_BUDGET) {
      pathsThisTick++;
      const p = findPath(w.grid, e.x, e.y, gx, gy, { maxExpand: 6000, radius: Math.min(0.45, e.radius) });
      if (p && p.length === 0) { e.path = null; e.stuckT = 0; return true; }
      e.path = p && p.length ? p : [{ x: gx, y: gy }];
      e.pathI = 0; e.pathGX = gx; e.pathGY = gy;
      e.repathAt = w.time + 5 + w.rng.next() * 2;
      e.lastDist = Infinity;
    } else if (!e.path) {
      setVel(w, e, dx / dist, dy / dist);
      return false;
    }
  }
  const path = e.path!;
  let wp = path[e.pathI];
  while (e.pathI < path.length - 1 && Math.hypot(wp.x - e.x, wp.y - e.y) < 0.5) {
    e.pathI++;
    wp = path[e.pathI];
    e.lastDist = Infinity;
    e.stuckT = 0;
  }
  const wx = wp.x - e.x, wy = wp.y - e.y;
  const wd = Math.hypot(wx, wy);
  const last = e.pathI === path.length - 1;
  if (last && wd < 0.3) { e.path = null; e.stuckT = 0; return true; }
  // stuck detection
  if (wd < e.lastDist - 0.03) { e.lastDist = wd; e.stuckT = 0; }
  else {
    e.stuckT += DT;
    if (e.stuckT > 1.2 && w.time >= e.repathAt - 4) e.repathAt = w.time; // force repath soon
    if (e.stuckT > 2.0 && dist < 1.2 + Math.sqrt(e.radius * 8)) { e.path = null; e.stuckT = 0; return true; }
    if (e.stuckT > 7) { e.path = null; e.stuckT = 0; return true; }
  }
  const slow = last && wd < 1 ? Math.max(0.35, wd) : 1;
  setVel(w, e, wx / (wd || 1), wy / (wd || 1), slow);
  return false;
}

/** Walkable tile centre on the perimeter of building b, nearest to e (spread per unit). */
export function approachPoint(w: World, e: Entity, b: Entity): { x: number; y: number } {
  let bx = b.x, by = b.ty + b.size + 0.5, bd = Infinity;
  for (let y = b.ty - 1; y <= b.ty + b.size; y++) {
    for (let x = b.tx - 1; x <= b.tx + b.size; x++) {
      if (x >= b.tx && x < b.tx + b.size && y >= b.ty && y < b.ty + b.size) continue;
      if (!w.isWalkableTile(x, y)) continue;
      const cx = x + 0.5, cy = y + 0.5;
      const d = Math.hypot(cx - e.x, cy - e.y) + ((e.id * 7 + x * 3 + y * 5) % 5) * 0.35;
      if (d < bd) { bd = d; bx = cx; by = cy; }
    }
  }
  return { x: bx, y: by };
}

/** Close enough to interact with building b (build/repair/deposit). */
export function touching(e: Entity, b: Entity): boolean {
  return surfaceDist(e.x, e.y, b) <= e.radius + 0.8;
}

function moveNear(w: World, e: Entity, t: Entity): void {
  if (t.cat === 'building') {
    const p = approachPoint(w, e, t);
    moveTo(w, e, p.x, p.y, 0.15);
  } else moveTo(w, e, t.x, t.y, 0.1);
}

export function canHit(wpn: WeaponDef, t: Entity): boolean {
  if (t.flying && (wpn.melee || wpn.antiAir === false)) return false;
  return true;
}

function reachOf(e: Entity, wpn: WeaponDef): number {
  return wpn.melee ? wpn.range + e.radius : wpn.range;
}

/** Move into range of t and fire. Returns false if t can't be engaged. */
export function engage(w: World, c: TickCache, e: Entity, t: Entity, allowMove = true): boolean {
  const wpn = e.udef?.weapon;
  if (!wpn || !canHit(wpn, t)) return false;
  e.targetId = t.id;
  const d = surfaceDist(e.x, e.y, t);
  const reach = reachOf(e, wpn);
  const tooClose = wpn.minRange !== undefined && d < wpn.minRange;
  if (d <= reach && !tooClose) {
    const ang = Math.atan2(t.y - e.y, t.x - e.x);
    if (e.udef!.turret) {
      e.turretAngle = turnToward(e.turretAngle, ang, 7 * DT);
      if (Math.abs(angDiff(e.turretAngle, ang)) > 0.35) return true;
    } else {
      e.angle = turnToward(e.angle, ang, turnRate(e) * 2 * DT);
      e.turretAngle = e.angle;
    }
    if (e.cd <= 0) fire(w, c, e, t, wpn);
    return true;
  }
  if (!allowMove) return d <= reach + 0.5;
  if (tooClose) {
    // back away from target
    const dx = e.x - t.x, dy = e.y - t.y, dd = Math.hypot(dx, dy) || 1;
    moveTo(w, e, e.x + (dx / dd) * 2, e.y + (dy / dd) * 2, 0.2);
    return true;
  }
  moveNear(w, e, t);
  return true;
}

function acquireRange(e: Entity): number {
  const wpn = e.udef?.weapon;
  if (!wpn) return 0;
  if (wpn.melee) return e.team === AXIOM ? 4.5 : 3;
  return wpn.range + (e.team === AXIOM ? 1.5 : 1);
}

function tryAcquire(w: World, c: TickCache, e: Entity, range = acquireRange(e)): Entity | null {
  const wpn = e.udef?.weapon;
  if (!wpn) return null;
  if (w.time < e.acquireAt) {
    const cur = e.targetId ? w.get(e.targetId) : undefined;
    if (cur && targetable(w, e.team, cur) && surfaceDist(e.x, e.y, cur) <= range + 1.5) return cur;
    if (e.targetId === 0) return null;
  }
  e.acquireAt = w.time + 0.3 + w.rng.next() * 0.15;
  const t = acquire(w, c, e, {
    range,
    antiAir: !wpn.melee && wpn.antiAir !== false,
    preferBuildings: e.kind === 'sapper',
  });
  e.targetId = t ? t.id : 0;
  return t;
}

// ------------------------------------------------------------------ orders
function runOrder(w: World, c: TickCache, e: Entity): void {
  const o = e.order;
  if (!o) return idle(w, c, e);
  switch (o.type) {
    case 'move':
      if (moveTo(w, e, o.x, o.y)) nextOrder(e);
      return;
    case 'amove': {
      const t = tryAcquire(w, c, e);
      if (t && engage(w, c, e, t)) return;
      if (moveTo(w, e, o.x, o.y, 0.4)) nextOrder(e);
      return;
    }
    case 'attack': {
      const t = w.get(o.id);
      if (!t || !targetable(w, e.team, t)) return nextOrder(e);
      if (!engage(w, c, e, t)) {
        // can't hit this target (e.g. melee vs air): just follow it
        moveNear(w, e, t);
      }
      return;
    }
    case 'hold': {
      const t = tryAcquire(w, c, e, e.udef?.weapon ? reachOf(e, e.udef.weapon) : 0);
      if (t) engage(w, c, e, t, false);
      return;
    }
    case 'harvest':
      return harvest(w, c, e, o);
    case 'return':
      return returnCargo(w, c, e, true);
    case 'build':
      return build(w, c, e, o.id);
    case 'repair':
      return repair(w, e, o.id);
    case 'hack':
      return hack(w, c, e, o.id);
    case 'flow':
      return flow(w, c, e, o);
    case 'guard':
      return guard(w, c, e, o);
  }
}

function idle(w: World, c: TickCache, e: Entity): void {
  const wpn = e.udef?.weapon;
  if (wpn) {
    const leash = e.team === HUMAN ? 6 : 10;
    const fromAnchor = Math.hypot(e.x - e.ax, e.y - e.ay);
    const t = tryAcquire(w, c, e);
    if (t && fromAnchor < leash) { engage(w, c, e, t); return; }
    if (t && engage(w, c, e, t, false)) return;
    if (fromAnchor > 0.8) { moveTo(w, e, e.ax, e.ay, 0.5); return; }
    return;
  }
  // engineers: auto-repair nearby damaged structures
  if (e.udef?.abilities?.includes('repair') && w.time >= e.acquireAt) {
    e.acquireAt = w.time + 1 + w.rng.next() * 0.5;
    if (w.human.scrap < 5) return;
    let best: Entity | null = null, bd = 7;
    for (const b of c.humanBuildings) {
      if (!b.built || b.hp >= b.maxHp) continue;
      const d = surfaceDist(e.x, e.y, b);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { e.order = { type: 'repair', id: best.id }; e.path = null; }
  }
}

function guard(w: World, c: TickCache, e: Entity, o: { x: number; y: number }): void {
  const t = tryAcquire(w, c, e, acquireRange(e) + 1.5);
  if (t && Math.hypot(e.x - o.x, e.y - o.y) < 12) { engage(w, c, e, t); return; }
  if (w.time >= e.loiterAt || (e.lx === 0 && e.ly === 0)) {
    const a = w.rng.next() * Math.PI * 2, r = 1 + w.rng.next() * 3.5;
    e.lx = o.x + Math.cos(a) * r;
    e.ly = o.y + Math.sin(a) * r;
    e.loiterAt = w.time + 4 + w.rng.next() * 6;
  }
  moveTo(w, e, e.lx, e.ly, 0.6);
}

function flow(w: World, c: TickCache, e: Entity, o: { field: string; tx: number; ty: number }): void {
  const t = tryAcquire(w, c, e);
  if (t && engage(w, c, e, t)) return;
  if (e.flying) { moveTo(w, e, o.tx, o.ty, 1.5); return; }
  const f = w.fields.get(o.field);
  if (!f) { moveTo(w, e, o.tx, o.ty, 1.5); return; }
  const s = f.sample(e.x, e.y);
  if (!isFinite(s.dist)) { moveTo(w, e, o.tx, o.ty, 1.5); return; }
  if (s.dx === 0 && s.dy === 0) {
    // at goal: hit the structure we're standing next to
    const b = adjacentHostileStructure(w, e);
    if (b) engage(w, c, e, b);
    return;
  }
  // structure directly ahead blocking the way → attack it
  const ax = e.x + s.dx * (e.radius + 0.5), ay = e.y + s.dy * (e.radius + 0.5);
  const atx = ax | 0, aty = ay | 0;
  if (w.inBounds(atx, aty)) {
    const occ = w.occ[aty * w.w + atx];
    if (occ) {
      const b = w.get(occ);
      if (b && b.team !== e.team && b.team !== 0) {
        if (engage(w, c, e, b)) return;
      }
    }
  }
  setVel(w, e, s.dx, s.dy);
}

function adjacentHostileStructure(w: World, e: Entity): Entity | null {
  const r = Math.ceil(e.radius + 1);
  const cx = e.x | 0, cy = e.y | 0;
  let best: Entity | null = null, bd = Infinity;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!w.inBounds(x, y)) continue;
    const id = w.occ[y * w.w + x];
    if (!id) continue;
    const b = w.get(id);
    if (!b || b.team === e.team || b.team === 0) continue;
    const d = surfaceDist(e.x, e.y, b);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// ------------------------------------------------------------------ economy orders
export function nearestDropoff(w: World, c: TickCache, x: number, y: number): Entity | null {
  let best: Entity | null = null, bd = Infinity;
  for (const b of c.humanBuildings) {
    if (!b.built || !b.bdef?.dropoff) continue;
    const d = surfaceDist(x, y, b);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function findNode(w: World, c: TickCache, x: number, y: number, maxD: number, preferWreck: boolean): Entity | null {
  let best: Entity | null = null, bd = Infinity;
  for (const r of c.resources) {
    if (!r.alive || r.amount <= 0) continue;
    if (!w.explored[(r.y | 0) * w.w + (r.x | 0)]) continue;
    let d = Math.hypot(r.x - x, r.y - y);
    if (d > maxD) continue;
    if (preferWreck !== (r.cat === 'wreck')) d += 3;
    // avoid nodes on enemy grid
    if (w.creepAt(r.x, r.y) > 0.5) d += 8;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

function returnCargo(w: World, c: TickCache, e: Entity, isOrder: boolean): void {
  const drop = nearestDropoff(w, c, e.x, e.y);
  if (!drop) { if (isOrder) nextOrder(e); return; }
  if (touching(e, drop)) {
    if (e.carrying > 0) {
      w.human.scrap += e.carrying;
      w.human.stats.scrapGathered += e.carrying;
      w.emit({ t: 'deposit', x: e.x, y: e.y, amount: e.carrying });
      e.carrying = 0;
    }
    if (isOrder) {
      if (e.lastNodeId && w.get(e.lastNodeId)) { e.order = { type: 'harvest', id: e.lastNodeId }; e.path = null; }
      else nextOrder(e);
    }
    return;
  }
  moveNear(w, e, drop);
}

function harvest(w: World, c: TickCache, e: Entity, o: { type: 'harvest'; id: number }): void {
  let node = w.get(o.id);
  if (e.carrying >= CARRY_CAP) { returnCargo(w, c, e, false); return; }
  if (!node || node.amount <= 0) {
    const lx = node ? node.x : e.x, ly = node ? node.y : e.y;
    node = findNode(w, c, lx, ly, 14, node ? node.cat === 'wreck' : false) ?? undefined;
    if (!node) {
      if (e.carrying > 0) { returnCargo(w, c, e, false); return; }
      nextOrder(e);
      return;
    }
    o.id = node.id;
  }
  e.lastNodeId = node.id;
  const d = Math.hypot(node.x - e.x, node.y - e.y);
  if (d > node.radius + e.radius + 0.25) {
    e.gatherT = 0;
    moveTo(w, e, node.x, node.y, node.radius + e.radius + 0.1);
    return;
  }
  e.angle = turnToward(e.angle, Math.atan2(node.y - e.y, node.x - e.x), 10 * DT);
  e.gatherT += DT * w.human.harvestMul * (node.cat === 'wreck' ? 1.5 : 1);
  if (e.gatherT >= GATHER_TIME) {
    e.gatherT = 0;
    const take = Math.min(CARRY_CAP - e.carrying, node.amount);
    node.amount -= take;
    e.carrying += take;
    w.emit({ t: 'harvest', x: node.x, y: node.y });
    if (node.amount <= 0) w.kill(node);
  }
}

function build(w: World, c: TickCache, e: Entity, id: number): void {
  const s = w.get(id);
  if (!s || s.built) {
    nextOrder(e);
    if (!e.order) autoHarvest(w, c, e);
    return;
  }
  if (!touching(e, s)) { moveNear(w, e, s); return; }
  e.angle = turnToward(e.angle, Math.atan2(s.y - e.y, s.x - e.x), 10 * DT);
  s.builders++;
}

export function autoHarvest(w: World, c: TickCache, e: Entity): void {
  const n = findNode(w, c, e.x, e.y, 10, false);
  if (n) { e.order = { type: 'harvest', id: n.id }; e.path = null; }
}

function repair(w: World, e: Entity, id: number): void {
  const t = w.get(id);
  if (!t || t.team !== e.team || t.hp >= t.maxHp || (t.isBuilding && !t.built) || (t.isUnit && t.udef?.armor !== 'armored')) return nextOrder(e);
  if (t.isBuilding ? !touching(e, t) : surfaceDist(e.x, e.y, t) > e.radius + 0.5) {
    if (t.isBuilding) moveNear(w, e, t); else moveTo(w, e, t.x, t.y, t.radius + e.radius + 0.2);
    return;
  }
  e.angle = turnToward(e.angle, Math.atan2(t.y - e.y, t.x - e.x), 10 * DT);
  const rate = t.isBuilding ? Math.max(15, t.maxHp / ((t.bdef!.buildTime || 10) * 1.2)) : 20;
  const heal = Math.min(rate * DT, t.maxHp - t.hp);
  const unitCost = t.isBuilding ? (t.bdef!.cost.scrap || 100) : (t.udef!.cost.scrap || 100);
  const cost = (heal / t.maxHp) * unitCost * 0.35;
  if (w.human.scrap < cost) return nextOrder(e);
  w.human.scrap -= cost;
  t.hp += heal;
  if (w.tick % 10 === 0) w.emit({ t: 'repair', x: (e.x + t.x) / 2, y: (e.y + t.y) / 2 });
}

export function hackEligible(w: World, t: Entity): boolean {
  if (t.team !== AXIOM) return false;
  if (t.isUnit) {
    if (!t.udef?.hackable || t.udef.boss) return false;
    return t.hp < t.maxHp * 0.5 || t.stunUntil > w.time;
  }
  return !!t.bdef?.hackable && (t.hp < t.maxHp * 0.5 || t.stunUntil > w.time);
}

function hack(w: World, c: TickCache, e: Entity, id: number): void {
  const t = w.get(id);
  if (!t || t.team !== AXIOM || !(t.udef?.hackable || t.bdef?.hackable) || t.udef?.boss) return nextOrder(e);
  if (e.links.filter((l) => w.get(l)).length >= w.human.bandwidth) {
    w.emit({ t: 'alert', msg: 'Netrunner bandwidth full', x: e.x, y: e.y, level: 'warn', sound: 'ui_error' });
    return nextOrder(e);
  }
  const d = surfaceDist(e.x, e.y, t);
  if (d > 5) { e.hackT = 0; moveNear(w, e, t); return; }
  e.angle = turnToward(e.angle, Math.atan2(t.y - e.y, t.x - e.x), 10 * DT);
  if (!hackEligible(w, t)) {
    e.hackT = 0;
    // soften it up with the sidearm while waiting
    engage(w, c, e, t, false);
    return;
  }
  if (e.hackTarget !== t.id) {
    e.hackTarget = t.id;
    e.hackT = 0;
    w.emit({ t: 'hack_start', x: t.x, y: t.y, id: t.id, from: e.id });
  }
  e.hackT += DT;
  const need = w.human.hackTime * (t.isBuilding ? 2 : 1);
  if (e.hackT >= need) {
    convertUnit(w, t, e);
    nextOrder(e);
  }
}
