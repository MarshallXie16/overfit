// 96x96 UI icons: portrait panels for units/buildings, glyphs for research, protocols and commands.
import { P, AXIOM_PAL, HACKED_PAL } from './palette';
import { renderSprite, type Layers } from './sprite';
import { regular } from './kit';
import {
  TAU, circPath, ctxOf, glow, glowLine, groove, light, limb, line, makeCanvas, polyPath, rgba, rivets, rrPath, vol,
  type G, mix, roundPolyPath,
} from './util';

export const ICON = 96;
const PANEL = rrPath(3, 3, 90, 90, 12);

function panel(accent: string, team: 'human' | 'axiom' | 'neutral' | 'glyph'): [HTMLCanvasElement, G] {
  const c = makeCanvas(ICON, ICON);
  const g = ctxOf(c);
  PANEL(g);
  const bg = g.createLinearGradient(0, 3, 0, 93);
  if (team === 'axiom') {
    bg.addColorStop(0, '#231a1e');
    bg.addColorStop(1, '#0f0b0d');
  } else if (team === 'human') {
    bg.addColorStop(0, '#1b2224');
    bg.addColorStop(1, '#0c0f10');
  } else {
    bg.addColorStop(0, '#1e2125');
    bg.addColorStop(1, '#0e1012');
  }
  g.fillStyle = bg;
  g.fill();
  g.save();
  PANEL(g);
  g.clip();
  // fine diagonal hatch
  g.strokeStyle = 'rgba(255,255,255,0.025)';
  g.lineWidth = 1;
  for (let i = -96; i < 96; i += 5) {
    g.beginPath();
    g.moveTo(i, 96);
    g.lineTo(i + 96, 0);
    g.stroke();
  }
  // accent radial wash
  const rg = g.createRadialGradient(48, 52, 4, 48, 52, 52);
  rg.addColorStop(0, rgba(accent, 0.16));
  rg.addColorStop(1, rgba(accent, 0));
  g.fillStyle = rg;
  g.fillRect(0, 0, 96, 96);
  g.restore();
  return [c, g];
}

function frame(g: G, accent: string): void {
  // vignette + border + tactical corner ticks
  g.save();
  PANEL(g);
  g.clip();
  const vg = g.createRadialGradient(48, 48, 30, 48, 48, 70);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = vg;
  g.fillRect(0, 0, 96, 96);
  const sh = g.createLinearGradient(0, 3, 0, 30);
  sh.addColorStop(0, 'rgba(255,255,255,0.07)');
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fillRect(0, 0, 96, 30);
  g.restore();
  PANEL(g);
  g.strokeStyle = 'rgba(0,0,0,0.9)';
  g.lineWidth = 2.5;
  g.stroke();
  rrPath(4.5, 4.5, 87, 87, 11)(g);
  g.strokeStyle = rgba(accent, 0.5);
  g.lineWidth = 1.2;
  g.stroke();
  g.strokeStyle = rgba(accent, 0.95);
  g.lineWidth = 2;
  g.lineCap = 'round';
  for (const [x, y, dx, dy] of [[9, 9, 1, 1], [87, 9, -1, 1], [9, 87, 1, -1], [87, 87, -1, -1]]) {
    g.beginPath();
    g.moveTo(x, y + dy * 8);
    g.lineTo(x, y);
    g.lineTo(x + dx * 8, y);
    g.stroke();
  }
}

function placeCentered(g: G, src: HTMLCanvasElement, maxSize: number, dy = 0): void {
  const s = Math.min(1, maxSize / Math.max(src.width, src.height));
  const w = src.width * s, h = src.height * s;
  g.save();
  PANEL(g);
  g.clip();
  g.drawImage(src, 48 - w / 2, 48 - h / 2 + dy, w, h);
  g.restore();
}

/** Icon from a sprite draw function rendered at `scale` (crisp, not resampled). */
export function spriteIcon(accent: string, team: 'human' | 'axiom' | 'neutral', size: number, scale: number, draw: (L: Layers) => void, rot = -Math.PI / 4): HTMLCanvasElement {
  const [c, g] = panel(accent, team);
  const spr = renderSprite(size, size, draw, { scale, rotate: rot, shadow: { dx: 2.5, dy: 3.5, blur: 4, a: 0.65 } });
  placeCentered(g, spr, 200);
  frame(g, accent);
  return c;
}

