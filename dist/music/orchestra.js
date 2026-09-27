import { clamp } from '../shared/math.js';

const DIATONIC = Object.freeze({
  minor: [9, 11, 0, 2, 4, 5, 7],
  major: [0, 2, 4, 5, 7, 9, 11],
});

/** Semitone offsets from a root that stay inside one diatonic scale. */
function diatonic(midi, scale) {
  const notes = DIATONIC[scale] ?? DIATONIC.major;
  const degree = notes.indexOf(((midi % 12) + 12) % 12);
  return steps => (notes[(degree + steps) % 7] - midi % 12 + 12) % 12;
}

/** Diatonic triads, voiced across four synthesized orchestral sections.
 * Section timbres are named apart from settings sound IDs: 'cello' is the ensemble
 * bass, while the 'bass' settings sound is the standalone Round bass instrument.
 */
export function arrangeOrchestra(midi, scale) {
  const interval = diatonic(midi, scale);
  return [
    { midi: midi - 12, sound: 'strings', level: .34, pan: -.35 },
    { midi: midi + interval(2), sound: 'woodwind', level: .24, pan: .3 },
    { midi: midi + interval(4) - 12, sound: 'brass', level: .22, pan: .1 },
    { midi: midi - 24, sound: 'cello', level: .3, pan: -.1 },
  ];
}

/** Body mode's settled posture shapes the four limb voices the same way:
 *  arms-up lifts the two arm channels an octave, squat drops the two leg
 *  channels an octave, wide opens the stereo image across all four, and lean
 *  drags every voice sideways by the body's torso tilt. A null posture is a
 *  no-op so the four voices keep their own settings.
 *
 *  `lean` is the body-level tilt in [-1, 1] from the pose mapper; passing it
 *  here keeps posture shaping free of geometry, and the mapper is the only
 *  thing that knows what "lean" means for a particular player. */
export function applyPosture(frames, posture, strength, lean = 0) {
  const s = clamp(strength, 0, 1);
  const tilt = posture === 'lean' ? clamp(lean, -1, 1) * .5 : 0;
  const width = posture === 'wide' ? 1.5 : 1;
  return frames.map(frame => {
    let midi = frame.midi;
    if (posture === 'arms_up' && (frame.channel === 'left' || frame.channel === 'right')) {
      midi += 12;
    } else if (posture === 'squat' && (frame.channel === 'lowerLeft' || frame.channel === 'lowerRight')) {
      midi -= 12;
    }
    const pan = clamp(frame.pan * width + tilt, -1, 1);
    const velocity = frame.velocity * (1 + s * .3);
    return { ...frame, midi, pan, velocity };
  });
}

/** True if the channel is an arm in body mode (and therefore responds to the
 *  arms-up posture). Used by the view to highlight the right limb group. */
export const ARM_CHANNELS = Object.freeze(['left', 'right']);
export const LEG_CHANNELS = Object.freeze(['lowerLeft', 'lowerRight']);
