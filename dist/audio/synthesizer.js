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
    this.channelGains = new Map();
    this.channelVoices = new Map();
    this.voices = new Set();
  }

  async start() {
    await this.context.resume();
    if (this.context.state !== 'running') {
      throw new Error('Audio could not start. Click Start again to enable sound.');
    }
  }

  channelGain(channel) {
    if (!this.channelGains.has(channel)) {
      const gain = this.context.createGain();
      gain.gain.value = 1;
      gain.connect(this.master);
      this.channelGains.set(channel, gain);
    }
    return this.channelGains.get(channel);
  }

  setVolume(volume, muted = false, channel = 'main') {
    this.channelGain(channel).gain.setTargetAtTime(muted ? 0 : clamp(volume), this.context.currentTime, .02);
  }

  play(channel, midi, velocity, pan, sound) {
    if (typeof channel !== 'string') {
      sound = pan;
      pan = velocity;
      velocity = midi;
      midi = channel;
      channel = 'main';
    }
    this.release(channel);
    const voice = createVoice(this.context, this.channelGain(channel), midi, velocity, pan, sound);
    this.channelVoices.set(channel, voice);
    if (channel === 'main') this.voice = voice;
    this.voices.add(voice);
  }

  pan(channel, value) {
    if (typeof channel !== 'string') {
      value = channel;
      channel = 'main';
    }
    this.channelVoices.get(channel)?.panner.pan.setTargetAtTime(clamp(value, -1, 1), this.context.currentTime, .025);
  }

  release(channel = null) {
    if (channel === null) {
      for (const id of [...this.channelVoices.keys()]) this.release(id);
      return;
    }
    const voice = this.channelVoices.get(channel);
    if (!voice) return;
    this.channelVoices.delete(channel);
    if (this.voice === voice) this.voice = null;
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
    this.channelGains.clear();
    this.channelVoices.clear();
  }
}
