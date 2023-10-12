export abstract class ExtismPluginBase {
  moduleData: ArrayBuffer | Response | PromiseLike<Response>;
  currentPlugin: CurrentPlugin;
  input: Uint8Array;
  output: Uint8Array;
  module?: WebAssembly.WebAssemblyInstantiatedSource;
  options: ExtismPluginOptions;
  lastStatusCode: number = 0;
  guestRuntime: GuestRuntime;

  constructor(extism: WebAssembly.Instance, moduleData: ArrayBuffer | Response | PromiseLike<Response>, options: ExtismPluginOptions) {
    this.moduleData = moduleData;
    this.currentPlugin = new CurrentPlugin(this, extism);
    this.input = new Uint8Array();
    this.output = new Uint8Array();
    this.options = options;
    this.guestRuntime = { type: GuestRuntimeType.None, init: () => { }, initialized: true };
  }

  async getExports(): Promise<WebAssembly.Exports> {
    const module = await this.instantiateModule();
    return module.instance.exports;
  }

  async getImports(): Promise<WebAssembly.ModuleImportDescriptor[]> {
    const module = await this.instantiateModule();
    return WebAssembly.Module.imports(module.module);
  }

  async getInstance(): Promise<WebAssembly.Instance> {
    const module = await this.instantiateModule();
    return module.instance;
  }

  /**
   * Check if a function exists in the WebAssembly module.
   *
   * @param {string} name The function's name
   * @returns {Promise<boolean>} true if the function exists, otherwise false
   */
  async functionExists(name: string): Promise<boolean> {
    const module = await this.instantiateModule();
    return module.instance.exports[name] ? true : false;
  }

  /**
   * Call a specific function from the WebAssembly module with provided input.
   *
   * @param {string} func_name The name of the function to call
   * @param {Uint8Array | string} input The input to pass to the function
   * @returns {Promise<Uint8Array>} The result from the function call
   */
  async call(func_name: string, input: Uint8Array | string): Promise<Uint8Array> {
    const module = await this.instantiateModule();

    if (typeof input === 'string') {
      this.input = new TextEncoder().encode(input);
    } else if (input instanceof Uint8Array) {
      this.input = input;
    } else {
      throw new Error('Plugin error: input should be string or Uint8Array');
    }

    this.currentPlugin.reset();

    let func = module.instance.exports[func_name];
    if (!func) {
      throw Error(`Plugin error: function does not exist ${func_name}`);
    }

    if (func_name != '_start' && this.guestRuntime?.init && !this.guestRuntime.initialized) {
      this.guestRuntime.init();
      this.guestRuntime.initialized = true;
    }

    //@ts-ignore
    func();
    return this.output;
  }

  protected abstract loadWasi(options: ExtismPluginOptions): PluginWasi;

  protected abstract supportsHttpRequests(): boolean;

  protected abstract httpRequest(request: HttpRequest, body: Uint8Array | null): HttpResponse;

  protected abstract matches(text: string, pattern: string): boolean;

  private async instantiateModule(): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
    if (this.module) {
      return this.module;
    }

    const environment = this.makeEnv();
    const pluginWasi = this.options.useWasi ? this.loadWasi(this.options) : undefined;

    let imports: any = {
      wasi_snapshot_preview1: pluginWasi?.importObject(),
      env: environment,
    };

    for (const m in this.options.functions) {
      imports[m] = imports[m] || {};
      const map = this.options.functions[m];

      for (const f in map) {
        imports[m][f] = this.options.functions[m][f];
      }
    }

    for (const m in imports) {
      if (m === "wasi_snapshot_preview1") {
        continue;
      }

      for (const f in imports[m]) {
        imports[m][f] = imports[m][f].bind(null, this.currentPlugin);
      }
    }

    if (this.moduleData instanceof ArrayBuffer || ArrayBuffer.isView(this.moduleData)) {
      this.module = await WebAssembly.instantiate(this.moduleData, imports);
    } else {
      this.module = await WebAssembly.instantiateStreaming(this.moduleData, imports);
    }

    if (this.module.instance.exports._start) {
      pluginWasi?.initialize(this.module.instance);
    }

    this.guestRuntime = detectGuestRuntime(this.module.instance);

    return this.module;
  }

  private makeEnv(): any {
    let plugin = this;
    var env: any = {
      extism_alloc(cp: CurrentPlugin, n: bigint): bigint {
        const response = cp.alloc(n);
        return response;
      },
      extism_free(cp: CurrentPlugin, n: bigint) {
        cp.free(n);
      },
      extism_load_u8(cp: CurrentPlugin, n: bigint): number {
        return cp.getMemoryBuffer()[Number(n)];
      },
      extism_load_u64(cp: CurrentPlugin, n: bigint): bigint {
        let cast = new DataView(cp.getMemory().buffer, Number(n));
        return cast.getBigUint64(0, true);
      },
      extism_store_u8(cp: CurrentPlugin, offset: bigint, n: number) {
        cp.getMemoryBuffer()[Number(offset)] = Number(n);
      },
      extism_store_u64(cp: CurrentPlugin, offset: bigint, n: bigint) {
        const tmp = new DataView(cp.getMemory().buffer, Number(offset));
        tmp.setBigUint64(0, n, true);
      },
      extism_input_length(): bigint {
        return BigInt(plugin.input.length);
      },
      extism_input_load_u8(cp: CurrentPlugin, i: bigint): number {
        return plugin.input[Number(i)];
      },
      extism_input_load_u64(cp: CurrentPlugin, idx: bigint): bigint {
        let cast = new DataView(plugin.input.buffer, Number(idx));
        return cast.getBigUint64(0, true);
      },
      extism_output_set(cp: CurrentPlugin, offset: bigint, length: bigint) {
        const offs = Number(offset);
        const len = Number(length);
        plugin.output = cp.getMemoryBuffer().slice(offs, offs + len);
      },
      extism_error_set(cp: CurrentPlugin, i: bigint) {
        throw new Error(`Call error: ${cp.readString(i)}`);
      },
      extism_config_get(cp: CurrentPlugin, i: bigint): bigint {
        if (typeof plugin.options.config === 'undefined') {
          return BigInt(0);
        }
        const key = cp.readString(i);
        if (key === null) {
          return BigInt(0);
        }
        const value = plugin.options.config[key];
        if (typeof value === 'undefined') {
          return BigInt(0);
        }
        return cp.writeString(value);
      },
      extism_var_get(cp: CurrentPlugin, i: bigint): bigint {
        const key = cp.readString(i);
        if (key === null) {
          return BigInt(0);
        }
        const value = cp.vars[key];
        if (typeof value === 'undefined') {
          return BigInt(0);
        }
        return cp.writeBytes(value);
      },
      extism_var_set(cp: CurrentPlugin, n: bigint, i: bigint) {
        const key = cp.readString(n);
        if (key === null) {
          return;
        }
        const value = cp.readBytes(i);
        if (value === null) {
          return;
        }
        cp.vars[key] = value;
      },
      extism_http_request(cp: CurrentPlugin, requestOffset: bigint, bodyOffset: bigint): bigint {
        if (!plugin.supportsHttpRequests()) {
          cp.free(bodyOffset);
          cp.free(requestOffset);
          throw new Error('Call error: http requests are not supported.');
        }

        const requestJson = cp.readString(requestOffset);
        if (requestJson == null) {
          throw new Error('Call error: Invalid request.');
        }

        var request: HttpRequest = JSON.parse(requestJson);

        // The actual code starts here
        const url = new URL(request.url);
        let hostMatches = false;
        for (const allowedHost of (plugin.options.allowedHosts ?? [])) {
          if (allowedHost === url.hostname) {
            hostMatches = true;
            break;
          }

          // Using minimatch for pattern matching
          const patternMatches = plugin.matches(url.hostname, allowedHost);
          if (patternMatches) {
            hostMatches = true;
            break;
          }
        }

        if (!hostMatches) {
          throw new Error(`Call error: HTTP request to '${request.url}' is not allowed`);
        }

        // TODO: limit number of bytes read to 50 MiB
        const body = cp.readBytes(bodyOffset);
        cp.free(bodyOffset);
        cp.free(requestOffset);

        const response = plugin.httpRequest(request, body);
        plugin.lastStatusCode = response.status;

        const offset = cp.writeBytes(response.body);

        return offset;
      },
      extism_http_status_code(): number {
        return plugin.lastStatusCode;
      },
      extism_length(cp: CurrentPlugin, i: bigint): bigint {
        return cp.getLength(i);
      },
      extism_log_warn(cp: CurrentPlugin, i: bigint) {
        const s = cp.readString(i);
        console.warn(s);
      },
      extism_log_info(cp: CurrentPlugin, i: bigint) {
        const s = cp.readString(i);
        console.log(s);
      },
      extism_log_debug(cp: CurrentPlugin, i: bigint) {
        const s = cp.readString(i);
        console.debug(s);
      },
      extism_log_error(cp: CurrentPlugin, i: bigint) {
        const s = cp.readString(i);
        console.error(s);
      },
    };

    return env;
  }
}

