// Human resistance buildings: improvised, sandbagged, olive/khaki with teal markings and amber lights.
import { P } from './palette';
import type { Layers } from './sprite';
import {
  acUnit, ammoBox, bevel, cable, chamferRect, corrugate, crate, dish, drum, fan, hazardStripe, humanEmblem, lamp,
  mast, regular, rust, sandbagLine, scrapBits, slab, solar, tarp, tyre, vent,
} from './kit';
import {
  TAU, circPath, castShadow, glow, glowLine, grime, groove, light, limb, line, mix, mulberry32,
  polyPath, rgba, rivets, rrPath, vol, type G,
} from './util';

function roofBlock(g: G, x: number, y: number, w: number, h: number, color: string, seed: number, rim = 4): number[] {
  const inner = bevel(g, chamferRect(x, y, w, h, 3), rim, mix(color, '#ffffff', 0.08), { top: color, strength: 0.38 });
  const bb: [number, number, number, number] = [x + rim, y + rim, w - rim * 2, h - rim * 2];
  grime(g, polyPath(inner), bb, seed, Math.round((w * h) / 45), 0.1, 0.3);
  return inner;
}

function paintLine(g: G, pts: number[], color: string, w: number, a = 0.6) {
  g.save();
  g.globalAlpha = a;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
  g.restore();
}

function helipad(g: G, x: number, y: number, r: number) {
  g.save();
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = 'rgba(30,32,30,0.55)';
  g.fill();
  g.globalAlpha = 0.7;
  g.beginPath();
  g.arc(x, y, r - 3, 0, TAU);
  g.strokeStyle = P.teal;
  g.lineWidth = 2;
  g.setLineDash([7, 4]);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(210,205,190,0.75)';
  const s = r * 0.42;
  g.fillRect(x - s * 0.6, y - s, s * 0.32, s * 2);
  g.fillRect(x + s * 0.28, y - s, s * 0.32, s * 2);
  g.fillRect(x - s * 0.3, y - s * 0.14, s * 0.6, s * 0.28);
  g.restore();
}

// ============================================================================ HQ (4x4)
export function drawHQ(L: Layers): void {
  const { p, m, b, e } = L;
  slab(p, -124, -124, 248, 248, 11, { color: '#5a5953', seam: 32, chamfer: 16 });
  paintLine(p, chamferRect(-116, -116, 232, 232, 12).concat([-104, -116]), P.amber, 2.2, 0.35);
  helipad(p, 84, 84, 30);
  // tyre tracks to the garage
  p.save();
  p.globalAlpha = 0.18;
  for (const dy of [-8, 8]) {
    p.beginPath();
    p.moveTo(124, -60 + dy);
    p.quadraticCurveTo(100, -60 + dy, 96, -40 + dy);
    p.strokeStyle = '#111';
    p.lineWidth = 6;
    p.stroke();
  }
  p.restore();

  // --- low stuff: sandbags, crates, drums, fuel bladders
  sandbagLine(m, [-118, 54, -118, 116, -60, 116], { seed: 1 });
  sandbagLine(m, [-24, 116, 40, 116], { seed: 2 });
  sandbagLine(m, [118, -118, 118, -96], { seed: 3, rows: 1 });
  crate(m, -104, 66, 16, 14);
  crate(m, -86, 68, 14, 12, { rot: 0.2 });
  crate(m, -100, 84, 15, 15, { rot: -0.1, color: P.oliveD });
  ammoBox(m, -80, 90, 14, 8);
  ammoBox(m, -80, 100, 14, 8);
  for (const [x, y] of [[-60, 90], [-50, 96], [-58, 102], [-46, 106]]) drum(m, x, y, 5.5, x % 4 ? '#5c4a35' : '#3f4a3c');
  // fuel bladders
  for (const y of [8, 30]) {
    vol(m, rrPath(84, y, 32, 16, 8), '#3e4132', [84, y, 32, 16], { hi: 0.35, lo: 0.4 });
    line(m, 88, y + 8, 112, y + 8, 'rgba(0,0,0,0.3)', 1);
  }

  // --- main block roof
  roofBlock(b, -106, -110, 178, 158, '#5f5d56', 21, 5);
  // roof clutter
  acUnit(b, -96, 18, 26, 16);
  acUnit(b, -64, 22, 22, 14);
  vent(b, 26, 18, 30, 12, '#3c3f40');
  solar(b, 30, -102, 34, 22);
  solar(b, 30, -76, 34, 22, true);
  for (const [x, y] of [[-98, -100], [-86, -100]]) {
    vol(b, circPath(x, y, 3.5), '#4b4c4a', [x - 3.5, y - 3.5, 7, 7], { radial: true });
    b.fillStyle = '#111';
    b.beginPath();
    b.arc(x, y, 1.8, 0, TAU);
    b.fill();
  }
  // tower casts a shadow over the lower roof
  const tower = polyPath(chamferRect(-74, -86, 96, 98, 6));
  castShadow(b, tower, 10, 12, 0.5, 4);
  roofBlock(b, -74, -86, 96, 98, '#6b6960', 22, 4);
  humanEmblem(b, -26, -37, 24, 0.8);
  // antenna mast & dish on the tower
  dish(L, 4, -70, 13, -2.4);
  mast(L, -62, -74, P.red);
  mast(L, -62, 0, P.amber);
  limb(b, [-62, -74, -40, -58], 0.8, P.gunL, { outline: null });
  // hatch
  vol(b, rrPath(-10, -10, 16, 14, 1.5), '#4f4e48', [-10, -10, 16, 14], { hi: 0.3 });
  rivets(b, [-8, -8, 4, -8, -8, 2, 4, 2], 0.8, '#777');
  // entrance canopy on the south side
  vol(b, rrPath(-46, 46, 52, 14, 2), P.olive, [-46, 46, 52, 14], { hi: 0.25 });
  hazardStripe(b, -46, 58, 52, 3, 0.8, 4);

  // --- garage tent (east)
  tarp(b, [72, -114, 120, -110, 122, -36, 72, -34], P.tarp, 31, 4);
  line(b, 96, -112, 97, -35, 'rgba(255,255,255,0.12)', 1.4);
  line(b, 98, -112, 99, -35, 'rgba(0,0,0,0.25)', 1.2);
  vol(b, rrPath(74, -40, 46, 5, 1.5), P.oliveD, [74, -40, 46, 5], { rim: null, ow: 0.8 });

  // --- lights
  lamp(L, -100, -104, P.amber, 1.8);
  lamp(L, 66, -104, P.amber, 1.8);
  lamp(L, -100, 42, P.amber, 1.8);
  lamp(L, -20, 54, '#fff1c8', 1.6);
  glowLine(e, [-40, 50, 0, 50], P.teal, 1, 0.6, 3);
}