/** Icon from an existing (building) canvas, downscaled to fit. */
export function canvasIcon(accent: string, team: 'human' | 'axiom' | 'neutral', src: HTMLCanvasElement, fit = 84): HTMLCanvasElement {
  const [c, g] = panel(accent, team);
  placeCentered(g, src, fit);
  frame(g, accent);
  return c;
}

function glyphIcon(accent: string, draw: (L: Layers) => void, level = 0): HTMLCanvasElement {
  const [c, g] = panel(accent, 'glyph');
  const spr = renderSprite(96, 96, draw, { shadow: { dx: 2, dy: 3, blur: 3, a: 0.6 }, outline: 1.6 });
  placeCentered(g, spr, 96);
  if (level > 0) {
    // tier pips (bottom-right)
    vol(g, rrPath(66, 72, 20, 13, 4), '#0b0d0f', [66, 72, 20, 13], { hi: 0.1, rim: null, outline: rgba(accent, 0.6), ow: 1 });
    for (let i = 0; i < level; i++) {
      const x = 76 - (level - 1) * 2.8 + i * 5.6;
      g.fillStyle = accent;
      g.fillRect(x - 1.3, 75.5, 2.6, 6);
    }
  }
  frame(g, accent);
  return c;
}

// ------------------------------------------------------------------ glyph pieces

function bolt(L: Layers, x: number, y: number, s: number, color: string): void {
  const pts = [x + 2 * s, y - 14 * s, x - 7 * s, y + 2 * s, x - 1 * s, y + 2 * s, x - 4 * s, y + 14 * s, x + 7 * s, y - 3 * s, x + 1 * s, y - 3 * s];
  vol(L.b, polyPath(pts), mix(color, '#ffffff', 0.35), [x - 7 * s, y - 14 * s, 14 * s, 28 * s], { hi: 0.45, lo: 0.25 });
  glow(L.e, x, y, 26 * s, color, 0.45);
}

function bullet(L: Layers, x: number, y: number, s: number, tip: string): void {
  const g = L.b;
  vol(g, rrPath(x - 4 * s, y - 2 * s, 8 * s, 16 * s, 1.5 * s), '#c79a45', [x - 4 * s, y - 2 * s, 8 * s, 16 * s], { hi: 0.45 });
  line(g, x - 4 * s, y + 11 * s, x + 4 * s, y + 11 * s, 'rgba(0,0,0,0.35)', 1);
  vol(g, (gg) => { gg.beginPath(); gg.moveTo(x - 4 * s, y - 2 * s); gg.quadraticCurveTo(x - 4 * s, y - 12 * s, x, y - 15 * s); gg.quadraticCurveTo(x + 4 * s, y - 12 * s, x + 4 * s, y - 2 * s); gg.closePath(); },
    tip, [x - 4 * s, y - 15 * s, 8 * s, 13 * s], { hi: 0.5 });
}

function gear(g: G, x: number, y: number, r: number, color: string): void {
  const pts: number[] = [];
  const teeth = 8;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * TAU;
    const rr = i % 2 ? r * 0.78 : r;
    pts.push(x + Math.cos(a - 0.12) * rr, y + Math.sin(a - 0.12) * rr, x + Math.cos(a + 0.12) * rr, y + Math.sin(a + 0.12) * rr);
  }
  vol(g, polyPath(pts), color, [x - r, y - r, r * 2, r * 2], { hi: 0.4, lo: 0.45 });
  vol(g, circPath(x, y, r * 0.32), '#121416', [x - r * 0.3, y - r * 0.3, r * 0.6, r * 0.6], { radial: true, hi: 0.1 });
}

function wrench(g: G, x0: number, y0: number, x1: number, y1: number, color: string): void {
  limb(g, [x0, y0, x1, y1], 6, color, { hi: 0.45 });
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.save();
  g.translate(x1, y1);
  g.rotate(a);
  vol(g, (gg) => { gg.beginPath(); gg.arc(4, 0, 8, 0.9, TAU - 0.9); gg.lineTo(4 + Math.cos(0.9) * 3, -3.5); gg.lineTo(4 + Math.cos(0.9) * 3, 3.5); gg.closePath(); }, color, [-4, -8, 16, 16], { hi: 0.45 });
  g.restore();
}

