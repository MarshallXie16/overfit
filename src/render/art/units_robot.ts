// AXIOM robots (also used for hacked variants via the palette). All face east (+x).
import { P, type TeamPal } from './palette';
import { contact, type Layers } from './sprite';
import {
  circPath, glow, glowLine, grime, groove, light, limb, line, polyPath, rgba, rivets,
  roundPolyPath, rrPath, vol, type G, bboxOf, mix, TAU,
} from './util';

type Pt = [number, number];
const CHITIN_RIM = 'rgba(175,195,215,0.38)';

/** Armour plate: chitin-like gunmetal with cool rim light and grime. */
function plate(g: G, pts: number[], color: string, r = 2, seed = 1, o: { hi?: number; lo?: number; grimeN?: number } = {}) {
  const path = roundPolyPath(pts, r);
  const bb = bboxOf(pts);
  vol(g, path, color, bb, { hi: o.hi ?? 0.2, lo: o.lo ?? 0.45, rim: CHITIN_RIM });
  if ((o.grimeN ?? 1) > 0) grime(g, path, bb, seed, Math.round((bb[2] * bb[3]) / 18) * (o.grimeN ?? 1), 0.1, 0.25);
}

function hackMark(L: Layers, pal: TeamPal, x: number, y: number, s: number) {
  if (!pal.hacked) return;
  const g = L.b;
  vol(g, polyPath([x - s, y - s, x, y, x - s, y + s, x - s * 0.45, y + s, x + s * 0.55, y, x - s * 0.45, y - s]),
    P.teal, [x - s, y - s, s * 1.6, s * 2], { rim: null, ow: 0.7, hi: 0.35, lo: 0.1 });
  glow(L.e, x, y, s * 2.4, P.teal, 0.25);
}

interface LegOpts {
  w: number;
  knee: number; // knee offset magnitude
  side: number; // +1 knee toward front, -1 toward back
  upper?: string;
  lower?: string;
  lift?: number; // 0..1 (lifted legs look lighter and tucked)
  servo?: TeamPal | null;
  claw?: number;
}

function leg(L: Layers, hip: Pt, foot: Pt, o: LegOpts) {
  const g = L.b;
  const lift = o.lift ?? 0;
  const fx = foot[0] + (hip[0] - foot[0]) * 0.08 * lift;
  const fy = foot[1] + (hip[1] - foot[1]) * 0.08 * lift;
  const dx = fx - hip[0];
  const dy = fy - hip[1];
  const len = Math.hypot(dx, dy) || 1;
  let px = -dy / len;
  let py = dx / len;
  if (Math.abs(px) > 0.05 && Math.sign(px) !== Math.sign(o.side)) { px = -px; py = -py; }
  const kx = hip[0] + dx * 0.45 + px * o.knee;
  const ky = hip[1] + dy * 0.45 + py * o.knee;
  const up = o.upper ?? P.ax3;
  const lo = o.lower ?? P.ax2;
  limb(g, [kx, ky, fx, fy], o.w * 0.72, lo, { hi: 0.22 + lift * 0.1 });
  // claw tip
  const cl = o.claw ?? o.w * 0.9;
  const ux = (fx - kx) / (Math.hypot(fx - kx, fy - ky) || 1);
  const uy = (fy - ky) / (Math.hypot(fx - kx, fy - ky) || 1);
  vol(g, polyPath([fx - uy * cl * 0.45, fy + ux * cl * 0.45, fx + ux * cl, fy + uy * cl, fx + uy * cl * 0.45, fy - ux * cl * 0.45]),
    P.ax1, [fx - cl, fy - cl, cl * 2, cl * 2], { rim: null, ow: 0.8 });
  limb(g, [hip[0], hip[1], kx, ky], o.w, up, { hi: 0.3 + lift * 0.1 });
  vol(g, circPath(kx, ky, o.w * 0.62), P.ax4, [kx - o.w * 0.6, ky - o.w * 0.6, o.w * 1.2, o.w * 1.2], { radial: true, hi: 0.35, rim: null, ow: 0.8 });
  if (o.servo) light(L.e, kx, ky, o.w * 0.2, o.servo.glow, 0.7, 2.6);
}

const phaseOf = (f: number) => (f / 4) * TAU;

// ======================================================================= skitter

