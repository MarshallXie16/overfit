import { BUILDINGS, HUMAN_BUILDABLE, PROTOCOLS, RESEARCH, UNITS, type BuildingDef, type UnitDef } from '../sim/data/defs';
import { protocolAvailable } from '../sim/systems/economy';
import { AXIOM, COUNTER_OF, DAMAGE_TYPES, HUMAN, T_PARK, T_ROAD, T_RUBBLE, T_RUIN, T_WATER, type DamageType, type SimEvent } from '../sim/types';
import type { Entity, World } from '../sim/world';
import type { Controller } from '../input/controller';
import type { GameRenderer } from '../render/renderer';

export interface IconSource { get(key: string): HTMLCanvasElement | undefined }

interface Btn {
  id: string;
  icon: string;
  hotkey?: string;
  title: string;
  desc?: string;
  cost?: { scrap?: number; data?: number; power?: number; time?: number };
  disabled?: boolean;
  poor?: boolean;
  reason?: string;
  active?: boolean;
  progress?: number;
  glyph?: string;
  action: (shift: boolean) => void;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const TYPE_LABEL: Record<DamageType, string> = { kinetic: 'KINETIC', energy: 'ENERGY', explosive: 'EXPLOSIVE' };
const BUILD_ORDER = ['generator', 'habitat', 'depot', 'barracks', 'factory', 'lab', 'wall', 'gun_turret', 'tesla', 'missile', 'sensor', 'hq'];

export class Hud {
  root: HTMLElement;
  w: World;
  ctl: Controller;
  r: GameRenderer;
  icons: IconSource | null;
  private iconCache = new Map<string, string>();
  private el: Record<string, HTMLElement> = {};
  private minimap!: HTMLCanvasElement;
  private miniBase: HTMLCanvasElement | null = null;
  private miniT = 0;
  private cardT = 0;
  private buttons: Btn[] = [];
  private buildMenu = false;
  private cardKey = '';
  private alerts: { el: HTMLElement; t: number; x: number; y: number }[] = [];
  private lastAlertPos: { x: number; y: number } | null = null;
  private radioQueue: { speaker: string; text: string; axiom: boolean }[] = [];
  private radioT = 0;
  private toastT = 0;
  private pings: { x: number; y: number; t: number; color: string }[] = [];
  private surgeArrows: HTMLElement[] = [];
  private lastVals: Record<string, string> = {};
  sound: (name: string) => void = () => {};
  onMenu: () => void = () => {};
  onSpeed: () => void = () => {};
  speedLabel = () => '1×';
  private tooltipBtn: Btn | null = null;

