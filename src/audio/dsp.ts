// Low-level synthesis helpers shared by the SFX bank and the music system.
// Everything here works on any BaseAudioContext (live or offline).

export type F32 = Float32Array<ArrayBuffer>;
export type Rng = () => number;
export type NoiseKind = 'white' | 'pink' | 'brown';

/** Sample rate of the pre-rendered SFX bank (BufferSources resample on playback). */
export const BANK_RATE = 44100;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function monoBuffer(data: F32, sampleRate = BANK_RATE): AudioBuffer {
  const b = new AudioBuffer({ length: Math.max(1, data.length), numberOfChannels: 1, sampleRate });
  b.copyToChannel(data, 0);
  return b;
}

// ---------------------------------------------------------------- noise ---

interface NoiseSet {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}
let noiseSet: NoiseSet | null = null;

/** 2 s looping noise buffers, generated once and shared by every context. */
export function getNoise(): NoiseSet {
  if (noiseSet) return noiseSet;
  const n = BANK_RATE * 2;
  const rng = mulberry32(0x5eed1234);
  const white = new Float32Array(n);
  const pink = new Float32Array(n);
  const brown = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    white[i] = w;
    // Paul Kellet's refined pink filter
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    pink[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    last = (last + 0.02 * w) / 1.02;
    brown[i] = last;
  }
  for (const a of [pink, brown]) {
    // remove DC and normalise
    let mean = 0;
    for (let i = 0; i < n; i++) mean += a[i];
    mean /= n;
    let peak = 0;
    for (let i = 0; i < n; i++) { a[i] -= mean; peak = Math.max(peak, Math.abs(a[i])); }
    const k = 1 / (peak || 1);
    for (let i = 0; i < n; i++) a[i] *= k;
  }
  // crossfade the loop seam of brown noise (it drifts)
  const seam = 2000;
  for (let i = 0; i < seam; i++) {
    const f = i / seam;
    brown[n - seam + i] = brown[n - seam + i] * (1 - f) + brown[i] * f;
  }
  noiseSet = { white: monoBuffer(white), pink: monoBuffer(pink), brown: monoBuffer(brown) };
  return noiseSet;
}

// --------------------------------------------------------------- curves ---

const curveCache = new Map<string, F32>();

/** tanh saturation, normalised so ±1 maps to ±1. */
export function softClip(drive: number): F32 {
  const key = 'sc' + drive;
  let c = curveCache.get(key);
  if (!c) {
    const n = 2048;
    c = new Float32Array(n);
    const norm = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(drive * x) / norm;
    }
    curveCache.set(key, c);
  }
  return c;
}

/**
 * Master safety ceiling, used after a ×0.5 pre-gain: curve input u∈[-1,1]
 * represents v = 2u. Linear below |v| = 0.8, then a tanh knee that never
 * exceeds 1.0 (inputs beyond ±2 clamp to the curve ends ≈ ±1).
 */
export function ceilingCurve(): F32 {
  const key = 'ceil';
  let c = curveCache.get(key);
  if (!c) {
    const n = 4097;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = ((i / (n - 1)) * 2 - 1) * 2;
      const a = Math.abs(v);
      const y = a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
      c[i] = Math.sign(v) * Math.min(y, 0.999);
    }
    curveCache.set(key, c);
  }
  return c;
}

// ---------------------------------------------------------- envelopes ---

/** 0 → peak over `a` s, then exponential decay with time-constant `tau` (−60 dB ≈ 6.9·tau). */
export function perc(p: AudioParam, t: number, peak: number, a: number, tau: number): void {
  const at = Math.max(a, 0.0005);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + at);
  p.setTargetAtTime(0, t + at, tau);
}

/** Attack / hold / linear release. */
export function ahr(p: AudioParam, t: number, peak: number, a: number, h: number, r: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + Math.max(a, 0.0005));
  p.setValueAtTime(peak, t + a + h);
  p.linearRampToValueAtTime(0, t + a + h + Math.max(r, 0.002));
}