// ============================================================================ Generator (2x2)
export function drawGenerator(L: Layers): void {
  const { p, m, b, e } = L;
  slab(p, -60, -60, 120, 120, 41, { color: '#56554f', seam: 0, chamfer: 8 });
  // oil stains on pad
  for (const [x, y, r] of [[-30, 40, 14], [30, 30, 10]]) {
    const gr = p.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(8,8,8,0.45)');
    gr.addColorStop(1, 'rgba(8,8,8,0)');
    p.fillStyle = gr;
    p.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // cables running off the pad
  cable(p, [36, -12, 50, -6, 58, 6, 66, 10], 2.2);
  cable(p, [36, -4, 46, 10, 50, 30, 66, 40], 1.8);
  // fuel tank (lying cylinder)
  vol(m, rrPath(-54, 24, 72, 22, 11), '#7a6f4f', [-54, 24, 72, 22], { hi: 0.42, lo: 0.45 });
  for (const x of [-38, -6]) {
    vol(m, rrPath(x, 23, 4, 24, 1), '#4e4733', [x, 23, 4, 24], { rim: null, ow: 0.8 });
  }
  vol(m, circPath(10, 30, 3.2), P.gunD, [7, 27, 6.4, 6.4], { radial: true, ow: 0.8 });
  rust(m, rrPath(-54, 24, 72, 22, 11), [-54, 24, 72, 22], 43, 5);
  hazardStripe(m, -50, 42, 20, 3, 0.75, 3);
  // generator housing
  const hx = -52, hy = -50, hw = 70, hh = 66;
  bevel(b, chamferRect(hx, hy, hw, hh, 5), 4, '#5f6646', { top: P.olive, strength: 0.4 });
  grime(b, rrPath(hx + 4, hy + 4, hw - 8, hh - 8, 3), [hx, hy, hw, hh], 44, 80, 0.12);
  groove(b, [hx + 4, hy + 30, hx + hw - 4, hy + 30], 0.35, 0.8);
  // radiator fan
  fan(b, -30, -28, 15, '#3e4433', 0.4);
  // exhaust stacks (tall: cast shadow on housing)
  for (const y of [-38, -20]) {
    castShadow(b, circPath(4, y, 6), 5, 6, 0.45, 3);
  }
  for (const y of [-38, -20]) {
    vol(b, circPath(4, y, 6), '#3a3633', [-2, y - 6, 12, 12], { radial: true, hi: 0.35 });
    b.beginPath();
    b.arc(4, y, 3.8, 0, TAU);
    b.fillStyle = '#0c0b0a';
    b.fill();
    glow(e, 4, y, 6, '#ff7a2a', 0.3);
    const gr = b.createRadialGradient(4, y, 4, 4, y, 13);
    gr.addColorStop(0, 'rgba(10,8,6,0.35)');
    gr.addColorStop(1, 'rgba(10,8,6,0)');
    b.fillStyle = gr;
    b.fillRect(-9, y - 13, 26, 26);
  }
  vent(b, -46, -4, 34, 14, '#424832');
  rivets(b, [hx + 5, hy + 5, hx + hw - 5, hy + 5, hx + 5, hy + hh - 5, hx + hw - 5, hy + hh - 5], 1, P.olive);
  // electrical cabinet
  bevel(b, chamferRect(24, -50, 32, 40, 2), 3, '#4b5158', { top: P.gun });
  b.fillStyle = rgba(P.teal, 0.85);
  b.beginPath();
  b.moveTo(42, -42); b.lineTo(34, -30); b.lineTo(40, -30); b.lineTo(36, -20); b.lineTo(46, -34); b.lineTo(40, -34); b.lineTo(44, -42);
  b.closePath();
  b.fill();
  // transformer coils
  for (const x of [28, 40, 52]) {
    vol(b, circPath(x, 0, 4.5), '#8a5a33', [x - 4.5, -4.5, 9, 9], { radial: true, hi: 0.4 });
    for (let r = 1.5; r < 4.5; r += 1.2) {
      b.beginPath();
      b.arc(x, 0, r, 0, TAU);
      b.strokeStyle = 'rgba(30,15,5,0.4)';
      b.lineWidth = 0.6;
      b.stroke();
    }
  }
  lamp(L, 50, -46, P.amber, 1.8);
  light(e, 28, -46, 0.9, '#7dff6a', 0.8, 3);
  glowLine(e, [-46, 13, -20, 13], P.amber, 0.8, 0.5, 3);
}

// ============================================================================ Habitat (2x2)
export function drawHabitat(L: Layers): void {
  const { p, m, b, e } = L;
  slab(p, -60, -60, 120, 120, 51, { color: '#57534a', seam: 0, chamfer: 8 });
  // tarp awning poles + crates
  crate(m, 30, 34, 14, 12);
  crate(m, 44, 38, 11, 11, { rot: 0.25, color: P.oliveD });
  drum(m, 50, 18, 5.5, '#40523f');
  // laundry / rope lines
  m.strokeStyle = 'rgba(200,190,160,0.5)';
  m.lineWidth = 0.7;
  m.beginPath();
  m.moveTo(-52, 52); m.quadraticCurveTo(-30, 56, -6, 52);
  m.stroke();
  for (const [x, c] of [[-44, '#6a5a40'], [-34, '#4b5868'], [-22, '#7a6f58'], [-14, '#5a4e3c']] as const) {
    vol(m, rrPath(x, 52.5, 6, 5, 1), c, [x, 52, 6, 5], { rim: null, ow: 0.6 });
  }
  // shipping container (corrugated roof)
  const cont = rrPath(-56, -50, 84, 44, 2);
  corrugate(b, cont, [-56, -50, 84, 44], '#55604a', 4.2, true);
  rust(b, cont, [-56, -50, 84, 44], 53, 6);
  vol(b, rrPath(-56, -50, 84, 44, 2), 'rgba(0,0,0,0)', [-56, -50, 84, 44], { hi: 0, lo: 0, rim: 'rgba(255,255,255,0.25)' });
  solar(b, -44, -44, 28, 18);
  // skylight hatch with warm light
  vol(b, rrPath(-6, -40, 14, 12, 1), '#2b2722', [-6, -40, 14, 12], { rim: null });
  e.save();
  e.globalCompositeOperation = 'lighter';
  e.fillStyle = 'rgba(255,190,100,0.55)';
  e.fillRect(-4.5, -38.5, 11, 9);
  e.restore();
  glow(e, 1, -34, 16, P.amber, 0.35);
  // tarp awning to the south
  tarp(b, [-58, -8, 28, -8, 32, 44, -60, 46], '#6d6650', 57, 5);
  line(b, -58, 19, 30, 18, 'rgba(255,255,255,0.12)', 1.2);
  line(b, -58, 20.5, 30, 19.5, 'rgba(0,0,0,0.25)', 1.2);
  // sewn patch + guy ropes
  b.save();
  b.translate(6, 30);
  b.rotate(0.12);
  vol(b, rrPath(-8, -6, 16, 12, 1), '#5c6648', [-8, -6, 16, 12], { hi: 0.25, rim: null, ow: 0.7 });
  b.setLineDash([1.6, 1.4]);
  b.strokeStyle = 'rgba(230,220,190,0.5)';
  b.lineWidth = 0.6;
  b.strokeRect(-6.5, -4.5, 13, 9);
  b.setLineDash([]);
  b.restore();
  for (const [x, y, sx, sy] of [[-58, 46, -62, 56], [32, 44, 40, 56], [-58, 19, -64, 22]]) {
    line(b, x, y, sx, sy, 'rgba(210,200,170,0.55)', 0.8);
    vol(b, circPath(sx, sy, 1.4), P.wood, [sx - 1.4, sy - 1.4, 2.8, 2.8], { radial: true, rim: null, ow: 0.5 });
  }
  for (const [x, y] of [[-58, 46], [32, 44]]) {
    vol(b, circPath(x, y, 2.2), P.wood, [x - 2, y - 2, 4, 4], { radial: true, ow: 0.7 });
  }
  // water tank
  vol(b, circPath(42, -20, 15), '#506066', [27, -35, 30, 30], { radial: true, hi: 0.35, lo: 0.45 });
  for (const r of [11, 6]) {
    b.beginPath();
    b.arc(42, -20, r, 0, TAU);
    b.strokeStyle = 'rgba(0,0,0,0.3)';
    b.lineWidth = 0.9;
    b.stroke();
  }
  vol(b, circPath(42, -20, 3.5), '#3a464a', [38, -24, 7, 7], { radial: true, ow: 0.7 });
  // stovepipe
  castShadow(b, circPath(14, -24, 3), 4, 5, 0.4, 2);
  vol(b, circPath(14, -24, 3), '#3a3532', [11, -27, 6, 6], { radial: true });
  b.fillStyle = '#0a0a0a';
  b.beginPath();
  b.arc(14, -24, 1.6, 0, TAU);
  b.fill();
  // teal door marking on container end
  b.fillStyle = rgba(P.teal, 0.85);
  b.fillRect(24, -40, 3, 24);
  humanEmblem(b, -14, 22, 9, 0.6);
  lamp(L, 26, -6, P.amber, 1.5);
}

// ============================================================================ Depot (2x2)
export function drawDepot(L: Layers): void {
  const { p, m, b, e } = L;
  slab(p, -60, -60, 120, 120, 61, { color: '#5d5b54', seam: 30, chamfer: 6 });
  hazardStripe(p, -58, -58, 116, 5, 0.6, 5);
  hazardStripe(p, -58, 53, 116, 5, 0.6, 5);
  // drop zone: teal arrows into the hopper
  p.save();
  p.globalAlpha = 0.7;
  p.fillStyle = P.teal;
  for (const x of [-34, -14]) {
    p.beginPath();
    p.moveTo(x - 6, 44); p.lineTo(x + 6, 44); p.lineTo(x + 6, 34); p.lineTo(x + 10, 34); p.lineTo(x, 24); p.lineTo(x - 10, 34); p.lineTo(x - 6, 34);
    p.closePath();
    p.fill();
  }
  p.restore();
  // pallets, crates
  for (const [x, y] of [[20, 24], [38, 24]]) {
    vol(m, rrPath(x, y, 16, 16, 1), '#7b6646', [x, y, 16, 16], { hi: 0.2 });
    for (let i = 0; i < 4; i++) line(m, x + 1, y + 2 + i * 4, x + 15, y + 2 + i * 4, 'rgba(0,0,0,0.35)', 1);
  }
  crate(m, 21, 25, 13, 13, { color: P.oliveD });
  crate(m, 39, 26, 12, 12, { rot: 0.15 });
  tyre(m, 48, 46, 6);
  tyre(m, 36, 48, 5.5);
  // forklift
  m.save();
  m.translate(-46, 34);
  m.rotate(-0.4);
  for (const s of [-1, 1]) line(m, 8, s * 4, 18, s * 4, '#2a2a2a', 2);
  vol(m, rrPath(-8, -7, 16, 14, 3), '#c68a2e', [-8, -7, 16, 14], { hi: 0.35 });
  vol(m, rrPath(-6, -5, 7, 10, 1.5), '#2b2b2b', [-6, -5, 7, 10], { rim: null, ow: 0.7 });
  m.restore();
  // scrap hopper (open bin with a pile inside)
  const hop = chamferRect(-54, -52, 64, 48, 4);
  bevel(b, hop, 5, '#4d5156', { top: '#2a2c2e', strength: 0.45 });
  b.save();
  polyPath([-49, -47, 5, -47, 5, -9, -49, -9])(b);
  b.clip();
  b.fillStyle = '#1b1c1d';
  b.fillRect(-50, -48, 56, 40);
  scrapBits(b, -22, -28, 22, 63, 34, e);
  // inner shadow from the top-left walls
  const gr = b.createLinearGradient(-49, -47, -40, -38);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  b.fillStyle = gr;
  b.fillRect(-50, -48, 56, 40);
  b.restore();
  rivets(b, [-52, -50, 8, -50, -52, -6, 8, -6], 1, '#888');
  b.fillStyle = rgba(P.teal, 0.85);
  b.fillRect(-48, -6, 18, 2.5);
  // office shed
  const shed = rrPath(18, -54, 40, 34, 1.5);
  corrugate(b, shed, [18, -54, 40, 34], '#7b7258', 3.6, false);
  rust(b, shed, [18, -54, 40, 34], 66, 4);
  vol(b, shed, 'rgba(0,0,0,0)', [18, -54, 40, 34], { hi: 0, lo: 0 });
  // crane arm over the hopper
  limb(b, [40, -12, 14, -24, -14, -30], 2.6, '#c08a35', { hi: 0.4 });
  vol(b, circPath(40, -12, 5), P.gun, [35, -17, 10, 10], { radial: true });
  vol(b, rrPath(-20, -34, 10, 8, 1.5), P.gunD, [-20, -34, 10, 8], { rim: null });
  lamp(L, 54, -16, P.amber, 1.6);
  lamp(L, -54, 2, P.amber, 1.6);
}

// ============================================================================ Barracks (3x3)
export function drawBarracks(L: Layers): void {
  const { p, m, b, e } = L;
  slab(p, -92, -92, 184, 184, 71, { color: '#58564f', seam: 0, chamfer: 10 });
  // gravel yard
  const r = mulberry32(72);
  for (let i = 0; i < 260; i++) {
    p.fillStyle = r() < 0.5 ? 'rgba(130,125,110,0.35)' : 'rgba(20,20,18,0.3)';
    p.fillRect(-90 + r() * 180, -90 + r() * 180, 1.2, 1.2);
  }
  // drill markings
  paintLine(p, [20, 62, 84, 62], 'rgba(220,215,200,1)', 1.5, 0.25);
  // sandbag entrance walls (east)
  sandbagLine(m, [70, -40, 84, -40, 84, -12], { seed: 4 });
  sandbagLine(m, [84, 12, 84, 40, 70, 40], { seed: 5 });
  sandbagLine(m, [-88, 58, -88, 86, -40, 86], { seed: 6 });
  ammoBox(m, 30, 62, 16, 9);
  ammoBox(m, 30, 74, 16, 9);
  crate(m, 50, 64, 16, 16, { color: P.oliveD });
  crate(m, 50, 82, 12, 8);
  // canvas tent (ridge along x)
  const tx0 = -78, ty0 = 44, tw = 84, th = 40;
  tarp(b, [tx0, ty0, tx0 + tw, ty0, tx0 + tw, ty0 + th / 2, tx0, ty0 + th / 2], '#7c7356', 73, 6);
  tarp(b, [tx0, ty0 + th / 2, tx0 + tw, ty0 + th / 2, tx0 + tw, ty0 + th, tx0, ty0 + th], '#5d5640', 74, 6);
  line(b, tx0, ty0 + th / 2, tx0 + tw, ty0 + th / 2, 'rgba(255,240,210,0.3)', 1.2);
  for (const x of [tx0 + 2, tx0 + tw - 2]) vol(b, circPath(x, ty0 + th / 2, 2.2), P.wood, [x - 2, ty0 + 18, 4, 4], { radial: true, ow: 0.7 });
  // quonset hut: half cylinder along x (lit north face, shaded south face)
  const hx = -86, hy = -64, hw = 150, hh = 92;
  b.save();
  rrPath(hx, hy, hw, hh, 4)(b);
  const gr = b.createLinearGradient(0, hy, 0, hy + hh);
  gr.addColorStop(0, '#5a6046');
  gr.addColorStop(0.18, '#7d8560');
  gr.addColorStop(0.42, '#6b7351');
  gr.addColorStop(0.75, '#4a5037');
  gr.addColorStop(1, '#30331f');
  b.fillStyle = gr;
  b.fill();
  b.clip();
  for (let x = hx + 4; x < hx + hw; x += 4.5) {
    b.fillStyle = 'rgba(0,0,0,0.16)';
    b.fillRect(x + 2.2, hy, 1.6, hh);
    b.fillStyle = 'rgba(255,255,255,0.06)';
    b.fillRect(x, hy, 1.2, hh);
  }
  for (let x = hx + 18; x < hx + hw - 4; x += 22) {
    b.fillStyle = 'rgba(0,0,0,0.35)';
    b.fillRect(x, hy, 2, hh);
    b.fillStyle = 'rgba(255,255,255,0.12)';
    b.fillRect(x - 1, hy, 1, hh);
  }
  rust(b, rrPath(hx, hy, hw, hh, 4), [hx, hy, hw, hh], 75, 8);
  b.restore();
  rrPath(hx, hy, hw, hh, 4)(b);
  b.strokeStyle = 'rgba(6,8,10,0.9)';
  b.lineWidth = 1.4;
  b.stroke();
  humanEmblem(b, -16, -18, 22, 0.75);
  // vents along ridge
  for (const x of [-64, 32]) {
    castShadow(b, circPath(x, -30, 4.5), 4, 5, 0.4, 2);
    vol(b, circPath(x, -30, 4.5), '#4a4c46', [x - 4.5, -34.5, 9, 9], { radial: true, hi: 0.4 });
    b.fillStyle = '#121212';
    b.beginPath();
    b.arc(x, -30, 2.2, 0, TAU);
    b.fill();
  }
  // east end wall + door
  bevel(b, chamferRect(62, -26, 12, 52, 2), 2.5, P.oliveD, { top: '#3f4430' });
  vol(b, rrPath(72, -14, 6, 28, 1), '#2c2a26', [72, -14, 6, 28], { rim: null });
  hazardStripe(b, 74, -14, 3, 28, 0.8, 3);
  // flagpole + teal flag
  mast(L, 74, -76, P.amber);
  b.save();
  b.beginPath();
  b.moveTo(75, -76);
  b.bezierCurveTo(82, -80, 88, -72, 96, -77);
  b.lineTo(96, -64);
  b.bezierCurveTo(88, -60, 82, -68, 75, -64);
  b.closePath();
  b.fillStyle = P.tealD;
  b.fill();
  b.strokeStyle = 'rgba(6,8,10,0.9)';
  b.lineWidth = 1;
  b.stroke();
  b.restore();
  humanEmblem(b, 86, -70, 4.6, 0.95);
  lamp(L, 78, -20, P.amber, 1.6);
  lamp(L, 78, 20, P.amber, 1.6);
  lamp(L, -84, -62, P.amber, 1.4);
  glowLine(e, [65, -22, 65, 22], P.teal, 0.8, 0.45, 3);
}

// ============================================================================ Factory (3x3)
export function drawFactory(L: Layers): void {
  const { p, m, b, e } = L;
  slab(p, -92, -92, 184, 184, 81, { color: '#5b5a54', seam: 46, chamfer: 10 });
  // apron + chevrons in front of the bay (east)
  p.save();
  p.globalAlpha = 0.5;
  for (let i = 0; i < 3; i++) {
    p.beginPath();
    const x = 66 + i * 8;
    p.moveTo(x, -26); p.lineTo(x + 6, 0); p.lineTo(x, 26);
    p.strokeStyle = P.amber;
    p.lineWidth = 3;
    p.stroke();
  }
  p.restore();
  // tyre tracks
  p.save();
  p.globalAlpha = 0.22;
  for (const dy of [-14, 14]) {
    p.beginPath();
    p.moveTo(60, dy);
    p.lineTo(92, dy + (dy > 0 ? 6 : -6));
    p.strokeStyle = '#0c0c0c';
    p.lineWidth = 7;
    p.stroke();
  }
  p.restore();
  // drums and tyre stacks
  for (const [x, y] of [[-80, 66], [-70, 72], [-80, 80], [-68, 84]]) drum(m, x, y, 5.5);
  for (const [x, y] of [[-48, 74], [-34, 80]]) tyre(m, x, y, 7);
  crate(m, 64, -82, 18, 14, { color: P.oliveD });
  crate(m, 64, 66, 16, 16);
  // main hall with sawtooth roof
  const hx = -86, hy = -72, hw = 148, hh = 128;
  bevel(b, chamferRect(hx, hy, hw, hh, 4), 4, '#5f5f58', { top: '#4f4f49' });
  b.save();
  rrPath(hx + 4, hy + 4, hw - 8, hh - 8, 2)(b);
  b.clip();
  const step = 20;
  for (let x = hx + 4; x < hx + hw - 4; x += step) {
    const gr = b.createLinearGradient(x, 0, x + step, 0);
    gr.addColorStop(0, '#6a6a62');
    gr.addColorStop(0.62, '#4d4d47');
    gr.addColorStop(0.64, '#1f2a2c');
    gr.addColorStop(1, '#2c3a3d');
    b.fillStyle = gr;
    b.fillRect(x, hy, step, hh);
    // skylight glazing bars
    for (let y = hy + 8; y < hy + hh; y += 10) {
      b.fillStyle = 'rgba(150,170,170,0.25)';
      b.fillRect(x + step * 0.64, y, step * 0.36, 0.8);
    }
    b.fillStyle = 'rgba(0,0,0,0.45)';
    b.fillRect(x + step - 1, hy, 1, hh);
  }
  grime(b, rrPath(hx, hy, hw, hh, 2), [hx, hy, hw, hh], 82, 220, 0.12);
  b.restore();
  // a few broken skylight panes leak warm light
  e.save();
  e.globalCompositeOperation = 'lighter';
  for (const [x, y] of [[-29, -40], [11, 10], [-49, 30]]) {
    e.fillStyle = 'rgba(255,170,80,0.28)';
    e.fillRect(x, y, 7, 9);
  }
  e.restore();
  // roof duct + stacks
  vol(b, rrPath(hx + 8, hy + 6, 10, 112, 4), '#6f716c', [hx + 8, hy + 6, 10, 112], { hi: 0.35 });
  for (let y = hy + 14; y < hy + 118; y += 14) line(b, hx + 8, y, hx + 18, y, 'rgba(0,0,0,0.35)', 1);
  for (const [x, y] of [[-64, -58], [-50, -58]]) {
    castShadow(b, circPath(x, y, 6), 7, 9, 0.45, 3);
  }
  for (const [x, y] of [[-64, -58], [-50, -58]]) {
    vol(b, circPath(x, y, 6), '#463f38', [x - 6, y - 6, 12, 12], { radial: true, hi: 0.35 });
    b.fillStyle = '#0b0a09';
    b.beginPath();
    b.arc(x, y, 3.8, 0, TAU);
    b.fill();
  }
  // bay door structure (east)
  bevel(b, chamferRect(56, -34, 18, 68, 2), 3, '#50563c', { top: P.olive });
  vol(b, rrPath(70, -28, 6, 56, 1), '#2a2a26', [70, -28, 6, 56], { rim: null });
  hazardStripe(b, 72, -28, 4, 56, 0.85, 3.5);
  b.fillStyle = rgba(P.teal, 0.85);
  b.fillRect(hx + 4, hy + hh - 10, hw - 8, 3);
  humanEmblem(b, 30, -46, 13, 0.7);
  // gantry crane over the yard (NE)
  for (const y of [-88, -56]) limb(b, [58, y, 90, y], 3, '#c39236', { hi: 0.4 });
  vol(b, rrPath(70, -90, 8, 36, 1), '#a07428', [70, -90, 8, 36], { hi: 0.3 });
  limb(b, [74, -72, 74, -66], 0.8, '#222', { outline: null });
  lamp(L, 78, -40, P.amber, 1.8);
  lamp(L, 78, 40, P.amber, 1.8);
  lamp(L, -84, 58, P.amber, 1.4);
}

// ============================================================================ Lab (3x3)
export function drawLab(L: Layers): void {
  const { p, m, b, e } = L;
  slab(p, -92, -92, 184, 184, 91, { color: '#625f58', seam: 23, chamfer: 10 });
  // cooling units & nitrogen tank (low)
  for (const x of [-70, -46, -22]) {
    vol(m, rrPath(x, 62, 20, 20, 2), '#6e7372', [x, 62, 20, 20], { hi: 0.3 });
    fan(m, x + 10, 72, 7.5, '#4b5050');
  }
  // main building
  bevel(b, chamferRect(-84, -80, 148, 134, 10), 5, '#858a86', { top: '#737875', strength: 0.4 });
  grime(b, rrPath(-79, -75, 138, 124, 6), [-84, -80, 148, 134], 92, 160, 0.09);
  // panel seams
  for (let x = -60; x < 60; x += 24) groove(b, [x, -75, x, 49], 0.25, 0.8);
  // glass atrium with server rows glowing beneath
  const ax = -56, ay = -52, aw = 72, ah = 64;
  vol(b, rrPath(ax, ay, aw, ah, 3), '#1b2a2e', [ax, ay, aw, ah], { hi: 0.25, lo: 0.3, rim: 'rgba(200,240,240,0.35)' });
  b.save();
  rrPath(ax, ay, aw, ah, 3)(b);
  b.clip();
  for (let i = 0; i < 4; i++) {
    b.fillStyle = '#0d1517';
    b.fillRect(ax + 6, ay + 7 + i * 15, aw - 12, 8);
  }
  for (let x = ax; x <= ax + aw; x += 12) line(b, x, ay, x, ay + ah, 'rgba(170,190,190,0.45)', 1);
  for (let y = ay; y <= ay + ah; y += 16) line(b, ax, y, ax + aw, y, 'rgba(170,190,190,0.45)', 1);
  const gl = b.createLinearGradient(ax, ay, ax + aw * 0.6, ay + ah * 0.6);
  gl.addColorStop(0, 'rgba(220,250,255,0.22)');
  gl.addColorStop(0.5, 'rgba(220,250,255,0)');
  b.fillStyle = gl;
  b.fillRect(ax, ay, aw, ah);
  b.restore();
  e.save();
  e.globalCompositeOperation = 'lighter';
  const r = mulberry32(93);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 9; j++) {
      if (r() < 0.35) continue;
      e.fillStyle = r() < 0.75 ? rgba(P.teal, 0.7) : rgba(P.amber, 0.7);
      e.fillRect(ax + 9 + j * 6.4, ay + 10 + i * 15, 2.2, 2);
    }
  }
  e.restore();
  glow(e, ax + aw / 2, ay + ah / 2, 50, P.teal, 0.22);
  // satellite dish & radome
  dish(L, 40, -50, 19, -2.2);
  vol(b, circPath(38, 24, 12), '#c9cbc6', [26, 12, 24, 24], { radial: true, hi: 0.45, lo: 0.45 });
  groove(b, [28, 24, 48, 24], 0.2, 0.7);
  groove(b, [38, 13, 38, 35], 0.2, 0.7);
  // antenna masts
  mast(L, -72, -68, P.red);
  mast(L, 54, 40, P.amber);
  // solar strip on the west wing
  solar(b, -78, 22, 40, 22);
  // teal light strip along facade
  glowLine(e, [-78, 50, 58, 50], P.teal, 1.1, 0.75, 3.5);
  glowLine(e, [60, -74, 60, 44], P.teal, 0.8, 0.4, 3);
  // nitrogen tank
  vol(b, circPath(76, 70, 11), '#d6d9d6', [65, 59, 22, 22], { radial: true, hi: 0.5, lo: 0.45 });
  vol(b, circPath(76, 70, 4), '#a8adab', [72, 66, 8, 8], { radial: true, ow: 0.7 });
  cable(b, [66, 70, 50, 62, 40, 54], 1.6, '#8a8f8e');
  humanEmblem(b, 12, -66, 7, 0.85);
  lamp(L, -80, 48, P.amber, 1.4);
}

