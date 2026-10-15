// Reusable building components (props, materials, emblems).
import { P } from './palette';
import type { Layers } from './sprite';
import {
  TAU, circPath, darken, ellPath, glow, glowLine, grime, groove, light, lighten, line, mix, mulberry32,
  polyPath, rgba, rivets, rrPath, vol, type BBox, type G, type PathFn,
} from './util';

const LX = -0.62;
const LY = -0.78; // light comes from top-left

/** Shade factor for a surface whose outward normal points at angle a. */
export function facing(a: number): number {
  return Math.cos(a) * LX + Math.sin(a) * LY; // -1..1
}

/**
 * Bevelled convex polygon: outer ring of faces shaded by orientation, inner top face.
 * pts = outer polygon (clockwise in screen space); inset = bevel width.
 */
export function bevel(g: G, pts: number[], inset: number, color: string, o: { top?: string; strength?: number; outline?: boolean; topPath?: (p: PathFn) => void } = {}): number[] {
  const n = pts.length / 2;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
  cx /= n; cy /= n;
  // inset each vertex along the bisector of adjacent edge normals
  const inner: number[] = [];
  for (let i = 0; i < n; i++) {
    const px = pts[((i - 1 + n) % n) * 2], py = pts[((i - 1 + n) % n) * 2 + 1];
    const x = pts[i * 2], y = pts[i * 2 + 1];
    const nx2 = pts[((i + 1) % n) * 2], ny2 = pts[((i + 1) % n) * 2 + 1];
    const e1x = x - px, e1y = y - py;
    const e2x = nx2 - x, e2y = ny2 - y;
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    // inward normals (for clockwise polygon in y-down space, inward = (-ey, ex)... verify by centroid)
    let n1x = -e1y / l1, n1y = e1x / l1;
    let n2x = -e2y / l2, n2y = e2x / l2;
    if ((cx - x) * n1x + (cy - y) * n1y < 0) { n1x = -n1x; n1y = -n1y; }
    if ((cx - x) * n2x + (cy - y) * n2y < 0) { n2x = -n2x; n2y = -n2y; }
    let bx = n1x + n2x, by = n1y + n2y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    const cosHalf = Math.max(0.35, bx * n1x + by * n1y);
    inner.push(x + (bx * inset) / cosHalf, y + (by * inset) / cosHalf);
  }
  const st = o.strength ?? 0.42;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], ay = pts[i * 2 + 1];
    const bx = pts[j * 2], by = pts[j * 2 + 1];
    // outward normal angle of this edge
    let nx = by - ay, ny = -(bx - ax);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const f = facing(Math.atan2(ny, nx));
    const c = f > 0 ? mix(color, '#ffffff', f * st) : mix(color, '#000000', -f * st * 1.25);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.lineTo(inner[j * 2], inner[j * 2 + 1]);
    g.lineTo(inner[i * 2], inner[i * 2 + 1]);
    g.closePath();
    g.fillStyle = c;
    g.fill();
    g.strokeStyle = c;
    g.lineWidth = 0.6;
    g.stroke();
  }
  const top = polyPath(inner);
  const bb: BBox = [Math.min(...inner.filter((_, k) => k % 2 === 0)), Math.min(...inner.filter((_, k) => k % 2 === 1)), 0, 0];
  bb[2] = Math.max(...inner.filter((_, k) => k % 2 === 0)) - bb[0];
  bb[3] = Math.max(...inner.filter((_, k) => k % 2 === 1)) - bb[1];
  vol(g, top, o.top ?? color, bb, { hi: 0.12, lo: 0.25, rim: 'rgba(255,255,255,0.12)', outline: 'rgba(0,0,0,0.35)', ow: 0.8 });
  if (o.outline !== false) {
    polyPath(pts)(g);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1;
    g.stroke();
  }
  return inner;
}

export function regular(n: number, r: number, rot = 0, cx = 0, cy = 0, sx = 1, sy = 1): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    pts.push(cx + Math.cos(a) * r * sx, cy + Math.sin(a) * r * sy);
  }
  return pts;
}

export function chamferRect(x: number, y: number, w: number, h: number, c: number): number[] {
  return [x + c, y, x + w - c, y, x + w, y + c, x + w, y + h - c, x + w - c, y + h, x + c, y + h, x, y + h - c, x, y + c];
}

