# Architecture

Muvesic uses native JavaScript ES modules, browser APIs and a dependency-free Node development server. There is no bundle step. **Files in dist/ are authored source**, not generated output; deploy that entire directory, including subdirectories.

![Module ownership map](architecture.png)

## Module ownership

| Area | Files | Responsibility |
| --- | --- | --- |
| Composition | dist/app.js | Connect features at startup; keep business logic elsewhere |
| Session | dist/app/session.js | Session state, resource ownership, startup cancellation, note dispatch, hand-close mute |
| Settings | dist/app/settings.js | Defaults, sound IDs, per-limb defaults, pure settings validation |
| Controls | dist/app/controls.js | Buttons, selectors, Escape, visibility and page lifecycle events |
| DOM presentation | dist/ui/instrument-view.js | DOM IDs, controls, lanes, note monitor, limb/section readouts, status and errors |
| Canvas | dist/ui/stage-renderer.js | Mirrored skeleton (hand or body), pulsing limb dots, fingertip trail |
| Alternative input | dist/input/pointer-keyboard.js | Pointer capture, touch, keyboard steps and animation cadence |
| Music | dist/music/ | Scale definitions, note names/tuning, smoothing, note gating, section arrangements, body mapper |
| Audio | dist/audio/ | AudioContext/master chain and individual note construction |
| Tracking | dist/tracking/ | Camera/model lifecycle, pinned asset URLs, error messages, body pose geometry, posture rules, closed-fist detection |
| About page | dist/about.html | Static guide page reachable from the nav |
| Shared helpers | dist/shared/ | Numeric clamping and cancellable resource deadlines |
| Optional tools | dist/integrations/webmcp.js | Feature-detected configure/read/stop tools |
| Development tooling | scripts/ | Local static server and recursive syntax checks |
| Verification | tests/ | Focused node:test suites and reusable test doubles |

The root music.js, audio.js and tracker.js files are compatibility exports. Existing imports remain valid; implement new behavior in their feature directories. Internal modules import focused modules directly, except the session uses the public audio interface. Avoid adding broad barrels or a shared mutable global state object.

## Data flow and contracts

1. Pointer/keyboard input produces normalized screen coordinates. Camera tracking produces raw MediaPipe landmarks; session.js mirrors fingertip x exactly once, and music/body-mapper.js mirrors the pose once for its own features. Landmarks are never mirrored twice: music maps mirrored input, the canvas draws mirrored raw input.
2. MotionMapper.update(x, y, time) accepts x/y in [0, 1] and monotonically increasing milliseconds. Top is high pitch. It returns a mapped note event, or null for invalid/stale timestamps.
3. BodyMapper.update(landmarks, time) takes 33 unmirrored pose landmarks and the same clock, and returns a frame with `limbs: [{ channel, x, y, visible }, ...]` plus a settled `posture`, a body-level `lean` for lean shaping, `strength`, `hint` and `status`. It returns null for anything unusable, including the frames it spends calibrating, so the session treats an uncalibrated body exactly like a lost hand.
4. Each visible limb is fed through its own MotionMapper (one per channel) by the session, so the four limbs sound as four independent voices on four channels, each with its own scale, sound and octave.
5. The session passes triggered MIDI notes, velocity, pan, sound and an optional arrangement to Synthesizer. Held notes update pan without retriggering. In orchestra mode the arrangement is a four-section voicing; in body mode the arrangement is null and each limb plays its own voice.
6. The view receives the same mapped event for the lane highlight, monitor and canvas, plus the arrangement when one is playing so it can name each section's note. Raw landmarks remain unmirrored until drawn by the canvas renderer.

Music functions have no DOM or hardware dependencies. Keep those calculations out of event handlers. Audio and camera modules own their hardware cleanup; presentation never starts or stops hardware.

Domain data is read, not owned, by the layer above it: the view imports `SCALES` from music/ and posture labels from tracking/ the same way, purely to name things on screen. Neither directory knows the DOM exists.

## State and resource ownership

createSession returns start, stop, switchMode, reset, applySettings, read and dispose. Only the controller owns session state: idle → loading → running → idle. start is ignored unless idle. stop invalidates the generation token before closing resources, so late startup completion and callbacks cannot revive or modify a newer session.

Each session creates a fresh synthesizer and, in camera mode, a fresh HandTracker or PoseTracker. Stop cancels the input loop and session clock, stops camera tracks/model inference, closes audio, resets musical history and clears visuals. Input listeners live for the application lifetime; input.stop cancels session activity, while input.dispose also removes listeners. createSession.dispose is intended for an embedding application's teardown.