// ============================================================================ Wall (1x1, mask)
const WALL_HW = 12;
function wallBag(g: G, x: number, y: number, w: number, h: number, c: string) {
  vol(g, rrPath(x - w / 2, y - h / 2, w, h, h * 0.45), c, [x - w / 2, y - h / 2, w, h], { hi: 0.32, lo: 0.42, rim: 'rgba(255,245,220,0.3)', ow: 0.9 });
}
export function drawWall(L: Layers, mask: number): void {
  const { b } = L;
  const arm = (dir: number) => {
    // dir 0=N,1=E,2=S,3=W: concrete footing + sandbag cap, running from the post to the tile edge (+1 px overlap)
    b.save();
    b.rotate((dir - 1) * (Math.PI / 2));
    const x0 = 8, x1 = 33, hw = WALL_HW;
    const gr = b.createLinearGradient(0, -hw, 0, hw);
    gr.addColorStop(0, '#8e8b82');
    gr.addColorStop(0.25, '#77746b');
    gr.addColorStop(0.75, '#5d5b55');
    gr.addColorStop(1, '#45433f');
    b.fillStyle = gr;
    b.fillRect(x0, -hw, x1 - x0, hw * 2);
    b.fillStyle = 'rgba(0,0,0,0.4)';
    b.fillRect(31.4, -hw, 1.2, hw * 2);
    b.fillStyle = 'rgba(6,8,10,0.9)';
    b.fillRect(x0, -hw - 1.3, x1 - x0, 1.3);
    b.fillRect(x0, hw, x1 - x0, 1.3);
    // sandbag cap: two staggered rows at fixed positions so neighbours line up
    const cols = ['#8b7c57', '#7e7150', '#958763', '#857753'];
    for (const [row, y, off] of [[0, -4.2, 0], [1, 4.2, 4]] as const) {
      for (let x = 8 + off; x < 36; x += 8) {
        const c = cols[(x / 4 + row + dir) & 3];
        wallBag(b, x + 4, y, 8.6, 7.2, c);
      }
    }
    b.restore();
  };
  for (let d = 0; d < 4; d++) if (mask & (1 << d)) arm(d);
  if (mask === 0) {
    // stand-alone: ring of sandbags around the post
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      b.save();
      b.translate(Math.cos(a) * 19, Math.sin(a) * 19);
      b.rotate(a + Math.PI / 2);
      wallBag(b, 0, 0, 12, 7.5, ['#8b7c57', '#7e7150', '#958763'][i % 3]);
      b.restore();
    }
  }
  // central post: concrete pillar with a steel cap
  bevel(b, chamferRect(-15, -15, 30, 30, 4), 4, '#8c897f', { top: '#73706a', strength: 0.5 });
  grime(b, rrPath(-11, -11, 22, 22, 2), [-11, -11, 22, 22], 101 + mask, 16, 0.12);
  rrPath(-15, -15, 30, 30, 4)(b);
  b.strokeStyle = 'rgba(6,8,10,0.9)';
  b.lineWidth = 1.3;
  b.stroke();
  vol(b, rrPath(-7.5, -7.5, 15, 15, 2), P.gun, [-7.5, -7.5, 15, 15], { hi: 0.35, ow: 0.9 });
  rivets(b, [-5, -5, 5, -5, -5, 5, 5, 5], 0.8, '#888');
  b.fillStyle = rgba(P.teal, 0.9);
  b.fillRect(-4.5, -1.2, 9, 2.4);
}

