import type { ArmorClass, Cost, DamageType } from '../types';

export interface WeaponDef {
  type: DamageType;
  damage: number;
  cooldown: number; // seconds
  range: number; // tiles (edge-to-edge-ish: centre distance minus target radius)
  minRange?: number;
  splash?: number; // radius, linear falloff to 50% at edge
  chains?: number; // extra arc jumps
  chainRange?: number;
  projectileSpeed?: number; // tiles/s; undefined = instant (hitscan)
  melee?: boolean;
  suicide?: boolean; // dies on attack (sapper)
  vsStructure?: number; // extra multiplier vs structures
  antiAir?: boolean; // default: ranged = true, melee = false
  sfx: string;
  fx?: 'bullet' | 'rail' | 'arc' | 'rocket' | 'shell' | 'beam' | 'melee' | 'cannon';
}

export type Ability = 'harvest' | 'build' | 'repair' | 'hack' | 'repairAura' | 'stomp';

export interface UnitDef {
  kind: string;
  name: string;
  side: 'human' | 'axiom';
  hp: number;
  armor: ArmorClass;
  speed: number; // tiles/s
  radius: number; // collision radius in tiles
  sight: number;
  weapon?: WeaponDef;
  cost: Cost;
  pop: number;
  buildTime: number; // seconds
  from?: string; // producing building
  requires?: string[]; // building kinds or research ids
  flying?: boolean;
  hackable?: boolean;
  boss?: boolean;
  /** AXIOM: compute cost and minimum threat level */
  compute?: number;
  threat?: number;
  dataValue?: number;
  scrapValue?: number;
  wreck?: 'small' | 'medium' | 'large';
  abilities?: Ability[];
  hotkey?: string;
  desc: string;
  turret?: boolean; // has separate turret sprite
}

export interface BuildingDef {
  kind: string;
  name: string;
  side: 'human' | 'axiom' | 'neutral';
  size: number;
  hp: number;
  cost: Cost;
  power: number; // + supplies, - consumes
  pop?: number;
  sight: number;
  weapon?: WeaponDef;
  trains?: string[];
  research?: boolean;
  dropoff?: boolean;
  requires?: string[];
  buildTime: number;
  hotkey?: string;
  desc: string;
  turret?: boolean;
  wall?: boolean;
  dataValue?: number;
  /** AXIOM: grid emission radius */
  creepRadius?: number;
  compute?: number;
  hackable?: boolean;
}

export interface ResearchDef {
  id: string;
  name: string;
  cost: Cost;
  time: number;
  requires?: string[];
  hotkey: string;
  desc: string;
}

export interface ProtocolDef {
  id: string;
  name: string;
  data: number;
  cooldown: number;
  radius: number;
  requires?: string;
  hotkey: string;
  desc: string;
}

