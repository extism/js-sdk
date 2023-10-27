export const FEATURES = {
  // When false, shared buffers have to be copied to an array
  // buffer before passing to Text{En,De}coding()
  allowSharedBufferCodec: true,

  // Whether or not the manifest supports the "path:" key.
  manifestSupportsPaths: true,

  // Whether or not cross-origin checks are enforced on this platform.
  crossOriginChecksEnforced: false,

  fsAccess: true,

  hasOffThreadCapability: true,

  supportsWasiPreview1: true,
}
