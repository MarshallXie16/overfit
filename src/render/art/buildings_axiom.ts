// AXIOM structures (monolithic graphite, crimson light strips, circuit inlays) + neutral Server Farm.
import { P, type TeamPal } from './palette';
import type { Layers } from './sprite';
import { acUnit, axiomSigil, bevel, cable, chamferRect, drum, fan, humanEmblem, lamp, regular, slab, vent } from './kit';
import {
  TAU, castShadow, circPath, glow, glowLine, grime, groove, light, limb, line, mix, mulberry32, polyPath, rgba, rivets,
  rrPath, vol, type G, type PathFn,
} from './util';

/** Circuit-trace inlay clipped to a path: dark grooves with faint emissive traces and vias. */
function circuit(g: G, e: G, clip: PathFn, bb: [number, number, number, number], seed: number, color: string, density = 1, glowA = 0.4): void {
  const r = mulberry32(seed);
  const [x, y, w, h] = bb;
  const step = 8;
  const n = Math.round(((w * h) / 700) * density);
  const traces: number[][] = [];
  for (let i = 0; i < n; i++) {
    let px = x + Math.round((r() * w) / step) * step;
    let py = y + Math.round((r() * h) / step) * step;
    const pts = [px, py];
    let dir = Math.floor(r() * 4) * (Math.PI / 2);
    const segs = 2 + Math.floor(r() * 3);
    for (let s = 0; s < segs; s++) {
      const len = step * (1 + Math.floor(r() * 3));
      px += Math.round(Math.cos(dir)) * len;
      py += Math.round(Math.sin(dir)) * len;
      pts.push(px, py);
      dir += (r() < 0.5 ? -1 : 1) * (Math.PI / 4);
      // keep to 45-degree steps
      const dx = Math.cos(dir), dy = Math.sin(dir);
      const l2 = step * (0.5 + Math.floor(r() * 2));
      px += Math.sign(Math.round(dx * 10)) * l2;
      py += Math.sign(Math.round(dy * 10)) * l2;
      pts.push(px, py);
      dir = Math.round(dir / (Math.PI / 2)) * (Math.PI / 2);
    }
    traces.push(pts);
  }
  for (const L of [g, e]) {
    L.save();
    clip(L);
    L.clip();
  }
  for (const pts of traces) {
    g.save();
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 2;
    g.stroke();
    g.strokeStyle = 'rgba(120,130,145,0.18)';
    g.lineWidth = 0.7;
    g.translate(0.6, 0.6);
    g.stroke();
    g.restore();
    const lit = r() < 0.55;
    if (lit) {
      e.save();
      e.globalCompositeOperation = 'lighter';
      e.beginPath();
      e.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) e.lineTo(pts[i], pts[i + 1]);
      e.strokeStyle = rgba(color, glowA);
      e.lineWidth = 0.8;
      e.lineJoin = 'round';
      e.stroke();
      e.restore();
    }
    // vias
    const ex = pts[pts.length - 2], ey = pts[pts.length - 1];
    g.beginPath();
    g.arc(ex, ey, 1.8, 0, TAU);
    g.fillStyle = '#0a0b0d';
    g.fill();
    g.strokeStyle = 'rgba(140,150,160,0.3)';
    g.lineWidth = 0.6;
    g.stroke();
    if (lit) light(e, ex, ey, 0.8, color, glowA * 1.6, 2.6);
  }
  g.restore();
  e.restore();
}

function edgeStrip(e: G, pts: number[], color: string, inset: number, a = 0.8, w = 1.2): void {
  // glowing strip along the polygon edges, slightly inset toward the centroid
  const n = pts.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
  cx /= n; cy /= n;
  const q: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    const d = Math.hypot(x - cx, y - cy) || 1;
    q.push(x - ((x - cx) / d) * inset, y - ((y - cy) / d) * inset);
  }
  q.push(q[0], q[1]);
  glowLine(e, q, color, w, a, 4);
}

function pyramid(L: Layers, x: number, y: number, r: number, pal: TeamPal, rot = 0): void {
  bevel(L.b, regular(4, r, rot, x, y), r * 0.92, P.ax3, { top: P.ax2, strength: 0.55 });
  light(L.e, x, y, r * 0.12 + 0.6, pal.glow, 0.95, 4);
}

function plinth(L: Layers, pts: number[], seed: number, pal: TeamPal): void {
  const { p, e } = L;
  const inner = bevel(p, pts, 5, '#1b1e23', { top: '#111317', strength: 0.5 });
  circuit(p, e, polyPath(inner), bboxOf(inner), seed, pal.glow, 0.7, 0.3);
  edgeStrip(e, inner, pal.glow, 3, 0.45, 0.8);
}

