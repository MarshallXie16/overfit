// Power/heat probe: measures CPU time burned by Chrome's renderer + GPU processes (cores used)
// per scenario, with A/B toggles, at a MacBook-like retina viewport. Also prints a JS CPU profile.
//
// Usage: node tools/perfprobe.mjs [baseUrl=http://127.0.0.1:4174/] [--quick] [--only=battle] [--profile]
// Serve a production build first (dev-server HMR and sourcemaps distort numbers):
//   npx vite build && npx vite preview --port 4174
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4174/';
const quick = args.includes('--quick');
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const wantProfile = args.includes('--profile');
const WINDOW = +((args.find((a) => a.startsWith('--window=')) ?? `--window=${quick ? 5 : 8}`).slice(9)); // seconds measured per case
const VIEW = { width: 1512, height: 982 };
const DPR = +((args.find((a) => a.startsWith('--dpr=')) ?? '--dpr=2').slice(6));

const server = await chromium.launchServer({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const rootPid = server.process().pid;
const browser = await chromium.connect(server.wsEndpoint());

function cpuByType() {
  const out = execSync('ps -A -o pid=,ppid=,time=,args=', { maxBuffer: 64 * 1024 * 1024 }).toString();
  const rows = out.trim().split('\n').map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/);
    if (!m) return null;
    const [, pid, ppid, time, cmd] = m;
    const parts = time.split(':').map(Number);
    const secs = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    return { pid: +pid, ppid: +ppid, secs, cmd };
  }).filter(Boolean);
  const kids = new Map();
  for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
  const tree = [];
  const walk = (pid) => { for (const k of kids.get(pid) ?? []) { tree.push(k); walk(k.pid); } };
  const root = rows.find((r) => r.pid === rootPid);
  if (root) tree.push(root);
  walk(rootPid);
  const acc = { renderer: 0, gpu: 0, other: 0 };
  for (const r of tree) {
    const t = /--type=renderer/.test(r.cmd) ? 'renderer' : /--type=gpu-process/.test(r.cmd) ? 'gpu' : 'other';
    acc[t] += r.secs;
  }
  return acc;
}

function gpuUtil() {
  try {
    const out = execSync('ioreg -r -c IOAccelerator -d 1 -w 0', { maxBuffer: 16 * 1024 * 1024 }).toString();
    const m = out.match(/"Device Utilization %"=(\d+)/);
    return m ? +m[1] : NaN;
  } catch { return NaN; }
}

/** Average system GPU utilisation over `ms` while `fn` runs (sampled every 250 ms). */
async function sampleGpu(ms) {
  const vals = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { vals.push(gpuUtil()); await new Promise((r) => setTimeout(r, 250)); }
  const ok = vals.filter((v) => Number.isFinite(v));
  return ok.reduce((a, b) => a + b, 0) / Math.max(1, ok.length);
}
let GPU_IDLE = 0;

async function measure(page, label) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const c0 = cpuByType();
  const t0 = Date.now();
  const gpuPct = await sampleGpu(WINDOW * 1000);
  const c1 = cpuByType();
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const wall = (Date.now() - t0) / 1000;
  const fps = await page.evaluate(() => window.overfit?.session?.fps ?? 0);
  const r = {
    label,
    renderer: (c1.renderer - c0.renderer) / wall,
    gpu: (c1.gpu - c0.gpu) / wall,
    other: (c1.other - c0.other) / wall,
    script: (m1.ScriptDuration - m0.ScriptDuration) / wall,
    style: ((m1.RecalcStyleDuration - m0.RecalcStyleDuration) + (m1.LayoutDuration - m0.LayoutDuration)) / wall,
    task: (m1.TaskDuration - m0.TaskDuration) / wall,
    fps,
    gpuPct: gpuPct - GPU_IDLE,
  };
  r.total = r.renderer + r.gpu + r.other;
  await cdp.detach();
  return r;
}

const fmt = (r) => `${r.label.padEnd(30)} GPU ${r.gpuPct.toFixed(0).padStart(3)}% (→120Hz ~${(r.gpuPct * 120 / Math.max(1, r.fps)).toFixed(0)}%) | CPU total ${r.total.toFixed(2)} cores | renderer ${r.renderer.toFixed(2)} gpu ${r.gpu.toFixed(2)} other ${r.other.toFixed(2)} | main-thread task ${(r.task * 100).toFixed(0)}% (script ${(r.script * 100).toFixed(0)}%, style+layout ${(r.style * 100).toFixed(0)}%) | fps ${r.fps.toFixed(0)}`;

const TOGGLES = {
  base: async () => {},
  'no-backdrop-blur': async (p) => { await p.addStyleTag({ content: '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' }); },
  'res-1x': async (p) => { await p.evaluate(() => { const r = window.overfit.app.renderer; r.resolution = 1; r.resize(window.innerWidth, window.innerHeight); }); },
  'no-creep': async (p) => { await p.evaluate(() => { const s = window.overfit.session; if (s) s.r.creepLayer.visible = false; }); },
  'no-fog': async (p) => { await p.evaluate(() => { const s = window.overfit.session; if (s) s.r.fogLayer.visible = false; }); },
  'no-hud-dom': async (p) => { await p.addStyleTag({ content: '#hud,.overlay{display:none!important}' }); },
  'fps-30': async (p) => { await p.evaluate(() => { window.overfit.app.ticker.maxFPS = 30; }); },
  'no-audio': null, // handled by not clicking
  'ticker-stopped': async (p) => { await p.evaluate(() => { window.overfit.app.ticker.stop(); }); },
  'no-vignette': async (p) => { await p.addStyleTag({ content: '.vignette{display:none!important}' }); },
  'no-css-effects': async (p) => { await p.addStyleTag({ content: '*{backdrop-filter:none!important;clip-path:none!important;box-shadow:none!important;animation:none!important}.vignette{display:none!important}' }); },
  'world-hidden': async (p) => { await p.evaluate(() => { window.overfit.session.r.root.visible = false; }); },
  'res1x+css': async (p) => { await TOGGLES['res-1x'](p); await TOGGLES['no-css-effects'](p); },
  'res1x+css+creep+fog': async (p) => { await TOGGLES['res1x+css'](p); await TOGGLES['no-creep'](p); await TOGGLES['no-fog'](p); },
};

