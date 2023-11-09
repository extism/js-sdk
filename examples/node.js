#!/usr/bin/env node --no-warnings
/* eslint-disable @typescript-eslint/no-var-requires */
const createPlugin = require('../dist/cjs').default;
const { argv } = require('process');

async function main() {
  const filename = argv[2] || 'wasm/hello.wasm';
  const funcname = argv[3] || 'run_test';
  const input = argv[4] || 'this is a test';

  const plugin = await createPlugin(filename, {
    useWasi: true,
    config: { thing: 'testing' },
    withAllowedHosts: ['*.typicode.com'],
  });

  const res = await plugin.call(funcname, new TextEncoder().encode(input));
  const s = new TextDecoder().decode(res.buffer);
  console.log(s);

  await plugin.close();
}

main();