/**
 * Represents the raw bytes of a WASM file loaded into memory
 */
export type ManifestWasmData = {
  data: Uint8Array;
  name?: string;
  hash?: string;
};

/**
 * Represents a url to a WASM module
 */
export type ManifestWasmUrl = {
  url: URL | string;
  name?: string;
  hash?: string;
};

/**
 * {@link ExtismPlugin} Config
 */
export type PluginConfig = { [key: string]: string };

/**
 * The WASM to load as bytes, a path, or a url
 */
export type ManifestWasm = ManifestWasmUrl | ManifestWasmData;

/**
 * The manifest which describes the {@link ExtismPlugin} code and
 * runtime constraints.
 *
 * @see [Extism > Concepts > Manifest](https://extism.org/docs/concepts/manifest)
 */
export type Manifest = {
  wasm: Array<ManifestWasm>;
  //memory?: ManifestMemory;
  config?: PluginConfig;
  allowed_hosts?: Array<string>;
};

/**
 * Options for initializing an Extism plugin.
 */
export interface ExtismPluginOptions {
  useWasi?: boolean | undefined;
  runtime?: ManifestWasm | undefined;
  functions?: { [key: string]: { [key: string]: any } } | undefined;
  allowedPaths?: { [key: string]: string } | undefined;
  allowedHosts?: string[] | undefined;
  config?: PluginConfig | undefined;
}

