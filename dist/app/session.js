import { arrangeBody, arrangeOrchestra } from '../music/orchestra.js';
import { BodyMapper } from '../music/body-mapper.js';
import { MotionMapper } from '../music/motion-mapper.js';
import { SCALES } from '../music/scales.js';
import { Synthesizer } from '../audio.js';
import { HandTracker } from '../tracking/hand-tracker.js';
import { PoseTracker } from '../tracking/pose-tracker.js';
import { cameraError } from '../tracking/errors.js';
import { CHANNELS, DEFAULT_SETTINGS, validateSettings } from './settings.js';

const ENSEMBLE = 'ensemble';
const BODY = 'body';
const ALL_CHANNELS = [...CHANNELS, ENSEMBLE, BODY];
/** Which channels each performance owns. Solo drives two hands; the other modes
 *  each collapse to one. */
const PERFORMANCES = Object.freeze({ solo: CHANNELS, orchestra: [ENSEMBLE], body: [BODY] });

/** Owns idle/loading/running transitions and per-session resources.
 * Factories are injectable so lifecycle tests need neither a DOM nor hardware.
 * The generation token prevents an old async startup from reviving a stopped session.
 *
 * Performance modes are exclusive. Solo plays the two tracked hands on their own
 * left/right channels; orchestra drops to a single conductor that drives one
 * four-section ensemble; body mode swaps the hands for one pose skeleton and
 * voices it across those same four sections. Either way only the active channels
 * own a voice.
 */
