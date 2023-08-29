import { ExtismPlugin, ExtismPluginOptions, Manifest, ManifestWasm } from '../src/index.node';

async function newPlugin(
  moduleName: string | Manifest | ManifestWasm | Buffer,
  optionsConfig?: (opts: ExtismPluginOptions) => void): Promise<ExtismPlugin> {
  let options = new ExtismPluginOptions()
    .withRuntime({
      path: 'wasm/extism-runtime.wasm',
    })
    .withWasi();

  if (optionsConfig) {
    optionsConfig(options);
  }

  let module : Manifest | ManifestWasm | Buffer;
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

describe('test extism', () => {
  test('can create plugin from url', async () => {
    const plugin = await newPlugin({
      url: "https://raw.githubusercontent.com/extism/extism/main/wasm/code.wasm",
      hash: "7def5bb4aa3843a5daf5d6078f1e8540e5ef10b035a9d9387e9bd5156d2b2565"
    });

    expect(await plugin.functionExists('count_vowels')).toBe(true);
  });

  test('fails on hash mismatch', async () => {
    await expect(newPlugin({
      path: "wasm/code.wasm",
      name: "code",
      hash: "-----------"
    })).rejects.toThrow(/Plugin error/);
  });

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

  test('host functions works', async () => {
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
