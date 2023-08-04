import { Plugin, PluginOptions } from "./index.js";
import { readFileSync } from "node:fs";
import { argv } from "node:process";

const filename = argv[2];
const funcname = argv[3];
const input = argv[4] || "this is a test";
const wasm = readFileSync(filename);
const opts = new PluginOptions().withWasi(true).withFunction(
  "env",
  "testing",
  (x) => x,
);
const plugin = new Plugin(wasm, opts);
plugin.withConfig("thing", "testing");
const res = await plugin.call(funcname, new TextEncoder().encode(input));
const s = new TextDecoder().decode(res.buffer);
console.log(s);
