// Render/sim stress test: spawns N robots marching on the base and samples fps.
// Usage: node tools/perf.mjs [N=900] [baseUrl]
import { chromium } from 'playwright';
const N = +(process.argv[2] ?? 900);
const base = process.argv[3] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('overfit.settings', JSON.stringify({ edgeScroll: false, master: 0 })));
await page.goto(base + '?quick=1&seed=11&size=128', { waitUntil: 'load' });
await page.waitForFunction(() => window.overfit?.session?.ctl, null, { timeout: 20000 });
await page.evaluate(async (N) => {
  const s = window.overfit.session, w = s.world;
  const mods = { setOrder: (u, o) => { u.order = o; u.queue.length = 0; u.path = null; } };
  w.revealAll = true;
  const hq = w.entities.find((e) => e.kind === 'hq');
  const kinds = ['skitter', 'skitter', 'skitter', 'gunner', 'gunner', 'brute', 'lancer', 'wasp', 'sapper'];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 20;
    const x = Math.max(2, Math.min(w.w - 2, hq.x + Math.cos(a) * r)), y = Math.max(2, Math.min(w.h - 2, hq.y + Math.sin(a) * r));
    if (!w.isWalkableTile(x | 0, y | 0)) continue;
    const u = w.spawnUnit(kinds[i % kinds.length], 2, x, y);
    mods.setOrder(u, { type: 'flow', field: 'human', tx: hq.x, ty: hq.y });
  }
  for (let i = 0; i < 60; i++) { const u = w.spawnUnit(['rifleman', 'arc_trooper', 'rocketeer', 'bulldog'][i % 4], 1, hq.x + (i % 10) - 5, hq.y + 4 + Math.floor(i / 10)); }
  s.r.cam.x = hq.x; s.r.cam.y = hq.y; s.r.cam.zoom = 0.75;
}, N);
const samples = [];
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1000);
  samples.push(await page.evaluate(() => { const s = window.overfit.session; return { fps: s.fps, step: s.stepMs, ents: s.world.entities.length, robots: s.world.entities.filter((e) => e.team === 2 && e.isUnit).length }; }));
  if (i === 4) await page.screenshot({ path: 'output/perf.png' });
}
for (const s of samples) console.log(`fps ${s.fps.toFixed(1)} step ${s.step.toFixed(2)}ms ents ${s.ents} robots ${s.robots}`);
console.log('errors', errors);
await browser.close();
