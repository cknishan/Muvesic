import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, sessionHarness } from './helpers/session-harness.mjs';

function openHand(x = .2, y = .5) {
  const landmarks = Array.from({ length: 21 }, () => ({ x, y }));
  landmarks[4] = { x: x - .18, y: y + .18 };
  landmarks[8] = { x, y };
  landmarks[12] = { x: x + .08, y: y + .18 };
  landmarks[16] = { x: x + .16, y: y + .02 };
  landmarks[20] = { x: x - .1, y: y - .18 };
  return landmarks;
}

function clusteredHand(x = .2, y = .5) {
  const landmarks = Array.from({ length: 21 }, () => ({ x, y }));
  for (const index of [4, 8, 12, 16, 20]) landmarks[index] = { x, y };
  return landmarks;
}

function looseClusteredHand(x = .2, y = .5) {
  const landmarks = Array.from({ length: 21 }, () => ({ x, y }));
  landmarks[4] = { x: x - .085, y };
  landmarks[8] = { x: x - .04, y };
  landmarks[12] = { x, y };
  landmarks[16] = { x: x + .04, y };
  landmarks[20] = { x: x + .085, y };
  return landmarks;
}

test('mouse mode plays, releases on input loss, and stops its resources', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  h.session.switchMode();
  await h.session.start();
  assert.equal(h.session.read().state, 'running');
  assert.equal(h.trackers.length, 0);
  assert.ok(h.events.some(([name]) => name === 'input.start'));
  h.input().onPoint(0, 0, 100);
  assert.deepEqual(h.audioInstances[0].notes[0], ['right', 72, .24, -1, 'bell', null]);
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
  h.trackers[0].onFrame([Array.from({ length: 21 }, () => ({ x: 0, y: 0 }))], 100);
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
  const landmarks = openHand(.2, .5);
  h.trackers[0].onFrame([landmarks], 100);
  assert.equal(h.audioInstances[0].notes[0][0], 'right');
  assert.ok(Math.abs(h.audioInstances[0].notes[0][3] - .6) < 1e-9);
  h.trackers[0].onFrame([], 200);
  assert.equal(h.audioInstances[0].released, 1);
  h.session.stop();
  assert.equal(h.trackers[0].stopped, 1);
});

test('invalid settings are atomic and reset restores the default camera session', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  h.session.switchMode();
  await h.session.start();
  h.session.applySettings({ left: { scale: 'minor', sound: 'bell', volume: 25, mute: true } });
  assert.ok(h.audioInstances[0].volumes.some(args => args[0] === .25 && args[1] === true && args[2] === 'left'));
  const before = h.session.read();
  assert.throws(() => h.session.applySettings({ left: { scale: 'major', volume: 200 } }));
  assert.deepEqual(h.session.read(), before);
  h.session.reset();
  assert.deepEqual(h.session.read(), { state: 'idle', mode: 'camera', performance: 'solo',
    left: { scale: 'pentatonic', sound: 'bell', volume: 65, muted: false, octave: 0 },
    right: { scale: 'pentatonic', sound: 'bell', volume: 65, muted: false, octave: 12 },
    lowerLeft: { scale: 'pentatonic', sound: 'bell', volume: 65, muted: false, octave: -24 },
    lowerRight: { scale: 'pentatonic', sound: 'bell', volume: 65, muted: false, octave: -12 },
    ensemble: { scale: 'pentatonic', sound: 'bell', volume: 65, muted: false, octave: 12 } });
});

test('camera mode maps two screen-side hands to independent instruments', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  await h.session.start();
  const left = openHand(.85, .5);
  const right = openHand(.15, .2);
  h.trackers[0].onFrame([right, left], 100);
  assert.deepEqual(h.audioInstances[0].notes.map(note => [note[0], note[4]]), [['left', 'bell'], ['right', 'bell']]);
  h.trackers[0].onFrame([right], 200);
  assert.ok(h.audioInstances[0].releases.includes('left'));
  assert.ok(!h.audioInstances[0].releases.includes('right'));
});

test('clustered fingertips mute solo playback until the hand opens again', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  await h.session.start();
  h.trackers[0].onFrame([openHand(.2, .5)], 100);
  assert.equal(h.audioInstances[0].notes.length, 1);
  h.trackers[0].onFrame([clusteredHand(.2, .5)], 200);
  assert.ok(h.audioInstances[0].releases.includes('right'));
  h.trackers[0].onFrame([openHand(.2, .25)], 300);
  assert.equal(h.audioInstances[0].notes.length, 2, 'opening the hand resumes playback');
});

