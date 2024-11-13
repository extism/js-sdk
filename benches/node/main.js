import createPlugin from '@extism/extism'
import { readFileSync, openSync } from 'node:fs'
import { Bench } from 'tinybench'

{
  const buf = readFileSync('../../wasm/consume.wasm')
  const module = await WebAssembly.compile(buf)

  let plugins = []
  const startup = new Bench({ name: 'createPlugin', time: 100, async teardown() { for (const plugin of plugins) await plugin.close(); plugins.length = 0; } })

  startup
    .add('create consume (foreground; fs)', async () => {
      const plugin = await createPlugin('../../wasm/consume.wasm')
      plugins.push(plugin)
    })
    .add('create consume (background; fs)', async () => {
      const plugin = await createPlugin('../../wasm/consume.wasm', { runInWorker: true })
      plugins.push(plugin)
    })
    .add('create consume (foreground; buffer)', async () => {
      const plugin = await createPlugin({ wasm: [{ data: buf }] })
      plugins.push(plugin)
    })
    .add('create consume (background; buffer)', async () => {
      const plugin = await createPlugin({ wasm: [{ data: buf }] }, { runInWorker: true })
      plugins.push(plugin)
    })
    .add('create consume (foreground; WebAssembly.Module)', async () => {
      const plugin = await createPlugin({ wasm: [{ module }] })
      plugins.push(plugin)
    })
    .add('create consume (background; WebAssembly.Module)', async () => {
      const plugin = await createPlugin({ wasm: [{ module }] }, { runInWorker: true })
      plugins.push(plugin)
    })

  await startup.run()

  for (const plugin of plugins) {
    await plugin.close()
  }
  console.log(startup.name)
  console.table(startup.table())
}

{
  const buf = readFileSync('../../wasm/consume.wasm')
  const module = await WebAssembly.compile(buf)

  const plugin = await createPlugin({ wasm: [{ module }] })
  const backgroundPlugin = await createPlugin({ wasm: [{ module }] }, { runInWorker: true })
  const startup = new Bench({ name: 'write', time: 100 })

  const buffer = new Uint8Array(1 << 20)

  startup
    .add('write consume 1KiB (foreground; WebAssembly.Module)', async () => {
      await plugin.call('consume', buffer.slice(0, 1024))
    })
    .add('write consume 1KiB (background; WebAssembly.Module)', async () => {
      await backgroundPlugin.call('consume', buffer.slice(0, 1024))
    })
    .add('write consume 1MiB (foreground; WebAssembly.Module)', async () => {
      await plugin.call('consume', buffer.slice(0, 1 << 20))
    })
    .add('write consume 1MiB (background; WebAssembly.Module)', async () => {
      await backgroundPlugin.call('consume', buffer.slice(0, 1 << 20))
    })

  await startup.run()
  await plugin.close()
  await backgroundPlugin.close()
  console.log(startup.name)
  console.table(startup.table())
}

{
  const buf = readFileSync('../../wasm/reflect.wasm')
  const module = await WebAssembly.compile(buf)

  const plugin = await createPlugin({ wasm: [{ module }] }, {
    functions: {
      'extism:host/user': {
        host_reflect(context, arg) {
          const buf = context.read(arg).bytes()
          return context.store(buf)
        }
      }
    }
  })
  const backgroundPlugin = await createPlugin({ wasm: [{ module }] }, {
    runInWorker: true,
    functions: {
      'extism:host/user': {
        host_reflect(context, arg) {
          const buf = context.read(arg).bytes()
          return context.store(buf)
        }
      }
    }
  })
  const startup = new Bench({ name: 'reflect', time: 100 })

  const buffer = new Uint8Array(1 << 20)

  startup
    .add('write reflect 1KiB (foreground; WebAssembly.Module)', async () => {
      await plugin.call('reflect', buffer.slice(0, 1024))
    })
    .add('write reflect 1KiB (background; WebAssembly.Module)', async () => {
      await backgroundPlugin.call('reflect', buffer.slice(0, 1024))
    })
    .add('write reflect 1MiB (foreground; WebAssembly.Module)', async () => {
      await plugin.call('reflect', buffer.slice(0, 1 << 20))
    })
    .add('write reflect 1MiB (background; WebAssembly.Module)', async () => {
      await backgroundPlugin.call('reflect', buffer.slice(0, 1 << 20))
    })

  await startup.run()
  await plugin.close()
  await backgroundPlugin.close()
  console.log(startup.name)
  console.table(startup.table())
}
