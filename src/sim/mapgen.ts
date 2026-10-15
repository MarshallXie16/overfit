import { BUILDINGS } from './data/defs';
import { WALK_BLOCKED } from './path';
import { initAxiom } from './ai/axiom';
import { updateCreep, updateVision } from './systems/field';
import { rebuildCache, TickCache } from './systems/query';
import { setOrder } from './systems/units';
import {
  AXIOM, HUMAN, NEUTRAL, T_GROUND, T_PARK, T_ROAD, T_RUBBLE, T_RUIN, T_WATER,
  type Pt, type Team,
} from './types';
import { DIFF, Rng, World, type GameSettings } from './world';

/** Campaign: a structure placed at an explicit spot relative to the player→AXIOM axis. */
export interface StructurePlacement {
  kind: string;
  /** default AXIOM (server_farm: NEUTRAL) */
  team?: Team;
  /** 0 = player start … 1 = AXIOM start */
  along: number;
  /** lateral offset in tiles, perpendicular to the axis */
  off?: number;
  /** default true */
  built?: boolean;
}

export interface MapGenOptions {
  river?: boolean;
  farms?: number;
  fabricators?: number;
  relays?: number;
  vaults?: number;
  lancets?: number;
  scrapFields?: number;
  core?: boolean;
  startUnits?: Record<string, number>;
  startBuildings?: string[];
  startScrap?: number;
  startData?: number;
  /** 0..1 how far AXIOM's forward structures reach toward the player */
  axiomReach?: number;
  density?: number;
  /** force the player's start corner (0 SW, 1 SE, 2 NE, 3 NW); AXIOM takes the opposite one */
  playerCorner?: number;
  /** extra structures at explicit positions (campaign scripting) */
  structures?: StructurePlacement[];
}

