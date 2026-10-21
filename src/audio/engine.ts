// AudioEngine: voice management, positional mixing, master bus, music glue.
//
// Graph:
//   positional voices ─► [far lowpass] ─► sfxWorld ─┐
//   music system ─────────────────────► musicOut ──┴► pauseLp ► pauseDuck ─┐
//   non-positional (UI/alerts) ─────────► sfxUi ───────────────────────────┴► mix
//   mix(−4.4 dB) ► compressor ► limiter ► ceiling(waveshaper) ► master ► out

import { SFX } from './sfx';
import { getBank, bankRef, type Bank } from './bank';
import { MusicSystem, type MusicStats } from './music';
import { ceilingCurve, clamp } from './dsp';
import type { MusicTrack, PlayOpts, SfxName, StingerKind, VolumeSettings } from './types';

const MAX_VOICES = 48;
/** Positional sounds beyond CULL × viewRadius are skipped entirely. */
const CULL = 2.5;
/** Beyond this × viewRadius, voices go through the "far" lowpass. */
const FAR = 1.2;
/** Global voice-start budget (token bucket); priority ≥ 5 bypasses it. */
const BUDGET_RATE = 90;
const BUDGET_BURST = 14;
/**
 * DynamicsCompressorNode applies automatic make-up gain (WebAudio spec:
 * (1/curve(1))^0.6), +4.4 dB for the two compressors below. Attenuating the
 * mix by the same amount *before* them gives unity gain for quiet material
 * while the limiter ceiling stays near −1 dBFS. Measured offline by
 * measureChain() / tools/audio-check.mjs.
 */
const PRE_COMP_GAIN = 0.602;

interface Voice {
  name: string;
  src: AudioBufferSourceNode;
  g: GainNode;
  p: StereoPannerNode | null;
  start: number;
  end: number;
  score: number;
}

export interface AudioStats {
  played: number;
  /** rejected by rate limit / per-name cap / budget / global cap */
  dropped: number;
  /** skipped because too far away or too quiet */
  culled: number;
  /** existing voices cut to make room for louder ones */
  stolen: number;
  peakVoices: number;
  errors: number;
}

export class AudioEngine {
  readonly stats: AudioStats = { played: 0, dropped: 0, culled: 0, stolen: 0, peakVoices: 0, errors: 0 };

  private ctx: BaseAudioContext | null = null;
  private live: AudioContext | null = null;
  private offline = false;
  private disabled = false;
  private initPromise: Promise<void> | null = null;
  private bank: Bank | null = null;
  private bankReady = false;

  private master: GainNode | null = null;
  private sfxWorld: GainNode | null = null;
  private sfxUi: GainNode | null = null;
  private far: BiquadFilterNode | null = null;
  private musicOut: GainNode | null = null;
  private pauseLp: BiquadFilterNode | null = null;
  private pauseDuck: GainNode | null = null;
  private musicSys: MusicSystem | null = null;

  private vol = { master: 0.8, sfx: 0.9, music: 0.55 };
  private lx = 0;
  private ly = 0;
  private lr = 20;
  private hasListener = false;
  private voices: Voice[] = [];
  private lastStart = new Map<string, { t: number; g: number }>();
  private lastVariant = new Map<string, number>();
  private tokens = BUDGET_BURST;
  private tokenTime = 0;
  private paused = false;
  /** The AudioContext was suspended by setBackground(true) and should resume when the page is visible again. */
  private bgSuspended = false;
  private track: MusicTrack = 'none';
  private intensity = 0;

  // -------------------------------------------------------------- setup ---

  /** Create/resume the AudioContext. Call from a user gesture; safe to call repeatedly. */
  init(): Promise<void> {
    const live = this.live;
    if (live && live.state !== 'running' && live.state !== 'closed') {
      live.resume().catch(() => undefined);
    }
    if (!this.initPromise) this.initPromise = this.boot();
    return this.initPromise;
  }

  get ready(): boolean {
    if (this.disabled || !this.ctx || !this.bankReady) return false;
    return this.offline || (this.live !== null && this.live.state === 'running');
  }