// ============================================================================ Turrets
export function drawGunTurretBase(L: Layers): void {
  const { p, m, b } = L;
  slab(p, -60, -60, 120, 120, 111, { color: '#55544e', seam: 0, chamfer: 18 });
  // octagonal emplacement floor
  bevel(b, regular(8, 46, TAU / 16), 5, '#6a675f', { top: '#4d4b46', strength: 0.45 });
  // sandbag ring
  const ring: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * TAU;
    ring.push(Math.cos(a) * 52, Math.sin(a) * 52);
  }
  sandbagLine(m, ring, { seed: 8, bw: 9, bh: 6.5 });
  // turret ring
  vol(b, circPath(0, 0, 26), '#3c4044', [-26, -26, 52, 52], { radial: true, hi: 0.3 });
  const rv: number[] = [];
  for (let i = 0; i < 16; i++) rv.push(Math.cos((i / 16) * TAU) * 23, Math.sin((i / 16) * TAU) * 23);
  rivets(b, rv, 1, '#777');
  ammoBox(b, -42, -10, 9, 20, '#4f5638');
  ammoBox(b, 33, -10, 9, 20, '#4f5638');
}

export function drawGunTurretHead(L: Layers): void {
  const { b, e } = L;
  // twin barrels with perforated jackets
  for (const s of [-1, 1]) {
    limb(b, [10, s * 5, 46, s * 5], 2.4, P.gunD, { hi: 0.35 });
    vol(b, rrPath(14, s * 5 - 2.6, 18, 5.2, 2), '#3d4247', [14, s * 5 - 2.6, 18, 5.2], { hi: 0.35, ow: 0.9 });
    for (let x = 16; x < 31; x += 3) {
      b.fillStyle = 'rgba(0,0,0,0.7)';
      b.beginPath();
      b.arc(x, s * 5, 0.8, 0, TAU);
      b.fill();
    }
    vol(b, rrPath(44, s * 5 - 1.6, 4, 3.2, 0.6), '#1d1f22', [44, s * 5 - 1.6, 4, 3.2], { rim: null, ow: 0.7 });
  }
  // armoured shield (curved)
  vol(b, (g) => { g.beginPath(); g.arc(-6, 0, 26, -0.78, 0.78); g.arc(-6, 0, 20.5, 0.72, -0.72, true); g.closePath(); }, P.olive, [10, -18, 12, 36], { hi: 0.35 });
  // receiver
  vol(b, rrPath(-16, -12, 28, 24, 4), '#4d5359', [-16, -12, 28, 24], { hi: 0.32 });
  groove(b, [-2, -11, -2, 11], 0.35, 0.8);
  // ammo cans on both sides
  vol(b, rrPath(-12, 12, 16, 8, 1.5), '#535a3b', [-12, 12, 16, 8], { hi: 0.3 });
  vol(b, rrPath(-12, -20, 16, 8, 1.5), '#535a3b', [-12, -20, 16, 8], { hi: 0.3 });
  // sensor head
  vol(b, rrPath(-10, -5, 10, 10, 2), P.gunD, [-10, -5, 10, 10], { hi: 0.3 });
  light(e, -1, 0, 1.4, P.teal, 1, 3);
  b.fillStyle = rgba(P.teal, 0.85);
  b.fillRect(-15, -2, 3, 4);
  rivets(b, [-13, -9, 9, -9, -13, 9, 9, 9], 0.8, '#777');
}

