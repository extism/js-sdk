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
  CurrentPlugin,
  StreamingSource,
} from '../plugin';

import { WASI, Fd, File, OpenFile } from '@bjorn3/browser_wasi_shim';
import { minimatch } from 'minimatch';

class ExtismPlugin extends ExtismPluginBase {
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
      new OpenFile(new File([])), // stdin
      new OpenFile(new File([])), // stdout
      new OpenFile(new File([])), // stderr
    ];

    const wasi = new WASI(args, envVars, fds);

    return new PluginWasi(wasi, wasi.wasiImport, instance => this.initialize(wasi, instance));
  }

  private initialize(wasi: WASI, instance: WebAssembly.Instance) {
    const wrapper = {
      exports: {
        memory: instance.exports.memory as WebAssembly.Memory,
        _start() { },
      },
    };

    if (!wrapper.exports.memory) {
      throw new Error('The module has to export a default memory.');
    }

    wasi.start(wrapper);
  }
}

/**
 * Create a new plugin.
 * @param manifestData An Extism manifest {@link Manifest} or a Wasm module.
 * @param options Options for initializing the plugin.
 * @returns {ExtismPlugin} An initialized plugin.
 */
async function createPlugin(
  manifestData: Manifest | ManifestWasm | ArrayBuffer,
  options: ExtismPluginOptions,
): Promise<ExtismPlugin> {
  let moduleData = await fetchModuleData(manifestData, fetchWasm, calculateHash);

  const runtimeWasm = options.runtime ?? {
    data: toBytes(embeddedRuntime),
    hash: embeddedRuntimeHash
  };

  let runtime = await instantiateExtismRuntime(runtimeWasm, fetchWasm, calculateHash);

  return new ExtismPlugin(runtime, moduleData, options);

  function toBytes(base64: string): Uint8Array {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
  }

  async function calculateHash(data: ArrayBuffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  async function fetchWasm(wasm: ManifestWasm): Promise<StreamingSource> {
    let data: ArrayBuffer;

    if ((wasm as ManifestWasmData).data) {
      data = (wasm as ManifestWasmData).data;
    } else if ((wasm as ManifestWasmFile).path) {
      throw new Error(`Unsupported wasm source: ${wasm}`);
    } else if ((wasm as ManifestWasmUrl).url) {
      return await fetch((wasm as ManifestWasmUrl).url);
    } else {
      throw new Error(`Unrecognized wasm source: ${wasm}`);
    }

    return data;
  }
}

if (window) {
  // @ts-ignore
  window.createPlugin = createPlugin;
}

export default createPlugin;
export type { ExtismPlugin, CurrentPlugin, ExtismPluginOptions, Manifest, ManifestWasm, ManifestWasmData, ManifestWasmFile, ManifestWasmUrl };
