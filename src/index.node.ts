import { ExtismPluginBase, PluginWasi, ExtismPluginOptions, fetchModuleData, instantiateRuntime, Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile, ManifestWasmUrl } from './plugin'
import { WASI } from 'wasi'
import { readFile } from "fs"
import { promisify } from "util"

class ExtismPlugin extends ExtismPluginBase {  
  static async newPlugin(manifestData: Manifest | ManifestWasm | Buffer, options: ExtismPluginOptions) : Promise<ExtismPlugin> {
    let moduleData = await fetchModuleData(manifestData, this.fetchWasm);
    let runtime = await instantiateRuntime(options.runtime, this.fetchWasm);
    
    return new ExtismPlugin(runtime, moduleData, options);
  }

  static async fetchWasm(wasm: ManifestWasm): Promise<ArrayBuffer> {
    let data: ArrayBuffer;

    if ((wasm as ManifestWasmData).data) {
        data = (wasm as ManifestWasmData).data;
    }
    else if ((wasm as ManifestWasmFile).path) {
      const readFileAsync = (path: string) => promisify(readFile)(path);

      data = await readFileAsync((wasm as ManifestWasmFile).path);
    } else if ((wasm as ManifestWasmUrl).url) {
        const response = await fetch((wasm as ManifestWasmUrl).url);
        data = await response.arrayBuffer();
    } else {
        throw new Error(`Unrecognized wasm source: ${wasm}`);
    }

    return data;
  }

  loadWasi(options: ExtismPluginOptions): PluginWasi {
    const w = new WASI({
      preopens: options.allowedPaths,
    });

    return new PluginWasi(w, w.wasiImport);
  }
}

export {
    ExtismPlugin,
    ExtismPluginOptions,
    Manifest,
    ManifestWasm,
    ManifestWasmData,
    ManifestWasmFile,
}