function bboxOf(pts: number[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

function hackTag(L: Layers, pal: TeamPal, x: number, y: number, s: number) {
  if (!pal.hacked) return;
  humanEmblem(L.b, x, y, s, 0.9);
  glow(L.e, x, y, s * 2, P.teal, 0.25);
}

// ============================================================================ Core (5x5)
export function drawCore(L: Layers, pal: TeamPal): void {
  const { b, e } = L;
  plinth(L, chamferRect(-156, -156, 312, 312, 48), 201, pal);
  // corner pylons
  for (const [x, y] of [[-118, -118], [118, -118], [-118, 118], [118, 118]]) {
    castShadow(L.p, polyPath(regular(4, 20, 0, x, y)), 10, 12, 0.5, 3);
    pyramid(L, x, y, 20, pal, 0);
  }
  // tier 1
  const t1 = regular(8, 132, TAU / 16);
  const t1i = bevel(b, t1, 12, '#262a31', { top: '#16181c', strength: 0.55 });
  circuit(b, e, polyPath(t1i), bboxOf(t1i), 202, pal.glow, 1.1, 0.45);
  // radial conduits
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const x0 = Math.cos(a) * 92, y0 = Math.sin(a) * 92, x1 = Math.cos(a) * 118, y1 = Math.sin(a) * 118;
    line(b, x0, y0, x1, y1, '#07080a', 5);
    glowLine(e, [x0, y0, x1, y1], i % 2 ? pal.glow2 : pal.glow, 1.3, 0.85, 4);
  }
  edgeStrip(e, t1i, pal.glow, 3, 0.55, 1);
  // tier 2 (casts shadow on tier 1)
  const t2 = regular(8, 94, 0);
  castShadow(b, polyPath(t2), 12, 15, 0.55, 4);
  const t2i = bevel(b, t2, 10, '#2c3139', { top: '#181b20', strength: 0.55 });
  circuit(b, e, polyPath(t2i), bboxOf(t2i), 203, pal.glow2, 1.2, 0.4);
  edgeStrip(e, t2i, pal.glow, 2.5, 0.7, 1.1);
  // tier 3
  const t3 = regular(8, 60, TAU / 16);
  castShadow(b, polyPath(t3), 9, 11, 0.55, 4);
  const t3i = bevel(b, t3, 8, '#323840', { top: '#121417', strength: 0.6 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    groove(b, [Math.cos(a) * 38, Math.sin(a) * 38, Math.cos(a) * 50, Math.sin(a) * 50], 0.7, 1.2);
  }
  void t3i;
  // the eye
  vol(b, circPath(0, 0, 36), '#07080a', [-36, -36, 72, 72], { radial: true, hi: 0.18, lo: 0.3, rim: 'rgba(200,210,230,0.3)' });
  glow(e, 0, 0, 110, pal.glow, 0.32);
  e.save();
  e.globalCompositeOperation = 'lighter';
  for (const [r, c, a, w] of [[31, pal.glow, 0.7, 1.4], [24, pal.glow2, 0.85, 1.2], [17, pal.glow, 0.9, 2]] as const) {
    e.beginPath();
    e.arc(0, 0, r, 0, TAU);
    e.strokeStyle = rgba(c, a);
    e.lineWidth = w;
    e.stroke();
  }
  e.restore();
  // iris segments
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    line(b, Math.cos(a) * 12, Math.sin(a) * 12, Math.cos(a) * 33, Math.sin(a) * 33, 'rgba(0,0,0,0.75)', 1.6);
  }
  light(e, 0, 0, 9, pal.glow, 1, 2.6);
  light(e, 0, 0, 4.5, pal.hot, 1, 2);
  // specular glint on the lens
  b.beginPath();
  b.ellipse(-12, -14, 9, 4, -0.7, 0, TAU);
  b.fillStyle = 'rgba(255,255,255,0.12)';
  b.fill();
}

// ============================================================================ Fabricator (3x3)
export function drawFabricator(L: Layers, pal: TeamPal): void {
  const { p, b, e } = L;
  plinth(L, chamferRect(-94, -94, 188, 188, 22), 211, pal);
  void p;
  const hull = chamferRect(-84, -80, 168, 160, 20);
  const top = bevel(b, hull, 9, '#272b32', { top: '#181a1f', strength: 0.55 });
  circuit(b, e, polyPath(top), bboxOf(top), 212, pal.glow, 0.6, 0.35);
  // vent fins (west)
  for (let i = 0; i < 7; i++) {
    const x = -70 + i * 6.5;
    vol(b, rrPath(x, -58, 4, 116, 1), '#2e333a', [x, -58, 4, 116], { hi: 0.35, lo: 0.5, rim: 'rgba(200,210,225,0.25)' });
    glowLine(e, [x + 5.2, -54, x + 5.2, 54], pal.glow, 0.8, 0.5, 3);
  }
  // assembly bay (east, open)
  const bay = rrPath(-8, -36, 94, 72, 3);
  b.save();
  bay(b);
  b.fillStyle = '#060708';
  b.fill();
  b.clip();
  for (let x = -4; x < 86; x += 7) {
    b.fillStyle = '#16181b';
    b.fillRect(x, -30, 4, 60);
    b.fillStyle = 'rgba(160,170,180,0.12)';
    b.fillRect(x, -30, 1, 60);
  }
  const ig = b.createLinearGradient(-8, -36, -8 + 20, -36 + 20);
  ig.addColorStop(0, 'rgba(0,0,0,0.7)');
  ig.addColorStop(1, 'rgba(0,0,0,0)');
  b.fillStyle = ig;
  b.fillRect(-8, -36, 94, 72);
  b.restore();
  glow(e, 36, 0, 60, pal.glow, 0.4);
  // half-built robot on the line
  limb(b, [36, 0, 52, -14], 2.4, P.ax3, { hi: 0.25 });
  limb(b, [36, 0, 52, 14], 2.4, P.ax3, { hi: 0.25 });
  limb(b, [30, 0, 18, -14], 2.4, P.ax3, { hi: 0.25 });
  vol(b, polyPath([46, 0, 38, -8, 24, -7, 20, 0, 24, 7, 38, 8]), P.ax2, [20, -8, 26, 16], { hi: 0.25 });
  glowLine(e, [24, 0, 42, 0], pal.glow, 0.9, 0.7, 3);
  // robotic arms reaching into the bay
  for (const s of [-1, 1]) {
    vol(b, circPath(6, s * 46, 7), P.ax3, [-1, s * 46 - 7, 14, 14], { radial: true, hi: 0.35 });
    limb(b, [6, s * 46, 22, s * 28, 34, s * 10], 4.2, P.ax4, { hi: 0.35 });
    vol(b, circPath(22, s * 28, 3.4), P.ax5, [18, s * 28 - 3.4, 7, 7], { radial: true, rim: null, ow: 0.8 });
    light(e, 35, s * 9, 1.6, s < 0 ? pal.hot : pal.glow2, 1, 3.5);
  }
  // bay rim lights
  glowLine(e, [-6, -38, 84, -38], pal.glow, 1.2, 0.8, 4);
  glowLine(e, [-6, 38, 84, 38], pal.glow, 1.2, 0.8, 4);
  // corner spikes
  for (const [x, y] of [[-66, -62], [66, -62], [-66, 62], [66, 62]]) pyramid(L, x, y, 10, pal, 0);
  axiomSigil(e, 40, -58, 9, pal.glow, 0.85);
  edgeStrip(e, top, pal.glow, 2, 0.5, 0.9);
  hackTag(L, pal, -48, 0, 10);
}

// ============================================================================ Relay (2x2)
export function drawRelay(L: Layers, pal: TeamPal): void {
  const { b, e } = L;
  plinth(L, regular(4, 62, 0), 221, pal);
  // emitter rings (painted on the plinth)
  e.save();
  e.globalCompositeOperation = 'lighter';
  e.setLineDash([6, 5]);
  e.beginPath();
  e.arc(0, 0, 42, 0, TAU);
  e.strokeStyle = rgba(pal.glow, 0.35);
  e.lineWidth = 1.2;
  e.stroke();
  e.setLineDash([]);
  e.restore();
  // fins to the vertices
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    b.save();
    b.rotate(a);
    bevel(b, [12, -7, 50, -2, 54, 0, 50, 2, 12, 7], 2.5, P.ax3, { top: P.ax2, strength: 0.55 });
    glowLine(e, [Math.cos(a) * 18, Math.sin(a) * 18, Math.cos(a) * 48, Math.sin(a) * 48], pal.glow, 0.9, 0.7, 3);
    b.restore();
    light(e, Math.cos(a) * 52, Math.sin(a) * 52, 1.4, pal.glow, 1, 3.5);
  }
  // spire (pyramid)
  bevel(b, regular(4, 30, TAU / 8), 28, '#2e333b', { top: P.ax2, strength: 0.6 });
  groove(b, regular(4, 18, TAU / 8).concat(regular(4, 18, TAU / 8).slice(0, 2)), 0.5, 1);
  glow(e, 0, 0, 40, pal.glow, 0.35);
  light(e, 0, 0, 4, pal.glow2, 1, 3);
  light(e, 0, 0, 2, pal.hot, 1, 2);
}

