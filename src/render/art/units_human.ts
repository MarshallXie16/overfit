// Human infantry and vehicles. All face east (+x), centre = pivot.
import { P } from './palette';
import { contact, type Layers } from './sprite';
import {
  circPath, darken, ellPath, glowLine, grime, groove, light, limb, line, mulberry32, polyPath,
  rivets, roundPolyPath, rrPath, vol, type G, glow, rgba,
} from './util';

type Pt = [number, number];

// ======================================================================= infantry

interface InfSpec {
  uniform: string;
  vest: string;
  pads: string;
  wide: number;
  hands: [Pt, Pt]; // right (+y), left (-y)
  elbows?: [Pt, Pt];
  swingLeft?: boolean;
  head: (L: Layers, f: number) => void;
  pack: (L: Layers, f: number) => void;
  gear: (L: Layers, f: number) => void; // drawn between arms and hands
  over?: (L: Layers, f: number) => void; // drawn after hands, before head
  cloak?: boolean;
  padMark?: boolean;
}

const STRIDE = [1, 0, -1, 0];

function boot(g: G, x: number, y: number) {
  vol(g, rrPath(x - 4, y - 2.6, 8.5, 5.2, 2.5), P.boot, [x - 4, y - 3, 8, 5], { hi: 0.18, rim: 'rgba(255,255,255,0.18)' });
}

function drawInfantry(L: Layers, sp: InfSpec, f: number) {
  const b = L.b;
  const st = STRIDE[f];
  contact(L.p, 0.5, 0.5, 14, 14, 0.28);
  // legs + boots
  for (const s of [-1, 1]) {
    const fx = 1.5 + st * 6.5 * (s < 0 ? 1 : -1);
    const fy = s * 5.6;
    limb(b, [-1, s * 4.5, fx - 1.5, fy], 4.6, darken(sp.uniform, 0.15));
    boot(b, fx, fy);
  }
  b.save();
  b.rotate(st * 0.055);
  // torso
  if (!sp.cloak) {
    vol(b, ellPath(-1, 0, 8.2, 12.6), sp.uniform, [-9, -12.6, 16.4, 25.2]);
    vol(b, rrPath(-7, -8.6, 13.5, 17.2, 5.5), sp.vest, [-7, -8.6, 13.5, 17.2], { hi: 0.2 });
    // pouches on front of vest
    for (const py of [-5.6, 0, 5.6]) {
      vol(b, rrPath(4.2, py - 2.1, 3.4, 4.2, 1), darken(sp.vest, 0.12), [4.2, py - 2.1, 3.4, 4.2], { rim: null, ow: 0.8 });
    }
    groove(b, [-6, -8, -6, 8], 0.35, 0.8);
  }
  sp.pack(L, f);
  // arms
  const w = sp.wide;
  const swing = sp.swingLeft ? st * 4 : 0;
  const [hr, hl] = sp.hands;
  const hlx = hl[0] + swing;
  const er: Pt = sp.elbows ? sp.elbows[0] : [(hr[0]) * 0.5 + 2.5, w + 2.2];
  const el: Pt = sp.elbows ? sp.elbows[1] : [(hlx) * 0.45 + 2, -w + 0.5];
  limb(b, [-0.5, w - 1, er[0], er[1], hr[0], hr[1]], 4.3, sp.uniform);
  limb(b, [-0.5, -w + 1, el[0], el[1] + (sp.swingLeft ? -1 : 0), hlx, hl[1]], 4.3, sp.uniform);
  // shoulder pads
  if (!sp.cloak) {
    for (const s of [-1, 1]) {
      vol(b, circPath(-0.8, s * (w - 1.2), 4.7), sp.pads, [-5.5, s * (w - 1.2) - 4.7, 9.4, 9.4], { radial: true, hi: 0.3 });
      if (sp.padMark !== false) {
        vol(b, rrPath(-3.2, s * (w - 1.2) + (s > 0 ? 1.1 : -3.3), 4.6, 2.2, 0.8), P.teal, [-3, -2, 4, 2], { rim: null, ow: 0.7, hi: 0.3, lo: 0.1 });
      }
    }
  }
  sp.gear(L, f);
  // hands / gloves
  vol(b, circPath(hr[0], hr[1], 2.4), P.leather, [hr[0] - 2.4, hr[1] - 2.4, 4.8, 4.8], { radial: true, rim: null, ow: 0.9 });
  vol(b, circPath(hlx, hl[1], 2.4), P.leather, [hlx - 2.4, hl[1] - 2.4, 4.8, 4.8], { radial: true, rim: null, ow: 0.9 });
  if (sp.over) sp.over(L, f);
  sp.head(L, f);
  b.restore();
}

function helmet(color: string, extra?: (g: G) => void) {
  return (L: Layers) => {
    const g = L.b;
    vol(g, circPath(1, 0, 7.1), color, [-6.1, -7.1, 14.2, 14.2], { radial: true, hi: 0.32, lo: 0.42 });
    // cover band and strap hints
    g.save();
    circPath(1, 0, 7.1)(g);
    g.clip();
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(1, 0, 5.4, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let i = -6; i <= 6; i += 3) {
      g.beginPath();
      g.moveTo(-6, i);
      g.lineTo(8, i + 1.5);
      g.stroke();
    }
    g.restore();
    // NVG mount at the front
    vol(g, rrPath(6, -1.6, 2.6, 3.2, 0.6), P.gunD, [6, -1.6, 2.6, 3.2], { rim: null, ow: 0.8 });
    extra?.(g);
  };
}