/**
 * Provides a unified interface for the supported WASI implementations.
 */
export class PluginWasi {
  wasi: any;
  imports: any;
  #initialize: (instance: WebAssembly.Instance) => void;

  constructor(wasi: any, imports: any, init: (instance: WebAssembly.Instance) => void) {
    this.wasi = wasi;
    this.imports = imports;
    this.#initialize = init;
  }

  importObject() {
    return this.imports;
  }

  initialize(instance: WebAssembly.Instance) {
    this.#initialize(instance);
  }
}

enum GuestRuntimeType {
  None,
  Haskell,
  Wasi,
}

type GuestRuntime = {
  init: () => void;
  initialized: boolean;
  type: GuestRuntimeType;
};

export type StreamingSource = ArrayBuffer | Response

export function isURL(url: URL | string) {
  return url instanceof URL || url.includes("://");
}

export async function fetchModuleData(
  manifestData: Manifest | ManifestWasm | ArrayBuffer,
  fetchWasm: (wasm: ManifestWasm) => Promise<StreamingSource>,
  calculateHash: (buffer: ArrayBuffer) => Promise<string>,
) {
  let moduleData: StreamingSource | null = null;

  if (manifestData instanceof ArrayBuffer) {
    moduleData = manifestData;
  } else if ((manifestData as Manifest).wasm) {
    const wasmData = (manifestData as Manifest).wasm;
    if (wasmData.length > 1) throw Error('This runtime only supports one module in Manifest.wasm');

    const wasm = wasmData[0];
    moduleData = await fetchWasm(wasm);
  } else if (
    (manifestData as ManifestWasmData).data ||
    (manifestData as ManifestWasmUrl).url
  ) {
    moduleData = await fetchWasm(manifestData as ManifestWasm);

    if (moduleData instanceof Response) {
      // HACK: WebAssembly.instantiateStreaming only works when the content-type is application/wasm
      // This can be problematic because a lot of object storages store the content-type
      // as application/octet-stream by default
      if (moduleData.headers.get('Content-Type') === 'application/octet-stream') {
        const headers = new Headers(moduleData.headers);
        headers.set('Content-Type', 'application/wasm');

        moduleData = new Response(moduleData.body, {
          status: moduleData.status,
          statusText: moduleData.statusText,
          headers: headers,
        })
      }
    }

    const expected = (manifestData as ManifestWasm).hash;

    if (expected) {
      let actual: string;
      if (moduleData instanceof ArrayBuffer || moduleData instanceof Uint8Array) {
        actual = await calculateHash(moduleData);
      } else {
        // Download the content to check its hash
        moduleData = await moduleData.arrayBuffer();
        actual = await calculateHash(moduleData);
      }

      if (actual != expected) {
        throw new Error(`Plugin error: hash mismatch. Expected: ${expected}. Actual: ${actual}`);
      }
    }
  }

  if (!moduleData) {
    throw Error(`Unsure how to interpret manifest ${(manifestData as any).path}`);
  }

  return moduleData;
}

