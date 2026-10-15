import { audio } from '../audio';
import { MISSIONS, type MissionDef } from '../game/missions';
import type { Session } from '../game/session';
import { dailyNumber, dailySeed, store, todayKey } from '../game/storage';
import type { Difficulty } from '../sim/types';
import type { App } from '../main';

const DIFFS: { id: Difficulty; name: string; desc: string }[] = [
  { id: 'recruit', name: 'Recruit', desc: 'Slower Surges, gentler swarm.' },
  { id: 'veteran', name: 'Veteran', desc: 'The intended challenge.' },
  { id: 'nightmare', name: 'Nightmare', desc: 'AXIOM out-computes you. Good luck.' },
];

export function scoreOf(s: Session): number {
  const st = s.world.human.stats;
  return Math.round(st.surgesSurvived * 1000 + st.killed * 5 + st.hacked * 25 + s.world.time / 2);
}

export class Menus {
  app: App;
  el: HTMLElement | null = null;
  constructor(app: App) { this.app = app; }

  close(): void { this.el?.remove(); this.el = null; }

  private show(html: string, cls = ''): HTMLElement {
    this.close();
    const o = document.createElement('div');
    o.className = 'overlay ' + cls;
    o.innerHTML = html;
    document.body.appendChild(o);
    this.el = o;
    o.querySelectorAll('button').forEach((b) => b.addEventListener('mouseenter', () => audio.play('ui_hover')));
    return o;
  }

  private on(sel: string, fn: (e: Event) => void): void {
    this.el?.querySelectorAll(sel).forEach((b) => b.addEventListener('click', (e) => { audio.play('ui_click'); fn(e); }));
  }

  private diffSeg(cur: Difficulty): string {
    return `<div class="seg" data-seg="diff">${DIFFS.map((d) => `<button data-v="${d.id}" class="${d.id === cur ? 'on' : ''}" title="${d.desc}">${d.name}</button>`).join('')}</div>`;
  }

