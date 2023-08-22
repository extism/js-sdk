import { ExtismPluginBase, PluginWasi, ExtismPluginOptions, fetchModuleData, instantiateRuntime, Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile, ManifestWasmUrl, PluginConfig } from './plugin.ts'
import WASI from 'https://deno.land/std@0.197.0/wasi/snapshot_preview1.ts'

class ExtismPlugin extends ExtismPluginBase {  
  static async newPlugin(manifestData, options) {
    let moduleData = await fetchModuleData(manifestData, this.fetchWasm);
    let runtime = await instantiateRuntime(options.runtime, this.fetchWasm);
    
    return new ExtismPlugin(runtime, moduleData, options.functions, options.config);
  }

  static async fetchWasm(wasm) {
    let data;

    if (wasm.data) {
        data = wasm.data;
    }
    else if (wasm.path) {
      data = await Deno.readFile(wasm.path);
    } else if (wasm.url) {
        const response = await fetch(wasm.url);
        data = await response.arrayBuffer();
    } else {
        throw new Error(`Unrecognized wasm source: ${wasm}`);
    }

    return data;
  }

  loadWasi() {
    const wasi = new WASI({
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
}