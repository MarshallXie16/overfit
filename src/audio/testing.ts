// Offline test hooks (used by audio.html / tools/audio-check.mjs). They run
// the exact same render path and master chain as the live engine, but inside
// OfflineAudioContexts so results are measurable without speakers.

import { renderOne, getBank, type RenderInfo } from './bank';
import { ALL_DEFS } from './sfx';
import { AudioEngine } from './engine';
import { BANK_RATE, mulberry32 } from './dsp';
import { SFX_NAMES, type SfxName } from './types';

export interface SfxMeta {
  name: string;
  channels: number;
  sampleRate: number;
  maxDur: number;
  variants: number;
  gain: number;
  minMs: number;
  maxVoices: number;
}

export function sfxMeta(name: string): SfxMeta {
  const d = ALL_DEFS[name];
  if (!d) throw new Error(`audio: unknown sfx "${name}"`);
  return {
    name, channels: d.stereo ? 2 : 1, sampleRate: BANK_RATE, maxDur: d.dur, variants: d.variants ?? 1,
    gain: d.gain, minMs: d.minMs, maxVoices: d.maxVoices,
  };
}

export const ALL_SOUND_IDS: readonly string[] = Object.keys(ALL_DEFS);

/**
 * Render one SFX exactly as the bank does (trimmed + normalised).
 * Stereo sounds come back interleaved (L,R,L,R…); see sfxMeta(name).channels.
 */
export async function renderSfxOffline(name: string, variant = 0, info?: RenderInfo): Promise<Float32Array> {
  const buf = await renderOne(name, variant, info);
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const out = new Float32Array(l.length * 2);
  for (let i = 0; i < l.length; i++) {
    out[2 * i] = l[i];
    out[2 * i + 1] = r[i];
  }
  return out;
}

export interface MixPlay {
  at: number;
  name: SfxName;
  x?: number;
  y?: number;
  vol?: number;
}

export interface MixOptions {
  seconds: number;
  plays?: MixPlay[];
  /** Fire `count` random SFX at random times within `over` seconds, positions within ±spread tiles. */
  burst?: { count: number; over: number; seed?: number; spread?: number };
  music?: 'menu' | 'game';
  intensity?: number;
  /** Optional intensity changes over time: [time, value]. */
  intensityAt?: Array<[number, number]>;
  musicSeed?: number;
  stingerAt?: Array<[number, 'surge' | 'victory' | 'defeat' | 'epoch']>;
  pausedAt?: Array<[number, boolean]>;
  /** Listener [x, y, viewRadius] (default 0, 0, 20). */
  listener?: [number, number, number];
}

export interface MixResult {
  seconds: number;
  peak: number;
  rms: number;
  rmsL: number;
  rmsR: number;
  /** Energy fraction above 2 kHz (for muffle checks). */
  highFrac: number;
  /** RMS per 0.5 s window */
  windowRms: number[];
  /** Ungated K-weighted loudness (LUFS-like) after the first second. */
  lufs: number;
  /** K-weighted loudness per 0.5 s window. */
  windowLufs: number[];
  maxVoices: number;
  played: number;
  dropped: number;
  culled: number;
  stolen: number;
  errors: number;
  musicSteps: number;
  musicNotes: number;
  musicSections: number;
  renderMs: number;
}

/** Render the full engine (voices + music + master chain) offline. */
export async function renderMixOffline(o: MixOptions): Promise<MixResult> {
  const bank = await getBank();
  const sr = BANK_RATE;
  const ctx = new OfflineAudioContext(2, Math.ceil(o.seconds * sr), sr);
  const eng = new AudioEngine();
  eng._attachOffline(ctx, bank, o.musicSeed ?? 1234);
  const [lx, ly, lr] = o.listener ?? [0, 0, 20];
  eng.setListener(lx, ly, lr);
  eng.setIntensity(o.intensity ?? 0);
  if (o.music) eng.music(o.music);

  const plays: MixPlay[] = [...(o.plays ?? [])];
  if (o.burst) {
    const rng = mulberry32(o.burst.seed ?? 42);
    const spread = o.burst.spread ?? 30;
    for (let i = 0; i < o.burst.count; i++) {
      const name = SFX_NAMES[Math.floor(rng() * SFX_NAMES.length) % SFX_NAMES.length];
      const positional = rng() < 0.85;
      plays.push({
        at: rng() * o.burst.over,
        name,
        x: positional ? (rng() * 2 - 1) * spread : undefined,
        y: positional ? (rng() * 2 - 1) * spread * 0.6 : undefined,
        vol: 0.5 + rng() * 0.5,
      });
    }
  }
  plays.sort((a, b) => a.at - b.at);
  const ints = [...(o.intensityAt ?? [])].sort((a, b) => a[0] - b[0]);
  const stings = [...(o.stingerAt ?? [])].sort((a, b) => a[0] - b[0]);
  const pauses = [...(o.pausedAt ?? [])].sort((a, b) => a[0] - b[0]);

  let pi = 0, ii = 0, si = 0, pz = 0, errors = 0, maxVoices = 0;
  const tick = (now: number): void => {
    while (pz < pauses.length && pauses[pz][0] <= now + 1e-9) eng.setPaused(pauses[pz++][1]);
    while (ii < ints.length && ints[ii][0] <= now + 1e-9) eng.setIntensity(ints[ii++][1]);
    while (si < stings.length && stings[si][0] <= now + 1e-9) eng.stinger(stings[si++][1]);
    while (pi < plays.length && plays[pi].at <= now + 1e-9) {
      const p = plays[pi++];
      try {
        eng.play(p.name, { x: p.x, y: p.y, vol: p.vol });
      } catch {
        errors++;
      }
    }
    try {
      eng._pumpMusic(0.2);
    } catch {
      errors++;
    }
    maxVoices = Math.max(maxVoices, eng.voiceCount);
  };
  tick(0);
  const q = 0.01;
  for (let i = 1; i * q < o.seconds - 0.02; i++) {
    ctx.suspend(i * q)
      .then(() => {
        tick(ctx.currentTime);
        return ctx.resume();
      })
      .catch(() => {
        errors++;
      });
  }
  const t0 = performance.now();
  const out = await ctx.startRendering();
  const renderMs = performance.now() - t0;

  const l = out.getChannelData(0);
  const r = out.getChannelData(1);
  let peak = 0, acc = 0, accL = 0, accR = 0;
  const windowRms: number[] = [];
  const win = Math.round(0.5 * sr);
  let wacc = 0, wn = 0;
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = r[i];
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
    const e = (a * a + b * b) / 2;
    accL += a * a;
    accR += b * b;
    acc += e;
    wacc += e;
    if (++wn === win) {
      windowRms.push(Math.sqrt(wacc / wn));
      wacc = 0;
      wn = 0;
    }
  }
  if (wn > 0) windowRms.push(Math.sqrt(wacc / wn));
  const kw = kWeighted([l, r], sr);
  const hp2k = highPass(sr, 2000, 0.7071);
  const hiE = [l, r].reduce((s, c) => s + biquad(biquad(c, hp2k), hp2k).reduce((x, v) => x + v * v, 0), 0);
  const ms = eng.musicStats;
  return {
    seconds: o.seconds,
    peak,
    rms: Math.sqrt(acc / l.length),
    rmsL: Math.sqrt(accL / l.length),
    rmsR: Math.sqrt(accR / l.length),
    highFrac: hiE / Math.max(1e-12, accL + accR),
    windowRms,
    lufs: kw.lufs,
    windowLufs: kw.windows,
    maxVoices,
    played: eng.stats.played,
    dropped: eng.stats.dropped,
    culled: eng.stats.culled,
    stolen: eng.stats.stolen,
    errors: errors + eng.stats.errors + (ms ? ms.errors : 0),
    musicSteps: ms ? ms.steps : 0,
    musicNotes: ms ? ms.notes : 0,
    musicSections: ms ? ms.sections : 0,
    renderMs,
  };
}

