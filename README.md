# Extism JS SDK

> **Note**: This houses the 1.0 version of the JavaScript SDK and is a work in progress. Please use the [Node SDK](https://github.com/extism/extism/tree/main/node) or the [Browser SDK](https://github.com/extism/extism/tree/main/browser) in extism/extism until we hit 1.0.

This is a universal JavaScript SDK for Extism. We are aiming for it to work in all the major
JavaScript runtimes:

* Browsers
* Node
* Deno
* Bun

Instead of using FFI and the libextism shared object, this library uses whatever Wasm runtime is already available with the JavaScript runtime.


## Install

```
npm install -g @extism/extism@1.0.0-rc1 --save
```

Or put in your package.json:

```
"@extism/extism": "1.0.0-rc1",
```

> **Note**: Keep in mind we will possibly have breaking changes b/w rc versions until we hit 1.0.

## API

We'll be publishing more docs very soon. For the time being look at [these tests](src/tests/mod.test.ts)
for up to date examples.

## Run Examples:

```
npm run build

node --experimental-wasi-unstable-preview1 ./examples/node.js wasm/config.wasm

deno run -A ./examples/deno.js ./wasm/config.wasm

bun run ./examples/node.js wasm/config.wasm
```

## Update `extism-kernel.wasm`:

We are shipping an embedded kernel in base64 form in plugin.ts. To update it, you can run these commands:

```
make update-kernel
```
