import type { WeaponDef } from '../data/defs';
import { AXIOM, DT, HUMAN, TYPE_VS_ARMOR, type DamageType, type Team } from '../types';
import type { Entity, World } from '../world';
import { acquire, hostile, surfaceDist, type TickCache } from './query';
import { angDiff, turnToward } from '../util';

const WRECK_SIZE: Record<string, number> = { small: 0, medium: 1, large: 2 };

// ------------------------------------------------------------------ damage
export function damageMul(w: World, attackerTeam: Team, type: DamageType, target: Entity, wpn?: WeaponDef): number {
  let m = TYPE_VS_ARMOR[type][target.armor];
  if (wpn?.vsStructure && target.isBuilding) m *= wpn.vsStructure;
  if (attackerTeam === HUMAN) m *= w.human.dmgMul[type];
  if (target.team === AXIOM) {
    const a = w.axiom;
    m *= Math.max(0.1, 1 - a.resist[type] + a.vuln[type]);
  }
  return m;
}

export function applyDamage(w: World, t: Entity, amount: number, type: DamageType, attackerTeam: Team, attackerId: number): void {
  if (!t.alive || t.kind === 'server_farm' || amount <= 0) return;
  t.hp -= amount;
  t.attackedAt = w.time;
  t.attackerId = attackerId;
  if (t.team === AXIOM && attackerTeam === HUMAN) w.axiom.dmgTaken[type] += amount;
  if (t.hp <= 0) die(w, t, attackerTeam);
}

function hit(w: World, attacker: Entity | null, team: Team, t: Entity, wpn: WeaponDef, base: number): void {
  applyDamage(w, t, base * damageMul(w, team, wpn.type, t, wpn), wpn.type, team, attacker ? attacker.id : 0);
}

const splashBuf: number[] = [];
export function splash(w: World, c: TickCache | null, x: number, y: number, radius: number, base: number, wpn: WeaponDef, team: Team, ownerId: number, hitAir = true): void {
  const n = w.hash.queryRadius(x, y, radius + 1.6, splashBuf);
  for (let i = 0; i < n; i++) {
    const t = w.byId.get(splashBuf[i]);
    if (!t || !t.alive || !hostile(team, t.team)) continue;
    if (t.flying && !hitAir) continue;
    const d = Math.max(0, Math.hypot(t.x - x, t.y - y) - t.radius);
    if (d > radius) continue;
    const fall = 1 - 0.5 * (d / radius);
    applyDamage(w, t, base * fall * damageMul(w, team, wpn.type, t, wpn), wpn.type, team, ownerId);
  }
  const blist = c ? (team === HUMAN ? c.axiomBuildings : c.humanBuildings) : w.entities.filter((e) => e.isBuilding);
  for (const b of blist) {
    if (!b.alive || !hostile(team, b.team)) continue;
    const d = surfaceDist(x, y, b);
    if (d > radius) continue;
    const fall = 1 - 0.5 * (d / radius);
    applyDamage(w, b, base * fall * damageMul(w, team, wpn.type, b, wpn), wpn.type, team, ownerId);
  }
}

