// audio.html — manual audition bench + test hooks for tools/audio-check.mjs.

import {
  audio, SFX_NAMES, renderSfxOffline, renderMixOffline, measureChain, sfxMeta, ALL_SOUND_IDS,
  type SfxName, type MusicTrack, type StingerKind,
} from './index';

const VIEW_R = 20;

const GROUPS: Array<[string, (n: string) => boolean]> = [
  ['Weapons', (n) => ['rifle', 'rail', 'arc', 'zap_small', 'rocket_launch', 'cannon', 'artillery_fire', 'mg_turret', 'tesla', 'missile'].includes(n)],
  ['Impacts & explosions', (n) => n.startsWith('explosion') || n === 'impact_metal' || n === 'bullet_hit'],
  ['AXIOM', (n) => ['skitter_bite', 'robot_shot', 'lancer_beam', 'brute_slam', 'sapper_beep', 'wasp_buzz', 'colossus_stomp', 'colossus_horn'].includes(n)],
  ['Deaths', (n) => n.endsWith('_die') || n.endsWith('_die_big') || n === 'building_collapse'],
  ['Hacking & powers', (n) => n.startsWith('hack') || ['emp', 'orbital_warn', 'orbital_strike', 'supply_drop'].includes(n)],
  ['Build & economy', (n) => ['build_place', 'build_done', 'unit_ready', 'research_done', 'harvest', 'deposit', 'repair'].includes(n)],
  ['UI', (n) => n.startsWith('ui_')],
  ['Alerts & stingers', (n) => ['surge_siren', 'alert', 'alert_attack', 'epoch', 'forgetting', 'victory', 'defeat', 'radio'].includes(n)],
];

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing #' + id);
  return el as T;
};

let analyser: AnalyserNode | null = null;
let meterBuf: Float32Array<ArrayBuffer> | null = null;
let peakHold = 0;

async function start(): Promise<void> {
  await audio.init();
  if (!analyser) {
    analyser = audio._tapOutput();
    if (analyser) meterBuf = new Float32Array(analyser.fftSize);
  }
}

// Any interaction unlocks audio (the init call happens inside the gesture).
document.addEventListener('pointerdown', () => { void start(); }, { capture: true });
document.addEventListener('keydown', () => { void start(); }, { capture: true });

function log(msg: string): void {
  const el = $('log');
  el.textContent = (msg + '\n' + (el.textContent ?? '')).slice(0, 4000);
}

function playOpts(): { x?: number; y?: number } {
  const pos = $<HTMLInputElement>('posmode').checked;
  if (!pos) return {};
  return { x: Number($<HTMLInputElement>('posx').value) * VIEW_R, y: 0 };
}

// ---------------------------------------------------------------- build UI

const groupsEl = $('groups');
const placed = new Set<string>();
for (const [title, test] of GROUPS) {
  const sec = document.createElement('section');
  const h = document.createElement('h2');
  h.textContent = title;
  sec.appendChild(h);
  const row = document.createElement('div');
  row.className = 'row';
  for (const n of SFX_NAMES) {
    if (placed.has(n) || !test(n)) continue;
    placed.add(n);
    const b = document.createElement('button');
    b.textContent = n;
    b.addEventListener('click', async () => {
      await start();
      audio.play(n as SfxName, playOpts());
    });
    row.appendChild(b);
  }
  sec.appendChild(row);
  groupsEl.appendChild(sec);
}
const rest = SFX_NAMES.filter((n) => !placed.has(n));
if (rest.length) log('ungrouped: ' + rest.join(', '));

for (const k of ['master', 'sfx', 'music'] as const) {
  const input = $<HTMLInputElement>('v-' + k);
  input.addEventListener('input', () => {
    $('v-' + k + '-v').textContent = Number(input.value).toFixed(2);
    audio.setVolumes({ [k]: Number(input.value) });
  });
}

const intensity = $<HTMLInputElement>('intensity');
intensity.addEventListener('input', () => {
  $('intensity-v').textContent = Number(intensity.value).toFixed(2);
  audio.setIntensity(Number(intensity.value));
});

const posx = $<HTMLInputElement>('posx');
posx.addEventListener('input', () => { $('posx-v').textContent = Number(posx.value).toFixed(2); });

