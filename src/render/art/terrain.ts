// Procedural ruined-city terrain. Deterministic from (seed, tile coords, neighbours) and seamless across chunks:
// every per-pixel value derives from global coordinates, and every per-tile decoration is drawn by any chunk
// that the decoration can overlap (chunks render a margin of neighbouring tiles' decorations).
import { ctxOf, ihash, makeCanvas, mulberry32, type G } from './util';

export const TERRAIN = { GROUND: 0, ROAD: 1, RUBBLE: 2, WATER: 3, RUIN: 4, PARK: 5 } as const;

export interface TerrainMap {
  w: number;
  h: number;
  terrain: Uint8Array;
  seed: number;
}

const { GROUND, ROAD, RUBBLE, WATER, RUIN, PARK } = TERRAIN;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ noise

interface Noise { (x: number, y: number): number }
const noiseCache = new Map<number, Noise>();

function makeNoise(seed: number): Noise {
  const hit = noiseCache.get(seed);
  if (hit) return hit;
  const r = mulberry32(seed ^ 0x9e3779b9);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = r();
  const fn: Noise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const pa = perm[X];
    const pb = perm[X + 1];
    const a = vals[perm[pa + Y]];
    const b = vals[perm[pb + Y]];
    const c = vals[perm[pa + Y + 1]];
    const d = vals[perm[pb + Y + 1]];
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  noiseCache.set(seed, fn);
  return fn;
}

const smooth = (a: number, b: number, x: number) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ map helpers

class TMap {
  w: number;
  h: number;
  t: Uint8Array;
  seed: number;
  constructor(m: TerrainMap) {
    this.w = m.w;
    this.h = m.h;
    this.t = m.terrain;
    this.seed = m.seed | 0;
  }
  at(x: number, y: number): number {
    const cx = x < 0 ? 0 : x >= this.w ? this.w - 1 : x;
    const cy = y < 0 ? 0 : y >= this.h ? this.h - 1 : y;
    return this.t[cy * this.w + cx];
  }
  rng(x: number, y: number, salt: number): () => number {
    return mulberry32(ihash(x, y, this.seed ^ salt));
  }
  h01(x: number, y: number, salt: number): number {
    return ihash(x, y, this.seed ^ salt) / 4294967296;
  }
}

// --- ruin building partition (deterministic, local)
function isColBoundary(m: TMap, x: number): boolean {
  return ((x % 6) + 6) % 6 === 0 || m.h01(x, 0, 0x51ab) < 0.28;
}
function isRowBoundary(m: TMap, y: number): boolean {
  return ((y % 6) + 6) % 6 === 3 || m.h01(0, y, 0x77c1) < 0.28;
}
function buildingCell(m: TMap, tx: number, ty: number): [number, number] {
  let bx = tx;
  while (!isColBoundary(m, bx)) bx--;
  let by = ty;
  while (!isRowBoundary(m, by)) by--;
  return [bx, by];
}
function buildingId(m: TMap, tx: number, ty: number): number {
  const [bx, by] = buildingCell(m, tx, ty);
  return ihash(bx, by, m.seed ^ 0x3b1d);
}
function buildingHeight(id: number): number {
  return 0.32 + ((id >>> 8) & 255) / 255 * 0.5; // tiles of shadow length
}
const ROOF_COLS: [number, number, number][] = [
  [62, 61, 58], [70, 66, 60], [57, 60, 62], [74, 70, 63], [56, 53, 50], [66, 63, 57], [52, 55, 54],
];
function roofCol(id: number): [number, number, number] {
  return ROOF_COLS[(id >>> 3) % ROOF_COLS.length];
}

// Roof rectangle (tile units) of a ruin tile: inset where it meets a road (sidewalk) or open ground.
const SIDEWALK = 0.2;
function roofRect(m: TMap, tx: number, ty: number): [number, number, number, number] {
  const ins = (nx: number, ny: number) => {
    const n = m.at(nx, ny);
    if (n === RUIN) return 0;
    if (n === ROAD) return SIDEWALK;
    return 0.05;
  };
  return [tx + ins(tx - 1, ty), ty + ins(tx, ty - 1), tx + 1 - ins(tx + 1, ty), ty + 1 - ins(tx, ty + 1)];
}

// --- road classification
function roadRuns(m: TMap, tx: number, ty: number): [number, number, number, number] {
  let l = 0, r = 0, u = 0, d = 0;
  while (l < 8 && m.at(tx - l - 1, ty) === ROAD) l++;
  while (r < 8 && m.at(tx + r + 1, ty) === ROAD) r++;
  while (u < 8 && m.at(tx, ty - u - 1) === ROAD) u++;
  while (d < 8 && m.at(tx, ty + d + 1) === ROAD) d++;
  return [l, r, u, d];
}
function roadClass(m: TMap, tx: number, ty: number): 'h' | 'v' | 'x' | 'n' {
  if (m.at(tx, ty) !== ROAD) return 'n';
  const [l, r, u, d] = roadRuns(m, tx, ty);
  const hl = l + r + 1;
  const vl = u + d + 1;
  if (hl >= 3 && vl <= 4 && hl > vl) return 'h';
  if (vl >= 3 && hl <= 4 && vl > hl) return 'v';
  if (hl > 4 && vl > 4) return 'x';
  return 'n';
}

// ------------------------------------------------------------------ per-pixel base

