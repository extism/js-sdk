const isBrowser =
  typeof window !== "undefined" && typeof window.document !== "undefined";

const isNode =
  typeof process !== "undefined" &&
  process.versions != null &&
  process.versions.node != null;

const isDeno =
  typeof Deno !== "undefined" &&
  typeof Deno.version !== "undefined" &&
  typeof Deno.version.deno !== "undefined";

export class PluginOptions {
  constructor() {
    this.useWasi = false;
    this.functions = {};
    this.runtime = null;
    this.allowedPaths = {};
  }

  withWasi(b) {
    this.useWasi = b;
    return this;
  }

  withRuntime(rt) {
    this.runtime = rt;
    return this;
  }

  withFunction(moduleName, funcName, f) {
    const x = this.functions[moduleName] || {};
    x[funcName] = f;
    this.functions[moduleName] = x;
    return this;
  }

  withAllowedPath(dest, src) {
    this.allowedPaths[dest] = src || dest;
    return this;
  }

  async getWasi() {
    if (!this.useWasi || isBrowser) {
      return null;
    } else if (isNode) {
      const pkg = await import("wasi");
      const wasi = new pkg.WASI({
        version: "preview1",
        preopens: this.allowedPaths,
      });

      return new PluginWasi(wasi);
    } else if (isDeno) {
      const pkgDeno = await import(
        "https://deno.land/std@0.197.0/wasi/snapshot_preview1.ts"
      );
      const wasi = new pkgDeno.default({
        preopens: this.allowedPaths,
      });

      return new PluginWasi(wasi);
    }

    throw new Error("Unsupported environment.");
  }
}

// PluginWasi provides a unified interface for the supported WASI implementations
class PluginWasi {
  constructor(wasi) {
    this.wasi = wasi;
  }

  importObject() {
    // node: this.wasi.wasiImport
    // deno: this.wasi.exports

    if (isBrowser) {
      return null;
    } else {
      return this.wasi.wasiImport || this.wasi.exports;
    }
  }
}

function extismConfigGet(kOffs) {
  const length = this.memoryLength(kOffs);
  const keyMem = this.getMemory(kOffs, length);
  const key = new TextDecoder().decode(keyMem);
  const value = this.config[key];

  if (!value) {
    return BigInt(0);
  }

  const data = new TextEncoder().encode(value);
  const offs = this.memoryAlloc(data.length);
  const mem = this.getMemory(offs, data.length);
  mem.set(data);
  return offs;
}

function extismVarGet(kOffs) {
  const length = this.memoryLength(kOffs);
  const keyMem = this.getMemory(kOffs, length);
  const key = new TextDecoder().decode(keyMem);
  const value = this.vars[key];

  if (!value) {
    return BigInt(0);
  }

  const data = new TextEncoder().encode(value);
  const offs = this.memoryAlloc(data.length);
  const mem = this.getMemory(offs, data.length);
  mem.set(data);
  return offs;
}

function extismVarSet(kOffs, vOffs) {
  const keyLength = this.memoryLength(kOffs);
  const valueLength = this.memoryLength(vOffs);

  if (keyLength === 0) {
    return;
  }

  // Get the key from memory
  const keyMem = this.getMemory(kOffs, keyLength);
  const key = new TextDecoder().decode(keyMem);

  if (valueLength === 0) {
    delete this.vars[key];
    return;
  }

  // Get the value from memory
  const valueMem = this.getMemory(vOffs, valueLength);
  const value = new TextDecoder().decode(valueMem);

  this.vars[key] = value;
}

function extismHttpStatusCode() {
  return this.lastHttpStatusCode;
}


function extismHttpRequest(rOffs, bOffs) {
  const requestLength = this.memoryLength(rOffs);

  // Get the key from memory
  const requestMem = this.getMemory(rOffs, requestLength);
  const requestJson = new TextDecoder().decode(requestMem);
  const request = JSON.parse(requestJson);

  // TODO: make sure deserialization is successful
  // TODO: make sure we're allowed to call host

  let body = null;
  if (bOffs != 0) {
    const bodyLength = this.memoryLength(bOffs);
    body = this.getMemory(bOffs, bodyLength);
  }

  const options = {
    method: request.method,
    headers: request.headers,
    protocol: request.url.split("://")[0],
  };

  // TODO: Send request synchronously
  const data = new TextEncoder().encode("dummy http response");
  const offs = this.memoryAlloc(data.length);
  const mem = this.getMemory(offs, data.length);
  mem.set(data);

  this.lastHttpStatusCode = 200;

  return offs;
}

