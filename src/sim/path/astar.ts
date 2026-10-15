/**
 * Grid A* (8-dir, octile heuristic, no diagonal corner cutting) + supercover line checks
 * + string-pulling. Pure, deterministic, allocation-light: all w*h search buffers are
 * module-level typed arrays reused across calls via a generation counter.
 */
import { NodeHeap, WALK_SLOW, SLOW_COST, type PathGrid, type PathPoint } from './grid';

const SQRT2 = Math.SQRT2;
const OCT = SQRT2 - 2;
/** Slight heuristic weight: breaks f-ties toward the goal (bounded suboptimality 0.05%). */
const H_WEIGHT = 1.0005;
const EPS = 1e-9;

/** Default clearance radius (tiles) used when string-pulling paths. */
export const DEFAULT_CLEARANCE = 0.35;

/** Step cost multiplier per walk code for A*; 0 = impassable. */
const STEP_COST = new Float64Array(256);
STEP_COST[1] = 1; // WALK_OPEN
STEP_COST[2] = SLOW_COST; // WALK_SLOW

export interface FindPathOptions {
  /** Max node expansions (default w*h). On hitting it, a partial path is returned. */
  maxExpand?: number;
  /** Clearance radius in tiles for string-pulling line checks (default DEFAULT_CLEARANCE). */
  radius?: number;
  /** String-pull the tile path (default true). false = every tile centre. */
  smooth?: boolean;
}

/** Diagnostics for the most recent findPath() call (shared, overwritten each call). */
export interface PathInfo {
  /** Nodes expanded by the search. */
  expanded: number;
  /** True if the path ends at the (possibly retargeted) goal tile. */
  reached: boolean;
  /** True if the start tile was unwalkable and the search began at the nearest walkable tile. */
  startRelocated: boolean;
  /** True if the goal tile was unwalkable / off-map and was retargeted. */
  goalRetargeted: boolean;
  /** Tile index the returned path ends at (-1 if null). */
  endIdx: number;
}

export const lastPathInfo: PathInfo = {
  expanded: 0,
  reached: false,
  startRelocated: false,
  goalRetargeted: false,
  endIdx: -1,
};

// ---------------------------------------------------------------------------
// Reusable search buffers
// ---------------------------------------------------------------------------

let cap = 0;
let gCost = new Float64Array(0);
let parent = new Int32Array(0);
let stamp = new Uint32Array(0);
let pathBuf = new Int32Array(0);
let slowPre = new Int32Array(0);
let gen = 0;
const heap = new NodeHeap(1024);

function ensureCapacity(n: number): void {
  if (n <= cap) return;
  cap = n;
  gCost = new Float64Array(n);
  parent = new Int32Array(n);
  stamp = new Uint32Array(n);
  pathBuf = new Int32Array(n);
  slowPre = new Int32Array(n + 1);
  gen = 0;
}

