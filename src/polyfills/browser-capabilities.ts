import type { Capabilities } from '../interfaces.ts';

export const CAPABILITIES: Capabilities = {
  supportsJSPromiseInterface: typeof (WebAssembly as any).Suspending === 'function' && typeof (WebAssembly as any).promising === 'function',

  // When false, shared buffers have to be copied to an array
  // buffer before passing to Text{En,De}coding()
  allowSharedBufferCodec: false,

  // Whether or not the manifest supports the "path:" key.
  manifestSupportsPaths: false,

  // Whether or not cross-origin checks are enforced on this platform.
  crossOriginChecksEnforced: true,

  fsAccess: false,

  hasWorkerCapability:
    typeof globalThis !== 'undefined'
      ? (globalThis as any).crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
      : true,

  supportsWasiPreview1: true,

  supportsTimeouts: true,

  extismStdoutEnvVarSet: false,
};
