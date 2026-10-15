// Usage: node tools/audio-check.mjs [url=http://localhost:5182/audio.html]
// Needs a running dev server:  npx vite --port 5182 --strictPort
//
// Verifies the synthesized audio engine without speakers:
//  1. every SFX (and internal music drum) renders offline: no exceptions,
//     non-silent (RMS > 0.005), no clipping (peak ≤ 1.0), no NaN, sane duration
//  2. master chain: unity gain for quiet input, hard ceiling ≤ 1.0 for hot input
//  3. offline full-engine mixes: 300-sound burst + dense battle stay ≤ 1.0, voice cap holds
//  4. offline music renders at several intensities (layers audibly add energy)
//  5. live AudioContext: 300 burst plays don't throw; game music scheduler runs 5 s cleanly
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5182/audio.html';
const failures = [];
const fail = (msg) => { failures.push(msg); };

const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') pageErrors.push(`console.${m.type()}: ${m.text()}`); });

try {
  await page.goto(url, { waitUntil: 'load' });
} catch (e) {
  console.error(`Could not load ${url} — is the dev server running? (npx vite --port 5182 --strictPort)\n${e.message}`);
  await browser.close();
  process.exit(2);
}
await page.waitForTimeout(1000); // let any Vite dev reload settle
await page.waitForFunction(() => !!window.__audioTest, null, { timeout: 20000 });

// ------------------------------------------------------------------ 1. SFX
const t0 = Date.now();
const sfx = await page.evaluate(async () => {
  const T = window.__audioTest;
  const rows = [];
  for (const name of T.ALL_SOUND_IDS) {
    const meta = T.sfxMeta(name);
    const row = { name, ch: meta.channels, variants: meta.variants, maxDur: meta.maxDur, dur: 0, minDur: Infinity, rms: Infinity, peak: 0, rawPeak: 0, nan: false, err: null };
    try {
      for (let v = 0; v < meta.variants; v++) {
        const info = { rawPeak: 0, norm: 1 };
        const d = await T.renderSfxOffline(name, v, info);
        let pk = 0, acc = 0;
        for (let i = 0; i < d.length; i++) {
          const x = d[i];
          if (!Number.isFinite(x)) { row.nan = true; continue; }
          acc += x * x;
          const a = Math.abs(x);
          if (a > pk) pk = a;
        }
        const dur = d.length / meta.channels / meta.sampleRate;
        row.dur = Math.max(row.dur, dur);
        row.minDur = Math.min(row.minDur, dur);
        row.rms = Math.min(row.rms, Math.sqrt(acc / Math.max(1, d.length)));
        row.peak = Math.max(row.peak, pk);
        row.rawPeak = Math.max(row.rawPeak, info.rawPeak);
      }
    } catch (e) {
      row.err = String(e && e.stack ? e.stack : e);
    }
    rows.push(row);
  }
  return rows;
});
const sfxMs = Date.now() - t0;

// in-mix loudness of each public SFX played alone (non-positional, default volumes)
const loud = await page.evaluate(async () => {
  const T = window.__audioTest;
  const out = {};
  for (const name of T.SFX_NAMES) {
    const meta = T.sfxMeta(name);
    // start at 0.5 s: Chrome's compressors begin in gain reduction for ~0.3 s after context creation
    const m = await T.renderMixOffline({ seconds: Math.min(5, meta.maxDur + 0.8), plays: [{ at: 0.5, name }] });
    out[name] = { peak: m.peak, lufs: Math.max(...m.windowLufs), errors: m.errors, played: m.played };
  }
  return out;
});
for (const [k, v] of Object.entries(loud)) {
  if (v.errors) fail(`${k}: ${v.errors} errors in mix render`);
  if (v.played !== 1) fail(`${k}: not played in mix render`);
  if (!(v.peak <= 1.0)) fail(`${k}: in-mix peak ${v.peak}`);
}

for (const r of sfx) {
  if (r.err) fail(`${r.name}: exception ${r.err}`);
  if (r.nan) fail(`${r.name}: NaN/Inf samples`);
  if (!(r.rms > 0.005)) fail(`${r.name}: too quiet / silent (rms ${r.rms})`);
  if (!(r.peak <= 1.0)) fail(`${r.name}: clipping (peak ${r.peak})`);
  if (!(r.minDur >= 0.02 && r.dur <= r.maxDur + 0.01)) fail(`${r.name}: odd duration ${r.minDur}..${r.dur} (max ${r.maxDur})`);
}