/** Exponential glide v0 → v1 over d seconds starting at t. */
export function glide(p: AudioParam, t: number, v0: number, v1: number, d: number): void {
  p.setValueAtTime(v0, t);
  p.exponentialRampToValueAtTime(v1, t + Math.max(d, 0.001));
}

// --------------------------------------------------------- JS generators ---

/** Sparse crackle: tiny noise bursts whose density goes d0 → d1 (per second). */
export function genCrackle(rng: Rng, seconds: number, d0: number, d1: number, sr = BANK_RATE): F32 {
  const n = Math.ceil(seconds * sr);
  const out = new Float32Array(n);
  let amp = 0;
  for (let i = 0; i < n; i++) {
    const f = i / n;
    const dens = d0 + (d1 - d0) * f;
    if (rng() < dens / sr) amp = 0.3 + 0.7 * rng();
    if (amp > 0.001) {
      out[i] = (rng() * 2 - 1) * amp;
      amp *= 0.82;
    }
  }
  return out;
}

/** Random stepped control signal (used for AM): new value every minMs..maxMs, lightly smoothed. */
export function genSteps(rng: Rng, seconds: number, minMs: number, maxMs: number, lo: number, hi: number, sr = BANK_RATE): F32 {
  const n = Math.ceil(seconds * sr);
  const out = new Float32Array(n);
  let next = 0, target = lo, v = lo;
  const k = 1 - Math.exp(-1 / (0.0015 * sr));
  for (let i = 0; i < n; i++) {
    if (i >= next) {
      next = i + ((minMs + (maxMs - minMs) * rng()) / 1000) * sr;
      target = lo + (hi - lo) * rng();
    }
    v += (target - v) * k;
    out[i] = v;
  }
  return out;
}

/**
 * Electric zap: white noise and a jittery sawtooth, both chopped by a fast
 * random gate (2–11 ms segments). Overall attack 3 ms, power-law decay.
 */
export function genZap(rng: Rng, seconds: number, buzzHz: number, sr = BANK_RATE): { noise: F32; buzz: F32 } {
  const n = Math.ceil(seconds * sr);
  const noise = new Float32Array(n);
  const buzz = new Float32Array(n);
  let next = 0, amT = 0, am = 0, f = buzzHz, phase = 0;
  const att = 0.003 * sr;
  for (let i = 0; i < n; i++) {
    if (i >= next) {
      next = i + (0.002 + rng() * 0.009) * sr;
      amT = rng() < 0.28 ? 0 : Math.pow(rng(), 0.5);
      f = buzzHz * (0.75 + rng() * 0.6);
    }
    am += (amT - am) * 0.2;
    const env = Math.min(1, i / att) * Math.pow(1 - i / n, 1.4);
    noise[i] = (rng() * 2 - 1) * am * env;
    phase += f / sr;
    if (phase >= 1) phase -= 1;
    buzz[i] = (2 * phase - 1) * am * env;
  }
  return { noise, buzz };
}

export interface ChipNote {
  f: number;
  t: number;
  d: number;
  v?: number;
}

/**
 * Lo-fi chip sequence: naive square/saw/tri notes, then sample-and-hold
 * (sample-rate reduction) and amplitude quantisation — a bit-crusher.
 * `hold` may be a function of normalised time for falling-rate glitches.
 */