export function drawSkitter(L: Layers, pal: TeamPal, f: number): void {
  const g = L.b;
  contact(L.p, 0, 0, 20, 18, 0.3);
  const ph = phaseOf(f);
  const hips: Pt[] = [[5, 4.5], [0.5, 5.5], [-4, 4.5]];
  const feet: Pt[] = [[16, 17], [1, 21], [-15, 17]];
  const sides = [1, 0.5, -1];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const groupA = (i % 2 === 0) === (s < 0);
      const p = ph + (groupA ? 0 : Math.PI);
      const off = Math.cos(p) * 4;
      const lift = Math.max(0, -Math.sin(p));
      leg(L, [hips[i][0], hips[i][1] * s], [feet[i][0] + off, feet[i][1] * s], { w: 2.5, knee: 3.6, side: sides[i], lift });
    }
  }
  // abdomen
  plate(g, [-5, -5.5, -13, -7, -20, -3.5, -20, 3.5, -13, 7, -5, 5.5], P.ax2, 2.5, 3);
  groove(g, [-9.5, -6, -9.5, 6], 0.5, 0.8);
  groove(g, [-14.5, -5.5, -14.5, 5.5], 0.5, 0.8);
  glowLine(L.e, [-7.5, 0, -18, 0], pal.glow, 0.9, 0.8, 3.4);
  // thorax
  plate(g, [-6, -5, 0, -7.2, 7, -5.6, 9.5, 0, 7, 5.6, 0, 7.2, -6, 5], P.ax3, 2, 5);
  groove(g, [-4, 0, 7, 0], 0.4, 0.7);
  // head
  plate(g, [7.5, -4.6, 12.5, -4.2, 15.8, -1.6, 15.8, 1.6, 12.5, 4.2, 7.5, 4.6], P.ax2, 1.5, 7, { grimeN: 0 });
  for (const s of [-1, 1]) {
    limb(g, [14.5, s * 2.6, 18.2, s * 3.6, 19.4, s * 1.6], 1.2, P.ax4, { hi: 0.4 });
    light(L.e, 13.4, s * 1.7, 0.95, pal.glow, 1, 2.8);
    light(L.e, 11.2, s * 3.1, 0.6, pal.glow, 0.85, 2.4);
  }
  hackMark(L, pal, -13, 0, 3);
}

// ======================================================================= gunner

export function drawGunner(L: Layers, pal: TeamPal, f: number): void {
  const g = L.b;
  contact(L.p, 0, 0, 24, 22, 0.3);
  const ph = phaseOf(f);
  const legs: [Pt, Pt, number][] = [[[7, 8], [20, 21], 1], [[-8, 8], [-20, 21], -1]];
  for (const s of [-1, 1]) {
    legs.forEach(([hip, foot, side], i) => {
      const groupA = (i === 0) === (s < 0);
      const p = ph + (groupA ? 0 : Math.PI);
      const off = Math.cos(p) * 4.5;
      const lift = Math.max(0, -Math.sin(p));
      leg(L, [hip[0], hip[1] * s], [foot[0] + off, foot[1] * s], { w: 3.6, knee: 4.5, side, lift, servo: pal });
    });
  }
  // twin barrels
  for (const s of [-1, 1]) {
    limb(g, [12, s * 4.2, 31, s * 4.2], 2.6, P.ax4, { hi: 0.4 });
    vol(g, rrPath(29, s * 4.2 - 1.8, 3.5, 3.6, 0.6), P.ax1, [29, s * 4.2 - 1.8, 3.5, 3.6], { rim: null, ow: 0.7 });
    vol(g, rrPath(13, s * 4.2 - 2.4, 9, 4.8, 1), P.ax3, [13, s * 4.2 - 2.4, 9, 4.8], { ow: 0.8 });
    for (let x = 15; x < 21; x += 2.2) {
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(x, s * 4.2 - 0.7, 1.1, 1.4);
    }
  }
  // ammo drum
  vol(g, circPath(-13, 0, 6), P.ax2, [-19, -6, 12, 12], { radial: true, hi: 0.3, rim: CHITIN_RIM });
  g.beginPath();
  g.arc(-13, 0, 3.6, 0, TAU);
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 1;
  g.stroke();
  // chassis
  plate(g, [14, -6, 10, -12, -9, -12, -15, -7, -15, 7, -9, 12, 10, 12, 14, 6], P.ax3, 2.5, 13);
  plate(g, [9, -8, -6, -8.5, -10, -4, -10, 4, -6, 8.5, 9, 8], P.ax2, 2, 14, { grimeN: 0.5 });
  groove(g, [-2, -8, -2, 8], 0.45, 0.8);
  glowLine(L.e, [-8, -10.4, 8, -10.4], pal.glow, 0.6, 0.55, 3);
  glowLine(L.e, [-8, 10.4, 8, 10.4], pal.glow, 0.6, 0.55, 3);
  // sensor head
  plate(g, [10.5, -6, 17.5, -4.5, 17.5, 4.5, 10.5, 6], P.ax2, 1.5, 15, { grimeN: 0 });
  glowLine(L.e, [16.3, -3.2, 16.3, 3.2], pal.glow, 1.1, 1, 3.6);
  light(L.e, 16.3, 0, 1, pal.hot, 0.8, 2);
  rivets(g, [-12, -8, -12, 8, 7, -10, 7, 10], 0.7, P.ax4);
  hackMark(L, pal, -4, 0, 3.4);
}