// ------------------------------------------------------------- 2. chain
const chain = await page.evaluate(async () => {
  const T = window.__audioTest;
  return {
    quiet: await T.measureChain(0.05),
    mid: await T.measureChain(0.3),
    hot: await T.measureChain(1.5),
    insane: await T.measureChain(8),
  };
});
if (!(chain.quiet.gain > 0.8 && chain.quiet.gain < 1.25)) fail(`chain: quiet-signal gain ${chain.quiet.gain.toFixed(3)} not ≈ 1`);
for (const k of ['quiet', 'mid', 'hot', 'insane']) if (!(chain[k].outPeak <= 1.0)) fail(`chain: ${k} output peak ${chain[k].outPeak}`);

// --------------------------------------------------------- 3. offline mixes
const mixes = await page.evaluate(async () => {
  const T = window.__audioTest;
  const battle = [];
  const heavy = ['rifle', 'mg_turret', 'explosion_big', 'explosion_small', 'cannon', 'robot_shot', 'skitter_bite', 'robot_die', 'bullet_hit', 'tesla', 'explosion_huge', 'artillery_fire'];
  for (let i = 0; i < 900; i++) {
    battle.push({ at: (i / 900) * 3, name: heavy[i % heavy.length], x: ((i * 7919) % 41) - 20, y: ((i * 104729) % 23) - 11, vol: 1 });
  }
  return {
    burst: await T.renderMixOffline({ seconds: 3, burst: { count: 300, over: 1, seed: 7 } }),
    battle: await T.renderMixOffline({ seconds: 4, plays: battle, music: 'game', intensity: 1 }),
  };
});
for (const [k, m] of Object.entries(mixes)) {
  if (m.errors) fail(`mix ${k}: ${m.errors} errors`);
  if (!(m.peak <= 1.0)) fail(`mix ${k}: peak ${m.peak}`);
  if (m.maxVoices > 48) fail(`mix ${k}: voice cap exceeded (${m.maxVoices})`);
  if (!(m.rms > 0.01)) fail(`mix ${k}: silent (rms ${m.rms})`);
}

// --------------------------------------------------------- 4. offline music
const music = await page.evaluate(async () => {
  const T = window.__audioTest;
  const out = {};
  for (const i of [0, 0.4, 0.6, 0.9]) out['game@' + i] = await T.renderMixOffline({ seconds: 8, music: 'game', intensity: i, musicSeed: 99 });
  out['menu'] = await T.renderMixOffline({ seconds: 10, music: 'menu', musicSeed: 99 });
  out['game long'] = await T.renderMixOffline({ seconds: 40, music: 'game', intensity: 0.7, musicSeed: 3 });
  out['game ramp+stingers'] = await T.renderMixOffline({
    seconds: 10, music: 'game', intensity: 0.2, musicSeed: 5,
    intensityAt: [[2, 0.55], [4, 0.95], [8, 0.1]], stingerAt: [[3, 'surge'], [6, 'epoch'], [9, 'victory']],
  });
  return out;
});
const avg = (a, from = 2) => { const s = a.slice(from); return s.reduce((x, y) => x + y, 0) / Math.max(1, s.length); };
for (const [k, m] of Object.entries(music)) {
  if (m.errors) fail(`music ${k}: ${m.errors} errors`);
  if (!(m.peak <= 1.0)) fail(`music ${k}: peak ${m.peak}`);
  if (!(avg(m.windowRms) > 0.01)) fail(`music ${k}: silent`);
  if (m.musicSteps < 20) fail(`music ${k}: scheduler ran only ${m.musicSteps} steps`);
}
const L = (k) => music[k].lufs;
if (!(L('game@0.4') > L('game@0') + 2)) fail(`music: bass layer adds < 2 dB (${L('game@0').toFixed(1)} → ${L('game@0.4').toFixed(1)} LUFS)`);
if (!(L('game@0.6') > L('game@0.4') + 1)) fail(`music: drum layer adds < 1 dB (${L('game@0.4').toFixed(1)} → ${L('game@0.6').toFixed(1)} LUFS)`);
if (!(L('game@0.9') > L('game@0.6') + 0.5)) fail(`music: lead layer adds < 0.5 dB (${L('game@0.6').toFixed(1)} → ${L('game@0.9').toFixed(1)} LUFS)`);
if (music['game long'].musicSections < 3) fail(`music: progression changed only ${music['game long'].musicSections - 1} times in 40 s`);

// ------------------------------------------------------------- 5. live
await page.mouse.click(5, 5); // real user gesture → audio.init()
const live0 = await page.evaluate(async () => {
  const T = window.__audioTest;
  await T.start();
  return T.audio._debug();
});
if (live0.state !== 'running') fail(`live: AudioContext state ${live0.state}`);
const liveBurst = await page.evaluate(async () => window.__audioTest.burst(300, 1000));
if (liveBurst.thrown) fail(`live burst: ${liveBurst.thrown} exceptions`);
if (liveBurst.peakVoices > 48) fail(`live burst: voice cap exceeded (${liveBurst.peakVoices})`);

