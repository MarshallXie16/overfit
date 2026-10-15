// Sound-effect recipes. Each recipe builds a WebAudio graph into a Kit
// (normally an OfflineAudioContext); bank.ts renders every recipe once into
// an AudioBuffer at init, so in-game playback is just a BufferSource.
//
// Absolute levels inside a recipe don't matter: the bank loudness-normalises
// every buffer (momentary RMS / peak), and `gain` below sets the mix balance.

import {
  Kit, perc, ahr, glide, softClip, genCrackle, genSteps, genZap, genChip, midiHz, clamp, BANK_RATE,
  type NoiseKind, type ChipNote, type F32,
} from './dsp';
import type { SfxName } from './types';

export interface SfxDef {
  /** Render length (s); the buffer is trimmed to its audible length afterwards. */
  dur: number;
  stereo?: boolean;
  /** Pre-rendered variations (different seeds) to avoid machine-gun repetition. */
  variants?: number;
  /** Mix gain at playback (pre distance attenuation). */
  gain: number;
  /** Rate limit: minimum ms between voice starts of this name. */
  minMs: number;
  /** Max simultaneous voices of this name. */
  maxVoices: number;
  /** Voice-stealing weight; UI/alerts are high so battles never mute them. */
  priority?: number;
  /** ± random playback-rate variation per play (fraction, default 0.04). */
  pitchVar?: number;
  render: (k: Kit) => void;
}

// --------------------------------------------------------------- blocks ---

/** attack / hold / exponential decay */
function ahd(p: AudioParam, t: number, peak: number, a: number, h: number, tau: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + Math.max(a, 0.0005));
  p.setValueAtTime(peak, t + a + h);
  p.setTargetAtTime(0, t + a + h, tau);
}

/** Pitch-dropping sine: the low "body" of every impact. */
function thump(k: Kit, dest: AudioNode, t: number, f0: number, f1: number, drop: number, peak: number, tau: number): void {
  const g = k.vca(dest);
  perc(g.gain, t, peak, 0.002, tau);
  const o = k.osc('sine', f0, t, t + 0.01 + tau * 7, g);
  glide(o.frequency, t, f0, f1, drop);
}

/** Filtered noise burst with a percussive envelope. */
function burst(
  k: Kit, dest: AudioNode, t: number, kind: NoiseKind, type: BiquadFilterType,
  f: number, q: number, peak: number, a: number, tau: number, rate = 1,
): BiquadFilterNode {
  const g = k.vca(dest);
  perc(g.gain, t, peak, a, tau);
  const fl = k.filter(type, f, q, g);
  k.noise(kind, t, t + a + tau * 7 + 0.01, fl, rate);
  return fl;
}

/** Oscillator blip with optional exponential glide. */
function tone(
  k: Kit, dest: AudioNode, t: number, type: OscillatorType,
  f0: number, f1: number, glideT: number, peak: number, a: number, tau: number, detune = 0,
): OscillatorNode {
  const g = k.vca(dest);
  perc(g.gain, t, peak, a, tau);
  const o = k.osc(type, f0, t, t + a + tau * 7 + 0.01, g, detune);
  if (f1 !== f0) glide(o.frequency, t, f0, f1, glideT);
  return o;
}

/** Inharmonic partials of a struck bar / plate. */
const METAL = [1, 2.756, 5.404, 8.933, 1.506, 3.87];

function ring(k: Kit, dest: AudioNode, t: number, base: number, ratios: readonly number[], peak: number, tau: number): void {
  ratios.forEach((r, i) => {
    const f = base * r * (1 + k.r(-0.008, 0.008));
    if (f > k.sr * 0.45) return;
    tone(k, dest, t, 'sine', f, f, 0, peak / Math.pow(i + 1, 0.6), 0.0008, tau / (1 + i * 0.45));
  });
}

/** Two-operator FM bell. ratio 2 = warm/harmonic, 3.5 = clangy. */
function bell(k: Kit, dest: AudioNode, t: number, f: number, peak: number, tau: number, ratio = 3.5, index = 2): void {
  const g = k.vca(dest);
  perc(g.gain, t, peak, 0.002, tau);
  const end = t + tau * 7 + 0.02;
  const car = k.osc('sine', f, t, end, g);
  const mg = k.vca(car.frequency);
  perc(mg.gain, t, f * index, 0.001, tau * 0.5);
  k.osc('sine', f * ratio, t, end, mg);
}

/** Layered explosion. s ≈ 0.45 small, 1 big, 1.6 huge. */
function explosion(k: Kit, dest: AudioNode, t: number, s: number): void {
  const drive = k.shaper(softClip(2.2), dest);
  const bodyTau = 0.07 + 0.26 * s;
  thump(k, drive, t, k.r(85, 115), 28, 0.15 + 0.3 * s, 1.0, 0.08 + 0.2 * s);
  thump(k, drive, t, k.r(200, 260), 55, 0.05, 0.45, 0.03 + 0.03 * s);
  burst(k, drive, t, 'white', 'highpass', 1000, 0.7, 0.8, 0.0006, 0.01 + 0.012 * s);
  {
    const g = k.vca(drive);
    perc(g.gain, t, 1.0, 0.003, bodyTau);
    const lp = k.filter('lowpass', 3000, 0.9, g);
    glide(lp.frequency, t, 2600 + 1600 * s, 140, 0.25 + 1.0 * s);
    k.noise('brown', t, t + bodyTau * 7 + 0.02, lp);
  }
  {
    const tau = 0.05 + 0.18 * s;
    const g = k.vca(drive);
    perc(g.gain, t, 0.45, 0.008, tau);
    const bp = k.filter('bandpass', 900, 0.9, g);
    glide(bp.frequency, t, 1600, 250, 0.3 + 0.7 * s);
    k.noise('pink', t, t + tau * 7 + 0.02, bp);
  }
  {
    const len = 0.35 + 1.1 * s;
    const g = k.vca(dest);
    perc(g.gain, t + 0.02, 0.3, 0.01, len * 0.4);
    const bp = k.filter('bandpass', 2400, 0.7, g);
    k.data(genCrackle(k.rng, len, 500 + 700 * s, 20), t + 0.02, bp);
  }
  if (s >= 0.9) {
    const n = Math.round(3 * s);
    for (let i = 0; i < n; i++) {
      const tt = t + k.r(0.12, 0.25 + 0.5 * s);
      burst(k, dest, tt, 'white', 'bandpass', k.r(1500, 4000), 3, 0.15, 0.001, 0.012);
      thump(k, dest, tt, k.r(90, 140), 45, 0.06, 0.2, 0.04);
    }
  }
}

/** Electric discharge: noise + jittery saw, chopped by a fast random gate. */
function zap(k: Kit, dest: AudioNode, t: number, d: number, centre: number, buzzHz: number, level: number): void {
  const z = genZap(k.rng, d, buzzHz, BANK_RATE);
  const ng = k.vca(dest, level);
  k.data(z.noise, t, k.filter('bandpass', centre, 1.6, ng));
  const sz = k.vca(dest, level * 0.35);
  k.data(z.noise, t, k.filter('highpass', 6000, 0.7, sz));
  const bg = k.vca(dest, level * 0.55);
  const hp = k.filter('highpass', 180, 0.7, bg);
  k.data(z.buzz, t, k.shaper(softClip(4), hp));
  const cg = k.vca(dest, level * 0.5);
  k.data(genCrackle(k.rng, d, 300, 80), t, k.filter('highpass', 2500, 0.7, cg));
}

/** Plays a JS-generated buffer through a gentle lowpass. */
function playData(k: Kit, dest: AudioNode, t: number, data: F32, level: number, lp = 9000): void {
  const g = k.vca(dest, level);
  k.data(data, t, k.filter('lowpass', lp, 0.7, g));
}