// ============================================================================ Vault (3x3)
export function drawVault(L: Layers, pal: TeamPal): void {
  const { b, e } = L;
  plinth(L, regular(6, 96, 0, 0, 0, 1, 0.98), 231, pal);
  const hex = regular(6, 82, 0);
  const top = bevel(b, hex, 10, '#2a2f37', { top: '#14161a', strength: 0.55 });
  // honeycomb data cells
  const r = mulberry32(232);
  const cr = 8.6;
  const dx = cr * 1.5;
  const dy = cr * Math.sqrt(3);
  b.save();
  polyPath(top)(b);
  b.clip();
  for (let i = -8; i <= 8; i++) {
    for (let j = -8; j <= 8; j++) {
      const x = i * dx;
      const y = j * dy + (i % 2 ? dy / 2 : 0);
      if (Math.hypot(x, y) > 62 || Math.hypot(x, y) < 24) continue;
      const cell = regular(6, cr - 1.2, 0, x, y);
      polyPath(cell)(b);
      b.fillStyle = '#0b0c0f';
      b.fill();
      b.strokeStyle = 'rgba(150,160,175,0.22)';
      b.lineWidth = 0.7;
      b.stroke();
      const v = r();
      if (v < 0.45) {
        e.save();
        e.globalCompositeOperation = 'lighter';
        polyPath(regular(6, cr - 3, 0, x, y))(e);
        e.fillStyle = rgba(v < 0.15 ? pal.glow : pal.glow2, 0.25 + v);
        e.fill();
        e.restore();
      }
    }
  }
  b.restore();
  edgeStrip(e, top, pal.glow2, 2.5, 0.7, 1);
  // corner pylons
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    pyramid(L, Math.cos(a) * 72, Math.sin(a) * 72, 8, pal, a);
  }
  // central data crystal
  castShadow(b, polyPath(regular(6, 22, TAU / 12)), 7, 9, 0.5, 3);
  bevel(b, regular(6, 22, TAU / 12), 10, mix(pal.glow2, '#000000', 0.55), { top: mix(pal.glow2, '#000000', 0.35), strength: 0.6 });
  glow(e, 0, 0, 56, pal.glow2, 0.45);
  light(e, 0, 0, 5, pal.glow2, 1, 2.5);
  light(e, -4, -4, 2, pal.hot, 0.9, 2);
}

