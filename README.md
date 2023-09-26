# Extism JS SDK

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