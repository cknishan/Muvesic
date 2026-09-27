# Muvesic

A webcam instrument implementing the core scope in [MVP.md](MVP.md). One tracked index fingertip controls a browser synthesizer: height selects pitch, horizontal position controls stereo pan, and speed changes note velocity. Everything is processed on the player's device. There is no backend, account, microphone access, recording, or video upload.

## Run

Install Node.js 20 or newer, then run:

```sh
npm run dev
```

Open **http://localhost:5173** in a recent desktop Chrome or Edge browser. No npm dependencies or build step are needed. The authored, deployable application lives in `dist/`.

1. Click **Start camera** and allow camera access.
2. Show one or two hands, keeping each index fingertip visible.
3. The left side of the screen controls the left instrument, and the right side controls the right instrument.
4. Lift to play higher notes; move sideways to pan; move faster for louder attacks.
5. Choose Soft keys, Warm synth, Glass bell, or Round bass for each hand, and a pentatonic, major, or minor scale.
6. Stop releases the webcam, tracking model and audio context. Reset also restores defaults. Changing tabs automatically stops the session.

**Try with mouse** provides a camera-free way to play using the same mapping and audio engine. Click Start playing, then move over the stage, drag on a touchscreen, or focus the stage and use arrow keys. Escape stops either mode. Touchscreen layout is supported, but webcam performance is targeted at desktop laptops.

## Design and implementation

The application is split by responsibility so contributors can work in separate files:

- `dist/app/`: session lifecycle, validated settings and control bindings.
- `dist/ui/`: DOM presentation and canvas rendering.
- `dist/input/`: pointer, touch and keyboard input.
- `dist/music/`: scales, tuning and motion-to-note mapping.
- `dist/audio/`: synthesis, individual voices and cleanup.
- `dist/tracking/`: camera/model lifecycle, configuration and recovery messages.
- `dist/integrations/`: optional WebMCP tools.
- `dist/shared/`: math and resource deadline helpers.
- `dist/app.js`: small composition entry point; root music/audio/tracker modules preserve public imports.
- `scripts/`: dependency-free development server and recursive syntax checks.

See [Architecture](docs/architecture.md) for ownership, data flow, lifecycle contracts and extension recipes. See [Contributing](CONTRIBUTING.md) for parallel development, merge guidance and review checks.

The default pentatonic spans C4 to C5 (five distinct pitch classes plus the top octave). Camera mode tracks up to two hands. Hands are assigned by mirrored screen position: the left side controls the left instrument and the right side controls the right instrument. Missing or stale frames release only that side's current voice and reset its movement history. Note that MediaPipe inference runs synchronously on the main thread, capped near 30 Hz; actual frame rate and latency depend on the device and have not been benchmarked on physical webcam hardware.

## Network and deployment

Camera access requires **HTTPS or localhost**. Do not open `index.html` with a `file://` URL. Host the entire `dist/` directory, including its module subdirectories, on a static HTTPS host.

Camera mode downloads the pinned `@mediapipe/tasks-vision@0.10.22-rc.20250304` JavaScript/WASM from jsDelivr and Google's version-1 float16 Hand Landmarker model. The model/runtime are fetched on start; video frames stay in the browser. Internet access to those hosts is required, and first startup can take several seconds. Mouse mode does not load MediaPipe. Google Fonts is optional; system fonts are used if it is unavailable. For an offline or restricted-network installation, vendor the runtime, WASM, model and fonts, then update their URLs.

MediaPipe integration follows the [official Hand Landmarker web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js). Camera permission failures, unavailable cameras, model-loading failures and disconnects show recovery instructions. Permission/model startup can be cancelled with Stop, including while the browser permission prompt is pending.

## Verification

```sh
npm run check
npm test
```

Tests cover musical mapping, jitter suppression, note gating, tracking reacquisition, dynamics, tuning, audio graph lifecycle with an AudioContext test double, cancellation/deadline disposal, error messages, session cancellation/restart races, settings validation and HTTP serving of every nested module. They do not substitute for hearing the audio or exercising a physical webcam.

Manual acceptance: start the camera; check that each skeleton aligns with the mirrored hand; play separate low-to-high melodies on the left and right sides; compare slow and fast movement; move one hand out of frame and verify only that side goes silent; stop and confirm the camera indicator turns off. Also try permission denial, model/network failure, mute, reset, tab switching and restarting during startup.

Optional `document.modelContext` tools configure/read settings and stop sessions, sharing the UI actions. They are feature-detected and never start camera/audio. A supported WebMCP browser context is needed to validate their registration; automated verification here does not cover that browser proposal.