// ---------------------------------------------------------------- weapons
const W = {
  rifle: { type: 'kinetic', damage: 8, cooldown: 0.8, range: 5.5, sfx: 'rifle', fx: 'bullet' },
  arc: { type: 'energy', damage: 11, cooldown: 1.2, range: 4, chains: 2, chainRange: 2.5, sfx: 'arc', fx: 'arc' },
  rocket: { type: 'explosive', damage: 34, cooldown: 2.4, range: 6.5, splash: 0.9, projectileSpeed: 11, sfx: 'rocket_launch', fx: 'rocket' },
  netpistol: { type: 'energy', damage: 4, cooldown: 1, range: 5, sfx: 'zap_small', fx: 'beam' },
  rail: { type: 'kinetic', damage: 48, cooldown: 3, range: 9, sfx: 'rail', fx: 'rail' },
  cannon: { type: 'kinetic', damage: 30, cooldown: 1.6, range: 6, sfx: 'cannon', fx: 'cannon' },
  voltArc: { type: 'energy', damage: 20, cooldown: 1, range: 5, chains: 3, chainRange: 2.8, sfx: 'tesla', fx: 'arc' },
  artillery: { type: 'explosive', damage: 70, cooldown: 4, range: 12, minRange: 3, splash: 2, projectileSpeed: 9, sfx: 'artillery_fire', fx: 'shell', antiAir: false },
  turretMg: { type: 'kinetic', damage: 9, cooldown: 0.45, range: 7, sfx: 'mg_turret', fx: 'bullet' },
  teslaCoil: { type: 'energy', damage: 22, cooldown: 1.4, range: 5, chains: 4, chainRange: 3, sfx: 'tesla', fx: 'arc' },
  missileBat: { type: 'explosive', damage: 42, cooldown: 2.6, range: 9, splash: 1.2, projectileSpeed: 13, sfx: 'missile', fx: 'rocket' },
  // AXIOM
  bite: { type: 'kinetic', damage: 5, cooldown: 0.6, range: 0.35, melee: true, sfx: 'skitter_bite', fx: 'melee' },
  gunner: { type: 'kinetic', damage: 7, cooldown: 0.9, range: 5, sfx: 'robot_shot', fx: 'bullet' },
  sapper: { type: 'explosive', damage: 120, cooldown: 1, range: 0.4, melee: true, suicide: true, splash: 1.5, vsStructure: 3, sfx: 'explosion_big', fx: 'melee' },
  slam: { type: 'kinetic', damage: 32, cooldown: 1.4, range: 0.5, melee: true, vsStructure: 1.5, sfx: 'brute_slam', fx: 'melee' },
  lance: { type: 'energy', damage: 20, cooldown: 1.6, range: 7, sfx: 'lancer_beam', fx: 'beam' },
  sting: { type: 'energy', damage: 6, cooldown: 0.5, range: 4, sfx: 'zap_small', fx: 'beam' },
  colossus: { type: 'explosive', damage: 80, cooldown: 2.5, range: 7, splash: 2, projectileSpeed: 10, sfx: 'artillery_fire', fx: 'shell' },
  lancet: { type: 'energy', damage: 18, cooldown: 1.2, range: 7, sfx: 'lancer_beam', fx: 'beam' },
  core: { type: 'energy', damage: 30, cooldown: 1.5, range: 8, chains: 3, chainRange: 3, sfx: 'tesla', fx: 'arc' },
} satisfies Record<string, WeaponDef>;