export function drawTeslaBase(L: Layers): void {
  const { p, m, b, e } = L;
  slab(p, -60, -60, 120, 120, 121, { color: '#53524c', seam: 0, chamfer: 8 });
  // insulator pylons at the corners
  for (const [x, y] of [[-42, -42], [42, -42], [-42, 42], [42, 42]]) {
    cable(m, [x, y, x * 0.5, y * 0.6, 0, 0], 1.6, '#1d1c1a');
  }
  for (const [x, y] of [[-42, -42], [42, -42], [-42, 42], [42, 42]]) {
    castShadow(p, circPath(x, y, 8), 6, 8, 0.4, 3);
    vol(b, circPath(x, y, 8), '#5a5e60', [x - 8, y - 8, 16, 16], { radial: true });
    for (const r of [6.5, 4.5]) vol(b, circPath(x, y, r), '#b8b3a5', [x - r, y - r, r * 2, r * 2], { radial: true, hi: 0.45, rim: null, ow: 0.6 });
    light(e, x, y, 1.2, P.cyan, 0.7, 3);
  }
  // central plinth
  bevel(b, regular(8, 34, TAU / 16), 5, '#5d6062', { top: '#484b4e' });
  hazardStripe(b, -30, 26, 60, 4, 0.6, 4);
  // capacitor ring
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.5;
    const x = Math.cos(a) * 25, y = Math.sin(a) * 25;
    vol(b, circPath(x, y, 5), '#2e3438', [x - 5, y - 5, 10, 10], { radial: true, hi: 0.4 });
    light(e, x, y, 1.1, P.cyan, 0.8, 2.6);
  }
}

