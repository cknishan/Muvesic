/** Diatonic triads, voiced across four synthesized orchestral sections. */
export function arrangeOrchestra(midi, scale) {
  const notes = scale === 'minor' ? [9, 11, 0, 2, 4, 5, 7] : [0, 2, 4, 5, 7, 9, 11];
  const degree = notes.indexOf(midi % 12);
  const interval = steps => (notes[(degree + steps) % 7] - midi % 12 + 12) % 12;
  return [
    { midi: midi - 12, sound: 'strings', level: .34, pan: -.35 },
    { midi: midi + interval(2), sound: 'woodwind', level: .24, pan: .3 },
    { midi: midi + interval(4) - 12, sound: 'brass', level: .22, pan: .1 },
    { midi: midi - 24, sound: 'bass', level: .3, pan: -.1 },
  ];
}
