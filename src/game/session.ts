import type { Application } from 'pixi.js';
import { audio, type SfxName } from '../audio';
import { Controller } from '../input/controller';
import { GameRenderer, type TerrainRenderer } from '../render/renderer';
import type { TextureBank } from '../render/textures';
import { Bot } from '../sim/bot';
import { step } from '../sim/step';
import { AXIOM, DT, HUMAN, type SimEvent } from '../sim/types';
import type { World } from '../sim/world';
import { Hud, type IconSource } from '../ui/hud';
import { Advisor } from './advisor';

export interface SessionOpts {
  attract?: boolean;
  onEnd?: (s: Session) => void;
  onMenu?: (s: Session) => void;
}

const SPEEDS = [0.5, 1, 1.5, 2];

export class Session {
  world: World;
  r: GameRenderer;
  ctl: Controller | null = null;
  hud: Hud | null = null;
  speedIdx = 1;
  acc = 0;
  bot: Bot | null = null;
  opts: SessionOpts;
  ended = false;
  private intensity = 0;
  private hudLayer: HTMLElement;
  private stepMsAvg = 0;
  fps = 60;
  frameMsAvg = 16;
  advisor: Advisor | null = null;

  constructor(app: Application, bank: TextureBank, icons: IconSource | null, terrain: TerrainRenderer | null, world: World, hudLayer: HTMLElement, opts: SessionOpts = {}) {
    this.world = world;
    this.opts = opts;
    this.hudLayer = hudLayer;
    this.r = new GameRenderer(app, bank);
    this.r.setWorld(world, terrain);
    const hq = world.entities.find((e) => e.kind === 'hq' && e.team === HUMAN);
    this.r.cam = { x: hq ? hq.x + 4 : world.playerStart.x, y: hq ? hq.y - 2 : world.playerStart.y, zoom: 1.1 };
    if (opts.attract) {
      world.revealAll = true;
      this.bot = new Bot(0);
      this.r.cam.zoom = 0.85;
      return;
    }
    this.ctl = new Controller(world, this.r, {
      hotkey: (e) => this.hud?.hotkey(e) ?? false,
      onSelectionChanged: () => this.hud?.onSelection(),
      onMode: () => this.hud?.onSelection(),
      sound: (n) => audio.play(n as SfxName),
      toast: (m) => this.hud?.toast(m),
      togglePause: () => this.togglePause(),
      openMenu: () => this.opts.onMenu?.(this),
      lastAlert: () => this.hud?.lastAlert() ?? null,
    });
    this.hud = new Hud(hudLayer, world, this.ctl, this.r, icons);
    this.hud.sound = (n) => audio.play(n as SfxName);
    this.hud.onMenu = () => this.opts.onMenu?.(this);
    this.hud.onSpeed = () => { this.speedIdx = (this.speedIdx + 1) % SPEEDS.length; };
    this.hud.speedLabel = () => `${SPEEDS[this.speedIdx]}×`;
    if (world.settings.mode !== 'campaign') this.advisor = new Advisor();
  }

  get speed(): number { return SPEEDS[this.speedIdx]; }

  /** Nothing is being played right now (title-screen demo, paused or finished): the app may lower its frame rate. */
  get idle(): boolean { return this.bot !== null || this.ended || this.world.paused; }

  togglePause(): void {
    this.world.paused = !this.world.paused;
    audio.setPaused(this.world.paused);
  }

  setPaused(p: boolean): void {
    this.world.paused = p;
    audio.setPaused(p);
  }

  frame(dtMs: number): void {
    const w = this.world;
    const dt = Math.min(0.1, dtMs / 1000);
    this.frameMsAvg = this.frameMsAvg * 0.95 + dtMs * 0.05;
    this.fps = 1000 / Math.max(1, this.frameMsAvg);
    this.ctl?.update(dt);
    if (!w.paused && !this.ended) {
      this.acc += dt * this.speed;
      let n = 0;
      const t0 = performance.now();
      while (this.acc >= DT && n < 6) {
        this.bot?.think(w);
        step(w);
        this.acc -= DT;
        n++;
      }
      if (n === 6) this.acc = 0;
      if (n) this.stepMsAvg = this.stepMsAvg * 0.9 + ((performance.now() - t0) / n) * 0.1;
    }
    const alpha = w.paused ? 1 : Math.min(1, this.acc / DT);
    const events = w.events;
    w.events = [];
    this.r.onEvents(events);
    this.hud?.onEvents(events);
    this.advisor?.observe(events);
    if (this.advisor && this.hud) this.advisor.update(w, dt, (sp, tx) => this.hud!.radio(sp, tx));
    this.playAudio(events);
    if (this.bot) this.attractCamera(dt);
    this.r.render(alpha, dt);
    this.hud?.update(dt);
    this.ctl?.pruneSelection();
    const vb = this.r.viewBounds();
    audio.setListener(this.r.cam.x, this.r.cam.y, (vb.x1 - vb.x0) / 2);
    this.updateIntensity(dt);
    if (w.result && !this.ended) {
      this.ended = true;
      this.opts.onEnd?.(this);
    }
  }