/** Detuned-saw brass section for the stingers. */
function brass(k: Kit, dest: AudioNode, t: number, notes: readonly number[], hold: number, level: number, bright = 3200): void {
  notes.forEach((m, i) => {
    const f = midiHz(m);
    const p = k.pan((i % 2 ? 1 : -1) * 0.35, dest);
    const g = k.vca(p);
    ahd(g.gain, t, (level / notes.length) * 1.5, 0.03, hold, 0.25);
    const lp = k.filter('lowpass', 500, 1.2, g);
    lp.frequency.setValueAtTime(450, t);
    lp.frequency.linearRampToValueAtTime(bright, t + 0.06);
    lp.frequency.setTargetAtTime(bright * 0.45, t + 0.07, 0.25);
    for (const det of [-8, 0, 8]) k.osc('sawtooth', f, t, t + hold + 1.8, lp, det + k.r(-2, 2));
  });
}

// ------------------------------------------------------------- recipes ---

export const SFX: Record<SfxName, SfxDef> = {
  // ---------------------------------------------------------- weapons ---
  rifle: {
    dur: 0.45, variants: 3, gain: 0.65, minMs: 40, maxVoices: 5, pitchVar: 0.05,
    render(k) {
      const t = k.t, d = k.shaper(softClip(2.5), k.out);
      burst(k, d, t, 'white', 'bandpass', k.r(2200, 3200), 0.8, 1.0, 0.0005, 0.009);
      burst(k, d, t, 'white', 'highpass', 5000, 0.7, 0.45, 0.0003, 0.005);
      thump(k, d, t, k.r(220, 280), 70, 0.035, 0.75, 0.022);
      burst(k, d, t, 'pink', 'lowpass', 1500, 0.7, 0.5, 0.001, 0.03);
      burst(k, k.out, t + k.r(0.035, 0.06), 'pink', 'bandpass', 1000, 0.7, 0.12, 0.012, 0.07);
    },
  },
  rail: {
    dur: 0.95, variants: 2, gain: 0.55, minMs: 70, maxVoices: 4,
    render(k) {
      const t = k.t, o = k.out, ch = 0.16, ts = t + ch;
      const cg = k.vca(o);
      cg.gain.setValueAtTime(0, t);
      cg.gain.linearRampToValueAtTime(0.22, ts - 0.01);
      cg.gain.linearRampToValueAtTime(0, ts + 0.005);
      const bp = k.filter('bandpass', 800, 3, cg);
      glide(bp.frequency, t, 700, 5200, ch);
      const s1 = k.osc('sawtooth', 320, t, ts + 0.01, bp);
      glide(s1.frequency, t, 320, 2600, ch);
      const s2 = k.osc('sine', 640, t, ts + 0.01, cg);
      glide(s2.frequency, t, 640, 5200, ch);
      const d = k.shaper(softClip(3), o);
      burst(k, d, ts, 'white', 'highpass', 2500, 0.7, 1.0, 0.0003, 0.004);
      burst(k, d, ts, 'white', 'bandpass', 1800, 1, 0.6, 0.0005, 0.012);
      thump(k, d, ts, 180, 50, 0.06, 0.7, 0.04);
      tone(k, o, ts, 'sine', 4200, 650, 0.22, 0.28, 0.001, 0.07);
      tone(k, o, ts, 'triangle', 2100, 420, 0.22, 0.12, 0.001, 0.06);
      const ag = k.vca(o);
      perc(ag.gain, ts, 0.25, 0.004, 0.09);
      const af = k.filter('bandpass', 3000, 1.2, ag);
      glide(af.frequency, ts, 5000, 700, 0.4);
      k.noise('white', ts, ts + 0.7, af);
    },
  },
  arc: {
    dur: 0.45, variants: 2, gain: 0.45, minMs: 60, maxVoices: 4,
    render(k) {
      zap(k, k.out, k.t, 0.38, k.r(2400, 3400), k.r(90, 130), 1);
      tone(k, k.out, k.t, 'sawtooth', 1800, 300, 0.1, 0.1, 0.001, 0.02);
    },
  },
  zap_small: {
    dur: 0.22, variants: 3, gain: 0.35, minMs: 35, maxVoices: 5, pitchVar: 0.07,
    render(k) {
      zap(k, k.out, k.t, 0.16, k.r(3500, 5000), k.r(150, 220), 1);
      tone(k, k.out, k.t, 'sine', 2600, 900, 0.05, 0.15, 0.001, 0.015);
    },
  },
  rocket_launch: {
    dur: 0.95, variants: 2, gain: 0.5, minMs: 80, maxVoices: 4,
    render(k) {
      const t = k.t, o = k.out;
      thump(k, o, t, 170, 55, 0.06, 0.7, 0.045);
      burst(k, o, t, 'white', 'highpass', 1800, 0.7, 0.45, 0.0005, 0.012);
      const wg = k.vca(o);
      wg.gain.setValueAtTime(0, t);
      wg.gain.linearRampToValueAtTime(0.85, t + 0.05);
      wg.gain.setTargetAtTime(0, t + 0.12, 0.17);
      const wf = k.filter('bandpass', 600, 1.3, wg);
      wf.frequency.setValueAtTime(500, t);
      wf.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
      wf.frequency.exponentialRampToValueAtTime(900, t + 0.8);
      k.noise('pink', t, t + 0.9, wf);
      const hg = k.vca(o);
      perc(hg.gain, t, 0.25, 0.02, 0.12);
      k.noise('white', t, t + 0.9, k.filter('highpass', 5000, 0.7, hg));
      const mg = k.vca(o);
      perc(mg.gain, t, 0.18, 0.03, 0.15);
      const mo = k.osc('sawtooth', 140, t, t + 0.9, k.filter('lowpass', 700, 1, mg));
      glide(mo.frequency, t, 140, 95, 0.8);
    },
  },
  cannon: {
    dur: 1.3, variants: 2, gain: 0.65, minMs: 90, maxVoices: 4, priority: 1.5,
    render(k) {
      const t = k.t, d = k.shaper(softClip(2.5), k.out);
      thump(k, d, t, k.r(140, 170), 36, 0.14, 1.0, 0.16);
      burst(k, d, t, 'white', 'highpass', 1300, 0.7, 0.8, 0.0005, 0.012);
      const g = k.vca(d);
      perc(g.gain, t, 0.9, 0.003, 0.11);
      const lp = k.filter('lowpass', 2000, 0.8, g);
      glide(lp.frequency, t, 2200, 180, 0.6);
      k.noise('brown', t, t + 0.9, lp);
      burst(k, d, t, 'pink', 'bandpass', 600, 0.9, 0.4, 0.004, 0.08);
      burst(k, k.out, t + 0.13, 'pink', 'lowpass', 700, 0.7, 0.18, 0.02, 0.12);
      burst(k, k.out, t + 0.31, 'pink', 'lowpass', 500, 0.7, 0.08, 0.03, 0.15);
    },
  },
  artillery_fire: {
    dur: 2.1, gain: 0.7, minMs: 150, maxVoices: 3, priority: 1.5,
    render(k) {
      const t = k.t, o = k.out, d = k.shaper(softClip(2.5), o);
      thump(k, d, t, 120, 26, 0.25, 1.0, 0.24);
      burst(k, d, t, 'white', 'highpass', 1100, 0.7, 0.8, 0.0005, 0.016);
      const g = k.vca(d);
      perc(g.gain, t, 1.0, 0.004, 0.2);
      const lp = k.filter('lowpass', 1600, 0.8, g);
      glide(lp.frequency, t, 1800, 120, 1.0);
      k.noise('brown', t, t + 1.6, lp);
      burst(k, d, t, 'pink', 'bandpass', 450, 0.9, 0.45, 0.005, 0.14);
      [[0.22, 0.25, 600], [0.5, 0.14, 450], [0.85, 0.07, 320]].forEach(([dt, a, f]) =>
        burst(k, o, t + dt, 'pink', 'lowpass', f, 0.7, a, 0.03, 0.16));
      const rg = k.vca(o);
      ahr(rg.gain, t, 0.3, 0.05, 0.4, 1.2);
      k.noise('brown', t, t + 1.8, k.filter('lowpass', 160, 0.7, rg));
    },
  },
  mg_turret: {
    dur: 0.35, variants: 3, gain: 0.6, minMs: 45, maxVoices: 5, pitchVar: 0.05,
    render(k) {
      const t = k.t, d = k.shaper(softClip(3), k.out);
      burst(k, d, t, 'white', 'bandpass', k.r(1500, 2100), 0.9, 1.0, 0.0005, 0.011);
      thump(k, d, t, k.r(170, 200), 55, 0.05, 0.95, 0.03);
      burst(k, d, t, 'pink', 'lowpass', 1100, 0.8, 0.6, 0.001, 0.04);
      tone(k, d, t, 'square', 95, 60, 0.03, 0.12, 0.001, 0.015);
      burst(k, k.out, t + 0.03, 'pink', 'bandpass', 800, 0.7, 0.1, 0.01, 0.06);
      burst(k, k.out, t + k.r(0.04, 0.06), 'white', 'bandpass', 4500, 4, 0.12, 0.0005, 0.004);
    },
  },
  tesla: {
    dur: 0.95, variants: 2, gain: 0.48, minMs: 90, maxVoices: 3,
    render(k) {
      const t = k.t, o = k.out;
      thump(k, o, t, 120, 40, 0.08, 0.6, 0.06);
      zap(k, o, t, 0.75, k.r(1800, 2400), k.r(55, 70), 1);
      zap(k, o, t + 0.05, 0.5, k.r(4000, 5500), k.r(110, 140), 0.6);
      const hg = k.vca(o);
      ahr(hg.gain, t, 0.18, 0.01, 0.4, 0.3);
      const hl = k.filter('lowpass', 900, 2, hg);
      k.osc('sawtooth', 60, t, t + 0.75, hl);
      k.osc('sawtooth', 120.5, t, t + 0.75, hl);
    },
  },
  missile: {
    dur: 1.3, gain: 0.55, minMs: 120, maxVoices: 3,
    render(k) {
      const t = k.t, o = k.out;
      burst(k, o, t, 'white', 'bandpass', 2500, 2, 0.4, 0.0005, 0.006);
      tone(k, o, t, 'square', 220, 110, 0.03, 0.15, 0.001, 0.02);
      const ti = t + 0.05;
      thump(k, o, ti, 150, 50, 0.08, 0.7, 0.06);
      const wg = k.vca(o);
      ahd(wg.gain, ti, 0.8, 0.05, 0.15, 0.22);
      const wf = k.filter('bandpass', 400, 1.2, wg);
      wf.frequency.setValueAtTime(400, ti);
      wf.frequency.exponentialRampToValueAtTime(3000, ti + 0.25);
      wf.frequency.exponentialRampToValueAtTime(1200, ti + 1.1);
      k.noise('pink', ti, ti + 1.2, wf);
      const wh = k.vca(o);
      ahd(wh.gain, ti, 0.12, 0.08, 0.2, 0.2);
      const so = k.osc('sine', 900, ti, ti + 1.2, wh);
      so.frequency.setValueAtTime(900, ti);
      so.frequency.exponentialRampToValueAtTime(2200, ti + 0.5);
      so.frequency.exponentialRampToValueAtTime(1800, ti + 1.1);
      const hg = k.vca(o);
      perc(hg.gain, ti, 0.22, 0.02, 0.18);
      k.noise('white', ti, ti + 1.2, k.filter('highpass', 4500, 0.7, hg));
    },
  },

  // ------------------------------------------------------- explosions ---
  explosion_small: {
    dur: 1.3, variants: 3, gain: 0.65, minMs: 40, maxVoices: 5, pitchVar: 0.06,
    render(k) { explosion(k, k.out, k.t, 0.45); },
  },
  explosion_big: {
    dur: 2.4, variants: 2, gain: 0.72, minMs: 70, maxVoices: 4, priority: 2,
    render(k) { explosion(k, k.out, k.t, 1.0); },
  },
  explosion_huge: {
    dur: 4.0, stereo: true, gain: 0.85, minMs: 200, maxVoices: 2, priority: 3, pitchVar: 0.03,
    render(k) {
      const t = k.t, o = k.out;
      explosion(k, o, t, 1.6);
      thump(k, o, t, 55, 22, 0.6, 0.8, 0.45);
      for (const p of [-0.75, 0.75]) {
        const cg = k.vca(k.pan(p, o));
        ahr(cg.gain, t + 0.15, 0.3, 0.1, 1.0, 2.0);
        k.data(genCrackle(k.rng, 3.2, 600, 40), t + 0.15, k.filter('bandpass', 2000, 0.6, cg));
      }
      const rg = k.vca(o);
      ahr(rg.gain, t, 0.45, 0.15, 1.0, 2.4);
      k.noise('brown', t, t + 3.8, k.filter('lowpass', 170, 0.8, rg));
    },
  },
  impact_metal: {
    dur: 0.7, variants: 3, gain: 0.4, minMs: 45, maxVoices: 4, pitchVar: 0.06,
    render(k) {
      const t = k.t, o = k.out;
      burst(k, o, t, 'white', 'highpass', 3000, 0.7, 0.6, 0.0003, 0.004);
      thump(k, o, t, 180, 90, 0.03, 0.4, 0.025);
      ring(k, o, t, k.r(380, 620), METAL, 0.5, 0.18);
      burst(k, o, t, 'white', 'bandpass', k.r(2500, 4500), 6, 0.3, 0.001, 0.05);
    },
  },
  bullet_hit: {
    dur: 0.2, variants: 3, gain: 0.3, minMs: 22, maxVoices: 6, pitchVar: 0.08,
    render(k) {
      const t = k.t, o = k.out;
      burst(k, o, t, 'white', 'bandpass', k.r(1200, 2600), 1.2, 1.0, 0.0004, 0.007);
      burst(k, o, t, 'pink', 'lowpass', 900, 0.7, 0.5, 0.001, 0.018);
      if (k.rng() < 0.5) tone(k, o, t + 0.002, 'sine', k.r(2800, 4200), k.r(1800, 2600), 0.08, 0.12, 0.001, 0.03);
      else ring(k, o, t, k.r(1500, 2200), [1, 2.756], 0.15, 0.03);
    },
  },

  // ----------------------------------------------------------- AXIOM ---
  skitter_bite: {
    dur: 0.25, variants: 3, gain: 0.45, minMs: 40, maxVoices: 4, pitchVar: 0.08,
    render(k) {
      const o = k.out;
      let tt = k.t;
      const n = 4 + Math.floor(k.rng() * 3);
      for (let i = 0; i < n; i++) {
        burst(k, o, tt, 'white', 'bandpass', k.r(3000, 6500), 4, k.r(0.5, 0.9), 0.0003, 0.003);
        tone(k, o, tt, 'square', k.r(1600, 2800), k.r(1200, 1800), 0.006, 0.08, 0.0005, 0.003);
        tt += k.r(0.012, 0.024);
      }
      burst(k, o, tt + 0.01, 'white', 'highpass', 2200, 0.7, 1.0, 0.0003, 0.006);
      ring(k, o, tt + 0.01, k.r(1300, 1700), [1, 2.756, 5.404], 0.35, 0.03);
    },
  },
  robot_shot: {
    dur: 0.3, variants: 3, gain: 0.45, minMs: 40, maxVoices: 5, pitchVar: 0.06,
    render(k) {
      const t = k.t, o = k.out;
      const f0 = k.r(1300, 1700);
      const g = k.vca(o);
      perc(g.gain, t, 0.8, 0.001, 0.045);
      const rm = k.vca(g, 0);
      const lp = k.filter('lowpass', 5000, 1, rm);
      const sq = k.osc('square', f0, t, t + 0.3, lp);
      glide(sq.frequency, t, f0, f0 * 0.22, 0.12);
      k.osc('sine', k.r(700, 900), t, t + 0.3, rm.gain);
      tone(k, o, t, 'sawtooth', f0 * 0.5, 120, 0.1, 0.35, 0.001, 0.035);
      burst(k, o, t, 'white', 'bandpass', 3500, 2, 0.4, 0.0005, 0.006);
    },
  },
  lancer_beam: {
    dur: 0.75, variants: 2, gain: 0.36, minMs: 80, maxVoices: 4,
    render(k) {
      const t = k.t, o = k.out, end = t + 0.62;
      tone(k, o, t, 'sine', 900, 3200, 0.05, 0.25, 0.001, 0.02);
      const g = k.vca(o);
      ahr(g.gain, t + 0.03, 0.6, 0.015, 0.33, 0.18);
      const trem = k.vca(g, 0.75);
      k.osc('sine', 38, t, end, k.vca(trem.gain, 0.25));
      const bp = k.filter('bandpass', 900, 5, trem);
      glide(bp.frequency, t, 900, 2800, 0.5);
      const sh = k.shaper(softClip(3), bp);
      k.osc('sawtooth', 220, t, end, sh);
      k.osc('sawtooth', 221.7, t, end, sh);
      k.osc('square', 440.8, t, end, sh);
      const wg = k.vca(o);
      ahr(wg.gain, t + 0.03, 0.12, 0.02, 0.3, 0.2);
      const rm = k.vca(wg, 0);
      k.osc('sine', 1760, t, end, rm);
      k.osc('sine', 330, t, end, rm.gain);
    },
  },
  brute_slam: {
    dur: 0.8, variants: 2, gain: 0.55, minMs: 90, maxVoices: 3,
    render(k) {
      const t = k.t, o = k.out, d = k.shaper(softClip(2.5), o);
      thump(k, d, t, 130, 40, 0.1, 1.0, 0.09);
      burst(k, d, t, 'pink', 'lowpass', 2200, 0.8, 0.7, 0.001, 0.05);
      burst(k, d, t, 'white', 'highpass', 2000, 0.7, 0.5, 0.0004, 0.008);
      ring(k, o, t, k.r(150, 200), METAL, 0.35, 0.22);
      const sg = k.vca(o);
      ahr(sg.gain, t + 0.18, 0.12, 0.04, 0.12, 0.1);
      const so = k.osc('sawtooth', 280, t + 0.18, t + 0.5, k.filter('bandpass', 1200, 4, sg));
      glide(so.frequency, t + 0.18, 280, 520, 0.26);
    },
  },
  sapper_beep: {
    dur: 0.22, gain: 0.3, minMs: 120, maxVoices: 3, pitchVar: 0.01,
    render(k) {
      const o = k.out;
      for (const dt of [0, 0.085]) {
        const t = k.t + dt;
        const g = k.vca(o);
        ahr(g.gain, t, 0.5, 0.002, 0.04, 0.01);
        k.osc('square', 1760, t, t + 0.06, k.filter('bandpass', 1800, 2, g));
        k.osc('sine', 3520, t, t + 0.06, k.vca(g, 0.3));
      }
    },
  },
  wasp_buzz: {
    dur: 0.65, variants: 2, gain: 0.3, minMs: 120, maxVoices: 3,
    render(k) {
      const t = k.t, o = k.out, end = t + 0.62;
      const g = k.vca(o);
      ahr(g.gain, t, 0.5, 0.08, 0.3, 0.2);
      const am = k.vca(g, 0.6);
      k.osc('sine', k.r(24, 32), t, end, k.vca(am.gain, 0.4));
      const bp = k.filter('bandpass', 900, 1.5, am);
      const f = k.r(150, 175);
      for (const m of [1, 1.02]) {
        const os = k.osc('sawtooth', f * m, t, end, bp);
        os.frequency.setValueAtTime(f * m, t);
        os.frequency.linearRampToValueAtTime(f * m * 1.08, t + 0.25);
        os.frequency.linearRampToValueAtTime(f * m * 0.92, t + 0.6);
      }
    },
  },
  colossus_stomp: {
    dur: 1.7, variants: 2, gain: 0.75, minMs: 250, maxVoices: 2, priority: 2,
    render(k) {
      const t = k.t, o = k.out, d = k.shaper(softClip(2), o);
      thump(k, d, t, 75, 26, 0.25, 1.0, 0.22);
      const g = k.vca(d);
      perc(g.gain, t, 0.8, 0.004, 0.18);
      const lp = k.filter('lowpass', 500, 0.8, g);
      glide(lp.frequency, t, 600, 90, 0.8);
      k.noise('brown', t, t + 1.5, lp);
      burst(k, d, t, 'pink', 'lowpass', 1800, 0.7, 0.4, 0.001, 0.03);
      ring(k, o, t + 0.01, k.r(80, 100), METAL, 0.25, 0.35);
      const cg = k.vca(o);
      perc(cg.gain, t + 0.05, 0.25, 0.02, 0.3);
      k.data(genCrackle(k.rng, 1.2, 250, 10), t + 0.05, k.filter('bandpass', 1500, 0.8, cg));
    },
  },
  colossus_horn: {
    dur: 3.2, stereo: true, gain: 0.7, minMs: 2000, maxVoices: 1, priority: 3, pitchVar: 0.02,
    render(k) {
      const t = k.t, o = k.out, end = t + 3.1;
      const g = k.vca(o);
      ahr(g.gain, t, 0.7, 0.18, 1.7, 1.1);
      const lp = k.filter('lowpass', 200, 3, g);
      lp.frequency.setValueAtTime(180, t);
      lp.frequency.exponentialRampToValueAtTime(1600, t + 0.5);
      lp.frequency.exponentialRampToValueAtTime(700, t + 2.0);
      lp.frequency.exponentialRampToValueAtTime(250, t + 3.0);
      const d = k.shaper(softClip(2.5), lp);
      const voices: Array<[number, number]> = [[73.42, -0.6], [73.42, 0.6], [110, -0.3], [110, 0.3], [146.83, 0]];
      for (const [f, p] of voices) k.osc('sawtooth', f, t, end, k.pan(p, d), k.r(-12, 12));
      const sg = k.vca(o);
      ahr(sg.gain, t, 0.5, 0.1, 1.8, 1.0);
      k.osc('sine', 73.42, t, end, sg);
      k.osc('sine', 6.5, t, end, k.vca(lp.frequency, 90)); // growl
    },
  },
  robot_die: {
    dur: 0.8, variants: 3, gain: 0.45, minMs: 50, maxVoices: 4, pitchVar: 0.06,
    render(k) {
      const t = k.t, o = k.out;
      const g = k.vca(o);
      perc(g.gain, t, 0.35, 0.002, 0.12);
      const lp = k.filter('lowpass', 3000, 2, g);
      glide(lp.frequency, t, 3000, 300, 0.4);
      const sq = k.osc('square', 900, t, t + 0.75, lp);
      let f = k.r(700, 1100);
      for (let i = 0; i < 12; i++) {
        sq.frequency.setValueAtTime(f * k.r(0.85, 1.15), t + i * 0.03);
        f *= 0.8;
      }
      thump(k, o, t, 220, 60, 0.05, 0.6, 0.04);
      burst(k, o, t, 'pink', 'lowpass', 2500, 0.7, 0.6, 0.001, 0.04);
      const cg = k.vca(o);
      perc(cg.gain, t, 0.4, 0.005, 0.12);
      k.data(genCrackle(k.rng, 0.6, 900, 50), t, k.filter('highpass', 3000, 0.7, cg));
      ring(k, o, t + k.r(0.05, 0.15), k.r(600, 900), [1, 2.756, 5.404], 0.2, 0.08);
    },
  },
  robot_die_big: {
    dur: 2.0, variants: 2, gain: 0.62, minMs: 120, maxVoices: 3, priority: 1.5,
    render(k) {
      const t = k.t, o = k.out;
      explosion(k, o, t, 0.75);
      const wg = k.vca(o);
      ahr(wg.gain, t, 0.18, 0.01, 0.3, 0.6);
      const wo = k.osc('sawtooth', 1400, t, t + 1.0, k.filter('lowpass', 2500, 3, wg));
      glide(wo.frequency, t, 1400, 45, 0.95);
      const cg = k.vca(o);
      perc(cg.gain, t, 0.3, 0.01, 0.35);
      k.data(genCrackle(k.rng, 1.5, 1200, 60), t, k.filter('highpass', 2800, 0.7, cg));
      for (let i = 0; i < 3; i++) ring(k, o, t + k.r(0.1, 0.7), k.r(500, 1100), [1, 2.756, 5.404], 0.15, 0.06);
    },
  },
  human_die: {
    dur: 0.6, variants: 3, gain: 0.42, minMs: 60, maxVoices: 3, pitchVar: 0.06,
    render(k) {
      const t = k.t, o = k.out;
      thump(k, o, t, 120, 60, 0.05, 0.6, 0.04);
      burst(k, o, t, 'brown', 'lowpass', 600, 0.7, 0.8, 0.003, 0.05);
      let tt = t + k.r(0.05, 0.1);
      for (let i = 0; i < 3; i++) {
        burst(k, o, tt, 'white', 'bandpass', k.r(2500, 5000), 3, 0.25, 0.0004, 0.004);
        tt += k.r(0.03, 0.07);
      }
      const t2 = t + k.r(0.16, 0.24);
      thump(k, o, t2, 90, 50, 0.05, 0.45, 0.04);
      burst(k, o, t2, 'brown', 'lowpass', 400, 0.7, 0.5, 0.004, 0.05);
    },
  },
  building_collapse: {
    dur: 3.4, stereo: true, gain: 0.7, minMs: 300, maxVoices: 2, priority: 2,
    render(k) {
      const t = k.t, o = k.out, d = k.shaper(softClip(2), o);
      burst(k, d, t, 'white', 'highpass', 900, 0.7, 0.8, 0.0005, 0.02);
      thump(k, d, t, 95, 30, 0.2, 1.0, 0.18);
      const rg = k.vca(d);
      ahr(rg.gain, t, 0.9, 0.12, 1.3, 1.6);
      const am = k.vca(rg, 0);
      k.data(genSteps(k.rng, 3.2, 40, 140, 0.35, 1.0), t, am.gain);
      const rl = k.filter('lowpass', 300, 0.9, am);
      glide(rl.frequency, t, 500, 120, 3.0);
      k.noise('brown', t, t + 3.2, rl);
      for (let i = 0; i < 7; i++) {
        const tt = t + k.r(0.15, 2.0);
        const p = k.pan(k.r(-0.7, 0.7), d);
        thump(k, p, tt, k.r(70, 120), 30, 0.12, k.r(0.3, 0.7), k.r(0.06, 0.14));
        burst(k, p, tt, 'pink', 'lowpass', 1500, 0.7, 0.35, 0.002, 0.05);
      }
      for (const p of [-0.6, 0.6]) {
        const cg = k.vca(k.pan(p, o));
        ahr(cg.gain, t + 0.1, 0.4, 0.1, 1.2, 1.5);
        k.data(genCrackle(k.rng, 3.0, 400, 60), t + 0.1, k.filter('bandpass', 1800, 0.6, cg));
      }
      const mg = k.vca(o);
      ahr(mg.gain, t + 0.3, 0.12, 0.3, 0.6, 0.6);
      const mb = k.filter('bandpass', 500, 14, mg);
      glide(mb.frequency, t + 0.3, 420, 900, 1.4);
      k.osc('sawtooth', 62, t + 0.3, t + 2.0, mb);
    },
  },

  // --------------------------------------------------- hacking & powers ---
  hack_start: {
    dur: 0.75, variants: 2, gain: 0.32, minMs: 150, maxVoices: 3, priority: 2,
    render(k) {
      const t = k.t, o = k.out;
      const notes: ChipNote[] = [];
      const scale = [0, 3, 5, 7, 10, 12, 15];
      let tt = 0, step = 0.045;
      while (tt < 0.6) {
        notes.push({ f: midiHz(74 + k.pick(scale) + (k.rng() < 0.3 ? 12 : 0)), t: tt, d: step * 0.8, v: 0.6 + 0.4 * k.rng() });
        tt += step;
        step = Math.max(0.018, step * 0.88);
      }
      playData(k, o, t, genChip(k.rng, notes, 0.7, 5000, 4, 'square'), 0.5, 7000);
      const cg = k.vca(o);
      ahr(cg.gain, t, 0.15, 0.01, 0.5, 0.1);
      const c = k.osc('sine', 1200, t, t + 0.65, cg);
      k.osc('square', 37, t, t + 0.65, k.vca(c.frequency, 600));
    },
  },
  hack_success: {
    dur: 1.0, gain: 0.45, minMs: 150, maxVoices: 2, priority: 3, pitchVar: 0.01,
    render(k) {
      const t = k.t, o = k.out;
      const seq = [62, 69, 74, 78, 81, 86];
      const notes: ChipNote[] = seq.map((m, i) => ({ f: midiHz(m), t: i * 0.05, d: i === seq.length - 1 ? 0.4 : 0.045 }));
      playData(k, o, t, genChip(k.rng, notes, 0.8, (f) => 3500 + 9000 * f, (f) => 3 + 4 * f, 'square'), 0.5, 8000);
      bell(k, o, t + 0.25, midiHz(86), 0.3, 0.18, 2, 1);
      bell(k, o, t + 0.25, midiHz(74), 0.2, 0.22, 2, 0.8);
    },
  },
  hack_revert: {
    dur: 1.0, gain: 0.45, minMs: 150, maxVoices: 2, priority: 3, pitchVar: 0.01,
    render(k) {
      const t = k.t, o = k.out;
      const seq = [86, 82, 77, 74, 70, 65, 62];
      const notes: ChipNote[] = seq.map((m, i) => ({ f: midiHz(m), t: i * 0.055, d: i === seq.length - 1 ? 0.3 : 0.05 }));
      playData(k, o, t, genChip(k.rng, notes, 0.8, (f) => 9000 * (1 - f) + 600, (f) => 5 - 3 * f, 'saw'), 0.5, 6000);
      const g = k.vca(o);
      ahr(g.gain, t + 0.3, 0.12, 0.02, 0.2, 0.3);
      const so = k.osc('square', 600, t + 0.3, t + 0.85, k.filter('lowpass', 1500, 2, g));
      glide(so.frequency, t + 0.3, 600, 60, 0.5);
    },
  },
  emp: {
    dur: 1.9, gain: 0.65, minMs: 300, maxVoices: 2, priority: 2,
    render(k) {
      const t = k.t, o = k.out, d = k.shaper(softClip(2), o);
      thump(k, d, t, 140, 38, 0.35, 1.0, 0.25);
      zap(k, o, t, 0.9, 2800, 50, 0.9);
      const sg = k.vca(o);
      perc(sg.gain, t, 0.6, 0.01, 0.25);
      const sb = k.filter('bandpass', 3000, 0.8, sg);
      glide(sb.frequency, t, 4000, 300, 1.2);
      k.noise('pink', t, t + 1.8, sb);
      const wg = k.vca(o);
      ahr(wg.gain, t + 0.05, 0.2, 0.02, 0.4, 1.0);
      const wo = k.osc('sine', 3500, t + 0.05, t + 1.7, wg);
      glide(wo.frequency, t + 0.05, 3500, 90, 1.5);
      const wo2 = k.osc('triangle', 1750, t + 0.05, t + 1.7, k.vca(wg, 0.5));
      glide(wo2.frequency, t + 0.05, 1750, 45, 1.5);
    },
  },
  orbital_warn: {
    dur: 1.5, gain: 0.5, minMs: 800, maxVoices: 2, priority: 4, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out;
      for (const dt of [0, 0.2, 0.36, 0.48, 0.57]) {
        const g = k.vca(o);
        ahr(g.gain, t + dt, 0.35, 0.002, 0.05, 0.015);
        k.osc('square', 2350, t + dt, t + dt + 0.08, k.filter('bandpass', 2400, 3, g));
        k.osc('sine', 1175, t + dt, t + dt + 0.08, g);
      }
      const tl = t + 0.66, te = t + 1.45;
      const lg = k.vca(o);
      ahr(lg.gain, tl, 0.3, 0.01, 0.6, 0.15);
      const trem = k.vca(lg, 0.6);
      k.osc('square', 16, tl, te, k.vca(trem.gain, 0.4));
      k.osc('sine', 2350, tl, te, trem);
      k.osc('sawtooth', 1175, tl, te, k.filter('lowpass', 2000, 1, k.vca(trem, 0.3)));
      const sw = k.vca(o);
      ahr(sw.gain, t, 0.25, 0.8, 0.4, 0.25);
      k.osc('sawtooth', 73.42, t, t + 1.5, k.filter('lowpass', 300, 2, sw));
    },
  },
  orbital_strike: {
    dur: 4.2, stereo: true, gain: 0.9, minMs: 500, maxVoices: 2, priority: 3, pitchVar: 0.02,
    render(k) {
      const t = k.t, o = k.out;
      tone(k, o, t, 'sawtooth', 5200, 400, 0.12, 0.35, 0.002, 0.04);
      const bg = k.vca(o);
      ahr(bg.gain, t, 0.5, 0.01, 0.1, 0.03);
      k.noise('white', t, t + 0.2, k.filter('highpass', 3000, 0.7, bg));
      const ti = t + 0.11;
      explosion(k, o, ti, 1.6);
      zap(k, o, ti, 1.2, 2200, 45, 0.7);
      thump(k, o, ti, 60, 20, 0.6, 0.9, 0.5);
      for (const p of [-0.8, 0.8]) {
        const cg = k.vca(k.pan(p, o));
        ahr(cg.gain, ti + 0.1, 0.35, 0.1, 1.2, 2.0);
        k.data(genCrackle(k.rng, 3.4, 700, 40), ti + 0.1, k.filter('bandpass', 2200, 0.6, cg));
      }
      const rg = k.vca(o);
      ahr(rg.gain, ti, 0.5, 0.2, 1.2, 2.2);
      k.noise('brown', ti, ti + 3.8, k.filter('lowpass', 180, 0.8, rg));
    },
  },
  supply_drop: {
    dur: 1.3, gain: 0.55, minMs: 300, maxVoices: 2, priority: 2,
    render(k) {
      const t = k.t, o = k.out;
      const wg = k.vca(o);
      wg.gain.setValueAtTime(0, t);
      wg.gain.linearRampToValueAtTime(0.4, t + 0.2);
      wg.gain.linearRampToValueAtTime(0, t + 0.26);
      const wf = k.filter('bandpass', 2000, 1.5, wg);
      glide(wf.frequency, t, 2500, 500, 0.26);
      k.noise('pink', t, t + 0.3, wf);
      const tl = t + 0.25;
      thump(k, o, tl, 130, 45, 0.08, 0.9, 0.08);
      burst(k, o, tl, 'brown', 'lowpass', 700, 0.7, 0.7, 0.002, 0.07);
      ring(k, o, tl, 280, METAL, 0.35, 0.2);
      burst(k, o, tl, 'white', 'highpass', 2000, 0.7, 0.4, 0.0004, 0.01);
      bell(k, o, tl + 0.22, midiHz(81), 0.18, 0.18, 2, 1);
      bell(k, o, tl + 0.32, midiHz(86), 0.18, 0.25, 2, 1);
    },
  },

  // ------------------------------------------------------ build & econ ---
  build_place: {
    dur: 0.45, variants: 2, gain: 0.45, minMs: 80, maxVoices: 3,
    render(k) {
      const t = k.t, o = k.out;
      thump(k, o, t, 160, 70, 0.05, 0.8, 0.045);
      burst(k, o, t, 'pink', 'lowpass', 1300, 0.7, 0.6, 0.001, 0.03);
      ring(k, o, t + 0.005, k.r(500, 650), METAL, 0.25, 0.07);
      burst(k, o, t + 0.07, 'white', 'bandpass', 3500, 3, 0.25, 0.0004, 0.005);
    },
  },
  build_done: {
    dur: 1.3, gain: 0.32, minMs: 200, maxVoices: 2, priority: 4, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out;
      [74, 81, 86].forEach((m, i) => bell(k, o, t + i * 0.09, midiHz(m), 0.35, 0.28, 2, 1.2));
      const g = k.vca(o);
      ahr(g.gain, t, 0.08, 0.05, 0.3, 0.6);
      k.osc('triangle', midiHz(62), t, t + 1.0, g);
      k.osc('triangle', midiHz(69), t, t + 1.0, g);
    },
  },
  unit_ready: {
    dur: 0.45, gain: 0.35, minMs: 150, maxVoices: 2, priority: 4, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out;
      burst(k, o, t, 'white', 'bandpass', 2000, 1, 0.15, 0.001, 0.01);
      for (const [f, dt] of [[880, 0.02], [1318.5, 0.11]]) {
        const g = k.vca(o);
        ahr(g.gain, t + dt, 0.4, 0.004, 0.07, 0.04);
        k.osc('square', f, t + dt, t + dt + 0.13, k.filter('bandpass', 1600, 0.8, g));
        k.osc('sine', f, t + dt, t + dt + 0.13, g);
      }
    },
  },
  research_done: {
    dur: 1.6, gain: 0.32, minMs: 300, maxVoices: 1, priority: 4, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out;
      [74, 78, 81, 86].forEach((m, i) => bell(k, o, t + i * 0.08, midiHz(m), 0.3, 0.35, 2, 1.5));
      const g = k.vca(o);
      ahr(g.gain, t + 0.24, 0.06, 0.05, 0.3, 0.8);
      k.osc('sine', midiHz(98), t + 0.24, t + 1.5, g);
      k.osc('sine', midiHz(98) * 1.004, t + 0.24, t + 1.5, g);
    },
  },
  harvest: {
    dur: 0.3, variants: 3, gain: 0.22, minMs: 70, maxVoices: 3, pitchVar: 0.08,
    render(k) {
      const t = k.t, o = k.out;
      ring(k, o, t, k.r(1800, 2600), [1, 2.756, 5.404], 0.4, 0.03);
      ring(k, o, t + k.r(0.04, 0.07), k.r(1500, 2200), [1, 2.756], 0.3, 0.025);
      burst(k, o, t, 'white', 'bandpass', 3000, 1.5, 0.3, 0.001, 0.015);
    },
  },
  deposit: {
    dur: 0.5, gain: 0.3, minMs: 90, maxVoices: 2, priority: 2, pitchVar: 0.02,
    render(k) {
      const t = k.t, o = k.out;
      thump(k, o, t, 180, 90, 0.04, 0.6, 0.04);
      burst(k, o, t, 'pink', 'lowpass', 1200, 0.7, 0.4, 0.001, 0.03);
      ring(k, o, t, 900, METAL, 0.2, 0.06);
      tone(k, o, t + 0.07, 'sine', 1318.5, 1318.5, 0, 0.25, 0.002, 0.05);
      tone(k, o, t + 0.13, 'sine', 1760, 1760, 0, 0.25, 0.002, 0.08);
    },
  },
  repair: {
    dur: 0.45, variants: 2, gain: 0.3, minMs: 120, maxVoices: 2,
    render(k) {
      const t = k.t, o = k.out;
      for (let i = 0; i < 4; i++) {
        const tt = t + i * 0.065;
        burst(k, o, tt, 'white', 'bandpass', k.r(2200, 3000), 3, 0.6, 0.0004, 0.005);
        ring(k, o, tt, k.r(1100, 1400), [1, 2.756], 0.15, 0.02);
      }
      zap(k, o, t + 0.1, 0.2, 4500, 200, 0.25);
    },
  },

  // --------------------------------------------------------------- UI ---
  ui_click: {
    dur: 0.08, gain: 0.2, minMs: 30, maxVoices: 2, priority: 10, pitchVar: 0.02,
    render(k) {
      tone(k, k.out, k.t, 'sine', 1150, 750, 0.02, 0.6, 0.0008, 0.01);
      burst(k, k.out, k.t, 'white', 'bandpass', 3500, 2, 0.25, 0.0003, 0.002);
    },
  },
  ui_hover: {
    dur: 0.06, gain: 0.07, minMs: 45, maxVoices: 1, priority: 10, pitchVar: 0.02,
    render(k) { tone(k, k.out, k.t, 'sine', 2100, 1900, 0.02, 0.5, 0.002, 0.008); },
  },
  ui_error: {
    dur: 0.32, gain: 0.26, minMs: 150, maxVoices: 1, priority: 10, pitchVar: 0,
    render(k) {
      for (const dt of [0, 0.12]) {
        const t = k.t + dt;
        const g = k.vca(k.out);
        ahr(g.gain, t, 0.5, 0.004, 0.07, 0.02);
        const lp = k.filter('lowpass', 1000, 1, g);
        k.osc('square', 146.8, t, t + 0.1, lp);
        k.osc('square', 155.6, t, t + 0.1, lp);
      }
    },
  },
  ui_select: {
    dur: 0.16, gain: 0.21, minMs: 40, maxVoices: 2, priority: 10, pitchVar: 0.01,
    render(k) {
      tone(k, k.out, k.t, 'triangle', 880, 880, 0, 0.5, 0.002, 0.02);
      tone(k, k.out, k.t + 0.04, 'triangle', 1318.5, 1318.5, 0, 0.5, 0.002, 0.03);
    },
  },
  ui_command: {
    dur: 0.16, gain: 0.22, minMs: 40, maxVoices: 2, priority: 10, pitchVar: 0.01,
    render(k) {
      tone(k, k.out, k.t, 'triangle', 1174.7, 1174.7, 0, 0.45, 0.002, 0.015);
      tone(k, k.out, k.t + 0.035, 'triangle', 880, 880, 0, 0.45, 0.002, 0.025);
      burst(k, k.out, k.t, 'white', 'bandpass', 4000, 2, 0.12, 0.0003, 0.002);
    },
  },
  ui_open: {
    dur: 0.3, gain: 0.16, minMs: 60, maxVoices: 1, priority: 10, pitchVar: 0,
    render(k) {
      const t = k.t, g = k.vca(k.out);
      ahr(g.gain, t, 0.3, 0.09, 0.02, 0.08);
      const bp = k.filter('bandpass', 600, 1.5, g);
      glide(bp.frequency, t, 500, 2600, 0.15);
      k.noise('pink', t, t + 0.25, bp);
      tone(k, k.out, t + 0.07, 'sine', 1318.5, 1318.5, 0, 0.35, 0.002, 0.04);
    },
  },

  // --------------------------------------------------- alerts & stingers ---
  surge_siren: {
    dur: 3.0, stereo: true, gain: 0.55, minMs: 2000, maxVoices: 1, priority: 8, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out, end = t + 2.95;
      const g = k.vca(o);
      ahr(g.gain, t, 0.6, 0.15, 2.3, 0.45);
      const lp = k.filter('lowpass', 1200, 5, g);
      const d = k.shaper(softClip(2), lp);
      const contour = (p: AudioParam, base: number): void => {
        p.setValueAtTime(base, t);
        for (let c = 0; c < 2; c++) {
          const c0 = t + c * 1.4;
          p.linearRampToValueAtTime(base * 2, c0 + 0.8);
          p.linearRampToValueAtTime(base, c0 + 1.4);
        }
      };
      const layers: Array<[number, number, OscillatorType, number]> = [
        [1, -0.5, 'sawtooth', -8], [1, 0.5, 'sawtooth', 8], [1.414, 0, 'square', 0], [0.5, 0, 'sawtooth', 0],
      ];
      for (const [mult, p, type, det] of layers) {
        const os = k.osc(type, 220 * mult, t, end, k.pan(p, d), det);
        contour(os.frequency, 220 * mult);
      }
      contour(lp.frequency, 900);
      const sg = k.vca(o);
      ahr(sg.gain, t, 0.4, 0.2, 2.2, 0.5);
      k.osc('sine', 55, t, end, sg);
    },
  },
  alert: {
    dur: 0.6, gain: 0.32, minMs: 400, maxVoices: 2, priority: 8, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out;
      bell(k, o, t, 1318.5, 0.4, 0.12, 2, 0.8);
      bell(k, o, t + 0.12, 987.8, 0.4, 0.18, 2, 0.8);
      for (const [f, dt] of [[1318.5, 0], [987.8, 0.12]]) {
        const g = k.vca(o);
        ahr(g.gain, t + dt, 0.12, 0.003, 0.06, 0.05);
        k.osc('square', f, t + dt, t + dt + 0.12, k.filter('lowpass', 2500, 1, g));
      }
    },
  },
  alert_attack: {
    dur: 0.8, gain: 0.42, minMs: 1200, maxVoices: 1, priority: 8, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out;
      const fs = [1046.5, 880, 1046.5, 880];
      fs.forEach((f, i) => {
        const tt = t + i * 0.13;
        const g = k.vca(o);
        ahr(g.gain, tt, 0.45, 0.003, 0.08, 0.02);
        const bp = k.filter('bandpass', 1500, 1, g);
        k.osc('square', f, tt, tt + 0.11, bp);
        k.osc('sawtooth', f / 2, tt, tt + 0.11, bp);
      });
      const bg = k.vca(o);
      ahr(bg.gain, t, 0.15, 0.01, 0.5, 0.1);
      k.osc('sawtooth', 110, t, t + 0.65, k.filter('lowpass', 600, 2, bg));
    },
  },
  epoch: {
    dur: 2.8, stereo: true, gain: 0.55, minMs: 2000, maxVoices: 1, priority: 8, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out;
      const blips: ChipNote[] = [];
      for (let i = 0; i < 10; i++) blips.push({ f: midiHz(86 + k.pick([0, 3, 7, 10, 12])), t: i * 0.028, d: 0.022, v: 0.7 });
      playData(k, o, t, genChip(k.rng, blips, 0.32, 8000, 4, 'square'), 0.35, 8000);
      const tc = t + 0.3;
      const chord = [62, 69, 76, 77, 84];
      chord.forEach((m, i) => {
        const f = midiHz(m);
        const g = k.vca(k.pan((i / (chord.length - 1)) * 1.2 - 0.6, o));
        ahd(g.gain, tc, 0.22, 0.01, 0.35, 0.5);
        k.osc('sine', f, tc, tc + 2.4, g, k.r(-4, 4));
        k.osc('triangle', f * 2.001, tc, tc + 2.4, k.vca(g, 0.25));
      });
      const cn = chord.map((m) => ({ f: midiHz(m), t: 0, d: 1.6, v: 0.25 }));
      const cr = k.vca(o, 0.25);
      k.data(genChip(k.rng, cn, 1.7, 3000, 3, 'tri'), tc, k.filter('bandpass', 1500, 0.6, cr));
      const sg = k.vca(o);
      ahd(sg.gain, tc, 0.35, 0.05, 0.5, 0.45);
      k.osc('sine', midiHz(38), tc, tc + 2.3, sg);
      for (let i = 0; i < 14; i++) {
        const tt = tc + k.r(0.05, 1.8);
        tone(k, k.pan(k.r(-0.9, 0.9), o), tt, 'sine', k.r(3000, 6500), k.r(3000, 6500), 0.01, 0.06, 0.001, 0.01);
      }
    },
  },
  forgetting: {
    dur: 2.4, stereo: true, gain: 0.55, minMs: 2000, maxVoices: 1, priority: 8, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out, sr = BANK_RATE, secs = 2.2;
      const chord = [62, 69, 76, 77, 84].map(midiHz);
      for (const p of [-0.5, 0.5]) {
        const n = Math.ceil(secs * sr);
        const out = new Float32Array(n);
        const ph = chord.map(() => k.rng());
        let held = 0, acc = 1, gate = 1, nextGate = 0;
        for (let i = 0; i < n; i++) {
          const f = i / n;
          const bend = Math.pow(2, -f * 1.1);
          let s = 0;
          for (let j = 0; j < chord.length; j++) {
            ph[j] += (chord[j] * bend) / sr;
            ph[j] -= Math.floor(ph[j]);
            s += 1 - 4 * Math.abs(ph[j] - 0.5);
          }
          s /= chord.length;
          if (i >= nextGate) {
            nextGate = i + (0.01 + 0.05 * k.rng()) * sr;
            gate = k.rng() < f * 0.7 ? 0 : 1;
          }
          const env = Math.min(1, i / (0.02 * sr)) * Math.pow(1 - f, 1.2);
          acc += (8000 * (1 - f) + 400) / sr;
          if (acc >= 1) {
            acc -= Math.floor(acc);
            const q = Math.pow(2, 6 - 4 * f);
            held = Math.round(clamp(s * env * gate, -1, 1) * q) / q;
          }
          out[i] = held;
        }
        const g = k.vca(k.pan(p, o), 0.5);
        const lp = k.filter('lowpass', 6000, 1, g);
        glide(lp.frequency, t, 6000, 500, secs);
        k.data(out, t, lp);
      }
      const sg = k.vca(o);
      ahr(sg.gain, t, 0.3, 0.05, 0.6, 1.4);
      const so = k.osc('sine', midiHz(50), t, t + 2.2, sg);
      glide(so.frequency, t, midiHz(50), midiHz(38), 2.0);
    },
  },
  victory: {
    dur: 3.4, stereo: true, gain: 0.6, minMs: 3000, maxVoices: 1, priority: 9, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out;
      const chords = [[58, 62, 65, 70], [60, 64, 67, 72], [62, 66, 69, 74, 78]];
      const times = [0, 0.32, 0.64];
      const holds = [0.2, 0.2, 1.9];
      chords.forEach((ch, i) => {
        const tt = t + times[i];
        brass(k, o, tt, ch, holds[i], i === 2 ? 0.9 : 0.6);
        thump(k, o, tt, midiHz(ch[0] - 12) * 1.5, midiHz(ch[0] - 12), 0.05, 0.5, 0.12);
      });
      const cg = k.vca(o);
      ahr(cg.gain, t + 0.64, 0.22, 0.01, 0.1, 1.8);
      k.noise('white', t + 0.64, t + 3.0, k.filter('highpass', 6000, 0.7, cg));
    },
  },
  defeat: {
    dur: 3.8, stereo: true, gain: 0.6, minMs: 3000, maxVoices: 1, priority: 9, pitchVar: 0,
    render(k) {
      const t = k.t, o = k.out;
      thump(k, o, t, 70, 30, 0.4, 0.8, 0.4);
      brass(k, o, t, [50, 53, 57], 0.85, 0.5, 1800);
      brass(k, o, t + 1.0, [46, 49, 53], 0.85, 0.45, 1500);
      brass(k, o, t + 2.0, [38, 45, 50], 1.1, 0.5, 1000);
      [69, 65, 62].forEach((m, i) => {
        const tt = t + i * 1.0;
        const g = k.vca(o);
        ahd(g.gain, tt, 0.12, 0.08, 0.6, 0.3);
        const lo = k.osc('triangle', midiHz(m), tt, tt + 1.6, g);
        k.osc('sine', 5, tt, tt + 1.6, k.vca(lo.detune, 12));
      });
    },
  },
  radio: {
    dur: 0.4, variants: 2, gain: 0.28, minMs: 250, maxVoices: 1, priority: 6, pitchVar: 0.02,
    render(k) {
      const t = k.t, o = k.out;
      tone(k, o, t, 'sine', 2400, 1200, 0.035, 0.4, 0.001, 0.015);
      const g = k.vca(o);
      ahr(g.gain, t + 0.02, 0.5, 0.005, 0.2, 0.04);
      const am = k.vca(g, 0);
      k.data(genSteps(k.rng, 0.3, 5, 25, 0.2, 1.0), t + 0.02, am.gain);
      k.noise('white', t + 0.02, t + 0.3, k.filter('bandpass', 1800, 1.5, am));
      burst(k, o, t + 0.27, 'white', 'highpass', 1500, 0.7, 0.4, 0.001, 0.01);
      tone(k, o, t + 0.27, 'sine', 1600, 900, 0.02, 0.2, 0.001, 0.01);
    },
  },
};

