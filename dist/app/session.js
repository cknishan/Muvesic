import { MotionMapper } from '../music/motion-mapper.js';
import { SCALES } from '../music/scales.js';
import { Synthesizer } from '../audio.js';
import { HandTracker } from '../tracking/hand-tracker.js';
import { cameraError } from '../tracking/errors.js';
import { DEFAULT_SETTINGS, validateSettings } from './settings.js';

/** Owns idle/loading/running transitions and per-session resources.
 * Factories are injectable so lifecycle tests need neither a DOM nor hardware.
 * The generation token prevents an old async startup from reviving a stopped session.
 */
export function createSession({
  view, video, createInput,
  createAudio = () => new Synthesizer(),
  createTracker = (...args) => new HandTracker(...args),
}) {
  const mapper = new MotionMapper();
  let settings = { ...DEFAULT_SETTINGS };
  let mode = 'camera';
  let state = 'idle';
  let audio = null;
  let tracker = null;
  let generation = 0;
  let sessionTimer = null;
  let tracking = false;

  const input = createInput({
    isEnabled: () => mode === 'mouse' && state === 'running',
    getLaneCount: () => SCALES[settings.scale].notes.length,
    onPoint: playPoint,
    onLost: loseTracking,
    onPitchStep: () => mapper.resetSmoothing(),
  });
  const renderControls = () => view.renderControls({ state, mode });

  function loseTracking() {
    if (tracking) {
      audio?.release();
      mapper.reset();
      view.clearVisual();
    }
    tracking = false;
    view.showTrackingHint(state === 'running' && mode === 'camera');
    if (state === 'running') {
      view.setStatus(mode === 'camera' ? 'No hand detected' : 'Move into the play area');
    }
  }

  function playPoint(x, y, time, landmarks = null) {
    if (state !== 'running') return;
    const mapped = mapper.update(x, y, time);
    if (!mapped) return;
    tracking = true;
    view.showTrackingHint(false);
    view.setStatus(mode === 'camera' ? 'Hand tracked · Playing' : 'Mouse & keys · Playing');
    try {
      if (mapped.trigger) audio.play(mapped.midi, mapped.velocity, mapped.pan, settings.sound);
      else audio.pan(mapped.pan);
    } catch {
      fail(new Error('Audio playback stopped. Press Start to try again.'));
      return;
    }
    view.renderNote(mapped, landmarks, time);
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
    mapper.reset();
    tracking = false;
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
      audio.setVolume(settings.volume / 100, settings.mute);
      await ownAudio.start();
      if (token !== generation) {
        void ownAudio.close().catch(() => {});
        return;
      }
      if (mode === 'camera') {
        const ownTracker = createTracker(video, (landmarks, time) => {
          if (token !== generation || state !== 'running') return;
          if (!landmarks) { loseTracking(); return; }
          // Mirror input once to match the displayed video. Drawing mirrors raw landmarks.
          playPoint(1 - landmarks[8].x, landmarks[8].y, time, landmarks);
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
    const changed = next.scale !== settings.scale || next.sound !== settings.sound;
    settings = next;
    if (changed) {
      audio?.release();
      mapper.setScale(settings.scale);
      view.clearVisual();
    }
    audio?.setVolume(settings.volume / 100, settings.mute);
    view.renderSettings(settings);
    if (changed) view.renderLanes(settings.scale);
    return { scale: settings.scale, sound: settings.sound, volume: settings.volume, muted: settings.mute };
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
    return { state, mode, scale: settings.scale, sound: settings.sound,
      volume: settings.volume, muted: settings.mute };
  }

  view.renderLanes(settings.scale);
  view.renderSettings(settings);
  renderControls();
  return { start, stop, switchMode, reset, applySettings, read,
    dispose: () => { stop(); input.dispose(); } };
}
