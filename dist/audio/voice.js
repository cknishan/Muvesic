import { clamp } from '../shared/math.js';
import { frequency } from '../music/notes.js';

// Section timbres exist only inside an orchestra arrangement, so they are named
// apart from the settings sound IDs handled below.
const ORCHESTRAL = {
  strings: { partials: [[1, .32], [1.004, .2], [2, .1]], type: 'sawtooth', cutoff: 1800, attack: .09, sustain: .8 },
  woodwind: { partials: [[1, .65], [2, .08], [3, .035]], type: 'sine', cutoff: 4000, attack: .045, sustain: .8 },
  brass: { partials: [[1, .36], [2, .12]], type: 'sawtooth', cutoff: 1400, attack: .07, sustain: .8 },
  cello: { partials: [[1, .6], [2, .15]], type: 'triangle', cutoff: 700, attack: .06, sustain: .8 },
};

/** Build one note's oscillators and envelope, connected to the given destination.
 * MIDI selects pitch; velocity is [0, 1], pan is [-1, 1], sound is a settings ID
 * or a section timbre name.
 */
export function createVoice(ctx, destination, midi, velocity, pan, sound) {
  const orchestral = ORCHESTRAL[sound];
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const filter = ctx.createBiquadFilter();
  panner.pan.value = clamp(pan, -1, 1);
  filter.type = 'lowpass';
  filter.frequency.value = orchestral?.cutoff ?? (sound === 'synth' ? 1900 : sound === 'bass' ? 720 : sound === 'guitar' ? 4500 : 6500);
  if (sound === 'guitar') {
    // Bright string attack, then quickly soften as a plucked note rings out.
    filter.frequency.setValueAtTime(4500, now);
    filter.frequency.exponentialRampToValueAtTime(900, now + .28);
  }
  gain.connect(filter);
  filter.connect(panner);
  panner.connect(destination);
  const partials = orchestral?.partials ?? (sound === 'bell'
    ? [[1, .5], [2.756, .16], [5.404, .05]]
    : sound === 'keys' ? [[1, .46], [2, .15], [3, .04]]
    : sound === 'bass' ? [[.5, .5], [1, .2], [1.995, .06]]
    : sound === 'guitar' ? [[1, .3], [2, .08], [3, .03]]
    : [[1, .22], [1.003, .12]]);
  const oscillators = partials.map(([ratio, level], index) => {
    const oscillator = ctx.createOscillator();
    const partialGain = ctx.createGain();
    oscillator.type = orchestral?.type ?? (sound === 'guitar' && index === 0 ? 'sawtooth'
      : sound === 'synth' || sound === 'bass' ? 'triangle' : 'sine');
    oscillator.frequency.value = frequency(midi) * ratio;
    partialGain.gain.value = level;
    oscillator.connect(partialGain);
    partialGain.connect(gain);
    oscillator.start(now);
    return { oscillator, partialGain };
  });
  gain.gain.setValueAtTime(0, now);
  const attack = orchestral?.attack ?? (sound === 'synth' ? .025 : sound === 'bass' ? .018 : sound === 'guitar' ? .002 : .008);
  gain.gain.linearRampToValueAtTime(velocity, now + attack);
  const sustain = orchestral?.sustain ?? (sound === 'bell' ? .015 : sound === 'keys' ? .22 : sound === 'bass' ? .5 : sound === 'guitar' ? .02 : .65);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(.001, velocity * sustain), now + (orchestral ? .9 : sound === 'bell' ? 1.5 : sound === 'guitar' ? .6 : .65),
  );
  return { gain, panner, filter, oscillators };
}
