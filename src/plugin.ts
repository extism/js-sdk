
export abstract class ExtismPluginBase {
  moduleData: ArrayBuffer;
  allocator: Allocator;
  vars: Record<string, Uint8Array>;
  input: Uint8Array;
  output: Uint8Array;
  module?: WebAssembly.WebAssemblyInstantiatedSource;
  options: ExtismPluginOptions;
  lastStatusCode: number = 0;
  guestRuntime: GuestRuntime;

  constructor(extism: WebAssembly.Instance, moduleData: ArrayBuffer, options: ExtismPluginOptions) {
    this.moduleData = moduleData;
    this.allocator = new Allocator(extism);
    this.vars = {};
    this.input = new Uint8Array();
    this.output = new Uint8Array();
    this.options = options;
    this.guestRuntime = { type: GuestRuntimeType.None, init: () => {}, initialized: true };
  }

  setVar(name: string, value: Uint8Array | string | number): void {
    if (value instanceof Uint8Array) {
      this.vars[name] = value;
    } else if (typeof value === 'string') {
      this.vars[name] = new TextEncoder().encode(value);
    } else if (typeof value === 'number') {
      this.vars[name] = this.uintToLEBytes(value);
    } else {
      throw new Error('Unsupported value type');
    }
  }

  getStringVar(name: string): string {
    return new TextDecoder().decode(this.getVar(name));
  }

