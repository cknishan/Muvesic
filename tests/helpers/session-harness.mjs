import { createSession } from '../../dist/app/session.js';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Hardware-free boundary doubles; capture observable calls, not controller internals. */
export function sessionHarness({ audioStart, trackerStart } = {}) {
  const events = [];
  const audioInstances = [];
  const trackers = [];
  const poseTrackers = [];
  let callbacks;
  const view = Object.fromEntries([
    'renderControls', 'clearVisual', 'showTrackingHint', 'setStatus', 'showError',
    'setTime', 'focusStage', 'renderSettings', 'renderLanes', 'renderNote',
  ].map(name => [name, (...args) => events.push([name, ...args])]));
  const session = createSession({
    view, video: {},
    createInput: handlers => {
      callbacks = handlers;
      // The session's input contract: handlers is what the session calls; start,
      // stop and dispose are what tests call to control the input loop.
      return Object.assign(Object.fromEntries(['start', 'stop', 'dispose'].map(name =>
        [name, () => events.push(['input.' + name])])), handlers);
    },
    createAudio: () => {
      const audio = { closed: 0, released: 0, releases: [], notes: [], volumes: [],
        start: () => audioStart?.() ?? Promise.resolve(),
        close: async () => { audio.closed++; },
        release: channel => { audio.released++; audio.releases.push(channel); },
        play: (...args) => audio.notes.push(args),
        pan: (channel, value) => events.push(['pan', channel, value]),
        setVolume: (...args) => audio.volumes.push(args),
      };
      audioInstances.push(audio);
      return audio;
    },
    // Hands and poses share one boundary shape: a tracker can start, stop, and
    // hand the session a frame. Which list a tracker lands in is how a test
    // asserts the camera pipeline the session chose.
    createTracker: trackInto(trackers),
    createPoseTracker: trackInto(poseTrackers),
  });
  return { session, events, audioInstances, trackers, poseTrackers, input: () => callbacks };

  function trackInto(list) {
    return (video, onFrame, onError) => {
      const tracker = { onFrame, onError, stopped: 0,
        start: () => trackerStart?.() ?? Promise.resolve(),
        stop: () => { tracker.stopped++; },
      };
      list.push(tracker);
      return tracker;
    };
  }
}
