import { BUILDINGS, RESEARCH, UNITS } from './data/defs';
import { AXIOM, HUMAN } from './types';
import type { Entity, World } from './world';

/**
 * Scripted human player used by the headless soak tests and the attract-mode demo.
 * Issues the same Commands a real player would.
 */
export class Bot {
  nextThink = 0;
  attackAt = 0;
  level: number;
  constructor(level = 1) { this.level = level; }

  think(w: World): void {
    if (w.time < this.nextThink) return;
    this.nextThink = w.time + 1;
    const H = w.human;
    const mine = w.entities.filter((e) => e.alive && e.team === HUMAN);
    const hq = mine.find((e) => e.kind === 'hq');
    if (!hq) return;
    const units = mine.filter((e) => e.isUnit);
    const engineers = units.filter((e) => e.kind === 'engineer');
    const army = units.filter((e) => e.kind !== 'engineer' && e.udef?.weapon);
    const blds = mine.filter((e) => e.isBuilding);
    const count = (k: string) => blds.filter((b) => b.kind === k).length;
    const building = (k: string) => blds.some((b) => b.kind === k && !b.built);

    // idle engineers → finish construction, else harvest
    const sites = blds.filter((b) => !b.built);
    for (const e of engineers) {
      if (e.order) continue;
      const site = sites.find((s) => Math.hypot(s.x - e.x, s.y - e.y) < 30);
      if (site) w.commands.push({ c: 'smart', ids: [e.id], x: site.x, y: site.y, targetId: site.id });
      else {
        const node = nearest(w, e, (r) => r.cat === 'resource' || r.cat === 'wreck');
        if (node) w.commands.push({ c: 'smart', ids: [e.id], x: node.x, y: node.y, targetId: node.id });
      }
    }

    // build order
    const want: string[] = [];
    if (H.power - H.powerUsed < 4 || (count('generator') < 1)) want.push('generator');
    if (H.popCap - H.pop < 5 && H.popCap < 150) want.push('habitat');
    if (count('barracks') < 1) want.push('barracks');
    if (count('gun_turret') < 2 && w.time > 60) want.push('gun_turret');
    if (count('lab') < 1 && w.time > 150) want.push('lab');
    if (count('factory') < 1 && w.time > 260) want.push('factory');
    if (count('barracks') < 2 && w.time > 360) want.push('barracks');
    if (count('tesla') < 2 && w.time > 400) want.push('tesla');
    if (count('depot') < 1 && w.time > 200) want.push('depot');
    for (const kind of want) {
      if (building(kind) || sites.length >= 2) break;
      const def = BUILDINGS[kind];
      if (!w.requirementsMet(def.requires) || H.scrap < def.cost.scrap) continue;
      const spot = findSpot(w, hq, def.size, kind);
      if (!spot) continue;
      const builders = engineers.filter((e) => e.order?.type !== 'build').slice(0, 2).map((e) => e.id);
      if (!builders.length) break;
      w.commands.push({ c: 'place', kind, tx: spot.x, ty: spot.y, builders });
      break;
    }

    // production
    if (engineers.length < 14 && hq.prod.length < 2) w.commands.push({ c: 'train', building: hq.id, kind: 'engineer' });
    for (const b of blds) {
      if (!b.built || b.prod.length >= 2) continue;
      if (b.kind === 'barracks') {
        const opts = ['rifleman', 'rifleman', 'arc_trooper', 'rocketeer'];
        if (w.requirementsMet(UNITS.netrunner.requires) && units.filter((u) => u.kind === 'netrunner').length < 2) opts.push('netrunner');
        const k = opts[Math.floor(w.rng.next() * opts.length)];
        if (H.scrap > (UNITS[k].cost.scrap + 50)) w.commands.push({ c: 'train', building: b.id, kind: k });
      }
      if (b.kind === 'factory') {
        const k = w.requirementsMet(UNITS.volt.requires) && w.rng.next() < 0.4 ? 'volt' : 'bulldog';
        if (H.scrap > UNITS[k].cost.scrap + 80) w.commands.push({ c: 'train', building: b.id, kind: k });
      }
      if (b.kind === 'lab' && !b.researching) {
        for (const id of ['salvage', 'kinetic1', 'energy1', 'armor1', 'explosive1', 'proto_emp', 'railguns', 'kinetic2', 'energy2']) {
          const r = RESEARCH[id];
          if (H.research.has(id) || !w.requirementsMet(r.requires)) continue;
          if (H.scrap >= r.cost.scrap && H.data >= (r.cost.data ?? 0)) w.commands.push({ c: 'research', building: b.id, id });
          break;
        }
      }
    }
    // rally all producers in front of base
    const front = frontPoint(w, hq);
    for (const b of blds) if (b.bdef?.trains && b.kind !== 'hq' && !b.rally) w.commands.push({ c: 'rally', ids: [b.id], x: front.x, y: front.y });

    // army: gather, then push nearest AXIOM structure
    const idleArmy = army.filter((u) => !u.order);
    if (army.length >= 22 + this.level * 4 && w.time > this.attackAt) {
      const target = nearest(w, hq, (e) => e.team === AXIOM && e.isBuilding && e.kind !== 'server_farm');
      if (target) {
        w.commands.push({ c: 'order', ids: army.map((u) => u.id), order: { type: 'amove', x: target.x, y: target.y } });
        this.attackAt = w.time + 40;
      }
    } else if (idleArmy.length && w.time > this.attackAt) {
      const far = idleArmy.filter((u) => Math.hypot(u.x - front.x, u.y - front.y) > 8);
      if (far.length) w.commands.push({ c: 'order', ids: far.map((u) => u.id), order: { type: 'amove', x: front.x, y: front.y } });
    }
  }
}

function nearest(w: World, from: { x: number; y: number }, pred: (e: Entity) => boolean): Entity | null {
  let best: Entity | null = null, bd = Infinity;
  for (const e of w.entities) {
    if (!e.alive || !pred(e)) continue;
    const d = Math.hypot(e.x - from.x, e.y - from.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function frontPoint(w: World, hq: Entity): { x: number; y: number } {
  const dx = w.axiomStart.x - hq.x, dy = w.axiomStart.y - hq.y, d = Math.hypot(dx, dy) || 1;
  return { x: hq.x + (dx / d) * 9, y: hq.y + (dy / d) * 9 };
}

function findSpot(w: World, hq: Entity, size: number, kind: string): { x: number; y: number } | null {
  const toward = BUILDINGS[kind].weapon ? 1 : 0;
  const dx = w.axiomStart.x - hq.x, dy = w.axiomStart.y - hq.y, d = Math.hypot(dx, dy) || 1;
  const cx = hq.x + (dx / d) * toward * 7, cy = hq.y + (dy / d) * toward * 7;
  for (let r = 3; r < 16; r++) {
    for (let k = 0; k < r * 6; k++) {
      const a = (k / (r * 6)) * Math.PI * 2 + r;
      const tx = Math.round(cx + Math.cos(a) * r - size / 2), ty = Math.round(cy + Math.sin(a) * r - size / 2);
      if (!w.canPlace(kind, tx, ty).ok) continue;
      // keep a 1-tile gap around to avoid walling in
      if (!w.canPlace(kind, tx - 1, ty - 1).ok && !w.canPlace(kind, tx + 1, ty + 1).ok) continue;
      return { x: tx, y: ty };
    }
  }
  return null;
}
