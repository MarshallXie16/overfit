import { BufferImageSource, CanvasSource, Container, GlProgram, Mesh, MeshGeometry, Shader, Sprite, Texture, UniformGroup, type Renderer } from 'pixi.js';
import { TILE } from './fx';

/**
 * AXIOM Grid (creep) layer drawn as ONE quad with a custom shader: no masks, filters or
 * render-to-texture. Per pixel it samples
 *   - the creep field (1 texel per tile, cubic B-spline from 4 bilinear taps; R = previous field,
 *     G = current field, blended by `phase` so the frontier grows smoothly between the sim's 0.5 s updates),
 *   - a tileable value-noise texture that roughens the edge into an organic outline,
 *   - the 256² circuit pattern (fx:creep_pattern, mipmapped, repeating, drifting over time),
 * and outputs dark crimson stain + pulsing circuitry + a faint glowing frontier, premultiplied.
 * The quad only covers the bounding box of tiles that have creep.
 *
 * GLSL is written WebGL2-style without `#version`, so Pixi compiles it as GLSL ES 1.00 (with its
 * in/out/texture defines) on WebGL1 and WebGL2 alike. Uniforms go through UniformGroup and textures
 * through TextureSource resources, which the `pixi.js/unsafe-eval` polyfill syncs without eval (CSP-safe).
 * On a non-WebGL renderer (WebGPU / canvas fallback) it degrades to a plain tint sprite.
 */

const VERT = `
in vec2 aPosition;
out vec2 vTile;
out vec2 vPat;
out vec2 vNoise;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uRect;   // quad in map px: x0, y0, x1, y1
uniform vec4 uPatXf;  // x: 1/TILE, y: 1/pattern period px, zw: pattern drift px
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aPosition);
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(p, 1.0)).xy, 0.0, 1.0);
  vTile = p * uPatXf.x;
  vPat = (p - uPatXf.zw) * uPatXf.y;
  // rotated so the noise lattice never lines up with the tile grid
  vNoise = mat2(0.8, 0.6, -0.6, 0.8) * vTile * 0.03125;
}
`;

const FRAG = `
in vec2 vTile;
in vec2 vPat;
in vec2 vNoise;
uniform sampler2D uCreep;
uniform sampler2D uPattern;
uniform sampler2D uNoise;
uniform vec4 uCreepFx; // x: 1/mapW, y: 1/mapH (tiles), z: prev->cur blend, w: pattern alpha (pulse)
uniform vec4 uRim;     // rgb: hot frontier colour, a: frontier halo alpha
uniform vec4 uColor;   // Pixi mesh tint/alpha
out vec4 finalColor;

// Cubic B-spline reconstruction of the 1-texel-per-tile field from 4 bilinear taps
// (round, smooth contours instead of bilinear's tile-aligned staircase). t is in tiles.
vec2 field(vec2 t) {
  vec2 st = t - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 p0 = (i - 0.5 + w1 / g0) * uCreepFx.xy;
  vec2 p1 = (i + 1.5 + w3 / g1) * uCreepFx.xy;
  vec2 a = texture(uCreep, p0).rg;
  vec2 b = texture(uCreep, vec2(p1.x, p0.y)).rg;
  vec2 c = texture(uCreep, vec2(p0.x, p1.y)).rg;
  vec2 d = texture(uCreep, p1).rg;
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

void main() {
  // sample everything up front (uniform control flow keeps mip selection valid)
  vec4 pat = texture(uPattern, vPat);
  float n = texture(uNoise, vNoise).r;
  vec2 cr = field(vTile);
  float v = mix(cr.x, cr.y, uCreepFx.z);
  // multiplicative noise roughens the outline into an organic edge and is 0 where there is no creep
  float s = v * (0.6 + 0.8 * n);
  float cov = smoothstep(0.1, 0.36, s);
  // band straddling the outline (also spots freshly growing tiles)
  float edge = smoothstep(0.03, 0.16, s) * (1.0 - smoothstep(0.2, 0.45, s));
  // dark crimson stain (as the old 1px/tile tint sprite: rgb 70,4,18 at up to ~0.59 alpha), turning
  // hot crimson along the frontier; still-growing tiles stay fainter so the spread reads
  float a = max(0.6 * cov * (0.25 + 0.75 * v), edge * uRim.a);
  vec4 col = vec4(mix(vec3(0.2745, 0.0157, 0.0706), uRim.rgb, edge) * a, a);
  // circuitry over it, fading in later than the stain (the old mask was v^2)
  pat *= uCreepFx.w * cov * v * v;
  col = pat + col * (1.0 - pat.a);
  // a touch of additive light so the frontier glows rather than just tints
  col.rgb += uRim.rgb * (edge * 0.06);
  finalColor = col * uColor;
}
`;