// ----------------------------------------------------------- ground / materials

/** Concrete slab with seams, stains and cracks (pad layer). */
export function slab(g: G, x: number, y: number, w: number, h: number, seed: number, o: { color?: string; seam?: number; chamfer?: number; edge?: boolean } = {}): void {
  const color = o.color ?? '#5f5e58';
  const c = o.chamfer ?? 6;
  const path = polyPath(chamferRect(x, y, w, h, c));
  vol(g, path, color, [x, y, w, h], { hi: 0.08, lo: 0.18, rim: 'rgba(255,255,255,0.14)', outline: 'rgba(0,0,0,0.55)', ow: 1.2 });
  const r = mulberry32(seed);
  g.save();
  path(g);
  g.clip();
  // seams
  const s = o.seam ?? 32;
  if (s > 0) {
    for (let sx = x + s; sx < x + w - 2; sx += s) groove(g, [sx, y, sx, y + h], 0.25, 0.8);
    for (let sy = y + s; sy < y + h - 2; sy += s) groove(g, [x, sy, x + w, sy], 0.25, 0.8);
  }
  // stains
  for (let i = 0; i < Math.max(3, (w * h) / 1400); i++) {
    const px = x + r() * w, py = y + r() * h, rr = 3 + r() * 10;
    const gr = g.createRadialGradient(px, py, 0, px, py, rr);
    const dark = r() < 0.7;
    gr.addColorStop(0, dark ? 'rgba(15,13,10,0.22)' : 'rgba(200,190,170,0.08)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
  // cracks
  for (let i = 0; i < Math.max(1, (w * h) / 5000); i++) {
    let px = x + r() * w, py = y + r() * h;
    const pts = [px, py];
    let a = r() * TAU;
    for (let k = 0; k < 5; k++) {
      a += (r() - 0.5) * 1.2;
      px += Math.cos(a) * (3 + r() * 6);
      py += Math.sin(a) * (3 + r() * 6);
      pts.push(px, py);
    }
    groove(g, pts, 0.4, 0.7);
  }
  grime(g, path, [x, y, w, h], seed + 5, Math.round((w * h) / 60), 0.08, 0.35);
  g.restore();
}

/** Corrugated sheet: alternating light/dark ribs along an axis, clipped to path. */
export function corrugate(g: G, path: PathFn, bb: BBox, color: string, step = 4, vertical = true, o: { hi?: number; lo?: number } = {}): void {
  const [x, y, w, h] = bb;
  vol(g, path, color, bb, { hi: o.hi ?? 0.18, lo: o.lo ?? 0.35 });
  g.save();
  path(g);
  g.clip();
  if (vertical) {
    for (let px = x; px < x + w; px += step) {
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(px, y, step * 0.35, h);
      g.fillStyle = 'rgba(0,0,0,0.20)';
      g.fillRect(px + step * 0.55, y, step * 0.35, h);
    }
  } else {
    for (let py = y; py < y + h; py += step) {
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x, py, w, step * 0.35);
      g.fillStyle = 'rgba(0,0,0,0.20)';
      g.fillRect(x, py + step * 0.55, w, step * 0.35);
    }
  }
  g.restore();
}

/** Rust patches clipped to path. */
export function rust(g: G, path: PathFn, bb: BBox, seed: number, n = 4): void {
  const r = mulberry32(seed);
  const [x, y, w, h] = bb;
  g.save();
  path(g);
  g.clip();
  for (let i = 0; i < n; i++) {
    const px = x + r() * w, py = y + r() * h, rr = 3 + r() * 9;
    const gr = g.createRadialGradient(px, py, 0, px, py, rr);
    gr.addColorStop(0, 'rgba(120,62,30,0.45)');
    gr.addColorStop(0.6, 'rgba(100,52,25,0.2)');
    gr.addColorStop(1, 'rgba(90,45,20,0)');
    g.fillStyle = gr;
    g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
  g.restore();
}

// ----------------------------------------------------------------- props

export function sandbagLine(g: G, pts: number[], o: { bw?: number; bh?: number; rows?: number; color?: string; seed?: number } = {}): void {
  const bw = o.bw ?? 9.5;
  const bh = o.bh ?? 6;
  const rows = o.rows ?? 2;
  const r = mulberry32(o.seed ?? 7);
  const base = o.color ?? P.sand;
  for (let row = rows - 1; row >= 0; row--) {
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const a = Math.atan2(y1 - y0, x1 - x0);
      const nx = -Math.sin(a), ny = Math.cos(a);
      const off = (row - (rows - 1) / 2) * bh * 0.95;
      const shift = row % 2 ? bw / 2 : 0;
      for (let d = shift; d < len - 1; d += bw) {
        const t = (d + bw / 2) / len;
        const cx = x0 + (x1 - x0) * Math.min(t, 1) + nx * off;
        const cy = y0 + (y1 - y0) * Math.min(t, 1) + ny * off;
        const c = mix(base, r() < 0.5 ? '#6e6448' : '#9a8d68', r() * 0.5);
        g.save();
        g.translate(cx, cy);
        g.rotate(a + (r() - 0.5) * 0.12);
        const ww = Math.min(bw, len - d) + 0.8;
        vol(g, rrPath(-ww / 2, -bh / 2, ww, bh, bh * 0.45), c, [-ww / 2, -bh / 2, ww, bh], { hi: 0.3, lo: 0.4, rim: 'rgba(255,245,220,0.3)', ow: 0.9 });
        line(g, -ww / 2 + 2, 0.2, ww / 2 - 2, 0.2, 'rgba(0,0,0,0.12)', 0.6);
        g.restore();
      }
    }
  }
}

export function crate(g: G, x: number, y: number, w: number, h: number, o: { color?: string; rot?: number; lid?: boolean } = {}): void {
  const color = o.color ?? P.wood;
  g.save();
  g.translate(x + w / 2, y + h / 2);
  if (o.rot) g.rotate(o.rot);
  const px = -w / 2, py = -h / 2;
  vol(g, rrPath(px, py, w, h, 1.2), color, [px, py, w, h], { hi: 0.25, lo: 0.4 });
  g.save();
  rrPath(px, py, w, h, 1.2)(g);
  g.clip();
  const step = Math.max(3, h / 4);
  for (let yy = py + step; yy < py + h - 1; yy += step) line(g, px, yy, px + w, yy, 'rgba(0,0,0,0.3)', 0.7);
  g.restore();
  const fr = darken(color, 0.25);
  g.strokeStyle = fr;
  g.lineWidth = 1.6;
  g.strokeRect(px + 1.2, py + 1.2, w - 2.4, h - 2.4);
  line(g, px + 1.5, py + 1.5, px + w - 1.5, py + h - 1.5, fr, 1.4);
  rivets(g, [px + 1.4, py + 1.4, px + w - 1.4, py + 1.4, px + 1.4, py + h - 1.4, px + w - 1.4, py + h - 1.4], 0.6, '#999');
  g.restore();
}

export function ammoBox(g: G, x: number, y: number, w: number, h: number, color = '#4f5638'): void {
  vol(g, rrPath(x, y, w, h, 1), color, [x, y, w, h], { hi: 0.25 });
  line(g, x + w * 0.5, y + 1, x + w * 0.5, y + h - 1, 'rgba(0,0,0,0.4)', 0.8);
  g.fillStyle = 'rgba(230,200,120,0.6)';
  g.fillRect(x + 1.5, y + h / 2 - 0.6, w * 0.3, 1.2);
}

export function drum(g: G, x: number, y: number, r: number, color = '#5a4a36'): void {
  vol(g, circPath(x, y, r), color, [x - r, y - r, r * 2, r * 2], { radial: true, hi: 0.3, lo: 0.45 });
  g.beginPath();
  g.arc(x, y, r * 0.78, 0, TAU);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 0.8;
  g.stroke();
  g.beginPath();
  g.arc(x + r * 0.35, y - r * 0.3, r * 0.18, 0, TAU);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fill();
}

export function tyre(g: G, x: number, y: number, r: number): void {
  vol(g, circPath(x, y, r), '#1d1d1d', [x - r, y - r, r * 2, r * 2], { radial: true, hi: 0.18, lo: 0.3, rim: 'rgba(255,255,255,0.12)' });
  g.save();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    line(g, x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75, x + Math.cos(a) * r * 0.97, y + Math.sin(a) * r * 0.97, 'rgba(70,70,70,0.7)', 0.8);
  }
  g.restore();
  vol(g, circPath(x, y, r * 0.48), '#0b0b0b', [x - r / 2, y - r / 2, r, r], { radial: true, hi: 0.05, rim: null, outline: 'rgba(90,90,90,0.5)', ow: 0.8 });
}

