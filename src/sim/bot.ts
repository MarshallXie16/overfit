import { BUILDINGS, RESEARCH, UNITS } from './data/defs';
import { FlowField, WALK_OPEN, WALK_SLOW } from './path';
import { protocolAvailable } from './systems/economy';
import { hackEligible } from './systems/units';
import { AXIOM, DAMAGE_TYPES, HUMAN, TYPE_VS_ARMOR, type DamageType, type Pt } from './types';
import { Rng, type Entity, type Order, type World } from './world';

/**
 * Scripted human player used by the headless soak/balance runs and the title-screen attract mode.
 * It only ever issues the same Commands a real player would (w.commands), never mutates the sim.
 *
 * level 0 — casual / attract mode: fewer engineers, no Overfit adaptation, basic protocols.
 * level 1 — competent: adapts production to AXIOM's model, hacks, uses protocols.
 * level 2 — strong: bigger economy, more defences, aggressive protocol + hack micro.
 *
 * Cost: one O(entities) scan per think (1 Hz) plus small per-subsystem loops.
 * Uses its own RNG so it never perturbs the simulation's random sequence.
 */
export interface BotConfig {
  engineers: number;
  thinkEvery: number;
  adapt: boolean;
  protocols: boolean;
  micro: boolean;
  walls: boolean;
  /** turrets wanted per surge survived (on top of the opening) */
  turretRate: number;
  maxTurrets: number;
  maxBarracks: number;
  maxFactories: number;
  maxLabs: number;
  maxSites: number;
  netrunners: number;
  /** army value (scrap-equivalent) needed before the first push */
  attackValue: number;
  /** required army/defender value ratio for a push */
  attackRatio: number;
  /** fraction of the home army that joins a push */
  strikeShare: number;
}

export const BOT_LEVELS: BotConfig[] = [
  {
    engineers: 11, thinkEvery: 1.5, adapt: false, protocols: false, micro: false, walls: false,
    turretRate: 0.5, maxTurrets: 5, maxBarracks: 2, maxFactories: 1, maxLabs: 1, maxSites: 1, netrunners: 1,
    attackValue: 1100, attackRatio: 1.1, strikeShare: 0.85,
  },
  {
    engineers: 15, thinkEvery: 1, adapt: true, protocols: true, micro: true, walls: true,
    turretRate: 0.8, maxTurrets: 9, maxBarracks: 2, maxFactories: 2, maxLabs: 1, maxSites: 2, netrunners: 3,
    attackValue: 1500, attackRatio: 1.5, strikeShare: 0.8,
  },
  {
    engineers: 18, thinkEvery: 1, adapt: true, protocols: true, micro: true, walls: true,
    turretRate: 1.1, maxTurrets: 12, maxBarracks: 3, maxFactories: 2, maxLabs: 2, maxSites: 3, netrunners: 4,
    attackValue: 1600, attackRatio: 1.5, strikeShare: 0.8,
  },
];

interface Scan {
  hq: Entity | null;
  engineers: Entity[];
  army: Entity[];
  netrunners: Entity[];
  blds: Entity[];
  byKind: Map<string, Entity[]>;
  sites: Entity[];
  dropoffs: Entity[];
  resources: Entity[];
  robots: Entity[]; // visible AXIOM units
  allRobots: Entity[];
  axStructs: Entity[];
  farms: Entity[];
  threats: Entity[]; // visible robots inside / next to the base
  baseR: number;
  lightShare: number;
}

interface Cluster { ids: number[]; x: number; y: number; amount: number }
interface Front { x: number; y: number; weight: number; dx: number; dy: number }

const DMG_UNITS: Record<DamageType, { inf: string[]; veh: string[]; turret: string }> = {
  kinetic: { inf: ['rifleman', 'ranger'], veh: ['bulldog'], turret: 'gun_turret' },
  energy: { inf: ['arc_trooper'], veh: ['volt'], turret: 'tesla' },
  explosive: { inf: ['rocketeer'], veh: ['thumper'], turret: 'missile' },
};
/** hand-tuned value-per-scrap of each combat unit before damage-type efficiency */
const UNIT_W: Record<string, number> = {
  rifleman: 1.0, ranger: 0.8, arc_trooper: 1.15, rocketeer: 0.85, bulldog: 1.0, volt: 1.1, thumper: 0.75,
};
const TURRETS = ['gun_turret', 'tesla', 'missile'];

export class Bot {
  level: number;
  cfg: BotConfig;
  nextThink = 0;
  /** legacy: time before which the army will not start a new push */
  attackAt = 0;
  mode: 'home' | 'attack' = 'home';
  targetId = 0;
  private rng: Rng;
  private world: World | null = null;
  private thinks = 0;
  private s!: Scan;
  private scrap = 0;
  private data = 0;
  private pop = 0;
  private reserve = 0;
  private clusters: Cluster[] | null = null;
  private homeField: FlowField | null = null;
  private homeFieldAt = -99;
  private fronts: Front[] = [];
  private atkField: FlowField | null = null;
  private atkFieldKey = -1;
  private atkFieldAt = -99;
  private strike = new Set<number>();
  private strikeStart = 0;
  private scoutId = 0;
  private wallsFor = new Set<number>();
  private farmHold = 0;
  private hashBuf: number[] = [];

  constructor(level = 1) {
    this.level = Math.max(0, Math.min(BOT_LEVELS.length - 1, level | 0));
    this.cfg = BOT_LEVELS[this.level];
    this.rng = new Rng(0x5eed + this.level);
  }

  think(w: World): void {
    if (this.world !== w) this.reset(w);
    if (w.time < this.nextThink || w.result) return;
    this.nextThink = w.time + this.cfg.thinkEvery;
    this.thinks++;
    this.s = this.scan(w);
    if (!this.s.hq) return;
    const H = w.human;
    this.scrap = H.scrap;
    this.data = H.data;
    this.pop = H.pop;
    this.reserve = 0;
    if (!this.clusters) this.clusters = this.buildClusters(w);
    if (!this.homeField || w.time - this.homeFieldAt > 20) this.updateFronts(w);

    this.engineers(w);
    this.construction(w);
    this.production(w);
    this.military(w);
    if (this.cfg.micro) this.hackers(w);
    this.protocols(w);
  }

  private reset(w: World): void {
    this.world = w;
    this.nextThink = 0;
    this.clusters = null;
    this.homeField = null;
    this.fronts = [];
    this.atkField = null;
    this.atkFieldKey = -1;
    this.strike.clear();
    this.mode = 'home';
    this.targetId = 0;
    this.wallsFor.clear();
    this.rng = new Rng(((w.settings.seed * 2654435761) ^ (0x5eed + this.level)) >>> 0);
  }

