import { arrangeOrchestra } from '../music/orchestra.js';
import { MotionMapper } from '../music/motion-mapper.js';
import { SCALES } from '../music/scales.js';
import { Synthesizer } from '../audio.js';
import { HandTracker } from '../tracking/hand-tracker.js';
import { cameraError } from '../tracking/errors.js';
import { CHANNELS, DEFAULT_SETTINGS, validateSettings } from './settings.js';

const ENSEMBLE = 'ensemble';
const FINGERTIPS = Object.freeze([4, 8, 12, 16, 20]);
const FINGER_CLUSTER_RADIUS = .18;

/** Owns idle/loading/running transitions and per-session resources.
 * Factories are injectable so lifecycle tests need neither a DOM nor hardware.
 * The generation token prevents an old async startup from reviving a stopped session.
 *
 * Performance modes are exclusive. Solo plays the two tracked hands on their own
 * left/right channels; orchestra drops to a single conductor that drives one
 * four-section ensemble. Either way only the active channels own a voice.
 */
export function createSession({
  view, video, createInput,
  createAudio = () => new Synthesizer(),
  createTracker = (...args) => new HandTracker(...args),
}) {
  // The ensemble keeps its own musical history so it never inherits a hand's notes.
  const mappers = Object.fromEntries([...CHANNELS, ENSEMBLE].map(channel =>
    [channel, new MotionMapper(DEFAULT_SETTINGS[channel]?.scale || DEFAULT_SETTINGS.right.scale)]));
  let settings = { ...DEFAULT_SETTINGS };
  let mode = 'camera';
  let state = 'idle';
  let audio = null;
  let tracker = null;
  let generation = 0;
  let sessionTimer = null;
  let tracking = { left: false, right: false };

  // Solo reads the right hand's scale, matching the keyboard lanes it draws.
  const practiceChannel = () => settings.performance === 'orchestra' ? ENSEMBLE : 'right';
  const activeChannels = () => settings.performance === 'orchestra' ? [ENSEMBLE] : CHANNELS;
  const trackedChannels = () => activeChannels().filter(id => tracking[id]);
  // The ensemble has no settings of its own: it borrows the right hand's scale and mix.
  const ensembleSettings = () => settings.right;
  const masterVolume = () => {
    const { volume, mute } = ensembleSettings();
    return [volume / 100, mute];
  };

  const input = createInput({
    isEnabled: () => mode === 'mouse' && state === 'running',
    getLaneCount: () => SCALES[settings.right.scale].notes.length,
    onPoint: (x, y, time) => playPoint(practiceChannel(), x, y, time),
    onLost: () => loseTracking(practiceChannel()),
    onPitchStep: () => mappers[practiceChannel()].resetSmoothing(),
  });
  const renderControls = () => view.renderControls({ state, mode, performance: settings.performance });

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
    const tracked = trackedChannels().length;
    view.showTrackingHint(state === 'running' && mode === 'camera' && tracked === 0);
    if (state === 'running') {
      const hint = settings.performance === 'orchestra'
        ? 'Show one index finger to conduct the ensemble'
        : 'Show one or two hands, then move an index finger to play';
      view.setStatus(mode === 'camera' ? tracked ? hint + ' · Playing' : 'No hands detected' : 'Mouse & keys · Playing');
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
    const channelSettings = settings[channel] || ensembleSettings();
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

  function fingertipsClustered(hand) {
    const tips = FINGERTIPS.map(index => hand?.[index]);
    if (tips.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
    for (let i = 0; i < tips.length; i++) {
      for (let j = i + 1; j < tips.length; j++) {
        if (Math.hypot(tips[i].x - tips[j].x, tips[i].y - tips[j].y) > FINGER_CLUSTER_RADIUS) {
          return false;
        }
      }
    }
    return true;
  }

  function muteAll(message = 'Fingers closed · Sound muted') {
    for (const channel of [...CHANNELS, ENSEMBLE]) {
      audio?.release(channel);
      mappers[channel].reset();
      view.clearVisual(channel);
      tracking[channel] = false;
    }
    view.showTrackingHint(false);
    if (state === 'running') view.setStatus(message);
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
      // Orchestra ignores the per-hand sound and level, so it borrows one hand's mix.
      audio.setVolume(...masterVolume(), ENSEMBLE);
      await ownAudio.start();
      if (token !== generation) {
        void ownAudio.close().catch(() => {});
        return;
      }
      if (mode === 'camera') {
        let previousConductorX = null;
        const ownTracker = createTracker(video, (hands, time) => {
          if (token !== generation || state !== 'running') return;
          if (settings.performance === 'orchestra') {
            const hand = conductorOf(hands, previousConductorX);
            previousConductorX = conductorX(hand);
            if (hand) {
              if (fingertipsClustered(hand)) {
                muteAll();
                return;
              }
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
            } else if (fingertipsClustered(landmarks)) {
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
    const performanceChanged = next.performance !== settings.performance;
    const changed = CHANNELS.filter(channel =>
      next[channel].scale !== settings[channel].scale || next[channel].sound !== settings[channel].sound);
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
    if (performanceChanged) for (const mapper of Object.values(mappers)) mapper.reset();
    for (const channel of CHANNELS) {
      audio?.setVolume(settings[channel].volume / 100, settings[channel].mute, channel);
    }
    if (audio) audio.setVolume(...masterVolume(), ENSEMBLE);
    view.renderSettings(settings);
    renderControls();
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
