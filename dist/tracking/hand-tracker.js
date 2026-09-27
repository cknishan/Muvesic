import { abortError, withDeadline } from '../shared/deadline.js';
import { VISION_URL, WASM_URL, MODEL_URL } from './config.js';

const closeStream = stream => stream.getTracks().forEach(track => track.stop());

async function loadModel(signal) {
  const { FilesetResolver, HandLandmarker } = await import(VISION_URL);
  if (signal.aborted) throw abortError();
  const files = await FilesetResolver.forVisionTasks(WASM_URL);
  if (signal.aborted) throw abortError();
  return HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: .65,
    minHandPresenceConfidence: .65,
    minTrackingConfidence: .65,
  });
}

/** Owns one camera stream, model and inference loop. Create anew per session.
 * onFrame receives unmirrored landmarks (or null) and milliseconds.
 */
export class HandTracker {
  constructor(video, onFrame, onError) {
    this.video = video;
    this.onFrame = onFrame;
    this.onError = onError;
    this.abort = new AbortController();
    this.frame = 0;
  }

  async start(onStatus) {
    const signal = this.abort.signal;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access needs HTTPS or localhost. Open the secure site, or try mouse mode.');
    }
    try {
      onStatus('Waiting for camera permission…');
      this.stream = await withDeadline(navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user', width: { ideal: 960 }, height: { ideal: 600 },
          frameRate: { ideal: 30, max: 30 },
        },
      }), signal, 45000,
      'Camera permission is still pending. Allow camera access and try again.', closeStream);
      this.video.srcObject = this.stream;
      for (const track of this.stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (!signal.aborted) {
            this.onError(new Error('The camera disconnected. Reconnect it and start again.'));
          }
        }, { signal });
      }
      await withDeadline(this.video.play(), signal, 12000,
        'The camera did not start. Close other camera apps and try again.');
      onStatus('Loading hand tracking…');
      this.model = await withDeadline(loadModel(signal), signal, 60000,
        'Hand tracking could not load. Check your internet connection and try again, or use mouse mode.',
        model => model.close());
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

  startFrameLoop() {
    const signal = this.abort.signal;
    let lastTime = -1;
    let lastInference = -Infinity;
    let lastFresh = performance.now();
    const loop = now => {
      if (signal.aborted) return;
      try {
        if (this.video.readyState >= 2 && this.video.currentTime !== lastTime && now - lastInference >= 30) {
          lastTime = this.video.currentTime;
          lastInference = now;
          lastFresh = now;
          const result = this.model.detectForVideo(this.video, now);
          this.onFrame(result.landmarks[0] || null, now);
        } else if (now - lastFresh > 300) {
          this.onFrame(null, now);
        }
        this.frame = requestAnimationFrame(loop);
      } catch (error) {
        this.onError(new Error('Hand tracking stopped. Please restart the camera.', { cause: error }));
      }
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop() {
    this.abort.abort();
    cancelAnimationFrame(this.frame);
    if (this.stream) closeStream(this.stream);
    this.model?.close();
    this.model = null;
    if (this.video.srcObject === this.stream) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }
}
