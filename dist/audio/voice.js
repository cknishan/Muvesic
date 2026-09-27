import { clamp } from '../shared/math.js';
import { frequency } from '../music/notes.js';

/** Build one note's oscillators and envelope, connected to the master gain.
 * MIDI selects pitch; velocity is [0, 1], pan is [-1, 1], sound is a settings ID.
 */
export function createVoice(ctx, destination, midi, velocity, pan, sound) {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const filter = ctx.createBiquadFilter();
  panner.pan.value = clamp(pan, -1, 1);
  filter.type = 'lowpass';
  filter.frequency.value = sound === 'synth' ? 1900 : sound === 'bass' ? 720 : sound === 'guitar' ? 4500 : 6500;
  if (sound === 'guitar') {
    // Bright string attack, then quickly soften as a plucked note rings out.
    filter.frequency.setValueAtTime(4500, now);
    filter.frequency.exponentialRampToValueAtTime(900, now + .28);
  }
  gain.connect(filter);
  filter.connect(panner);
  panner.connect(destination);
  const partials = sound === 'bell'
    ? [[1, .5], [2.756, .16], [5.404, .05]]
    : sound === 'keys' ? [[1, .46], [2, .15], [3, .04]]
    : sound === 'bass' ? [[.5, .5], [1, .2], [1.995, .06]]
    : sound === 'guitar' ? [[1, .3], [2, .08], [3, .03]]
    : [[1, .22], [1.003, .12]];
  const oscillators = partials.map(([ratio, level], index) => {
    const oscillator = ctx.createOscillator();
    const partialGain = ctx.createGain();
    oscillator.type = sound === 'guitar' && index === 0 ? 'sawtooth'
      : sound === 'synth' || sound === 'bass' ? 'triangle' : 'sine';
    oscillator.frequency.value = frequency(midi) * ratio;
    partialGain.gain.value = level;
    oscillator.connect(partialGain);
    partialGain.connect(gain);
    oscillator.start(now);
    return { oscillator, partialGain };
  });
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(velocity, now + (sound === 'synth' ? .025 : sound === 'bass' ? .018 : sound === 'guitar' ? .002 : .008));
  const sustain = sound === 'bell' ? .015 : sound === 'keys' ? .22 : sound === 'bass' ? .5 : sound === 'guitar' ? .02 : .65;
  gain.gain.exponentialRampToValueAtTime(
    Math.max(.001, velocity * sustain), now + (sound === 'bell' ? 1.5 : sound === 'guitar' ? .6 : .65),
  );
  return { gain, panner, filter, oscillators };
}
