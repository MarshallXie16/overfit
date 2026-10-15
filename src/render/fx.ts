import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { TextureBank } from './textures';

export const TILE = 32;
/** art is authored at 64 px per tile */
export const ART_SCALE = 0.5;

interface Particle {
  sp: Sprite;
  x: number; y: number; vx: number; vy: number;
  life: number; max: number;
  s0: number; s1: number; a0: number; a1: number;
  rot: number; vr: number;
  drag: number;
  frames: Texture[] | null;
  z: number; vz: number; gravity: number;
  add: boolean;
}

interface Line {
  pts: number[]; // world px
  color: number; width: number;
  life: number; max: number;
  glow: number;
}

export interface SpawnOpts {
  vx?: number; vy?: number;
  life?: number;
  s0?: number; s1?: number;
  a0?: number; a1?: number;
  rot?: number; vr?: number;
  tint?: number;
  add?: boolean;
  drag?: number;
  frames?: Texture[];
  z?: number; vz?: number; gravity?: number;
}

const MAX_PARTICLES = 2500;

export class Fx {
  bank: TextureBank;
  addLayer = new Container();
  normLayer = new Container();
  decalLayer = new Container();
  lineG = new Graphics();
  private parts: Particle[] = [];
  private pool: Sprite[] = [];
  private lines: Line[] = [];
  private decals: { sp: Sprite; life: number; max: number }[] = [];
  shakeAmt = 0;
  /** world px view bounds for culling spawns */
  view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  quality = 1;

  constructor(bank: TextureBank) {
    this.bank = bank;
    this.addLayer.addChild(this.lineG);
    this.lineG.blendMode = 'add';
  }

  inView(x: number, y: number, m = 200): boolean {
    const v = this.view;
    return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
  }

  private sprite(): Sprite {
    const s = this.pool.pop() ?? new Sprite();
    s.anchor.set(0.5);
    s.visible = true;
    return s;
  }

  spawn(key: string, x: number, y: number, o: SpawnOpts = {}): void {
    if (this.parts.length >= MAX_PARTICLES * this.quality) return;
    const ti = this.bank.get(key);
    const sp = this.sprite();
    sp.texture = o.frames ? o.frames[0] : ti.tex;
    if (!o.frames) sp.anchor.set(ti.ax, ti.ay);
    sp.tint = o.tint ?? 0xffffff;
    sp.blendMode = o.add ? 'add' : 'normal';
    (o.add ? this.addLayer : this.normLayer).addChild(sp);
    const p: Particle = {
      sp, x, y, vx: o.vx ?? 0, vy: o.vy ?? 0,
      life: 0, max: o.life ?? 0.5,
      s0: o.s0 ?? 1, s1: o.s1 ?? o.s0 ?? 1,
      a0: o.a0 ?? 1, a1: o.a1 ?? 0,
      rot: o.rot ?? Math.random() * Math.PI * 2, vr: o.vr ?? 0,
      drag: o.drag ?? 0,
      frames: o.frames ?? null,
      z: o.z ?? 0, vz: o.vz ?? 0, gravity: o.gravity ?? 0,
      add: !!o.add,
    };
    this.parts.push(p);
    this.apply(p, 0);
  }

  line(pts: number[], color: number, width: number, life: number, glow = 0): void {
    if (this.lines.length > 600) return;
    this.lines.push({ pts, color, width, life: 0, max: life, glow });
  }

