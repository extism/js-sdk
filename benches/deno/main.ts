import { createPlugin } from '../../src/mod.ts';

const buf = await Deno.readFile('../../wasm/consume.wasm');
const module = await WebAssembly.compile(buf);

// Plugin creation benchmarks
Deno.bench({
  name: 'create consume (foreground; fs)',
  async fn(b) {
    b.start();
    const plugin = await createPlugin('../../wasm/consume.wasm');
    b.end();
    await plugin.close();
  }
});

Deno.bench({
  name: 'create consume (background; fs)',
  async fn(b) {
    b.start();
    const plugin = await createPlugin('../../wasm/consume.wasm', { runInWorker: true });
    b.end();
    await plugin.close();
  }
});

Deno.bench({
  name: 'create consume (foreground; buffer)',
  async fn(b) {
    b.start();
    const plugin = await createPlugin({ wasm: [{ data: buf }] });
    b.end();
    await plugin.close();
  }
});

Deno.bench({
  name: 'create consume (background; buffer)',
  async fn(b) {
    b.start();
    const plugin = await createPlugin({ wasm: [{ data: buf }] }, { runInWorker: true });
    b.end();
    await plugin.close();
  }
});

Deno.bench({
  name: 'create consume (foreground; WebAssembly.Module)',
  async fn(b) {
    b.start();
    const plugin = await createPlugin({ wasm: [{ module }] });
    b.end();
    await plugin.close();
  }
});

Deno.bench({
  name: 'create consume (background; WebAssembly.Module)',
  async fn(b) {
    b.start();
    const plugin = await createPlugin({ wasm: [{ module }] }, { runInWorker: true });
    b.end();
    await plugin.close();
  }
});

const writeBuffer = new Uint8Array(1 << 30);
const reflectBuf = await Deno.readFile('../../wasm/reflect.wasm');
const reflectModule = await WebAssembly.compile(reflectBuf);

for (const [humanSize, size] of [['1KiB', 1024], ['1MiB', 1 << 20]] as [string, number][]) {
  Deno.bench({
    name: `write consume ${humanSize} (foreground; WebAssembly.Module)`,
    group: 'consume',
    async fn(b) {
      const plugin = await createPlugin({ wasm: [{ module }] }, {});
      b.start()
      await plugin.call('consume', writeBuffer.slice(0, size));
      b.end()
      await plugin.close()
    },
  });

  Deno.bench({
    name: `write consume ${humanSize} (background; WebAssembly.Module)`,
    group: 'consume',
    async fn(b) {
      const plugin = await createPlugin({ wasm: [{ module }] }, { runInWorker: true });
      b.start()
      await plugin.call('consume', writeBuffer.slice(0, size));
      b.end()
      await plugin.close()
    },
  });

  Deno.bench({
    name: `write reflect ${humanSize} (foreground; WebAssembly.Module)`,
    group: 'reflect',
    async fn(b) {
      const plugin = await createPlugin({ wasm: [{ module: reflectModule }] }, {
        functions: {
          'extism:host/user': {
            host_reflect(context, arg) {
              const buf = context.read(arg)!.bytes();
              return context.store(buf);
            }
          }
        }
      });
      b.start()
      await plugin.call('reflect', writeBuffer.slice(0, size));
      b.end()
      await plugin.close()
    },
  });

  Deno.bench({
    name: `write reflect ${humanSize} (background; WebAssembly.Module)`,
    group: 'reflect',
    async fn(b) {
      const plugin = await createPlugin({ wasm: [{ module: reflectModule }] }, {
        runInWorker: true,
        functions: {
          'extism:host/user': {
            host_reflect(context, arg) {
              const buf = context.read(arg)!.bytes();
              return context.store(buf);
            }
          }
        }
      });
      b.start()
      await plugin.call('reflect', writeBuffer.slice(0, size));
      b.end()
      await plugin.close()
    },
  });
}
