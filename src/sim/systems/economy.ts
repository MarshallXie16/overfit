import { BUILDINGS, PROTOCOLS, RESEARCH, UNITS } from '../data/defs';
import { nearestWalkable } from '../path';
import { AXIOM, DT, HUMAN, NEUTRAL } from '../types';
import type { Entity, World } from '../world';
import { applyDamage, convertUnit, stunArea } from './combat';
import type { TickCache } from './query';
import { autoHarvest, setOrder } from './units';

export const MAX_POP = 150;
const FARM_RADIUS = 4.5;

export function updateEconomy(w: World, c: TickCache): void {
  const H = w.human;
  // ---------------------------------------------------------------- power & pop
  let power = 0, used = 0, popCap = 0;
  for (const b of c.humanBuildings) {
    if (!b.built || b.hacked) continue;
    const p = b.bdef!.power;
    if (p > 0) power += p; else used -= p;
    popCap += b.bdef!.pop ?? 0;
  }
  const wasBrown = H.brownout;
  H.power = power;
  H.powerUsed = used;
  H.popCap = Math.min(MAX_POP, popCap);
  if (H.brownout !== wasBrown && w.tick > 2) {
    w.emit({ t: 'brownout', on: H.brownout });
    if (H.brownout) w.alert('BROWNOUT — production and turrets slowed. Build Generators.', 0, 0, 'warn');
  }
  let pop = 0;
  for (const u of c.units) if (u.team === HUMAN && !u.hacked) pop += u.udef!.pop;
  // queued units reserve pop
  for (const b of c.humanBuildings) for (const p of b.prod) pop += UNITS[p.kind]?.pop ?? 0;
  H.pop = pop;

  // ---------------------------------------------------------------- construction
  for (const b of c.buildings) {
    if (b.built) continue;
    if (b.builders > 0) {
      const rate = Math.pow(b.builders, 0.75) / b.bdef!.buildTime;
      const before = b.progress;
      b.progress = Math.min(1, b.progress + rate * DT);
      b.hp = Math.min(b.maxHp, b.hp + (b.progress - before) * b.maxHp * 0.9);
      if (b.progress >= 1) {
        b.built = true;
        H.stats.built++;
        w.emit({ t: 'build_done', id: b.id, kind: b.kind, x: b.x, y: b.y, sfx: 'build_done' });
        if (b.bdef!.trains || b.bdef!.research) w.fieldDirty = true;
      }
    }
    b.builders = 0;
  }

  // ---------------------------------------------------------------- production & research
  const ratio = H.powerRatio;
  for (const b of c.humanBuildings) {
    if (!b.built || b.hacked) continue;
    if (b.prod.length) {
      const item = b.prod[0];
      const m = b.bdef!.power < 0 ? ratio : 1;
      item.t += DT * m;
      if (item.t >= item.total) {
        b.prod.shift();
        spawnFromBuilding(w, b, item.kind);
      }
    }
    if (b.researching) {
      const r = b.researching;
      r.t += DT * (b.bdef!.power < 0 ? ratio : 1);
      if (r.t >= r.total) {
        b.researching = null;
        completeResearch(w, r.id);
      }
    }
  }

  // ---------------------------------------------------------------- protocols cooldown
  for (const k in H.protocolCd) if (H.protocolCd[k] > 0) H.protocolCd[k] = Math.max(0, H.protocolCd[k] - DT);

  // ---------------------------------------------------------------- delayed effects
  for (let i = w.delayed.length - 1; i >= 0; i--) {
    const d = w.delayed[i];
    if (w.time < d.at) continue;
    w.delayed.splice(i, 1);
    if (d.kind === 'orbital') {
      for (const e of w.entities) {
        if (!e.alive || e.team !== AXIOM) continue;
        const dist = Math.hypot(e.x - d.x, e.y - d.y) - e.radius;
        if (dist > d.r) continue;
        const fall = 1 - 0.4 * Math.max(0, dist) / d.r;
        applyDamage(w, e, 400 * fall * (e.isBuilding ? 1.5 : e.armor === 'armored' ? 1.5 : 0.9), 'explosive', HUMAN, 0);
      }
      w.emit({ t: 'orbital', x: d.x, y: d.y, r: d.r, sfx: 'orbital_strike' });
    } else if (d.kind === 'supply') {
      H.scrap += 200;
      H.stats.scrapGathered += 200;
      w.emit({ t: 'supply_land', x: d.x, y: d.y, sfx: 'supply_drop' });
    }
  }

  // ---------------------------------------------------------------- server farms (every 0.5 s)
  if (w.tick % 10 === 0) {
    for (const f of c.buildings) {
      if (f.kind !== 'server_farm') continue;
      let h = 0, a = 0;
      const n = w.hash.queryRadius(f.x, f.y, FARM_RADIUS + 1, c.buf);
      for (let i = 0; i < n; i++) {
        const u = w.byId.get(c.buf[i]);
        if (!u || !u.alive || Math.hypot(u.x - f.x, u.y - f.y) > FARM_RADIUS) continue;
        if (u.team === HUMAN) h++; else if (u.team === AXIOM) a++;
      }
      const prev = f.team;
      if (h > 0 && a === 0) f.capture = Math.min(1, f.capture + 0.05);
      else if (a > 0 && h === 0) f.capture = Math.max(-1, f.capture - 0.05);
      if (f.capture >= 1) f.team = HUMAN;
      else if (f.capture <= -1) f.team = AXIOM;
      else if ((f.team === HUMAN && f.capture < 0) || (f.team === AXIOM && f.capture > 0)) f.team = NEUTRAL;
      if (f.team !== prev) {
        const known = !!w.explored[(f.y | 0) * w.w + (f.x | 0)];
        if (f.team === HUMAN) w.alert('Server Farm captured — Data income online', f.x, f.y, 'info');
        else if (f.team === AXIOM && known) w.alert('AXIOM seized a Server Farm', f.x, f.y, 'warn');
        w.emit({ t: 'farm', id: f.id, team: f.team, x: f.x, y: f.y });
      }
      if (f.team === HUMAN) { H.data += 0.25; H.stats.dataEarned += 0.25; }
    }
  }

  // ---------------------------------------------------------------- wreck expiry
  if (w.tick % 20 === 0) {
    for (const r of c.resources) if (r.cat === 'wreck' && w.time >= r.expire) w.kill(r);
  }
}