  /** Jagged lightning between successive points. */
  arc(pts: number[], color: number, life = 0.18): void {
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const x0 = pts[k], y0 = pts[k + 1], x1 = pts[k + 2], y1 = pts[k + 3];
      const out: number[] = [x0, y0];
      const segs = Math.max(3, Math.round(Math.hypot(x1 - x0, y1 - y0) / 10));
      const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        const j = (Math.random() - 0.5) * 14;
        out.push(x0 + (x1 - x0) * t + (nx / nl) * j, y0 + (y1 - y0) * t + (ny / nl) * j);
      }
      out.push(x1, y1);
      this.line(out, color, 2, life, 6);
      this.spawn('fx:glow', x1, y1, { life: 0.2, s0: 0.5, s1: 0.2, a0: 0.9, a1: 0, tint: color, add: true });
    }
  }

  decal(key: string, x: number, y: number, scale: number, life = 40, tint = 0xffffff, rot = Math.random() * Math.PI * 2): void {
    if (this.decals.length > 220) {
      const old = this.decals.shift()!;
      old.sp.destroy();
    }
    const ti = this.bank.get(key);
    const sp = new Sprite(ti.tex);
    sp.anchor.set(0.5);
    sp.position.set(x, y);
    sp.scale.set(scale);
    sp.rotation = rot;
    sp.tint = tint;
    this.decalLayer.addChild(sp);
    this.decals.push({ sp, life: 0, max: life });
  }

  explosion(x: number, y: number, r: number, frames: Texture[]): void {
    // r in tiles
    const s = Math.max(0.35, r * 0.85);
    this.spawn('fx:glow', x, y, { life: 0.35, s0: s * 2.6, s1: s * 3.4, a0: 0.9, a1: 0, tint: 0xffa040, add: true });
    if (frames.length) this.spawn('fx:explosion:0', x, y, { life: 0.55 + r * 0.12, s0: s * 1.15, s1: s * 1.35, a0: 1, a1: 0.85, frames, add: false, rot: Math.random() * 6 });
    const n = Math.min(14, 3 + Math.round(r * 5));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (40 + Math.random() * 120) * (0.6 + r * 0.5);
      this.spawn('fx:spark', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.35, s0: 0.5, s1: 0.1, a0: 1, a1: 0, tint: 0xffc070, add: true, drag: 3 });
    }
    for (let i = 0; i < Math.min(6, 1 + r * 3); i++) {
      const a = Math.random() * Math.PI * 2, v = 10 + Math.random() * 25;
      this.spawn('fx:smoke', x + Math.cos(a) * r * 8, y + Math.sin(a) * r * 8, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 8, life: 1.2 + Math.random(), s0: s * 0.8, s1: s * 2, a0: 0.55, a1: 0, tint: 0x3a3532, drag: 1 });
    }
    if (r >= 0.8) {
      for (let i = 0; i < Math.min(6, r * 3); i++) {
        const a = Math.random() * Math.PI * 2, v = 50 + Math.random() * 90;
        this.spawn('fx:debris:' + (i % 3), x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.7 + Math.random() * 0.5, s0: 0.5, s1: 0.45, a0: 1, a1: 0.6, vr: (Math.random() - 0.5) * 14, drag: 2, z: 0, vz: 90 + Math.random() * 80, gravity: 320 });
      }
    }
  }

  shake(a: number): void {
    this.shakeAmt = Math.min(18, Math.max(this.shakeAmt, a));
  }

  private apply(p: Particle, t: number): void {
    const s = p.s0 + (p.s1 - p.s0) * t;
    p.sp.scale.set(s * ART_SCALE);
    p.sp.alpha = p.a0 + (p.a1 - p.a0) * t;
    p.sp.position.set(p.x, p.y - p.z);
    p.sp.rotation = p.rot;
    if (p.frames) {
      const f = Math.min(p.frames.length - 1, Math.floor(t * p.frames.length));
      p.sp.texture = p.frames[f];
    }
  }

  update(dt: number): void {
    let j = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.max) {
        p.sp.removeFromParent();
        p.sp.visible = false;
        if (this.pool.length < 1500) this.pool.push(p.sp); else p.sp.destroy();
        continue;
      }
      if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.gravity) { p.vz -= p.gravity * dt; p.z = Math.max(0, p.z + p.vz * dt); if (p.z === 0) { p.vz = 0; p.vr *= 0.8; } }
      this.apply(p, p.life / p.max);
      this.parts[j++] = p;
    }
    this.parts.length = j;

    // lines
    const g = this.lineG;
    g.clear();
    let k = 0;
    for (const l of this.lines) {
      l.life += dt;
      if (l.life >= l.max) continue;
      const a = 1 - l.life / l.max;
      if (l.glow) {
        g.moveTo(l.pts[0], l.pts[1]);
        for (let i = 2; i < l.pts.length; i += 2) g.lineTo(l.pts[i], l.pts[i + 1]);
        g.stroke({ width: l.width + l.glow, color: l.color, alpha: a * 0.25, cap: 'round', join: 'round' });
      }
      g.moveTo(l.pts[0], l.pts[1]);
      for (let i = 2; i < l.pts.length; i += 2) g.lineTo(l.pts[i], l.pts[i + 1]);
      g.stroke({ width: l.width, color: l.color, alpha: a, cap: 'round', join: 'round' });
      this.lines[k++] = l;
    }
    this.lines.length = k;

    // decals fade
    let d = 0;
    for (const dc of this.decals) {
      dc.life += dt;
      if (dc.life >= dc.max) { dc.sp.destroy(); continue; }
      dc.sp.alpha = Math.min(1, (dc.max - dc.life) / 6);
      this.decals[d++] = dc;
    }
    this.decals.length = d;
    this.shakeAmt *= Math.max(0, 1 - dt * 7);
    if (this.shakeAmt < 0.1) this.shakeAmt = 0;
  }

  clear(): void {
    for (const p of this.parts) p.sp.destroy();
    this.parts.length = 0;
    for (const d of this.decals) d.sp.destroy();
    this.decals.length = 0;
    this.lines.length = 0;
    this.lineG.clear();
  }
}
