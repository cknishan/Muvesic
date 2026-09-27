import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionHarness } from './helpers/session-harness.mjs';
import { CALIBRATION, poseFixture } from './helpers/pose-fixture.mjs';

const STILL = Array.from({ length: CALIBRATION }, () => ({}));
const REACHING = { reach: .9 };

/** A running body session, plus a way to feed it frames the way the model would.
 *  The session owns its own mapper, so the calibration window has to be played
 *  through the tracker boundary rather than short-circuited. */
async function bodySession(t, patch = {}) {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  h.session.applySettings({ performance: 'body', ...patch });
  await h.session.start();
  const tracker = h.poseTrackers[0];
  let time = 0;
  const feed = frames => {
    for (const frame of frames) {
      time += 50;
      tracker.onFrame(frame === null ? null : poseFixture(frame), time);
    }
    return time;
  };
  const hints = () => h.events.filter(([name]) => name === 'showTrackingHint').at(-1);
  const status = () => h.events.filter(([name]) => name === 'setStatus').at(-1)[1];
  return { ...h, feed, hints, status, audio: () => h.audioInstances[0], standing: () => feed(STILL) };
}

test('body mode asks the camera for a pose tracker, not a hand tracker', async t => {
  const h = await bodySession(t);
  assert.equal(h.poseTrackers.length, 1);
  assert.equal(h.trackers.length, 0, 'no hand model is loaded in body mode');
  assert.equal(h.session.read().performance, 'body');
  assert.equal(h.session.read().state, 'running');
});

test('a tracked body plays one sustained chord on the body channel', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([REACHING]);
  assert.equal(h.audio().notes.length, 1);
  const [channel, midi, velocity, pan, sound, arrangement] = h.audio().notes[0];
  assert.equal(channel, 'body', 'body mode owns one channel of its own');
  assert.equal(sound, null, 'and takes its timbres from the arrangement');
  assert.ok(midi >= 57 && midi <= 72, 'the root is a real scale note');
  assert.ok(velocity > 0 && velocity <= 1);
  assert.ok(pan >= -1 && pan <= 1);
  assert.deepEqual(arrangement.map(part => part.sound), ['strings', 'woodwind', 'brass', 'cello']);
  for (const part of arrangement) assert.ok(part.midi < 96, 'no voice escapes the register');
});

test('a held body steers its chord instead of retriggering it', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([REACHING, REACHING, REACHING]);
  assert.equal(h.audio().notes.length, 1, 'a body held overhead sounds once, not three times');
  const steered = h.events.filter(([name, channel]) => name === 'pan' && channel === 'body');
  assert.ok(steered.length >= 2, 'and keeps steering its stereo image while it holds');
});

test('losing the body releases the chord instead of freezing it', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([REACHING, null]);
  assert.deepEqual(h.audio().releases, ['body']);
  assert.match(h.status(), /No body/, 'and the player is told the body went missing');
});

test('a body is calibrated before it plays, and the first note is silent', async t => {
  const h = await bodySession(t);
  h.feed([{}, {}]);
  assert.match(h.hints()[2], /hold still/, 'the overlay says what to do');
  assert.match(h.status(), /hold still/);
  assert.equal(h.audio().notes.length, 0, 'calibrating must not make a sound');
  h.standing();
  assert.equal(h.hints()[2], undefined, 'and then it stops talking');
  assert.match(h.status(), /Body tracked/);
});

test('a body that needs framing guidance asks for it on the stage', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([{ ...REACHING, ankleY: 1.06 }]);
  assert.match(h.hints()[2], /Step back/, 'the overlay asks for more room');
  assert.match(h.status(), /Step back/);
  h.feed([{ ...REACHING, ankleVisibility: 0 }]);
  assert.match(h.hints()[2], /Upper body only/, 'and settles for a smaller kit if it has to');
  assert.match(h.status(), /Upper body/);
});

test('stopping a body session disposes the pose model and its channel', async t => {
  const h = await bodySession(t);
  h.session.stop();
  assert.equal(h.poseTrackers[0].stopped, 1);
  assert.equal(h.audio().closed, 1);
  assert.equal(h.session.read().state, 'idle');
});

test('body mode borrows the right hand scale, and follows it when it changes', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([REACHING]);
  const before = h.audio().notes.at(-1)[1];
  h.session.applySettings({ right: { scale: 'minor' } });
  h.standing();
  h.feed([REACHING]);
  const after = h.audio().notes.at(-1)[1];
  assert.notEqual(after, before, 'a new scale means a new root');
  assert.ok([57, 59, 60, 62, 64, 65, 67, 69].includes(after), 'and the root is in the new scale');
});

test('entering or leaving body mode restarts, because the camera model changes', async t => {
  const h = await bodySession(t);
  h.session.applySettings({ performance: 'solo' });
  assert.equal(h.session.read().state, 'idle', 'a pose model cannot play two hands');
  await h.session.start();
  assert.equal(h.trackers.length, 1, 'and the hand tracker takes over on the next start');
  assert.equal(h.poseTrackers.length, 1, 'without a second pose model');
});

test('switching between the two hand performances stays live', async t => {
  const h = sessionHarness();
  t.after(() => h.session.dispose());
  await h.session.start();
  h.session.applySettings({ performance: 'orchestra' });
  assert.equal(h.session.read().state, 'running', 'one hand drives either performance');
  assert.equal(h.trackers.length, 1, 'so the same tracker keeps going');
  h.session.applySettings({ performance: 'solo' });
  assert.equal(h.session.read().state, 'running');
});

test('a pose frame cannot sneak into a hand performance', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([REACHING]);
  h.session.applySettings({ performance: 'orchestra' });
  h.feed([REACHING]);
  assert.equal(h.audio().notes.length, 1, 'a dead tracker must not keep a voice alive');
  assert.equal(h.session.read().state, 'idle', 'and the body is handed back for a restart');
});

test('mouse mode has no posture to read, so it hands the session back to the hands', async t => {
  const h = await bodySession(t);
  h.session.switchMode();
  assert.equal(h.session.read().mode, 'mouse');
  assert.equal(h.session.read().performance, 'solo');
  assert.equal(h.session.read().state, 'idle');
});
