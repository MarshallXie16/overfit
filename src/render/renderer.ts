import { Application, BufferImageSource, CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { BUILDINGS } from '../sim/data/defs';
import { AXIOM, HUMAN, type SimEvent } from '../sim/types';
import type { Entity, World } from '../sim/world';
import { CreepLayer } from './creepMesh';
import { ART_SCALE, Fx, TILE } from './fx';
import type { TextureBank, TexInfo } from './textures';

export interface Camera { x: number; y: number; zoom: number }

export interface TerrainRenderer {
  renderTerrainChunk(map: { w: number; h: number; terrain: Uint8Array; seed: number }, x0: number, y0: number, tw: number, th: number, pxPerTile?: number): HTMLCanvasElement;
}

interface View {
  id: number;
  root: Container;
  body: Sprite;
  shadow: Sprite | null;
  turret: Sprite | null;
  overlay: Sprite | null; // scaffold
  kind: string;
  teamKey: string;
  frames: TexInfo[] | null;
  live: boolean;
  turretTi: TexInfo | null;
  stamp: number;
  lastHp: number;
  frameT: number;
  wallMask: number;
}

const TEAM_COL = { human: 0x37e0c8, axiom: 0xff3355, neutral: 0xe8d070, hacked: 0x45f0ff };
const CHUNK = 32;

export class GameRenderer {
  app: Application;
  bank: TextureBank;
  world: World | null = null;
  cam: Camera = { x: 0, y: 0, zoom: 1 };
  root = new Container();
  private terrainLayer = new Container();
  private creepLayer = new Container();
  private resLayer = new Container({ isRenderGroup: true });
  private ringLayer = new Container();
  private bldLayer = new Container({ isRenderGroup: true });
  private shadowLayer = new Container({ isRenderGroup: true });
  private unitLayer = new Container({ isRenderGroup: true });
  private projLayer = new Container({ isRenderGroup: true });
  private airShadowLayer = new Container({ isRenderGroup: true });
  private airLayer = new Container({ isRenderGroup: true });
  private fogLayer = new Container();
  private overlayG = new Graphics();
  private barG = new Graphics();
  private screenG = new Graphics();
  fx: Fx;
  private views = new Map<number, View>();
  private stamp = 0;
  /** fog: 1 texel per tile, premultiplied RGBA uploaded straight from this buffer (no canvas round-trip) */
  private fogData: Uint8Array | null = null;
  private fogSrc: BufferImageSource | null = null;
  private fogSprite: Sprite | null = null;
  private fogTick = -1;
  /** AXIOM Grid: one shader quad (see creepMesh.ts) */
  private creep: CreepLayer | null = null;
  /** index of the last 10-tick creep period fed to the layer (sim updates creep when tick % 10 === 5) */
  private creepEpoch = Number.NaN;
  /** tick at which the creep layer last received a changed field (start of its prev→cur blend) */
  private creepBlendTick = 0;
  private ownedTex: Texture[] = [];
  private seen = new Set<number>();
  private projSprites: Sprite[] = [];
  private projGlow: Sprite[] = [];
  private explosionFrames: Texture[] = [];
  private time = 0;
  selected = new Set<number>();
  hoverId = 0;
  /** placement ghost (set by input) */
  ghost: { kind: string; tx: number; ty: number; ok: boolean; line?: { tx: number; ty: number }[] } | null = null;
  ghostSprites: Sprite[] = [];
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  targetCircle: { x: number; y: number; r: number; color: number } | null = null;
  terrainApi: TerrainRenderer | null = null;
  pings: { x: number; y: number; t: number; color: number }[] = [];
  private markers: { x: number; y: number; t: number; color: number }[] = [];
  private orbitals: { x: number; y: number; r: number; t: number }[] = [];

  constructor(app: Application, bank: TextureBank) {
    this.app = app;
    this.bank = bank;
    this.fx = new Fx(bank);
    for (let i = 0; i < 8; i++) {
      const k = 'fx:explosion:' + i;
      if (bank.has(k)) this.explosionFrames.push(bank.get(k).tex);
    }
    this.root.addChild(
      this.terrainLayer, this.creepLayer, this.fx.decalLayer, this.resLayer, this.ringLayer, this.shadowLayer,
      this.bldLayer, this.unitLayer, this.fx.normLayer, this.projLayer, this.airShadowLayer, this.airLayer,
      this.fx.addLayer, this.fogLayer, this.overlayG, this.barG,
    );
    this.app.stage.addChild(this.root, this.screenG);
  }

  private canvasTex(c: HTMLCanvasElement): Texture {
    const t = new Texture({ source: new CanvasSource({ resource: c, scaleMode: 'linear' }) });
    this.ownedTex.push(t);
    return t;
  }

  // ---------------------------------------------------------------- world setup
  setWorld(w: World, terrain: TerrainRenderer | null): void {
    this.clear();
    this.world = w;
    this.terrainApi = terrain;
    const map = { w: w.w, h: w.h, terrain: w.terrain, seed: w.settings.seed };
    for (let cy = 0; cy < w.h; cy += CHUNK) {
      for (let cx = 0; cx < w.w; cx += CHUNK) {
        const tw = Math.min(CHUNK, w.w - cx), th = Math.min(CHUNK, w.h - cy);
        let canvas: HTMLCanvasElement;
        if (terrain) canvas = terrain.renderTerrainChunk(map, cx, cy, tw, th, TILE);
        else canvas = this.fallbackTerrain(w, cx, cy, tw, th);
        const sp = new Sprite(this.canvasTex(canvas));
        sp.position.set(cx * TILE, cy * TILE);
        sp.width = tw * TILE; sp.height = th * TILE;
        this.terrainLayer.addChild(sp);
      }
    }
    // creep: single shader quad (stain + circuitry + frontier glow), no mask/filter passes
    this.creep = new CreepLayer(this.app.renderer, this.bank.get('fx:creep_pattern').tex, w.w, w.h);
    this.creepLayer.addChild(this.creep.view);
    this.creepEpoch = Number.NaN;
    // fog
    this.fogData = new Uint8Array(w.w * w.h * 4);
    this.fogSrc = new BufferImageSource({ resource: this.fogData, width: w.w, height: w.h, format: 'rgba8unorm', alphaMode: 'premultiplied-alpha', scaleMode: 'linear' });
    const fogTex = new Texture({ source: this.fogSrc });
    this.ownedTex.push(fogTex);
    this.fogSprite = new Sprite(fogTex);
    this.fogSprite.scale.set(TILE);
    this.fogLayer.addChild(this.fogSprite);
    this.fogTick = -1;
  }

  private fallbackTerrain(w: World, x0: number, y0: number, tw: number, th: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = tw * TILE; c.height = th * TILE;
    const g = c.getContext('2d')!;
    const cols = ['#2b2c2b', '#1f2021', '#3a3530', '#10202a', '#121212', '#2c3326'];
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      g.fillStyle = cols[w.terrain[(y0 + y) * w.w + x0 + x]] ?? '#333';
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
    return c;
  }

  clear(): void {
    for (const v of this.views.values()) { v.root.destroy({ children: true }); v.shadow?.destroy(); }
    this.views.clear();
    this.seen.clear();
    this.terrainLayer.removeChildren().forEach((c) => c.destroy());
    this.creep?.destroy();
    this.creep = null;
    this.creepLayer.removeChildren().forEach((c) => c.destroy());
    this.fogLayer.removeChildren().forEach((c) => c.destroy());
    for (const s of this.projSprites) s.destroy();
    for (const s of this.projGlow) s.destroy();
    this.projSprites = []; this.projGlow = [];
    this.fx.clear();
    for (const t of this.ownedTex) t.destroy(true);
    this.ownedTex = [];
    this.fogSrc = null;
    this.fogSprite = null;
    this.fogData = null;
    this.world = null;
  }

  /** Tear down everything this renderer added to the stage (atlas textures are shared and kept). */
  destroy(): void {
    this.clear();
    this.root.destroy({ children: true });
    this.screenG.destroy();
  }

  // ---------------------------------------------------------------- coordinates
  /** Viewport size in CSS pixels (Pixi v8: app.screen is already CSS px, independent of resolution). */
  get screenW(): number { return this.app.screen.width; }
  get screenH(): number { return this.app.screen.height; }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const z = this.cam.zoom * TILE;
    return { x: (sx - this.screenW / 2) / z + this.cam.x, y: (sy - this.screenH / 2) / z + this.cam.y };
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const z = this.cam.zoom * TILE;
    return { x: (x - this.cam.x) * z + this.screenW / 2, y: (y - this.cam.y) * z + this.screenH / 2 };
  }

  viewBounds(): { x0: number; y0: number; x1: number; y1: number } {
    const a = this.screenToWorld(0, 0), b = this.screenToWorld(this.screenW, this.screenH);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  clampCamera(): void {
    const w = this.world;
    if (!w) return;
    this.cam.zoom = Math.max(0.4, Math.min(2.2, this.cam.zoom));
    const hw = this.screenW / 2 / (this.cam.zoom * TILE), hh = this.screenH / 2 / (this.cam.zoom * TILE);
    const mx = Math.min(hw, w.w / 2), my = Math.min(hh, w.h / 2);
    this.cam.x = Math.max(mx - 2, Math.min(w.w - mx + 2, this.cam.x));
    this.cam.y = Math.max(my - 2, Math.min(w.h - my + 2 + 4, this.cam.y));
  }

  // ---------------------------------------------------------------- per-frame
  private adaptTint = 0xffffff;
  private frameDt = 1 / 60;
  private computeAdaptTint(w: World): void {
    const r = w.axiom.resist;
    let top: 'kinetic' | 'energy' | 'explosive' = 'kinetic';
    for (const k of ['energy', 'explosive'] as const) if (r[k] > r[top]) top = k;
    const v = Math.min(1, r[top] / 0.6) * 0.55;
    const col = top === 'kinetic' ? [255, 196, 120] : top === 'energy' ? [130, 225, 255] : [255, 150, 90];
    const mix = (c: number) => Math.round(255 + (c - 255) * v);
    this.adaptTint = (mix(col[0]) << 16) | (mix(col[1]) << 8) | mix(col[2]);
  }

  render(alpha: number, dt: number): void {
    const w = this.world;
    if (!w) return;
    this.time += dt;
    this.frameDt = dt;
    if (w.tick % 20 === 0) this.computeAdaptTint(w);
    this.clampCamera();
    const z = this.cam.zoom;
    const sh = this.fx.shakeAmt;
    const ox = sh ? (Math.random() - 0.5) * sh : 0, oy = sh ? (Math.random() - 0.5) * sh : 0;
    this.root.scale.set(z);
    this.root.position.set(Math.round(this.screenW / 2 - this.cam.x * TILE * z + ox), Math.round(this.screenH / 2 - this.cam.y * TILE * z + oy));
    const vb = this.viewBounds();
    this.fx.view = { x0: vb.x0 * TILE, y0: vb.y0 * TILE, x1: vb.x1 * TILE, y1: vb.y1 * TILE };

    this.updateCreep(w, alpha);
    // fully revealed: skip the map-sized fog blend pass entirely
    if (this.fogSprite) this.fogSprite.visible = !w.revealAll;
    if (w.tick !== this.fogTick) this.updateFog(w);

    this.stamp++;
    const stamp = this.stamp;
    const m = 3;
    for (const e of w.entities) {
      if (!e.alive) continue;
      const vis = this.isShown(w, e);
      if (!vis) { const v = this.views.get(e.id); if (v) { v.root.visible = false; if (v.shadow) v.shadow.visible = false; v.stamp = stamp; } continue; }
      // enemy structures under fog keep their last-seen look
      if (e.isBuilding && e.team !== HUMAN && !w.revealAll) {
        if (this.bldVisible(w, e)) this.seen.add(e.id);
        else {
          const v = this.views.get(e.id);
          if (v && this.seen.has(e.id)) { v.root.visible = true; v.stamp = stamp; v.live = false; continue; }
          if (!this.seen.has(e.id) && e.team === AXIOM) { if (v) { v.root.visible = false; v.stamp = stamp; } continue; }
        }
      }
      const ix = e.px + (e.x - e.px) * alpha, iy = e.py + (e.y - e.py) * alpha;
      const r = e.isBuilding ? e.size : 2;
      const onScreen = ix > vb.x0 - r - m && ix < vb.x1 + r + m && iy > vb.y0 - r - m && iy < vb.y1 + r + m;
      let v = this.views.get(e.id);
      if (!onScreen) { if (v) { v.root.visible = false; if (v.shadow) v.shadow.visible = false; v.stamp = stamp; } continue; }
      if (!v) { v = this.createView(e); this.views.set(e.id, v); }
      v.stamp = stamp;
      v.live = true;
      this.updateView(w, e, v, ix, iy, dt);
    }
    for (const [id, v] of this.views) {
      if (v.stamp !== stamp) {
        v.root.destroy({ children: true });
        if (v.shadow) v.shadow.destroy();
        this.views.delete(id);
      }
    }
    this.renderProjectiles(w, alpha);
    this.renderOverlays(w, alpha, dt);
    this.fx.update(dt);
    this.renderScreen();
  }

  private bldVisible(w: World, e: Entity): boolean {
    const a = e.tx + 0.5, b = e.ty + 0.5, c = e.tx + e.size - 0.5, d = e.ty + e.size - 0.5;
    return w.isVisible(e.x, e.y) || w.isVisible(a, b) || w.isVisible(c, b) || w.isVisible(a, d) || w.isVisible(c, d);
  }

  private isShown(w: World, e: Entity): boolean {
    if (e.team === HUMAN) return true;
    if (w.revealAll) return true;
    if (e.isBuilding || e.cat === 'resource') {
      // remembered once explored
      return !!w.explored[(e.y | 0) * w.w + (e.x | 0)];
    }
    if (e.cat === 'wreck') return !!w.explored[(e.y | 0) * w.w + (e.x | 0)];
    return w.isVisible(e.x, e.y);
  }

  private teamKey(e: Entity): string {
    if (e.kind === 'server_farm') return e.team === HUMAN ? 'human' : e.team === AXIOM ? 'axiom' : 'neutral';
    if (e.isRobot || (e.isBuilding && e.bdef?.side === 'axiom')) return e.hacked ? 'hacked' : 'axiom';
    return 'human';
  }

  private createView(e: Entity): View {
    const root = new Container();
    const body = new Sprite();
    body.anchor.set(0.5);
    root.addChild(body);
    let shadow: Sprite | null = null;
    let turret: Sprite | null = null;
    let overlay: Sprite | null = null;
    if (e.isUnit) {
      shadow = new Sprite();
      shadow.anchor.set(0.5);
      shadow.tint = 0x000000;
      shadow.alpha = e.flying ? 0.3 : 0.42;
      (e.flying ? this.airShadowLayer : this.shadowLayer).addChild(shadow);
      if (e.udef?.turret) { turret = new Sprite(); turret.anchor.set(0.5); root.addChild(turret); }
      (e.flying ? this.airLayer : this.unitLayer).addChild(root);
    } else if (e.isBuilding) {
      if (e.bdef?.turret) { turret = new Sprite(); turret.anchor.set(0.5); root.addChild(turret); }
      overlay = new Sprite(); overlay.anchor.set(0.5); overlay.visible = false; root.addChild(overlay);
      this.bldLayer.addChild(root);
    } else {
      this.resLayer.addChild(root);
    }
    return { id: e.id, root, body, shadow, turret, overlay, kind: '', teamKey: '', frames: null, turretTi: null, live: true, stamp: 0, lastHp: e.hp, frameT: Math.random() * 10, wallMask: -1 };
  }

  private setTex(sp: Sprite, ti: TexInfo): void {
    if (sp.texture !== ti.tex) { sp.texture = ti.tex; sp.anchor.set(ti.ax, ti.ay); }
  }

  private updateView(w: World, e: Entity, v: View, ix: number, iy: number, dt: number): void {
    v.root.visible = true;
    const tk = this.teamKey(e);
    const px = ix * TILE, py = iy * TILE;
    v.root.position.set(px, py);
    if (e.isUnit) {
      v.frameT += dt * (e.moving ? 1 : 0);
      const nFrames = e.udef?.armor === 'armored' && !e.isRobot ? 2 : 4;
      const fps = e.isRobot ? 9 : 7;
      const frame = e.moving ? Math.floor(v.frameT * fps) % nFrames : 0;
      if (v.teamKey !== tk || !v.frames) {
        v.teamKey = tk;
        v.frames = [0, 1, 2, 3].map((f) => this.bank.pick(`unit:${e.kind}:${tk}:${f}`, `unit:${e.kind}:${tk}:0`));
        v.turretTi = v.turret ? this.bank.get(`unit:${e.kind}:${tk}:turret`) : null;
      }
      const ti = v.frames[e.flying ? Math.floor(this.time * 20) % 2 : frame];
      this.setTex(v.body, ti);
      v.body.scale.set(ART_SCALE);
      v.body.rotation = e.angle;
      if (v.turret) {
        this.setTex(v.turret, v.turretTi!);
        v.turret.scale.set(ART_SCALE);
        v.turret.rotation = e.turretAngle;
      }
      if (v.shadow) {
        v.shadow.visible = true;
        v.shadow.texture = v.body.texture;
        v.shadow.anchor.copyFrom(v.body.anchor);
        v.shadow.scale.set(ART_SCALE * (e.flying ? 0.85 : 1.02));
        v.shadow.rotation = e.angle;
        const off = e.flying ? 26 : e.radius > 0.6 ? 5 : 3;
        v.shadow.position.set(px + off * 0.6, py + off);
      }
      // stunned tint; AXIOM robots' plating shifts toward their dominant adaptation
      const stunned = e.stunUntil > w.time;
      v.body.tint = stunned ? 0x8fb8ff : e.team === AXIOM ? this.adaptTint : 0xffffff;
      if (stunned && Math.random() < dt * 8) this.fx.spawn('fx:spark', px + (Math.random() - 0.5) * 20, py + (Math.random() - 0.5) * 20, { life: 0.2, s0: 0.4, s1: 0.1, tint: 0x80c0ff, add: true });
      v.root.alpha = 1;
    } else if (e.isBuilding) {
      const mask = e.bdef?.wall ? this.wallMask(w, e) : -1;
      if (v.teamKey !== tk || v.wallMask !== mask || !v.frames) {
        v.teamKey = tk;
        v.wallMask = mask;
        const key = mask >= 0 ? `bld:wall:human:${mask}` : `bld:${e.kind}:${tk}`;
        v.frames = [this.bank.pick(key, `bld:${e.kind}:human`, `bld:${e.kind}:axiom`)];
        v.turretTi = v.turret ? this.bank.pick(`bld:${e.kind}:${tk}:turret`, `bld:${e.kind}:axiom:turret`, `bld:${e.kind}:human:turret`) : null;
      }
      this.setTex(v.body, v.frames[0]);
      v.body.scale.set(ART_SCALE);
      if (v.turret) {
        this.setTex(v.turret, v.turretTi!);
        v.turret.scale.set(ART_SCALE);
        v.turret.rotation = e.turretAngle;
        v.turret.visible = e.built;
      }
      if (!e.built) {
        v.body.alpha = e.team === AXIOM ? 0.35 + 0.4 * e.progress + Math.sin(this.time * 8) * 0.1 : 0.5 + 0.3 * e.progress;
        if (v.overlay && e.team === HUMAN) {
          v.overlay.visible = true;
          this.setTex(v.overlay, this.bank.get(`fx:scaffold:${Math.min(5, e.size)}`));
          v.overlay.scale.set(ART_SCALE);
        }
        if (e.team === HUMAN && Math.random() < dt * 4 && e.builders >= 0) this.fx.spawn('fx:spark', px + (Math.random() - 0.5) * e.size * TILE, py + (Math.random() - 0.5) * e.size * TILE, { life: 0.3, s0: 0.35, s1: 0.1, tint: 0xffd080, add: true, vy: -30 });
      } else {
        v.body.alpha = 1;
        if (v.overlay) v.overlay.visible = false;
      }
      v.body.tint = e.stunUntil > w.time ? 0x9fbfff : 0xffffff;
      // damage smoke/fire
      const hpf = e.hp / e.maxHp;
      if (e.built && hpf < 0.55 && e.kind !== 'server_farm' && Math.random() < dt * (hpf < 0.25 ? 10 : 4)) {
        const sx = px + (Math.random() - 0.5) * e.size * TILE * 0.7, sy = py + (Math.random() - 0.5) * e.size * TILE * 0.7;
        this.fx.spawn('fx:smoke', sx, sy, { vx: 6, vy: -18, life: 1.6, s0: 0.5, s1: 1.4, a0: 0.45, a1: 0, tint: 0x2a2624 });
        if (hpf < 0.3) this.fx.spawn('fx:glow', sx, sy, { life: 0.4, s0: 0.5, s1: 0.2, a0: 0.8, tint: 0xff7a20, add: true, vy: -20 });
      }
    } else {
      // resources / wrecks
      if (e.cat === 'resource') {
        this.setTex(v.body, this.bank.get(`res:scrap:${e.variant % 4}`));
        v.body.scale.set(ART_SCALE * (0.75 + 0.25 * Math.min(1, e.amount / 400)));
        if (Math.random() < dt * 0.6) this.fx.spawn('fx:glow', px + (Math.random() - 0.5) * 18, py + (Math.random() - 0.5) * 18, { life: 0.5, s0: 0.05, s1: 0.32, a0: 0.9, a1: 0, tint: 0xffc060, add: true });
      } else {
        const size = ['small', 'medium', 'large'][Math.min(2, e.variant >> 1)];
        this.setTex(v.body, this.bank.pick(`wreck:${size}:${e.variant & 1}`, `wreck:${size}:0`));
        v.body.scale.set(ART_SCALE);
        v.body.rotation = (e.id * 2.39) % (Math.PI * 2);
        const left = e.expire - w.time;
        v.body.alpha = Math.max(0, Math.min(1, left / 6));
      }
    }
  }

  private wallMask(w: World, e: Entity): number {
    let m = 0;
    const isWall = (x: number, y: number) => {
      if (!w.inBounds(x, y)) return false;
      const id = w.occ[y * w.w + x];
      const o = id ? w.byId.get(id) : undefined;
      return !!o && !!o.bdef?.wall && o.team === e.team;
    };
    if (isWall(e.tx, e.ty - 1)) m |= 1;
    if (isWall(e.tx + 1, e.ty)) m |= 2;
    if (isWall(e.tx, e.ty + 1)) m |= 4;
    if (isWall(e.tx - 1, e.ty)) m |= 8;
    return m;
  }

  private renderProjectiles(w: World, alpha: number): void {
    const ps = w.projectiles;
    while (this.projSprites.length < ps.length) {
      const s = new Sprite(); s.anchor.set(0.5); this.projLayer.addChild(s); this.projSprites.push(s);
      const g = new Sprite(this.bank.get('fx:glow').tex); g.anchor.set(0.5); g.blendMode = 'add'; this.projLayer.addChild(g); this.projGlow.push(g);
    }
    for (let i = 0; i < this.projSprites.length; i++) {
      const s = this.projSprites[i], g = this.projGlow[i];
      const p = ps[i];
      if (!p || !w.isVisible(p.x, p.y)) { s.visible = false; g.visible = false; continue; }
      s.visible = true; g.visible = true;
      const x = (p.px + (p.x - p.px) * alpha) * TILE, y = (p.py + (p.y - p.py) * alpha) * TILE;
      const isShell = p.wpn.fx === 'shell';
      const t = Math.min(1, p.t / p.total);
      const h = isShell ? Math.sin(Math.PI * t) * TILE * 1.8 : 0;
      s.texture = this.bank.get(isShell ? 'fx:shell' : 'fx:rocket').tex;
      s.position.set(x, y - h);
      s.rotation = Math.atan2(p.ty - p.y, p.tx - p.x);
      s.scale.set(ART_SCALE * (isShell ? 1 + h / 120 : 1));
      g.position.set(x, y - h);
      g.scale.set(0.35);
      g.tint = p.team === AXIOM ? 0xff4060 : 0xffa040;
      g.alpha = 0.8;
      if (Math.random() < this.frameDt * 24 && this.fx.inView(x, y)) this.fx.spawn('fx:smoke', x, y - h, { life: 0.6, s0: 0.25, s1: 0.6, a0: 0.4, a1: 0, tint: 0x555050 });
    }
  }

  private renderOverlays(w: World, alpha: number, dt: number): void {
    const g = this.overlayG;
    g.clear();
    const bars = this.barG;
    bars.clear();
    const T = TILE;
    // pings / markers
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const mk = this.markers[i];
      mk.t += dt;
      if (mk.t > 0.6) { this.markers.splice(i, 1); continue; }
      const a = 1 - mk.t / 0.6;
      const r = (0.6 - mk.t * 0.6) * T;
      g.circle(mk.x * T, mk.y * T, r).stroke({ width: 2, color: mk.color, alpha: a });
    }
    for (let i = this.orbitals.length - 1; i >= 0; i--) {
      const o = this.orbitals[i];
      o.t += dt;
      if (o.t > 2.1) { this.orbitals.splice(i, 1); continue; }
      const pulse = 0.5 + 0.5 * Math.sin(o.t * 18);
      g.circle(o.x * T, o.y * T, o.r * T).stroke({ width: 3, color: 0xff3030, alpha: 0.5 + pulse * 0.5 });
      g.circle(o.x * T, o.y * T, o.r * T * (1 - o.t / 2.1)).stroke({ width: 2, color: 0xffa0a0, alpha: 0.8 });
    }
    // selection rings & bars
    for (const e of w.entities) {
      if (!e.alive) continue;
      const v = this.views.get(e.id);
      if (!v || !v.root.visible) continue;
      const sel = this.selected.has(e.id);
      const hov = this.hoverId === e.id;
      const x = v.root.position.x, y = v.root.position.y;
      const col = e.team === HUMAN ? (e.hacked ? TEAM_COL.hacked : TEAM_COL.human) : e.team === AXIOM ? TEAM_COL.axiom : TEAM_COL.neutral;
      if (sel || hov) {
        if (e.isBuilding) {
          const s = e.size * T;
          g.rect(e.tx * T - 2, e.ty * T - 2, s + 4, s + 4).stroke({ width: sel ? 2 : 1, color: col, alpha: sel ? 0.9 : 0.5 });
        } else {
          g.ellipse(x, y + e.radius * T * 0.2, (e.radius + 0.18) * T, (e.radius + 0.12) * T * 0.8).stroke({ width: sel ? 1.6 : 1, color: col, alpha: sel ? 0.95 : 0.55 });
        }
      }
      // health bars
      const damaged = e.hp < e.maxHp - 0.5;
      if (!v.live) continue; // fogged enemy structure: no live info
      if ((e.isUnit || e.isBuilding) && e.kind !== 'server_farm' && (sel || hov || damaged || (e.isBuilding && !e.built))) {
        const wpx = e.isBuilding ? e.size * T * 0.8 : Math.max(18, e.radius * T * 2.2);
        const by = e.isBuilding ? e.ty * T - 6 : y - e.radius * T - 9;
        const bx = x - wpx / 2;
        const f = Math.max(0, e.hp / e.maxHp);
        bars.rect(bx - 1, by - 1, wpx + 2, 5).fill({ color: 0x000000, alpha: 0.6 });
        const hc = f > 0.6 ? (e.team === HUMAN ? 0x4be38a : 0xff4a5a) : f > 0.3 ? 0xffc040 : 0xff3b30;
        bars.rect(bx, by, wpx * f, 3).fill({ color: hc });
        if (e.isBuilding && !e.built) {
          bars.rect(bx, by + 4, wpx, 2).fill({ color: 0x000000, alpha: 0.6 });
          bars.rect(bx, by + 4, wpx * e.progress, 2).fill({ color: 0x9fd8ff });
        }
      }
      if (e.isBuilding && e.prod.length && (sel || hov)) {
        const it = e.prod[0];
        const wpx = e.size * T * 0.8;
        bars.rect(x - wpx / 2, e.ty * T + e.size * T + 3, wpx * (it.t / it.total), 3).fill({ color: 0xffd060 });
      }
      // hacking channel
      if (e.hackTarget && e.hackT > 0 && e.team === HUMAN) {
        const t = w.get(e.hackTarget);
        if (t) {
          const need = w.human.hackTime * (t.isBuilding ? 2 : 1);
          const p = Math.min(1, e.hackT / need);
          const tx = t.x * T, ty = t.y * T;
          g.moveTo(x, y).lineTo(tx, ty).stroke({ width: 1.5, color: 0x45f0ff, alpha: 0.4 + 0.4 * Math.sin(this.time * 30) });
          g.arc(tx, ty, (t.radius + 0.35) * T, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2).stroke({ width: 3, color: 0x45f0ff, alpha: 0.95 });
          if (Math.random() < 0.3) this.fx.spawn('fx:hack', tx + (Math.random() - 0.5) * 20, ty + (Math.random() - 0.5) * 20, { life: 0.4, s0: 0.35, s1: 0.2, a0: 0.9, a1: 0, tint: 0x45f0ff, add: true, vy: -25 });
        }
      }
      // server farm capture ring
      if (e.kind === 'server_farm' && Math.abs(e.capture) > 0.01 && Math.abs(e.capture) < 1) {
        const c2 = e.capture > 0 ? TEAM_COL.human : TEAM_COL.axiom;
        g.arc(x, y, e.size * T * 0.75, -Math.PI / 2, -Math.PI / 2 + Math.abs(e.capture) * Math.PI * 2).stroke({ width: 4, color: c2, alpha: 0.9 });
      }
      if (e.kind === 'server_farm') {
        g.circle(x, y, 4.5 * T).stroke({ width: 1, color: e.team === HUMAN ? TEAM_COL.human : e.team === AXIOM ? TEAM_COL.axiom : 0xe8d070, alpha: 0.18 });
      }
      // rally lines for selected producers
      if (sel && e.isBuilding && e.rally) {
        g.moveTo(x, y).lineTo(e.rally.x * T, e.rally.y * T).stroke({ width: 1, color: 0x9fffd0, alpha: 0.5 });
        g.circle(e.rally.x * T, e.rally.y * T, 5).fill({ color: 0x9fffd0, alpha: 0.8 });
      }
      // order lines for selected units
      if (sel && e.isUnit && e.team === HUMAN) {
        let lx = x, ly = y;
        const orders = e.order ? [e.order, ...e.queue] : [];
        for (const o of orders) {
          let ox: number | undefined, oy: number | undefined, c = 0x6fe0a0;
          if (o.type === 'move' || o.type === 'amove') { ox = o.x; oy = o.y; c = o.type === 'amove' ? 0xff8060 : 0x6fe0a0; }
          else if ('id' in o) { const t = w.get(o.id); if (t) { ox = t.x; oy = t.y; c = o.type === 'attack' ? 0xff6060 : o.type === 'hack' ? 0x45f0ff : 0xffd060; } }
          if (ox === undefined || oy === undefined) continue;
          g.moveTo(lx, ly).lineTo(ox * T, oy * T).stroke({ width: 1, color: c, alpha: 0.35 });
          g.circle(ox * T, oy * T, 3).fill({ color: c, alpha: 0.6 });
          lx = ox * T; ly = oy * T;
        }
      }
      // weapon range for selected turrets
      if (sel && e.isBuilding && e.bdef?.weapon) {
        g.circle(x, y, (e.bdef.weapon.range + e.radius * 0.5) * T).stroke({ width: 1, color: col, alpha: 0.25 });
      }
    }
    // placement ghost
    for (const s of this.ghostSprites) s.visible = false;
    if (this.ghost) {
      const gh = this.ghost;
      const def = BUILDINGS[gh.kind];
      const tiles = gh.line ?? [{ tx: gh.tx, ty: gh.ty }];
      let i = 0;
      for (const t of tiles) {
        let s = this.ghostSprites[i];
        if (!s) { s = new Sprite(); s.anchor.set(0.5); this.overlayG.parent!.addChild(s); this.ghostSprites.push(s); }
        s.visible = true;
        const ti = this.bank.pick(def.wall ? 'bld:wall:human:0' : `bld:${gh.kind}:human`);
        this.setTex(s, ti);
        s.scale.set(ART_SCALE);
        s.position.set((t.tx + def.size / 2) * T, (t.ty + def.size / 2) * T);
        s.alpha = 0.55;
        s.tint = gh.ok ? 0xa0ffc0 : 0xff6060;
        g.rect(t.tx * T, t.ty * T, def.size * T, def.size * T).fill({ color: gh.ok ? 0x40ff80 : 0xff3030, alpha: 0.16 }).stroke({ width: 1, color: gh.ok ? 0x40ff80 : 0xff3030, alpha: 0.7 });
        i++;
      }
      if (def.weapon) g.circle((gh.tx + def.size / 2) * T, (gh.ty + def.size / 2) * T, (def.weapon.range + def.size * 0.25) * T).stroke({ width: 1, color: 0x9fffd0, alpha: 0.35 });
      if (def.sight >= 10) g.circle((gh.tx + def.size / 2) * T, (gh.ty + def.size / 2) * T, def.sight * T).stroke({ width: 1, color: 0x9fd0ff, alpha: 0.25 });
    }
    if (this.targetCircle) {
      const tc = this.targetCircle;
      g.circle(tc.x * T, tc.y * T, tc.r * T).fill({ color: tc.color, alpha: 0.12 }).stroke({ width: 2, color: tc.color, alpha: 0.8 });
    }
  }

  private screenGDirty = false;
  private renderScreen(): void {
    const g = this.screenG;
    // only touch the Graphics while a drag box is (or just was) shown
    if (!this.dragRect && !this.screenGDirty) return;
    g.clear();
    this.screenGDirty = !!this.dragRect;
    if (this.dragRect) {
      const d = this.dragRect;
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      g.rect(x, y, w, h).fill({ color: 0x40ffb0, alpha: 0.08 }).stroke({ width: 1, color: 0x60ffc0, alpha: 0.8 });
    }
  }

  // ---------------------------------------------------------------- textures from sim state
  /**
   * Feeds the creep layer once per 10-tick creep period (the sim recomputes w.creep when
   * tick % 10 === 5, so it is fresh from tick % 10 === 6). Robust to frames that skip ticks.
   * The layer re-uploads only when values changed and then blends old→new over the next 10 ticks.
   */
  private updateCreep(w: World, alpha: number): void {
    const c = this.creep;
    if (!c) return;
    const epoch = Math.floor((w.tick - 6) / 10);
    if (epoch !== this.creepEpoch) {
      const first = Number.isNaN(this.creepEpoch);
      this.creepEpoch = epoch;
      if (c.update(w.creep, first)) this.creepBlendTick = w.tick;
    }
    // paused: show the latest field as-is (no half-blended frontier while the player plans)
    c.frame(this.time, w.paused ? 1 : (w.tick - this.creepBlendTick + alpha) / 10);
  }

  private updateFog(w: World): void {
    const d = this.fogData;
    if (!d || !this.fogSrc) return;
    this.fogTick = w.tick;
    if (w.revealAll) return;
    // vision only changes every 5 ticks: upload only when a texel actually changed
    const n = w.w * w.h;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const a = w.vis[i] ? 0 : w.explored[i] ? 135 : 250;
      const k = i * 4;
      if (d[k + 3] === a) continue;
      changed = true;
      // premultiplied rgb(4,6,10)
      d[k] = Math.round((4 * a) / 255); d[k + 1] = Math.round((6 * a) / 255); d[k + 2] = Math.round((10 * a) / 255); d[k + 3] = a;
    }
    if (changed) this.fogSrc.update();
  }

  // ---------------------------------------------------------------- events → fx
  marker(x: number, y: number, color: number): void {
    this.markers.push({ x, y, t: 0, color });
  }

  onEvents(events: SimEvent[]): void {
    const w = this.world;
    if (!w) return;
    const fx = this.fx;
    const T = TILE;
    for (const ev of events) {
      const x = (ev.x ?? 0) * T, y = (ev.y ?? 0) * T;
      const visible = ev.x === undefined || w.isVisible(ev.x, ev.y ?? 0);
      switch (ev.t) {
        case 'shot': {
          if (!visible || !fx.inView(x, y)) break;
          const tx = (ev.tx as number) * T, ty = (ev.ty as number) * T;
          const team = ev.team as number;
          const fxk = ev.fx as string;
          const tcol = team === AXIOM ? 0xff5060 : 0xffc060;
          const rot = Math.atan2(ty - y, tx - x);
          if (fxk === 'bullet') {
            fx.line([x, y, tx, ty], tcol, 1.2, 0.07, 2);
            fx.spawn('fx:muzzle:' + (Math.random() < 0.5 ? 0 : 1), x, y, { life: 0.06, s0: 0.45, s1: 0.4, a0: 1, a1: 0.6, tint: team === AXIOM ? 0xff8080 : 0xffffff, add: true, rot });
            fx.spawn('fx:spark', tx + (Math.random() - 0.5) * 8, ty + (Math.random() - 0.5) * 8, { life: 0.12, s0: 0.3, s1: 0.1, tint: 0xffe0a0, add: true });
          } else if (fxk === 'cannon') {
            fx.line([x, y, tx, ty], 0xffd080, 2.5, 0.09, 4);
            fx.spawn('fx:muzzle:0', x, y, { life: 0.1, s0: 0.9, s1: 0.7, a0: 1, a1: 0.5, add: true, rot });
            fx.spawn('fx:smoke', x, y, { life: 0.8, s0: 0.4, s1: 1, a0: 0.4, a1: 0, tint: 0x6a6460 });
            fx.explosion(tx, ty, 0.35, this.explosionFrames);
          } else if (fxk === 'rail') {
            fx.line([x, y, tx, ty], 0xd8f8ff, 2.2, 0.35, 6);
            fx.spawn('fx:glow', x, y, { life: 0.2, s0: 0.6, s1: 0.3, tint: 0xa0e8ff, add: true });
            fx.spawn('fx:glow', tx, ty, { life: 0.25, s0: 0.7, s1: 0.2, tint: 0xa0e8ff, add: true });
          } else if (fxk === 'beam') {
            const c = team === AXIOM ? 0xff3df0 : 0x45f0ff;
            fx.line([x, y, tx, ty], c, 1.8, 0.16, 5);
            fx.spawn('fx:glow', tx, ty, { life: 0.18, s0: 0.45, s1: 0.15, tint: c, add: true });
          } else if (fxk === 'melee') {
            fx.spawn('fx:spark', tx + (Math.random() - 0.5) * 10, ty + (Math.random() - 0.5) * 10, { life: 0.15, s0: 0.5, s1: 0.1, tint: 0xffd0a0, add: true });
          } else if (fxk === 'rocket' || fxk === 'shell') {
            fx.spawn('fx:muzzle:1', x, y, { life: 0.08, s0: 0.6, s1: 0.5, add: true, rot });
            fx.spawn('fx:smoke', x, y, { life: 0.9, s0: 0.4, s1: 1.1, a0: 0.45, a1: 0, tint: 0x5a5550 });
          }
          break;
        }
        case 'arc': {
          const pts = (ev.pts as number[]).map((p) => p * T);
          if (!fx.inView(pts[0], pts[1])) break;
          if (!visible && !w.isVisible(pts[2] / T, pts[3] / T)) break;
          fx.arc(pts, (ev.team as number) === AXIOM ? 0xff4df0 : 0x6ff6ff, 0.16);
          break;
        }
        case 'impact': {
          if (!visible || !fx.inView(x, y)) break;
          const r = Math.max(0.35, ev.r as number);
          fx.explosion(x, y, r, this.explosionFrames);
          if (r >= 0.9) fx.decal('decal:scorch:' + Math.floor(Math.random() * 3), x, y, ART_SCALE * r * 0.9, 30);
          if (r >= 1.5) fx.shake(3 + r);
          break;
        }
        case 'explode': {
          if (!visible) break;
          fx.explosion(x, y, (ev.r as number) ?? 1.2, this.explosionFrames);
          fx.decal('decal:scorch:' + Math.floor(Math.random() * 3), x, y, ART_SCALE * 1.2, 30);
          fx.shake(5);
          break;
        }
        case 'death': {
          if (!visible || !fx.inView(x, y, 300)) break;
          if (ev.cat === 'building') {
            const s = (ev.size as number) ?? 2;
            for (let i = 0; i < 2 + s; i++) {
              const ox = (Math.random() - 0.5) * s * T * 0.8, oy = (Math.random() - 0.5) * s * T * 0.8;
              fx.explosion(x + ox, y + oy, 0.8 + s * 0.3, this.explosionFrames);
            }
            fx.decal('decal:crater:0', x, y, ART_SCALE * s * 0.7, 60);
            fx.shake(6 + s * 2);
          } else if (ev.robot || ev.hacked) {
            const r = (ev.r as number) ?? 0.4;
            fx.explosion(x, y, r * 1.4, this.explosionFrames);
            if (r > 1) fx.shake(10);
          } else {
            fx.spawn('fx:smoke', x, y, { life: 0.9, s0: 0.3, s1: 0.8, a0: 0.5, a1: 0, tint: 0x5a5048 });
            fx.decal('decal:scorch:' + Math.floor(Math.random() * 3), x, y, ART_SCALE * 0.4, 20, 0x553333);
          }
          break;
        }
        case 'hack_start':
          if (visible) fx.spawn('fx:ring', x, y, { life: 0.5, s0: 0.3, s1: 1.2, a0: 0.9, a1: 0, tint: 0x45f0ff, add: true });
          break;
        case 'hack_done':
          if (!visible) break;
          for (let i = 0; i < 3; i++) fx.spawn('fx:ring', x, y, { life: 0.5 + i * 0.15, s0: 0.2, s1: 1.6 + i * 0.4, a0: 1, a1: 0, tint: 0x45f0ff, add: true });
          fx.spawn('fx:hack', x, y - 10, { life: 1, s0: 0.8, s1: 1.1, a0: 1, a1: 0, tint: 0x45f0ff, add: true, vy: -30 });
          break;
        case 'hack_revert':
          if (!visible) break;
          for (let i = 0; i < 2; i++) fx.spawn('fx:ring', x, y, { life: 0.6, s0: 1.6, s1: 0.2, a0: 1, a1: 0, tint: 0xff3355, add: true });
          fx.spawn('fx:hack', x, y - 10, { life: 1, s0: 0.8, s1: 1.1, a0: 1, a1: 0, tint: 0xff3355, add: true, vy: -30 });
          break;
        case 'emp':
          fx.spawn('fx:emp_ring', x, y, { life: 0.6, s0: 0.3, s1: (ev.r as number) * 1.05, a0: 1, a1: 0, tint: 0x80c8ff, add: true });
          fx.spawn('fx:glow', x, y, { life: 0.4, s0: 2, s1: 5, a0: 0.8, a1: 0, tint: 0x80c8ff, add: true });
          fx.shake(4);
          break;
        case 'orbital_warn':
          this.orbitals.push({ x: ev.x!, y: ev.y!, r: ev.r as number, t: 0 });
          break;
        case 'orbital': {
          fx.line([x, y - 900, x, y], 0xffffff, 26, 0.45, 40);
          fx.line([x, y - 900, x, y], 0xffd0a0, 10, 0.6, 0);
          for (let i = 0; i < 6; i++) fx.explosion(x + (Math.random() - 0.5) * (ev.r as number) * T, y + (Math.random() - 0.5) * (ev.r as number) * T, 1.6, this.explosionFrames);
          fx.decal('decal:crater:0', x, y, ART_SCALE * (ev.r as number) * 0.8, 90);
          fx.shake(16);
          break;
        }
        case 'supply_warn':
          this.marker(ev.x!, ev.y!, 0xffd060);
          break;
        case 'supply_land':
          fx.spawn('fx:glow', x, y, { life: 0.6, s0: 1.5, s1: 3, a0: 0.9, a1: 0, tint: 0xffd060, add: true });
          for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; fx.spawn('fx:smoke', x, y, { vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, life: 0.9, s0: 0.5, s1: 1.2, a0: 0.5, a1: 0, tint: 0x8a7a60, drag: 3 }); }
          break;
        case 'build_place':
          for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2; fx.spawn('fx:smoke', x, y, { vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: 0.7, s0: 0.4, s1: 1, a0: 0.4, a1: 0, tint: 0x7a7060, drag: 3 }); }
          break;
        case 'build_done':
          fx.spawn('fx:glow', x, y, { life: 0.5, s0: 1.5, s1: 3, a0: 0.6, a1: 0, tint: 0x9fffd0, add: true });
          break;
        case 'unit_ready':
          fx.spawn('fx:ring', x, y, { life: 0.5, s0: 0.2, s1: 0.9, a0: 0.9, a1: 0, tint: 0x9fffd0, add: true });
          break;
        case 'heal':
          if (visible) for (let i = 0; i < 4; i++) fx.spawn('fx:glow', x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60, { life: 0.6, s0: 0.25, s1: 0.1, tint: (ev.team as number) === HUMAN ? 0x60ffb0 : 0xff60a0, add: true, vy: -30 });
          break;
        case 'stomp':
          if (visible) { fx.spawn('fx:emp_ring', x, y, { life: 0.4, s0: 0.5, s1: (ev.r as number), a0: 0.8, a1: 0, tint: 0xffa060, add: true }); fx.shake(6); }
          break;
        case 'robot_spawn':
          if (visible && fx.inView(x, y)) fx.spawn('fx:glow', x, y, { life: 0.4, s0: 0.4, s1: 1.2, a0: 0.8, a1: 0, tint: 0xff3355, add: true });
          break;
        case 'override':
          fx.spawn('fx:emp_ring', x, y, { life: 0.6, s0: 0.3, s1: (ev.r as number), a0: 1, a1: 0, tint: 0x45f0ff, add: true });
          break;
        case 'ack':
          this.marker(ev.x!, ev.y!, ev.kind === 'attack' ? 0xff5050 : ev.kind === 'interact' ? 0xffd060 : 0x60ff9a);
          break;
        case 'rally_set':
          this.marker(ev.x!, ev.y!, 0x9fffd0);
          break;
        case 'harvest':
          if (visible && fx.inView(x, y) && Math.random() < 0.5) fx.spawn('fx:spark', x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12, { life: 0.2, s0: 0.3, s1: 0.1, tint: 0xffe0a0, add: true, vy: -20 });
          break;
      }
    }
  }
}

