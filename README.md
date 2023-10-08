# Extism JS SDK

> **Note**: This houses the 1.0 version of the JavaScript SDK and is a work in progress. Please use the [Node SDK](https://github.com/extism/extism/tree/main/node) or the [Browser SDK](https://github.com/extism/extism/tree/main/browser) in extism/extism until we hit 1.0.

This is a universal JavaScript SDK for Extism. We are aiming for it to work in all the major
JavaScript runtimes:

* Browsers
* Node
* Deno
* Bun

Instead of using FFI and the libextism shared object, this library uses whatever Wasm runtime is already available with the JavaScript runtime.

## Installation

Install via npm:
```
npm install @extism/extism@1.0.0-rc1 --save
```

> **Note**: Keep in mind we will possibly have breaking changes b/w rc versions until we hit 1.0.

## Getting Started

This guide should walk you through some of the concepts in Extism and this JS library.

First you should import `createPlugin` and `ExtismPluginOptions` from Extism:
```js
// CommonJS
const { createPlugin } = require("../dist/node/index")

// ES Modules
import createPlugin from '../src/deno/mod.ts'
```

## Creating A Plug-in

The primary concept in Extism is the [plug-in](https://extism.org/docs/concepts/plug-in). You can think of a plug-in as a code module stored in a `.wasm` file.

Plug-in code can come from a file on disk, object storage or any number of places. Since you may not have one handy let's load a demo plug-in from the web:

```js
const wasm = {
    url: 'https://github.com/extism/plugins/releases/latest/download/count_vowels.wasm'
}

const plugin = await createPlugin(wasm, {
    // NOTE: If you get an error like "TypeError: WebAssembly.instantiate(): Import #0 module="wasi_snapshot_preview1": module is not an object or function", then your plugin requires WASI support
    useWasi: true,
});
```

## Calling A Plug-in's Exports

This plug-in was written in Rust and it does one thing, it counts vowels in a string. As such, it exposes one "export" function: `count_vowels`. We can call exports using `ExtismPlugin.call`:

```js
let out = await plugin.call("count_vowels", new TextEncoder().encode(input));
console.log(new TextDecoder().decode(out.buffer))

// => {"count": 3, "total": 3, "vowels": "aeiouAEIOU"}
```

All exports have a simple interface of optional bytes in, and optional bytes out. This plug-in happens to take a string and return a JSON encoded string with a report of results.

### Plug-in State

Plug-ins may be stateful or stateless. Plug-ins can maintain state b/w calls by the use of variables. Our count vowels plug-in remembers the total number of vowels it's ever counted in the "total" key in the result. You can see this by making subsequent calls to the export:

```js
let out = await plugin.call("count_vowels", new TextEncoder().encode("Hello, World!"));
console.log(new TextDecoder().decode(out.buffer))

// => {"count": 3, "total": 9, "vowels": "aeiouAEIOU"}

out = await plugin.call("count_vowels", new TextEncoder().encode("Hello, World!"));
console.log(new TextDecoder().decode(out.buffer))
// => {"count": 3, "total": 9, "vowels": "aeiouAEIOU"}
```

These variables will persist until this plug-in is freed or you initialize a new one.

### Configuration

Plug-ins may optionally take a configuration object. This is a static way to configure the plug-in. Our count-vowels plugin takes an optional configuration to change out which characters are considered vowels. Example:

```js
const wasm = {
    url: 'https://github.com/extism/plugins/releases/latest/download/count_vowels.wasm'
}

let plugin = await createPlugin(wasm, {
    useWasi: true,
});

let out = await plugin.call("count_vowels", new TextEncoder().encode("Yellow, World!"));
console.log(new TextDecoder().decode(out.buffer))
// => {"count": 3, "total": 3, "vowels": "aeiouAEIOU"}

plugin = await createPlugin(wasm, {
    useWasi: true,
    config: { "vowels": "aeiouyAEIOUY" }
});

out = await plugin.call("count_vowels", new TextEncoder().encode("Yellow, World!"));
console.log(new TextDecoder().decode(out.buffer))
// => {"count": 4, "total": 4, "vowels": "aeiouAEIOUY"}
```

### Host Functions

Let's extend our count-vowels example a little bit: Instead of storing the `total` in an ephemeral plug-in var, let's store it in a persistent key-value store!

Wasm can't use our KV store on it's own. This is where [Host Functions](https://extism.org/docs/concepts/host-functions) come in.

[Host functions](https://extism.org/docs/concepts/host-functions) allow us to grant new capabilities to our plug-ins from our application. They are simply some JS functions you write which can be passed down and invoked from any language inside the plug-in.

Let's load the manifest like usual but load up this `count_vowels_kvstore` plug-in:

```js
const wasm = {
    url: "https://github.com/extism/plugins/releases/latest/download/count_vowels_kvstore.wasm"
}
```

> *Note*: The source code for this is [here](https://github.com/extism/plugins/blob/main/count_vowels_kvstore/src/lib.rs) and is written in rust, but it could be written in any of our PDK languages.

Unlike our previous plug-in, this plug-in expects you to provide host functions that satisfy our its import interface for a KV store.

We want to expose two functions to our plugin, `kv_write(key: string, value: Uint8Array)` which writes a bytes value to a key and `kv_read(key: string): Uint8Array` which reads the bytes at the given `key`.
```js
// pretend this is Redis or something :)
let kvStore = new Map();

const options = {
    useWasi: true,
    functions: {
        "env": {
            "kv_read": function (offs) { // this: CurrentPlugin
                const key = this.readString(offs);
                let value = kvStore.get(key) ?? new Uint8Array([0, 0, 0, 0]);
                console.log(`Read ${new DataView(value.buffer).getUint32(0, true)} from key=${key}`);
                return this.writeBytes(value);
            },
            "kv_write": function (kOffs, vOffs) { // this: CurrentPlugin
                const key = this.readString(kOffs);
                const value = this.readBytes(vOffs);
                console.log(`Writing value=${new DataView(value.buffer).getUint32(0, true)} from key=${key}`);

                kvStore.set(key, value);
            }
        }
    }
};
```

> *Note*: In order to write host functions you should get familiar with the methods on the `CurrentPlugin` type. `this` is bound to an instance of `CurrentPlugin`.

We need to pass these imports to the plug-in to create them. All imports of a plug-in must be satisfied for it to be initialized:

```js
const plugin = await createPlugin(wasm, options);
```

Now we can invoke the event:

```js
let out = await plugin.call("count_vowels", new TextEncoder().encode("Hello World!"));
console.log(new TextDecoder().decode(out.buffer))
// => Read from key=count-vowels"
// => Writing value=3 from key=count-vowels"
// => {"count": 3, "total": 3, "vowels": "aeiouAEIOU"}

out = await plugin.call("count_vowels", new TextEncoder().encode("Hello World!"));
console.log(new TextDecoder().decode(out.buffer))
// => Read from key=count-vowels"
// => Writing value=6 from key=count-vowels"
// => {"count": 3, "total": 6, "vowels": "aeiouAEIOU"}
```

## Run Examples:

```
npm run build

node --experimental-wasi-unstable-preview1 ./examples/node.js wasm/config.wasm

deno run -A ./examples/deno.ts ./wasm/config.wasm

bun run ./examples/node.js wasm/config.wasm
```

## Update `extism-kernel.wasm`:

We are shipping an embedded kernel in base64 form in plugin.ts. To update it, you can run:

```
make update-kernel
```