function nextGen(): void {
  gen++;
  if (gen >= 0xffffffff) {
    stamp.fill(0);
    gen = 1;
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!(v >= lo)) return lo; // also catches NaN
  return v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Line checks
// ---------------------------------------------------------------------------

function cellOk(walk: Uint8Array, w: number, h: number, tx: number, ty: number, allowSlow: boolean): boolean {
  if (!(tx >= 0 && ty >= 0 && tx < w && ty < h)) return false;
  const c = walk[ty * w + tx];
  return c === 1 || (allowSlow && c === 2);
}

/**
 * Supercover traversal of the segment; false as soon as a touched tile is not allowed.
 * Passing exactly through a tile corner touches both side tiles (no corner cutting).
 */
function traceClear(
  walk: Uint8Array, w: number, h: number,
  x0: number, y0: number, x1: number, y1: number, allowSlow: boolean,
): boolean {
  let tx = Math.floor(x0);
  let ty = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  if (!cellOk(walk, w, h, tx, ty, allowSlow)) return false;
  if (!cellOk(walk, w, h, ex, ey, allowSlow)) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = sy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tmx = sx > 0 ? (tx + 1 - x0) * tdx : sx < 0 ? (x0 - tx) * tdx : Infinity;
  let tmy = sy > 0 ? (ty + 1 - y0) * tdy : sy < 0 ? (y0 - ty) * tdy : Infinity;
  let n = Math.abs(ex - tx) + Math.abs(ey - ty);
  while (n > 0) {
    if (tx === ex) {
      ty += sy;
      tmy += tdy;
      n--;
    } else if (ty === ey) {
      tx += sx;
      tmx += tdx;
      n--;
    } else if (tmx < tmy - EPS) {
      tx += sx;
      tmx += tdx;
      n--;
    } else if (tmy < tmx - EPS) {
      ty += sy;
      tmy += tdy;
      n--;
    } else {
      // Exactly through a corner: both side tiles are touched.
      if (!cellOk(walk, w, h, tx + sx, ty, allowSlow)) return false;
      if (!cellOk(walk, w, h, tx, ty + sy, allowSlow)) return false;
      tx += sx;
      ty += sy;
      tmx += tdx;
      tmy += tdy;
      n -= 2;
    }
    if (!cellOk(walk, w, h, tx, ty, allowSlow)) return false;
  }
  return true;
}

function boxClear(
  walk: Uint8Array, w: number, h: number,
  x0: number, y0: number, x1: number, y1: number, allowSlow: boolean,
): boolean {
  const tx0 = Math.floor(x0), ty0 = Math.floor(y0), tx1 = Math.floor(x1), ty1 = Math.floor(y1);
  if (!(tx0 <= tx1 && ty0 <= ty1)) return false;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!cellOk(walk, w, h, tx, ty, allowSlow)) return false;
    }
  }
  return true;
}

/**
 * Thick-line check: every tile touched by the rectangle swept by a segment of half-width
 * `radius` must be allowed. For radius < 0.5 any touched tile must cross the rectangle's
 * boundary, so the two long edges + two end caps suffice; wider radii add interior lines.
 */
function lineClear(
  walk: Uint8Array, w: number, h: number,
  x0: number, y0: number, x1: number, y1: number, radius: number, allowSlow: boolean,
): boolean {
  if (!(radius > 0)) return traceClear(walk, w, h, x0, y0, x1, y1, allowSlow);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return boxClear(walk, w, h, x0 - radius, y0 - radius, x0 + radius, y0 + radius, allowSlow);
  const k = radius / len;
  const nx = -dy * k;
  const ny = dx * k;
  if (!traceClear(walk, w, h, x0 + nx, y0 + ny, x1 + nx, y1 + ny, allowSlow)) return false;
  if (!traceClear(walk, w, h, x0 - nx, y0 - ny, x1 - nx, y1 - ny, allowSlow)) return false;
  if (!traceClear(walk, w, h, x0 - nx, y0 - ny, x0 + nx, y0 + ny, allowSlow)) return false;
  if (!traceClear(walk, w, h, x1 - nx, y1 - ny, x1 + nx, y1 + ny, allowSlow)) return false;
  const m = Math.ceil((2 * radius) / 0.9);
  for (let i = 1; i < m; i++) {
    const s = -1 + (2 * i) / m;
    if (!traceClear(walk, w, h, x0 + s * nx, y0 + s * ny, x1 + s * nx, y1 + s * ny, allowSlow)) return false;
  }
  return true;
}

/**
 * True if every tile touched by the segment (x0,y0)-(x1,y1) is WALK_OPEN or WALK_SLOW.
 * Supercover: passing exactly through a tile corner touches both side tiles.
 * radius > 0 checks the swept rectangle of that half-width (clearance). Off-map = blocked.
 */
export function lineWalkable(grid: PathGrid, x0: number, y0: number, x1: number, y1: number, radius = 0): boolean {
  return lineClear(grid.walk, grid.w, grid.h, x0, y0, x1, y1, radius, true);
}

// ---------------------------------------------------------------------------
// Nearest walkable
// ---------------------------------------------------------------------------

/**
 * Index of the walkable tile whose centre is nearest (Euclidean) to float point (x,y),
 * searching Chebyshev rings out to maxR around the (clamped) tile. -1 if none.
 * Deterministic tie-break: first in ring scan order (top row, bottom row, left col, right col).
 */
