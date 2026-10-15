// Renders every SFX recipe once (OfflineAudioContext) into AudioBuffers.
// Buffers are trimmed to their audible length and loudness-normalised so the
// per-sound `gain` in sfx.ts is the only mix control.

import { ALL_DEFS, RENDER_ORDER } from './sfx';
import { BANK_RATE, Kit, hashString, mulberry32 } from './dsp';

export type Bank = Map<string, AudioBuffer[]>;

/** Target max momentary (50 ms) RMS after normalisation. */
const TARGET_RMS = 0.2;
/** Never exceed this sample peak after normalisation. */
const PEAK_CEIL = 0.95;
/** Trailing samples below peak × TRIM_REL (−60 dB) are trimmed. */
const TRIM_REL = 1e-3;
const CONCURRENCY = 6;

export interface RenderInfo {
  rawPeak: number;
  norm: number;
}

/** Render one variant of one recipe. Same path the live bank uses. */
export async function renderOne(name: string, variant: number, info?: RenderInfo): Promise<AudioBuffer> {
  const def = ALL_DEFS[name];
  if (!def) throw new Error(`audio: unknown sfx "${name}"`);
  const ch = def.stereo ? 2 : 1;
  const len = Math.ceil(def.dur * BANK_RATE);
  const ctx = new OfflineAudioContext(ch, len, BANK_RATE);
  const gate = ctx.createGain();
  // end gate: longer, gentler fade for long sounds (stingers), short for clicks
  const fade = Math.min(0.3, Math.max(0.01, def.dur * 0.1));
  gate.gain.setValueAtTime(1, 0);
  gate.gain.setValueAtTime(1, def.dur - fade);
  gate.gain.linearRampToValueAtTime(0, def.dur - 0.001);
  gate.connect(ctx.destination);
  const rng = mulberry32((hashString(name) + Math.imul(variant + 1, 0x9e3779b1)) >>> 0);
  def.render(new Kit(ctx, 0, gate, rng));
  const raw = await ctx.startRendering();
  return finish(raw, info);
}

function finish(raw: AudioBuffer, info?: RenderInfo): AudioBuffer {
  const ch = raw.numberOfChannels;
  const n = raw.length;
  const sr = raw.sampleRate;
  const data: Float32Array[] = [];
  for (let c = 0; c < ch; c++) data.push(raw.getChannelData(c));

  let peak = 0;
  for (const d of data) for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  if (info) { info.rawPeak = peak; info.norm = 1; }
  if (!(peak > 1e-7)) return raw; // silent: leave as-is (the audio check flags it)

  const thr = peak * TRIM_REL;
  let end = 1;
  for (const d of data) {
    for (let i = n - 1; i >= end; i--) if (Math.abs(d[i]) > thr) { end = i + 1; break; }
  }
  end = Math.min(n, end + Math.round(0.005 * sr));

  const win = Math.round(0.05 * sr);
  const hop = Math.round(0.025 * sr);
  let maxRms = 0;
  for (let s = 0; s < end; s += hop) {
    const e = Math.min(end, s + win);
    let acc = 0;
    for (const d of data) for (let i = s; i < e; i++) acc += d[i] * d[i];
    const rms = Math.sqrt(acc / ((e - s) * ch));
    if (rms > maxRms) maxRms = rms;
  }
  const g = Math.min(TARGET_RMS / Math.max(maxRms, 1e-9), PEAK_CEIL / peak);
  if (info) info.norm = g;

  const out = new AudioBuffer({ length: end, numberOfChannels: ch, sampleRate: sr });
  const fadeN = Math.min(end, Math.round(0.004 * sr));
  for (let c = 0; c < ch; c++) {
    const src = data[c];
    const dst = new Float32Array(end);
    for (let i = 0; i < end; i++) dst[i] = src[i] * g;
    for (let j = 0; j < fadeN; j++) dst[end - fadeN + j] *= 1 - (j + 1) / fadeN;
    out.copyToChannel(dst, c);
  }
  return out;
}

// One shared bank per page: live engine and offline test engines reuse it.
const bank: Bank = new Map();
let bankPromise: Promise<Bank> | null = null;

/** The (possibly still filling) shared bank. */
export function bankRef(): Bank {
  return bank;
}

/** Renders everything once; the map fills progressively (UI + common combat first). */
export function getBank(): Promise<Bank> {
  if (!bankPromise) bankPromise = build();
  return bankPromise;
}

async function build(): Promise<Bank> {
  const jobs: Array<[string, number]> = [];
  for (const name of RENDER_ORDER) {
    const v = ALL_DEFS[name].variants ?? 1;
    for (let i = 0; i < v; i++) jobs.push([name, i]);
  }
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const [name, v] = jobs[next++];
      try {
        const buf = await renderOne(name, v);
        let arr = bank.get(name);
        if (!arr) { arr = []; bank.set(name, arr); }
        arr.push(buf);
      } catch (e) {
        console.warn('[audio] failed to render', name, e);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return bank;
}
