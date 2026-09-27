import { readFileSync } from 'node:fs';

/** Hardware-free DOM double built from the real markup, so the id contract is
 *  checked against dist/index.html instead of a hand-kept list. */
export function createDomDouble(markupUrl) {
  const markup = readFileSync(markupUrl, 'utf8');
  const ids = [...markup.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  const noop = () => {};
  const context = new Proxy({}, {
    get: (target, key) => (key === 'canvas' ? {} : noop),
    set: () => true,
  });

  function element(id) {
    return {
      id, textContent: '', value: '', hidden: false, disabled: false, innerHTML: '',
      dataset: {}, style: {}, children: [], attributes: {},
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      addEventListener: noop,
      append: noop,
      setAttribute(name, value) { this.attributes[name] = value; },
      getContext: () => context,
      getBoundingClientRect: () => ({ width: 640, height: 360 }),
      replaceChildren(...children) { this.children = children; },
      querySelector: () => element('inner'),
    };
  }

  const registry = new Map(ids.map(id => [id, element(id)]));
  const document = {
    getElementById: id => registry.get(id) ?? null,
    createElement: () => element('created'),
    body: { dataset: {} },
    hidden: false,
    addEventListener: noop,
  };

  // The view reaches for browser globals directly, so stand them in and hand back
  // a restore function to keep the test runner's process clean.
  const globals = { document, window: { addEventListener: noop }, devicePixelRatio: 1 };
  const previous = new Map();
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  return {
    document,
    markupIds: ids,
    element,
    restore() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}
