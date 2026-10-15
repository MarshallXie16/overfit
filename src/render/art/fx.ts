// Effects, decals, scrap piles, wrecks, scaffolding, AXIOM creep pattern.
import { P, AXIOM_PAL, type TeamPal } from './palette';
import { ROBOT_CANVAS, drawSkitter, drawSapper, drawGunner, drawLancer, drawBrute } from './units_robot';
import { renderSprite, type Layers } from './sprite';
import { drum, regular, scrapBits, tyre } from './kit';
import {
  TAU, circPath, ctxOf, glow, glowLine, grime, groove, light, limb, line, makeCanvas, mix, mulberry32, polyPath, rgba,
  roundPolyPath, rrPath, vol, type G,
} from './util';

type Add = (key: string, c: HTMLCanvasElement, ax?: number, ay?: number) => void;

function canvas(w: number, h: number): [HTMLCanvasElement, G] {
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  return [c, g];
}

// ------------------------------------------------------------------ simple fx

function fxGlow(): HTMLCanvasElement {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.15, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.28)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.07)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}

function fxMuzzle(v: number): HTMLCanvasElement {
  const [c, g] = canvas(48, 32);
  const r = mulberry32(31 + v);
  g.translate(6, 16);
  g.globalCompositeOperation = 'lighter';
  glow(g, 6, 0, 16, P.amber, 0.7);
  const spikes = v === 0 ? [[0, 34, 5], [0.55, 14, 3.5], [-0.55, 14, 3.5], [1.4, 8, 2.5], [-1.4, 8, 2.5]] : [[0, 26, 6], [0.35, 20, 3.5], [-0.35, 20, 3.5], [0.9, 11, 3], [-0.9, 11, 3]];
  for (const [a, len, w] of spikes) {
    const L = len * (0.9 + r() * 0.2);
    g.save();
    g.rotate(a);
    for (const [col, k] of [[P.amber, 1], ['#ffe2a0', 0.65], ['#ffffff', 0.32]] as const) {
      g.beginPath();
      g.moveTo(0, -w * k);
      g.quadraticCurveTo(L * 0.4, -w * k * 0.8, L * (0.6 + k * 0.4), 0);
      g.quadraticCurveTo(L * 0.4, w * k * 0.8, 0, w * k);
      g.closePath();
      g.fillStyle = rgba(col, k === 1 ? 0.75 : 0.9);
      g.fill();
    }
    g.restore();
  }
  light(g, 2, 0, 3.5, '#fff4d0', 1, 2.5);
  return c;
}

/** Fireball -> smoke, frame i of 8. */
function fxExplosion(i: number): HTMLCanvasElement {
  const [c, g] = canvas(128, 128);
  g.translate(64, 64);
  const t = i / 7;
  const r = mulberry32(77);
  const blobs: [number, number, number, number][] = [];
  for (let k = 0; k < 22; k++) {
    const a = r() * TAU;
    const d = Math.sqrt(r());
    blobs.push([Math.cos(a) * d, Math.sin(a) * d, 0.35 + r() * 0.45, r()]);
  }
  const R = 16 + 44 * Math.pow(t, 0.55);
  // smoke (behind)
  if (t > 0.15) {
    const sa = Math.min(1, (t - 0.15) * 3) * (1 - Math.pow(t, 3) * 0.85);
    for (const [bx, by, br, bv] of blobs) {
      const x = bx * R * 0.75 + t * 4, y = by * R * 0.75 - t * 8;
      const rad = br * R * (0.75 + t * 0.4);
      const gr = g.createRadialGradient(x - rad * 0.35, y - rad * 0.35, 0, x, y, rad);
      const shade = 34 + bv * 26 + t * 18;
      gr.addColorStop(0, `rgba(${shade + 30},${shade + 26},${shade + 22},${0.85 * sa})`);
      gr.addColorStop(0.6, `rgba(${shade},${shade - 2},${shade - 4},${0.7 * sa})`);
      gr.addColorStop(1, `rgba(${shade - 10},${shade - 10},${shade - 10},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rad, 0, TAU);
      g.fill();
    }
  }
  // fire (additive)
  if (t < 0.75) {
    const fa = 1 - Math.pow(t / 0.75, 1.6);
    g.save();
    g.globalCompositeOperation = 'lighter';
    if (i === 0) {
      glow(g, 0, 0, 60, '#ffd27a', 0.9);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU + r() * 0.3;
        glowLine(g, [0, 0, Math.cos(a) * (26 + r() * 22), Math.sin(a) * (26 + r() * 22)], '#ffcf7a', 2.5, 0.8, 3);
      }
    }
    for (const [bx, by, br, bv] of blobs) {
      const x = bx * R * 0.6, y = by * R * 0.6 - t * 6;
      const rad = br * R * (0.7 - t * 0.25);
      const heat = Math.max(0, 1 - t * 1.6 - bv * 0.3);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(255,${200 + heat * 55},${120 + heat * 120},${0.9 * fa})`);
      gr.addColorStop(0.4, `rgba(255,${110 + heat * 80},${30 + heat * 40},${0.7 * fa})`);
      gr.addColorStop(1, 'rgba(160,30,10,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rad, 0, TAU);
      g.fill();
    }
    g.restore();
  }
  // embers
  if (t > 0.1 && t < 0.9) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 14; k++) {
      const a = r() * TAU;
      const d = R * (0.5 + r() * 0.8);
      light(g, Math.cos(a) * d, Math.sin(a) * d, 0.8, '#ff9a40', 1 - t, 2.5);
    }
    g.restore();
  }
  return c;
}