// ---------------------------------------------------------------- units
export const UNITS: Record<string, UnitDef> = {
  engineer: {
    kind: 'engineer', name: 'Engineer', side: 'human', hp: 60, armor: 'light', speed: 2.7, radius: 0.3, sight: 6,
    cost: { scrap: 50 }, pop: 1, buildTime: 12, from: 'hq', abilities: ['harvest', 'build', 'repair'], hotkey: 'E',
    desc: 'Harvests scrap, constructs and repairs structures and vehicles.',
  },
  rifleman: {
    kind: 'rifleman', name: 'Rifleman', side: 'human', hp: 90, armor: 'light', speed: 2.6, radius: 0.3, sight: 7,
    weapon: W.rifle, cost: { scrap: 60 }, pop: 1, buildTime: 14, from: 'barracks', hotkey: 'Q',
    desc: 'Cheap line infantry. Kinetic rifle.',
  },
  arc_trooper: {
    kind: 'arc_trooper', name: 'Arc Trooper', side: 'human', hp: 85, armor: 'light', speed: 2.6, radius: 0.3, sight: 7,
    weapon: W.arc, cost: { scrap: 90 }, pop: 1, buildTime: 18, from: 'barracks', hotkey: 'W',
    desc: 'Energy arc that chains between targets. Shreds swarms.',
  },
  rocketeer: {
    kind: 'rocketeer', name: 'Rocketeer', side: 'human', hp: 80, armor: 'light', speed: 2.4, radius: 0.3, sight: 7.5,
    weapon: W.rocket, cost: { scrap: 100 }, pop: 1, buildTime: 20, from: 'barracks', hotkey: 'R',
    desc: 'Explosive rockets. Strong against armored robots and structures.',
  },
  netrunner: {
    kind: 'netrunner', name: 'Netrunner', side: 'human', hp: 70, armor: 'light', speed: 2.6, radius: 0.3, sight: 8,
    weapon: W.netpistol, cost: { scrap: 110, data: 15 }, pop: 1, buildTime: 22, from: 'barracks', requires: ['lab'],
    abilities: ['hack'], hotkey: 'T',
    desc: 'Hacks robots below 50% HP or stunned, turning them to your side. If the Netrunner dies, its hacked units revert.',
  },
  ranger: {
    kind: 'ranger', name: 'Ranger', side: 'human', hp: 75, armor: 'light', speed: 2.5, radius: 0.3, sight: 10,
    weapon: W.rail, cost: { scrap: 140, data: 10 }, pop: 1, buildTime: 24, from: 'barracks', requires: ['railguns'], hotkey: 'Y',
    desc: 'Long-range railgun sniper. High kinetic damage per shot.',
  },
  bulldog: {
    kind: 'bulldog', name: 'Bulldog Tank', side: 'human', hp: 650, armor: 'armored', speed: 2.1, radius: 0.7, sight: 7.5,
    weapon: W.cannon, cost: { scrap: 240 }, pop: 3, buildTime: 30, from: 'factory', hotkey: 'Q', turret: true,
    desc: 'Main battle tank. Durable kinetic cannon.',
  },
  volt: {
    kind: 'volt', name: 'Volt Carrier', side: 'human', hp: 450, armor: 'armored', speed: 2.2, radius: 0.7, sight: 7,
    weapon: W.voltArc, cost: { scrap: 260, data: 20 }, pop: 3, buildTime: 32, from: 'factory', requires: ['lab'], hotkey: 'W', turret: true,
    desc: 'Mobile tesla coil. Chains energy through packed swarms.',
  },
  thumper: {
    kind: 'thumper', name: 'Thumper Artillery', side: 'human', hp: 300, armor: 'armored', speed: 1.8, radius: 0.75, sight: 6,
    weapon: W.artillery, cost: { scrap: 300, data: 30 }, pop: 3, buildTime: 36, from: 'factory', requires: ['lab'], hotkey: 'E', turret: true,
    desc: 'Long-range explosive artillery. Cannot fire at close range or at air.',
  },

  // ------------------------------------------------------------- AXIOM
  skitter: {
    kind: 'skitter', name: 'Skitter', side: 'axiom', hp: 40, armor: 'light', speed: 3.6, radius: 0.28, sight: 6,
    weapon: W.bite, cost: { scrap: 0 }, pop: 0, buildTime: 3, compute: 6, threat: 1, dataValue: 1, scrapValue: 8, wreck: 'small', hackable: true,
    desc: 'Fast spider swarmling.',
  },
  gunner: {
    kind: 'gunner', name: 'Gunner', side: 'axiom', hp: 110, armor: 'light', speed: 2.4, radius: 0.36, sight: 7,
    weapon: W.gunner, cost: { scrap: 0 }, pop: 0, buildTime: 5, compute: 14, threat: 1, dataValue: 2, scrapValue: 15, wreck: 'small', hackable: true,
    desc: 'Ranged line bot with twin kinetic barrels.',
  },
  sapper: {
    kind: 'sapper', name: 'Sapper', side: 'axiom', hp: 60, armor: 'light', speed: 3.0, radius: 0.32, sight: 6,
    weapon: W.sapper, cost: { scrap: 0 }, pop: 0, buildTime: 5, compute: 16, threat: 2, dataValue: 2, scrapValue: 10, wreck: 'small', hackable: true,
    desc: 'Volatile core. Detonates against structures.',
  },
  brute: {
    kind: 'brute', name: 'Brute', side: 'axiom', hp: 520, armor: 'armored', speed: 1.8, radius: 0.72, sight: 6,
    weapon: W.slam, cost: { scrap: 0 }, pop: 0, buildTime: 10, compute: 45, threat: 3, dataValue: 6, scrapValue: 45, wreck: 'large', hackable: true,
    desc: 'Armored siege walker. Smashes walls.',
  },
  lancer: {
    kind: 'lancer', name: 'Lancer', side: 'axiom', hp: 160, armor: 'light', speed: 2.4, radius: 0.38, sight: 8,
    weapon: W.lance, cost: { scrap: 0 }, pop: 0, buildTime: 8, compute: 28, threat: 4, dataValue: 4, scrapValue: 25, wreck: 'medium', hackable: true,
    desc: 'Long-range energy lance. Hunts infantry.',
  },
  wasp: {
    kind: 'wasp', name: 'Wasp', side: 'axiom', hp: 90, armor: 'light', speed: 4.0, radius: 0.35, sight: 7,
    weapon: W.sting, cost: { scrap: 0 }, pop: 0, buildTime: 6, compute: 18, threat: 5, dataValue: 3, scrapValue: 15, wreck: 'small', hackable: true, flying: true,
    desc: 'Flying drone. Ignores walls and terrain.',
  },
  warden: {
    kind: 'warden', name: 'Warden', side: 'axiom', hp: 300, armor: 'armored', speed: 2.0, radius: 0.55, sight: 7,
    cost: { scrap: 0 }, pop: 0, buildTime: 10, compute: 40, threat: 6, dataValue: 6, scrapValue: 35, wreck: 'medium', hackable: true,
    abilities: ['repairAura'],
    desc: 'Support drone that repairs nearby robots.',
  },
  colossus: {
    kind: 'colossus', name: 'Colossus', side: 'axiom', hp: 6000, armor: 'armored', speed: 1.2, radius: 1.5, sight: 9,
    weapon: W.colossus, cost: { scrap: 0 }, pop: 0, buildTime: 30, compute: 400, threat: 99, dataValue: 60, scrapValue: 300, wreck: 'large', boss: true,
    abilities: ['stomp'],
    desc: 'Siege walker boss. Leads Cascades. Cannot be hacked.',
  },
};

