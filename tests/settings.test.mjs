import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, validateSettings } from '../dist/app/settings.js';

test('settings patches preserve omitted values and do not mutate their inputs', () => {
  const patch = { left: { volume: 0, mute: true } };
  const next = validateSettings(patch);
  assert.deepEqual(next, { ...DEFAULT_SETTINGS, left: { ...DEFAULT_SETTINGS.left, ...patch.left } });
  assert.equal(DEFAULT_SETTINGS.left.volume, 65);
  assert.deepEqual(patch, { left: { volume: 0, mute: true } });
});

test('settings reject malformed patches, unsupported options and invalid values', () => {
  for (const patch of [null, [], 'minor', { extra: 1 }, { left: { scale: '__proto__' } },
    { left: { sound: 'piano' } }, { left: { volume: NaN } }, { left: { volume: Infinity } },
    { left: { volume: -1 } }, { left: { volume: 101 } }, { left: { volume: '65' } },
    { left: { mute: 1 } }]) {
    assert.throws(() => validateSettings(patch), /Invalid instrument settings/);
  }
});
