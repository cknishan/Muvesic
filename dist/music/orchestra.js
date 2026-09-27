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

/** Body mode voices one sustained four-section chord per movement.
 *
 * The root is already the lower wrist, so every part is built above or under it
 * and never fights the melody. Posture colours the voicing instead of adding
 * notes: arms up lift and brighten, a squat drops and thickens, a wide pose
 * opens the stereo image and a lean drags the whole image sideways, and posture
 * strength opens the level across all four sections so a held shape swells while
 * a passing one stays light.
 *
 * The parts come back in section order, the same as arrangeOrchestra, so one
 * readout renders either arrangement.
 */
export function arrangeBody(frame, scale) {
  const { midi, posture = null, strength = 0, pan = 0 } = frame;
  const interval = diatonic(midi, scale);
  const high = posture === 'arms_up';
  const low = posture === 'squat';
  const octave = high ? 12 : low ? -12 : 0;
  const width = posture === 'wide' ? 1.5 : 1;
  const tilt = posture === 'lean' ? clamp(pan, -1, 1) * .5 : 0;
  const level = base => base * (low ? 1.25 : high ? .9 : 1) * (.55 + clamp(strength, 0, 1) * .45);
  const place = offset => clamp(tilt + offset * width, -1, 1);
  return [
    { midi: midi + octave, sound: 'strings', level: level(.26), pan: place(.4) },
    { midi: midi + interval(2) + octave, sound: 'woodwind', level: level(.3), pan: place(.1) },
    { midi: midi + interval(4) + octave, sound: 'brass', level: level(.22), pan: place(-.35) },
    { midi: midi - 12 + (high ? 12 : 0), sound: 'cello', level: level(.32), pan: place(-.25) },
  ];
}
