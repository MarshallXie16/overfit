/**
 * Map passability contract (see docs/ARCHITECTURE.md, "Map passability contract").
 *
 * Walk codes live in a row-major Uint8Array: idx = ty * w + tx.
 * World coordinates are float tiles; tile (tx,ty) spans [tx,tx+1)x[ty,ty+1), centre tx+0.5.
 */

/** Terrain: water, ruins, map edge. Never walkable. */
export const WALK_BLOCKED = 0;
/** Normal ground. */
export const WALK_OPEN = 1;
/** Rubble: walkable, path cost SLOW_COST, speed x0.7. */
export const WALK_SLOW = 2;
/** Occupied by a building: blocked for A*; traversable at SIEGE_COST in 'siege' flow fields. */
export const WALK_STRUCTURE = 3;

/** Path-cost multiplier for entering a WALK_SLOW tile. */
export const SLOW_COST = 1.6;

export interface PathGrid {
  w: number;
  h: number;
  walk: Uint8Array;
  /** Bump whenever `walk` changes (lets callers cache paths / flow fields). */
  version: number;
}

export interface PathPoint {
  x: number;
  y: number;
}

/** Convenience constructor (tests, map generation). */
export function createPathGrid(w: number, h: number, fill: number = WALK_OPEN): PathGrid {
  const walk = new Uint8Array(w * h);
  if (fill !== 0) walk.fill(fill);
  return { w, h, walk, version: 0 };
}

/** Tile index for integer tile coords (no bounds check). */
export function idx(grid: { w: number }, tx: number, ty: number): number {
  return ty * grid.w + tx;
}

/** True if integer tile coords are inside the grid. */
export function inBounds(grid: { w: number; h: number }, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h;
}

/** True for codes a ground unit may stand on / path through (OPEN or SLOW). */
export function isWalkCode(code: number): boolean {
  return code === WALK_OPEN || code === WALK_SLOW;
}

/** True if the integer tile is in bounds and WALK_OPEN / WALK_SLOW. */
export function isWalkable(grid: PathGrid, tx: number, ty: number): boolean {
  return inBounds(grid, tx, ty) && isWalkCode(grid.walk[ty * grid.w + tx]);
}

/** Tile index containing float world point (x,y), or -1 if outside the grid. */
export function tileIndexAt(grid: { w: number; h: number }, x: number, y: number): number {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!(tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h)) return -1;
  return ty * grid.w + tx;
}

/**
 * Binary min-heap of (node:int32, key:float64) pairs. Lazy-deletion friendly
 * (duplicates allowed; callers skip stale entries). Grows on demand, never shrinks,
 * so steady-state use is allocation-free. Internal helper for A* / flow fields.
 */
export class NodeHeap {
  nodes: Int32Array;
  keys: Float64Array;
  size = 0;
  /** Key of the node returned by the most recent pop(). */
  popKey = 0;

  constructor(capacity = 256) {
    const cap = Math.max(16, capacity | 0);
    this.nodes = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }

  clear(): void {
    this.size = 0;
  }

  push(node: number, key: number): void {
    if (this.size === this.nodes.length) this.grow();
    const nodes = this.nodes;
    const keys = this.keys;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = keys[p];
      if (pk <= key) break;
      nodes[i] = nodes[p];
      keys[i] = pk;
      i = p;
    }
    nodes[i] = node;
    keys[i] = key;
  }

  /** Removes and returns the min node (caller must check size > 0). Key -> popKey. */
  pop(): number {
    const nodes = this.nodes;
    const keys = this.keys;
    const top = nodes[0];
    this.popKey = keys[0];
    const n = --this.size;
    if (n > 0) {
      const lastNode = nodes[n];
      const lastKey = keys[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        let ck = keys[c];
        const r = c + 1;
        if (r < n) {
          const rk = keys[r];
          if (rk < ck) {
            c = r;
            ck = rk;
          }
        }
        if (ck >= lastKey) break;
        nodes[i] = nodes[c];
        keys[i] = ck;
        i = c;
      }
      nodes[i] = lastNode;
      keys[i] = lastKey;
    }
    return top;
  }

  private grow(): void {
    const cap = this.nodes.length * 2;
    const nodes = new Int32Array(cap);
    const keys = new Float64Array(cap);
    nodes.set(this.nodes);
    keys.set(this.keys);
    this.nodes = nodes;
    this.keys = keys;
  }
}
