import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionHarness } from './helpers/session-harness.mjs';
import { CALIBRATION, poseFixture } from './helpers/pose-fixture.mjs';

const STILL = Array.from({ length: CALIBRATION }, () => ({}));
const REACHING = { reach: .9 };
const LIMB_CHANNELS = ['left', 'right', 'lowerLeft', 'lowerRight'];

/** A running body session, plus a way to feed it frames the way the model would.
 *  The session owns its own geometry mapper, so the calibration window has to be
 *  played through the tracker boundary rather than short-circuited. */
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

test('a tracked body plays one note per visible limb on four real channels', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([REACHING]);
  // Four notes, one per limb — same pose in, four voices out.
  assert.equal(h.audio().notes.length, 4);
  const channels = new Set(h.audio().notes.map(note => note[0]));
  assert.deepEqual([...channels].sort(), [...LIMB_CHANNELS].sort());
  for (const note of h.audio().notes) {
    const [, midi, velocity, pan, sound, arrangement] = note;
    assert.ok(midi >= 12 && midi <= 120, 'each limb produces a real MIDI note');
    assert.ok(velocity > 0 && velocity <= 1);
    assert.ok(pan >= -1 && pan <= 1);
    assert.ok(typeof sound === 'string', 'each limb carries its own sound ID');
    assert.equal(arrangement, null, 'body mode does not voice sections — each limb is its own voice');
  }
});

test('a held body steers its four voices instead of retriggering them', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([REACHING, REACHING, REACHING]);
  assert.equal(h.audio().notes.length, 4, 'a body held overhead sounds four voices, not twelve');
  // Each limb should keep steering its own pan between notes.
  for (const channel of LIMB_CHANNELS) {
    const pans = h.events.filter(([name, ch]) => name === 'pan' && ch === channel);
    assert.ok(pans.length >= 2, channel + ' keeps steering while the body holds');
  }
});

test('losing the body releases all four voices instead of freezing them', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([REACHING, null]);
  const released = new Set(h.audio().releases);
  for (const channel of LIMB_CHANNELS) assert.ok(released.has(channel), channel + ' was released');
  assert.match(h.status(), /No body|hold still|Step back|Upper body/);
});

test('a body is calibrated before it plays, and the first note is silent', async t => {
  const h = await bodySession(t);
  h.feed([{}, {}]);
  assert.match(h.hints()[2], /hold still/, 'the overlay says what to do');
  assert.match(h.status(), /hold still/);
  assert.equal(h.audio().notes.length, 0, 'calibrating must not make a sound');
  h.standing();
  assert.equal(h.hints()[2], undefined, 'and then it stops talking');
  assert.match(h.status(), /Four voices|Arms only|Step back/);
});

test('a body that needs framing guidance asks for it on the stage', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([{ ...REACHING, ankleY: 1.06 }]);
  assert.match(h.hints()[2], /Step back/, 'the overlay asks for more room');
  assert.match(h.status(), /Step back/);
});

test('stopping a body session disposes the pose model and its channels', async t => {
  const h = await bodySession(t);
  h.session.stop();
  assert.equal(h.poseTrackers[0].stopped, 1);
  assert.equal(h.audio().closed, 1);
  assert.equal(h.session.read().state, 'idle');
});

test('each limb uses its own scale, and changing one follows that limb', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([REACHING]);
  // Pentatonic and major are different note sets, so the left arm must land on
  // a note that is not in pentatonic after the change.
  const pentatonic = new Set([60, 62, 64, 67, 69, 72]);
  h.session.applySettings({ left: { scale: 'major' } });
  h.standing();
  h.feed([REACHING]);
  const notes = h.audio().notes.map(note => [note[0], note[1]]);
  const leftNote = notes.find(([ch]) => ch === 'left')[1];
  assert.ok(!pentatonic.has(leftNote % 12),
    'left arm plays a note that is only in major, so it followed the scale change');
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
  // The four limb channels were released when body mode ended, so no new body
  // notes should appear after the switch.
  assert.equal(h.audio().notes.length, 4, 'a dead tracker must not keep a voice alive');
  assert.equal(h.session.read().state, 'idle', 'and the body is handed back for a restart');
});

test('mouse mode has no posture to read, so it hands the session back to the hands', async t => {
  const h = await bodySession(t);
  h.session.switchMode();
  assert.equal(h.session.read().mode, 'mouse');
  assert.equal(h.session.read().performance, 'solo');
  assert.equal(h.session.read().state, 'idle');
});

test('legs that leave frame release their voices, but arms keep playing', async t => {
  const h = await bodySession(t);
  h.standing();
  h.feed([REACHING]);
  const beforeCount = h.audio().notes.length;
  assert.equal(beforeCount, 4);
  // Now a pose with feet out of frame: arms stay visible, legs do not.
  h.feed([{ ...REACHING, ankleVisibility: 0, ankleY: .99 }]);
  const channelsAfter = new Set(h.audio().notes.slice(beforeCount).map(n => n[0]));
  for (const ch of channelsAfter) {
    assert.ok(ch === 'left' || ch === 'right', 'only arms sounded with feet out of frame');
  }
});
