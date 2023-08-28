import { ExtismPlugin, ExtismPluginOptions } from '../src/index.node';
import { readFileSync } from 'fs';
import { join } from 'path';

function wasmBuffer(): Buffer {
  return readFileSync(join(__dirname, '/../../wasm/code.wasm'));
}

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

describe('test extism', () => {
  test('can create and call a plugin', async () => {
    const plugin = await newPlugin('code.wasm');
    let output = await plugin.call('count_vowels', 'this is a test');

    let result = JSON.parse(decode(output));
    expect(result['count']).toBe(4);
    output = await plugin.call('count_vowels', 'this is a test again');
    result = JSON.parse(decode(output));
    expect(result['count']).toBe(7);
    output = await plugin.call('count_vowels', 'this is a test thrice');
    result = JSON.parse(decode(output));
    expect(result['count']).toBe(6);
    output = await plugin.call('count_vowels', '🌎hello🌎world🌎');
    result = JSON.parse(decode(output));
    expect(result['count']).toBe(3);
  });

  test('can detect if function exists or not', async () => {
    const plugin = await newPlugin('code.wasm');
    expect(await plugin.functionExists('count_vowels')).toBe(true);
    expect(await plugin.functionExists('i_dont_extist')).toBe(false);
  });

  test('errors when function is not known', async () => {
    const plugin = await newPlugin('code.wasm');
    await expect(plugin.call('i_dont_exist', 'example-input')).rejects.toThrow();
  });

  test('host functions work', async () => {
    const plugin = await newPlugin('code-functions.wasm', options => {
      options.withFunction("env", "hello_world", (off: bigint) => {
        let result = JSON.parse(plugin.allocator.getString(off) ?? "");
        result['message'] = "hello from host!";

        return plugin.allocator.allocString(JSON.stringify(result));
      });
    });

    console.log("plugin options: ", plugin.options.functions);

    const output = await plugin.call('count_vowels', 'aaa');
    const result = JSON.parse(decode(output));

    expect(result).toStrictEqual({
      count: 3,
      message: "hello from host!"
    })
  });
});