function smallPack(color: string) {
  return (L: Layers) => {
    const g = L.b;
    vol(g, rrPath(-15.5, -7.5, 9, 15, 3), color, [-15.5, -7.5, 9, 15], { hi: 0.25 });
    groove(g, [-14, -4.5, -8, -4.5], 0.35, 0.7);
    vol(g, rrPath(-16.5, -3.2, 3.2, 6.4, 1.2), darken(color, 0.2), [-16.5, -3.2, 3.2, 6.4], { rim: null, ow: 0.8 });
    // bedroll
    vol(g, rrPath(-13.5, -9.5, 5, 19, 2.4), P.oliveD, [-13.5, -9.5, 5, 19], { hi: 0.3, ow: 0.9 });
    for (const y of [-6, 6]) line(g, -13.5, y, -8.5, y, 'rgba(0,0,0,0.45)', 0.8);
  };
}

// --- weapons

function rifle(L: Layers, y: number) {
  const g = L.b;
  // stock
  vol(g, rrPath(-6, y - 2, 8, 4, 1.4), P.gunD, [-6, y - 2, 8, 4], { rim: null, ow: 0.9 });
  // receiver
  vol(g, rrPath(1, y - 1.9, 14, 3.8, 0.8), P.gun, [1, y - 1.9, 14, 3.8], { ow: 0.9 });
  // optic
  vol(g, rrPath(4.5, y - 1.3, 6, 2.6, 1.2), P.gunD, [4.5, y - 1.3, 6, 2.6], { rim: 'rgba(255,255,255,0.4)', ow: 0.8 });
  light(L.e, 10.6, y, 0.55, P.amber, 0.6, 2.2);
  // handguard + barrel
  vol(g, rrPath(14.5, y - 1.5, 7, 3, 0.6), darken(P.olive, 0.2), [14.5, y - 1.5, 7, 3], { ow: 0.9, rim: null });
  limb(g, [21, y, 28, y], 1.5, P.gunD, { outline: null });
  vol(g, rrPath(27, y - 1.2, 3, 2.4, 0.5), P.gunD, [27, y - 1.2, 3, 2.4], { rim: null, ow: 0.8 });
}

// --- specs

const RIFLEMAN: InfSpec = {
  uniform: P.olive,
  vest: '#4f5539',
  pads: P.olive,
  wide: 10.8,
  hands: [[4.5, 6.8], [15, 4.2]],
  elbows: [[3.5, 12.5], [8, -7.5]],
  head: helmet('#626a46'),
  pack: smallPack(P.khaki),
  gear: (L) => rifle(L, 5.2),
};

const ENGINEER: InfSpec = {
  uniform: '#6b6449',
  vest: '#7b704f',
  pads: '#6b6449',
  wide: 10.8,
  hands: [[9, 7.2], [3.5, -12]],
  elbows: [[5, 12.5], [-1, -13]],
  swingLeft: true,
  padMark: true,
  head: (L) => {
    const g = L.b;
    // brim then crown
    vol(g, ellPath(1, 0, 8.4, 8), '#b57c22', [-7.4, -8, 16.8, 16], { radial: true, hi: 0.25 });
    vol(g, ellPath(0.6, 0, 6.2, 5.8), '#d99b2e', [-5.6, -5.8, 12.4, 11.6], { radial: true, hi: 0.45, lo: 0.3 });
    line(g, -5, 0, 6.5, 0, 'rgba(255,240,200,0.55)', 1.2);
    line(g, -5, 0.9, 6.5, 0.9, 'rgba(0,0,0,0.3)', 0.6);
    vol(g, rrPath(7.4, -1.6, 2.2, 3.2, 0.8), P.gunD, [7.4, -1.6, 2.2, 3.2], { rim: null, ow: 0.7 });
    light(L.e, 9.2, 0, 0.9, '#fff1c8', 0.9, 2.6);
  },
  pack: (L) => {
    const g = L.b;
    // gas cylinder
    vol(g, rrPath(-18, -13.5, 12, 5, 2.5), '#5c6970', [-18, -13.5, 12, 5], { hi: 0.35 });
    vol(g, rrPath(-7.5, -12.6, 2.2, 3.2, 0.6), P.amberD, [-7.5, -12.6, 2.2, 3.2], { rim: null, ow: 0.7 });
    // toolbox
    vol(g, rrPath(-18, -8.5, 11.5, 17, 2), '#9b5a2b', [-18, -8.5, 11.5, 17], { hi: 0.28 });
    groove(g, [-12.2, -8, -12.2, 8], 0.45, 0.8);
    vol(g, rrPath(-14.5, -1.6, 4.6, 3.2, 1), P.gunD, [-14.5, -1.6, 4.6, 3.2], { rim: null, ow: 0.7 });
    rivets(g, [-16.5, -6.5, -16.5, 6.5, -8.2, -6.5, -8.2, 6.5], 0.8, '#aaa');
    // cable coil
    g.beginPath();
    g.arc(-12, 9.5, 3.2, 0, Math.PI * 2);
    g.strokeStyle = '#1c1c1c';
    g.lineWidth = 1.6;
    g.stroke();
  },
  gear: (L, f) => {
    const g = L.b;
    // hose
    g.beginPath();
    g.moveTo(5, 9);
    g.quadraticCurveTo(-4, 15, -12, 9);
    g.strokeStyle = '#151515';
    g.lineWidth = 1.4;
    g.stroke();
    // hi-vis stripes over shoulders
    for (const s of [-1, 1]) {
      g.save();
      g.globalAlpha = 0.9;
      vol(g, rrPath(-7, s * 5.5 - 1.2, 12.5, 2.4, 1), '#e2a53b', [-7, s * 5.5 - 1.2, 12, 2.4], { rim: null, ow: 0.5, lo: 0.2 });
      g.restore();
    }
    // torch
    limb(g, [7.5, 7.2, 18.5, 5.6], 2.4, P.gun);
    vol(g, rrPath(17.5, 4.3, 3.4, 2.6, 0.8), '#a58440', [17.5, 4.3, 3.4, 2.6], { rim: null, ow: 0.7 });
    const fl = 0.75 + 0.25 * ((f % 2) ? 1 : 0);
    light(L.e, 21.6, 5.5, 1.7, '#9fe9ff', fl, 3.2);
    light(L.e, 21.6, 5.5, 0.8, '#ffffff', 1, 1.5);
    const r = mulberry32(17 + f);
    for (let i = 0; i < 4; i++) {
      const a = -0.8 + r() * 1.6;
      const d = 3 + r() * 5;
      light(L.e, 21.6 + Math.cos(a) * d, 5.5 + Math.sin(a) * d, 0.45, P.amber, 0.9, 2);
    }
  },
};

