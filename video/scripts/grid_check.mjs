#!/usr/bin/env node
// grid_check.mjs — the objective half of "sound sync": every SFX cue sits on a measured beat or onset,
// and every scene cut sits on a downbeat. Exit 1 when anything is off the grid.
//
//   node scripts/grid_check.mjs beats.json [cues.json] [--page index.html] [--tol 0.04]
//
// Scene cuts are read from window.FILM.cuts when --page is given (the template publishes them as
// SCENES.map(s => s.from)). Tolerance 40 ms = about two frames at 60 fps.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2), pos = [];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { i++; continue; } pos.push(argv[i]); }
const [beatsPath, cuesPath] = pos;
if (!beatsPath) { console.error('usage: node grid_check.mjs beats.json [cues.json] [--page index.html] [--tol 0.04]'); process.exit(2); }
const TOL = Number(opt('tol', 0.04)), PAGE = opt('page');

const grid = JSON.parse(readFileSync(beatsPath, 'utf8'));
const beats = grid.beats || [], downbeats = grid.downbeats?.length ? grid.downbeats : beats, hits = [...beats, ...(grid.hits || [])];
const nearest = (t, arr) => arr.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), arr[0] ?? 0);
let bad = 0;

if (cuesPath) {
  const cues = JSON.parse(readFileSync(cuesPath, 'utf8'));
  let off = 0;
  for (const c of cues) {
    const n = nearest(c.t, hits);
    if (Math.abs(n - c.t) > TOL) { off++; console.log(`  cue ${c.type} at ${c.t}s is off the grid by ${(c.t - n).toFixed(3)}s (nearest ${n}s)`); }
  }
  bad += off; console.log(`cues: ${cues.length - off} / ${cues.length} on a beat or onset`);
}

if (PAGE) {
  const abs = resolve(PAGE);
  if (!existsSync(abs)) { console.error(`grid_check.mjs: page not found: ${abs}`); process.exit(2); }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(abs).href);
    const cuts = await page.evaluate(() => (window.FILM && window.FILM.cuts) || null);
    if (!cuts) console.log('cuts: window.FILM.cuts not published by the page (set FILM.cuts = SCENES.map(s => s.from)); skipped');
    else {
      let off = 0;
      for (const t of cuts) {
        const n = nearest(t, downbeats);
        if (Math.abs(n - t) > TOL) { off++; console.log(`  cut at ${t}s is off a downbeat by ${(t - n).toFixed(3)}s (nearest ${n}s)`); }
      }
      bad += off; console.log(`cuts: ${cuts.length - off} / ${cuts.length} on a downbeat`);
    }
  } finally { await browser.close(); }
}
process.exit(bad ? 1 : 0);
