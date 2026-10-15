import { BUILDINGS, PROTOCOLS } from '../sim/data/defs';
import { hackEligible } from '../sim/systems/units';
import { AXIOM, HUMAN } from '../sim/types';
import type { Command, Entity, Order, World } from '../sim/world';
import type { GameRenderer } from '../render/renderer';

export type Mode =
  | { m: 'normal' }
  | { m: 'attack' }
  | { m: 'move' }
  | { m: 'hack' }
  | { m: 'rally' }
  | { m: 'place'; kind: string }
  | { m: 'protocol'; id: string };

export interface ControllerHooks {
  hotkey(e: KeyboardEvent): boolean;
  onSelectionChanged(): void;
  onMode(): void;
  sound(name: string): void;
  toast(msg: string): void;
  togglePause(): void;
  openMenu(): void;
  lastAlert(): { x: number; y: number } | null;
}

export class Controller {
  world: World;
  r: GameRenderer;
  hooks: ControllerHooks;
  selection: number[] = [];
  groups = new Map<number, number[]>();
  mode: Mode = { m: 'normal' };
  mouse = { x: 0, y: 0, inside: false };
  keys = new Set<string>();
  private down: { x: number; y: number; button: number; t: number } | null = null;
  private panning: { x: number; y: number; cx: number; cy: number } | null = null;
  private lastClick = { t: 0, id: 0 };
  private lastGroupTap = { n: -1, t: 0 };
  private wallStart: { tx: number; ty: number } | null = null;
  enabled = true;
  edgeScroll = true;
  private disposers: (() => void)[] = [];

