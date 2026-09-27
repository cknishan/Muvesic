import { MotionMapper } from '../music/motion-mapper.js';
import { GuitarMapper } from '../music/guitar-mapper.js';
import { SCALES } from '../music/scales.js';
import { Synthesizer } from '../audio.js';
import { HandTracker } from '../tracking/hand-tracker.js';
import { TwoHandTracker } from '../tracking/two-hand-tracker.js';
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
  createGuitarTracker = (...args) => new TwoHandTracker(...args),
}) {
  const mapper = new MotionMapper();
  const guitarMapper = new GuitarMapper();
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
      guitarMapper.reset();
      view.clearVisual();
    }

    tracking = false;
    view.showTrackingHint(state === 'running' && mode === 'camera');

    if (state === 'running') {
      view.setStatus(mode === 'camera'
        ? settings.sound === 'guitar'
          ? 'Show both hands to play Guitar'
          : 'No hand detected'
        : 'Move into the play area');
    }
  }

  function playPoint(x, y, time, landmarks = null) {
    if (state !== 'running') return;

    const mapped = mapper.update(x, y, time);
    if (!mapped) return;

    tracking = true;
    view.showTrackingHint(false);
    view.setStatus(
      mode === 'camera'
        ? 'Hand tracked · Playing'
        : 'Mouse & keys · Playing'
    );

    try {
      if (mapped.trigger) {
        audio.play(
          mapped.midi,
          mapped.velocity,
          mapped.pan,
          settings.sound
        );
      } else {
        audio.pan(mapped.pan);
      }
    } catch {
      fail(new Error('Audio playback stopped. Press Start to try again.'));
      return;
    }

    view.renderNote(mapped, landmarks, time);
  }

  function playGuitar(hands, time) {
    if (state !== 'running') return;

    if (!Array.isArray(hands) || hands.length < 2) {
      loseTracking();
      return;
    }

    // The camera video is mirrored on screen. The screen-left hand
    // selects the note; the screen-right hand strums.
    const ordered = hands.slice(0, 2).map(landmarks => ({
      landmarks,
      screenX: 1 - landmarks?.[9]?.x,
    }));

    if (ordered.some(hand =>
      hand.landmarks?.length < 21 ||
      !Number.isFinite(hand.screenX) ||
      !Number.isFinite(hand.landmarks[8]?.x) ||
      !Number.isFinite(hand.landmarks[8]?.y)
    )) {
      loseTracking();
      return;
    }

    ordered.sort((a, b) => a.screenX - b.screenX);

    const fretHand = ordered[0].landmarks;
    const strumHand = ordered[1].landmarks;

    const mapped = guitarMapper.update(
      1 - fretHand[8].x,
      fretHand[8].y,
      1 - strumHand[8].x,
      strumHand[8].y,
      time
    );

    if (!mapped) return;

    tracking = true;
    view.showTrackingHint(false);
    view.setStatus(
      mapped.trigger
        ? 'Guitar · Strum!'
        : 'Guitar · Two hands tracked'
    );

    try {
      if (mapped.trigger) {
        audio.play(
          mapped.midi,
          mapped.velocity,
          mapped.pan,
          'guitar'
        );
      } else {
        audio.pan(mapped.pan);
      }
    } catch {
      fail(new Error('Audio playback stopped. Press Start to try again.'));
      return;
    }

    view.renderNote(mapped, [fretHand, strumHand], time);
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
    guitarMapper.reset();
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
        const guitarMode = settings.sound === 'guitar';
        const trackerFactory = guitarMode
          ? createGuitarTracker
          : createTracker;

        const onFrame = guitarMode
          ? (hands, time) => {
              if (token !== generation || state !== 'running') return;
              playGuitar(hands, time);
            }
          : (landmarks, time) => {
              if (token !== generation || state !== 'running') return;

              if (!landmarks) {
                loseTracking();
                return;
              }

              // Mirror input once to match the displayed video.
              playPoint(
                1 - landmarks[8].x,
                landmarks[8].y,
                time,
                landmarks
              );
            };

        const ownTracker = trackerFactory(
          video,
          onFrame,
          error => {
            if (token === generation) fail(error);
          }
        );

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
        view.setTime(
          Math.floor((performance.now() - started) / 1000)
        );
      }, 250);

      renderControls();
      loseTracking();

      if (mode === 'mouse') {
        view.focusStage();
        input.start();
      }
    } catch (error) {
      if (token === generation && error.name !== 'AbortError') {
        fail(error);
      }
    }
  }

  function applySettings(patch) {
    const next = validateSettings(patch, settings);

    const changed =
      next.scale !== settings.scale ||
      next.sound !== settings.sound;

    const trackerChanged =
      (next.sound === 'guitar') !==
      (settings.sound === 'guitar');

    settings = next;

    if (changed) {
      audio?.release();
      mapper.setScale(settings.scale);
      guitarMapper.setScale(settings.scale);
      view.clearVisual();
    }

    audio?.setVolume(settings.volume / 100, settings.mute);
    view.renderSettings(settings);

    if (changed) {
      view.renderLanes(settings.scale);
    }

    // A one-hand tracker cannot become a two-hand tracker mid-session.
    if (trackerChanged && mode === 'camera' && state !== 'idle') {
      stop('Instrument changed · Press Start camera again');
    }

    return {
      scale: settings.scale,
      sound: settings.sound,
      volume: settings.volume,
      muted: settings.mute,
    };
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
    return {
      state,
      mode,
      scale: settings.scale,
      sound: settings.sound,
      volume: settings.volume,
      muted: settings.mute,
    };
  }

  view.renderLanes(settings.scale);
  view.renderSettings(settings);
  renderControls();

  return {
    start,
    stop,
    switchMode,
    reset,
    applySettings,
    read,
    dispose: () => {
      stop();
      input.dispose();
    },
  };
}
