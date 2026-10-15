// "Tactical noir" palette. Desaturated world, saturated team accents.

export const P = {
  // human materials
  olive: '#5b6243',
  oliveD: '#3a3f2a',
  oliveL: '#7c845c',
  khaki: '#8a7e5b',
  khakiD: '#5e553d',
  khakiL: '#ada07a',
  gun: '#4b5158',
  gunD: '#2a2e33',
  gunL: '#707880',
  leather: '#3c3026',
  boot: '#211b16',
  cloth: '#3d4236',
  charcoal: '#2d3135',
  amber: '#f2a33a',
  amberD: '#a8661c',
  amberL: '#ffd384',
  orange: '#c96f2c',
  teal: '#2fd4c4',
  tealD: '#17847b',
  tealL: '#a6fff5',
  cyan: '#35f0ff',
  // AXIOM materials
  ax0: '#0e1013',
  ax1: '#181b20',
  ax2: '#24282f',
  ax3: '#343a43',
  ax4: '#4d5560',
  ax5: '#6c7682',
  red: '#ff2a4d',
  redD: '#8f0f26',
  mag: '#ff3df0',
  // world
  conc: '#6c6a63',
  concD: '#4a4945',
  concL: '#8b887f',
  rust: '#7b4a2b',
  rustD: '#4c2d1a',
  rustL: '#a4673b',
  sand: '#8b7c57',
  sandD: '#5d5139',
  wood: '#6c5337',
  woodD: '#45351f',
  tarp: '#56603f',
  steel: '#5d646b',
  glass: '#22343a',
  black: '#0b0c0e',
};

export interface TeamPal {
  glow: string; // primary emissive (optics, seams)
  glow2: string; // secondary emissive
  hot: string; // hot core
  mark: string; // team marking colour
  hacked: boolean;
}

export const AXIOM_PAL: TeamPal = { glow: '#ff2a4d', glow2: '#ff3df0', hot: '#ffd2dc', mark: '#ff2a4d', hacked: false };
export const HACKED_PAL: TeamPal = { glow: '#35f0ff', glow2: '#2fd4c4', hot: '#e2ffff', mark: '#2fd4c4', hacked: true };
export const HUMAN_PAL: TeamPal = { glow: '#2fd4c4', glow2: '#35f0ff', hot: '#e2ffff', mark: '#2fd4c4', hacked: false };

export function robotPal(team: string): TeamPal {
  return team === 'hacked' ? HACKED_PAL : AXIOM_PAL;
}
