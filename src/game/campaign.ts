import { HUMAN } from '../sim/types';
import { at, completeObjective, MISSIONS, once, setObjective, win, type MissionDef } from './missions';

const m1: MissionDef = {
  id: 'first-light',
  index: 1,
  name: 'First Light',
  subtitle: 'Operation 1 — The Outskirts',
  briefing: [
    'Commander, AXIOM went dark nine days ago. Then the machines came out of the logistics hubs.',
    'We have one Command HQ, four Engineers and a rifle squad. Get the scrap flowing, fortify, and survive what comes next.',
    'Then find the nearest AXIOM Relay and take it down. Show it we can hit back.',
  ],
  seed: 1101,
  mapSize: 80,
  difficulty: 'recruit',
  gen: { fabricators: 1, relays: 2, vaults: 0, lancets: 0, farms: 1, axiomReach: 0.38, startUnits: { engineer: 4, rifleman: 4 } },
  setup(w) {
    w.axiom.surgeT = 260;
    w.axiom.tuning.raids = false;
    w.axiom.tuning.expand = false;
  },
  script(w) {
    once(w, 'intro', at(w, 1), () => {
      w.radio('Lt. Reyes', 'Commander, Engineers are standing by. Select them and right-click a scrap pile to start harvesting.');
      setObjective(w, 'gen', 'Build a Generator (select an Engineer, press B, then G)');
      setObjective(w, 'bar', 'Build a Barracks');
    });
    const has = (k: string) => w.countBuildings(HUMAN, k) > 0;
    once(w, 'gen', has('generator'), () => completeObjective(w, 'gen'));
    once(w, 'bar', has('barracks'), () => {
      completeObjective(w, 'bar');
      w.radio('Lt. Reyes', 'Barracks online. Train Riflemen and Arc Troopers — and put a Gun Turret between us and the Grid.');
      setObjective(w, 'surge', 'Survive the first Surge');
    });
    once(w, 'surge', w.human.stats.surgesSurvived >= 1, () => {
      completeObjective(w, 'surge');
      w.radio('Dr. Okafor', 'AXIOM\'s Relays project the Grid — that red circuitry. Robots on it move faster and repair. Destroy a Relay.');
      setObjective(w, 'relay', 'Destroy an AXIOM Relay');
      w.flags.relays0 = w.countBuildings(2, 'relay', false);
    });
    once(w, 'relay', !!w.flags['once:surge'] && w.countBuildings(2, 'relay', false) < (w.flags.relays0 as number), () => {
      completeObjective(w, 'relay');
      win(w, 'The Relay is down. The Grid recedes — for now.');
    });
  },
};

MISSIONS.push(m1);
