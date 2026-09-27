import { SCALES } from '../music/scales.js';
import { noteName, frequency } from '../music/notes.js';
import { createStageRenderer } from './stage-renderer.js';

/** Collect the DOM contract once; fail early when markup and controls drift. */
export function collectUI(document) {
  const ids = ['stage', 'camera', 'overlay', 'lanes', 'welcome', 'tracking-hint',
    'status', 'input-label', 'start', 'stop', 'mode', 'reset', 'sound', 'scale',
    'scale-hint', 'volume', 'volume-value', 'mute', 'note', 'frequency', 'dynamics',
    'meter', 'meter-fill', 'pan-dot', 'session-time', 'error', 'stage-help'];
  return Object.fromEntries(ids.map(id => {
    const element = document.getElementById(id);
    if (!element) throw new Error('Missing instrument element: ' + id);
    return [id, element];
  }));
}

/** DOM presentation only. The session controller supplies state and note events. */
export function createInstrumentView(ui) {
  const stage = createStageRenderer(ui.overlay);
  function renderLanes(scale) {
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
    ui['scale-hint'].textContent = SCALES[scale].hint;
  }

  function renderControls({ state, mode }) {
    document.body.dataset.running = String(state === 'running');
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
      ? 'Use one hand · Lift to go higher · Move sideways to pan · Move faster for louder notes'
      : 'Move your pointer to play · On touchscreens, drag · Arrow keys change pitch and pan · Escape stops';
    ui.welcome.querySelector('p').innerHTML = mode === 'camera'
      ? 'Start your camera, then move your<br>index finger up and down to play.'
      : 'Press Start playing, then move your pointer.<br>You can also focus this area and use arrow keys.';
  }

  function clearVisual() {
    stage.clear();
    [...ui.lanes.children].forEach(lane => lane.classList.remove('active'));
    ui.note.textContent = '—';
    ui.frequency.textContent = 'Waiting to play';
    ui.dynamics.textContent = 'At rest';
    ui['meter-fill'].style.width = '0%';
    ui.meter.setAttribute('aria-valuenow', '0');
    ui['pan-dot'].style.left = '50%';
  }

  function renderNote(mapped, landmarks, time) {
    [...ui.lanes.children].forEach((lane, i) => lane.classList.toggle('active', i === mapped.index));
    ui.note.textContent = noteName(mapped.midi);
    ui.frequency.textContent = frequency(mapped.midi).toFixed(1) + ' Hz';
    const intensity = Math.round(mapped.intensity * 100);
    ui['meter-fill'].style.width = intensity + '%';
    ui.meter.setAttribute('aria-valuenow', String(intensity));
    ui.dynamics.textContent = intensity > 65 ? 'Expressive' : intensity > 20 ? 'Flowing' : 'Gentle';
    ui['pan-dot'].style.left = mapped.x * 100 + '%';
    stage.paint(landmarks, mapped, time);
  }

  function renderSettings({ scale, sound, volume, mute }) {
    ui.scale.value = scale;
    ui.sound.value = sound;
    ui.volume.value = String(volume);
    ui['volume-value'].textContent = volume + '%';
    ui.mute.setAttribute('aria-pressed', String(mute));
    ui.mute.textContent = mute ? 'Unmute' : 'Mute';
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
