import { BUILDINGS, UNITS } from '../data/defs';
import { nearestWalkable, WALK_BLOCKED, WALK_STRUCTURE } from '../path';
import { fieldTo } from '../systems/field';
import type { TickCache } from '../systems/query';
import { setOrder } from '../systems/units';
import { AXIOM, COUNTER_OF, DAMAGE_TYPES, DT, HUMAN, type DamageType, type Pt } from '../types';
import { DIFF, type Entity, type World } from '../world';

const ROBOTS = ['skitter', 'gunner', 'sapper', 'brute', 'lancer', 'wasp', 'warden'];
const BASE_W: Record<string, number> = { skitter: 10, gunner: 7, sapper: 2.5, brute: 2.5, lancer: 2.5, wasp: 2.5, warden: 1 };
/**
 * AXIOM balance constants. Mutable so tools/headless.ts can override them for balance experiments
 * (`--set AXIOM_BAL.rampDiv=300`); the game never changes them at runtime.
 */
export const AXIOM_BAL = {
  /** compute/s before structures & ramp */
  baseRate: 0.4,
  farmCompute: 0.8,
  creepCompute: 0.0004,
  /** ramp(t) = 1 + (t / rampDiv) ^ rampExp */
  rampDiv: 240,
  rampExp: 1.25,
  /** share of income banked for the next Surge */
  surgeShare: 0.6,
  /** Surge n budget multiplier = min(1, surgeDamp0 + surgeDampStep * (n - 1)) */
  surgeDamp0: 0.45,
  surgeDampStep: 0.15,
  surgeMinInterval: 95,
  surgeIntervalStep: 4,
  garrisonBase: 5,
  garrisonPerThreat: 2,
  threatTime: 170,
  threatCompute: 4000,
  maxRobots: 1400,
};
const B = AXIOM_BAL;

export interface AxiomTuning {
  /** multiplier on everything spawned (mission scripting) */
  aggression: number;
  /** disable expansion (missions) */
  expand: boolean;
  surges: boolean;
  raids: boolean;
  /** surge interval base seconds */
  surgeInterval: number;
}

export function defaultTuning(): AxiomTuning {
  return { aggression: 1, expand: true, surges: true, raids: true, surgeInterval: 150 };
}

export function initAxiom(w: World): void {
  const D = DIFF[w.settings.difficulty];
  const A = w.axiom;
  A.surgeT = D.firstSurge;
  A.epochLen = A.epochT = D.epoch;
  A.raidT = D.firstSurge * 0.7;
  A.expandT = 45;
  A.compute = 60;
}

export function getTuning(w: World): AxiomTuning {
  return w.axiom.tuning;
}

