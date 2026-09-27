import { clamp } from '../shared/math.js';

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** Owns pointer capture, keyboard position and the mouse-mode animation loop.
 * onPoint receives normalized screen coordinates and monotonic milliseconds.
 * dispose removes listeners; stop cancels only the current session's loop.
 */
export function createPointerKeyboardInput(stage, {
  isEnabled, getLaneCount, onPoint, onLost, onPitchStep,
}) {
  let point = { x: .5, y: .5 };
  let pointerId = null;
  let active = false;
  let frame = 0;
  const lifecycle = new AbortController();
  const listen = (name, handler) => stage.addEventListener(name, handler, {
    signal: lifecycle.signal,
  });

  function pointer(event) {
    if (!isEnabled() || (event.pointerType === 'touch' && pointerId !== event.pointerId)) return;
    const rect = stage.getBoundingClientRect();
    point = {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
    active = true;
  }

  function lose() {
    active = false;
    onLost();
  }

  listen('pointermove', pointer);
  listen('pointerdown', event => {
    if (!isEnabled()) return;
    pointerId = event.pointerId;
    stage.setPointerCapture(pointerId);
    stage.focus({ preventScroll: true });
    pointer(event);
  });
  listen('pointerleave', () => {
    if (isEnabled() && pointerId === null) lose();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    listen(name, () => {
      if (!isEnabled()) return;
      pointerId = null;
      lose();
    });
  }
  listen('keydown', event => {
    if (!isEnabled() || !ARROWS.includes(event.key)) return;
    event.preventDefault();
    const count = getLaneCount();
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      const lane = clamp(Math.floor(point.y * count) + direction, 0, count - 1);
      point.y = (lane + .5) / count;
      onPitchStep();
    } else {
      point.x = clamp(point.x + (event.key === 'ArrowLeft' ? -.1 : .1));
    }
    active = true;
  });

  function stop() {
    cancelAnimationFrame(frame);
    active = false;
    const captured = pointerId;
    pointerId = null;
    if (captured !== null && stage.hasPointerCapture(captured)) {
      stage.releasePointerCapture(captured);
    }
  }

  function start() {
    stop();
    let lastFrame = -Infinity;
    const tick = time => {
      if (!isEnabled()) return;
      if (active && time - lastFrame >= 30) {
        onPoint(point.x, point.y, time);
        lastFrame = time;
      }
      if (isEnabled()) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  return { start, stop, dispose: () => { stop(); lifecycle.abort(); } };
}
