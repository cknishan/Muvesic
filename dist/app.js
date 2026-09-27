import { createSession } from './app/session.js';
import { bindControls } from './app/controls.js';
import { collectUI, createInstrumentView } from './ui/instrument-view.js';
import { createPointerKeyboardInput } from './input/pointer-keyboard.js';
import { registerInstrumentTools } from './integrations/webmcp.js';

// Composition only: feature behavior belongs in the modules wired together here.
const ui = collectUI(document);
const view = createInstrumentView(ui);
const session = createSession({
  view,
  video: ui.camera,
  createInput: callbacks => createPointerKeyboardInput(ui.stage, callbacks),
});
bindControls(ui, session, { document, window });
const unregisterTools = registerInstrumentTools(document.modelContext, session);
const resizeObserver = new ResizeObserver(() => view.redraw());
resizeObserver.observe(ui.stage);
window.addEventListener('pagehide', unregisterTools, { once: true });
