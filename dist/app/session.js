import { applyPosture, arrangeOrchestra } from '../music/orchestra.js';
import { BodyMapper } from '../music/body-mapper.js';
import { MotionMapper } from '../music/motion-mapper.js';
import { SCALES } from '../music/scales.js';
import { Synthesizer } from '../audio.js';
import { HandTracker } from '../tracking/hand-tracker.js';
import { PoseTracker } from '../tracking/pose-tracker.js';
import { cameraError } from '../tracking/errors.js';
import { LIMBS, DEFAULT_SETTINGS, validateSettings } from './settings.js';

const ENSEMBLE = 'ensemble';
const HAND_CHANNELS = ['left', 'right'];
/** Which channels each performance owns. Solo drives two hands; orchestra drives
 *  one conductor; body drives four limbs, one per tracked body part. */
const PERFORMANCES = Object.freeze({
  solo: HAND_CHANNELS, orchestra: [ENSEMBLE], body: [...LIMBS],
});
const ALL_CHANNELS = Object.freeze([...HAND_CHANNELS, ENSEMBLE, ...LIMBS]);

/** Owns idle/loading/running transitions and per-session resources.
 * Factories are injectable so lifecycle tests need neither a DOM nor hardware.
 * The generation token prevents an old async startup from reviving a stopped session.
 *
 * Performance modes are exclusive. Solo plays the two tracked hands; orchestra
 * collapses to one conductor driving a four-section ensemble; body mode swaps the
 * hands for a pose skeleton and turns each visible limb into its own voice, so a
 * full-body player sounds four channels at once. Either way only the active
 * channels own a voice.
 */
