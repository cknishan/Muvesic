const VERSION = '0.10.22-rc.20250304';
export const VISION_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
export const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
export const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function abortError() { return new DOMException('Session stopped', 'AbortError'); }
export function withDeadline(promise, signal, milliseconds, label, dispose = () => {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
    const fail = error => { if (!done) { done = true; cleanup(); reject(error); } };
    const aborted = () => fail(abortError());
    const timer = setTimeout(() => fail(new Error(label)), milliseconds);
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(value => {
      if (done) { dispose(value); return; }
      done = true; cleanup(); resolve(value);
    }, fail);
    if (signal.aborted) aborted();
  });
}
const closeStream = stream => stream.getTracks().forEach(track => track.stop());
export class HandTracker {
  constructor(video, onFrame, onError) { this.video = video; this.onFrame = onFrame; this.onError = onError; this.abort = new AbortController(); this.frame = 0; }
  async start(onStatus) {
    const signal = this.abort.signal;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost. Open the secure site, or try mouse mode.');
    try {
      onStatus('Waiting for camera permission…');
      this.stream = await withDeadline(navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 600 }, frameRate: { ideal: 30, max: 30 } } }), signal, 45000, 'Camera permission is still pending. Allow camera access and try again.', closeStream);
      this.video.srcObject = this.stream;
      for (const track of this.stream.getVideoTracks()) track.addEventListener('ended', () => { if (!signal.aborted) this.onError(new Error('The camera disconnected. Reconnect it and start again.')); }, { signal });
      await withDeadline(this.video.play(), signal, 12000, 'The camera did not start. Close other camera apps and try again.');
      onStatus('Loading hand tracking…');
      const loading = (async () => {
        const { FilesetResolver, HandLandmarker } = await import(VISION_URL);
        if (signal.aborted) throw abortError();
        const files = await FilesetResolver.forVisionTasks(WASM_URL);
        if (signal.aborted) throw abortError();
        return HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: .65, minHandPresenceConfidence: .65, minTrackingConfidence: .65 });
      })();
      this.model = await withDeadline(loading, signal, 60000, 'Hand tracking could not load. Check your internet connection and try again, or use mouse mode.', model => model.close());
      if (signal.aborted) { this.stop(); return; }
      let lastTime = -1, lastInference = -Infinity, lastFresh = performance.now();
      const loop = now => {
        if (signal.aborted) return;
        try {
          if (this.video.readyState >= 2 && this.video.currentTime !== lastTime && now - lastInference >= 30) {
            lastTime = this.video.currentTime; lastInference = now; lastFresh = now;
            const result = this.model.detectForVideo(this.video, now);
            this.onFrame(result.landmarks[0] || null, now);
          } else if (now - lastFresh > 300) this.onFrame(null, now);
          this.frame = requestAnimationFrame(loop);
        } catch (error) { this.onError(new Error('Hand tracking stopped. Please restart the camera.', { cause: error })); }
      };
      this.frame = requestAnimationFrame(loop);
    } catch (error) { this.stop(); throw error; }
  }
  stop() {
    this.abort.abort(); cancelAnimationFrame(this.frame);
    if (this.stream) closeStream(this.stream);
    this.model?.close(); this.model = null;
    if (this.video.srcObject === this.stream) { this.video.pause(); this.video.srcObject = null; }
  }
}
export function cameraError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Camera access was denied. Allow camera access in your browser’s site settings, then try again. You can also play with the mouse.';
  if (error.name === 'NotFoundError') return 'No camera was found. Connect a webcam or try mouse mode.';
  if (error.name === 'NotReadableError') return 'The camera is busy or unavailable. Close other camera apps, then try again.';
  if (error.name === 'OverconstrainedError') return 'This camera cannot use the requested video settings. Try another webcam or mouse mode.';
  if (error instanceof TypeError) return 'Hand tracking could not load. Check your connection and allow downloads from jsDelivr and Google, or try mouse mode.';
  return error.message || 'Something went wrong. Stop and try again.';
}