  // ================================================================ scan
  private scan(w: World): Scan {
    const s: Scan = {
      hq: null, engineers: [], army: [], netrunners: [], blds: [], byKind: new Map(), sites: [], dropoffs: [],
      resources: [], robots: [], allRobots: [], axStructs: [], farms: [], threats: [], baseR: 10, lightShare: 0.85,
    };
    let lightHp = 1, armHp = 0.15;
    for (const e of w.entities) {
      if (!e.alive) continue;
      if (e.kind === 'server_farm') { s.farms.push(e); continue; }
      if (e.team === HUMAN) {
        if (e.isUnit) {
          if (e.kind === 'engineer') s.engineers.push(e);
          else if (e.kind === 'netrunner') s.netrunners.push(e);
          else if (e.udef?.weapon) s.army.push(e);
        } else if (e.isBuilding && !e.hacked) {
          s.blds.push(e);
          let arr = s.byKind.get(e.kind);
          if (!arr) { arr = []; s.byKind.set(e.kind, arr); }
          arr.push(e);
          if (!e.built) s.sites.push(e);
          else if (e.bdef?.dropoff) s.dropoffs.push(e);
          if (e.kind === 'hq' && e.built && (!s.hq || e.hp > s.hq.hp)) s.hq = e;
        }
      } else if (e.team === AXIOM) {
        if (e.isUnit) {
          s.allRobots.push(e);
          if (w.isVisible(e.x, e.y)) {
            s.robots.push(e);
            if (e.udef!.armor === 'armored') armHp += e.hp; else lightHp += e.hp;
          }
        } else if (e.isBuilding) s.axStructs.push(e);
      } else if (e.cat === 'resource' || e.cat === 'wreck') {
        if (e.amount > 0) s.resources.push(e);
      }
    }
    s.lightShare = lightHp / (lightHp + armHp);
    const hq = s.hq;
    if (hq) {
      let r = 8;
      for (const b of s.blds) if (b.kind !== 'depot') r = Math.max(r, Math.hypot(b.x - hq.x, b.y - hq.y) + b.size / 2);
      s.baseR = Math.min(24, r);
      const R = s.baseR + 7;
      for (const u of s.robots) {
        if (Math.hypot(u.x - hq.x, u.y - hq.y) < R) { s.threats.push(u); continue; }
        for (const d of s.dropoffs) if (d !== hq && Math.hypot(u.x - d.x, u.y - d.y) < 9) { s.threats.push(u); break; }
      }
    }
    return s;
  }

  private count(kind: string, builtOnly = false): number {
    const arr = this.s.byKind.get(kind);
    if (!arr) return 0;
    if (!builtOnly) return arr.length;
    let n = 0;
    for (const b of arr) if (b.built) n++;
    return n;
  }

  // ================================================================ map knowledge
  private buildClusters(w: World): Cluster[] {
    const out: Cluster[] = [];
    for (const r of this.s.resources) {
      if (r.cat !== 'resource') continue;
      let c = out.find((k) => Math.hypot(k.x - r.x, k.y - r.y) < 5.5);
      if (!c) { c = { ids: [], x: r.x, y: r.y, amount: 0 }; out.push(c); }
      c.ids.push(r.id);
      c.x += (r.x - c.x) / c.ids.length;
      c.y += (r.y - c.y) / c.ids.length;
    }
    void w;
    return out;
  }

  /** Trace AXIOM's likely approach routes to the HQ and record where they reach the base. */
  private updateFronts(w: World): void {
    const hq = this.s.hq!;
    this.homeFieldAt = w.time;
    if (!this.homeField) this.homeField = new FlowField(w.w, w.h);
    const goals: number[] = [];
    for (let y = hq.ty; y < hq.ty + hq.size; y++) for (let x = hq.tx; x < hq.tx + hq.size; x++) goals.push(y * w.w + x);
    const f = this.homeField;
    f.build(w.grid, goals, 'siege');
    const fronts: Front[] = [];
    const sources = this.s.axStructs.filter((b) => b.kind === 'fabricator' || b.kind === 'core');
    const stopAt = Math.max(13, this.s.baseR + 4);
    for (const src of sources) {
      let i = (src.y | 0) * w.w + (src.x | 0);
      if (!(f.dist[i] < Infinity)) continue;
      for (let k = 0; k < 600 && f.dist[i] > stopAt && f.next[i] >= 0; k++) i = f.next[i];
      const x = (i % w.w) + 0.5, y = ((i / w.w) | 0) + 0.5;
      const near = fronts.find((p) => Math.hypot(p.x - x, p.y - y) < 7);
      if (near) { near.weight++; continue; }
      const d = Math.hypot(x - hq.x, y - hq.y) || 1;
      fronts.push({ x, y, weight: 1, dx: (x - hq.x) / d, dy: (y - hq.y) / d });
    }
    if (!fronts.length) {
      const dx = w.axiomStart.x - hq.x, dy = w.axiomStart.y - hq.y, d = Math.hypot(dx, dy) || 1;
      fronts.push({ x: hq.x + (dx / d) * 11, y: hq.y + (dy / d) * 11, weight: 1, dx: dx / d, dy: dy / d });
    }
    fronts.sort((a, b) => b.weight - a.weight);
    this.fronts = fronts.slice(0, 3);
  }

  /** Rally point for the home army: between the HQ and the main front. */
  private homePoint(): Pt {
    const hq = this.s.hq!;
    const f = this.fronts[0];
    if (!f) return { x: hq.x, y: hq.y + 4 };
    const d = Math.hypot(f.x - hq.x, f.y - hq.y);
    const t = Math.min(1, Math.max(0.4, (d - 3) / Math.max(1, d)));
    return { x: hq.x + (f.x - hq.x) * t * 0.85, y: hq.y + (f.y - hq.y) * t * 0.85 };
  }

  // ================================================================ placement
  private tileOk(w: World, x: number, y: number): boolean {
    if (x < 1 || y < 1 || x >= w.w - 1 || y >= w.h - 1) return false;
    const i = y * w.w + x;
    const c = w.grid.walk[i];
    if (c !== WALK_OPEN && c !== WALK_SLOW) return false;
    return w.creep[i] <= 0.3 && w.explored[i] === 1;
  }

  /** Footprint free + a 1-tile walkable ring around it (never seal alleys or other buildings). */
  private canPut(w: World, kind: string, tx: number, ty: number): boolean {
    const s = BUILDINGS[kind].size;
    for (let y = ty - 1; y <= ty + s; y++) {
      for (let x = tx - 1; x <= tx + s; x++) {
        const inner = x >= tx && x < tx + s && y >= ty && y < ty + s;
        if (inner) { if (!this.tileOk(w, x, y)) return false; continue; }
        if (x < 0 || y < 0 || x >= w.w || y >= w.h) return false;
        const c = w.grid.walk[y * w.w + x];
        if (c !== WALK_OPEN && c !== WALK_SLOW) return false;
      }
    }
    for (const r of this.s.resources) {
      if (r.cat !== 'resource') continue;
      if (r.x > tx - 1.2 && r.x < tx + s + 1.2 && r.y > ty - 1.2 && r.y < ty + s + 1.2) return false;
    }
    for (const u of this.s.threats) if (u.x > tx - 1 && u.x < tx + s + 1 && u.y > ty - 1 && u.y < ty + s + 1) return false;
    return true;
  }