  constructor(parent: HTMLElement, w: World, ctl: Controller, r: GameRenderer, icons: IconSource | null) {
    this.w = w; this.ctl = ctl; this.r = r; this.icons = icons;
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="vignette"></div>
      <div class="topbar panel">
        <div class="res scrap" data-tip="scrap"><i class="ic"></i><span class="lbl">Scrap</span><b data-k="scrap">0</b></div>
        <div class="res power" data-tip="power"><i class="ic"></i><span class="lbl">Power</span><b data-k="power">0</b></div>
        <div class="res pop" data-tip="pop"><i class="ic"></i><span class="lbl">Pop</span><b data-k="pop">0</b></div>
        <div class="res data" data-tip="data"><i class="ic"></i><span class="lbl">Data</span><b data-k="data">0</b></div>
        <div class="topcenter">
          <div class="surge" data-k="surgebox"><span data-k="surge">SURGE</span></div>
          <div class="threat"><span>THREAT</span><div class="pips" data-k="pips"></div></div>
        </div>
        <div class="axstat"><span>COMPUTE <b data-k="compute">0</b>/s</span><span>SWARM <b data-k="swarm">0</b></span><span>GRID <b data-k="grid">0</b></span></div>
        <div class="clock" data-k="clock">0:00</div>
        <button class="tbtn" data-k="speed" title="Game speed">1×</button>
        <button class="tbtn" data-k="menu" title="Menu (Esc)">☰</button>
      </div>
      <div class="paused-banner" data-k="paused">PAUSED — ORDERS STILL ACCEPTED</div>
      <div class="bossbar" data-k="boss"><span>COLOSSUS</span><div class="bb"><i data-k="bossfill"></i></div></div>
      <div class="objectives panel clip" data-k="objectives"></div>
      <div class="alerts" data-k="alerts"></div>
      <div class="model panel clip" data-k="model"></div>
      <div class="protocols panel" data-k="protocols"></div>
      <div class="announce" data-k="announce"></div>
      <div data-k="radio"></div>
      <div class="toast" data-k="toast"></div>
      <div class="bottom">
        <div class="minimap panel clip"><canvas data-k="minimap" width="184" height="176"></canvas></div>
        <div class="selpanel panel clip" data-k="sel"></div>
        <div class="cmdcard panel clip" data-k="card"></div>
      </div>
      <div class="tooltip" data-k="tooltip"></div>`;
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => { this.el[e.dataset.k!] = e; });
    this.minimap = this.el.minimap as HTMLCanvasElement;
    const pips = this.el.pips;
    for (let i = 0; i < 10; i++) { const p = document.createElement('i'); p.className = 'pip'; pips.appendChild(p); }
    this.el.menu.onclick = () => this.onMenu();
    this.el.speed.onclick = () => { this.onSpeed(); this.el.speed.textContent = this.speedLabel(); };
    this.buildModel();
    this.buildProtocols();
    this.setupMinimap();
    this.setupTooltips();
    this.refreshObjectives();
    this.onSelection();
  }

  destroy(): void { this.root.remove(); }

  // ---------------------------------------------------------------- icons
  icon(id: string): string {
    let u = this.iconCache.get(id);
    if (u) return u;
    const c = this.icons?.get('icon:' + id) ?? (id === 'scrap' ? this.icons?.get('res:scrap:0') : undefined);
    if (c) u = c.toDataURL();
    else {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 96;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#10181c'; g.fillRect(0, 0, 96, 96);
      g.strokeStyle = '#37e0c8'; g.strokeRect(4, 4, 88, 88);
      g.fillStyle = '#37e0c8'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(id.replace(/^cmd_|^proto_/, '').slice(0, 2).toUpperCase(), 48, 50);
      u = cv.toDataURL();
    }
    this.iconCache.set(id, u);
    return u;
  }

  // ---------------------------------------------------------------- top bar
  private set(k: string, v: string): void {
    if (this.lastVals[k] === v) return;
    this.lastVals[k] = v;
    this.el[k].textContent = v;
  }

  update(dt: number): void {
    const w = this.w, H = w.human, A = w.axiom;
    this.set('scrap', String(Math.floor(H.scrap)));
    this.set('power', `${H.powerUsed}/${H.power}`);
    this.el.power.parentElement!.classList.toggle('warn', H.brownout);
    this.set('pop', `${H.pop}/${H.popCap}`);
    this.el.pop.parentElement!.classList.toggle('warn', H.pop >= H.popCap && H.popCap < 150);
    this.set('data', String(Math.floor(H.data)));
    this.set('clock', fmtTime(w.time));
    this.set('compute', A.computeRate.toFixed(1));
    this.set('swarm', String(A.units));
    this.set('grid', String(A.creepTiles));
    const sb = this.el.surgebox;
    if (!A.tuning.surges) { this.set('surge', 'NO SURGES DETECTED'); sb.className = 'surge'; }
    else if (A.surgeActive) { this.set('surge', `SURGE ${A.surgeN} IN PROGRESS`); sb.className = 'surge active'; }
    else {
      const cascade = (A.surgeN + 1) % 4 === 0;
      this.set('surge', `${cascade ? 'CASCADE' : 'SURGE'} ${A.surgeN + 1} IN ${fmtTime(Math.max(0, A.surgeT))}`);
      sb.className = A.surgeT < 30 ? 'surge hot' : 'surge';
    }
    const pips = this.el.pips.children;
    for (let i = 0; i < 10; i++) pips[i].classList.toggle('on', i < A.threat);
    this.updateModel();
    this.updateProtocols();
    // alerts fade
    for (let i = this.alerts.length - 1; i >= 0; i--) {
      const a = this.alerts[i];
      a.t += dt;
      if (a.t > 7) a.el.classList.add('fade');
      if (a.t > 7.7) { a.el.remove(); this.alerts.splice(i, 1); }
    }
    // radio
    if (this.radioT > 0) { this.radioT -= dt; if (this.radioT <= 0) { this.el.radio.innerHTML = ''; this.nextRadio(); } }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el.toast.classList.remove('show'); }
    this.miniT -= dt;
    if (this.miniT <= 0) { this.miniT = 0.2; this.drawMinimap(); }
    this.cardT -= dt;
    if (this.cardT <= 0) { this.cardT = 0.15; this.refreshCard(); this.refreshSelDynamic(); this.refreshObjectives(); }
    this.updateSurgeArrows();
    let boss: Entity | null = null;
    if (w.tick % 5 === 0 || this.bossId) {
      const b = this.bossId ? w.get(this.bossId) : undefined;
      if (b && w.isVisible(b.x, b.y)) boss = b;
      else if (w.tick % 5 === 0) { boss = w.entities.find((e) => e.alive && e.kind === 'colossus' && e.team === AXIOM && w.isVisible(e.x, e.y)) ?? null; }
      this.bossId = boss ? boss.id : 0;
      this.el.boss.style.display = boss ? 'flex' : 'none';
      if (boss) this.el.bossfill.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
    }
    this.attackT -= dt;
    if (this.attackT <= 0) { this.attackT = 0.5; this.checkUnderAttack(); }
    this.el.paused.style.display = w.paused ? 'block' : 'none';
  }

  // ---------------------------------------------------------------- AXIOM model
  private buildModel(): void {
    const m = this.el.model;
    m.innerHTML = `<h4>AXIOM MODEL <small data-m="ep">EPOCH 0</small></h4><div class="epoch"><i data-m="ebar"></i></div>` +
      DAMAGE_TYPES.map((t) => `<div class="mrow ${t}"><span class="nm">${TYPE_LABEL[t]}</span><div class="bar"><i class="res-b" data-m="r-${t}"></i><i class="vul-b" data-m="v-${t}"></i><i class="mid"></i><i class="live" data-m="l-${t}"></i></div><span class="mul" data-m="m-${t}">×1.00</span></div>`).join('') +
      `<div class="hint" data-m="hint">AXIOM learns from the damage it takes. Its next epoch will train on your most-used weapon type.</div>`;
    m.querySelectorAll<HTMLElement>('[data-m]').forEach((e) => { this.el['m_' + e.dataset.m] = e; });
    m.addEventListener('mouseenter', () => this.showTip(m, `<div class="tt-h">AXIOM Model — Overfit</div><div class="tt-d">Every epoch AXIOM retrains on the damage type that hurt it most: <b>+resistance</b> to it (red), but its counter-type gains <b>vulnerability</b> (green).<br><br>KINETIC → weak to ENERGY<br>ENERGY → weak to EXPLOSIVE<br>EXPLOSIVE → weak to KINETIC<br><br>The thin line under each bar shows what it is training on right now. Destroy Data Vaults to halve everything it has learned.</div>`));
    m.addEventListener('mouseleave', () => this.hideTip());
  }

  private updateModel(): void {
    const A = this.w.axiom;
    this.set('m_ep', `EPOCH ${A.epoch} · ${Math.ceil(A.epochT)}s`);
    this.el.m_ebar.style.width = `${(1 - A.epochT / A.epochLen) * 100}%`;
    const tot = DAMAGE_TYPES.reduce((s, t) => s + A.dmgTaken[t], 0) || 1;
    for (const t of DAMAGE_TYPES) {
      this.el['m_r-' + t].style.width = `${(A.resist[t] / 0.6) * 60}%`;
      this.el['m_v-' + t].style.width = `${(A.vuln[t] / 0.4) * 40}%`;
      this.el['m_l-' + t].style.width = `${(A.dmgTaken[t] / tot) * 100}%`;
      const mul = Math.max(0.1, 1 - A.resist[t] + A.vuln[t]);
      const me = this.el['m_m-' + t];
      const s = `×${mul.toFixed(2)}`;
      if (me.textContent !== s) { me.textContent = s; me.className = 'mul' + (mul > 1.001 ? ' good' : mul < 0.999 ? ' bad' : ''); }
    }
    let top: DamageType = 'kinetic';
    for (const t of DAMAGE_TYPES) if (A.dmgTaken[t] > A.dmgTaken[top]) top = t;
    let best: DamageType = 'kinetic', bm = 0;
    for (const t of DAMAGE_TYPES) { const m = 1 - A.resist[t] + A.vuln[t]; if (m > bm) { bm = m; best = t; } }
    const hint = tot > 50
      ? `Training on <b>${TYPE_LABEL[top]}</b> (${Math.round((A.dmgTaken[top] / tot) * 100)}%). Best weapon now: <b>${TYPE_LABEL[best]}</b>.`
      : 'AXIOM learns from the damage it takes. Mix weapon types to keep it guessing.';
    if (this.lastVals.hint !== hint) { this.lastVals.hint = hint; this.el.m_hint.innerHTML = hint; }
  }

  // ---------------------------------------------------------------- protocols
  private buildProtocols(): void {
    const p = this.el.protocols;
    p.innerHTML = '';
    for (const id of Object.keys(PROTOCOLS)) {
      const def = PROTOCOLS[id];
      const d = document.createElement('div');
      d.className = 'proto';
      d.dataset.id = id;
      d.innerHTML = `<img src="${this.icon('proto_' + id)}"><span class="hk">${def.hotkey}</span><span class="cost">${def.data}◆</span><div class="cd" style="display:none"></div>`;
      d.onclick = () => this.useProtocol(id);
      d.onmouseenter = () => {
        const chk = protocolAvailable(this.w, id);
        this.showTip(d, `<div class="tt-h">${def.name}<span class="hk">${def.hotkey}</span></div><div class="tt-c"><span class="d">${def.data} Data</span> · <span class="t">${def.cooldown}s cooldown</span></div><div class="tt-d">${def.desc}</div>${chk.ok ? '' : `<div class="tt-r">${chk.reason}</div>`}`);
      };
      d.onmouseleave = () => this.hideTip();
      p.appendChild(d);
    }
  }

  private updateProtocols(): void {
    for (const d of Array.from(this.el.protocols.children) as HTMLElement[]) {
      const id = d.dataset.id!;
      const def = PROTOCOLS[id];
      const locked = !!def.requires && !this.w.human.research.has(def.requires);
      const cd = this.w.human.protocolCd[id] ?? 0;
      d.classList.toggle('locked', locked);
      d.classList.toggle('poor', !locked && this.w.human.data < def.data);
      const c = d.querySelector<HTMLElement>('.cd')!;
      if (cd > 0) { c.style.display = 'flex'; c.textContent = String(Math.ceil(cd)); } else c.style.display = 'none';
    }
  }

  useProtocol(id: string): void {
    const chk = protocolAvailable(this.w, id);
    if (!chk.ok) { this.toast(chk.reason ?? 'Unavailable'); this.sound('ui_error'); return; }
    this.ctl.setMode({ m: 'protocol', id });
    this.sound('ui_click');
  }

  // ---------------------------------------------------------------- objectives
  refreshObjectives(): void {
    const objs = this.w.objectives;
    const html = objs.length ? `<h4>OBJECTIVES</h4>` + objs.map((o) => `<div class="obj ${o.done ? 'done' : ''} ${o.failed ? 'failed' : ''}"><i class="box"></i><span>${o.text}</span>${o.progress ? `<span class="prog">${o.progress}</span>` : ''}</div>`).join('') : '';
    if (this.lastVals.obj !== html) {
      this.lastVals.obj = html;
      this.el.objectives.innerHTML = html;
      this.el.objectives.style.display = objs.length ? 'block' : 'none';
    }
  }

  // ---------------------------------------------------------------- events
  onEvents(events: SimEvent[]): void {
    for (const ev of events) {
      switch (ev.t) {
        case 'alert': this.alert(ev.msg as string, ev.x as number, ev.y as number, ev.level as string); break;
        case 'error': this.toast(ev.msg as string); this.sound('ui_error'); break;
        case 'radio': this.radio(ev.speaker as string, ev.text as string); break;
        case 'surge_warn': this.announce(ev.cascade ? 'CASCADE INBOUND' : 'SURGE INBOUND', 'T-minus 30 seconds', ''); break;
        case 'surge_start': this.announce(ev.cascade ? `CASCADE ${ev.n}` : `SURGE ${ev.n}`, `${ev.count} machines inbound`, ''); this.root.querySelector('.vignette')!.classList.remove('surge'); void (this.root.querySelector('.vignette') as HTMLElement).offsetWidth; this.root.querySelector('.vignette')!.classList.add('surge'); break;
        case 'surge_end': this.announce('SURGE REPELLED', 'Rebuild. Expand. Strike back.', 'teal'); break;
        case 'epoch': {
          if (!ev.type) break;
          const t = ev.type as DamageType;
          this.announce('AXIOM RETRAINED', `Resists ${TYPE_LABEL[t]} ${Math.round((ev.resist as number) * 100)}% · now weak to ${TYPE_LABEL[COUNTER_OF[t]]}`, '');
          this.el.model.classList.remove('flash'); void this.el.model.offsetWidth; this.el.model.classList.add('flash');
          break;
        }
        case 'forgetting': this.announce('CATASTROPHIC FORGETTING', 'AXIOM adaptations halved', 'teal'); this.el.model.classList.remove('flash'); void this.el.model.offsetWidth; this.el.model.classList.add('flash'); break;
        case 'research_done': this.alert(`Research complete: ${ev.name}`, 0, 0, 'info'); this.cardKey = ''; break;
        case 'build_done': if (ev.kind !== 'wall') this.alert(`${BUILDINGS[ev.kind as string]?.name ?? ev.kind} online`, ev.x as number, ev.y as number, 'info'); this.cardKey = ''; break;
        case 'unit_ready': this.cardKey = ''; break;
        case 'hack_done': break;
        case 'objective': this.refreshObjectives(); break;
      }
      if (ev.t === 'surge_warn') for (const p of (ev.from as { x: number; y: number }[]) ?? []) this.pings.push({ x: p.x, y: p.y, t: 0, color: '#ff3355' });
    }
  }

  alert(msg: string, x: number, y: number, level = 'info'): void {
    const el = document.createElement('div');
    el.className = `alert ${level}`;
    el.textContent = msg;
    if (x > 0 || y > 0) {
      el.onclick = () => this.ctl.centerOn(x, y);
      this.lastAlertPos = { x, y };
      this.pings.push({ x, y, t: 0, color: level === 'danger' ? '#ff3355' : level === 'warn' ? '#ffb547' : '#37e0c8' });
    }
    this.el.alerts.appendChild(el);
    this.alerts.push({ el, t: 0, x, y });
    while (this.alerts.length > 6) { const a = this.alerts.shift()!; a.el.remove(); }
    if (level === 'danger') this.sound('alert_attack'); else if (level === 'warn') this.sound('alert');
  }

  lastAlert(): { x: number; y: number } | null { return this.lastAlertPos; }

  announce(big: string, sub: string, cls: string): void {
    const a = this.el.announce;
    a.innerHTML = `<div class="big ${cls}">${big}<span class="sub">${sub}</span></div>`;
  }

  radio(speaker: string, text: string): void {
    this.radioQueue.push({ speaker, text, axiom: /axiom/i.test(speaker) });
    if (this.radioT <= 0) this.nextRadio();
  }

  private nextRadio(): void {
    const m = this.radioQueue.shift();
    if (!m) return;
    const initials = m.axiom ? '◉' : m.speaker.split(/\s+/).map((s) => s[0]).join('').slice(0, 2);
    this.el.radio.innerHTML = `<div class="radio panel clip"><div class="portrait ${m.axiom ? 'axiom' : ''}">${initials}</div><div><div class="who ${m.axiom ? 'axiom' : ''}">${m.speaker.toUpperCase()}</div><div class="txt">${m.text}</div></div></div>`;
    this.radioT = Math.max(5, m.text.length * 0.065);
    this.sound('radio');
  }

  toast(msg: string): void {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    this.toastT = 2.2;
  }

  // ---------------------------------------------------------------- under-attack alerts
  private attackT = 0;
  private bossId = 0;
  private lastAttackAlert = { bld: -99, unit: -99 };
  private checkUnderAttack(): void {
    const w = this.w;
    const vb = this.r.viewBounds();
    let bld: Entity | null = null, unit: Entity | null = null;
    for (const e of w.entities) {
      if (!e.alive || e.team !== HUMAN || w.time - e.attackedAt > 1) continue;
      const onScreen = e.x > vb.x0 && e.x < vb.x1 && e.y > vb.y0 && e.y < vb.y1;
      if (onScreen) continue;
      if (e.isBuilding) bld = e; else if (e.isUnit) unit = e;
    }
    if (bld && w.time - this.lastAttackAlert.bld > 20) {
      this.lastAttackAlert.bld = w.time;
      this.alert(`${bld.bdef?.name ?? 'Base'} under attack!`, bld.x, bld.y, 'danger');
    } else if (unit && w.time - this.lastAttackAlert.unit > 25 && w.time - this.lastAttackAlert.bld > 8) {
      this.lastAttackAlert.unit = w.time;
      this.alert(unit.kind === 'engineer' ? 'Engineers under attack!' : 'Our forces are under attack', unit.x, unit.y, 'warn');
    }
  }

  // ---------------------------------------------------------------- surge arrows
  private updateSurgeArrows(): void {
    const A = this.w.axiom;
    const show = A.tuning.surges && !A.surgeActive && A.surgeT < 30 && A.surgeT > 0;
    const pts = show ? A.surgeFrom : [];
    while (this.surgeArrows.length < pts.length) { const d = document.createElement('div'); d.className = 'edgearrow'; this.root.appendChild(d); this.surgeArrows.push(d); }
    const W = this.r.screenW, Hh = this.r.screenH;
    for (let i = 0; i < this.surgeArrows.length; i++) {
      const el = this.surgeArrows[i];
      const p = pts[i];
      if (!p) { el.style.display = 'none'; continue; }
      const s = this.r.worldToScreen(p.x, p.y);
      const onScreen = s.x > 0 && s.x < W && s.y > 40 && s.y < Hh - 210;
      if (onScreen) { el.style.display = 'none'; continue; }
      const cx = W / 2, cy = (Hh - 170) / 2;
      const ang = Math.atan2(s.y - cy, s.x - cx);
      const rx = W / 2 - 40, ry = (Hh - 260) / 2;
      const k = Math.min(rx / Math.abs(Math.cos(ang) || 1e-6), ry / Math.abs(Math.sin(ang) || 1e-6));
      el.style.display = 'block';
      el.style.left = `${cx + Math.cos(ang) * k - 14}px`;
      el.style.top = `${cy + Math.sin(ang) * k}px`;
      el.style.transform = `rotate(${ang + Math.PI / 2}rad)`;
    }
  }

  // ---------------------------------------------------------------- minimap
  private setupMinimap(): void {
    const c = this.minimap;
    let dragging = false;
    const go = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.w.w, y = ((e.clientY - r.top) / r.height) * this.w.h;
      return { x, y };
    };
    c.addEventListener('pointerdown', (e) => {
      const p = go(e);
      if (e.button === 2) {
        const sel = this.ctl.ownSelected();
        if (sel.length) { this.ctl.issue({ c: 'smart', ids: sel.map((s) => s.id), x: p.x, y: p.y, targetId: 0, queue: e.shiftKey }); this.r.marker(p.x, p.y, 0x60ff9a); this.sound('ui_command'); }
        return;
      }
      const md = this.ctl.mode.m;
      if (md === 'attack' || md === 'move') {
        const ids = this.ctl.ownSelected().filter((u) => u.isUnit).map((u) => u.id);
        this.ctl.issue({ c: 'order', ids, order: { type: md === 'attack' ? 'amove' : 'move', x: p.x, y: p.y }, queue: e.shiftKey });
        this.ctl.setMode({ m: 'normal' });
        return;
      }
      dragging = true;
      c.setPointerCapture(e.pointerId);
      this.ctl.centerOn(p.x, p.y);
    });
    c.addEventListener('pointermove', (e) => { if (dragging) { const p = go(e); this.ctl.centerOn(p.x, p.y); } });
    c.addEventListener('pointerup', () => { dragging = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setMinimapBase(c: HTMLCanvasElement | null): void { this.miniBase = c; }

  private drawMinimap(): void {
    const w = this.w;
    const c = this.minimap;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const sx = c.width / w.w, sy = c.height / w.h;
    if (!this.miniBase) {
      const b = document.createElement('canvas');
      b.width = w.w; b.height = w.h;
      const bg = b.getContext('2d')!;
      const img = bg.createImageData(w.w, w.h);
      const cols: Record<number, number[]> = { 0: [52, 52, 50], [T_ROAD]: [36, 38, 40], [T_RUBBLE]: [70, 62, 52], [T_WATER]: [16, 34, 44], [T_RUIN]: [18, 18, 20], [T_PARK]: [44, 52, 36] };
      for (let i = 0; i < w.w * w.h; i++) { const cc = cols[w.terrain[i]] ?? [50, 50, 50]; img.data.set([cc[0], cc[1], cc[2], 255], i * 4); }
      bg.putImageData(img, 0, 0);
      this.miniBase = b;
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(this.miniBase, 0, 0, c.width, c.height);
    // creep + fog in one pass
    const ov = g.getImageData(0, 0, c.width, c.height);
    const d = ov.data;
    for (let py = 0; py < c.height; py++) {
      const ty = Math.floor(py / sy);
      for (let px = 0; px < c.width; px++) {
        const tx = Math.floor(px / sx);
        const i = ty * w.w + tx;
        const k = (py * c.width + px) * 4;
        const cr = w.creep[i];
        if (cr > 0.3 && w.explored[i]) { d[k] = d[k] * 0.5 + 120 * cr; d[k + 1] *= 0.55; d[k + 2] = d[k + 2] * 0.6 + 20 * cr; }
        if (!w.revealAll) {
          if (!w.explored[i]) { d[k] = 6 + d[k] * 0.12; d[k + 1] = 8 + d[k + 1] * 0.12; d[k + 2] = 12 + d[k + 2] * 0.12; }
          else if (!w.vis[i]) { d[k] *= 0.55; d[k + 1] *= 0.55; d[k + 2] *= 0.55; }
        }
      }
    }
    g.putImageData(ov, 0, 0);
    for (const e of w.entities) {
      if (!e.alive || e.cat === 'wreck') continue;
      if (e.cat === 'resource') {
        if (!w.explored[(e.y | 0) * w.w + (e.x | 0)]) continue;
        g.fillStyle = '#c8a050';
        g.fillRect(e.x * sx - 0.5, e.y * sy - 0.5, 1.5, 1.5);
        continue;
      }
      if (e.team !== HUMAN) {
        if (e.isUnit && !w.isVisible(e.x, e.y)) continue;
        if (e.isBuilding && !w.explored[(e.y | 0) * w.w + (e.x | 0)]) continue;
      }
      const col = e.team === HUMAN ? (e.hacked ? '#45f0ff' : '#37e0c8') : e.team === AXIOM ? '#ff3355' : '#e8d070';
      g.fillStyle = col;
      if (e.isBuilding) g.fillRect(e.tx * sx, e.ty * sy, Math.max(2, e.size * sx), Math.max(2, e.size * sy));
      else g.fillRect(e.x * sx - 1, e.y * sy - 1, e.radius > 1 ? 4 : 2, e.radius > 1 ? 4 : 2);
    }
    // camera rect
    const vb = this.r.viewBounds();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 1;
    g.strokeRect(vb.x0 * sx, vb.y0 * sy, (vb.x1 - vb.x0) * sx, (vb.y1 - vb.y0) * sy);
    // pings
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t += 0.2;
      if (p.t > 3) { this.pings.splice(i, 1); continue; }
      g.strokeStyle = p.color;
      g.globalAlpha = 1 - p.t / 3;
      g.beginPath(); g.arc(p.x * sx, p.y * sy, 3 + ((p.t * 8) % 10), 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- tooltips
  private setupTooltips(): void {
    const tips: Record<string, () => string> = {
      scrap: () => `<div class="tt-h">Scrap</div><div class="tt-d">Harvested by Engineers from scrap fields and robot wrecks. Wrecks decay after 45 s — salvage them fast.</div>`,
      power: () => `<div class="tt-h">Power ${this.w.human.powerUsed}/${this.w.human.power}</div><div class="tt-d">Production buildings and turrets draw power. If usage exceeds supply you suffer a <b>Brownout</b>: production and turrets slow down. Build Generators.</div>`,
      pop: () => `<div class="tt-h">Population ${this.w.human.pop}/${this.w.human.popCap}</div><div class="tt-d">HQ +10, Habitat +8 (max 150). Hacked robots don't count.</div>`,
      data: () => `<div class="tt-h">Data</div><div class="tt-d">Earned by destroying robots and AXIOM structures and by holding Server Farms. Spent on research, advanced units and Commander Protocols.</div>`,
    };
    this.root.querySelectorAll<HTMLElement>('[data-tip]').forEach((el) => {
      el.style.pointerEvents = 'auto';
      el.onmouseenter = () => this.showTip(el, tips[el.dataset.tip!]());
      el.onmouseleave = () => this.hideTip();
    });
  }

