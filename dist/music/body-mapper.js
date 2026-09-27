import { clamp } from '../shared/math.js';
import { bodyFeatures, bodyMotion, framing, isPose, mirrorPose, neutralPose } from '../tracking/posture.js';
import { PostureClassifier } from '../tracking/classifier.js';

/** A standing-still window at ~20 Hz, long enough to average out tracker noise. */
const CALIBRATION_FRAMES = 24;
/** Per-limb pose heights in torso lengths above the hip that map to the lane ladder.
 *  Arms hang at -1.3 torso and reach overhead at +1, so the arms ladder spans
 *  about 2.3 torso lengths. Legs fold to roughly hip height and rise to about hip
 *  height on a high knee, so the legs ladder spans roughly 1.5 torso lengths. */
const ARM_LOW = -1.3;
const ARM_HIGH = 1;
const LEG_LOW = -1.2;
const LEG_HIGH = .3;
/** Visibility threshold for a limb's anchor and reach. Below it the limb goes
 *  silent rather than guessing wildly where the joint is. */
const LIMB_VISIBLE = .55;

/** Owns body-level state — calibration, framing, posture classification — and
 *  produces per-limb screen positions for the session to dispatch through the
 *  ordinary MotionMapper pipeline. Each limb's mapper still owns its own scale,
 *  smoothing and retrigger gate, because those are musical and per-channel.
 *
 *  Pitch is read against the player's own calibrated torso, so the four lanes
 *  read the same whether the player is close to the camera or standing back.
 *  Postures modulate the four voices together rather than adding notes; the
 *  session applies them after the per-limb mapping.
 */
export class BodyMapper {
  constructor() {
    this.classifier = new PostureClassifier();
    this.reset();
  }

  reset() {
    this.neutral = null;
    this.calibration = null;
    this.calibrated = false;
    this.previous = null;
    this.time = null;
    this.energy = 0;
    this.framing = 'lost';
    this.posture = null;
    this.strength = 0;
    this.classifier.reset();
  }

  /** Guidance for the stage overlay, or null while nothing needs saying. */
  hint() {
    if (this.framing === 'step-back') {
      return 'Step back so I can see your feet<br><small>Each leg is its own voice.</small>';
    }
    if (this.framing === 'upper') {
      return 'Upper body only<br><small>Step back to bring your legs in, or keep dancing with your arms.</small>';
    }
    if (!this.calibrated) return 'Stand tall and hold still<br><small>I am learning your neutral pose.</small>';
    return null;
  }

  status() {
    if (this.framing === 'step-back') return 'Step back — feet out of frame';
    if (this.framing === 'upper') return 'Upper body · Arms only';
    if (!this.calibrated) return 'Stand tall and hold still…';
    return 'Body tracked · Four voices playing';
  }

  /** @returns null when the frame yields nothing playable. The caller treats this
   *  exactly like a lost subject. Otherwise returns an object with per-limb data:
   *  `limbs: [{ channel, x, y, visible }, ...]`, the settled `posture`, and the
   *  hint/status strings. */
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

    const limbs = [
      this.limb('left', landmarks, features, 11, 15, ARM_LOW, ARM_HIGH),
      this.limb('right', landmarks, features, 12, 16, ARM_LOW, ARM_HIGH),
      this.limb('lowerLeft', landmarks, features, 23, 27, LEG_LOW, LEG_HIGH),
      this.limb('lowerRight', landmarks, features, 24, 28, LEG_LOW, LEG_HIGH),
    ];

    const posture = this.classifier.update(features, motion);
    this.posture = posture.id;
    this.strength = posture.strength;
    return { limbs, posture: posture.id, strength: posture.strength,
      hint: this.hint(), status: this.status() };
  }

  /** One limb's screen position: mirrored x so left is left, lane y so the
   *  MotionMapper's pitch ladder reads top=high, and a visibility flag the
   *  caller uses to release a missing limb rather than play a guess. */
  limb(channel, landmarks, features, shoulder, wrist, low, high) {
    const anchor = landmarks[shoulder];
    const reach = landmarks[wrist];
    const visible = Math.min(anchor?.visibility ?? 0, reach?.visibility ?? 0) >= LIMB_VISIBLE;
    // Arms-down reads as the bottom of the ladder; raised arms read as the top.
    // The flip matters because the pitch ladder is top=high pitch.
    const span = high - low;
    const rise = (anchor.y - reach.y) / features.torso;
    const lane = clamp(1 - (rise - low) / span);
    return { channel, x: clamp(1 - reach.x), y: lane, visible };
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

  /** A calibration frame: no per-limb data yet, but the overlay and posture
   *  readout stay live so the player can see the stage is working. */
  resting() {
    return { limbs: [], posture: this.posture, strength: 0,
      hint: this.hint(), status: this.status() };
  }
}