// ======================================================================= sapper

export function drawSapper(L: Layers, pal: TeamPal, f: number): void {
  const g = L.b;
  contact(L.p, 0, 0, 19, 19, 0.32);
  const ph = phaseOf(f);
  const angs = [0.75, 2.35, -0.75, -2.35];
  angs.forEach((a, i) => {
    const p = ph + (i % 2 ? Math.PI : 0);
    const off = Math.cos(p) * 0.22;
    const lift = Math.max(0, -Math.sin(p));
    const fa = a + off * Math.sign(Math.sin(a) || 1);
    leg(L, [Math.cos(a) * 9, Math.sin(a) * 9], [Math.cos(fa) * 18.5, Math.sin(fa) * 18.5], { w: 3, knee: 2.5, side: Math.cos(a) > 0 ? 1 : -1, lift });
  });
  // front sensor
  plate(g, [10, -3.6, 16.5, -2.4, 16.5, 2.4, 10, 3.6], P.ax2, 1.2, 3, { grimeN: 0 });
  light(L.e, 15, 0, 1.1, pal.glow, 1, 2.6);
  // shell
  vol(g, circPath(0, 0, 13.2), P.ax3, [-13.2, -13.2, 26.4, 26.4], { radial: true, hi: 0.3, rim: CHITIN_RIM });
  grime(g, circPath(0, 0, 13.2), [-13, -13, 26, 26], 21, 40, 0.1, 0.2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.52;
    groove(g, [Math.cos(a) * 7.4, Math.sin(a) * 7.4, Math.cos(a) * 13, Math.sin(a) * 13], 0.6, 1.1);
    // warning chevrons
    const cx = Math.cos(a + 0.52) * 10.4;
    const cy = Math.sin(a + 0.52) * 10.4;
    glowLine(L.e, [cx - Math.cos(a + 0.52 + 0.9) * 1.6, cy - Math.sin(a + 0.52 + 0.9) * 1.6, cx + Math.cos(a + 0.52) * 1.2, cy + Math.sin(a + 0.52) * 1.2,
      cx - Math.cos(a + 0.52 - 0.9) * 1.6, cy - Math.sin(a + 0.52 - 0.9) * 1.6], pal.glow2, 0.6, 0.45, 2.2);
  }
  // volatile core
  const pulse = [1, 0.78, 0.6, 0.8][f];
  vol(g, circPath(0, 0, 7.2), '#22070c', [-7.2, -7.2, 14.4, 14.4], { radial: true, hi: 0.15, rim: null, ow: 1.2 });
  glow(L.e, 0, 0, 16, pal.glow, 0.55 * pulse);
  const e = L.e;
  e.save();
  e.globalCompositeOperation = 'lighter';
  const gr = e.createRadialGradient(-1, -1, 0, 0, 0, 6.6);
  gr.addColorStop(0, rgba(pal.hot, 0.95 * pulse));
  gr.addColorStop(0.35, rgba(pal.glow, 0.9 * pulse));
  gr.addColorStop(1, rgba(pal.glow, 0.25 * pulse));
  e.fillStyle = gr;
  e.beginPath();
  e.arc(0, 0, 6.6, 0, TAU);
  e.fill();
  e.restore();
  // containment bars
  for (const a of [0.4, 2.5, 4.6]) {
    line(g, Math.cos(a) * 2, Math.sin(a) * 2, Math.cos(a) * 7, Math.sin(a) * 7, 'rgba(20,10,12,0.7)', 1.2);
  }
  hackMark(L, pal, -9, 0, 2.6);
}

