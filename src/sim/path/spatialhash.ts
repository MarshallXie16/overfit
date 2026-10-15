/**
 * Uniform-grid spatial hash rebuilt every tick (clear + insert). Entries are a linked list in
 * typed arrays (per-cell head + per-entry next), so steady-state use is allocation-free.
 * Points outside the map are clamped into border cells (queries clamp the same way, so the
 * candidate set is always a superset of the exact result).
 */
export class SpatialHash {
  readonly w: number;
  readonly h: number;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  /** Number of entries inserted since the last clear(). */
  count = 0;

  private readonly inv: number;
  private readonly head: Int32Array;
  private nextE: Int32Array;
  private ids: Int32Array;
  private xs: Float64Array;
  private ys: Float64Array;

  constructor(w: number, h: number, cellSize = 2, initialCapacity = 1024) {
    this.w = w;
    this.h = h;
    this.cellSize = cellSize > 0 ? cellSize : 2;
    this.inv = 1 / this.cellSize;
    this.cols = Math.max(1, Math.ceil(w / this.cellSize));
    this.rows = Math.max(1, Math.ceil(h / this.cellSize));
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    const cap = Math.max(16, initialCapacity | 0);
    this.nextE = new Int32Array(cap);
    this.ids = new Int32Array(cap);
    this.xs = new Float64Array(cap);
    this.ys = new Float64Array(cap);
  }

  /** Entry capacity before the next growth. */
  get capacity(): number {
    return this.ids.length;
  }

  clear(): void {
    this.head.fill(-1);
    this.count = 0;
  }

  /** Insert an integer id (int32 range) at float world point (x,y). */
  insert(id: number, x: number, y: number): void {
    const e = this.count;
    if (e === this.ids.length) this.grow();
    let cx = Math.floor(x * this.inv);
    let cy = Math.floor(y * this.inv);
    if (!(cx >= 0)) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (!(cy >= 0)) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    const cell = cy * this.cols + cx;
    this.ids[e] = id;
    this.xs[e] = x;
    this.ys[e] = y;
    this.nextE[e] = this.head[cell];
    this.head[cell] = e;
    this.count = e + 1;
  }

  /**
   * Candidate ids from every cell overlapping the square [x-r,x+r]^2 (caller does the exact
   * distance check). Writes out[0..count) and returns count; out.length is NOT truncated
   * (entries past count are stale) so a reused array never reallocates.
   */
  queryRadius(x: number, y: number, r: number, out: number[]): number {
    const head = this.head, nextE = this.nextE, ids = this.ids;
    const cols = this.cols;
    const inv = this.inv;
    let c0 = Math.floor((x - r) * inv);
    let c1 = Math.floor((x + r) * inv);
    let r0 = Math.floor((y - r) * inv);
    let r1 = Math.floor((y + r) * inv);
    if (!(c0 <= c1 && r0 <= r1)) return 0; // NaN or negative radius
    // Clamp exactly like insert() so off-map points stay findable.
    if (c0 < 0) c0 = 0;
    if (r0 < 0) r0 = 0;
    if (c1 >= cols) c1 = cols - 1;
    if (r1 >= this.rows) r1 = this.rows - 1;
    if (c0 >= cols) c0 = cols - 1;
    if (r0 >= this.rows) r0 = this.rows - 1;
    if (c1 < 0) c1 = 0;
    if (r1 < 0) r1 = 0;
    let n = 0;
    for (let cy = r0; cy <= r1; cy++) {
      const row = cy * cols;
      for (let cx = c0; cx <= c1; cx++) {
        for (let e = head[row + cx]; e !== -1; e = nextE[e]) out[n++] = ids[e];
      }
    }
    return n;
  }

  /** Like queryRadius but only ids whose inserted point is within distance r (inclusive). */
  queryRadiusExact(x: number, y: number, r: number, out: number[]): number {
    const head = this.head, nextE = this.nextE, ids = this.ids, xs = this.xs, ys = this.ys;
    const cols = this.cols;
    const inv = this.inv;
    let c0 = Math.floor((x - r) * inv);
    let c1 = Math.floor((x + r) * inv);
    let r0 = Math.floor((y - r) * inv);
    let r1 = Math.floor((y + r) * inv);
    if (!(c0 <= c1 && r0 <= r1)) return 0;
    if (c0 < 0) c0 = 0;
    if (r0 < 0) r0 = 0;
    if (c1 >= cols) c1 = cols - 1;
    if (r1 >= this.rows) r1 = this.rows - 1;
    if (c0 >= cols) c0 = cols - 1;
    if (r0 >= this.rows) r0 = this.rows - 1;
    if (c1 < 0) c1 = 0;
    if (r1 < 0) r1 = 0;
    const r2 = r * r;
    let n = 0;
    for (let cy = r0; cy <= r1; cy++) {
      const row = cy * cols;
      for (let cx = c0; cx <= c1; cx++) {
        for (let e = head[row + cx]; e !== -1; e = nextE[e]) {
          const dx = xs[e] - x;
          const dy = ys[e] - y;
          if (dx * dx + dy * dy <= r2) out[n++] = ids[e];
        }
      }
    }
    return n;
  }

  private grow(): void {
    const cap = this.ids.length * 2;
    const nextE = new Int32Array(cap);
    const ids = new Int32Array(cap);
    const xs = new Float64Array(cap);
    const ys = new Float64Array(cap);
    nextE.set(this.nextE);
    ids.set(this.ids);
    xs.set(this.xs);
    ys.set(this.ys);
    this.nextE = nextE;
    this.ids = ids;
    this.xs = xs;
    this.ys = ys;
  }
}
