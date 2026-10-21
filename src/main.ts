import 'pixi.js/unsafe-eval';
import { Application, type Ticker } from 'pixi.js';
import './ui/style.css';
import chakra400 from '@fontsource/chakra-petch/files/chakra-petch-latin-400-normal.woff2?url';
import chakra600 from '@fontsource/chakra-petch/files/chakra-petch-latin-600-normal.woff2?url';
import chakra700 from '@fontsource/chakra-petch/files/chakra-petch-latin-700-normal.woff2?url';
import mono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url';
import mono600 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2?url';
import { audio } from './audio';
import { buildArtAtlas } from './render/art';
import { renderMinimapTerrain, renderTerrainChunk } from './render/art/terrain';
import { TextureBank } from './render/textures';
import { generateWorld } from './sim/mapgen';
import type { Difficulty, GameMode } from './sim/types';
import { Session } from './game/session';
import { Bot } from './sim/bot';
import { step as simStep } from './sim/step';
import { MISSIONS } from './game/missions';
import './game/campaign';
import { renderResolution, store, type RenderScale } from './game/storage';
import { Menus } from './ui/menus';

/** Frame-rate ceiling while nothing is being played (menus, title demo, pause, end screen). */
const IDLE_FPS = 30;
/** A display frame this close to its deadline still renders (absorbs vsync timestamp jitter). */
const FRAME_SLACK_MS = 2;
/** A tactical pause counts as idle after this long without input or camera motion. */
const IDLE_AFTER_MS = 1000;
/** Longest frame step handed to the session (same clamp as Pixi's default minFPS of 10). */
const MAX_FRAME_MS = 100;
/** Adaptive guard: a second whose mean frame interval exceeds this is slow... */
const GUARD_SLOW_MS = 20;
/** ...and this many consecutive slow seconds of gameplay drop 'auto' render scale to 1x (once). */
const GUARD_SECONDS = 5;

