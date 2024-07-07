import { test } from 'node:test';
import assert from 'node:assert';
import createPlugin, { CallContext, CAPABILITIES } from './mod.ts';

if (typeof WebAssembly === 'undefined') {
  test('this platform lacks WebAssembly support', async () => {
    // at the time of writing (2023 Oct 27), playwright webkit builds for windows
    // do not support webassembly. there's an open PR (https://github.com/WebKit/WebKit/pull/18184)
    // to fix this though.
  });
} else {
  // The presence of `*.test.ts` files adjacent to module files is no mistake, sadly:
  // we have to be in the same directory in order to preserve the `__dirname` / `import.meta.url` value
  // between `mod.ts` and the tests in the build output.
  test('createPlugin loads a module and provides lookups', async () => {
    const plugin = await createPlugin('http://localhost:8124/wasm/code.wasm', { useWasi: true });

    try {
      assert(await plugin.functionExists('count_vowels'), 'count_vowels should exist');
      assert(!(await plugin.functionExists('count_sheep')), 'count_sheep should not exist');
    } finally {
      await plugin.close();
    }
  });

  test('createPlugin loads a WebAssembly.Module', async () => {
    const response = await fetch('http://localhost:8124/wasm/code.wasm');
    const arrayBuffer = await response.arrayBuffer();
    const module = await WebAssembly.compile(arrayBuffer);

    const plugin = await createPlugin(module, { useWasi: true });

    try {
      assert(await plugin.functionExists('count_vowels'), 'count_vowels should exist');
      assert(!(await plugin.functionExists('count_sheep')), 'count_sheep should not exist');
    } finally {
      await plugin.close();
    }
  });

  test('createPlugin loads a WebAssembly.Module from manifest', async () => {
    const response = await fetch('http://localhost:8124/wasm/code.wasm');
    const arrayBuffer = await response.arrayBuffer();
    const plugin = await createPlugin(
      { wasm: [{ module: await WebAssembly.compile(arrayBuffer) }] },
      { useWasi: true },
    );

    try {
      assert(await plugin.functionExists('count_vowels'), 'count_vowels should exist');
      assert(!(await plugin.functionExists('count_sheep')), 'count_sheep should not exist');
    } finally {
      await plugin.close();
    }
  });

  test('createPlugin fails if provided a module and hash', async () => {
    const response = await fetch('http://localhost:8124/wasm/code.wasm');
    const arrayBuffer = await response.arrayBuffer();
    const [err, plugin] = await createPlugin(
      { wasm: [{ module: await WebAssembly.compile(arrayBuffer), hash: 'anything' }] },
      { useWasi: true },
    ).then(
      (plugin) => [null, plugin],
      (err) => [err, null],
    );

    if (plugin) {
      await plugin.close();
    }
    assert.equal(plugin, null);
    assert.equal(err.message, 'Item specified a hash but WebAssembly.Module source data is unavailable for hashing');
  });

  test('createPlugin loads a fetch Response', async () => {
    const plugin = await createPlugin(fetch('http://localhost:8124/wasm/code.wasm'), { useWasi: true });

    try {
      assert(await plugin.functionExists('count_vowels'), 'count_vowels should exist');
      assert(!(await plugin.functionExists('count_sheep')), 'count_sheep should not exist');
    } finally {
      await plugin.close();
    }
  });

  if (!CAPABILITIES.crossOriginChecksEnforced) {
    test('can create plugin from url with hash check', async () => {
      const plugin = await createPlugin({
        wasm: [
          {
            url: 'https://github.com/extism/plugins/releases/download/v0.5.0/count_vowels.wasm',
            hash: '93898457953d30d016f712ccf4336ce7e9971db5f7f3aff1edd252764f75d5d7',
          },
        ],
      });

      try {
        assert.equal(await plugin.functionExists('count_vowels'), true);
      } finally {
        await plugin.close();
      }
    });
  }

  test('createPlugin fails on hash mismatch (bad hash)', async () => {
    const [err, plugin] = await createPlugin(
      {
        wasm: [
          {
            url: 'http://localhost:8124/wasm/code.wasm',
            hash: 'not a good hash',
          },
        ],
      },
      { useWasi: true },
    ).then(
      (data) => [null, data],
      (err) => [err, null],
    );

    assert(plugin === null);
    assert(/hash mismatch/.test(err.message));
    if (plugin) {
      await plugin.close();
    }
  });

  test('createPlugin fails on hash mismatch (hash mismatch)', async () => {
    const [err, plugin] = await createPlugin(
      {
        wasm: [
          {
            url: 'http://localhost:8124/wasm/code.wasm',
            hash: '93898457953d30d016f712ccf4336ce7e9971db5f7f3aff1edd252764f75d5d7',
          },
        ],
      },
      { useWasi: true },
    ).then(
      (data) => [null, data],
      (err) => [err, null],
    );

    assert(plugin === null);
    assert(/hash mismatch/.test(err.message));
    if (plugin) {
      await plugin.close();
    }
  });

  test('createPlugin loads a module and provides access to exports/imports', async () => {
    const plugin = await createPlugin({ wasm: [{ url: 'http://localhost:8124/wasm/code.wasm' }] }, { useWasi: true });

    try {
      const exports = await plugin.getExports();
      assert.deepEqual(
        exports.map((xs) => xs.name).sort(),
        ['memory', 'count_vowels', '__data_end', '__heap_base'].sort(),
      );

      const imports = await plugin.getImports();
      assert.deepEqual(
        imports.map((xs) => xs.name).sort(),
        [
          'alloc',
          'config_get',
          'error_set',
          'input_length',
          'input_load_u64',
          'input_load_u8',
          'length',
          'load_u64',
          'load_u8',
          'output_set',
          'store_u64',
          'store_u8',
          'var_get',
          'var_set',
        ].sort(),
      );
    } finally {
      await plugin.close();
    }
  });

  test('createPlugin returns an interface that can call wasm functions', async () => {
    const plugin = await createPlugin({ wasm: [{ url: 'http://localhost:8124/wasm/code.wasm' }] }, { useWasi: true });

    try {
      const result = await plugin.call('count_vowels', 'hello world');
      assert(result, 'result is not null');

      assert.deepEqual(JSON.parse(new TextDecoder().decode(result.buffer)), {
        count: 3,
        total: 3,
        vowels: 'aeiouAEIOU',
      });
    } finally {
      await plugin.close();
    }
  });

  test('logging works as expected', async () => {
    const intercept: Record<string, string> = {};
    const logLevel = (level: string) => (message: string) => (intercept[level] = message);

    // FIXME: we're using non-blocking log functions here; to properly preserve behavior we
    // should invoke these and wait on the host to return.
    const logger = Object.fromEntries(
      ['info', 'debug', 'warn', 'error'].map((lvl) => [lvl, logLevel(lvl)]),
    ) as unknown as Console;

    const plugin = await createPlugin(
      { wasm: [{ url: 'http://localhost:8124/wasm/log.wasm' }] },
      { useWasi: true, logger },
    );

    try {
      await plugin.call('run_test', '');
      assert.deepEqual(intercept, {
        debug: 'this is a debug log',
        error: 'this is an erorr log',
        info: 'this is an info log',
        warn: 'this is a warning log',
      });
    } finally {
      await plugin.close();
    }
  });

  test('host functions may read info from context and return values', async () => {
    let executed: any;
    const functions = {
      'extism:host/user': {
        hello_world(context: CallContext, off: bigint) {
          executed = context.read(off)?.string();
          return context.store('wow okay then');
        },
      },
    };
    const plugin = await createPlugin(
      { wasm: [{ url: 'http://localhost:8124/wasm/code-functions.wasm' }] },
      { useWasi: true, functions },
    );

    try {
      const output = await plugin.call('count_vowels', 'hello world');
      assert.equal(output?.string(), 'wow okay then');
      assert.equal(executed, '{"count": 3}');
    } finally {
      await plugin.close();
    }
  });

  test('resetting the plugin unsets all existing pages', async () => {
    const offsets: bigint[] = [0n, 0n];
    let callContext: CallContext | null = null;

    const functions = {
      'extism:host/user': {
        hello_world(context: CallContext, off: bigint) {
          callContext = context;

          offsets[0] = off;
          offsets[1] = context.store('wow okay then');
          return offsets[1];
        },
      },
    };
    const plugin = await createPlugin(
      { wasm: [{ url: 'http://localhost:8124/wasm/code-functions.wasm' }] },
      { useWasi: true, functions },
    );

    try {
      const output = await plugin.call('count_vowels', 'hello world');
      assert.equal(output?.string(), 'wow okay then');

      await plugin.reset();

      assert(callContext !== null);
      assert.notEqual(offsets[0], 0n);
      assert.notEqual(offsets[1], 0n);
      assert.equal((callContext as CallContext).read(offsets[0]), null);
      assert.equal((callContext as CallContext).read(offsets[1]), null);
    } finally {
      await plugin.close();
    }
  });

  test('host functions reject original promise when throwing', async () => {
    const expected = String(Math.random());
    const functions = {
      'extism:host/user': {
        hello_world(_context: CallContext, _off: bigint) {
          throw new Error(expected);
        },
      },
    };
    const plugin = await createPlugin(
      { wasm: [{ url: 'http://localhost:8124/wasm/code-functions.wasm' }] },
      { useWasi: true, functions },
    );

    try {
      const [err, data] = await plugin.call('count_vowels', 'hello world').then(
        (data) => [null, data],
        (err) => [err, null],
      );

      assert(data === null);
      assert.equal(err?.message, expected);
    } finally {
      await plugin.close();
    }
  });

  test('plugin can get/set variables', async () => {
    const plugin = await createPlugin('http://localhost:8124/wasm/var.wasm', { useWasi: true });
    try {
      const [err, data] = await plugin.call('run_test').then(
        (data) => [null, data],
        (err) => [err, null],
      );

      assert.equal(err, null);
      assert.equal(data.string(), 'a: 0');
    } finally {
      await plugin.close();
    }
  });

  test('plugins cant allocate more var bytes than allowed', async () => {
    const plugin = await createPlugin(
      { wasm: [{ url: 'http://localhost:8124/wasm/memory.wasm' }], memory: { maxVarBytes: 100 } },
      { useWasi: true });

    try {
      const [err, _] = await plugin.call('alloc_var', JSON.stringify({ bytes: 1024 })).then(
        (data) => [null, data],
        (err) => [err, null],
      );

      assert(err)
      assert.equal(err.message, 'var memory limit exceeded: 1024 bytes requested, 100 allowed');
    } finally {
      await plugin.close();
    }
  });

  test('plugins can allocate var bytes if allowed', async () => {
    const plugin = await createPlugin(
      { wasm: [{ url: 'http://localhost:8124/wasm/memory.wasm' }], memory: { maxVarBytes: 1024 } },
      { useWasi: true });

    try {
      const [err, _] = await plugin.call('alloc_var', JSON.stringify({ bytes: 1024 })).then(
        (data) => [null, data],
        (err) => [err, null],
      );

      assert(err === null)
    } finally {
      await plugin.close();
    }
  });

  test('plugins can link', async () => {
    const plugin = await createPlugin({
      wasm: [
        { name: 'main', url: 'http://localhost:8124/wasm/reflect.wasm' },
        { name: 'extism:host/user', url: 'http://localhost:8124/wasm/upper.wasm' },
      ],
    });

    try {
      const [err, data] = await plugin.call('reflect', 'Hello, world!').then(
        (data) => [null, data],
        (err) => [err, null],
      );

      assert.equal(err, null);
      assert.equal(data.string(), 'HELLO, WORLD!');
    } finally {
      await plugin.close();
    }
  });

  test('plugin linking: circular func deps are supported', async () => {
    const plugin = await createPlugin({
      wasm: [
        // these deps also share a memory
        { name: 'lhs', url: 'http://localhost:8124/wasm/circular-lhs.wasm' },
        { name: 'rhs', url: 'http://localhost:8124/wasm/circular-rhs.wasm' },
        { name: 'main', url: 'http://localhost:8124/wasm/circular.wasm' },
      ],
    });

    try {
      // this plugin starts with 1, multiplies by two, adds one, ... recursively, until it's greater than 100.
      const [err, data] = await plugin.call('encalculate', 'Hello, world!').then(
        (data) => [null, data],
        (err) => [err, null],
      );

      assert.equal(err, null);
      assert.equal(data.getBigUint64(0, true), 127);
    } finally {
      await plugin.close();
    }
  });

  test('plugin linking: missing deps are messaged', async () => {
    const [err, plugin] = await createPlugin({
      wasm: [
        { name: 'lhs', url: 'http://localhost:8124/wasm/circular-lhs.wasm' },
        { name: 'main', url: 'http://localhost:8124/wasm/circular.wasm' },
      ],
    }).then(
      (data) => [null, data],
      (err) => [err, null],
    );

    try {
      assert.equal(
        err?.message,
        'from module "main"/"lhs": cannot resolve import "rhs" "add_one": not provided by host imports nor linked manifest items',
      );
      assert.equal(plugin, null);
    } finally {
      if (plugin) await plugin.close();
    }
  });

  if (CAPABILITIES.hasWorkerCapability) {
    test('host functions may be async if worker is off-main-thread', async () => {
      const functions = {
        'extism:host/user': {
          async hello_world(context: CallContext, _off: bigint) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return context.store('it works');
          },
        },
      };

      const plugin = await createPlugin(
        { wasm: [{ url: 'http://localhost:8124/wasm/code-functions.wasm' }] },
        { useWasi: true, functions, runInWorker: true },
      );

      try {
        const output = await plugin.call('count_vowels', 'hello world');
        assert.equal(output?.string(), 'it works');
      } finally {
        await plugin.close();
      }
    });

    test('test writes that span multiple blocks (w/small buffer)', async () => {
      const value = '9:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(18428 / 34);
      const functions = {
        'extism:host/user': {
          async hello_world(context: CallContext, _off: bigint) {
            context.setVariable('hmmm okay storing a variable', 'hello world hello.');
            const result = new TextEncoder().encode(value);
            const ret = context.store(result);
            return ret;
          },
        },
      };

      const plugin = await createPlugin(
        { wasm: [{ url: 'http://localhost:8124/wasm/code-functions.wasm' }] },
        { useWasi: true, functions, runInWorker: true, sharedArrayBufferSize: 1 << 6 },
      );

      let i = 0;
      try {
        for (; i < 10; ++i) {
          const output = await plugin.call('count_vowels', 'hello world');
          assert.equal(output?.string(), value);
        }

        const again = await plugin.call('count_vowels', 'hello world');
        assert.equal(again?.string(), value);
      } finally {
        await plugin.close();
      }
    });

    test('host functions may not be reentrant off-main-thread', async () => {
      const functions = {
        'extism:host/user': {
          async hello_world(context: CallContext, _off: bigint) {
            await plugin?.call('count_vowels', 'hello world');
            return context.store('it works');
          },
        },
      };

      const plugin = await createPlugin(
        { wasm: [{ url: 'http://localhost:8124/wasm/code-functions.wasm' }] },
        { useWasi: true, functions, runInWorker: true },
      );

      try {
        const [err, data] = await plugin.call('count_vowels', 'hello world').then(
          (data) => [null, data],
          (err) => [err, null],
        );

        assert(data === null);
        assert.equal(err?.message, 'plugin is not reentrant');
      } finally {
        await plugin.close();
      }
    });

    if (!CAPABILITIES.crossOriginChecksEnforced)
      test('http fails as expected when no allowed hosts match', async () => {
        const functions = {
          'extism:host/user': {
            async hello_world(context: CallContext, _off: bigint) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              return context.store('it works');
            },
          },
        };

        const plugin = await createPlugin(
          { wasm: [{ name: 'main', url: 'http://localhost:8124/wasm/http.wasm' }] },
          { useWasi: true, functions, runInWorker: true, allowedHosts: ['*.example.com'] },
        );

        try {
          const [err, data] = await plugin
            .call('http_get', '{"url": "https://jsonplaceholder.typicode.com/todos/1"}')
            .then(
              (data) => [null, data],
              (err) => [err, null],
            );

          assert(data === null);
          assert.equal(
            err.message,
            `Call error: HTTP request to "https://jsonplaceholder.typicode.com/todos/1" is not allowed (no allowedHosts match "jsonplaceholder.typicode.com")`,
          );
        } finally {
          await plugin.close();
        }
      });

    test('http works as expected when host is allowed', async () => {
      const plugin = await createPlugin(
        { wasm: [{ name: 'main', url: 'http://localhost:8124/wasm/http.wasm' }], allowedHosts: ['*.typicode.com'], memory: { maxHttpResponseBytes: 100 * 1024 * 1024 } },
        { useWasi: true, functions: {}, runInWorker: true },
      );

      try {
        const [err, data] = await plugin
          .call('http_get', '{"url": "https://jsonplaceholder.typicode.com/todos/1"}')
          .then(
            (data) => [null, data],
            (err) => [err, null],
          );
        assert(err === null);
        assert.deepEqual(data.json(), {
          userId: 1,
          id: 1,
          title: 'delectus aut autem',
          completed: false,
        });
      } finally {
        await plugin.close();
      }
    });

    test('http fails when body is larger than allowed', async () => {
      const plugin = await createPlugin(
        { wasm: [{ name: 'main', url: 'http://localhost:8124/wasm/http.wasm' }], allowedHosts: ['*.typicode.com'], memory: { maxHttpResponseBytes: 1 } },
        { useWasi: true, functions: {}, runInWorker: true },
      );

      try {
        const [err, _] = await plugin
          .call('http_get', '{"url": "https://jsonplaceholder.typicode.com/todos/1"}')
          .then(
            (data) => [null, data],
            (err) => [err, null],
          );

        assert(err)
      } finally {
        await plugin.close();
      }
    });

    test('we fallback to Manifest.allowedHosts if ExtismPluginOptions.allowedHosts is not specified', async () => {
      const plugin = await createPlugin(
        { wasm: [{ name: 'main', url: 'http://localhost:8124/wasm/http.wasm' }], allowedHosts: ['*.typicode.com'] },
        { useWasi: true, functions: {}, runInWorker: true },
      );

      try {
        const [err, data] = await plugin
          .call('http_get', '{"url": "https://jsonplaceholder.typicode.com/todos/1"}')
          .then(
            (data) => [null, data],
            (err) => [err, null],
          );
        assert.equal(err, null);
        assert.deepEqual(data.json(), {
          userId: 1,
          id: 1,
          title: 'delectus aut autem',
          completed: false,
        });
      } finally {
        await plugin.close();
      }
    });
  }

  test('createPlugin fails as expected when calling unknown function', async () => {
    const plugin = await createPlugin('http://localhost:8124/wasm/code.wasm', { useWasi: true });

    try {
      const [err, data] = await plugin.call('reticulate_splines', 'hello world').then(
        (data) => [null, data],
        (err) => [err, null],
      );

      assert(data === null);
      assert.equal(err?.message, 'Plugin error: function "reticulate_splines" does not exist');
    } finally {
      await plugin.close();
    }
  });

  test('plugin can allocate memory', async () => {
    const plugin = await createPlugin('http://localhost:8124/wasm/alloc.wasm');
    try {
      await plugin.call('run_test', '');
    } finally {
      await plugin.close();
    }
  });

  test('plugins cant allocate more memory than allowed', async () => {
    const plugin = await createPlugin(
      { wasm: [{ url: 'http://localhost:8124/wasm/memory.wasm' }], memory: { maxPages: 2 } },
      { useWasi: true });

    const pageSize = 64 * 1024;

    try {
      const [err, _] = await plugin.call('alloc_memory', JSON.stringify({ bytes: pageSize * 5 })).then(
        (data) => [null, data],
        (err) => [err, null],
      );

      assert(err)
    } finally {
      await plugin.close();
    }
  });

  test('plugins can allocate memory if allowed', async () => {
    const plugin = await createPlugin(
      { wasm: [{ url: 'http://localhost:8124/wasm/memory.wasm' }], memory: { maxPages: 6 } },
      { useWasi: true });

    const pageSize = 64 * 1024;

    try {
      const [err, _] = await plugin.call('alloc_memory', JSON.stringify({ bytes: pageSize * 5 })).then(
        (data) => [null, data],
        (err) => [err, null],
      );

      assert(err === null)
    } finally {
      await plugin.close();
    }
  });

  test('plugin can call input_offset', async () => {
    const plugin = await createPlugin('http://localhost:8124/wasm/input_offset.wasm');
    try {
      const input = 'hello world';
      const hw = await plugin.call('input_offset_length', input);
      assert.equal(hw?.getBigUint64(0, true), input.length);
    } finally {
      await plugin.close();
    }
  });

  test('plugin can fail gracefully', async () => {
    const plugin = await createPlugin('http://localhost:8124/wasm/fail.wasm');
    try {
      const [err, data] = await plugin.call('run_test', '').then(
        (data) => [null, data],
        (err) => [err, null],
      );
      assert(data === null);
      assert.equal(err.message, 'Plugin-originated error: Some error message');
    } finally {
      await plugin.close();
    }
  });

  if (CAPABILITIES.supportsWasiPreview1) {
    test('can initialize Haskell runtime', async () => {
      const plugin = await createPlugin('http://localhost:8124/wasm/hello_haskell.wasm', {
        config: { greeting: 'Howdy' },
        useWasi: true,
      });

      try {
        let output = await plugin.call('testing', 'John');

        assert.equal(output?.string(), 'Howdy, John');

        output = await plugin.call('testing', 'Ben');
        assert(output !== null);
        assert.equal(output?.string(), 'Howdy, Ben');
      } finally {
        await plugin.close();
      }
    });

    test('we fallback to Manifest.config if ExtismPluginOptions.config is not specified', async () => {
      const plugin = await createPlugin(
        { wasm: [{ url: 'http://localhost:8124/wasm/hello_haskell.wasm' }], config: { greeting: 'Howdy' } },
        { useWasi: true }
      );

      try {
        let output = await plugin.call('testing', 'John');

        assert.equal(output?.string(), 'Howdy, John');

        output = await plugin.call('testing', 'Ben');
        assert(output !== null);
        assert.equal(output?.string(), 'Howdy, Ben');
      } finally {
        await plugin.close();
      }
    });

    // TODO(chrisdickinson): this turns out to be pretty tricky to test, since
    // deno and node's wasi bindings bypass JS entirely and write directly to
    // their respective FDs. I'm settling for tests that exercise both behaviors.
    test('when EXTISM_ENABLE_WASI_OUTPUT is not set, WASI output is stifled', async () => {
      if ((globalThis as unknown as any).process) {
        (
          globalThis as unknown as Record<string, { env: Record<string, string> }>
        ).process.env.EXTISM_ENABLE_WASI_OUTPUT = '';
      } else if ((globalThis as unknown as any).Deno) {
        globalThis.Deno.env.set('EXTISM_ENABLE_WASI_OUTPUT', '');
      }
      const plugin = await createPlugin('http://localhost:8124/wasm/wasistdout.wasm', {
        useWasi: true,
      });

      try {
        await plugin.call('say_hello');
      } finally {
        await plugin.close();
      }
    });

    test('respects enableWasiOutput', async () => {
      if ((globalThis as unknown as any).process) {
        (
          globalThis as unknown as Record<string, { env: Record<string, string> }>
        ).process.env.EXTISM_ENABLE_WASI_OUTPUT = '';
      } else if ((globalThis as unknown as any).Deno) {
        globalThis.Deno.env.set('EXTISM_ENABLE_WASI_OUTPUT', '');
      }
      const plugin = await createPlugin('http://localhost:8124/wasm/wasistdout.wasm', {
        useWasi: true,
        enableWasiOutput: true,
      });

      try {
        await plugin.call('say_hello');
      } finally {
        await plugin.close();
      }
    });
  }

  if (CAPABILITIES.fsAccess && CAPABILITIES.supportsWasiPreview1) {
    test('can access fs', async () => {
      const plugin = await createPlugin('http://localhost:8124/wasm/fs.wasm', {
        allowedPaths: { '/mnt': 'tests/data' },
        useWasi: true,
      });

      try {
        const output = await plugin.call('run_test', '');
        assert(output !== null);
        const result = output.string();
        assert.equal(result, 'hello world!');
      } finally {
        await plugin.close();
      }
    });

    test('we fallback to Manifest.allowedPaths if ExtismPluginOptions.allowedPaths is not specified', async () => {
      const plugin = await createPlugin(
        { wasm: [{ url: 'http://localhost:8124/wasm/fs.wasm' }], allowedPaths: { '/mnt': 'tests/data' } },
        { useWasi: true }
      );

      try {
        const output = await plugin.call('run_test', '');
        assert(output !== null);
        const result = output.string();
        assert.equal(result, 'hello world!');
      } finally {
        await plugin.close();
      }
    });

    test('linking to a wasi command side-module works', async () => {
      const plugin = await createPlugin(
        {
          wasm: [
            { name: 'side', url: 'http://localhost:8124/wasm/fs.wasm' },
            { name: 'main', url: 'http://localhost:8124/wasm/fs-link.wasm' },
          ],
        },
        {
          allowedPaths: { '/mnt': 'tests/data' },
          useWasi: true,
        },
      );

      try {
        const output = await plugin.call('run_test', '');
        assert(output !== null);
        const result = output.string();
        assert.equal(result, 'hello world!');
      } finally {
        await plugin.close();
      }
    });
  }
}