let paused = false;
$('pause').addEventListener('click', () => {
  paused = !paused;
  audio.setPaused(paused);
  $('pause').textContent = 'pause: ' + (paused ? 'on' : 'off');
  $('pause').classList.toggle('on', paused);
});

document.querySelectorAll<HTMLButtonElement>('[data-music]').forEach((b) => {
  b.addEventListener('click', async () => {
    await start();
    audio.music(b.dataset.music as MusicTrack);
    document.querySelectorAll('[data-music]').forEach((x) => x.classList.toggle('on', x === b && b.dataset.music !== 'none'));
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-stinger]').forEach((b) => {
  b.addEventListener('click', async () => {
    await start();
    audio.stinger(b.dataset.stinger as StingerKind);
  });
});

/** Fire `count` random sounds (85% positional, random spots near the camera) over `ms`. */
function burst(count: number, ms: number): Promise<{ fired: number; thrown: number; played: number; dropped: number; culled: number; stolen: number; peakVoices: number }> {
  const s0 = { ...audio.stats };
  let fired = 0, thrown = 0;
  const ticks = Math.max(1, Math.round(ms / 10));
  audio.setListener(0, 0, VIEW_R);
  return new Promise((resolve) => {
    let tick = 0;
    const step = (): void => {
      const n = Math.round(((tick + 1) * count) / ticks) - fired;
      for (let i = 0; i < n; i++) {
        const name = SFX_NAMES[Math.floor(Math.random() * SFX_NAMES.length)];
        const pos = Math.random() < 0.85;
        try {
          audio.play(name, pos ? { x: (Math.random() * 2 - 1) * 45, y: (Math.random() * 2 - 1) * 25, vol: 0.5 + Math.random() * 0.5 } : {});
        } catch {
          thrown++;
        }
        fired++;
      }
      tick++;
      if (tick < ticks) setTimeout(step, 10);
      else {
        const s = audio.stats;
        resolve({
          fired, thrown,
          played: s.played - s0.played, dropped: s.dropped - s0.dropped, culled: s.culled - s0.culled,
          stolen: s.stolen - s0.stolen, peakVoices: s.peakVoices,
        });
      }
    };
    step();
  });
}

$('burst').addEventListener('click', async () => {
  await start();
  const r = await burst(300, 1000);
  log(`burst: fired ${r.fired}, played ${r.played}, dropped ${r.dropped}, culled ${r.culled}, stolen ${r.stolen}, peak voices ${r.peakVoices}, thrown ${r.thrown}`);
});

// ---------------------------------------------------------------- status

function frame(): void {
  const d = audio._debug();
  const s = audio.stats;
  const m = audio.musicStats;
  $('status').textContent =
    `ctx ${d.state} t=${d.time.toFixed(1)}s ${d.sampleRate}Hz  bank ${d.bankSounds}  ready ${audio.ready}  voices ${d.voices}/${s.peakVoices}  ` +
    `played ${s.played} dropped ${s.dropped} culled ${s.culled} stolen ${s.stolen}` +
    (m ? `  |  music ${m.track} i=${m.intensity.toFixed(2)} steps ${m.steps} notes ${m.notes} sections ${m.sections}` : '');
  if (analyser && meterBuf) {
    analyser.getFloatTimeDomainData(meterBuf);
    let pk = 0, acc = 0;
    for (let i = 0; i < meterBuf.length; i++) {
      const v = meterBuf[i];
      acc += v * v;
      if (Math.abs(v) > pk) pk = Math.abs(v);
    }
    const rms = Math.sqrt(acc / meterBuf.length);
    peakHold = Math.max(pk, peakHold * 0.97);
    $('m-rms').style.width = Math.min(100, rms * 200) + '%';
    $('m-pk').style.left = Math.min(99, peakHold * 100) + '%';
    $('m-txt').textContent = `rms ${rms.toFixed(3)}  peak ${peakHold.toFixed(3)}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- test hooks

(window as unknown as Record<string, unknown>).__audioTest = {
  audio, SFX_NAMES, ALL_SOUND_IDS, renderSfxOffline, renderMixOffline, measureChain, sfxMeta, burst, start,
};
