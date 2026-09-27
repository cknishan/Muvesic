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
  for (const patch of [null, [], 'minor', { extra: 1 }, { performance: 'invalid' },
    { left: { scale: '__proto__' } }, { left: { sound: 'piano' } }, { left: { volume: NaN } },
    { left: { volume: Infinity } }, { left: { volume: -1 } }, { left: { volume: 101 } },
    { left: { volume: '65' } }, { left: { mute: 1 } }, { left: { performance: 'orchestra' } }]) {
    assert.throws(() => validateSettings(patch), /Invalid instrument settings/);
  }
});

test('either hand can select guitar without changing the other hand', () => {
  const left = validateSettings({ left: { sound: 'guitar' } });
  assert.equal(left.left.sound, 'guitar');
  assert.equal(left.right.sound, DEFAULT_SETTINGS.right.sound);
  const right = validateSettings({ right: { sound: 'guitar' } });
  assert.equal(right.right.sound, 'guitar');
  assert.equal(right.left.sound, DEFAULT_SETTINGS.left.sound);
});

test('the performance mode is top level and leaves both hands alone', () => {
  const next = validateSettings({ performance: 'orchestra' });
  assert.equal(next.performance, 'orchestra');
  assert.equal(next.left, DEFAULT_SETTINGS.left);
  assert.equal(next.right, DEFAULT_SETTINGS.right);
  assert.equal(validateSettings({}, DEFAULT_SETTINGS).performance, 'solo');
});