// ============================================================================ Lancet (2x2) base + head
export function drawLancetBase(L: Layers, pal: TeamPal): void {
  const { b, e } = L;
  plinth(L, regular(6, 58, TAU / 12), 241, pal);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI / 2;
    b.save();
    b.rotate(a);
    bevel(b, [16, -12, 52, -4, 52, 4, 16, 12], 3, P.ax3, { top: P.ax2, strength: 0.55 });
    b.restore();
    glowLine(e, [Math.cos(a) * 22, Math.sin(a) * 22, Math.cos(a) * 48, Math.sin(a) * 48], pal.glow, 0.9, 0.7, 3);
  }
  bevel(b, regular(6, 30, 0), 6, '#2a2f36', { top: '#17191d', strength: 0.55 });
  b.beginPath();
  b.arc(0, 0, 18, 0, TAU);
  b.strokeStyle = 'rgba(0,0,0,0.6)';
  b.lineWidth = 2;
  b.stroke();
  glowLine(e, regular(6, 25, 0).concat(regular(6, 25, 0).slice(0, 2)), pal.glow, 0.7, 0.5, 3);
  hackTag(L, pal, -36, -30, 7);
}

export function drawLancetHead(L: Layers, pal: TeamPal): void {
  const { b, e } = L;
  // cooling fins at the rear
  for (let i = -2; i <= 2; i++) {
    vol(b, rrPath(-32, i * 4.6 - 1.2, 10, 2.4, 0.6), P.ax4, [-32, i * 4.6 - 1.2, 10, 2.4], { rim: null, ow: 0.6 });
  }
  const body = [-24, -10, 12, -12.5, 28, -6, 28, 6, 12, 12.5, -24, 10, -29, 0];
  bevel(b, body, 4, P.ax3, { top: P.ax2, strength: 0.6 });
  groove(b, [0, -10, 0, 10], 0.5, 1);
  // conduits
  for (const s of [-1, 1]) glowLine(e, [-18, s * 7.5, 22, s * 4.5], pal.glow, 0.9, 0.85, 3.5);
  // lens housing + lens
  vol(b, rrPath(25, -7.5, 13, 15, 2), P.ax2, [25, -7.5, 13, 15], { hi: 0.35, rim: 'rgba(200,210,225,0.35)' });
  for (const s of [-1, 1]) limb(b, [36, s * 6, 44, s * 3.5], 1.6, P.ax4, { hi: 0.4 });
  light(e, 39, 0, 3.2, pal.glow, 1, 3.4);
  light(e, 39, 0, 1.5, pal.hot, 1, 2);
  light(e, 44.5, 0, 1, pal.glow2, 0.8, 3);
  if (pal.hacked) {
    humanEmblem(b, -10, 0, 6, 0.95);
    glow(e, -10, 0, 12, P.teal, 0.2);
  }
}

