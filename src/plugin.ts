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

export class ExtismPluginOptions {
  useWasi: boolean;
  functions: { [key: string]: { [key: string]: any } };
  runtime: ManifestWasm | null;
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

  withWasi(value: boolean = true) {
    this.useWasi = value;
    return this;
  }

  withRuntime(runtime: ManifestWasm) {
    this.runtime = runtime;
    return this;
  }

  withFunction(moduleName: string, funcName: string, func: any) {
    const x = this.functions[moduleName] ?? {};
    x[funcName] = func;
    this.functions[moduleName] = x;

    return this;
  }

  withAllowedPath(dest: string, src: string | null) {
    this.allowedPaths[dest] = src || dest;
    return this;
  }

  withConfig(key: string, value: string) {
    this.config[key] = value;

    return this;
  }

  withConfigs(configs: { [key: string]: string }) {
    for (let key in configs) {
      this.config[key] = configs[key];
    }

    return this;
  }

  withAllowedHost(pattern: string) {
    this.allowedHosts.push(pattern.trim());

    return this;
  }

  withAllowedHosts(patterns: string[]) {
    for (const pattern of patterns) {
      this.withAllowedHost(pattern);
    }

    return this;
  }
}

// PluginWasi provides a unified interface for the supported WASI implementations
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
    init = () => haskellInit();
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
) : Promise<WebAssembly.Instance> {
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

export const embeddedRuntime = "AGFzbQEAAAABNQtgAX8AYAN/f38Bf2ACf38AYAF/AX5gAX4BfmABfgBgAX4Bf2ACfn8AYAJ+fgBgAAF+YAAAAxoZAAEBAAIDBAUEBgQGBAcICAgJCQkJCgUJCQQFAXABAwMFAwEAEQYZA38BQYCAwAALfwBBgIHAAAt/AEGAgcAACweVAxYGbWVtb3J5AgAMZXh0aXNtX2FsbG9jAAYLZXh0aXNtX2ZyZWUABw1leHRpc21fbGVuZ3RoAAgOZXh0aXNtX2xvYWRfdTgACQ9leHRpc21fbG9hZF91NjQAChRleHRpc21faW5wdXRfbG9hZF91OAALFWV4dGlzbV9pbnB1dF9sb2FkX3U2NAAMD2V4dGlzbV9zdG9yZV91OAANEGV4dGlzbV9zdG9yZV91NjQADhBleHRpc21faW5wdXRfc2V0AA8RZXh0aXNtX291dHB1dF9zZXQAEBNleHRpc21faW5wdXRfbGVuZ3RoABETZXh0aXNtX2lucHV0X29mZnNldAASFGV4dGlzbV9vdXRwdXRfbGVuZ3RoABMUZXh0aXNtX291dHB1dF9vZmZzZXQAFAxleHRpc21fcmVzZXQAFRBleHRpc21fZXJyb3Jfc2V0ABYQZXh0aXNtX2Vycm9yX2dldAAXE2V4dGlzbV9tZW1vcnlfYnl0ZXMAGApfX2RhdGFfZW5kAwELX19oZWFwX2Jhc2UDAgkIAQBBAQsCAwUKwRAZBAAAAAu1AQEDfwJAAkAgAkEPSw0AIAAhAwwBCyAAQQAgAGtBA3EiBGohBQJAIARFDQAgACEDA0AgAyABOgAAIANBAWoiAyAFSQ0ACwsgBSACIARrIgRBfHEiAmohAwJAIAJBAUgNACABQf8BcUGBgoQIbCECA0AgBSACNgIAIAVBBGoiBSADSQ0ACwsgBEEDcSECCwJAIAJFDQAgAyACaiEFA0AgAyABOgAAIANBAWoiAyAFSQ0ACwsgAAsOACAAIAEgAhCBgICAAAsCAAtMAQF/I4CAgIAAQSBrIgIkgICAgAAgAkEBOgAYIAIgATYCFCACIAA2AhAgAkGAgMCAADYCDCACQYCAwIAANgIIIAJBCGoQgICAgAAACwwAQuLnycndnOOADQvlBAYDfwJ+AX8CfgJ/AXwjgICAgABBIGsiASSAgICAAEEAQQAtAPiAwIAAIgJBASACGzoA+IDAgAACQAJAIAINAEEAQQFAACICNgL8gMCAAAJAIAJBf0YNACACQRB0IgNCADcDACADQvD/AzcDCCADQRByQQBBkAEQgoCAgAAaDAILIAFBFGpBATYCACABQRxqQQA2AgAgAUGggMCAADYCECABQZCAwIAANgIYIAFBADYCCCABQQhqQbyAwIAAEISAgIAAAAtBACgC/IDAgABBEHQhAwsgAykDCCEEAkACQAJAAkACQAJAIAMpAwAiBSADQRBqIgatIgd8IgggB1gNACAApyEJIAYhAgNAAkACQAJAIAItAAAOAwYAAQALIAIoAgQhCgwBCyACKAIEIgogCU8NAwsgCCAKIAJqQRhqIgKtVg0ACwsgBCAFfSAAWA0CDAMLIAogCWsiCkGAAUkNACACQQA2AgggAiAKNgIEIAIgCmoiAkEUakEANgIAIAJBEGogCTYCACACQQxqIgJBAjoAAAsgAkEBOgAAIAIgCTYCCAwCCwJAAkAgALpEAAAAAAAA8D6iRAAAAAAAAOA/oCILRAAAAAAAAPBBYyALRAAAAAAAAAAAZiIKcUUNACALqyEJDAELQQAhCQtBACECQX8gCUEAIAobIAtEAADg////70FkGyIKQABBf0YNASADIAMpAwggCq1CEIZ8NwMICyADIAAgAykDAHxCDHw3AwAgBacgBmoiAiAApyIKNgIIIAIgCjYCBCACQQE6AAALIAFBIGokgICAgAAgAkEMaq1CACACGwv7AQEDfyOAgICAAEEgayIBJICAgIAAQQBBAC0A+IDAgAAiAkEBIAIbOgD4gMCAAAJAAkAgAg0AQQBBAUAAIgI2AvyAwIAAAkAgAkF/Rg0AIAJBEHQiAkIANwMAIAJC8P8DNwMIIAJBEHJBAEGQARCCgICAABoMAgsgAUEUakEBNgIAIAFBHGpBADYCACABQaCAwIAANgIQIAFBkIDAgAA2AhggAUEANgIIIAFBCGpBvIDAgAAQhICAgAAAC0EAKAL8gMCAAEEQdCECCwJAIACnQXRqIgNFDQAgAikDCCACQRBqrXwgAFgNACADQQI6AAALIAFBIGokgICAgAALigIDAX8BfgJ/I4CAgIAAQSBrIgEkgICAgABCACECAkAgAFANAEEAQQAtAPiAwIAAIgNBASADGzoA+IDAgAACQAJAIAMNAEEAQQFAACIDNgL8gMCAAAJAIANBf0YNACADQRB0IgNCADcDACADQvD/AzcDCCADQRByQQBBkAEQgoCAgAAaDAILIAFBFGpBATYCACABQRxqQQA2AgAgAUGggMCAADYCECABQZCAwIAANgIYIAFBADYCCCABQQhqQbyAwIAAEISAgIAAAAtBACgC/IDAgABBEHQhAwsgAKdBdGoiBEUNACADKQMIIANBEGqtfCAAWA0AIAQ1AgghAgsgAUEgaiSAgICAACACCwgAIACnLQAACwgAIACnKQMACxIAQQApA9CAwIAAIAB8py0AAAsSAEEAKQPQgMCAACAAfKcpAwALCgAgAKcgAToAAAsKACAApyABNwMACxgAQQAgATcD2IDAgABBACAANwPQgMCAAAsYAEEAIAE3A+iAwIAAQQAgADcD4IDAgAALCwBBACkD2IDAgAALCwBBACkD0IDAgAALCwBBACkD6IDAgAALCwBBACkD4IDAgAAL+gEBAn8jgICAgABBIGsiACSAgICAAEEAQgA3A/CAwIAAQQBBAC0A+IDAgAAiAUEBIAEbOgD4gMCAAAJAAkAgAQ0AQQBBAUAAIgE2AvyAwIAAAkAgAUF/Rg0AIAFBEHQiAUIANwMAIAFC8P8DNwMIIAFBEHJBAEGQARCCgICAABoMAgsgAEEUakEBNgIAIABBHGpBADYCACAAQaCAwIAANgIQIABBkIDAgAA2AhggAEEANgIIIABBCGpBvIDAgAAQhICAgAAAC0EAKAL8gMCAAEEQdCEBCyABQRBqQQAgASgCCBCCgICAABogAUIANwMAIABBIGokgICAgAALDQBBACAANwPwgMCAAAsLAEEAKQPwgMCAAAvgAQICfwF+I4CAgIAAQSBrIgAkgICAgABBAEEALQD4gMCAACIBQQEgARs6APiAwIAAAkACQCABDQBBAEEBQAAiATYC/IDAgAACQCABQX9GDQAgAUEQdCIBQgA3AwAgAULw/wM3AwggAUEQckEAQZABEIKAgIAAGgwCCyAAQRRqQQE2AgAgAEEcakEANgIAIABBoIDAgAA2AhAgAEGQgMCAADYCGCAAQQA2AgggAEEIakG8gMCAABCEgICAAAALQQAoAvyAwIAAQRB0IQELIAEpAwAhAiAAQSBqJICAgIAAIAILC1UBAEGAgMAAC0wBAAAAAAAAAAEAAAACAAAAT3V0IG9mIG1lbW9yeQAAABAAEAANAAAAa2VybmVsL3NyYy9saWIucnMAAAAoABAAEQAAAJEAAAANAAAA";

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

  uintToLEBytes(num: number): Uint8Array {
    const bytes = new Uint8Array(4);
    bytes[0] = num & 0xff;
    bytes[1] = (num >> 8) & 0xff;
    bytes[2] = (num >> 16) & 0xff;
    bytes[3] = (num >> 24) & 0xff;
    return bytes;
  }

  uintFromLEBytes(bytes: Uint8Array): number {
    return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  }

  async getExports(): Promise<WebAssembly.Exports> {
    const module = await this._instantiateModule();
    return module.instance.exports;
  }

  async getImports(): Promise<WebAssembly.ModuleImportDescriptor[]> {
    const module = await this._instantiateModule();
    return WebAssembly.Module.imports(module.module);
  }

  async getInstance(): Promise<WebAssembly.Instance> {
    const module = await this._instantiateModule();
    return module.instance;
  }

  async functionExists(name: string): Promise<boolean> {
    const module = await this._instantiateModule();
    return module.instance.exports[name] ? true : false;
  }

  async call(func_name: string, input: Uint8Array | string): Promise<Uint8Array> {
    const module = await this._instantiateModule();

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

  abstract loadWasi(options: ExtismPluginOptions): PluginWasi;
  abstract supportsHttpRequests(): boolean;
  abstract httpRequest(request: HttpRequest, body: Uint8Array | null): HttpResponse;
  abstract matches(text: string, pattern: string): boolean;

  async _instantiateModule(): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
    if (this.module) {
      return this.module;
    }

    const environment = this.makeEnv();
    const pluginWasi = this.loadWasi(this.options);

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
      pluginWasi.initialize(this.module.instance);
    }

    this.guestRuntime = detectGuestRuntime(this.module.instance);

    return this.module;
  }

  makeEnv(): any {
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

        // TODO: take allowed hosts into account
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

class Allocator {
  extism: WebAssembly.Instance;

  constructor(extism: WebAssembly.Instance) {
    this.extism = extism;
  }

  reset() {
    return (this.extism.exports.extism_reset as Function).call(undefined);
  }

  alloc(length: bigint): bigint {
    return (this.extism.exports.extism_alloc as Function).call(undefined, length);
  }

  getMemory(): WebAssembly.Memory {
    return this.extism.exports.memory as WebAssembly.Memory;
  }

  getMemoryBuffer(): Uint8Array {
    return new Uint8Array(this.getMemory().buffer);
  }

  getBytes(offset: bigint): Uint8Array | null {
    if (offset == BigInt(0)) {
      return null;
    }

    const length = this.getLength(offset);

    return new Uint8Array(this.getMemory().buffer, Number(offset), Number(length));
  }

  getString(offset: bigint): string | null {
    const bytes = this.getBytes(offset);
    if (bytes === null) {
      return null;
    }

    return new TextDecoder().decode(bytes);
  }

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

  allocString(data: string): bigint {
    const bytes = new TextEncoder().encode(data);
    return this.allocBytes(bytes);
  }

  getLength(offset: bigint): bigint {
    return (this.extism.exports.extism_length as Function).call(undefined, offset);
  }

  free(offset: bigint) {
    if (offset == BigInt(0)) {
      return;
    }

    (this.extism.exports.extism_free as Function).call(undefined, offset);
  }
}