function fxSpark(): HTMLCanvasElement {
  const [c, g] = canvas(16, 16);
  g.translate(8, 8);
  glowLine(g, [-6, 0, 6, 0], '#ffd27a', 1.4, 1, 3);
  light(g, 5, 0, 1.2, '#ffffff', 1, 2);
  return c;
}

function fxSmoke(): HTMLCanvasElement {
  const [c, g] = canvas(64, 64);
  g.translate(32, 32);
  const r = mulberry32(11);
  for (let k = 0; k < 9; k++) {
    const a = r() * TAU;
    const d = r() * 12;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const rad = 10 + r() * 10;
    const gr = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(120,118,112,0.5)');
    gr.addColorStop(0.6, 'rgba(80,79,76,0.35)');
    gr.addColorStop(1, 'rgba(60,60,60,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, TAU);
    g.fill();
  }
  return c;
}

function fxDebris(v: number): HTMLCanvasElement {
  return renderSprite(16, 16, (L) => {
    const g = L.b;
    if (v === 0) vol(g, polyPath([-5, -3, 4, -4, 6, 2, -2, 4]), '#5c6168', [-5, -4, 11, 8], { hi: 0.4 });
    else if (v === 1) vol(g, polyPath([-4, -4, 3, -3, 5, 3, -3, 5, -5, 0]), '#77746c', [-5, -4, 10, 9], { hi: 0.4 });
    else {
      vol(g, rrPath(-5, -1.5, 10, 3, 0.8), '#7b4a2b', [-5, -1.5, 10, 3], { hi: 0.45 });
      light(L.e, 4, 0, 0.8, '#ff9a40', 0.8, 2);
    }
  }, { outline: 0.8 });
}

function fxRocket(): HTMLCanvasElement {
  return renderSprite(36, 14, (L) => {
    const g = L.b;
    glow(L.e, -12, 0, 10, P.amber, 0.8);
    glowLine(L.e, [-17, 0, -10, 0], '#ffd27a', 2.6, 1, 3);
    vol(g, rrPath(-10, -2.4, 18, 4.8, 2.2), '#8d8a74', [-10, -2.4, 18, 4.8], { hi: 0.4 });
    vol(g, polyPath([8, -2.4, 14, 0, 8, 2.4]), '#b0582a', [8, -2.4, 6, 4.8], { ow: 0.8 });
    vol(g, polyPath([-10, -2.4, -13, -4.4, -13, 4.4, -10, 2.4]), '#5d5a4c', [-13, -4.4, 3, 8.8], { rim: null, ow: 0.7 });
  }, { outline: 1 });
}

function fxShell(): HTMLCanvasElement {
  const [c, g] = canvas(20, 10);
  g.translate(10, 5);
  glowLine(g, [-8, 0, 5, 0], '#ff9a40', 1.6, 0.8, 3);
  light(g, 5, 0, 2.2, '#ffd27a', 1, 2.2);
  return c;
}

function fxRing(thick: boolean): HTMLCanvasElement {
  const [c, g] = canvas(64, 64);
  g.translate(32, 32);
  const R = thick ? 27 : 28.5;
  const w = thick ? 4.5 : 1.8;
  g.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * TAU + 0.12;
    const a1 = a0 + TAU / 4 - 0.24;
    g.beginPath();
    g.arc(0, 0, R, a0, a1);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = w + 2.5;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, R, a0, a1);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = w;
    g.stroke();
  }
  return c;
}

function fxMoveMarker(): HTMLCanvasElement {
  const [c, g] = canvas(48, 48);
  g.translate(24, 24);
  for (let k = 0; k < 4; k++) {
    g.save();
    g.rotate((k / 4) * TAU + TAU / 8);
    g.beginPath();
    g.moveTo(14, -6);
    g.lineTo(7, 0);
    g.lineTo(14, 6);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 4.5;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 2.4;
    g.stroke();
    g.restore();
  }
  g.beginPath();
  g.arc(0, 0, 2.2, 0, TAU);
  g.fillStyle = '#fff';
  g.fill();
  return c;
}

