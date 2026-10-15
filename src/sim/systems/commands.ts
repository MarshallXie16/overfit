import { BUILDINGS, RESEARCH, UNITS } from '../data/defs';
import { nearestWalkable } from '../path';
import { AXIOM, HUMAN } from '../types';
import type { Command, Entity, Order, World } from '../world';
import { canAfford, pay, useProtocol } from './economy';
import { hackEligible, setOrder } from './units';

const MAX_QUEUE = 6;

export function applyCommands(w: World): void {
  const cmds = w.commands;
  w.commands = [];
  for (const cmd of cmds) apply(w, cmd);
}

function own(w: World, ids: number[]): Entity[] {
  const out: Entity[] = [];
  for (const id of ids) {
    const e = w.get(id);
    if (e && e.team === HUMAN) out.push(e);
  }
  return out;
}

function err(w: World, msg: string): void {
  w.emit({ t: 'error', msg });
}

function apply(w: World, cmd: Command): void {
  switch (cmd.c) {
    case 'order': {
      const units = own(w, cmd.ids).filter((e) => e.isUnit);
      const o = cmd.order;
      if ((o.type === 'move' || o.type === 'amove') && units.length > 1) {
        formationOrders(w, units, o.type, o.x, o.y, !!cmd.queue);
      } else {
        for (const u of units) {
          if (o.type === 'hack' && !u.udef?.abilities?.includes('hack')) continue;
          setOrder(u, { ...o } as Order, cmd.queue);
        }
      }
      break;
    }
    case 'stop':
      for (const u of own(w, cmd.ids)) if (u.isUnit) setOrder(u, null);
      break;
    case 'smart':
      smart(w, cmd.ids, cmd.x, cmd.y, cmd.targetId, !!cmd.queue);
      break;
    case 'rally':
      for (const b of own(w, cmd.ids)) if (b.isBuilding && b.bdef?.trains) b.rally = { x: cmd.x, y: cmd.y };
      break;
    case 'place': {
      const def = BUILDINGS[cmd.kind];
      if (!def || def.side !== 'human') return;
      if (!w.requirementsMet(def.requires)) return err(w, `Requires ${def.requires!.map((r) => BUILDINGS[r]?.name ?? RESEARCH[r]?.name).join(', ')}`);
      if (!canAfford(w, def.cost)) return err(w, 'Not enough scrap');
      const chk = w.canPlace(cmd.kind, cmd.tx, cmd.ty);
      if (!chk.ok) return err(w, chk.reason ?? 'Cannot build there');
      pay(w, def.cost);
      const site = w.spawnBuilding(cmd.kind, HUMAN, cmd.tx, cmd.ty, false);
      pushUnitsOut(w, site);
      w.emit({ t: 'build_place', kind: cmd.kind, x: site.x, y: site.y, sfx: 'build_place' });
      const builders = own(w, cmd.builders).filter((u) => u.udef?.abilities?.includes('build'));
      for (const b of builders) {
        if (b.carrying > 0 && !cmd.queue) { /* keep cargo; deposit later */ }
        setOrder(b, { type: 'build', id: site.id }, cmd.queue);
      }
      break;
    }
    case 'cancelBuild': {
      const b = w.get(cmd.id);
      if (!b || b.team !== HUMAN || b.built) return;
      pay(w, b.bdef!.cost, -1);
      w.kill(b);
      break;
    }
    case 'demolish': {
      const b = w.get(cmd.id);
      if (!b || b.team !== HUMAN || !b.isBuilding || b.kind === 'hq' && w.countBuildings(HUMAN, 'hq') <= 1) return;
      if (b.hacked) { w.kill(b); return; }
      const refund = Math.floor(b.bdef!.cost.scrap * 0.5 * (b.hp / b.maxHp));
      w.human.scrap += refund;
      w.emit({ t: 'death', id: b.id, kind: b.kind, team: b.team, x: b.x, y: b.y, big: true, cat: 'building', size: b.size });
      w.kill(b);
      break;
    }
    case 'train': {
      const b = w.get(cmd.building);
      const def = UNITS[cmd.kind];
      if (!b || b.team !== HUMAN || !b.built || !def || !b.bdef?.trains?.includes(cmd.kind)) return;
      if (!w.requirementsMet(def.requires)) return err(w, `Requires ${def.requires!.map((r) => BUILDINGS[r]?.name ?? RESEARCH[r]?.name).join(', ')}`);
      if (b.prod.length >= MAX_QUEUE) return err(w, 'Queue full');
      if (!canAfford(w, def.cost)) return err(w, def.cost.data && w.human.data < def.cost.data ? 'Not enough Data' : 'Not enough scrap');
      if (w.human.pop + def.pop > w.human.popCap) return err(w, 'Population cap reached — build Habitats');
      pay(w, def.cost);
      b.prod.push({ kind: cmd.kind, t: 0, total: def.buildTime });
      w.human.pop += def.pop;
      w.emit({ t: 'train_queued', kind: cmd.kind, sfx: 'ui_command' });
      break;
    }
    case 'cancelTrain': {
      const b = w.get(cmd.building);
      if (!b || b.team !== HUMAN) return;
      const item = b.prod[cmd.index];
      if (!item) return;
      b.prod.splice(cmd.index, 1);
      pay(w, UNITS[item.kind].cost, -1);
      break;
    }
    case 'research': {
      const b = w.get(cmd.building);
      const r = RESEARCH[cmd.id];
      if (!b || b.team !== HUMAN || !b.built || !b.bdef?.research || !r) return;
      if (b.researching) return err(w, 'Already researching');
      if (w.human.research.has(r.id)) return;
      for (const other of w.entities) if (other.alive && other.researching?.id === r.id) return err(w, 'Already in progress');
      if (!w.requirementsMet(r.requires)) return err(w, 'Requires ' + r.requires!.map((q) => RESEARCH[q]?.name).join(', '));
      if (!canAfford(w, r.cost)) return err(w, w.human.data < (r.cost.data ?? 0) ? 'Not enough Data' : 'Not enough scrap');
      pay(w, r.cost);
      b.researching = { id: r.id, t: 0, total: r.time };
      w.emit({ t: 'research_start', id: r.id, sfx: 'ui_command' });
      break;
    }
    case 'cancelResearch': {
      const b = w.get(cmd.building);
      if (!b || !b.researching) return;
      pay(w, RESEARCH[b.researching.id].cost, -1);
      b.researching = null;
      break;
    }
    case 'protocol':
      useProtocol(w, cmd.id, cmd.x, cmd.y);
      break;
  }
}

