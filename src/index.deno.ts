import { ExtismPluginBase, PluginWasi, ExtismPluginOptions, fetchModuleData, instantiateRuntime, Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile, ManifestWasmUrl } from './plugin.ts';
import WASI from 'https://deno.land/std@0.197.0/wasi/snapshot_preview1.ts';

class ExtismPlugin extends ExtismPluginBase {
  static async newPlugin(
    manifestData: Manifest | ManifestWasm | ArrayBuffer,
    options: ExtismPluginOptions,
  ): Promise<ExtismPlugin> {
    const moduleData = await fetchModuleData(manifestData, this.fetchWasm);
    const runtime = await instantiateRuntime(options.runtime, this.fetchWasm);

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
    const wasi = new WASI({
      preopens: options.allowedPaths,
      // preopens: this.allowedPaths,
    });

    return new PluginWasi(wasi, wasi.exports);
  }
}

export {
  ExtismPlugin,
  ExtismPluginOptions,
  // Manifest,
  // ManifestWasm,
  // ManifestWasmData,
  // ManifestWasmFile,
};