function fxRally(): HTMLCanvasElement {
  const [c, g] = canvas(48, 48);
  // base ring at the pole foot (anchor)
  g.translate(16, 38);
  g.save();
  g.scale(1, 0.5);
  g.beginPath();
  g.arc(0, 0, 9, 0, TAU);
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 2;
  g.stroke();
  g.restore();
  line(g, 0, 0, 0, -32, 'rgba(0,0,0,0.6)', 3.4);
  line(g, 0, 0, 0, -32, '#f2f2f2', 1.8);
  g.beginPath();
  g.moveTo(1, -32);
  g.bezierCurveTo(8, -35, 14, -27, 24, -31);
  g.lineTo(24, -19);
  g.bezierCurveTo(14, -15, 8, -23, 1, -20);
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 1;
  g.stroke();
  return c;
}

function fxHack(): HTMLCanvasElement {
  const [c, g] = canvas(64, 64);
  g.translate(32, 32);
  const r = mulberry32(404);
  const draw = (dx: number, col: string, a: number) => {
    g.save();
    g.translate(dx, 0);
    g.globalCompositeOperation = 'lighter';
    // broken hexagon
    const hx = regular(6, 20, TAU / 12);
    for (let i = 0; i < 6; i++) {
      if (i === 2) continue;
      const j = (i + 1) % 6;
      glowLine(g, [hx[i * 2], hx[i * 2 + 1], hx[j * 2], hx[j * 2 + 1]], col, 1.5, a, 3);
    }
    // inner brackets  < / >
    glowLine(g, [-6, -7, -11, 0, -6, 7], col, 1.6, a, 3);
    glowLine(g, [6, -7, 11, 0, 6, 7], col, 1.6, a, 3);
    glowLine(g, [2.5, -8, -2.5, 8], col, 1.4, a, 3);
    g.restore();
  };
  draw(-1.5, P.mag, 0.45);
  draw(1.5, P.cyan, 0.95);
  // glitch bars & bits
  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 7; k++) {
    const y = -26 + r() * 52;
    const x = -26 + r() * 30;
    g.fillStyle = rgba(r() < 0.7 ? P.cyan : P.mag, 0.35 + r() * 0.4);
    g.fillRect(x, y, 6 + r() * 20, 1.2 + r() * 1.5);
  }
  for (let k = 0; k < 10; k++) {
    g.fillStyle = rgba(P.cyan, 0.6);
    g.fillRect(-28 + r() * 56, -28 + r() * 56, 2, 2);
  }
  return c;
}