export function drawTeslaHead(L: Layers): void {
  const { b, e } = L;
  // forward emitter prong
  limb(b, [14, 0, 34, 0], 3, '#4a5056', { hi: 0.35 });
  vol(b, circPath(35, 0, 3.4), '#c48a4a', [31.6, -3.4, 6.8, 6.8], { radial: true, hi: 0.5, ow: 0.8 });
  light(e, 35, 0, 1.8, P.cyan, 1, 3.4);
  // torus
  vol(b, circPath(0, 0, 21), '#6f4a2c', [-21, -21, 42, 42], { radial: true, hi: 0.35, lo: 0.5 });
  b.save();
  circPath(0, 0, 21)(b);
  b.clip();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * TAU;
    line(b, Math.cos(a) * 12, Math.sin(a) * 12, Math.cos(a) * 21, Math.sin(a) * 21, 'rgba(30,14,4,0.5)', 1);
    line(b, Math.cos(a + 0.03) * 12, Math.sin(a + 0.03) * 12, Math.cos(a + 0.03) * 21, Math.sin(a + 0.03) * 21, 'rgba(255,200,150,0.18)', 0.6);
  }
  b.restore();
  // torus highlight ring
  b.beginPath();
  b.arc(-1.5, -1.5, 16, Math.PI * 0.95, Math.PI * 1.65);
  b.strokeStyle = 'rgba(255,220,190,0.45)';
  b.lineWidth = 2;
  b.stroke();
  vol(b, circPath(0, 0, 11.5), '#3d4448', [-11.5, -11.5, 23, 23], { radial: true, hi: 0.3 });
  vol(b, circPath(0, 0, 7.5), '#c9eef2', [-7.5, -7.5, 15, 15], { radial: true, hi: 0.6, lo: 0.4 });
  glow(e, 0, 0, 30, P.cyan, 0.35);
  light(e, 0, 0, 4.5, P.cyan, 0.85, 2.5);
  // crawling arcs on the torus
  const r = mulberry32(5);
  for (let k = 0; k < 3; k++) {
    const a0 = r() * TAU;
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = a0 + i * 0.16;
      const rad = 16 + (r() - 0.5) * 6;
      pts.push(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    glowLine(e, pts, P.cyan, 0.7, 0.8, 3.5);
  }
}

