/** Bind UI and page events to the same actions exposed to optional browser tools. */
export function bindControls(ui, session, { document, window }) {
  const lifecycle = new AbortController();
  const listen = (target, name, callback) => target.addEventListener(name, callback, {
    signal: lifecycle.signal,
  });
  listen(ui.start, 'click', () => { void session.start(); });
  listen(ui.stop, 'click', () => session.stop());
  listen(ui.mode, 'click', () => session.switchMode());
  listen(ui.reset, 'click', () => session.reset());
  for (const channel of ['left', 'right']) {
    listen(ui[channel + '-scale'], 'change', () => session.applySettings({ [channel]: { scale: ui[channel + '-scale'].value } }));
    listen(ui[channel + '-sound'], 'change', () => session.applySettings({ [channel]: { sound: ui[channel + '-sound'].value } }));
    listen(ui[channel + '-volume'], 'input', () => session.applySettings({ [channel]: { volume: Number(ui[channel + '-volume'].value) } }));
    listen(ui[channel + '-mute'], 'click', () => session.applySettings({ [channel]: { mute: !session.read()[channel].muted } }));
  }
  listen(document, 'keydown', event => {
    if (event.key === 'Escape' && session.read().state !== 'idle') session.stop();
  });
  listen(document, 'visibilitychange', () => {
    if (document.hidden && session.read().state !== 'idle') {
      session.stop('Paused while this tab was away');
    }
  });
  listen(window, 'pagehide', () => session.stop());
  return () => lifecycle.abort();
}