// ------------------------------------------------------------------ firing
export function fire(w: World, c: TickCache, e: Entity, t: Entity, wpn: WeaponDef): void {
  const ratio = e.isBuilding && e.team === HUMAN && !e.hacked ? w.human.powerRatio : 1;
  e.cd = wpn.cooldown / ratio * (0.95 + w.rng.next() * 0.1);
  e.firedAt = w.time;
  const team = e.team;
  const dmg = wpn.damage;
  if (wpn.suicide) {
    w.emit({ t: 'explode', x: e.x, y: e.y, r: wpn.splash ?? 1, big: true, sfx: 'explosion_big' });
    splash(w, c, e.x, e.y, wpn.splash ?? 1, dmg, wpn, team, e.id, false);
    die(w, e, 0);
    return;
  }
  const ang = e.udef?.turret || e.bdef?.turret ? e.turretAngle : e.angle;
  const muzzle = e.radius * 0.9;
  const mx = e.x + Math.cos(ang) * muzzle, my = e.y + Math.sin(ang) * muzzle;
  if (wpn.projectileSpeed) {
    const homing = wpn.fx === 'rocket';
    const tx = t.x + (homing ? 0 : (w.rng.next() - 0.5) * 0.8);
    const ty = t.y + (homing ? 0 : (w.rng.next() - 0.5) * 0.8);
    const dist = Math.hypot(tx - mx, ty - my);
    w.projectiles.push({
      x: mx, y: my, px: mx, py: my, sx: mx, sy: my, tx, ty, targetId: t.id, speed: wpn.projectileSpeed,
      wpn, team, ownerId: e.id, homing, t: 0, total: Math.max(0.15, dist / wpn.projectileSpeed), alive: true,
    });
    w.emit({ t: 'shot', fx: wpn.fx, dtype: wpn.type, sfx: wpn.sfx, x: mx, y: my, tx, ty, id: e.id, team });
    return;
  }
  hit(w, e, team, t, wpn, dmg);
  if (wpn.chains) {
    const pts: number[] = [mx, my, t.x, t.y];
    const hitIds = new Set<number>([t.id]);
    let cur = t;
    let mul = 1;
    for (let k = 0; k < wpn.chains; k++) {
      mul *= 0.7;
      const n = w.hash.queryRadius(cur.x, cur.y, (wpn.chainRange ?? 2.5) + 1, c.buf);
      let best: Entity | null = null, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const o = w.byId.get(c.buf[i]);
        if (!o || !o.alive || hitIds.has(o.id) || !hostile(team, o.team)) continue;
        const d = Math.hypot(o.x - cur.x, o.y - cur.y);
        if (d < bd && d <= (wpn.chainRange ?? 2.5)) { bd = d; best = o; }
      }
      if (!best) break;
      hitIds.add(best.id);
      hit(w, e, team, best, wpn, dmg * mul);
      pts.push(best.x, best.y);
      cur = best;
    }
    w.emit({ t: 'arc', pts, sfx: wpn.sfx, x: mx, y: my, team, id: e.id });
  } else {
    w.emit({ t: 'shot', fx: wpn.fx, dtype: wpn.type, sfx: wpn.sfx, x: mx, y: my, tx: t.x, ty: t.y, id: e.id, team, melee: !!wpn.melee });
  }
}

export function updateProjectiles(w: World, c: TickCache): void {
  for (const p of w.projectiles) {
    if (!p.alive) continue;
    p.px = p.x; p.py = p.y;
    if (p.homing) {
      const t = w.get(p.targetId);
      if (t) { p.tx = t.x; p.ty = t.y; }
    }
    p.t += DT;
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * DT;
    if (d <= step || p.t > p.total * 2.5 + 1) {
      p.x = p.tx; p.y = p.ty;
      p.alive = false;
      const r = p.wpn.splash ?? 0;
      if (r > 0) splash(w, c, p.x, p.y, r, p.wpn.damage, p.wpn, p.team, p.ownerId, p.wpn.antiAir !== false);
      else {
        const t = w.get(p.targetId);
        if (t && Math.hypot(t.x - p.x, t.y - p.y) < t.radius + 0.6) hit(w, w.get(p.ownerId) ?? null, p.team, t, p.wpn, p.wpn.damage);
      }
      w.emit({ t: 'impact', x: p.x, y: p.y, r, fx: p.wpn.fx, dtype: p.wpn.type, sfx: r >= 1.5 ? 'explosion_big' : 'explosion_small' });
    } else {
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    }
  }
  let j = 0;
  for (const p of w.projectiles) if (p.alive) w.projectiles[j++] = p;
  w.projectiles.length = j;
}

