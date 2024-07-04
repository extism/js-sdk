import type { Capabilities } from '../interfaces.ts';

export const CAPABILITIES: Capabilities = {
  // When false, shared buffers have to be copied to an array
  // buffer before passing to Text{En,De}coding()
  allowSharedBufferCodec: false,

  // Whether or not the manifest supports the "path:" key.
  manifestSupportsPaths: true,

  // Whether or not cross-origin checks are enforced on this platform.
  crossOriginChecksEnforced: false,

  fsAccess: true,

  hasWorkerCapability: true,

  // See https://github.com/oven-sh/bun/issues/1960
  supportsWasiPreview1: false,

  extismStdoutEnvVarSet: Boolean(process.env.EXTISM_ENABLE_WASI_OUTPUT),

  supportsTimeouts: false,
};