test('clustered fingertips mute only their matching solo hand', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  await h.session.start();
  const left = openHand(.85, .5);
  const right = openHand(.15, .2);
  h.trackers[0].onFrame([right, left], 100);
  assert.deepEqual(h.audioInstances[0].notes.map(note => note[0]), ['left', 'right']);
  h.trackers[0].onFrame([openHand(.15, .1), looseClusteredHand(.85, .5)], 250);
  assert.ok(h.audioInstances[0].releases.includes('left'));
  assert.ok(!h.audioInstances[0].releases.includes('right'));
  assert.equal(h.audioInstances[0].notes.at(-1)[0], 'right', 'the open hand keeps playing');
  h.trackers[0].onFrame([openHand(.15, .1), openHand(.85, .25)], 400);
  assert.equal(h.audioInstances[0].notes.filter(note => note[0] === 'left').length, 2,
    'opening the clustered hand lets that hand play again');
});

test('clustered fingertips mute orchestra playback until the hand opens again', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  h.session.applySettings({ performance: 'orchestra' });
  await h.session.start();
  h.trackers[0].onFrame([openHand(.5, .5)], 100);
  assert.equal(h.audioInstances[0].notes[0][0], 'ensemble');
  h.trackers[0].onFrame([clusteredHand(.5, .5)], 200);
  assert.ok(h.audioInstances[0].releases.includes('ensemble'));
  h.trackers[0].onFrame([openHand(.5, .25)], 300);
  assert.equal(h.audioInstances[0].notes.length, 2, 'opening the hand resumes the ensemble');
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
    const hand = openHand(.5, .5);
    const play = time => mouse ? h.input().onPoint(.5, .5, time)
      : h.trackers[0].onFrame([hand], time);
    play(100);
    const ensemble = h.audioInstances[0].notes[0];
    assert.equal(ensemble[0], 'ensemble', 'orchestra owns a single channel, not the two hands');
    assert.equal(ensemble[5].length, 4);
    h.session.applySettings({ performance: 'solo' });
    assert.ok(h.audioInstances[0].releases.includes('ensemble'));
    play(200);
    const solo = h.audioInstances[0].notes.at(-1);
    assert.equal(solo.length, 6);
    assert.equal(solo[5], null);
    assert.ok(['left', 'right'].includes(solo[0]), 'solo playback returns to the hand channels');
  }
});

test('orchestra follows one conductor even when a second hand is visible', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  h.session.applySettings({ performance: 'orchestra' });
  await h.session.start();
  const hand = openHand;
  h.trackers[0].onFrame([hand(.1, .5), hand(.9, .5)], 100);
  assert.equal(h.audioInstances[0].notes.length, 1, 'two hands still make one ensemble note');
  assert.ok(Math.abs(h.audioInstances[0].notes[0][3] - .8) < 1e-9);
  // The other hand moves; the conductor keeps the ensemble, so the pan barely shifts.
  h.trackers[0].onFrame([hand(.15, .5), hand(.9, .1)], 200);
  assert.equal(h.audioInstances[0].notes.length, 1, 'the same pitch does not retrigger');
  const [, , heldPan] = h.events.filter(([name]) => name === 'pan').at(-1);
  assert.ok(heldPan > .6, 'the conductor keeps the ensemble instead of the nearer-in-x hand');
  h.trackers[0].onFrame([hand(.15, .1), hand(.9, .9)], 300);
  assert.equal(h.audioInstances[0].notes.length, 2);
  assert.ok(h.audioInstances[0].notes[1][3] > .5, 'a second hand cannot steal the ensemble');
  h.trackers[0].onFrame([], 400);
  assert.ok(h.audioInstances[0].releases.includes('ensemble'));
  assert.equal(h.session.read().state, 'running', 'losing the conductor must not stop the session');
  // The hand comes back: the ensemble picks up again on the same running session.
  h.trackers[0].onFrame([hand(.1, .5)], 500);
  assert.equal(h.audioInstances[0].notes.length, 3, 'the ensemble returns when the hand does');
  assert.equal(h.audioInstances[0].notes[2][0], 'ensemble');
  assert.equal(h.audioInstances[0].notes[2][5].length, 4);
});

test('orchestra borrows the right hand mix and keeps both hand settings', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  h.session.applySettings({ performance: 'orchestra', right: { volume: 40, mute: true }, left: { sound: 'guitar' } });
  await h.session.start();
  const ensembleMix = args => args[2] === 'ensemble';
  assert.ok(h.audioInstances[0].volumes.some(args => ensembleMix(args) && args[0] === .4 && args[1] === true));
  assert.ok(h.audioInstances[0].volumes.some(args => args[2] === 'right' && args[0] === .4 && args[1] === true));
  assert.equal(h.session.read().right.volume, 40);
  assert.equal(h.session.read().left.sound, 'guitar', 'the left hand keeps its solo sound while orchestra is active');
  h.session.applySettings({ performance: 'solo' });
  assert.equal(h.session.read().right.muted, true, 'switching modes does not discard a choice');
  h.session.reset();
  assert.equal(h.session.read().right.volume, 65);
  assert.equal(h.session.read().right.muted, false);
});