const ARC: InfSpec = {
  uniform: '#4b5049',
  vest: '#58616a',
  pads: '#5c656d',
  wide: 11.4,
  hands: [[4.5, 7.4], [14, 4.2]],
  elbows: [[3.5, 13.5], [8, -7.5]],
  head: (L) => {
    const g = L.b;
    vol(g, circPath(1, 0, 7.5), '#5a636b', [-6.5, -7.5, 15, 15], { radial: true, hi: 0.35 });
    groove(g, [-4, -5, -1, 0, -4, 5], 0.4, 0.8);
    // visor slit
    g.save();
    g.beginPath();
    g.arc(1, 0, 5.6, -0.95, 0.95);
    g.strokeStyle = '#0b1416';
    g.lineWidth = 2.6;
    g.stroke();
    g.restore();
    L.e.save();
    L.e.beginPath();
    L.e.arc(1, 0, 5.6, -0.85, 0.85);
    L.e.strokeStyle = rgba(P.cyan, 0.95);
    L.e.lineWidth = 1.3;
    L.e.stroke();
    L.e.restore();
    glow(L.e, 6.5, 0, 6, P.cyan, 0.35);
  },
  pack: (L) => {
    const g = L.b;
    vol(g, rrPath(-17, -8, 10, 16, 4), '#4a535a', [-17, -8, 10, 16], { hi: 0.3 });
    for (let i = 0; i < 4; i++) line(g, -16, -5 + i * 3.3, -8.5, -5 + i * 3.3, 'rgba(0,0,0,0.45)', 0.8);
    vol(g, rrPath(-14.6, -6.5, 2.2, 13, 1), '#0d1a1c', [-14.6, -6.5, 2.2, 13], { rim: null, ow: 0.6 });
    glowLine(L.e, [-13.5, -5.5, -13.5, 5.5], P.cyan, 1, 0.85, 3);
  },
  gear: (L) => {
    const g = L.b;
    const y = 5.6;
    // cable to pack
    g.beginPath();
    g.moveTo(-1, y + 2.5);
    g.quadraticCurveTo(-6, 13, -13, 7);
    g.strokeStyle = '#121518';
    g.lineWidth = 1.5;
    g.stroke();
    vol(g, rrPath(-4, y - 2.8, 26, 5.6, 2), '#4e575f', [-4, y - 2.8, 26, 5.6], { hi: 0.3 });
    for (const cx of [9, 13, 17]) {
      vol(g, rrPath(cx - 1, y - 3.8, 2.2, 7.6, 0.8), '#8d5f35', [cx - 1, y - 3.8, 2.2, 7.6], { rim: null, ow: 0.6 });
      glowLine(L.e, [cx + 0.1, y - 3.2, cx + 0.1, y + 3.2], P.cyan, 0.9, 0.9, 3.2);
    }
    limb(g, [21, y - 2.2, 26.5, y - 1.6], 1.3, P.gunD, { outline: null });
    limb(g, [21, y + 2.2, 26.5, y + 1.6], 1.3, P.gunD, { outline: null });
    light(L.e, 26.5, y, 1.5, P.cyan, 1, 3.6);
  },
};

const ROCKETEER: InfSpec = {
  uniform: P.olive,
  vest: '#585d3c',
  pads: P.olive,
  wide: 10.8,
  hands: [[3.5, 13.5], [10.5, 5]],
  elbows: [[0.5, 14.8], [6, -6]],
  head: helmet('#5f6744'),
  pack: (L) => {
    const g = L.b;
    vol(g, rrPath(-16, -8, 9.5, 16, 3), P.khaki, [-16, -8, 9.5, 16], { hi: 0.25 });
    for (const y of [-4, 3]) {
      vol(g, circPath(-11.5, y, 2.6), '#9d5a2a', [-14, y - 2.6, 5.2, 5.2], { radial: true, ow: 0.8 });
      line(g, -12.4, y - 0.8, -11, y - 0.8, 'rgba(255,220,180,0.5)', 0.6);
    }
  },
  gear: (L) => {
    const g = L.b;
    const y = 9.5;
    vol(g, rrPath(-19, y - 4.4, 5, 8.8, 1.5), darken('#646b48', 0.25), [-19, y - 4.4, 5, 8.8], { rim: null });
    vol(g, rrPath(-16, y - 3.8, 38, 7.6, 3.2), '#646b48', [-16, y - 3.8, 38, 7.6], { hi: 0.32, lo: 0.42 });
    for (const bx of [-12, 14.5]) {
      g.fillStyle = 'rgba(232,160,60,0.85)';
      g.fillRect(bx, y - 3.6, 2.2, 7.2);
    }
    groove(g, [-2, y - 3.6, -2, y + 3.6], 0.4, 0.8);
    vol(g, rrPath(1, y - 6.8, 6, 3, 0.8), P.gunD, [1, y - 6.8, 6, 3], { rim: null, ow: 0.7 });
    // warhead peeking out
    vol(g, polyPath([21.5, y - 3, 27.5, y, 21.5, y + 3]), '#a3592b', [21.5, y - 3, 6, 6], { ow: 0.8 });
  },
};

