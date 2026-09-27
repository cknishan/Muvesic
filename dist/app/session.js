import { MotionMapper } from '../music/motion-mapper.js';
import { SCALES } from '../music/scales.js';
import { Synthesizer } from '../audio.js';
import { HandTracker } from '../tracking/hand-tracker.js';
import { cameraError } from '../tracking/errors.js';
import { CHANNELS, DEFAULT_SETTINGS, validateSettings } from './settings.js';

/** Owns idle/loading/running transitions and per-session resources.
 * Factories are injectable so lifecycle tests need neither a DOM nor hardware.
 * The generation token prevents an old async startup from reviving a stopped session.
 */
export function createSession({
  view, video, createInput,
  createAudio = () => new Synthesizer(),
  createTracker = (...args) => new HandTracker(...args),
}) {
  const mappers = Object.fromEntries(CHANNELS.map(channel =>
    [channel, new MotionMapper(DEFAULT_SETTINGS[channel].scale)]));
  let settings = { ...DEFAULT_SETTINGS };
  let mode = 'camera';
  let state = 'idle';
  let audio = null;
  let tracker = null;
  let generation = 0;
  let sessionTimer = null;
  let tracking = { left: false, right: false };

  const input = createInput({
    isEnabled: () => mode === 'mouse' && state === 'running',
    getLaneCount: () => SCALES[settings.right.scale].notes.length,
    onPoint: (x, y, time) => playPoint('right', x, y, time),
    onLost: () => loseTracking('right'),
    onPitchStep: () => mappers.right.resetSmoothing(),
  });
  const renderControls = () => view.renderControls({ state, mode });

  function loseTracking(channel = null) {
    const channels = channel ? [channel] : CHANNELS;
    for (const id of channels) {
      if (tracking[id]) {
        audio?.release(id);
        mappers[id].reset();
        view.clearVisual(id);
      }
      tracking[id] = false;
    }
    const anyTracking = CHANNELS.some(id => tracking[id]);
    view.showTrackingHint(state === 'running' && mode === 'camera' && !anyTracking);
    if (state === 'running') {
      view.setStatus(mode === 'camera' && !anyTracking ? 'No hands detected' : 'Move into the play area');
    }
  }

  function playPoint(channel, x, y, time, landmarks = null) {
    if (state !== 'running') return;
    const mapped = mappers[channel].update(x, y, time);
    if (!mapped) return;
    tracking[channel] = true;
    view.showTrackingHint(false);
    const active = CHANNELS.filter(id => tracking[id]).length;
    view.setStatus(mode === 'camera' ? active + ' hand' + (active === 1 ? '' : 's') + ' tracked · Playing' : 'Mouse & keys · Playing');
    try {
      if (mapped.trigger) audio.play(channel, mapped.midi, mapped.velocity, mapped.pan, settings[channel].sound);
      else audio.pan(channel, mapped.pan);
    } catch {
      fail(new Error('Audio playback stopped. Press Start to try again.'));
      return;
    }
    view.renderNote(channel, mapped, landmarks, time);
  }

  function handsByChannel(hands) {
    const visible = hands.filter(hand => hand?.[8]).sort((a, b) => (1 - a[8].x) - (1 - b[8].x));
    if (visible.length === 0) return {};
    if (visible.length === 1) return { [(1 - visible[0][8].x) < .5 ? 'left' : 'right']: visible[0] };
    return { left: visible[0], right: visible[visible.length - 1] };
  }

  function stop(message = 'Session stopped') {
    generation++;
    state = 'idle';
    tracker?.stop();
    tracker = null;
    const previousAudio = audio;
    audio = null;
    void previousAudio?.close().catch(() => {});
    clearInterval(sessionTimer);
    sessionTimer = null;
    input.stop();
    for (const mapper of Object.values(mappers)) mapper.reset();
    tracking = { left: false, right: false };
    view.showTrackingHint(false);
    view.clearVisual();
    renderControls();
    view.setStatus(message);
  }

  function fail(error) {
    stop('Unable to start');
    view.showError(cameraError(error));
  }

  async function start() {
    if (state !== 'idle') return;
    const token = ++generation;
    state = 'loading';
    view.showError(null);
    renderControls();
    view.setStatus('Starting audio…');
    let ownAudio;
    try {
      ownAudio = createAudio();
      audio = ownAudio;
      for (const channel of CHANNELS) {
        audio.setVolume(settings[channel].volume / 100, settings[channel].mute, channel);
      }
      await ownAudio.start();
      if (token !== generation) {
        void ownAudio.close().catch(() => {});
        return;
      }
      if (mode === 'camera') {
        const ownTracker = createTracker(video, (hands, time) => {
          if (token !== generation || state !== 'running') return;
          const channels = handsByChannel(hands);
          for (const channel of CHANNELS) {
            const landmarks = channels[channel];
            if (!landmarks) {
              loseTracking(channel);
            } else {
              // Mirror input once to match the displayed video. Drawing mirrors raw landmarks.
              playPoint(channel, 1 - landmarks[8].x, landmarks[8].y, time, landmarks);
            }
          }
        }, error => { if (token === generation) fail(error); });
        tracker = ownTracker;
        await ownTracker.start(message => {
          if (token === generation) view.setStatus(message);
        });
      }
      if (token !== generation) return;
      state = 'running';
      const started = performance.now();
      view.setTime(0);
      sessionTimer = setInterval(() => {
        view.setTime(Math.floor((performance.now() - started) / 1000));
      }, 250);
      renderControls();
      loseTracking();
      if (mode === 'mouse') {
        view.focusStage();
        input.start();
      }
    } catch (error) {
      if (token === generation && error.name !== 'AbortError') fail(error);
    }
  }

  function applySettings(patch) {
    const next = validateSettings(patch, settings);
    const changed = CHANNELS.filter(channel =>
      next[channel].scale !== settings[channel].scale || next[channel].sound !== settings[channel].sound);
    settings = next;
    for (const channel of changed) {
      audio?.release(channel);
      mappers[channel].setScale(settings[channel].scale);
      view.clearVisual(channel);
    }
    for (const channel of CHANNELS) {
      audio?.setVolume(settings[channel].volume / 100, settings[channel].mute, channel);
    }
    view.renderSettings(settings);
    if (changed.length) view.renderLanes(settings);
    return readSettings();
  }

  function switchMode() {
    stop('Ready when you are');
    mode = mode === 'camera' ? 'mouse' : 'camera';
    view.showError(null);
    renderControls();
  }

  function reset() {
    stop('Ready when you are');
    mode = 'camera';
    applySettings(DEFAULT_SETTINGS);
    view.setTime(0);
    view.showError(null);
    renderControls();
  }

  function read() {
    return { state, mode, ...readSettings() };
  }

  function readSettings() {
    return Object.fromEntries(CHANNELS.map(channel => [channel, {
      scale: settings[channel].scale, sound: settings[channel].sound,
      volume: settings[channel].volume, muted: settings[channel].mute,
    }]));
  }

  view.renderLanes(settings);
  view.renderSettings(settings);
  renderControls();
  return { start, stop, switchMode, reset, applySettings, read,
    dispose: () => { stop(); input.dispose(); } };
}