  private bindSeg(name: string, cb: (v: string) => void): void {
    const seg = this.el?.querySelector(`[data-seg=${name}]`);
    seg?.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      audio.play('ui_click');
      cb((b as HTMLElement).dataset.v!);
    }));
  }

  // ---------------------------------------------------------------- title
  title(): void {
    const prog = store.progress;
    this.show(`
      <div class="title-wrap">
        <div class="logo">OVERFIT</div>
        <div class="tagline">THE SWARM LEARNS YOU.</div>
        <div class="title-menu">
          <button class="btn primary" data-a="campaign">Campaign<small>Five operations against AXIOM · ${Object.keys(prog.completed).length}/${MISSIONS.length} complete</small></button>
          <button class="btn" data-a="skirmish">Skirmish<small>Procedural city. Destroy the AXIOM Core.</small></button>
          <button class="btn" data-a="endless">Endless Swarm<small>Survive the ever-growing swarm · Daily challenge #${dailyNumber()}</small></button>
          <div class="row"><button class="btn" data-a="howto">How to Play</button><button class="btn" data-a="settings">Settings</button></div>
        </div>
        <div class="foot">An RTS about teaching a machine the wrong lessons · v0.9${window.innerWidth < 1000 ? '<br><span style="color:var(--amber)">Best played on a desktop with mouse & keyboard.</span>' : ''}</div>
      </div>`, 'title');
    this.on('[data-a=campaign]', () => this.campaign());
    this.on('[data-a=skirmish]', () => this.skirmish());
    this.on('[data-a=endless]', () => this.endless());
    this.on('[data-a=howto]', () => this.howto(() => this.title()));
    this.on('[data-a=settings]', () => this.settings(() => this.title()));
  }

  // ---------------------------------------------------------------- campaign
  campaign(): void {
    const prog = store.progress;
    let diff: Difficulty = store.settings.difficulty;
    const list = MISSIONS.map((m) => {
      const locked = m.index > prog.unlocked;
      const done = prog.completed[m.id];
      return `<button class="btn ${locked ? '' : ''}" data-m="${m.id}" ${locked ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}>${m.index}. ${m.name}${done ? ' ✓' : ''}<small>${locked ? 'Locked — complete the previous operation' : m.subtitle}</small></button>`;
    }).join('');
    this.show(`<div class="dialog clip"><h2>CAMPAIGN</h2><p>Five operations. Each teaches AXIOM something — and teaches you how to make it forget.</p>
      <h3>DIFFICULTY</h3>${this.diffSeg(diff)}<h3>OPERATIONS</h3>${list}<button class="btn" data-a="back">Back</button></div>`);
    this.bindSeg('diff', (v) => { diff = v as Difficulty; store.settings.difficulty = diff; store.saveSettings(); });
    this.el!.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      audio.play('ui_click');
      this.app.start({ mode: 'campaign', difficulty: diff, seed: 0, mapSize: 96, missionId: b.dataset.m });
    }));
    this.on('[data-a=back]', () => this.title());
  }

  briefing(m: MissionDef, s: Session): void {
    s.setPaused(true);
    this.show(`<div class="dialog clip" style="max-width:640px"><div style="color:var(--teal);letter-spacing:3px;font-size:12px">${m.subtitle.toUpperCase()}</div><h2>${m.name.toUpperCase()}</h2>
      ${m.briefing.map((p) => `<p>${p}</p>`).join('')}
      <button class="btn primary" data-a="go">Deploy<small>Press Enter</small></button></div>`);
    const go = () => { this.close(); s.setPaused(false); window.removeEventListener('keydown', key); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter') go(); };
    window.addEventListener('keydown', key);
    this.on('[data-a=go]', go);
  }

  // ---------------------------------------------------------------- skirmish
  skirmish(): void {
    let diff: Difficulty = store.settings.difficulty;
    let size = 96;
    let seed = Math.floor(Math.random() * 99999);
    this.show(`<div class="dialog clip"><h2>SKIRMISH</h2><p>A procedurally generated ruined city. AXIOM holds the far corner. Destroy its Core before the swarm consumes you.</p>
      <h3>DIFFICULTY</h3>${this.diffSeg(diff)}
      <h3>MAP SIZE</h3><div class="seg" data-seg="size"><button data-v="80">Small</button><button data-v="96" class="on">Medium</button><button data-v="128">Large</button></div>
      <h3>SEED</h3><div class="row" style="align-items:center"><input type="number" data-k="seed" value="${seed}"><button class="btn" data-a="rnd" style="margin:0">Randomize</button></div>
      <button class="btn primary" data-a="go" style="margin-top:18px">Deploy</button><button class="btn" data-a="back">Back</button></div>`);
    this.bindSeg('diff', (v) => { diff = v as Difficulty; store.settings.difficulty = diff; store.saveSettings(); });
    this.bindSeg('size', (v) => { size = +v; });
    const inp = this.el!.querySelector<HTMLInputElement>('[data-k=seed]')!;
    this.on('[data-a=rnd]', () => { seed = Math.floor(Math.random() * 99999); inp.value = String(seed); });
    this.on('[data-a=go]', () => this.app.start({ mode: 'skirmish', difficulty: diff, seed: +inp.value || seed, mapSize: size }));
    this.on('[data-a=back]', () => this.title());
  }

  // ---------------------------------------------------------------- endless
  endless(): void {
    let diff: Difficulty = store.settings.difficulty;
    const key = todayKey();
    const daily = store.endless.daily[key];
    const best = store.endless.best[diff];
    this.show(`<div class="dialog clip"><h2>ENDLESS SWARM</h2><p>No Core to kill. AXIOM's compute grows without limit. Survive as many Surges as you can — and make it overfit along the way.</p>
      <h3>DAILY CHALLENGE #${dailyNumber()}</h3><p style="margin:4px 0">Same map and seed for everyone today, Veteran difficulty. ${daily ? `Your best today: <b>${daily.score}</b> (${daily.surges} surges)` : 'Not attempted yet.'}</p>
      <button class="btn primary" data-a="daily">Play Daily #${dailyNumber()}</button>
      <h3>FREE PLAY</h3>${this.diffSeg(diff)}<p style="margin:6px 0" data-k="best">${best ? `Best on this difficulty: <b>${best}</b>` : ''}</p>
      <button class="btn" data-a="go">Deploy</button><button class="btn" data-a="back">Back</button></div>`);
    this.bindSeg('diff', (v) => { diff = v as Difficulty; const b = store.endless.best[diff]; this.el!.querySelector('[data-k=best]')!.innerHTML = b ? `Best on this difficulty: <b>${b}</b>` : ''; });
    this.on('[data-a=daily]', () => this.app.start({ mode: 'endless', difficulty: 'veteran', seed: dailySeed(key), mapSize: 96, daily: key }));
    this.on('[data-a=go]', () => this.app.start({ mode: 'endless', difficulty: diff, seed: Math.floor(Math.random() * 99999), mapSize: 96 }));
    this.on('[data-a=back]', () => this.title());
  }

  // ---------------------------------------------------------------- settings
  settings(back: () => void): void {
    const s = store.settings;
    this.show(`<div class="dialog clip"><h2>SETTINGS</h2>
      <label class="set">Master volume<input type="range" min="0" max="1" step="0.05" data-s="master" value="${s.master}"></label>
      <label class="set">Effects volume<input type="range" min="0" max="1" step="0.05" data-s="sfx" value="${s.sfx}"></label>
      <label class="set">Music volume<input type="range" min="0" max="1" step="0.05" data-s="music" value="${s.music}"></label>
      <label class="set">Effects quality<input type="range" min="0.3" max="1" step="0.1" data-s="quality" value="${s.quality}"></label>
      <label class="set">Edge scrolling<input type="checkbox" data-s="edgeScroll" ${s.edgeScroll ? 'checked' : ''}></label>
      <label class="set">Advisor tips (skirmish/endless)<input type="checkbox" data-s="advisor" ${s.advisor ? 'checked' : ''}></label>
      <label class="set">Show FPS<input type="checkbox" data-s="showFps" ${s.showFps ? 'checked' : ''}></label>
      <button class="btn" data-a="back">Back</button></div>`);
    this.el!.querySelectorAll<HTMLInputElement>('[data-s]').forEach((inp) => inp.addEventListener('input', () => {
      const k = inp.dataset.s as keyof typeof s;
      (s as unknown as Record<string, unknown>)[k] = inp.type === 'checkbox' ? inp.checked : +inp.value;
      store.saveSettings();
      this.app.applySettings();
      if (k === 'sfx') audio.play('ui_click');
    }));
    this.on('[data-a=back]', back);
  }

  // ---------------------------------------------------------------- how to play
  howto(back: () => void): void {
    this.show(`<div class="dialog clip" style="max-width:760px"><h2>FIELD MANUAL</h2>
      <h3>THE WAR</h3><p>AXIOM's robots spread a red <b>Grid</b> from its Relays and Fabricators. Robots on the Grid move faster and self-repair, and you can't build on it. Every couple of minutes AXIOM launches a <b>Surge</b> at your base — and each one is bigger. Its Compute grows with time, territory and captured Server Farms.</p>
      <h3>OVERFIT</h3><p>AXIOM <b>learns</b>. Every epoch it retrains on whichever damage type hurt it most and grows resistant to it — but each adaptation creates a weakness: <span style="color:var(--kinetic)">KINETIC</span> → weak to <span style="color:var(--energy)">ENERGY</span> → weak to <span style="color:var(--explosive)">EXPLOSIVE</span> → weak to <span style="color:var(--kinetic)">KINETIC</span>. Watch the AXIOM MODEL panel and switch weapons. Destroy <b>Data Vaults</b> to trigger Catastrophic Forgetting.</p>
      <h3>HACKING</h3><p>Netrunners convert robots below 50% HP (or stunned by EMP) to your side. If the Netrunner dies, its robots revert. Protect your hackers.</p>
      <h3>ECONOMY</h3><p>Engineers harvest <b>Scrap</b> from piles and from robot <b>wrecks</b> (they decay). Kills earn <b>Data</b> for research and Commander Protocols. Generators supply <b>Power</b>; Habitats raise <b>Pop</b>.</p>
      <h3>CONTROLS</h3><table class="keys">
      <tr><td>Select / box select</td><td>Left click / drag · <kbd>Shift</kbd> add · double-click all of a type</td></tr>
      <tr><td>Command</td><td>Right click (move · attack · harvest · build · repair · hack)</td></tr>
      <tr><td>Attack-move / Stop / Hold / Hack</td><td><kbd>A</kbd> <kbd>S</kbd> <kbd>H</kbd> <kbd>K</kbd> · <kbd>Shift</kbd> queues orders</td></tr>
      <tr><td>Build menu (Engineers)</td><td><kbd>B</kbd> then the building key · drag to draw walls</td></tr>
      <tr><td>Control groups</td><td><kbd>Ctrl</kbd>+<kbd>1-9</kbd> set · <kbd>1-9</kbd> select · double-tap to centre</td></tr>
      <tr><td>Camera</td><td>Arrow keys · screen edge · middle-drag · wheel zoom · minimap</td></tr>
      <tr><td>Idle Engineer / Last alert / Base</td><td><kbd>.</kbd> / <kbd>Space</kbd> / <kbd>Home</kbd></td></tr>
      <tr><td>Select whole army</td><td><kbd>F2</kbd></td></tr>
      <tr><td>Commander Protocols</td><td><kbd>F5</kbd>–<kbd>F8</kbd></td></tr>
      <tr><td>Tactical pause / Menu</td><td><kbd>P</kbd> (orders still work) / <kbd>Esc</kbd></td></tr></table>
      <button class="btn" data-a="back" style="margin-top:16px">Back</button></div>`);
    this.on('[data-a=back]', back);
  }

  // ---------------------------------------------------------------- pause
  pause(s: Session): void {
    this.show(`<div class="dialog clip"><h2>PAUSED</h2>
      <button class="btn primary" data-a="resume">Resume</button>
      <button class="btn" data-a="howto">Field Manual</button>
      <button class="btn" data-a="settings">Settings</button>
      <button class="btn" data-a="restart">Restart</button>
      <button class="btn danger" data-a="quit">Quit to Title</button></div>`);
    const resume = () => { this.close(); s.setPaused(false); window.removeEventListener('keydown', key); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && this.el) { e.stopPropagation(); resume(); } };
    setTimeout(() => window.addEventListener('keydown', key), 0);
    this.on('[data-a=resume]', resume);
    this.on('[data-a=howto]', () => { window.removeEventListener('keydown', key); this.howto(() => this.pause(s)); });
    this.on('[data-a=settings]', () => { window.removeEventListener('keydown', key); this.settings(() => this.pause(s)); });
    this.on('[data-a=restart]', () => { window.removeEventListener('keydown', key); this.app.restart(); });
    this.on('[data-a=quit]', () => { window.removeEventListener('keydown', key); this.app.quitToMenu(); });
  }

  // ---------------------------------------------------------------- end
  end(s: Session): void {
    const w = s.world;
    const st = w.human.stats;
    const win = w.result === 'victory';
    const cur = this.app.current!;
    const endless = cur.mode === 'endless';
    let extra = '';
    let share = '';
    if (endless) {
      const score = scoreOf(s);
      const best = store.endless.best[cur.difficulty] ?? 0;
      if (score > best) store.endless.best[cur.difficulty] = score;
      if (cur.daily) {
        const d = store.endless.daily[cur.daily];
        if (!d || score > d.score) store.endless.daily[cur.daily] = { score, surges: st.surgesSurvived, kills: st.killed };
      }
      store.saveEndless();
      const A = w.axiom;
      const bar = (v: number) => '🟥'.repeat(Math.round(v * 10)) + '⬛'.repeat(Math.max(0, 6 - Math.round(v * 10)));
      share = `OVERFIT ${cur.daily ? `Daily #${dailyNumber(cur.daily)}` : `Endless (${cur.difficulty})`}\n` +
        `🛡️ ${st.surgesSurvived} surges · 💀 ${st.killed} bots · 🧠 ${st.hacked} hacked\n` +
        `AXIOM learned:\nK ${bar(A.resist.kinetic)}\nE ${bar(A.resist.energy)}\nX ${bar(A.resist.explosive)}\n` +
        `Score ${score} — the swarm learns you.`;
      extra = `<p style="font-size:18px">Score <b style="color:var(--amber);font-family:var(--mono)">${score}</b>${score > best ? ' — <span style="color:var(--good)">new best!</span>' : ''}</p>
        <pre style="background:#0c1216;border:1px solid var(--line);padding:10px;font-size:13px;white-space:pre-wrap">${share}</pre>
        <button class="btn" data-a="share">Copy result</button>`;
    } else if (win && cur.mode === 'campaign' && cur.missionId) {
      const m = MISSIONS.find((x) => x.id === cur.missionId)!;
      store.progress.completed[m.id] = { difficulty: cur.difficulty, time: Math.round(w.time) };
      store.progress.unlocked = Math.max(store.progress.unlocked, m.index + 1);
      store.saveProgress();
    }
    const next = cur.mode === 'campaign' && win ? MISSIONS.find((m) => m.index === (MISSIONS.find((x) => x.id === cur.missionId)?.index ?? 0) + 1) : undefined;
    const mm = Math.floor(w.time / 60), ss = Math.floor(w.time % 60);
    setTimeout(() => {
      this.show(`<div class="dialog clip" style="max-width:640px"><h2 style="color:${win ? 'var(--teal)' : 'var(--red)'}">${endless ? 'THE SWARM PREVAILS' : win ? 'VICTORY' : 'DEFEAT'}</h2><p>${w.resultReason}</p>
        <div class="statgrid">
          <div><b>${mm}:${String(ss).padStart(2, '0')}</b><span>TIME</span></div>
          <div><b>${st.killed}</b><span>ROBOTS DESTROYED</span></div>
          <div><b>${st.hacked}</b><span>ROBOTS HACKED</span></div>
          <div><b>${st.surgesSurvived}</b><span>SURGES REPELLED</span></div>
          <div><b>${st.peakSwarm}</b><span>PEAK SWARM</span></div>
          <div><b>${w.axiom.epoch}</b><span>AXIOM EPOCHS</span></div>
          <div><b>${Math.floor(st.scrapGathered)}</b><span>SCRAP GATHERED</span></div>
          <div><b>${st.trained}</b><span>UNITS TRAINED</span></div>
          <div><b>${st.lost}</b><span>UNITS LOST</span></div>
        </div>${extra}
        ${next ? `<button class="btn primary" data-a="next">Next: ${next.name}</button>` : ''}
        <button class="btn ${next ? '' : 'primary'}" data-a="retry">${win && !endless ? 'Play Again' : 'Retry'}</button>
        <button class="btn" data-a="quit">Title Screen</button></div>`);
      this.on('[data-a=retry]', () => this.app.restart());
      this.on('[data-a=quit]', () => this.app.quitToMenu());
      if (next) this.on('[data-a=next]', () => this.app.start({ ...cur, missionId: next.id }));
      if (share) this.on('[data-a=share]', () => { navigator.clipboard?.writeText(share).then(() => { const b = this.el!.querySelector('[data-a=share]')!; b.textContent = 'Copied!'; }).catch(() => {}); });
    }, win ? 1800 : 2500);
  }
}