const NETRUNNER: InfSpec = {
  uniform: '#34393c',
  vest: '#2b3034',
  pads: '#3a4044',
  wide: 10.2,
  hands: [[10.5, 6.6], [10.5, -6.6]],
  elbows: [[6, 11.5], [6, -11.5]],
  padMark: false,
  head: (L) => {
    const g = L.b;
    // hood: teardrop pointing back
    const hood = (gg: G) => {
      gg.beginPath();
      gg.arc(1.5, 0, 6.9, -1.9, 1.9);
      gg.quadraticCurveTo(-6, 6.5, -9, 0);
      gg.quadraticCurveTo(-6, -6.5, 1.5 + Math.cos(-1.9) * 6.9, Math.sin(-1.9) * 6.9);
      gg.closePath();
    };
    vol(g, hood, '#3f4549', [-9, -7, 17, 14], { hi: 0.28 });
    groove(g, [-7.5, 0, -2, 0], 0.4, 0.8);
    // face opening + glowing lenses
    vol(g, ellPath(5.3, 0, 2.4, 4.4), '#141719', [3, -4.4, 4.8, 8.8], { rim: null, ow: 0.6 });
    light(L.e, 6.4, -1.8, 0.85, P.teal, 1, 2.6);
    light(L.e, 6.4, 1.8, 0.85, P.teal, 1, 2.6);
  },
  pack: (L, f) => {
    const g = L.b;
    vol(g, rrPath(-16, -7, 9, 14, 2), P.gun, [-16, -7, 9, 14], { hi: 0.3 });
    groove(g, [-15, 0, -8, 0], 0.4, 0.7);
    // antennas
    limb(g, [-14, -5, -26, -12.5], 1.1, P.gunL, { outline: '#0b0c0e' });
    limb(g, [-14, 5, -23, 13.5], 1.1, P.gunL, { outline: '#0b0c0e' });
    vol(g, circPath(-12, 3, 2.2), P.gunD, [-14, 1, 4.4, 4.4], { radial: true, ow: 0.6 });
    const blink = f % 2 === 0 ? 1 : 0.45;
    light(L.e, -26, -12.5, 1, P.teal, blink, 3);
    light(L.e, -23, 13.5, 1, P.teal, 1.45 - blink, 3);
    light(L.e, -10, -4.5, 0.5, P.amber, 0.9, 2);
    // teal piping on coat
    glowLine(L.e, [-6, -7.5, 4, -7.5], P.teal, 0.5, 0.5, 2.5);
    glowLine(L.e, [-6, 7.5, 4, 7.5], P.teal, 0.5, 0.5, 2.5);
  },
  gear: (L) => {
    const g = L.b;
    vol(g, rrPath(8.5, -7, 7.5, 14, 1.6), '#1a1f22', [8.5, -7, 7.5, 14], { hi: 0.3 });
    g.fillStyle = '#073b3a';
    g.fillRect(9.6, -5.8, 5.2, 11.6);
    const e = L.e;
    glow(e, 12.2, 0, 13, P.teal, 0.45);
    e.save();
    e.globalCompositeOperation = 'lighter';
    e.fillStyle = rgba(P.teal, 0.65);
    e.fillRect(9.6, -5.8, 5.2, 11.6);
    e.fillStyle = rgba('#d8fffb', 0.75);
    for (let i = 0; i < 5; i++) e.fillRect(10.4, -4.8 + i * 2.2, 1.2 + ((i * 7) % 3) * 1.1, 0.7);
    e.restore();
  },
};