async function newPage() {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  pageerror', e.message));
  await page.addInitScript(() => localStorage.setItem('overfit.settings', JSON.stringify({ edgeScroll: false, master: 0.5, advisor: false })));
  return page;
}

const SCENARIOS = {
  async title(page, audio) {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector('.logo', { timeout: 20000 });
    if (audio) await page.mouse.click(1300, 120);
    await page.waitForTimeout(2500);
  },
  async early(page, audio) {
    await page.goto(base + '?quick=1&seed=7', { waitUntil: 'load' });
    await page.waitForFunction(() => window.overfit?.session?.ctl, null, { timeout: 20000 });
    if (audio) await page.mouse.click(700, 400, { button: 'right' });
    await page.waitForTimeout(2500);
  },
  async battle(page, audio) {
    await page.goto(base + '?quick=1&seed=11&size=96', { waitUntil: 'load' });
    await page.waitForFunction(() => window.overfit?.session?.ctl, null, { timeout: 20000 });
    if (audio) await page.mouse.click(700, 400, { button: 'right' });
    await page.evaluate(() => {
      const s = window.overfit.session, w = s.world;
      const hq = w.entities.find((e) => e.kind === 'hq');
      const B = (k, dx, dy) => { try { w.spawnBuilding(k, 1, hq.tx + dx, hq.ty + dy, true); } catch {} };
      B('gun_turret', 6, -2); B('tesla', 6, 2); B('missile', -3, 6); B('gun_turret', 2, 7); B('generator', -4, -3); B('generator', -7, -3);
      for (let i = 0; i < 50; i++) { const u = w.spawnUnit(['rifleman', 'arc_trooper', 'rocketeer', 'bulldog', 'volt', 'thumper'][i % 6], 1, hq.x + 5 + (i % 8) * 0.9, hq.y - 4 + Math.floor(i / 8) * 0.9); u.ax = u.x; u.ay = u.y; }
      w.revealAll = true;
      const ang = Math.atan2(w.h / 2 - hq.y, w.w / 2 - hq.x);
      window.__spawn = () => {
        const kinds = ['skitter', 'skitter', 'gunner', 'brute', 'lancer', 'wasp', 'sapper'];
        let n = 0;
        for (let i = 0; i < 600 && n < 90; i++) {
          const a = ang + (Math.random() - 0.5) * 1.2, r = 16 + Math.random() * 10;
          const x = hq.x + Math.cos(a) * r, y = hq.y + Math.sin(a) * r;
          if (!w.isWalkableTile(x | 0, y | 0)) continue;
          const u = w.spawnUnit(kinds[i % kinds.length], 2, x, y);
          u.order = { type: 'flow', field: 'human', tx: hq.x, ty: hq.y }; n++;
        }
      };
      window.__keep = setInterval(() => { const live = w.entities.filter((e) => e.alive && e.team === 2 && e.isUnit).length; if (live < 400) window.__spawn(); for (const e of w.entities) if (e.kind === 'hq' && e.team === 1) e.hp = e.maxHp; }, 500);
      for (let k = 0; k < 4; k++) window.__spawn();
      s.r.cam.x = hq.x + Math.cos(ang) * 8; s.r.cam.y = hq.y + Math.sin(ang) * 8; s.r.cam.zoom = 1.0;
    });
    await page.waitForTimeout(3000);
  },
};

const plan = [];
const scen = only ? [only] : ['title', 'early', 'battle'];
const casesArg = (args.find((a) => a.startsWith('--cases=')) ?? '').slice(8);
const reps = +((args.find((a) => a.startsWith('--reps=')) ?? '--reps=1').slice(7));
for (let rep = 0; rep < reps; rep++) for (const s of scen) {
  const toggles = casesArg ? casesArg.split(',') : s === 'early' ? ['base'] : quick ? ['base', 'no-backdrop-blur', 'res-1x', 'fps-30'] : Object.keys(TOGGLES).slice(0, 8);
  for (const t of toggles) plan.push([s, t]);
}

GPU_IDLE = await sampleGpu(4000);
console.log(`viewport ${VIEW.width}x${VIEW.height} @${DPR}x, ${WINDOW}s windows, base ${base}; system GPU idle baseline ${GPU_IDLE.toFixed(1)}% (subtracted)`);
for (const [s, t] of plan) {
  const page = await newPage();
  await SCENARIOS[s](page, t !== 'no-audio');
  if (TOGGLES[t]) await TOGGLES[t](page);
  await page.waitForTimeout(1500);
  const r = await measure(page, `${s} / ${t}`);
  console.log(fmt(r));
  if (wantProfile && t === 'base' && s === 'battle') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await page.waitForTimeout(5000);
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    const total = profile.samples.length;
    const counts = new Map();
    for (const id of profile.samples) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const n of profile.nodes) {
      const c = counts.get(n.id) ?? 0;
      if (!c) continue;
      const f = n.callFrame;
      const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + c);
    }
    console.log('  top self-time (battle/base):');
    for (const [k, c] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`    ${(c / total * 100).toFixed(1).padStart(5)}%  ${k}`);
  }
  await page.context().close();
}
await browser.close();
await server.close();