/** Round fan grille housing. */
export function fan(g: G, x: number, y: number, r: number, housing = '#4a4e52', rot = 0.3): void {
  vol(g, circPath(x, y, r), housing, [x - r, y - r, r * 2, r * 2], { radial: true, hi: 0.3 });
  vol(g, circPath(x, y, r * 0.8), '#15171a', [x - r, y - r, r * 2, r * 2], { radial: true, hi: 0.08, lo: 0.2, rim: null, ow: 0.6 });
  g.save();
  circPath(x, y, r * 0.8)(g);
  g.clip();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i / 5) * TAU;
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, r * 0.75, a, a + 0.55);
    g.closePath();
    g.fillStyle = 'rgba(120,125,130,0.55)';
    g.fill();
  }
  for (let rr = r * 0.25; rr < r * 0.8; rr += r * 0.18) {
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.strokeStyle = 'rgba(160,165,170,0.35)';
    g.lineWidth = 0.6;
    g.stroke();
  }
  line(g, x - r * 0.8, y, x + r * 0.8, y, 'rgba(160,165,170,0.4)', 0.7);
  line(g, x, y - r * 0.8, x, y + r * 0.8, 'rgba(160,165,170,0.4)', 0.7);
  g.restore();
  vol(g, circPath(x, y, r * 0.18), '#666', [x - 2, y - 2, 4, 4], { radial: true, rim: null, ow: 0.5 });
}

