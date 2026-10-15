/**
 * Multi-goal flow field: Dijkstra integration (binary heap, 8 neighbours, no corner cutting)
 * followed by a per-tile direction pass. Buffers are allocated once per field.
 */
import { NodeHeap, WALK_BLOCKED, SLOW_COST, type PathGrid } from './grid';

/** Traversal cost of a WALK_STRUCTURE tile in 'siege' mode (vs 1 for open ground). */
export const SIEGE_COST = 10;

export type FlowMode = 'normal' | 'siege';

export interface FlowSample {
  dx: number;
  dy: number;
  dist: number;
}

const SQRT2 = Math.SQRT2;
const INV_SQRT2 = 1 / SQRT2;
const COS45 = INV_SQRT2 - 1e-9;

/** Cost of traversing (leaving) a tile, per walk code; 0 = impassable. */
const NORMAL_COST = new Float64Array(256);
NORMAL_COST[1] = 1;
NORMAL_COST[2] = SLOW_COST;
const SIEGE_COSTS = new Float64Array(256);
SIEGE_COSTS[1] = 1;
SIEGE_COSTS[2] = SLOW_COST;
SIEGE_COSTS[3] = SIEGE_COST;

/** Tiles that let a diagonal move squeeze past their corner: OPEN / SLOW only (never structures). */
const CORNER_OK = new Uint8Array(256);
CORNER_OK[1] = 1;
CORNER_OK[2] = 1;

// Directions in angular order (y grows down): E, SE, S, SW, W, NW, N, NE. Odd = diagonal.
const DIR_X = [1, 1, 0, -1, -1, -1, 0, 1];
const DIR_Y = [0, 1, 1, 1, 0, -1, -1, -1];
const UNIT_X = [1, INV_SQRT2, 0, -INV_SQRT2, -1, -INV_SQRT2, 0, INV_SQRT2];
const UNIT_Y = [0, INV_SQRT2, 1, INV_SQRT2, 0, -INV_SQRT2, -1, -INV_SQRT2];
/** Scan order for picking the best neighbour: orthogonals first so ties prefer straight moves. */
const SCAN = [0, 2, 4, 6, 1, 3, 5, 7];

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => 0;

export class FlowField {
  readonly w: number;
  readonly h: number;
  /** Integrated cost to the nearest goal; Infinity if unreachable. */
  dist: Float32Array;
  /** Unit direction to move (0,0 at goals / unreachable tiles). */
  dirX: Float32Array;
  dirY: Float32Array;
  /** Index of the lowest-dist neighbour tile; -1 at goals / unreachable tiles. */
  next: Int32Array;
  /** Duration of the last build() in ms (0 if performance.now is unavailable). */
  buildMs = 0;
  /** Mode of the last build(). */
  mode: FlowMode = 'normal';
  /** grid.version at the last build() (-1 before the first build). */
  gridVersion = -1;