export function genChip(
  rng: Rng,
  notes: readonly ChipNote[],
  seconds: number,
  hold: number | ((f: number) => number),
  bits: number | ((f: number) => number),
  wave: 'square' | 'saw' | 'tri',
  sr = BANK_RATE,
): F32 {
  const n = Math.ceil(seconds * sr);
  const dry = new Float32Array(n);
  for (const no of notes) {
    const s0 = Math.floor(no.t * sr);
    const len = Math.floor(no.d * sr);
    const v = no.v ?? 1;
    let ph = rng();
    const att = Math.min(len * 0.1, 0.002 * sr);
    for (let i = 0; i < len && s0 + i < n; i++) {
      ph += no.f / sr;
      ph -= Math.floor(ph);
      let s: number;
      if (wave === 'square') s = ph < 0.5 ? 1 : -1;
      else if (wave === 'saw') s = 2 * ph - 1;
      else s = 1 - 4 * Math.abs(ph - 0.5);
      const e = Math.min(1, i / Math.max(1, att)) * Math.pow(1 - i / len, 0.6);
      dry[s0 + i] += s * v * e;
    }
  }
  const out = new Float32Array(n);
  let held = 0, acc = 1;
  for (let i = 0; i < n; i++) {
    const f = i / n;
    const h = typeof hold === 'number' ? hold : hold(f);
    acc += h / sr;
    if (acc >= 1) {
      acc -= Math.floor(acc);
      const b = typeof bits === 'number' ? bits : bits(f);
      const q = Math.pow(2, Math.max(1, b) - 1);
      held = Math.round(clamp(dry[i], -1, 1) * q) / q;
    }
    out[i] = held;
  }
  return out;
}

// ------------------------------------------------------------- the kit ---

function link(n: AudioNode, dest: AudioNode | AudioParam): void {
  if (dest instanceof AudioParam) n.connect(dest);
  else n.connect(dest);
}

/** Small node-factory bound to one context, one start time and one RNG. */
export class Kit {
  readonly ctx: BaseAudioContext;
  readonly t: number;
  readonly out: AudioNode;
  readonly rng: Rng;
  readonly sr: number;

  constructor(ctx: BaseAudioContext, t: number, out: AudioNode, rng: Rng) {
    this.ctx = ctx;
    this.t = t;
    this.out = out;
    this.rng = rng;
    this.sr = ctx.sampleRate;
  }

  r(a: number, b: number): number {
    return a + (b - a) * this.rng();
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rng() * arr.length) % arr.length];
  }

  osc(type: OscillatorType, f: number, t0: number, t1: number, dest: AudioNode | AudioParam, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    link(o, dest);
    o.start(t0);
    o.stop(t1);
    return o;
  }

  /** Gain node, initial value v (default 0 so envelopes start silent). */
  vca(dest: AudioNode | AudioParam, v = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    link(g, dest);
    return g;
  }

  filter(type: BiquadFilterType, f: number, q: number, dest: AudioNode | AudioParam): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    link(b, dest);
    return b;
  }

  noise(kind: NoiseKind, t0: number, t1: number, dest: AudioNode | AudioParam, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = getNoise()[kind];
    s.loop = true;
    s.playbackRate.value = rate;
    link(s, dest);
    s.start(t0, this.rng() * 1.9);
    s.stop(t1);
    return s;
  }

  data(arr: F32, t0: number, dest: AudioNode | AudioParam, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = monoBuffer(arr);
    s.playbackRate.value = rate;
    link(s, dest);
    s.start(t0);
    return s;
  }

  shaper(curve: F32, dest: AudioNode): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = curve;
    w.connect(dest);
    return w;
  }

  pan(p: number, dest: AudioNode): StereoPannerNode {
    const n = this.ctx.createStereoPanner();
    n.pan.value = p;
    n.connect(dest);
    return n;
  }

  /** Feedback echo; returns the input node. Output = wet only. */
  echo(time: number, feedback: number, damp: number, wet: number, dest: AudioNode): GainNode {
    const inp = this.ctx.createGain();
    const d = this.ctx.createDelay(2);
    d.delayTime.value = time;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = damp;
    lp.Q.value = 0.5;
    const fb = this.vca(d, feedback);
    const w = this.vca(dest, wet);
    inp.connect(d);
    d.connect(lp);
    lp.connect(fb);
    lp.connect(w);
    return inp;
  }
}
