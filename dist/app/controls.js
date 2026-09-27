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
  listen(ui.performance, 'change', () => session.applySettings({ performance: ui.performance.value }));
  listen(ui.scale, 'change', () => session.applySettings({ scale: ui.scale.value }));
  listen(ui.sound, 'change', () => session.applySettings({ sound: ui.sound.value }));
  listen(ui.volume, 'input', () => session.applySettings({ volume: Number(ui.volume.value) }));
  listen(ui.mute, 'click', () => session.applySettings({ mute: !session.read().muted }));
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
