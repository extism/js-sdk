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
} from './plugin';

import { WASI, Fd } from '@bjorn3/browser_wasi_shim';
import { minimatch } from 'minimatch'

class ExtismPlugin extends ExtismPluginBase {
  supportsHttpRequests(): boolean {
    return true;
  }

  matches(text: string, pattern: string): boolean {
    return minimatch(text, pattern);
  }

  httpRequest(request: HttpRequest, body: Uint8Array | null): HttpResponse {
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
      case "arraybuffer":
        responseBody = new Uint8Array(xhr.response);
        break;
      case "blob":
        throw new Error("Blob response type is not supported in a synchronous context.");
      case "document":
      case "json":
      case "text":
      case "":
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

  static async calculateHash(data: ArrayBuffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  static async newPlugin(
    manifestData: Manifest | ManifestWasm | Buffer,
    options: ExtismPluginOptions,
  ): Promise<ExtismPlugin> {
    let moduleData = await fetchModuleData(manifestData, this.fetchWasm, this.calculateHash);
    let runtime = await instantiateExtismRuntime(options.runtime, this.fetchWasm);

    return new ExtismPlugin(runtime, moduleData, options);
  }

  static async fetchWasm(wasm: ManifestWasm): Promise<ArrayBuffer> {
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

// @ts-ignore
window.ExtismPlugin = ExtismPlugin;
// @ts-ignore
window.ExtismPluginOptions = ExtismPluginOptions;

export {
  ExtismPlugin,
  ExtismPluginOptions,
  Manifest,
  ManifestWasm,
  ManifestWasmData,
  ManifestWasmFile,
}