/** Rooftop AC unit with a fan. */
export function acUnit(g: G, x: number, y: number, w: number, h: number, color = '#7b7d78'): void {
  vol(g, rrPath(x, y, w, h, 1.5), color, [x, y, w, h], { hi: 0.25, lo: 0.4 });
  const r = Math.min(w, h) * 0.36;
  fan(g, x + w - r - 2.5, y + h / 2, r, darken(color, 0.25));
  for (let i = 0; i < 4; i++) line(g, x + 2, y + 3 + i * ((h - 6) / 3), x + w - r * 2 - 5, y + 3 + i * ((h - 6) / 3), 'rgba(0,0,0,0.35)', 0.8);
}

export function vent(g: G, x: number, y: number, w: number, h: number, color = '#3a3d40', n = 0): void {
  vol(g, rrPath(x, y, w, h, 1), color, [x, y, w, h], { hi: 0.2, rim: null, ow: 0.9 });
  const k = n || Math.max(2, Math.floor(h / 3));
  for (let i = 0; i < k; i++) {
    const yy = y + ((i + 0.5) * h) / k;
    line(g, x + 1.5, yy, x + w - 1.5, yy, 'rgba(0,0,0,0.55)', 1);
    line(g, x + 1.5, yy + 0.8, x + w - 1.5, yy + 0.8, 'rgba(255,255,255,0.08)', 0.5);
  }
}

export function solar(g: G, x: number, y: number, w: number, h: number, broken = false): void {
  vol(g, rrPath(x, y, w, h, 1), '#1e2a33', [x, y, w, h], { hi: 0.35, lo: 0.3, rim: 'rgba(200,220,240,0.35)' });
  g.save();
  rrPath(x, y, w, h, 1)(g);
  g.clip();
  const cs = 4.5;
  for (let xx = x + cs; xx < x + w; xx += cs) line(g, xx, y, xx, y + h, 'rgba(140,160,180,0.3)', 0.5);
  for (let yy = y + cs; yy < y + h; yy += cs) line(g, x, yy, x + w, yy, 'rgba(140,160,180,0.3)', 0.5);
  const gr = g.createLinearGradient(x, y, x + w, y + h);
  gr.addColorStop(0, 'rgba(220,235,255,0.25)');
  gr.addColorStop(0.4, 'rgba(220,235,255,0)');
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  if (broken) {
    line(g, x + w * 0.6, y, x + w * 0.4, y + h * 0.6, 'rgba(230,240,250,0.5)', 0.6);
    line(g, x + w * 0.4, y + h * 0.6, x + w * 0.7, y + h, 'rgba(230,240,250,0.4)', 0.6);
  }
  g.restore();
}