/** Spread move targets into a loose formation around (x,y). */
function formationOrders(w: World, units: Entity[], type: 'move' | 'amove', x: number, y: number, queue: boolean): void {
  const n = units.length;
  // centroid & facing
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= n; cy /= n;
  const slots: { x: number; y: number }[] = [];
  const spacing = 0.85;
  // spiral ring slots
  slots.push({ x, y });
  for (let ring = 1; slots.length < n * 2 && ring < 12; ring++) {
    const count = Math.floor(ring * 6.3);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + ring * 0.37;
      const sx = x + Math.cos(a) * ring * spacing, sy = y + Math.sin(a) * ring * spacing;
      if (w.isWalkableTile(sx | 0, sy | 0)) slots.push({ x: sx, y: sy });
    }
  }
  // greedy assignment: units sorted by distance to target take closest free slot (relative offset preserved)
  const order = units.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  const used = new Array(slots.length).fill(false);
  // big units first get inner slots
  order.sort((a, b) => b.radius - a.radius);
  for (const u of order) {
    // preferred position keeps relative offset (compressed)
    const px = x + (u.x - cx) * 0.35, py = y + (u.y - cy) * 0.35;
    let bi = -1, bd = Infinity;
    for (let i = 0; i < slots.length; i++) {
      if (used[i]) continue;
      const d = Math.hypot(slots[i].x - px, slots[i].y - py) + Math.hypot(slots[i].x - x, slots[i].y - y) * 0.6;
      if (d < bd) { bd = d; bi = i; }
    }
    const s = bi >= 0 ? slots[bi] : { x, y };
    if (bi >= 0) {
      used[bi] = true;
      // big units occupy neighbouring slots too
      if (u.radius > 0.5) for (let i = 0; i < slots.length; i++) if (!used[i] && Math.hypot(slots[i].x - s.x, slots[i].y - s.y) < u.radius * 1.6) used[i] = true;
    }
    setOrder(u, { type, x: s.x, y: s.y }, queue);
  }
}

