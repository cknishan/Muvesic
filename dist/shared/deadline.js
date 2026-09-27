export function abortError() {
  return new DOMException('Session stopped', 'AbortError');
}

/** Reject on timeout/cancellation and dispose resources that arrive afterward.
 * The underlying promise keeps running; callers supply resource cleanup.
 */
export function withDeadline(promise, signal, milliseconds, label, dispose = () => {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
    };
    const fail = error => {
      if (!done) {
        done = true;
        cleanup();
        reject(error);
      }
    };
    const aborted = () => fail(abortError());
    const timer = setTimeout(() => fail(new Error(label)), milliseconds);
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(value => {
      if (done) {
        dispose(value);
        return;
      }
      done = true;
      cleanup();
      resolve(value);
    }, fail);
    if (signal.aborted) aborted();
  });
}
