import { Application } from 'pixi.js';
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
import { MISSIONS } from './game/missions';
import './game/campaign';
import { store } from './game/storage';
import { Menus } from './ui/menus';

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

  async boot(): Promise<void> {
    injectFonts();
    const loading = document.getElementById('loading')!;
    const game = document.getElementById('game')!;
    this.app = new Application();
    await this.app.init({ resizeTo: window, background: '#07090c', antialias: false, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1), powerPreference: 'high-performance' });
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
    this.app.ticker.add((t) => {
      this.session?.frame(t.deltaMS);
      if (this.fpsEl && this.session) this.fpsEl.textContent = `${this.session.fps.toFixed(0)} fps · sim ${this.session.stepMs.toFixed(2)} ms · ${this.session.world.entities.length} ent`;
    });
    const unlock = () => { audio.init().then(() => { audio.music(this.session && !this.session.bot ? 'game' : 'menu'); }).catch(() => {}); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
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
    if (this.session) this.session.r.fx.quality = s.quality;
    if (this.session?.advisor) this.session.advisor.enabled = s.advisor;
    if (s.showFps && !this.fpsEl) {
      this.fpsEl = document.createElement('div');
      this.fpsEl.style.cssText = 'position:fixed;left:236px;bottom:4px;z-index:40;font:11px JetBrains Mono,monospace;color:#7d8f8c;pointer-events:none';
      document.body.appendChild(this.fpsEl);
    } else if (!s.showFps && this.fpsEl) { this.fpsEl.remove(); this.fpsEl = null; }
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
(window as unknown as { overfitDebug: unknown }).overfitDebug = { Bot };
app.boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.querySelector('.msg')!.textContent = 'Failed to start: ' + (e?.message ?? e);
});

export type { App };
