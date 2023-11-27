declare module 'js-sdk:response-to-module' {
  export function responseToModule(response: Response, hasHash?: boolean): Promise<{module: WebAssembly.Module, data?: ArrayBuffer}>; 
}

declare module 'js-sdk:capabilities' {
  import type { Capabilities } from '../../src/interfaces';

  /**
   *
   * The {@link Capabilities} supported by the current platform.
   *
   * @see {@link Capabilities}
   */
  export const CAPABILITIES: Capabilities;
}
declare module 'js-sdk:fs' {
  function readFile(path: string): Promise<Buffer>;
}
declare module 'js-sdk:wasi' {
  interface InternalWasi {
    importObject(): Promise<Record<string, WebAssembly.ImportValue>>;
    initialize(instance: WebAssembly.Instance): Promise<void>
  }
  function loadWasi(allowedPaths: {[from: string]: string}): Promise<InternalWasi>;
}
declare module 'js-sdk:worker-url' {
  declare const WORKER_URL: URL;
}
declare module 'js-sdk:minimatch' {
  function matches(text: string, pattern: string): boolean;
}
