import { ExtismPluginBase, PluginWasi, PluginOptions, fetchModuleData, instantiateRuntime } from './plugin'
import wasi from 'wasi'
import { Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile, PluginConfig } from './manifest';
import { readFileSync } from "fs"

export class ExtismPlugin extends ExtismPluginBase {  
  static async newPlugin(manifestData: Manifest | ManifestWasm | Buffer, options: PluginOptions) : Promise<ExtismPlugin> {
    let moduleData = await fetchModuleData(manifestData, this.fetchWasm);
    let runtime = await instantiateRuntime(options.runtime, this.fetchWasm);
    
    return new ExtismPlugin(runtime, moduleData, options.functions, options.config);
  }

  static async fetchWasm(wasm: ManifestWasm): Promise<ArrayBuffer> {
    let data: ArrayBuffer = (wasm as ManifestWasmData).data;
    if (!data) {
      data = readFileSync((wasm as ManifestWasmFile).path);
    }

    return data;
  }

  loadWasi(): PluginWasi {
    const w = new wasi.WASI({
      // version: "preview1",
      // preopens: this.allowedPaths,
    });

    return new PluginWasi(w, w.wasiImport);
  }
}