await page.click('button[data-music="game"]');
await page.evaluate(() => {
  const el = document.getElementById('intensity');
  el.value = '1';
  el.dispatchEvent(new Event('input'));
});
const liveA = await page.evaluate(() => ({ dbg: window.__audioTest.audio._debug(), ms: { ...window.__audioTest.audio.musicStats } }));
await page.waitForTimeout(5000);
const liveB = await page.evaluate(() => {
  const T = window.__audioTest;
  const a = T.audio._tapOutput();
  return new Promise((res) => setTimeout(() => {
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let acc = 0, pk = 0;
    for (const v of buf) { acc += v * v; pk = Math.max(pk, Math.abs(v)); }
    res({ dbg: T.audio._debug(), ms: { ...T.audio.musicStats }, outRms: Math.sqrt(acc / buf.length), outPeak: pk, stats: { ...T.audio.stats } });
  }, 300));
});
const liveSecs = liveB.dbg.time - liveA.dbg.time;
const liveSteps = liveB.ms.steps - liveA.ms.steps;
if (liveSecs < 4.5) fail(`live music: audio clock advanced only ${liveSecs.toFixed(2)} s`);
if (liveSteps < 28) fail(`live music: only ${liveSteps} steps scheduled in ${liveSecs.toFixed(2)} s`);
if (liveB.ms.errors) fail(`live music: ${liveB.ms.errors} scheduler errors (${liveB.ms.lastError})`);
if (liveB.stats.errors) fail(`live: ${liveB.stats.errors} play errors`);

await page.click('button[data-music="menu"]');
await page.waitForTimeout(1500);
await page.click('button[data-music="none"]');
await page.waitForTimeout(300);

for (const e of pageErrors) fail(e);
await browser.close();

// ------------------------------------------------------------------ report
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
console.log(`\nSFX offline renders (${sfx.length} sounds incl. music drums, ${sfxMs} ms; worst case over variants)`);
console.log('name                 var ch   dur(s)  maxDur   rms     peak   | in-mix: peak  LUFS(0.5s)');
for (const r of sfx) {
  const lm = loud[r.name];
  console.log(`${r.name.padEnd(20)} ${String(r.variants).padStart(3)} ${String(r.ch).padStart(2)}  ${f(r.dur).padStart(6)}  ${f(r.maxDur, 2).padStart(6)}  ${f(r.rms, 4)}  ${f(r.peak)}  |${lm ? `         ${f(lm.peak)}  ${f(lm.lufs, 1).padStart(6)}` : '         (internal music sample)'}`);
}
console.log('\nMaster chain (sine into UI bus, sfx=master=1):');
for (const [k, c] of Object.entries(chain)) console.log(`  ${k.padEnd(7)} in ${f(c.inAmp, 2).padStart(5)} → out peak ${f(c.outPeak)}  gain ${f(c.gain)}`);
console.log('\nOffline mixes:');
for (const [k, m] of Object.entries({ ...mixes, ...music })) {
  console.log(`  ${k.padEnd(20)} peak ${f(m.peak)} rms ${f(m.rms, 4)} LUFS ${f(m.lufs, 1)} maxVoices ${m.maxVoices} played ${m.played} dropped ${m.dropped} culled ${m.culled} stolen ${m.stolen} steps ${m.musicSteps} notes ${m.musicNotes} sections ${m.musicSections} errors ${m.errors} (${Math.round(m.renderMs)} ms)`);
  if ((k.startsWith('game') || k === 'menu') && k !== 'game long') console.log(`  ${''.padEnd(20)} LUFS/0.5s: ${m.windowLufs.map((x) => x.toFixed(0)).join(' ')}`);
}
console.log(`\nLive: ctx ${live0.state} @ ${live0.sampleRate} Hz, bank ${live0.bankSounds} sounds`);
console.log(`  burst: ${JSON.stringify(liveBurst)}`);
console.log(`  game music 5 s: clock +${f(liveSecs, 2)} s, steps +${liveSteps}, notes ${liveB.ms.notes}, sections ${liveB.ms.sections}, errors ${liveB.ms.errors}, out rms ${f(liveB.outRms, 4)} peak ${f(liveB.outPeak)}`);

if (failures.length) {
  console.log(`\nFAIL (${failures.length}):`);
  for (const m of failures) console.log('  - ' + m);
  process.exit(1);
}
console.log('\nPASS — all audio checks green');
