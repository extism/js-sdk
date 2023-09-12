import { ExtismPlugin, ExtismPluginOptions } from '../src/deno/mod.ts'

async function main() {
    const filename = Deno.args[0] || "wasm/hello.wasm";
    const funcname = Deno.args[1] || "run_test";
    const input = Deno.args[2] || "this is a test";
    const wasm = {
        path: filename
    }

    const options = new ExtismPluginOptions()
        .withConfig("thing", "testing")
        .withWasi();

    const plugin = await ExtismPlugin.new(wasm, options);

    const res = await plugin.call(funcname, new TextEncoder().encode(input));
    const s = new TextDecoder().decode(res.buffer);
    console.log(s)
}

main();