const PATTERN_PERIOD = 128; // world px per pattern repeat (256 px art at tileScale 0.5, as before)
const RIM = [0.72, 0.05, 0.15];

let noiseData: Uint8Array | null = null;
/** 128² tileable value-noise fBm (R=G=B), deterministic. */
function noise(): Uint8Array {
  if (noiseData) return noiseData;
  const S = 128;
  const acc = new Float32Array(S * S);
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const [n, amp] of [[16, 0.55], [32, 0.3], [64, 0.15]]) {
    const lat = new Float32Array(n * n);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const cell = S / n;
    for (let y = 0; y < S; y++) {
      const gy = y / cell, iy = Math.floor(gy), fy = gy - iy, sy = fy * fy * (3 - 2 * fy);
      const r0 = (iy % n) * n, r1 = ((iy + 1) % n) * n;
      for (let x = 0; x < S; x++) {
        const gx = x / cell, ix = Math.floor(gx), fx = gx - ix, sx = fx * fx * (3 - 2 * fx);
        const c0 = ix % n, c1 = (ix + 1) % n;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        acc[y * S + x] += amp * (a + (b - a) * sy);
      }
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of acc) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const out = new Uint8Array(S * S * 4);
  for (let i = 0; i < acc.length; i++) {
    const v = Math.round(((acc[i] - lo) / (hi - lo || 1)) * 255);
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  noiseData = out;
  return out;
}

/** The pattern's own canvas (it is uploaded standalone), or a crop if it ever lands in a packed sheet. */
function patternCanvas(t: Texture): HTMLCanvasElement {
  const src = t.source, f = t.frame;
  const res = src.resource as HTMLCanvasElement;
  if (!f.x && !f.y && f.width === src.width && f.height === src.height) return res;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(f.width));
  c.height = Math.max(1, Math.round(f.height));
  c.getContext('2d')!.drawImage(res, f.x, f.y, f.width, f.height, 0, 0, c.width, c.height);
  return c;
}

