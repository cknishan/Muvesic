/** Scale notes are stored from lowest to highest MIDI pitch. */
export const SCALES = Object.freeze({
  pentatonic: { label: 'C major pentatonic', notes: [60, 62, 64, 67, 69, 72], hint: 'Five tones, plenty of possibilities.' },
  major: { label: 'C major', notes: [60, 62, 64, 65, 67, 69, 71, 72], hint: 'A bright, familiar eight-note journey.' },
  minor: { label: 'A minor', notes: [57, 59, 60, 62, 64, 65, 67, 69], hint: 'A softer, more reflective palette.' },
});
