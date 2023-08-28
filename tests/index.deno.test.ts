import { assertEquals, assertThrows } from "https://deno.land/std@0.200.0/assert/mod.ts";
import { ExtismPlugin, ExtismPluginOptions } from '../src/mod.ts'
import { assertRejects } from "https://deno.land/std@0.200.0/assert/assert_rejects.ts";


async function newPlugin(
  name: string,
  optionsConfig?: (opts: ExtismPluginOptions) => void,
): Promise<ExtismPlugin> {
  let options = new ExtismPluginOptions()
    .withRuntime({
      path: 'wasm/extism-runtime.wasm',
    })
    .withWasi();

  if (optionsConfig) {
    optionsConfig(options);
  }

  const module = {
    path: `wasm/${name}`,
  };

  const plugin = await ExtismPlugin.newPlugin(module, options);
  return plugin;
}

function decode(buffer: Uint8Array) {
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

// 2. Changing `describe` and `test` functions to match Deno's testing API
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