function fxEmpRing(): HTMLCanvasElement {
  const [c, g] = canvas(128, 128);
  g.translate(64, 64);
  const r = mulberry32(55);
  const gr = g.createRadialGradient(0, 0, 30, 0, 0, 62);
  gr.addColorStop(0, 'rgba(53,240,255,0)');
  gr.addColorStop(0.75, 'rgba(53,240,255,0.18)');
  gr.addColorStop(0.9, 'rgba(180,250,255,0.35)');
  gr.addColorStop(1, 'rgba(53,240,255,0)');
  g.fillStyle = gr;
  g.fillRect(-64, -64, 128, 128);
  const pts: number[] = [];
  for (let k = 0; k <= 72; k++) {
    const a = (k / 72) * TAU;
    const rad = 55 + (r() - 0.5) * 6;
    pts.push(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  glowLine(g, pts, P.cyan, 1.4, 0.95, 4);
  for (let k = 0; k < 9; k++) {
    const a = r() * TAU;
    const seg: number[] = [];
    let rad = 55;
    for (let s = 0; s < 5; s++) {
      seg.push(Math.cos(a + (r() - 0.5) * 0.12) * rad, Math.sin(a + (r() - 0.5) * 0.12) * rad);
      rad -= 4 + r() * 5;
    }
    glowLine(g, seg, '#bff8ff', 0.9, 0.8, 3);
  }
  return c;
}

// ------------------------------------------------------------------ creep

function wrapDraw(g: G, size: number, fn: (ox: number, oy: number) => void): void {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(ox, oy);
}

function fxCreepPattern(): HTMLCanvasElement {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = mulberry32(2024);
  const cell = 16;
  const N = S / cell;
  // faint territorial stain so the Grid reads as a field, not just lines
  const r2 = mulberry32(77);
  for (let k = 0; k < 14; k++) {
    const x = r2() * S, y = r2() * S, rad = 30 + r2() * 50;
    wrapDraw(g, S, (ox, oy) => {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, 'rgba(70,6,18,0.10)');
      gr.addColorStop(1, 'rgba(70,6,18,0)');
      g.fillStyle = gr;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    });
  }
  g.fillStyle = 'rgba(50,4,12,0.10)';
  g.fillRect(0, 0, S, S);
  const traces: { pts: number[]; lit: boolean; w: number }[] = [];
  for (let k = 0; k < 24; k++) {
    let x = Math.floor(r() * N), y = Math.floor(r() * N);
    const pts = [x * cell, y * cell];
    let dir = Math.floor(r() * 4) * 2;
    const n = 2 + Math.floor(r() * 4);
    for (let s2 = 0; s2 < n; s2++) {
      const dx = [1, 1, 0, -1, -1, -1, 0, 1][dir];
      const dy = [0, 1, 1, 1, 0, -1, -1, -1][dir];
      const len = 1 + Math.floor(r() * (dir % 2 ? 2 : 4));
      x += dx * len;
      y += dy * len;
      pts.push(x * cell, y * cell);
      dir = (dir + (r() < 0.5 ? 1 : 7)) % 8;
    }
    traces.push({ pts, lit: r() < 0.4, w: r() < 0.25 ? 2.4 : 1.4 });
  }
  const stroke = (pts: number[], ox: number, oy: number, col: string, w: number) => {
    g.beginPath();
    g.moveTo(pts[0] + ox, pts[1] + oy);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] + ox, pts[i + 1] + oy);
    g.strokeStyle = col;
    g.lineWidth = w;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
  };
  for (const t of traces) wrapDraw(g, S, (ox, oy) => stroke(t.pts, ox, oy, 'rgba(18,2,6,0.55)', t.w + 2.4));
  for (const t of traces) wrapDraw(g, S, (ox, oy) => stroke(t.pts, ox, oy, 'rgba(112,12,34,0.8)', t.w));
  for (const t of traces) if (t.lit) wrapDraw(g, S, (ox, oy) => stroke(t.pts, ox, oy, 'rgba(255,58,92,0.5)', 0.7));
  // vias at trace ends
  for (const t of traces) {
    for (const idx of [0, t.pts.length - 2]) {
      const x = t.pts[idx], y = t.pts[idx + 1];
      wrapDraw(g, S, (ox, oy) => {
        g.beginPath();
        g.arc(x + ox, y + oy, 2.6, 0, TAU);
        g.fillStyle = 'rgba(22,2,7,0.85)';
        g.fill();
        g.lineWidth = 1;
        g.strokeStyle = t.lit ? 'rgba(230,40,72,0.8)' : 'rgba(140,16,40,0.8)';
        g.stroke();
        if (t.lit) {
          g.beginPath();
          g.arc(x + ox, y + oy, 0.9, 0, TAU);
          g.fillStyle = 'rgba(255,120,140,0.9)';
          g.fill();
        }
      });
    }
  }
  // a couple of chip pads
  for (let k = 0; k < 2; k++) {
    const x = Math.floor(r() * N) * cell + cell / 2, y = Math.floor(r() * N) * cell + cell / 2;
    wrapDraw(g, S, (ox, oy) => {
      g.fillStyle = 'rgba(20,3,7,0.8)';
      g.fillRect(x + ox - 6, y + oy - 6, 12, 12);
      g.strokeStyle = 'rgba(150,20,46,0.75)';
      g.lineWidth = 1;
      g.strokeRect(x + ox - 6, y + oy - 6, 12, 12);
      for (let p = -4; p <= 4; p += 2.7) {
        g.fillStyle = 'rgba(150,20,46,0.7)';
        g.fillRect(x + ox + p - 0.5, y + oy - 9, 1, 3);
        g.fillRect(x + ox + p - 0.5, y + oy + 6, 1, 3);
      }
    });
  }
  return c;
}

function fxCreepNode(): HTMLCanvasElement {
  return renderSprite(64, 64, (L) => {
    const { b, e } = L;
    vol(b, polyPath(regular(6, 15, TAU / 12)), '#1a1d22', [-15, -15, 30, 30], { hi: 0.25, rim: 'rgba(200,210,225,0.3)' });
    vol(b, polyPath(regular(6, 9, TAU / 12)), '#0d0f12', [-9, -9, 18, 18], { hi: 0.15 });
    glow(e, 0, 0, 30, P.red, 0.45);
    e.save();
    e.globalCompositeOperation = 'lighter';
    e.beginPath();
    e.arc(0, 0, 22, 0, TAU);
    e.strokeStyle = rgba(P.red, 0.45);
    e.lineWidth = 1.2;
    e.setLineDash([4, 3]);
    e.stroke();
    e.restore();
    light(e, 0, 0, 3, P.red, 1, 2.6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      glowLine(e, [Math.cos(a) * 15, Math.sin(a) * 15, Math.cos(a) * 27, Math.sin(a) * 27], P.red, 0.9, 0.7, 3);
    }
  }, { outline: 1 });
}

// ------------------------------------------------------------------ scaffold

