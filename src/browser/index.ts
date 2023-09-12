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
  embeddedRuntime
} from '../plugin';

import { WASI, Fd } from '@bjorn3/browser_wasi_shim';
import { minimatch } from 'minimatch';

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
      hash: 'f8219993be45b8f589d78b2fdd8064d3798a34d05fb9eea3a5e985919d88daa7'
    };

    let runtime = await instantiateExtismRuntime(runtimeWasm, this.fetchWasm, this.calculateHash);

    return new ExtismPlugin(runtime, moduleData, options);
  }

  protected supportsHttpRequests(): boolean {
    return true;
  }

  protected httpRequest(request: HttpRequest, body: Uint8Array | null): HttpResponse {
    if (request.method == 'GET' || request.method == 'HEAD') {
      body = null;
    }

    const xhr = new XMLHttpRequest();

    // Open the request synchronously
    xhr.open(request.method, request.url, false);

    // Set headers
    for (const key in request.headers) {
      xhr.setRequestHeader(key, request.headers[key]);
    }

    xhr.send(body);

    let responseBody: Uint8Array;

    switch (xhr.responseType) {
      case 'arraybuffer':
        responseBody = new Uint8Array(xhr.response);
        break;
      case 'blob':
        throw new Error('Blob response type is not supported in a synchronous context.');
      case 'document':
      case 'json':
      case 'text':
      case '':
        const encoder = new TextEncoder();
        responseBody = encoder.encode(String(xhr.response));
        break;
      default:
        throw new Error(`Unknown response type: ${xhr.responseType}`);
    }

    return {
      body: responseBody,
      status: xhr.status,
    };
  }

  protected matches(text: string, pattern: string): boolean {
    return minimatch(text, pattern);
  }

  protected loadWasi(options: ExtismPluginOptions): PluginWasi {
    const args: Array<string> = [];
    const envVars: Array<string> = [];
    let fds: Fd[] = [
    ];

    const wasi = new WASI(args, envVars, fds);

    return new PluginWasi(wasi, wasi.wasiImport, instance => this.initialize(wasi, instance));
  }

  private initialize(wasi: WASI, instance: WebAssembly.Instance) {
    const wrapper = {
      exports: {
        memory: instance.exports.memory as WebAssembly.Memory,
        _start() {},
      },
    };

    if (!wrapper.exports.memory) {
      throw new Error('The module has to export a default memory.');
    }

    wasi.start(wrapper);
  }

  private static async fetchWasm(wasm: ManifestWasm): Promise<ArrayBuffer> {
    let data: ArrayBuffer;

    if ((wasm as ManifestWasmData).data) {
      data = (wasm as ManifestWasmData).data;
    } else if ((wasm as ManifestWasmFile).path) {
      throw new Error(`Unsupported wasm source: ${wasm}`);
    } else if ((wasm as ManifestWasmUrl).url) {
      const response = await fetch((wasm as ManifestWasmUrl).url);
      data = await response.arrayBuffer();
    } else {
      throw new Error(`Unrecognized wasm source: ${wasm}`);
    }

    return data;
  }

  private static async calculateHash(data: ArrayBuffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  private static toBytes(base64: string): Uint8Array {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
  
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
  
    return bytes;
  }
}

if (window) {
  // @ts-ignore
  window.ExtismPlugin = ExtismPlugin;
  // @ts-ignore
  window.ExtismPluginOptions = ExtismPluginOptions;
}

export { ExtismPlugin, ExtismPluginOptions, Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile, ManifestWasmUrl };
