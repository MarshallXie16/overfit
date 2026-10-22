#!/usr/bin/env node
// sfx.mjs — synthesize UI sound effects from a cue list into a 48 kHz 16-bit mono WAV.
//
//   node scripts/sfx.mjs cues.json out/sfx.wav
//   cues.json: [{ "t": 0.5, "type": "click" }, { "t": 1.0, "type": "whoosh", "gain": 0.6 }, ...]
//
// Voices: click, pop, thump, whoosh, tick, rise. Add a voice by appending to VOICES:
// [length in seconds, fn(t) -> sample in -1..1]. Noise is seeded so the file is identical every run.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [cuesPath, outPath] = process.argv.slice(2);
if (!cuesPath || !outPath) { console.error('usage: node sfx.mjs cues.json out/sfx.wav'); process.exit(1); }
const cues = JSON.parse(readFileSync(cuesPath, 'utf8'));
if (!Array.isArray(cues) || cues.length === 0) { console.error('sfx.mjs: cues.json must be a non-empty array'); process.exit(1); }

const SR = 48000;
let s = 42; const noise = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2147483648 - 1;
const VOICES = {
  click:  [0.05, t => Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 90) * 0.5],
  tick:   [0.03, t => Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t * 160) * 0.35],
  pop:    [0.15, t => Math.sin(2 * Math.PI * (600 + 900 * t) * t) * Math.exp(-t * 30) * 0.4],
  thump:  [0.50, t => Math.sin(2 * Math.PI * (90 - 60 * t) * t) * Math.exp(-t * 9) * 0.9],
  whoosh: [0.35, t => noise() * Math.sin(Math.PI * Math.min(1, t / 0.35)) * 0.25],
  rise:   [0.40, t => Math.sin(2 * Math.PI * (300 + 1200 * t * t) * t) * Math.sin(Math.PI * t / 0.4) * 0.3],
};

const unknown = cues.filter(c => !VOICES[c.type]).map(c => c.type);
if (unknown.length) { console.error(`sfx.mjs: unknown voice(s): ${[...new Set(unknown)].join(', ')}. Known: ${Object.keys(VOICES).join(', ')}`); process.exit(1); }

const end = Math.max(...cues.map(c => c.t)) + 2;
const buf = new Float32Array(Math.ceil(end * SR));
for (const c of cues) {
  const [len, fn] = VOICES[c.type], start = Math.floor(c.t * SR), gain = c.gain ?? 1;
  for (let i = 0; i < len * SR && start + i < buf.length; i++) buf[start + i] += fn(i / SR) * gain;
}

const n = buf.length, b = Buffer.alloc(44 + n * 2);      // 16-bit mono WAV header + samples
b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
b.write('data', 36); b.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, b);
console.log(`wrote ${outPath}  ${cues.length} cues, ${end.toFixed(2)}s`);