export function createSession({
  view, video, createInput,
  createAudio = () => new Synthesizer(),
  createTracker = (...args) => new HandTracker(...args),
  createPoseTracker = (...args) => new PoseTracker(...args),
}) {
  // Each channel keeps its own musical history, and the borrowed ones keep the
  // right hand's starting scale, so no switch can inherit a held note.
  const mappers = {
    left: new MotionMapper(DEFAULT_SETTINGS.left.scale),
    right: new MotionMapper(DEFAULT_SETTINGS.right.scale),
    [ENSEMBLE]: new MotionMapper(DEFAULT_SETTINGS.right.scale),
    [BODY]: new BodyMapper(DEFAULT_SETTINGS.right.scale),
  };
  const clearTracking = () => Object.fromEntries(ALL_CHANNELS.map(id => [id, false]));
  let settings = { ...DEFAULT_SETTINGS };
  let mode = 'camera';
  let state = 'idle';
  let audio = null;
  let tracker = null;
  let generation = 0;
  let sessionTimer = null;
  let tracking = clearTracking();

  // Solo reads the right hand's scale, matching the keyboard lanes it draws.
  // Pointer and keyboard input carry no posture, so they stay with the hands.
  const practiceChannel = () => settings.performance === 'orchestra' ? ENSEMBLE : 'right';
  const activeChannels = () => PERFORMANCES[settings.performance] ?? CHANNELS;
  const trackedChannels = () => activeChannels().filter(id => tracking[id]);
  // Ensemble and body have no settings of their own: they borrow the right hand's
  // scale and mix, so a choice made for solo still shapes them.
  const borrowed = () => settings.right;
  const masterVolume = () => {
    const { volume, mute } = borrowed();
    return [volume / 100, mute];
  };
  // Body mode needs a pose model, which is a different camera pipeline entirely.
  const needsPoseTracker = performance => performance === 'body';

  const input = createInput({
    isEnabled: () => mode === 'mouse' && state === 'running',
    getLaneCount: () => SCALES[settings.right.scale].notes.length,
    onPoint: (x, y, time) => playPoint(practiceChannel(), x, y, time),
    onLost: () => loseTracking(practiceChannel()),
    onPitchStep: () => mappers[practiceChannel()].resetSmoothing(),
  });
  const renderControls = () => view.renderControls({ state, mode, performance: settings.performance });

  function loseTracking(channel = null) {
    const channels = channel ? [channel] : activeChannels();
    for (const id of channels) {
      if (tracking[id]) {
        audio?.release(id);
        mappers[id].reset();
        view.clearVisual(id);
      }
      tracking[id] = false;
    }
    const tracked = trackedChannels().length;
    // Body mode carries its own guidance: how much of the player is in frame and
    // whether the neutral pose has been learned yet.
    const hint = settings.performance === 'body' ? mappers[BODY].hint() : null;
    view.showTrackingHint(state === 'running' && mode === 'camera' && tracked === 0, hint || undefined);
    if (state === 'running') {
      const missed = settings.performance === 'body' ? 'No body detected' : 'No hands detected';
      const guidance = settings.performance === 'orchestra'
        ? 'Show one index finger to conduct the ensemble'
        : 'Show one or two hands, then move an index finger to play';
      view.setStatus(mode === 'camera' ? tracked ? guidance + ' · Playing' : missed : 'Mouse & keys · Playing');
    }
  }

  function playPoint(channel, x, y, time, landmarks = null) {
    if (state !== 'running') return;
    const mapped = mappers[channel].update(x, y, time);
    if (!mapped) return;
    tracking[channel] = true;
    view.showTrackingHint(false);
    const tracked = trackedChannels().length;
    const hand = tracked + (settings.performance === 'orchestra' ? ' hand conducting' : ' hand' + (tracked === 1 ? '' : 's') + ' tracked');
    view.setStatus(mode === 'camera' ? hand + ' · Playing' : 'Mouse & keys · Playing');
    // A hand setting follows the channel that actually plays it.
    const channelSettings = settings[channel] || borrowed();
    const arrangement = settings.performance === 'orchestra'
      ? arrangeOrchestra(mapped.midi, channelSettings.scale) : null;
    try {
      if (mapped.trigger) {
        audio.play(channel, mapped.midi, mapped.velocity, mapped.pan, channelSettings.sound, arrangement);
      } else audio.pan(channel, mapped.pan);
    } catch {
      fail(new Error('Audio playback stopped. Press Start to try again.'));
      return;
    }
    view.renderNote(channel, mapped, landmarks, time, arrangement);
  }

  /** Body mode's whole dispatch: one pose skeleton in, one sustained chord out.
   *
   * The mapper normalizes, calibrates and classifies; the arrangement gives the
   * settled posture somewhere to sound. A null frame means the body is not usable
   * yet, which is handled exactly like a lost hand rather than as an error.
   */
  function playPose(pose, time) {
    if (state !== 'running' || settings.performance !== 'body') return;
    const frame = mappers[BODY].update(pose, time);
    if (!frame) {
      loseTracking(BODY);
      return;
    }
    tracking[BODY] = true;
    view.showTrackingHint(Boolean(frame.hint), frame.hint || undefined);
    view.setStatus(frame.status);
    const arrangement = frame.trigger ? arrangeBody(frame, borrowed().scale) : null;
    try {
      if (frame.trigger) {
        audio.play(BODY, frame.midi, frame.velocity, frame.pan, null, arrangement);
      } else {
        audio.pan(BODY, frame.pan ?? 0);
      }
    } catch {
      fail(new Error('Audio playback stopped. Press Start to try again.'));
      return;
    }
    view.renderNote(BODY, frame, pose, time, arrangement);
  }

  function handsByChannel(hands) {
    const visible = hands.filter(hand => hand?.[8]).sort((a, b) => (1 - a[8].x) - (1 - b[8].x));
    if (visible.length === 0) return {};
    if (visible.length === 1) return { [(1 - visible[0][8].x) < .5 ? 'left' : 'right']: visible[0] };
    return { left: visible[0], right: visible[visible.length - 1] };
  }

  /** Orchestra keeps one hand on screen: hold the hand nearest the last conductor so
   * a second hand entering frame cannot steal the ensemble mid-note.
   */
  function conductorOf(hands, previousX) {
    const candidates = hands.filter(hand => hand?.[8]);
    if (candidates.length < 2 || previousX === null) return candidates[0] || null;
    // Compare mirrored x on both sides so the nearest hand really is the same hand.
    return candidates.reduce((nearest, hand) =>
      Math.abs(conductorX(hand) - previousX) < Math.abs(conductorX(nearest) - previousX) ? hand : nearest);
  }

  function conductorX(hand) {
    return hand ? 1 - hand[8].x : null;
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
    tracking = clearTracking();
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
      // Orchestra and body ignore the per-hand sound and level, so they borrow one hand's mix.
      audio.setVolume(...masterVolume(), ENSEMBLE);
      audio.setVolume(...masterVolume(), BODY);
      await ownAudio.start();
      if (token !== generation) {
        void ownAudio.close().catch(() => {});
        return;
      }
      if (mode === 'camera') {
        let previousConductorX = null;
        const onHands = (hands, time) => {
          if (token !== generation || state !== 'running' || needsPoseTracker(settings.performance)) return;
          if (settings.performance === 'orchestra') {
            const hand = conductorOf(hands, previousConductorX);
            previousConductorX = conductorX(hand);
            if (hand) {
              // Mirror input once to match the displayed video. Drawing mirrors raw landmarks.
              playPoint(ENSEMBLE, 1 - hand[8].x, hand[8].y, time, hand);
            } else loseTracking(ENSEMBLE);
            return;
          }
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
        };
        const onError = error => { if (token === generation) fail(error); };
        const onStatus = message => { if (token === generation) view.setStatus(message); };
        // One camera, one pipeline: pose tracking loads a different model, so the
        // kind of tracker is decided once at startup and never swapped mid-session.
        tracker = needsPoseTracker(settings.performance)
          ? createPoseTracker(video, playPose, onError)
          : createTracker(video, onHands, onError);
        await tracker.start(onStatus);
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
    const performanceChanged = next.performance !== settings.performance;
    // Entering or leaving body mode needs a different model on the camera, and a
    // tracker cannot be swapped underneath a running session. Orchestra and solo
    // share the hand pipeline, so switching between them stays live.
    if (performanceChanged && needsPoseTracker(next.performance) !== needsPoseTracker(settings.performance)) {
      stop('Ready when you are');
    }
    const changed = CHANNELS.filter(channel =>
      next[channel].scale !== settings[channel].scale || next[channel].sound !== settings[channel].sound);
    const scaleChanged = next.right.scale !== settings.right.scale;
    // Only the channels that are active right now can hold a voice, so capture them
    // before the new performance replaces the old one.
    const sounding = trackedChannels();
    settings = next;
    const toRelease = performanceChanged ? sounding : changed;
    for (const channel of toRelease) {
      audio?.release(channel);
      view.clearVisual(channel);
    }
    for (const channel of changed) mappers[channel].setScale(settings[channel].scale);
    // The borrowed channels must follow the scale they borrow, or the ladder the
    // player sees would stop matching the notes they hear.
    if (scaleChanged) {
      for (const channel of [ENSEMBLE, BODY]) mappers[channel].setScale(settings.right.scale);
    }
    if (performanceChanged) for (const mapper of Object.values(mappers)) mapper.reset();
    for (const channel of CHANNELS) {
      audio?.setVolume(settings[channel].volume / 100, settings[channel].mute, channel);
    }
    if (audio) {
      audio.setVolume(...masterVolume(), ENSEMBLE);
      audio.setVolume(...masterVolume(), BODY);
    }
    view.renderSettings(settings);
    renderControls();
    if (changed.length) view.renderLanes(settings);
    return readSettings();
  }

  function switchMode() {
    stop('Ready when you are');
    mode = mode === 'camera' ? 'mouse' : 'camera';
    // A pointer has no landmarks to read a posture from, so mouse mode is the
    // two-hand instrument's alone and the session says so by switching back.
    if (mode === 'mouse' && settings.performance === 'body') applySettings({ performance: 'solo' });
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
    return {
      performance: settings.performance,
      ...Object.fromEntries(CHANNELS.map(channel => [channel, {
        scale: settings[channel].scale, sound: settings[channel].sound,
        volume: settings[channel].volume, muted: settings[channel].mute,
      }])),
    };
  }

  view.renderLanes(settings);
  view.renderSettings(settings);
  renderControls();
  return { start, stop, switchMode, reset, applySettings, read,
    dispose: () => { stop(); input.dispose(); } };
}