function reticle(L: Layers, r: number, color: string): void {
  const g = L.b;
  g.save();
  g.lineCap = 'round';
  for (const [w, c] of [[6, 'rgba(0,0,0,0.75)'], [3, color]] as const) {
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.strokeStyle = c;
    g.lineWidth = w;
    g.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      g.beginPath();
      g.moveTo(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8));
      g.lineTo(Math.cos(a) * (r + 9), Math.sin(a) * (r + 9));
      g.stroke();
    }
  }
  g.restore();
  light(L.e, 0, 0, 3, color, 1, 3);
}

function hackBrackets(L: Layers, s: number, color: string): void {
  glowLine(L.e, [-10 * s, -16 * s, -22 * s, 0, -10 * s, 16 * s], color, 3.2 * s, 1, 3);
  glowLine(L.e, [10 * s, -16 * s, 22 * s, 0, 10 * s, 16 * s], color, 3.2 * s, 1, 3);
  glowLine(L.e, [4 * s, -18 * s, -4 * s, 18 * s], color, 2.8 * s, 1, 3);
  glowLine(L.e, [-12 * s, -16 * s, -24 * s, 0, -12 * s, 16 * s], P.mag, 1.2 * s, 0.4, 2);
}

function shield(L: Layers, s: number, color: string, edge: string): void {
  const pts = (k: number) => {
    const out: number[] = [];
    out.push(0, -30 * k);
    out.push(24 * k, -22 * k);
    out.push(22 * k, 6 * k);
    out.push(0, 30 * k);
    out.push(-22 * k, 6 * k);
    out.push(-24 * k, -22 * k);
    return out;
  };
  vol(L.b, roundPolyPath(pts(s), 5), edge, [-24 * s, -30 * s, 48 * s, 60 * s], { hi: 0.4 });
  vol(L.b, roundPolyPath(pts(s * 0.8), 4), color, [-20 * s, -24 * s, 40 * s, 48 * s], { hi: 0.35 });
}

// ------------------------------------------------------------------ registry

const KIN = '#f2a33a';
const ENE = '#35f0ff';
const EXP = '#ff7a2a';
const ARM = '#b9a878';
const CMD = '#9fc7c4';

