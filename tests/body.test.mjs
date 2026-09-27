import test from 'node:test';
import assert from 'node:assert/strict';
import {
  J, bodyFeatures, bodyMotion, framing, isPose, mirrorPose, neutralPose,
} from '../dist/tracking/posture.js';
import { PostureClassifier } from '../dist/tracking/classifier.js';
import { BodyMapper } from '../dist/music/body-mapper.js';
import { applyPosture, ARM_CHANNELS, LEG_CHANNELS } from '../dist/music/orchestra.js';
import { SCALES } from '../dist/music/scales.js';
import { CALIBRATION, poseFixture, runFrames } from './helpers/pose-fixture.mjs';

const PENTATONIC = SCALES.pentatonic.notes;
const still = { reach: -1.3, span: 1 };
/** Posture descriptors for a pose, measured against a standing player. */
const describe = (options = {}) =>
  bodyFeatures(poseFixture(options), neutralPose(poseFixture(still)));
/** The same, but with the movement energy the mapper would have smoothed. */
const moving = (energy, options = {}) => ({ ...describe(options), energy });

test('a pose is only accepted when the joints the mapper reads are all present', () => {
  assert.ok(isPose(poseFixture()));
  for (const broken of [null, undefined, [], 'pose', poseFixture().slice(0, 20)]) {
    assert.equal(isPose(broken), false);
  }
  const missing = poseFixture();
  missing[J.wristR] = { x: NaN, y: .5 };
  assert.equal(isPose(missing), false);
});

test('the mirror happens exactly once, and only on x', () => {
  const raw = poseFixture();
  const mirrored = mirrorPose(raw);
  assert.equal(mirrored.length, raw.length);
  assert.ok(Math.abs(mirrored[J.shoulderR].x - (1 - raw[J.shoulderR].x)) < 1e-12);
  assert.equal(mirrored[J.shoulderR].y, raw[J.shoulderR].y);
  assert.ok(Math.abs(mirrorPose(mirrored)[J.shoulderR].x - raw[J.shoulderR].x) < 1e-12,
    'mirroring twice is the original, up to float rounding');
});

test('how much of the player is in frame decides which limbs can play', () => {
  assert.equal(framing(poseFixture()), 'full');
  assert.equal(framing(null), 'lost');
  // Feet hidden mid-body reads as an upper-body player — arms still play.
  assert.equal(framing(poseFixture({ ankleVisibility: 0 })), 'upper');
  // Feet hidden and the legs running off the bottom edge means step back.
  assert.equal(framing(poseFixture({ ankleVisibility: 0, ankleY: 1 })), 'step-back');
  assert.equal(framing(poseFixture({ ankleY: 1.06 })), 'step-back');
  // No hips means no torso to measure against, so nothing is playable.
  assert.equal(framing(poseFixture({ hipVisibility: 0 })), 'lost');
});

test('the same dance at two distances produces the same posture', () => {
  // Each player is described in his own torso lengths and measured against his
  // own neutral, so a player twice as far off reads exactly like one close up.
  const at = (torso, moved) => {
    const standing = { torso, ...still };
    const neutral = neutralPose(poseFixture(standing));
    return bodyFeatures(poseFixture({ ...standing, ...moved }), neutral);
  };
  const dancing = torso => ({ reach: .8, span: 1.6, tilt: .4, hipY: .6 + torso * .3 });
  const close = at(.3, dancing(.3));
  const far = at(.15, dancing(.15));
  assert.notEqual(close.torso, far.torso, 'the two players really are different sizes');
  for (const key of ['reachL', 'reachR', 'armL', 'armR', 'spread', 'crouch', 'lean', 'twist']) {
    assert.ok(Math.abs(close[key] - far[key]) < 1e-9, key + ' is not distance invariant');
  }
  assert.ok(close.crouch > .2 && close.reachR > .5, 'the pose should actually be raised and dipped');
});

test('the neutral ruler is the player\'s own body, not a constant', () => {
  assert.ok(Math.abs(neutralPose(poseFixture({ torso: .3 })).torso - .3) < 1e-9);
  assert.ok(Math.abs(neutralPose(poseFixture({ torso: .15, shoulderY: .45 })).torso - .15) < 1e-9);
  assert.equal(neutralPose(null), null);
});

