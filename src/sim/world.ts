import { BUILDINGS, UNITS, type BuildingDef, type UnitDef } from './data/defs';
import { FlowField, SpatialHash, WALK_BLOCKED, WALK_OPEN, WALK_SLOW, WALK_STRUCTURE, type PathGrid } from './path';
import {
  AXIOM, HUMAN, T_RUBBLE, T_RUIN, T_WATER,
  type DamageType, type Difficulty, type GameMode, type Pt, type SimEvent, type Team,
} from './types';

// ------------------------------------------------------------------ rng
export class Rng {
  s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number): boolean { return this.next() < p; }
}

// ------------------------------------------------------------------ orders
export type Order =
  | { type: 'move'; x: number; y: number }
  | { type: 'amove'; x: number; y: number }
  | { type: 'attack'; id: number }
  | { type: 'harvest'; id: number }
  | { type: 'return' }
  | { type: 'build'; id: number }
  | { type: 'repair'; id: number }
  | { type: 'hack'; id: number }
  | { type: 'hold' }
  | { type: 'flow'; field: string; tx: number; ty: number } // AXIOM: follow a flow field toward (tx,ty)
  | { type: 'guard'; x: number; y: number }; // AXIOM garrison: loiter around a point

export type Cat = 'unit' | 'building' | 'resource' | 'wreck';

export interface Projectile {
  x: number; y: number; px: number; py: number;
  sx: number; sy: number;
  tx: number; ty: number;
  targetId: number;
  speed: number;
  wpn: import('./data/defs').WeaponDef;
  team: Team;
  ownerId: number;
  homing: boolean;
  t: number; total: number;
  alive: boolean;
}

export interface ProdItem { kind: string; t: number; total: number }

export class Entity {
  id: number;
  kind: string;
  cat: Cat;
  team: Team;
  udef: UnitDef | null = null;
  bdef: BuildingDef | null = null;
  x: number; y: number; px: number; py: number;
  angle = 0; turretAngle = 0;
  hp = 1; maxHp = 1;
  radius = 0.3;
  alive = true;
  // unit state
  order: Order | null = null;
  queue: Order[] = [];
  path: Pt[] | null = null;
  pathI = 0;
  pathGX = 0; pathGY = 0;
  repathAt = 0;
  stuckT = 0;
  lastDist = 0;
  vx = 0; vy = 0;
  moving = false;
  targetId = 0;
  cd = 0;
  acquireAt = 0;
  carrying = 0;
  gatherT = 0;
  lastNodeId = 0;
  stunUntil = 0;
  hackedBy = 0; // netrunner id controlling this unit (0 = none / protocol)
  hackExpire = 0; // Override protocol: revert at this time
  links: number[] = []; // netrunner: hacked unit ids
  hackT = 0;
  hackTarget = 0;
  hacked = false;
  attackedAt = -99;
  attackerId = 0;
  holdFire = false;
  firedAt = -99;
  // building state
  tx = 0; ty = 0; size = 1;
  built = true;
  progress = 1;
  prod: ProdItem[] = [];
  rally: Pt | null = null;
  researching: { id: string; t: number; total: number } | null = null;
  // capture (server farm)
  capture = 0; // -1 (axiom) .. +1 (human)
  // resource / wreck
  amount = 0;
  expire = 0;
  variant = 0;
  // AXIOM
  homeId = 0;
  squad = 0;
  /** idle anchor (units return here after chasing) */
  ax = 0; ay = 0;
  /** engineers working on this construction site this tick */
  builders = 0;
  /** loiter target for guard orders */
  lx = 0; ly = 0; loiterAt = 0;
  constructor(id: number, kind: string, cat: Cat, team: Team, x: number, y: number) {
    this.id = id; this.kind = kind; this.cat = cat; this.team = team;
    this.x = this.px = x; this.y = this.py = y;
  }
  get isUnit(): boolean { return this.cat === 'unit'; }
  get isBuilding(): boolean { return this.cat === 'building'; }
  get isRobot(): boolean { return this.udef?.side === 'axiom'; }
  get flying(): boolean { return !!this.udef?.flying; }
  get armor() { return this.udef ? this.udef.armor : 'structure'; }
  get sight(): number { return this.udef ? this.udef.sight : this.bdef ? this.bdef.sight : 0; }
}