// ======================================================================= brute

export function drawBrute(L: Layers, pal: TeamPal, f: number): void {
  const g = L.b;
  contact(L.p, 0, 0, 50, 48, 0.32);
  const ph = phaseOf(f);
  const hips: Pt[] = [[13, 18], [-3, 22], [-18, 18]];
  const feet: Pt[] = [[29, 41], [-3, 47], [-33, 40]];
  const sides = [1, 0.4, -1];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const groupA = (i % 2 === 0) === (s < 0);
      const p = ph + (groupA ? 0 : Math.PI);
      const off = Math.cos(p) * 6;
      const lift = Math.max(0, -Math.sin(p));
      leg(L, [hips[i][0], hips[i][1] * s], [feet[i][0] + off, feet[i][1] * s], { w: 7.5, knee: 7, side: sides[i], lift, servo: pal, claw: 6 });
    }
  }
  // claws
  const sw = Math.sin(ph) * 1.5;
  for (const s of [-1, 1]) {
    limb(g, [18, s * 18, 34, s * 31, 44 + sw, s * 22], 8, P.ax3, { hi: 0.3 });
    vol(g, circPath(34, s * 31, 5), P.ax4, [29, s * 31 - 5, 10, 10], { radial: true, hi: 0.35, rim: null });
    light(L.e, 34, s * 31, 1.2, pal.glow, 0.7, 2.6);
    // pincer blades
    const bx = 44 + sw;
    const by = s * 22;
    plate(g, [bx - 4, by - s * 3, bx + 9, by - s * 9, bx + 16, by - s * 3, bx + 9, by - s * 4], P.ax2, 1.5, 31 + s, { grimeN: 0 });
    plate(g, [bx - 4, by + s * 3, bx + 8, by + s * 1, bx + 13, by + s * 6, bx + 5, by + s * 7], P.ax2, 1.5, 33 + s, { grimeN: 0 });
    vol(g, circPath(bx, by, 5.5), P.ax3, [bx - 5.5, by - 5.5, 11, 11], { radial: true, hi: 0.3, rim: CHITIN_RIM });
  }
  // ram
  plate(g, [24, -12, 42, -5.5, 48, 0, 42, 5.5, 24, 12], P.ax4, 2, 41);
  plate(g, [42, -5.5, 48, 0, 42, 5.5, 45, 0], P.ax1, 1, 42, { grimeN: 0 });
  groove(g, [30, -9, 44, -2.5], 0.4, 0.8);
  groove(g, [30, 9, 44, 2.5], 0.4, 0.8);
  // carapace layers (rear to front)
  plate(g, [-14, -30, -32, -22, -39, 0, -32, 22, -14, 30, -6, 0], P.ax2, 5, 51);
  plate(g, [8, -32, -16, -31, -26, -18, -29, 0, -26, 18, -16, 31, 8, 32, 14, 0], P.ax3, 5, 52);
  plate(g, [24, -24, 8, -31, -6, -26, -10, 0, -6, 26, 8, 31, 24, 24, 30, 10, 30, -10], mix(P.ax3, P.ax4, 0.35), 5, 53);
  // spine ridge
  plate(g, [24, -4, -34, -3.5, -38, 0, -34, 3.5, 24, 4, 27, 0], P.ax4, 2, 54, { grimeN: 0 });
  for (let x = -30; x < 22; x += 7) groove(g, [x, -3.5, x, 3.5], 0.55, 0.9);
  // glowing seams between plates
  const e = L.e;
  glowLine(e, [8, -30, 13, -12], pal.glow, 0.8, 0.55, 3.2);
  glowLine(e, [8, 30, 13, 12], pal.glow, 0.8, 0.55, 3.2);
  glowLine(e, [-16, -29, -11, -12], pal.glow, 0.8, 0.45, 3.2);
  glowLine(e, [-16, 29, -11, 12], pal.glow, 0.8, 0.45, 3.2);
  // rear vents
  for (let i = -1; i <= 1; i++) {
    vol(g, rrPath(-36, i * 6 - 1.6, 7, 3.2, 1), '#14070a', [-36, i * 6 - 1.6, 7, 3.2], { rim: null, ow: 0.6 });
    glowLine(e, [-35, i * 6, -30.5, i * 6], pal.glow, 1, 0.75, 3);
  }
  // optics cluster
  for (const [x, y, r] of [[27, -7.5, 1.2], [29.5, -3.6, 1.5], [29.5, 3.6, 1.5], [27, 7.5, 1.2]] as const) {
    light(e, x, y, r, pal.glow, 1, 2.8);
  }
  rivets(g, [18, -20, 18, 20, 0, -27, 0, 27], 1, P.ax4);
  hackMark(L, pal, -24, 0, 5);
}

