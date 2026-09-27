import { SCALES } from '../music/scales.js';

export const SOUNDS = Object.freeze(['keys', 'synth', 'bell', 'bass', 'guitar']);
export const CHANNELS = Object.freeze(['left', 'right']);
/** Exclusive top-level modes. Each owns a different set of channels, so only one
 *  performance can hold a voice at a time. */
export const PERFORMANCES = Object.freeze(['solo', 'orchestra', 'body']);
export const DEFAULT_CHANNEL_SETTINGS = Object.freeze({
  scale: 'pentatonic', sound: 'keys', volume: 65, mute: false,
});
export const DEFAULT_SETTINGS = Object.freeze({
  performance: 'solo',
  left: Object.freeze({ ...DEFAULT_CHANNEL_SETTINGS, sound: 'bass' }),
  right: Object.freeze({ ...DEFAULT_CHANNEL_SETTINGS, sound: 'keys' }),
});

/** Validate the entire patch before changing state. Volume uses percent (0–100). */
export function validateChannelSettings(input, current = DEFAULT_CHANNEL_SETTINGS) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !Object.hasOwn(DEFAULT_CHANNEL_SETTINGS, key))) {
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

/** Performance is the top-level mode; each hand keeps its own settings whether or not
 * it is the active channel, so switching modes never discards a choice.
 */
export function validateSettings(input, current = DEFAULT_SETTINGS) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => key !== 'performance' && !CHANNELS.includes(key))) {
    throw new Error('Invalid instrument settings');
  }
  const next = { performance: current.performance, left: current.left, right: current.right };
  if (Object.hasOwn(input, 'performance')) {
    if (!PERFORMANCES.includes(input.performance)) throw new Error('Invalid instrument settings');
    next.performance = input.performance;
  }
  for (const channel of CHANNELS) {
    if (Object.hasOwn(input, channel)) {
      next[channel] = validateChannelSettings(input[channel], current[channel]);
    }
  }
  return next;
}