export function drawMissileBase(L: Layers): void {
  const { p, m, b } = L;
  slab(p, -60, -60, 120, 120, 131, { color: '#57554f', seam: 0, chamfer: 8 });
  // blast scorch
  const gr = p.createRadialGradient(20, 0, 0, 20, 0, 40);
  gr.addColorStop(0, 'rgba(10,9,8,0.4)');
  gr.addColorStop(1, 'rgba(10,9,8,0)');
  p.fillStyle = gr;
  p.fillRect(-20, -40, 80, 80);
  paintLine(p, regular(8, 50, TAU / 16).concat(regular(8, 50, TAU / 16).slice(0, 2)), P.amber, 1.6, 0.35);
  // spare missile crates
  for (const y of [-54, 40]) {
    vol(m, rrPath(-46, y, 70, 13, 2), '#4f5638', [-46, y, 70, 13], { hi: 0.3 });
    for (const x of [-30, -6, 14]) line(m, x, y + 1, x, y + 12, 'rgba(0,0,0,0.4)', 1);
    m.fillStyle = 'rgba(230,180,90,0.7)';
    m.fillRect(-42, y + 5, 8, 2.5);
  }
  // rotating platform
  bevel(b, regular(12, 32, 0), 4, '#555a5e', { top: '#41454a' });
  const rv: number[] = [];
  for (let i = 0; i < 12; i++) rv.push(Math.cos((i / 12) * TAU + 0.26) * 25, Math.sin((i / 12) * TAU + 0.26) * 25);
  rivets(b, rv, 1, '#777');
}