function basePass(g: G, m: TMap, x0: number, y0: number, tw: number, th: number, ppt: number): void {
  const W = tw * ppt;
  const H = th * ppt;
  const img = g.createImageData(W, H);
  const d = img.data;
  const LM = 2;
  const LW = tw + LM * 2;
  const LH = th + LM * 2;
  const types = new Uint8Array(LW * LH);
  for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) types[j * LW + i] = m.at(x0 - LM + i, y0 - LM + j);
  const uniform = new Uint8Array(LW * LH);
  for (let j = 1; j < LH - 1; j++) {
    for (let i = 1; i < LW - 1; i++) {
      const t = types[j * LW + i];
      let u = 1;
      for (let dj = -1; dj <= 1 && u; dj++) for (let di = -1; di <= 1; di++) if (types[(j + dj) * LW + i + di] !== t) { u = 0; break; }
      uniform[j * LW + i] = u;
    }
  }
  // per-tile roof colours & road-adjacency flags for ruin tiles
  const roofR = new Float32Array(LW * LH);
  const roofG = new Float32Array(LW * LH);
  const roofB = new Float32Array(LW * LH);
  const rr = new Float32Array(LW * LH * 4); // roof rect per local tile (relative to tile origin)
  for (let j = 0; j < LH; j++) {
    for (let i = 0; i < LW; i++) {
      const k = j * LW + i;
      if (types[k] !== RUIN) continue;
      const tx = x0 - LM + i, ty = y0 - LM + j;
      const id = buildingId(m, tx, ty);
      const c = roofCol(id);
      const v = 0.92 + ((id >>> 13) & 63) / 63 * 0.16;
      roofR[k] = c[0] * v; roofG[k] = c[1] * v; roofB[k] = c[2] * v;
      const rect = roofRect(m, tx, ty);
      rr[k * 4] = rect[0] - tx; rr[k * 4 + 1] = rect[1] - ty; rr[k * 4 + 2] = rect[2] - tx; rr[k * 4 + 3] = rect[3] - ty;
    }
  }
  const N1 = makeNoise(m.seed);
  const N2 = makeNoise(m.seed + 1013);
  const N3 = makeNoise(m.seed + 7717);
  const inv = 1 / ppt;
  for (let py = 0; py < H; py++) {
    const wy = y0 * ppt + py;
    const v = (wy + 0.5) * inv;
    const tyl = Math.floor(v) - (y0 - LM);
    for (let px = 0; px < W; px++) {
      const wx = x0 * ppt + px;
      const u = (wx + 0.5) * inv;
      const txl = Math.floor(u) - (x0 - LM);
      const k = tyl * LW + txl;
      let t = types[k];
      let ue = u, ve = v, kk = k;
      let shoreD = 9; // distance (tiles) to nearest non-water (if water) or to water (if land)
      if (!uniform[k] && t !== ROAD && t !== RUIN) {
        ue = u + (N2(u * 1.9, v * 1.9) - 0.5) * 0.62;
        ve = v + (N2(u * 1.9 + 40.3, v * 1.9 + 17.1) - 0.5) * 0.62;
        const twl = Math.floor(ue) - (x0 - LM);
        const thl = Math.floor(ve) - (y0 - LM);
        const kw = thl * LW + twl;
        const tw2 = types[kw];
        if (tw2 !== ROAD && tw2 !== RUIN) { t = tw2; kk = kw; }
        else { ue = u; ve = v; }
        // shore distance
        const isW = t === WATER;
        const ci = Math.floor(ue) - (x0 - LM), cj = Math.floor(ve) - (y0 - LM);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const nt = types[(cj + dj) * LW + ci + di];
            if ((nt === WATER) === isW) continue;
            if (isW && (nt === RUIN || nt === ROAD)) { /* hard edge: still shore */ }
            const rx0 = Math.floor(ue) + di, ry0 = Math.floor(ve) + dj;
            const ddx = ue < rx0 ? rx0 - ue : ue > rx0 + 1 ? ue - rx0 - 1 : 0;
            const ddy = ve < ry0 ? ry0 - ve : ve > ry0 + 1 ? ve - ry0 - 1 : 0;
            const dd = Math.sqrt(ddx * ddx + ddy * ddy);
            if (dd < shoreD) shoreD = dd;
          }
        }
      } else if (t === WATER && !uniform[k]) {
        // water tile next to a road/ruin (sharp edge)
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const nt = types[(tyl + dj) * LW + txl + di];
            if (nt === WATER) continue;
            const rx0 = Math.floor(u) + di, ry0 = Math.floor(v) + dj;
            const ddx = u < rx0 ? rx0 - u : u > rx0 + 1 ? u - rx0 - 1 : 0;
            const ddy = v < ry0 ? ry0 - v : v > ry0 + 1 ? v - ry0 - 1 : 0;
            const dd = Math.sqrt(ddx * ddx + ddy * ddy);
            if (dd < shoreD) shoreD = dd;
          }
        }
      }
      // fine detail noise (shared)
      const n1 = N1(u * 3.1, v * 3.1);
      const n2 = N1(u * 9.3 + 11.7, v * 9.3 + 5.3);
      const n3 = N3(u * 23, v * 23);
      const sp = ((ihash(wx, wy, 0x2f) & 255) / 255 - 0.5) * 9;
      let R = 0, Gc = 0, B = 0;
      if (t === GROUND || t === RUBBLE) {
        const z1 = N3(u * 0.13 + 3.3, v * 0.13 + 9.1);
        const z2 = N2(u * 0.17 + 21.7, v * 0.17 + 2.9);
        const sc = smooth(0.48, 0.62, z1);
        const sd = smooth(0.56, 0.7, z2) * (1 - sc * 0.6);
        // asphalt lot -> concrete -> dirt
        R = 52 + (86 - 52) * sc; Gc = 53 + (84 - 53) * sc; B = 55 + (78 - 55) * sc;
        R += (74 - R) * sd; Gc += (64 - Gc) * sd; B += (52 - B) * sd;
        const br = 0.84 + n1 * 0.22 + n2 * 0.12 + n3 * 0.06;
        R *= br; Gc *= br; B *= br;
        if (t === RUBBLE) {
          const dust = 0.55 + n2 * 0.3;
          R += (92 - R) * dust * 0.55; Gc += (88 - Gc) * dust * 0.55; B += (80 - B) * dust * 0.55;
        }
        if (shoreD < 0.3) {
          const wet = 1 - shoreD / 0.3;
          const f = 1 - wet * 0.38;
          R *= f; Gc *= f; B *= f * 1.02;
        }
      } else if (t === ROAD) {
        const br = 0.86 + n1 * 0.16 + n2 * 0.1 + n3 * 0.08;
        R = 37 * br; Gc = 39 * br; B = 42 * br;
        // tyre-worn lanes slightly lighter
        const tl = N2(u * 0.9, v * 0.9);
        R += tl * 5; Gc += tl * 5; B += tl * 5;
      } else if (t === WATER) {
        const deep = smooth(0, 0.5, shoreD);
        const sheen = N2(u * 1.3 + v * 0.6, v * 2.6 - u * 0.4);
        const ripple = N1(u * 5 + v * 2.1, v * 7.5);
        R = 30 - deep * 14 + sheen * 6; Gc = 40 - deep * 14 + sheen * 9; B = 38 - deep * 9 + sheen * 9;
        R += ripple * 6; Gc += ripple * 8; B += ripple * 8;
        // muddy shallows + scum edge
        if (shoreD < 0.5) {
          const s = 1 - shoreD / 0.5;
          R += (64 - R) * s * 0.55; Gc += (60 - Gc) * s * 0.55; B += (46 - B) * s * 0.55;
          if (shoreD < 0.06) { R = 84 + n3 * 10; Gc = 82 + n3 * 10; B = 64 + n3 * 8; }
        }
      } else if (t === PARK) {
        const grass = N3(u * 28, v * 7.5) * 0.6 + N1(u * 7.5, v * 26) * 0.4;
        const earth = smooth(0.55, 0.72, N2(u * 0.55 + 5.5, v * 0.55 + 1.5) * 0.7 + n1 * 0.3);
        R = 86 + grass * 26; Gc = 80 + grass * 22; B = 50 + grass * 12;
        R += (76 - R) * earth; Gc += (64 - Gc) * earth; B += (50 - B) * earth;
        const br = 0.8 + n1 * 0.2 + n2 * 0.12;
        R *= br; Gc *= br; B *= br;
        if (shoreD < 0.3) {
          const f = 1 - (1 - shoreD / 0.3) * 0.35;
          R *= f; Gc *= f; B *= f;
        }
      } else {
        // RUIN: roof (or sidewalk strip where inset)
        const fx = u - Math.floor(u), fy = v - Math.floor(v);
        const k4 = k * 4;
        if (fx < rr[k4] || fy < rr[k4 + 1] || fx > rr[k4 + 2] || fy > rr[k4 + 3]) {
          const br = 0.85 + n1 * 0.15 + n2 * 0.1;
          R = 82 * br; Gc = 80 * br; B = 75 * br;
        } else {
          const grav = 0.82 + n2 * 0.18 + n3 * 0.16 + n1 * 0.08;
          R = roofR[k] * grav; Gc = roofG[k] * grav; B = roofB[k] * grav;
        }
      }
      void kk;
      const o = (py * W + px) * 4;
      d[o] = R + sp;
      d[o + 1] = Gc + sp;
      d[o + 2] = B + sp;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------ vector details

