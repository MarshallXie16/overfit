// Public sound names. The order here is also the preview/test order.
export const SFX_NAMES = [
  'rifle', 'rail', 'arc', 'zap_small', 'rocket_launch', 'cannon', 'artillery_fire', 'mg_turret', 'tesla', 'missile',
  'explosion_small', 'explosion_big', 'explosion_huge', 'impact_metal', 'bullet_hit',
  'skitter_bite', 'robot_shot', 'lancer_beam', 'brute_slam', 'sapper_beep', 'wasp_buzz', 'colossus_stomp', 'colossus_horn',
  'robot_die', 'robot_die_big', 'human_die', 'building_collapse',
  'hack_start', 'hack_success', 'hack_revert', 'emp', 'orbital_warn', 'orbital_strike', 'supply_drop',
  'build_place', 'build_done', 'unit_ready', 'research_done', 'harvest', 'deposit', 'repair',
  'ui_click', 'ui_hover', 'ui_error', 'ui_select', 'ui_command', 'ui_open',
  'surge_siren', 'alert', 'alert_attack', 'epoch', 'forgetting', 'victory', 'defeat', 'radio',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

export type MusicTrack = 'menu' | 'game' | 'none';
export type StingerKind = 'surge' | 'victory' | 'defeat' | 'epoch';

export interface PlayOpts {
  /** World x in tiles. Omit x/y for UI / non-positional sounds. */
  x?: number;
  /** World y in tiles. */
  y?: number;
  /** Linear volume multiplier (default 1). */
  vol?: number;
  /** Playback-rate multiplier (default 1; 2 = one octave up). */
  pitch?: number;
}

export interface VolumeSettings {
  master?: number;
  sfx?: number;
  music?: number;
}