// ---------------------------------------------------------------- buildings
export const BUILDINGS: Record<string, BuildingDef> = {
  hq: {
    kind: 'hq', name: 'Command HQ', side: 'human', size: 4, hp: 3000, cost: { scrap: 400 }, power: 5, pop: 10, sight: 9,
    trains: ['engineer'], dropoff: true, buildTime: 60, desc: 'Trains Engineers. Scrap drop-off. Lose every HQ and the resistance falls.',
  },
  generator: {
    kind: 'generator', name: 'Generator', side: 'human', size: 2, hp: 500, cost: { scrap: 100 }, power: 12, sight: 4, buildTime: 15,
    hotkey: 'G', desc: '+12 power.',
  },
  habitat: {
    kind: 'habitat', name: 'Habitat', side: 'human', size: 2, hp: 450, cost: { scrap: 80 }, power: 0, pop: 8, sight: 4, buildTime: 15,
    hotkey: 'H', desc: '+8 population capacity.',
  },
  depot: {
    kind: 'depot', name: 'Scrap Depot', side: 'human', size: 2, hp: 700, cost: { scrap: 100 }, power: 0, sight: 8, buildTime: 18,
    dropoff: true, hotkey: 'D', desc: 'Forward scrap drop-off point.',
  },
  barracks: {
    kind: 'barracks', name: 'Barracks', side: 'human', size: 3, hp: 1000, cost: { scrap: 150 }, power: -3, sight: 5, buildTime: 25,
    trains: ['rifleman', 'arc_trooper', 'rocketeer', 'netrunner', 'ranger'], hotkey: 'B', desc: 'Trains infantry.',
  },
  factory: {
    kind: 'factory', name: 'Factory', side: 'human', size: 3, hp: 1400, cost: { scrap: 250 }, power: -5, sight: 5, buildTime: 35,
    trains: ['bulldog', 'volt', 'thumper'], requires: ['barracks'], hotkey: 'F', desc: 'Builds vehicles.',
  },
  lab: {
    kind: 'lab', name: 'Research Lab', side: 'human', size: 3, hp: 900, cost: { scrap: 200 }, power: -4, sight: 5, buildTime: 30,
    research: true, requires: ['barracks'], hotkey: 'L', desc: 'Researches upgrades with Data. Unlocks advanced units.',
  },
  wall: {
    kind: 'wall', name: 'Wall', side: 'human', size: 1, hp: 450, cost: { scrap: 10 }, power: 0, sight: 2, buildTime: 4, wall: true,
    hotkey: 'V', desc: 'Blocks ground robots. Drag to build a line.',
  },
  gun_turret: {
    kind: 'gun_turret', name: 'Gun Turret', side: 'human', size: 2, hp: 600, cost: { scrap: 120 }, power: -2, sight: 8, buildTime: 20,
    weapon: W.turretMg, turret: true, hotkey: 'T', desc: 'Kinetic machine-gun emplacement.',
  },
  tesla: {
    kind: 'tesla', name: 'Tesla Coil', side: 'human', size: 2, hp: 600, cost: { scrap: 160 }, power: -4, sight: 7, buildTime: 24,
    weapon: W.teslaCoil, turret: true, requires: ['lab'], hotkey: 'Y', desc: 'Energy arcs chain through up to 5 robots.',
  },
  missile: {
    kind: 'missile', name: 'Missile Battery', side: 'human', size: 2, hp: 550, cost: { scrap: 180 }, power: -3, sight: 10, buildTime: 24,
    weapon: W.missileBat, turret: true, requires: ['lab'], hotkey: 'U', desc: 'Long-range explosive missiles. Anti-armor.',
  },
  sensor: {
    kind: 'sensor', name: 'Sensor Tower', side: 'human', size: 2, hp: 300, cost: { scrap: 80 }, power: -1, sight: 14, buildTime: 15,
    hotkey: 'S', desc: 'Wide vision radius.',
  },

  // ------------------------------------------------------------- AXIOM
  core: {
    kind: 'core', name: 'AXIOM Core', side: 'axiom', size: 5, hp: 12000, cost: { scrap: 0 }, power: 0, sight: 10, buildTime: 1,
    weapon: W.core, creepRadius: 11, compute: 0.4, dataValue: 0, desc: 'The heart of AXIOM. Destroy it to end the war.',
  },
  fabricator: {
    kind: 'fabricator', name: 'Fabricator', side: 'axiom', size: 3, hp: 2400, cost: { scrap: 0 }, power: 0, sight: 7, buildTime: 30,
    creepRadius: 7, compute: 0.25, dataValue: 80, desc: 'Produces robots.',
  },
  relay: {
    kind: 'relay', name: 'Relay', side: 'axiom', size: 2, hp: 700, cost: { scrap: 0 }, power: 0, sight: 6, buildTime: 12,
    creepRadius: 6, compute: 0.08, dataValue: 25, desc: 'Extends the Grid. Robots on the Grid move faster and self-repair.',
  },
  vault: {
    kind: 'vault', name: 'Data Vault', side: 'axiom', size: 3, hp: 3000, cost: { scrap: 0 }, power: 0, sight: 6, buildTime: 1,
    creepRadius: 4, compute: 0.15, dataValue: 150, desc: "Stores AXIOM's learned model. Destroy it to cause Catastrophic Forgetting.",
  },
  lancet: {
    kind: 'lancet', name: 'Lancet', side: 'axiom', size: 2, hp: 900, cost: { scrap: 0 }, power: 0, sight: 8, buildTime: 15,
    weapon: W.lancet, turret: true, dataValue: 20, hackable: true, desc: 'AXIOM energy turret. Can be hacked.',
  },
  server_farm: {
    kind: 'server_farm', name: 'Server Farm', side: 'neutral', size: 3, hp: 99999, cost: { scrap: 0 }, power: 0, sight: 6, buildTime: 1,
    desc: 'Capture by holding the area. Humans gain Data; AXIOM gains Compute.',
  },
};

