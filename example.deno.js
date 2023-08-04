import { Plugin, PluginOptions } from "./index.js";

const filename = Deno.args[0];
const funcname = Deno.args[1];
const input = Deno.args[2] || "this is a test";
const wasm = Deno.readFileSync(filename);
const opts = new PluginOptions().withWasi(true);
const plugin = new Plugin(wasm, opts);
plugin.withConfig("thing", "testing");
const res = await plugin.call(funcname, new TextEncoder().encode(input));
const s = new TextDecoder().decode(res.buffer);
console.log(s);
