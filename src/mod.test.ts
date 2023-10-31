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
      assert(await plugin.functionExists(['0', 'count_vowels']), '0:count_vowels should exist');
      assert(!(await plugin.functionExists(['dne', 'count_vowels'])), 'dne:count_vowels should not exist');
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
            url: 'https://raw.githubusercontent.com/extism/extism/v0.5.4/wasm/code.wasm',
            hash: '7def5bb4aa3843a5daf5d6078f1e8540e5ef10b035a9d9387e9bd5156d2b2565',
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
            hash: '7def5bb4aa3843a5daf5d6078f1e8540e5ef10b035a9d9387e9bd5156d2b256a',
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
          'extism_alloc',
          'extism_output_set',
          'extism_input_length',
          'extism_input_load_u64',
          'extism_input_load_u8',
          'extism_store_u64',
          'extism_store_u8',
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

      assert.deepEqual(JSON.parse(new TextDecoder().decode(result.buffer)), { count: 3 });
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
      env: {
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
      env: {
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
      env: {
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
      assert.equal(data.string(), 'a: 200');
    } finally {
      await plugin.close();
    }
  });

  if (CAPABILITIES.hasWorkerCapability) {
    test('host functions may be async if worker is off-main-thread', async () => {
      const functions = {
        env: {
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
      const res = await fetch('http://localhost:8124/src/mod.test.ts');
      const result = await res.text();
      const functions = {
        env: {
          async hello_world(context: CallContext, _off: bigint) {
            context.setVariable('hmmm okay storing a variable', 'hello world hello.');
            const res = await fetch('http://localhost:8124/src/mod.test.ts');
            const result = await res.text();
            return context.store(result);
          },
        },
      };

      const plugin = await createPlugin(
        { wasm: [{ url: 'http://localhost:8124/wasm/code-functions.wasm' }] },
        { useWasi: true, functions, runInWorker: true, sharedArrayBufferSize: 1 << 6 },
      );

      try {
        const output = await plugin.call('count_vowels', 'hello world');
        assert.equal(output?.string(), result);

        const again = await plugin.call('count_vowels', 'hello world');
        assert.equal(again?.string(), result);
      } finally {
        await plugin.close();
      }
    });

    test('host functions may not be reentrant off-main-thread', async () => {
      const functions = {
        env: {
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
      test('http works fails as expected when no allowed hosts match', async () => {
        const functions = {
          env: {
            async hello_world(context: CallContext, _off: bigint) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              return context.store('it works');
            },
          },
        };

        const plugin = await createPlugin(
          { wasm: [{ name: 'http', url: 'http://localhost:8124/wasm/http.wasm' }] },
          { useWasi: true, functions, runInWorker: true, allowedHosts: ['*.example.com'] },
        );

        try {
          const [err, data] = await plugin.call('http_get').then(
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
      const functions = {
        env: {
          async hello_world(context: CallContext, _off: bigint) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return context.store('it works');
          },
        };

      const plugin = await createPlugin(
        { wasm: [{ name: 'http', url: 'http://localhost:8124/wasm/http.wasm' }] },
        { useWasi: true, functions, runInWorker: true, allowedHosts: ['*.typicode.com'] },
      );

      try {
        const [err, data] = await plugin.call('http_get').then(
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
  }

  test('createPlugin fails as expected when calling unknown function', async () => {
    const plugin = await createPlugin('http://localhost:8124/wasm/code.wasm', { useWasi: true });

    try {
      const [err, data] = await plugin.call('reticulate_splines', 'hello world').then(
        (data) => [null, data],
        (err) => [err, null],
      );

      assert(data === null);
      assert.equal(err?.message, 'Plugin error: target "reticulate_splines" does not exist');
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
  }
}