const RANGER: InfSpec = {
  uniform: '#6a6447',
  vest: '#6a6447',
  pads: '#6a6447',
  wide: 10.6,
  cloak: true,
  hands: [[3.5, 6.8], [16.5, 4.4]],
  elbows: [[2.5, 13], [9, -7]],
  head: (L) => {
    const g = L.b;
    vol(g, ellPath(0.5, 0, 9.6, 9.2), '#776d4c', [-9.1, -9.2, 19.2, 18.4], { radial: true, hi: 0.22 });
    g.save();
    ellPath(0.5, 0, 9.6, 9.2)(g);
    g.clip();
    const r = mulberry32(4);
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      g.fillStyle = r() < 0.5 ? 'rgba(60,70,40,0.5)' : 'rgba(30,25,15,0.35)';
      g.beginPath();
      g.ellipse(0.5 + Math.cos(a) * 7, Math.sin(a) * 7, 2.2, 1.2, a, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    vol(g, circPath(0.5, 0, 5.4), '#8a805b', [-4.9, -5.4, 10.8, 10.8], { radial: true, hi: 0.35 });
    g.beginPath();
    g.arc(0.5, 0, 5.4, 0, Math.PI * 2);
    g.strokeStyle = '#3d3424';
    g.lineWidth = 1.2;
    g.stroke();
    vol(g, rrPath(-1.5, 3.8, 3, 1.8, 0.5), P.teal, [-1.5, 3.8, 3, 1.8], { rim: null, ow: 0.5, lo: 0.1 });
  },
  pack: (L) => {
    const g = L.b;
    // ghillie cloak: ragged blob with mottling
    const r = mulberry32(99);
    const pts: number[] = [];
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rx = 10.5 + (Math.cos(a) < 0 ? 5 : 0);
      const rad = 1 + (r() - 0.5) * 0.28;
      pts.push(-2.5 + Math.cos(a) * rx * rad, Math.sin(a) * 14.2 * rad);
    }
    const path = polyPath(pts);
    vol(g, path, '#5d5a3c', [-16, -15, 26, 30], { hi: 0.22 });
    g.save();
    path(g);
    g.clip();
    for (let i = 0; i < 40; i++) {
      const x = -17 + r() * 26;
      const y = -15 + r() * 30;
      g.fillStyle = ['rgba(90,96,58,0.65)', 'rgba(56,50,34,0.6)', 'rgba(120,108,74,0.5)'][i % 3];
      g.beginPath();
      g.ellipse(x, y, 1.5 + r() * 2.2, 0.9 + r() * 1.2, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // strands trailing back
    for (let i = 0; i < 9; i++) {
      const y = -11 + i * 2.7;
      const x0 = -12 - r() * 3;
      line(g, x0, y, x0 - 3 - r() * 4, y + (r() - 0.5) * 3, i % 2 ? '#4a4730' : '#6e6845', 1);
    }
  },
  gear: (L) => {
    const g = L.b;
    const y = 5.2;
    vol(g, rrPath(-8, y - 1.8, 9, 3.6, 1.3), P.gunD, [-8, y - 1.8, 9, 3.6], { rim: null, ow: 0.9 });
    vol(g, rrPath(0, y - 1.8, 22, 3.6, 0.8), '#3e454b', [0, y - 1.8, 22, 3.6], { ow: 0.9 });
    // twin rails
    limb(g, [20, y - 1.3, 37, y - 1.3], 1.1, P.gunL, { outline: '#0a0b0c' });
    limb(g, [20, y + 1.3, 37, y + 1.3], 1.1, P.gunL, { outline: '#0a0b0c' });
    glowLine(L.e, [10, y, 37.5, y], P.teal, 0.7, 0.9, 3.4);
    light(L.e, 38, y, 1, P.teal, 1, 3);
    // scope
    vol(g, rrPath(3.5, y - 4.6, 11, 2.8, 1.4), '#262b30', [3.5, y - 4.6, 11, 2.8], { rim: 'rgba(255,255,255,0.4)', ow: 0.8 });
    light(L.e, 14.6, y - 3.2, 0.6, P.amber, 0.7, 2);
  },
};

export const INFANTRY: Record<string, InfSpec> = {
  engineer: ENGINEER,
  rifleman: RIFLEMAN,
  arc_trooper: ARC,
  rocketeer: ROCKETEER,
  netrunner: NETRUNNER,
  ranger: RANGER,
};

export function drawInfantryKind(kind: string, L: Layers, f: number): void {
  drawInfantry(L, INFANTRY[kind], f);
}

// ======================================================================= vehicles

function treadBand(g: G, x0: number, x1: number, y0: number, y1: number, f: number, step = 6) {
  const h = y1 - y0;
  vol(g, rrPath(x0, y0, x1 - x0, h, Math.min(5, h / 2)), '#1c1d1e', [x0, y0, x1 - x0, h], { hi: 0.12, lo: 0.3, rim: 'rgba(255,255,255,0.12)' });
  g.save();
  rrPath(x0 + 0.8, y0 + 0.8, x1 - x0 - 1.6, h - 1.6, Math.min(4, h / 2))(g);
  g.clip();
  const off = (f % 2) * (step / 2);
  for (let x = x0 - step + off; x < x1 + step; x += step) {
    g.fillStyle = '#3b3c3b';
    g.fillRect(x, y0 + 1, step * 0.62, h - 2);
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.fillRect(x, y0 + 1, step * 0.62, 0.9);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(x + step * 0.62, y0 + 1, 0.8, h - 2);
    // guide horns
    g.fillStyle = '#56585a';
    g.fillRect(x + step * 0.2, y0 + h / 2 - 0.7, step * 0.25, 1.4);
  }
  // mud/dust grime
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, 'rgba(70,58,40,0.15)');
  gr.addColorStop(1, 'rgba(70,58,40,0.35)');
  g.fillStyle = gr;
  g.fillRect(x0, y0, x1 - x0, h);
  g.restore();
}

function headlight(L: Layers, x: number, y: number) {
  vol(L.b, rrPath(x - 1.8, y - 2.2, 3.6, 4.4, 1), P.gunD, [x - 1.8, y - 2.2, 3.6, 4.4], { rim: null, ow: 0.8 });
  light(L.e, x + 0.6, y, 1.2, '#ffd38a', 0.9, 3.4);
}

function tealChevron(g: G, x: number, y: number, s: number) {
  vol(g, polyPath([x - s, y - s, x, y, x - s, y + s, x - s * 0.4, y + s, x + s * 0.6, y, x - s * 0.4, y - s]),
    P.teal, [x - s, y - s, s * 1.6, s * 2], { rim: null, ow: 0.7, hi: 0.35, lo: 0.15 });
}

function hullDetails(g: G, x0: number, x1: number, hw: number, color: string, seed: number) {
  // panel lines and rivets along edges
  groove(g, [x0 + 4, -hw + 4, x1 - 8, -hw + 4], 0.3, 0.8);
  groove(g, [x0 + 4, hw - 4, x1 - 8, hw - 4], 0.3, 0.8);
  const pts: number[] = [];
  for (let x = x0 + 6; x < x1 - 6; x += 8) pts.push(x, -hw + 2.2, x, hw - 2.2);
  rivets(g, pts, 0.75, color);
  grime(g, rrPath(x0, -hw, x1 - x0, hw * 2, 3), [x0, -hw, x1 - x0, hw * 2], seed, 70, 0.12);
}

export function drawBulldog(L: Layers, f: number): void {
  const g = L.b;
  contact(L.p, 0, 0, 58, 46, 0.3);
  for (const s of [-1, 1]) treadBand(g, -50, 50, s > 0 ? 23 : -36, s > 0 ? 36 : -23, f);
  const hull = roundPolyPath([-46, -24, 38, -24, 48, -14, 48, 14, 38, 24, -46, 24], 3);
  vol(g, hull, P.olive, [-46, -24, 94, 48], { hi: 0.22, lo: 0.42 });
  hullDetails(g, -46, 48, 24, P.olive, 11);
  // fenders over the treads
  for (const s of [-1, 1]) {
    vol(g, rrPath(-42, s > 0 ? 22 : -26, 84, 4, 1.2), P.oliveD, [-42, -26, 84, 4], { rim: 'rgba(255,255,255,0.18)', ow: 0.9 });
  }
  // engine deck
  vol(g, rrPath(-44, -16, 19, 32, 2), '#454b33', [-44, -16, 19, 32], { rim: null, ow: 1 });
  for (let y = -14; y <= 14; y += 3) line(g, -42.5, y, -27, y, 'rgba(0,0,0,0.55)', 1.2);
  for (let y = -13.2; y <= 14; y += 3) line(g, -42.5, y, -27, y, 'rgba(255,255,255,0.08)', 0.6);
  for (const s of [-1, 1]) {
    vol(g, rrPath(-47.5, s * 19 - 2.5, 5, 5, 1.2), '#2a2622', [-47.5, s * 19 - 2.5, 5, 5], { rim: null, ow: 0.8 });
    g.fillStyle = 'rgba(10,10,10,0.6)';
    g.beginPath();
    g.arc(-46, s * 19, 1.5, 0, Math.PI * 2);
    g.fill();
  }
  // glacis + spare track links
  groove(g, [30, -22, 30, 22], 0.4, 1);
  for (let i = -1; i <= 1; i++) {
    vol(g, rrPath(36, i * 7 - 3, 6, 6, 1), '#2b2c2c', [36, i * 7 - 3, 6, 6], { rim: 'rgba(255,255,255,0.15)', ow: 0.7 });
  }
  for (const s of [-1, 1]) headlight(L, 45, s * 17.5);
  // stowage box & teal markings
  vol(g, rrPath(-18, -23, 20, 5.5, 1.2), P.khaki, [-18, -23, 20, 5.5], { ow: 0.8 });
  vol(g, rrPath(-18, 17.5, 20, 5.5, 1.2), P.khaki, [-18, 17.5, 20, 5.5], { ow: 0.8 });
  for (const s of [-1, 1]) {
    g.fillStyle = rgba(P.teal, 0.9);
    g.fillRect(6, s > 0 ? 18.5 : -21.5, 10, 3);
  }
  light(L.e, -44, -21, 0.7, P.amber, 0.9, 2.6);
}

export function drawBulldogTurret(L: Layers): void {
  const g = L.b;
  // bustle basket
  vol(g, rrPath(-32, -14, 9, 28, 1.5), '#2e3122', [-32, -14, 9, 28], { rim: null, ow: 1 });
  for (let y = -12; y <= 12; y += 4) line(g, -31.5, y, -23.5, y, 'rgba(110,110,90,0.6)', 0.6);
  vol(g, ellPath(-28, -6, 3.5, 5), P.khaki, [-31.5, -11, 7, 10], { radial: true, ow: 0.8 });
  vol(g, ellPath(-28, 6, 3.2, 4.4), P.oliveD, [-31.5, 1.6, 7, 9], { radial: true, ow: 0.8 });
  // barrel
  limb(g, [20, 0, 58, 0], 5, '#4f553c', { hi: 0.32 });
  vol(g, rrPath(36, -3.7, 7, 7.4, 2.5), '#4f553c', [36, -3.7, 7, 7.4], { hi: 0.3, ow: 1 });
  vol(g, rrPath(55, -3.8, 7, 7.6, 1.2), P.gunD, [55, -3.8, 7, 7.6], { ow: 1 });
  line(g, 57.5, -3.5, 57.5, 3.5, 'rgba(0,0,0,0.7)', 1);
  line(g, 59.8, -3.5, 59.8, 3.5, 'rgba(0,0,0,0.7)', 1);
  // turret body
  const body = roundPolyPath([-26, -13, -20, -19.5, 7, -19.5, 20, -10, 20, 10, 7, 19.5, -20, 19.5, -26, 13], 3.5);
  vol(g, body, P.olive, [-26, -19.5, 46, 39], { hi: 0.3, lo: 0.45 });
  grime(g, body, [-26, -20, 46, 40], 5, 40, 0.1);
  groove(g, [8, -18, 8, 18], 0.3, 0.8);
  // mantlet
  vol(g, rrPath(16, -7, 9, 14, 2), '#4c5236', [16, -7, 9, 14], { hi: 0.3, ow: 1 });
  // smoke launchers
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      vol(g, circPath(9 + i * 2.4, s * (15.5 - i * 1.6), 1.4), P.gunD, [7, -1, 3, 3], { rim: null, ow: 0.6 });
    }
  }
  // cupola + hatch
  vol(g, circPath(-8, -7.5, 6.4), '#4c5236', [-14.4, -13.9, 12.8, 12.8], { radial: true, hi: 0.3 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    vol(g, rrPath(-8 + Math.cos(a) * 5.2 - 1, -7.5 + Math.sin(a) * 5.2 - 1, 2, 2, 0.5), '#1b2a2c', [0, 0, 2, 2], { rim: null, ow: 0.4 });
  }
  vol(g, circPath(-8.5, -8, 3.6), P.oliveL, [-12, -11.5, 7.2, 7.2], { radial: true, hi: 0.4, ow: 0.8 });
  vol(g, circPath(-10, 8, 4.4), '#4c5236', [-14.4, 3.6, 8.8, 8.8], { radial: true, hi: 0.35 });
  line(g, -13, 8, -7, 8, 'rgba(0,0,0,0.4)', 0.8);
  // antenna
  limb(g, [-21, -15, -36, -22], 0.9, P.gunD, { outline: null });
  light(L.e, -36, -22, 0.6, P.amber, 0.8, 2.4);
  // teal chevron
  tealChevron(g, 4, 0, 4.2);
  rivets(g, [-22, -12, -22, 12, 4, -17, 4, 17], 0.8, P.olive);
}

