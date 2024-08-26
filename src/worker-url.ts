// This file is aliased by esbuild for commonjs, esm, and browser builds.
const relativeUrl = (await import.meta.resolve('./worker.ts')) as string
export const WORKER_URL = `data:text/javascript;base64,${btoa(`
  export * from ${JSON.stringify(relativeUrl)};
`)}`
