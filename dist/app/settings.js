import { SCALES } from '../music/scales.js';

export const SOUNDS = Object.freeze(['keys', 'synth', 'bell', 'bass', 'guitar']);
export const CHANNELS = Object.freeze(['left', 'right']);
/** Body mode owns four channels, one per limb, sharing the left/right pair with
 *  solo so a switch back doesn't lose the player's settings. */
export const LIMBS = Object.freeze(['left', 'right', 'lowerLeft', 'lowerRight']);
/** Exclusive top-level modes. Each owns a different set of channels, so only one
 *  performance can hold a voice at a time. */
export const PERFORMANCES = Object.freeze(['solo', 'orchestra', 'body']);
export const DEFAULT_CHANNEL_SETTINGS = Object.freeze({
  scale: 'pentatonic', sound: 'keys', volume: 65, mute: false, octave: 0,
});
const DEFAULT_LIMB_SETTINGS = Object.freeze({
  // One sound across all four limbs so the player hears a single band with four
  // voices. The octaves spread the limbs across the instrument so they don't
  // collide on the same note; legs sit low and arms sit high.
  left: Object.freeze({ ...DEFAULT_CHANNEL_SETTINGS, sound: 'bell' }),
  right: Object.freeze({ ...DEFAULT_CHANNEL_SETTINGS, sound: 'bell', octave: 12 }),
  lowerLeft: Object.freeze({ ...DEFAULT_CHANNEL_SETTINGS, sound: 'bell', octave: -24 }),
  lowerRight: Object.freeze({ ...DEFAULT_CHANNEL_SETTINGS, sound: 'bell', octave: -12 }),
});
export const DEFAULT_SETTINGS = Object.freeze({
  performance: 'solo',
  left: DEFAULT_LIMB_SETTINGS.left,
  right: DEFAULT_LIMB_SETTINGS.right,
  lowerLeft: DEFAULT_LIMB_SETTINGS.lowerLeft,
  lowerRight: DEFAULT_LIMB_SETTINGS.lowerRight,
});

/** Validate the entire patch before changing state. Volume uses percent (0–100).
 *  Octave is a small integer shift in semitones so a body channel can sit in a
 *  sensible register (legs in the bass, arms in the melody) without leaving the
 *  scale. */
export function validateChannelSettings(input, current = DEFAULT_CHANNEL_SETTINGS) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !Object.hasOwn(DEFAULT_CHANNEL_SETTINGS, key))) {
    throw new Error('Invalid instrument settings');
  }
  const next = { ...current, ...input };
  if (!Object.hasOwn(SCALES, next.scale) || !SOUNDS.includes(next.sound) ||
      !Number.isFinite(next.volume) || next.volume < 0 || next.volume > 100 ||
      typeof next.mute !== 'boolean' ||
      !Number.isInteger(next.octave) || next.octave < -24 || next.octave > 24) {
    throw new Error('Invalid instrument settings');
  }
  return next;
}

/** Performance is the top-level mode; each channel keeps its own settings whether
 *  or not it is the active channel, so switching modes never discards a choice.
 *  In body mode the four limbs each have their own channel; in solo only the two
 *  hands are reachable from the panel; the others sit idle but keep their values.
 */
export function validateSettings(input, current = DEFAULT_SETTINGS) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => key !== 'performance' && !LIMBS.includes(key))) {
    throw new Error('Invalid instrument settings');
  }
  const next = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) next[key] = current[key];
  if (Object.hasOwn(input, 'performance')) {
    if (!PERFORMANCES.includes(input.performance)) throw new Error('Invalid instrument settings');
    next.performance = input.performance;
  }
  for (const channel of LIMBS) {
    if (Object.hasOwn(input, channel)) {
      next[channel] = validateChannelSettings(input[channel], current[channel]);
    }
  }
  return next;
}
