const { ExtismPlugin, ExtismFunction, ManifestWasmFile } = require("../dist/browser/index")
const { WASI } = require('wasi');
const { argv } = require("node:process");

async function main() {
    const filename = argv[2] || "wasm/hello.wasm";
    const funcname = argv[3] || "run_test";
    const input = argv[4] || "this is a test";
    const wasm = {
        path: filename
    }
    
    const extism = {
        path: "wasm/extism-runtime.wasm"
    }

    const plugin = await ExtismPlugin.newPlugin(wasm, extism, undefined, new Map([
        ["thing", "testing"]
    ]));

    const res = await plugin.call(funcname, new TextEncoder().encode(input));
    const s = new TextDecoder().decode(res.buffer);
    console.log(s)
}


main();