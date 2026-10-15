// Procedural adaptive music. A lookahead scheduler (setTimeout + AudioContext
// time) places notes slightly ahead of the audio clock. Key: D phrygian.
//
//  'menu'  60 BPM dark ambient: drone, slow evolving pad, sparse FM bells,
//          wind and distant metal.
//  'game'  100 BPM dark synthwave/industrial in four intensity layers:
//          L0 drone + pad (always), L1 pulsing bass (>0.25),
//          L2 kick/snare/hat/glitch (>0.5), L3 arp + high tension (>0.75).
//  A new seeded progression is chosen every 4–8 bars.

import { clamp, getNoise, midiHz, mulberry32, perc, type Rng } from './dsp';
import type { Bank } from './bank';
import type { MusicTrack } from './types';

type TrackKind = 'menu' | 'game';

const ROOT = 50; // D3

/** Chords as semitone offsets from ROOT, all diatonic to D phrygian. */
const CHORDS: Record<string, readonly number[]> = {
  i: [0, 3, 7, 10], // Dm7
  bII: [1, 5, 8, 12], // Ebmaj7
  III: [3, 7, 10], // F
  iv: [5, 8, 12, 15], // Gm7
  v0: [7, 10, 13], // Adim
  bVI: [8, 12, 15, 19], // Bbmaj7
  bvii: [10, 13, 17], // Cm
};

const GAME_PROGS: readonly (readonly string[])[] = [
  ['i', 'bII', 'i', 'bvii'],
  ['i', 'bVI', 'bvii', 'i'],
  ['i', 'iv', 'bII', 'i'],
  ['i', 'bII', 'bVI', 'v0'],
  ['bVI', 'bII', 'i', 'i'],
  ['i', 'bvii', 'bVI', 'bII'],
  ['iv', 'bII', 'i', 'v0'],
];

const MENU_PROGS: readonly (readonly string[])[] = [
  ['i', 'bVI', 'iv', 'i'],
  ['i', 'bII', 'i', 'bvii'],
  ['bVI', 'bvii', 'i', 'i'],
  ['i', 'iv', 'bII', 'v0'],
  ['i', 'III', 'bII', 'i'],
];

/** 'x' accent, 'o' normal, '-' ghost, 'O' octave-up (negative), '.' rest. */
function pat(s: string): number[] {
  return [...s].map((c) => (c === 'x' ? 1 : c === 'o' ? 0.65 : c === '-' ? 0.35 : c === 'O' ? -0.8 : 0));
}

const BASS_PATS = [
  pat('x.o.x.o.x.o.x.o.'), // 0 straight 8ths
  pat('x.oox.oox.oox.oo'), // 1 gallop
  pat('x..ox..ox..ox.O.'), // 2 syncopated
  pat('xoooxoooxoooxoOo'), // 3 driving 16ths
  pat('x.....o.x..o..O.'), // 4 sparse
];
const KICK_PATS = [
  pat('x.......x.......'),
  pat('x.......x..o....'),
  pat('x...x...x...x...'),
  pat('x.....o.x.......'),
];
const SNARE = pat('....x.......x...');
const HAT8 = pat('..x...x...x...x.');
const HAT16 = pat('-.o.-.o.-.o.-.ox');
const ARP_MASKS = [
  pat('xoxoxoxoxoxoxoxo'),
  pat('xo.oxo.oxo.oxo.o'),
  pat('x.oox.oox.oox.oo'),
  pat('xoo.xoo.xo.oxoo.'),
];

const LAYER_FADE_TC = 0.9; // s, time-constant of intensity crossfades

interface Section {
  prog: readonly string[];
  chordBars: number;
  bars: number;
  startBar: number;
  bass: number[];
  kick: number[];
  hat16: boolean;
  arpMode: number;
  arpMask: number[];
  arpWave: OscillatorType;
}

function makeIR(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.ceil(seconds * sr);
  const b = ctx.createBuffer(2, n, sr);
  const rng = mulberry32(0xec40);
  const pre = Math.round(0.012 * sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const f = i / n;
      const w = rng() * 2 - 1;
      lp += (w - lp) * (0.12 + 0.8 * (1 - f) * (1 - f));
      d[i] = lp * Math.pow(1 - f, 3.2);
    }
  }
  return b;
}

