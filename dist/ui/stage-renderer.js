import { BODY_BONES, J } from '../tracking/posture.js';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
  [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
/** Only the joints the body mapper reads, so the overlay stays legible instead of
 * speckling the stage with 33 unlabelled points. */
const BODY_JOINTS = Object.values(J);
const HAND_JOINTS = CONNECTIONS.flat();

/** Owns canvas drawing and trajectory history; never controls audio or tracking.
 * Landmarks arrive unmirrored and are mirrored here, so the skeleton lines up with
 * the CSS-mirrored video.
 */
export function createStageRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const colors = {
    left: { line: '#c6f36b88', point: '#d9ff95', glow: '#c6f36b26' },
    right: { line: '#7cc7ff88', point: '#a8dcff', glow: '#7cc7ff26' },
    ensemble: { line: '#edc78388', point: '#f3dcae', glow: '#edc78326' },
    body: { line: '#f79ad488', point: '#fdc4d8', glow: '#f79ad426' },
  };
  const visuals = new Map();
  const trails = new Map();

  function drawSkeleton(landmarks, bones, joints, width, height, color) {
    ctx.strokeStyle = color.line;
    ctx.lineWidth = 2;
    for (const [a, b] of bones) {
      if (!landmarks[a] || !landmarks[b]) continue;
      ctx.beginPath();
      ctx.moveTo((1 - landmarks[a].x) * width, landmarks[a].y * height);
      ctx.lineTo((1 - landmarks[b].x) * width, landmarks[b].y * height);
      ctx.stroke();
    }
    for (const index of joints) {
      const landmark = landmarks[index];
      if (!Number.isFinite(landmark?.x)) continue;
      ctx.beginPath();
      ctx.arc((1 - landmark.x) * width, landmark.y * height, 3, 0, Math.PI * 2);
      ctx.fillStyle = color.point;
      ctx.fill();
    }
  }

  function drawTrail(trail, width, height, color) {
    for (let i = 1; i < trail.length; i++) {
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x * width, trail[i - 1].y * height);
      ctx.lineTo(trail[i].x * width, trail[i].y * height);
      ctx.strokeStyle = color.line.replace('88', Math.round((i / trail.length) * 130).toString(16).padStart(2, '0'));
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  function drawVisual({ channel, landmarks, point, time }, width, height) {
    const color = colors[channel] || colors.right;
    if (landmarks) {
      const body = channel === 'body';
      drawSkeleton(landmarks, body ? BODY_BONES : CONNECTIONS,
        body ? BODY_JOINTS : HAND_JOINTS, width, height, color);
    }
    drawTrail(trails.get(channel) || [], width, height, color);
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, 17, 0, Math.PI * 2);
    ctx.fillStyle = color.glow;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, 6, 0, Math.PI * 2);
    ctx.fillStyle = color.point;
    ctx.fill();
  }

  function redrawAll() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const visual of visuals.values()) drawVisual(visual, width, height);
  }

  function paint(channel, landmarks, point, time) {
    const trail = (trails.get(channel) || []).filter(point => time - point.time < 550);
    trail.push({ x: point.x, y: point.y, time });
    trails.set(channel, trail);
    visuals.set(channel, { channel, landmarks, point, time });
    redrawAll();
  }

  function clear(channel = null) {
    if (channel) {
      visuals.delete(channel);
      trails.delete(channel);
      redrawAll();
    } else {
      visuals.clear();
      trails.clear();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function redraw() {
    if (visuals.size) redrawAll();
  }

  return { paint, clear, redraw };
}
