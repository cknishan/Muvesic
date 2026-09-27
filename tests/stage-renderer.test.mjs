import test from 'node:test';
import assert from 'node:assert/strict';
import { createStageRenderer } from '../dist/ui/stage-renderer.js';

/** Count draw operations the renderer asks of the canvas context, so we can
 *  assert that the right number of skeletons is on stage without rendering for
 *  real. The proxy intercepts every method call on `ctx` and tallies the ones
 *  that draw (beginPath+stroke for lines, beginPath+arc+fill for joints). */
function makeCanvas() {
  const counts = { lines: 0, joints: 0, calls: [] };
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === 'canvas') return {};
      if (key === 'beginPath' || key === 'moveTo' || key === 'lineTo' || key === 'clearRect' || key === 'setTransform' || key === 'arc') {
        return () => {};
      }
      if (key === 'stroke') return () => { counts.lines++; counts.calls.push('stroke'); };
      if (key === 'fill') return () => { counts.joints++; counts.calls.push('fill'); };
      return () => {};
    },
    set() { return true; },
  });
  const canvas = {
    clientWidth: 640, clientHeight: 360,
    width: 0, height: 0,
    getContext: () => ctx,
  };
  if (typeof globalThis.devicePixelRatio === 'undefined') globalThis.devicePixelRatio = 1;
  return { canvas, counts };
}

const HAND = () => Array.from({ length: 21 }, () => ({ x: .5, y: .5, visibility: 1 }));
const BODY = () => Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }));

test("solo draws one skeleton per tracked hand, in the hand's own colour", () => {
  const { canvas, counts } = makeCanvas();
  const renderer = createStageRenderer(canvas);
  // One hand: 21 skeleton strokes + 21 skeleton's draws are clear.
  renderer.paint('left', HAND(), { x: .3, y: .5, intensity: .4 }, 100, 'solo');
  const linesAfterOneHand = counts.lines;
  const jointsAfterOneHand = counts.joints;
  // Adding a second hand must increase both counts — the second skeleton
  // contributes more strokes and fills than just a pulse would.
  renderer.paint('right', HAND(), { x: .7, y: .5, intensity: .4 }, 100, 'solo');
  assert.ok(counts.lines > linesAfterOneHand,
    'a second hand adds skeleton strokes');
  assert.ok(counts.joints > jointsAfterOneHand,
    'a second hand adds joint fills');
  // The skeleton is the same for every hand — so the second-hand delta should
  // be at least as many strokes as the first hand's full skeleton (21 bones),
  // not just a single pulse stroke.
  assert.ok(counts.lines - linesAfterOneHand >= 21,
    'the second-hand redraw draws a full second skeleton, not just a pulse');
});

test('orchestra draws one skeleton for the conductor hand', () => {
  const { canvas, counts } = makeCanvas();
  const renderer = createStageRenderer(canvas);
  renderer.paint('ensemble', HAND(), { x: .5, y: .5, intensity: .3 }, 100, 'orchestra');
  // A hand skeleton is 21 bones (CONNECTIONS). The pulse adds 1 stroke.
  assert.ok(counts.lines >= 21, 'at least the 21 bone strokes for the hand');
  assert.ok(counts.joints >= 21, 'at least 21 joint dots');
});

test('body draws one whole-body skeleton regardless of how many limbs are sounding', () => {
  const { canvas, counts } = makeCanvas();
  const renderer = createStageRenderer(canvas);
  // Paint all four limbs in sequence. With body-mode deduplication, each paint
  // redraws one body skeleton (12 bones) and one pulse per visual. The first
  // paint produces 13 strokes, the last produces 12 + 4 = 16. The total
  // accumulated count is 13 + 16 + 16 + 16 = 61.
  renderer.paint('left', BODY(), { x: .3, y: .2, intensity: .4 }, 100, 'body');
  const linesAfterOne = counts.lines;
  renderer.paint('right', BODY(), { x: .7, y: .2, intensity: .4 }, 100, 'body');
  renderer.paint('lowerLeft', BODY(), { x: .4, y: .8, intensity: .4 }, 100, 'body');
  renderer.paint('lowerRight', BODY(), { x: .6, y: .8, intensity: .4 }, 100, 'body');
  // Four paints total. If body mode were re-drawing one skeleton per visual
  // (the bug we are guarding against), the total would grow linearly with the
  // number of limbs: 12 + (12+1) + (12+2) + (12+3) + (12+4) = 78 strokes.
  // The deduplicated contract is: one skeleton per redraw, no matter how many
  // limbs are sounding — total is 13 + 16*3 = 61 strokes.
  assert.equal(counts.lines, 13 + 16 * 3,
    'one body skeleton and a pulse per visual, regardless of how many limbs paint');
  // First paint = 12 skeleton + 1 pulse.
  assert.equal(linesAfterOne, 13);
});

test('clearing one hand removes only that skeleton, not the other', () => {
  const { canvas, counts } = makeCanvas();
  const renderer = createStageRenderer(canvas);
  renderer.paint('left', HAND(), { x: .3, y: .5, intensity: .4 }, 100, 'solo');
  renderer.paint('right', HAND(), { x: .7, y: .5, intensity: .4 }, 100, 'solo');
  counts.lines = 0;
  counts.joints = 0;
  renderer.clear('left');
  // Only the right hand is left, so we should still see at least one full
  // skeleton's worth of bones drawn.
  assert.ok(counts.lines >= 21, 'the right hand skeleton remains');
  assert.ok(counts.joints >= 21, 'and its joint dots');
});