export interface MusicStats {
  steps: number;
  notes: number;
  sections: number;
  errors: number;
  lastError: string;
  track: MusicTrack;
  intensity: number;
}

export class MusicSystem {
  readonly ctx: BaseAudioContext;
  readonly bank: Bank;
  readonly rng: Rng;
  readonly bus: GainNode;
  readonly reverbIn: GainNode;
  readonly delayIn: GainNode;
  readonly stats: MusicStats = { steps: 0, notes: 0, sections: 0, errors: 0, lastError: '', track: 'none', intensity: 0 };
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly glitchLp: BiquadFilterNode;
  private readonly duckG: GainNode;
  private readonly manual: boolean;
  private tracks: Track[] = [];
  private current: Track | null = null;
  private intensity = 0;
  private applied = -1;
  private surgeAt = -1e9;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: BaseAudioContext, out: AudioNode, bank: Bank, manual: boolean, seed?: number) {
    this.ctx = ctx;
    this.bank = bank;
    this.manual = manual;
    this.rng = mulberry32(seed ?? (Math.random() * 4294967296) >>> 0);

    this.duckG = ctx.createGain();
    this.duckG.connect(out);
    this.glitchLp = ctx.createBiquadFilter();
    this.glitchLp.type = 'lowpass';
    this.glitchLp.frequency.value = Math.min(20000, ctx.sampleRate * 0.45);
    this.glitchLp.Q.value = 0.7;
    this.glitchLp.connect(this.duckG);
    this.bus = ctx.createGain();
    this.bus.connect(this.glitchLp);

    // shared reverb
    this.reverbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeIR(ctx, 2.6);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.9;
    this.reverbIn.connect(conv);
    conv.connect(revOut);
    revOut.connect(this.glitchLp);

    // shared ping-pong delay
    this.delayIn = ctx.createGain();
    this.delayL = ctx.createDelay(2);
    this.delayR = ctx.createDelay(2);
    this.delayL.delayTime.value = 0.45;
    this.delayR.delayTime.value = 0.45;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const fbA = ctx.createGain();
    fbA.gain.value = 0.55;
    const fbB = ctx.createGain();
    fbB.gain.value = 0.55;
    const merge = ctx.createChannelMerger(2);
    const dOut = ctx.createGain();
    dOut.gain.value = 0.7;
    this.delayIn.connect(lp);
    lp.connect(this.delayL);
    this.delayL.connect(fbA);
    fbA.connect(this.delayR);
    this.delayR.connect(fbB);
    fbB.connect(this.delayL);
    this.delayL.connect(merge, 0, 0);
    this.delayR.connect(merge, 0, 1);
    merge.connect(dOut);
    dOut.connect(this.glitchLp);
  }

  get trackName(): MusicTrack {
    return this.current ? this.current.kind : 'none';
  }

  play(name: MusicTrack): void {
    if (name === this.trackName) return;
    const now = this.ctx.currentTime;
    if (this.current) {
      this.current.fadeOut(now, 2.0);
      this.current = null;
    }
    if (name !== 'none') {
      const tr = new Track(this, name, now + 0.06);
      const d = name === 'game' ? 0.45 : 0.75; // dotted-8th echo
      this.delayL.delayTime.setValueAtTime(d, now);
      this.delayR.delayTime.setValueAtTime(d, now);
      this.tracks.push(tr);
      this.current = tr;
      this.applied = this.effIntensity(now);
      tr.setIntensity(this.applied, now);
    }
    this.stats.track = name;
    this.ensureTimer();
  }

  /** Fade the current track out (stingers). */
  fadeOut(seconds: number): void {
    if (!this.current) return;
    this.current.fadeOut(this.ctx.currentTime, seconds);
    this.current = null;
    this.stats.track = 'none';
  }

  setIntensity(v: number): void {
    this.intensity = clamp(v, 0, 1);
    this.applyIntensity(this.ctx.currentTime);
  }

  /** Surge: pull intensity up to ~0.9, decaying back over ~30 s. */
  surge(): void {
    this.surgeAt = this.ctx.currentTime;
    this.applyIntensity(this.surgeAt);
  }

  duck(level: number, seconds: number): void {
    const now = this.ctx.currentTime;
    const g = this.duckG.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(level, now, 0.08);
    g.setTargetAtTime(1, now + seconds, 0.6);
  }

  /** "Model retrained": filter dive + gated stutter. */
  glitch(): void {
    const now = this.ctx.currentTime;
    const top = Math.min(20000, this.ctx.sampleRate * 0.45);
    const f = this.glitchLp.frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(top, now);
    f.exponentialRampToValueAtTime(320, now + 0.3);
    f.setValueAtTime(320, now + 0.9);
    f.exponentialRampToValueAtTime(top, now + 2.4);
    const g = this.duckG.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(1, now);
    for (let i = 0; i < 8; i++) g.setValueAtTime(i % 2 ? 0.2 : 0.9, now + 0.3 + i * 0.075);
    g.setTargetAtTime(1, now + 0.9, 0.3);
  }

  private effIntensity(now: number): number {
    const s = now - this.surgeAt;
    const boost = s < 0 ? 0 : s < 4 ? 0.9 : 0.9 * Math.max(0, 1 - (s - 4) / 26);
    return Math.max(this.intensity, boost);
  }

  private applyIntensity(now: number): void {
    const eff = this.effIntensity(now);
    this.stats.intensity = eff;
    if (this.current && Math.abs(eff - this.applied) > 0.01) {
      this.current.setIntensity(eff, now);
      this.applied = eff;
    }
  }

  /** Schedule everything up to now + horizon. Called by the timer (or manually offline). */
  pump(horizon = 0.18): void {
    const now = this.ctx.currentTime;
    this.applyIntensity(now);
    for (const tr of this.tracks) tr.schedule(now, now + horizon);
    if (this.tracks.some((tr) => now >= tr.disposeTime)) {
      this.tracks = this.tracks.filter((tr) => {
        if (now < tr.disposeTime) return true;
        tr.dispose();
        return false;
      });
    }
  }

  private ensureTimer(): void {
    if (this.manual || this.timer !== null) return;
    const tick = (): void => {
      this.timer = null;
      try {
        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        this.pump(hidden ? 1.5 : 0.18);
      } catch (e) {
        this.stats.errors++;
        this.stats.lastError = String(e);
      }
      if (this.tracks.length > 0) this.timer = setTimeout(tick, 25);
    };
    this.timer = setTimeout(tick, 0);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const tr of this.tracks) tr.dispose();
    this.tracks = [];
    this.current = null;
  }
}

