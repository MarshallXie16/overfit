// Layered sprite pipeline:
//   pad (ground paint, no shadow) -> mid (low objects: short shadow + outline)
//   -> body (tall: long shadow + outline) -> emissive (additive).
import { ctxOf, makeCanvas, type G } from './util';

export interface Layers {
  /** ground layer: no shadow, no outline (pads, slabs, paint, contact shadows) */
  p: G;
  /** low objects: short shadow + outline (sandbags, crates, treads...) */
  m: G;
  /** body layer: casts the main shadow and gets a silhouette outline */
  b: G;
  /** emissive layer: composited additively on top */
  e: G;
  /** scale the sprite is rendered at (1 = authoring scale) */
  s: number;
}

export interface ShadowSpec {
  dx: number;
  dy: number;
  blur: number;
  a: number;
}

export interface SpriteOpts {
  shadow?: ShadowSpec | null;
  midShadow?: ShadowSpec | null;
  outline?: number;
  outlineColor?: string;
  scale?: number;
  /** extra rotation applied to the drawing (icons) */
  rotate?: number;
  /** composite the mid layer (low objects) */
  mid?: boolean;
}

export const UNIT_SHADOW: ShadowSpec = { dx: 1.5, dy: 2.5, blur: 4, a: 0.55 };
export const BIG_UNIT_SHADOW: ShadowSpec = { dx: 3, dy: 4, blur: 8, a: 0.55 };
export const BLD_SHADOW: ShadowSpec = { dx: 7, dy: 9, blur: 7, a: 0.62 };
export const LOW_SHADOW: ShadowSpec = { dx: 2.5, dy: 3.5, blur: 3, a: 0.55 };

function composite(g: G, src: HTMLCanvasElement, W: number, H: number, s: number, sh: ShadowSpec | null, ow: number, oc: string) {
  if (ow > 0 || sh) {
    const sil = makeCanvas(W, H);
    const sg = ctxOf(sil);
    sg.drawImage(src, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = oc;
    sg.fillRect(0, 0, W, H);
    if (sh) {
      g.save();
      g.shadowColor = `rgba(0,0,0,${sh.a})`;
      g.shadowBlur = sh.blur * s;
      // draw far off-canvas so only the shadow lands
      g.shadowOffsetX = sh.dx * s + W * 2;
      g.shadowOffsetY = sh.dy * s;
      g.drawImage(sil, -W * 2, 0);
      g.restore();
    }
    if (ow > 0) {
      g.save();
      g.globalAlpha = 0.9;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.drawImage(sil, Math.cos(a) * ow, Math.sin(a) * ow);
      }
      g.restore();
    }
  }
  g.drawImage(src, 0, 0);
}

export function renderSprite(w: number, h: number, draw: (L: Layers) => void, o: SpriteOpts = {}): HTMLCanvasElement {
  const s = o.scale ?? 1;
  const W = Math.ceil(w * s);
  const H = Math.ceil(h * s);
  const mk = () => {
    const c = makeCanvas(W, H);
    const g = ctxOf(c);
    g.translate(W / 2, H / 2);
    g.scale(s, s);
    if (o.rotate) g.rotate(o.rotate);
    return { c, g };
  };
  const Pl = mk();
  const M = mk();
  const B = mk();
  const E = mk();
  draw({ p: Pl.g, m: M.g, b: B.g, e: E.g, s });

  const out = makeCanvas(W, H);
  const g = ctxOf(out);
  g.drawImage(Pl.c, 0, 0);
  const ow = (o.outline ?? 1.4) * s;
  const oc = o.outlineColor ?? '#06080a';
  if (o.mid) composite(g, M.c, W, H, s, o.midShadow === undefined ? LOW_SHADOW : o.midShadow, ow * 0.8, oc);
  composite(g, B.c, W, H, s, o.shadow === undefined ? null : o.shadow, ow, oc);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.drawImage(E.c, 0, 0);
  g.restore();
  return out;
}

/** Soft elliptical contact shadow (draw onto the pad layer). */
export function contact(g: G, x: number, y: number, rx: number, ry: number, a = 0.35): void {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, `rgba(0,0,0,${a})`);
  gr.addColorStop(0.6, `rgba(0,0,0,${a * 0.6})`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, rx, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
