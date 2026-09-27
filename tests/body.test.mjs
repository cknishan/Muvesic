import test from 'node:test';
import assert from 'node:assert/strict';
import {
  J, bodyFeatures, bodyMotion, framing, isPose, mirrorPose, neutralPose,
} from '../dist/tracking/posture.js';
import { PostureClassifier } from '../dist/tracking/classifier.js';
import { BodyMapper } from '../dist/music/body-mapper.js';
import { arrangeBody } from '../dist/music/orchestra.js';
import { SCALES } from '../dist/music/scales.js';
import { CALIBRATION, poseFixture, runFrames } from './helpers/pose-fixture.mjs';

const PENTATONIC = SCALES.pentatonic.notes;
const still = { reach: -1.3, span: 1 };
/** Posture descriptors for a pose, measured against a standing player. */
const describe = (options = {}) =>
  bodyFeatures(poseFixture(options), neutralPose(poseFixture(still)));
/** The same, but with the movement energy the mapper would have smoothed. */
const moving = (energy, options = {}) => ({ ...describe(options), energy });
/** A mapper calibrated against this player's own ruler, ready for one more frame. */
const playing = (options = {}) => {
  const mapper = new BodyMapper();
  const standing = { ...still, ...options };
  runFrames(mapper, Array.from({ length: CALIBRATION }, () => standing));
  return { mapper, standing, time: CALIBRATION * 50 };
};

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
  // Mirroring twice is the original, up to float rounding: the flip happens once.
  assert.ok(Math.abs(mirrorPose(mirrored)[J.shoulderR].x - raw[J.shoulderR].x) < 1e-12);
});

test('how much of the player is in frame decides the available kit', () => {
  assert.equal(framing(poseFixture()), 'full');
  assert.equal(framing(null), 'lost');
  // Feet hidden mid-body reads as an upper-body player, who can still dance.
  assert.equal(framing(poseFixture({ ankleVisibility: 0 })), 'upper');
  // Feet hidden and the legs running off the bottom edge means step back.
  assert.equal(framing(poseFixture({ ankleVisibility: 0, ankleY: 1 })), 'step-back');
  assert.equal(framing(poseFixture({ ankleY: 1.06 })), 'step-back');
  // No hips means no torso to measure against, so nothing is playable.
  assert.equal(framing(poseFixture({ hipVisibility: 0 })), 'lost');
});

