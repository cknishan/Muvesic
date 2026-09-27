import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUI, createInstrumentView } from '../dist/ui/instrument-view.js';
import { applyPosture } from '../dist/music/orchestra.js';
import { validateSettings } from '../dist/app/settings.js';
import { createDomDouble } from './helpers/dom-double.mjs';
import { poseFixture } from './helpers/pose-fixture.mjs';

const LIMB_PREFIX = { left: 'left-arm', right: 'right-arm', lowerLeft: 'left-leg', lowerRight: 'right-leg' };
const name = midi => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12]
  + (Math.floor(midi / 12) - 1);
const POSE = poseFixture();
const FRAME = { x: .5, y: .5, midi: 64, index: 3, trigger: true, pan: 0, velocity: .4, intensity: .5,
  posture: 'arms_up', strength: .4, hint: null, status: 'Body tracked · Four voices playing' };

function mount() {
  const dom = createDomDouble(new URL('../dist/index.html', import.meta.url));
  const ui = collectUI(dom.document);
  return { dom, ui, view: createInstrumentView(ui) };
}

test('body mode shows the four limb panels and hides the solo and orchestra panels', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  view.renderLanes(validateSettings({ performance: 'body' }));
  view.renderSettings(validateSettings({ performance: 'body' }));

  // Four equal limb panels, each with its own sound + scale + volume + mute.
  assert.equal(ui.limbs.hidden, false);
  for (const prefix of Object.values(LIMB_PREFIX)) {
    assert.equal(ui[prefix + '-panel'].hidden, false, prefix + ' panel is visible');
    assert.ok(ui[prefix + '-sound'], prefix + ' sound select exists');
    assert.ok(ui[prefix + '-scale'], prefix + ' scale select exists');
    assert.ok(ui[prefix + '-volume'], prefix + ' volume slider exists');
    assert.ok(ui[prefix + '-mute'], prefix + ' mute button exists');
  }
  // Solo and orchestra panels are put away in body mode.
  assert.equal(ui['left-panel'].hidden, true, 'no two-hand panel');
  assert.equal(ui.ensemble.hidden, true, 'no section arrangement');
  assert.equal(dom.document.body.dataset.limbs, 'true');
  assert.equal(dom.document.body.dataset.arranged, 'false');

  view.renderSettings(validateSettings({ performance: 'solo' }));
  assert.equal(ui.limbs.hidden, true);
  assert.equal(ui['left-panel'].hidden, false);
  assert.equal(dom.document.body.dataset.limbs, 'false');
});

test('every limb defaults to the same sound across four octaves', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  view.renderSettings(validateSettings({ performance: 'body' }));
  const settings = validateSettings({});
  for (const channel of Object.keys(LIMB_PREFIX)) {
    const prefix = LIMB_PREFIX[channel];
    assert.equal(ui[prefix + '-sound'].value, settings[channel].sound,
      channel + ' uses the shared default sound');
    // Volume is uniform across the four limbs.
    assert.equal(ui[prefix + '-volume'].value, String(settings[channel].volume));
    assert.equal(ui[prefix + '-scale'].value, settings[channel].scale,
      channel + ' reads its own scale');
  }
});

test('a tracked limb updates its own note, frequency, meter and pan dot', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  view.renderSettings(validateSettings({ performance: 'body' }));
  view.renderNote('right', FRAME, POSE, 100, null);
  const prefix = LIMB_PREFIX.right;
  assert.equal(ui[prefix + '-note'].textContent, name(64));
  assert.match(ui[prefix + '-frequency'].textContent, /Hz/);
  assert.match(ui[prefix + '-dynamics'].textContent, /Expressive|Flowing|Gentle/);
  assert.ok(ui[prefix + '-meter-fill'].style.width);
  // Pan dot at 50% when x = 0.5.
  assert.equal(ui[prefix + '-pan-dot'].style.left, '50%');
});

test('four limbs dispatched in one frame update four panels independently', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  view.renderSettings(validateSettings({ performance: 'body' }));
  const events = applyPosture([
    { channel: 'left', midi: 60, pan: -.5, velocity: .3, intensity: .2, index: 0, x: .25, y: .5 },
    { channel: 'right', midi: 64, pan: .3, velocity: .4, intensity: .4, index: 1, x: .65, y: .5 },
    { channel: 'lowerLeft', midi: 48, pan: -.2, velocity: .2, intensity: .1, index: 0, x: .45, y: .5 },
    { channel: 'lowerRight', midi: 52, pan: .1, velocity: .25, intensity: .15, index: 1, x: .55, y: .5 },
  ], null, 0);
  for (const event of events) {
    view.renderNote(event.channel, event, POSE, 100, null);
  }
  assert.equal(ui['left-arm-note'].textContent, name(60));
  assert.equal(ui['right-arm-note'].textContent, name(64));
  assert.equal(ui['left-leg-note'].textContent, name(48));
  assert.equal(ui['right-leg-note'].textContent, name(52));
});

test('a lost limb clears its own readout', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  view.renderSettings(validateSettings({ performance: 'body' }));
  view.renderNote('right', FRAME, POSE, 100, null);
  assert.notEqual(ui['right-arm-note'].textContent, '—');
  view.clearVisual('right');
  assert.equal(ui['right-arm-note'].textContent, '—');
  // Other limbs are untouched when only one is cleared.
  assert.equal(ui['left-arm-note'].textContent, '—');
});

test('body mode rewrites the stage copy so the player is told what to do', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
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
  assert.match(welcome.h2.innerHTML, /A little movement/);
});