// ------------------------------------------------------------------ player state
export interface PlayerStats {
  killed: number; lost: number; hacked: number; scrapGathered: number; dataEarned: number;
  built: number; trained: number; surgesSurvived: number; peakSwarm: number;
}

export class HumanState {
  scrap = 0;
  data = 0;
  power = 0;
  powerUsed = 0;
  pop = 0;
  popCap = 0;
  research = new Set<string>();
  protocolCd: Record<string, number> = {};
  dmgMul: Record<DamageType, number> = { kinetic: 1, energy: 1, explosive: 1 };
  hpMul = 1;
  harvestMul = 1;
  wreckMul = 1;
  bandwidth = 3;
  hackTime = 2.5;
  stats: PlayerStats = { killed: 0, lost: 0, hacked: 0, scrapGathered: 0, dataEarned: 0, built: 0, trained: 0, surgesSurvived: 0, peakSwarm: 0 };
  get brownout(): boolean { return this.powerUsed > this.power; }
  get powerRatio(): number { return this.powerUsed <= this.power ? 1 : Math.max(0.25, this.power / Math.max(1, this.powerUsed)); }
}

export class AxiomState {
  compute = 0;
  computeRate = 0;
  totalCompute = 0;
  threat = 1;
  surgeT = 180;
  surgeN = 0;
  surgeActive = false;
  epochT = 75;
  epochLen = 75;
  epoch = 0;
  resist: Record<DamageType, number> = { kinetic: 0, energy: 0, explosive: 0 };
  vuln: Record<DamageType, number> = { kinetic: 0, energy: 0, explosive: 0 };
  dmgTaken: Record<DamageType, number> = { kinetic: 0, energy: 0, explosive: 0 };
  lastAdapt: DamageType | null = null;
  raidT = 150;
  expandT = 50;
  creepTiles = 0;
  farms = 0;
  units = 0;
  surgePool = 0;
  /** direction hints for UI: tiles where next surge will come from */
  surgeFrom: Pt[] = [];
  enabled = true;
  tuning = { aggression: 1, expand: true, surges: true, raids: true, surgeInterval: 150 };
}

export interface GameSettings {
  mode: GameMode;
  difficulty: Difficulty;
  seed: number;
  mapSize: number;
  missionId?: string;
}

export const DIFF: Record<Difficulty, { compute: number; epoch: number; surge: number; firstSurge: number; startScrap: number }> = {
  recruit: { compute: 0.7, epoch: 90, surge: 0.7, firstSurge: 240, startScrap: 500 },
  veteran: { compute: 1.0, epoch: 75, surge: 1.0, firstSurge: 180, startScrap: 400 },
  nightmare: { compute: 1.4, epoch: 60, surge: 1.35, firstSurge: 150, startScrap: 350 },
};

// ------------------------------------------------------------------ commands (player → sim)
export type Command =
  | { c: 'order'; ids: number[]; order: Order; queue?: boolean }
  | { c: 'smart'; ids: number[]; x: number; y: number; targetId: number; queue?: boolean }
  | { c: 'stop'; ids: number[] }
  | { c: 'place'; kind: string; tx: number; ty: number; builders: number[]; queue?: boolean }
  | { c: 'train'; building: number; kind: string }
  | { c: 'cancelTrain'; building: number; index: number }
  | { c: 'research'; building: number; id: string }
  | { c: 'cancelResearch'; building: number }
  | { c: 'rally'; ids: number[]; x: number; y: number }
  | { c: 'protocol'; id: string; x: number; y: number }
  | { c: 'cancelBuild'; id: number }
  | { c: 'demolish'; id: number };