function haskellRuntime(module: WebAssembly.Instance): GuestRuntime | null {
  const haskellInit = module.exports.hs_init;

  if (!haskellInit) {
    return null;
  }

  const reactorInit = module.exports._initialize;

  let init: () => void;
  if (reactorInit) {
    //@ts-ignore
    init = () => reactorInit();
  } else {
    //@ts-ignore
    init = () => haskellInit();
  }

  const kind = reactorInit ? 'reactor' : 'normal';
  console.debug(`Haskell (${kind}) runtime detected.`);

  return { type: GuestRuntimeType.Haskell, init: init, initialized: false };
}

function wasiRuntime(module: WebAssembly.Instance): GuestRuntime | null {
  const reactorInit = module.exports._initialize;
  const commandInit = module.exports.__wasm_call_ctors;

  // WASI supports two modules: Reactors and Commands
  // we prioritize Reactors over Commands
  // see: https://github.com/WebAssembly/WASI/blob/main/legacy/application-abi.md

  let init: () => void;
  if (reactorInit) {
    //@ts-ignore
    init = () => reactorInit();
  } else if (commandInit) {
    //@ts-ignore
    init = () => commandInit();
  } else {
    return null;
  }

  const kind = reactorInit ? 'reactor' : 'command';
  console.debug(`WASI (${kind}) runtime detected.`);

  return { type: GuestRuntimeType.Wasi, init: init, initialized: false };
}

function detectGuestRuntime(module: WebAssembly.Instance): GuestRuntime {
  const none = { init: () => { }, type: GuestRuntimeType.None, initialized: true };
  return haskellRuntime(module) ?? wasiRuntime(module) ?? none;
}

export async function instantiateExtismRuntime(
  runtime: ManifestWasm | null,
  fetchWasm: (wasm: ManifestWasm) => Promise<StreamingSource>,
  calculateHash: (buffer: ArrayBuffer) => Promise<string>,
): Promise<WebAssembly.Instance> {
  if (!runtime) {
    throw Error('Please specify Extism runtime.');
  }

  const extismWasm = await fetchModuleData(runtime, fetchWasm, calculateHash);

  let extismInstance: WebAssembly.Instance;
  if (extismWasm instanceof Response) {
    extismInstance = (await WebAssembly.instantiateStreaming(extismWasm)).instance;
  } else {
    extismInstance = (await WebAssembly.instantiate(extismWasm)).instance;
  }

  return extismInstance;
}

