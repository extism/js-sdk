import { assertEquals, assertRejects } from "https://deno.land/std@0.200.0/assert/mod.ts";
import { ExtismPlugin, ExtismPluginOptions, Manifest, ManifestWasm } from '../src/mod.ts'

async function newPlugin(
  moduleName: string | Manifest | ManifestWasm,
  optionsConfig?: (opts: ExtismPluginOptions) => void,
): Promise<ExtismPlugin> {
  const options = new ExtismPluginOptions()
    .withRuntime({
      path: 'wasm/extism-runtime.wasm',
    })
    .withWasi();

  if (optionsConfig) {
    optionsConfig(options);
  }

  let module : Manifest | ManifestWasm;
  if (typeof moduleName == 'string') {
    module = {
      path: `wasm/${moduleName}`,
    };
  } else {
    module = moduleName;
  }

  const plugin = await ExtismPlugin.newPlugin(module, options);
  return plugin;
}

function decode(buffer: Uint8Array) {
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

Deno.test('can create plugin from url', async () => {
  const plugin = await newPlugin({
    url: "https://raw.githubusercontent.com/extism/extism/main/wasm/code.wasm",
    hash: "7def5bb4aa3843a5daf5d6078f1e8540e5ef10b035a9d9387e9bd5156d2b2565"
  });

  assertEquals(await plugin.functionExists('count_vowels'), true);
});

Deno.test('fails on hash mismatch', async () => {
  await assertRejects(() => newPlugin({
    path: "wasm/code.wasm",
    hash: "----"
  }), Error, "hash mismatch");
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
  await assertRejects(() => plugin.call('i_dont_exist', 'example-input'), Error, "Plugin error");
});

Deno.test('host functions works', async () => {
  const plugin = await newPlugin('code-functions.wasm', options => {
    options.withFunction("env", "hello_world", (off: bigint) => {
      const result = JSON.parse(plugin.allocator.getString(off) ?? "");
      result['message'] = "hello from host!";
      return plugin.allocator.allocString(JSON.stringify(result));
    });
  });

  const output = await plugin.call('count_vowels', 'aaa');
  const result = JSON.parse(decode(output));

  assertEquals(result, {
    count: 3,
    message: "hello from host!"
  });
});