export function drawVolt(L: Layers, f: number): void {
  const g = L.b;
  contact(L.p, 0, 0, 58, 46, 0.3);
  // wheels
  for (const s of [-1, 1]) {
    for (const wx of [-31, -3, 25]) {
      const y0 = s > 0 ? 23 : -36;
      vol(g, rrPath(wx - 9, y0, 18, 13, 5), '#1b1c1d', [wx - 9, y0, 18, 13], { hi: 0.15, rim: 'rgba(255,255,255,0.12)' });
      g.save();
      rrPath(wx - 9, y0, 18, 13, 5)(g);
      g.clip();
      const off = (f % 2) * 2;
      for (let x = wx - 10 + off; x < wx + 10; x += 4) {
        g.fillStyle = 'rgba(80,80,80,0.6)';
        g.fillRect(x, y0 + 1, 1.6, 11);
      }
      g.restore();
      vol(g, rrPath(wx - 4, y0 + (s > 0 ? 0 : 9), 8, 4, 1.5), '#3a3c3e', [wx - 4, y0, 8, 4], { rim: null, ow: 0.6 });
    }
  }
  const hull = roundPolyPath([-47, -24, 30, -24, 47, -12, 47, 12, 30, 24, -47, 24], 4);
  const col = '#545b4c';
  vol(g, hull, col, [-47, -24, 94, 48], { hi: 0.25, lo: 0.42 });
  hullDetails(g, -47, 47, 24, col, 23);
  // capacitor banks along both flanks
  for (const s of [-1, 1]) {
    for (const cx of [-34, -18, -2]) {
      const y0 = s > 0 ? 14 : -21;
      vol(g, rrPath(cx, y0, 13, 7, 3.2), '#2e3438', [cx, y0, 13, 7], { hi: 0.4 });
      g.fillStyle = '#0a2a2e';
      g.fillRect(cx + 5.5, y0 + 0.8, 2, 5.4);
      glowLine(L.e, [cx + 6.5, y0 + 1.2, cx + 6.5, y0 + 5.8], P.cyan, 1.1, 0.9, 3.4);
    }
  }
  // rear radiator
  vol(g, rrPath(-46, -11, 8, 22, 1.5), '#33382e', [-46, -11, 8, 22], { rim: null, ow: 0.8 });
  for (let y = -9; y <= 9; y += 2.5) line(g, -45, y, -39, y, 'rgba(0,0,0,0.6)', 0.9);
  // nose
  groove(g, [30, -22, 38, -6, 38, 6, 30, 22], 0.35, 0.9);
  for (const s of [-1, 1]) headlight(L, 41, s * 13);
  for (const s of [-1, 1]) {
    g.fillStyle = rgba(P.teal, 0.9);
    g.fillRect(14, s > 0 ? 18 : -21, 12, 3);
  }
}

