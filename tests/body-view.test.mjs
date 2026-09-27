import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUI, createInstrumentView } from '../dist/ui/instrument-view.js';
import { arrangeBody } from '../dist/music/orchestra.js';
import { validateSettings } from '../dist/app/settings.js';
import { createDomDouble } from './helpers/dom-double.mjs';
import { poseFixture } from './helpers/pose-fixture.mjs';

const SECTIONS = ['strings', 'woodwind', 'brass', 'cello'];
const name = midi => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12]
  + (Math.floor(midi / 12) - 1);
const POSE = poseFixture();
const BODY = { x: .5, y: .5, midi: 64, index: 3, trigger: true, pan: 0, velocity: .4, intensity: .5,
  posture: 'arms_up', strength: .4, hint: null, status: 'Body tracked · Playing' };

function mount() {
  const dom = createDomDouble(new URL('../dist/index.html', import.meta.url));
  const ui = collectUI(dom.document);
  return { dom, ui, view: createInstrumentView(ui) };
}

test('body mode reuses the single-source panel, relabelled for a body', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  const settings = validateSettings({ performance: 'body' });
  view.renderLanes(settings);
  view.renderSettings(settings);

  assert.equal(ui['left-panel'].hidden, true, 'there is only one source in body mode');
  assert.equal(ui['right-panel'].hidden, false);
  assert.equal(ui['conductor-heading'].textContent, 'Body');
  assert.equal(ui['conductor-eyebrow'].textContent, 'BODY NOTE');
  assert.equal(ui.ensemble.hidden, false, 'the section list is the four layers of the chord');
  assert.equal(ui['ensemble-title'].textContent, 'YOUR DANCE');
  assert.match(ui['ensemble-copy'].textContent, /higher one leads/, 'and says how to play it');
  assert.equal(ui['left-sound'].hidden, true, 'the arrangement picks the timbres');
  assert.equal(ui['right-scale'].hidden, false, 'one borrowed scale, same as the ensemble');
  assert.equal(ui['right-scale'].value, settings.right.scale);
  // Only body mode has a posture to name.
  assert.equal(ui['posture-row'].hidden, false);
  assert.equal(dom.document.body.dataset.arranged, 'true', 'so one stylesheet rules both');

  view.renderSettings(validateSettings({ performance: 'solo' }));
  assert.equal(ui['left-panel'].hidden, false);
  assert.equal(ui.ensemble.hidden, true);
  assert.equal(ui['posture-row'].hidden, true, 'two hands have no posture');
  assert.equal(dom.document.body.dataset.arranged, 'false');
});

test('the body readout names the note and the posture, and clears both', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  const settings = validateSettings({ performance: 'body' });
  const arrangement = arrangeBody({ ...BODY, midi: 64 }, settings.right.scale);
  view.renderSettings(settings);
  view.renderNote('body', BODY, POSE, 100, arrangement);

  assert.equal(ui['right-note'].textContent, name(64));
  assert.equal(ui.posture.textContent, 'Arms up');
  assert.deepEqual(SECTIONS.map(section => ui['ensemble-' + section].textContent),
    arrangement.map(part => name(part.midi)));

  view.clearVisual('body');
  assert.equal(ui['right-note'].textContent, '—');
  assert.equal(ui.posture.textContent, '—');
  assert.deepEqual(SECTIONS.map(section => ui['ensemble-' + section].textContent), ['—', '—', '—', '—']);
});

test('a body that has not chosen a pitch yet still renders, and reads as waiting', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  view.renderSettings(validateSettings({ performance: 'body' }));
  // Calibration frames carry a null lane and a null note; noteName(null) would
  // otherwise print a nonsense pitch and take the tracking loop's assertion with it.
  const resting = { ...BODY, midi: null, index: null, trigger: false, intensity: 0, posture: null };
  assert.doesNotThrow(() => view.renderNote('body', resting, POSE, 100, null));
  assert.equal(ui['right-note'].textContent, '—');
  assert.equal(ui['right-frequency'].textContent, 'Waiting');
  assert.equal(ui.posture.textContent, 'Moving');
  assert.equal(ui['right-meter-fill'].style.width, '0%');
});

test('an unknown posture is named as movement rather than left blank', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  view.renderNote('body', { ...BODY, posture: 'cartwheel' }, POSE, 100, null);
  assert.equal(ui.posture.textContent, 'Moving');
});

test('the tracking hint keeps its own copy per performance', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  view.showTrackingHint(true);
  assert.equal(ui['tracking-hint'].hidden, false);
  view.showTrackingHint(true, 'Step back so I can see your feet');
  assert.equal(ui['tracking-hint'].innerHTML, 'Step back so I can see your feet');
  // Two-hand mode passes no message, so the shared guidance from the markup stays.
  view.showTrackingHint(false);
  assert.match(ui['tracking-hint'].innerHTML, /Step back/, 'the last message is left in place');
});

test('body mode rewrites the stage copy so the player is told what to do', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  // The welcome panel is written through a selector lookup, so record the writes
  // rather than the elements the double would hand back.
  const welcome = {};
  ui.welcome.querySelector = selector => (welcome[selector] ??= { innerHTML: '' });

  view.renderControls({ state: 'idle', mode: 'camera', performance: 'body' });
  assert.equal(ui['input-label'].textContent, 'BODY INPUT');
  assert.match(ui['stage-help'].textContent, /Stand back/);
  assert.match(welcome.h2.innerHTML, /Move your body/);
  assert.match(welcome.p.innerHTML, /whole body is in frame/);
  assert.equal(dom.document.body.dataset.performance, 'body');

  view.renderControls({ state: 'idle', mode: 'mouse', performance: 'solo' });
  assert.equal(ui['input-label'].textContent, 'MOUSE / KEYS');
  assert.match(ui['stage-help'].textContent, /Arrow keys/);
  assert.match(welcome.h2.innerHTML, /A little movement/, 'and the two-hand copy comes back');
});
