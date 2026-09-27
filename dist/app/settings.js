import { SCALES } from '../music/scales.js';

export const SOUNDS = Object.freeze(['keys', 'synth', 'bell', 'bass']);
export const DEFAULT_SETTINGS = Object.freeze({
  scale: 'pentatonic', sound: 'keys', volume: 65, mute: false,
});

/** Validate the entire patch before changing state. Volume uses percent (0–100). */
export function validateSettings(input, current = DEFAULT_SETTINGS) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !Object.hasOwn(DEFAULT_SETTINGS, key))) {
    throw new Error('Invalid instrument settings');
  }
  const next = { ...current, ...input };
  if (!Object.hasOwn(SCALES, next.scale) || !SOUNDS.includes(next.sound) ||
      !Number.isFinite(next.volume) || next.volume < 0 || next.volume > 100 ||
      typeof next.mute !== 'boolean') {
    throw new Error('Invalid instrument settings');
  }
  return next;
}
