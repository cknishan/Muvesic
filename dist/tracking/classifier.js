import { clamp } from '../shared/math.js';

/** Candidate postures in priority order.
 *
 * `value` reduces a frame to one scalar that only grows as the movement becomes
 * more pronounced, so a single threshold divided by the sensitivity setting
 * decides membership. `engage` is how many consecutive frames a posture must
 * hold before it takes effect, `release` how many frames it must be absent
 * first. Asymmetric counts stop flicker without adding lag to a real change.
 */
const RULES = [
  { id: 'jump', engage: 1, release: 5, threshold: 1, value: motion => (motion?.airborne ? 1 : 0) },
  { id: 'arms_up', engage: 2, release: 6, threshold: .5, value: f => Math.min(f.reachL, f.reachR) },
  { id: 'squat', engage: 2, release: 6, threshold: .18, value: f => f.crouch },
  { id: 'twist', engage: 3, release: 8, threshold: .3, value: f => 1 - f.twist },
  { id: 'lean', engage: 3, release: 8, threshold: .5, value: f => Math.abs(f.lean) },
  { id: 'wide', engage: 2, release: 6, threshold: 1.3, value: f => f.spread },
  { id: 'still', engage: 6, release: 6, threshold: .4, value: f => 1 - f.energy },
];

export const POSTURE_LABELS = Object.freeze({
  jump: 'Jump', arms_up: 'Arms up', squat: 'Squat', twist: 'Twist',
  lean: 'Lean', wide: 'Wide', still: 'Holding still', moving: 'Moving',
});

/** The settled posture, or null while the body is simply moving. */
export const NEUTRAL_POSTURE = null;

/** Reads posture descriptors and reports a settled posture with a 0..1 strength
 * plus whether it just changed. It gates and colours notes that movement already
 * justified; it must never invent a note on its own, which is the tracking-loss
 * rule the whole instrument is built on.
 */
export class PostureClassifier {
  constructor(sensitivity = 1) {
    this.sensitivity = 1;
    this.setSensitivity(sensitivity);
    this.reset();
  }

  setSensitivity(value) {
    this.sensitivity = Number.isFinite(value) && value > 0 ? clamp(value, .6, 1.4) : 1;
  }

  reset() {
    this.current = NEUTRAL_POSTURE;
    this.candidate = NEUTRAL_POSTURE;
    this.release = 0;
    this.held = 0;
    this.gone = 0;
    this.strength = 0;
  }

  update(features, motion) {
    if (!features) {
      this.held = 0;
      return this.emit(false);
    }
    const rule = RULES.find(candidate => candidate.value(features, motion) >= candidate.threshold / this.sensitivity);
    const id = rule?.id ?? NEUTRAL_POSTURE;
    if (id === this.candidate) this.held++;
    else { this.candidate = id; this.held = 1; }

    // Nothing is held yet, so the first posture to complete its engage window wins.
    if (this.current === NEUTRAL_POSTURE) {
      if (rule && this.held >= rule.engage) return this.commit(rule, features, motion);
      return this.emit(false);
    }
    if (id === this.current) {
      this.gone = 0;
      this.strength = this.measure(rule, features, motion);
      return this.emit(false);
    }
    if (rule) return this.held >= rule.engage ? this.commit(rule, features, motion) : this.emit(false);
    this.gone++;
    if (this.gone >= this.release) {
      this.current = NEUTRAL_POSTURE;
      this.gone = 0;
      this.strength = 0;
      return this.emit(true);
    }
    return this.emit(false);
  }

  commit(rule, features, motion) {
    this.current = rule.id;
    this.release = rule.release;
    this.held = 0;
    this.strength = this.measure(rule, features, motion);
    return this.emit(true);
  }

  /** How far past its own threshold the pose is, folded into 0..1. */
  measure(rule, features, motion) {
    return (rule.value(features, motion) / rule.threshold - 1) / 2;
  }

  emit(changed) {
    return { id: this.current, strength: clamp(this.strength, 0, 1), changed };
  }
}