/** Buildings with weapons (turrets, lancets, core). */
export function updateTurrets(w: World, c: TickCache): void {
  for (const b of c.buildings) {
    const wpn = b.bdef?.weapon;
    if (!wpn || !b.built || !b.alive) continue;
    if (b.cd > 0) b.cd -= DT;
    if (b.stunUntil > w.time) continue;
    let t = b.targetId ? w.get(b.targetId) : undefined;
    if (t && (t.team === b.team || surfaceDist(b.x, b.y, t) > wpn.range + b.radius)) t = undefined;
    if (!t && w.time >= b.acquireAt) {
      b.acquireAt = w.time + 0.25 + w.rng.next() * 0.1;
      t = acquire(w, c, b, { range: wpn.range + b.radius * 0.5, antiAir: wpn.antiAir !== false, unitsOnly: false, ignoreWalls: true }) ?? undefined;
      b.targetId = t ? t.id : 0;
    }
    if (!t) continue;
    const ang = Math.atan2(t.y - b.y, t.x - b.x);
    b.turretAngle = turnToward(b.turretAngle, ang, 6 * DT);
    if (Math.abs(angDiff(b.turretAngle, ang)) < 0.3) {
      if (b.cd <= 0) fire(w, c, b, t, wpn);
    }
  }
}

// ------------------------------------------------------------------ abilities
export function updateAbilities(w: World, c: TickCache): void {
  const t10 = w.tick % 10 === 0;
  for (const e of c.units) {
    if (!e.alive) continue;
    // AXIOM robots regenerate on the Grid
    if (t10 && e.team === AXIOM && e.hp < e.maxHp && !e.flying && w.creepAt(e.x, e.y) > 0.5) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.02 * 0.5);
    }
    if (e.stunUntil > w.time) continue;
    const ab = e.udef?.abilities;
    if (!ab) continue;
    if (t10 && ab.includes('repairAura')) {
      const n = w.hash.queryRadius(e.x, e.y, 4.5, c.buf);
      let healed = false;
      for (let i = 0; i < n; i++) {
        const o = w.byId.get(c.buf[i]);
        if (!o || !o.alive || o.team !== e.team || !o.isRobot || o === e || o.hp >= o.maxHp) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) > 4) continue;
        o.hp = Math.min(o.maxHp, o.hp + 6);
        healed = true;
      }
      if (healed && w.tick % 20 === 0) w.emit({ t: 'heal', x: e.x, y: e.y, r: 4, team: e.team });
    }
    if (ab.includes('stomp') && w.tick % 80 === (e.id % 80)) {
      const n = w.hash.queryRadius(e.x, e.y, 4, c.buf);
      let any = false;
      for (let i = 0; i < n; i++) {
        const o = w.byId.get(c.buf[i]);
        if (o && o.alive && hostile(e.team, o.team) && !o.flying && Math.hypot(o.x - e.x, o.y - e.y) < 2.8) { any = true; break; }
      }
      if (any) {
        const wpn: WeaponDef = { type: 'explosive', damage: 45, cooldown: 4, range: 2.8, splash: 2.8, sfx: 'colossus_stomp' };
        splash(w, c, e.x, e.y, 2.8, 45, wpn, e.team, e.id, false);
        w.emit({ t: 'stomp', x: e.x, y: e.y, r: 2.8, sfx: 'colossus_stomp' });
      }
    }
  }
  // Override protocol expiry
  if (t10) {
    for (const e of c.units) {
      if (e.alive && e.hacked && e.hackExpire > 0 && w.time >= e.hackExpire) revertUnit(w, e);
    }
  }
}

// ------------------------------------------------------------------ hacking
export function convertUnit(w: World, t: Entity, runner: Entity | null, duration = 0): void {
  t.team = HUMAN;
  t.hacked = true;
  t.hackedBy = runner ? runner.id : 0;
  t.hackExpire = duration > 0 ? w.time + duration : 0;
  if (runner) runner.links.push(t.id);
  t.hp = Math.min(t.maxHp, t.hp + t.maxHp * 0.25);
  t.order = null;
  t.queue.length = 0;
  t.targetId = 0;
  t.path = null;
  t.ax = t.x; t.ay = t.y;
  t.stunUntil = 0;
  t.homeId = 0;
  w.human.stats.hacked++;
  if (t.isBuilding) w.fieldDirty = true;
  w.emit({ t: 'hack_done', x: t.x, y: t.y, id: t.id, kind: t.kind, sfx: 'hack_success' });
}

