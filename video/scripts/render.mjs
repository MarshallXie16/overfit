#!/usr/bin/env node
// render.mjs — walk time, call window.seek(t) in headless Chromium, pipe PNG frames into ffmpeg.
//
//   node scripts/render.mjs [--page index.html] [--out out/silent.mp4] [--fps 60] [--dur 15] [--sub 4]
//                           [--width 1080] [--height 1920] [--from 0] [--crf 16] [--selector #c]
//
// fps / dur / width / height default to window.FILM = { fps, dur, w, h } when the page defines it.
// --sub N renders N subframes per output frame and averages them (ffmpeg tmix) for motion blur.
// --from S starts at second S (re-render only the seconds you changed, then splice).
// The page is opened as index.html?w=W&h=H so one timeline can lay itself out per format.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const num = (k, d) => { const v = opt(k, undefined); return v === undefined ? d : Number(v); };

const PAGE = resolve(opt('page', 'index.html'));
const OUT = opt('out', 'out/silent.mp4');
const SUB = Math.max(1, num('sub', 4));
const CRF = num('crf', 16);
const FROM = num('from', 0);
const SEL = opt('selector', '#c');

if (!existsSync(PAGE)) { console.error(`render.mjs: page not found: ${PAGE}`); process.exit(1); }
mkdirSync(dirname(resolve(OUT)), { recursive: true });

const browser = await chromium.launch();
let ff = null;
try {
  // Pass 1: read window.FILM so the viewport can match the film's own size.
  let page = await browser.newPage();
  await page.goto(pathToFileURL(PAGE).href);
  const film = await page.evaluate(() => JSON.parse(JSON.stringify(window.FILM || {})));
  await page.close();
  const FPS = num('fps', film.fps ?? 60);
  const DUR = num('dur', film.dur ?? 15);
  const W = num('width', film.w ?? 1080);
  const H = num('height', film.h ?? 1920);

  // Pass 2: the real page at the real size. deviceScaleFactor 1 so 1 CSS px = 1 output px.
  page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const url = new URL(pathToFileURL(PAGE).href);
  url.searchParams.set('w', String(W)); url.searchParams.set('h', String(H));
  await page.goto(url.href);
  // Canvas text needs loaded fonts, and canvas never triggers a font load by itself: the page lists the
  // faces it draws in window.ready (document.fonts.load(...)); we await that, then fonts.ready.
  await page.evaluate(() => (window.ready || Promise.resolve()).then(() => document.fonts.ready).then(() => true));
  const hasSeek = await page.evaluate(() => typeof window.seek === 'function');
  if (!hasSeek) throw new Error('page does not define window.seek(t); see references/engine.md');
  const el = await page.$(SEL);                 // the canvas when there is one, else the viewport
  const clip = el ? await el.boundingBox() : null;   // screenshot by clip: no per-frame element-stability wait

  // tmix averages SUB consecutive subframes; select keeps the last of each group; setpts renumbers.
  const vf = SUB > 1
    ? `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB`
    : `setpts=N/${FPS}/TB`;
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-i', '-',
    '-vf', vf, '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(CRF), '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((res, rej) => { ff.on('close', res); ff.on('error', rej); });

  const total = Math.round((DUR - FROM) * FPS * SUB);
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    const t = FROM + i / (FPS * SUB);
    await page.evaluate((t) => window.seek(t), t);
    const png = await page.screenshot({ type: 'png', ...(clip ? { clip } : {}) });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % (FPS * SUB) === 0) console.log(`rendered ${t.toFixed(1)}s / ${DUR}s`);
  }
  ff.stdin.end();
  const code = await ffDone;
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
  console.log(`wrote ${OUT}  ${W}x${H} ${FPS}fps ${DUR - FROM}s sub=${SUB}  in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} catch (e) {
  console.error('render.mjs:', e.message);
  process.exitCode = 1;
  try { ff.kill('SIGKILL'); } catch {}
} finally {
  await browser.close();
}
