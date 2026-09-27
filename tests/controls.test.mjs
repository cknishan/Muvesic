import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindControls } from '../dist/app/controls.js';

/** Minimal control double: records listeners so a test can fire them. */
function control() {
  return {
    value: '', textContent: '', hidden: false, disabled: false,
    listeners: new Map(),
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    fire(name) { this.listeners.get(name)?.(); },
  };
}

const ACTION_IDS = ['start', 'stop', 'mode', 'reset', 'performance'];

// The live DOM contract: per-channel controls, plus the orchestra-only readouts.
const IDS = [...ACTION_IDS, 'left-panel', 'right-panel', 'conductor-heading', 'conductor-eyebrow',
  ...['left', 'right'].flatMap(channel => ['sound', 'sound-label', 'scale', 'scale-hint', 'volume',
    'volume-value', 'mute', 'note', 'frequency', 'dynamics', 'meter', 'meter-fill', 'pan-dot']
    .map(suffix => channel + '-' + suffix)),
  ...['left-arm', 'right-arm', 'left-leg', 'right-leg'].flatMap(prefix =>
    ['sound', 'sound-label', 'scale', 'volume', 'volume-value', 'mute',
     'note', 'frequency', 'dynamics', 'meter', 'meter-fill', 'pan-dot']
      .map(suffix => prefix + '-' + suffix)),
  ...['strings', 'woodwind', 'brass', 'cello'].map(section => 'ensemble-' + section)];

function harness() {
  const ui = Object.fromEntries(IDS.map(id => [id, control()]));
  const applied = [];
  const session = {
    applied,
    start: () => applied.push(['start']),
    stop: () => applied.push(['stop']),
    switchMode: () => applied.push(['switchMode']),
    reset: () => applied.push(['reset']),
    applySettings: patch => applied.push(['applySettings', patch]),
    read: () => ({ state: 'running', left: { muted: false }, right: { muted: true } }),
  };
  const document = { hidden: false, addEventListener() {} };
  const window = { addEventListener() {} };
  return { ui, session, applied, document, window };
}

test('every control the binder touches exists in the markup', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  // Guards the pre-merge single-panel controls: they have no element, so binding
  // them threw on load and took the whole app down with it.
  for (const legacy of ['scale', 'sound', 'volume', 'mute']) {
    assert.equal(ids.has(legacy), false, legacy + ' must not be bound without a matching element');
  }
  const { ui, session, document, window } = harness();
  assert.doesNotThrow(() => bindControls(ui, session, { document, window }));
});

test('the performance select switches modes and hands keep their own controls', () => {
  const { ui, session, applied, document, window } = harness();
  bindControls(ui, session, { document, window });

  ui.performance.value = 'orchestra';
  ui.performance.fire('change');
  assert.deepEqual(applied.at(-1), ['applySettings', { performance: 'orchestra' }]);

  ui['left-scale'].value = 'minor';
  ui['left-scale'].fire('change');
  assert.deepEqual(applied.at(-1), ['applySettings', { left: { scale: 'minor' } }]);

  ui['right-volume'].value = '20';
  ui['right-volume'].fire('input');
  assert.deepEqual(applied.at(-1), ['applySettings', { right: { volume: 20 } }]);

  // The mute buttons read each hand's own flag, not a shared top-level one.
  ui['left-mute'].fire('click');
  assert.deepEqual(applied.at(-1), ['applySettings', { left: { mute: true } }]);
  ui['right-mute'].fire('click');
  assert.deepEqual(applied.at(-1), ['applySettings', { right: { mute: false } }]);
});

test('lifecycle buttons and page events reach the session', () => {
  const { ui, session, applied, document, window } = harness();
  bindControls(ui, session, { document, window });
  ui.start.fire('click');
  ui.stop.fire('click');
  ui.mode.fire('click');
  ui.reset.fire('click');
  assert.deepEqual(applied, [['start'], ['stop'], ['switchMode'], ['reset']]);
});

test('each body-mode limb has its own scale, sound, volume and mute binding', () => {
  const { ui, session, applied, document, window } = harness();
  bindControls(ui, session, { document, window });

  ui['left-arm-scale'].value = 'minor';
  ui['left-arm-scale'].fire('change');
  assert.deepEqual(applied.at(-1), ['applySettings', { left: { scale: 'minor' } }]);

  ui['right-leg-sound'].value = 'bass';
  ui['right-leg-sound'].fire('change');
  assert.deepEqual(applied.at(-1), ['applySettings', { lowerRight: { sound: 'bass' } }]);

  ui['left-leg-volume'].value = '40';
  ui['left-leg-volume'].fire('input');
  assert.deepEqual(applied.at(-1), ['applySettings', { lowerLeft: { volume: 40 } }]);

  ui['right-arm-mute'].fire('click');
  assert.deepEqual(applied.at(-1), ['applySettings', { right: { mute: false } }]);
});