test('movement energy is a speed, and a jump is recognised as one', () => {
  const neutral = neutralPose(poseFixture(still));
  const standing = bodyFeatures(poseFixture(still), neutral);
  const waved = bodyFeatures(poseFixture({ reach: .6 }), neutral);
  assert.equal(bodyMotion(standing, null, .05).energy, 0, 'the first frame has nothing to compare');
  assert.ok(bodyMotion(waved, standing, .05).energy > 0);
  assert.equal(bodyMotion(waved, standing, .05).airborne, false, 'an arm wave is not a jump');

  const crouched = bodyFeatures(poseFixture({ hipY: .69 }), neutral);
  const leapt = bodyFeatures(poseFixture({ hipY: .58, ankleY: .9 }), neutral);
  const rose = bodyFeatures(poseFixture({ hipY: .58 }), neutral);
  assert.equal(bodyMotion(leapt, crouched, .05).airborne, true, 'up with the feet off the floor');
  assert.equal(bodyMotion(rose, crouched, .05).airborne, false, 'up while standing is not a jump');
  assert.equal(bodyMotion(crouched, standing, .05).airborne, false, 'down is never a jump');
});

test('a posture engages only after it holds, and only releases after it goes', () => {
  const classifier = new PostureClassifier();
  const raised = describe({ reach: .9 });
  const dancing = moving(1);
  const hold = (features, times) => Array.from({ length: times }, () => classifier.update(features, {}));

  assert.equal(hold(raised, 1)[0].id, null, 'one frame is not a posture');
  assert.equal(hold(raised, 1)[0].id, 'arms_up', 'arms up needs two frames');
  const away = hold(dancing, 5);
  assert.equal(away.at(-1).id, 'arms_up', 'five loud frames do not clear six');
  assert.equal(hold(dancing, 1)[0].id, null, 'the sixth does');
  classifier.reset();
  assert.equal(classifier.current, null, 'a reset starts from nothing');
});

test('holding still is itself a posture, so stillness can be played', () => {
  const classifier = new PostureClassifier();
  const quiet = moving(0);
  const result = Array.from({ length: 7 }, () => classifier.update(quiet, {}));
  assert.equal(result.slice(0, 5).at(-1).id, null, 'stillness is held for six frames');
  assert.equal(result.at(-1).id, 'still');
  assert.ok(result.at(-1).strength > 0, 'a settled posture reports how far past its threshold it is');
  assert.equal(new PostureClassifier().update(quiet, { airborne: true }).id, null,
    'a jump outranks stillness');
});

test('sensitivity moves every threshold without adding a rule', () => {
  const faint = describe({ reach: .45 });
  const plain = new PostureClassifier();
  assert.equal([plain.update(faint, {}).id, plain.update(faint, {}).id].at(-1), null, 'too faint to name');
  const keen = new PostureClassifier(1.4);
  assert.equal(keen.update(faint, {}).id, null, 'one frame is still one frame');
  assert.equal(keen.update(faint, {}).id, 'arms_up', 'but a keener threshold names it');
  assert.equal(new PostureClassifier(0).sensitivity, 1, 'a nonsense sensitivity falls back to default');
});

test('the mapper learns the neutral pose before it produces any limbs', () => {
  const mapper = new BodyMapper();
  const frames = runFrames(mapper, Array.from({ length: CALIBRATION }, () => ({})));
  assert.ok(frames.slice(0, -1).every(frame => frame.limbs.length === 0),
    'no limbs before calibration ends');
  assert.match(frames[0].hint, /hold still/, 'the player is told what to do');
  assert.match(frames[0].status, /hold still/);
  assert.equal(frames.at(-1).calibrated, true, 'the frame that finishes calibration is ready');

  const [ready] = runFrames(mapper, [{}], CALIBRATION * 50);
  assert.equal(ready.limbs.length, 4, 'a calibrated player has all four limbs');
  assert.equal(ready.hint, null, 'calibrated players are left alone');
  assert.match(ready.status, /Four voices|Arms only|Step back/);
});

test('each limb carries its own channel, screen position and visibility', () => {
  const mapper = new BodyMapper();
  runFrames(mapper, Array.from({ length: CALIBRATION }, () => ({})));
  const [frame] = runFrames(mapper, [{}], CALIBRATION * 50);
  const channels = frame.limbs.map(limb => limb.channel);
  assert.deepEqual(new Set(channels), new Set(['left', 'right', 'lowerLeft', 'lowerRight']));
  for (const limb of frame.limbs) {
    assert.ok(limb.x >= 0 && limb.x <= 1, limb.channel + ' x is on screen');
    assert.ok(limb.y >= 0 && limb.y <= 1, limb.channel + ' y is in the lane range');
    assert.equal(limb.visible, true, limb.channel + ' is visible when its joints are');
  }
});