export type HttpResponse = {
  body: Uint8Array;
  status: number;
};

export type HttpRequest = {
  url: string;
  headers: { [key: string]: string };
  method: string;
};

export const embeddedRuntime =
  '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EHJBAEGQARCCgICAABoMAgsgAUEUakIANwIAIAFBATYCDCABQaCAwIAANgIIIAFBkIDAgAA2AhAgAUEIakG0gMCAABCEgICAAAALQQAoAvSAwIAAQRB0IQMLIACnQXRqIgRFDQAgAykDCCADQRBqrXwgAFgNACAENQIIIQILIAFBIGokgICAgAAgAgsIACAApy0AAAsIACAApykDAAsSAEEAKQPIgMCAACAAfKctAAALEgBBACkDyIDAgAAgAHynKQMACwoAIACnIAE6AAALCgAgAKcgATcDAAsYAEEAIAE3A9CAwIAAQQAgADcDyIDAgAALGABBACABNwPggMCAAEEAIAA3A9iAwIAACwsAQQApA9CAwIAACwsAQQApA8iAwIAACwsAQQApA+CAwIAACwsAQQApA9iAwIAAC/ABAQJ/I4CAgIAAQSBrIgAkgICAgABBAEIANwPogMCAAEEAQQAtAPCAwIAAIgFBASABGzoA8IDAgAACQAJAIAENAEEAQQFAACIBNgL0gMCAAAJAIAFBf0YNACABQRB0IgFCADcDACABQvD/AzcDCCABQRByQQBBkAEQgoCAgAAaDAILIABBFGpCADcCACAAQQE2AgwgAEGggMCAADYCCCAAQZCAwIAANgIQIABBCGpBtIDAgAAQhICAgAAAC0EAKAL0gMCAAEEQdCEBCyABQRBqQQAgASgCCBCCgICAABogAUIANwMAIABBIGokgICAgAALDQBBACAANwPogMCAAAsLAEEAKQPogMCAAAvWAQICfwF+I4CAgIAAQSBrIgAkgICAgABBAEEALQDwgMCAACIBQQEgARs6APCAwIAAAkACQCABDQBBAEEBQAAiATYC9IDAgAACQCABQX9GDQAgAUEQdCIBQgA3AwAgAULw/wM3AwggAUEQckEAQZABEIKAgIAAGgwCCyAAQRRqQgA3AgAgAEEBNgIMIABBoIDAgAA2AgggAEGQgMCAADYCECAAQQhqQbSAwIAAEISAgIAAAAtBACgC9IDAgABBEHQhAQsgASkDACECIABBIGokgICAgAAgAgsLTQEAQYCAwAALRAEAAAAAAAAAAQAAAAIAAABPdXQgb2YgbWVtb3J5AAAAEAAQAA0AAABzcmMvbGliLnJzAAAoABAACgAAAJsAAAANAAAA';

export const embeddedRuntimeHash = '1a8172a36acc75aa49c35663c1bb5d89c6ae681863540c7d0afc9e0b93727c59'

export class CurrentPlugin {
  vars: Record<string, Uint8Array>;
  plugin: ExtismPluginBase;
  #extism: WebAssembly.Instance;

  constructor(plugin: ExtismPluginBase, extism: WebAssembly.Instance) {
    this.vars = {};
    this.plugin = plugin;
    this.#extism = extism;
  }

  setVar(name: string, value: Uint8Array | string | number): void {
    if (value instanceof Uint8Array) {
      this.vars[name] = value;
    } else if (typeof value === 'string') {
      this.vars[name] = new TextEncoder().encode(value);
    } else if (typeof value === 'number') {
      this.vars[name] = this.uintToLEBytes(value);
    } else {
      const typeName = (value as any)?.constructor.name || (value === null ? 'null' : typeof value);
      throw new TypeError(`Invalid plugin variable type. Expected Uint8Array, string, or number, got ${typeName}`);
    }
  }