export function nearestWalkableIdx(grid: PathGrid, x: number, y: number, maxR?: number): number {
  const w = grid.w, h = grid.h, walk = grid.walk;
  if (w <= 0 || h <= 0) return -1;
  const cx = clampInt(Math.floor(x), 0, w - 1);
  const cy = clampInt(Math.floor(y), 0, h - 1);
  const c0 = cy * w + cx;
  if (STEP_COST[walk[c0]] > 0) return c0;
  const limit = maxR === undefined ? Math.max(w, h) : maxR;
  const reach = Math.max(cx, w - 1 - cx, cy, h - 1 - cy);
  const px = x === x ? x : cx + 0.5;
  const py = y === y ? y : cy + 0.5;
  let best = -1;
  let bestD = Infinity;
  for (let r = 1; r <= limit && r <= reach; r++) {
    const y0 = cy - r, y1 = cy + r, x0 = cx - r, x1 = cx + r;
    const xa = x0 < 0 ? 0 : x0;
    const xb = x1 > w - 1 ? w - 1 : x1;
    // top & bottom rows
    for (let pass = 0; pass < 2; pass++) {
      const ty = pass === 0 ? y0 : y1;
      if (ty < 0 || ty >= h) continue;
      const row = ty * w;
      const ddy = ty + 0.5 - py;
      for (let tx = xa; tx <= xb; tx++) {
        if (STEP_COST[walk[row + tx]] > 0) {
          const ddx = tx + 0.5 - px;
          const d = ddx * ddx + ddy * ddy;
          if (d < bestD) {
            bestD = d;
            best = row + tx;
          }
        }
      }
    }
    // left & right columns (excluding corners)
    const ya = y0 + 1 < 0 ? 0 : y0 + 1;
    const yb = y1 - 1 > h - 1 ? h - 1 : y1 - 1;
    for (let pass = 0; pass < 2; pass++) {
      const tx = pass === 0 ? x0 : x1;
      if (tx < 0 || tx >= w) continue;
      const ddx = tx + 0.5 - px;
      for (let ty = ya; ty <= yb; ty++) {
        const i = ty * w + tx;
        if (STEP_COST[walk[i]] > 0) {
          const ddy = ty + 0.5 - py;
          const d = ddx * ddx + ddy * ddy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    // Tiles on ring r+1 are at least r+0.5 away from any point in (or projected into) tile c.
    if (best >= 0 && (r + 0.5) * (r + 0.5) >= bestD) break;
  }
  return best;
}

/** Nearest walkable tile (by centre distance) to tile (tx,ty) within maxR rings, or null. */
export function nearestWalkable(grid: PathGrid, tx: number, ty: number, maxR?: number): { tx: number; ty: number } | null {
  const i = nearestWalkableIdx(grid, tx + 0.5, ty + 0.5, maxR);
  if (i < 0) return null;
  const y = (i / grid.w) | 0;
  return { tx: i - y * grid.w, ty: y };
}

// ---------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------

/**
 * 8-dir A* from float (sx,sy) to float (gx,gy).
 * - No diagonal corner cutting; WALK_SLOW costs SLOW_COST; STRUCTURE/BLOCKED impassable.
 * - Unwalkable start tile: search starts at the nearest walkable tile (its centre is the first waypoint).
 * - Unwalkable / off-map goal: retargets to the nearest walkable tile (its centre is the final point).
 * - Unreachable goal (or maxExpand hit): partial path to the expanded tile with the lowest heuristic.
 * - Output: string-pulled tile-centre waypoints, first waypoint is NOT the start, final point is the
 *   exact goal when the goal tile is walkable and reached.
 * Returns [] if already as close as possible, null only if no walkable start exists or the start
 * tile is fully enclosed (no walkable orthogonal neighbour) while the goal is elsewhere.
 */
export function findPath(
  grid: PathGrid, sx: number, sy: number, gx: number, gy: number, opts?: FindPathOptions,
): PathPoint[] | null {
  const w = grid.w, h = grid.h, walk = grid.walk;
  const n = w * h;
  const info = lastPathInfo;
  info.expanded = 0;
  info.reached = false;
  info.startRelocated = false;
  info.goalRetargeted = false;
  info.endIdx = -1;
  if (n <= 0) return null;
  ensureCapacity(n);
  const maxExpand = opts?.maxExpand ?? n;
  const radius = opts?.radius ?? DEFAULT_CLEARANCE;
  const smooth = opts?.smooth ?? true;

  // --- start tile
  const stx = clampInt(Math.floor(sx), 0, w - 1);
  const sty = clampInt(Math.floor(sy), 0, h - 1);
  let start = sty * w + stx;
  let relocated = false;
  if (STEP_COST[walk[start]] === 0) {
    start = nearestWalkableIdx(grid, sx, sy);
    if (start < 0) return null;
    relocated = true;
  }

  // --- goal tile
  const gtx0 = clampInt(Math.floor(gx), 0, w - 1);
  const gty0 = clampInt(Math.floor(gy), 0, h - 1);
  let target = gty0 * w + gtx0;
  const goalOnMap = gx >= 0 && gy >= 0 && gx < w && gy < h;
  const exactGoal = goalOnMap && STEP_COST[walk[target]] > 0;
  if (STEP_COST[walk[target]] === 0) {
    target = nearestWalkableIdx(grid, gx, gy);
    if (target < 0) target = start;
  }
  info.startRelocated = relocated;
  info.goalRetargeted = !exactGoal;

  if (start === target) {
    info.reached = true;
    info.endIdx = target;
    if (exactGoal) return [{ x: gx, y: gy }];
    if (relocated) return [centreOf(start, w)];
    return [];
  }

  // --- search
  nextGen();
  const ttx = target % w;
  const tty = (target / w) | 0;
  const g = gCost, par = parent, st = stamp, curGen = gen, hp = heap;
  hp.clear();

  const relax = (nb: number, nx: number, ny: number, ng: number, from: number): void => {
    if (st[nb] === curGen) {
      if (ng >= g[nb]) return;
    } else {
      st[nb] = curGen;
    }
    g[nb] = ng;
    par[nb] = from;
    const dx = nx > ttx ? nx - ttx : ttx - nx;
    const dy = ny > tty ? ny - tty : tty - ny;
    hp.push(nb, ng + (dx + dy + OCT * (dx < dy ? dx : dy)) * H_WEIGHT);
  };

  {
    const s0y = (start / w) | 0;
    const s0x = start - s0y * w;
    st[start] = curGen;
    g[start] = 0;
    par[start] = -1;
    const dx = Math.abs(s0x - ttx), dy = Math.abs(s0y - tty);
    hp.push(start, 0 + (dx + dy + OCT * (dx < dy ? dx : dy)) * H_WEIGHT);
  }

  let best = start;
  let bestH = Infinity;
  let bestG = Infinity;
  let expanded = 0;
  let found = false;

  while (hp.size > 0) {
    const cur = hp.pop();
    const key = hp.popKey;
    const cy = (cur / w) | 0;
    const cx = cur - cy * w;
    const dxg = cx > ttx ? cx - ttx : ttx - cx;
    const dyg = cy > tty ? cy - tty : tty - cy;
    const hc = dxg + dyg + OCT * (dxg < dyg ? dxg : dyg);
    const gc = g[cur];
    if (key > gc + hc * H_WEIGHT) continue; // stale duplicate
    if (cur === target) {
      found = true;
      best = cur;
      break;
    }
    if (hc < bestH || (hc === bestH && gc < bestG)) {
      best = cur;
      bestH = hc;
      bestG = gc;
    }
    if (++expanded > maxExpand) break;

    const cE = cx < w - 1 ? STEP_COST[walk[cur + 1]] : 0;
    const cW = cx > 0 ? STEP_COST[walk[cur - 1]] : 0;
    const cS = cy < h - 1 ? STEP_COST[walk[cur + w]] : 0;
    const cN = cy > 0 ? STEP_COST[walk[cur - w]] : 0;
    if (cE > 0) relax(cur + 1, cx + 1, cy, gc + cE, cur);
    if (cW > 0) relax(cur - 1, cx - 1, cy, gc + cW, cur);
    if (cS > 0) relax(cur + w, cx, cy + 1, gc + cS, cur);
    if (cN > 0) relax(cur - w, cx, cy - 1, gc + cN, cur);
    if (cS > 0) {
      if (cE > 0) {
        const c = STEP_COST[walk[cur + w + 1]];
        if (c > 0) relax(cur + w + 1, cx + 1, cy + 1, gc + c * SQRT2, cur);
      }
      if (cW > 0) {
        const c = STEP_COST[walk[cur + w - 1]];
        if (c > 0) relax(cur + w - 1, cx - 1, cy + 1, gc + c * SQRT2, cur);
      }
    }
    if (cN > 0) {
      if (cE > 0) {
        const c = STEP_COST[walk[cur - w + 1]];
        if (c > 0) relax(cur - w + 1, cx + 1, cy - 1, gc + c * SQRT2, cur);
      }
      if (cW > 0) {
        const c = STEP_COST[walk[cur - w - 1]];
        if (c > 0) relax(cur - w - 1, cx - 1, cy - 1, gc + c * SQRT2, cur);
      }
    }
  }
  info.expanded = expanded;
  info.reached = found;

  if (best === start) {
    info.endIdx = start;
    if (relocated) return [centreOf(start, w)];
    // Fully enclosed start tile (cannot step anywhere) -> null; otherwise already closest.
    const s0y = (start / w) | 0;
    const s0x = start - s0y * w;
    const open =
      (s0x < w - 1 && STEP_COST[walk[start + 1]] > 0) ||
      (s0x > 0 && STEP_COST[walk[start - 1]] > 0) ||
      (s0y < h - 1 && STEP_COST[walk[start + w]] > 0) ||
      (s0y > 0 && STEP_COST[walk[start - w]] > 0);
    return open ? [] : null;
  }
  info.endIdx = best;

  // --- reconstruct tile chain start..best into pathBuf
  let count = 0;
  for (let c = best; c !== -1; c = par[c]) pathBuf[count++] = c;
  for (let i = 0, j = count - 1; i < j; i++, j--) {
    const t = pathBuf[i];
    pathBuf[i] = pathBuf[j];
    pathBuf[j] = t;
  }
  return buildWaypoints(grid, count, sx, sy, gx, gy, found && exactGoal, relocated, smooth, radius);
}

function centreOf(i: number, w: number): PathPoint {
  const y = (i / w) | 0;
  return { x: i - y * w + 0.5, y: y + 0.5 };
}

/**
 * Greedy furthest-visible string pulling over pathBuf[0..count). Shortcuts may only enter
 * WALK_SLOW tiles if the tile-path section they replace already crossed slow ground (so
 * smoothing never undoes A*'s choice to route around rubble).
 */
function buildWaypoints(
  grid: PathGrid, count: number, sx: number, sy: number, gx: number, gy: number,
  exactEnd: boolean, relocated: boolean, smooth: boolean, radius: number,
): PathPoint[] {
  const w = grid.w, h = grid.h, walk = grid.walk;
  const last = count - 1;
  const out: PathPoint[] = [];
  const px = (k: number): number => {
    if (k === last && exactEnd) return gx;
    const t = pathBuf[k];
    return t - ((t / w) | 0) * w + 0.5;
  };
  const py = (k: number): number => {
    if (k === last && exactEnd) return gy;
    return ((pathBuf[k] / w) | 0) + 0.5;
  };

  if (!smooth) {
    if (relocated) out.push({ x: px(0), y: py(0) });
    for (let k = 1; k <= last; k++) out.push({ x: px(k), y: py(k) });
    return out;
  }

  slowPre[0] = 0;
  for (let k = 0; k < count; k++) slowPre[k + 1] = slowPre[k] + (walk[pathBuf[k]] === WALK_SLOW ? 1 : 0);

  let ax: number;
  let ay: number;
  if (relocated) {
    ax = px(0);
    ay = py(0);
    out.push({ x: ax, y: ay });
  } else {
    ax = sx;
    ay = sy;
  }
  let i = 0;
  while (i < last) {
    let j = i + 1; // adjacent tile: always reachable (A* guarantees no corner cut)
    if (i + 1 < last) {
      if (lineClear(walk, w, h, ax, ay, px(last), py(last), radius, slowPre[last + 1] - slowPre[i] > 0)) {
        j = last;
      } else {
        for (let k = i + 2; k < last; k++) {
          if (lineClear(walk, w, h, ax, ay, px(k), py(k), radius, slowPre[k + 1] - slowPre[i] > 0)) j = k;
          else break;
        }
      }
    }
    ax = px(j);
    ay = py(j);
    out.push({ x: ax, y: ay });
    i = j;
  }
  return out;
}
