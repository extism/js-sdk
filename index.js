import { readFile } from "node:fs/promises";

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
    if (!this.useWasi) {
      return null;
    }

    let wasi;
    try {
      const pkg = await import("wasi");
      wasi = new pkg.WASI({
        version: "preview1",
        preopens: this.allowedPaths,
      });
    } catch (_) {
      const pkgDeno = await import(
        "https://deno.land/std@0.197.0/wasi/snapshot_preview1.ts"
      );
      wasi = new pkgDeno.default({
        preopens: this.allowedPaths,
      });
    }

    return new PluginWasi(wasi);
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
    return this.wasi.wasiImport || this.wasi.exports;
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

  async initExtism() {
    const extismWasm = this.opts.runtime ||
      (await readFile("extism-runtime.wasm"));
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

      const x = {};
      const f = this.wasi.importObject();
      for (const k in f) {
        x[k] = f[k];
      }
      imports["wasi_snapshot_preview1"] = x;
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

    this.imports = imports;
    this.extism = {
      instance: instance,
      module: module,
    };
  }

  init() {
    this.module = new WebAssembly.Module(this.wasm);
    this.instance = new WebAssembly.Instance(this.module, this.imports);
  }

  memoryAlloc(size) {
    return this.extism.instance.exports.extism_alloc(
      BigInt(size),
    );
  }

  memoryLength(offs) {
    return this.extism.instance.exports.extism_length(offs);
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

  async call(name, input) {
    await this.initExtism();
    this.setInput(input);
    this.init();

    const rc = this.instance.exports[name]();
    if (Number(rc) != 0) {
      const msg = this.getError() || "Call failed";
      throw new Error(msg);
    }

    return this.getOutput();
  }
}
