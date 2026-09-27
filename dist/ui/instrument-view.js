import { SCALES } from '../music/scales.js';
import { noteName, frequency } from '../music/notes.js';
import { createStageRenderer } from './stage-renderer.js';

/** Collect the DOM contract once; fail early when markup and controls drift. */
export function collectUI(document) {
  const ids = ['stage', 'camera', 'overlay', 'lanes', 'welcome', 'tracking-hint',
    'status', 'input-label', 'start', 'stop', 'mode', 'reset', 'session-time',
    'error', 'stage-help', 'performance', 'performance-hint', 'ensemble'];
  for (const channel of ['left', 'right']) {
    ids.push(channel + '-sound', channel + '-sound-label', channel + '-scale',
      channel + '-scale-hint', channel + '-volume', channel + '-volume-value',
      channel + '-mute', channel + '-note', channel + '-frequency', channel + '-dynamics',
      channel + '-meter', channel + '-meter-fill', channel + '-pan-dot');
  }
  return Object.fromEntries(ids.map(id => {
    const element = document.getElementById(id);
    if (!element) throw new Error('Missing instrument element: ' + id);
    return [id, element];
  }));
}

/** DOM presentation only. The session controller supplies state and note events.
 * Solo and orchestra are exclusive: the two hand panels and the ensemble panel
 * never appear at the same time, so one performance is always legible.
 */
export function createInstrumentView(ui) {
  const stage = createStageRenderer(ui.overlay);

  function renderLanes(settings) {
    const scale = settings.right?.scale || settings.scale || 'pentatonic';
    const lanes = [...SCALES[scale].notes].reverse().map((midi, i) => {
      const lane = document.createElement('div');
      lane.className = 'lane';
      const label = document.createElement('span');
      label.textContent = noteName(midi);
      const hint = document.createElement('span');
      hint.className = 'key-hint';
      hint.textContent = String(i + 1).padStart(2, '0');
      lane.append(label, hint);
      return lane;
    });
    ui.lanes.replaceChildren(...lanes);
    for (const channel of ['left', 'right']) {
      const channelScale = settings[channel]?.scale || scale;
      ui[channel + '-scale-hint'].textContent = SCALES[channelScale].hint;
    }
  }

  function renderControls({ state, mode, performance = 'solo' }) {
    const ensemble = performance === 'orchestra';
    document.body.dataset.performance = performance;
    document.body.dataset.running = String(state === 'running');
    ui.welcome.querySelector('h2').innerHTML = ensemble
      ? 'An orchestra.<br>In your hands.' : 'A little movement.<br>A little magic.';
    ui.start.disabled = state !== 'idle';
    ui.stop.disabled = state === 'idle';
    const startLabel = state === 'loading' ? 'Starting…' : mode === 'camera' ? 'Start camera' : 'Start playing';
    ui.start.innerHTML = '<span aria-hidden="true">▶</span> ' + startLabel;
    ui.mode.innerHTML = mode === 'camera'
      ? 'Try with mouse <span aria-hidden="true">↗</span>'
      : 'Use camera <span aria-hidden="true">↗</span>';
    ui['input-label'].textContent = mode === 'camera' ? 'CAMERA INPUT' : 'MOUSE / KEYS';
    ui.welcome.hidden = state === 'running';
    ui.camera.hidden = mode !== 'camera';
    ui.stage.style.touchAction = state === 'running' && mode === 'mouse' ? 'none' : 'auto';
    ui['stage-help'].textContent = mode === 'camera'
      ? ensemble
        ? 'One hand conducts · Lift for higher harmonies · Move sideways to pan the ensemble'
        : 'Use two hands · Left and right sides control separate sounds · Lift to go higher'
      : 'Move your pointer to play · On touchscreens, drag · Arrow keys change pitch and pan · Escape stops';
    ui.welcome.querySelector('p').innerHTML = mode === 'camera'
      ? ensemble
        ? 'Start your camera, then move one<br>index finger to conduct the ensemble.'
        : 'Start your camera, then move one or two<br>index fingers to play.'
      : 'Press Start playing, then move your pointer.<br>You can also focus this area and use arrow keys.';
  }

  function clearVisual(channel = null) {
    stage.clear(channel);
    [...ui.lanes.children].forEach(lane => lane.classList.remove('active'));
    const channels = channel ? [channel] : ['left', 'right'];
    for (const id of channels) {
      ui[id + '-note'].textContent = '—';
      ui[id + '-frequency'].textContent = 'Waiting';
      ui[id + '-dynamics'].textContent = 'At rest';
      ui[id + '-meter-fill'].style.width = '0%';
      ui[id + '-meter'].setAttribute('aria-valuenow', '0');
      ui[id + '-pan-dot'].style.left = '50%';
    }
  }

  function renderNote(channel, mapped, landmarks, time) {
    [...ui.lanes.children].forEach((lane, i) => lane.classList.toggle('active', i === mapped.index));
    const id = channel === 'ensemble' ? 'right' : channel;
    ui[id + '-note'].textContent = noteName(mapped.midi);
    ui[id + '-frequency'].textContent = frequency(mapped.midi).toFixed(1) + ' Hz';
    const intensity = Math.round(mapped.intensity * 100);
    ui[id + '-meter-fill'].style.width = intensity + '%';
    ui[id + '-meter'].setAttribute('aria-valuenow', String(intensity));
    ui[id + '-dynamics'].textContent = intensity > 65 ? 'Expressive' : intensity > 20 ? 'Flowing' : 'Gentle';
    ui[id + '-pan-dot'].style.left = mapped.x * 100 + '%';
    stage.paint(channel, landmarks, mapped, time);
  }

  function renderSettings(settings) {
    ui.performance.value = settings.performance;
    const ensemble = settings.performance === 'orchestra';
    document.body.dataset.performance = settings.performance;
    ui['performance-hint'].textContent = ensemble
      ? 'One hand leads the whole ensemble.' : 'One or two hands, each on its own sound.';
    ui.ensemble.hidden = !ensemble;
    for (const channel of ['left', 'right']) {
      const { scale, sound, volume, mute } = settings[channel];
      ui[channel + '-scale'].value = scale;
      ui[channel + '-sound'].value = sound;
      // The arrangement chooses section timbres, so solo sounds do not apply here.
      ui[channel + '-sound'].hidden = ensemble;
      ui[channel + '-sound-label'].hidden = ensemble;
      ui[channel + '-volume'].value = String(volume);
      ui[channel + '-volume-value'].textContent = volume + '%';
      ui[channel + '-mute'].setAttribute('aria-pressed', String(mute));
      ui[channel + '-mute'].textContent = mute ? 'Unmute' : 'Mute';
    }
  }

  function setTime(seconds) {
    ui['session-time'].textContent = String(Math.floor(seconds / 60)).padStart(2, '0') +
      ':' + String(seconds % 60).padStart(2, '0');
  }

  return {
    renderLanes, renderControls, renderSettings, renderNote, clearVisual, setTime,
    redraw: stage.redraw,
    focusStage: () => ui.stage.focus({ preventScroll: true }),
    setStatus: message => { ui.status.textContent = message; },
    showTrackingHint: visible => { ui['tracking-hint'].hidden = !visible; },
    showError: message => {
      ui.error.hidden = !message;
      ui.error.textContent = message || '';
    },
  };
}