function spawnFromBuilding(w: World, b: Entity, kind: string): void {
  const def = UNITS[kind];
  // exit at the building edge facing the rally point (or south)
  const rx = b.rally ? b.rally.x : b.x;
  const ry = b.rally ? b.rally.y : b.ty + b.size + 2;
  const dx = rx - b.x, dy = ry - b.y, d = Math.hypot(dx, dy) || 1;
  let ex = b.x + (dx / d) * (b.size / 2 + 0.7), ey = b.y + (dy / d) * (b.size / 2 + 0.7);
  const nw = nearestWalkable(w.grid, ex | 0, ey | 0, 8);
  if (nw) { ex = nw.tx + 0.5 + (w.rng.next() - 0.5) * 0.3; ey = nw.ty + 0.5 + (w.rng.next() - 0.5) * 0.3; }
  const u = w.spawnUnit(kind, HUMAN, ex, ey);
  u.angle = Math.atan2(dy, dx);
  u.turretAngle = u.angle;
  w.human.stats.trained++;
  w.emit({ t: 'unit_ready', id: u.id, kind, x: u.x, y: u.y, sfx: 'unit_ready' });
  if (b.rally) {
    const target = b.rally;
    // rally onto scrap → engineers harvest
    if (def.abilities?.includes('harvest')) {
      const node = w.entities.find((r) => r.alive && (r.cat === 'resource' || r.cat === 'wreck') && Math.hypot(r.x - target.x, r.y - target.y) < 1.2);
      if (node) { setOrder(u, { type: 'harvest', id: node.id }); return; }
    }
    // spread arrivals around the rally point (golden-angle spiral) so units don't pile onto one spot
    let rx2 = target.x, ry2 = target.y;
    for (let j = 0; j < 24; j++) {
      const k = (u.id + j) % 24;
      if (k === 0) continue;
      const a = k * 2.39996, r = 0.65 * Math.sqrt(k);
      const sx = target.x + Math.cos(a) * r, sy = target.y + Math.sin(a) * r;
      if (roomy(w, Math.floor(sx), Math.floor(sy))) { rx2 = sx; ry2 = sy; break; }
    }
    setOrder(u, def.weapon ? { type: 'amove', x: rx2, y: ry2 } : { type: 'move', x: rx2, y: ry2 });
  } else if (def.abilities?.includes('harvest')) {
    // engineers auto-harvest by default
    autoHarvestSoon(w, u);
  } else {
    setOrder(u, { type: 'move', x: ex + dx / d * 1.5, y: ey + dy / d * 1.5 });
  }
}

