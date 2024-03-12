import createPlugin from './src/mod.ts'

const p = await createPlugin('../js-pdk/examples/simple_js/output.wasm', { useWasi: true })

console.log((await p.call('greet', 'hello world')).text())

