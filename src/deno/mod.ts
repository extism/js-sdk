import {
  ExtismPluginBase,
  PluginWasi,
  ExtismPluginOptions,
  fetchModuleData,
  instantiateExtismRuntime,
  Manifest,
  ManifestWasm,
  ManifestWasmData,
  ManifestWasmFile,
  ManifestWasmUrl,
  HttpRequest,
  HttpResponse,
  embeddedRuntime,
} from '../plugin.ts';
import Context from 'https://deno.land/std@0.200.0/wasi/snapshot_preview1.ts';
import minimatch from 'https://deno.land/x/minimatch@v3.0.4/index.js';
import { createHash } from 'https://deno.land/std@0.108.0/hash/mod.ts';
import { decode } from 'https://deno.land/std@0.201.0/encoding/base64.ts';

class ExtismPlugin extends ExtismPluginBase {
  /**
   * Create a new plugin.
   * @param manifestData An Extism manifest {@link Manifest} or a Wasm module.
   * @param options Options for initializing the plugin.
   * @returns {ExtismPlugin} An initialized plugin.
   */
  static async newPlugin(
    manifestData: Manifest | ManifestWasm | ArrayBuffer,
    options: ExtismPluginOptions,
  ): Promise<ExtismPlugin> {
    const moduleData = await fetchModuleData(manifestData, this.fetchWasm, this.calculateHash);

    const runtimeWasm = options.runtime ?? {
      data: decode(embeddedRuntime),
      hash: 'f8219993be45b8f589d78b2fdd8064d3798a34d05fb9eea3a5e985919d88daa7',
    };

    const runtime = await instantiateExtismRuntime(runtimeWasm, this.fetchWasm, this.calculateHash);

    return new ExtismPlugin(runtime, moduleData, options);
  }

  protected supportsHttpRequests(): boolean {
    return false;
  }

  protected httpRequest(_: HttpRequest, __: Uint8Array | null): HttpResponse {
    throw new Error('Method not implemented.');
  }

  protected matches(text: string, pattern: string): boolean {
    return minimatch(text, pattern);
  }

  protected loadWasi(options: ExtismPluginOptions): PluginWasi {
    const context = new Context({
      preopens: options.allowedPaths,
    });

    return new PluginWasi(context, context.exports, (instance) => this.initialize(context, instance));
  }

  private initialize(context: Context, instance: WebAssembly.Instance) {
    const memory = instance.exports.memory as WebAssembly.Memory;

    if (!memory) {
      throw new Error('The module has to export a default memory.');
    }

    context.start({
      exports: {
        memory,
        _start: () => {},
      },
    });
  }

  private static async fetchWasm(wasm: ManifestWasm): Promise<ArrayBuffer> {
    let data: ArrayBuffer;

    if ((wasm as ManifestWasmData).data) {
      data = (wasm as ManifestWasmData).data;
    } else if ((wasm as ManifestWasmFile).path) {
      data = await Deno.readFile((wasm as ManifestWasmFile).path);
    } else if ((wasm as ManifestWasmUrl).url) {
      const response = await fetch((wasm as ManifestWasmUrl).url);
      data = await response.arrayBuffer();
    } else {
      throw new Error(`Unrecognized wasm source: ${wasm}`);
    }

    return data;
  }

  private static calculateHash(data: ArrayBuffer): Promise<string> {
    return new Promise<string>((resolve) => {
      const hasher = createHash('sha256');
      hasher.update(data);
      resolve(hasher.toString('hex'));
    });
  }
}

export { ExtismPlugin, ExtismPluginOptions };

export type { Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile, ManifestWasmUrl };