/** Tile and its 8 neighbours are walkable (a spot that doesn't plug a corridor). */
function roomy(w: World, tx: number, ty: number): boolean {
  for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) if (!w.isWalkableTile(x, y)) return false;
  return true;
}

function autoHarvestSoon(w: World, u: Entity): void {
  // find nearest explored scrap within 12 tiles
  let best: Entity | null = null, bd = 12;
  for (const r of w.entities) {
    if (!r.alive || r.cat !== 'resource') continue;
    const d = Math.hypot(r.x - u.x, r.y - u.y);
    if (d < bd) { bd = d; best = r; }
  }
  if (best) setOrder(u, { type: 'harvest', id: best.id });
}

export function completeResearch(w: World, id: string): void {
  const H = w.human;
  H.research.add(id);
  switch (id) {
    case 'kinetic1': case 'kinetic2': H.dmgMul.kinetic += 0.2; break;
    case 'energy1': case 'energy2': H.dmgMul.energy += 0.2; break;
    case 'explosive1': case 'explosive2': H.dmgMul.explosive += 0.2; break;
    case 'armor1': case 'armor2': {
      const before = H.hpMul;
      H.hpMul += 0.15;
      for (const e of w.entities) {
        if (e.alive && e.isUnit && e.team === HUMAN && !e.hacked) {
          const f = H.hpMul / before;
          e.maxHp *= f; e.hp *= f;
        }
      }
      break;
    }
    case 'salvage': H.harvestMul = 1.3; H.wreckMul = 1.5; break;
    case 'bandwidth': H.bandwidth = 5; H.hackTime = 1.1; break;
  }
  w.emit({ t: 'research_done', id, name: RESEARCH[id]?.name, sfx: 'research_done' });
}

// ------------------------------------------------------------------ protocols
export function protocolAvailable(w: World, id: string): { ok: boolean; reason?: string } {
  const p = PROTOCOLS[id];
  if (!p) return { ok: false, reason: 'Unknown' };
  if (p.requires && !w.human.research.has(p.requires)) return { ok: false, reason: `Requires ${RESEARCH[p.requires].name}` };
  if ((w.human.protocolCd[id] ?? 0) > 0) return { ok: false, reason: 'Cooling down' };
  if (w.human.data < p.data) return { ok: false, reason: 'Not enough Data' };
  if (w.countBuildings(HUMAN, 'hq') === 0) return { ok: false, reason: 'Requires an HQ' };
  return { ok: true };
}

export function useProtocol(w: World, id: string, x: number, y: number): boolean {
  const chk = protocolAvailable(w, id);
  if (!chk.ok) { w.emit({ t: 'error', msg: chk.reason }); return false; }
  const p = PROTOCOLS[id];
  if (!w.explored[(y | 0) * w.w + (x | 0)]) { w.emit({ t: 'error', msg: 'Target must be explored' }); return false; }
  w.human.data -= p.data;
  w.human.protocolCd[id] = p.cooldown;
  switch (id) {
    case 'supply':
      w.delayed.push({ at: w.time + 2.5, kind: 'supply', x, y, r: p.radius });
      w.emit({ t: 'supply_warn', x, y });
      break;
    case 'emp': {
      const n = stunArea(w, x, y, p.radius, 5);
      w.emit({ t: 'emp', x, y, r: p.radius, n, sfx: 'emp' });
      break;
    }
    case 'orbital':
      w.delayed.push({ at: w.time + 2, kind: 'orbital', x, y, r: p.radius });
      w.emit({ t: 'orbital_warn', x, y, r: p.radius, sfx: 'orbital_warn' });
      break;
    case 'override': {
      const cands = w.entities
        .filter((e) => e.alive && e.isUnit && e.team === AXIOM && e.udef?.hackable && !e.udef.boss && Math.hypot(e.x - x, e.y - y) <= p.radius)
        .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
        .slice(0, 8);
      for (const e of cands) convertUnit(w, e, null, 60);
      w.emit({ t: 'override', x, y, r: p.radius, n: cands.length, sfx: 'hack_success' });
      break;
    }
  }
  return true;
}

export function canAfford(w: World, cost: { scrap: number; data?: number }): boolean {
  return w.human.scrap >= cost.scrap && w.human.data >= (cost.data ?? 0);
}

export function pay(w: World, cost: { scrap: number; data?: number }, sign = 1): void {
  w.human.scrap -= cost.scrap * sign;
  w.human.data -= (cost.data ?? 0) * sign;
}

export function buildingName(kind: string): string {
  return BUILDINGS[kind]?.name ?? kind;
}
