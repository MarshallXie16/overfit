// OVERFIT audio — fully synthesised WebAudio SFX + adaptive procedural music.
// No audio files. Safe to import in Node (nothing touches WebAudio until init()).
//
//   import { audio } from '../audio';
//   button.onclick = () => audio.init();          // must be inside a user gesture
//   audio.setListener(cam.x, cam.y, viewHalfWidthTiles);
//   audio.play('rifle', { x, y });                // positional (world tiles)
//   audio.play('ui_click');                       // UI / non-positional
//   audio.music('game'); audio.setIntensity(0.6);
//   audio.stinger('surge');
//   audio.setBackground(document.visibilityState === 'hidden'); // suspend/resume with the tab

import { AudioEngine } from './engine';

export { AudioEngine } from './engine';
export type { AudioStats } from './engine';
export type { MusicStats } from './music';
export { SFX_NAMES } from './types';
export type { SfxName, PlayOpts, MusicTrack, StingerKind, VolumeSettings } from './types';
export { renderSfxOffline, renderMixOffline, measureChain, sfxMeta, ALL_SOUND_IDS } from './testing';

/** The game-wide audio singleton. */
export const audio: AudioEngine = new AudioEngine();