Camera startup uses withDeadline. Cancellation does not cancel the underlying browser promise: its dispose callback must release any stream or model that arrives after cancellation or timeout. Preserve this behavior when changing initialization.

Settings patches are fully validated before state changes. Volume is a percent in the settings API (0–100), a fraction in audio (0–1). Settings input uses mute; read/applySettings results retain the existing muted field. Body mode exposes four channels (`left`, `right`, `lowerLeft`, `lowerRight`) and each carries its own `octave` integer so the legs can sit in the bass without leaving the scale. Returned snapshots do not expose mutable session state. Changing scale or sound releases the current note and resets mapping; changing volume/mute updates master gain.

The input adapter receives callbacks and read functions; it does not import the session or manipulate its state. The view receives values and does not read controller state. Session factories for input, audio and tracking are injectable for deterministic tests.

## Camera, hand and pose pipelines

`tracking/camera-source.js` owns the camera stream, video playback and inference cadence for both hand and pose pipelines. A tracker supplies `createDetector(signal)` and the source handles permissions, deadlines, disposal and the stale rule. It rate-limits silence to one report per stale window, and it delivers frames outside its own try block so a presentation fault cannot stop tracking.

`tracking/hand-tracker.js` is a thin wrapper around CameraSource that drives the Hand Landmarker model. `tracking/pose-tracker.js` is the equivalent for the Pose Landmarker model, runs at about 20 Hz on a 1280x720 stream, requests one pose and no segmentation masks.

Both trackers share the same `onFrame(landmarks, milliseconds)` contract, so the session chooses one at startup based on `performance` and never swaps it mid-session. Entering or leaving body mode restarts the session; orchestra↔solo stays live.

## Performance modes

The `performance` setting (`solo`, `orchestra` or `body`) is independent of camera/mouse input but exclusive with itself: exactly one mode is active at a time, and it decides which channels exist.

| Mode | Channels | UI |
| --- | --- | --- |
| `solo` | `left`, `right` | Two hand panels (instrument, scale, volume, mute each) |
| `orchestra` | `ensemble` | Right-hand panel + section arrangement |
| `body` | `left`, `right`, `lowerLeft`, `lowerRight` | Four limb panels (instrument, scale, volume, mute each) |

Solo drives two tracked hands on their own left/right channels. Orchestra drops to one conductor hand driving a four-section ensemble. Body mode swaps the hands for a pose skeleton and turns each visible limb into its own voice, so a full-body player sounds four channels at once.

The session's `activeChannels()` returns the right set for the current performance. Volume/mute only flow through the channels that have their own settings row. In orchestra, the ensemble channel has no settings row and borrows the right hand's mix.

`music/orchestra.js` turns a mapped root into four diatonic section parts, one per synthesized section timbre. The session passes that arrangement to `Synthesizer.play(channel, midi, velocity, pan, sound, arrangement)`, which always takes all six arguments and ignores `arrangement` when it is null. The synthesizer groups voices per channel and releases a channel's whole group together, retaining releasing voices until oscillator cleanup completes. `audio/voice.js` defines the synthesized section timbres. Section timbres are namespaced (`strings`, `woodwind`, `brass`, `cello`) so the orchestra bass does not collide with the solo `bass` instrument.

The conductor is sticky: `conductorOf` keeps whichever hand is nearest the previous conductor's mirrored x, so a second hand entering frame cannot steal the ensemble mid-phrase. Losing every hand releases the ensemble and clears its readouts but leaves the session running, so the hand can return and resume. A performance change releases only the channels that were sounding, captured before the new settings are applied. Settings changes reset mapping and release all active sections.

The view maps every channel onto a real panel before touching the DOM: `ensemble` reads out through the right-hand panel; each limb channel reads out through its own limb panel. Any channel that does not resolve to a real element would throw inside the tracking frame loop, and the tracker reports that as a fatal error which stops the session. Treat the `collectUI` id list and the panel mapping as one contract; `tests/view.test.mjs` and `tests/body-view.test.mjs` check it against the real markup.

## Hand-close mute

In solo and orchestra modes the session watches the fingertip cluster. `fingertipsClustered(hand)` returns true when every fingertip on MediaPipe's hand landmarks (indices 4, 8, 12, 16, 20) lies within `FINGER_CLUSTER_RADIUS` (0.18 in normalized image space) of every other — i.e. the hand is a closed fist. When the conductor's hand clusters in orchestra mode, the ensemble is released without leaving the session; when either hand clusters in solo mode, only that hand's voice is released so the other hand keeps playing. Body mode does not watch hand landmarks at all (it has none), so the gesture is invisible there.