function smart(w: World, ids: number[], x: number, y: number, targetId: number, queue: boolean): void {
  const sel = own(w, ids);
  const units = sel.filter((e) => e.isUnit);
  const buildings = sel.filter((e) => e.isBuilding);
  if (buildings.length && !units.length) {
    for (const b of buildings) if (b.bdef?.trains) b.rally = { x, y };
    w.emit({ t: 'rally_set', x, y, sfx: 'ui_command' });
    return;
  }
  const t = targetId ? w.get(targetId) : undefined;
  const moveGroup: Entity[] = [];
  for (const u of units) {
    const ab = u.udef?.abilities ?? [];
    if (t) {
      if (t.team === AXIOM || (t.team !== HUMAN && t.team !== 0)) {
        if (ab.includes('hack') && (t.udef?.hackable || t.bdef?.hackable) && !t.udef?.boss && hackEligible(w, t)) { setOrder(u, { type: 'hack', id: t.id }, queue); continue; }
        if (u.udef?.weapon) { setOrder(u, { type: 'attack', id: t.id }, queue); continue; }
      } else if (t.cat === 'resource' || t.cat === 'wreck') {
        if (ab.includes('harvest')) { setOrder(u, { type: 'harvest', id: t.id }, queue); continue; }
      } else if (t.team === HUMAN && t.isBuilding) {
        if (ab.includes('build') && !t.built) { setOrder(u, { type: 'build', id: t.id }, queue); continue; }
        if (ab.includes('harvest') && u.carrying > 0 && t.bdef?.dropoff) { setOrder(u, { type: 'return' }, queue); continue; }
        if (ab.includes('repair') && t.hp < t.maxHp) { setOrder(u, { type: 'repair', id: t.id }, queue); continue; }
      } else if (t.team === HUMAN && t.isUnit && t !== u) {
        if (ab.includes('repair') && t.udef?.armor === 'armored' && t.hp < t.maxHp) { setOrder(u, { type: 'repair', id: t.id }, queue); continue; }
      }
    }
    moveGroup.push(u);
  }
  if (moveGroup.length > 1) formationOrders(w, moveGroup, 'move', x, y, queue);
  else for (const u of moveGroup) setOrder(u, { type: 'move', x, y }, queue);
  if (units.length) w.emit({ t: 'ack', x, y, kind: t ? (t.team === AXIOM ? 'attack' : 'interact') : 'move' });
}

/** Units standing inside a new footprint get nudged to the nearest free tile. */
export function pushUnitsOut(w: World, b: Entity): void {
  for (const e of w.entities) {
    if (!e.alive || !e.isUnit || e.flying) continue;
    if (e.x >= b.tx - e.radius && e.x <= b.tx + b.size + e.radius && e.y >= b.ty - e.radius && e.y <= b.ty + b.size + e.radius) {
      const nw = nearestWalkable(w.grid, e.x | 0, e.y | 0, 8);
      if (nw) {
        // place just outside, nearest edge
        const p = { x: nw.tx + 0.5, y: nw.ty + 0.5 };
        e.x = e.px = p.x; e.y = e.py = p.y;
        e.path = null;
      }
    }
  }
}