  private readonly heap: NodeHeap;
  private readonly nb = new Float64Array(8);
  private readonly out: FlowSample = { dx: 0, dy: 0, dist: Infinity };

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.dist = new Float32Array(n).fill(Infinity);
    this.dirX = new Float32Array(n);
    this.dirY = new Float32Array(n);
    this.next = new Int32Array(n).fill(-1);
    this.heap = new NodeHeap(Math.max(1024, n));
  }

  /**
   * Dijkstra from all goal tile indices. 'normal': OPEN 1, SLOW 1.6, STRUCTURE/BLOCKED impassable.
   * 'siege': STRUCTURE tiles traversable at SIEGE_COST. Diagonals x sqrt2 and never cut a corner
   * of a BLOCKED or STRUCTURE tile. Goals may be OPEN/SLOW/STRUCTURE tiles (dist 0); BLOCKED goals
   * and out-of-range indices are ignored.
   */
  build(grid: PathGrid, goals: ArrayLike<number>, mode: FlowMode = 'normal'): void {
    const t0 = now();
    const w = this.w, h = this.h;
    if (grid.w !== w || grid.h !== h) {
      throw new Error(`FlowField ${w}x${h} cannot build from grid ${grid.w}x${grid.h}`);
    }
    const walk = grid.walk;
    const n = w * h;
    const dist = this.dist, dirX = this.dirX, dirY = this.dirY, next = this.next;
    dist.fill(Infinity);
    dirX.fill(0);
    dirY.fill(0);
    next.fill(-1);
    const cost = mode === 'siege' ? SIEGE_COSTS : NORMAL_COST;
    const heap = this.heap;
    heap.clear();

    for (let k = 0; k < goals.length; k++) {
      const gi = goals[k];
      if (!(gi >= 0 && gi < n) || (gi | 0) !== gi) continue;
      if (walk[gi] === WALK_BLOCKED || dist[gi] === 0) continue;
      dist[gi] = 0;
      heap.push(gi, 0);
    }

    // --- integration. Moving from tile `t` onto `cur` costs cost[walk[t]] (x sqrt2 diagonally).
    while (heap.size > 0) {
      const cur = heap.pop();
      const d = heap.popKey;
      if (d > dist[cur]) continue;
      const cy = (cur / w) | 0;
      const cx = cur - cy * w;
      const hasE = cx < w - 1, hasW = cx > 0, hasS = cy < h - 1, hasN = cy > 0;
      let t: number;
      let c: number;
      let nd: number;
      if (hasE) {
        t = cur + 1; c = cost[walk[t]];
        if (c > 0) { nd = d + c; if (nd < dist[t]) { dist[t] = nd; heap.push(t, dist[t]); } }
      }
      if (hasW) {
        t = cur - 1; c = cost[walk[t]];
        if (c > 0) { nd = d + c; if (nd < dist[t]) { dist[t] = nd; heap.push(t, dist[t]); } }
      }
      if (hasS) {
        t = cur + w; c = cost[walk[t]];
        if (c > 0) { nd = d + c; if (nd < dist[t]) { dist[t] = nd; heap.push(t, dist[t]); } }
      }
      if (hasN) {
        t = cur - w; c = cost[walk[t]];
        if (c > 0) { nd = d + c; if (nd < dist[t]) { dist[t] = nd; heap.push(t, dist[t]); } }
      }
      const okE = hasE && CORNER_OK[walk[cur + 1]] === 1;
      const okW = hasW && CORNER_OK[walk[cur - 1]] === 1;
      const okS = hasS && CORNER_OK[walk[cur + w]] === 1;
      const okN = hasN && CORNER_OK[walk[cur - w]] === 1;
      if (okS) {
        if (okE) {
          t = cur + w + 1; c = cost[walk[t]];
          if (c > 0) { nd = d + c * SQRT2; if (nd < dist[t]) { dist[t] = nd; heap.push(t, dist[t]); } }
        }
        if (okW) {
          t = cur + w - 1; c = cost[walk[t]];
          if (c > 0) { nd = d + c * SQRT2; if (nd < dist[t]) { dist[t] = nd; heap.push(t, dist[t]); } }
        }
      }
      if (okN) {
        if (okE) {
          t = cur - w + 1; c = cost[walk[t]];
          if (c > 0) { nd = d + c * SQRT2; if (nd < dist[t]) { dist[t] = nd; heap.push(t, dist[t]); } }
        }
        if (okW) {
          t = cur - w - 1; c = cost[walk[t]];
          if (c > 0) { nd = d + c * SQRT2; if (nd < dist[t]) { dist[t] = nd; heap.push(t, dist[t]); } }
        }
      }
    }

    // --- directions
    const nb = this.nb;
    for (let i = 0; i < n; i++) {
      const di = dist[i];
      if (di === 0 || di === Infinity) continue;
      const cy = (i / w) | 0;
      const cx = i - cy * w;
      const hasE = cx < w - 1, hasW = cx > 0, hasS = cy < h - 1, hasN = cy > 0;
      const okE = hasE && CORNER_OK[walk[i + 1]] === 1;
      const okW = hasW && CORNER_OK[walk[i - 1]] === 1;
      const okS = hasS && CORNER_OK[walk[i + w]] === 1;
      const okN = hasN && CORNER_OK[walk[i - w]] === 1;
      nb[0] = hasE ? dist[i + 1] : Infinity;
      nb[1] = okE && okS ? dist[i + w + 1] : Infinity;
      nb[2] = hasS ? dist[i + w] : Infinity;
      nb[3] = okS && okW ? dist[i + w - 1] : Infinity;
      nb[4] = hasW ? dist[i - 1] : Infinity;
      nb[5] = okW && okN ? dist[i - w - 1] : Infinity;
      nb[6] = hasN ? dist[i - w] : Infinity;
      nb[7] = okN && okE ? dist[i - w + 1] : Infinity;
      let bk = -1;
      let bd = di;
      for (let s = 0; s < 8; s++) {
        const k = SCAN[s];
        if (nb[k] < bd) {
          bd = nb[k];
          bk = k;
        }
      }
      if (bk < 0) continue; // cannot happen for a reachable non-goal tile
      next[i] = i + DIR_Y[bk] * w + DIR_X[bk];
      // Smooth direction = one-sided gradient from the steepest downhill orthogonal neighbour on
      // each axis (gives true angles in open ground instead of 8-way zig-zag). Accepted only if
      // it is safe: when it points into a quadrant, that quadrant's diagonal must be a valid move
      // (=> both orthogonals OPEN/SLOW and the diagonal reachable, so a ray of length <= 1 only
      // crosses non-blocked tiles and cuts no corner), and it must stay within 45 deg of `next`.
      // Otherwise fall back to the unit vector toward `next`.
      const dropE = di - nb[0], dropW = di - nb[4], dropS = di - nb[2], dropN = di - nb[6];
      const gx = dropE >= dropW ? (dropE > 0 ? dropE : 0) : dropW > 0 ? -dropW : 0;
      const gy = dropS >= dropN ? (dropS > 0 ? dropS : 0) : dropN > 0 ? -dropN : 0;
      let vx = UNIT_X[bk];
      let vy = UNIT_Y[bk];
      if (gx !== 0 || gy !== 0) {
        let ok = true;
        if (gx !== 0 && gy !== 0) {
          const k = gx > 0 ? (gy > 0 ? 1 : 7) : gy > 0 ? 3 : 5;
          ok = nb[k] < Infinity;
        }
        if (ok) {
          const gl = Math.sqrt(gx * gx + gy * gy);
          const ux = gx / gl, uy = gy / gl;
          if (ux * vx + uy * vy >= COS45) {
            vx = ux;
            vy = uy;
          }
        }
      }
      dirX[i] = vx;
      dirY[i] = vy;
    }

    this.mode = mode;
    this.gridVersion = grid.version;
    this.buildMs = now() - t0;
  }

  /**
   * Flow at float world point (x,y). Returns a shared object (overwritten by the next call).
   * Off-map -> (0,0,Infinity). On an unreachable tile (e.g. a unit shoved into a wall) it steers
   * toward the centre of the lowest-dist neighbour tile, if any.
   */
  sample(x: number, y: number): FlowSample {
    const o = this.out;
    const w = this.w, h = this.h;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!(tx >= 0 && ty >= 0 && tx < w && ty < h)) {
      o.dx = 0;
      o.dy = 0;
      o.dist = Infinity;
      return o;
    }
    const i = ty * w + tx;
    const d = this.dist[i];
    if (d !== Infinity) {
      o.dx = this.dirX[i];
      o.dy = this.dirY[i];
      o.dist = d;
      return o;
    }
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < 8; k++) {
      const nx = tx + DIR_X[k];
      const ny = ty + DIR_Y[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nd = this.dist[ny * w + nx];
      if (nd < bd) {
        bd = nd;
        best = k;
      }
    }
    if (best < 0) {
      o.dx = 0;
      o.dy = 0;
      o.dist = Infinity;
      return o;
    }
    const vx = tx + DIR_X[best] + 0.5 - x;
    const vy = ty + DIR_Y[best] + 0.5 - y;
    const len = Math.sqrt(vx * vx + vy * vy);
    o.dx = len > 0 ? vx / len : 0;
    o.dy = len > 0 ? vy / len : 0;
    o.dist = bd + len;
    return o;
  }
}
