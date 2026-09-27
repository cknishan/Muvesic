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
  let callbacks;
  const view = Object.fromEntries([
    'renderControls', 'clearVisual', 'showTrackingHint', 'setStatus', 'showError',
    'setTime', 'focusStage', 'renderSettings', 'renderLanes', 'renderNote',
  ].map(name => [name, (...args) => events.push([name, ...args])]));
  const session = createSession({
    view, video: {},
    createInput: handlers => {
      callbacks = handlers;
      return Object.fromEntries(['start', 'stop', 'dispose'].map(name =>
        [name, () => events.push(['input.' + name])]));
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
    createTracker: (video, onFrame, onError) => {
      const tracker = { onFrame, onError, stopped: 0,
        start: () => trackerStart?.() ?? Promise.resolve(),
        stop: () => { tracker.stopped++; },
      };
      trackers.push(tracker);
      return tracker;
    },
  });
  return { session, events, audioInstances, trackers, input: () => callbacks };
}
