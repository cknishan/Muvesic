import { clamp } from '../shared/math.js';
import { SCALES } from './scales.js';
import { pitchIndex } from './motion-mapper.js';
import { bodyFeatures, bodyMotion, framing, isPose, mirrorPose, neutralPose } from '../tracking/posture.js';
import { PostureClassifier } from '../tracking/classifier.js';

/** A standing-still window at ~20 Hz, long enough to average out tracker noise. */
const CALIBRATION_FRAMES = 24;
/** Same attack gate as the fingertip mapper, so both instruments feel alike. */
const ATTACK_GAP = 85;
/** Torso lengths per second counted as a full-scale movement. */
const FULL_SPEED = 3;
/** Arm heights, in torso lengths above the hips, that span the pitch ladder:
 *  arms hanging at your sides, up to arms straight overhead. */
const ARMS_LOW = -.5;
const ARMS_HIGH = 2.2;

/** Turn a body-relative arm height into a 0..1 screen position, the shape the
 *  shared lane helper expects. The flip matters: arms up have to read as the top
 *  of the stage, because the top of the stage is the high notes. */
const lane = rise => clamp(1 - (rise - ARMS_LOW) / (ARMS_HIGH - ARMS_LOW));

/** Turns whole-body movement into note events.
 *
 * Two arms make two voices: the higher wrist leads the melody and owns the lane
 * the player sees, while the lower wrist sets the root the arrangement is built
 * from. Every distance is divided by the player's own calibrated torso, so a
 * player standing close and a player standing back read the same, and stepping
 * back to fit their feet in frame does not retune the instrument.
 *
 * Postures are read here but sounded by the caller through music/orchestra.js,
 * which keeps geometry free of audio and arrangement knowledge.
 */
export class BodyMapper {
  constructor(scale = 'pentatonic') {
    this.classifier = new PostureClassifier();
    this.scale = 'pentatonic';
    this.setScale(scale);
  }

  setScale(scale) {
    if (!Object.hasOwn(SCALES, scale)) throw new Error('Unknown scale');
    this.scale = scale;
    this.reset();
  }

  /** Keyboard steps arrive with no posture attached, so there is nothing to smooth. */
  resetSmoothing() {
    this.previous = null;
  }

  reset() {
    this.neutral = null;
    this.calibration = null;
    this.calibrated = false;
    this.previous = null;
    this.time = null;
    this.energy = 0;
    this.framing = 'lost';
    this.melodyIndex = null;
    this.rootIndex = null;
    this.lastMelody = null;
    this.lastRoot = null;
    this.lastTrigger = -Infinity;
    this.posture = null;
    this.classifier.reset();
  }

  /** Guidance for the stage overlay, or null while nothing needs saying. */
  hint() {
    if (this.framing === 'step-back') {
      return 'Step back so I can see your feet<br><small>Squats and jumps need your whole body in frame.</small>';
    }
    if (this.framing === 'upper') {
      return 'Upper body only<br><small>Step back for squats and jumps, or keep dancing with your arms.</small>';
    }
    if (!this.calibrated) return 'Stand tall and hold still<br><small>I am learning your neutral pose.</small>';
    return null;
  }

  status() {
    if (this.framing === 'step-back') return 'Step back — feet out of frame';
    if (this.framing === 'upper') return 'Upper body · Playing';
    if (!this.calibrated) return 'Stand tall and hold still…';
    return 'Body tracked · Playing';
  }

  /** @returns null when the frame yields nothing playable, which the caller must
   *  treat exactly like a lost subject. */
  update(landmarks, time) {
    if (!isPose(landmarks) || !Number.isFinite(time)) return null;
    if (this.time !== null && time <= this.time) return null;
    this.framing = framing(landmarks);
    if (this.framing === 'lost') return null;
    if (!this.neutral) return this.calibrate(landmarks, time);

    const features = bodyFeatures(mirrorPose(landmarks), this.neutral);
    if (!features) return null;
    const seconds = this.time === null ? 1 / 20 : Math.max(.001, (time - this.time) / 1000);
    const motion = bodyMotion(features, this.previous, seconds);
    this.energy += (motion.energy - this.energy) * (1 - Math.exp(-seconds / .18));
    features.energy = this.energy;
    this.previous = features;
    this.time = time;

    const notes = SCALES[this.scale].notes;
    const top = notes.length - 1;
    // Arm height is read against the hips, not the screen, so a player standing
    // back to get their whole body in frame does not quietly drop an octave.
    const melodyIndex = clamp(pitchIndex(lane(features.armR), notes.length, this.melodyIndex), 0, top);
    const rootIndex = clamp(pitchIndex(lane(features.armL), notes.length, this.rootIndex), 0, top);
    const melody = notes[top - melodyIndex];
    const root = notes[top - rootIndex];
    // The arrangement builds a triad above the root, so the root never rides over
    // the melody: the lower wrist is the floor and the higher wrist is the tune.
    const midi = Math.min(melody, root);
    const trigger = (melody !== this.lastMelody || root !== this.lastRoot) &&
      time - this.lastTrigger >= ATTACK_GAP;
    if (trigger) {
      this.lastMelody = melody;
      this.lastRoot = root;
      this.lastTrigger = time;
    }
    this.melodyIndex = melodyIndex;
    this.rootIndex = rootIndex;

    const posture = this.classifier.update(features, motion);
    this.posture = posture.id;
    return {
      x: features.wristX,
      y: features.wristY,
      midi,
      index: melodyIndex,
      trigger,
      pan: clamp(features.wristX * 2 - 1, -1, 1),
      velocity: .24 + clamp(motion.speedR / FULL_SPEED) * .66,
      intensity: clamp(this.energy / FULL_SPEED),
      posture: posture.id,
      strength: posture.strength,
      hint: this.hint(),
      status: this.status(),
    };
  }

  /** Averages a standing-still window into the ruler every later feature uses. */
  calibrate(landmarks, time) {
    const pose = neutralPose(landmarks);
    this.calibration ??= { frames: 0, torso: 0, hipY: 0, ankleY: 0, tilt: 0 };
    for (const key of ['torso', 'hipY', 'ankleY', 'tilt']) this.calibration[key] += pose[key];
    this.calibration.frames++;
    this.time = time;
    if (this.calibration.frames < CALIBRATION_FRAMES) return this.resting();
    this.calibrated = true;
    this.neutral = Object.fromEntries(
      ['torso', 'hipY', 'ankleY', 'tilt'].map(key => [key, this.calibration[key] / this.calibration.frames]));
    this.calibration = null;
    return this.resting();
  }

  /** The shaping frame used while calibrating: no note, but the overlay and the
   * posture readout stay live so the player can see the stage is working. */
  resting() {
    return {
      x: .5, y: .5, midi: null, index: null, trigger: false, pan: null,
      velocity: 0, intensity: 0,
      posture: this.posture, strength: 0, hint: this.hint(), status: this.status(),
    };
  }
}
