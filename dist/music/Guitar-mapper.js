import { clamp } from '../shared/math.js';
import { SCALES } from './scales.js';
import { pitchIndex } from './motion-mapper.js';

export class GuitarMapper {
  constructor(scale = 'pentatonic') {
    this.setScale(scale);
  }

  setScale(scale) {
    if (!Object.hasOwn(SCALES, scale)) {
      throw new Error('Unknown scale');
    }

    this.scale = scale;
    this.reset();
  }

  reset() {
    this.index = null;

    this.lastStrumY = null;
    this.lastTime = null;

    this.lastTrigger = -Infinity;
    this.lastDirection = 0;

    this.strumSpeed = 0;
  }

  update(
    fretX,
    fretY,
    strumX,
    strumY,
    time
  ) {
    if (
      ![
        fretX,
        fretY,
        strumX,
        strumY,
        time
      ].every(Number.isFinite)
    ) {
      return null;
    }

    if (
      this.lastTime !== null &&
      time <= this.lastTime
    ) {
      return null;
    }

    // Reset after tracking disappears.
    if (
      this.lastTime !== null &&
      time - this.lastTime > 300
    ) {
      this.reset();
    }

    fretX = clamp(fretX);
    fretY = clamp(fretY);

    strumX = clamp(strumX);
    strumY = clamp(strumY);

    /*
     * LEFT/FRET HAND
     *
     * Height chooses the note.
     */
    const notes = SCALES[this.scale].notes;

    this.index = pitchIndex(
      fretY,
      notes.length,
      this.index
    );

    const midi =
      notes[notes.length - 1 - this.index];

    /*
     * RIGHT/STRUM HAND
     *
     * Detect vertical motion.
     */
    let direction = 0;

    if (
      this.lastTime !== null &&
      this.lastStrumY !== null
    ) {
      const dt = Math.max(
        .001,
        (time - this.lastTime) / 1000
      );

      const delta =
        strumY - this.lastStrumY;

      const speed =
        Math.abs(delta) / dt;

      // Smooth hand-tracking noise.
      this.strumSpeed +=
        (speed - this.strumSpeed) *
        (1 - Math.exp(-dt / .06));

      if (Math.abs(delta) > .006) {
        direction = Math.sign(delta);
      }
    }

    /*
     * Trigger when:
     *
     * 1. movement is fast enough
     * 2. direction changes
     *
     * This creates alternating:
     *
     * ↓ downstroke
     * ↑ upstroke
     */
    const changedDirection =
      direction !== 0 &&
      direction !== this.lastDirection;

    const trigger =
      changedDirection &&
      this.strumSpeed > .85 &&
      time - this.lastTrigger >= 110;

    if (trigger) {
      this.lastTrigger = time;
    }

    if (direction !== 0) {
      this.lastDirection = direction;
    }

    this.lastStrumY = strumY;
    this.lastTime = time;

    return {
      // Fret-hand point
      x: fretX,
      y: fretY,

      // Strumming-hand point
      strumX,
      strumY,

      midi,
      index: this.index,

      trigger,

      pan: fretX * 2 - 1,

      // Faster strumming = louder note
      velocity:
        .30 +
        clamp(this.strumSpeed / 4) * .65,

      intensity:
        clamp(this.strumSpeed / 4),
    };
  }
}