function fxScaffold(n: number): HTMLCanvasElement {
  const size = n * 64 + 32;
  const H = n * 32;
  const raw = renderSprite(size, size, (L) => {
    const { b, m } = L;
    const r = mulberry32(600 + n);
    const step = 32;
    const x0 = -H + 4, x1 = H - 4;
    // planks on some bays
    for (let gx = x0; gx < x1 - 1; gx += step) {
      for (let gy = x0; gy < x1 - 1; gy += step) {
        const edge = gx === x0 || gy === x0 || gx + step >= x1 - 1 || gy + step >= x1 - 1;
        if (!edge && r() < 0.6) continue;
        if (r() < 0.35) continue;
        const w = Math.min(step, x1 - gx);
        const hgt = Math.min(step, x1 - gy);
        for (let k = 0; k < 3; k++) {
          const py = gy + 2 + k * ((hgt - 4) / 3);
          vol(m, rrPath(gx + 1, py, w - 2, (hgt - 4) / 3 - 1, 0.6), mix(P.wood, '#8a6a42', r()), [gx, py, w, 8], { hi: 0.25, rim: null, ow: 0.6 });
        }
      }
    }
    // ledgers (pipes) on the grid
    const pipe = (ax: number, ay: number, bx: number, by: number) => limb(b, [ax, ay, bx, by], 2, '#8e9396', { hi: 0.5 });
    for (let v = x0; v <= x1 + 0.1; v += (x1 - x0) / Math.max(1, Math.round((x1 - x0) / step))) {
      pipe(x0, v, x1, v);
      pipe(v, x0, v, x1);
    }
    // diagonal braces on the outer bays
    const bays = Math.max(1, Math.round((x1 - x0) / step));
    const bs = (x1 - x0) / bays;
    for (let k = 0; k < bays; k++) {
      if (k % 2 === 0) {
        limb(b, [x0 + k * bs, x0, x0 + (k + 1) * bs, x0 + bs], 1.3, '#a3a8aa', { hi: 0.4 });
        limb(b, [x0 + k * bs, x1, x0 + (k + 1) * bs, x1 - bs], 1.3, '#a3a8aa', { hi: 0.4 });
      }
    }
    // couplers at nodes
    for (let i = 0; i <= bays; i++) {
      for (let j = 0; j <= bays; j++) {
        vol(b, circPath(x0 + i * bs, x0 + j * bs, 2.4), '#6c7174', [0, 0, 4, 4], { radial: true, rim: null, ow: 0.6 });
      }
    }
    // hazard tape across one corner
    b.save();
    b.translate(x1 - bs * 0.6, x0 + bs * 0.6);
    b.rotate(-Math.PI / 4);
    for (let k = -4; k < 4; k++) {
      b.fillStyle = k % 2 ? 'rgba(20,20,20,0.85)' : 'rgba(226,160,60,0.9)';
      b.fillRect(k * 5, -1.6, 5, 3.2);
    }
    b.restore();
    if (n >= 3) {
      // tarp hung on one side
      b.save();
      b.globalAlpha = 0.75;
      vol(b, rrPath(x0 + 2, x1 - 10, (x1 - x0) * 0.45, 9, 1), P.tarp, [x0, x1 - 10, (x1 - x0) * 0.45, 9], { hi: 0.25 });
      b.restore();
    }
  }, { shadow: { dx: 3, dy: 4, blur: 3, a: 0.45 }, mid: true, midShadow: { dx: 1.5, dy: 2, blur: 2, a: 0.4 }, outline: 0.9 });
  const [c, g] = canvas(size, size);
  g.globalAlpha = 0.88;
  g.drawImage(raw, 0, 0);
  return c;
}

// ------------------------------------------------------------------ resources / wrecks / decals

function girder(g: G, x0: number, y0: number, x1: number, y1: number, w: number, col: string): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0);
  g.save();
  g.translate(x0, y0);
  g.rotate(a);
  vol(g, rrPath(0, -w / 2, len, w, 0.8), col, [0, -w / 2, len, w], { hi: 0.4, lo: 0.45 });
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(1, -w * 0.12, len - 2, w * 0.24);
  for (let x = 6; x < len - 2; x += 8) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.arc(x, -w * 0.32, 0.7, 0, TAU);
    g.arc(x, w * 0.32, 0.7, 0, TAU);
    g.fill();
  }
  g.restore();
}

function panel(g: G, x: number, y: number, w: number, h: number, rot: number, col: string, seed: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  const pts = [-w / 2, -h / 2, w / 2 - 3, -h / 2 + 1, w / 2, h / 2 - 2, -w / 2 + 2, h / 2];
  vol(g, polyPath(pts), col, [-w / 2, -h / 2, w, h], { hi: 0.35, lo: 0.45 });
  grime(g, polyPath(pts), [-w / 2, -h / 2, w, h], seed, 30, 0.2, 0.2);
  groove(g, [-w / 2 + 3, 0, w / 2 - 3, 1], 0.45, 0.8);
  const gr = g.createRadialGradient(w * 0.2, h * 0.1, 0, w * 0.2, h * 0.1, w * 0.4);
  gr.addColorStop(0, 'rgba(110,60,28,0.55)');
  gr.addColorStop(1, 'rgba(110,60,28,0)');
  g.save();
  polyPath(pts)(g);
  g.clip();
  g.fillStyle = gr;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.restore();
  g.restore();
}

function glint(e: G, x: number, y: number, s: number): void {
  e.save();
  e.globalCompositeOperation = 'lighter';
  glow(e, x, y, s * 3, '#fff2d0', 0.5);
  e.strokeStyle = 'rgba(255,248,230,0.9)';
  e.lineWidth = 0.8;
  e.beginPath();
  e.moveTo(x - s * 2, y); e.lineTo(x + s * 2, y);
  e.moveTo(x, y - s * 2); e.lineTo(x, y + s * 2);
  e.stroke();
  e.restore();
}