  constructor(world: World, r: GameRenderer, hooks: ControllerHooks) {
    this.world = world;
    this.r = r;
    this.hooks = hooks;
    const c = r.app.canvas as HTMLCanvasElement;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(c, 'pointerdown', (e) => this.onDown(e));
    on(window, 'pointermove', (e) => this.onMove(e as PointerEvent));
    on(window, 'pointerup', (e) => this.onUp(e as PointerEvent));
    on(c, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(c, 'pointerenter', () => { this.mouse.inside = true; });
    on(c, 'pointerleave', () => { this.mouse.inside = false; });
    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    on(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).key));
    on(window, 'blur', () => { this.keys.clear(); this.mouse.inside = false; });
  }

  dispose(): void { for (const d of this.disposers) d(); this.disposers = []; }

  // ---------------------------------------------------------------- helpers
  issue(cmd: Command): void { this.world.commands.push(cmd); }

  ownSelected(): Entity[] {
    const out: Entity[] = [];
    for (const id of this.selection) { const e = this.world.get(id); if (e && e.team === HUMAN) out.push(e); }
    return out;
  }

  selectedEntities(): Entity[] {
    const out: Entity[] = [];
    for (const id of this.selection) { const e = this.world.get(id); if (e) out.push(e); }
    return out;
  }

  setSelection(ids: number[]): void {
    this.selection = ids;
    this.r.selected = new Set(ids);
    this.hooks.onSelectionChanged();
  }

  /** Drop dead / no-longer-visible entities from selection. */
  pruneSelection(): void {
    const w = this.world;
    const keep = this.selection.filter((id) => {
      const e = w.get(id);
      if (!e) return false;
      if (e.team !== HUMAN && e.isUnit && !w.isVisible(e.x, e.y)) return false;
      return true;
    });
    if (keep.length !== this.selection.length) this.setSelection(keep);
  }

  setMode(m: Mode): void {
    this.mode = m;
    this.wallStart = null;
    this.r.ghost = null;
    this.r.targetCircle = null;
    const c = this.r.app.canvas as HTMLCanvasElement;
    c.style.cursor = m.m === 'normal' ? 'default' : m.m === 'place' ? 'copy' : 'crosshair';
    this.hooks.onMode();
  }

  pick(x: number, y: number): Entity | null {
    const w = this.world;
    let best: Entity | null = null, bd = Infinity;
    for (const e of w.entities) {
      if (!e.alive) continue;
      if (e.team !== HUMAN) {
        if (e.isUnit && !w.isVisible(e.x, e.y)) continue;
        if (!e.isUnit && !w.explored[(e.y | 0) * w.w + (e.x | 0)]) continue;
      }
      let d: number;
      if (e.isBuilding) {
        if (x < e.tx || x > e.tx + e.size || y < e.ty || y > e.ty + e.size) continue;
        d = 1 + Math.hypot(x - e.x, y - e.y) * 0.1;
      } else {
        const dd = Math.hypot(x - e.x, y - e.y);
        const r = e.isUnit ? e.radius + 0.3 : 0.55;
        if (dd > r) continue;
        d = dd - (e.isUnit ? 0.5 : 0);
      }
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  centerOn(x: number, y: number): void {
    this.r.cam.x = x;
    this.r.cam.y = y;
  }

  // ---------------------------------------------------------------- per-frame
  update(dt: number): void {
    const cam = this.r.cam;
    const sp = (22 / cam.zoom) * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('ArrowDown')) dy += 1;
    const mx = this.mouse.x, my = this.mouse.y, W = this.r.screenW, H = this.r.screenH;
    const inBounds = mx >= 0 && my >= 0 && mx <= W && my <= H;
    if (this.edgeScroll && this.mouse.inside && inBounds && !this.down && !this.panning && document.hasFocus() && performance.now() - this.lastMoveT < 4000) {
      const m = 6;
      if (mx < m) dx -= 1;
      if (mx > W - m) dx += 1;
      if (my < m) dy -= 1;
      if (my > H - m) dy += 1;
    }
    cam.x += dx * sp;
    cam.y += dy * sp;
    // hover + ghost
    const wp = this.r.screenToWorld(this.mouse.x, this.mouse.y);
    const h = this.mouse.inside ? this.pick(wp.x, wp.y) : null;
    this.r.hoverId = h ? h.id : 0;
    if (this.mode.m === 'place') {
      const def = BUILDINGS[this.mode.kind];
      const tx = Math.floor(wp.x - def.size / 2 + 0.5), ty = Math.floor(wp.y - def.size / 2 + 0.5);
      if (def.wall && this.wallStart) {
        const line = wallLine(this.wallStart.tx, this.wallStart.ty, Math.floor(wp.x), Math.floor(wp.y));
        const ok = line.every((t) => this.world.canPlace('wall', t.tx, t.ty).ok);
        this.r.ghost = { kind: 'wall', tx: line[0].tx, ty: line[0].ty, ok, line };
      } else {
        this.r.ghost = { kind: this.mode.kind, tx, ty, ok: this.world.canPlace(this.mode.kind, tx, ty).ok };
      }
    } else if (this.mode.m === 'protocol') {
      const p = PROTOCOLS[this.mode.id];
      this.r.targetCircle = { x: wp.x, y: wp.y, r: p.radius, color: this.mode.id === 'orbital' ? 0xff4040 : this.mode.id === 'supply' ? 0xffd060 : 0x45f0ff };
    }
    const c = this.r.app.canvas as HTMLCanvasElement;
    if (this.mode.m === 'normal') {
      const sel = this.ownSelected();
      let cur = 'default';
      if (h && sel.some((u) => u.isUnit)) {
        if (h.team === AXIOM) cur = sel.some((u) => u.udef?.abilities?.includes('hack')) && hackEligible(this.world, h) ? 'cell' : 'crosshair';
        else if ((h.cat === 'resource' || h.cat === 'wreck') && sel.some((u) => u.kind === 'engineer')) cur = 'grab';
        else if (h.team === HUMAN && h.isBuilding && !h.built && sel.some((u) => u.kind === 'engineer')) cur = 'grab';
        else cur = 'pointer';
      } else if (h) cur = 'pointer';
      c.style.cursor = cur;
    }
  }

  // ---------------------------------------------------------------- mouse
  private onDown(e: PointerEvent): void {
    if (!this.enabled) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.mouse.x = e.offsetX; this.mouse.y = e.offsetY;
    if (e.button === 1) {
      this.panning = { x: e.clientX, y: e.clientY, cx: this.r.cam.x, cy: this.r.cam.y };
      e.preventDefault();
      return;
    }
    const wp = this.r.screenToWorld(e.offsetX, e.offsetY);
    if (e.button === 2) {
      if (this.mode.m !== 'normal') { this.setMode({ m: 'normal' }); return; }
      this.rightClick(wp.x, wp.y, e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    const md = this.mode;
    if (md.m === 'place') {
      const def = BUILDINGS[md.kind];
      if (def.wall) {
        if (!this.wallStart) { this.wallStart = { tx: Math.floor(wp.x), ty: Math.floor(wp.y) }; return; }
      } else {
        this.placeBuilding(md.kind, Math.floor(wp.x - def.size / 2 + 0.5), Math.floor(wp.y - def.size / 2 + 0.5), e.shiftKey);
        return;
      }
      return;
    }
    if (md.m === 'attack' || md.m === 'move') {
      const units = this.ownSelected().filter((u) => u.isUnit);
      const t = this.pick(wp.x, wp.y);
      if (md.m === 'attack' && t && t.team === AXIOM) this.issue({ c: 'order', ids: units.map((u) => u.id), order: { type: 'attack', id: t.id }, queue: e.shiftKey });
      else this.issue({ c: 'order', ids: units.map((u) => u.id), order: { type: md.m === 'attack' ? 'amove' : 'move', x: wp.x, y: wp.y }, queue: e.shiftKey });
      this.r.marker(wp.x, wp.y, md.m === 'attack' ? 0xff5050 : 0x60ff9a);
      this.hooks.sound('ui_command');
      if (!e.shiftKey) this.setMode({ m: 'normal' });
      return;
    }
    if (md.m === 'hack') {
      const t = this.pick(wp.x, wp.y);
      const runners = this.ownSelected().filter((u) => u.udef?.abilities?.includes('hack'));
      if (t && t.team === AXIOM && (t.udef?.hackable || t.bdef?.hackable) && !t.udef?.boss) {
        // assign the closest runner with free bandwidth
        const free = runners.filter((r) => r.links.filter((l) => this.world.get(l)).length < this.world.human.bandwidth).sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y));
        if (!free.length) { this.hooks.toast('Netrunner bandwidth full'); this.hooks.sound('ui_error'); }
        else { this.issue({ c: 'order', ids: [free[0].id], order: { type: 'hack', id: t.id }, queue: e.shiftKey }); this.hooks.sound('ui_command'); }
      } else { this.hooks.toast('Target a hackable robot (below 50% HP or stunned)'); this.hooks.sound('ui_error'); }
      if (!e.shiftKey) this.setMode({ m: 'normal' });
      return;
    }
    if (md.m === 'rally') {
      this.issue({ c: 'rally', ids: this.ownSelected().filter((b) => b.isBuilding).map((b) => b.id), x: wp.x, y: wp.y });
      this.r.marker(wp.x, wp.y, 0x9fffd0);
      this.setMode({ m: 'normal' });
      return;
    }
    if (md.m === 'protocol') {
      this.issue({ c: 'protocol', id: md.id, x: wp.x, y: wp.y });
      this.setMode({ m: 'normal' });
      return;
    }
    this.down = { x: e.offsetX, y: e.offsetY, button: 0, t: performance.now() };
  }

  private lastMoveT = 0;
  private onMove(e: PointerEvent): void {
    this.lastMoveT = performance.now();
    const rect = (this.r.app.canvas as HTMLCanvasElement).getBoundingClientRect();
    this.mouse.x = e.clientX - rect.left;
    this.mouse.y = e.clientY - rect.top;
    if (this.panning) {
      const z = this.r.cam.zoom * 32;
      this.r.cam.x = this.panning.cx - (e.clientX - this.panning.x) / z;
      this.r.cam.y = this.panning.cy - (e.clientY - this.panning.y) / z;
      return;
    }
    if (this.down) {
      const d = this.down;
      if (Math.hypot(this.mouse.x - d.x, this.mouse.y - d.y) > 5) this.r.dragRect = { x0: d.x, y0: d.y, x1: this.mouse.x, y1: this.mouse.y };
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.button === 1) { this.panning = null; return; }
    if (e.button === 0 && this.mode.m === 'place' && this.wallStart) {
      const wp = this.r.screenToWorld(this.mouse.x, this.mouse.y);
      const end = { tx: Math.floor(wp.x), ty: Math.floor(wp.y) };
      if (end.tx !== this.wallStart.tx || end.ty !== this.wallStart.ty || performance.now() - (this.down?.t ?? 0) > 50) {
        const line = wallLine(this.wallStart.tx, this.wallStart.ty, end.tx, end.ty);
        for (const t of line) this.placeBuilding('wall', t.tx, t.ty, true, true);
        this.wallStart = null;
        if (!e.shiftKey) this.setMode({ m: 'normal' });
      }
      return;
    }
    if (e.button !== 0 || !this.down) return;
    const d = this.down;
    this.down = null;
    const drag = this.r.dragRect;
    this.r.dragRect = null;
    if (drag) {
      const a = this.r.screenToWorld(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
      const b = this.r.screenToWorld(Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1));
      this.boxSelect(a.x, a.y, b.x, b.y, e.shiftKey);
    } else {
      const wp = this.r.screenToWorld(d.x, d.y);
      const t = this.pick(wp.x, wp.y);
      const now = performance.now();
      const dbl = t && this.lastClick.id === t.id && now - this.lastClick.t < 320;
      this.lastClick = { t: now, id: t ? t.id : 0 };
      if (t && (dbl || e.ctrlKey || e.metaKey) && t.team === HUMAN) this.selectSameOnScreen(t.kind, e.shiftKey);
      else if (t) {
        if (e.shiftKey && t.team === HUMAN) {
          const i = this.selection.indexOf(t.id);
          if (i >= 0) this.setSelection(this.selection.filter((x) => x !== t.id));
          else this.setSelection([...this.ownSelected().map((x) => x.id), t.id]);
        } else this.setSelection([t.id]);
        this.hooks.sound('ui_select');
      } else if (!e.shiftKey) this.setSelection([]);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const before = this.r.screenToWorld(e.offsetX, e.offsetY);
    const f = Math.exp(-e.deltaY * 0.0015);
    this.r.cam.zoom = Math.max(0.4, Math.min(2.2, this.r.cam.zoom * f));
    const after = this.r.screenToWorld(e.offsetX, e.offsetY);
    this.r.cam.x += before.x - after.x;
    this.r.cam.y += before.y - after.y;
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const w = this.world;
    const units: number[] = [], blds: number[] = [];
    for (const e of w.entities) {
      if (!e.alive || e.team !== HUMAN) continue;
      if (e.isUnit && e.x + e.radius >= x0 && e.x - e.radius <= x1 && e.y + e.radius >= y0 && e.y - e.radius <= y1) units.push(e.id);
      else if (e.isBuilding && e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1) blds.push(e.id);
    }
    const ids = units.length ? units : blds;
    if (add) this.setSelection([...new Set([...this.ownSelected().map((e) => e.id), ...ids])]);
    else this.setSelection(ids);
    if (ids.length) this.hooks.sound('ui_select');
  }

  selectSameOnScreen(kind: string, add = false): void {
    const vb = this.r.viewBounds();
    const ids = this.world.entities.filter((e) => e.alive && e.team === HUMAN && e.kind === kind && e.x >= vb.x0 && e.x <= vb.x1 && e.y >= vb.y0 && e.y <= vb.y1).map((e) => e.id);
    this.setSelection(add ? [...new Set([...this.selection, ...ids])] : ids);
  }

  private rightClick(x: number, y: number, shift: boolean): void {
    const sel = this.ownSelected();
    if (!sel.length) return;
    const t = this.pick(x, y);
    this.issue({ c: 'smart', ids: sel.map((e) => e.id), x, y, targetId: t ? t.id : 0, queue: shift });
    this.hooks.sound('ui_command');
  }

  placeBuilding(kind: string, tx: number, ty: number, queue: boolean, silent = false): void {
    const builders = this.ownSelected().filter((u) => u.udef?.abilities?.includes('build'));
    const chk = this.world.canPlace(kind, tx, ty);
    if (!chk.ok) { if (!silent) { this.hooks.toast(chk.reason ?? 'Cannot build there'); this.hooks.sound('ui_error'); } return; }
    // closest builder only for single structures; all selected for walls is wasteful
    let ids = builders.map((b) => b.id);
    if (!BUILDINGS[kind].wall && builders.length > 2 && !queue) {
      const cx = tx + BUILDINGS[kind].size / 2, cy = ty + BUILDINGS[kind].size / 2;
      ids = builders.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, 2).map((b) => b.id);
    }
    this.issue({ c: 'place', kind, tx, ty, builders: ids, queue });
    if (!queue && !BUILDINGS[kind].wall) this.setMode({ m: 'normal' });
  }

  // ---------------------------------------------------------------- keyboard
  private onKey(e: KeyboardEvent): void {
    if (!this.enabled) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    this.keys.add(e.key);
    const k = e.key;
    if (k === 'Escape') {
      if (this.mode.m !== 'normal') { this.setMode({ m: 'normal' }); return; }
      if (this.hooks.hotkey(e)) return;
      this.hooks.openMenu();
      return;
    }
    if (k === 'F10') { e.preventDefault(); this.hooks.openMenu(); return; }
    if (k === 'p' || k === 'P' || k === 'Pause') { this.hooks.togglePause(); return; }
    // control groups
    if (/^[0-9]$/.test(k)) {
      const n = +k;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups.set(n, this.ownSelected().map((x) => x.id));
        this.hooks.toast(`Group ${n} set`);
        return;
      }
      if (e.shiftKey) {
        this.groups.set(n, [...new Set([...(this.groups.get(n) ?? []), ...this.ownSelected().map((x) => x.id)])]);
        return;
      }
      const g = (this.groups.get(n) ?? []).filter((id) => this.world.get(id));
      if (!g.length) return;
      this.setSelection(g);
      const now = performance.now();
      if (this.lastGroupTap.n === n && now - this.lastGroupTap.t < 350) {
        const es = g.map((id) => this.world.get(id)!);
        this.centerOn(es.reduce((s, x) => s + x.x, 0) / es.length, es.reduce((s, x) => s + x.y, 0) / es.length);
      }
      this.lastGroupTap = { n, t: now };
      return;
    }
    if (k === ' ') {
      e.preventDefault();
      const a = this.hooks.lastAlert();
      if (a) this.centerOn(a.x, a.y);
      return;
    }
    if (k === '.' || k === '`') {
      const idle = this.world.entities.filter((x) => x.alive && x.team === HUMAN && x.kind === 'engineer' && !x.order);
      if (idle.length) {
        const cur = this.selection.length === 1 ? idle.findIndex((x) => x.id === this.selection[0]) : -1;
        const pickE = idle[(cur + 1) % idle.length];
        this.setSelection([pickE.id]);
        this.centerOn(pickE.x, pickE.y);
      } else this.hooks.toast('No idle Engineers');
      return;
    }
    if (k === 'Home') {
      const hq = this.world.entities.find((x) => x.alive && x.team === HUMAN && x.kind === 'hq');
      if (hq) this.centerOn(hq.x, hq.y);
      return;
    }
    if (this.hooks.hotkey(e)) { e.preventDefault(); return; }
  }

  // ---------------------------------------------------------------- unit commands (also used by command card)
  unitCommand(cmd: 'stop' | 'hold' | 'attack' | 'move' | 'hack' | 'rally'): void {
    const sel = this.ownSelected();
    switch (cmd) {
      case 'stop': this.issue({ c: 'stop', ids: sel.map((e) => e.id) }); break;
      case 'hold': this.issue({ c: 'order', ids: sel.filter((e) => e.isUnit).map((e) => e.id), order: { type: 'hold' } as Order }); break;
      case 'attack': this.setMode({ m: 'attack' }); break;
      case 'move': this.setMode({ m: 'move' }); break;
      case 'hack': this.setMode({ m: 'hack' }); break;
      case 'rally': this.setMode({ m: 'rally' }); break;
    }
    this.hooks.sound('ui_click');
  }
}

/** Tiles of an axis-aligned L-free straight wall line (dominant axis). */
export function wallLine(x0: number, y0: number, x1: number, y1: number): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [];
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
    const s = Math.sign(x1 - x0) || 1;
    for (let x = x0; x !== x1 + s && out.length < 40; x += s) out.push({ tx: x, ty: y0 });
  } else {
    const s = Math.sign(y1 - y0) || 1;
    for (let y = y0; y !== y1 + s && out.length < 40; y += s) out.push({ tx: x0, ty: y });
  }
  return out;
}
