import { Rectangle, Texture } from 'pixi.js';

export interface ArtAtlasLike {
  get(key: string): HTMLCanvasElement | undefined;
  keys(): string[];
  meta(key: string): { w: number; h: number; anchorX: number; anchorY: number };
}

export interface TexInfo { tex: Texture; ax: number; ay: number; w: number; h: number }

const SHEET = 4096;
const PAD = 12;
/** keys uploaded as their own repeating texture (tiling patterns) */
const STANDALONE = new Set(['fx:creep_pattern']);

/**
 * Packs every atlas canvas into a few 4096² sheets (shelf packing) so Pixi can batch draws.
 * Large canvases (> 1024) are uploaded as standalone textures.
 */
export class TextureBank {
  private map = new Map<string, TexInfo>();
  private fallbacks = new Map<string, TexInfo>();
  sheets: HTMLCanvasElement[] = [];

  constructor(atlas: ArtAtlasLike | null) {
    if (atlas) this.pack(atlas);
  }

  private pack(atlas: ArtAtlasLike): void {
    const keys = atlas.keys().filter((k) => atlas.get(k));
    const items = keys.map((k) => ({ k, c: atlas.get(k)!, m: atlas.meta(k) }));
    items.sort((a, b) => b.c.height - a.c.height || b.c.width - a.c.width);
    let sheet: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let x = 0, y = 0, rowH = 0;
    const placed: { k: string; sheet: number; x: number; y: number; w: number; h: number; ax: number; ay: number }[] = [];
    const big: typeof items = [];
    for (const it of items) {
      const w = it.c.width, h = it.c.height;
      if (w > 1024 || h > 1024 || STANDALONE.has(it.k)) { big.push(it); continue; }
      if (!sheet || x + w + PAD > SHEET) { x = 0; y += rowH + PAD; rowH = 0; }
      if (!sheet || y + h + PAD > SHEET) {
        sheet = document.createElement('canvas');
        sheet.width = SHEET; sheet.height = SHEET;
        ctx = sheet.getContext('2d')!;
        this.sheets.push(sheet);
        x = 0; y = 0; rowH = 0;
      }
      ctx!.drawImage(it.c, x, y);
      placed.push({ k: it.k, sheet: this.sheets.length - 1, x, y, w, h, ax: it.m.anchorX, ay: it.m.anchorY });
      x += w + PAD;
      rowH = Math.max(rowH, h);
    }
    // trim the last sheet height to save GPU memory
    const sources = this.sheets.map((s) => Texture.from(s).source);
    for (const s of sources) { s.scaleMode = 'linear'; s.autoGenerateMipmaps = true; }
    for (const p of placed) {
      const tex = new Texture({ source: sources[p.sheet], frame: new Rectangle(p.x, p.y, p.w, p.h) });
      this.map.set(p.k, { tex, ax: p.ax, ay: p.ay, w: p.w, h: p.h });
    }
    for (const it of big) {
      const tex = Texture.from(it.c);
      tex.source.scaleMode = 'linear';
      if (STANDALONE.has(it.k)) tex.source.addressMode = 'repeat';
      this.map.set(it.k, { tex, ax: it.m.anchorX, ay: it.m.anchorY, w: it.c.width, h: it.c.height });
    }
  }

  has(key: string): boolean { return this.map.has(key); }

  get(key: string): TexInfo {
    const t = this.map.get(key);
    if (t) return t;
    return this.fallback(key);
  }

  /** First key that exists among candidates, else a generated placeholder. */
  pick(...keys: string[]): TexInfo {
    for (const k of keys) { const t = this.map.get(k); if (t) return t; }
    return this.fallback(keys[0]);
  }

  /** Coloured placeholder so missing art never crashes the game. */
  /** keys requested but missing from the atlas (debug aid) */
  missing = new Set<string>();

  private fallback(key: string): TexInfo {
    let f = this.fallbacks.get(key);
    if (f) return f;
    this.missing.add(key);
    const c = document.createElement('canvas');
    let size = 48;
    const m = /^bld:([a-z_]+)/.exec(key);
    if (m) size = 128;
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const axiom = key.includes(':axiom');
    const human = key.includes(':human');
    g.fillStyle = axiom ? '#5a1020' : human ? '#2a4a40' : '#555';
    g.strokeStyle = axiom ? '#ff2a4d' : human ? '#2fd4c4' : '#bbb';
    g.lineWidth = 3;
    if (key.startsWith('fx:glow') || key.startsWith('fx:spark') || key.startsWith('fx:smoke')) {
      const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, size, size);
    } else if (key.startsWith('fx:ring')) {
      g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2); g.strokeStyle = '#fff'; g.stroke();
    } else if (m) {
      g.fillRect(4, 4, size - 8, size - 8); g.strokeRect(4, 4, size - 8, size - 8);
    } else {
      g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(size / 2, size / 2); g.lineTo(size - 4, size / 2); g.stroke();
    }
    f = { tex: Texture.from(c), ax: 0.5, ay: 0.5, w: size, h: size };
    this.fallbacks.set(key, f);
    return f;
  }
}