export function researchIcons(): Record<string, HTMLCanvasElement> {
  const out: Record<string, HTMLCanvasElement> = {};
  out.railguns = glyphIcon(P.teal, (L) => {
    L.b.rotate(-0.62); L.e.rotate(-0.62);
    vol(L.b, rrPath(-34, -4, 14, 8, 2), P.gunD, [-34, -4, 14, 8], { hi: 0.3 });
    vol(L.b, rrPath(-22, -4.5, 26, 9, 1.5), '#3e454b', [-22, -4.5, 26, 9], { hi: 0.35 });
    limb(L.b, [2, -3, 30, -3], 2.2, P.gunL, { hi: 0.5 });
    limb(L.b, [2, 3, 30, 3], 2.2, P.gunL, { hi: 0.5 });
    vol(L.b, rrPath(-16, -10, 16, 5, 2.5), '#262b30', [-16, -10, 16, 5], { hi: 0.4 });
    glowLine(L.e, [-8, 0, 30, 0], P.teal, 1.6, 1, 3);
    glowLine(L.e, [32, 0, 46, 0], '#d6fffb', 2.6, 0.9, 3.5);
  });
  for (const lvl of [1, 2]) {
    out[`kinetic${lvl}`] = glyphIcon(KIN, (L) => {
      const tip = lvl === 1 ? '#b8743a' : '#5b6168';
      L.b.rotate(0.3); L.e.rotate(0.3);
      bullet(L, -14, 2, 1.25, tip);
      bullet(L, 0, -2, 1.35, tip);
      bullet(L, 14, 2, 1.25, tip);
      if (lvl === 2) glow(L.e, 0, -18, 16, KIN, 0.4);
    }, lvl);
    out[`energy${lvl}`] = glyphIcon(ENE, (L) => {
      if (lvl === 1) {
        vol(L.b, rrPath(-14, -24, 28, 46, 8), '#3a4248', [-14, -24, 28, 46], { hi: 0.4 });
        for (const y of [-12, 0, 12]) {
          L.b.fillStyle = '#0a2a2e';
          L.b.fillRect(-14, y - 2, 28, 4);
          glowLine(L.e, [-13, y, 13, y], ENE, 1.6, 0.9, 3);
        }
        vol(L.b, rrPath(-6, -29, 12, 6, 2), P.gunL, [-6, -29, 12, 6], { hi: 0.4 });
      } else {
        vol(L.b, circPath(0, 0, 24), '#7a4f2e', [-24, -24, 48, 48], { radial: true, hi: 0.4 });
        vol(L.b, circPath(0, 0, 13), '#3a4248', [-13, -13, 26, 26], { radial: true, hi: 0.35 });
        L.e.save();
        L.e.globalCompositeOperation = 'lighter';
        L.e.beginPath();
        L.e.arc(0, 0, 18.5, 0, TAU);
        L.e.strokeStyle = rgba(ENE, 0.8);
        L.e.lineWidth = 2;
        L.e.stroke();
        L.e.restore();
      }
      bolt(L, 4, 2, 1.05, ENE);
    }, lvl);
    out[`explosive${lvl}`] = glyphIcon(EXP, (L) => {
      // blast star
      const star: number[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const r = i % 2 ? 14 : lvl === 1 ? 28 : 34;
        star.push(Math.cos(a) * r, Math.sin(a) * r - 2);
      }
      vol(L.b, polyPath(star), lvl === 1 ? '#e0742c' : '#f08a2a', [-30, -32, 60, 60], { hi: 0.5, lo: 0.35 });
      glow(L.e, 0, -2, 40, EXP, 0.5);
      light(L.e, 0, -2, 7, '#ffd27a', 1, 2.5);
      if (lvl === 1) {
        // shaped charge cone
        vol(L.b, polyPath([-12, 26, 12, 26, 6, 8, -6, 8]), P.olive, [-12, 8, 24, 18], { hi: 0.35 });
        vol(L.b, rrPath(-13, 24, 26, 6, 2), '#3a3f2a', [-13, 24, 26, 6], { hi: 0.3 });
      }
    }, lvl);
    out[`armor${lvl}`] = glyphIcon(ARM, (L) => {
      shield(L, 1, lvl === 1 ? '#6a6f58' : '#5b6146', '#8d8a72');
      if (lvl === 1) {
        groove(L.b, [-16, -6, 16, -6], 0.5, 1.2);
        groove(L.b, [-14, 8, 14, 8], 0.5, 1.2);
        rivets(L.b, [-14, -16, 14, -16, -14, 0, 14, 0, -10, 14, 10, 14], 1.4, '#9a9580');
      } else {
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          if (Math.abs(i) + Math.abs(j) > 1 && j > 0) continue;
          vol(L.b, rrPath(i * 13 - 5.5, j * 13 - 6, 11, 11, 1.5), '#a65d2e', [i * 13 - 5.5, j * 13 - 6, 11, 11], { hi: 0.4, ow: 1 });
        }
      }
      L.e.save();
      L.e.globalCompositeOperation = 'lighter';
      roundPolyPath([0, -30, 24, -22, 22, 6, 0, 30, -22, 6, -24, -22], 5)(L.e);
      L.e.strokeStyle = rgba(P.teal, 0.6);
      L.e.lineWidth = 1.4;
      L.e.stroke();
      L.e.restore();
    }, lvl);
  }
  out.salvage = glyphIcon(KIN, (L) => {
    gear(L.b, -6, -4, 22, '#6a7076');
    wrench(L.b, 20, 24, -2, 2, '#c08a35');
    light(L.e, -6, -4, 2, KIN, 0.8, 3);
  });
  out.bandwidth = glyphIcon(P.teal, (L) => {
    limb(L.b, [0, 28, 0, -10], 3.5, P.gunL, { hi: 0.45 });
    limb(L.b, [-12, 28, 0, 0, 12, 28], 2.4, P.gun, { hi: 0.35 });
    light(L.e, 0, -12, 3.2, P.teal, 1, 3);
    for (const r of [12, 21, 30]) {
      for (const s of [-1, 1]) {
        L.e.save();
        L.e.globalCompositeOperation = 'lighter';
        L.e.beginPath();
        L.e.arc(0, -12, r, s < 0 ? Math.PI * 0.7 : -Math.PI * 0.3, s < 0 ? Math.PI * 1.3 : Math.PI * 0.3);
        L.e.strokeStyle = rgba(P.teal, 0.95 - r / 50);
        L.e.lineWidth = 2.6;
        L.e.lineCap = 'round';
        L.e.stroke();
        L.e.restore();
      }
    }
  });
  out.proto_emp = glyphIcon(ENE, (L) => {
    const e = L.e;
    e.save();
    e.globalCompositeOperation = 'lighter';
    for (const [r, a] of [[30, 0.9], [22, 0.5]] as const) {
      e.beginPath();
      e.arc(0, 0, r, 0, TAU);
      e.strokeStyle = rgba(ENE, a);
      e.lineWidth = 2.5;
      e.setLineDash(r === 30 ? [9, 4] : []);
      e.stroke();
    }
    e.restore();
    glow(e, 0, 0, 40, ENE, 0.35);
    bolt(L, 1, 0, 1, ENE);
  });
  out.proto_orbital = glyphIcon('#ff5a3a', (L) => {
    // beam from orbit onto a reticle
    glowLine(L.e, [0, -44, 0, 6], '#ffd9a0', 5, 0.9, 3);
    reticle(L, 18, '#ff5a3a');
    vol(L.b, rrPath(-8, -36, 16, 9, 2), P.gunL, [-8, -36, 16, 9], { hi: 0.45 });
    vol(L.b, rrPath(-24, -34, 13, 5, 1), '#1e2a33', [-24, -34, 13, 5], { hi: 0.4, rim: 'rgba(200,220,240,0.4)' });
    vol(L.b, rrPath(11, -34, 13, 5, 1), '#1e2a33', [11, -34, 13, 5], { hi: 0.4, rim: 'rgba(200,220,240,0.4)' });
    light(L.e, 0, 8, 6, '#ffd27a', 1, 3);
  });
  out.proto_override = glyphIcon(P.red, (L) => {
    const e = L.e;
    e.save();
    e.globalCompositeOperation = 'lighter';
    e.beginPath();
    e.moveTo(-26, -16); e.lineTo(26, -16); e.lineTo(0, 28); e.closePath();
    e.strokeStyle = rgba(P.red, 0.9);
    e.lineWidth = 3;
    e.stroke();
    e.restore();
    light(e, 0, -3, 5, P.red, 1, 3);
    hackBrackets(L, 1.15, P.cyan);
  });
  out.proto_supply = glyphIcon(KIN, (L) => {
    const g = L.b;
    vol(g, (gg) => { gg.beginPath(); gg.moveTo(-28, -10); gg.quadraticCurveTo(0, -46, 28, -10); gg.quadraticCurveTo(14, -16, 0, -12); gg.quadraticCurveTo(-14, -16, -28, -10); gg.closePath(); }, '#8a7e5b', [-28, -36, 56, 26], { hi: 0.4 });
    for (const x of [-28, -9, 9, 28]) line(g, x, -10, x * 0.3, 10, 'rgba(220,210,180,0.7)', 1);
    vol(g, rrPath(-13, 8, 26, 22, 2), P.wood, [-13, 8, 26, 22], { hi: 0.35 });
    g.strokeStyle = '#3e2f1c';
    g.lineWidth = 2;
    g.strokeRect(-11, 10, 22, 18);
    line(g, -11, 10, 11, 28, '#3e2f1c', 2);
    g.fillStyle = rgba(P.teal, 0.9);
    g.fillRect(-4, 16, 8, 6);
  });
  return out;
}

