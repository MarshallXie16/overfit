#!/usr/bin/env node
// score.mjs — a deterministic placeholder score on the beat grid: kick, hats, bass, pad.
//
//   node scripts/score.mjs --bpm 120 --dur 20 --key A --mode minor --out out/score.wav
//   (--dur derives the bar count from the film length; --bars N sets it directly)
//
// It is a bed to cut to while the film is being built, not a finished track. Extend PROG, the
// voices or the drum pattern, or replace it with a supplied track measured by beats.py. Because
// it is generated from the same BPM the film uses, `beats.py --bpm` gives the matching grid.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const BPM = Number(opt('bpm', 120)), KEY = opt('key', 'A');
const BARS = opt('dur') ? Math.ceil(Number(opt('dur')) * BPM / 240) : Number(opt('bars', 8));
const MODE = opt('mode', 'minor'), OUT = opt('out', 'out/score.wav');

const SR = 48000, beat = 60 / BPM, DUR = BARS * 4 * beat + 1.5;
const NOTES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const root = NOTES[KEY]; if (root === undefined) { console.error(`score.mjs: unknown key ${KEY}`); process.exit(1); }
const scale = MODE === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
const PROG = MODE === 'major' ? [0, 5, 3, 4] : [0, 5, 2, 6];        // I vi IV V  /  i VI III VII (scale degrees per bar)
const hz = (semi, oct) => 440 * Math.pow(2, (root + semi - 9) / 12 + (oct - 4));
let s = 7; const noise = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2147483648 - 1;

const buf = new Float32Array(Math.ceil(DUR * SR));
const add = (t0, len, fn) => { const st = Math.floor(t0 * SR); for (let i = 0; i < len * SR && st + i < buf.length; i++) buf[st + i] += fn(i / SR); };
const ad = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));

for (let bar = 0; bar < BARS; bar++) {
  const deg = PROG[bar % PROG.length];
  const tri = [0, 2, 4].map(k => scale[(deg + k) % 7] + 12 * Math.floor((deg + k) / 7));
  const tb = bar * 4 * beat, barLen = 4 * beat;
  add(tb, barLen, t => {                                              // pad: triad in two octaves, soft edges
    const a = Math.min(1, t / 0.25, (barLen - t) / 0.25);
    return tri.reduce((acc, n) => acc + Math.sin(2 * Math.PI * hz(n, 4) * t) + 0.4 * Math.sin(2 * Math.PI * hz(n, 5) * t), 0) / 7 * a * 0.16;
  });
  for (let b = 0; b < 4; b++) {
    const t0 = tb + b * beat;
    add(t0, 0.45, t => Math.sin(2 * Math.PI * (85 - 55 * Math.min(1, t * 4)) * t) * Math.exp(-t * 11) * 0.85);   // kick on every beat
    add(t0, beat * 0.9, t => Math.sin(2 * Math.PI * hz(tri[0], 2) * t) * ad(t, 0.01, 0.35) * 0.3);               // bass root
    for (let h = 0; h < 2; h++) add(t0 + h * beat / 2, 0.06, t => noise() * Math.exp(-t * 70) * (h ? 0.1 : 0.18)); // hats on 8ths
    if (b === 1 || b === 3) add(t0, 0.2, t => (noise() * 0.5 + Math.sin(2 * Math.PI * 190 * t) * 0.5) * Math.exp(-t * 18) * 0.5); // snare 2 & 4
  }
}
for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * 1.2) * 0.9;   // soft clip

const n = buf.length, b = Buffer.alloc(44 + n * 2);
b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
b.write('data', 36); b.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(buf[i] * 32767), 44 + i * 2);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, b);
console.log(`wrote ${OUT}  ${BPM} BPM, ${BARS} bars, ${KEY} ${MODE}, ${DUR.toFixed(2)}s`);
