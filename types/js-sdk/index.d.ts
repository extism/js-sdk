declare module 'js-sdk:features' {
  export const FEATURES: Record<string, any>;
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
