import { describe, it, expect } from 'vitest';
import {
  WALK_BLOCKED,
  WALK_OPEN,
  WALK_SLOW,
  WALK_STRUCTURE,
  SLOW_COST,
  SIEGE_COST,
  createPathGrid,
  idx,
  inBounds,
  isWalkable,
  findPath,
  lineWalkable,
  nearestWalkable,
  lastPathInfo,
  FlowField,
  SpatialHash,
  type PathGrid,
  type PathPoint,
} from '../src/sim/path';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** '#' blocked, '.' open, '~' slow, 'B' structure. */
function ascii(rows: string[]): PathGrid {
  const h = rows.length;
  const w = rows[0].length;
  const g = createPathGrid(w, h, WALK_OPEN);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      g.walk[y * w + x] = ch === '#' ? WALK_BLOCKED : ch === '~' ? WALK_SLOW : ch === 'B' ? WALK_STRUCTURE : WALK_OPEN;
    }
  }
  return g;
}

function fillRect(g: PathGrid, x0: number, y0: number, x1: number, y1: number, code: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inBounds(g, x, y)) g.walk[idx(g, x, y)] = code;
}

/** Blob/rect obstacle map with roughly `coverage` blocked tiles and ~5% rubble. */
function blobMap(w: number, h: number, seed: number, coverage = 0.3): PathGrid {
  const rng = mulberry32(seed);
  const g = createPathGrid(w, h, WALK_OPEN);
  const target = Math.floor(w * h * coverage);
  let blocked = 0;
  const count = (): number => {
    let c = 0;
    for (let i = 0; i < g.walk.length; i++) if (g.walk[i] === WALK_BLOCKED) c++;
    return c;
  };
  while (blocked < target) {
    for (let k = 0; k < 20; k++) {
      const cx = Math.floor(rng() * w);
      const cy = Math.floor(rng() * h);
      if (rng() < 0.5) {
        const r = 1 + rng() * 4;
        for (let y = Math.floor(cy - r); y <= cy + r; y++) {
          for (let x = Math.floor(cx - r); x <= cx + r; x++) {
            if (inBounds(g, x, y) && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) g.walk[idx(g, x, y)] = WALK_BLOCKED;
          }
        }
      } else {
        const horiz = rng() < 0.5;
        const len = 3 + Math.floor(rng() * 10);
        const thick = 1 + Math.floor(rng() * 2);
        if (horiz) fillRect(g, cx, cy, cx + len, cy + thick - 1, WALK_BLOCKED);
        else fillRect(g, cx, cy, cx + thick - 1, cy + len, WALK_BLOCKED);
      }
    }
    blocked = count();
  }
  // rubble patches on open ground
  const slowTarget = Math.floor(w * h * 0.05);
  let slow = 0;
  while (slow < slowTarget) {
    const cx = Math.floor(rng() * w);
    const cy = Math.floor(rng() * h);
    const r = 1 + rng() * 2;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (inBounds(g, x, y) && g.walk[idx(g, x, y)] === WALK_OPEN && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
          g.walk[idx(g, x, y)] = WALK_SLOW;
          slow++;
        }
      }
    }
  }
  return g;
}

/** 4-connected component labels over walkable tiles (== 8-dir no-corner-cut connectivity). */
function components(g: PathGrid): Int32Array {
  const lab = new Int32Array(g.w * g.h).fill(-1);
  const q = new Int32Array(g.w * g.h);
  let next = 0;
  for (let s = 0; s < lab.length; s++) {
    if (lab[s] !== -1 || !isWalkable(g, s % g.w, (s / g.w) | 0)) continue;
    let qh = 0, qt = 0;
    q[qt++] = s;
    lab[s] = next;
    while (qh < qt) {
      const c = q[qh++];
      const x = c % g.w, y = (c / g.w) | 0;
      const nbs: [number, number][] = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of nbs) {
        if (!isWalkable(g, nx, ny)) continue;
        const ni = idx(g, nx, ny);
        if (lab[ni] === -1) {
          lab[ni] = next;
          q[qt++] = ni;
        }
      }
    }
    next++;
  }
  return lab;
}

function largestComponentTiles(g: PathGrid): number[] {
  const lab = components(g);
  const sizes = new Map<number, number>();
  for (const l of lab) if (l >= 0) sizes.set(l, (sizes.get(l) ?? 0) + 1);
  let bestL = -1, bestS = 0;
  for (const [l, s] of sizes) if (s > bestS) { bestS = s; bestL = l; }
  const out: number[] = [];
  for (let i = 0; i < lab.length; i++) if (lab[i] === bestL) out.push(i);
  return out;
}

/** True if no densely sampled interior point of the polyline lies on a tile with `code`. */
function segmentsAvoid(g: PathGrid, code: number, sx: number, sy: number, path: PathPoint[]): boolean {
  let ax = sx, ay = sy;
  for (const p of path) {
    const steps = Math.ceil(Math.hypot(p.x - ax, p.y - ay) * 40) + 1;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const tx = Math.floor(ax + (p.x - ax) * t), ty = Math.floor(ay + (p.y - ay) * t);
      if (g.walk[idx(g, tx, ty)] === code) return false;
    }
    ax = p.x;
    ay = p.y;
  }
  return true;
}

