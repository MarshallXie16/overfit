import { BUILDINGS, PROTOCOLS, RESEARCH, UNITS } from './data/defs';
import { AXIOM_BAL } from './ai/axiom';
import { FlowField, WALK_OPEN, WALK_SLOW } from './path';
import { protocolAvailable } from './systems/economy';
import { hackEligible } from './systems/units';
import { AXIOM, DAMAGE_TYPES, HUMAN, TYPE_VS_ARMOR, type DamageType, type Pt } from './types';
import { DIFF, Rng, type Entity, type Order, type World } from './world';

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
    turretRate: 0.5, maxTurrets: 5, maxBarracks: 3, maxFactories: 1, maxLabs: 1, maxSites: 1, netrunners: 1,
    attackValue: 1100, attackRatio: 1.1, strikeShare: 0.85,
  },
  {
    engineers: 16, thinkEvery: 1, adapt: true, protocols: true, micro: true, walls: true,
    turretRate: 1, maxTurrets: 10, maxBarracks: 4, maxFactories: 2, maxLabs: 2, maxSites: 3, netrunners: 3,
    attackValue: 2000, attackRatio: 1.6, strikeShare: 0.8,
  },
  {
    engineers: 18, thinkEvery: 1, adapt: true, protocols: true, micro: true, walls: true,
    turretRate: 1.3, maxTurrets: 14, maxBarracks: 5, maxFactories: 2, maxLabs: 2, maxSites: 3, netrunners: 4,
    attackValue: 2200, attackRatio: 1.6, strikeShare: 0.8,
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
  /** after a failed push, wait for a bigger army before the next one */
  private minNext = 0;
  private minNextUntil = 0;
  private scoutId = 0;
  private wallsFor = new Set<number>();
  private farmHold = 0;
  private hashBuf: number[] = [];
  /** last decision summary (debug / tooling) */
  note = '';
  /** smoothed scrap income (per second) */
  income = 0;
  private gathered: number[] = [];

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
    this.gathered.push(H.stats.scrapGathered);
    if (this.gathered.length > 31) this.gathered.shift();
    this.income = (H.stats.scrapGathered - this.gathered[0]) / Math.max(1, (this.gathered.length - 1) * this.cfg.thinkEvery);
    if (!this.clusters) this.clusters = this.buildClusters();
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
    this.gathered = [];
    this.anchorCache = null;
    this.anchorAt = -99;
    this.homeFieldAt = -99;
    this.atkFieldAt = -99;
    this.attackAt = 0;
    this.minNext = 0;
    this.minNextUntil = 0;
    this.scoutId = 0;
    this.farmHold = 0;
    this.thinks = 0;
    this.income = 0;
    this.note = '';
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
  private buildClusters(): Cluster[] {
    const out: Cluster[] = [];
    for (const r of this.s.resources) {
      if (r.cat !== 'resource') continue;
      let c = out.find((k) => Math.hypot(k.x - r.x, k.y - r.y) < 5.5);
      if (!c) { c = { ids: [], x: r.x, y: r.y, amount: 0 }; out.push(c); }
      c.ids.push(r.id);
      c.x += (r.x - c.x) / c.ids.length;
      c.y += (r.y - c.y) / c.ids.length;
    }
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

  private anchorCache: Pt | null = null;
  private anchorAt = -99;

  /** Where the home army stands: just behind the turrets that cover the main front, in open ground. */
  private anchor(): Pt {
    const w = this.world!;
    if (this.anchorCache && w.time - this.anchorAt < 10) return this.anchorCache;
    const p = this.rawAnchor();
    this.anchorCache = this.openSpot(w, p.x, p.y) ?? p;
    this.anchorAt = w.time;
    return this.anchorCache;
  }

  /** Tile and its 8 neighbours are free ground (not a corridor / doorway). */
  private roomy(w: World, tx: number, ty: number): boolean {
    for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) if (!w.isWalkableTile(x, y)) return false;
    return true;
  }

  /** Nearest tile centre whose 5x5 neighbourhood is free ground (room for a blob of units). */
  private openSpot(w: World, x: number, y: number): Pt | null {
    const cx = x | 0, cy = y | 0;
    for (let r = 0; r <= 7; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx, ty = cy + dy;
        let ok = true;
        for (let yy = ty - 2; yy <= ty + 2 && ok; yy++) for (let xx = tx - 2; xx <= tx + 2 && ok; xx++) {
          if (!w.isWalkableTile(xx, yy)) ok = false;
        }
        if (ok) return { x: tx + 0.5, y: ty + 0.5 };
      }
    }
    return null;
  }

  private rawAnchor(): Pt {
    const hq = this.s.hq!;
    const f = this.fronts[0];
    let x = 0, y = 0, k = 0;
    for (const kind of TURRETS) for (const b of this.s.byKind.get(kind) ?? []) {
      if (!b.id || !b.built) continue;
      if (f && Math.hypot(b.x - f.x, b.y - f.y) > 12) continue;
      x += b.x; y += b.y; k++;
    }
    if (!k) return this.homePoint();
    const cx = x / k, cy = y / k;
    const dx = hq.x - cx, dy = hq.y - cy, d = Math.hypot(dx, dy) || 1;
    const back = Math.min(1.5, d * 0.3);
    return { x: cx + (dx / d) * back, y: cy + (dy / d) * back };
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
    let wallBuilders = 0;
    for (const e of s.engineers) { const o = e.order; if (o?.type === 'build') { const b = w.get(o.id); if (b?.kind === 'wall') wallBuilders++; } }
    for (const site of s.sites) {
      const want = site.kind === 'wall' ? 1 : site.size >= 3 ? 3 : 2;
      let have = buildersOf.get(site.id) ?? 0;
      if (have >= want) continue;
      if (site.kind === 'wall' && (have > 0 || wallBuilders >= 2)) continue;
      if (site.kind === 'wall') wallBuilders++;
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
      if (dd > (wreck ? 22 : 30)) continue;
      const de = Math.hypot(r.x - e.x, r.y - e.y);
      if (wreck && r.expire - w.time < de / 2.6 + 2) continue;
      const i = (r.y | 0) * w.w + (r.x | 0);
      if (w.creep[i] > 0.3) continue;
      const load = this.nodeLoad.get(r.id) ?? 0;
      let sc: number;
      if (wreck) {
        if (load >= Math.ceil(r.amount / 10)) continue;
        // wrecks decay: grab them first (they are usually right at the turret line)
        sc = dd * 0.8 + de * 0.3 + load * 2 - 10;
      } else sc = dd * 1.2 + de * 0.25 + load * load * 1.6;
      if (sc >= bs) continue;
      if (this.dangerAt(r.x, r.y, 7)) continue;
      bs = sc; best = r;
    }
    return best;
  }

  // ================================================================ construction
  private construction(w: World): void {
    const s = this.s, H = w.human, A = w.axiom, cfg = this.cfg;
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
    const turretWant = Math.min(cfg.maxTurrets, Math.floor(1 + this.level + A.surgeN * cfg.turretRate + (t > 600 ? 1 : 0)));
    const turrets = TURRETS.reduce((n, k) => n + this.count(k), 0);

    type Want = { kind: string; save: boolean; at?: () => Pt | null };
    const wants: Want[] = [];
    const nB = this.count('barracks'), nF = this.count('factory'), nL = this.count('lab');
    // production capacity (scrap/s a producer can turn into units) vs. income
    const capacity = nB * 4.5 + nF * 8;
    const income = this.income;
    // add a producer only when scrap is piling up while every queue is busy (or capacity is far below income)
    let queuesBusy = true;
    for (const k of ['barracks', 'factory']) for (const b of s.byKind.get(k) ?? []) if (b.id && b.built && b.prod.length < 2) queuesBusy = false;
    const floating = this.scrap > 300 + this.reserve && queuesBusy;
    const wantProducer = t > 75 && (capacity < income * 0.45 || floating) && nB + nF > 0 && this.count('barracks', true) === nB && this.count('factory', true) === nF;
    // economy starving (fields near our drop-offs are gone): a new Depot comes first
    const depot = this.depotPlan(w);
    const starving = depot && this.income < 6 && t > 240;
    if (starving) wants.push({ kind: 'depot', save: true, at: () => depot });
    if (nB < 1) wants.push({ kind: 'barracks', save: true });
    if (powerFree < 3 + (nB ? 2 : 0) && this.count('generator') - this.count('generator', true) < 1) wants.push({ kind: 'generator', save: true });
    if (popFree < 2 + producers * 1.5 && H.popCap + pendingPop < 150 && this.count('habitat') - this.count('habitat', true) < 1) wants.push({ kind: 'habitat', save: true });
    if (turrets < turretWant && nB > 0) wants.push({ kind: this.pickTurret(w), save: surgeSoon || turrets < 2, at: () => this.turretSpot(w) });
    if (nL < 1 && this.count('barracks', true) > 0 && (t > 110 || this.scrap > 350)) wants.push({ kind: 'lab', save: t > 150 });
    if (wantProducer) {
      if (nF < 1 && this.count('lab', true) > 0 && nB >= 2) wants.push({ kind: 'factory', save: false });
      else if (nB < cfg.maxBarracks) wants.push({ kind: 'barracks', save: false });
      else if (nF < cfg.maxFactories && this.count('lab', true) > 0) wants.push({ kind: 'factory', save: false });
    }
    if (depot && !starving) wants.push({ kind: 'depot', save: false, at: () => depot });
    if (nF < 1 && this.count('lab', true) > 0 && t > 300) wants.push({ kind: 'factory', save: t > 400 });
    if (nL < 2 && cfg.maxLabs >= 2 && this.count('lab', true) > 0 && (t > 600 || this.data > 120) && this.scrap > 300) wants.push({ kind: 'lab', save: false });

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
      for (const d of s.dropoffs) dd = Math.min(dd, Math.hypot(d.x - c.x, d.y - c.y) - d.size / 2);
      for (const d of s.byKind.get('depot') ?? []) if (d.id) dd = Math.min(dd, Math.hypot(d.x - c.x, d.y - c.y) - 1);
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
    const issued = new Set<string>();
    for (const lab of s.byKind.get('lab') ?? []) {
      if (!lab.id || !lab.built || lab.researching) continue;
      const id = this.nextResearch(w, issued);
      if (!id) break;
      issued.add(id);
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
    if (b.kind !== 'hq' && this.thinks % 10 === 0) {
      const p = this.anchor();
      if (!b.rally || Math.hypot(b.rally.x - p.x, b.rally.y - p.y) > 3) w.commands.push({ c: 'rally', ids: [b.id], x: p.x, y: p.y });
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

  private nextResearch(w: World, skip?: Set<string>): string | null {
    const H = w.human;
    const best = this.bestTypes(w);
    const order: string[] = ['salvage'];
    const dmg1 = best.map((k) => k + '1');
    const dmg2 = best.map((k) => k + '2');
    if (this.level === 0) order.push(dmg1[0], 'armor1', 'railguns', dmg1[1], dmg1[2], 'proto_emp');
    else order.push(dmg1[0], 'armor1', 'proto_emp', 'proto_orbital', dmg1[1], dmg2[0], 'railguns', 'bandwidth', dmg1[2], 'armor2', dmg2[1], 'proto_override', dmg2[2]);
    for (const id of order) {
      if (H.research.has(id) || skip?.has(id)) continue;
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

    // ---------------------------------------------------------- base defence
    const anchor = this.anchor();
    if (s.threats.length) {
      // group threats into clusters
      const cl: { x: number; y: number; v: number; n: number }[] = [];
      for (const u of s.threats) {
        let c = cl.find((q) => Math.hypot(q.x - u.x, q.y - u.y) < 7);
        if (!c) { c = { x: u.x, y: u.y, v: 0, n: 0 }; cl.push(c); }
        c.n++;
        c.x += (u.x - c.x) / c.n; c.y += (u.y - c.y) / c.n;
        c.v += this.value(u);
      }
      cl.sort((a, b) => b.v - a.v);
      const used = new Set<number>();
      let frontV = 0;
      for (const c of cl) {
        const dA = Math.hypot(c.x - anchor.x, c.y - anchor.y);
        // how close is this group to any of our structures?
        let bd = Infinity;
        for (const b of s.blds) { const d = Math.hypot(b.x - c.x, b.y - c.y) - b.size / 2; if (d < bd) bd = d; }
        if (dA >= 16 && bd > 7) continue; // still approaching: let it come to the turret line
        if (dA < 16) {
          // fight at the turret line: step out at most ~5 tiles toward the enemy
          frontV += c.v;
          const k = Math.min(1, 5 / Math.max(1, dA));
          const px = anchor.x + (c.x - anchor.x) * k, py = anchor.y + (c.y - anchor.y) * k;
          const g = home.filter((u) => !used.has(u.id) && Math.hypot(u.x - anchor.x, u.y - anchor.y) < 22);
          for (const u of g) used.add(u.id);
          this.amove(w, g.filter((u) => !u.order || Math.hypot(u.x - px, u.y - py) > 6), px, py, 3);
        } else {
          // raid elsewhere: send the nearest units with enough punch
          const g = home.filter((u) => !used.has(u.id)).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
          const pick: Entity[] = [];
          let v = 0;
          for (const u of g) {
            if (v >= c.v * 1.6 && pick.length >= 4) break;
            if (frontV > 0 && pick.length >= g.length * 0.5) break;
            pick.push(u); v += this.value(u); used.add(u.id);
          }
          this.amove(w, pick, c.x, c.y, 3);
        }
      }
      // a boss in the base: everything that can hurt armour focuses it (infantry keeps the escorts busy)
      const boss = s.threats.find((u) => u.udef?.boss);
      if (boss) {
        const focus = home.filter((u) => {
          const wpn = u.udef?.weapon;
          return wpn && (wpn.type === 'explosive' || wpn.range >= 6.5 || u.udef!.armor === 'armored') && Math.hypot(u.x - boss.x, u.y - boss.y) < 18;
        });
        const ids = focus.filter((u) => u.order?.type !== 'attack' || u.order.id !== boss.id).map((u) => u.id);
        if (ids.length) w.commands.push({ c: 'order', ids, order: { type: 'attack', id: boss.id } });
      }
      const big = s.threats.length >= 6 || A.surgeActive;
      if (big && strike.length && this.mode === 'attack') {
        const sc = this.centroid(strike);
        const far = Math.hypot(sc.x - hq.x, sc.y - hq.y);
        let threatValue = 0;
        for (const c of cl) threatValue += c.v;
        let homeValue = 0;
        for (const u of home) homeValue += this.value(u);
        if (threatValue > homeValue * 0.8 + 300 || far < 30) this.recall(w, strike, anchor);
      }
    } else {
      // regroup home units around the anchor (each to its own spot so the blob doesn't pile up)
      for (const u of home) {
        if (Math.hypot(u.x - anchor.x, u.y - anchor.y) <= 7 || (u.order && u.order.type !== 'amove')) continue;
        let px = anchor.x, py = anchor.y;
        for (let j = 0; j < 29; j++) {
          const k = (u.id + j) % 29, a = k * 2.39996, r = 0.7 * Math.sqrt(k);
          const qx = anchor.x + Math.cos(a) * r, qy = anchor.y + Math.sin(a) * r;
          if (this.roomy(w, qx | 0, qy | 0)) { px = qx; py = qy; break; }
        }
        const o = u.order;
        if (o && o.type === 'amove' && Math.hypot(o.x - px, o.y - py) < 1.5) continue;
        w.commands.push({ c: 'order', ids: [u.id], order: { type: 'amove', x: px, y: py } });
      }
    }

    // ---------------------------------------------------------- attacks
    if (this.mode === 'attack') this.runAttack(w, strike);
    else if (w.time > this.attackAt) {
      let homeValue = 0, threatV = 0;
      for (const u of home) homeValue += this.value(u);
      for (const u of s.threats) threatV += this.value(u);
      // AXIOM without Fabricators only spawns at the Core: go for the kill even mid-cycle
      const weak = !s.axStructs.some((b) => b.kind === 'fabricator') && s.axStructs.some((b) => b.kind === 'core');
      const quiet = threatV <= homeValue * (weak ? 0.25 : 0.02);
      // a Cascade (every 4th Surge) is coming: keep the army home for it
      const cascadeNext = (A.surgeN + 1) % 4 === 0 && A.surgeT < 150 && this.level > 0;
      const surgeWindow = !A.tuning.surges || weak || (!cascadeNext && (A.surgeT > (this.level === 0 ? 30 : 70) || (A.surgeN === 0 && A.surgeT > 60)));
      if (quiet && surgeWindow && (!A.surgeActive || weak)) {
        let minV = cfg.attackValue * (weak ? 1 : 1 + 0.12 * (A.threat - 1));
        if (w.time < this.minNextUntil) minV = Math.max(minV, this.minNext);
        this.note = `home ${homeValue | 0}/${minV | 0}`;
        if (homeValue >= minV) {
          const t = this.pickTarget(w, homeValue);
          this.note += t ? ` -> ${t.kind}#${t.id}` : ' no target';
          if (!t) { const core = s.axStructs.find((b) => b.kind === 'core'); if (core) this.note += ` coreDef ${this.defenseAt(core) | 0}`; }
          if (t) this.launch(w, t, home);
        }
      }
    }
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

  /** Defending value around an AXIOM structure (the bot is allowed to know roughly where the swarm is). */
  private defenseAt(b: Entity): number {
    let def = 0;
    for (const u of this.s.allRobots) if (Math.abs(u.x - b.x) < 12 && Math.abs(u.y - b.y) < 12) def += this.value(u);
    for (const o of this.s.axStructs) if (o.bdef?.weapon && Math.hypot(o.x - b.x, o.y - b.y) < 9) def += o.kind === 'core' ? 900 : 350;
    // key structures call in reinforcements while under siege
    if (b.kind === 'core') def += 1200;
    else if (b.kind === 'fabricator' || b.kind === 'vault') def += 400;
    return def;
  }

  private pickTarget(w: World, armyValue: number, from?: Pt): Entity | null {
    const s = this.s, hq = s.hq!;
    const o = from ?? hq;
    let best: Entity | null = null, bs = Infinity;
    const fabs = s.axStructs.filter((b) => b.kind === 'fabricator').length;
    const A = w.axiom;
    const resist = A.resist.kinetic + A.resist.energy + A.resist.explosive;
    const cands: Entity[] = [...s.axStructs];
    if (this.level > 0) for (const f of s.farms) if (f.team === AXIOM) cands.push(f);
    for (const b of cands) {
      if (!b.alive) continue;
      let sc = Math.hypot(b.x - o.x, b.y - o.y) * 0.7 + Math.hypot(b.x - hq.x, b.y - hq.y) * 0.3;
      switch (b.kind) {
        case 'relay': sc -= 8; break;
        case 'lancet': sc -= 4; break;
        case 'fabricator': sc -= 16; break;
        case 'vault': sc -= resist > 0.6 ? 22 : 6; break;
        case 'core': sc += fabs > 0 ? 20 : -25; break;
        case 'server_farm': sc += 4; break;
      }
      const def = this.defenseAt(b);
      // final push: once the Fabricators are gone (or we are maxed out) accept an even fight at the Core
      const maxed = w.human.pop >= Math.min(140, w.human.popCap) - 8;
      const ratio = b.kind === 'core' && (fabs === 0 || maxed) ? 1.0 : this.cfg.attackRatio;
      if (armyValue < def * ratio) continue;
      sc += def / 150;
      if (sc < bs) { bs = sc; best = b; }
    }
    return best;
  }

  /** Can the base hold the next surge without the strike group? */
  private homeCanHold(w: World, home: Entity[]): boolean {
    const A = w.axiom;
    const D = DIFF[w.settings.difficulty];
    let hv = 0;
    for (const u of home) hv += this.value(u);
    for (const k of TURRETS) for (const b of this.s.byKind.get(k) ?? []) if (b.id && b.built) hv += 380 * b.hp / b.maxHp;
    const n = A.surgeN + 1;
    const damp = Math.min(1, AXIOM_BAL.surgeDamp0 + AXIOM_BAL.surgeDampStep * (n - 1));
    // pool keeps growing until launch: extrapolate to the launch time
    const pool = A.surgePool + A.computeRate * AXIOM_BAL.surgeShare * Math.max(0, A.surgeT);
    const expected = pool * D.surge * damp * 4.3 * (n % 4 === 0 ? 1.4 : 1);
    return hv > expected * 1.4;
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
    const p = to ?? this.anchor();
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
    if (v < this.strikeStart * 0.35) {
      this.minNext = this.strikeStart * 1.3;
      this.minNextUntil = w.time + 240;
      this.recall(w, strike);
      return;
    }
    if (A.tuning.surges && this.level > 0 && A.surgeT < travel && A.surgeT > 0 && distHome > 20) {
      const home = s.army.filter((u) => !this.strike.has(u.id));
      if (!this.homeCanHold(w, home)) { this.recall(w, strike); return; }
    }
    let t = w.get(this.targetId);
    if (t && t.kind === 'server_farm') {
      if (t.team === HUMAN) { this.farmHold++; if (this.farmHold > 3) t = undefined; }
    }
    if (!t || (t.team !== AXIOM && t.kind !== 'server_farm')) {
      const nt = this.pickTarget(w, v, c);
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
    const anchor = this.mode === 'attack' && strike.length ? this.centroid(strike) : this.anchor();
    for (const n of s.netrunners) {
      if (n.order?.type === 'hack') {
        const t = w.get(n.order.id);
        if (t && t.team === AXIOM && Math.hypot(t.x - n.x, t.y - n.y) < 9) continue;
      }
      let live = 0;
      for (const id of n.links) if (w.get(id)) live++;
      if (live < H.bandwidth) {
        let best: Entity | null = null, bs = -Infinity;
        // at home the turret line covers the walk to a victim, so look a little further
        const reach = this.mode === 'attack' ? 7.5 : 9.5;
        const cnt = w.hash.queryRadius(n.x, n.y, reach + 0.5, this.hashBuf);
        for (let i = 0; i < cnt; i++) {
          const t = w.byId.get(this.hashBuf[i]);
          if (!t || !t.alive || t.team !== AXIOM || claimed.has(t.id) || !hackEligible(w, t)) continue;
          const d = Math.hypot(t.x - n.x, t.y - n.y);
          if (d > reach) continue;
          // valuable, stunned (an EMP'd robot at full health survives the channel), and not about
          // to die under our own guns
          const stunned = t.stunUntil > w.time + 1;
          const frail = t.hp < t.maxHp * (stunned ? 0.2 : 0.3);
          const sc = (t.udef?.compute ?? 10) - d * 2 + (stunned ? 20 : 0) - (frail ? 25 : 0);
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
      const boss = cands.find((u) => u.udef?.boss && (Math.hypot(u.x - hq.x, u.y - hq.y) < s.baseR + 12 || Math.hypot(u.x - ac.x, u.y - ac.y) < 14));
      if (boss && can('orbital', 60)) { this.useProtocol(w, 'orbital', { x: boss.x, y: boss.y }); return; }
      if (bestC) {
        const freeBw = s.netrunners.reduce((a, n) => a + Math.max(0, H.bandwidth - n.links.filter((l) => w.get(l)).length), 0);
        const nearNets = s.netrunners.filter((n) => Math.hypot(n.x - bestC!.x, n.y - bestC!.y) < 9).length;
        // orbital: dense packs (armoured robots count double — they take 1.5x)
        if (bestN + bestArmored >= 10 && can('orbital', 60 + keep * 0.5)) {
          this.useProtocol(w, 'orbital', bestC);
          return;
        }
        if (bestHack >= 6 && this.level >= 2 && can('override', 80 + keep * 0.5)) {
          this.useProtocol(w, 'override', bestC);
          return;
        }
        if ((bestN >= 9 || (bestN >= 4 && nearNets > 0 && freeBw >= 2)) && can('emp', 30 + keep * 0.5)) {
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
    this.data -= PROTOCOLS[id].data;
  }
}
