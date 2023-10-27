# Developing

## The build process

The Extism SDK targets several platforms:

- Deno
- Node ECMAScript Modules ("ESM")
- Node CommonJS Modules ("CJS")
- Browser ECMAScript Modules

The source of this library is written as valid TypeScript, which may be
consumed and run directly by Deno. The latter three platforms are treated as
compile targets. There are two other compile targets:

- The source of the [Worker](https://mdn.io/worker), compiled for the browser.
- The source of the [Worker](https://mdn.io/worker), compiled for node.
- Tests

For compiled targets, the worker is compiled to a single artifact with an entry
point starting at `src/worker.ts`, base64-encoded, and included in the
resulting artifact.

Builds are orchestrated by the `justfile` and `esbuild`: each build target recipe accepts
incoming `esbuild` flags as an array of JSON data and prepends its own configuration.
This allows dependent recipes to override earlier flags. An annotated example:

```
build_worker_browser out='worker/browser' args='[]': # <-- we accept args and an out dir
    #!/bin/bash
    config="$(<<<'{{ args }}' jq -cM '
      [{
        "format": "esm",
        "alias": {
          "js-sdk:features": "./src/polyfills/browser-features.ts",
          "node:worker_threads": "./src/polyfills/worker-node-worker_threads.ts",
          "js-sdk:fs": "./src/polyfills/browser-fs.ts",
          "js-sdk:wasi": "./src/polyfills/browser-wasi.ts",
        }
      }] + . # <--- add this recipe's flags to the incoming flags.
    ')"
    just build_worker {{ out }} "$config"
```

There is a `_build` recipe that all other build targets depend on, at
varying degrees of indirection. This `_build` fixes all Deno-style `.ts`
import statements, invokes `esbuild`, and emits TypeScript declarations
via `tsc`.

### Polyfills

We use `esbuild` to compile to these targets. This allows us to abstract
differences at module boundaries and replace them as-needed. For example: each
of Node, Deno, and the Browser have different WASI libraries with slightly different
interfaces. We define a **virtual module**, `js-sdk:wasi`, and implement it by:

1. Modifying `deno.json`; adding a mapping from `js-sdk:wasi` to `./src/polyfills/deno-wasi.ts`.
2. Adding a `types/js-sdk:wasi/index.d.ts` file.
3. Modifying the esbuild `alias` added by `build_worker`, `build_worker_node`,
   `build_node_cjs`, `build_node_esm`, and `build_browser`.
    - Node overrides are set to `./src/polyfills/node-wasi.ts`.
    - Browser overrides are set to `./src/polyfills/browser-wasi.ts`.

In this manner, differences between the platforms are hidden and the core of
the library can be written in "mutually intelligble" TypeScript.

One notable exception to this rule: Deno implements Node polyfills; for
complicated imports, like `node:worker_threads`, we instead only polyfill the
browser. The browser polyfill is split into `host:node:worker_threads.ts` and
`worker-node-worker_threads.ts`: these polyfill just enough of the Node worker
thread API over the top of builtin workers to make them adhere to the same
interface.

### Testing

Tests are co-located with source code, using the `*.test.ts` pattern. Tests
are run in three forms:

- Interpreted, via `deno test -A`
- Compiled, via `node --test`
- And via playwright, which polyfills `node:test` using `tape` and runs tests
  across firefox, webkit, and chromium.

The `assert` API is polyfilled in browser using
[`rollup-plugin-polyfill-node`](https://npm.im/rollup-plugin-polyfill-node).
This polyfill doesn't track Node's APIs very closely, so it's best to stick to
simple assertions (`assert.equal`.)

## The Extism runtime, shared memory, and worker threads

This SDK defaults to running on background threads in contexts where that is
feasible. Host functions require this library to share memory between the main
and worker threads, however. The rules on transferring buffers are as follows:

- ArrayBuffers may be transferred asynchronously between main and worker threads. Once
  transferred they may no longer be accessed on the sending thread.
- SharedArrayBuffers may be sent _only_ from the main thread. (All browsers allow
  the creation of SharedArrayBuffers off of the main thread, but Chromium disallows
  _sending_ those SharedArrayBuffers to the main thread from the worker.)
- Browser environments disallow using `TextDecoder` against typed arrays backed by
  SharedArrayBuffers. The Extism library handles this transparently by copying out
  of shared memory.

These rules make navigating memory sharing fairly tricky compared to other SDK platforms.
As a result, the JS SDK includes its own extism runtime, which:

- Reserves 16 bits of address space for "page id" information, leaving 48 bits per "page"
  of allocated memory.
- Creates sharedarraybuffers on the worker thread and shares them with the worker thread on
  `call()`.
- Worker-originated pages are transferred up to the main thread and copied into sharedarraybuffers
  whenever the worker transfers control to the main thread (whether returning from a `call()` or
  calling a `hostfn`.)
- When new pages are created during the execution of a `hostfn`, they will be
  _copied down_ to the worker thread using a 64KiB scratch space.