/** Satellite dish seen from above, tilted toward angle `a`. */
export function dish(L: Layers, x: number, y: number, r: number, a = -2.3): void {
  const g = L.b;
  g.save();
  g.translate(x, y);
  g.rotate(a);
  vol(g, ellPath(0, 0, r * 0.62, r), '#9a9e9c', [-r * 0.6, -r, r * 1.2, r * 2], { radial: true, hi: 0.4, lo: 0.5 });
  vol(g, ellPath(r * 0.08, 0, r * 0.48, r * 0.84), '#c2c6c3', [-r * 0.5, -r * 0.8, r, r * 1.6], { radial: true, hi: 0.3, lo: 0.45, rim: null, outline: 'rgba(0,0,0,0.25)', ow: 0.6 });
  for (const s of [-1, 1]) line(g, r * 0.1, s * r * 0.75, r * 0.95, 0, 'rgba(40,40,40,0.8)', 0.9);
  line(g, r * 0.1, 0, r * 0.95, 0, 'rgba(40,40,40,0.8)', 0.9);
  vol(g, circPath(r * 0.95, 0, r * 0.13), P.gunD, [r * 0.8, -r * 0.13, r * 0.3, r * 0.3], { radial: true, rim: null, ow: 0.6 });
  g.restore();
}

export function lamp(L: Layers, x: number, y: number, color = P.amber, r = 1.6, a = 1): void {
  vol(L.b, circPath(x, y, r + 1.2), P.gunD, [x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2], { radial: true, rim: null, ow: 0.8 });
  light(L.e, x, y, r, color, a, 3.6);
}

/** Painted resistance emblem: teal ring with an upward spark-chevron. */
export function humanEmblem(g: G, x: number, y: number, r: number, a = 0.85): void {
  g.save();
  g.translate(x, y);
  g.globalAlpha = a;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.strokeStyle = P.teal;
  g.lineWidth = r * 0.16;
  g.stroke();
  g.beginPath();
  g.moveTo(-r * 0.55, r * 0.35);
  g.lineTo(0, -r * 0.45);
  g.lineTo(r * 0.55, r * 0.35);
  g.lineTo(r * 0.3, r * 0.35);
  g.lineTo(0, -r * 0.05);
  g.lineTo(-r * 0.3, r * 0.35);
  g.closePath();
  g.fillStyle = P.teal;
  g.fill();
  g.fillRect(-r * 0.08, r * 0.1, r * 0.16, r * 0.5);
  g.restore();
}

/** AXIOM sigil: inverted triangle with an eye. Draw on emissive layer for glow. */
export function axiomSigil(g: G, x: number, y: number, r: number, color: string, a = 1): void {
  g.save();
  g.translate(x, y);
  g.globalCompositeOperation = 'lighter';
  g.beginPath();
  g.moveTo(-r, -r * 0.62);
  g.lineTo(r, -r * 0.62);
  g.lineTo(0, r * 0.95);
  g.closePath();
  g.strokeStyle = rgba(color, 0.9 * a);
  g.lineWidth = r * 0.12;
  g.stroke();
  g.beginPath();
  g.ellipse(0, -r * 0.08, r * 0.38, r * 0.22, 0, 0, TAU);
  g.strokeStyle = rgba(color, 0.85 * a);
  g.lineWidth = r * 0.09;
  g.stroke();
  g.beginPath();
  g.arc(0, -r * 0.08, r * 0.1, 0, TAU);
  g.fillStyle = rgba(lighten(color, 0.6), a);
  g.fill();
  g.restore();
  glow(g, x, y, r * 1.6, color, 0.2 * a);
}