export function drawMissileHead(L: Layers): void {
  const { b, e } = L;
  // side armour plates
  for (const s of [-1, 1]) {
    vol(b, rrPath(-24, s > 0 ? 17 : -23, 44, 6, 1.5), '#5d6446', [-24, -23, 44, 6], { hi: 0.32 });
  }
  // frame
  vol(b, rrPath(-22, -18, 40, 36, 2), '#3a3f2b', [-22, -18, 40, 36], { hi: 0.2 });
  // four missiles lying side by side
  for (const y of [-12.5, -4.2, 4.2, 12.5]) {
    vol(b, rrPath(-26, y - 3.4, 42, 6.8, 3.4), '#c9c7bc', [-26, y - 3.4, 42, 6.8], { hi: 0.35, lo: 0.45 });
    // nose cone
    vol(b, polyPath([16, y - 3.4, 26, y, 16, y + 3.4]), '#b9542a', [16, y - 3.4, 10, 6.8], { hi: 0.35, ow: 0.9 });
    // fins
    vol(b, polyPath([-26, y - 3.4, -30, y - 4.6, -30, y + 4.6, -26, y + 3.4]), '#7c7a70', [-30, y - 4.6, 4, 9.2], { rim: null, ow: 0.7 });
    b.fillStyle = 'rgba(40,40,40,0.6)';
    b.fillRect(4, y - 3.3, 1.4, 6.6);
  }
  // retaining straps
  for (const x of [-12, 6]) {
    vol(b, rrPath(x, -21, 4, 42, 1), '#4c523a', [x, -21, 4, 42], { hi: 0.3, ow: 0.9 });
  }
  b.fillStyle = rgba(P.teal, 0.9);
  b.fillRect(-18, 18, 10, 3);
  b.fillRect(-18, -21, 10, 3);
  light(e, 18, -20, 0.9, P.amber, 0.9, 3);
  light(e, 18, 20, 0.9, P.amber, 0.9, 3);
}

export function drawSensor(L: Layers): void {
  const { p, m, b, e } = L;
  slab(p, -60, -60, 120, 120, 141, { color: '#56554f', seam: 0, chamfer: 8 });
  // long shadow of the tower & dish on the pad (it is tall)
  p.save();
  p.globalAlpha = 0.28;
  p.fillStyle = '#000';
  p.translate(22, 28);
  p.beginPath();
  p.ellipse(4, -4, 11, 30, -0.35, 0, TAU);
  p.fill();
  p.fillRect(-14, -14, 28, 28);
  p.restore();
  // guy wires
  for (const [x, y] of [[-54, -54], [54, -54], [-54, 54], [54, 54]]) {
    line(p, x, y, x * 0.25, y * 0.25, 'rgba(20,20,20,0.6)', 0.8);
    vol(m, circPath(x, y, 2.5), P.gunD, [x - 2.5, y - 2.5, 5, 5], { radial: true });
  }
  // equipment shed
  const shed = rrPath(-56, 20, 32, 34, 1.5);
  corrugate(m, shed, [-56, 20, 32, 34], '#596046', 3.6, true);
  vol(m, shed, 'rgba(0,0,0,0)', [-56, 20, 32, 34], { hi: 0, lo: 0 });
  cable(m, [-24, 34, -10, 24, -4, 12], 1.6);
  // lattice tower (seen from above)
  const tw = 16;
  b.save();
  b.strokeStyle = '#3d4246';
  b.lineWidth = 2;
  b.strokeRect(-tw, -tw, tw * 2, tw * 2);
  b.lineWidth = 1.2;
  b.beginPath();
  b.moveTo(-tw, -tw); b.lineTo(tw, tw); b.moveTo(tw, -tw); b.lineTo(-tw, tw);
  b.moveTo(-tw * 0.6, -tw * 0.6); b.lineTo(tw * 0.6, -tw * 0.6); b.lineTo(tw * 0.6, tw * 0.6); b.lineTo(-tw * 0.6, tw * 0.6); b.closePath();
  b.stroke();
  b.restore();
  for (const [x, y] of [[-tw, -tw], [tw, -tw], [-tw, tw], [tw, tw]]) vol(b, circPath(x, y, 2.6), P.gunL, [x - 2.6, y - 2.6, 5.2, 5.2], { radial: true, ow: 0.8 });
  // top platform + radar dish (big, elongated)
  vol(b, circPath(0, 0, 8), '#4b5055', [-8, -8, 16, 16], { radial: true, hi: 0.35 });
  b.save();
  b.rotate(-0.35);
  vol(b, (g) => { g.beginPath(); g.ellipse(6, 0, 7, 34, 0, 0, TAU); }, '#a6aaa6', [-1, -34, 14, 68], { radial: true, hi: 0.45, lo: 0.5 });
  b.save();
  b.beginPath();
  b.ellipse(6, 0, 7, 34, 0, 0, TAU);
  b.clip();
  for (let y = -30; y <= 30; y += 6) line(b, -2, y, 14, y, 'rgba(0,0,0,0.25)', 0.8);
  b.restore();
  limb(b, [6, 0, 20, 0], 1.6, P.gunD, { hi: 0.3 });
  vol(b, circPath(21, 0, 2.6), P.gunD, [18, -2.6, 5.2, 5.2], { radial: true, ow: 0.7 });
  b.restore();
  light(e, 0, 0, 1.6, P.red, 1, 4);
  light(e, -tw, -tw, 0.8, P.amber, 0.8, 3);
  light(e, tw, tw, 0.8, P.amber, 0.8, 3);
  b.fillStyle = rgba(P.teal, 0.85);
  b.fillRect(-52, 24, 3, 26);
}

export const HUMAN_BUILDINGS: Record<string, { n: number; draw: (L: Layers) => void }> = {
  hq: { n: 4, draw: drawHQ },
  generator: { n: 2, draw: drawGenerator },
  habitat: { n: 2, draw: drawHabitat },
  depot: { n: 2, draw: drawDepot },
  barracks: { n: 3, draw: drawBarracks },
  factory: { n: 3, draw: drawFactory },
  lab: { n: 3, draw: drawLab },
  gun_turret: { n: 2, draw: drawGunTurretBase },
  tesla: { n: 2, draw: drawTeslaBase },
  missile: { n: 2, draw: drawMissileBase },
  sensor: { n: 2, draw: drawSensor },
};

export const HUMAN_TURRETS: Record<string, { size: number; draw: (L: Layers) => void }> = {
  gun_turret: { size: 112, draw: drawGunTurretHead },
  tesla: { size: 96, draw: drawTeslaHead },
  missile: { size: 80, draw: drawMissileHead },
};
