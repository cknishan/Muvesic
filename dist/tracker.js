// Public compatibility exports. Camera implementation lives in tracking/.
export { HandTracker } from './tracking/hand-tracker.js';
export { cameraError } from './tracking/errors.js';
export { withDeadline } from './shared/deadline.js';
export { VISION_URL, WASM_URL, MODEL_URL } from './tracking/config.js';
