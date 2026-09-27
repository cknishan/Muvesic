import { withDeadline } from '../shared/deadline.js';

const closeStream = stream => { for (const track of stream.getTracks()) track.stop(); };

/** Hands are read at a close working distance; a standing body needs more pixels. */
export const HAND_CONSTRAINT = Object.freeze({
  facingMode: 'user', width: { ideal: 960 }, height: { ideal: 600 },
  frameRate: { ideal: 30, max: 30 },
});
export const BODY_CONSTRAINT = Object.freeze({
  facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
});

/** Owns one camera stream, video playback and the inference cadence.
 *
 * A tracker supplies createDetector(signal), which must resolve to something with
 * detect(video, milliseconds) and close(). Hardware and scheduling therefore live
 * here once, and hand versus body differ only in the detector, the cadence and the
 * player-facing labels. onFrame receives whatever the detector returns — a body
 * landmark array or a hand array, or `missing` when nothing is visible.
 *
 * Cancellation cannot cancel a browser promise, so a stream or model arriving
 * after Stop or a timeout is disposed by withDeadline and then stop() releases
 * the detector that did make it through.
 */
export class CameraSource {
  constructor(video, { frameInterval = 30, stale = 300, missing = null, constraint = HAND_CONSTRAINT, labels = {} } = {}) {
    this.video = video;
    this.frameInterval = frameInterval;
    this.stale = stale;
    this.missing = missing;
    this.constraint = constraint;
    this.labels = labels;
    this.stream = null;
    this.detector = null;
    this.frame = 0;
  }

  label(key, fallback) {
    return this.labels[key] ?? fallback;
  }

  async start(signal, { createDetector, onFrame, onError, onStatus }) {
    this.onFrame = onFrame;
    this.onError = onError;
    this.signal = signal;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access needs HTTPS or localhost. Open the secure site, or try mouse mode.');
    }
    try {
      onStatus(this.label('permission', 'Waiting for camera permission…'));
      this.stream = await withDeadline(
        navigator.mediaDevices.getUserMedia({ audio: false, video: this.constraint }), signal, 45000,
        this.label('permissionPending', 'Camera permission is still pending. Allow camera access and try again.'),
        closeStream);
      this.video.srcObject = this.stream;
      for (const track of this.stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (!signal.aborted) {
            this.onError(new Error(this.label('disconnected', 'The camera disconnected. Reconnect it and start again.')));
          }
        }, { signal });
      }
      await withDeadline(this.video.play(), signal, 12000,
        this.label('playFailed', 'The camera did not start. Close other camera apps and try again.'));
      onStatus(this.label('loading', 'Loading tracking…'));
      this.detector = await withDeadline(createDetector(signal), signal, 60000,
        this.label('modelFailed', 'Tracking could not load. Check your internet connection and try again.'),
        detector => detector.close());
      if (signal.aborted) {
        this.stop();
        return;
      }
      this.startFrameLoop();
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  /** One inference per new video frame, rate capped. Silence is reported once per
   * stale window rather than on every animation frame, so a lost subject cannot
   * flood the view with 60 rewrites a second. */
  startFrameLoop() {
    const signal = this.signal;
    let lastTime = -1;
    let lastInference = -Infinity;
    let lastFresh = performance.now();
    let lastMissing = -Infinity;
    const loop = now => {
      if (signal.aborted) return;
      const due = this.video.readyState >= 2 && this.video.currentTime !== lastTime &&
        now - lastInference >= this.frameInterval;
      const lost = !due && now - lastFresh > this.stale && now - lastMissing >= this.stale;
      let landmarks = this.missing;
      if (due) {
        lastTime = this.video.currentTime;
        lastInference = now;
        lastFresh = now;
        try {
          landmarks = this.detector.detect(this.video, now);
        } catch (error) {
          this.onError(new Error(this.label('stopped', 'Tracking stopped. Please restart the camera.'), { cause: error }));
          return;
        }
      } else if (lost) {
        lastMissing = now;
      }
      // Delivery stays outside the try: a presentation fault must not stop tracking.
      if (due || lost) this.onFrame(landmarks, now);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop() {
    const stream = this.stream;
    this.stream = null;
    this.detector?.close();
    this.detector = null;
    cancelAnimationFrame(this.frame);
    if (stream) closeStream(stream);
    if (this.video.srcObject === stream) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }
}