  getNumberVar(name: string): number {
    const value = this.getVar(name);
    if (value.length < 4) {
      throw new Error(`Variable ${name} has incorrect length`);
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
    bytes[0] = num & 0xff;
    bytes[1] = (num >> 8) & 0xff;
    bytes[2] = (num >> 16) & 0xff;
    bytes[3] = (num >> 24) & 0xff;
    return bytes;
  }

  private uintFromLEBytes(bytes: Uint8Array): number {
    return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
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

    this.allocator.reset();

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

    this.module = await WebAssembly.instantiate(this.moduleData, imports);

    if (this.module.instance.exports._start) {
      pluginWasi?.initialize(this.module.instance);
    }

    this.guestRuntime = detectGuestRuntime(this.module.instance);

    return this.module;
  }

  private makeEnv(): any {
    const plugin = this;
    var env: any = {
      extism_alloc(n: bigint): bigint {
        const response = plugin.allocator.alloc(n);
        return response;
      },
      extism_free(n: bigint) {
        plugin.allocator.free(n);
      },
      extism_load_u8(n: bigint): number {
        return plugin.allocator.getMemoryBuffer()[Number(n)];
      },
      extism_load_u64(n: bigint): bigint {
        let cast = new DataView(plugin.allocator.getMemory().buffer, Number(n));
        return cast.getBigUint64(0, true);
      },
      extism_store_u8(offset: bigint, n: number) {
        plugin.allocator.getMemoryBuffer()[Number(offset)] = Number(n);
      },
      extism_store_u64(offset: bigint, n: bigint) {
        const tmp = new DataView(plugin.allocator.getMemory().buffer, Number(offset));
        tmp.setBigUint64(0, n, true);
      },
      extism_input_length(): bigint {
        return BigInt(plugin.input.length);
      },
      extism_input_load_u8(i: bigint): number {
        return plugin.input[Number(i)];
      },
      extism_input_load_u64(idx: bigint): bigint {
        let cast = new DataView(plugin.input.buffer, Number(idx));
        return cast.getBigUint64(0, true);
      },
      extism_output_set(offset: bigint, length: bigint) {
        const offs = Number(offset);
        const len = Number(length);
        plugin.output = plugin.allocator.getMemoryBuffer().slice(offs, offs + len);
      },
      extism_error_set(i: bigint) {
        throw new Error(`Call error: ${plugin.allocator.getString(i)}`);
      },
      extism_config_get(i: bigint): bigint {
        if (typeof plugin.options.config === 'undefined') {
          return BigInt(0);
        }
        const key = plugin.allocator.getString(i);
        if (key === null) {
          return BigInt(0);
        }
        const value = plugin.options.config[key];
        if (typeof value === 'undefined') {
          return BigInt(0);
        }
        return plugin.allocator.allocString(value);
      },
      extism_var_get(i: bigint): bigint {
        const key = plugin.allocator.getString(i);
        if (key === null) {
          return BigInt(0);
        }
        const value = plugin.vars[key];
        if (typeof value === 'undefined') {
          return BigInt(0);
        }
        return plugin.allocator.allocBytes(value);
      },
      extism_var_set(n: bigint, i: bigint) {
        const key = plugin.allocator.getString(n);
        if (key === null) {
          return;
        }
        const value = plugin.allocator.getBytes(i);
        if (value === null) {
          return;
        }
        plugin.vars[key] = value;
      },
      extism_http_request(requestOffset: bigint, bodyOffset: bigint): bigint {
        if (!plugin.supportsHttpRequests()) {
          plugin.allocator.free(bodyOffset);
          plugin.allocator.free(requestOffset);
          throw new Error('Call error: http requests are not supported.');
        }

        const requestJson = plugin.allocator.getString(requestOffset);
        if (requestJson == null) {
          throw new Error('Call error: Invalid request.');
        }

        var request: HttpRequest = JSON.parse(requestJson);

        // The actual code starts here
        const url = new URL(request.url);
        let hostMatches = false;
        for (const allowedHost of plugin.options.allowedHosts) {
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
        const body = plugin.allocator.getBytes(bodyOffset);
        plugin.allocator.free(bodyOffset);
        plugin.allocator.free(requestOffset);

        const response = plugin.httpRequest(request, body);
        plugin.lastStatusCode = response.status;

        const offset = plugin.allocator.allocBytes(response.body);

        return offset;
      },
      extism_http_status_code(): number {
        return plugin.lastStatusCode;
      },
      extism_length(i: bigint): bigint {
        return plugin.allocator.getLength(i);
      },
      extism_log_warn(i: bigint) {
        const s = plugin.allocator.getString(i);
        console.warn(s);
      },
      extism_log_info(i: bigint) {
        const s = plugin.allocator.getString(i);
        console.log(s);
      },
      extism_log_debug(i: bigint) {
        const s = plugin.allocator.getString(i);
        console.debug(s);
      },
      extism_log_error(i: bigint) {
        const s = plugin.allocator.getString(i);
        console.error(s);
      },
    };

    return env;
  }
}

/**
 * Represents a path to a WASM module
 */
export type ManifestWasmFile = {
  path: string;
  name?: string;
  hash?: string;
};

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
  url: string;
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
export type ManifestWasm = ManifestWasmUrl | ManifestWasmFile | ManifestWasmData;

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
 *
 * @class ExtismPluginOptions
 */
export class ExtismPluginOptions {
  useWasi: boolean;
  runtime: ManifestWasm | null;
  functions: { [key: string]: { [key: string]: any } };
  allowedPaths: { [key: string]: string };
  allowedHosts: string[];
  config: PluginConfig;

  constructor() {
    this.useWasi = false;
    this.functions = {};
    this.runtime = null;
    this.allowedPaths = {};
    this.config = {};
    this.allowedHosts = [];
  }

  /**
   * Enable/Disable WASI.
   */
  withWasi(value: boolean = true) {
    this.useWasi = value;
    return this;
  }

  /**
   * Overrides the Extism Runtime.
   * @param runtime A Wasm source.
   * @returns ExtismPluginOptions
   */
  withRuntime(runtime: ManifestWasm) {
    this.runtime = runtime;
    return this;
  }

  /**
   * Adds or updates a host function under a specified module name.
   * @param {string} moduleName - The name of the module.
   * @param {string} funcName - The name of the function.
   * @param {any} func - The host function callback.
   * @returns {this} Returns the current instance for chaining.
   */
  withFunction(moduleName: string, funcName: string, func: any) {
    const x = this.functions[moduleName] ?? {};
    x[funcName] = func;
    this.functions[moduleName] = x;

    return this;
  }

  /**
   * Adds or updates an allowed path.
   * If WASI is enabled, the plugin will have access to all allowed paths.
   * @param {string} dest - The destination path.
   * @param {string|null} src - The source path. Defaults to the destination if null.
   * @returns {this} Returns the current instance for chaining.
   */
  withAllowedPath(dest: string, src: string | null) {
    this.allowedPaths[dest] = src || dest;
    return this;
  }

  /**
   * Sets a configuration value that's accessible to the plugin.
   * The plugin can't change configuration values.
   * @param {string} key - The configuration key.
   * @param {string} value - The configuration value.
   * @returns {this} Returns the current instance for chaining.
   */
  withConfig(key: string, value: string) {
    this.config[key] = value;

    return this;
  }

  /**
   * Sets multiple configuration values.
   * @param {{ [key: string]: string }} configs - An object containing configuration key-value pairs.
   * @returns {this} Returns the current instance for chaining.
   */
  withConfigs(configs: { [key: string]: string }) {
    for (let key in configs) {
      this.config[key] = configs[key];
    }

    return this;
  }

  /**
   * Adds a host pattern to the allowed hosts list.
   * The plugin will be able to make HTTP requests to all allowed hosts.
   * By default, all hosts are denied.
   * @param {string} pattern - The host pattern to allow.
   * @returns {this} Returns the current instance for chaining.
   */
  withAllowedHost(pattern: string) {
    this.allowedHosts.push(pattern.trim());

    return this;
  }

  /**
   * Adds multiple host patterns to the allowed hosts list.
   * @param {string[]} patterns - An array of host patterns to allow.
   * @returns {this} Returns the current instance for chaining.
   */
  withAllowedHosts(patterns: string[]) {
    for (const pattern of patterns) {
      this.withAllowedHost(pattern);
    }

    return this;
  }
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

export async function fetchModuleData(
  manifestData: Manifest | ManifestWasm | ArrayBuffer,
  fetchWasm: (wasm: ManifestWasm) => Promise<ArrayBuffer>,
  calculateHash: (buffer: ArrayBuffer) => Promise<string>,
) {
  let moduleData: ArrayBuffer | null = null;

  if (manifestData instanceof ArrayBuffer) {
    moduleData = manifestData;
  } else if ((manifestData as Manifest).wasm) {
    const wasmData = (manifestData as Manifest).wasm;
    if (wasmData.length > 1) throw Error('This runtime only supports one module in Manifest.wasm');

    const wasm = wasmData[0];
    moduleData = await fetchWasm(wasm);
  } else if (
    (manifestData as ManifestWasmData).data ||
    (manifestData as ManifestWasmFile).path ||
    (manifestData as ManifestWasmUrl).url
  ) {
    moduleData = await fetchWasm(manifestData as ManifestWasm);

    const expected = (manifestData as ManifestWasm).hash;

    if (expected) {
      const actual = await calculateHash(moduleData);
      if (actual != expected) {
        throw new Error('Plugin error: hash mismatch');
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
  const none = { init: () => {}, type: GuestRuntimeType.None, initialized: true };
  return haskellRuntime(module) ?? wasiRuntime(module) ?? none;
}

export async function instantiateExtismRuntime(
  runtime: ManifestWasm | null,
  fetchWasm: (wasm: ManifestWasm) => Promise<ArrayBuffer>,
  calculateHash: (buffer: ArrayBuffer) => Promise<string>,
): Promise<WebAssembly.Instance> {
  if (!runtime) {
    throw Error('Please specify Extism runtime.');
  }

  const extismWasm = await fetchModuleData(runtime, fetchWasm, calculateHash);
  const extismModule = new WebAssembly.Module(extismWasm);
  const extismInstance = new WebAssembly.Instance(extismModule, {});

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
	'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';

export const embeddedRuntimeHash = '80fcbfb1d046f0779adf0e3c4861b264a1c56df2d6c9ee051fc02188e83d45f7'

class Allocator {
  #extism: WebAssembly.Instance;

  /**
   * Constructs an allocator instance.
   * @param {WebAssembly.Instance} extism - WebAssembly instance.
   */
  constructor(extism: WebAssembly.Instance) {
    this.#extism = extism;
  }

  /**
   * Resets Extism memory.
   * @returns {void}
   */
  reset() {
    return (this.#extism.exports.extism_reset as Function).call(undefined);
  }

  /**
   * Allocates a block of memory.
   * @param {bigint} length - Size of the memory block.
   * @returns {bigint} Offset in the memory.
   */
  alloc(length: bigint): bigint {
    return (this.#extism.exports.extism_alloc as Function).call(undefined, length);
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
  getBytes(offset: bigint): Uint8Array | null {
    if (offset == BigInt(0)) {
      return null;
    }

    const length = this.getLength(offset);

    return new Uint8Array(this.getMemory().buffer, Number(offset), Number(length));
  }

  /**
   * Retrieves a string from a specific memory offset.
   * @param {bigint} offset - Memory offset.
   * @returns {string | null} Decoded string or null if offset is zero.
   */
  getString(offset: bigint): string | null {
    const bytes = this.getBytes(offset);
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
  allocBytes(data: Uint8Array): bigint {
    const offs = this.alloc(BigInt(data.length));
    const bytes = this.getBytes(offs);
    if (bytes === null) {
      this.free(offs);
      return BigInt(0);
    }

    bytes.set(data);
    return offs;
  }

  /**
   * Allocates a string to the WebAssembly memory.
   * @param {string} data - String to allocate.
   * @returns {bigint} Memory offset.
   */
  allocString(data: string): bigint {
    const bytes = new TextEncoder().encode(data);
    return this.allocBytes(bytes);
  }

  /**
   * Retrieves the length of a memory block from a specific offset.
   * @param {bigint} offset - Memory offset.
   * @returns {bigint} Length of the memory block.
   */
  getLength(offset: bigint): bigint {
    return (this.#extism.exports.extism_length as Function).call(undefined, offset);
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

    (this.#extism.exports.extism_free as Function).call(undefined, offset);
  }
}
