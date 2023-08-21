import { ExtismPluginBase, PluginWasi } from './plugin'
import fetch from 'node-fetch'
import wasi from 'wasi'
import { Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile, PluginConfig } from './manifest';
import { readFileSync } from "fs"

export class ExtismPlugin extends ExtismPluginBase {  
  static async newPlugin(manifestData: Manifest | ManifestWasm | Buffer, extismRuntime: ManifestWasm, functions: Record<string, any> = {}, config?: PluginConfig) : Promise<ExtismPlugin> {
    let moduleData: ArrayBuffer | null = null;

    if (manifestData instanceof ArrayBuffer) {
      moduleData = manifestData;
    } else if ((manifestData as Manifest).wasm) {
      const wasmData = (manifestData as Manifest).wasm;
      if (wasmData.length > 1) throw Error('This runtime only supports one module in Manifest.wasm');

      const wasm = wasmData[0];
      moduleData = await this.fetchWasm(wasm);
    } else if ((manifestData as ManifestWasmData).data || (manifestData as ManifestWasmFile).path) {
      moduleData = await this.fetchWasm(manifestData as ManifestWasm);
    }

    if (!moduleData) {
      throw Error(`Unsure how to interpret manifest ${(manifestData as any).path}`);
    }

    const extismWasm = await this.fetchWasm(extismRuntime);
    const extismModule = new WebAssembly.Module(extismWasm);
    const extismInstance = new WebAssembly.Instance(extismModule, {});

    return new ExtismPlugin(extismInstance, moduleData, functions, config);
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