# Contributing to Muvesic

Start with [README.md](README.md) for running the app and [docs/architecture.md](docs/architecture.md) for module responsibilities and contracts. Node.js 20 or newer is required. No dependency installation or build step is needed.

## Working in parallel

Choose a feature boundary before starting work. For example, one contributor can change audio/voice.js while another changes ui/stage-renderer.js and a third improves tracking/errors.js. Each should add or update the corresponding test file. The composition root (dist/app.js), index.html, style.css, settings registry and package.json are shared integration points: coordinate changes to those explicitly.

1. Create a short-lived branch from the team's current base branch.
2. Agree on the affected files and public interfaces in the issue or PR. When two tasks need the same interface change, land that small change first or agree on its signature.
3. Keep one concern per PR. Separate feature behavior from broad moves, renames or formatting.
4. Add code beside the feature it belongs to. Keep dist/app.js limited to wiring. Prefer explicit imports and parameters over shared state.
5. Add focused tests in a feature-specific test file; put reusable doubles in tests/helpers/ only when useful. Do not append every scenario to one shared test file.
6. Update your branch from the team's base before review. Resolve conflicts by understanding both changes, then rerun checks; do not blindly accept one side of a lifecycle or import conflict.

Commit only files relevant to your change. dist/ is tracked source and must be included. Avoid committing artifacts/, credentials, local hosting metadata or unrelated edits. Change package.json only when tooling actually changes; the current app has no npm dependencies or lockfile.

## Code and documentation conventions

- Use native ES modules with explicit .js extensions in browser imports.
- Keep each module focused on a responsibility; do not create a file for every trivial function.
- Use descriptive names, readable blocks and one operation per line for state/resource changes.
- Document exported contracts: units, coordinate orientation, callback shape, ownership and cleanup expectations. Explain non-obvious timing/cancellation decisions rather than narrating obvious statements.
- Maintain existing public exports unless a deliberate breaking change is agreed. Root audio.js, music.js and tracker.js are compatibility entry points.
- Keep dependency direction clear: input/view adapters communicate with the session via callbacks; pure music/shared modules never import UI/controller code.
- Update architecture documentation when boundaries or contracts change. Put feature-specific implementation notes near their code.

## Verification before review

Run from the project root:

~~~sh
npm run check
npm test
npm run dev
~~~

For focused iteration, use Node's test runner directly, for example:

~~~sh
node --test tests/session.test.mjs
node --test tests/music.test.mjs
~~~

For UI/input/session changes, check mouse mode in Chrome or Edge: start, move across pitches/pan, use arrow keys, change scale/sound, mute, stop, reset and restart. Check Escape and leaving the tab. On touch devices, verify drag, release and cancellation.

For camera/audio changes, also check permission denial, stopping during permission/model loading, restarting before the old startup finishes, missing-hand silence, mirrored skeleton alignment, physical sound output and the camera indicator turning off on Stop. Test a network/model failure when tracking changes. Never treat test doubles as webcam or sound-quality verification.

For body mode, also check the calibration window staying silent and then starting on its own, arm height mapping to pitch at two different distances from the camera, the posture readout settling instead of flickering, the stage asking for more room when the feet leave the frame, and full-body silence when you walk out of frame.

## Pull request notes

Describe the user-visible outcome (or preserved behavior for a refactor), affected module boundaries, validation performed and any hardware/browser checks still outstanding. Mention public contract changes so other contributors can update their branches. Keep unrelated generated files and sweeping formatting out of feature PRs.