export class Plugin {
  constructor(wasm, opts = null) {
    this.wasm = wasm;
    this.extism = null;
    this.module = null;
    this.instance = null;
    this.opts = opts || new PluginOptions();
    this.wasi = null;
    this.config = {};
    this.vars = {};
  }

  withConfig(k, v) {
    this.config[k] = v;
  }

  async fetchRuntime() {
    if (isBrowser) {
      const response = await fetch("/extism-runtime.wasm");
      return response.arrayBuffer();
    } else {
      return await readFile("extism-runtime.wasm");
    }
  }

  async initExtism() {
    if (this.extism) {
      return;
    }

    const extismWasm = this.opts.runtime || await this.fetchRuntime();

    console.log('runtime', extismWasm);

    const module = new WebAssembly.Module(extismWasm);
    const instance = new WebAssembly.Instance(module, {});
    const imports = {
      "env": {},
    };

    for (const k in instance.exports) {
      imports.env[k] = instance.exports[k];
    }

    if (this.opts.useWasi) {
      this.wasi = await this.opts.getWasi();

      if (this.wasi) {
        const f = this.wasi.importObject();
        if (!f) {

        } else {
          console.log(f)
        }

        const x = {};
        for (const k in f) {
          x[k] = f[k];
        }
        imports["wasi_snapshot_preview1"] = x;
      }
    }

    for (const f in this.opts.functions) {
      imports[f] = imports[f] || {};
      for (const g in f) {
        imports[f][g] = this.opts.functions[f][g];
      }
    }

    imports["env"]["extism_config_get"] = (kOffs) => {
      return extismConfigGet.call(this, kOffs);
    };

    imports["env"]["extism_var_get"] = (kOffs) => {
      return extismVarGet.call(this, kOffs);
    };

    imports["env"]["extism_var_set"] = (kOffs, vOffs) => {
      return extismVarSet.call(this, kOffs, vOffs);
    };

    imports["env"]["extism_http_request"] = (rOffs, bOffs) => {
      return rOffs;
    };

    imports["env"]["extism_http_status_code"] = () => {
      return extismHttpStatusCode.call(this);
    };

    this.imports = imports;
    this.extism = {
      instance: instance,
      module: module,
    };
  }

  init() {
    if (!this.module || !this.instance) {
      this.module = new WebAssembly.Module(this.wasm);
      this.instance = new WebAssembly.Instance(this.module, this.imports);
    }
  }

  memoryAlloc(size) {
    return this.extism.instance.exports.extism_alloc(
      BigInt(size),
    );
  }

  memoryLength(offs) {
    return this.extism.instance.exports.extism_length(offs);
  }

  free(offs) {
    this.extism.instance.exports.extism_free(offs);
  }

  getMemory(index = 0, length = null) {
    return new Uint8Array(
      this.extism.instance.exports.memory.buffer,
      Number(index),
      Number(length) ||
      (this.extism.instance.exports.memory.buffer.length - Number(index)),
    );
  }

  getError() {
    const errorOffs = this.extism.instance.exports.extism_error_get();
    if (errorOffs === 0) {
      return null;
    }
    const errorLen = this.memoryLength(errorOffs);
    const memory = this.getMemory(errorOffs, errorLen);
    return new TextDecoder().decode(memory);
  }

  setInput(data) {
    const input = this.extism.instance.exports.extism_alloc(
      BigInt(data.length),
    );
    this.extism.instance.exports.extism_reset();
    this.extism.instance.exports.extism_input_set(input, BigInt(data.length));
    const memory = this.getMemory(input, data.length);
    memory.set(data);
  }

  getOutput() {
    const outputOffs = this.extism.instance.exports.extism_output_offset();
    const outputLen = this.extism.instance.exports.extism_output_length();
    const memory = this.getMemory(outputOffs, outputLen);
    return memory.slice(0, Number(outputLen));
  }

  async functionExsits(name) {
    await this.initExtism();
    this.init();

    return name in this.instance.exports;
  }

  async call(name, input) {
    await this.initExtism();
    this.setInput(input);
    await this.init();

    const rc = this.instance.exports[name]();
    if (Number(rc) != 0) {
      const msg = this.getError() || "Call failed";
      throw new Error(msg);
    }

    return this.getOutput();
  }
}