  private async boot(): Promise<void> {
    try {
      const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) {
        this.disabled = true;
        return;
      }
      const ctx = new AC({ latencyHint: 'interactive' });
      this.live = ctx;
      // resume() must be issued synchronously inside the gesture
      const resumed = ctx.resume().catch(() => undefined);
      this.attach(ctx, bankRef(), false);
      this.installUnlock(ctx);
      // the page may have been hidden while the context was being created
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.setBackground(true);
      await getBank();
      this.bankReady = true;
      await resumed;
    } catch (e) {
      console.warn('[audio] init failed; audio disabled', e);
      this.disabled = true;
    }
  }

  /**
   * Page hidden/visible. Hidden suspends the AudioContext: the audio thread stops, the context clock
   * (and with it the music scheduler, which schedules against currentTime) freezes, and play() drops
   * new sounds. Visible resumes it, but only if this method suspended it. Safe before init().
   */
  setBackground(hidden: boolean): void {
    const live = this.live;
    if (!live || live.state === 'closed') return;
    if (hidden) {
      this.bgSuspended = true;
      live.suspend().catch(() => undefined);
    } else if (this.bgSuspended) {
      this.bgSuspended = false;
      live.resume().catch(() => undefined);
    }
  }

  /** Re-resume on later gestures (iOS interruptions, autoplay policies). */
  private installUnlock(ctx: AudioContext): void {
    if (typeof window === 'undefined') return;
    const kick = (): void => {
      if (this.bgSuspended && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => undefined);
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) {
      window.addEventListener(ev, kick, { capture: true, passive: true });
    }
  }

  /** @internal Testing: drive this engine with an OfflineAudioContext (music is pumped manually). */
  _attachOffline(ctx: OfflineAudioContext, bank: Bank, musicSeed?: number): void {
    this.offline = true;
    this.bankReady = true;
    this.attach(ctx, bank, true, musicSeed);
  }

  private attach(ctx: BaseAudioContext, bank: Bank, manualMusic: boolean, musicSeed?: number): void {
    this.ctx = ctx;
    this.bank = bank;
    const gain = (v: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };

    const master = gain(this.vol.master);
    master.connect(ctx.destination);
    const ceil = ctx.createWaveShaper();
    ceil.curve = ceilingCurve();
    ceil.connect(master);
    const preCeil = gain(0.5); // ceiling curve domain is ±2
    preCeil.connect(ceil);

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    limiter.connect(preCeil);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    comp.connect(limiter);

    const mix = gain(PRE_COMP_GAIN);
    mix.connect(comp);

    const pauseDuck = gain(1);
    pauseDuck.connect(mix);
    const pauseLp = ctx.createBiquadFilter();
    pauseLp.type = 'lowpass';
    pauseLp.frequency.value = Math.min(20000, ctx.sampleRate * 0.45);
    pauseLp.Q.value = 0.5;
    pauseLp.connect(pauseDuck);

    const sfxWorld = gain(this.vol.sfx);
    sfxWorld.connect(pauseLp);
    const sfxUi = gain(this.vol.sfx);
    sfxUi.connect(mix);
    const far = ctx.createBiquadFilter();
    far.type = 'lowpass';
    far.frequency.value = 1700;
    far.Q.value = 0.6;
    far.connect(sfxWorld);
    const musicOut = gain(this.vol.music);
    musicOut.connect(pauseLp);

    this.master = master;
    this.sfxWorld = sfxWorld;
    this.sfxUi = sfxUi;
    this.far = far;
    this.musicOut = musicOut;
    this.pauseLp = pauseLp;
    this.pauseDuck = pauseDuck;

    this.musicSys = new MusicSystem(ctx, musicOut, bank, manualMusic, musicSeed);
    this.musicSys.setIntensity(this.intensity);
    if (this.track !== 'none') this.musicSys.play(this.track);
    if (this.paused) this.applyPaused(true);
  }

  // --------------------------------------------------------------- SFX ---

  /** Seconds; wall-clock for live contexts (finer than currentTime), audio clock offline. */
  private clock(): number {
    if (this.offline || typeof performance === 'undefined') return this.ctx ? this.ctx.currentTime : 0;
    return performance.now() / 1000;
  }

  play(name: SfxName, opts?: PlayOpts): void {
    try {
      this.playInternal(name, opts);
    } catch (e) {
      this.stats.errors++;
      if (this.stats.errors < 5) console.warn('[audio] play failed', name, e);
    }
  }

  private playInternal(name: SfxName, opts: PlayOpts | undefined): void {
    const ctx = this.ctx;
    if (!ctx || this.disabled || !this.bank) return;
    if (this.live && this.live.state !== 'running') return; // never queue up a blast
    const def = SFX[name];
    if (!def) return;
    const bufs = this.bank.get(name);
    if (!bufs || bufs.length === 0) return;

    const vol = opts?.vol;
    let gain = def.gain * (vol !== undefined && Number.isFinite(vol) ? vol : 1);
    let pan = 0;
    let isFar = false;
    const positional = this.hasListener && opts !== undefined && opts.x !== undefined && opts.y !== undefined;
    if (positional) {
      const dx = (opts.x as number) - this.lx;
      const dy = (opts.y as number) - this.ly;
      const r = Math.max(1, this.lr);
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (!(d < CULL)) {
        this.stats.culled++;
        return;
      }
      if (d > 1) {
        const f = (CULL - d) / (CULL - 1);
        gain *= f * f;
        isFar = d > FAR;
      }
      pan = clamp(dx / r, -1, 1) * 0.8;
    }
    if (!(gain > 0.002)) {
      this.stats.culled++;
      return;
    }

    const now = this.clock();
    const prio = def.priority ?? 1;
    // per-name rate limit; a much louder (closer) request may still get through
    // so distant spam can't mask on-screen action
    const last = this.lastStart.get(name);
    if (last !== undefined && (now - last.t) * 1000 < def.minMs && !(gain > last.g * 2.5 && (now - last.t) * 1000 >= def.minMs * 0.25)) {
      this.stats.dropped++;
      return;
    }

    // global start budget
    this.tokens = Math.min(BUDGET_BURST, this.tokens + (now - this.tokenTime) * BUDGET_RATE);
    this.tokenTime = now;
    if (this.tokens < 1 && prio < 5) {
      this.stats.dropped++;
      return;
    }

    const at = ctx.currentTime;
    this.reap(at);
    const score = gain * prio;

    // per-name cap: replace the weakest of this name if we're at least as important
    let count = 0;
    let weakest: Voice | null = null;
    let weakestScore = Infinity;
    for (const v of this.voices) {
      if (v.name !== name) continue;
      count++;
      const s = this.liveScore(v, at);
      if (s < weakestScore) { weakestScore = s; weakest = v; }
    }
    if (count >= def.maxVoices) {
      if (!weakest || weakestScore > score) {
        this.stats.dropped++;
        return;
      }
      this.kill(weakest, at);
    }

    // global cap: replace the quietest / most-finished voice overall
    if (this.voices.length >= MAX_VOICES) {
      let w: Voice | null = null;
      let ws = Infinity;
      for (const v of this.voices) {
        const s = this.liveScore(v, at);
        if (s < ws) { ws = s; w = v; }
      }
      if (!w || ws > score) {
        this.stats.dropped++;
        return;
      }
      this.kill(w, at);
    }

    // pick a variant, avoiding immediate repeats
    let vi = 0;
    if (bufs.length > 1) {
      const lv = this.lastVariant.get(name) ?? -1;
      vi = Math.floor(Math.random() * (bufs.length - 1));
      if (vi >= lv && lv >= 0) vi++;
      vi = Math.min(vi, bufs.length - 1);
      this.lastVariant.set(name, vi);
    }
    const buf = bufs[vi];

    const pv = def.pitchVar ?? 0.04;
    const pitch = opts?.pitch;
    const base = pitch !== undefined && Number.isFinite(pitch) && pitch > 0 ? pitch : 1;
    const rate = clamp(base * (1 + (Math.random() * 2 - 1) * pv), 0.25, 4);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const usePan = positional && Math.abs(pan) > 0.02;
    const g = ctx.createGain();
    // For mono input StereoPanner is equal-power (0.707 per side at centre) while
    // an unpanned mono voice upmixes at 1.0 per side: compensate so power is
    // constant across the field. Stereo input is a balance control (unity at 0).
    const panComp = usePan && buf.numberOfChannels === 1 ? Math.SQRT2 : 1;
    g.gain.value = gain * (0.9 + Math.random() * 0.15) * panComp;
    src.connect(g);
    let p: StereoPannerNode | null = null;
    let tail: AudioNode = g;
    if (usePan) {
      p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    const dest = positional ? (isFar ? this.far : this.sfxWorld) : this.sfxUi;
    if (!dest) return;
    tail.connect(dest);

    const voice: Voice = { name, src, g, p, start: at, end: at + buf.duration / rate, score };
    src.onended = (): void => this.release(voice);
    src.start(at);
    this.voices.push(voice);
    this.lastStart.set(name, { t: now, g: gain });
    this.tokens -= 1;
    this.stats.played++;
    if (this.voices.length > this.stats.peakVoices) this.stats.peakVoices = this.voices.length;
  }

  /** Importance of a playing voice: its score, discounted as it nears its end. */
  private liveScore(v: Voice, at: number): number {
    const len = Math.max(0.001, v.end - v.start);
    const remain = clamp((v.end - at) / len, 0.05, 1);
    return v.score * Math.sqrt(remain);
  }

  private kill(v: Voice, at: number): void {
    this.remove(v);
    this.stats.stolen++;
    try {
      v.g.gain.cancelScheduledValues(at);
      v.g.gain.setTargetAtTime(0, at, 0.008);
      v.src.stop(at + 0.05);
    } catch {
      /* already stopped */
    }
  }

  private remove(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  private release(v: Voice): void {
    this.remove(v);
    try {
      v.src.disconnect();
      v.g.disconnect();
      if (v.p) v.p.disconnect();
    } catch {
      /* ignore */
    }
  }

  /** Safety net in case an onended never fires. */
  private reap(at: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].end < at - 0.25) this.voices.splice(i, 1);
    }
  }

  get voiceCount(): number {
    return this.voices.length;
  }

  // ---------------------------------------------------- listener / mix ---

  setListener(x: number, y: number, viewRadius: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.lx = x;
    this.ly = y;
    this.lr = Number.isFinite(viewRadius) && viewRadius > 0 ? viewRadius : 1;
    this.hasListener = true;
  }

  setVolumes(v: VolumeSettings): void {
    const prev = { ...this.vol };
    const ok = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);
    if (ok(v.master)) this.vol.master = clamp(v.master, 0, 1);
    if (ok(v.sfx)) this.vol.sfx = clamp(v.sfx, 0, 1);
    if (ok(v.music)) this.vol.music = clamp(v.music, 0, 1);
    const ctx = this.ctx;
    if (!ctx) return;
    if (prev.master === this.vol.master && prev.sfx === this.vol.sfx && prev.music === this.vol.music) return;
    const at = ctx.currentTime;
    this.master?.gain.setTargetAtTime(this.vol.master, at, 0.03);
    this.sfxWorld?.gain.setTargetAtTime(this.vol.sfx, at, 0.03);
    this.sfxUi?.gain.setTargetAtTime(this.vol.sfx, at, 0.03);
    this.musicOut?.gain.setTargetAtTime(this.vol.music, at, 0.03);
  }

  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    this.applyPaused(p);
  }

  private applyPaused(p: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.pauseLp || !this.pauseDuck) return;
    const at = ctx.currentTime;
    const top = Math.min(20000, ctx.sampleRate * 0.45);
    this.pauseLp.frequency.cancelScheduledValues(at);
    this.pauseLp.frequency.setTargetAtTime(p ? 600 : top, at, p ? 0.06 : 0.12);
    this.pauseDuck.gain.cancelScheduledValues(at);
    this.pauseDuck.gain.setTargetAtTime(p ? 0.45 : 1, at, 0.08);
  }

  // ------------------------------------------------------------- music ---

  music(track: MusicTrack): void {
    this.track = track;
    this.musicSys?.play(track);
  }

  setIntensity(v: number): void {
    this.intensity = clamp(Number.isFinite(v) ? v : 0, 0, 1);
    this.musicSys?.setIntensity(this.intensity);
  }

  stinger(kind: StingerKind): void {
    const m = this.musicSys;
    switch (kind) {
      case 'surge':
        this.play('surge_siren');
        m?.duck(0.5, 2.6);
        m?.surge();
        break;
      case 'victory':
      case 'defeat':
        this.play(kind);
        m?.fadeOut(1.2);
        this.track = 'none';
        break;
      case 'epoch':
        this.play('epoch');
        m?.glitch();
        break;
    }
  }

  get musicStats(): MusicStats | null {
    return this.musicSys ? this.musicSys.stats : null;
  }

  /** @internal Testing: schedule music manually (offline contexts have no timer). */
  _pumpMusic(horizon = 0.2): void {
    this.musicSys?.pump(horizon);
  }

  /** @internal Testing: the non-positional SFX bus input (gain = sfx volume, then master chain). */
  _uiBus(): AudioNode | null {
    return this.sfxUi;
  }

  /** @internal Tap the master output (after the ceiling) for level meters. */
  _tapOutput(): AnalyserNode | null {
    if (!this.ctx || !this.master) return null;
    const a = this.ctx.createAnalyser();
    a.fftSize = 2048;
    this.master.connect(a);
    return a;
  }

  /** @internal Diagnostics for the preview page / audio check. */
  _debug(): { state: string; time: number; voices: number; sampleRate: number; bankSounds: number; bankBytes: number; background: boolean } {
    const ctx = this.ctx;
    let bankBytes = 0;
    if (this.bank) for (const arr of this.bank.values()) for (const b of arr) bankBytes += b.length * b.numberOfChannels * 4;
    return {
      bankBytes,
      background: this.bgSuspended,
      state: this.disabled ? 'disabled' : ctx ? (this.live ? this.live.state : 'offline') : 'uninitialised',
      time: ctx ? ctx.currentTime : 0,
      voices: this.voices.length,
      sampleRate: ctx ? ctx.sampleRate : 0,
      bankSounds: this.bank ? this.bank.size : 0,
    };
  }
}
