import { assertEquals, assertRejects } from 'https://deno.land/std@0.200.0/assert/mod.ts';
import { assertSpyCalls, spy } from 'https://deno.land/std@0.200.0/testing/mock.ts';
import createPlugin, { CurrentPlugin, ExtismPlugin, ExtismPluginOptions, Manifest, ManifestWasm } from '../src/deno/mod.ts';

async function newPlugin(
  moduleName: string | Manifest | ManifestWasm,
  optionsConfig?: (opts: ExtismPluginOptions) => void,
): Promise<ExtismPlugin> {

  const options: ExtismPluginOptions = {
    useWasi: true,
    runtime: {
      url: 'wasm/extism-runtime.wasm',
    },
  }

  if (optionsConfig) {
    optionsConfig(options);
  }

  let module: Manifest | ManifestWasm;
  if (typeof moduleName == 'string') {
    module = {
      url: `wasm/${moduleName}`,
    };
  } else {
    module = moduleName;
  }

  const plugin = await createPlugin(module, options);
  return plugin;
}

function decode(buffer: Uint8Array) {
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

Deno.test('can create plugin from url', async () => {
  const plugin = await newPlugin({
    url: 'https://raw.githubusercontent.com/extism/extism/main/wasm/code.wasm',
    hash: '7def5bb4aa3843a5daf5d6078f1e8540e5ef10b035a9d9387e9bd5156d2b2565',
  });

  assertEquals(await plugin.functionExists('count_vowels'), true);
});

Deno.test('fails on hash mismatch', async () => {
  await assertRejects(
    () =>
      newPlugin({
        url: 'wasm/code.wasm',
        hash: '----',
      }),
    Error,
    'hash mismatch',
  );
});

Deno.test('can use embedded runtime', async () => {
  let module = {
    url: `wasm/code.wasm`,
  };

  const plugin = await createPlugin(module, {
    useWasi: true
  });

  let output = await plugin.call('count_vowels', 'this is a test');
  let result = JSON.parse(decode(output));
  assertEquals(result['count'], 4);
});

Deno.test('can create and call a plugin', async () => {
  const plugin = await newPlugin('code.wasm');
  let output = await plugin.call('count_vowels', 'this is a test');
  let result = JSON.parse(decode(output));
  assertEquals(result['count'], 4);

  output = await plugin.call('count_vowels', 'this is a test again');
  result = JSON.parse(decode(output));
  assertEquals(result['count'], 7);

  output = await plugin.call('count_vowels', 'this is a test thrice');
  result = JSON.parse(decode(output));
  assertEquals(result['count'], 6);

  output = await plugin.call('count_vowels', '🌎hello🌎world🌎');
  result = JSON.parse(decode(output));
  assertEquals(result['count'], 3);
});

Deno.test('can detect if function exists or not', async () => {
  const plugin = await newPlugin('code.wasm');
  assertEquals(await plugin.functionExists('count_vowels'), true);
  assertEquals(await plugin.functionExists('i_dont_extist'), false);
});

Deno.test('can detect if function exists or not', async () => {
  const plugin = await newPlugin('code.wasm');
  assertEquals(await plugin.functionExists('count_vowels'), true);
  assertEquals(await plugin.functionExists('i_dont_extist'), false);
});

Deno.test('errors when function is not known', async () => {
  const plugin = await newPlugin('code.wasm');
  await assertRejects(() => plugin.call('i_dont_exist', 'example-input'), Error, 'Plugin error');
});

Deno.test('host functions works', async () => {
  const plugin = await newPlugin('code-functions.wasm', (options) => {
    options.functions = {
      "env": {
        "hello_world": function (cp: CurrentPlugin, off: bigint) {
          const result = JSON.parse(cp.readString(off) ?? '');
          result['message'] = 'hello from host!';
          return plugin.currentPlugin.writeString(JSON.stringify(result));
        }
      }
    }
  });

  const output = await plugin.call('count_vowels', 'aaa');
  const result = JSON.parse(decode(output));

  assertEquals(result, {
    count: 3,
    message: 'hello from host!',
  });
});

Deno.env.set('NO_COLOR', '1');

Deno.test('plugin can allocate memory', async () => {
  const plugin = await newPlugin('alloc.wasm');
  await plugin.call('run_test', '');
});

Deno.test('plugin can fail gracefully', async () => {
  const plugin = await newPlugin('fail.wasm');
  await assertRejects(() => plugin.call('run_test', ''), Error, 'Call error');
});

Deno.test('can deny http requests', async () => {
  const plugin = await newPlugin('http.wasm');
  await assertRejects(() => plugin.call('run_test', ''), Error, 'http');
});

Deno.test('can allow http requests', async () => {
  const plugin = await newPlugin('http.wasm', (options) => {
    options.allowedHosts = ['*.typicode.com'];
  });

  // http is not supported in Deno
  await assertRejects(() => plugin.call('run_test', ''), Error, 'http');
});

Deno.test('can log messages', async () => {
  const logSpy = spy(console, 'log');
  const warnSpy = spy(console, 'warn');
  const errorSpy = spy(console, 'error');
  const debugSpy = spy(console, 'debug');

  try {
    const plugin = await newPlugin('log.wasm');
    const _ = await plugin.call('run_test', '');
  } finally {
    logSpy.restore();
    warnSpy.restore();
    errorSpy.restore();
    debugSpy.restore();
  }

  assertSpyCalls(logSpy, 1);
  assertSpyCalls(warnSpy, 1);
  assertSpyCalls(errorSpy, 1);
  assertSpyCalls(debugSpy, 1);
});

Deno.test('can initialize Haskell runtime', async () => {
  const plugin = await newPlugin('hello_haskell.wasm', (options) => {
    options.config = { 'greeting': 'Howdy' };
  });

  let output = await plugin.call('testing', 'John');
  let result = decode(output);
  assertEquals(result, 'Howdy, John');

  output = await plugin.call('testing', 'Ben');
  result = decode(output);
  assertEquals(result, 'Howdy, Ben');
});

Deno.test('can access fs', async () => {
  const plugin = await newPlugin('fs.wasm', (options) => {
    options.allowedPaths = { '/mnt': 'tests/data' };
  });

  const output = await plugin.call('run_test', '');
  const result = decode(output);
  assertEquals(result, 'hello world!');
});