const quantize = (v: number): number => (v <= 0.02 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

export class CreepLayer {
  readonly view = new Container();
  private w: number;
  private h: number;
  /** per tile RGBA: R = previous field, G = current field, B = 0, A = 255 */
  private data: Uint8Array;
  private phase = 1;
  private src: BufferImageSource | null = null;
  private patSrc: CanvasSource | null = null;
  private noiseSrc: BufferImageSource | null = null;
  private mesh: Mesh<MeshGeometry, Shader> | null = null;
  private uni: UniformGroup | null = null;
  // non-WebGL fallback
  private fbCanvas: HTMLCanvasElement | null = null;
  private fbTex: Texture | null = null;

  constructor(renderer: Renderer, pattern: Texture, w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
    this.view.eventMode = 'none';
    if (renderer.name === 'webgl') this.initMesh(pattern);
    else this.initFallback();
  }

  private initMesh(pattern: Texture): void {
    this.src = new BufferImageSource({
      resource: this.data, width: this.w, height: this.h, format: 'rgba8unorm',
      alphaMode: 'premultiplied-alpha', scaleMode: 'linear', addressMode: 'clamp-to-edge',
    });
    // own repeating + mipmapped copy of the pattern (the atlas texture has no mips: shimmered when zoomed out)
    this.patSrc = new CanvasSource({
      resource: patternCanvas(pattern),
      scaleMode: 'linear', addressMode: 'repeat', autoGenerateMipmaps: true,
    });
    this.noiseSrc = new BufferImageSource({
      resource: noise(), width: 128, height: 128, format: 'rgba8unorm',
      alphaMode: 'premultiplied-alpha', scaleMode: 'linear', addressMode: 'repeat',
    });
    this.uni = new UniformGroup({
      uRect: { value: new Float32Array(4), type: 'vec4<f32>' },
      uPatXf: { value: new Float32Array([1 / TILE, 1 / PATTERN_PERIOD, 0, 0]), type: 'vec4<f32>' },
      uCreepFx: { value: new Float32Array([1 / this.w, 1 / this.h, 1, 0.55]), type: 'vec4<f32>' },
      uRim: { value: new Float32Array(4), type: 'vec4<f32>' },
    });
    const shader = new Shader({
      glProgram: GlProgram.from({ vertex: VERT, fragment: FRAG, name: 'creep-grid', preferredFragmentPrecision: 'highp' }),
      resources: { uCreep: this.src, uPattern: this.patSrc, uNoise: this.noiseSrc, creepUniforms: this.uni },
    });
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.mesh = new Mesh({ geometry, shader });
    this.mesh.eventMode = 'none';
    this.mesh.visible = false;
    this.view.addChild(this.mesh);
  }

  private initFallback(): void {
    this.fbCanvas = document.createElement('canvas');
    this.fbCanvas.width = this.w;
    this.fbCanvas.height = this.h;
    this.fbTex = new Texture({ source: new CanvasSource({ resource: this.fbCanvas, scaleMode: 'linear' }) });
    const sp = new Sprite(this.fbTex);
    sp.scale.set(TILE);
    this.view.addChild(sp);
  }

  /**
   * Feed the sim's creep field. Re-uploads only when a quantized value changed; returns whether it
   * did (the caller then restarts the prev→cur blend). `snap` skips the blend (first frame).
   */
  update(creep: Float32Array, snap = false): boolean {
    const d = this.data, n = this.w * this.h;
    let i = 0;
    for (; i < n; i++) if (quantize(creep[i]) !== d[i * 4 + 1]) break;
    if (i === n) return false;
    const t = snap ? 1 : this.phase;
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0, k = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++, k += 4) {
        const q = quantize(creep[k >> 2]);
        // previous = what is on screen right now, so a new field never pops
        const prev = snap ? q : Math.round(d[k] + (d[k + 1] - d[k]) * t);
        d[k] = prev;
        d[k + 1] = q;
        if (prev | q) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (snap) this.phase = 1;
    if (this.src && this.mesh && this.uni) {
      this.src.update();
      const visible = x1 >= 0;
      this.mesh.visible = visible;
      if (visible) {
        // the cubic filter reaches 2 tiles past the last non-zero texel centre
        const r = this.uni.uniforms.uRect as Float32Array;
        r[0] = Math.max(0, x0 - 2) * TILE;
        r[1] = Math.max(0, y0 - 2) * TILE;
        r[2] = Math.min(this.w, x1 + 3) * TILE;
        r[3] = Math.min(this.h, y1 + 3) * TILE;
      }
    } else if (this.fbCanvas && this.fbTex) {
      const g = this.fbCanvas.getContext('2d')!;
      const img = g.createImageData(this.w, this.h);
      const a = img.data;
      for (let p = 0; p < n; p++) {
        const v = d[p * 4 + 1] / 255;
        if (!v) continue;
        a[p * 4] = 70; a[p * 4 + 1] = 4; a[p * 4 + 2] = 18; a[p * 4 + 3] = Math.min(255, v * 150);
      }
      g.putImageData(img, 0, 0);
      this.fbTex.source.update();
    }
    return true;
  }

  /** Per-frame animation. `phase` 0..1 = progress from the previous to the current creep field. */
  frame(time: number, phase: number): void {
    this.phase = Math.max(0, Math.min(1, phase));
    const u = this.uni;
    if (!u || !this.mesh?.visible) return;
    const pulse = Math.sin(time * 2.2);
    const fx = u.uniforms.uCreepFx as Float32Array;
    fx[2] = this.phase;
    fx[3] = 0.55 + pulse * 0.25;
    const pt = u.uniforms.uPatXf as Float32Array;
    pt[2] = (time * 6) % PATTERN_PERIOD;
    pt[3] = (time * 3) % PATTERN_PERIOD;
    const rim = u.uniforms.uRim as Float32Array;
    const k = 0.85 + pulse * 0.15;
    rim[0] = RIM[0] * k; rim[1] = RIM[1] * k; rim[2] = RIM[2] * k;
    rim[3] = 0.2 + pulse * 0.05;
  }

  destroy(): void {
    this.view.removeFromParent();
    if (this.mesh) {
      const sh = this.mesh.shader, geo = this.mesh.geometry;
      this.mesh.destroy();
      geo.destroy();
      sh?.destroy(false); // keep the cached GlProgram for the next session
    }
    this.view.destroy({ children: true });
    this.src?.destroy();
    this.patSrc?.destroy();
    this.noiseSrc?.destroy();
    this.fbTex?.destroy(true);
    this.mesh = null;
    this.uni = null;
    this.src = this.noiseSrc = null;
    this.patSrc = null;
    this.fbTex = null;
    this.fbCanvas = null;
  }
}
