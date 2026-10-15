// Shared Canvas2D helpers for procedural art. No pixi, no DOM beyond <canvas>.

export type G = CanvasRenderingContext2D;
export type PathFn = (g: G) => void;
export type BBox = [number, number, number, number]; // x, y, w, h

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctxOf(c: HTMLCanvasElement): G {
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  return g;
}

// ---------------------------------------------------------------- random

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ihash(x: number, y: number, s: number): number {
  let h = (s | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hash01(x: number, y: number, s: number): number {
  return ihash(x, y, s) / 4294967296;
}

// ---------------------------------------------------------------- colour

type RGB = [number, number, number];
const colCache = new Map<string, RGB>();

export function parseCol(c: string): RGB {
  let v = colCache.get(c);
  if (v) return v;
  let s = c.trim();
  if (s[0] === '#') {
    s = s.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    const n = parseInt(s.slice(0, 6), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = s.match(/[\d.]+/g);
    v = m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
  }
  colCache.set(c, v);
  return v;
}

const h2 = (n: number) => {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return (v < 16 ? '0' : '') + v.toString(16);
};

export function rgba(c: string, a = 1): string {
  const [r, g, b] = parseCol(c);
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(a: string, b: string, t: number): string {
  const A = parseCol(a);
  const B = parseCol(b);
  return '#' + h2(A[0] + (B[0] - A[0]) * t) + h2(A[1] + (B[1] - A[1]) * t) + h2(A[2] + (B[2] - A[2]) * t);
}
export const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
export const darken = (c: string, t: number) => mix(c, '#000000', t);

// ---------------------------------------------------------------- paths

export function rrPath(x: number, y: number, w: number, h: number, r: number): PathFn {
  return (g) => {
    g.beginPath();
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  };
}

export function ellPath(cx: number, cy: number, rx: number, ry: number, rot = 0): PathFn {
  return (g) => {
    g.beginPath();
    g.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
  };
}

export function circPath(cx: number, cy: number, r: number): PathFn {
  return ellPath(cx, cy, r, r);
}

export function polyPath(pts: number[], close = true): PathFn {
  return (g) => {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    if (close) g.closePath();
  };
}

/** Polygon with every corner rounded by r. */
export function roundPolyPath(pts: number[], r: number): PathFn {
  return (g) => {
    const n = pts.length / 2;
    g.beginPath();
    const mx = (pts[0] + pts[(n - 1) * 2]) / 2;
    const my = (pts[1] + pts[(n - 1) * 2 + 1]) / 2;
    g.moveTo(mx, my);
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      const j = (i + 1) % n;
      g.arcTo(x, y, pts[j * 2], pts[j * 2 + 1], r);
    }
    g.closePath();
  };
}

export function bboxOf(pts: number[]): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Mirror a list of points across y=0 (pairs), returning [...pts, ...mirrored-reversed]. */
export function mirrorY(half: number[]): number[] {
  const out = half.slice();
  for (let i = half.length - 2; i >= 0; i -= 2) out.push(half[i], -half[i + 1]);
  return out;
}

// ---------------------------------------------------------------- shading

export const OUTLINE = 'rgba(6,8,10,0.92)';

export interface VolOpts {
  hi?: number; // top-left highlight strength 0..1
  lo?: number; // bottom-right darkening 0..1
  rim?: string | null; // rim-light colour (inner top-left edge)
  rimW?: number;
  edge?: number; // inner bottom-right edge darkness
  outline?: string | null;
  ow?: number;
  radial?: boolean; // dome shading instead of linear
}

/** Fill a shape with a top-left-lit volumetric look: base, gradient, rim light, inner shadow edge, outline. */
export function vol(g: G, path: PathFn, color: string, bb: BBox, o: VolOpts = {}): void {
  const [x, y, w, h] = bb;
  g.save();
  path(g);
  g.fillStyle = color;
  g.fill();
  g.clip();
  const hi = o.hi ?? 0.22;
  const lo = o.lo ?? 0.38;
  let gr: CanvasGradient;
  if (o.radial) {
    const r = Math.max(w, h) * 0.75;
    gr = g.createRadialGradient(x + w * 0.32, y + h * 0.3, 0, x + w * 0.45, y + h * 0.45, r);
    gr.addColorStop(0, `rgba(255,255,255,${hi * 1.3})`);
    gr.addColorStop(0.35, 'rgba(255,255,255,0)');
    gr.addColorStop(1, `rgba(0,0,0,${lo})`);
  } else {
    gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, `rgba(255,255,255,${hi})`);
    gr.addColorStop(0.45, 'rgba(255,255,255,0)');
    gr.addColorStop(1, `rgba(0,0,0,${lo})`);
  }
  g.fillStyle = gr;
  g.fillRect(x - 2, y - 2, w + 4, h + 4);
  if (o.rim !== null) {
    const d = o.rimW ?? 1.1;
    g.lineJoin = 'round';
    g.translate(d, d);
    path(g);
    g.strokeStyle = o.rim ?? 'rgba(255,255,255,0.32)';
    g.lineWidth = 1.4;
    g.stroke();
    g.translate(-2 * d, -2 * d);
    path(g);
    g.strokeStyle = `rgba(0,0,0,${o.edge ?? 0.35})`;
    g.lineWidth = 1.6;
    g.stroke();
  }
  g.restore();
  if (o.outline !== null) {
    path(g);
    g.lineJoin = 'round';
    g.strokeStyle = o.outline ?? OUTLINE;
    g.lineWidth = o.ow ?? 1.3;
    g.stroke();
  }
}

/** Simple flat fill + optional outline. */
export function flat(g: G, path: PathFn, color: string, outline: string | null = null, ow = 1): void {
  path(g);
  g.fillStyle = color;
  g.fill();
  if (outline) {
    g.strokeStyle = outline;
    g.lineWidth = ow;
    g.stroke();
  }
}

/** Thick outlined limb/tube along points with a highlight line. */
export function limb(g: G, pts: number[], w: number, color: string, o: { outline?: string | null; hi?: number; cap?: CanvasLineCap } = {}): void {
  g.save();
  g.lineCap = o.cap ?? 'round';
  g.lineJoin = 'round';
  const draw = () => {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  };
  if (o.outline !== null) {
    draw();
    g.strokeStyle = o.outline ?? OUTLINE;
    g.lineWidth = w + 2.2;
    g.stroke();
  }
  draw();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
  // shade lower-right half
  g.translate(w * 0.18, w * 0.18);
  draw();
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = w * 0.55;
  g.stroke();
  g.translate(-w * 0.36, -w * 0.36);
  draw();
  g.strokeStyle = `rgba(255,255,255,${o.hi ?? 0.28})`;
  g.lineWidth = Math.max(0.6, w * 0.3);
  g.stroke();
  g.restore();
}

export function line(g: G, x0: number, y0: number, x1: number, y1: number, color: string, w = 1, cap: CanvasLineCap = 'round'): void {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = cap;
  g.stroke();
}

export function polyline(g: G, pts: number[], color: string, w = 1, close = false): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  if (close) g.closePath();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.stroke();
}

/** Panel lines: dark groove with a light lip below-right (engraved look). */
export function groove(g: G, pts: number[], a = 0.55, w = 1): void {
  polyline(g, pts.map((v) => v + 0.7), `rgba(255,255,255,${a * 0.35})`, w * 0.8);
  polyline(g, pts, `rgba(0,0,0,${a})`, w);
}

export function rivet(g: G, x: number, y: number, r = 1.1, base = '#777'): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = darken(base, 0.45);
  g.fill();
  g.beginPath();
  g.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, Math.PI * 2);
  g.fillStyle = lighten(base, 0.35);
  g.fill();
}