export function drawVoltTurret(L: Layers, f = 0): void {
  const g = L.b;
  const e = L.e;
  // prongs
  for (const s of [-1, 1]) {
    limb(g, [8, s * 9, 22, s * 8, 31, s * 5], 2.6, '#454c52', { hi: 0.35 });
    vol(g, circPath(31, s * 5, 2), '#9a6a3c', [29, s * 5 - 2, 4, 4], { radial: true, ow: 0.7 });
  }
  // capacitor pods at rear
  for (const s of [-1, 1]) {
    vol(g, rrPath(-24, s * 10 - 4, 12, 8, 3.5), '#2f363b', [-24, s * 10 - 4, 12, 8], { hi: 0.35 });
    glowLine(e, [-21, s * 10, -15, s * 10], P.cyan, 0.9, 0.85, 3);
  }
  // base ring
  vol(g, circPath(0, 0, 17), '#4c5349', [-17, -17, 34, 34], { radial: true, hi: 0.28 });
  rivets(g, Array.from({ length: 12 }, (_, i) => [Math.cos(i * 0.5236) * 15, Math.sin(i * 0.5236) * 15]).flat(), 0.8, '#666');
  // stacked coil
  vol(g, circPath(0, 0, 12.5), '#8a5a33', [-12.5, -12.5, 25, 25], { radial: true, hi: 0.35 });
  g.save();
  circPath(0, 0, 12.5)(g);
  g.clip();
  for (let r = 4; r < 13; r += 1.6) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(30,15,5,0.45)';
    g.lineWidth = 0.7;
    g.stroke();
  }
  g.restore();
  vol(g, circPath(0, 0, 8), '#3d4448', [-8, -8, 16, 16], { radial: true, hi: 0.35 });
  e.save();
  e.globalCompositeOperation = 'lighter';
  for (const r of [10.2, 6]) {
    e.beginPath();
    e.arc(0, 0, r, 0, Math.PI * 2);
    e.strokeStyle = rgba(P.cyan, 0.75);
    e.lineWidth = 1;
    e.stroke();
  }
  e.restore();
  glow(e, 0, 0, 22, P.cyan, 0.3);
  vol(g, circPath(0, 0, 4.6), '#bff8ff', [-4.6, -4.6, 9.2, 9.2], { radial: true, hi: 0.6, ow: 0.8 });
  light(e, 0, 0, 3, P.cyan, 0.9, 3);
  // arc between prongs
  const r = mulberry32(3 + f);
  const pts: number[] = [31, -5];
  for (let i = 1; i < 5; i++) pts.push(32 + (r() - 0.5) * 4, -5 + i * 2.5);
  pts.push(31, 5);
  glowLine(e, pts, P.cyan, 0.7, 0.9, 4);
  tealChevron(g, -12.5, 0, 3);
}