export function generateWorld(settings: GameSettings, opts: MapGenOptions = {}): World {
  const N = settings.mapSize;
  const w = new World(N, N, settings);
  const rng = new Rng((settings.seed * 2654435761) >>> 0);
  const T = w.terrain;
  const idx = (x: number, y: number) => y * N + x;
  const set = (x: number, y: number, t: number) => { if (x >= 0 && y >= 0 && x < N && y < N) T[idx(x, y)] = t; };
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < N && y < N ? T[idx(x, y)] : T_RUIN);

  // ---------------------------------------------------------------- roads
  const vRoads: { x: number; wd: number }[] = [];
  const hRoads: { y: number; wd: number }[] = [];
  for (let x = rng.int(5, 9); x < N - 4; x += rng.int(13, 18)) vRoads.push({ x, wd: rng.chance(0.35) ? 3 : 2 });
  for (let y = rng.int(5, 9); y < N - 4; y += rng.int(13, 18)) hRoads.push({ y, wd: rng.chance(0.35) ? 3 : 2 });
  for (const r of vRoads) for (let y = 0; y < N; y++) for (let k = 0; k < r.wd; k++) set(r.x + k, y, T_ROAD);
  for (const r of hRoads) for (let x = 0; x < N; x++) for (let k = 0; k < r.wd; k++) set(x, r.y + k, T_ROAD);

  // ---------------------------------------------------------------- blocks
  const xs = [0, ...vRoads.map((r) => r.x), N];
  const ys = [0, ...hRoads.map((r) => r.y), N];
  const density = opts.density ?? 0.62;
  for (let bi = 0; bi < xs.length - 1; bi++) {
    for (let bj = 0; bj < ys.length - 1; bj++) {
      const x0 = bi === 0 ? 0 : xs[bi] + (vRoads[bi - 1]?.wd ?? 2);
      const x1 = xs[bi + 1] - 1;
      const y0 = bj === 0 ? 0 : ys[bj] + (hRoads[bj - 1]?.wd ?? 2);
      const y1 = ys[bj + 1] - 1;
      if (x1 - x0 < 3 || y1 - y0 < 3) continue;
      const roll = rng.next();
      if (roll < density) fillRuins(x0 + 1, y0 + 1, x1 - 1, y1 - 1);
      else if (roll < density + 0.15) fillRect(x0, y0, x1, y1, T_PARK, 0.0);
      else scatter(x0, y0, x1, y1, T_RUBBLE, 0.12);
    }
  }

  function fillRect(x0: number, y0: number, x1: number, y1: number, t: number, holes: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!rng.chance(holes)) set(x, y, t);
  }
  function scatter(x0: number, y0: number, x1: number, y1: number, t: number, p: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (rng.chance(p)) set(x, y, t);
  }
  function fillRuins(x0: number, y0: number, x1: number, y1: number): void {
    // recursive split into buildings separated by alleys
    const split = (ax: number, ay: number, bx: number, by: number, depth: number) => {
      const wdt = bx - ax + 1, hgt = by - ay + 1;
      if (wdt < 3 || hgt < 3) return;
      if (depth > 0 && (wdt <= 7 && hgt <= 7 || rng.chance(0.15))) {
        // building
        for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) set(x, y, T_RUIN);
        // collapse: rubble bites from edges
        if (rng.chance(0.45)) {
          const bites = rng.int(1, 3);
          for (let b = 0; b < bites; b++) {
            const cx = rng.int(ax, bx), cy = rng.int(ay, by), r = rng.range(1.2, 2.6);
            for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (Math.hypot(x - cx, y - cy) < r) set(x, y, T_RUBBLE);
          }
        }
        return;
      }
      if (wdt > hgt) {
        const m = rng.int(ax + 2, bx - 2);
        split(ax, ay, m - 1, by, depth + 1);
        split(m + 1, ay, bx, by, depth + 1);
        if (rng.chance(0.5)) for (let y = ay; y <= by; y++) if (rng.chance(0.3)) set(m, y, T_RUBBLE);
      } else {
        const m = rng.int(ay + 2, by - 2);
        split(ax, ay, bx, m - 1, depth + 1);
        split(ax, m + 1, bx, by, depth + 1);
        if (rng.chance(0.5)) for (let x = ax; x <= bx; x++) if (rng.chance(0.3)) set(x, m, T_RUBBLE);
      }
    };
    split(x0, y0, x1, y1, 0);
  }

  // broken roads → rubble patches
  for (let k = 0; k < N / 4; k++) {
    const x = rng.int(0, N - 1), y = rng.int(0, N - 1);
    if (get(x, y) === T_ROAD) { const r = rng.range(1, 2.2); for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (get(xx, yy) === T_ROAD && Math.hypot(xx - x, yy - y) < r) set(xx, yy, T_RUBBLE); }
  }

  // ---------------------------------------------------------------- river
  if (opts.river ?? rng.chance(0.6)) {
    const vertical = rng.chance(0.5);
    const phase = rng.range(0, Math.PI * 2), amp = rng.range(4, 9), freq = rng.range(0.04, 0.08);
    const base = N * rng.range(0.42, 0.58);
    for (let s = 0; s < N; s++) {
      const c = base + Math.sin(s * freq + phase) * amp;
      const wd = 2.2 + Math.sin(s * 0.13 + phase) * 0.8;
      for (let o = Math.floor(c - wd); o <= Math.ceil(c + wd); o++) {
        const x = vertical ? o : s, y = vertical ? s : o;
        if (get(x, y) !== T_ROAD) set(x, y, T_WATER);
      }
      // muddy banks
      for (const o of [Math.floor(c - wd) - 1, Math.ceil(c + wd) + 1]) {
        const x = vertical ? o : s, y = vertical ? s : o;
        if (get(x, y) === T_RUIN && rng.chance(0.7)) set(x, y, T_RUBBLE);
      }
    }
  }

  // ---------------------------------------------------------------- key positions
  const rolledCorner = rng.int(0, 3);
  const corner = opts.playerCorner !== undefined ? ((opts.playerCorner % 4) + 4) % 4 : rolledCorner;
  const m = 13;
  const corners: Pt[] = [{ x: m, y: N - m }, { x: N - m, y: N - m }, { x: N - m, y: m }, { x: m, y: m }];
  const ps = corners[corner];
  const as = corners[(corner + 2) % 4];
  ps.x += rng.int(-2, 2); ps.y += rng.int(-2, 2);
  as.x += rng.int(-2, 2); as.y += rng.int(-2, 2);
  w.playerStart = { x: ps.x, y: ps.y };
  w.axiomStart = { x: as.x, y: as.y };

  const clearCircle = (cx: number, cy: number, r: number) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const t = get(x, y);
      if (t === T_RUIN || t === T_WATER) set(x, y, d > r - 1.5 && rng.chance(0.5) ? T_RUBBLE : T_GROUND);
      else if (t === T_RUBBLE && d < r - 2) set(x, y, T_GROUND);
    }
  };
  clearCircle(ps.x, ps.y, 10);
  clearCircle(as.x, as.y, 9);

  // structure sites along the player→axiom axis
  const lerp = (a: Pt, b: Pt, t: number, off: number): Pt => {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    return { x: a.x + dx * t + (-dy / L) * off, y: a.y + dy * t + (dx / L) * off };
  };
  const reach = opts.axiomReach ?? 0.42;
  const fabSites: Pt[] = [];
  const nFab = opts.fabricators ?? 2;
  for (let i = 0; i < nFab; i++) fabSites.push(lerp(as, ps, reach * rng.range(0.55, 0.85), (i - (nFab - 1) / 2) * N * 0.28 + rng.range(-4, 4)));
  const relaySites: Pt[] = [];
  const nRelay = opts.relays ?? 3;
  for (let i = 0; i < nRelay; i++) relaySites.push(lerp(as, ps, reach * rng.range(0.6, 1.05), rng.range(-0.35, 0.35) * N));
  const vaultSites: Pt[] = [];
  const nVault = opts.vaults ?? 1;
  for (let i = 0; i < nVault; i++) vaultSites.push(lerp(as, ps, rng.range(0.1, 0.3), (i % 2 ? 1 : -1) * N * rng.range(0.12, 0.22)));
  const farmSites: Pt[] = [];
  const nFarm = opts.farms ?? 3;
  for (let i = 0; i < nFarm; i++) farmSites.push(lerp(ps, as, 0.5 + rng.range(-0.06, 0.06), (i - (nFarm - 1) / 2) * N * 0.3));
  for (const p of [...fabSites, ...relaySites, ...vaultSites, ...farmSites]) {
    p.x = Math.max(6, Math.min(N - 7, p.x));
    p.y = Math.max(6, Math.min(N - 7, p.y));
    clearCircle(p.x, p.y, 4.5);
  }
  const extraSites: Pt[] = [];
  for (const s of opts.structures ?? []) {
    const p = lerp(ps, as, s.along, s.off ?? 0);
    p.x = Math.max(6, Math.min(N - 7, p.x));
    p.y = Math.max(6, Math.min(N - 7, p.y));
    clearCircle(p.x, p.y, Math.max(4.5, BUILDINGS[s.kind].size / 2 + 2.5));
    extraSites.push(p);
  }

  // ---------------------------------------------------------------- scrap field sites
  const scrapSites: Pt[] = [];
  const toA = { x: as.x - ps.x, y: as.y - ps.y };
  const L = Math.hypot(toA.x, toA.y);
  const ux = toA.x / L, uy = toA.y / L;
  // two near the base, flanking
  scrapSites.push({ x: ps.x + ux * 9 - uy * 7, y: ps.y + uy * 9 + ux * 7 });
  scrapSites.push({ x: ps.x + ux * 9 + uy * 7, y: ps.y + uy * 9 - ux * 7 });
  // skirmish/endless: two "natural expansion" fields ~22 tiles out on the player's side, so a
  // random layout can't leave the player with nothing between the base and AXIOM's half
  if (opts.scrapFields === undefined) {
    scrapSites.push({ x: ps.x + ux * 12 - uy * 19, y: ps.y + uy * 12 + ux * 19 });
    scrapSites.push({ x: ps.x + ux * 12 + uy * 19, y: ps.y + uy * 12 - ux * 19 });
  }
  const nScrap = opts.scrapFields ?? Math.round(N / 11);
  for (let k = 0; k < nScrap * 4 && scrapSites.length < nScrap; k++) {
    const p = { x: rng.range(8, N - 8), y: rng.range(8, N - 8) };
    if (Math.hypot(p.x - as.x, p.y - as.y) < 16) continue;
    if (scrapSites.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 13)) continue;
    scrapSites.push(p);
  }
  for (const p of scrapSites) {
    p.x = Math.max(4, Math.min(N - 5, p.x));
    p.y = Math.max(4, Math.min(N - 5, p.y));
    clearCircle(p.x, p.y, 3.2);
  }

  // ---------------------------------------------------------------- borders & connectivity
  w.rebuildWalk();
  const ensure = (p: Pt) => carveTo(w, rng, Math.floor(p.x), Math.floor(p.y), Math.floor(ps.x), Math.floor(ps.y));
  for (const p of [as, ...fabSites, ...relaySites, ...vaultSites, ...farmSites, ...scrapSites, ...extraSites]) ensure(p);
  w.rebuildWalk();

  // ---------------------------------------------------------------- human start
  const D = DIFF[settings.difficulty];
  const hq = w.spawnBuilding('hq', HUMAN, Math.floor(ps.x) - 2, Math.floor(ps.y) - 2, true);
  w.human.scrap = opts.startScrap ?? D.startScrap;
  w.human.data = opts.startData ?? 0;
  const startUnits = opts.startUnits ?? { engineer: 4, rifleman: 3 };
  let k = 0;
  for (const [kind, n] of Object.entries(startUnits)) {
    for (let i = 0; i < n; i++, k++) {
      const a = (k / 8) * Math.PI * 2 + 0.3;
      const u = w.spawnUnit(kind, HUMAN, hq.x + Math.cos(a) * 3.6, hq.y + Math.sin(a) * 3.6);
      u.ax = u.x; u.ay = u.y;
    }
  }
  let bk = 0;
  for (const kind of opts.startBuildings ?? []) {
    const s = BUILDINGS[kind].size;
    for (let tries = 0; tries < 60; tries++) {
      const a = bk * 1.7 + tries * 0.45, r = 5 + s + (tries % 6);
      const tx = Math.round(hq.x + Math.cos(a) * r - s / 2), ty = Math.round(hq.y + Math.sin(a) * r - s / 2);
      if (areaOk(w, tx - 1, ty - 1, s + 2)) { w.spawnBuilding(kind, HUMAN, tx, ty, true); bk++; break; }
    }
  }

  // ---------------------------------------------------------------- scrap
  for (let i = 0; i < scrapSites.length; i++) {
    const p = scrapSites[i];
    const nodes = rng.int(5, 8);
    const near = i < 2;
    for (let j = 0, tries = 0; j < nodes && tries < 60; tries++) {
      const a = rng.next() * Math.PI * 2, r = rng.range(0, 2.6);
      const x = Math.floor(p.x + Math.cos(a) * r), y = Math.floor(p.y + Math.sin(a) * r);
      if (!w.isWalkableTile(x, y)) continue;
      if (w.entities.some((e) => e.cat === 'resource' && (e.x | 0) === x && (e.y | 0) === y)) continue;
      w.spawnResource('scrap', x + 0.5, y + 0.5, near ? rng.int(500, 700) : rng.int(400, 650), rng.int(0, 3));
      j++;
    }
  }

  // ---------------------------------------------------------------- AXIOM
  const placeAt = (kind: string, team: Team, p: Pt, built = true): void => {
    const s = BUILDINGS[kind].size;
    for (let tries = 0; tries < 80; tries++) {
      const a = tries * 2.4, r = tries * 0.18;
      const tx = Math.round(p.x + Math.cos(a) * r - s / 2), ty = Math.round(p.y + Math.sin(a) * r - s / 2);
      if (areaOk(w, tx - 1, ty - 1, s + 2)) { w.spawnBuilding(kind, team, tx, ty, built); return; }
    }
  };
  if (opts.core ?? true) placeAt('core', AXIOM, as);
  for (const p of fabSites) placeAt('fabricator', AXIOM, p);
  for (const p of relaySites) placeAt('relay', AXIOM, p);
  for (const p of vaultSites) placeAt('vault', AXIOM, p);
  const nLancet = opts.lancets ?? 2;
  const lancetHosts = [...fabSites, as];
  for (let i = 0; i < nLancet; i++) {
    const h = lancetHosts[i % lancetHosts.length];
    const toP = { x: ps.x - h.x, y: ps.y - h.y }, d = Math.hypot(toP.x, toP.y) || 1;
    placeAt('lancet', AXIOM, { x: h.x + (toP.x / d) * 5 + rng.range(-2, 2), y: h.y + (toP.y / d) * 5 + rng.range(-2, 2) });
  }
  for (const p of farmSites) placeAt('server_farm', NEUTRAL, p);
  (opts.structures ?? []).forEach((s, i) => placeAt(s.kind, s.team ?? (s.kind === 'server_farm' ? NEUTRAL : AXIOM), extraSites[i], s.built ?? true));

  // pre-grow the Grid
  const c = new TickCache();
  rebuildCache(w, c);
  for (let i = 0; i < 40; i++) { w.tick = i * 10; updateCreep(w, c); }
  w.tick = 0;

  initAxiom(w);
  // starting garrisons
  for (const b of w.entities) {
    if (b.team !== AXIOM || (b.kind !== 'fabricator' && b.kind !== 'core')) continue;
    const n = b.kind === 'core' ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const kind = i % 3 === 2 ? 'gunner' : 'skitter';
      const a = rng.next() * Math.PI * 2;
      const u = w.spawnUnit(kind, AXIOM, b.x + Math.cos(a) * (b.size / 2 + 1.5), b.y + Math.sin(a) * (b.size / 2 + 1.5));
      u.homeId = b.id;
      setOrder(u, { type: 'guard', x: b.x, y: b.y + b.size / 2 + 2 });
    }
  }
  updateVision(w);
  return w;
}

