// This is a polyfill for the worker thread in a browser context.
// We're exposing the worker thread's addEventListener/postMessage
// functionality out on something that looks like Node's MessagePort.
const _parentPort = null;

export const parentPort = _parentPort || {
  on (ev: string, fn: unknown) {
    addEventListener(ev, (event: MessageEvent) => {
      fn(event.data);
    })
  },

  postMessage (data, txf=[]) {
    self.postMessage(data, txf);
  }
}