test('a body that has lost its ankles falls back to arms-only without going silent', () => {
  const mapper = new BodyMapper();
  runFrames(mapper, Array.from({ length: CALIBRATION }, () => ({})));
  // When the hips are gone the whole pose is lost and the mapper returns null —
  // a limb-level visibility flag is for the legs being cropped, not the trunk
  // being gone.
  const lost = runFrames(mapper, [{ hipVisibility: 0 }], CALIBRATION * 50);
  assert.equal(lost.length, 1, 'a hip-less body is one frame, not four voices');
  assert.equal(lost[0], null, 'and that frame is silent, like a lost hand');

  // Ankle visibility controls the legs only.
  const [upper] = runFrames(mapper, [{ ankleVisibility: 0 }], CALIBRATION * 50);
  for (const limb of upper.limbs) {
    if (limb.channel === 'lowerLeft' || limb.channel === 'lowerRight') {
      assert.equal(limb.visible, false, limb.channel + ' needs ankles');
    } else {
      assert.equal(limb.visible, true, limb.channel + ' does not need ankles');
    }
  }
});

test('arm heights and leg heights live on separate ladders', () => {
  const mapper = new BodyMapper();
  runFrames(mapper, Array.from({ length: CALIBRATION }, () => ({})));
  const [armsDown] = runFrames(mapper, [{}], (CALIBRATION + 1) * 50);
  for (const limb of armsDown.limbs) assert.ok(limb.y > .85, limb.channel + ' arms-down is the bottom lane');
  const [armsUp] = runFrames(mapper, [{ reach: .9 }], (CALIBRATION + 2) * 50);
  for (const limb of armsUp.limbs) {
    if (limb.channel === 'left' || limb.channel === 'right') {
      assert.ok(limb.y < .2, limb.channel + ' arms-up is the top lane');
    } else {
      assert.ok(limb.y > .5, limb.channel + ' legs do not move with the arms');
    }
  }
});

test('postures shape the four voices the same way', () => {
  const notes = (posture, strength, lean = 0) => applyPosture([
    { channel: 'left', midi: 60, pan: -.2, velocity: .5 },
    { channel: 'right', midi: 60, pan: .2, velocity: .5 },
    { channel: 'lowerLeft', midi: 60, pan: -.1, velocity: .5 },
    { channel: 'lowerRight', midi: 60, pan: .1, velocity: .5 },
  ], posture, strength, lean);
  assert.deepEqual(ARM_CHANNELS, ['left', 'right']);
  assert.deepEqual(LEG_CHANNELS, ['lowerLeft', 'lowerRight']);

  // Null posture is a no-op.
  assert.deepEqual(notes(null, 0).map(n => n.midi), [60, 60, 60, 60]);

  // Arms up lifts the arms, leaves the legs.
  const up = notes('arms_up', 1);
  assert.equal(up.find(n => n.channel === 'left').midi, 72);
  assert.equal(up.find(n => n.channel === 'right').midi, 72);
  assert.equal(up.find(n => n.channel === 'lowerLeft').midi, 60);
  assert.equal(up.find(n => n.channel === 'lowerRight').midi, 60);

  // Squat drops the legs, leaves the arms.
  const down = notes('squat', 1);
  assert.equal(down.find(n => n.channel === 'left').midi, 60);
  assert.equal(down.find(n => n.channel === 'right').midi, 60);
  assert.equal(down.find(n => n.channel === 'lowerLeft').midi, 48);
  assert.equal(down.find(n => n.channel === 'lowerRight').midi, 48);

  // Wide opens the stereo image, lean drags it sideways by the body's torso tilt.
  const wide = notes('wide', 0, 0);
  const flat = notes(null, 0, 0);
  assert.ok(Math.max(...wide.map(n => n.pan)) - Math.min(...wide.map(n => n.pan)) >
    Math.max(...flat.map(n => n.pan)) - Math.min(...flat.map(n => n.pan)),
    'wide opens the stereo image');
  const left = notes('lean', 0, -1).map(n => n.pan);
  const right = notes('lean', 0, 1).map(n => n.pan);
  assert.ok(left.every((pan, i) => pan < flat[i].pan), 'leaning left drags every voice left');
  assert.ok(right.every((pan, i) => pan > flat[i].pan), 'and leaning right drags them right');

  // Strength swells the velocity.
  const soft = notes(null, 0)[0].velocity;
  const hard = notes(null, 1)[0].velocity;
  assert.ok(hard > soft, 'a stronger posture plays louder');
});

test('the four voices all sit inside one shared scale', () => {
  for (const [scale, { notes }] of Object.entries(SCALES)) {
    for (const posture of [null, 'arms_up', 'squat']) {
      for (const limb of ['left', 'right', 'lowerLeft', 'lowerRight']) {
        const voiced = applyPosture([
          { channel: limb, midi: notes[0], pan: 0, velocity: .5 },
        ], posture, 1);
        const midi = voiced[0].midi;
        const pitchClass = ((midi % 12) + 12) % 12;
        assert.ok(notes.map(n => n % 12).includes(pitchClass) || posture === 'arms_up',
          scale + ' ' + limb + ' ' + posture + ': ' + midi + ' is outside the scale');
      }
    }
  }
});
