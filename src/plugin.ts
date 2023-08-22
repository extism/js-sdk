import Allocator from './allocator';
import { PluginConfig, Manifest, ManifestWasmData, ManifestWasmFile, ManifestWasm, ManifestWasmUrl } from './manifest';

export type ExtismFunction = any;

export class ExtismPluginOptions {
  useWasi: boolean;
  functions: Map<string, Map<string, ExtismFunction>>;
  runtime: ManifestWasm | null;
  allowedPaths: Map<string, string>;
  config: PluginConfig;

  constructor() {
    this.useWasi = false;
    this.functions = new Map<string, Map<string, ExtismFunction>>();
    this.runtime = null;
    this.allowedPaths = new Map<string, string>();
    this.config = new Map<string, string>();
  }

  withWasi(value: boolean = true) {
    this.useWasi = value;
    return this;
  }

  withRuntime(runtime: ManifestWasm) {
    this.runtime = runtime;
    return this;
  }

  withFunction(moduleName: string, funcName: string, func: ExtismFunction) {
    const x = this.functions.get(moduleName) ?? new Map<string, string>();
    x.set(funcName, func);
    this.functions.set(moduleName, x);

    return this;
  }

  withAllowedPath(dest: string, src: string | null) {
    this.allowedPaths.set(dest, src || dest);
    return this;
  }

  withConfig(key: string, value: string) {
    this.config.set(key, value);

    return this;
  }

  withConfigs(configs: Map<string, string>) {
    for (let key in configs) {
      this.config.set(key, configs.get(key)!)
    }

    return this;
  }
}

// PluginWasi provides a unified interface for the supported WASI implementations
export class PluginWasi {
  wasi: any;
  imports: any;

  constructor(wasi: any, imports: any) {
    this.wasi = wasi;
    this.imports = imports;
  }

  importObject() {
    return this.imports;
  }

  initialize() {}
}

export async function fetchModuleData(manifestData: Manifest | ManifestWasm | Buffer, fetchWasm: (wasm: ManifestWasm) => Promise<ArrayBuffer>) {

  let moduleData: ArrayBuffer | null = null;
  if (manifestData instanceof ArrayBuffer) {
    moduleData = manifestData;
  } else if ((manifestData as Manifest).wasm) {
    const wasmData = (manifestData as Manifest).wasm;
    if (wasmData.length > 1) throw Error('This runtime only supports one module in Manifest.wasm');

    const wasm = wasmData[0];
    moduleData = await fetchWasm(wasm);
  } else if ((manifestData as ManifestWasmData).data || (manifestData as ManifestWasmFile).path || (manifestData as ManifestWasmUrl).url) {
    moduleData = await fetchWasm(manifestData as ManifestWasm);
  }

  if (!moduleData) {
    throw Error(`Unsure how to interpret manifest ${(manifestData as any).path}`);
  }

  return moduleData;
}

export async function instantiateRuntime(runtime: ManifestWasm | null, fetchWasm: (wasm: ManifestWasm) => Promise<ArrayBuffer>) {
  if (!runtime) {
    throw Error("Please specify Extism runtime.");
  }

  const extismWasm = await fetchWasm(runtime);
  const extismModule = new WebAssembly.Module(extismWasm);
  const extismInstance = new WebAssembly.Instance(extismModule, {});

  return extismInstance;
}

export abstract class ExtismPluginBase {
  moduleData: ArrayBuffer;
  allocator: Allocator;
  config?: PluginConfig;
  vars: Record<string, Uint8Array>;
  input: Uint8Array;
  output: Uint8Array;
  module?: WebAssembly.WebAssemblyInstantiatedSource;
  functions: Map<string, Map<string, ExtismFunction>>;

  constructor(
    extism: WebAssembly.Instance,
    moduleData: ArrayBuffer,
    functions: Map<string, Map<string, ExtismFunction>>,
    config?: PluginConfig,
  ) {
    this.moduleData = moduleData;
    this.allocator = new Allocator(extism);
    this.config = config;
    this.vars = {};
    this.input = new Uint8Array();
    this.output = new Uint8Array();
    this.functions = functions;
  }

  static async fetchData(wasm: ManifestWasm, fetch: (url: string) => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    let data: ArrayBuffer = (wasm as ManifestWasmData).data;

    if (!data) {
      data = await fetch((wasm as ManifestWasmFile).path);
    }

    return data;
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

  async call(func_name: string, input: Uint8Array | string): Promise<Uint8Array> {
    const module = await this._instantiateModule();

    if (typeof input === 'string') {
      this.input = new TextEncoder().encode(input);
    } else if (input instanceof Uint8Array) {
      this.input = input;
    } else {
      throw new Error('input should be string or Uint8Array');
    }

    this.allocator.reset();

    let func = module.instance.exports[func_name];
    if (!func) {
      throw Error(`function does not exist ${func_name}`);
    }
    //@ts-ignore
    func();
    return this.output;
  }

  abstract loadWasi(): PluginWasi;

  async _instantiateModule(): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
    if (this.module) {
      return this.module;
    }
    const environment = this.makeEnv();
    const pluginWasi = this.loadWasi();

    let imports: any = {
      wasi_snapshot_preview1: pluginWasi?.importObject(),
      env: environment,
    };

    this.module = await WebAssembly.instantiate(this.moduleData, imports);

    for (const m in this.functions) {
      imports[m] = imports[m] || {};
      const map = this.functions.get(m);

      for (const f in map) {
        imports[m][f] = this.functions.get(m)?.get(f);
      }
    }

    // normally we would call wasi.start here but it doesn't respect when there is
    // no _start function
    //@ts-ignore
    pluginWasi.inst = this.module.instance;
    if (this.module.instance.exports._start) {
      //@ts-ignore
      pluginWasi.wasi.start(this.module.instance);
    }
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
        throw plugin.allocator.getString(i);
      },
      extism_config_get(i: bigint): bigint {
        if (typeof plugin.config === 'undefined') {
          return BigInt(0);
        }
        const key = plugin.allocator.getString(i);
        if (key === null) {
          return BigInt(0);
        }
        const value = plugin.config.get(key);
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
      extism_http_request(n: bigint, i: bigint): number {
        debugger;
        return 0;
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