export function updateAxiom(w: World, c: TickCache): void {
  const A = w.axiom;
  if (!A.enabled) return;
  const D = DIFF[w.settings.difficulty];
  const T = getTuning(w);

  // ---------------------------------------------------------------- economy (2 Hz)
  if (w.tick % 10 === 0) {
    let rate = B.baseRate;
    let farms = 0;
    for (const b of c.axiomBuildings) if (b.built) rate += b.bdef!.compute ?? 0;
    for (const b of c.buildings) if (b.kind === 'server_farm' && b.team === AXIOM) farms++;
    rate += farms * B.farmCompute;
    rate += A.creepTiles * B.creepCompute;
    const ramp = 1 + Math.pow(w.time / B.rampDiv, B.rampExp);
    A.farms = farms;
    A.computeRate = rate * ramp * D.compute * T.aggression;
    const inc = A.computeRate * 0.5;
    A.totalCompute += inc;
    if (T.surges) { A.surgePool += inc * B.surgeShare; A.compute += inc * (1 - B.surgeShare); }
    else A.compute += inc;
    A.threat = Math.max(1, Math.min(10, 1 + Math.floor(w.time / B.threatTime + A.totalCompute / B.threatCompute)));
    let n = 0;
    for (const u of c.units) if (u.team === AXIOM) n++;
    A.units = n;
    if (n > w.human.stats.peakSwarm) w.human.stats.peakSwarm = n;
  }

  // AXIOM structures self-assemble
  for (const b of c.axiomBuildings) {
    if (b.built) continue;
    b.progress = Math.min(1, b.progress + DT / b.bdef!.buildTime);
    b.hp = Math.max(b.hp, b.maxHp * (0.1 + 0.9 * b.progress));
    if (b.progress >= 1) { b.built = true; w.emit({ t: 'axiom_built', kind: b.kind, x: b.x, y: b.y }); }
  }

  // ---------------------------------------------------------------- endless: AXIOM never dies, it re-seeds
  if (w.flags.endless && w.tick % 200 === 50 && !c.axiomBuildings.some((b) => b.kind === 'fabricator' || b.kind === 'core')) reseed(w, c);

  // ---------------------------------------------------------------- garrison production (1 Hz, staggered)
  if (w.tick % 20 === 7) produceGarrisons(w, c);

  // ---------------------------------------------------------------- defense response (1 Hz)
  if (w.tick % 20 === 13) defend(w, c);

  // ---------------------------------------------------------------- expansion
  if (T.expand) {
    A.expandT -= DT;
    if (A.expandT <= 0) {
      A.expandT = 55 / Math.sqrt(D.compute) + w.rng.next() * 20;
      expand(w, c);
    }
  }

  // ---------------------------------------------------------------- raids
  if (T.raids) {
    A.raidT -= DT;
    if (A.raidT <= 0) {
      A.raidT = 70 + w.rng.next() * 40 - A.threat * 3;
      raid(w, c);
    }
  }

  // ---------------------------------------------------------------- surges
  if (T.surges) {
    const prev = A.surgeT;
    A.surgeT -= DT;
    if (prev > 30 && A.surgeT <= 30) {
      A.surgeFrom = c.axiomBuildings.filter((b) => b.kind === 'fabricator' || b.kind === 'core').map((b) => ({ x: b.x, y: b.y }));
      const cascade = (A.surgeN + 1) % 4 === 0;
      w.emit({ t: 'surge_warn', n: A.surgeN + 1, cascade, from: A.surgeFrom, sfx: 'alert' });
      w.alert(cascade ? 'CASCADE INBOUND in 30 s — a Colossus leads this Surge!' : `Surge ${A.surgeN + 1} inbound in 30 s`, 0, 0, 'warn');
    }
    if (A.surgeT <= 0) {
      launchSurge(w, c);
      A.surgeT = Math.max(B.surgeMinInterval, T.surgeInterval - A.surgeN * B.surgeIntervalStep) * (w.settings.difficulty === 'recruit' ? 1.15 : 1);
    }
  }
  trackSurge(w, c);

  // ---------------------------------------------------------------- Overfit epochs
  A.epochT -= DT;
  if (A.epochT <= 0) {
    A.epochT = A.epochLen;
    train(w);
  }

  // ---------------------------------------------------------------- orphan / reverted robots get orders
  if (w.tick % 20 === 3) {
    for (const u of c.units) {
      if (u.team === AXIOM && !u.order && u.queue.length === 0) {
        const home = nearestHome(c, u.x, u.y);
        if (home && Math.hypot(home.x - u.x, home.y - u.y) < 14) setOrder(u, { type: 'guard', x: home.x, y: home.y + home.size / 2 + 2 });
        else sendToField(w, u);
      }
    }
  }
}

