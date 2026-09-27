import { clamp } from '../shared/math.js';
import { SCALES } from './scales.js';

/** Return a top-to-bottom lane index, with hysteresis around the current lane. */
export function pitchIndex(y, count, previous = null) {
  const position = clamp(y) * count;
  // A 12%-of-lane dead band stops tiny tracking errors retriggering notes.
  if (previous !== null && position >= previous - .12 && position <= previous + 1.12) {
    return previous;
  }
  return Math.min(count - 1, Math.floor(position));
}

/** Maps normalized screen coordinates and monotonic milliseconds to note events.
 * Top = high pitch, left = negative pan; reset after tracking loss.
 */
export class MotionMapper {
  constructor(scale = 'pentatonic') {
    this.setScale(scale);
  }

  setScale(scale) {
    if (!Object.hasOwn(SCALES, scale)) throw new Error('Unknown scale');
    this.scale = scale;
    this.reset();
  }

  reset() {
    this.point = null;
    this.index = null;
    this.lastMidi = null;
    this.lastTrigger = -Infinity;
    this.time = null;
    this.speed = 0;
  }

  /** Let a discrete keyboard pitch step bypass coordinate smoothing. */
  resetSmoothing() {
    this.point = null;
  }

  update(x, y, time) {
    if (![x, y, time].every(Number.isFinite)) return null;
    if (this.time !== null && time <= this.time) return null;
    if (this.time !== null && time - this.time > 300) this.reset();
    x = clamp(x);
    y = clamp(y);
    const dt = this.time === null ? 1 / 30 : Math.max(.001, (time - this.time) / 1000);
    const alpha = 1 - Math.exp(-dt / .035);
    const previous = this.point;
    const point = previous ? {
      x: previous.x + (x - previous.x) * alpha,
      y: previous.y + (y - previous.y) * alpha,
    } : { x, y };
    const speed = previous ? Math.hypot(point.x - previous.x, point.y - previous.y) / dt : 0;
    this.speed += (speed - this.speed) * (1 - Math.exp(-dt / .08));
    const notes = SCALES[this.scale].notes;
    this.index = pitchIndex(point.y, notes.length, this.index);
    const midi = notes[notes.length - 1 - this.index];
    const trigger = midi !== this.lastMidi && time - this.lastTrigger >= 85;
    if (trigger) {
      this.lastMidi = midi;
      this.lastTrigger = time;
    }
    this.point = point;
    this.time = time;
    return {
      ...point, midi: this.lastMidi ?? midi, index: this.index, trigger,
      pan: point.x * 2 - 1,
      velocity: .24 + clamp(this.speed / 2.5) * .66,
      intensity: clamp(this.speed / 2.5),
    };
  }
}