function areaOk(w: World, x: number, y: number, s: number): boolean {
  for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) {
    if (xx < 1 || yy < 1 || xx >= w.w - 1 || yy >= w.h - 1) return false;
    const i = yy * w.w + xx;
    if (w.grid.walk[i] === WALK_BLOCKED || w.occ[i]) return false;
  }
  for (const e of w.entities) if (e.cat === 'resource' && e.x >= x && e.x < x + s && e.y >= y && e.y < y + s) return false;
  return true;
}

/** Ensure (sx,sy) connects to (gx,gy) by carving rubble through blocked tiles. */
function carveTo(w: World, rng: Rng, sx: number, sy: number, gx: number, gy: number): void {
  const N = w.w;
  const reach = new Uint8Array(N * N);
  const q: number[] = [];
  const start = gy * N + gx;
  if (w.grid.walk[start] === WALK_BLOCKED) return;
  reach[start] = 1; q.push(start);
  while (q.length) {
    const i = q.pop()!;
    const x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (reach[j] || w.grid.walk[j] === WALK_BLOCKED) continue;
      reach[j] = 1; q.push(j);
    }
  }
  if (reach[sy * N + sx]) return;
  // walk toward goal with a wobbly line, converting blocked to rubble, until reaching a reachable tile
  let x = sx, y = sy;
  for (let steps = 0; steps < N * 3; steps++) {
    for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) {
      const xx = Math.min(N - 1, x + ox), yy = Math.min(N - 1, y + oy);
      const j = yy * N + xx;
      if (w.terrain[j] === T_RUIN || w.terrain[j] === T_WATER) { w.terrain[j] = T_RUBBLE; w.refreshWalk(j); }
    }
    if (reach[y * N + x]) break;
    const dx = gx - x, dy = gy - y;
    if (Math.abs(dx) > Math.abs(dy) ? rng.chance(0.8) : rng.chance(0.2)) x += Math.sign(dx); else y += Math.sign(dy);
  }
  void T_ROAD;
}
