import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, sessionHarness } from './helpers/session-harness.mjs';

test('mouse mode plays, releases on input loss, and stops its resources', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  h.session.switchMode();
  await h.session.start();
  assert.equal(h.session.read().state, 'running');
  assert.equal(h.trackers.length, 0);
  assert.ok(h.events.some(([name]) => name === 'input.start'));
  h.input().onPoint(0, 0, 100);
  assert.deepEqual(h.audioInstances[0].notes[0], [72, .24, -1, 'keys']);
  h.input().onLost();
  assert.equal(h.audioInstances[0].released, 1);
  h.input().onPoint(1, 1, 200);
  assert.equal(h.audioInstances[0].notes.length, 2);
  h.session.stop();
  assert.equal(h.session.read().state, 'idle');
  assert.equal(h.audioInstances[0].closed, 1);
  assert.equal(h.input().isEnabled(), false);
});

test('a cancelled audio startup cannot revive or close a newer session', async t => {
  const pending = deferred();
  let starts = 0;
  const h = sessionHarness({ audioStart: () => ++starts === 1 ? pending.promise : Promise.resolve() });
  t.after(() => h.session.dispose());
  const oldStart = h.session.start();
  assert.equal(h.session.read().state, 'loading');
  await h.session.start();
  assert.equal(h.audioInstances.length, 1, 'duplicate start is ignored');
  h.session.switchMode();
  await h.session.start();
  pending.resolve();
  await oldStart;
  assert.equal(h.session.read().state, 'running');
  assert.equal(h.session.read().mode, 'mouse');
  assert.ok(h.audioInstances[0].closed >= 1);
  assert.equal(h.audioInstances[1].closed, 0);
  assert.equal(h.trackers.length, 0);
});

test('a cancelled camera startup ignores late completion, frames and errors', async t => {
  const pending = deferred();
  const h = sessionHarness({ trackerStart: () => pending.promise });
  t.after(() => h.session.dispose());
  const starting = h.session.start();
  await Promise.resolve();
  assert.equal(h.trackers.length, 1);
  h.session.stop();
  pending.resolve();
  await starting;
  h.trackers[0].onFrame(Array.from({ length: 21 }, () => ({ x: 0, y: 0 })), 100);
  h.trackers[0].onError(new Error('stale failure'));
  assert.equal(h.session.read().state, 'idle');
  assert.equal(h.trackers[0].stopped, 1);
  assert.equal(h.audioInstances[0].notes.length, 0);
  assert.equal(h.events.filter(([name, message]) => name === 'showError' && message).length, 0);
});

test('camera coordinates mirror once and missing frames release the note', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  await h.session.start();
  const landmarks = Array.from({ length: 21 }, () => ({ x: .2, y: .5 }));
  h.trackers[0].onFrame(landmarks, 100);
  assert.ok(Math.abs(h.audioInstances[0].notes[0][2] - .6) < 1e-9);
  h.trackers[0].onFrame(null, 200);
  assert.equal(h.audioInstances[0].released, 1);
  h.session.stop();
  assert.equal(h.trackers[0].stopped, 1);
});

test('invalid settings are atomic and reset restores the default camera session', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  h.session.switchMode();
  await h.session.start();
  h.session.applySettings({ scale: 'minor', sound: 'bell', volume: 25, mute: true });
  assert.deepEqual(h.audioInstances[0].volumes.at(-1), [.25, true]);
  const before = h.session.read();
  assert.throws(() => h.session.applySettings({ scale: 'major', volume: 200 }));
  assert.deepEqual(h.session.read(), before);
  h.session.reset();
  assert.deepEqual(h.session.read(), { state: 'idle', mode: 'camera',
    performance: 'solo', scale: 'pentatonic', sound: 'keys', volume: 65, muted: false });
});

test('startup and playback failures return to idle and surface recovery text', async t => {
  const h = sessionHarness({ audioStart: () => Promise.reject(new Error('audio unavailable')) });
  t.after(() => h.session.dispose());
  await h.session.start();
  assert.equal(h.session.read().state, 'idle');
  assert.ok(h.events.some(([name, message]) => name === 'showError' && message === 'audio unavailable'));
  const playing = sessionHarness();
  t.after(() => playing.session.dispose());
  playing.session.switchMode();
  await playing.session.start();
  playing.audioInstances[0].play = () => { throw new Error('device gone'); };
  playing.input().onPoint(.5, .5, 100);
  assert.equal(playing.session.read().state, 'idle');
  assert.ok(playing.events.some(([name, message]) => name === 'showError' && /Audio playback stopped/.test(message)));
});


test('orchestra works in both inputs and switching back releases the ensemble', async t => {
  for (const mouse of [true, false]) {
    const h = sessionHarness();
    t.after(() => h.session.dispose());
    if (mouse) h.session.switchMode();
    h.session.applySettings({ performance: 'orchestra' });
    await h.session.start();
    const play = time => mouse ? h.input().onPoint(.5, .5, time)
      : h.trackers[0].onFrame(Array.from({ length: 21 }, () => ({ x: .5, y: .5 })), time);
    play(100);
    assert.equal(h.audioInstances[0].notes[0][4].length, 4);
    h.session.applySettings({ performance: 'solo' });
    assert.equal(h.audioInstances[0].released, 1);
    play(200);
    assert.equal(h.audioInstances[0].notes.at(-1).length, 4);
  }
});
