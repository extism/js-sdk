declare module 'js-sdk:wasi' {
  interface InternalWasi {
    importObject(): Promise<Record<string, WebAssembly.ImportValue>>;
    initialize(instance: WebAssembly.Instance): Promise<void>
  }
  function loadWasi(allowedPaths: {[from: string]: string}): Promise<InternalWasi>;
}
