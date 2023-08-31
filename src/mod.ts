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
} from './plugin.ts';
import Context from 'https://deno.land/std@0.200.0/wasi/snapshot_preview1.ts';
import minimatch from 'https://deno.land/x/minimatch@v3.0.4/index.js';
import { createHash } from 'https://deno.land/std@0.108.0/hash/mod.ts';

class ExtismPlugin extends ExtismPluginBase {
  supportsHttpRequests(): boolean {
    return false;
  }

  httpRequest(_: HttpRequest, __: Uint8Array | null): HttpResponse {
    throw new Error('Method not implemented.');
  }

  matches(text: string, pattern: string): boolean {
    return minimatch(text, pattern);
  }

  static calculateHash(data: ArrayBuffer): Promise<string> {
    return new Promise<string>((resolve) => {
      const hasher = createHash('sha256');
      hasher.update(data);
      resolve(hasher.toString('hex'));
    });
  }

  static async newPlugin(
    manifestData: Manifest | ManifestWasm | ArrayBuffer,
    options: ExtismPluginOptions,
  ): Promise<ExtismPlugin> {
    const moduleData = await fetchModuleData(manifestData, this.fetchWasm, this.calculateHash);
    const runtime = await instantiateExtismRuntime(options.runtime, this.fetchWasm);

    return new ExtismPlugin(runtime, moduleData, options);
  }

  static async fetchWasm(wasm: ManifestWasm): Promise<ArrayBuffer> {
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

  loadWasi(options: ExtismPluginOptions): PluginWasi {
    const context = new Context({
      preopens: options.allowedPaths,
    });

    return new PluginWasi(context, context.exports, instance => this.initialize(context, instance));
  }

  initialize(context: Context, instance: WebAssembly.Instance) {
    const memory = instance.exports.memory as WebAssembly.Memory;

    if (!memory) {
      throw new Error("The module has to export a default memory.")
    }

    context.start({
      exports: {
        memory,
        _start: () => {},
      },
    });
  }
}

export { ExtismPlugin, ExtismPluginOptions };

export type { Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile };
