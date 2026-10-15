export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

export type Team = 0 | 1 | 2;
export const NEUTRAL: Team = 0;
export const HUMAN: Team = 1;
export const AXIOM: Team = 2;

export type DamageType = 'kinetic' | 'energy' | 'explosive';
export const DAMAGE_TYPES: DamageType[] = ['kinetic', 'energy', 'explosive'];
export type ArmorClass = 'light' | 'armored' | 'structure';

/** damage multiplier table [damageType][armorClass] */
export const TYPE_VS_ARMOR: Record<DamageType, Record<ArmorClass, number>> = {
  kinetic: { light: 1.0, armored: 0.6, structure: 0.5 },
  energy: { light: 1.15, armored: 0.8, structure: 0.6 },
  explosive: { light: 0.7, armored: 1.5, structure: 1.5 },
};

/** Overfit cycle: adapting to key makes AXIOM vulnerable to value */
export const COUNTER_OF: Record<DamageType, DamageType> = {
  kinetic: 'energy',
  energy: 'explosive',
  explosive: 'kinetic',
};

export type Difficulty = 'recruit' | 'veteran' | 'nightmare';
export type GameMode = 'campaign' | 'skirmish' | 'endless';

export interface Pt { x: number; y: number }

export interface Cost { scrap: number; data?: number }

export type Terrain = 0 | 1 | 2 | 3 | 4 | 5;
export const T_GROUND = 0;
export const T_ROAD = 1;
export const T_RUBBLE = 2;
export const T_WATER = 3;
export const T_RUIN = 4;
export const T_PARK = 5;

export interface SimEvent {
  t: string;
  x?: number;
  y?: number;
  [k: string]: unknown;
}