test('the same dance at two distances produces the same posture', () => {
  // Each player is described in his own torso lengths and measured against his own
  // neutral, so a player twice as far off reads exactly like one standing close.
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
  // A jump outranks stillness, so a big movement is never reported as standing still.
  assert.equal(new PostureClassifier().update(quiet, { airborne: true }).id, null);
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

test('the mapper learns the neutral pose before it plays anything', () => {
  const mapper = new BodyMapper();
  const frames = runFrames(mapper, Array.from({ length: CALIBRATION }, () => ({})));
  assert.ok(frames.slice(0, -1).every(frame => frame.midi === null), 'no note before calibration ends');
  assert.match(frames[0].hint, /hold still/, 'the player is told what to do');
  assert.match(frames[0].status, /hold still/);
  assert.equal(frames.at(-1).midi, null, 'the frame that finishes calibration still rests');

  const [frame] = runFrames(mapper, [{}], CALIBRATION * 50);
  assert.equal(frame.hint, null, 'a calibrated player is left alone');
  assert.equal(frame.status, 'Body tracked · Playing');
  assert.ok(PENTATONIC.includes(frame.midi), 'the note comes from the chosen scale');
  assert.equal(frame.index, PENTATONIC.length - 1, 'arms at your sides read the bottom lane');
  assert.equal(frame.midi, PENTATONIC[0], 'and so the low note, like every other lane');
});

test('the higher arm leads and the lower arm sets the root under it', () => {
  const { mapper, standing, time } = playing();
  // One arm overhead and one arm at the side: two voices, one arrangement.
  const [frame] = runFrames(mapper, [{ ...standing, wristRy: 0, wristLy: .68 }], time);
  assert.equal(frame.index, 0, 'the high arm takes the top lane');
  assert.equal(frame.midi, PENTATONIC[0], 'the low arm sets the root, a full octave below');
  assert.ok(PENTATONIC.at(-1) > frame.midi, 'so the root can never ride over the melody');
});

test('moving away from the camera does not retune the instrument', () => {
  const lane = torso => {
    const { mapper, standing, time } = playing({ torso });
    return runFrames(mapper, [{ ...standing, reach: .9 }], time)[0].index;
  };
  // Same arms raised, one player filling the frame and one small in the middle.
  assert.equal(lane(.3), lane(.15));
});

test('a lost or unusable body is silence, exactly like a lost hand', () => {
  const { mapper, time } = playing();
  const [first] = runFrames(mapper, [{}], time);
  assert.equal(mapper.update(null, time + 50), null, 'no body at all');
  assert.equal(mapper.update(poseFixture({ hipVisibility: 0 }), time + 100), null, 'no hips to measure');
  assert.equal(mapper.update(poseFixture(), time), null, 'a repeated timestamp is not a new frame');
  assert.ok(first.midi !== null, 'and a real body in between still plays');
});

test('the player is told to step back rather than losing the ones that fit', () => {
  const { mapper, standing, time } = playing();
  const [frame] = runFrames(mapper, [{ ...standing, ankleY: 1.06 }], time);
  assert.match(frame.hint, /Step back/, 'squats and jumps need the whole body');
  assert.equal(frame.status, 'Step back — feet out of frame');
  assert.ok(frame.midi !== null, 'and they can keep playing with what is in frame');

  const [upper] = runFrames(mapper, [{ ...standing, ankleVisibility: 0 }], time + 50);
  assert.match(upper.hint, /Upper body only/);
  assert.equal(upper.status, 'Upper body · Playing');
});

test('retriggering is rate limited, so a held posture cannot machine-gun notes', () => {
  const { mapper, standing, time } = playing();
  const rapid = runFrames(mapper, [
    { ...standing, wristRy: .2 }, { ...standing, wristRy: .3 }, { ...standing, wristRy: .4 },
  ], time, 20);
  assert.deepEqual(rapid.map(frame => frame.trigger), [true, false, false]);
  assert.equal(mapper.update(poseFixture({ ...standing, wristRy: .4 }), time + 100).trigger, true);
});

test('a lost body mid-groove releases the note instead of freezing it', () => {
  const { mapper, standing, time } = playing();
  const [sounded] = runFrames(mapper, [{ ...standing, wristRy: .2 }], time);
  assert.equal(sounded.trigger, true);
  assert.equal(mapper.update(null, time + 50), null, 'the session reads this as tracking loss');
  // The mapper resets through the same door a lost hand uses, so the next frame
  // asks for calibration again rather than trusting a stale ruler.
  mapper.reset();
  assert.match(mapper.hint(), /hold still/);
  assert.equal(mapper.update(poseFixture(), time + 100).midi, null);
});

test('the body arrangement always voices the four sections above the root', () => {
  const parts = arrangeBody({ midi: 60, posture: null, strength: 0, pan: 0 }, 'pentatonic');
  assert.deepEqual(parts.map(part => part.sound), ['strings', 'woodwind', 'brass', 'cello']);
  assert.deepEqual(parts.map(part => part.midi), [60, 64, 67, 48]);
  for (const part of parts) {
    assert.ok(part.level > 0 && part.level <= .5, part.sound + ' is mixed at a sensible level');
    assert.ok(part.pan >= -1 && part.pan <= 1, part.sound + ' stays inside the stereo field');
  }
});

test('postures colour the chord instead of adding notes', () => {
  const level = (parts, sound) => parts.find(part => part.sound === sound).level;
  const note = (parts, sound) => parts.find(part => part.sound === sound).midi;
  const pan = (parts, sound) => parts.find(part => part.sound === sound).pan;
  const width = parts => Math.max(...parts.map(part => part.pan)) - Math.min(...parts.map(part => part.pan));
  const plain = arrangeBody({ midi: 60, posture: null, strength: 0, pan: 0 }, 'pentatonic');

  const loud = arrangeBody({ midi: 60, posture: null, strength: 1, pan: 0 }, 'pentatonic');
  for (const part of loud) assert.ok(part.level > level(plain, part.sound), part.sound + ' swells');

  const up = arrangeBody({ midi: 60, posture: 'arms_up', strength: .5, pan: 0 }, 'pentatonic');
  assert.equal(note(up, 'cello'), 60, 'arms up lift the whole chord, floor included');
  for (const part of up) assert.ok(part.midi >= note(plain, part.sound), part.sound + ' lifts');

  const down = arrangeBody({ midi: 60, posture: 'squat', strength: .5, pan: 0 }, 'pentatonic');
  for (const part of down) {
    if (part.sound !== 'cello') assert.ok(part.midi < note(plain, part.sound), part.sound + ' drops');
  }
  assert.equal(note(down, 'cello'), note(plain, 'cello'),
    'the floor holds, because dropping the bass again would leave the register');
  assert.ok(level(down, 'cello') > level(plain, 'cello'), 'and a squat thickens rather than fades');

  const wide = arrangeBody({ midi: 60, posture: 'wide', strength: 0, pan: 0 }, 'pentatonic');
  assert.ok(width(wide) > width(plain), 'arms wide open the image');
  assert.ok(wide.every(part => Math.abs(part.pan) <= 1), 'and stay inside it');

  const left = arrangeBody({ midi: 60, posture: 'lean', strength: 0, pan: -1 }, 'pentatonic');
  for (const part of left) assert.ok(pan(left, part.sound) < pan(plain, part.sound), 'leaning drags it');
  const right = arrangeBody({ midi: 60, posture: 'lean', strength: 0, pan: 1 }, 'pentatonic');
  for (const part of right) assert.ok(pan(right, part.sound) > pan(plain, part.sound), 'both ways');
});

test('an arrangement stays diatonic, the same contract the ensemble keeps', () => {
  for (const [scale, { notes }] of Object.entries(SCALES)) {
    const allowed = scale === 'minor' ? [9, 11, 0, 2, 4, 5, 7] : [0, 2, 4, 5, 7, 9, 11];
    for (const posture of [null, 'arms_up', 'squat', 'wide', 'lean']) {
      for (const midi of notes) {
        const parts = arrangeBody({ midi, posture, strength: 1, pan: -1 }, scale);
        assert.equal(parts.length, 4, 'four sections, every posture');
        for (const part of parts) {
          assert.ok(allowed.includes(((part.midi % 12) + 12) % 12), scale + ': ' + part.midi);
        }
      }
    }
  }
});
