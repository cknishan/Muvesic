import { J } from '../../dist/tracking/posture.js';

/** Builds a 33-point MediaPipe pose from a few body-shaped knobs.
 *
 * Coordinates are raw and unmirrored, as the tracker contract promises: the
 * player's left side sits at the higher x, because the camera image is not
 * flipped. Arm positions are given in torso lengths, so the same knobs describe
 * the same dance whether the player is close to the camera or standing back.
 */
export function poseFixture({
  torso = .3,
  hipY = .6,
  shoulderY = hipY - torso,
  ankleY = hipY + torso * 1.17,
  reach = -1.3,
  span = 1,
  tilt = 0,
  visibility = 1,
  ankleVisibility = visibility,
  hipVisibility = visibility,
  wristLy,
  wristRy,
  wristLx,
  wristRx,
} = {}) {
  const wristY = shoulderY - reach * torso;
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility }));
  const put = (index, x, y, seen = visibility) => { points[index] = { x, y, visibility: seen }; };

  // Every horizontal span is a fraction of the torso, so a smaller player really is
  // a smaller player and not the same one with longer legs.
  const left = { x: .5 + torso / 6, y: shoulderY - tilt * torso * .5 };
  const right = { x: .5 - torso / 6, y: shoulderY + tilt * torso * .5 };
  const hipLeft = { x: .5 + torso / 7.5, y: hipY };
  const hipRight = { x: .5 - torso / 7.5, y: hipY };
  const armL = { x: wristLx ?? .5 + span * torso / 2, y: wristLy ?? wristY };
  const armR = { x: wristRx ?? .5 - span * torso / 2, y: wristRy ?? wristY };

  put(J.shoulderL, left.x, left.y);
  put(J.shoulderR, right.x, right.y);
  put(J.hipL, hipLeft.x, hipLeft.y, hipVisibility);
  put(J.hipR, hipRight.x, hipRight.y, hipVisibility);
  put(J.ankleL, .52, ankleY, ankleVisibility);
  put(J.ankleR, .48, ankleY, ankleVisibility);
  put(J.kneeL, .51, (hipY + ankleY) / 2, ankleVisibility);
  put(J.kneeR, .49, (hipY + ankleY) / 2, ankleVisibility);
  put(J.wristL, armL.x, armL.y);
  put(J.wristR, armR.x, armR.y);
  put(J.elbowL, (left.x + armL.x) / 2 + .02, (left.y + armL.y) / 2);
  put(J.elbowR, (right.x + armR.x) / 2 - .02, (right.y + armR.y) / 2);
  return points;
}

/** The player, standing still with arms down. Calibrates against these values. */
export const STANDING = { reach: -1.3, span: 1 };

/** Runs a mapper over a list of pose fixtures at a steady 20 Hz. */
export function runFrames(mapper, frames, startTime = 0, step = 50) {
  return frames.map((options, index) => mapper.update(
    typeof options === 'function' ? options(index) : poseFixture(options),
    startTime + index * step));
}

/** Enough still frames to clear the mapper's auto-calibration window. */
export const CALIBRATION = 24;