// ------------------------------------------------------------------ helpers
function nearestHome(c: TickCache, x: number, y: number): Entity | null {
  let best: Entity | null = null, bd = Infinity;
  for (const b of c.axiomBuildings) {
    if (!b.built || (b.kind !== 'fabricator' && b.kind !== 'core')) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function humanHQ(w: World, c: TickCache): Entity | null {
  let best: Entity | null = null;
  for (const b of c.humanBuildings) if (b.kind === 'hq' && (!best || b.maxHp > best.maxHp)) best = b;
  return best ?? c.humanBuildings[0] ?? null;
}

function sendToField(w: World, u: Entity): void {
  const hq = w.entities.find((e) => e.alive && e.team === HUMAN && e.kind === 'hq') ?? w.entities.find((e) => e.alive && e.team === HUMAN && e.isBuilding);
  const tx = hq ? hq.x : w.playerStart.x, ty = hq ? hq.y : w.playerStart.y;
  setOrder(u, { type: 'flow', field: 'human', tx, ty });
}

/** Choose a robot kind given threat and the human army composition. */
export function pickRobot(w: World, c: TickCache, purpose: 'surge' | 'garrison' | 'raid'): string {
  const A = w.axiom;
  let inf = 0, veh = 0, turrets = 0, walls = 0;
  for (const u of c.units) if (u.team === HUMAN && !u.hacked) { if (u.udef!.armor === 'armored') veh++; else if (u.kind !== 'engineer') inf++; }
  for (const b of c.humanBuildings) { if (b.bdef!.weapon) turrets++; if (b.bdef!.wall) walls++; }
  const total = inf + veh + 1;
  let sum = 0;
  const weights: number[] = [];
  for (const k of ROBOTS) {
    const d = UNITS[k];
    let wgt = (d.threat ?? 1) <= A.threat ? BASE_W[k] : 0;
    if (wgt > 0) {
      if (k === 'lancer' || k === 'skitter') wgt *= 1 + (inf / total) * 0.8;
      if (k === 'brute') wgt *= 1 + (veh / total) * 1.2 + Math.min(1, walls / 30);
      if (k === 'sapper') wgt *= 1 + Math.min(1.5, (turrets + walls / 8) / 6);
      if (k === 'wasp') wgt *= 1 + Math.min(1, walls / 20);
      if (purpose === 'raid' && (k === 'skitter' || k === 'wasp')) wgt *= 1.6;
      if (purpose === 'garrison' && k === 'warden') wgt *= 1.5;
    }
    weights.push(wgt);
    sum += wgt;
  }
  let r = w.rng.next() * sum;
  for (let i = 0; i < ROBOTS.length; i++) { r -= weights[i]; if (r <= 0) return ROBOTS[i]; }
  return 'skitter';
}

function spawnAt(w: World, kind: string, home: Entity, spread = 2.5): Entity | null {
  if (w.axiom.units >= B.maxRobots) return null;
  const a = w.rng.next() * Math.PI * 2;
  const r = home.size / 2 + 0.8 + w.rng.next() * spread;
  let x = home.x + Math.cos(a) * r, y = home.y + Math.sin(a) * r;
  const def = UNITS[kind];
  if (!def.flying) {
    const nw = nearestWalkable(w.grid, x | 0, y | 0, 10);
    if (!nw) return null;
    x = nw.tx + 0.2 + w.rng.next() * 0.6; y = nw.ty + 0.2 + w.rng.next() * 0.6;
  }
  const u = w.spawnUnit(kind, AXIOM, x, y);
  u.homeId = home.id;
  w.axiom.units++;
  w.emit({ t: 'robot_spawn', x, y, kind });
  return u;
}

function produceGarrisons(w: World, c: TickCache): void {
  const A = w.axiom;
  const counts = new Map<number, number>();
  for (const u of c.units) if (u.team === AXIOM && u.homeId && u.order?.type === 'guard') counts.set(u.homeId, (counts.get(u.homeId) ?? 0) + 1);
  const cap = B.garrisonBase + A.threat * B.garrisonPerThreat;
  for (const b of c.axiomBuildings) {
    if (!b.built || (b.kind !== 'fabricator' && b.kind !== 'core') || b.stunUntil > w.time) continue;
    if ((counts.get(b.id) ?? 0) >= cap) continue;
    const kind = pickRobot(w, c, 'garrison');
    const cost = UNITS[kind].compute ?? 10;
    if (A.compute < cost) continue;
    // production speed scales with threat
    if (w.rng.next() > 0.35 + A.threat * 0.06) continue;
    A.compute -= cost;
    const u = spawnAt(w, kind, b);
    if (u) setOrder(u, { type: 'guard', x: b.x, y: b.y + b.size / 2 + 2 });
  }
}

function defend(w: World, c: TickCache): void {
  for (const b of c.axiomBuildings) {
    if (w.time - b.attackedAt > 2) continue;
    const attacker = w.get(b.attackerId);
    const ax = attacker ? attacker.x : b.x, ay = attacker ? attacker.y : b.y;
    let sent = 0;
    for (const u of c.units) {
      if (u.team !== AXIOM || u.order?.type !== 'guard') continue;
      if (Math.hypot(u.x - b.x, u.y - b.y) > 20) continue;
      setOrder(u, { type: 'amove', x: ax + (w.rng.next() - 0.5) * 2, y: ay + (w.rng.next() - 0.5) * 2 });
      u.queue.push({ type: 'guard', x: b.x, y: b.y + b.size / 2 + 2 });
      if (++sent > 24) break;
    }
  }
}

function expand(w: World, c: TickCache): void {
  const A = w.axiom;
  const relays = c.axiomBuildings.filter((b) => b.kind === 'relay').length;
  const fabs = c.axiomBuildings.filter((b) => b.kind === 'fabricator').length;
  let kind = 'relay';
  if (fabs < 1 + Math.floor(A.threat / 2) && relays >= 2 && A.compute >= 260 && w.rng.next() < 0.5) kind = 'fabricator';
  else if (A.threat >= 3 && w.rng.next() < 0.3 && A.compute >= 90) kind = 'lancet';
  else if (relays >= 4 + A.threat * 2) return;
  const cost = kind === 'fabricator' ? 260 : kind === 'lancet' ? 90 : 60;
  if (A.compute < cost) return;
  const spot = findFrontier(w, c, BUILDINGS[kind].size, kind === 'lancet');
  if (!spot) return;
  A.compute -= cost;
  const b = w.spawnBuilding(kind, AXIOM, spot.x, spot.y, false);
  w.emit({ t: 'axiom_expand', kind, x: b.x, y: b.y });
  if (w.isVisible(b.x, b.y)) w.alert(`AXIOM is constructing a ${BUILDINGS[kind].name}`, b.x, b.y, 'warn');
}

/** Find a creep-edge location for a new structure, biased toward humans / server farms. */
function findFrontier(w: World, c: TickCache, size: number, nearHumans: boolean): Pt | null {
  const targets: Pt[] = [];
  for (const b of c.buildings) if (b.kind === 'server_farm' && b.team !== AXIOM) targets.push({ x: b.x, y: b.y });
  const hq = humanHQ(w, c);
  if (hq) targets.push({ x: hq.x, y: hq.y });
  if (!targets.length) targets.push(w.playerStart);
  let best: Pt | null = null, bestScore = Infinity;
  for (let attempt = 0; attempt < 160; attempt++) {
    const x = 2 + Math.floor(w.rng.next() * (w.w - size - 4));
    const y = 2 + Math.floor(w.rng.next() * (w.h - size - 4));
    const i = (y + (size >> 1)) * w.w + x + (size >> 1);
    if (w.creep[i] < 0.6) continue;
    // must be near the creep edge
    let edge = false;
    for (let k = 0; k < 8 && !edge; k++) {
      const a = (k / 8) * Math.PI * 2;
      const ex = (x + Math.cos(a) * 4) | 0, ey = (y + Math.sin(a) * 4) | 0;
      if (w.inBounds(ex, ey) && w.creep[ey * w.w + ex] < 0.3) edge = true;
    }
    if (!edge) continue;
    if (!areaFree(w, x, y, size)) continue;
    // keep distance from structures
    let ok = true;
    for (const b of c.buildings) {
      const d = Math.hypot(b.x - (x + size / 2), b.y - (y + size / 2));
      if (b.team === HUMAN && d < 9) { ok = false; break; }
      if (b.team === AXIOM && d < (nearHumans ? 3.5 : 6)) { ok = false; break; }
    }
    if (!ok) continue;
    let score = Infinity;
    for (const t of targets) score = Math.min(score, Math.hypot(t.x - x, t.y - y));
    score += w.rng.next() * 6;
    if (score < bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}

function areaFree(w: World, x: number, y: number, size: number): boolean {
  for (let yy = y - 1; yy <= y + size; yy++) for (let xx = x - 1; xx <= x + size; xx++) {
    if (!w.inBounds(xx, yy)) return false;
    const code = w.grid.walk[yy * w.w + xx];
    if (code === WALK_BLOCKED || code === WALK_STRUCTURE) return false;
  }
  return true;
}

/** Endless mode: spawn a new Fabricator (+Relay) far from the humans when all production is gone. */
function reseed(w: World, c: TickCache): void {
  const hq = humanHQ(w, c);
  const hx = hq ? hq.x : w.playerStart.x, hy = hq ? hq.y : w.playerStart.y;
  let best: Pt | null = null, bd = -1;
  for (let k = 0; k < 200; k++) {
    const x = 3 + Math.floor(w.rng.next() * (w.w - 8)), y = 3 + Math.floor(w.rng.next() * (w.h - 8));
    if (!areaFree(w, x, y, 3)) continue;
    const d = Math.hypot(x - hx, y - hy) + w.rng.next() * 10;
    if (d > bd) { bd = d; best = { x, y }; }
  }
  if (!best) return;
  w.spawnBuilding('fabricator', AXIOM, best.x, best.y, false);
  w.alert('AXIOM has re-seeded a Fabricator somewhere in the city', 0, 0, 'warn');
}

function raid(w: World, c: TickCache): void {
  const A = w.axiom;
  const hq = humanHQ(w, c);
  if (!hq) return;
  // most exposed structure: far from HQ, few defenders
  let target: Entity | null = null, best = -Infinity;
  for (const b of c.humanBuildings) {
    if (b.bdef!.wall) continue;
    const d = Math.hypot(b.x - hq.x, b.y - hq.y);
    const s = d + w.rng.next() * 8 - (b.bdef!.weapon ? 6 : 0);
    if (s > best) { best = s; target = b; }
  }
  if (!target) return;
  const size = Math.round((3 + A.threat * 1.6) * DIFF[w.settings.difficulty].surge);
  const goals: number[] = [];
  for (let y = target.ty; y < target.ty + target.size; y++) for (let x = target.tx; x < target.tx + target.size; x++) goals.push(y * w.w + x);
  const key = 'raid:' + target.id;
  fieldTo(w, key, goals);
  // pull from garrisons first, then spawn with compute
  let sent = 0;
  const pool = c.units.filter((u) => u.team === AXIOM && u.order?.type === 'guard').sort((a, b) => Math.hypot(a.x - target!.x, a.y - target!.y) - Math.hypot(b.x - target!.x, b.y - target!.y));
  for (const u of pool) {
    if (sent >= size) break;
    setOrder(u, { type: 'flow', field: key, tx: target.x, ty: target.y });
    sent++;
  }
  const home = nearestHome(c, target.x, target.y);
  while (sent < size && home) {
    const kind = pickRobot(w, c, 'raid');
    const cost = UNITS[kind].compute ?? 10;
    if (A.compute < cost) break;
    A.compute -= cost;
    const u = spawnAt(w, kind, home);
    if (!u) break;
    setOrder(u, { type: 'flow', field: key, tx: target.x, ty: target.y });
    sent++;
  }
  if (sent > 0) w.emit({ t: 'raid', x: target.x, y: target.y, n: sent });
}

function launchSurge(w: World, c: TickCache): void {
  const A = w.axiom;
  const D = DIFF[w.settings.difficulty];
  A.surgeN++;
  const n = A.surgeN;
  const cascade = n % 4 === 0;
  // early surges are damped: AXIOM is still 'learning' (Surge 1 ≈ 20–25 small robots on Veteran)
  let budget = A.surgePool * D.surge * Math.min(1, B.surgeDamp0 + B.surgeDampStep * (n - 1));
  A.surgePool = 0;
  const homes = c.axiomBuildings.filter((b) => b.built && (b.kind === 'fabricator' || b.kind === 'core'));
  if (!homes.length) return;
  const hq = humanHQ(w, c);
  const tx = hq ? hq.x : w.playerStart.x, ty = hq ? hq.y : w.playerStart.y;
  let spawned = 0;
  if (cascade) {
    const home = homes.reduce((a, b) => (Math.hypot(a.x - tx, a.y - ty) < Math.hypot(b.x - tx, b.y - ty) ? a : b));
    const boss = spawnAt(w, 'colossus', home, 1);
    if (boss) { boss.squad = n; setOrder(boss, { type: 'flow', field: 'human', tx, ty }); spawned++; }
    budget *= 0.75;
  }
  let guard = 0;
  while (budget > 0 && spawned < 400) {
    const kind = pickRobot(w, c, 'surge');
    const cost = UNITS[kind].compute ?? 10;
    if (budget < cost && budget < 6) break;
    budget -= cost;
    const home = homes[(spawned + guard) % homes.length];
    const u = spawnAt(w, kind, home, 3.5);
    if (!u) { if (++guard > 50) break; continue; }
    u.squad = n;
    setOrder(u, { type: 'flow', field: 'human', tx, ty });
    spawned++;
  }
  // part of the standing garrison joins (a quarter early on, half later)
  const join = n <= 2 ? 0.25 : 0.5;
  for (const u of c.units) {
    if (u.team === AXIOM && u.order?.type === 'guard' && w.rng.next() < join) {
      u.squad = n;
      setOrder(u, { type: 'flow', field: 'human', tx, ty });
      spawned++;
    }
  }
  w.flags.surgeSize = spawned;
  A.surgeActive = true;
  w.emit({ t: 'surge_start', n, cascade, count: spawned, sfx: 'surge_siren' });
  w.alert(cascade ? `CASCADE ${n} — ${spawned} machines and a Colossus are coming!` : `SURGE ${n} — ${spawned} machines inbound!`, tx, ty, 'danger');
}

function trackSurge(w: World, c: TickCache): void {
  const A = w.axiom;
  if (!A.surgeActive || w.tick % 20 !== 0) return;
  let alive = 0;
  for (const u of c.units) if (u.team === AXIOM && u.squad === A.surgeN) alive++;
  const size = (w.flags.surgeSize as number) || 1;
  if (alive <= Math.max(2, size * 0.1)) {
    A.surgeActive = false;
    w.human.stats.surgesSurvived++;
    w.emit({ t: 'surge_end', n: A.surgeN });
    w.alert(`Surge ${A.surgeN} repelled`, 0, 0, 'info');
    // stragglers go home
    for (const u of c.units) if (u.team === AXIOM && u.squad === A.surgeN) u.squad = 0;
  }
}

/** Overfit: retrain on the damage taken this epoch. */
export function train(w: World): void {
  const A = w.axiom;
  A.epoch++;
  let total = 0;
  let top: DamageType = 'kinetic';
  for (const k of DAMAGE_TYPES) { total += A.dmgTaken[k]; if (A.dmgTaken[k] > A.dmgTaken[top]) top = k; }
  if (total < 150) {
    w.emit({ t: 'epoch', epoch: A.epoch, type: null, sfx: 'epoch' });
    return;
  }
  const share = A.dmgTaken[top] / total;
  const gain = share > 0.75 ? 0.15 : share > 0.5 ? 0.12 : 0.08;
  A.resist[top] = Math.min(0.6, Math.round((A.resist[top] + gain) * 100) / 100);
  const counter = COUNTER_OF[top];
  A.vuln[counter] = Math.min(0.4, Math.round((A.vuln[counter] + gain * 0.67) * 100) / 100);
  A.lastAdapt = top;
  for (const k of DAMAGE_TYPES) A.dmgTaken[k] *= 0.25;
  w.emit({ t: 'epoch', epoch: A.epoch, type: top, counter, resist: A.resist[top], vuln: A.vuln[counter], share, sfx: 'epoch' });
}
