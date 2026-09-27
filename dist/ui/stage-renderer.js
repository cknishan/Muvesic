const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
  [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

/** Owns canvas drawing and trajectory history; never controls audio or tracking. */
export function createStageRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let lastVisual = null;
  let trail = [];

  function drawHand(landmarks, width, height) {
    ctx.strokeStyle = '#d4f5a788';
    ctx.lineWidth = 2;
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo((1 - landmarks[a].x) * width, landmarks[a].y * height);
      ctx.lineTo((1 - landmarks[b].x) * width, landmarks[b].y * height);
      ctx.stroke();
    }
    for (const landmark of landmarks) {
      ctx.beginPath();
      ctx.arc((1 - landmark.x) * width, landmark.y * height, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#e3f6d4';
      ctx.fill();
    }
  }

  function drawTrail(width, height) {
    for (let i = 1; i < trail.length; i++) {
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x * width, trail[i - 1].y * height);
      ctx.lineTo(trail[i].x * width, trail[i].y * height);
      ctx.strokeStyle = 'rgba(198,243,107,' + (i / trail.length) * .5 + ')';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  function paint(landmarks, point, time) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (landmarks) drawHand(landmarks, width, height);
    trail = trail.filter(point => time - point.time < 550);
    trail.push({ x: point.x, y: point.y, time });
    drawTrail(width, height);
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, 17, 0, Math.PI * 2);
    ctx.fillStyle = '#c6f36b26';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#d9ff95';
    ctx.fill();
    lastVisual = { landmarks, point, time };
  }

  function clear() {
    lastVisual = null;
    trail = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function redraw() {
    if (lastVisual) paint(lastVisual.landmarks, lastVisual.point, lastVisual.time);
  }

  return { paint, clear, redraw };
}