class Track {
  readonly kind: TrackKind;
  readonly out: GainNode;
  disposeTime = Infinity;
  private readonly sys: MusicSystem;
  private readonly ctx: BaseAudioContext;
  private readonly stepDur: number;
  private readonly barDur: number;
  private readonly layers: GainNode[] = [];
  private readonly layerMax: number[];
  private readonly thresholds: number[];
  private readonly target: number[];
  private readonly activeUntil: number[];
  private readonly persistent: AudioScheduledSourceNode[] = [];
  private readonly padBus: GainNode;
  private readonly padFilter: BiquadFilterNode;
  private readonly bassBus: GainNode;
  private readonly drumBus: GainNode;
  private readonly arpBus: GainNode;
  private readonly leadBus: GainNode;
  private readonly droneFilter: BiquadFilterNode;
  private step = 0;
  private nextTime: number;
  private stopTime = Infinity;
  private section: Section | null = null;
  private chord: readonly number[] = CHORDS.i;
  private lastProg = -1;
  private intensity = 0;

  constructor(sys: MusicSystem, kind: TrackKind, t0: number) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.kind = kind;
    const ctx = this.ctx;
    const game = kind === 'game';
    this.stepDur = game ? 60 / 100 / 4 : 60 / 60 / 4;
    this.barDur = this.stepDur * 16;
    this.nextTime = t0;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setTargetAtTime(1, t0, game ? 0.6 : 1.5);
    this.out.connect(sys.bus);