/**
 * Measure the master chain's gain for a sine at `amp` fed into the UI bus
 * (sfx volume removed from the result). ≈1 for quiet input; loud input is
 * compressed/limited and must never exceed 1.0 at the output.
 */
export async function measureChain(amp: number): Promise<{ inAmp: number; outPeak: number; gain: number }> {
  const sr = BANK_RATE;
  const ctx = new OfflineAudioContext(2, sr, sr);
  const eng = new AudioEngine();
  eng._attachOffline(ctx, new Map());
  eng.setVolumes({ master: 1, sfx: 1 });
  const bus = eng._uiBus();
  if (!bus) throw new Error('no bus');
  const o = ctx.createOscillator();
  o.frequency.value = 220;
  const g = ctx.createGain();
  g.gain.value = amp;
  o.connect(g);
  g.connect(bus);
  o.start(0);
  const out = await ctx.startRendering();
  const d = out.getChannelData(0);
  let peak = 0;
  for (let i = Math.floor(sr * 0.5); i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  return { inAmp: amp, outPeak: peak, gain: peak / amp };
}

// ------------------------------------------------- K-weighted loudness ---

type Coef = [number, number, number, number, number];

function highShelf(fs: number, f0: number, db: number, q: number): Coef {
  const A = Math.pow(10, db / 40), w = (2 * Math.PI * f0) / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * q), sA = Math.sqrt(A);
  const a0 = A + 1 - (A - 1) * cs + 2 * sA * al;
  return [
    (A * (A + 1 + (A - 1) * cs + 2 * sA * al)) / a0,
    (-2 * A * (A - 1 + (A + 1) * cs)) / a0,
    (A * (A + 1 + (A - 1) * cs - 2 * sA * al)) / a0,
    (2 * (A - 1 - (A + 1) * cs)) / a0,
    (A + 1 - (A - 1) * cs - 2 * sA * al) / a0,
  ];
}

function highPass(fs: number, f0: number, q: number): Coef {
  const w = (2 * Math.PI * f0) / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return [(1 + cs) / 2 / a0, -(1 + cs) / a0, (1 + cs) / 2 / a0, (-2 * cs) / a0, (1 - al) / a0];
}

function biquad(x: Float32Array, c: Coef): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/** BS.1770 K-weighting (ungated): integrated loudness after 1 s + 0.5 s windows. */
function kWeighted(chs: Float32Array[], sr: number): { lufs: number; windows: number[] } {
  const shelf = highShelf(sr, 1681.97, 4, 0.7072);
  const hp = highPass(sr, 38.135, 0.5003);
  const w = chs.map((c) => biquad(biquad(c, shelf), hp));
  const n = chs[0].length;
  const toL = (ms: number): number => -0.691 + 10 * Math.log10(Math.max(ms, 1e-12));
  const win = Math.round(0.5 * sr);
  const windows: number[] = [];
  let tot = 0, totN = 0;
  for (let s = 0; s < n; s += win) {
    const e = Math.min(n, s + win);
    let acc = 0;
    for (const c of w) for (let i = s; i < e; i++) acc += c[i] * c[i];
    windows.push(toL(acc / (e - s)));
    if (s >= sr) { tot += acc; totN += e - s; }
  }
  return { lufs: toL(tot / Math.max(1, totN)), windows };
}