export const HUMAN_BUILDABLE = ['generator', 'habitat', 'depot', 'barracks', 'factory', 'lab', 'wall', 'gun_turret', 'tesla', 'missile', 'sensor', 'hq'];

// ---------------------------------------------------------------- research
export const RESEARCH: Record<string, ResearchDef> = {
  railguns: { id: 'railguns', name: 'Railguns', cost: { scrap: 100, data: 40 }, time: 40, hotkey: 'Q', desc: 'Unlocks the Ranger sniper.' },
  kinetic1: { id: 'kinetic1', name: 'Tungsten Rounds', cost: { scrap: 100, data: 30 }, time: 35, hotkey: 'W', desc: '+20% Kinetic damage.' },
  kinetic2: { id: 'kinetic2', name: 'Depleted Cores', cost: { scrap: 200, data: 80 }, time: 50, requires: ['kinetic1'], hotkey: 'W', desc: '+20% Kinetic damage.' },
  energy1: { id: 'energy1', name: 'Capacitor Banks', cost: { scrap: 100, data: 30 }, time: 35, hotkey: 'E', desc: '+20% Energy damage.' },
  energy2: { id: 'energy2', name: 'Plasma Coils', cost: { scrap: 200, data: 80 }, time: 50, requires: ['energy1'], hotkey: 'E', desc: '+20% Energy damage.' },
  explosive1: { id: 'explosive1', name: 'Shaped Charges', cost: { scrap: 100, data: 30 }, time: 35, hotkey: 'R', desc: '+20% Explosive damage.' },
  explosive2: { id: 'explosive2', name: 'Thermobarics', cost: { scrap: 200, data: 80 }, time: 50, requires: ['explosive1'], hotkey: 'R', desc: '+20% Explosive damage.' },
  armor1: { id: 'armor1', name: 'Composite Armor', cost: { scrap: 150, data: 40 }, time: 40, hotkey: 'A', desc: '+15% HP for all units.' },
  armor2: { id: 'armor2', name: 'Reactive Plating', cost: { scrap: 250, data: 90 }, time: 55, requires: ['armor1'], hotkey: 'A', desc: '+15% HP for all units.' },
  salvage: { id: 'salvage', name: 'Salvage Protocols', cost: { scrap: 75, data: 25 }, time: 30, hotkey: 'S', desc: '+30% harvest speed. Wrecks yield +50% scrap.' },
  bandwidth: { id: 'bandwidth', name: 'Expanded Bandwidth', cost: { scrap: 120, data: 50 }, time: 40, hotkey: 'D', desc: 'Netrunners control 5 robots and hack 1 s faster.' },
  proto_emp: { id: 'proto_emp', name: 'Protocol: EMP Burst', cost: { scrap: 100, data: 40 }, time: 30, hotkey: 'Z', desc: 'Unlocks EMP Burst: stun robots in an area.' },
  proto_orbital: { id: 'proto_orbital', name: 'Protocol: Orbital Strike', cost: { scrap: 200, data: 80 }, time: 45, hotkey: 'X', desc: 'Unlocks Orbital Strike.' },
  proto_override: { id: 'proto_override', name: 'Protocol: Override', cost: { scrap: 200, data: 100 }, time: 50, requires: ['bandwidth'], hotkey: 'C', desc: 'Unlocks Override: mass-hack robots for 60 s.' },
};

export const PROTOCOLS: Record<string, ProtocolDef> = {
  supply: { id: 'supply', name: 'Supply Drop', data: 40, cooldown: 90, radius: 1.5, hotkey: 'F5', desc: '+200 scrap delivered by air.' },
  emp: { id: 'emp', name: 'EMP Burst', data: 30, cooldown: 60, radius: 5, requires: 'proto_emp', hotkey: 'F6', desc: 'Stun robots in radius 5 for 5 s.' },
  orbital: { id: 'orbital', name: 'Orbital Strike', data: 60, cooldown: 90, radius: 3.5, requires: 'proto_orbital', hotkey: 'F7', desc: '2 s delay, then 400 explosive damage.' },
  override: { id: 'override', name: 'Override', data: 80, cooldown: 120, radius: 4, requires: 'proto_override', hotkey: 'F8', desc: 'Hack up to 8 non-boss robots for 60 s.' },
};

export function isUnitKind(kind: string): boolean {
  return kind in UNITS;
}
export function isBuildingKind(kind: string): boolean {
  return kind in BUILDINGS;
}