function crack(g: G, r: () => number, x: number, y: number, len: number, w: number, a = 0.45): void {
  let px = x, py = y;
  let ang = r() * TAU;
  g.beginPath();
  g.moveTo(px, py);
  const n = 4 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    ang += (r() - 0.5) * 1.3;
    px += Math.cos(ang) * (len / n);
    py += Math.sin(ang) * (len / n);
    g.lineTo(px, py);
  }
  g.strokeStyle = `rgba(10,10,10,${a})`;
  g.lineWidth = w;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.stroke();
  g.save();
  g.translate(w * 0.8, w * 0.8);
  g.strokeStyle = `rgba(150,150,140,${a * 0.18})`;
  g.lineWidth = w * 0.6;
  g.stroke();
  g.restore();
}

function blob(g: G, x: number, y: number, r: number, col: string): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, col);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

function irregular(g: G, r: () => number, x: number, y: number, rad: number, n = 6, squash = 1): void {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r() * 0.5;
    const d = rad * (0.6 + r() * 0.5);
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d * squash;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
}

/** A lit chunk of concrete with a cast shadow. */
function chunk(g: G, r: () => number, x: number, y: number, rad: number, col: [number, number, number], k: number): void {
  const n = 5 + Math.floor(r() * 3);
  const seed = r();
  const rr = mulberry32(Math.floor(seed * 1e9));
  g.save();
  irregular(g, rr, x + rad * 0.35 + k, y + rad * 0.45 + k, rad, n);
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fill();
  const rr2 = mulberry32(Math.floor(seed * 1e9));
  irregular(g, rr2, x, y, rad, n);
  const gr = g.createLinearGradient(x - rad, y - rad, x + rad, y + rad);
  gr.addColorStop(0, `rgb(${col[0] + 28},${col[1] + 27},${col[2] + 24})`);
  gr.addColorStop(0.5, `rgb(${col[0]},${col[1]},${col[2]})`);
  gr.addColorStop(1, `rgb(${col[0] - 22},${col[1] - 22},${col[2] - 22})`);
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = 'rgba(15,15,15,0.55)';
  g.lineWidth = 0.6 * k;
  g.stroke();
  g.restore();
}

function deadTree(g: G, r: () => number, x: number, y: number, R: number, k: number): void {
  const segs: [number, number, number, number, number][] = [];
  const branch = (bx: number, by: number, a: number, len: number, w: number, depth: number) => {
    const ex = bx + Math.cos(a) * len;
    const ey = by + Math.sin(a) * len;
    segs.push([bx, by, ex, ey, w]);
    if (depth <= 0) return;
    const nb = 2 + (r() < 0.4 ? 1 : 0);
    for (let i = 0; i < nb; i++) {
      const t = 0.45 + r() * 0.45;
      branch(bx + (ex - bx) * t, by + (ey - by) * t, a + (r() - 0.5) * 1.5, len * (0.4 + r() * 0.25), w * 0.55, depth - 1);
    }
  };
  const nMain = 5 + Math.floor(r() * 3);
  const a0 = r() * TAU;
  for (let i = 0; i < nMain; i++) {
    branch(x, y, a0 + (i / nMain) * TAU + (r() - 0.5) * 0.6, R * (0.55 + r() * 0.4), 2.6 * k * (R / (22 * k)), 2);
  }
  const drawSegs = (dx: number, dy: number, col: string, wm: number) => {
    g.strokeStyle = col;
    g.lineCap = 'round';
    for (const [ax, ay, bx, by, w] of segs) {
      g.beginPath();
      g.moveTo(ax + dx, ay + dy);
      g.lineTo(bx + dx, by + dy);
      g.lineWidth = Math.max(0.5, w * wm);
      g.stroke();
    }
  };
  // shadow (cast bottom-right; trees are tall)
  g.save();
  g.globalAlpha = 0.28;
  drawSegs(R * 0.35, R * 0.45, '#000', 1.1);
  g.restore();
  drawSegs(0, 0, '#211a14', 1.25);
  drawSegs(0, 0, '#4a3a2b', 0.85);
  drawSegs(-0.4 * k, -0.4 * k, 'rgba(150,130,100,0.35)', 0.3);
  // trunk top
  g.beginPath();
  g.arc(x, y, Math.max(1.5, R * 0.13), 0, TAU);
  g.fillStyle = '#3a2c20';
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 0.8;
  g.stroke();
  // a few clinging dry leaves
  for (let i = 0; i < 10; i++) {
    const s = segs[Math.floor(r() * segs.length)];
    g.fillStyle = r() < 0.5 ? 'rgba(120,98,60,0.75)' : 'rgba(92,80,48,0.75)';
    g.beginPath();
    g.arc(s[2] + (r() - 0.5) * 2 * k, s[3] + (r() - 0.5) * 2 * k, (0.7 + r() * 0.9) * k, 0, TAU);
    g.fill();
  }
}