  get stepMs(): number { return this.stepMsAvg; }

  private playAudio(events: SimEvent[]): void {
    if (!audio.ready || this.bot) return;
    for (const ev of events) {
      const pos = ev.x !== undefined && (ev.x as number) > 0 ? { x: ev.x as number, y: ev.y as number } : {};
      switch (ev.t) {
        case 'death': {
          if (ev.cat === 'building') audio.play('building_collapse', pos);
          else if (ev.robot) audio.play((ev.r as number) > 0.6 ? 'robot_die_big' : 'robot_die', pos);
          else if (ev.team === HUMAN) audio.play('human_die', pos);
          break;
        }
        case 'harvest': audio.play('harvest', { ...pos, vol: 0.4 }); break;
        case 'deposit': audio.play('deposit', { ...pos, vol: 0.5 }); break;
        case 'repair': audio.play('repair', { ...pos, vol: 0.4 }); break;
        case 'surge_start': audio.stinger('surge'); if (ev.cascade) audio.play('colossus_horn'); break;
        case 'epoch': if (ev.type) audio.stinger('epoch'); break;
        case 'victory': audio.stinger('victory'); break;
        case 'defeat': audio.stinger('defeat'); break;
        case 'shot': if (ev.team === AXIOM && !this.world.isVisible(ev.x as number, ev.y as number)) break; if (ev.sfx) audio.play(ev.sfx as SfxName, pos); break;
        case 'arc': audio.play((ev.sfx as SfxName) ?? 'arc', pos); break;
        case 'impact': audio.play((ev.r as number) >= 1.5 ? 'explosion_big' : (ev.r as number) > 0 ? 'explosion_small' : 'impact_metal', pos); break;
        case 'alert': case 'error': break; // HUD plays these
        default: if (ev.sfx) audio.play(ev.sfx as SfxName, pos);
      }
    }
  }

  private updateIntensity(dt: number): void {
    const w = this.world;
    let target = 0.12;
    if (w.axiom.surgeActive) target += 0.45;
    else if (w.axiom.tuning.surges && w.axiom.surgeT < 30) target += 0.25;
    if (w.tick % 10 === 0) {
      let near = 0;
      for (const e of w.entities) if (e.alive && e.team === AXIOM && e.isUnit && w.isVisible(e.x, e.y)) near++;
      (this as unknown as { _near: number })._near = near;
    }
    target += Math.min(0.45, ((this as unknown as { _near: number })._near ?? 0) / 50);
    target = Math.min(1, target);
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.6);
    audio.setIntensity(this.intensity);
  }

  private camT = 0;
  private camTarget = { x: 0, y: 0 };
  private attractCamera(dt: number): void {
    this.camT -= dt;
    const w = this.world;
    if (this.camT <= 0) {
      this.camT = 9;
      // follow the action: centroid of a random cluster of robots, else base
      const robots = w.entities.filter((e) => e.alive && e.isUnit && e.team === AXIOM && e.order?.type === 'flow');
      if (robots.length > 5) {
        const r = robots[Math.floor(Math.random() * robots.length)];
        this.camTarget = { x: r.x, y: r.y };
      } else {
        const hq = w.entities.find((e) => e.kind === 'hq');
        const t = Math.random() < 0.5 && hq ? hq : w.entities.find((e) => e.kind === 'fabricator') ?? hq;
        if (t) this.camTarget = { x: t.x + (Math.random() - 0.5) * 10, y: t.y + (Math.random() - 0.5) * 8 };
      }
    }
    this.r.cam.x += (this.camTarget.x - this.r.cam.x) * dt * 0.25;
    this.r.cam.y += (this.camTarget.y - this.r.cam.y) * dt * 0.25;
  }

  dispose(): void {
    this.ctl?.dispose();
    this.hud?.destroy();
    this.r.destroy();
    audio.setPaused(false);
  }
}
