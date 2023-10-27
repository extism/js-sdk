// This is a polyfill for the main thread in a browser context.
// We're making the native Worker API look like node's worker_threads
// implementation.
export const parentPort = null; 

const HANDLER_MAP = new WeakMap();

export class Worker extends (global.Worker || Object) {
  constructor(url: string) {
    super(url, { type: 'module', credentials: 'omit', name: 'extism-worker', crossOriginIsolated: true } as any)
  }

  on(ev: string, action: any) {
    const handler = (ev: any) => action(ev.data);
    HANDLER_MAP.set(action, handler);
    this.addEventListener(ev, handler);
  }

  removeListener(ev: string, action: any) {
    const handler = HANDLER_MAP.get(action);
    if (handler) {
      this.removeEventListener(ev, handler);
    }
  }

  once(ev: string, action: any) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.addEventListener(ev, function handler(...args) {
      self.removeEventListener(ev, handler);
      action.call(self, ...args);
    });
  }
}