    // layer gains (+ effect sends taken post-fader)
    this.thresholds = game ? [0, 0.25, 0.5, 0.75] : [0, 0, 0];
    this.layerMax = game ? [0.34, 0.7, 0.92, 0.7] : [0.55, 0.6, 0.55];
    const revSend = game ? [0.45, 0.06, 0.12, 0.3] : [0.6, 0.7, 0.9];
    const dlySend = game ? [0, 0, 0, 0.35] : [0, 0.45, 0];
    this.target = this.thresholds.map(() => 0);
    this.activeUntil = this.thresholds.map(() => -1);
    for (let i = 0; i < this.thresholds.length; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      this.send(g, sys.reverbIn, revSend[i]);
      this.send(g, sys.delayIn, dlySend[i]);
      this.layers.push(g);
    }

    // L0: pad + drone
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = game ? 700 : 900;
    this.padFilter.Q.value = 0.8;
    this.padFilter.connect(this.layers[0]);
    this.padBus = ctx.createGain();
    this.padBus.connect(this.padFilter);
    this.lfo(game ? 0.07 : 0.045, game ? 250 : 350, this.padFilter.frequency, t0);

    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = game ? 240 : 320;
    this.droneFilter.Q.value = game ? 2.5 : 3;
    const droneG = ctx.createGain();
    droneG.gain.value = game ? 0.32 : 0.4;
    this.droneFilter.connect(droneG);
    droneG.connect(this.layers[0]);
    this.lfo(game ? 0.06 : 0.03, game ? 90 : 160, this.droneFilter.frequency, t0);
    const drone: Array<[OscillatorType, number, number, number]> = game
      ? [['sine', ROOT - 12, 0, 0.7], ['sawtooth', ROOT - 12, 6, 0.35], ['sawtooth', ROOT - 5, -6, 0.25]]
      : [['sine', ROOT - 12, 0, 0.6], ['sawtooth', ROOT - 12, 5, 0.3], ['sawtooth', ROOT - 5, -7, 0.25], ['triangle', ROOT, 3, 0.25]];
    for (const [type, m, det, lv] of drone) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiHz(m);
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = lv;
      o.connect(g);
      g.connect(this.droneFilter);
      o.start(t0);
      this.persistent.push(o);
    }

    // L1 (game: bass) / L1 (menu: bells)
    this.bassBus = ctx.createGain();
    this.bassBus.connect(this.layers[1]);
    // L2 (game: drums) / L2 (menu: ambience)
    this.drumBus = ctx.createGain();
    this.drumBus.connect(this.layers[2]);
    // L3 (game: arp + lead); menu bells reuse arpBus on L1
    this.arpBus = ctx.createGain();
    this.leadBus = ctx.createGain();
    if (game) {
      const arpF = ctx.createBiquadFilter();
      arpF.type = 'lowpass';
      arpF.frequency.value = 1900;
      arpF.Q.value = 4;
      this.arpBus.connect(arpF);
      arpF.connect(this.layers[3]);
      this.lfo(0.11, 900, arpF.frequency, t0);
      const leadF = ctx.createBiquadFilter();
      leadF.type = 'lowpass';
      leadF.frequency.value = 2400;
      leadF.Q.value = 0.7;
      this.leadBus.connect(leadF);
      leadF.connect(this.layers[3]);
    } else {
      this.arpBus.connect(this.layers[1]);
      // wind: looping pink noise through a slowly wandering bandpass
      const wind = ctx.createBufferSource();
      wind.buffer = getNoise().pink;
      wind.loop = true;
      const wf = ctx.createBiquadFilter();
      wf.type = 'bandpass';
      wf.frequency.value = 450;
      wf.Q.value = 1.4;
      const wg = ctx.createGain();
      wg.gain.value = 0.05;
      wind.connect(wf);
      wf.connect(wg);
      wg.connect(this.layers[2]);
      this.lfo(0.05, 260, wf.frequency, t0);
      this.lfo(0.08, 0.03, wg.gain, t0);
      wind.start(t0);
      this.persistent.push(wind);
    }
  }

  private send(from: AudioNode, to: AudioNode, amt: number): void {
    if (amt <= 0) return;
    const g = this.ctx.createGain();
    g.gain.value = amt;
    from.connect(g);
    g.connect(to);
  }

  private lfo(rate: number, depth: number, param: AudioParam, t0: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(param);
    o.start(t0);
    this.persistent.push(o);
  }

  setIntensity(v: number, now: number): void {
    this.intensity = v;
    for (let i = 0; i < this.layers.length; i++) {
      const thr = this.thresholds[i];
      const f = thr <= 0 ? 1 : clamp((v - thr) / 0.1, 0, 1);
      if (f > 0) this.activeUntil[i] = Infinity;
      else if (this.target[i] > 0 || this.activeUntil[i] === Infinity) this.activeUntil[i] = now + LAYER_FADE_TC * 6;
      this.target[i] = f;
      this.layers[i].gain.setTargetAtTime(f * this.layerMax[i], now, LAYER_FADE_TC);
    }
    if (this.kind === 'game') {
      this.padFilter.frequency.setTargetAtTime(550 + 1000 * v, now, 1.5);
      this.droneFilter.frequency.setTargetAtTime(200 + 160 * v, now, 1.5);
    }
  }

  private on(i: number, t: number): boolean {
    return this.target[i] > 0.001 || t < this.activeUntil[i];
  }

  fadeOut(now: number, seconds: number): void {
    this.out.gain.setTargetAtTime(0, now, seconds / 4);
    this.stopTime = now + seconds;
    this.disposeTime = now + seconds + 3;
  }

  dispose(): void {
    for (const n of this.persistent) {
      try { n.stop(); } catch { /* already stopped */ }
    }
    this.persistent.length = 0;
    try { this.out.disconnect(); } catch { /* ignore */ }
  }

  schedule(now: number, until: number): void {
    if (this.nextTime < now - 0.25) {
      // fell behind (throttled tab / suspended context): skip, don't burst
      const missed = Math.ceil((now - this.nextTime) / this.stepDur);
      this.step += missed;
      this.nextTime += missed * this.stepDur;
    }
    while (this.nextTime < until && this.nextTime < this.stopTime) {
      if (this.kind === 'game') this.gameStep(this.step, this.nextTime);
      else this.menuStep(this.step, this.nextTime);
      this.sys.stats.steps++;
      this.step++;
      this.nextTime += this.stepDur;
    }
  }

  // ------------------------------------------------------------ sections ---

  private newSection(bar: number, progs: readonly (readonly string[])[], game: boolean): Section {
    const rng = this.sys.rng;
    const I = this.intensity;
    let pi = Math.floor(rng() * progs.length) % progs.length;
    if (pi === this.lastProg) pi = (pi + 1) % progs.length;
    this.lastProg = pi;
    const chordBars = game ? (rng() < (I > 0.6 ? 0.65 : 0.3) ? 1 : 2) : 2;
    const pickOf = (arr: readonly number[]): number => arr[Math.floor(rng() * arr.length) % arr.length];
    const bassIdx = I < 0.45 ? pickOf([0, 4, 0]) : I < 0.8 ? pickOf([0, 1, 2]) : pickOf([1, 2, 3, 3]);
    const kickIdx = I < 0.8 ? pickOf([0, 1, 3]) : pickOf([2, 2, 1]);
    this.sys.stats.sections++;
    return {
      prog: progs[pi],
      chordBars,
      bars: chordBars * 4,
      startBar: bar,
      bass: BASS_PATS[bassIdx],
      kick: KICK_PATS[kickIdx],
      hat16: I > 0.7 && rng() < 0.8,
      arpMode: Math.floor(rng() * 4),
      arpMask: ARP_MASKS[Math.floor(rng() * ARP_MASKS.length) % ARP_MASKS.length],
      arpWave: rng() < 0.6 ? 'square' : 'sawtooth',
    };
  }

  private barStart(bar: number, t: number, progs: readonly (readonly string[])[], game: boolean): { sec: Section; sb: number; chordStart: boolean } {
    let sec = this.section;
    if (!sec || bar - sec.startBar >= sec.bars) sec = this.section = this.newSection(bar, progs, game);
    const sb = bar - sec.startBar;
    const chordStart = sb % sec.chordBars === 0;
    if (chordStart) {
      this.chord = CHORDS[sec.prog[Math.floor(sb / sec.chordBars) % sec.prog.length]];
      const dur = sec.chordBars * this.barDur;
      this.padChord(t, dur, game);
    }
    return { sec, sb, chordStart };
  }

  // ---------------------------------------------------------------- game ---

  private gameStep(step: number, t: number): void {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    if (s16 === 0) {
      const { sec, sb, chordStart } = this.barStart(bar, t, GAME_PROGS, true);
      if (chordStart && this.on(3, t)) this.lead(t, sec.chordBars * this.barDur);
      if (sb === 0 && bar > 0 && this.on(2, t)) this.hit('_ohat', t, 0.35, 0.8, 0);
    }
    const sec = this.section;
    if (!sec) return;
    if (this.on(1, t)) {
      const v = sec.bass[s16];
      if (v !== 0) this.bass(t, Math.abs(v), v < 0 ? 12 : 0);
    }
    if (this.on(2, t)) this.drums(s16, bar, t, sec);
    if (this.on(3, t) && sec.arpMask[s16] > 0) this.arp(s16, t, sec);
  }

  private bass(t: number, vel: number, oct: number): void {
    const ctx = this.ctx;
    let r = this.chord[0] % 12;
    if (r > 6) r -= 12;
    const f = midiHz(ROOT - 12 + r + oct);
    const g = ctx.createGain();
    g.gain.value = 0;
    perc(g.gain, t, 0.5 * vel, 0.004, 0.085 + 0.04 * (1 - this.intensity));
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 6;
    flt.frequency.setValueAtTime(130, t);
    flt.frequency.linearRampToValueAtTime(300 + 1500 * vel * (0.4 + 0.6 * this.intensity), t + 0.006);
    flt.frequency.setTargetAtTime(120, t + 0.008, 0.05);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f;
    const sub = ctx.createGain();
    sub.gain.value = 0.6;
    o1.connect(flt);
    flt.connect(g);
    o2.connect(sub);
    sub.connect(g);
    g.connect(this.bassBus);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.7);
    o2.stop(t + 0.7);
    this.sys.stats.notes++;
  }

  private drums(s16: number, bar: number, t: number, sec: Section): void {
    const rng = this.sys.rng;
    const I = this.intensity;
    const lastBar = bar - sec.startBar === sec.bars - 1;
    if (sec.kick[s16] > 0) this.hit('_kick', t, 0.95 * sec.kick[s16], 1, 0);
    if (SNARE[s16] > 0) this.hit('_snare', t, 0.5, 1, 0);
    else if (lastBar && s16 > 12) this.hit('_snare', t, 0.18 + 0.08 * (s16 - 12), 1.05, 0);
    const h = sec.hat16 ? HAT16[s16] : HAT8[s16];
    if (h > 0) this.hit('_hat', t, 0.22 * h, 1 + (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.5);
    if (s16 === 14 && bar % 2 === 1 && I > 0.6) this.hit('_ohat', t, 0.16, 1, 0.3);
    if (sec.kick[s16] === 0 && SNARE[s16] === 0 && rng() < 0.03 + 0.09 * I) {
      this.hit('_glitch', t, 0.16, 0.8 + rng() * 0.6, (rng() * 2 - 1) * 0.7);
    }
    if (s16 === 6 && bar % 4 === 3) this.hit('_metal', t, 0.22, 0.7, -0.3);
  }

  private arpTones(base: number): number[] {
    const tones = this.chord.map((c) => base + (c % 12)).sort((a, b) => a - b);
    tones.push(tones[0] + 12);
    return tones;
  }

  private arp(s16: number, t: number, sec: Section): void {
    const tones = this.arpTones(ROOT + 12);
    const n = tones.length;
    let idx: number;
    switch (sec.arpMode) {
      case 0: idx = s16 % n; break;
      case 1: idx = n - 1 - (s16 % n); break;
      case 2: { const p = s16 % (2 * n - 2); idx = p < n ? p : 2 * n - 2 - p; break; }
      default: idx = Math.floor(this.sys.rng() * n) % n;
    }
    const m = tones[idx] + (sec.arpMode !== 3 && s16 >= 8 && (s16 & 3) === 0 ? 12 : 0);
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = sec.arpWave;
    o.frequency.value = midiHz(m);
    const g = ctx.createGain();
    g.gain.value = 0;
    perc(g.gain, t, (sec.arpWave === 'square' ? 0.22 : 0.26) * sec.arpMask[s16], 0.003, 0.055);
    o.connect(g);
    g.connect(this.arpBus);
    o.start(t);
    o.stop(t + 0.45);
    this.sys.stats.notes++;
  }

  /** L3 high tension: sustained chord-3rd plus a phrygian b2 shimmer. */
  private lead(t: number, dur: number): void {
    const ctx = this.ctx;
    const notes = [ROOT + 24 + (this.chord[1] % 12), ROOT + 13];
    notes.forEach((m, i) => {
      const lv = i === 0 ? 0.05 : 0.025;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(lv, t + Math.min(1.2, dur * 0.4));
      g.gain.setValueAtTime(lv, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.8);
      g.connect(this.leadBus);
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.85);
      }
      this.sys.stats.notes++;
    });
  }

  // ---------------------------------------------------------------- menu ---

  private menuStep(step: number, t: number): void {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const rng = this.sys.rng;
    if (s16 === 0) {
      const { sb, chordStart } = this.barStart(bar, t, MENU_PROGS, false);
      if (sb === 0) this.hit('_boom', t, 0.45, 1, 0);
      else if (rng() < 0.3) this.hit('_metal', t, 0.09, 0.4 + rng() * 0.2, (rng() * 2 - 1) * 0.8);
      if (chordStart) this.bell(t, this.arpTones(ROOT + 24)[0], 0.14);
    }
    if (s16 % 2 === 0 && s16 > 0 && rng() < 0.16) {
      const tones = this.arpTones(rng() < 0.6 ? ROOT + 24 : ROOT + 12);
      this.bell(t, tones[Math.floor(rng() * tones.length) % tones.length], 0.07 + rng() * 0.06);
    }
  }

  private bell(t: number, m: number, level: number): void {
    const ctx = this.ctx;
    const f = midiHz(m);
    const tau = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    perc(g.gain, t, level, 0.004, tau);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * (this.sys.rng() < 0.5 ? 2 : 3);
    const mg = ctx.createGain();
    mg.gain.value = 0;
    perc(mg.gain, t, f * 1.2, 0.002, tau * 0.4);
    mod.connect(mg);
    mg.connect(car.frequency);
    car.connect(g);
    g.connect(this.arpBus);
    const end = t + tau * 6;
    car.start(t);
    mod.start(t);
    car.stop(end);
    mod.stop(end);
    this.sys.stats.notes++;
  }

  // -------------------------------------------------------------- shared ---

  private padChord(t: number, dur: number, game: boolean): void {
    const a = game ? 0.5 : 2.2;
    const r = game ? 1.2 : 3.2;
    const lv = game ? 0.05 : 0.045;
    const notes = this.chord.slice(0, 4).map((c) => ROOT + (c % 12));
    for (const m of notes) this.padNote(t, midiHz(m), dur, a, r, lv);
  }

  private padNote(t: number, f: number, dur: number, a: number, r: number, level: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + a);
    g.gain.setValueAtTime(level, t + Math.max(a, dur));
    g.gain.linearRampToValueAtTime(0, t + Math.max(a, dur) + r);
    const m = ctx.createChannelMerger(2);
    m.connect(g);
    g.connect(this.padBus);
    const end = t + Math.max(a, dur) + r + 0.05;
    for (const [ch, det] of [[0, -9], [1, 9]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det + (this.sys.rng() - 0.5) * 4;
      o.connect(m, 0, ch);
      o.start(t);
      o.stop(end);
    }
    this.sys.stats.notes++;
  }

  private hit(name: string, t: number, vol: number, rate: number, pan: number): void {
    const bufs = this.sys.bank.get(name);
    if (!bufs || bufs.length === 0) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = bufs[Math.floor(this.sys.rng() * bufs.length) % bufs.length];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    if (pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.drumBus);
    } else {
      g.connect(this.drumBus);
    }
    src.start(t);
    this.sys.stats.notes++;
  }
}
