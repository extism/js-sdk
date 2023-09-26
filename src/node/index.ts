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
  embeddedRuntimeHash,
} from '../plugin';
import { WASI } from 'wasi';
import { readFile } from 'fs';
import { promisify } from 'util';
import fetch from 'sync-fetch';
import { minimatch } from 'minimatch';
import { createHash } from 'crypto';

class ExtismPlugin extends ExtismPluginBase {
  /**
   * Create a new plugin.
   * @param manifestData An Extism manifest {@link Manifest} or a Wasm module.
   * @param options Options for initializing the plugin.
   * @returns {ExtismPlugin} An initialized plugin.
   */
  static async new(
    manifestData: Manifest | ManifestWasm | Buffer,
    options: ExtismPluginOptions,
  ): Promise<ExtismPlugin> {
    let moduleData = await fetchModuleData(manifestData, this.fetchWasm, this.calculateHash);

    const runtimeWasm = options.runtime ?? {
      data: this.toBytes(embeddedRuntime),
      hash: embeddedRuntimeHash
    };

    let runtime = await instantiateExtismRuntime(runtimeWasm, this.fetchWasm, this.calculateHash);

    return new ExtismPlugin(runtime, moduleData, options);
  }

  protected supportsHttpRequests(): boolean {
    return true;
  }

  protected httpRequest(request: HttpRequest, body: Uint8Array | null): HttpResponse {
    let b = body
      ? {
          buffer: body,
          byteLength: body.length,
          byteOffset: 0,
        }
      : undefined;

    if (request.method == 'GET' || request.method == 'HEAD') {
      b = undefined;
    }

    const response = fetch(request.url, {
      headers: request.headers,
      method: request.method,
      body: b,
    });

    return {
      body: new Uint8Array(response.arrayBuffer()),
      status: response.status,
    };
  }

  protected matches(text: string, pattern: string): boolean {
    return minimatch(text, pattern);
  }

  protected loadWasi(options: ExtismPluginOptions): PluginWasi {
    const wasi = new WASI({
      //@ts-ignore
      version: 'preview1',
      preopens: options.allowedPaths,
    });

    return new PluginWasi(wasi, wasi.wasiImport, instance => this.initialize(wasi, instance));
  }
  
  private initialize(wasi: WASI, instance: WebAssembly.Instance) {
    const memory = instance.exports.memory as WebAssembly.Memory;

    if (!memory) {
      throw new Error("The module has to export a default memory.")
    }

    wasi.start({
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
  
  private static async calculateHash(data: ArrayBuffer) {
    const hasher = createHash('sha256');
    hasher.update(new Uint8Array(data));
    return new Promise<string>((resolve, _) => resolve(hasher.digest('hex')));
  }

  private static toBytes(base64: string): Uint8Array {
    const buffer = Buffer.from(base64, 'base64');
    return new Uint8Array(buffer);
  }
}

export { ExtismPlugin, ExtismPluginOptions, Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile, ManifestWasmUrl };
