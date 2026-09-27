import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, validateSettings } from '../dist/app/settings.js';

test('settings patches preserve omitted values and do not mutate their inputs', () => {
  const patch = { volume: 0, mute: true };
  const next = validateSettings(patch);
  assert.deepEqual(next, { ...DEFAULT_SETTINGS, ...patch });
  assert.equal(DEFAULT_SETTINGS.volume, 65);
  assert.deepEqual(patch, { volume: 0, mute: true });
});

test('settings reject malformed patches, unsupported options and invalid values', () => {
  for (const patch of [null, [], 'minor', { extra: 1 }, { scale: '__proto__' },
    { sound: 'piano' }, { performance: 'invalid' }, { volume: NaN }, { volume: Infinity }, { volume: -1 },
    { volume: 101 }, { volume: '65' }, { mute: 1 }]) {
    assert.throws(() => validateSettings(patch), /Invalid instrument settings/);
  }
});
