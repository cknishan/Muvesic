import { abortError } from '../shared/deadline.js';
import { VISION_URL, WASM_URL, MODEL_URL } from './config.js';
import { CameraSource, HAND_CONSTRAINT } from './camera-source.js';

const LABELS = {
  permission: 'Waiting for camera permission…',
  permissionPending: 'Camera permission is still pending. Allow camera access and try again.',
  playFailed: 'The camera did not start. Close other camera apps and try again.',
  loading: 'Loading hand tracking…',
  modelFailed: 'Hand tracking could not load. Check your internet connection and try again, or use mouse mode.',
  disconnected: 'The camera disconnected. Reconnect it and start again.',
  stopped: 'Hand tracking stopped. Please restart the camera.',
};

/** Wraps HandLandmarker in the detector contract the camera source expects. */
async function createDetector(signal) {
  const { FilesetResolver, HandLandmarker } = await import(VISION_URL);
  if (signal.aborted) throw abortError();
  const files = await FilesetResolver.forVisionTasks(WASM_URL);
  if (signal.aborted) throw abortError();
  const landmarker = await HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: .65,
    minHandPresenceConfidence: .65,
    minTrackingConfidence: .65,
  });
  return {
    detect: (video, milliseconds) => landmarker.detectForVideo(video, milliseconds).landmarks || [],
    close: () => landmarker.close(),
  };
}

/** Owns one camera stream, model and inference loop. Create anew per session.
 * onFrame receives an array of unmirrored hands (or an empty array) and
 * milliseconds; the index fingertip is landmark 8 of each hand.
 */
export class HandTracker {
  constructor(video, onFrame, onError) {
    this.video = video;
    this.onFrame = onFrame;
    this.onError = onError;
    this.abort = new AbortController();
    this.source = new CameraSource(video, { frameInterval: 30, missing: [], labels: LABELS });
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
