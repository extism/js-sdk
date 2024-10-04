#!/usr/bin/env deno run -A
import createPlugin from '../src/mod.ts';

const filename = Deno.args[0] || 'wasm/hello.wasm';
const funcname = Deno.args[1] || 'run_test';
const input = Deno.args[2] || 'this is a test';

const plugin = await createPlugin(filename, {
  useWasi: true,
  logLevel: 'trace',
  logger: console,
  config: {
    thing: 'testing',
  },
});

console.log('calling', { filename, funcname, input });
const res = await plugin.call(funcname, new TextEncoder().encode(input));
// const s = new TextDecoder().decode(res.buffer);
// console.log(s);

await plugin.close();
