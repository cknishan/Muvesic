import { SCALES } from '../music/scales.js';
import { noteName, frequency } from '../music/notes.js';
import { POSTURE_LABELS } from '../tracking/classifier.js';
import { createStageRenderer } from './stage-renderer.js';

// Orchestra section timbres, in the order the arrangement voices them.
const SECTIONS = ['strings', 'woodwind', 'brass', 'cello'];
const ENSEMBLE = 'ensemble';
/** Each body-mode limb has its own panel prefix. The panel id and the control
 *  ids share the prefix so a single channel maps to one readable block. */
const LIMB_PREFIX = { left: 'left-arm', right: 'right-arm', lowerLeft: 'left-leg', lowerRight: 'right-leg' };

const SOLO_COPY = {
  title: 'YOUR ORCHESTRA',
  copy: 'Your one hand sets the root note and all four sections follow it. The scale, volume and mute below shape the whole ensemble.',
};
const BODY_COPY = {
  title: 'YOUR FOUR VOICES',
  copy: 'Each limb is its own channel with its own sound. Arms read wrist height, legs read ankle height. Hold a posture to colour the band.',
};
const HINTS = {
  solo: 'One or two hands, each on its own sound.',
  orchestra: 'One hand leads the whole ensemble.',
  body: 'Your whole body is the instrument. Arms and legs each have their own sound.',
};
const STAGE_HELP = {
  solo: 'Use two hands · Left and right sides control separate sounds · Lift to go higher',
  orchestra: 'One hand conducts · Lift for higher harmonies · Move sideways to pan the ensemble',
  body: 'Stand back so your whole body is in frame · Each limb plays its own sound · Hold a posture to colour the band',
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
    'limbs', 'limbs-title', 'limbs-copy',
    ...SECTIONS.map(section => 'ensemble-' + section)];
  for (const channel of ['left', 'right']) {
    ids.push(channel + '-sound', channel + '-sound-label', channel + '-scale',
      channel + '-scale-hint', channel + '-volume', channel + '-volume-value',
      channel + '-mute', channel + '-note', channel + '-frequency', channel + '-dynamics',
      channel + '-meter', channel + '-meter-fill', channel + '-pan-dot');
  }
  for (const channel of Object.keys(LIMB_PREFIX)) {
    const prefix = LIMB_PREFIX[channel];
    ids.push(prefix + '-panel', prefix + '-sound', prefix + '-sound-label',
      prefix + '-scale', prefix + '-volume', prefix + '-volume-value',
      prefix + '-mute', prefix + '-note', prefix + '-frequency',
      prefix + '-dynamics', prefix + '-meter', prefix + '-meter-fill', prefix + '-pan-dot');
  }
  return Object.fromEntries(ids.map(id => {
    const element = document.getElementById(id);
    if (!element) throw new Error('Missing instrument element: ' + id);
    return [id, element];
  }));
}

/** DOM presentation only. The session controller supplies state and note events.
 *  The three performances are exclusive: solo shows two hand panels, orchestra
 *  shows the section arrangement, body shows four limb panels — never together,
 *  so one performance is always legible. */
