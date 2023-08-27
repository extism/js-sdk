const { ExtismPlugin, ExtismPluginOptions } = require("../dist/node/index")
const { argv } = require("node:process");

async function main() {
    const filename = argv[2] || "wasm/hello.wasm";
    const funcname = argv[3] || "run_test";
    const input = argv[4] || "this is a test";
    const wasm = {
        path: filename
    }

    const options = new ExtismPluginOptions()
        .withConfig("thing", "testing")
        .withRuntime({
            path: "wasm/extism-runtime.wasm"
        })
        .withWasi();

    const plugin = await ExtismPlugin.newPlugin(wasm, options);

    const res = await plugin.call(funcname, new TextEncoder().encode(input));
    const s = new TextDecoder().decode(res.buffer);
    console.log(s)
}

main();