function injectFonts(): void {
  const css = [
    [chakra400, 'Chakra Petch', 400], [chakra600, 'Chakra Petch', 600], [chakra700, 'Chakra Petch', 700],
    [mono400, 'JetBrains Mono', 400], [mono600, 'JetBrains Mono', 600],
  ].map(([u, f, w]) => `@font-face{font-family:'${f}';src:url(${u}) format('woff2');font-weight:${w};font-display:swap}`).join('');
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

export interface StartOpts {
  mode: GameMode;
  difficulty: Difficulty;
  seed: number;
  mapSize: number;
  missionId?: string;
  daily?: string;
}

class App {
  app!: Application;
  bank!: TextureBank;
  atlas: ReturnType<typeof buildArtAtlas> | null = null;
  session: Session | null = null;
  menus!: Menus;
  hudLayer!: HTMLElement;
  current: StartOpts | null = null;
  fpsEl: HTMLElement | null = null;
  /** Set by the adaptive guard; pins 'auto' render scale to 1x until the player changes the setting. */
  autoDowngraded = false;
  private scaleMode: RenderScale | null = null;
  private nextFrameAt = 0;
  private lastFrameAt = 0;
  private lastInputAt = 0;
  private lastCam = { x: 0, y: 0, zoom: 0 };
  private fpsTextAt = 0;
  private frameErrors = 0;
  private guard = { last: 0, holdUntil: 0, t0: 0, frames: 0, sumDt: 0, sumWork: 0, slow: 0 };

  async boot(): Promise<void> {
    injectFonts();
    const loading = document.getElementById('loading')!;
    const game = document.getElementById('game')!;
    this.app = new Application();
    await this.app.init({ resizeTo: window, background: '#07090c', antialias: false, autoDensity: true, resolution: this.targetResolution(), powerPreference: 'high-performance' });
    // Pixi's ticker still drives requestAnimationFrame (so app.ticker.stop()/start() keep working), but the
    // stage is drawn by this.frame, and only on frames that pass the frame-rate cap.
    this.app.ticker.remove(this.app.render, this.app);
    game.appendChild(this.app.canvas);
    loading.querySelector('.msg')!.textContent = 'Fabricating sprites…';
    await new Promise((r) => setTimeout(r, 30));
    try {
      this.atlas = buildArtAtlas();
    } catch (err) {
      console.error('art generation failed', err);
      this.atlas = null;
    }
    this.bank = new TextureBank(this.atlas);
    this.hudLayer = document.getElementById('ui')!;
    this.menus = new Menus(this);
    this.applySettings();
    loading.remove();
    this.app.ticker.add(this.frame);
    // the first gesture creates/resumes the AudioContext (autoplay policy); later gestures are handled by the engine
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audio.init().then(() => { audio.music(this.session && !this.session.bot ? 'game' : 'menu'); }).catch(() => {});
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // real input lifts the idle frame cap during a tactical pause (smooth camera while giving orders)
    const input = (e: Event) => { if (e.isTrusted) this.lastInputAt = performance.now(); };
    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) window.addEventListener(ev, input, { capture: true, passive: true });
    // hidden tab: rAF (and so rendering + sim) stops by itself; the audio thread is suspended explicitly
    document.addEventListener('visibilitychange', () => {
      const hidden = document.visibilityState === 'hidden';
      audio.setBackground(hidden);
      if (!hidden) this.resetGuard();
    });
    window.addEventListener('resize', () => this.applyRenderScale());
    this.watchDpr();
    this.startAttract();
    this.menus.title();
    const q = new URLSearchParams(location.search);
    if (q.has('quick')) this.start({ mode: 'skirmish', difficulty: 'veteran', seed: +(q.get('seed') ?? 7), mapSize: +(q.get('size') ?? 96) });
    if (q.has('mission')) this.start({ mode: 'campaign', difficulty: (q.get('diff') as Difficulty) ?? store.settings.difficulty, seed: 0, mapSize: 96, missionId: q.get('mission')! });
  }

  applySettings(): void {
    const s = store.settings;
    audio.setVolumes({ master: s.master, sfx: s.sfx, music: s.music });
    if (this.session?.ctl) this.session.ctl.edgeScroll = s.edgeScroll;
    // the title-screen demo is background decoration: half the particle budget
    if (this.session) this.session.r.fx.quality = this.session.bot ? Math.min(s.quality, 0.5) : s.quality;
    if (this.session?.advisor) this.session.advisor.enabled = s.advisor;
    if (s.showFps && !this.fpsEl) {
      this.fpsEl = document.createElement('div');
      this.fpsEl.style.cssText = 'position:fixed;left:236px;bottom:4px;z-index:40;font:11px JetBrains Mono,monospace;color:#7d8f8c;pointer-events:none';
      document.body.appendChild(this.fpsEl);
    } else if (!s.showFps && this.fpsEl) { this.fpsEl.remove(); this.fpsEl = null; }
    if (s.renderScale !== this.scaleMode) {
      // a changed setting re-arms the adaptive guard (setRenderScale also re-arms it for a repeated choice)
      this.scaleMode = s.renderScale;
      this.autoDowngraded = false;
    }
    this.applyRenderScale();
    this.nextFrameAt = 0;
  }

  /**
   * The player picked a render scale in settings. Any explicit pick, including the option that is already
   * selected, re-arms the adaptive guard: clicking 'Auto' after the guard pinned it to 1x restores Auto's resolution.
   */
  setRenderScale(scale: RenderScale): void {
    store.settings.renderScale = scale;
    store.saveSettings();
    this.autoDowngraded = false;
    this.applySettings();
  }

  // ---------------------------------------------------------------- frame pacing
  /**
   * Runs on every display frame (Pixi ticker → requestAnimationFrame) and draws only the frames that pass
   * the cap. Pixi's own ticker.maxFPS is not used: it truncates the elapsed time to whole ms before comparing
   * it with 1000/fps, so a cap equal to the display rate drops frames (measured 58 fps at maxFPS 60 and 29 at
   * maxFPS 30 on a 60 Hz display). Here a frame is drawn when it is within FRAME_SLACK_MS of its deadline
   * and deadlines advance by exactly one interval: cap 60 gives 60 fps on 60/120 Hz displays (about 60 on
   * 75/90/144 Hz), cap 30 gives 30. The 20 Hz sim is fixed-step inside Session.frame, so the cap changes
   * only how often the world is drawn, never how fast it runs.
   */
  private frame = (t: Ticker): void => {
    const now = t.lastTime + t.elapsedMS; // this rAF's timestamp (Pixi updates lastTime after the listeners)
    const cap = this.frameCap();
    if (cap > 0) {
      const T = 1000 / cap;
      if (now < this.nextFrameAt - FRAME_SLACK_MS) return;
      this.nextFrameAt = now - this.nextFrameAt > T ? now + T : this.nextFrameAt + T;
    }
    const dt = this.lastFrameAt ? Math.min(MAX_FRAME_MS, Math.max(0, now - this.lastFrameAt)) : 1000 / 60;
    this.lastFrameAt = now;
    const s = this.session;
    const t0 = performance.now();
    try {
      s?.frame(dt);
      this.app.render();
    } catch (e) {
      // keep the loop alive: an exception escaping a ticker listener stops Pixi's rAF loop for good
      if (this.frameErrors++ < 5) console.error('[overfit] frame failed', e);
    }
    const work = performance.now() - t0;
    if (s) {
      const c = s.r.cam, l = this.lastCam;
      if (c.x !== l.x || c.y !== l.y || c.zoom !== l.zoom) { l.x = c.x; l.y = c.y; l.zoom = c.zoom; this.lastInputAt = performance.now(); }
    }
    this.adaptiveGuard(now, work, cap);
    if (this.fpsEl && s && now - this.fpsTextAt > 250) {
      this.fpsTextAt = now;
      this.fpsEl.textContent = `${s.fps.toFixed(0)} fps (${cap ? `cap ${cap}` : 'uncapped'}) · ${+this.app.renderer.resolution.toFixed(2)}× · sim ${s.stepMs.toFixed(2)} ms · ${s.world.entities.length} ent`;
    }
  };

  /** Nothing is being played: menu overlay, title demo, end screen, or a tactical pause without recent input. */
  isIdle(): boolean {
    const s = this.session;
    if (!s || this.menus?.el) return true;
    if (!s.idle) return false;
    // Session.idle = title demo, finished, or paused; a tactical pause stays live while the player works the camera/orders
    return s.bot !== null || s.ended || performance.now() - this.lastInputAt > IDLE_AFTER_MS;
  }

  /** Current frame-rate cap in fps (0 = display rate). */
  frameCap(): number {
    const user = store.settings.fpsCap;
    if (!this.isIdle()) return user;
    return user > 0 ? Math.min(user, IDLE_FPS) : IDLE_FPS;
  }

  // ---------------------------------------------------------------- render scale
  /** Resolution for what is on screen now: the in-game one, except that the title demo renders at 1x under 'auto'. */
  targetResolution(): number {
    const scale = store.settings.renderScale;
    return this.resolutionFor(scale === 'auto' && this.session?.bot ? 'performance' : scale);
  }

  private resolutionFor(scale: RenderScale): number {
    return renderResolution(scale, window.devicePixelRatio || 1, window.innerWidth, window.innerHeight, this.autoDowngraded);
  }

  /**
   * Apply the render scale live (no reload). Only the canvas backing store changes: input and the HUD/minimap work
   * in CSS px, so GameRenderer.screenW/H must be CSS px too (app.screen), or the view shifts on every change.
   */
  applyRenderScale(): void {
    const r = this.app?.renderer;
    if (!r) return;
    const res = this.targetResolution();
    if (Math.abs(r.resolution - res) < 1e-3) return;
    r.resize(window.innerWidth, window.innerHeight, res);
    this.nextFrameAt = 0; // repaint the cleared canvas on the next display frame even when idle-capped
    this.resetGuard();
  }

  /** For the settings screen: the in-game backing store for the current setting (the title demo may differ). */
  renderInfo(): { res: number; w: number; h: number; downgraded: boolean } {
    const res = this.resolutionFor(store.settings.renderScale);
    return { res, w: Math.round(window.innerWidth * res), h: Math.round(window.innerHeight * res), downgraded: this.autoDowngraded };
  }

  /** Window moved to a display with a different DPR (or browser zoom changed). */
  private watchDpr(): void {
    const mq = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq?.addEventListener('change', () => { this.applyRenderScale(); this.watchDpr(); }, { once: true });
  }

  private resetGuard(): void {
    const g = this.guard;
    g.last = 0; g.t0 = 0; g.frames = 0; g.sumDt = 0; g.sumWork = 0; g.slow = 0;
    g.holdUntil = performance.now() + 3000;
  }

  /**
   * Auto render scale only: if gameplay frames are consistently slower than GUARD_SLOW_MS while our own
   * per-frame JS work is a small part of the interval (GPU/compositor-bound, not sim-bound), drop to 1x
   * once. It never steps back up until the player changes the setting, so it cannot oscillate.
   */
  private adaptiveGuard(now: number, workMs: number, cap: number): void {
    const g = this.guard;
    const dt = g.last ? now - g.last : 0;
    g.last = now;
    // (a Pixi-side ticker.maxFPS, e.g. set by tools/perfprobe.mjs, would read as slow frames: stay out of the way)
    const eligible = store.settings.renderScale === 'auto' && !this.autoDowngraded && this.app.renderer.resolution > 1
      && (cap === 0 || cap >= 50) && !this.app.ticker.maxFPS && !this.isIdle() && document.visibilityState === 'visible';
    if (!eligible || now < g.holdUntil) { g.t0 = 0; g.slow = 0; return; }
    if (!dt || dt > 250) { g.t0 = 0; return; } // hitch / first frame: start a fresh bucket
    if (!g.t0) { g.t0 = now; g.frames = 0; g.sumDt = 0; g.sumWork = 0; }
    g.frames++; g.sumDt += dt; g.sumWork += workMs;
    if (now - g.t0 < 1000) return;
    const meanDt = g.sumDt / g.frames, meanWork = g.sumWork / g.frames;
    g.slow = meanDt > GUARD_SLOW_MS && meanWork < meanDt * 0.7 ? g.slow + 1 : 0;
    g.t0 = 0;
    if (g.slow < GUARD_SECONDS) return;
    const from = this.app.renderer.resolution;
    this.autoDowngraded = true;
    console.info(`[overfit] frames averaged ${meanDt.toFixed(1)} ms (JS ${meanWork.toFixed(1)} ms) for ${GUARD_SECONDS}s at ${from}x render scale; auto render scale stepping down to ${this.targetResolution()}x until the setting is changed`);
    this.applyRenderScale();
  }

  terrainApi = { renderTerrainChunk };

  startAttract(): void {
    this.disposeSession();
    const w = generateWorld({ mode: 'skirmish', difficulty: 'recruit', seed: 4242 + Math.floor(Math.random() * 1000), mapSize: 72 }, { scrapFields: 8, startScrap: 1500 });
    w.axiom.surgeT = 40;
    const s = new Session(this.app, this.bank, this.atlas, this.terrainApi, w, this.hudLayer, {
      attract: true,
      // the title-screen demo restarts itself when its game ends
      onEnd: () => setTimeout(() => { if (this.session === s) this.startAttract(); }, 4000),
    });
    this.session = s;
    this.applySettings(); // demo fx budget + its render scale
    this.resetGuard();
  }

  disposeSession(): void {
    if (this.session) { this.session.dispose(); this.session = null; }
  }

  start(o: StartOpts): void {
    this.current = o;
    this.menus.close();
    this.disposeSession();
    const mission = o.missionId ? MISSIONS.find((m) => m.id === o.missionId) : undefined;
    const difficulty = mission?.difficulty ?? o.difficulty;
    const settings = { mode: o.mode, difficulty, seed: mission ? mission.seed : o.seed, mapSize: mission ? mission.mapSize : o.mapSize, missionId: o.missionId };
    const w = generateWorld(settings, mission ? mission.gen : o.mode === 'endless' ? { core: true, vaults: 2 } : {});
    if (o.mode === 'endless') {
      // no win condition: the Core is invulnerable-ish and far away; AXIOM never stops
      w.flags.endless = true;
      w.axiom.surgeT = Math.min(w.axiom.surgeT, 150);
    }
    if (mission) {
      mission.setup(w);
      w.script = (ww) => mission.script(ww);
    } else if (o.mode === 'skirmish') {
      w.objectives.push({ id: 'core', text: 'Destroy the AXIOM Core', done: false });
      w.objectives.push({ id: 'hq', text: 'Keep at least one Command HQ alive', done: false });
    } else {
      w.objectives.push({ id: 'survive', text: 'Survive as many Surges as possible', done: false });
    }
    this.session = new Session(this.app, this.bank, this.atlas, this.terrainApi, w, this.hudLayer, {
      onEnd: (s) => this.menus.end(s),
      onMenu: (s) => { if (s.ended) return; const was = s.world.paused; s.setPaused(true); this.menus.pause(s, was); },
    });
    if (this.atlas) this.session.hud?.setMinimapBase(renderMinimapTerrain({ w: w.w, h: w.h, terrain: w.terrain, seed: w.settings.seed }));
    this.applySettings();
    this.resetGuard(); // texture uploads and terrain chunks make the first seconds of a session unrepresentative
    if (audio.ready) audio.music('game');
    if (mission) this.menus.briefing(mission, this.session);
  }

  restart(): void { if (this.current) this.start(this.current); }

  quitToMenu(): void {
    this.startAttract();
    this.menus.title();
    if (audio.ready) audio.music('menu');
  }
}

const app = new App();
(window as unknown as { overfit: App; overfitDebug: unknown }).overfit = app;
(window as unknown as { overfitDebug: unknown }).overfitDebug = { Bot, step: simStep, audio };
app.boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.querySelector('.msg')!.textContent = 'Failed to start: ' + (e?.message ?? e);
});

export type { App };