export function createInstrumentView(ui) {
  const stage = createStageRenderer(ui.overlay);

  function renderLanes(settings) {
    // The right hand's scale sets the visible ladder in all three modes; body
    // mode reuses the right arm's ladder for its arms, and the left arm/legs
    // get a hidden copy that the audio engine reads but the player does not see.
    const scale = settings.right?.scale || 'pentatonic';
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
    document.body.dataset.arranged = String(performance === 'orchestra');
    document.body.dataset.limbs = String(performance === 'body');
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

  /** Resolve a channel id to the DOM panel prefix that reads it out. */
  function panel(channel) {
    if (channel === ENSEMBLE) return 'right';
    if (Object.hasOwn(LIMB_PREFIX, channel)) return LIMB_PREFIX[channel];
    return channel;
  }

  function clearSectionNotes() {
    for (const section of SECTIONS) ui['ensemble-' + section].textContent = '—';
  }

  function clearLimbPanel(prefix) {
    ui[prefix + '-note'].textContent = '—';
    ui[prefix + '-frequency'].textContent = 'Waiting';
    ui[prefix + '-dynamics'].textContent = 'At rest';
    ui[prefix + '-meter-fill'].style.width = '0%';
    ui[prefix + '-meter'].setAttribute('aria-valuenow', '0');
    ui[prefix + '-pan-dot'].style.left = '50%';
  }

  function clearVisual(channel = null) {
    stage.clear(channel);
    [...ui.lanes.children].forEach(lane => lane.classList.remove('active'));
    if (!channel) {
      for (const side of ['left', 'right']) clearLimbPanel(side);
      for (const limb of Object.values(LIMB_PREFIX)) clearLimbPanel(limb);
      clearSectionNotes();
      ui.posture.textContent = '—';
      return;
    }
    if (channel === ENSEMBLE || channel === 'body') {
      // The legacy body channel routed through the right panel; today's body
      // mode never sets tracking['body'], but guard for tests that still do.
      clearLimbPanel('right');
      clearSectionNotes();
    } else {
      clearLimbPanel(panel(channel));
    }
    if (channel !== 'left') ui.posture.textContent = '—';
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
    // Body mode shows the settled posture next to the right arm's note, so the
    // player can read both at a glance.
    if (mapped.posture !== undefined && (channel === 'right' || channel === 'left' || channel === ENSEMBLE)) {
      ui.posture.textContent = POSTURE_LABELS[mapped.posture] ?? POSTURE_LABELS.moving;
    }
    const intensity = Math.round((mapped.intensity ?? 0) * 100);
    ui[id + '-meter-fill'].style.width = intensity + '%';
    ui[id + '-meter'].setAttribute('aria-valuenow', String(intensity));
    ui[id + '-dynamics'].textContent = intensity > 65 ? 'Expressive' : intensity > 20 ? 'Flowing' : 'Gentle';
    ui[id + '-pan-dot'].style.left = ((mapped.x ?? .5) * 100) + '%';
    if (channel === ENSEMBLE) {
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
    const isBody = performance === 'body';
    const isOrchestra = performance === 'orchestra';
    const isSolo = performance === 'solo';
    ui.performance.value = performance;
    document.body.dataset.performance = performance;
    document.body.dataset.arranged = String(isOrchestra);
    document.body.dataset.limbs = String(isBody);
    ui['performance-hint'].textContent = HINTS[performance] ?? HINTS.solo;

    // Solo shows both hand panels. Orchestra and body collapse to a single source
    // — orchestra uses the right panel + the section arrangement, body uses four
    // limb panels, neither shows the left-hand panel.
    ui['left-panel'].hidden = !isSolo;
    ui['right-panel'].hidden = isBody;
    ui.ensemble.hidden = !isOrchestra;
    ui.limbs.hidden = !isBody;
    ui['posture-row'].hidden = !isBody && !isOrchestra;

    if (isOrchestra) {
      ui['conductor-heading'].textContent = 'Ensemble';
      ui['conductor-eyebrow'].textContent = 'ENSEMBLE NOTE';
      ui['ensemble-title'].textContent = SOLO_COPY.title;
      ui['ensemble-copy'].textContent = SOLO_COPY.copy;
      clearSectionNotes();
    }
    if (isBody) {
      ui['limbs-title'].textContent = BODY_COPY.title;
      ui['limbs-copy'].textContent = BODY_COPY.copy;
      for (const limb of Object.values(LIMB_PREFIX)) clearLimbPanel(limb);
    }

    for (const channel of ['left', 'right']) {
      if (!ui[channel + '-scale']) continue;
      const { scale, sound, volume, mute } = settings[channel];
      ui[channel + '-scale'].value = scale;
      ui[channel + '-sound'].value = sound;
      // The arrangement chooses section timbres, so solo sounds do not apply here.
      const arranged = isOrchestra;
      ui[channel + '-sound'].hidden = arranged;
      ui[channel + '-sound-label'].hidden = arranged;
      ui[channel + '-volume'].value = String(volume);
      ui[channel + '-volume-value'].textContent = volume + '%';
      ui[channel + '-mute'].setAttribute('aria-pressed', String(mute));
      ui[channel + '-mute'].textContent = mute ? 'Unmute' : 'Mute';
    }
    for (const channel of Object.keys(LIMB_PREFIX)) {
      const prefix = LIMB_PREFIX[channel];
      const { scale, sound, volume, mute } = settings[channel];
      ui[prefix + '-scale'].value = scale;
      ui[prefix + '-sound'].value = sound;
      ui[prefix + '-volume'].value = String(volume);
      ui[prefix + '-volume-value'].textContent = volume + '%';
      ui[prefix + '-mute'].setAttribute('aria-pressed', String(mute));
      ui[prefix + '-mute'].textContent = mute ? 'Unmute' : 'Mute';
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
