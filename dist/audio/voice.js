import { clamp } from '../shared/math.js';
import { frequency } from '../music/notes.js';

/** Build one note's oscillators and envelope, connected to the master gain.
 * MIDI selects pitch; velocity is [0, 1], pan is [-1, 1], sound is a settings ID.
 */
export function createVoice(ctx, destination, midi, velocity, pan, sound) {
  const orchestral = {
    strings: { partials: [[1, .32], [1.004, .2], [2, .1]], type: 'sawtooth', cutoff: 1800, attack: .09 },
    woodwind: { partials: [[1, .65], [2, .08], [3, .035]], type: 'sine', cutoff: 4000, attack: .045 },
    brass: { partials: [[1, .36], [2, .12]], type: 'sawtooth', cutoff: 1400, attack: .07 },
    bass: { partials: [[1, .6], [2, .15]], type: 'triangle', cutoff: 700, attack: .06 },
  }[sound];
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const filter = ctx.createBiquadFilter();
  panner.pan.value = clamp(pan, -1, 1);
  filter.type = 'lowpass';
  filter.frequency.value = orchestral?.cutoff ?? (sound === 'synth' ? 1900 : 6500);
  gain.connect(filter);
  filter.connect(panner);
  panner.connect(destination);
  const partials = orchestral?.partials ?? (sound === 'bell'
    ? [[1, .5], [2.756, .16], [5.404, .05]]
    : sound === 'keys' ? [[1, .46], [2, .15], [3, .04]] : [[1, .22], [1.003, .12]]);
  const oscillators = partials.map(([ratio, level]) => {
    const oscillator = ctx.createOscillator();
    const partialGain = ctx.createGain();
    oscillator.type = orchestral?.type ?? (sound === 'synth' ? 'triangle' : 'sine');
    oscillator.frequency.value = frequency(midi) * ratio;
    partialGain.gain.value = level;
    oscillator.connect(partialGain);
    partialGain.connect(gain);
    oscillator.start(now);
    return { oscillator, partialGain };
  });
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(velocity, now + (orchestral?.attack ?? (sound === 'synth' ? .025 : .008)));
  const sustain = orchestral ? .8 : sound === 'bell' ? .015 : sound === 'keys' ? .22 : .65;
  gain.gain.exponentialRampToValueAtTime(
    Math.max(.001, velocity * sustain), now + (sound === 'bell' ? 1.5 : .65),
  );
  return { gain, panner, filter, oscillators };
}