  private findSpot(w: World, kind: string, cx: number, cy: number, rMax: number, avoid?: Pt): Pt | null {
    const s = BUILDINGS[kind].size;
    for (let r = 0; r <= rMax; r++) {
      const n = Math.max(1, Math.round(r * 6));
      const off = this.rng.next() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const a = off + (k / n) * Math.PI * 2;
        const tx = Math.round(cx + Math.cos(a) * r - s / 2), ty = Math.round(cy + Math.sin(a) * r - s / 2);
        if (avoid && Math.hypot(tx + s / 2 - avoid.x, ty + s / 2 - avoid.y) < 4.5) continue;
        if (!this.canPut(w, kind, tx, ty)) continue;
        if (!w.canPlace(kind, tx, ty).ok) continue;
        return { x: tx, y: ty };
      }
    }
    return null;
  }

  private place(w: World, kind: string, spot: Pt, builders: Entity[], queue = false): boolean {
    const def = BUILDINGS[kind];
    if (this.scrap < def.cost.scrap) return false;
    this.scrap -= def.cost.scrap;
    w.commands.push({ c: 'place', kind, tx: spot.x, ty: spot.y, builders: builders.map((b) => b.id), queue });
    // reflect the reservation locally so later decisions this think see it
    const fake = { kind, built: false, id: 0, prod: [], x: spot.x + def.size / 2, y: spot.y + def.size / 2, size: def.size } as unknown as Entity;
    let arr = this.s.byKind.get(kind);
    if (!arr) { arr = []; this.s.byKind.set(kind, arr); }
    arr.push(fake);
    return true;
  }

  // ================================================================ engineers
  private nodeLoad = new Map<number, number>();

  private engineers(w: World): void {
    const s = this.s;
    const hq = s.hq!;
    this.nodeLoad.clear();
    const buildersOf = new Map<number, number>();
    for (const e of s.engineers) {
      const o = e.order;
      if (o?.type === 'harvest') this.nodeLoad.set(o.id, (this.nodeLoad.get(o.id) ?? 0) + 1);
      else if (o?.type === 'build') buildersOf.set(o.id, (buildersOf.get(o.id) ?? 0) + 1);
    }
    const busy = new Set<number>();
    // ---- flee: engineers caught near enemies outside the defended core go home
    if (s.robots.length) {
      for (const e of s.engineers) {
        if (e.order?.type === 'build' && this.s.threats.length === 0) continue;
        let danger = false;
        const n = w.hash.queryRadius(e.x, e.y, 6, this.hashBuf);
        for (let i = 0; i < n && !danger; i++) {
          const o = w.byId.get(this.hashBuf[i]);
          if (o && o.alive && o.team === AXIOM && o.udef?.weapon && Math.hypot(o.x - e.x, o.y - e.y) < 5.5) danger = true;
        }
        if (!danger) continue;
        const dx = e.x - hq.x, dy = e.y - hq.y, d = Math.hypot(dx, dy) || 1;
        // run to the far side of the HQ
        const tx = hq.x - (this.fronts[0]?.dx ?? dx / d) * 3, ty = hq.y - (this.fronts[0]?.dy ?? dy / d) * 3;
        if (e.order?.type !== 'move' || Math.hypot(e.order.x - tx, e.order.y - ty) > 2) {
          w.commands.push({ c: 'order', ids: [e.id], order: { type: 'move', x: tx, y: ty } });
        }
        busy.add(e.id);
      }
    }
    // ---- construction sites get builders
    for (const site of s.sites) {
      const want = site.kind === 'wall' ? 1 : site.size >= 3 ? 3 : 2;
      let have = buildersOf.get(site.id) ?? 0;
      if (have >= want) continue;
      if (this.dangerAt(site.x, site.y, 7)) continue;
      const cands = s.engineers
        .filter((e) => !busy.has(e.id) && e.order?.type !== 'build' && e.order?.type !== 'move')
        .sort((a, b) => Math.hypot(a.x - site.x, a.y - site.y) - Math.hypot(b.x - site.x, b.y - site.y));
      for (const e of cands) {
        if (have >= want) break;
        if (Math.hypot(e.x - site.x, e.y - site.y) > 45) break;
        w.commands.push({ c: 'order', ids: [e.id], order: { type: 'build', id: site.id } });
        busy.add(e.id);
        have++;
      }
    }
    // ---- repairs (no enemies around)
    if (!s.threats.length && this.scrap > 80) {
      let repairing = 0;
      for (const e of s.engineers) if (e.order?.type === 'repair') repairing++;
      if (repairing < 3) {
        const dmg = s.blds.filter((b) => b.built && b.hp < b.maxHp * 0.7).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
        for (const b of dmg) {
          if (repairing >= 3) break;
          const e = s.engineers.filter((q) => !busy.has(q.id) && (q.order?.type === 'harvest' || !q.order) && q.carrying === 0)
            .sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
          if (!e || Math.hypot(e.x - b.x, e.y - b.y) > 30) break;
          w.commands.push({ c: 'order', ids: [e.id], order: { type: 'repair', id: b.id } });
          busy.add(e.id);
          repairing++;
        }
      }
    }
    // ---- scout far scrap fields for a depot
    const scout = this.scoutId ? w.get(this.scoutId) : undefined;
    if (scout && scout.order?.type !== 'move') this.scoutId = 0;
    // ---- idle engineers harvest; rebalance far harvesters every few seconds
    const rebalance = this.thinks % 6 === 0;
    for (const e of s.engineers) {
      if (busy.has(e.id)) continue;
      const o = e.order;
      if (o && o.type !== 'harvest') continue;
      if (o?.type === 'harvest') {
        if (!rebalance) continue;
        const node = w.get(o.id);
        if (node && node.amount > 0 && e.carrying < 6) {
          const dd = this.dropDist(node);
          if (dd < 12 && !this.dangerAt(node.x, node.y, 7)) continue;
        } else if (node && node.amount > 0) continue;
      }
      const best = this.pickNode(w, e);
      if (best && (!o || o.type !== 'harvest' || o.id !== best.id)) {
        w.commands.push({ c: 'order', ids: [e.id], order: { type: 'harvest', id: best.id } });
        this.nodeLoad.set(best.id, (this.nodeLoad.get(best.id) ?? 0) + 1);
        if (o?.type === 'harvest') this.nodeLoad.set(o.id, Math.max(0, (this.nodeLoad.get(o.id) ?? 1) - 1));
      } else if (!best && !o) {
        // nothing safe to harvest: wait near the HQ
        if (Math.hypot(e.x - hq.x, e.y - hq.y) > 7) w.commands.push({ c: 'order', ids: [e.id], order: { type: 'move', x: hq.x, y: hq.y + 3 } });
      }
    }
  }

  private dropDist(n: Entity): number {
    let bd = Infinity;
    for (const d of this.s.dropoffs) {
      const dd = Math.hypot(d.x - n.x, d.y - n.y) - d.size / 2;
      if (dd < bd) bd = dd;
    }
    return bd;
  }

  private dangerAt(x: number, y: number, r: number): boolean {
    for (const u of this.s.robots) if (u.udef?.weapon && Math.abs(u.x - x) < r && Math.abs(u.y - y) < r && Math.hypot(u.x - x, u.y - y) < r) return true;
    for (const b of this.s.axStructs) if (b.bdef?.weapon && Math.hypot(b.x - x, b.y - y) < 10) return true;
    return false;
  }

  private pickNode(w: World, e: Entity): Entity | null {
    let best: Entity | null = null, bs = Infinity;
    for (const r of this.s.resources) {
      const dd = this.dropDist(r);
      const wreck = r.cat === 'wreck';
      if (dd > (wreck ? 16 : 30)) continue;
      if (wreck && r.expire - w.time < 8) continue;
      const i = (r.y | 0) * w.w + (r.x | 0);
      if (w.creep[i] > 0.3) continue;
      const load = this.nodeLoad.get(r.id) ?? 0;
      if (wreck && load * 10 >= r.amount) continue;
      let sc = dd * 1.2 + Math.hypot(r.x - e.x, r.y - e.y) * 0.25 + load * load * 1.6;
      if (wreck) sc -= 4;
      if (sc >= bs) continue;
      if (this.dangerAt(r.x, r.y, 7)) continue;
      bs = sc; best = r;
    }
    return best;
  }

  // ================================================================ construction
  private construction(w: World): void {
    const s = this.s, H = w.human, A = w.axiom, cfg = this.cfg;
    const hq = s.hq!;
    const t = w.time;
    const nonWallSites = s.sites.filter((b) => b.kind !== 'wall').length;
    if (s.engineers.length === 0) return;
    const free = () => s.engineers.filter((e) => e.order?.type !== 'build' && e.order?.type !== 'move' && e.order?.type !== 'repair');
    const builders = (n: number, near: Pt) => free().sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y)).slice(0, n);
    let sitesLeft = cfg.maxSites - nonWallSites;
    // enemies all over the base: don't start new projects except turrets
    const underSiege = s.threats.length > 8;

    // pending power demand of unfinished sites
    let pendingPower = 0, pendingPop = 0;
    for (const b of s.sites) { pendingPower -= b.bdef!.power; pendingPop += b.bdef!.pop ?? 0; }
    const powerFree = H.power - H.powerUsed - pendingPower;
    const producers = this.count('barracks', true) + this.count('factory', true) + 1;
    const popFree = H.popCap + pendingPop - this.pop;

    const surgeSoon = A.tuning.surges && A.surgeT < 45;
    const turretWant = Math.min(cfg.maxTurrets, Math.floor((this.level === 0 ? 1 : 2) + H.stats.surgesSurvived * cfg.turretRate + (t > 600 ? 1 : 0)));
    const turrets = TURRETS.reduce((n, k) => n + this.count(k), 0);

    type Want = { kind: string; save: boolean; at?: () => Pt | null };
    const wants: Want[] = [];
    if (this.count('barracks') < 1) wants.push({ kind: 'barracks', save: true });
    if (powerFree < 3 + (this.count('barracks') ? 2 : 0) && this.count('generator') - this.count('generator', true) < 1) wants.push({ kind: 'generator', save: true });
    if (popFree < 3 + producers * 2 && H.popCap + pendingPop < 150 && (this.count('habitat') - this.count('habitat', true)) < (producers > 3 ? 2 : 1)) wants.push({ kind: 'habitat', save: true });
    if (turrets < turretWant && this.count('barracks') > 0) wants.push({ kind: this.pickTurret(w), save: surgeSoon || turrets < 2, at: () => this.turretSpot(w) });
    if (this.count('lab') < 1 && this.count('barracks', true) > 0 && (t > 110 || this.scrap > 350)) wants.push({ kind: 'lab', save: t > 150 });
    const depot = this.depotPlan(w);
    if (depot) wants.push({ kind: 'depot', save: false, at: () => depot });
    if (this.count('factory') < 1 && this.count('lab', true) > 0 && t > 260) wants.push({ kind: 'factory', save: t > 360 });
    if (this.count('barracks') < 2 && t > 300 && cfg.maxBarracks >= 2) wants.push({ kind: 'barracks', save: false });
    if (this.count('barracks') < 3 && t > 560 && cfg.maxBarracks >= 3 && this.scrap > 400) wants.push({ kind: 'barracks', save: false });
    if (this.count('factory') < 2 && t > 720 && cfg.maxFactories >= 2 && this.scrap > 500) wants.push({ kind: 'factory', save: false });
    if (this.count('lab') < 2 && t > 700 && cfg.maxLabs >= 2 && this.scrap > 450) wants.push({ kind: 'lab', save: false });

    for (const want of wants) {
      if (sitesLeft <= 0) break;
      const def = BUILDINGS[want.kind];
      if (!w.requirementsMet(def.requires)) continue;
      if (underSiege && !def.weapon) continue;
      if (this.scrap < def.cost.scrap) {
        if (want.save) { this.reserve = Math.max(this.reserve, def.cost.scrap); break; }
        continue;
      }
      const spot = want.at ? want.at() : this.ecoSpot(w, want.kind);
      if (!spot) continue;
      const bs = builders(def.size >= 3 ? 2 : 1, { x: spot.x, y: spot.y });
      if (!bs.length) break;
      if (this.place(w, want.kind, spot, bs)) sitesLeft--;
    }

    // walls in front of turrets (cheap, one segment per think)
    if (cfg.walls && t > 150 && !underSiege && this.scrap > 120 + this.reserve) {
      for (const k of TURRETS) for (const tur of s.byKind.get(k) ?? []) {
        if (!tur.built || this.wallsFor.has(tur.id) || !tur.id) continue;
        this.wallsFor.add(tur.id);
        this.wallSegment(w, tur, builders(1, tur));
        return;
      }
    }
    void hq;
  }

  private pickTurret(w: World): string {
    const best = this.bestTypes(w);
    for (const k of best) {
      const kind = DMG_UNITS[k].turret;
      if (w.requirementsMet(BUILDINGS[kind].requires)) return kind;
    }
    return 'gun_turret';
  }

  private turretSpot(w: World): Pt | null {
    const hq = this.s.hq!;
    // spread turrets over the fronts by weight
    let tot = 0;
    for (const f of this.fronts) tot += f.weight;
    const counts = this.fronts.map(() => 0);
    for (const k of TURRETS) for (const b of this.s.byKind.get(k) ?? []) {
      if (!b.id) continue;
      let bi = 0, bd = Infinity;
      this.fronts.forEach((f, i) => { const d = Math.hypot(f.x - b.x, f.y - b.y); if (d < bd) { bd = d; bi = i; } });
      counts[bi]++;
    }
    let fi = 0, worst = Infinity;
    this.fronts.forEach((f, i) => { const r = counts[i] / (f.weight / tot); if (r < worst) { worst = r; fi = i; } });
    const f = this.fronts[fi];
    if (!f) return this.findSpot(w, 'gun_turret', hq.x, hq.y, 10);
    // pull the spot a bit toward the HQ so turrets cover each other
    const d = Math.hypot(f.x - hq.x, f.y - hq.y);
    const k = d > 12 ? (d - 3) / d : 1;
    const cx = hq.x + (f.x - hq.x) * k, cy = hq.y + (f.y - hq.y) * k;
    return this.findSpot(w, 'gun_turret', cx, cy, 7);
  }

  private ecoSpot(w: World, kind: string): Pt | null {
    const hq = this.s.hq!;
    const f = this.fronts[0];
    const bx = f ? -f.dx : 0, by = f ? -f.dy : 1;
    // behind the HQ (away from AXIOM), drifting sideways as space fills
    const sp = this.findSpot(w, kind, hq.x + bx * 5, hq.y + by * 5, 9, f);
    return sp ?? this.findSpot(w, kind, hq.x, hq.y, 16);
  }

  private wallSegment(w: World, tur: Entity, bs: Entity[]): void {
    if (!bs.length) return;
    const hq = this.s.hq!;
    let dx = tur.x - hq.x, dy = tur.y - hq.y;
    const f = this.fronts[0];
    if (f) { dx = f.x - hq.x; dy = f.y - hq.y; }
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const px = -dy, py = dx;
    const cx = tur.x + dx * 3, cy = tur.y + dy * 3;
    let first = true;
    for (let k = -2; k <= 2; k++) {
      if (this.scrap < 10) break;
      const tx = Math.floor(cx + px * k), ty = Math.floor(cy + py * k);
      if (!this.wallOk(w, tx, ty)) continue;
      if (!w.canPlace('wall', tx, ty).ok) continue;
      this.scrap -= 10;
      w.commands.push({ c: 'place', kind: 'wall', tx, ty, builders: bs.map((b) => b.id), queue: !first });
      first = false;
    }
  }

  private wallOk(w: World, tx: number, ty: number): boolean {
    if (!this.tileOk(w, tx, ty)) return false;
    for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) {
      if (!w.inBounds(x, y)) return false;
      const id = w.occ[y * w.w + x];
      if (id && w.get(id)?.kind !== 'wall') return false;
    }
    for (const r of this.s.resources) if (r.cat === 'resource' && Math.abs(r.x - tx - 0.5) < 2 && Math.abs(r.y - ty - 0.5) < 2) return false;
    return true;
  }

  /** Where (if anywhere) to put the next Depot. */
  private depotPlan(w: World): Pt | null {
    if (this.thinks % 5 !== 0 || !this.clusters) return null;
    const s = this.s, hq = s.hq!;
    if (this.count('depot') - this.count('depot', true) > 0) return null;
    if (s.engineers.length < 8) return null;
    let served = 0;
    let best: Cluster | null = null, bs = Infinity;
    for (const c of this.clusters) {
      let amt = 0;
      for (const id of c.ids) { const r = w.get(id); if (r) amt += r.amount; }
      c.amount = amt;
      if (amt < 300) continue;
      let dd = Infinity;
      for (const d of s.dropoffs) dd = Math.min(dd, Math.hypot(d.x - c.x, d.y - c.y));
      for (const d of s.byKind.get('depot') ?? []) if (d.id) dd = Math.min(dd, Math.hypot(d.x - c.x, d.y - c.y));
      if (dd < 10) { served += amt; continue; }
      if (amt < 1200) continue;
      if (w.creepAt(c.x, c.y) > 0.2) continue;
      let unsafe = false;
      for (const b of s.axStructs) if (Math.hypot(b.x - c.x, b.y - c.y) < (b.bdef?.weapon ? 13 : 9)) { unsafe = true; break; }
      if (unsafe || this.dangerAt(c.x, c.y, 9)) continue;
      const sc = Math.hypot(c.x - hq.x, c.y - hq.y) - amt / 400;
      if (sc < bs) { bs = sc; best = c; }
    }
    const perEng = served / Math.max(1, s.engineers.length);
    if (!best || (served > 3000 && perEng > 220)) return null;
    // explored? otherwise send a scout first
    if (!w.explored[(best.y | 0) * w.w + (best.x | 0)]) {
      if (!this.scoutId) {
        const e = s.engineers.find((q) => q.order?.type === 'harvest' && q.carrying === 0);
        if (e) { this.scoutId = e.id; w.commands.push({ c: 'order', ids: [e.id], order: { type: 'move', x: best.x, y: best.y } }); }
      }
      return null;
    }
    const toHq = { x: hq.x - best.x, y: hq.y - best.y };
    const L = Math.hypot(toHq.x, toHq.y) || 1;
    return this.findSpot(w, 'depot', best.x + (toHq.x / L) * 3.5, best.y + (toHq.y / L) * 3.5, 5);
  }

  // ================================================================ production & research
  /** Damage types sorted by effectiveness against AXIOM right now (best first). */
  private effCache = new Map<DamageType, number>();
  private bestTypes(w: World): DamageType[] {
    this.effCache.clear();
    for (const k of DAMAGE_TYPES) this.effCache.set(k, this.eff(w, k));
    return DAMAGE_TYPES.slice().sort((a, b) => this.effCache.get(b)! - this.effCache.get(a)!);
  }

  private eff(w: World, k: DamageType): number {
    const A = w.axiom, H = w.human;
    const ls = this.s.lightShare;
    const armor = ls * TYPE_VS_ARMOR[k].light + (1 - ls) * TYPE_VS_ARMOR[k].armored;
    const model = this.cfg.adapt ? Math.max(0.1, 1 - A.resist[k] + A.vuln[k]) : 1;
    return H.dmgMul[k] * model * armor;
  }

  private production(w: World): void {
    const s = this.s, H = w.human, cfg = this.cfg;
    const hq = s.hq!;
    // ---- engineers
    let engQueued = 0;
    for (const p of hq.prod) if (p.kind === 'engineer') engQueued++;
    const engWant = Math.min(cfg.engineers, 6 + Math.floor(w.time / 20));
    if (s.engineers.length + engQueued < engWant && hq.prod.length < 2 && this.scrap >= 50 && this.pop + 1 <= H.popCap) {
      this.train(w, hq, 'engineer');
    }
    // ---- research
    for (const lab of s.byKind.get('lab') ?? []) {
      if (!lab.id || !lab.built || lab.researching) continue;
      const id = this.nextResearch(w);
      if (!id) break;
      const r = RESEARCH[id];
      if (this.scrap >= r.cost.scrap && this.data >= (r.cost.data ?? 0)) {
        w.commands.push({ c: 'research', building: lab.id, id });
        this.scrap -= r.cost.scrap; this.data -= r.cost.data ?? 0;
      } else if ((r.cost.data ?? 0) <= this.data) this.reserve = Math.max(this.reserve, r.cost.scrap);
    }
    // ---- army
    const surgeSoon = w.axiom.tuning.surges && w.axiom.surgeT < 40;
    const reserve = surgeSoon || s.threats.length > 4 ? 0 : this.reserve;
    const weights = this.unitWeights(w);
    for (const kind of ['barracks', 'factory']) {
      for (const b of s.byKind.get(kind) ?? []) {
        if (!b.id || !b.built || b.prod.length >= 2) continue;
        const pick = this.pickUnit(w, b, weights);
        if (!pick) continue;
        const def = UNITS[pick];
        if (this.scrap - def.cost.scrap < reserve) continue;
        if (this.pop + def.pop > H.popCap) continue;
        this.train(w, b, pick);
      }
    }
  }

  private train(w: World, b: Entity, kind: string): void {
    const def = UNITS[kind];
    if (this.scrap < def.cost.scrap || this.data < (def.cost.data ?? 0)) return;
    this.scrap -= def.cost.scrap;
    this.data -= def.cost.data ?? 0;
    this.pop += def.pop;
    w.commands.push({ c: 'train', building: b.id, kind });
    if (!b.rally && b.kind !== 'hq') {
      const p = this.homePoint();
      w.commands.push({ c: 'rally', ids: [b.id], x: p.x, y: p.y });
    }
  }

  private unitWeights(w: World): Map<string, number> {
    const out = new Map<string, number>();
    const best = this.bestTypes(w);
    const top = this.effCache.get(best[0])!;
    const pw = this.cfg.adapt ? 3 : 0;
    for (const k of DAMAGE_TYPES) {
      const rel = this.effCache.get(k)! / top;
      for (const u of [...DMG_UNITS[k].inf, ...DMG_UNITS[k].veh]) out.set(u, (UNIT_W[u] ?? 1) * Math.pow(rel, pw));
    }
    return out;
  }

  private pickUnit(w: World, b: Entity, weights: Map<string, number>): string | null {
    const s = this.s;
    const trains = b.bdef!.trains ?? [];
    // netrunners first (barracks)
    if (trains.includes('netrunner') && w.requirementsMet(UNITS.netrunner.requires)) {
      let have = s.netrunners.length;
      for (const q of s.byKind.get('barracks') ?? []) for (const p of q.prod) if (p.kind === 'netrunner') have++;
      if (have < this.cfg.netrunners && this.data >= 15 + 20) return 'netrunner';
    }
    let sum = 0;
    const opts: [string, number][] = [];
    for (const k of trains) {
      const wt = weights.get(k);
      if (!wt) continue;
      const def = UNITS[k];
      if (!w.requirementsMet(def.requires)) continue;
      if ((def.cost.data ?? 0) > 0 && this.data < (def.cost.data ?? 0) + 30) continue;
      opts.push([k, wt]);
      sum += wt;
    }
    if (!opts.length) return null;
    let r = this.rng.next() * sum;
    for (const [k, wt] of opts) { r -= wt; if (r <= 0) return k; }
    return opts[opts.length - 1][0];
  }

  private nextResearch(w: World): string | null {
    const H = w.human;
    const best = this.bestTypes(w);
    const order: string[] = ['salvage'];
    const dmg1 = best.map((k) => k + '1');
    const dmg2 = best.map((k) => k + '2');
    if (this.level === 0) order.push(dmg1[0], 'armor1', 'railguns', dmg1[1], dmg1[2], 'proto_emp');
    else order.push(dmg1[0], 'armor1', 'proto_emp', dmg1[1], 'railguns', 'bandwidth', dmg2[0], 'proto_orbital', dmg1[2], 'armor2', dmg2[1], 'proto_override', dmg2[2]);
    for (const id of order) {
      if (H.research.has(id)) continue;
      const r = RESEARCH[id];
      if (!r || !w.requirementsMet(r.requires)) continue;
      let inProgress = false;
      for (const lab of this.s.byKind.get('lab') ?? []) if (lab.researching?.id === id) inProgress = true;
      if (inProgress) continue;
      return id;
    }
    return null;
  }

  // ================================================================ military
  private value(u: Entity): number {
    const d = u.udef!;
    const v = d.side === 'axiom' ? (d.compute ?? 10) * 4 : d.cost.scrap + (d.cost.data ?? 0) * 3;
    return v * (0.4 + 0.6 * u.hp / u.maxHp);
  }

  private military(w: World): void {
    const s = this.s, A = w.axiom, cfg = this.cfg;
    const hq = s.hq!;
    // drop dead ids from the strike group
    const strike: Entity[] = [];
    for (const id of this.strike) { const u = w.get(id); if (u && u.team === HUMAN) strike.push(u); else this.strike.delete(id); }
    const home = s.army.filter((u) => !this.strike.has(u.id));
    const home0 = this.homePoint();

    // ---------------------------------------------------------- base defence
    if (s.threats.length) {
      const tgt = this.threatCenter(w);
      const big = s.threats.length >= 6 || A.surgeActive;
      const defenders = home.filter((u) => Math.hypot(u.x - hq.x, u.y - hq.y) < s.baseR + 25);
      this.amove(w, defenders, tgt.x, tgt.y, 3);
      if (big && strike.length && this.mode === 'attack') {
        const sc = this.centroid(strike);
        const far = Math.hypot(sc.x - hq.x, sc.y - hq.y);
        let threatValue = 0;
        for (const u of s.threats) threatValue += this.value(u);
        let homeValue = 0;
        for (const u of home) homeValue += this.value(u);
        if (threatValue > homeValue * 0.8 + 300 || far < 30) this.recall(w, strike, tgt);
      }
    } else {
      // regroup idle home units at the rally point
      const idle = home.filter((u) => !u.order && Math.hypot(u.x - home0.x, u.y - home0.y) > 7);
      if (idle.length) this.amove(w, idle, home0.x, home0.y, 2);
      // defenders that chased threats away come back
      const strays = home.filter((u) => u.order?.type === 'amove' && Math.hypot(u.x - hq.x, u.y - hq.y) > s.baseR + 14);
      if (strays.length) this.amove(w, strays, home0.x, home0.y, 2);
    }

    // ---------------------------------------------------------- attacks
    if (this.mode === 'attack') this.runAttack(w, strike);
    else if (!s.threats.length && w.time > this.attackAt) {
      const surgeWindow = !A.tuning.surges || A.surgeT > (this.level === 0 ? 30 : 70) || A.surgeN === 0 && A.surgeT > 60;
      if (surgeWindow && !A.surgeActive) {
        let homeValue = 0;
        for (const u of home) homeValue += this.value(u);
        const minV = cfg.attackValue * (1 + 0.12 * (A.threat - 1));
        if (homeValue >= minV) {
          const t = this.pickTarget(w, homeValue);
          if (t) this.launch(w, t, home);
        }
      }
    }
  }

  private threatCenter(w: World): Pt {
    const hq = this.s.hq!;
    // nearest threat to the HQ, then centroid of threats around it
    let n: Entity | null = null, bd = Infinity;
    for (const u of this.s.threats) { const d = Math.hypot(u.x - hq.x, u.y - hq.y); if (d < bd) { bd = d; n = u; } }
    if (!n) return { x: hq.x, y: hq.y };
    let x = 0, y = 0, k = 0;
    for (const u of this.s.threats) if (Math.hypot(u.x - n.x, u.y - n.y) < 6) { x += u.x; y += u.y; k++; }
    void w;
    return { x: x / k, y: y / k };
  }

  private centroid(us: Entity[]): Pt {
    let x = 0, y = 0;
    for (const u of us) { x += u.x; y += u.y; }
    x /= us.length; y /= us.length;
    // trimmed mean around the bulk (ignore stragglers)
    let tx = 0, ty = 0, k = 0;
    for (const u of us) if (Math.hypot(u.x - x, u.y - y) < 12) { tx += u.x; ty += u.y; k++; }
    return k ? { x: tx / k, y: ty / k } : { x, y };
  }

  /** a-move a group unless it is already heading (roughly) there. */
  private amove(w: World, us: Entity[], x: number, y: number, tol: number): void {
    const ids: number[] = [];
    for (const u of us) {
      const o = u.order;
      if (o && o.type === 'amove' && Math.hypot(o.x - x, o.y - y) < tol + Math.sqrt(us.length) * 0.6) continue;
      if (o && o.type === 'hack') continue;
      ids.push(u.id);
    }
    if (ids.length) w.commands.push({ c: 'order', ids, order: { type: 'amove', x, y } });
  }

  private pickTarget(w: World, armyValue: number): Entity | null {
    const s = this.s, hq = s.hq!;
    let best: Entity | null = null, bs = Infinity;
    const fabs = s.axStructs.filter((b) => b.kind === 'fabricator').length;
    const cands: Entity[] = [...s.axStructs];
    if (this.level > 0) for (const f of s.farms) if (f.team !== HUMAN) cands.push(f);
    for (const b of cands) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - hq.x, b.y - hq.y);
      let sc = d;
      switch (b.kind) {
        case 'relay': sc -= 6; break;
        case 'lancet': sc -= 2; break;
        case 'fabricator': sc -= 4; break;
        case 'vault': sc -= w.axiom.resist.kinetic + w.axiom.resist.energy + w.axiom.resist.explosive > 0.5 ? 14 : 4; break;
        case 'core': sc += fabs > 0 ? 25 : -10; break;
        case 'server_farm': sc -= 5; break;
      }
      // defenders around the target (bot knows the swarm's rough whereabouts)
      let def = 0;
      for (const u of s.allRobots) if (Math.abs(u.x - b.x) < 13 && Math.abs(u.y - b.y) < 13) def += this.value(u);
      for (const o of s.axStructs) if (o.bdef?.weapon && Math.hypot(o.x - b.x, o.y - b.y) < 9) def += o.kind === 'core' ? 900 : 350;
      if (armyValue < def * this.cfg.attackRatio) continue;
      sc += def / 200;
      if (sc < bs) { bs = sc; best = b; }
    }
    return best;
  }

  private launch(w: World, t: Entity, home: Entity[]): void {
    const hq = this.s.hq!;
    // keep a share of the army at home (nearest to the HQ stay)
    const sorted = home.slice().sort((a, b) => Math.hypot(b.x - hq.x, b.y - hq.y) - Math.hypot(a.x - hq.x, a.y - hq.y));
    const n = Math.max(1, Math.round(sorted.length * this.cfg.strikeShare));
    this.strike.clear();
    let v = 0;
    for (let i = 0; i < n; i++) { this.strike.add(sorted[i].id); v += this.value(sorted[i]); }
    this.strikeStart = v;
    this.mode = 'attack';
    this.targetId = t.id;
    this.farmHold = 0;
    this.runAttack(w, sorted.slice(0, n));
  }

  private recall(w: World, strike: Entity[], to?: Pt): void {
    const p = to ?? this.homePoint();
    this.amove(w, strike, p.x, p.y, 3);
    this.strike.clear();
    this.mode = 'home';
    this.targetId = 0;
    this.attackAt = w.time + 20;
    const nets = this.s.netrunners.filter((n) => n.order?.type !== 'hack');
    if (nets.length) w.commands.push({ c: 'order', ids: nets.map((n) => n.id), order: { type: 'move', x: p.x, y: p.y } });
  }

  private runAttack(w: World, strike: Entity[]): void {
    const A = w.axiom, s = this.s;
    if (!strike.length) { this.mode = 'home'; this.targetId = 0; this.attackAt = w.time + 15; return; }
    let v = 0;
    for (const u of strike) v += this.value(u);
    const c = this.centroid(strike);
    const hq = s.hq!;
    const distHome = Math.hypot(c.x - hq.x, c.y - hq.y);
    // retreat: too weak, or a surge is about to land and we are far away
    const travel = distHome / 2.3 + 10;
    if (v < this.strikeStart * 0.35 || (A.tuning.surges && this.level > 0 && A.surgeT < travel && A.surgeT > 0 && distHome > 20)) {
      this.recall(w, strike);
      return;
    }
    let t = w.get(this.targetId);
    if (t && t.kind === 'server_farm') {
      if (t.team === HUMAN) { this.farmHold++; if (this.farmHold > 3) t = undefined; }
    }
    if (!t || (t.team !== AXIOM && t.kind !== 'server_farm')) {
      const nt = this.pickTarget(w, v);
      if (!nt) { this.recall(w, strike); return; }
      this.targetId = nt.id;
      this.farmHold = 0;
      t = nt;
    }
    const dT = Math.hypot(c.x - t.x, c.y - t.y);
    let wx = t.x, wy = t.y;
    if (t.kind === 'server_farm') wy = t.y + 2.2;
    if (dT > 9) {
      const p = this.advance(w, t, c);
      wx = p.x; wy = p.y;
    }
    const lead = strike.filter((u) => Math.hypot(u.x - c.x, u.y - c.y) < 14);
    const lag = strike.filter((u) => Math.hypot(u.x - c.x, u.y - c.y) >= 14);
    this.amove(w, lead, wx, wy, 2.5);
    if (lag.length) this.amove(w, lag, c.x, c.y, 4);
  }

  /** Next waypoint ~8 tiles ahead of the blob along a flow field toward the target. */
  private advance(w: World, t: Entity, c: Pt): Pt {
    if (!this.atkField) this.atkField = new FlowField(w.w, w.h);
    const f = this.atkField;
    if (this.atkFieldKey !== t.id || w.time - this.atkFieldAt > 15) {
      const goals: number[] = [];
      for (let y = t.ty; y < t.ty + t.size; y++) for (let x = t.tx; x < t.tx + t.size; x++) goals.push(y * w.w + x);
      f.build(w.grid, goals, 'siege');
      this.atkFieldKey = t.id;
      this.atkFieldAt = w.time;
    }
    let i = (c.y | 0) * w.w + (c.x | 0);
    if (!(f.dist[i] < Infinity)) return { x: t.x, y: t.y };
    for (let k = 0; k < 8 && f.next[i] >= 0; k++) i = f.next[i];
    return { x: (i % w.w) + 0.5, y: ((i / w.w) | 0) + 0.5 };
  }

  // ================================================================ netrunners
  private hackers(w: World): void {
    const s = this.s, H = w.human;
    if (!s.netrunners.length) return;
    const claimed = new Set<number>();
    for (const n of s.netrunners) if (n.order?.type === 'hack') claimed.add(n.order.id);
    const strike = [...this.strike].map((id) => w.get(id)).filter((u): u is Entity => !!u);
    const anchor = this.mode === 'attack' && strike.length ? this.centroid(strike) : this.homePoint();
    for (const n of s.netrunners) {
      if (n.order?.type === 'hack') {
        const t = w.get(n.order.id);
        if (t && t.team === AXIOM && Math.hypot(t.x - n.x, t.y - n.y) < 9) continue;
      }
      let live = 0;
      for (const id of n.links) if (w.get(id)) live++;
      if (live < H.bandwidth) {
        let best: Entity | null = null, bs = -Infinity;
        const cnt = w.hash.queryRadius(n.x, n.y, 8, this.hashBuf);
        for (let i = 0; i < cnt; i++) {
          const t = w.byId.get(this.hashBuf[i]);
          if (!t || !t.alive || t.team !== AXIOM || claimed.has(t.id) || !hackEligible(w, t)) continue;
          const d = Math.hypot(t.x - n.x, t.y - n.y);
          if (d > 7.5) continue;
          const sc = (t.udef?.compute ?? 10) - d * 2 + (t.stunUntil > w.time ? 10 : 0);
          if (sc > bs) { bs = sc; best = t; }
        }
        if (best) {
          claimed.add(best.id);
          w.commands.push({ c: 'order', ids: [n.id], order: { type: 'hack', id: best.id } });
          continue;
        }
      }
      if (n.order?.type === 'hack') continue;
      // stay a little behind the army
      const hq = s.hq!;
      const dx = hq.x - anchor.x, dy = hq.y - anchor.y, d = Math.hypot(dx, dy) || 1;
      const px = anchor.x + (dx / d) * 2.5, py = anchor.y + (dy / d) * 2.5;
      const o = n.order as Order | null;
      const tgt = o && (o.type === 'move' || o.type === 'amove') ? o : null;
      if (Math.hypot(n.x - px, n.y - py) > 4 && (!tgt || Math.hypot(tgt.x - px, tgt.y - py) > 3)) {
        w.commands.push({ c: 'order', ids: [n.id], order: { type: 'move', x: px, y: py } });
      }
    }
  }

  // ================================================================ protocols
  private protocols(w: World): void {
    const s = this.s, H = w.human;
    const hq = s.hq!;
    // research needs data first; protocols spend the surplus
    const nextR = this.nextResearch(w);
    const keep = this.level === 0 ? 0 : nextR ? Math.min(60, RESEARCH[nextR].cost.data ?? 0) : 0;
    const can = (id: string, extra = 0) => protocolAvailable(w, id).ok && this.data >= extra;
    if (this.cfg.protocols) {
      // cluster scan around the fight (threats, or the strike group)
      const cands: Entity[] = s.threats.length ? s.threats : s.robots;
      const army = this.mode === 'attack' ? [...this.strike].map((id) => w.get(id)).filter((u): u is Entity => !!u) : s.army;
      const ac = army.length ? this.centroid(army) : { x: hq.x, y: hq.y };
      let bestC: Pt | null = null, bestN = 0, bestHack = 0, bestArmored = 0;
      const step = Math.max(1, Math.floor(cands.length / 40));
      for (let i = 0; i < cands.length; i += step) {
        const u = cands[i];
        if (Math.hypot(u.x - ac.x, u.y - ac.y) > 16 && Math.hypot(u.x - hq.x, u.y - hq.y) > s.baseR + 8) continue;
        const n = w.hash.queryRadius(u.x, u.y, 4, this.hashBuf);
        let k = 0, hk = 0, arm = 0;
        for (let j = 0; j < n; j++) {
          const o = w.byId.get(this.hashBuf[j]);
          if (!o || !o.alive || o.team !== AXIOM || Math.hypot(o.x - u.x, o.y - u.y) > 3.5) continue;
          k++;
          if (o.udef?.hackable) hk++;
          if (o.udef?.armor === 'armored') arm++;
        }
        if (k > bestN) { bestN = k; bestC = { x: u.x, y: u.y }; bestHack = hk; bestArmored = arm; }
      }
      if (bestC) {
        const freeBw = s.netrunners.reduce((a, n) => a + Math.max(0, H.bandwidth - n.links.filter((l) => w.get(l)).length), 0);
        const nearNets = s.netrunners.filter((n) => Math.hypot(n.x - bestC!.x, n.y - bestC!.y) < 9).length;
        if (bestN >= 10 + bestArmored * -2 && can('orbital', 60 + keep * 0.5)) {
          this.useProtocol(w, 'orbital', bestC);
          return;
        }
        if (bestHack >= 6 && this.level >= 2 && can('override', 80 + keep * 0.5)) {
          this.useProtocol(w, 'override', bestC);
          return;
        }
        if ((bestN >= 9 || (bestN >= 5 && nearNets > 0 && freeBw >= 3)) && can('emp', 30 + keep * 0.5)) {
          this.useProtocol(w, 'emp', bestC);
          return;
        }
      }
      // orbital on a structure under attack when no swarm is around
      if (this.mode === 'attack') {
        const t = w.get(this.targetId);
        if (t && t.isBuilding && t.team === AXIOM && t.hp > 900 && Math.hypot(ac.x - t.x, ac.y - t.y) < 10 && can('orbital', 60 + keep)) {
          this.useProtocol(w, 'orbital', { x: t.x, y: t.y });
          return;
        }
      }
    }
    // supply drop when poor and data is spare
    if (this.scrap < 150 && w.time > 90 && can('supply', 40 + keep)) {
      this.useProtocol(w, 'supply', { x: hq.x, y: hq.y + hq.size / 2 + 1.5 });
    }
  }

  private useProtocol(w: World, id: string, p: Pt): void {
    if (!w.explored[(p.y | 0) * w.w + (p.x | 0)]) return;
    w.commands.push({ c: 'protocol', id, x: p.x, y: p.y });
    this.data -= id === 'orbital' ? 60 : id === 'override' ? 80 : id === 'emp' ? 30 : 40;
  }
}
