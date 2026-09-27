/** Translate camera/runtime failures into recoverable player-facing messages. */
export function cameraError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Camera access was denied. Allow camera access in your browser’s site settings, then try again. You can also play with the mouse.';
  if (error.name === 'NotFoundError') return 'No camera was found. Connect a webcam or try mouse mode.';
  if (error.name === 'NotReadableError') return 'The camera is busy or unavailable. Close other camera apps, then try again.';
  if (error.name === 'OverconstrainedError') return 'This camera cannot use the requested video settings. Try another webcam or mouse mode.';
  if (error instanceof TypeError) return 'Hand tracking could not load. Check your connection and allow downloads from jsDelivr and Google, or try mouse mode.';
  return error.message || 'Something went wrong. Stop and try again.';
}