/** Thin cable along points. */
export function cable(g: G, pts: number[], w = 1.4, color = '#141414'): void {
  g.save();
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2, my = (pts[i + 1] + pts[i + 3]) / 2;
    g.quadraticCurveTo(pts[i], pts[i + 1], mx, my);
  }
  g.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = w + 1.2;
  g.lineCap = 'round';
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
  g.restore();
}

/** Fabric tarp with sag folds. */
export function tarp(g: G, pts: number[], color: string, seed: number, folds = 5): void {
  const path = polyPath(pts);
  const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
  const bb: BBox = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  vol(g, path, color, bb, { hi: 0.2, lo: 0.35 });
  const r = mulberry32(seed);
  g.save();
  path(g);
  g.clip();
  for (let i = 0; i < folds; i++) {
    const x = bb[0] + ((i + 0.5 + (r() - 0.5) * 0.5) / folds) * bb[2];
    const gr = g.createLinearGradient(x - 6, 0, x + 6, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.10)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0.18)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - 6, bb[1], 12, bb[3]);
  }
  grime(g, path, bb, seed + 3, Math.round((bb[2] * bb[3]) / 50), 0.08, 0.3);
  g.restore();
}

/** Tall pole/antenna with tip light. */
export function mast(L: Layers, x: number, y: number, tipColor = P.amber): void {
  vol(L.b, circPath(x, y, 3), P.gun, [x - 3, y - 3, 6, 6], { radial: true, hi: 0.35 });
  vol(L.b, circPath(x, y, 1.4), P.gunL, [x - 1.4, y - 1.4, 2.8, 2.8], { radial: true, rim: null, ow: 0.6 });
  light(L.e, x, y, 1.1, tipColor, 0.95, 3.4);
}

export function hazardStripe(g: G, x: number, y: number, w: number, h: number, a = 0.85, step = 5): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = `rgba(20,20,20,${a})`;
  g.fillRect(x, y, w, h);
  g.fillStyle = `rgba(214,152,52,${a})`;
  for (let i = -h - w; i < w + h; i += step * 2) {
    g.beginPath();
    g.moveTo(x + i, y + h);
    g.lineTo(x + i + step, y + h);
    g.lineTo(x + i + step + h, y);
    g.lineTo(x + i + h, y);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** Scrap bits (used for piles in depot / scrap fields). */
export function scrapBits(g: G, cx: number, cy: number, rad: number, seed: number, n = 18, e?: G): void {
  const r = mulberry32(seed);
  const cols = ['#5d5f61', '#6e4a2e', '#7b7a72', '#4a4c4f', '#8a5a34', '#545a4b', '#3c3e40'];
  for (let i = 0; i < n; i++) {
    const a = r() * TAU;
    const d = Math.sqrt(r()) * rad;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.9;
    const s = 2.2 + r() * 4.2;
    const rot = r() * TAU;
    const c = cols[Math.floor(r() * cols.length)];
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    const kind = r();
    if (kind < 0.45) {
      vol(g, polyPath([-s, -s * 0.5, s * 0.8, -s * 0.7, s, s * 0.4, -s * 0.6, s * 0.6]), c, [-s, -s, s * 2, s * 2], { hi: 0.35, lo: 0.4, ow: 0.8 });
    } else if (kind < 0.7) {
      // bar / girder piece
      vol(g, rrPath(-s * 1.4, -1.2, s * 2.8, 2.4, 0.5), c, [-s * 1.4, -1.2, s * 2.8, 2.4], { hi: 0.4, ow: 0.8 });
    } else if (kind < 0.85) {
      // pipe
      vol(g, rrPath(-s, -1.6, s * 2, 3.2, 1.6), c, [-s, -1.6, s * 2, 3.2], { hi: 0.45, ow: 0.8 });
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.beginPath();
      g.ellipse(s, 0, 0.7, 1.3, 0, 0, TAU);
      g.fill();
    } else {
      // gear / disc
      vol(g, circPath(0, 0, s * 0.7), c, [-s, -s, s * 2, s * 2], { radial: true, hi: 0.4, ow: 0.8 });
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.beginPath();
      g.arc(0, 0, s * 0.25, 0, TAU);
      g.fill();
    }
    g.restore();
    if (e && r() < 0.18) light(e, x - 0.5, y - 0.5, 0.5, '#fff4dc', 0.7, 3);
  }
}

export { glowLine };
