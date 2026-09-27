import { clamp } from '../shared/math.js';
import { createVoice } from './voice.js';

/** Owns the audio context, master chain and active/releasing voice lifetimes.
 * Each channel owns one gain node and one voice group. A group holds the solo voice
 * or every section of an orchestra arrangement, so one channel never leaves parts
 * ringing after a note change, a settings change or close.
 */
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
    this.channelGroups = new Map();
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

  /** Solo callers may omit the channel; the legacy form keeps its leading note argument. */
  play(channel, midi, velocity, pan, sound, arrangement = null) {
    if (typeof channel !== 'string') {
      arrangement = sound;
      sound = pan;
      pan = velocity;
      velocity = midi;
      midi = channel;
      channel = 'main';
    }
    this.release(channel);
    const parts = arrangement || [{ midi, sound, level: 1, pan: 0 }];
    const group = [];
    for (const part of parts) {
      const voice = createVoice(this.context, this.channelGain(channel), part.midi,
        velocity * part.level, clamp(pan + part.pan, -1, 1), part.sound);
      voice.panOffset = part.pan;
      group.push(voice);
      this.voices.add(voice);
    }
    this.channelGroups.set(channel, group);
    if (channel === 'main') this.voice = group[0];
  }

  pan(channel, value) {
    if (typeof channel !== 'string') {
      value = channel;
      channel = 'main';
    }
    for (const voice of this.channelGroups.get(channel) || []) {
      voice.panner.pan.setTargetAtTime(clamp(value + voice.panOffset, -1, 1), this.context.currentTime, .025);
    }
  }

  setVolume(volume, muted = false, channel = 'main') {
    this.channelGain(channel).gain.setTargetAtTime(muted ? 0 : clamp(volume), this.context.currentTime, .02);
  }

  release(channel = null) {
    if (channel === null) {
      for (const id of [...this.channelGroups.keys()]) this.release(id);
      return;
    }
    const group = this.channelGroups.get(channel);
    if (!group) return;
    this.channelGroups.delete(channel);
    if (this.voice && group.includes(this.voice)) this.voice = null;
    for (const voice of group) this.stopVoice(voice);
  }

  stopVoice(voice) {
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
    this.channelGroups.clear();
  }
}