export function createSession({
  view, video, createInput,
  createAudio = () => new Synthesizer(),
  createTracker = (...args) => new HandTracker(...args),
  createPoseTracker = (...args) => new PoseTracker(...args),
}) {
  // Each voice channel keeps its own musical history. Body mode's geometry mapper
  // is shared by all four limb voices; it owns calibration and posture, not audio.
  const voices = Object.fromEntries(LIMBS.map(channel => [channel, new MotionMapper(DEFAULT_SETTINGS[channel].scale)]));
  voices[ENSEMBLE] = new MotionMapper(DEFAULT_SETTINGS.right.scale);
  const geometry = new BodyMapper();
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
  const activeChannels = () => PERFORMANCES[settings.performance] ?? HAND_CHANNELS;
  const trackedChannels = () => activeChannels().filter(id => tracking[id]);
  // The borrowed channels used to include body, but body now owns its own scale,
  // so only the ensemble still borrows the right hand's mix.
  const borrowed = () => settings.right;
  const masterVolume = () => [borrowed().volume / 100, borrowed().mute];
  // Body mode needs a pose model, which is a different camera pipeline entirely.
  const needsPoseTracker = performance => performance === 'body';

  const input = createInput({
    isEnabled: () => mode === 'mouse' && state === 'running',
    getLaneCount: () => SCALES[settings.right.scale].notes.length,
    onPoint: (x, y, time) => playPoint(practiceChannel(), x, y, time),
    onLost: () => loseTracking(practiceChannel()),
    onPitchStep: () => voices[practiceChannel()].resetSmoothing(),
  });
  const renderControls = () => view.renderControls({ state, mode, performance: settings.performance });

  function loseTracking(channel = null) {
    const channels = channel ? [channel] : activeChannels();
    for (const id of channels) {
      if (tracking[id]) {
        audio?.release(id);
        voices[id]?.reset();
        geometry.reset();
        view.clearVisual(id);
      }
      tracking[id] = false;
    }
    const tracked = trackedChannels().length;
    // Body mode carries its own guidance: how much of the player is in frame and
    // whether the neutral pose has been learned yet.
    const hint = settings.performance === 'body' ? geometry.hint() : null;
    view.showTrackingHint(state === 'running' && mode === 'camera' && tracked === 0, hint || undefined);
    if (state === 'running') {
      if (settings.performance === 'body') {
        view.setStatus(geometry.status());
      } else {
        const missed = 'No hands detected';
        const guidance = settings.performance === 'orchestra'
          ? 'Show one index finger to conduct the ensemble'
          : 'Show one or two hands, then move an index finger to play';
        view.setStatus(mode === 'camera' ? tracked ? guidance + ' · Playing' : missed : 'Mouse & keys · Playing');
      }
    }
  }

  /** Hand and orchestra: one tracker point becomes one note event on one channel. */
  function playPoint(channel, x, y, time, landmarks = null) {
    if (state !== 'running') return;
    const mapped = voices[channel].update(x, y, time);
    if (!mapped) return;
    tracking[channel] = true;
    view.showTrackingHint(false);
    const tracked = trackedChannels().length;
    const hand = tracked + (settings.performance === 'orchestra' ? ' hand conducting' : ' hand' + (tracked === 1 ? '' : 's') + ' tracked');
    view.setStatus(mode === 'camera' ? hand + ' · Playing' : 'Mouse & keys · Playing');
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

  /** Body mode: one pose becomes up to four voice events, one per visible limb. */
  function playPose(pose, time) {
    if (state !== 'running' || settings.performance !== 'body') return;
    const frame = geometry.update(pose, time);
    if (!frame) {
      loseTrackingForBody();
      return;
    }
    view.showTrackingHint(Boolean(frame.hint), frame.hint || undefined);
    view.setStatus(frame.status);
    // Postures are a body-level mood: arms up lifts the arms, squat drops the
    // legs, wide opens stereo, lean drags the rig. Apply once before dispatch so
    // every limb gets the same shape.
    const voiced = applyPosture(
      frame.limbs.map(limb => ({
        ...limb,
        ...voices[limb.channel].update(limb.x, limb.y, time),
      })),
      frame.posture, frame.strength);
    let any = false;
    for (const event of voiced) {
      if (!event) continue;
      const channel = event.channel;
      const visible = frame.limbs.find(l => l.channel === channel)?.visible;
      if (!visible) {
        if (tracking[channel]) {
          audio?.release(channel);
          voices[channel].reset();
          view.clearVisual(channel);
          tracking[channel] = false;
        }
        continue;
      }
      any = true;
      tracking[channel] = true;
      const channelSettings = settings[channel];
      // Each limb carries its own octave shift, so legs stay in the bass while
      // arms live in the melody register.
      const midi = event.midi + channelSettings.octave;
      try {
        if (event.trigger) {
          audio.play(channel, midi, event.velocity, event.pan, channelSettings.sound, null);
        } else audio.pan(channel, event.pan);
      } catch {
        fail(new Error('Audio playback stopped. Press Start to try again.'));
        return;
      }
      view.renderNote(channel, { ...event, midi }, pose, time, null);
    }
    if (!any) loseTrackingForBody();
  }

  /** Body mode's analogue of losing a hand: release every limb that was sounding. */
  function loseTrackingForBody() {
    for (const channel of LIMBS) {
      if (tracking[channel]) {
        audio?.release(channel);
        voices[channel].reset();
        view.clearVisual(channel);
      }
      tracking[channel] = false;
    }
    geometry.reset();
    const hint = geometry.hint();
    view.showTrackingHint(state === 'running' && mode === 'camera', hint || undefined);
    if (state === 'running') view.setStatus(geometry.status());
  }

  function handsByChannel(hands) {
    const visible = hands.filter(hand => hand?.[8]).sort((a, b) => (1 - a[8].x) - (1 - b[8].x));
    if (visible.length === 0) return {};
    if (visible.length === 1) return { [(1 - visible[0][8].x) < .5 ? 'left' : 'right']: visible[0] };
    return { left: visible[0], right: visible[visible.length - 1] };
  }

  /** Orchestra keeps one hand on screen: hold the hand nearest the last conductor so
   * a second hand entering frame cannot steal the ensemble mid-note. */
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
    for (const voice of Object.values(voices)) voice.reset();
    geometry.reset();
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
      for (const channel of ALL_CHANNELS) {
        audio.setVolume(settings[channel].volume / 100, settings[channel].mute, channel);
      }
      // Orchestra ignores per-hand sounds and borrows the right hand's mix.
      audio.setVolume(...masterVolume(), ENSEMBLE);
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
          for (const channel of HAND_CHANNELS) {
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
      if (token !== generation && error.name !== 'AbortError') fail(error);
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
    // Each channel that changed its scale needs its mapper retuned, and the
    // ensemble still borrows the right hand's scale.
    const scaleChanged = {};
    for (const channel of ALL_CHANNELS) {
      scaleChanged[channel] = next[channel].scale !== settings[channel].scale;
    }
    const sounding = trackedChannels();
    settings = next;
    const toRelease = performanceChanged ? sounding : ALL_CHANNELS.filter(channel =>
      next[channel].scale !== settings[channel].scale || next[channel].sound !== settings[channel].sound);
    for (const channel of toRelease) {
      audio?.release(channel);
      view.clearVisual(channel);
    }
    for (const channel of ALL_CHANNELS) if (scaleChanged[channel]) voices[channel]?.setScale(settings[channel].scale);
    if (performanceChanged) {
      for (const voice of Object.values(voices)) voice.reset();
      geometry.reset();
    }
    for (const channel of ALL_CHANNELS) {
      audio?.setVolume(settings[channel].volume / 100, settings[channel].mute, channel);
    }
    if (audio) audio.setVolume(...masterVolume(), ENSEMBLE);
    view.renderSettings(settings);
    renderControls();
    if (Object.values(scaleChanged).some(Boolean)) view.renderLanes(settings);
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
    const snapshot = { performance: settings.performance };
    for (const channel of ALL_CHANNELS) {
      const { scale, sound, volume, mute, octave } = settings[channel];
      snapshot[channel] = { scale, sound, volume, muted: mute, octave };
    }
    return snapshot;
  }

  view.renderLanes(settings);
  view.renderSettings(settings);
  renderControls();
  return { start, stop, switchMode, reset, applySettings, read,
    dispose: () => { stop(); input.dispose(); } };
}
