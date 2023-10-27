export const FEATURES = {
  // When false, shared buffers have to be copied to an array
  // buffer before passing to Text{En,De}coding()
  allowSharedBufferCodec: false,

  // Whether or not the manifest supports the "path:" key.
  manifestSupportsPaths: false,

  // Whether or not cross-origin checks are enforced on this platform.
  crossOriginChecksEnforced: true,

  fsAccess: false,

  hasWorkerCapability:
    typeof window !== 'undefined'
      ? (window as any).crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
      : true,

  supportsWasiPreview1: true,
};