// ------------------------------------------------------------------ world
export class World {
  tick = 0;
  time = 0;
  rng: Rng;
  settings: GameSettings;
  w: number; h: number;
  terrain: Uint8Array;
  grid: PathGrid;
  /** building occupying a tile (entity id) or 0 */
  occ: Int32Array;
  creep: Float32Array;
  /** tile is fed by an AXIOM grid emitter */
  creepSrc: Uint8Array;
  vis: Uint8Array;
  explored: Uint8Array;
  entities: Entity[] = [];
  byId = new Map<number, Entity>();
  nextId = 1;
  events: SimEvent[] = [];
  commands: Command[] = [];
  projectiles: Projectile[] = [];
  /** pending delayed effects (orbital strikes etc.) */
  delayed: { at: number; kind: string; x: number; y: number; r: number }[] = [];
  human = new HumanState();
  axiom = new AxiomState();
  hash: SpatialHash;
  fields = new Map<string, FlowField>();
  fieldDirty = true;
  result: null | 'victory' | 'defeat' = null;
  resultReason = '';
  paused = false;
  /** per-mission scripting hook, called every tick */
  script: ((w: World) => void) | null = null;
  /** mission objectives exposed to UI */
  objectives: { id: string; text: string; done: boolean; failed?: boolean; progress?: string }[] = [];
  flags: Record<string, number | boolean | string> = {};
  /** reveal entire map (debug / endgame) */
  revealAll = false;
  /** spawn point(s) for the player's base (for camera) */
  playerStart: Pt = { x: 0, y: 0 };
  axiomStart: Pt = { x: 0, y: 0 };

  constructor(w: number, h: number, settings: GameSettings) {
    this.w = w; this.h = h;
    this.settings = settings;
    this.rng = new Rng(settings.seed);
    this.terrain = new Uint8Array(w * h);
    this.grid = { w, h, walk: new Uint8Array(w * h).fill(WALK_OPEN), version: 0 };
    this.occ = new Int32Array(w * h);
    this.creep = new Float32Array(w * h);
    this.creepSrc = new Uint8Array(w * h);
    this.vis = new Uint8Array(w * h);
    this.explored = new Uint8Array(w * h);
    this.hash = new SpatialHash(w, h, 2);
  }

  idx(tx: number, ty: number): number { return ty * this.w + tx; }
  inBounds(tx: number, ty: number): boolean { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }

  emit(e: SimEvent): void { this.events.push(e); }

  get(id: number): Entity | undefined {
    const e = this.byId.get(id);
    return e && e.alive ? e : undefined;
  }

  /** Recompute walk code from terrain + occupancy for one tile. */
  refreshWalk(i: number): void {
    const t = this.terrain[i];
    let code: number;
    if (t === T_WATER || t === T_RUIN) code = WALK_BLOCKED;
    else if (this.occ[i]) code = WALK_STRUCTURE;
    else if (t === T_RUBBLE) code = WALK_SLOW;
    else code = WALK_OPEN;
    this.grid.walk[i] = code;
  }

  rebuildWalk(): void {
    for (let i = 0; i < this.w * this.h; i++) this.refreshWalk(i);
    this.grid.version++;
    this.fieldDirty = true;
  }

  isWalkableTile(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return false;
    const c = this.grid.walk[ty * this.w + tx];
    return c === WALK_OPEN || c === WALK_SLOW;
  }

  // ---------------------------------------------------------------- spawning
  spawnUnit(kind: string, team: Team, x: number, y: number): Entity {
    const def = UNITS[kind];
    if (!def) throw new Error('unknown unit ' + kind);
    const e = new Entity(this.nextId++, kind, 'unit', team, x, y);
    e.udef = def;
    e.radius = def.radius;
    const hpMul = team === HUMAN && def.side === 'human' ? this.human.hpMul : 1;
    e.maxHp = e.hp = def.hp * hpMul;
    e.angle = this.rng.range(-Math.PI, Math.PI);
    e.turretAngle = e.angle;
    e.acquireAt = this.time + this.rng.range(0, 0.3);
    this.add(e);
    return e;
  }

  /** Place building occupying tiles [tx,tx+size)×[ty,ty+size). */
  spawnBuilding(kind: string, team: Team, tx: number, ty: number, built = true): Entity {
    const def = BUILDINGS[kind];
    if (!def) throw new Error('unknown building ' + kind);
    const s = def.size;
    const e = new Entity(this.nextId++, kind, 'building', team, tx + s / 2, ty + s / 2);
    e.bdef = def;
    e.tx = tx; e.ty = ty; e.size = s;
    e.radius = s * 0.5;
    e.maxHp = def.hp;
    e.built = built;
    e.progress = built ? 1 : 0;
    e.hp = built ? def.hp : Math.max(1, def.hp * 0.1);
    e.angle = 0;
    e.turretAngle = team === AXIOM ? Math.PI : 0;
    if (kind !== 'server_farm') this.occupy(e, true);
    else this.occupy(e, true);
    this.add(e);
    return e;
  }

