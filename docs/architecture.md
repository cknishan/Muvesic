# Architecture

Muvesic uses native JavaScript ES modules, browser APIs and a dependency-free Node development server. There is no bundle step. **Files in dist/ are authored source**, not generated output; deploy that entire directory, including subdirectories.

## Module ownership

| Area | Files | Responsibility |
| --- | --- | --- |
| Composition | dist/app.js | Connect features at startup; keep business logic elsewhere |
| Session | dist/app/session.js | Session state, resource ownership, startup cancellation, note dispatch |
| Settings | dist/app/settings.js | Defaults, sound IDs, pure settings validation |
| Controls | dist/app/controls.js | Buttons, selectors, Escape, visibility and page lifecycle events |
| DOM presentation | dist/ui/instrument-view.js | DOM IDs, controls, lanes, note monitor, status and errors |
| Canvas | dist/ui/stage-renderer.js | Mirrored skeleton, fingertip and trajectory history |
| Alternative input | dist/input/pointer-keyboard.js | Pointer capture, touch, keyboard steps and animation cadence |
| Music | dist/music/ | Scale definitions, note names/tuning, smoothing and note gating |
| Audio | dist/audio/ | AudioContext/master chain and individual note construction |
| Tracking | dist/tracking/ | Camera/model lifecycle, pinned asset URLs and error messages |
| Shared helpers | dist/shared/ | Numeric clamping and cancellable resource deadlines |
| Optional tools | dist/integrations/webmcp.js | Feature-detected configure/read/stop tools |
| Development tooling | scripts/ | Local static server and recursive syntax checks |
| Verification | tests/ | Focused node:test suites and reusable test doubles |

The root music.js, audio.js and tracker.js files are compatibility exports. Existing imports remain valid; implement new behavior in their feature directories. Internal modules import focused modules directly, except the session uses the public audio interface. Avoid adding broad barrels or a shared mutable global state object.

## Data flow and contracts

1. Pointer/keyboard input produces normalized screen coordinates. Camera tracking produces raw MediaPipe landmarks; session.js mirrors fingertip x exactly once.
2. MotionMapper.update(x, y, time) accepts x/y in [0, 1] and monotonically increasing milliseconds. Top is high pitch. It returns a mapped note event, or null for invalid/stale timestamps.
3. The session passes triggered MIDI notes, velocity and pan to Synthesizer. Held notes update pan without retriggering.
4. The view receives the same mapped event for the lane highlight, monitor and canvas. Raw landmarks remain unmirrored until drawn by the canvas renderer.

Music functions have no DOM or hardware dependencies. Keep those calculations out of event handlers. Audio and camera modules own their hardware cleanup; presentation never starts or stops hardware.

## State and resource ownership

createSession returns start, stop, switchMode, reset, applySettings, read and dispose. Only the controller owns session state: idle → loading → running → idle. start is ignored unless idle. stop invalidates the generation token before closing resources, so late startup completion and callbacks cannot revive or modify a newer session.

Each session creates a fresh synthesizer and, in camera mode, a fresh HandTracker. Stop cancels the input loop and session clock, stops camera tracks/model inference, closes audio, resets musical history and clears visuals. Input listeners live for the application lifetime; input.stop cancels session activity, while input.dispose also removes listeners. createSession.dispose is intended for an embedding application's teardown.

Camera startup uses withDeadline. Cancellation does not cancel the underlying browser promise: its dispose callback must release any stream or model that arrives after cancellation or timeout. Preserve this behavior when changing initialization.

Settings patches are fully validated before state changes. Volume is a percent in the settings API (0–100), a fraction in audio (0–1). Settings input uses mute; read/applySettings results retain the existing muted field. Returned snapshots do not expose mutable session state. Changing scale or sound releases the current note and resets mapping; changing volume/mute updates master gain.

The input adapter receives callbacks and read functions; it does not import the session or manipulate its state. The view receives values and does not read controller state. Session factories for input, audio and tracking are injectable for deterministic tests.

## Extension recipes

- **New scale:** add its ascending MIDI notes and hint in music/scales.js, add its select option in index.html, and extend music tests. Tool scale enumeration follows the registry.
- **New sound:** add its ID in app/settings.js, define synthesis in audio/voice.js, add its select option, and extend audio tests. Do not change master/context ownership for a new timbre.
- **New input:** implement an adapter with start/stop/dispose and normalized point callbacks. Wire it through the session and composition root. Define tracking-loss and cancellation behavior before enabling it.
- **Visual change:** use ui/ for rendering and index.html/style.css for markup/style. Keep note decisions in music/.
- **Camera provider change:** use tracking/; keep raw landmark orientation and the onFrame(landmarksOrNull, milliseconds) contract stable, or explicitly update callers and tests together.
- **Tool change:** use integrations/webmcp.js and the session's public actions. Tools intentionally cannot start camera/audio.

## Checks and limits

Run npm run check and npm test. The syntax checker discovers all nested JavaScript in dist/, scripts/ and tests/. Server tests discover and fetch every application module, checking JavaScript MIME types. Existing audio, music and deadline tests continue to exercise the compatibility exports. Session tests exercise injected boundaries, including cancellation/restart races and missing camera frames.

Automated doubles do not establish actual webcam alignment, latency, sound quality or WebMCP browser support. Perform the manual checks in CONTRIBUTING.md when those areas change.

## Performance modes

The `performance` setting (`solo` or `orchestra`) is independent of camera/mouse input. `music/orchestra.js` turns a mapped root into four diatonic section parts. The session passes this arrangement as the optional fifth argument to `Synthesizer.play`; solo callers retain the four-argument interface. The synthesizer owns all active section voices and releases them together, retaining releasing voices until oscillator cleanup completes. `audio/voice.js` defines the synthesized section timbres. Settings changes reset mapping and release all active sections.
j