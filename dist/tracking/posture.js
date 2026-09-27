import { clamp } from '../shared/math.js';

/** MediaPipe pose landmark indices body mode reads. */
export const J = Object.freeze({
  shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16,
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28,
});

/** Bones worth drawing: shoulders, arms, torso, hips, legs. */
export const BODY_BONES = Object.freeze([
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
]);

/** Joints whose travel becomes movement energy. */
const MOVING = ['elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'];
const REQUIRED = ['shoulderL', 'shoulderR', 'wristL', 'wristR', 'hipL', 'hipR'];
/** Below this a landmark is treated as occluded rather than as a real position. */
const VISIBLE = .4;

/** Mirror x exactly once, matching the displayed video and the mouse coordinate
 * space. Mirrored landmarks drive music only; the canvas still draws raw ones. */
export function mirrorPose(landmarks) {
  return landmarks.map(point => ({ x: 1 - point.x, y: point.y, visibility: point.visibility }));
}

export function isPose(landmarks) {
  return Array.isArray(landmarks) && landmarks.length > J.ankleR &&
    REQUIRED.every(key => Number.isFinite(landmarks[J[key]]?.x) && Number.isFinite(landmarks[J[key]]?.y));
}

const at = (landmarks, key) => ({ x: landmarks[J[key]].x, y: landmarks[J[key]].y });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const tiltOf = landmarks => Math.atan2(
  landmarks[J.shoulderR].y - landmarks[J.shoulderL].y,
  landmarks[J.shoulderR].x - landmarks[J.shoulderL].x);

/** A neutral standing pose measured in raw landmark units.
 *
 * Nothing here is normalized: this is the ruler the player's own body defines.
 * Every distance that follows is divided by it, so one player a metre from the
 * camera and another four metres away read the same for the same movement.
 */
export function neutralPose(landmarks) {
  if (!isPose(landmarks)) return null;
  const shoulder = mid(at(landmarks, 'shoulderL'), at(landmarks, 'shoulderR'));
  const hip = mid(at(landmarks, 'hipL'), at(landmarks, 'hipR'));
  return {
    torso: Math.max(span(shoulder, hip), 1e-4),
    hipY: hip.y,
    ankleY: (landmarks[J.ankleL].y + landmarks[J.ankleR].y) / 2,
    tilt: tiltOf(landmarks),
  };
}

/** How much of the body the camera can see, which decides the available kit.
 * Feet below the bottom edge read as step-back rather than as a full body, so
 * the overlay can ask for more room instead of silently dropping squats.
 */
export function framing(landmarks) {
  if (!isPose(landmarks)) return 'lost';
  const hips = Math.min(landmarks[J.hipL].visibility ?? 1, landmarks[J.hipR].visibility ?? 1);
  if (hips < VISIBLE) return 'lost';
  const feet = Math.min(landmarks[J.ankleL].visibility ?? 1, landmarks[J.ankleR].visibility ?? 1);
  const lowest = Math.max(landmarks[J.ankleL].y, landmarks[J.ankleR].y);
  // With the feet hidden the ankle position is only a guess, so it is read
  // conservatively: near the bottom edge means cropped, anywhere else means the
  // player is simply working above the waist.
  if (feet < VISIBLE) return lowest > .97 ? 'step-back' : 'upper';
  return lowest > 1.05 ? 'step-back' : 'full';
}

/** Instantaneous, scale-invariant posture descriptors.
 *
 * armL and armR are each wrist's height above the hips, measured in torso lengths,
 * and are what the pitch ladder reads. They are body-relative on purpose: a player
 * who steps back to fit their feet in frame, or who moves nearer to a low desk,
 * keeps the same note for the same movement. reach and spread are positive when
 * raised or wide; crouch is positive when the hips drop below the neutral pose;
 * ankleLift is positive when the feet rise above it. lean is the shoulder line's
 * tilt away from neutral, clamped to -1..1 and positive towards the player's right
 * on screen. twist falls below 1 as the torso turns away from the camera.
 */
export function bodyFeatures(landmarks, neutral) {
  if (!isPose(landmarks) || !neutral) return null;
  const { torso } = neutral;
  const shoulder = mid(at(landmarks, 'shoulderL'), at(landmarks, 'shoulderR'));
  const hip = mid(at(landmarks, 'hipL'), at(landmarks, 'hipR'));
  const wristL = at(landmarks, 'wristL');
  const wristR = at(landmarks, 'wristR');
  const feet = Math.min(landmarks[J.ankleL].visibility ?? 1, landmarks[J.ankleR].visibility ?? 1);
  return {
    torso,
    keypoints: Object.fromEntries(MOVING.map(key => [key, at(landmarks, key)])),
    x: hip.x,
    y: hip.y,
    // Pan and the drawn cursor stay in screen space, where left really is left.
    wristX: wristR.x,
    wristY: wristR.y,
    armL: (hip.y - wristL.y) / torso,
    armR: (hip.y - wristR.y) / torso,
    reachL: (shoulder.y - wristL.y) / torso,
    reachR: (shoulder.y - wristR.y) / torso,
    spread: span(wristL, wristR) / torso,
    crouch: (hip.y - neutral.hipY) / torso,
    ankleLift: (neutral.ankleY - (landmarks[J.ankleL].y + landmarks[J.ankleR].y) / 2) / torso,
    lean: clamp((tiltOf(landmarks) - neutral.tilt) / .5, -1, 1),
    twist: span(at(landmarks, 'shoulderL'), at(landmarks, 'shoulderR')) /
      Math.max(span(at(landmarks, 'hipL'), at(landmarks, 'hipR')), 1e-4),
    feetVisible: feet >= VISIBLE,
    energy: 0,
  };
}

/** Velocities from two consecutive feature sets, in torso lengths per second so
 * they mean the same at any distance. Rising hips with lifted feet read as a jump. */
export function bodyMotion(current, previous, seconds) {
  if (!current || !previous || !(seconds > 0)) {
    return { energy: 0, speedL: 0, speedR: 0, airborne: false };
  }
  const travel = key => span(current.keypoints[key], previous.keypoints[key]) / (current.torso * seconds);
  let total = 0;
  for (const key of MOVING) total += travel(key);
  return {
    energy: total / MOVING.length,
    speedL: travel('wristL'),
    speedR: travel('wristR'),
    airborne: current.feetVisible && current.ankleLift > .1 &&
      current.y < previous.y && current.ankleLift > previous.ankleLift + .02,
  };
}