export function drawThumper(L: Layers, f: number): void {
  const g = L.b;
  contact(L.p, 0, 0, 62, 48, 0.3);
  for (const s of [-1, 1]) treadBand(g, -54, 54, s > 0 ? 25 : -38, s > 0 ? 38 : -25, f);
  // recoil spade at rear
  vol(g, rrPath(-62, -19, 9, 38, 2), P.gunD, [-62, -19, 9, 38], { hi: 0.25 });
  for (let y = -16; y <= 16; y += 4) line(g, -62, y, -59, y, 'rgba(0,0,0,0.6)', 1);
  for (const s of [-1, 1]) limb(g, [-55, s * 13, -46, s * 18], 2.4, P.gunL);
  const hull = roundPolyPath([-50, -26, 42, -26, 52, -16, 52, 16, 42, 26, -50, 26], 3);
  const col = '#666648';
  vol(g, hull, col, [-50, -26, 102, 52], { hi: 0.22, lo: 0.42 });
  hullDetails(g, -50, 52, 26, col, 31);
  for (const s of [-1, 1]) {
    vol(g, rrPath(-46, s > 0 ? 24 : -28, 92, 4, 1.2), darken(col, 0.3), [-46, -28, 92, 4], { rim: 'rgba(255,255,255,0.18)', ow: 0.9 });
  }
  // ammo rack (shell tops)
  vol(g, rrPath(-47, -17, 20, 34, 2), '#3c3c2a', [-47, -17, 20, 34], { rim: null, ow: 1 });
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 5; j++) {
      const x = -42.5 + i * 6;
      const y = -12.5 + j * 6.2;
      vol(g, circPath(x, y, 2.4), '#b38f48', [x - 2.4, y - 2.4, 4.8, 4.8], { radial: true, hi: 0.45, ow: 0.7 });
      g.fillStyle = '#7a3a22';
      g.beginPath();
      g.arc(x, y, 1, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const s of [-1, 1]) headlight(L, 49, s * 17);
  // amber/black hazard at front edge
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? 'rgba(20,20,20,0.8)' : 'rgba(226,160,60,0.85)';
    g.fillRect(46, -12 + i * 4, 3, 4);
  }
  for (const s of [-1, 1]) {
    g.fillStyle = rgba(P.teal, 0.9);
    g.fillRect(-20, s > 0 ? 20 : -23, 12, 3);
  }
}

export function drawThumperTurret(L: Layers): void {
  const g = L.b;
  // barrel
  limb(g, [16, 0, 62, 0], 7, '#545942', { hi: 0.32 });
  vol(g, rrPath(58, -5.5, 10, 11, 1.6), P.gunD, [58, -5.5, 10, 11], { ow: 1 });
  for (const x of [61, 64]) line(g, x, -5, x, 5, 'rgba(0,0,0,0.75)', 1.2);
  // recoil cylinders
  for (const s of [-1, 1]) limb(g, [8, s * 6, 36, s * 5.2], 3, P.gunL, { hi: 0.4 });
  vol(g, rrPath(30, -7, 6, 14, 1.5), '#545942', [30, -7, 6, 14], { ow: 0.9 });
  // casemate
  const body = roundPolyPath([-27, -20, 12, -20, 22, -11, 22, 11, 12, 20, -27, 20], 3.5);
  vol(g, body, '#6a6a4a', [-27, -20, 49, 40], { hi: 0.3, lo: 0.45 });
  grime(g, body, [-27, -20, 49, 40], 9, 40, 0.1);
  groove(g, [10, -18, 10, 18], 0.3, 0.8);
  groove(g, [-18, -18, -18, 18], 0.3, 0.8);
  // hatches & sights
  vol(g, circPath(-8, -9, 5), '#58583c', [-13, -14, 10, 10], { radial: true, hi: 0.35 });
  vol(g, circPath(-8, 9, 4.2), '#58583c', [-12.2, 4.8, 8.4, 8.4], { radial: true, hi: 0.35 });
  vol(g, rrPath(2, -16.5, 7, 5, 1), P.gunD, [2, -16.5, 7, 5], { rim: null, ow: 0.8 });
  light(L.e, 8, -14, 0.7, P.amber, 0.9, 2.4);
  // hazard stripes at barrel base
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? 'rgba(20,20,20,0.85)' : 'rgba(226,160,60,0.9)';
    g.fillRect(17 + i * 2.5, -3.5, 2.5, 7);
  }
  tealChevron(g, -18, 0, 4);
  rivets(g, [-24, -16, -24, 16, 6, -18, 6, 18], 0.8, '#6a6a4a');
}

export const VEHICLE_CANVAS: Record<string, number> = { bulldog: 128, volt: 128, thumper: 144 };
