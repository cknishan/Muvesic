import { SCALES } from '../music/scales.js';
import { noteName, frequency } from '../music/notes.js';
import { POSTURE_LABELS } from '../tracking/classifier.js';
import { createStageRenderer } from './stage-renderer.js';

// Orchestra and body section timbres, in the order the arrangement voices them.
const SECTIONS = ['strings', 'woodwind', 'brass', 'cello'];
const ENSEMBLE = 'ensemble';
const BODY = 'body';
// Performances that drive one channel through a borrowed settings panel.
const SOLO_COPY = {
  title: 'YOUR ORCHESTRA',
  copy: 'Your one hand sets the root note and all four sections follow it. The scale, volume and mute below shape the whole ensemble.',
};
const BODY_COPY = {
  title: 'YOUR DANCE',
  copy: 'Both arms play: the higher one leads, the lower one sets the root, and all four sections hold one chord. Squats sink it, arms up lift it.',
};
const HINTS = {
  solo: 'One or two hands, each on its own sound.',
  orchestra: 'One hand leads the whole ensemble.',
  body: 'Your whole body plays. Stand back so I can see your feet.',
};
const HEADINGS = { orchestra: 'Ensemble', body: 'Body' };
const EYEBROWS = { orchestra: 'ENSEMBLE NOTE', body: 'BODY NOTE' };
const STAGE_HELP = {
  solo: 'Use two hands · Left and right sides control separate sounds · Lift to go higher',
  orchestra: 'One hand conducts · Lift for higher harmonies · Move sideways to pan the ensemble',
  body: 'Stand back · One arm leads and the other harmonizes · Squat to sink it · Arms up to lift it',
};
const WELCOME_HEAD = {
  solo: 'A little movement.<br>A little magic.',
  orchestra: 'An orchestra.<br>In your hands.',
  body: 'Move your body.<br>Make some noise.',
};
const WELCOME_BODY = {
  solo: 'Start your camera, then move one or two<br>index fingers to play.',
  orchestra: 'Start your camera, then move one<br>index finger to conduct the ensemble.',
  body: 'Start your camera and step back so your<br>whole body is in frame. Then move.',
};