// ======================================================================= lancer

export function drawLancer(L: Layers, pal: TeamPal, f: number): void {
  const g = L.b;
  contact(L.p, 0, 0, 26, 24, 0.28);
  const ph = phaseOf(f);
  const legs: [Pt, Pt, number][] = [[[3, 4.5], [18, 26], 1], [[-9, 4.5], [-28, 23], -1]];
  for (const s of [-1, 1]) {
    legs.forEach(([hip, foot, side], i) => {
      const groupA = (i === 0) === (s < 0);
      const p = ph + (groupA ? 0 : Math.PI);
      const off = Math.cos(p) * 5;
      const lift = Math.max(0, -Math.sin(p));
      leg(L, [hip[0], hip[1] * s], [foot[0] + off, foot[1] * s], { w: 2.3, knee: 6.5, side, lift, claw: 2.6 });
    });
  }
  // lance
  limb(g, [12, 0, 44, 0], 3, P.ax1, { hi: 0.25 });
  for (const x of [19, 27, 35]) {
    vol(g, rrPath(x - 1.4, -2.8, 2.8, 5.6, 0.8), P.ax4, [x - 1.4, -2.8, 2.8, 5.6], { rim: null, ow: 0.7 });
  }
  for (const s of [-1, 1]) limb(g, [40, s * 1.2, 44, s * 3.4, 49, s * 1.6], 1.2, P.ax4, { hi: 0.4 });
  glowLine(L.e, [13, 0, 47, 0], pal.glow2, 0.9, 0.9, 4.5);
  light(L.e, 48.5, 0, 1.8, pal.glow2, 1, 3.5);
  // body
  plate(g, [10, -5, 0, -6.6, -16, -5.2, -23, 0, -16, 5.2, 0, 6.6, 10, 5], P.ax2, 2.4, 61);
  plate(g, [6, -3, -14, -3, -18, 0, -14, 3, 6, 3], P.ax3, 1.5, 62, { grimeN: 0 });
  for (let x = -12; x < 6; x += 4.5) groove(g, [x, -3, x, 3], 0.5, 0.7);
  // energy cell
  vol(g, polyPath([-15, -3.2, -23, 0, -15, 3.2]), '#16060c', [-23, -3.2, 8, 6.4], { rim: null, ow: 0.8 });
  glowLine(L.e, [-15.5, 0, -21, 0], pal.glow2, 1.4, 0.8, 3);
  // head
  plate(g, [9, -4.2, 15.5, -2.8, 18.5, 0, 15.5, 2.8, 9, 4.2], P.ax3, 1.5, 63, { grimeN: 0 });
  light(L.e, 15, 0, 1.4, pal.glow, 1, 3);
  hackMark(L, pal, -7, 0, 2.6);
}

// ======================================================================= wasp

