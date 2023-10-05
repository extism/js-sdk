import { createPlugin, ExtismPluginOptions } from '../src/deno/mod.ts'

const filename = Deno.args[0] || "wasm/hello.wasm";
const funcname = Deno.args[1] || "run_test";
const input = Deno.args[2] || "this is a test";
const wasm = {
    path: filename
}

const options = new ExtismPluginOptions()
    .withConfig("thing", "testing")
    .withWasi();

const plugin = await createPlugin(wasm, options);

const res = await plugin.call(funcname, new TextEncoder().encode(input));
const s = new TextDecoder().decode(res.buffer);
console.log(s)