// ============================================================================ Server Farm (3x3, neutral)
export function drawServerFarm(L: Layers, team: string): void {
  const { p, m, b, e } = L;
  const sc = team === 'human' ? P.teal : team === 'axiom' ? P.red : '#ffe9a8';
  slab(p, -92, -92, 184, 184, 251, { color: '#5c5b56', seam: 46, chamfer: 8 });
  // faded yellow lot lines
  p.save();
  p.globalAlpha = 0.3;
  p.fillStyle = '#c2a44e';
  for (let x = -80; x < 80; x += 20) p.fillRect(x, 74, 2, 16);
  p.restore();
  // backup diesel tanks
  for (const x of [-70, -40]) {
    vol(m, rrPath(x, 72, 24, 14, 7), '#6d6f6a', [x, 72, 24, 14], { hi: 0.4 });
  }
  drum(m, 70, 78, 5.5, '#4e5153');
  drum(m, 58, 82, 5.5, '#4e5153');
  // building
  const hull = chamferRect(-86, -84, 172, 150, 4);
  const top = bevel(b, hull, 5, '#81847f', { top: '#6b6e6a', strength: 0.4 });
  grime(b, polyPath(top), bboxOf(top), 252, 200, 0.1);
  for (let x = -60; x < 80; x += 43) groove(b, [x, -79, x, 61], 0.25, 0.8);
  // chiller units in two rows + cable trays
  for (const y of [-70, -24]) {
    vol(b, rrPath(-78, y + 32, 156, 5, 1), '#565a5c', [-78, y + 32, 156, 5], { rim: null, ow: 0.8 });
    for (let i = 0; i < 4; i++) {
      const x = -76 + i * 38;
      vol(b, rrPath(x, y, 32, 28, 2), '#9a9d98', [x, y, 32, 28], { hi: 0.3, lo: 0.4 });
      fan(b, x + 16, y + 14, 11, '#6e716e', i * 0.7);
      light(e, x + 29, y + 3, 0.9, sc, 0.9, 3);
    }
  }
  // roof access + uplink mast
  acUnit(b, -76, 22, 28, 18);
  vent(b, -40, 24, 34, 14, '#5a5d5a');
  vol(b, circPath(54, 36, 12), '#8a8d89', [42, 24, 24, 24], { radial: true, hi: 0.4 });
  cable(b, [42, 36, 20, 40, 4, 34], 1.4, '#2a2c2e');
  lamp(L, 54, 36, sc, 2.2, 1);
  // status LED strip along the south facade
  for (let i = 0; i < 14; i++) light(e, -78 + i * 12, 62, 1, sc, 0.95, 3);
  glowLine(e, [-80, 62, 80, 62], sc, 0.6, 0.35, 4);
  // corner beacons
  for (const [x, y] of [[-82, -80], [82, -80], [-82, 62], [82, 62]]) lamp(L, x, y, sc, 2.2, 1);
  if (team === 'human') humanEmblem(b, 20, 40, 10, 0.85);
  if (team === 'axiom') {
    axiomSigil(e, 20, 40, 11, P.red, 0.9);
    // creeping crimson traces over the roof
    circuit(b, e, polyPath(top), bboxOf(top), 253, P.red, 0.35, 0.5);
  }
  rivets(b, [-82, -80, 82, -80, -82, 62, 82, 62].map((v, i) => (i % 2 ? v + (v < 0 ? 4 : -4) : v + (v < 0 ? 4 : -4))), 1, '#999');
}

export const AXIOM_BUILDINGS: Record<string, { n: number; draw: (L: Layers, pal: TeamPal) => void }> = {
  core: { n: 5, draw: drawCore },
  fabricator: { n: 3, draw: drawFabricator },
  relay: { n: 2, draw: drawRelay },
  vault: { n: 3, draw: drawVault },
  lancet: { n: 2, draw: drawLancetBase },
};

