/** Pinned runtime and model assets, fetched only when camera mode starts. */
const VERSION = '0.10.22-rc.20250304';
export const VISION_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
export const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
export const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
// Body mode loads from the same tasks-vision bundle, so this asset is the only
// addition. The lite graph is the variant that stays honest on CPU inference.
export const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
