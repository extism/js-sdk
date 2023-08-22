import { Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile } from './manifest';
import { ExtismPluginBase, PluginWasi, PluginOptions, fetchModuleData, instantiateRuntime } from './plugin'
import { WASI, Fd } from '@bjorn3/browser_wasi_shim';

export class ExtismPlugin extends ExtismPluginBase {

  static async newPlugin(manifestData: Manifest | ManifestWasm | Buffer, options: PluginOptions) : Promise<ExtismPlugin> {
    let moduleData = await fetchModuleData(manifestData, this.fetchWasm);
    let runtime = await instantiateRuntime(options.runtime, this.fetchWasm);
    
    return new ExtismPlugin(runtime, moduleData, options.functions, options.config);
  }

  static async fetchWasm(wasm: ManifestWasm): Promise<ArrayBuffer> {
    let data: ArrayBuffer = (wasm as ManifestWasmData).data;
    if (!data) {
      const response = await fetch((wasm as ManifestWasmFile).path);
      data = await response.arrayBuffer();
    }

    return data;
  }

  loadWasi(): PluginWasi {

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