function shrub(g: G, r: () => number, x: number, y: number, R: number, k: number): void {
  blob(g, x + R * 0.4, y + R * 0.5, R * 1.3, 'rgba(0,0,0,0.35)');
  const n = 7 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU;
    const d = r() * R * 0.7;
    const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
    const rad = R * (0.3 + r() * 0.3);
    const c = [[78, 72, 44], [92, 82, 50], [64, 58, 38], [100, 86, 56]][Math.floor(r() * 4)];
    const gr = g.createRadialGradient(cx - rad * 0.4, cy - rad * 0.4, 0, cx, cy, rad);
    gr.addColorStop(0, `rgb(${c[0] + 30},${c[1] + 26},${c[2] + 16})`);
    gr.addColorStop(1, `rgb(${c[0] - 20},${c[1] - 20},${c[2] - 14})`);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(cx, cy, rad, 0, TAU);
    g.fill();
  }
  for (let i = 0; i < 6; i++) {
    const a = r() * TAU;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * R * 0.9, y + Math.sin(a) * R * 0.9);
    g.strokeStyle = 'rgba(40,30,20,0.6)';
    g.lineWidth = 0.6 * k;
    g.stroke();
  }
}

// ------------------------------------------------------------------ main

export function renderTerrainChunk(map: TerrainMap, x0: number, y0: number, tw: number, th: number, pxPerTile = 32): HTMLCanvasElement {
  const ppt = pxPerTile;
  const k = ppt / 32;
  const m = new TMap(map);
  const W = tw * ppt;
  const H = th * ppt;
  const c = makeCanvas(W, H);
  const g = ctxOf(c);
  basePass(g, m, x0, y0, tw, th, ppt);

  g.save();
  g.translate(-x0 * ppt, -y0 * ppt);
  const M = 2;
  const tx0 = x0 - M, ty0 = y0 - M, tx1 = x0 + tw + M, ty1 = y0 + th + M;
  const S = ppt;

  // ---------------------------------------------------------------- ground & sidewalks
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      const t = m.at(tx, ty);
      const X = tx * S, Y = ty * S;
      if (t === GROUND || t === RUBBLE) {
        const r = m.rng(tx, ty, 0x101);
        const N = makeNoise(m.seed + 7717);
        const conc = N((tx + 0.5) * 0.13 + 3.3, (ty + 0.5) * 0.13 + 9.1) > 0.55;
        if (t === GROUND && conc) {
          // slab joints on the tile grid (top + left edges only => drawn once)
          g.fillStyle = 'rgba(20,20,18,0.35)';
          g.fillRect(X, Y, S, 0.9 * k);
          g.fillRect(X, Y, 0.9 * k, S);
          g.fillStyle = 'rgba(160,155,145,0.08)';
          g.fillRect(X, Y + 0.9 * k, S, 0.7 * k);
          if (r() < 0.25) {
            g.fillStyle = 'rgba(20,20,18,0.25)';
            g.fillRect(X + S / 2, Y, 0.7 * k, S);
          }
        }
        if (t === GROUND && !conc && r() < 0.16) {
          // faded parking stripes
          g.fillStyle = 'rgba(200,195,175,0.16)';
          for (const fx of [0.22, 0.72]) g.fillRect(X + fx * S, Y + 0.08 * S, 1.6 * k, 0.6 * S);
        }
        if (r() < 0.55) crack(g, r, X + r() * S, Y + r() * S, (0.3 + r() * 0.6) * S, 0.8 * k);
        if (r() < 0.25) blob(g, X + r() * S, Y + r() * S, (0.12 + r() * 0.25) * S, 'rgba(10,9,8,0.28)');
        if (t === GROUND && r() < 0.035) {
          // manhole cover
          const cx = X + (0.3 + r() * 0.4) * S, cy = Y + (0.3 + r() * 0.4) * S, rad = 0.16 * S;
          g.beginPath();
          g.arc(cx, cy, rad, 0, TAU);
          g.fillStyle = '#2a2b2c';
          g.fill();
          g.strokeStyle = 'rgba(120,120,115,0.5)';
          g.lineWidth = 1 * k;
          g.stroke();
          for (let i = -2; i <= 2; i++) {
            g.fillStyle = 'rgba(80,80,80,0.6)';
            g.fillRect(cx - rad * 0.7, cy + i * rad * 0.3, rad * 1.4, 0.6 * k);
          }
        }
        // dead weeds
        const nw = r() < 0.4 ? 2 + Math.floor(r() * 4) : 0;
        for (let i = 0; i < nw; i++) {
          const wx = X + r() * S, wy = Y + r() * S;
          for (let j = 0; j < 5; j++) {
            const a = r() * TAU;
            g.beginPath();
            g.moveTo(wx, wy);
            g.lineTo(wx + Math.cos(a) * 2.6 * k, wy + Math.sin(a) * 2.6 * k);
            g.strokeStyle = r() < 0.5 ? 'rgba(112,100,62,0.8)' : 'rgba(80,74,46,0.8)';
            g.lineWidth = 0.7 * k;
            g.stroke();
          }
        }
        // pebbles / litter
        for (let i = 0; i < 6; i++) {
          g.fillStyle = r() < 0.5 ? 'rgba(120,118,110,0.5)' : 'rgba(20,20,20,0.4)';
          g.fillRect(X + r() * S, Y + r() * S, (0.6 + r()) * k, (0.6 + r()) * k);
        }
      }
      // sidewalks along roads (on ground/rubble/ruin-inset/park tiles)
      if (t !== ROAD && t !== WATER) {
        const nb: [number, number, number][] = [[0, -1, 0], [1, 0, 1], [0, 1, 2], [-1, 0, 3]];
        for (const [dx, dy, side] of nb) {
          if (m.at(tx + dx, ty + dy) !== ROAD) continue;
          const wdt = (t === PARK ? 0.09 : SIDEWALK) * S;
          let rx = X, ry = Y, rw = S, rh = S;
          if (side === 0) rh = wdt;
          if (side === 2) { ry = Y + S - wdt; rh = wdt; }
          if (side === 3) rw = wdt;
          if (side === 1) { rx = X + S - wdt; rw = wdt; }
          g.fillStyle = t === PARK ? '#5b5a54' : '#585751';
          g.fillRect(rx, ry, rw, rh);
          // joints
          g.fillStyle = 'rgba(25,25,22,0.45)';
          if (side === 0 || side === 2) {
            for (let j = 0; j <= 2; j++) g.fillRect(X + (j * S) / 2, ry, 0.8 * k, rh);
          } else {
            for (let j = 0; j <= 2; j++) g.fillRect(rx, Y + (j * S) / 2, rw, 0.8 * k);
          }
          // curb lip (light) at the road side + dark gutter
          g.fillStyle = 'rgba(170,165,150,0.35)';
          const cw = 1.4 * k;
          if (side === 0) g.fillRect(X, Y, S, cw);
          if (side === 2) g.fillRect(X, Y + S - cw, S, cw);
          if (side === 3) g.fillRect(X, Y, cw, S);
          if (side === 1) g.fillRect(X + S - cw, Y, cw, S);
          g.fillStyle = 'rgba(0,0,0,0.35)';
          if (side === 0) g.fillRect(X, Y - cw, S, cw);
          if (side === 2) g.fillRect(X, Y + S, S, cw);
          if (side === 3) g.fillRect(X - cw, Y, cw, S);
          if (side === 1) g.fillRect(X + S, Y, cw, S);
        }
      }
    }
  }

  // ---------------------------------------------------------------- roads
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      if (m.at(tx, ty) !== ROAD) continue;
      const X = tx * S, Y = ty * S;
      const r = m.rng(tx, ty, 0x202);
      g.save();
      g.beginPath();
      g.rect(X, Y, S, S);
      g.clip();
      // patches & cracks
      if (r() < 0.22) {
        const pw = (0.3 + r() * 0.5) * S, ph = (0.2 + r() * 0.4) * S;
        const px = X + r() * (S - pw * 0.5), py = Y + r() * (S - ph * 0.5);
        g.fillStyle = 'rgba(15,16,18,0.35)';
        g.fillRect(px, py, pw, ph);
        g.strokeStyle = 'rgba(90,90,90,0.18)';
        g.lineWidth = 0.8 * k;
        g.strokeRect(px, py, pw, ph);
      }
      if (r() < 0.6) crack(g, r, X + r() * S, Y + r() * S, (0.4 + r() * 0.7) * S, 0.8 * k, 0.5);
      if (r() < 0.05) {
        // pothole
        const cx = X + (0.25 + r() * 0.5) * S, cy = Y + (0.25 + r() * 0.5) * S;
        irregular(g, r, cx, cy, 0.13 * S, 7, 0.8);
        g.fillStyle = '#121314';
        g.fill();
        g.strokeStyle = 'rgba(110,105,95,0.4)';
        g.lineWidth = 1 * k;
        g.stroke();
      }
      const cls = roadClass(m, tx, ty);
      const [l, rr2, u, dd] = roadRuns(m, tx, ty);
      const paint = (x: number, y: number, w: number, h: number, col: string) => {
        // worn paint: skip random bits
        const pr = mulberry32(ihash(Math.floor(x), Math.floor(y), m.seed ^ 0x77));
        const horizontal = w > h;
        const len = horizontal ? w : h;
        const segN = Math.max(1, Math.round(len / (4 * k)));
        g.fillStyle = col;
        for (let i = 0; i < segN; i++) {
          if (pr() < 0.18) continue;
          const a = (i / segN) * len, b = ((i + 1) / segN) * len;
          if (horizontal) g.fillRect(x + a, y, b - a, h);
          else g.fillRect(x, y + a, w, b - a);
        }
      };
      const lw = 1.6 * k;
      const yel = 'rgba(196,160,72,0.55)';
      const wht = 'rgba(200,198,186,0.42)';
      if (cls === 'h') {
        const band = u + dd + 1;
        const cy = (ty - u + band / 2) * S;
        if (band >= 2) {
          // centre dashes (global phase)
          for (let dx = Math.floor(X / (S * 0.5)) * S * 0.5; dx < X + S; dx += S * 0.5) {
            if (Math.round(dx / (S * 0.5)) % 2 === 0) paint(dx + 0.05 * S, cy - lw / 2, S * 0.4, lw, yel);
          }
        }
        if (u === 0) paint(X, Y + 0.06 * S, S, lw * 0.8, wht);
        if (dd === 0) paint(X, Y + S - 0.06 * S - lw * 0.8, S, lw * 0.8, wht);
        // crosswalks next to intersections
        for (const side of [-1, 1]) {
          if (roadClass(m, tx + side, ty) === 'x') {
            const bx = side < 0 ? X + 0.08 * S : X + S - 0.48 * S;
            for (let sy = Y + 0.06 * S; sy < Y + S; sy += 0.2 * S) paint(bx, sy, 0.4 * S, 0.1 * S, wht);
          }
        }
      } else if (cls === 'v') {
        const band = l + rr2 + 1;
        const cx = (tx - l + band / 2) * S;
        if (band >= 2) {
          for (let dy = Math.floor(Y / (S * 0.5)) * S * 0.5; dy < Y + S; dy += S * 0.5) {
            if (Math.round(dy / (S * 0.5)) % 2 === 0) paint(cx - lw / 2, dy + 0.05 * S, lw, S * 0.4, yel);
          }
        }
        if (l === 0) paint(X + 0.06 * S, Y, lw * 0.8, S, wht);
        if (rr2 === 0) paint(X + S - 0.06 * S - lw * 0.8, Y, lw * 0.8, S, wht);
        for (const side of [-1, 1]) {
          if (roadClass(m, tx, ty + side) === 'x') {
            const by = side < 0 ? Y + 0.08 * S : Y + S - 0.48 * S;
            for (let sx = X + 0.06 * S; sx < X + S; sx += 0.2 * S) paint(sx, by, 0.1 * S, 0.4 * S, wht);
          }
        }
      }
      // oil drips in lane centres
      if (r() < 0.3) blob(g, X + r() * S, Y + r() * S, (0.1 + r() * 0.15) * S, 'rgba(5,5,6,0.3)');
      g.restore();
    }
  }

  // ---------------------------------------------------------------- water details
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      if (m.at(tx, ty) !== WATER) continue;
      const X = tx * S, Y = ty * S;
      const r = m.rng(tx, ty, 0x303);
      // sheen streaks
      for (let i = 0; i < 3; i++) {
        const sx = X + r() * S, sy = Y + r() * S, len = (0.25 + r() * 0.5) * S;
        g.beginPath();
        g.moveTo(sx, sy);
        g.quadraticCurveTo(sx + len * 0.5, sy - len * 0.12, sx + len, sy + len * 0.05);
        g.strokeStyle = `rgba(160,185,180,${0.05 + r() * 0.06})`;
        g.lineWidth = (0.8 + r()) * k;
        g.stroke();
      }
      if (r() < 0.12) {
        // oily iridescent film
        const cx = X + r() * S, cy = Y + r() * S, rad = (0.2 + r() * 0.3) * S;
        const gr = g.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad);
        gr.addColorStop(0, 'rgba(120,70,140,0.0)');
        gr.addColorStop(0.5, 'rgba(110,80,150,0.10)');
        gr.addColorStop(0.7, 'rgba(60,140,120,0.10)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
      if (r() < 0.06) {
        // floating plank / debris
        const cx = X + (0.2 + r() * 0.6) * S, cy = Y + (0.2 + r() * 0.6) * S;
        g.save();
        g.translate(cx, cy);
        g.rotate(r() * TAU);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(-0.18 * S + k, -0.03 * S + k, 0.36 * S, 0.06 * S);
        g.fillStyle = '#4d3d2a';
        g.fillRect(-0.18 * S, -0.03 * S, 0.36 * S, 0.06 * S);
        g.restore();
      }
    }
  }

  // ---------------------------------------------------------------- rubble
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      if (m.at(tx, ty) !== RUBBLE) continue;
      const X = tx * S, Y = ty * S;
      const r = m.rng(tx, ty, 0x404);
      // gravel
      for (let i = 0; i < 26; i++) {
        const gx = X + r() * S, gy = Y + r() * S;
        g.fillStyle = r() < 0.5 ? 'rgba(140,136,126,0.6)' : 'rgba(30,30,28,0.5)';
        g.fillRect(gx, gy, (0.6 + r() * 1.2) * k, (0.6 + r() * 1.2) * k);
      }
      // bricks
      for (let i = 0; i < 4; i++) {
        const bx = X + r() * S, by = Y + r() * S;
        g.save();
        g.translate(bx, by);
        g.rotate(r() * TAU);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(-1.5 * k + 0.8 * k, -0.8 * k + 0.8 * k, 3 * k, 1.6 * k);
        g.fillStyle = r() < 0.5 ? '#6c4436' : '#5a3a2e';
        g.fillRect(-1.5 * k, -0.8 * k, 3 * k, 1.6 * k);
        g.restore();
      }
      // concrete chunks
      const n = 4 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const cx = X + (0.1 + r() * 0.8) * S, cy = Y + (0.1 + r() * 0.8) * S;
        const v = Math.floor(r() * 30);
        chunk(g, r, cx, cy, (0.05 + r() * 0.11) * S, [92 + v, 90 + v, 84 + v], k);
      }
      // rebar
      if (r() < 0.7) {
        const sx = X + r() * S, sy = Y + r() * S;
        let a = r() * TAU;
        g.beginPath();
        g.moveTo(sx, sy);
        let px = sx, py = sy;
        for (let i = 0; i < 3; i++) {
          a += (r() - 0.5) * 1.2;
          px += Math.cos(a) * 0.15 * S;
          py += Math.sin(a) * 0.15 * S;
          g.lineTo(px, py);
        }
        g.strokeStyle = 'rgba(0,0,0,0.4)';
        g.lineWidth = 1.4 * k;
        g.save();
        g.translate(1 * k, 1.3 * k);
        g.stroke();
        g.restore();
        g.strokeStyle = '#7a4a2a';
        g.lineWidth = 1 * k;
        g.stroke();
      }
    }
  }

  // ---------------------------------------------------------------- park
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      if (m.at(tx, ty) !== PARK) continue;
      const X = tx * S, Y = ty * S;
      const r = m.rng(tx, ty, 0x505);
      // leaf litter
      for (let i = 0; i < 14; i++) {
        g.fillStyle = ['rgba(120,96,58,0.55)', 'rgba(70,60,36,0.5)', 'rgba(140,120,80,0.4)'][i % 3];
        g.beginPath();
        g.arc(X + r() * S, Y + r() * S, (0.5 + r() * 0.8) * k, 0, TAU);
        g.fill();
      }
      // grass tufts
      for (let i = 0; i < 5; i++) {
        const gx = X + r() * S, gy = Y + r() * S;
        for (let j = 0; j < 6; j++) {
          const a = -Math.PI / 2 + (r() - 0.5) * 2.2;
          g.beginPath();
          g.moveTo(gx, gy);
          g.lineTo(gx + Math.cos(a) * 3 * k, gy + Math.sin(a) * 3 * k);
          g.strokeStyle = r() < 0.5 ? 'rgba(150,134,84,0.7)' : 'rgba(96,88,52,0.7)';
          g.lineWidth = 0.7 * k;
          g.stroke();
        }
      }
      if (r() < 0.1) shrub(g, r, X + (0.2 + r() * 0.6) * S, Y + (0.2 + r() * 0.6) * S, (0.15 + r() * 0.12) * S, k);
    }
  }
  // trees in a separate pass so they overlap everything on the ground
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      if (m.at(tx, ty) !== PARK) continue;
      const r = m.rng(tx, ty, 0x606);
      if (r() < 0.2) {
        deadTree(g, r, (tx + 0.25 + r() * 0.5) * S, (ty + 0.25 + r() * 0.5) * S, (0.55 + r() * 0.5) * S, k);
      }
    }
  }

  // ---------------------------------------------------------------- ruins: cast shadows onto the ground
  const PAD = Math.ceil(6 * k);
  const sm = makeCanvas(W + PAD * 2, H + PAD * 2);
  const sg = ctxOf(sm);
  sg.translate(-x0 * ppt + PAD, -y0 * ppt + PAD);
  sg.fillStyle = '#000';
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      if (m.at(tx, ty) !== RUIN) continue;
      const id = buildingId(m, tx, ty);
      const L = buildingHeight(id) * S;
      const [a0, b0, a1, b1] = roofRect(m, tx, ty).map((v) => v * S);
      sg.beginPath();
      sg.moveTo(a0, b0);
      sg.lineTo(a1, b0);
      sg.lineTo(a1 + L, b0 + L);
      sg.lineTo(a1 + L, b1 + L);
      sg.lineTo(a0 + L, b1 + L);
      sg.lineTo(a0, b1);
      sg.closePath();
      sg.fill();
    }
  }
  // remove shadow over roofs (roofs are above the shadow)
  sg.globalCompositeOperation = 'destination-out';
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      if (m.at(tx, ty) !== RUIN) continue;
      const [a0, b0, a1, b1] = roofRect(m, tx, ty).map((v) => v * S);
      sg.fillRect(a0, b0, a1 - a0, b1 - b0);
    }
  }
  g.save();
  g.globalAlpha = 0.5;
  try { g.filter = `blur(${1.2 * k}px)`; } catch { /* unsupported */ }
  g.drawImage(sm, x0 * ppt - PAD, y0 * ppt - PAD);
  g.restore();

  // ---------------------------------------------------------------- ruins: roofs
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      if (m.at(tx, ty) !== RUIN) continue;
      const id = buildingId(m, tx, ty);
      const hgt = buildingHeight(id);
      const [a0, b0, a1, b1] = roofRect(m, tx, ty).map((v) => v * S);
      const r = m.rng(tx, ty, 0x707);
      g.save();
      g.beginPath();
      g.rect(a0, b0, a1 - a0, b1 - b0);
      g.clip();
      const X = tx * S, Y = ty * S;
      // neighbouring buildings: lower roofs get shade from taller N/W neighbours
      const nbr = (dx: number, dy: number) => {
        if (m.at(tx + dx, ty + dy) !== RUIN) return null;
        const nid = buildingId(m, tx + dx, ty + dy);
        return nid === id ? 'same' : buildingHeight(nid);
      };
      for (const [dx, dy] of [[-1, 0], [0, -1]] as const) {
        const n = nbr(dx, dy);
        if (typeof n === 'number' && n > hgt) {
          const L = Math.min(0.6, (n - hgt) * 1.4) * S;
          const gr = dx < 0 ? g.createLinearGradient(a0, 0, a0 + L, 0) : g.createLinearGradient(0, b0, 0, b0 + L);
          gr.addColorStop(0, 'rgba(0,0,0,0.5)');
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr;
          if (dx < 0) g.fillRect(a0, b0, L, b1 - b0);
          else g.fillRect(a0, b0, a1 - a0, L);
        }
      }
      // roof features
      const roll = r();
      const fx = X + (0.22 + r() * 0.3) * S, fy = Y + (0.22 + r() * 0.3) * S;
      if (roll < 0.13) {
        // collapsed hole
        const cx = X + (0.3 + r() * 0.4) * S, cy = Y + (0.3 + r() * 0.4) * S;
        const rad = (0.22 + r() * 0.16) * S;
        const seed = Math.floor(r() * 1e9);
        irregular(g, mulberry32(seed), cx, cy, rad, 9);
        const gr = g.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, 0, cx, cy, rad);
        gr.addColorStop(0, '#0b0b0b');
        gr.addColorStop(1, '#1b1a19');
        g.fillStyle = gr;
        g.fill();
        g.save();
        g.clip();
        // inner shadow from the top-left lip
        irregular(g, mulberry32(seed), cx + rad * 0.25, cy + rad * 0.25, rad, 9);
        g.fillStyle = 'rgba(40,38,34,0.0)';
        g.fill();
        for (let i = 0; i < 6; i++) chunk(g, r, cx + (r() - 0.3) * rad, cy + (r() - 0.3) * rad, rad * (0.12 + r() * 0.15), [58, 56, 52], k);
        g.restore();
        irregular(g, mulberry32(seed), cx, cy, rad, 9);
        g.strokeStyle = 'rgba(150,145,135,0.35)';
        g.lineWidth = 1.2 * k;
        g.stroke();
        // exposed beams
        for (let i = 0; i < 2; i++) {
          const yy = cy + (i - 0.5) * rad * 0.7;
          g.fillStyle = 'rgba(0,0,0,0.45)';
          g.fillRect(cx - rad * 1.05 + k, yy + k, rad * 2.1, 1.8 * k);
          g.fillStyle = '#5a4532';
          g.fillRect(cx - rad * 1.05, yy, rad * 2.1, 1.8 * k);
        }
      } else if (roll < 0.25) {
        // AC unit
        const w = (0.28 + r() * 0.1) * S, h = (0.2 + r() * 0.06) * S;
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.fillRect(fx + 2 * k, fy + 2.5 * k, w, h);
        g.fillStyle = '#6e6f6b';
        g.fillRect(fx, fy, w, h);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(fx, fy, w, 1 * k);
        g.beginPath();
        g.arc(fx + w * 0.7, fy + h / 2, h * 0.36, 0, TAU);
        g.fillStyle = '#2a2b2c';
        g.fill();
        g.strokeStyle = 'rgba(150,150,145,0.4)';
        g.lineWidth = 0.6 * k;
        g.stroke();
        for (let i = 0; i < 3; i++) {
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(fx + 1.5 * k, fy + (i + 1) * (h / 4), w * 0.4, 0.6 * k);
        }
      } else if (roll < 0.34) {
        // stairwell / elevator housing (tall box)
        const w = (0.36 + r() * 0.12) * S, h = (0.3 + r() * 0.12) * S;
        g.fillStyle = 'rgba(0,0,0,0.42)';
        g.beginPath();
        g.moveTo(fx + w, fy);
        g.lineTo(fx + w + 0.16 * S, fy + 0.16 * S);
        g.lineTo(fx + w + 0.16 * S, fy + h + 0.16 * S);
        g.lineTo(fx + 0.16 * S, fy + h + 0.16 * S);
        g.lineTo(fx, fy + h);
        g.closePath();
        g.fill();
        const rc = roofCol(id);
        g.fillStyle = `rgb(${rc[0] + 14},${rc[1] + 13},${rc[2] + 12})`;
        g.fillRect(fx, fy, w, h);
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.fillRect(fx, fy, w, 1.2 * k);
        g.fillRect(fx, fy, 1.2 * k, h);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(fx, fy + h - 1.2 * k, w, 1.2 * k);
        g.fillRect(fx + w - 1.2 * k, fy, 1.2 * k, h);
      } else if (roll < 0.42) {
        // vent stacks
        for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
          const vx = X + (0.2 + r() * 0.6) * S, vy = Y + (0.2 + r() * 0.6) * S, vr = (0.04 + r() * 0.04) * S;
          g.beginPath();
          g.arc(vx + 1.6 * k, vy + 2 * k, vr, 0, TAU);
          g.fillStyle = 'rgba(0,0,0,0.4)';
          g.fill();
          g.beginPath();
          g.arc(vx, vy, vr, 0, TAU);
          g.fillStyle = '#5c5d5b';
          g.fill();
          g.beginPath();
          g.arc(vx, vy, vr * 0.55, 0, TAU);
          g.fillStyle = '#1a1a1a';
          g.fill();
        }
      } else if (roll < 0.47) {
        // water tank on stilts
        const cx = X + 0.5 * S, cy = Y + 0.5 * S, rad = 0.26 * S;
        blob(g, cx + 0.25 * S, cy + 0.3 * S, rad * 1.2, 'rgba(0,0,0,0.55)');
        const gr = g.createRadialGradient(cx - rad * 0.4, cy - rad * 0.4, 0, cx, cy, rad);
        gr.addColorStop(0, '#7a6a55');
        gr.addColorStop(1, '#3e3328');
        g.beginPath();
        g.arc(cx, cy, rad, 0, TAU);
        g.fillStyle = gr;
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 1 * k;
        g.stroke();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
          g.strokeStyle = 'rgba(0,0,0,0.25)';
          g.lineWidth = 0.6 * k;
          g.stroke();
        }
      } else if (roll < 0.6) {
        // debris pile on the roof
        for (let i = 0; i < 4; i++) {
          chunk(g, r, X + (0.2 + r() * 0.6) * S, Y + (0.2 + r() * 0.6) * S, (0.05 + r() * 0.08) * S, [86, 84, 78], k);
        }
      } else if (roll < 0.66) {
        // broken skylight
        const w = 0.42 * S, h = 0.3 * S;
        g.fillStyle = '#1d282b';
        g.fillRect(fx, fy, w, h);
        g.strokeStyle = 'rgba(160,170,170,0.45)';
        g.lineWidth = 0.8 * k;
        g.strokeRect(fx, fy, w, h);
        g.beginPath();
        g.moveTo(fx + w / 2, fy);
        g.lineTo(fx + w / 2, fy + h);
        g.moveTo(fx, fy + h / 2);
        g.lineTo(fx + w, fy + h / 2);
        g.stroke();
        g.fillStyle = 'rgba(180,200,200,0.18)';
        g.beginPath();
        g.moveTo(fx, fy);
        g.lineTo(fx + w * 0.4, fy);
        g.lineTo(fx, fy + h * 0.5);
        g.fill();
      }
      // tar patches, cracks
      if (r() < 0.35) {
        g.fillStyle = 'rgba(15,15,15,0.18)';
        g.fillRect(X + r() * S * 0.6, Y + r() * S * 0.6, (0.2 + r() * 0.3) * S, (0.15 + r() * 0.25) * S);
      }
      if (r() < 0.45) crack(g, r, X + r() * S, Y + r() * S, 0.5 * S, 0.8 * k, 0.35);
      g.restore();

      // parapets on edges facing open ground or another building
      const edges: [number, number, number][] = [[0, -1, 0], [1, 0, 1], [0, 1, 2], [-1, 0, 3]];
      const pw = 0.075 * S;
      for (const [dx, dy, side] of edges) {
        const n = nbr(dx, dy);
        if (n === 'same') continue;
        // parapet top (lit on top/left facing edges, darker on bottom/right)
        const lit = side === 0 || side === 3;
        const rc = roofCol(id);
        const base = lit ? 34 : 4;
        g.fillStyle = `rgb(${rc[0] + base},${rc[1] + base},${rc[2] + base - 2})`;
        let ex = a0, ey = b0, ew = a1 - a0, eh = b1 - b0;
        if (side === 0) eh = pw;
        if (side === 2) { ey = b1 - pw; eh = pw; }
        if (side === 3) ew = pw;
        if (side === 1) { ex = a1 - pw; ew = pw; }
        g.fillRect(ex, ey, ew, eh);
        // inner shadow line of the parapet
        g.fillStyle = 'rgba(0,0,0,0.35)';
        if (side === 0) g.fillRect(ex, ey + pw, ew, 0.9 * k);
        if (side === 2) g.fillRect(ex, ey - 0.9 * k, ew, 0.9 * k);
        if (side === 3) g.fillRect(ex + pw, ey, 0.9 * k, eh);
        if (side === 1) g.fillRect(ex - 0.9 * k, ey, 0.9 * k, eh);
        // outer dark edge
        g.fillStyle = 'rgba(0,0,0,0.6)';
        if (side === 0) g.fillRect(ex, ey, ew, 0.8 * k);
        if (side === 2) g.fillRect(ex, ey + eh - 0.8 * k, ew, 0.8 * k);
        if (side === 3) g.fillRect(ex, ey, 0.8 * k, eh);
        if (side === 1) g.fillRect(ex + ew - 0.8 * k, ey, 0.8 * k, eh);
        // chipped parapet
        if (r() < 0.3) {
          const t = r();
          const gx = side % 2 === 0 ? ex + t * ew * 0.8 : ex;
          const gy = side % 2 === 0 ? ey : ey + t * eh * 0.8;
          g.fillStyle = `rgb(${rc[0] - 10},${rc[1] - 10},${rc[2] - 10})`;
          g.fillRect(gx, gy, side % 2 === 0 ? 0.15 * S : pw, side % 2 === 0 ? pw : 0.15 * S);
        }
      }
    }
  }
  g.restore();
  return c;
}

const MINI: Record<number, [number, number, number]> = {
  [GROUND]: [58, 58, 56],
  [ROAD]: [34, 35, 38],
  [RUBBLE]: [80, 76, 68],
  [WATER]: [20, 38, 42],
  [RUIN]: [96, 92, 84],
  [PARK]: [74, 72, 46],
};

/** 1 px per tile flat-colour minimap base. */
export function renderMinimapTerrain(map: TerrainMap): HTMLCanvasElement {
  const c = makeCanvas(map.w, map.h);
  const g = ctxOf(c);
  const img = g.createImageData(map.w, map.h);
  const d = img.data;
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.terrain[y * map.w + x];
      const col = MINI[t] ?? MINI[GROUND];
      const v = ((ihash(x, y, map.seed) & 15) - 7) * 0.6;
      const o = (y * map.w + x) * 4;
      d[o] = col[0] + v;
      d[o + 1] = col[1] + v;
      d[o + 2] = col[2] + v;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
