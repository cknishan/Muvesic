import { clamp, frequency } from './music.js';
export class Synthesizer {
  constructor(Context = globalThis.AudioContext || globalThis.webkitAudioContext) {
    if (!Context) throw new Error('This browser does not support Web Audio. Try a recent desktop browser.');
    this.context = new Context({ latencyHint: 'interactive' });
    this.master = this.context.createGain();
    this.master.gain.value = .65;
    this.compressor = this.context.createDynamicsCompressor();
    this.master.connect(this.compressor);
    this.compressor.connect(this.context.destination);
    this.voice = null;
    this.voices = new Set();
  }
  async start() {
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio could not start. Click Start again to enable sound.');
  }
  setVolume(volume, muted = false) { this.master.gain.setTargetAtTime(muted ? 0 : clamp(volume), this.context.currentTime, .02); }
  play(midi, velocity, pan, sound) {
    this.release();
    const ctx = this.context, now = ctx.currentTime;
    const gain = ctx.createGain(), panner = ctx.createStereoPanner(), filter = ctx.createBiquadFilter();
    panner.pan.value = clamp(pan, -1, 1);
    filter.type = 'lowpass';
    filter.frequency.value = sound === 'synth' ? 1900 : 6500;
    gain.connect(filter); filter.connect(panner); panner.connect(this.master);
    const partials = sound === 'bell' ? [[1, .5], [2.756, .16], [5.404, .05]] : sound === 'keys' ? [[1, .46], [2, .15], [3, .04]] : [[1, .22], [1.003, .12]];
    const oscillators = partials.map(([ratio, level]) => {
      const oscillator = ctx.createOscillator(), partialGain = ctx.createGain();
      oscillator.type = sound === 'synth' ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency(midi) * ratio;
      partialGain.gain.value = level;
      oscillator.connect(partialGain); partialGain.connect(gain); oscillator.start(now);
      return { oscillator, partialGain };
    });
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(velocity, now + (sound === 'synth' ? .025 : .008));
    gain.gain.exponentialRampToValueAtTime(Math.max(.001, velocity * (sound === 'bell' ? .015 : sound === 'keys' ? .22 : .65)), now + (sound === 'bell' ? 1.5 : .65));
    const voice = { gain, panner, filter, oscillators };
    this.voice = voice; this.voices.add(voice);
  }
  pan(value) { this.voice?.panner.pan.setTargetAtTime(clamp(value, -1, 1), this.context.currentTime, .025); }
  release() {
    const voice = this.voice;
    if (!voice) return;
    this.voice = null;
    const now = this.context.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(now);
    voice.gain.gain.setTargetAtTime(0, now, .025);
    let remaining = voice.oscillators.length;
    for (const { oscillator, partialGain } of voice.oscillators) {
      oscillator.onended = () => {
        oscillator.disconnect(); partialGain.disconnect();
        if (--remaining === 0) { voice.gain.disconnect(); voice.filter.disconnect(); voice.panner.disconnect(); this.voices.delete(voice); }
      };
      oscillator.stop(now + .16);
    }
  }
  async close() { this.release(); if (this.context.state !== 'closed') await this.context.close(); this.voices.clear(); }
}
