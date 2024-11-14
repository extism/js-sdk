import type { Capabilities } from '../interfaces.ts';

const WebAssembly = globalThis.WebAssembly || {}

const { Deno } = globalThis as unknown as { Deno: { env: Map<string, string> } };

export const CAPABILITIES: Capabilities = {
  supportsJSPromiseInterface: typeof (WebAssembly as any).Suspending === 'function' && typeof (WebAssembly as any).promising === 'function',

  // When false, shared buffers have to be copied to an array
  // buffer before passing to Text{En,De}coding()
  allowSharedBufferCodec: true,

  // Whether or not the manifest supports the "path:" key.
  manifestSupportsPaths: true,

  // Whether or not cross-origin checks are enforced on this platform.
  crossOriginChecksEnforced: false,

  fsAccess: true,

  hasWorkerCapability: true,

  supportsWasiPreview1: false,

  supportsTimeouts: true,

  extismStdoutEnvVarSet: Boolean(Deno.env.get('EXTISM_ENABLE_WASI_OUTPUT')),
};