## Body mode

Body mode swaps the two tracked hands for one pose skeleton, so the session routes `onFrame` into `playPose` instead of `playPoint`. The tracker chosen at startup reflects this: body mode needs a different camera model than hand modes do, and a tracker cannot be swapped underneath a running session. Entering or leaving body mode stops the session and asks you to start again. Switching to mouse mode has no posture to read, so it returns the session to solo.

`tracking/posture.js` is pure geometry. It normalizes every distance by the player's own calibrated torso, so a player standing close and a player standing back read the same for the same movement. `neutralPose` measures the ruler from one frame; the mapper averages a short still window into it, so arm height, crouch, ankle height, spread and twist are all in torso lengths. `framing` reports how much of the player is in frame (`full`, `upper`, `step-back` or `lost`), and the mapper turns a lost frame into the same silence a lost hand produces.

`music/body-mapper.js` is the per-limb geometry-to-screen-position step. It returns one entry per visible limb with `channel`, mirrored `x`, a body-relative `y` in [0, 1] for the lane ladder, and a `visible` flag. The session iterates that list and feeds each visible limb through its own `MotionMapper`, so the four limbs sound as four independent voices rather than a chord. Arms and legs use different `ARM_LOW`/`ARM_HIGH` and `LEG_LOW`/`LEG_HIGH` ranges so the two arms share one pitch ladder and the two legs share another — squatting a leg doesn't move an arm.

`tracking/classifier.js` names the settled posture with asymmetric engage/release counts, so a posture has to hold before it counts and does not flicker once it does. `music/orchestra.js`'s `applyPosture(frames, posture, strength, lean)` is the only audio shaper — it never invents a note, it just shifts octaves, opens the stereo, or drags the rig sideways. Neither the mapper nor the classifier knows about audio.

The stage draws one shared body skeleton (not four), four equal pulsing dots at each limb's `(x, y)`, and no fingertip trail — body mode uses a ring + dot instead of a trail because four trails would speckle the stage.

## Extension recipes

- **New scale:** add its ascending MIDI notes and hint in music/scales.js, add its select option in index.html, and extend music tests. Tool scale enumeration follows the registry.
- **New sound:** add its ID in app/settings.js, define synthesis in audio/voice.js, add its select option, and extend audio tests. Do not change master/context ownership for a new timbre.
- **New input:** implement an adapter with start/stop/dispose and normalized point callbacks. Wire it through the session and composition root. Define tracking-loss and cancellation behavior before enabling it.
- **Visual change:** use ui/ for rendering and index.html/style.css for markup/style. Keep note decisions in music/.
- **Camera provider change:** use tracking/; keep raw landmark orientation and the onFrame(landmarksOrNull, milliseconds) contract stable, or explicitly update callers and tests together. A new detector needs only a `createDetector(signal)` returning `detect(video, milliseconds)` and `close()`; CameraSource owns the hardware and the cadence.
- **New posture:** add one rule to `RULES` in tracking/classifier.js with an engage/release pair, a threshold and a `value` that only grows as the pose becomes more pronounced. Read new geometry in tracking/posture.js and decide what it sounds like in music/orchestra.js.
- **New body limb:** add the channel to `LIMBS` in app/settings.js with its own `{scale, sound, volume, mute, octave}`, add an entry in `LIMB_PREFIX` in ui/instrument-view.js, add the limb panel markup to index.html, and add a frame shape in music/body-mapper.js (anchor index, reach index, low/high lane bounds). The session wires the new channel through automatically.
- **Tool change:** use integrations/webmcp.js and the session's public actions. Tools intentionally cannot start camera/audio.

## Checks and limits

Run npm run check and npm test. The syntax checker discovers all nested JavaScript in dist/, scripts/ and tests/. Server tests discover and fetch every application module, checking JavaScript MIME types. Existing audio, music and deadline tests continue to exercise the compatibility exports. Session tests exercise injected boundaries, including cancellation/restart races and missing camera frames. Controls tests bind against the real element ids, and view tests build a DOM double from dist/index.html so the id contract and panel exclusivity are checked against the actual markup.

Automated doubles do not establish actual webcam alignment, latency, sound quality or WebMCP browser support. Perform the manual checks in CONTRIBUTING.md when those areas change.

## Unwired modules

`dist/music/Guitar-mapper.js` and `dist/tracking/two-hand-tracker.js` are left over from the two-hand/guitar line of work and are not imported by the composition root or any test. They are kept as-is for reference. Wire them up or delete them in a follow-up rather than expanding their surface here.