export function commandIcons(): Record<string, HTMLCanvasElement> {
  const out: Record<string, HTMLCanvasElement> = {};
  out.cmd_move = glyphIcon(CMD, (L) => {
    const pts = [-24, 20, 4, -8, -6, -18, 26, -26, 18, 6, 8, -4, -20, 24];
    vol(L.b, polyPath(pts), '#dfe8e6', [-24, -26, 50, 50], { hi: 0.3, lo: 0.35 });
    glow(L.e, 18, -18, 18, P.teal, 0.35);
  });
  out.cmd_attack = glyphIcon('#ff5a3a', (L) => reticle(L, 22, '#ff6a4a'));
  out.cmd_stop = glyphIcon(CMD, (L) => {
    vol(L.b, polyPath(regular(8, 30, TAU / 16)), '#b8443a', [-30, -30, 60, 60], { hi: 0.35 });
    vol(L.b, rrPath(-12, -12, 24, 24, 3), '#efe9e2', [-12, -12, 24, 24], { hi: 0.3 });
  });
  out.cmd_hold = glyphIcon(CMD, (L) => {
    shield(L, 1, '#d9e0de', '#7d8c8a');
    vol(L.b, rrPath(-4, -16, 8, 26, 2), P.tealD, [-4, -16, 8, 26], { hi: 0.4 });
    vol(L.b, rrPath(-13, -7, 26, 8, 2), P.tealD, [-13, -7, 26, 8], { hi: 0.4 });
  });
  out.cmd_hack = glyphIcon(P.cyan, (L) => {
    hackBrackets(L, 1.25, P.cyan);
    glow(L.e, 0, 0, 34, P.cyan, 0.25);
  });
  out.cmd_build = glyphIcon(KIN, (L) => {
    L.b.rotate(-0.7);
    limb(L.b, [0, 30, 0, -10], 6, P.wood, { hi: 0.4 });
    vol(L.b, rrPath(-18, -24, 36, 13, 2.5), '#8b9096', [-18, -24, 36, 13], { hi: 0.45 });
    vol(L.b, rrPath(-18, -24, 10, 13, 2), '#c08a35', [-18, -24, 10, 13], { hi: 0.45 });
    L.b.rotate(0.7);
  });
  out.cmd_repair = glyphIcon(P.teal, (L) => {
    wrench(L.b, 22, 22, -6, -6, '#aab0b4');
    vol(L.b, rrPath(-26, 8, 18, 6, 1.5), P.teal, [-26, 8, 18, 6], { hi: 0.4 });
    vol(L.b, rrPath(-20, 2, 6, 18, 1.5), P.teal, [-20, 2, 6, 18], { hi: 0.4 });
    light(L.e, -17, 11, 2.5, P.teal, 0.8, 3);
  });
  out.cmd_harvest = glyphIcon(KIN, (L) => {
    gear(L.b, 8, 12, 15, '#7a7f84');
    // claw
    limb(L.b, [-26, -26, -8, -8], 5, '#c08a35', { hi: 0.4 });
    limb(L.b, [-8, -8, -2, 2], 3.2, P.gunL, { hi: 0.4 });
    limb(L.b, [-8, -8, 4, -6], 3.2, P.gunL, { hi: 0.4 });
    light(L.e, 16, 4, 1.6, '#fff2d0', 0.9, 3);
  });
  out.cmd_cancel = glyphIcon('#ff5a3a', (L) => {
    limb(L.b, [-20, -20, 20, 20], 9, '#d0473a', { hi: 0.4 });
    limb(L.b, [20, -20, -20, 20], 9, '#d0473a', { hi: 0.4 });
  });
  out.cmd_rally = glyphIcon(P.teal, (L) => {
    limb(L.b, [-12, 30, -12, -28], 3, '#c9cfd2', { hi: 0.4 });
    vol(L.b, (gg) => { gg.beginPath(); gg.moveTo(-10, -28); gg.bezierCurveTo(0, -34, 12, -22, 26, -27); gg.lineTo(26, -5); gg.bezierCurveTo(12, 0, 0, -12, -10, -6); gg.closePath(); }, P.tealD, [-10, -34, 36, 34], { hi: 0.4 });
    light(L.e, -12, -30, 2.4, P.amber, 0.9, 3);
    L.b.save();
    L.b.scale(1, 0.45);
    L.b.beginPath();
    L.b.arc(-12, 66, 14, 0, TAU);
    L.b.strokeStyle = P.teal;
    L.b.lineWidth = 3;
    L.b.stroke();
    L.b.restore();
  });
  return out;
}

export { AXIOM_PAL, HACKED_PAL };
