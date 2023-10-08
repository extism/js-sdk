const { createPlugin } = require("../dist/node/index")
const { argv } = require("process");

async function main() {
    const filename = argv[2] || "wasm/hello.wasm";
    const funcname = argv[3] || "run_test";
    const input = argv[4] || "this is a test";
    const wasm = {
        path: filename
    }

    const plugin = await createPlugin(wasm, {
        useWasi: true,
        config: { "thing": "testing" },
        withAllowedHosts: ["*.typicode.com"]
    })

    const res = await plugin.call(funcname, new TextEncoder().encode(input));
    const s = new TextDecoder().decode(res.buffer);
    console.log(s)
}

main();