function waspBody(L: Layers, pal: TeamPal, f: number, shadowOnly = false) {
  const g = L.b;
  const rotors: Pt[] = [[14, -15.5], [14, 15.5], [-13, -15.5], [-13, 15.5]];
  for (const [x, y] of rotors) limb(g, [0, 0, x, y], 3.2, P.ax3, { hi: 0.3 });
  rotors.forEach(([x, y], i) => {
    // motor pod
    if (shadowOnly) {
      g.beginPath();
      g.arc(x, y, 10.5, 0, TAU);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fill();
      return;
    }
    const disc = g.createRadialGradient(x, y, 2, x, y, 10.8);
    disc.addColorStop(0, 'rgba(150,160,175,0.22)');
    disc.addColorStop(0.85, 'rgba(150,160,175,0.12)');
    disc.addColorStop(1, 'rgba(190,200,215,0.3)');
    g.fillStyle = disc;
    g.beginPath();
    g.arc(x, y, 10.8, 0, TAU);
    g.fill();
    // blurred blades
    const a0 = (f === 0 ? 0.35 : 1.15) + i * 0.7;
    for (let k = 0; k < 5; k++) {
      const a = a0 - k * 0.13;
      const al = 0.55 - k * 0.1;
      g.beginPath();
      g.moveTo(x - Math.cos(a) * 10, y - Math.sin(a) * 10);
      g.lineTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
      g.strokeStyle = `rgba(25,28,33,${al})`;
      g.lineWidth = 2 - k * 0.25;
      g.stroke();
    }
    vol(g, circPath(x, y, 2.6), P.ax4, [x - 2.6, y - 2.6, 5.2, 5.2], { radial: true, hi: 0.4, ow: 0.8 });
    light(L.e, x, y, 0.6, pal.glow, 0.6, 2.2);
  });
  // body
  plate(g, [17.5, 0, 9, -6.8, -9, -6.2, -16.5, -2.6, -16.5, 2.6, -9, 6.2, 9, 6.8], P.ax3, 2, 71);
  plate(g, [11, 0, 5, -4, -8, -3.6, -11, 0, -8, 3.6, 5, 4], P.ax2, 1.5, 72, { grimeN: 0 });
  groove(g, [-3, -3.8, -3, 3.8], 0.5, 0.7);
  if (!shadowOnly) {
    limb(g, [14, 0, 23, 0], 1.6, P.ax4, { hi: 0.4 });
    light(L.e, 23.5, 0, 0.9, pal.glow2, 0.9, 3);
    light(L.e, 14.5, 0, 1.5, pal.glow, 1, 3);
    glowLine(L.e, [-15, -1.2, -15, 1.2], pal.glow2, 1.2, 0.8, 3);
    hackMark(L, pal, -6, 0, 2.4);
  }
}

export function drawWasp(L: Layers, pal: TeamPal, f: number): void {
  waspBody(L, pal, f);
}

/** Flat soft shadow key for the wasp (rendered by the caller with blur). */
export function drawWaspShadow(L: Layers): void {
  const g = L.b;
  g.fillStyle = 'rgba(0,0,0,1)';
  for (const [x, y] of [[14, -15.5], [14, 15.5], [-13, -15.5], [-13, 15.5]] as Pt[]) {
    g.beginPath();
    g.arc(x, y, 10, 0, TAU);
    g.fill();
  }
  roundPolyPath([17.5, 0, 9, -6.8, -9, -6.2, -16.5, -2.6, -16.5, 2.6, -9, 6.2, 9, 6.8], 2)(g);
  g.fill();
  g.lineWidth = 3.2;
  g.strokeStyle = '#000';
  for (const [x, y] of [[14, -15.5], [14, 15.5], [-13, -15.5], [-13, 15.5]] as Pt[]) line(g, 0, 0, x, y, '#000', 3.2);
}

// ======================================================================= warden

