import { SCALES } from '../music/scales.js';
import { SOUNDS } from '../app/settings.js';

/** Optional tools may configure/read/stop; they never start camera or audio. */
export function registerInstrumentTools(modelContext, session) {
  if (!modelContext?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
  const tools = [
    {
      name: 'configure_instrument',
      description: 'Set the musical scale, sound, volume and mute state. Does not start the camera or audio.',
      inputSchema: {
        type: 'object',
        properties: {
          scale: { type: 'string', enum: Object.keys(SCALES) },
          sound: { type: 'string', enum: SOUNDS },
          volume: { type: 'number', minimum: 0, maximum: 100 },
          mute: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      execute: input => session.applySettings(input),
      annotations: { readOnlyHint: false },
    },
    {
      name: 'stop_instrument',
      description: 'Stop the camera, hand tracking and audio session.',
      inputSchema: emptySchema,
      execute: () => { session.stop(); return { state: session.read().state }; },
      annotations: { readOnlyHint: false },
    },
    {
      name: 'read_instrument',
      description: 'Read the current instrument settings and session state.',
      inputSchema: emptySchema,
      execute: () => session.read(),
      annotations: { readOnlyHint: true },
    },
  ];
  for (const tool of tools) {
    try {
      Promise.resolve(modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
    } catch {
      // An unsupported optional API must not prevent playing the instrument.
    }
  }
  return () => lifecycle.abort();
}