/** Collect the DOM contract once; fail early when markup and controls drift. */
export function collectUI(document) {
  const ids = ['stage', 'camera', 'overlay', 'lanes', 'welcome', 'tracking-hint',
    'status', 'input-label', 'start', 'stop', 'mode', 'reset', 'session-time',
    'error', 'stage-help', 'performance', 'performance-hint', 'ensemble',
    'left-panel', 'right-panel', 'conductor-heading', 'conductor-eyebrow',
    'ensemble-title', 'ensemble-copy', 'posture-row', 'posture',
    ...SECTIONS.map(section => 'ensemble-' + section)];
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
    const copy = STAGE_HELP[performance] ?? STAGE_HELP.solo;
    document.body.dataset.performance = performance;
    document.body.dataset.arranged = String(performance !== 'solo');
    document.body.dataset.running = String(state === 'running');
    ui.welcome.querySelector('h2').innerHTML = WELCOME_HEAD[performance] ?? WELCOME_HEAD.solo;
    ui.start.disabled = state !== 'idle';
    ui.stop.disabled = state === 'idle';
    const startLabel = state === 'loading' ? 'Starting…' : mode === 'camera' ? 'Start camera' : 'Start playing';
    ui.start.innerHTML = '<span aria-hidden="true">▶</span> ' + startLabel;
    ui.mode.innerHTML = mode === 'camera'
      ? 'Try with mouse <span aria-hidden="true">↗</span>'
      : 'Use camera <span aria-hidden="true">↗</span>';
    ui['input-label'].textContent = mode === 'camera'
      ? (performance === 'body' ? 'BODY INPUT' : 'CAMERA INPUT') : 'MOUSE / KEYS';
    ui.welcome.hidden = state === 'running';
    ui.camera.hidden = mode !== 'camera';
    ui.stage.style.touchAction = state === 'running' && mode === 'mouse' ? 'none' : 'auto';
    ui['stage-help'].textContent = mode === 'camera' ? copy
      : 'Move your pointer to play · On touchscreens, drag · Arrow keys change pitch and pan · Escape stops';
    ui.welcome.querySelector('p').innerHTML = mode === 'camera'
      ? (WELCOME_BODY[performance] ?? WELCOME_BODY.solo)
      : 'Press Start playing, then move your pointer.<br>You can also focus this area and use arrow keys.';
  }

  // Ensemble and body are single sources, so they read out through the right-hand
  // panel. Every channel must map to a real panel: an unknown id here throws inside
  // the tracking frame loop and takes the camera down with it.
  const panel = channel => (channel === ENSEMBLE || channel === BODY ? 'right' : channel);

  function clearSectionNotes() {
    for (const section of SECTIONS) ui['ensemble-' + section].textContent = '—';
  }

  function clearVisual(channel = null) {
    stage.clear(channel);
    [...ui.lanes.children].forEach(lane => lane.classList.remove('active'));
    const channels = channel ? [panel(channel)] : ['left', 'right'];
    for (const id of channels) {
      ui[id + '-note'].textContent = '—';
      ui[id + '-frequency'].textContent = 'Waiting';
      ui[id + '-dynamics'].textContent = 'At rest';
      ui[id + '-meter-fill'].style.width = '0%';
      ui[id + '-meter'].setAttribute('aria-valuenow', '0');
      ui[id + '-pan-dot'].style.left = '50%';
    }
    if (!channel || channel !== 'left') ui.posture.textContent = '—';
    if (!channel || channel === ENSEMBLE || channel === BODY) clearSectionNotes();
  }

  function renderNote(channel, mapped, landmarks, time, arrangement = null) {
    // Body mode passes a null lane and note while it learns the player's neutral
    // pose, so the readout must tolerate a frame that has not chosen a pitch yet.
    if (mapped.index !== null && mapped.index !== undefined) {
      [...ui.lanes.children].forEach((lane, i) => lane.classList.toggle('active', i === mapped.index));
    }
    const id = panel(channel);
    const singing = mapped.midi !== null && mapped.midi !== undefined;
    ui[id + '-note'].textContent = singing ? noteName(mapped.midi) : '—';
    ui[id + '-frequency'].textContent = singing ? frequency(mapped.midi).toFixed(1) + ' Hz' : 'Waiting';
    if (channel === BODY) ui.posture.textContent = POSTURE_LABELS[mapped.posture] ?? POSTURE_LABELS.moving;
    const intensity = Math.round(mapped.intensity * 100);
    ui[id + '-meter-fill'].style.width = intensity + '%';
    ui[id + '-meter'].setAttribute('aria-valuenow', String(intensity));
    ui[id + '-dynamics'].textContent = intensity > 65 ? 'Expressive' : intensity > 20 ? 'Flowing' : 'Gentle';
    ui[id + '-pan-dot'].style.left = mapped.x * 100 + '%';
    if (channel === ENSEMBLE || channel === BODY) {
      clearSectionNotes();
      for (const part of arrangement || []) {
        const readout = ui['ensemble-' + part.sound];
        if (readout) readout.textContent = noteName(part.midi);
      }
    }
    stage.paint(channel, landmarks, mapped, time);
  }

  function renderSettings(settings) {
    const performance = settings.performance;
    // Orchestra and body each collapse to one source, so the second hand panel is
    // put away and the surviving panel is relabelled instead of showing two scales.
    const single = performance !== 'solo';
    const arranged = performance === 'orchestra' || performance === 'body';
    ui.performance.value = performance;
    // data-arranged is the layout the stylesheet keys off, so a new single-source
    // performance inherits the one-panel arrangement styling with no CSS of its own.
    document.body.dataset.performance = performance;
    document.body.dataset.arranged = String(arranged);
    ui['performance-hint'].textContent = HINTS[performance] ?? HINTS.solo;
    ui['left-panel'].hidden = single;
    ui['right-panel'].hidden = false;
    ui['conductor-heading'].textContent = HEADINGS[performance] ?? 'Right hand';
    ui['conductor-eyebrow'].textContent = EYEBROWS[performance] ?? 'RIGHT NOTE';
    // Only body mode has a posture to name, so the row is hidden rather than
    // sitting there reading "—" beside the two-hand panels.
    ui['posture-row'].hidden = performance !== 'body';
    ui.ensemble.hidden = !arranged;
    if (arranged) {
      const copy = performance === 'body' ? BODY_COPY : SOLO_COPY;
      ui['ensemble-title'].textContent = copy.title;
      ui['ensemble-copy'].textContent = copy.copy;
      clearSectionNotes();
    }
    for (const channel of ['left', 'right']) {
      const { scale, sound, volume, mute } = settings[channel];
      ui[channel + '-scale'].value = scale;
      ui[channel + '-sound'].value = sound;
      // The arrangement chooses section timbres, so solo sounds do not apply here.
      ui[channel + '-sound'].hidden = arranged;
      ui[channel + '-sound-label'].hidden = arranged;
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
    // Body mode supplies its own message; the two-hand modes keep the default copy.
    showTrackingHint: (visible, message) => {
      ui['tracking-hint'].hidden = !visible;
      if (message) ui['tracking-hint'].innerHTML = message;
    },
    showError: message => {
      ui.error.hidden = !message;
      ui.error.textContent = message || '';
    },
  };
}
