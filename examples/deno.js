import { ExtismPlugin, ExtismPluginOptions } from '../dist/deno/extism.js'

async function main() {
    const filename = "wasm/config.wasm";
    const funcname = "run_test";
    const input = "this is a test";
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