export function drawWarden(L: Layers, pal: TeamPal, f: number): void {
  const g = L.b;
  const e = L.e;
  contact(L.p, 4, 6, 30, 28, 0.25);
  // halo segments (ring frame floating around)
  const rot = f * (Math.PI / 12);
  for (let i = 0; i < 6; i++) {
    const a0 = rot + (i / 6) * TAU + 0.12;
    const a1 = a0 + TAU / 6 - 0.24;
    g.beginPath();
    g.arc(0, 0, 31, a0, a1);
    g.strokeStyle = '#06080a';
    g.lineWidth = 5;
    g.lineCap = 'butt';
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 31, a0, a1);
    g.strokeStyle = P.ax3;
    g.lineWidth = 3.2;
    g.stroke();
    g.beginPath();
    g.arc(-0.5, -0.5, 31.6, a0, a1);
    g.strokeStyle = 'rgba(190,205,220,0.35)';
    g.lineWidth = 0.8;
    g.stroke();
    e.save();
    e.globalCompositeOperation = 'lighter';
    e.beginPath();
    e.arc(0, 0, 31, a0 + 0.08, a1 - 0.08);
    e.strokeStyle = rgba(pal.glow, 0.85);
    e.lineWidth = 1;
    e.stroke();
    e.beginPath();
    e.arc(0, 0, 31, a0 + 0.08, a1 - 0.08);
    e.strokeStyle = rgba(pal.glow, 0.18);
    e.lineWidth = 5;
    e.stroke();
    e.restore();
  }
  // arms
  const sway = [0, 1.2, 0, -1.2][f];
  for (const s of [-1, 1]) {
    limb(g, [7, s * 10, 18, s * (19 + sway), 27, s * (11 + sway)], 3.4, P.ax3, { hi: 0.3 });
    vol(g, circPath(18, s * (19 + sway), 2.6), P.ax4, [15, s * 19 - 3, 6, 6], { radial: true, rim: null, ow: 0.8 });
    // tool head
    plate(g, [25, s * (11 + sway) - 2.5, 31, s * (11 + sway) - 1.2, 31, s * (11 + sway) + 1.2, 25, s * (11 + sway) + 2.5], P.ax2, 1, 81 + s, { grimeN: 0 });
    light(e, 31.5, s * (11 + sway), 1.2, s < 0 ? pal.glow2 : pal.glow, 0.95, 3.2);
  }
  limb(g, [-12, 0, -21, 7 - sway, -26, 1], 2.6, P.ax3, { hi: 0.3 });
  light(e, -26, 1, 0.8, pal.glow, 0.8, 2.6);
  // octagonal body
  const oct = (r: number) => {
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return pts;
  };
  plate(g, oct(18), P.ax3, 2.5, 83);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    groove(g, [Math.cos(a) * 12.5, Math.sin(a) * 12.5, Math.cos(a) * 16.5, Math.sin(a) * 16.5], 0.55, 1);
  }
  plate(g, oct(12), P.ax2, 2, 84, { grimeN: 0 });
  // repair emitter at the front
  plate(g, [14, -4, 21, -2.5, 21, 2.5, 14, 4], P.ax2, 1.2, 85, { grimeN: 0 });
  light(e, 20, 0, 1.3, pal.glow2, 1, 3);
  // lens
  vol(g, circPath(0, 0, 7), '#120508', [-7, -7, 14, 14], { radial: true, hi: 0.35, ow: 1 });
  glow(e, 0, 0, 14, pal.glow, 0.5);
  e.save();
  e.globalCompositeOperation = 'lighter';
  e.beginPath();
  e.arc(0, 0, 5, 0, TAU);
  e.strokeStyle = rgba(pal.glow, 0.95);
  e.lineWidth = 1.2;
  e.stroke();
  e.restore();
  light(e, 0, 0, 2.2, pal.glow, 1, 2.5);
  hackMark(L, pal, -8, -8, 2.6);
}

// ======================================================================= colossus