  readStringVar(name: string): string {
    return new TextDecoder().decode(this.getVar(name));
  }

  getNumberVar(name: string): number {
    const value = this.getVar(name);
    if (value.length < 4) {
      throw new Error(`Variable "${name}" has incorrect length`);
    }

    return this.uintFromLEBytes(value);
  }

  getVar(name: string): Uint8Array {
    const value = this.vars[name];
    if (!value) {
      throw new Error(`Variable ${name} not found`);
    }

    return value;
  }

  private uintToLEBytes(num: number): Uint8Array {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, num, true);

    return bytes;
  }

  private uintFromLEBytes(bytes: Uint8Array): number {
    return new DataView(bytes.buffer).getUint32(0, true);
  }

  /**
   * Resets Extism memory.
   * @returns {void}
   */
  reset() {
    return (this.#extism.exports.extism_reset as Function)();
  }

  /**
   * Allocates a block of memory.
   * @param {bigint} length - Size of the memory block.
   * @returns {bigint} Offset in the memory.
   */
  alloc(length: bigint): bigint {
    return (this.#extism.exports.extism_alloc as Function)(length);
  }

  /**
   * Retrieves Extism memory.
   * @returns {WebAssembly.Memory} The memory object.
   */
  getMemory(): WebAssembly.Memory {
    return this.#extism.exports.memory as WebAssembly.Memory;
  }

  /**
   * Retrieves Extism memory buffer as Uint8Array.
   * @returns {Uint8Array} The buffer view.
   */
  getMemoryBuffer(): Uint8Array {
    return new Uint8Array(this.getMemory().buffer);
  }

  /**
   * Gets bytes from a specific memory offset.
   * @param {bigint} offset - Memory offset.
   * @returns {Uint8Array | null} Byte array or null if offset is zero.
   */
  readBytes(offset: bigint): Uint8Array | null {
    if (offset == BigInt(0)) {
      return null;
    }

    const length = this.getLength(offset);

    const buffer = new Uint8Array(this.getMemory().buffer, Number(offset), Number(length));

    // Copy the buffer because `this.getMemory().buffer` returns a write-through view
    return new Uint8Array(buffer);
  }

  /**
   * Retrieves a string from a specific memory offset.
   * @param {bigint} offset - Memory offset.
   * @returns {string | null} Decoded string or null if offset is zero.
   */
  readString(offset: bigint): string | null {
    const bytes = this.readBytes(offset);
    if (bytes === null) {
      return null;
    }

    return new TextDecoder().decode(bytes);
  }

  /**
   * Allocates bytes to the WebAssembly memory.
   * @param {Uint8Array} data - Byte array to allocate.
   * @returns {bigint} Memory offset.
   */
  writeBytes(data: Uint8Array): bigint {
    const offs = this.alloc(BigInt(data.length));
    const buffer = new Uint8Array(this.getMemory().buffer, Number(offs), data.length);
    buffer.set(data);
    return offs;
  }

  /**
   * Allocates a string to the WebAssembly memory.
   * @param {string} data - String to allocate.
   * @returns {bigint} Memory offset.
   */
  writeString(data: string): bigint {
    const bytes = new TextEncoder().encode(data);
    return this.writeBytes(bytes);
  }

  /**
   * Retrieves the length of a memory block from a specific offset.
   * @param {bigint} offset - Memory offset.
   * @returns {bigint} Length of the memory block.
   */
  getLength(offset: bigint): bigint {
    return (this.#extism.exports.extism_length as Function)(offset);
  }

  inputLength(): bigint {
    return (this.#extism.exports.extism_input_length as Function)();
  }

  /**
   * Frees a block of memory from a specific offset.
   * @param {bigint} offset - Memory offset to free.
   * @returns {void}
   */
  free(offset: bigint) {
    if (offset == BigInt(0)) {
      return;
    }

    (this.#extism.exports.extism_free as Function)(offset);
  }
}