// -------------------------------------------------- music drum samples ---
// Internal (not SfxName): rendered into the same bank, used by music.ts.

export const DRUMS: Record<string, SfxDef> = {
  _kick: {
    dur: 0.5, gain: 1, minMs: 0, maxVoices: 99,
    render(k) {
      const d = k.shaper(softClip(2), k.out);
      thump(k, d, k.t, 160, 42, 0.07, 1.0, 0.09);
      thump(k, d, k.t, 60, 40, 0.1, 0.4, 0.14);
      burst(k, d, k.t, 'white', 'highpass', 3000, 0.7, 0.25, 0.0003, 0.003);
    },
  },
  _snare: {
    dur: 0.45, gain: 1, minMs: 0, maxVoices: 99,
    render(k) {
      const t = k.t, d = k.shaper(softClip(2.5), k.out);
      burst(k, d, t, 'white', 'bandpass', 1900, 0.7, 1.0, 0.001, 0.06);
      burst(k, d, t, 'white', 'highpass', 5000, 0.7, 0.5, 0.001, 0.04);
      tone(k, d, t, 'triangle', 200, 170, 0.05, 0.7, 0.001, 0.04);
      ring(k, k.out, t, 410, METAL, 0.12, 0.05);
    },
  },
  _hat: {
    dur: 0.1, variants: 2, gain: 1, minMs: 0, maxVoices: 99,
    render(k) {
      burst(k, k.out, k.t, 'white', 'highpass', 7000, 0.7, 1.0, 0.0003, 0.012);
      burst(k, k.out, k.t, 'white', 'bandpass', 10000, 1, 0.5, 0.0003, 0.008);
    },
  },
  _ohat: {
    dur: 0.4, gain: 1, minMs: 0, maxVoices: 99,
    render(k) {
      burst(k, k.out, k.t, 'white', 'highpass', 6500, 0.7, 1.0, 0.002, 0.07);
      ring(k, k.out, k.t, 3100, METAL, 0.08, 0.06);
    },
  },
  _glitch: {
    dur: 0.15, variants: 3, gain: 1, minMs: 0, maxVoices: 99,
    render(k) {
      const notes: ChipNote[] = [];
      for (let i = 0; i < 4; i++) notes.push({ f: k.r(300, 3000), t: i * 0.022, d: 0.02, v: 0.8 });
      playData(k, k.out, k.t, genChip(k.rng, notes, 0.12, k.r(1500, 4000), 3, k.pick(['square', 'saw'] as const)), 0.8, 9000);
    },
  },
  _metal: {
    dur: 0.6, variants: 2, gain: 1, minMs: 0, maxVoices: 99,
    render(k) {
      const d = k.shaper(softClip(3), k.out);
      ring(k, d, k.t, k.r(260, 340), METAL, 0.6, 0.12);
      burst(k, d, k.t, 'white', 'bandpass', 2200, 1.5, 0.6, 0.0005, 0.02);
      thump(k, d, k.t, 140, 70, 0.04, 0.3, 0.04);
    },
  },
  _boom: {
    dur: 2.2, gain: 1, minMs: 0, maxVoices: 99,
    render(k) {
      thump(k, k.out, k.t, 55, 28, 0.6, 1.0, 0.45);
      burst(k, k.out, k.t, 'brown', 'lowpass', 220, 0.7, 0.6, 0.01, 0.4);
    },
  },
};

export const ALL_DEFS: Record<string, SfxDef> = { ...SFX, ...DRUMS };

/** Render order: what's needed first (UI, common combat) renders first. */
export const RENDER_ORDER: readonly string[] = [
  'ui_click', 'ui_hover', 'ui_select', 'ui_command', 'ui_error', 'ui_open',
  'rifle', 'bullet_hit', 'robot_shot', 'skitter_bite', 'explosion_small', 'robot_die', 'human_die',
  'mg_turret', 'impact_metal', 'zap_small', 'arc', 'rail', 'rocket_launch', 'cannon',
  '_kick', '_snare', '_hat', '_ohat', '_glitch', '_metal', '_boom',
  ...Object.keys(SFX),
].filter((n, i, a) => a.indexOf(n) === i);