function segmentsOk(g: PathGrid, sx: number, sy: number, path: PathPoint[], radius = 0): boolean {
  let ax = sx, ay = sy;
  for (const p of path) {
    if (!lineWalkable(g, ax, ay, p.x, p.y, radius)) return false;
    ax = p.x;
    ay = p.y;
  }
  return true;
}

function pathLen(sx: number, sy: number, path: PathPoint[]): number {
  let L = 0, ax = sx, ay = sy;
  for (const p of path) {
    L += Math.hypot(p.x - ax, p.y - ay);
    ax = p.x;
    ay = p.y;
  }
  return L;
}

const last = <T>(a: T[]): T => a[a.length - 1];

// ---------------------------------------------------------------------------
// grid helpers
// ---------------------------------------------------------------------------

describe('grid helpers', () => {
  it('idx / inBounds / isWalkable', () => {
    const g = ascii(['.#', '~B']);
    expect(idx(g, 1, 1)).toBe(3);
    expect(inBounds(g, 1, 1)).toBe(true);
    expect(inBounds(g, 2, 0)).toBe(false);
    expect(inBounds(g, -1, 0)).toBe(false);
    expect(isWalkable(g, 0, 0)).toBe(true);
    expect(isWalkable(g, 1, 0)).toBe(false);
    expect(isWalkable(g, 0, 1)).toBe(true);
    expect(isWalkable(g, 1, 1)).toBe(false);
    expect(isWalkable(g, 5, 5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lineWalkable
// ---------------------------------------------------------------------------

describe('lineWalkable', () => {
  it('handles trivial and boundary cases', () => {
    const g = ascii([
      '.....',
      '..#..',
      '.....',
      '..B~.',
    ]);
    expect(lineWalkable(g, 0.5, 0.5, 0.5, 0.5)).toBe(true); // same point, open
    expect(lineWalkable(g, 2.5, 1.5, 2.5, 1.5)).toBe(false); // same point, blocked
    expect(lineWalkable(g, 0.5, 0.5, 4.5, 0.5)).toBe(true);
    expect(lineWalkable(g, 0.5, 1.5, 4.5, 1.5)).toBe(false); // through '#'
    expect(lineWalkable(g, 0.5, 3.5, 4.5, 3.5)).toBe(false); // through structure
    expect(lineWalkable(g, 3.5, 3.5, 4.5, 3.5)).toBe(true); // slow is walkable
    expect(lineWalkable(g, 0.5, 0.5, -1.5, 0.5)).toBe(false); // off map
    expect(lineWalkable(g, 0.5, 0.5, 5.2, 0.5)).toBe(false); // off map (right)
    expect(lineWalkable(g, 0, 0, 2, 0)).toBe(true); // endpoints exactly on tile edges
    expect(lineWalkable(g, 4.5, 2.5, 0.5, 2.5)).toBe(true); // reversed direction
  });

  it('is a supercover: passing exactly through a corner touches both side tiles', () => {
    const g = ascii([
      '.#',
      '..',
    ]);
    expect(lineWalkable(g, 0.5, 1.5, 1.5, 0.5)).toBe(false); // ends in '#'
    expect(lineWalkable(g, 0.5, 0.5, 1.5, 1.5)).toBe(false); // corner shared with '#'
    expect(lineWalkable(g, 1.5, 1.5, 0.5, 0.5)).toBe(false);
    const open = ascii(['..', '..']);
    expect(lineWalkable(open, 0.5, 0.5, 1.5, 1.5)).toBe(true);
    // diagonal squeeze between two blocked corners
    const squeeze = ascii([
      '.#',
      '#.',
    ]);
    expect(lineWalkable(squeeze, 0.5, 0.5, 1.5, 1.5)).toBe(false);
  });

  it('respects the clearance radius', () => {
    const g = ascii([
      '..........',
      '##########',
    ]);
    expect(lineWalkable(g, 0.5, 0.5, 9.5, 0.5, 0)).toBe(true);
    expect(lineWalkable(g, 0.5, 0.5, 9.5, 0.5, 0.35)).toBe(true); // 0.85 < 1
    expect(lineWalkable(g, 0.5, 0.5, 9.5, 0.5, 0.55)).toBe(false); // reaches row 1
    expect(lineWalkable(g, 0.5, 0.7, 9.5, 0.7, 0.35)).toBe(false); // too close to the wall
    // point check with radius
    expect(lineWalkable(g, 5.5, 0.5, 5.5, 0.5, 0.35)).toBe(true);
    expect(lineWalkable(g, 5.5, 0.8, 5.5, 0.8, 0.35)).toBe(false);
    // a single pillar slightly off the centre line
    const p = ascii([
      '.....',
      '.....',
      '...#.',
      '.....',
    ]);
    expect(lineWalkable(p, 0.5, 1.5, 4.5, 1.5, 0)).toBe(true);
    expect(lineWalkable(p, 0.5, 1.5, 4.5, 1.5, 0.35)).toBe(true);
    expect(lineWalkable(p, 0.5, 1.8, 4.5, 1.8, 0.35)).toBe(false);
    // wide radius (> 0.5) still catches tiles fully inside the swept area
    const mid = ascii([
      '.....',
      '.....',
      '..#..',
      '.....',
      '.....',
    ]);
    expect(lineWalkable(mid, 0.5, 2.5, 4.5, 2.5, 1.2)).toBe(false);
  });

  it('never reports true when a densely sampled point lies in a blocked tile', () => {
    const g = blobMap(48, 48, 7);
    const rng = mulberry32(99);
    let trues = 0;
    for (let k = 0; k < 3000; k++) {
      const x0 = rng() * 48, y0 = rng() * 48;
      const x1 = x0 + (rng() - 0.5) * 16, y1 = y0 + (rng() - 0.5) * 16;
      const r = k % 2 === 0 ? 0 : 0.35;
      const ok = lineWalkable(g, x0, y0, x1, y1, r);
      if (!ok) continue;
      trues++;
      const L = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.ceil(L * 50) + 1;
      const nx = L > 0 ? (-(y1 - y0) / L) * r : 0, ny = L > 0 ? ((x1 - x0) / L) * r : 0;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        for (const o of [-1, 0, 1]) {
          const px = x0 + (x1 - x0) * t + o * nx, py = y0 + (y1 - y0) * t + o * ny;
          expect(isWalkable(g, Math.floor(px), Math.floor(py))).toBe(true);
        }
      }
      // symmetric
      expect(lineWalkable(g, x1, y1, x0, y0, r)).toBe(true);
    }
    expect(trues).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// nearestWalkable
// ---------------------------------------------------------------------------

describe('nearestWalkable', () => {
  it('finds the closest walkable tile by centre distance', () => {
    const g = createPathGrid(20, 20);
    fillRect(g, 5, 5, 11, 11, WALK_BLOCKED);
    expect(nearestWalkable(g, 2, 2)).toEqual({ tx: 2, ty: 2 });
    const n = nearestWalkable(g, 8, 8)!;
    expect(isWalkable(g, n.tx, n.ty)).toBe(true);
    expect(Math.max(Math.abs(n.tx - 8), Math.abs(n.ty - 8))).toBe(4);
    expect(Math.hypot(n.tx - 8, n.ty - 8)).toBe(4); // orthogonal exit, not a corner
    const n2 = nearestWalkable(g, 10, 8)!;
    expect(n2).toEqual({ tx: 12, ty: 8 });
    expect(nearestWalkable(g, 8, 8, 2)).toBeNull(); // maxR too small
    expect(nearestWalkable(createPathGrid(4, 4, WALK_BLOCKED), 1, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findPath
// ---------------------------------------------------------------------------

describe('findPath', () => {
  it('straight path in the open is a single waypoint at the exact goal', () => {
    const g = createPathGrid(20, 20);
    const p = findPath(g, 2.3, 5.5, 15.7, 5.2)!;
    expect(p).toEqual([{ x: 15.7, y: 5.2 }]);
    expect(lastPathInfo.reached).toBe(true);
    const d = findPath(g, 1.5, 1.5, 17.5, 12.5)!;
    expect(d).toEqual([{ x: 17.5, y: 12.5 }]);
  });

  it('same tile returns the exact goal', () => {
    const g = createPathGrid(8, 8);
    expect(findPath(g, 3.2, 3.2, 3.8, 3.9)).toEqual([{ x: 3.8, y: 3.9 }]);
  });

  it('routes around a wall', () => {
    const g = createPathGrid(20, 20);
    fillRect(g, 10, 0, 10, 14, WALK_BLOCKED); // gap at y >= 15
    const p = findPath(g, 5.5, 2.5, 15.5, 2.5)!;
    expect(p).not.toBeNull();
    expect(last(p)).toEqual({ x: 15.5, y: 2.5 });
    expect(segmentsOk(g, 5.5, 2.5, p)).toBe(true);
    expect(segmentsOk(g, 5.5, 2.5, p, 0.35)).toBe(true);
    expect(p.some((q) => q.y >= 15)).toBe(true);
    expect(p.length).toBeLessThanOrEqual(4); // string-pulled, not tile-by-tile
    // close to the optimal Euclidean detour around the wall end
    const opt = 2 * Math.hypot(4.5, 12.5);
    expect(pathLen(5.5, 2.5, p)).toBeLessThan(opt + 3);
  });

  it('never cuts a blocked corner diagonally', () => {
    const g = ascii([
      '#...',
      '....',
      '....',
    ]);
    // (0,1) -> (1,0): direct diagonal would cut the '#' at (0,0)
    const p = findPath(g, 0.5, 1.5, 1.5, 0.5, { radius: 0 })!;
    expect(p.length).toBe(2);
    expect(p[0]).toEqual({ x: 1.5, y: 1.5 });
    expect(segmentsOk(g, 0.5, 1.5, p)).toBe(true);
    // squeeze between two diagonal blocks is impossible
    const s = ascii([
      '.#.',
      '#..',
      '...',
    ]);
    const q = findPath(s, 0.5, 0.5, 2.5, 0.5)!;
    // (0,0) is enclosed (orthogonal neighbours blocked) -> null
    expect(q).toBeNull();
    const raw = findPath(g, 0.5, 1.5, 1.5, 0.5, { smooth: false })!;
    for (let i = 0, ax = 0.5, ay = 1.5; i < raw.length; i++) {
      const dx = Math.floor(raw[i].x) - Math.floor(ax), dy = Math.floor(raw[i].y) - Math.floor(ay);
      if (dx !== 0 && dy !== 0) {
        expect(isWalkable(g, Math.floor(ax) + dx, Math.floor(ay))).toBe(true);
        expect(isWalkable(g, Math.floor(ax), Math.floor(ay) + dy)).toBe(true);
      }
      ax = raw[i].x;
      ay = raw[i].y;
    }
  });

  it('goes around rubble when the detour is cheap', () => {
    const g = createPathGrid(30, 15);
    fillRect(g, 10, 5, 19, 9, WALK_SLOW);
    const p = findPath(g, 2.5, 7.5, 27.5, 7.5)!;
    expect(last(p)).toEqual({ x: 27.5, y: 7.5 });
    expect(segmentsAvoid(g, WALK_SLOW, 2.5, 7.5, p)).toBe(true);
  });

  it('crosses rubble when the detour is expensive', () => {
    const g = createPathGrid(30, 30);
    fillRect(g, 13, 1, 15, 29, WALK_SLOW); // only row 0 is clear
    const p = findPath(g, 2.5, 25.5, 27.5, 25.5)!;
    expect(last(p)).toEqual({ x: 27.5, y: 25.5 });
    expect(segmentsOk(g, 2.5, 25.5, p)).toBe(true);
    expect(segmentsAvoid(g, WALK_SLOW, 2.5, 25.5, p)).toBe(false);
    expect(Math.min(...p.map((q) => q.y))).toBeGreaterThan(15);
    expect(SLOW_COST).toBe(1.6);
  });

  it('returns a partial path toward an unreachable goal', () => {
    const g = createPathGrid(40, 40);
    fillRect(g, 20, 15, 30, 25, WALK_BLOCKED);
    fillRect(g, 21, 16, 29, 24, WALK_OPEN); // sealed room, goal inside
    const p = findPath(g, 2.5, 20.5, 25.5, 20.5)!;
    expect(p).not.toBeNull();
    expect(lastPathInfo.reached).toBe(false);
    expect(last(p)).toEqual({ x: 19.5, y: 20.5 }); // closest reachable tile to the goal
    expect(segmentsOk(g, 2.5, 20.5, p)).toBe(true);
  });

  it('returns a partial path toward the goal when maxExpand is hit', () => {
    const g = createPathGrid(100, 100);
    const p = findPath(g, 5.5, 5.5, 95.5, 95.5, { maxExpand: 30 })!;
    expect(lastPathInfo.reached).toBe(false);
    expect(p.length).toBeGreaterThan(0);
    const e = last(p);
    expect(Math.hypot(e.x - 95.5, e.y - 95.5)).toBeLessThan(Math.hypot(90, 90) - 3);
  });

  it('retargets a goal inside an obstacle to the nearest walkable tile', () => {
    const g = createPathGrid(30, 30);
    fillRect(g, 10, 10, 14, 14, WALK_BLOCKED);
    const p = findPath(g, 2.5, 12.5, 12.5, 12.5)!;
    const n = nearestWalkable(g, 12, 12)!;
    expect(last(p)).toEqual({ x: n.tx + 0.5, y: n.ty + 0.5 });
    expect(Math.hypot(n.tx - 12, n.ty - 12)).toBe(3);
    expect(lastPathInfo.reached).toBe(true);
    expect(lastPathInfo.goalRetargeted).toBe(true);
    // off-map goal clamps onto the map edge
    const q = findPath(g, 2.5, 3.5, -5, 3.5)!;
    expect(last(q)).toEqual({ x: 0.5, y: 3.5 });
  });

  it('starts from the nearest walkable tile when the start is inside an obstacle', () => {
    const g = createPathGrid(30, 30);
    fillRect(g, 10, 10, 14, 14, WALK_BLOCKED);
    const p = findPath(g, 12.5, 12.5, 25.5, 25.5)!;
    const n = nearestWalkable(g, 12, 12)!;
    expect(lastPathInfo.startRelocated).toBe(true);
    expect(p[0]).toEqual({ x: n.tx + 0.5, y: n.ty + 0.5 });
    expect(last(p)).toEqual({ x: 25.5, y: 25.5 });
    expect(segmentsOk(g, p[0].x, p[0].y, p.slice(1))).toBe(true);
  });

  it('returns null only when the start is enclosed or nothing is walkable', () => {
    const g = createPathGrid(10, 10);
    fillRect(g, 4, 4, 6, 6, WALK_BLOCKED);
    g.walk[idx(g, 5, 5)] = WALK_OPEN;
    expect(findPath(g, 5.5, 5.5, 1.5, 1.5)).toBeNull();
    expect(findPath(createPathGrid(5, 5, WALK_BLOCKED), 1.5, 1.5, 3.5, 3.5)).toBeNull();
    // already as close as possible -> empty path (not null)
    const h = createPathGrid(10, 10);
    fillRect(h, 5, 0, 5, 9, WALK_BLOCKED);
    expect(findPath(h, 4.5, 3.5, 8.5, 3.5)).toEqual([]);
  });

  it('produces valid paths on random maps (reachable -> exact goal, segments walkable)', () => {
    const g = blobMap(96, 96, 1234);
    const lab = components(g);
    const rng = mulberry32(5);
    const walkables: number[] = [];
    for (let i = 0; i < g.walk.length; i++) if (lab[i] >= 0) walkables.push(i);
    for (let k = 0; k < 300; k++) {
      const s = walkables[Math.floor(rng() * walkables.length)];
      const t = walkables[Math.floor(rng() * walkables.length)];
      const sx = (s % g.w) + 0.1 + rng() * 0.8, sy = ((s / g.w) | 0) + 0.1 + rng() * 0.8;
      const gx = (t % g.w) + 0.1 + rng() * 0.8, gy = ((t / g.w) | 0) + 0.1 + rng() * 0.8;
      const p = findPath(g, sx, sy, gx, gy);
      expect(p).not.toBeNull();
      expect(segmentsOk(g, sx, sy, p!)).toBe(true);
      if (lab[s] === lab[t]) {
        expect(lastPathInfo.reached).toBe(true);
        if (s !== t || p!.length > 0) expect(last(p!)).toEqual({ x: gx, y: gy });
      } else {
        expect(lastPathInfo.reached).toBe(false);
      }
    }
  });

  it('is deterministic regardless of call order / buffer reuse', () => {
    const g = blobMap(64, 64, 42);
    const rng = mulberry32(3);
    const qs: number[][] = [];
    for (let k = 0; k < 80; k++) qs.push([rng() * 64, rng() * 64, rng() * 64, rng() * 64]);
    const a = qs.map((q) => JSON.stringify(findPath(g, q[0], q[1], q[2], q[3])));
    const other = createPathGrid(30, 30);
    findPath(other, 1.5, 1.5, 28.5, 28.5);
    const b = qs.slice().reverse().map((q) => JSON.stringify(findPath(g, q[0], q[1], q[2], q[3]))).reverse();
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// FlowField
// ---------------------------------------------------------------------------

/** Bellman-Ford reference with the same movement rules. */
function referenceDist(g: PathGrid, goals: number[], siege: boolean): Float64Array {
  const { w, h, walk } = g;
  const cost = (c: number): number => (c === WALK_OPEN ? 1 : c === WALK_SLOW ? SLOW_COST : c === WALK_STRUCTURE && siege ? SIEGE_COST : 0);
  const cornerOk = (x: number, y: number): boolean => inBounds(g, x, y) && (walk[y * w + x] === WALK_OPEN || walk[y * w + x] === WALK_SLOW);
  const d = new Float64Array(w * h).fill(Infinity);
  for (const gi of goals) if (walk[gi] !== WALK_BLOCKED) d[gi] = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const c = cost(walk[i]);
        if (c === 0 || d[i] === 0) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (!inBounds(g, nx, ny)) continue;
            if (dx && dy && !(cornerOk(x + dx, y) && cornerOk(x, y + dy))) continue;
            const nd = d[ny * w + nx] + c * (dx && dy ? Math.SQRT2 : 1);
            if (nd < d[i] - 1e-9) {
              d[i] = nd;
              changed = true;
            }
          }
        }
      }
    }
  }
  return d;
}

function checkFieldInvariants(g: PathGrid, ff: FlowField, goals: number[], siege: boolean): void {
  const { w, walk } = g;
  const goalSet = new Set(goals);
  let reachable = 0;
  for (let i = 0; i < walk.length; i++) {
    const d = ff.dist[i];
    const x = i % w, y = (i / w) | 0;
    if (d === Infinity || goalSet.has(i)) {
      expect(ff.next[i]).toBe(-1);
      expect(ff.dirX[i]).toBe(0);
      expect(ff.dirY[i]).toBe(0);
      if (goalSet.has(i) && walk[i] !== WALK_BLOCKED) expect(d).toBe(0);
      continue;
    }
    reachable++;
    expect(walk[i]).not.toBe(WALK_BLOCKED);
    if (!siege) expect(walk[i]).not.toBe(WALK_STRUCTURE);
    const n = ff.next[i];
    expect(n).toBeGreaterThanOrEqual(0);
    expect(ff.dist[n]).toBeLessThan(d); // downhill
    expect(walk[n]).not.toBe(WALK_BLOCKED);
    const nx = n % w, ny = (n / w) | 0;
    expect(Math.max(Math.abs(nx - x), Math.abs(ny - y))).toBe(1);
    if (nx !== x && ny !== y) {
      // diagonal: both orthogonal tiles must be open ground (no corner cutting)
      expect(isWalkable(g, nx, y)).toBe(true);
      expect(isWalkable(g, x, ny)).toBe(true);
    }
    const dx = ff.dirX[i], dy = ff.dirY[i];
    expect(Math.hypot(dx, dy)).toBeCloseTo(1, 4);
    expect(dx * (nx - x) + dy * (ny - y)).toBeGreaterThan(0);
    // following the direction from the tile centre never enters a blocked tile
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const px = x + 0.5 + dx * t, py = y + 0.5 + dy * t;
      const tx = Math.floor(px), ty = Math.floor(py);
      expect(inBounds(g, tx, ty)).toBe(true);
      const code = walk[ty * w + tx];
      expect(code).not.toBe(WALK_BLOCKED);
      if (!siege && code === WALK_STRUCTURE) expect(goalSet.has(ty * w + tx)).toBe(true);
    }
  }
  expect(reachable).toBeGreaterThan(0);
}

describe('FlowField', () => {
  it('integrates the same distances as a brute-force reference (normal + siege)', () => {
    for (const seed of [1, 2, 3]) {
      const g = blobMap(24, 24, seed, 0.25);
      const rng = mulberry32(seed + 100);
      for (let k = 0; k < 25; k++) g.walk[Math.floor(rng() * g.walk.length)] = WALK_STRUCTURE;
      const goals = [Math.floor(rng() * g.walk.length), Math.floor(rng() * g.walk.length)];
      for (const mode of ['normal', 'siege'] as const) {
        const ff = new FlowField(24, 24);
        ff.build(g, goals, mode);
        const ref = referenceDist(g, goals, mode === 'siege');
        for (let i = 0; i < ref.length; i++) {
          if (ref[i] === Infinity) expect(ff.dist[i]).toBe(Infinity);
          else expect(ff.dist[i]).toBeCloseTo(ref[i], 3);
        }
      }
    }
  });

  it('directions point downhill and never into blocked tiles or across blocked corners', () => {
    const g = blobMap(64, 64, 77);
    const rng = mulberry32(8);
    for (let k = 0; k < 60; k++) g.walk[Math.floor(rng() * g.walk.length)] = WALK_STRUCTURE;
    const lc = largestComponentTiles(g);
    const goals = [lc[0], lc[Math.floor(lc.length / 2)], lc[lc.length - 1]];
    const ff = new FlowField(64, 64);
    ff.build(g, goals, 'normal');
    checkFieldInvariants(g, ff, goals, false);
    ff.build(g, goals, 'siege');
    checkFieldInvariants(g, ff, goals, true);
    expect(ff.buildMs).toBeGreaterThanOrEqual(0);
  });

  it('accepts structure goals (dist 0) and points neighbours at them', () => {
    const g = createPathGrid(12, 12);
    fillRect(g, 5, 5, 6, 6, WALK_STRUCTURE); // a 2x2 HQ
    const goals = [idx(g, 5, 5), idx(g, 6, 5), idx(g, 5, 6), idx(g, 6, 6)];
    const ff = new FlowField(12, 12);
    ff.build(g, goals, 'normal');
    for (const gi of goals) expect(ff.dist[gi]).toBe(0);
    expect(ff.dist[idx(g, 4, 5)]).toBe(1);
    expect(ff.next[idx(g, 4, 5)]).toBe(idx(g, 5, 5));
    expect(ff.dist[idx(g, 0, 0)]).toBeCloseTo(5 * Math.SQRT2, 4);
    checkFieldInvariants(g, ff, goals, false);
    // blocked goals and junk indices are ignored
    g.walk[idx(g, 0, 0)] = WALK_BLOCKED;
    ff.build(g, [idx(g, 0, 0), -1, 9999, 2.5], 'normal');
    expect(ff.dist.every((d) => d === Infinity)).toBe(true);
  });

  function wallMap(gapY: number): PathGrid {
    const g = createPathGrid(64, 32);
    fillRect(g, 32, 0, 32, 31, WALK_STRUCTURE);
    g.walk[idx(g, 32, gapY)] = WALK_OPEN;
    return g;
  }

  function follow(g: PathGrid, ff: FlowField, from: number): { codes: Set<number>; steps: number } {
    const codes = new Set<number>();
    let i = from, steps = 0;
    while (ff.next[i] !== -1 && steps < 10000) {
      i = ff.next[i];
      codes.add(g.walk[i]);
      steps++;
    }
    expect(ff.dist[i]).toBe(0);
    return { codes, steps };
  }

  it('siege mode breaches a wall only when the detour is long', () => {
    const goal = 2 * 64 + 50; // (50,2)
    const robot = 2 * 64 + 10; // (10,2)

    const far = wallMap(30);
    const ff = new FlowField(64, 32);
    ff.build(far, [goal], 'normal');
    expect(follow(far, ff, robot).codes.has(WALK_STRUCTURE)).toBe(false);
    expect(ff.dist[robot]).toBeGreaterThan(60);
    ff.build(far, [goal], 'siege');
    expect(ff.mode).toBe('siege');
    expect(follow(far, ff, robot).codes.has(WALK_STRUCTURE)).toBe(true);
    expect(ff.dist[robot]).toBeLessThan(55);
    // the tile in front of the wall points into it (robots stop there and attack)
    expect(far.walk[ff.next[2 * 64 + 31]]).toBe(WALK_STRUCTURE);

    const near = wallMap(4);
    ff.build(near, [goal], 'siege');
    expect(follow(near, ff, robot).codes.has(WALK_STRUCTURE)).toBe(false);

    // fully sealed: normal mode can't reach, siege can
    const sealed = createPathGrid(64, 32);
    fillRect(sealed, 32, 0, 32, 31, WALK_STRUCTURE);
    ff.build(sealed, [goal], 'normal');
    expect(ff.dist[robot]).toBe(Infinity);
    ff.build(sealed, [goal], 'siege');
    expect(ff.dist[robot]).toBeCloseTo(39 + SIEGE_COST, 4);
  });

  it('sample() returns a shared object and handles off-map / unreachable points', () => {
    const g = createPathGrid(16, 16);
    fillRect(g, 8, 0, 8, 15, WALK_BLOCKED);
    const ff = new FlowField(16, 16);
    ff.build(g, [idx(g, 2, 8)], 'normal');
    const a = ff.sample(5.5, 8.5);
    expect(a.dx).toBeCloseTo(-1, 5);
    expect(a.dy).toBeCloseTo(0, 5);
    expect(a.dist).toBe(3);
    const b = ff.sample(-3, 2);
    expect(b).toBe(a); // same shared object
    expect(b.dist).toBe(Infinity);
    expect(b.dx).toBe(0);
    // unit shoved into the blocked column steers back to the reachable side
    const c = ff.sample(8.2, 8.5);
    expect(c.dx).toBeLessThan(0);
    expect(c.dist).toBeLessThan(Infinity);
    // other side of the wall: unreachable
    const d = ff.sample(12.5, 8.5);
    expect(d.dist).toBe(Infinity);
    expect(d.dx).toBe(0);
    expect(d.dy).toBe(0);
  });

  it('is deterministic', () => {
    const g = blobMap(64, 64, 9);
    const lc = largestComponentTiles(g);
    const goals = [lc[5], lc[lc.length - 5]];
    const a = new FlowField(64, 64);
    const b = new FlowField(64, 64);
    a.build(g, goals, 'siege');
    b.build(createPathGrid(64, 64), [1], 'normal');
    b.build(g, goals, 'siege');
    expect(Array.from(b.dist)).toEqual(Array.from(a.dist));
    expect(Array.from(b.dirX)).toEqual(Array.from(a.dirX));
    expect(Array.from(b.dirY)).toEqual(Array.from(a.dirY));
    expect(Array.from(b.next)).toEqual(Array.from(a.next));
  });

  it('rejects a grid of the wrong size', () => {
    const ff = new FlowField(8, 8);
    expect(() => ff.build(createPathGrid(9, 8), [0], 'normal')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SpatialHash
// ---------------------------------------------------------------------------

describe('SpatialHash', () => {
  it('returns a duplicate-free superset of the brute-force result', () => {
    const rng = mulberry32(2024);
    const W = 64, H = 48;
    const hash = new SpatialHash(W, H, 2, 16); // tiny capacity: forces growth
    const pts: { id: number; x: number; y: number }[] = [];
    for (let i = 0; i < 3000; i++) {
      const p = { id: i * 3 + 1, x: -2 + rng() * (W + 4), y: -2 + rng() * (H + 4) }; // some off-map
      pts.push(p);
      hash.insert(p.id, p.x, p.y);
    }
    expect(hash.count).toBe(3000);
    expect(hash.capacity).toBeGreaterThanOrEqual(3000);
    const out: number[] = [];
    const exact: number[] = [];
    for (let q = 0; q < 600; q++) {
      const x = -4 + rng() * (W + 8), y = -4 + rng() * (H + 8), r = rng() * 6;
      const n = hash.queryRadius(x, y, r, out);
      const got = new Set(out.slice(0, n));
      expect(got.size).toBe(n); // no duplicates
      const brute = pts.filter((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r).map((p) => p.id);
      for (const id of brute) expect(got.has(id)).toBe(true);
      const m = hash.queryRadiusExact(x, y, r, exact);
      expect(exact.slice(0, m).sort((a, b) => a - b)).toEqual(brute.sort((a, b) => a - b));
    }
  });

  it('clear() resets contents and reuses storage', () => {
    const hash = new SpatialHash(32, 32);
    for (let i = 0; i < 100; i++) hash.insert(i, 16, 16);
    hash.clear();
    expect(hash.count).toBe(0);
    const out: number[] = [];
    expect(hash.queryRadius(16, 16, 4, out)).toBe(0);
    hash.insert(7, 16.2, 16.3);
    expect(hash.queryRadius(16, 16, 1, out)).toBe(1);
    expect(out[0]).toBe(7);
    expect(hash.queryRadius(2, 2, 1, out)).toBe(0);
    expect(hash.queryRadius(Number.NaN, 2, 1, out)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// performance (logs; only fails if >10x over budget)
// ---------------------------------------------------------------------------

function percentile(xs: number[], p: number): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

describe('performance (128x128, ~30% obstacles)', () => {
  const g = blobMap(128, 128, 31337, 0.3);
  const blockedFrac = g.walk.reduce((a, c) => a + (c === WALK_BLOCKED ? 1 : 0), 0) / g.walk.length;
  const lc = largestComponentTiles(g);

  it('findPath typical < 1.5 ms', () => {
    const rng = mulberry32(11);
    const pairs: number[][] = [];
    for (let k = 0; k < 400; k++) {
      const s = lc[Math.floor(rng() * lc.length)], t = lc[Math.floor(rng() * lc.length)];
      pairs.push([(s % 128) + 0.5, ((s / 128) | 0) + 0.5, (t % 128) + 0.5, ((t / 128) | 0) + 0.5]);
    }
    for (let k = 0; k < 100; k++) findPath(g, pairs[k][0], pairs[k][1], pairs[k][2], pairs[k][3]); // warm-up
    const times: number[] = [];
    let expanded = 0;
    for (const p of pairs) {
      const t0 = performance.now();
      findPath(g, p[0], p[1], p[2], p[3]);
      times.push(performance.now() - t0);
      expanded += lastPathInfo.expanded;
    }
    // unreachable worst case (goal in a sealed pocket): full-component expansion
    const sealed = createPathGrid(128, 128);
    sealed.walk.set(g.walk);
    fillRect(sealed, 60, 60, 66, 66, WALK_BLOCKED);
    fillRect(sealed, 62, 62, 64, 64, WALK_OPEN);
    const tw0 = performance.now();
    for (let k = 0; k < 20; k++) findPath(sealed, lc[0] % 128 + 0.5, ((lc[0] / 128) | 0) + 0.5, 63.5, 63.5);
    const worst = (performance.now() - tw0) / 20;
    const median = percentile(times, 0.5);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(
      `[perf] findPath 128x128 (${(blockedFrac * 100).toFixed(1)}% blocked): median ${median.toFixed(3)} ms, ` +
        `mean ${mean.toFixed(3)} ms, p95 ${percentile(times, 0.95).toFixed(3)} ms, max ${Math.max(...times).toFixed(3)} ms, ` +
        `avg expanded ${(expanded / pairs.length).toFixed(0)}; unreachable (full flood) ${worst.toFixed(3)} ms`,
    );
    expect(median).toBeLessThan(15);
  });

  it('FlowField.build < 5 ms', () => {
    const ff = new FlowField(128, 128);
    const goals = [lc[0], lc[lc.length >> 1], lc[lc.length - 1]];
    for (let k = 0; k < 10; k++) ff.build(g, goals, k & 1 ? 'siege' : 'normal'); // warm-up
    const times: number[] = [];
    const siegeTimes: number[] = [];
    for (let k = 0; k < 30; k++) {
      ff.build(g, goals, 'normal');
      times.push(ff.buildMs);
      ff.build(g, goals, 'siege');
      siegeTimes.push(ff.buildMs);
    }
    const med = percentile(times, 0.5), medS = percentile(siegeTimes, 0.5);
    console.log(`[perf] FlowField.build 128x128: normal median ${med.toFixed(3)} ms (max ${Math.max(...times).toFixed(3)}), siege median ${medS.toFixed(3)} ms`);
    expect(med).toBeLessThan(50);
  });

  it('SpatialHash 3000 inserts + 3000 queries < 2 ms', () => {
    const rng = mulberry32(5);
    const xs = new Float64Array(3000), ys = new Float64Array(3000);
    for (let i = 0; i < 3000; i++) {
      xs[i] = rng() * 128;
      ys[i] = rng() * 128;
    }
    const hash = new SpatialHash(128, 128, 2);
    const out: number[] = [];
    let sink = 0;
    const run = (): number => {
      const t0 = performance.now();
      hash.clear();
      for (let i = 0; i < 3000; i++) hash.insert(i, xs[i], ys[i]);
      for (let i = 0; i < 3000; i++) sink += hash.queryRadius(xs[i], ys[i], 3, out);
      return performance.now() - t0;
    };
    for (let k = 0; k < 20; k++) run(); // warm-up
    const times: number[] = [];
    for (let k = 0; k < 50; k++) times.push(run());
    const med = percentile(times, 0.5);
    console.log(`[perf] SpatialHash 3000 inserts + 3000 queries (r=3): median ${med.toFixed(3)} ms, max ${Math.max(...times).toFixed(3)} ms (avg candidates ${(sink / 70 / 3000).toFixed(1)})`);
    expect(med).toBeLessThan(20);
  });
});
