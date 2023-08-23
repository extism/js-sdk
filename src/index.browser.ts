import { ExtismPluginBase, PluginWasi, ExtismPluginOptions, fetchModuleData, instantiateRuntime, Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile, ManifestWasmUrl } from './plugin'
import { WASI, Fd } from '@bjorn3/browser_wasi_shim';

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
        throw new Error(`Unsupported wasm source: ${wasm}`);
    } else if ((wasm as ManifestWasmUrl).url) {
        const response = await fetch((wasm as ManifestWasmUrl).url);
        data = await response.arrayBuffer();
    } else {
        throw new Error(`Unrecognized wasm source: ${wasm}`);
    }

    return data;
  }

  loadWasi(options: ExtismPluginOptions): PluginWasi {
    const args: Array<string> = [];
    const envVars: Array<string> = [];
    let fds: Fd[] = [
      // new XtermStdio(term), // stdin
      // new XtermStdio(term), // stdout
      // new XtermStdio(term), // stderr
    ];

    const wasi = new WASI(args, envVars, fds);
    return new PluginWasi(wasi, wasi.wasiImport);
  }
}

export {
    ExtismPlugin,
    ExtismPluginOptions,
    Manifest,
    ManifestWasm,
    ManifestWasmFile,
    ManifestWasmData,
    ManifestWasmUrl,
}