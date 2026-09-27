import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeOrchestra } from '../dist/music/orchestra.js';
import { SCALES } from '../dist/music/scales.js';

test('orchestra voices major and minor triads with a bass root', () => {
  assert.deepEqual(arrangeOrchestra(60, 'major').map(p => p.midi), [48, 64, 55, 36]);
  assert.deepEqual(arrangeOrchestra(69, 'minor').map(p => p.midi), [57, 72, 64, 45]);
  for (const [scale, { notes }] of Object.entries(SCALES)) {
    const allowed = scale === 'minor' ? [9, 11, 0, 2, 4, 5, 7] : [0, 2, 4, 5, 7, 9, 11];
    for (const midi of notes) {
      assert.ok(arrangeOrchestra(midi, scale).every(p => allowed.includes(p.midi % 12)));
    }
  }
});