export function rivets(g: G, pts: number[], r = 1.1, base = '#777'): void {
  for (let i = 0; i < pts.length; i += 2) rivet(g, pts[i], pts[i + 1], r, base);
}

/** Speckle/grime texture clipped to a path. */
export function grime(g: G, path: PathFn, bb: BBox, seed: number, n = 40, a = 0.12, light = 0.4): void {
  const r = mulberry32(seed);
  const [x, y, w, h] = bb;
  g.save();
  path(g);
  g.clip();
  for (let i = 0; i < n; i++) {
    const px = x + r() * w;
    const py = y + r() * h;
    const s = 0.4 + r() * 1.4;
    const isLight = r() < light;
    g.fillStyle = isLight ? `rgba(255,255,255,${a * 0.6 * r()})` : `rgba(0,0,0,${a * (0.5 + r())})`;
    if (r() < 0.3) {
      g.fillRect(px, py, s * (2 + r() * 4), 0.6);
    } else {
      g.beginPath();
      g.arc(px, py, s, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

/** Soft cast shadow of a shape onto what is already drawn in this layer (source-atop). */
export function castShadow(g: G, path: PathFn, dx: number, dy: number, a = 0.35, steps = 3): void {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    g.save();
    g.translate(dx * t, dy * t);
    path(g);
    g.fillStyle = `rgba(0,0,0,${(a / steps) * 1.15})`;
    g.fill();
    g.restore();
  }
  g.restore();
}

/** Current uniform scale of a context transform (shadows ignore transforms). */
export function gScale(g: G): number {
  const m = g.getTransform();
  return Math.hypot(m.a, m.b);
}

// ---------------------------------------------------------------- emissive

/** Additive radial glow. */
export function glow(g: G, x: number, y: number, r: number, color: string, a = 1): void {
  g.save();
  g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(color, a));
  gr.addColorStop(0.25, rgba(color, a * 0.55));
  gr.addColorStop(0.6, rgba(color, a * 0.15));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

/** Bright emissive dot: hot core + coloured halo. Draw on emissive layer. */
export function light(g: G, x: number, y: number, r: number, color: string, a = 1, halo = 3.2): void {
  glow(g, x, y, r * halo, color, 0.55 * a);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = rgba(color, 0.95 * a);
  g.fill();
  g.beginPath();
  g.arc(x - r * 0.15, y - r * 0.15, r * 0.5, 0, Math.PI * 2);
  g.fillStyle = rgba(mix(color, '#ffffff', 0.75), 0.9 * a);
  g.fill();
  g.restore();
}

/** Glowing line (seam, light strip, rail). Draw on emissive layer. */
export function glowLine(g: G, pts: number[], color: string, w = 1.2, a = 1, halo = 4): void {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const draw = () => {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  };
  draw();
  g.strokeStyle = rgba(color, 0.16 * a);
  g.lineWidth = w * halo;
  g.stroke();
  draw();
  g.strokeStyle = rgba(color, 0.3 * a);
  g.lineWidth = w * halo * 0.5;
  g.stroke();
  draw();
  g.strokeStyle = rgba(color, 0.95 * a);
  g.lineWidth = w;
  g.stroke();
  draw();
  g.strokeStyle = rgba(mix(color, '#ffffff', 0.7), 0.8 * a);
  g.lineWidth = w * 0.4;
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------- misc

export function hazard(g: G, path: PathFn, bb: BBox, c1: string, c2: string, step = 6, angle = Math.PI / 4): void {
  const [x, y, w, h] = bb;
  g.save();
  path(g);
  g.clip();
  g.fillStyle = c1;
  g.fillRect(x, y, w, h);
  g.translate(x + w / 2, y + h / 2);
  g.rotate(angle);
  const R = Math.hypot(w, h);
  g.fillStyle = c2;
  for (let i = -R; i < R; i += step * 2) g.fillRect(i, -R, step, R * 2);
  g.restore();
}

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