  spawnResource(kind: 'scrap' | 'wreck', x: number, y: number, amount: number, variant = 0): Entity {
    const e = new Entity(this.nextId++, kind, kind === 'scrap' ? 'resource' : 'wreck', 0, x, y);
    e.amount = amount;
    e.variant = variant;
    e.radius = 0.45;
    e.hp = e.maxHp = 1;
    if (kind === 'wreck') e.expire = this.time + 45;
    this.add(e);
    return e;
  }

  private add(e: Entity): void {
    this.entities.push(e);
    this.byId.set(e.id, e);
  }

  occupy(e: Entity, on: boolean): void {
    for (let y = e.ty; y < e.ty + e.size; y++) {
      for (let x = e.tx; x < e.tx + e.size; x++) {
        if (!this.inBounds(x, y)) continue;
        const i = y * this.w + x;
        this.occ[i] = on ? e.id : 0;
        this.refreshWalk(i);
      }
    }
    this.grid.version++;
    this.fieldDirty = true;
  }

  /** Mark dead; removal happens in cleanup(). */
  kill(e: Entity): void {
    if (!e.alive) return;
    e.alive = false;
    if (e.isBuilding) this.occupy(e, false);
  }

  cleanup(): void {
    let j = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.alive) this.entities[j++] = e;
      else this.byId.delete(e.id);
    }
    this.entities.length = j;
  }

  // ---------------------------------------------------------------- queries
  /** Can a building of `size` be placed with top-left (tx,ty)? */
  canPlace(kind: string, tx: number, ty: number, team: Team = HUMAN): { ok: boolean; reason?: string } {
    const def = BUILDINGS[kind];
    if (!def) return { ok: false, reason: 'Unknown building' };
    const s = def.size;
    for (let y = ty; y < ty + s; y++) {
      for (let x = tx; x < tx + s; x++) {
        if (!this.inBounds(x, y) || x < 1 || y < 1 || x >= this.w - 1 || y >= this.h - 1) return { ok: false, reason: 'Out of bounds' };
        const i = y * this.w + x;
        if (this.grid.walk[i] === WALK_BLOCKED) return { ok: false, reason: 'Blocked terrain' };
        if (this.occ[i]) return { ok: false, reason: 'Space occupied' };
        if (team === HUMAN && this.creep[i] > 0.3) return { ok: false, reason: 'Cannot build on the AXIOM Grid' };
        if (team === HUMAN && !this.explored[i]) return { ok: false, reason: 'Unexplored area' };
      }
    }
    // resources block placement
    for (const e of this.entities) {
      if ((e.cat === 'resource' || (e.isUnit && e.team !== HUMAN)) && e.alive) {
        if (e.x > tx - 0.3 && e.x < tx + s + 0.3 && e.y > ty - 0.3 && e.y < ty + s + 0.3) {
          return { ok: false, reason: e.cat === 'resource' ? 'Scrap in the way' : 'Enemies in the way' };
        }
      }
    }
    return { ok: true };
  }

  countBuildings(team: Team, kind: string, builtOnly = true): number {
    let n = 0;
    for (const e of this.entities) if (e.alive && e.team === team && e.kind === kind && (!builtOnly || e.built)) n++;
    return n;
  }

  hasRequirement(req: string): boolean {
    if (req in BUILDINGS) return this.countBuildings(HUMAN, req) > 0;
    return this.human.research.has(req);
  }

  requirementsMet(reqs: string[] | undefined): boolean {
    if (!reqs) return true;
    for (const r of reqs) if (!this.hasRequirement(r)) return false;
    return true;
  }

  isVisible(x: number, y: number): boolean {
    if (this.revealAll) return true;
    const tx = x | 0, ty = y | 0;
    if (!this.inBounds(tx, ty)) return false;
    return this.vis[ty * this.w + tx] > 0;
  }

  creepAt(x: number, y: number): number {
    const tx = x | 0, ty = y | 0;
    if (!this.inBounds(tx, ty)) return 0;
    return this.creep[ty * this.w + tx];
  }

  alert(msg: string, x: number, y: number, level: 'info' | 'warn' | 'danger' = 'info'): void {
    this.emit({ t: 'alert', msg, x, y, level });
  }

  radio(speaker: string, text: string): void {
    this.emit({ t: 'radio', speaker, text });
  }
}
