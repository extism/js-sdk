import createPlugin, { CurrentPlugin } from '../src/deno/mod.ts'

const filename = Deno.args[0] || "wasm/hello.wasm";
const funcname = Deno.args[1] || "run_test";
const input = Deno.args[2] || "this is a test";
const wasm = {
    url: filename
}

const plugin = await createPlugin(wasm, {
    useWasi: true,
    config: {
        "thing": "testing"
    }
});

const res = await plugin.call(funcname, new TextEncoder().encode(input));
const s = new TextDecoder().decode(res.buffer);
console.log(s)