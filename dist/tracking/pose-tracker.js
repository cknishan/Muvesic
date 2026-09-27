import { abortError } from '../shared/deadline.js';
import { VISION_URL, WASM_URL, POSE_MODEL_URL } from './config.js';
import { CameraSource, BODY_CONSTRAINT } from './camera-source.js';

const LABELS = {
  permission: 'Waiting for camera permission…',
  permissionPending: 'Camera permission is still pending. Allow camera access and try again.',
  playFailed: 'The camera did not start. Close other camera apps and try again.',
  loading: 'Loading body tracking…',
  modelFailed: 'Body tracking could not load. Check your internet connection and try again, or play with your hands.',
  disconnected: 'The camera disconnected. Reconnect it and start again.',
  stopped: 'Body tracking stopped. Please restart the camera.',
};

/** Wraps PoseLandmarker in the detector contract the camera source expects.
 * Confidence sits below hand mode on purpose: a partly occluded body should keep
 * tracking, and per-landmark visibility (read by tracking/posture.js) judges
 * reliability far better than one global floor.
 */
async function createDetector(signal) {
  const { FilesetResolver, PoseLandmarker } = await import(VISION_URL);
  if (signal.aborted) throw abortError();
  const files = await FilesetResolver.forVisionTasks(WASM_URL);
  if (signal.aborted) throw abortError();
  const landmarker = await PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: .5,
    minPosePresenceConfidence: .5,
    minTrackingConfidence: .5,
    outputSegmentationMasks: false,
  });
  return {
    detect: (video, milliseconds) => landmarker.detectForVideo(video, milliseconds).landmarks[0] || null,
    close: () => landmarker.close(),
  };
}

/** Owns one camera stream, pose model and inference loop. Create anew per
 * session. onFrame receives 33 unmirrored landmarks for one person (or null) and
 * milliseconds.
 *
 * Inference is capped near 20 Hz rather than 30: pose costs more CPU than two
 * hands, and body mapping is a sustained groove rather than a run of single
 * notes, so the cadence is spent where the player can feel it.
 */
export class PoseTracker {
  constructor(video, onFrame, onError) {
    this.video = video;
    this.onFrame = onFrame;
    this.onError = onError;
    this.abort = new AbortController();
    this.source = new CameraSource(video, { frameInterval: 50, constraint: BODY_CONSTRAINT, labels: LABELS });
  }

  async start(onStatus) {
    return this.source.start(this.abort.signal, {
      createDetector, onFrame: this.onFrame, onError: this.onError, onStatus,
    });
  }

  stop() {
    this.abort.abort();
    this.source.stop();
  }
}