export function revertUnit(w: World, t: Entity): void {
  if (!t.alive || !t.hacked) return;
  t.team = AXIOM;
  t.hacked = false;
  t.hackedBy = 0;
  t.hackExpire = 0;
  t.order = null;
  t.queue.length = 0;
  t.targetId = 0;
  t.path = null;
  if (t.isBuilding) w.fieldDirty = true;
  w.emit({ t: 'hack_revert', x: t.x, y: t.y, id: t.id, kind: t.kind, sfx: 'hack_revert' });
}

export function stunArea(w: World, x: number, y: number, r: number, dur: number): number {
  let n = 0;
  for (const e of w.entities) {
    if (!e.alive || e.team !== AXIOM) continue;
    if (e.isUnit && e.udef?.boss) continue;
    const d = e.isBuilding ? surfaceDist(x, y, e) : Math.hypot(e.x - x, e.y - y);
    if (d <= r) { e.stunUntil = Math.max(e.stunUntil, w.time + dur); n++; }
  }
  return n;
}

// ------------------------------------------------------------------ death
export function die(w: World, e: Entity, killerTeam: Team): void {
  if (!e.alive) return;
  w.kill(e);
  const big = e.radius >= 0.65 || e.isBuilding;
  w.emit({
    t: 'death', id: e.id, kind: e.kind, team: e.team, x: e.x, y: e.y, big, cat: e.cat, size: e.size,
    robot: e.isRobot, hacked: e.hacked, r: e.radius,
  });
  const H = w.human;
  if (e.isUnit) {
    if (e.isRobot) {
      const sv = Math.round((e.udef!.scrapValue ?? 0) * H.wreckMul);
      if (sv > 0) {
        const size = WRECK_SIZE[e.udef!.wreck ?? 'small'];
        w.spawnResource('wreck', e.x, e.y, sv, size * 2 + (w.rng.next() < 0.5 ? 0 : 1));
      }
      if (e.team === AXIOM && killerTeam === HUMAN) {
        const dv = e.udef!.dataValue ?? 0;
        H.data += dv;
        H.stats.dataEarned += dv;
        H.stats.killed++;
      }
      if (e.hacked) {
        const r = w.get(e.hackedBy);
        if (r) r.links = r.links.filter((l) => l !== e.id);
        H.stats.lost++;
      }
    } else if (e.team === HUMAN) {
      H.stats.lost++;
    }
    if (e.links.length) {
      const linked = e.links.slice();
      e.links.length = 0;
      let n = 0;
      for (const id of linked) {
        const u = w.get(id);
        if (u && u.hacked && u.hackedBy === e.id) { revertUnit(w, u); n++; }
      }
      if (n > 0) w.alert(`Netrunner lost — ${n} hacked unit${n > 1 ? 's' : ''} reverted to AXIOM!`, e.x, e.y, 'danger');
    }
  } else if (e.isBuilding) {
    if (e.team === AXIOM && killerTeam === HUMAN) {
      const dv = e.bdef!.dataValue ?? 0;
      H.data += dv;
      H.stats.dataEarned += dv;
      if (e.kind === 'vault') forget(w);
      if (e.kind === 'fabricator') w.alert('Fabricator destroyed', e.x, e.y, 'info');
      if (e.kind === 'relay') w.alert('Relay destroyed — the Grid recedes', e.x, e.y, 'info');
    } else if (e.team === HUMAN) {
      w.alert(`${e.bdef!.name} destroyed`, e.x, e.y, 'danger');
    }
  }
}

export function forget(w: World): void {
  const a = w.axiom;
  for (const k of ['kinetic', 'energy', 'explosive'] as DamageType[]) {
    a.resist[k] = Math.round(a.resist[k] * 50) / 100;
    a.vuln[k] = Math.round(a.vuln[k] * 50) / 100;
  }
  w.emit({ t: 'forgetting', sfx: 'forgetting' });
  w.alert('Data Vault destroyed — CATASTROPHIC FORGETTING! AXIOM adaptations halved.', 0, 0, 'info');
}