function dirtPatch(p: G, rad: number, seed: number): void {
  const r = mulberry32(seed);
  for (let k = 0; k < 6; k++) {
    const x = (r() - 0.5) * rad * 0.6, y = (r() - 0.5) * rad * 0.6;
    const rr = rad * (0.5 + r() * 0.4);
    const gr = p.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(28,24,20,0.35)');
    gr.addColorStop(1, 'rgba(28,24,20,0)');
    p.fillStyle = gr;
    p.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
}

function resScrap(v: number): HTMLCanvasElement {
  return renderSprite(96, 96, (L) => {
    const { p, m, b, e } = L;
    dirtPatch(p, 40, 700 + v);
    scrapBits(m, 0, 2, 30, 710 + v, 26, e);
    if (v === 0) {
      girder(b, -26, -14, 22, 10, 7, '#7a4a2b');
      girder(b, -20, 16, 26, -10, 6, '#6b5a48');
      scrapBits(b, 6, -12, 10, 720, 6, e);
      glint(e, 12, -2, 1.6);
    } else if (v === 1) {
      tyre(b, -12, -8, 11);
      tyre(b, 8, 6, 10);
      tyre(b, -6, 2, 9.5);
      panel(b, 18, -14, 16, 12, 0.5, '#4f5a63', 731);
      glint(e, 20, -16, 1.5);
    } else if (v === 2) {
      panel(b, -10, -6, 30, 20, -0.3, '#5d4b3b', 741);
      panel(b, 10, 8, 24, 16, 0.6, '#3f5058', 742);
      limb(b, [-24, 14, 2, 22], 3.2, '#6b6e70', { hi: 0.45 });
      glint(e, -4, -12, 1.7);
      glint(e, 16, 4, 1.2);
    } else {
      // engine block + drums
      vol(b, rrPath(-14, -12, 26, 20, 3), '#4c4f52', [-14, -12, 26, 20], { hi: 0.35 });
      for (let k = 0; k < 4; k++) vol(b, circPath(-8 + k * 5.5, -2, 2.2), '#2a2c2e', [0, 0, 4, 4], { radial: true, rim: null, ow: 0.6 });
      groove(b, [-12, 4, 10, 4], 0.4, 0.8);
      drum(b, 18, 10, 6, '#6a3d22');
      drum(b, -20, 14, 5.5, '#3d4a3a');
      girder(b, -24, -20, 8, -24, 5, '#7a4a2b');
      glint(e, 0, -10, 1.6);
    }
  }, { shadow: { dx: 3, dy: 4, blur: 4, a: 0.5 }, mid: true, outline: 1.1 });
}

const DEAD: TeamPal = { glow: '#3a1209', glow2: '#2a0d07', hot: '#5a2410', mark: '#000000', hacked: false };

function wreck(size: 'small' | 'medium' | 'large', v: number): HTMLCanvasElement {
  const S = size === 'small' ? 1 : size === 'medium' ? 1.6 : 2.5;
  const cs = size === 'small' ? 80 : size === 'medium' ? 120 : 176;
  const choices: Record<string, [(L: Layers, p: TeamPal, f: number) => void, string][]> = {
    small: [[drawSkitter, 'skitter'], [drawSapper, 'sapper']],
    medium: [[drawGunner, 'gunner'], [drawLancer, 'lancer']],
    large: [[drawBrute, 'brute'], [drawBrute, 'brute']],
  };
  const [draw, kind] = choices[size][v];
  const r = mulberry32(800 + v * 7 + Math.round(S * 10));
  const bs = ROBOT_CANVAS[kind];
  const body = renderSprite(bs, bs, (L) => draw(L, DEAD, 1 + v * 2), { shadow: null, outline: 1.2 });
  // char, heat-tint and break the carcass
  const t = makeCanvas(bs, bs);
  const tg = ctxOf(t);
  tg.drawImage(body, 0, 0);
  tg.globalCompositeOperation = 'source-atop';
  tg.fillStyle = 'rgba(26,18,12,0.42)';
  tg.fillRect(0, 0, bs, bs);
  for (let k = 0; k < 7; k++) {
    const x = bs / 2 + (r() - 0.5) * bs * 0.6, y = bs / 2 + (r() - 0.5) * bs * 0.6, rad = bs * (0.08 + r() * 0.16);
    const gr = tg.createRadialGradient(x, y, 0, x, y, rad);
    const heat = r() < 0.35;
    gr.addColorStop(0, heat ? 'rgba(120,52,22,0.35)' : 'rgba(4,3,2,0.65)');
    gr.addColorStop(1, 'rgba(4,3,2,0)');
    tg.fillStyle = gr;
    tg.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  tg.globalCompositeOperation = 'destination-out';
  const cuts = 2 + Math.floor(r() * 3);
  for (let k = 0; k < cuts; k++) {
    const a = r() * TAU;
    const d = bs * (0.28 + r() * 0.18);
    const cx = bs / 2 + Math.cos(a) * d, cy = bs / 2 + Math.sin(a) * d;
    const rad = bs * (0.1 + r() * 0.1);
    tg.beginPath();
    for (let i = 0; i < 7; i++) {
      const aa = (i / 7) * TAU;
      const rr = rad * (0.5 + r() * 0.7);
      if (i === 0) tg.moveTo(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr);
      else tg.lineTo(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr);
    }
    tg.closePath();
    tg.fill();
  }
  // a crack straight through
  tg.beginPath();
  let px = bs * (0.3 + r() * 0.1), py = bs * (0.25 + r() * 0.5);
  tg.moveTo(px, py);
  for (let i = 0; i < 5; i++) {
    px += bs * 0.09;
    py += (r() - 0.5) * bs * 0.12;
    tg.lineTo(px, py);
  }
  tg.lineWidth = 1.6 * S;
  tg.stroke();
  const rot = r() * TAU;
  return renderSprite(cs, cs, (L) => {
    const { p, m, b, e } = L;
    // scorch on the ground
    const gr = p.createRadialGradient(0, 0, 0, 0, 0, 30 * S);
    gr.addColorStop(0, 'rgba(8,6,5,0.6)');
    gr.addColorStop(0.6, 'rgba(10,8,6,0.3)');
    gr.addColorStop(1, 'rgba(10,8,6,0)');
    p.fillStyle = gr;
    p.fillRect(-32 * S, -32 * S, 64 * S, 64 * S);
    soot(p, S, r);
    // loose fragments and severed limbs
    const nf = 3 + Math.floor(r() * 3);
    for (let k = 0; k < nf; k++) {
      const a = r() * TAU;
      const d = (13 + r() * 9) * S;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (r() < 0.5) {
        const a2 = a + (r() - 0.5) * 2;
        const len = (5 + r() * 6) * S;
        limb(m, [x, y, x + Math.cos(a2) * len, y + Math.sin(a2) * len], (1.6 + r() * 1.2) * Math.sqrt(S), '#27292c', { hi: 0.16 });
      } else {
        const rad = (2.5 + r() * 3) * Math.sqrt(S);
        const pts: number[] = [];
        for (let i = 0; i < 5; i++) {
          const aa = (i / 5) * TAU + r() * 0.6;
          pts.push(x + Math.cos(aa) * rad * (0.6 + r() * 0.5), y + Math.sin(aa) * rad * (0.6 + r() * 0.5));
        }
        vol(m, roundPolyPath(pts, 0.8), mix(P.ax3, '#2a1f18', r() * 0.6), [x - rad, y - rad, rad * 2, rad * 2], { hi: 0.18, rim: 'rgba(170,180,190,0.25)', ow: 0.8 });
      }
    }
    b.save();
    b.rotate(rot);
    b.drawImage(t, -bs / 2, -bs / 2);
    b.restore();
    // embers + a dying optic
    for (let k = 0; k < 4 + S * 3; k++) light(e, (r() - 0.5) * 22 * S, (r() - 0.5) * 22 * S, 0.7, '#ff7a2a', 0.45 + r() * 0.35, 3);
    light(e, Math.cos(rot) * 6 * S, Math.sin(rot) * 6 * S, 1.1 * Math.sqrt(S), AXIOM_PAL.glow, 0.3, 2.4);
  }, { shadow: { dx: 2, dy: 3, blur: 3, a: 0.5 }, mid: true, outline: 0.8 });
}

function soot(p: G, S: number, r: () => number): void {
  // soot streaks radiating
  for (let k = 0; k < 10; k++) {
    const a = r() * TAU;
    const len = (14 + r() * 16) * S;
    p.beginPath();
    p.moveTo(0, 0);
    p.lineTo(Math.cos(a - 0.08) * len, Math.sin(a - 0.08) * len);
    p.lineTo(Math.cos(a + 0.08) * len, Math.sin(a + 0.08) * len);
    p.closePath();
    p.fillStyle = 'rgba(5,4,3,0.25)';
    p.fill();
  }
}

function decalScorch(v: number): HTMLCanvasElement {
  const [c, g] = canvas(128, 128);
  g.translate(64, 64);
  const r = mulberry32(950 + v);
  for (let k = 0; k < 7; k++) {
    const x = (r() - 0.5) * 22, y = (r() - 0.5) * 22, rad = 22 + r() * 24;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(6,5,4,0.42)');
    gr.addColorStop(0.5, 'rgba(8,6,5,0.22)');
    gr.addColorStop(1, 'rgba(8,6,5,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let k = 0; k < 18; k++) {
    const a = r() * TAU;
    const len = 30 + r() * 30;
    const w = 0.05 + r() * 0.08;
    const gr = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    gr.addColorStop(0, 'rgba(5,4,3,0.4)');
    gr.addColorStop(1, 'rgba(5,4,3,0)');
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a - w) * len, Math.sin(a - w) * len);
    g.lineTo(Math.cos(a + w) * len, Math.sin(a + w) * len);
    g.closePath();
    g.fillStyle = gr;
    g.fill();
  }
  // ash speckles
  for (let k = 0; k < 60; k++) {
    const a = r() * TAU, d = r() * 44;
    g.fillStyle = r() < 0.7 ? 'rgba(0,0,0,0.35)' : 'rgba(150,140,130,0.2)';
    g.fillRect(Math.cos(a) * d, Math.sin(a) * d, 1.2, 1.2);
  }
  return c;
}

function decalCrater(v: number): HTMLCanvasElement {
  const [c, g] = canvas(128, 128);
  g.translate(64, 64);
  const r = mulberry32(980 + v);
  const R = v === 0 ? 30 : 22;
  // ejecta
  for (let k = 0; k < 90; k++) {
    const a = r() * TAU, d = R * (0.9 + r() * 0.9);
    const s = 0.8 + r() * 2.2;
    g.fillStyle = r() < 0.5 ? 'rgba(80,72,60,0.6)' : 'rgba(20,18,16,0.5)';
    g.fillRect(Math.cos(a) * d, Math.sin(a) * d, s, s);
  }
  const eg = g.createRadialGradient(0, 0, R * 0.8, 0, 0, R * 1.7);
  eg.addColorStop(0, 'rgba(70,62,52,0.55)');
  eg.addColorStop(1, 'rgba(70,62,52,0)');
  g.fillStyle = eg;
  g.fillRect(-64, -64, 128, 128);
  // rim
  const rim: number[] = [];
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * TAU;
    const rr = R * (1 + (r() - 0.5) * 0.18);
    rim.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const path = roundPolyPath(rim, 3);
  g.save();
  path(g);
  g.fillStyle = '#2b2722';
  g.fill();
  g.clip();
  // bowl: near (top-left) inner wall in shadow, far (bottom-right) wall lit
  const bg = g.createLinearGradient(-R, -R, R, R);
  bg.addColorStop(0, 'rgba(0,0,0,0.65)');
  bg.addColorStop(0.55, 'rgba(0,0,0,0.25)');
  bg.addColorStop(1, 'rgba(150,135,110,0.3)');
  g.fillStyle = bg;
  g.fillRect(-R, -R, R * 2, R * 2);
  const cg = g.createRadialGradient(R * 0.1, R * 0.1, 0, 0, 0, R * 0.6);
  cg.addColorStop(0, 'rgba(0,0,0,0.45)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = cg;
  g.fillRect(-R, -R, R * 2, R * 2);
  for (let k = 0; k < 8; k++) {
    const x = (r() - 0.5) * R, y = (r() - 0.5) * R;
    g.fillStyle = 'rgba(90,85,78,0.6)';
    g.fillRect(x, y, 2 + r() * 2, 1.5 + r() * 2);
  }
  g.restore();
  // rim highlight (top-left outer lip lit) and dark lower-right outer lip
  g.save();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(140,128,108,0.55)';
  g.beginPath();
  g.arc(0, 0, R + 1, Math.PI * 0.95, Math.PI * 1.75);
  g.stroke();
  g.strokeStyle = 'rgba(10,8,6,0.5)';
  g.beginPath();
  g.arc(0, 0, R + 1.5, -0.1, Math.PI * 0.75);
  g.stroke();
  g.restore();
  return c;
}

// ------------------------------------------------------------------ registration

export function buildFx(add: Add): void {
  add('fx:glow', fxGlow());
  for (let v = 0; v < 2; v++) add(`fx:muzzle:${v}`, fxMuzzle(v), 6 / 48, 0.5);
  for (let i = 0; i < 8; i++) add(`fx:explosion:${i}`, fxExplosion(i));
  add('fx:spark', fxSpark());
  add('fx:smoke', fxSmoke());
  for (let v = 0; v < 3; v++) add(`fx:debris:${v}`, fxDebris(v));
  add('fx:rocket', fxRocket());
  add('fx:shell', fxShell());
  add('fx:ring', fxRing(false));
  add('fx:ring_thick', fxRing(true));
  add('fx:move_marker', fxMoveMarker());
  add('fx:rally', fxRally(), 16 / 48, 38 / 48);
  add('fx:hack', fxHack());
  add('fx:emp_ring', fxEmpRing());
  add('fx:creep_pattern', fxCreepPattern());
  add('fx:creep_node', fxCreepNode());
  for (let n = 1; n <= 5; n++) add(`fx:scaffold:${n}`, fxScaffold(n));
  for (let v = 0; v < 4; v++) add(`res:scrap:${v}`, resScrap(v));
  for (const s of ['small', 'medium', 'large'] as const) for (let v = 0; v < 2; v++) add(`wreck:${s}:${v}`, wreck(s, v));
  for (let v = 0; v < 3; v++) add(`decal:scorch:${v}`, decalScorch(v));
  for (let v = 0; v < 2; v++) add(`decal:crater:${v}`, decalCrater(v));
}

export type { Layers };