  showTip(anchor: HTMLElement, html: string): void {
    const t = this.el.tooltip;
    t.innerHTML = html;
    t.style.display = 'block';
    const r = anchor.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < 44) y = r.bottom + 8;
    x = Math.max(6, Math.min(window.innerWidth - tw - 6, x));
    t.style.left = `${x}px`; t.style.top = `${y}px`;
  }

  hideTip(): void { this.el.tooltip.style.display = 'none'; this.tooltipBtn = null; }

  // ---------------------------------------------------------------- selection panel
  onSelection(): void {
    this.buildMenu = false;
    this.cardKey = '';
    this.renderSel();
    this.refreshCard();
  }

  private renderSel(): void {
    const sel = this.ctl.selectedEntities();
    const p = this.el.sel;
    p.classList.toggle('empty', !sel.length);
    if (!sel.length) { p.innerHTML = `<div class="desc" style="font-size:12px;color:var(--muted)">Drag to select · Right-click to command · <kbd>.</kbd> idle Engineer · <kbd>Space</kbd> last alert · <kbd>P</kbd> pause · <kbd>Esc</kbd> menu</div>`; return; }
    if (sel.length === 1) {
      const e = sel[0];
      const def = (e.udef ?? e.bdef) as UnitDef | BuildingDef | null;
      const name = def?.name ?? (e.cat === 'resource' ? 'Scrap Pile' : 'Wreck');
      const teamLbl = e.team === HUMAN ? (e.hacked ? 'HACKED' : 'RESISTANCE') : e.team === AXIOM ? 'AXIOM' : 'NEUTRAL';
      const iconId = e.cat === 'resource' ? 'scrap' : e.cat === 'wreck' ? 'scrap' : e.kind;
      p.innerHTML = `<div class="sel-single"><div class="sel-portrait"><img src="${this.icon(iconId)}"></div><div class="sel-info">
        <div class="nm">${name}<small>${teamLbl}</small></div>
        <div class="hpbar" data-s="hp"><i></i><span></span></div>
        <div class="stats" data-s="stats"></div>
        <div class="desc">${def?.desc ?? (e.cat === 'resource' ? 'Engineers can harvest scrap here.' : 'Robot wreckage. Salvage for scrap before it decays.')}</div>
        <div class="queue" data-s="queue"></div></div></div>`;
    } else {
      const counts = new Map<string, Entity[]>();
      for (const e of sel) { const a = counts.get(e.kind) ?? []; a.push(e); counts.set(e.kind, a); }
      p.innerHTML = `<div class="sel-multi">${sel.slice(0, 48).map((e) => `<div class="mitem" data-id="${e.id}"><img src="${this.icon(e.kind)}"><div class="hp"><i style="width:${(e.hp / e.maxHp) * 100}%"></i></div></div>`).join('')}</div>`;
      p.querySelectorAll<HTMLElement>('.mitem').forEach((m) => {
        m.onclick = (ev) => {
          const id = +m.dataset.id!;
          if (ev.shiftKey) this.ctl.setSelection(this.ctl.selection.filter((x) => x !== id));
          else if (ev.ctrlKey || ev.metaKey) { const k = this.w.get(id)?.kind; this.ctl.setSelection(this.ctl.selection.filter((x) => this.w.get(x)?.kind === k)); }
          else this.ctl.setSelection([id]);
        };
      });
    }
    this.refreshSelDynamic();
  }

  private refreshSelDynamic(): void {
    const sel = this.ctl.selectedEntities();
    const p = this.el.sel;
    if (sel.length !== 1) {
      if (sel.length > 1) {
        const items = p.querySelectorAll<HTMLElement>('.mitem');
        items.forEach((m) => { const e = this.w.get(+m.dataset.id!); const i = m.querySelector<HTMLElement>('.hp i'); if (e && i) i.style.width = `${(e.hp / e.maxHp) * 100}%`; });
      }
      return;
    }
    const e = sel[0];
    const hp = p.querySelector<HTMLElement>('[data-s=hp]');
    if (hp) {
      if (e.isUnit || e.isBuilding) {
        const f = Math.max(0, e.hp / e.maxHp);
        (hp.firstElementChild as HTMLElement).style.width = `${f * 100}%`;
        (hp.firstElementChild as HTMLElement).style.background = f > 0.6 ? 'var(--good)' : f > 0.3 ? 'var(--amber)' : 'var(--red)';
        hp.querySelector('span')!.textContent = e.kind === 'server_farm' ? '' : `${Math.ceil(e.hp)}/${Math.ceil(e.maxHp)}`;
        hp.style.display = e.kind === 'server_farm' ? 'none' : 'block';
      } else hp.style.display = 'none';
    }
    const st = p.querySelector<HTMLElement>('[data-s=stats]');
    if (st) {
      const parts: string[] = [];
      const wpn = e.udef?.weapon ?? e.bdef?.weapon;
      if (wpn) {
        const mul = e.team === HUMAN ? this.w.human.dmgMul[wpn.type] : 1;
        parts.push(`<span class="dtag ${wpn.type}">${TYPE_LABEL[wpn.type]}</span>`);
        parts.push(`<span class="st">DMG <b>${Math.round(wpn.damage * mul)}</b></span>`);
        parts.push(`<span class="st">RATE <b>${wpn.cooldown}s</b></span>`);
        parts.push(`<span class="st">RANGE <b>${wpn.melee ? 'melee' : wpn.range}</b></span>`);
        if (wpn.chains) parts.push(`<span class="st">CHAINS <b>${wpn.chains}</b></span>`);
        if (wpn.splash) parts.push(`<span class="st">SPLASH <b>${wpn.splash}</b></span>`);
      }
      if (e.isUnit) {
        parts.push(`<span class="st">ARMOR <b>${e.udef!.armor}</b></span>`);
        parts.push(`<span class="st">SPEED <b>${e.udef!.speed}</b></span>`);
        if (e.kind === 'engineer' && e.carrying) parts.push(`<span class="st">CARRYING <b>${e.carrying}</b></span>`);
        if (e.udef?.abilities?.includes('hack')) parts.push(`<span class="st">BANDWIDTH <b>${e.links.filter((l) => this.w.get(l)).length}/${this.w.human.bandwidth}</b></span>`);
        if (e.hacked) parts.push(`<span class="st" style="color:var(--cyan)">${e.hackExpire ? `OVERRIDE ${Math.ceil(e.hackExpire - this.w.time)}s` : 'LINKED TO NETRUNNER'}</span>`);
        if (e.stunUntil > this.w.time) parts.push(`<span class="st" style="color:#8fb8ff">STUNNED</span>`);
        if (e.team === AXIOM && e.udef?.hackable && !e.udef.boss) parts.push(`<span class="st" style="color:var(--cyan)">${e.hp < e.maxHp * 0.5 || e.stunUntil > this.w.time ? 'HACKABLE NOW' : 'hackable below 50% HP'}</span>`);
      }
      if (e.isBuilding) {
        if (!e.built) parts.push(`<span class="st">BUILDING <b>${Math.floor(e.progress * 100)}%</b></span>`);
        if (e.bdef!.power) parts.push(`<span class="st">POWER <b>${e.bdef!.power > 0 ? '+' : ''}${e.bdef!.power}</b></span>`);
        if (e.bdef!.pop) parts.push(`<span class="st">POP <b>+${e.bdef!.pop}</b></span>`);
        if (e.kind === 'server_farm') parts.push(`<span class="st">CONTROL <b>${e.team === HUMAN ? 'RESISTANCE' : e.team === AXIOM ? 'AXIOM' : 'NEUTRAL'}</b> (${Math.round(e.capture * 100)}%)</span>`);
        if (e.researching) parts.push(`<span class="st">RESEARCHING <b>${RESEARCH[e.researching.id].name} ${Math.floor((e.researching.t / e.researching.total) * 100)}%</b></span>`);
      }
      if (e.cat === 'resource' || e.cat === 'wreck') parts.push(`<span class="st">SCRAP <b>${e.amount}</b></span>`);
      if (e.cat === 'wreck') parts.push(`<span class="st">DECAYS IN <b>${Math.max(0, Math.ceil(e.expire - this.w.time))}s</b></span>`);
      const html = parts.join('');
      if (st.dataset.v !== html) { st.dataset.v = html; st.innerHTML = html; }
    }
    const q = p.querySelector<HTMLElement>('[data-s=queue]');
    if (q && e.isBuilding && e.team === HUMAN) {
      const key = e.prod.map((x) => x.kind).join(',');
      if (q.dataset.k !== key) {
        q.dataset.k = key;
        q.innerHTML = e.prod.map((it, i) => `<div class="qitem" data-i="${i}" title="Click to cancel"><img src="${this.icon(it.kind)}"><div class="prog"></div></div>`).join('');
        q.querySelectorAll<HTMLElement>('.qitem').forEach((el) => { el.onclick = () => { this.ctl.issue({ c: 'cancelTrain', building: e.id, index: +el.dataset.i! }); this.sound('ui_click'); }; });
      }
      const first = q.querySelector<HTMLElement>('.qitem .prog');
      if (first && e.prod[0]) first.style.width = `${(e.prod[0].t / e.prod[0].total) * 100}%`;
    }
  }

  // ---------------------------------------------------------------- command card
  private computeButtons(): Btn[] {
    const w = this.w, H = w.human;
    const sel = this.ctl.ownSelected();
    const out: Btn[] = [];
    if (!sel.length) return out;
    const units = sel.filter((e) => e.isUnit);
    const blds = sel.filter((e) => e.isBuilding);
    const md = this.ctl.mode.m;
    if (units.length) {
      const engineers = units.filter((u) => u.udef?.abilities?.includes('build'));
      if (this.buildMenu && engineers.length) {
        for (const kind of BUILD_ORDER) {
          if (!HUMAN_BUILDABLE.includes(kind)) continue;
          const def = BUILDINGS[kind];
          const reqOk = w.requirementsMet(def.requires);
          const pmode = this.ctl.mode;
          out.push({
            id: 'b:' + kind, icon: this.icon(kind), hotkey: kind === 'hq' ? 'Q' : def.hotkey, title: def.name, desc: def.desc,
            cost: { scrap: def.cost.scrap, power: def.power, time: def.buildTime },
            disabled: !reqOk, reason: reqOk ? undefined : `Requires ${def.requires!.map((r) => BUILDINGS[r]?.name ?? RESEARCH[r]?.name).join(', ')}`,
            poor: H.scrap < def.cost.scrap, active: pmode.m === 'place' && pmode.kind === kind,
            action: () => {
              if (!reqOk) { this.toast(`Requires ${def.requires!.map((r) => BUILDINGS[r]?.name ?? r).join(', ')}`); this.sound('ui_error'); return; }
              if (H.scrap < def.cost.scrap) { this.toast('Not enough scrap'); this.sound('ui_error'); return; }
              this.ctl.setMode({ m: 'place', kind });
              this.sound('ui_click');
            },
          });
        }
        out.push({ id: 'back', icon: this.icon('cmd_cancel'), hotkey: 'Escape', title: 'Back', action: () => { this.buildMenu = false; this.ctl.setMode({ m: 'normal' }); this.cardKey = ''; } });
        return out;
      }
      out.push({ id: 'move', icon: this.icon('cmd_move'), hotkey: 'M', title: 'Move', desc: 'Move ignoring enemies. (Right-click also moves.)', active: md === 'move', action: () => this.ctl.unitCommand('move') });
      out.push({ id: 'stop', icon: this.icon('cmd_stop'), hotkey: 'S', title: 'Stop', action: () => this.ctl.unitCommand('stop') });
      out.push({ id: 'hold', icon: this.icon('cmd_hold'), hotkey: 'H', title: 'Hold Position', desc: 'Engage only targets in range; never chase.', action: () => this.ctl.unitCommand('hold') });
      out.push({ id: 'attack', icon: this.icon('cmd_attack'), hotkey: 'A', title: 'Attack-Move', desc: 'Move and engage anything along the way. Click an enemy to focus it.', active: md === 'attack', action: () => this.ctl.unitCommand('attack') });
      if (engineers.length) {
        out.push({ id: 'build', icon: this.icon('cmd_build'), hotkey: 'B', title: 'Build', desc: 'Open the construction menu.', action: () => { this.buildMenu = true; this.cardKey = ''; this.refreshCard(); this.sound('ui_open'); } });
        out.push({ id: 'harvest', icon: this.icon('cmd_harvest'), title: 'Harvest', desc: 'Right-click scrap or a wreck to harvest. Engineers return cargo automatically.', action: () => this.toast('Right-click a scrap pile or wreck') });
        out.push({ id: 'repair', icon: this.icon('cmd_repair'), title: 'Repair', desc: 'Right-click a damaged structure or vehicle. Costs a little scrap.', action: () => this.toast('Right-click a damaged structure or vehicle') });
      }
      if (units.some((u) => u.udef?.abilities?.includes('hack'))) {
        out.push({ id: 'hack', icon: this.icon('cmd_hack'), hotkey: 'K', title: 'Hack', desc: 'Convert a robot below 50% HP (or stunned) to your side. The Netrunner must survive or the robot reverts.', active: md === 'hack', action: () => this.ctl.unitCommand('hack') });
      }
      return out;
    }
    // buildings: only the first kind's actions
    const b = blds[0];
    const same = blds.filter((x) => x.kind === b.kind);
    if (!b.built) {
      out.push({ id: 'cancel', icon: this.icon('cmd_cancel'), hotkey: 'Escape', title: 'Cancel Construction', desc: 'Refunds the full cost.', action: () => { for (const s of same) this.ctl.issue({ c: 'cancelBuild', id: s.id }); } });
      return out;
    }
    if (b.hacked) {
      out.push({ id: 'demolish', icon: this.icon('cmd_cancel'), hotkey: 'Delete', title: 'Self-destruct', action: () => this.ctl.issue({ c: 'demolish', id: b.id }) });
      return out;
    }
    for (const kind of b.bdef?.trains ?? []) {
      const def = UNITS[kind];
      const reqOk = w.requirementsMet(def.requires);
      const queued = same.reduce((s, x) => s + x.prod.filter((p) => p.kind === kind).length, 0);
      out.push({
        id: 't:' + kind, icon: this.icon(kind), hotkey: def.hotkey, title: def.name, desc: def.desc + (def.weapon ? ` <span class="dtag ${def.weapon.type}">${TYPE_LABEL[def.weapon.type]}</span>` : ''),
        cost: { scrap: def.cost.scrap, data: def.cost.data, time: def.buildTime },
        disabled: !reqOk, reason: reqOk ? undefined : `Requires ${def.requires!.map((r) => BUILDINGS[r]?.name ?? RESEARCH[r]?.name).join(', ')}`,
        poor: H.scrap < def.cost.scrap || H.data < (def.cost.data ?? 0),
        progress: queued ? 1 : undefined,
        action: (shift) => {
          // train in the building with the shortest queue
          const n = shift ? 5 : 1;
          for (let i = 0; i < n; i++) {
            const tgt = same.slice().sort((a, c) => a.prod.length - c.prod.length)[0];
            this.ctl.issue({ c: 'train', building: tgt.id, kind });
          }
          this.sound('ui_click');
        },
      });
    }
    if (b.bdef?.research) {
      for (const id of Object.keys(RESEARCH)) {
        const r = RESEARCH[id];
        if (H.research.has(id)) continue;
        // show tier 2 only once tier 1 is done
        if (r.requires && !r.requires.every((q) => H.research.has(q)) && r.requires.some((q) => !H.research.has(q) && RESEARCH[q] && RESEARCH[q].hotkey === r.hotkey)) continue;
        const inProg = this.w.entities.find((x) => x.alive && x.researching?.id === id);
        const reqOk = w.requirementsMet(r.requires);
        out.push({
          id: 'r:' + id, icon: this.icon(id), hotkey: r.hotkey, title: r.name, desc: r.desc,
          cost: { scrap: r.cost.scrap, data: r.cost.data, time: r.time },
          disabled: !reqOk || (!!inProg && inProg !== b), reason: !reqOk ? `Requires ${r.requires!.map((q) => RESEARCH[q]?.name).join(', ')}` : inProg ? 'In progress' : undefined,
          poor: H.scrap < r.cost.scrap || H.data < (r.cost.data ?? 0),
          active: !!inProg, progress: inProg?.researching ? inProg.researching.t / inProg.researching.total : undefined,
          action: () => {
            const lab = same.find((x) => !x.researching) ?? b;
            if (inProg) { this.ctl.issue({ c: 'cancelResearch', building: inProg.id }); return; }
            this.ctl.issue({ c: 'research', building: lab.id, id });
            this.sound('ui_click');
          },
        });
      }
    }
    if (b.bdef?.trains) out.push({ id: 'rally', icon: this.icon('cmd_rally'), hotkey: 'G', title: 'Set Rally Point', desc: 'New units move here. Rally onto scrap to auto-harvest. (Right-click also sets rally.)', active: md === 'rally', action: () => this.ctl.unitCommand('rally') });
    if (b.kind !== 'hq' || this.w.countBuildings(HUMAN, 'hq') > 1) {
      out.push({ id: 'demolish', icon: this.icon('cmd_cancel'), hotkey: 'Delete', title: 'Demolish', desc: 'Refunds 50% of the cost, scaled by remaining HP.', action: () => { for (const s of same) this.ctl.issue({ c: 'demolish', id: s.id }); this.sound('ui_click'); } });
    }
    return out;
  }

  private refreshCard(): void {
    const btns = this.computeButtons();
    this.buttons = btns;
    const key = btns.map((b) => `${b.id}|${b.disabled ? 1 : 0}|${b.poor ? 1 : 0}|${b.active ? 1 : 0}|${b.progress !== undefined ? Math.round(b.progress * 50) : '-'}`).join(',');
    if (key === this.cardKey) return;
    this.cardKey = key;
    const card = this.el.card;
    card.innerHTML = '';
    for (const b of btns) {
      const el = document.createElement('button');
      el.className = `cbtn ${b.disabled ? 'disabled' : ''} ${b.poor ? 'poor' : ''} ${b.active ? 'active' : ''}`;
      const hk = b.hotkey === 'Escape' ? 'Esc' : b.hotkey === 'Delete' ? 'Del' : b.hotkey ?? '';
      const cost = b.cost && (b.cost.scrap || b.cost.data) ? `<span class="cost">${b.cost.scrap ? b.cost.scrap : ''}${b.cost.data ? ` <span class="d">${b.cost.data}◆</span>` : ''}</span>` : '';
      el.innerHTML = `<img src="${b.icon}"><span class="hk">${hk}</span>${cost}${b.progress !== undefined ? `<div class="prog" style="width:${Math.min(1, b.progress) * 100}%"></div>` : ''}`;
      el.onclick = (ev) => { if (b.disabled) { this.toast(b.reason ?? 'Unavailable'); this.sound('ui_error'); return; } b.action(ev.shiftKey); this.cardKey = ''; };
      el.onmouseenter = () => {
        const c = b.cost;
        const costHtml = c ? `<div class="tt-c">${c.scrap ? `<span class="s">${c.scrap} scrap</span> ` : ''}${c.data ? `<span class="d">${c.data} data</span> ` : ''}${c.power ? `<span class="p">${c.power > 0 ? '+' : ''}${c.power} power</span> ` : ''}${c.time ? `<span class="t">${c.time}s</span>` : ''}</div>` : '';
        this.showTip(el, `<div class="tt-h">${b.title}${hk ? `<span class="hk">${hk}</span>` : ''}</div>${costHtml}${b.desc ? `<div class="tt-d">${b.desc}</div>` : ''}${b.reason ? `<div class="tt-r">${b.reason}</div>` : ''}`);
        this.tooltipBtn = b;
      };
      el.onmouseleave = () => this.hideTip();
      card.appendChild(el);
    }
  }

  /** Keyboard → command card / protocols. Returns true if handled. */
  hotkey(e: KeyboardEvent): boolean {
    const k = e.key;
    const pk = Object.values(PROTOCOLS).find((p) => p.hotkey === k);
    if (pk) { e.preventDefault(); this.useProtocol(pk.id); return true; }
    if (k === 'Escape' && this.buildMenu) { this.buildMenu = false; this.cardKey = ''; this.refreshCard(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const up = k.length === 1 ? k.toUpperCase() : k;
    const b = this.buttons.find((x) => x.hotkey === up);
    if (!b) return false;
    if (b.disabled) { this.toast(b.reason ?? 'Unavailable'); this.sound('ui_error'); return true; }
    b.action(e.shiftKey);
    this.cardKey = '';
    this.refreshCard();
    return true;
  }
}
