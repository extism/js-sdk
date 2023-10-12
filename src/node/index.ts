import {
  ExtismPluginBase,
  PluginWasi,
  ExtismPluginOptions,
  fetchModuleData,
  instantiateExtismRuntime,
  Manifest,
  ManifestWasm,
  ManifestWasmData,
  ManifestWasmUrl,
  HttpRequest,
  HttpResponse,
  embeddedRuntime,
  embeddedRuntimeHash,
  CurrentPlugin,
  StreamingSource,
  isURL,
} from '../plugin';
import { WASI } from 'wasi';
import { readFile } from 'fs';
import { promisify } from 'util';
import syncFetch from 'sync-fetch';
import fetchPolyfill from 'node-fetch';
import { minimatch } from 'minimatch';
import { createHash } from 'crypto';
import path from 'path';

class ExtismPlugin extends ExtismPluginBase {
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

    const response = syncFetch(request.url, {
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
        _start: () => { },
      },
    });
  }
}

/**
 * Create a new plugin.
 * @param manifestData An Extism manifest {@link Manifest} or a Wasm module.
 * @param options Options for initializing the plugin.
 * @returns {ExtismPlugin} An initialized plugin.
 */
async function createPlugin(
  manifestData: Manifest | ManifestWasm | Buffer,
  options: ExtismPluginOptions,
): Promise<ExtismPlugin> {
  let moduleData = await fetchModuleData(manifestData, fetchWasm, calculateHash);

  const runtimeWasm = options.runtime ?? {
    data: toBytes(embeddedRuntime),
    hash: embeddedRuntimeHash
  };

  let runtime = await instantiateExtismRuntime(runtimeWasm, fetchWasm, calculateHash);

  return new ExtismPlugin(runtime, moduleData, options);

  async function fetchWasm(wasm: ManifestWasm): Promise<StreamingSource> {
    if ((wasm as ManifestWasmData).data) {
      return Promise.resolve((wasm as ManifestWasmData).data);
    } else if ((wasm as ManifestWasmUrl).url) {
      const url = (wasm as ManifestWasmUrl).url;

      let source: StreamingSource;
      if (isURL(url)) {
        const response = await fetch(url);

        //@ts-ignore
        if (WebAssembly.instantiateStreaming) {
          source = response;
        } else {
          source = await response.arrayBuffer();
        }
      } else {
        const readFileAsync = (path: string) => promisify(readFile)(path);
        const buffer = await readFileAsync(url as string);
        const array = new Uint8Array(buffer);
        source = array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength);
      }

      return source;
    } else {
      throw new Error(`Unrecognized wasm source: ${wasm}`);
    }
  }

  async function calculateHash(data: ArrayBuffer) {
    const hasher = createHash('sha256');
    hasher.update(new Uint8Array(data));
    return new Promise<string>((resolve, _) => resolve(hasher.digest('hex')));
  }

  function toBytes(base64: string): Uint8Array {
    const buffer = Buffer.from(base64, 'base64');
    return new Uint8Array(buffer);
  }
}

export default createPlugin;
export type { ExtismPlugin, CurrentPlugin, ExtismPluginOptions, Manifest, ManifestWasm, ManifestWasmData, ManifestWasmUrl };