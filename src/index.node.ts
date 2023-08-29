import {
  ExtismPluginBase,
  PluginWasi,
  ExtismPluginOptions,
  fetchModuleData,
  instantiateRuntime,
  Manifest,
  ManifestWasm,
  ManifestWasmData,
  ManifestWasmFile,
  ManifestWasmUrl,
  HttpRequest,
  HttpResponse,
} from './plugin';
import { WASI } from 'wasi';
import { readFile } from 'fs';
import { promisify } from 'util';
import fetch from 'sync-fetch';
import { minimatch } from 'minimatch';
import { createHash } from 'crypto';

class ExtismPlugin extends ExtismPluginBase {
  matches(text: string, pattern: string): boolean {
    return minimatch(text, pattern);
  }

  supportsHttpRequests(): boolean {
    return true;
  }

  httpRequest(request: HttpRequest, body: Uint8Array | null): HttpResponse {
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

  static async calculateHash(data: ArrayBuffer) {
    const hasher = createHash('sha256');
    hasher.update(new Uint8Array(data));
    return new Promise<string>((resolve, _) => resolve(hasher.digest('hex')));
  }

  static async newPlugin(
    manifestData: Manifest | ManifestWasm | Buffer,
    options: ExtismPluginOptions,
  ): Promise<ExtismPlugin> {
    let moduleData = await fetchModuleData(manifestData, this.fetchWasm, this.calculateHash);
    let runtime = await instantiateRuntime(options.runtime, this.fetchWasm);

    return new ExtismPlugin(runtime, moduleData, options);
  }

  static async fetchWasm(wasm: ManifestWasm): Promise<ArrayBuffer> {
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

  loadWasi(options: ExtismPluginOptions): PluginWasi {
    const w = new WASI({
      preopens: options.allowedPaths,
    });

    return new PluginWasi(w, w.wasiImport);
  }
}

export { ExtismPlugin, ExtismPluginOptions, Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile };
