// NB(chris): we can't do the obvious thing here (`new URL('./worker.js', import.meta.url)`.)
// Why? This file is consumed by Deno, and in Deno JSR packages `import.meta.url`
// resolves to an `http(s):` protocol. However, `http(s):` protocol URLs are not supported
// by node:worker_threads.
//
// (And oof, in order to switch from node workers to web Workers,
// we'd have to polyfill the web Worker api on top of node. It was easier to go the other way
// around.)
//
// In Node, Bun, and browser environments, this entire file is *ignored*: the esbuild config
// replaces it with a prebuilt base64'd inline javascript URL. See `build_worker_node` in
// the `justfile`.
const relativeUrl = (await (import.meta.resolve as any)('./worker.ts')) as string;
export const WORKER_URL = `data:text/javascript;base64,${btoa(`
  export * from ${JSON.stringify(relativeUrl)};
`)}`;