export function drawColossus(L: Layers, pal: TeamPal, f: number): void {
  const g = L.b;
  const e = L.e;
  contact(L.p, 0, 0, 100, 92, 0.3);
  const ph = phaseOf(f);
  const hips: Pt[] = [[38, 24], [14, 29], [-14, 29], [-40, 24]];
  const feet: Pt[] = [[84, 74], [30, 97], [-28, 97], [-82, 74]];
  const sides = [1, 0.5, -0.5, -1];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const p = ph + i * (Math.PI / 2) + (s < 0 ? Math.PI : 0);
      const off = Math.cos(p) * 9;
      const lift = Math.max(0, -Math.sin(p));
      leg(L, [hips[i][0], hips[i][1] * s], [feet[i][0] + off, feet[i][1] * s], { w: 13, knee: 15, side: sides[i], lift, servo: pal, claw: 10 });
    }
  }
  // abdomen
  plate(g, [-20, -30, -58, -35, -92, -24, -102, 0, -92, 24, -58, 35, -20, 30], P.ax2, 7, 91);
  for (const x of [-38, -56, -74, -88]) groove(g, [x, -30 + (x < -80 ? 8 : 0), x - 4, 0, x, 30 - (x < -80 ? 8 : 0)], 0.55, 1.4);
  for (let i = -2; i <= 2; i++) {
    vol(g, rrPath(-84, i * 9 - 2, 16, 4, 1.4), '#140508', [-84, i * 9 - 2, 16, 4], { rim: null, ow: 0.8 });
    glowLine(e, [-82.5, i * 9, -70, i * 9], pal.glow, 1.4, 0.7, 3);
  }
  // thorax
  plate(g, [-26, -37, 18, -41, 50, -31, 60, 0, 50, 31, 18, 41, -26, 37, -32, 0], P.ax3, 7, 92);
  plate(g, [-18, -30, 14, -34, 40, -26, 46, 0, 40, 26, 14, 34, -18, 30, -22, 0], mix(P.ax3, P.ax4, 0.3), 6, 93);
  groove(g, [14, -33, 20, 0, 14, 33], 0.5, 1.2);
  glowLine(e, [-16, -29, 12, -32.5], pal.glow, 1, 0.6, 3.5);
  glowLine(e, [-16, 29, 12, 32.5], pal.glow, 1, 0.6, 3.5);
  glowLine(e, [40, -25, 46, -1], pal.glow, 1, 0.5, 3.5);
  glowLine(e, [40, 25, 46, 1], pal.glow, 1, 0.5, 3.5);
  // head
  plate(g, [50, -24, 74, -21, 89, -9, 92, 0, 89, 9, 74, 21, 50, 24, 56, 0], P.ax2, 4, 94);
  for (const s of [-1, 1]) limb(g, [86, s * 8, 98, s * 14, 104, s * 7], 3.2, P.ax4, { hi: 0.35 });
  const eyes: [number, number, number][] = [[84, -5, 2.2], [84, 5, 2.2], [79, -11, 1.7], [79, 11, 1.7], [73, -15.5, 1.3], [73, 15.5, 1.3]];
  for (const [x, y, r] of eyes) light(e, x, y, r, pal.glow, 1, 3);
  // artillery spine
  plate(g, [-62, -15, -30, -17, -26, 0, -30, 17, -62, 15, -66, 0], P.ax3, 3, 95);
  for (let y = -12; y <= 12; y += 4) groove(g, [-60, y, -32, y], 0.45, 0.8);
  limb(g, [-30, 0, 62, 0], 16, P.ax2, { hi: 0.26 });
  limb(g, [62, 0, 112, 0], 12, P.ax2, { hi: 0.28 });
  for (const x of [66, 78, 90]) vol(g, rrPath(x, -8, 5, 16, 1.5), P.ax4, [x, -8, 5, 16], { hi: 0.3, ow: 1 });
  vol(g, rrPath(108, -9.5, 15, 19, 2), P.ax3, [108, -9.5, 15, 19], { hi: 0.3 });
  for (const x of [112, 117]) line(g, x, -9, x, 9, 'rgba(0,0,0,0.75)', 1.6);
  glowLine(e, [-26, -6.5, 60, -6.5], pal.glow, 1.2, 0.75, 4);
  glowLine(e, [-26, 6.5, 60, 6.5], pal.glow, 1.2, 0.75, 4);
  glowLine(e, [64, -4.5, 106, -4.5], pal.glow2, 0.9, 0.6, 3.5);
  glowLine(e, [64, 4.5, 106, 4.5], pal.glow2, 0.9, 0.6, 3.5);
  light(e, 123, 0, 2.6, pal.glow2, 0.6, 3);
  // turret collar
  vol(g, circPath(4, 0, 15), P.ax3, [-11, -15, 30, 30], { radial: true, hi: 0.3, rim: CHITIN_RIM });
  vol(g, circPath(4, 0, 9), P.ax1, [-5, -9, 18, 18], { radial: true, hi: 0.25 });
  light(e, 4, 0, 3, pal.glow, 0.9, 3);
  rivets(g, Array.from({ length: 10 }, (_, i) => [4 + Math.cos(i * 0.628) * 12.5, Math.sin(i * 0.628) * 12.5]).flat(), 0.9, P.ax4);
  hackMark(L, pal, -46, 0, 7);
}

export const ROBOT_CANVAS: Record<string, number> = {
  skitter: 64, gunner: 80, sapper: 64, brute: 128, lancer: 104, wasp: 72, warden: 104, colossus: 264,
};
