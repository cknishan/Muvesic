import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUI, createInstrumentView } from '../dist/ui/instrument-view.js';
import { arrangeOrchestra } from '../dist/music/orchestra.js';
import { DEFAULT_SETTINGS, validateSettings } from '../dist/app/settings.js';
import { createDomDouble } from './helpers/dom-double.mjs';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SECTIONS = ['strings', 'woodwind', 'brass', 'cello'];
const name = midi => NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

function mount() {
  const dom = createDomDouble(new URL('../dist/index.html', import.meta.url));
  const ui = collectUI(dom.document);
  return { dom, ui, view: createInstrumentView(ui) };
}

const MAPPED = { midi: 64, index: 3, x: .5, y: .5, velocity: .3, intensity: .4, trigger: true };
const LANDMARKS = Array.from({ length: 21 }, () => ({ x: .5, y: .5 }));

test('the markup satisfies the whole view contract, so no panel lookup can throw', t => {
  const { dom } = mount();
  t.after(() => dom.restore());
  // A missing id throws during rendering, inside the tracking frame loop, and takes
  // the running session down with it, so the contract is asserted up front.
  assert.doesNotThrow(() => collectUI(dom.document));
  for (const id of ['left-panel', 'right-panel', 'conductor-heading', 'conductor-eyebrow',
    ...SECTIONS.map(section => 'ensemble-' + section)]) {
    assert.ok(dom.markupIds.includes(id), id + ' is missing from index.html');
  }
});

test('orchestra replaces the two hand panels with one ensemble panel', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  const settings = validateSettings({ performance: 'orchestra' });
  view.renderLanes(settings);
  view.renderSettings(settings);

  assert.equal(ui['left-panel'].hidden, true, 'there is only one hand in orchestra mode');
  assert.equal(ui['right-panel'].hidden, false);
  assert.equal(ui['conductor-heading'].textContent, 'Ensemble');
  assert.equal(ui['conductor-eyebrow'].textContent, 'ENSEMBLE NOTE');
  assert.equal(ui.ensemble.hidden, false, 'the section list replaces the per-hand controls');
  assert.equal(ui['left-sound'].hidden, true, 'arrangement timbres make solo sounds meaningless');
  assert.equal(ui['right-sound'].hidden, true);
  // One scale, not two: the ensemble borrows the right hand's.
  assert.equal(ui['right-scale'].hidden, false);
  assert.equal(ui['right-scale'].value, settings.right.scale);

  view.renderSettings(DEFAULT_SETTINGS);
  assert.equal(ui['left-panel'].hidden, false);
  assert.equal(ui['conductor-heading'].textContent, 'Right hand');
  assert.equal(ui.ensemble.hidden, true);
  assert.equal(ui['left-sound'].hidden, false);
});

test('the ensemble channel reads out through one panel and names each section', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  const settings = validateSettings({ performance: 'orchestra' });
  const arrangement = arrangeOrchestra(64, settings.right.scale);
  const leftBefore = ui['left-note'].textContent;
  view.renderNote('ensemble', MAPPED, LANDMARKS, 100, arrangement);

  assert.equal(ui['right-note'].textContent, name(64));
  assert.equal(ui['left-note'].textContent, leftBefore, 'the put-away hand gets no readout');
  assert.deepEqual(SECTIONS.map(section => ui['ensemble-' + section].textContent),
    arrangement.map(part => name(part.midi)));
});

test('clearing the ensemble channel cannot throw, so tracking survives a lost hand', t => {
  const { dom, ui, view } = mount();
  t.after(() => dom.restore());
  const settings = validateSettings({ performance: 'orchestra' });
  const arrangement = arrangeOrchestra(64, settings.right.scale);
  view.renderNote('ensemble', MAPPED, LANDMARKS, 100, arrangement);

  // 'ensemble-note' is not an element; indexing it directly used to throw here and
  // the tracker reported a fatal error, which stopped the camera for good.
  assert.doesNotThrow(() => view.clearVisual('ensemble'));
  assert.equal(ui['right-note'].textContent, '—');
  assert.equal(ui['right-frequency'].textContent, 'Waiting');
  assert.deepEqual(SECTIONS.map(section => ui['ensemble-' + section].textContent), ['—', '—', '—', '—']);
  assert.doesNotThrow(() => view.clearVisual());
});
