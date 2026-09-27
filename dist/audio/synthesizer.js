import { clamp } from '../shared/math.js';
import { createVoice } from './voice.js';

/** Owns the audio context, master chain and active/releasing voice lifetimes. */
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
    this.activeVoices = [];
    this.voices = new Set();
  }

  async start() {
    await this.context.resume();
    if (this.context.state !== 'running') {
      throw new Error('Audio could not start. Click Start again to enable sound.');
    }
  }

  setVolume(volume, muted = false) {
    this.master.gain.setTargetAtTime(muted ? 0 : clamp(volume), this.context.currentTime, .02);
  }

  play(midi, velocity, pan, sound, arrangement = null) {
    this.release();
    const parts = arrangement || [{ midi, sound, level: 1, pan: 0 }];
    for (const part of parts) {
      const voice = createVoice(this.context, this.master, part.midi,
        velocity * part.level, clamp(pan + part.pan, -1, 1), part.sound);
      voice.panOffset = part.pan;
      this.activeVoices.push(voice);
      this.voices.add(voice);
    }
    this.voice = this.activeVoices[0];
  }

  pan(value) {
    for (const voice of this.activeVoices) {
      voice.panner.pan.setTargetAtTime(clamp(value + voice.panOffset, -1, 1), this.context.currentTime, .025);
    }
  }

  release() {
    const active = this.activeVoices;
    this.activeVoices = [];
    this.voice = null;
    for (const voice of active) this.releaseVoice(voice);
  }

  releaseVoice(voice) {
    const now = this.context.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(now);
    voice.gain.gain.setTargetAtTime(0, now, .025);
    let remaining = voice.oscillators.length;
    for (const { oscillator, partialGain } of voice.oscillators) {
      oscillator.onended = () => {
        oscillator.disconnect();
        partialGain.disconnect();
        if (--remaining === 0) {
          voice.gain.disconnect();
          voice.filter.disconnect();
          voice.panner.disconnect();
          this.voices.delete(voice);
        }
      };
      oscillator.stop(now + .16);
    }
  }

  async close() {
    this.release();
    if (this.context.state !== 'closed') await this.context.close();
    this.voices.clear();
  }
}
