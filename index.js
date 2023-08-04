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
    // node: this.wasi.wasiExports
    // deno: this.wasi.exports
    return this.wasi.wasiImports || this.wasi.exports;
  }
}

export class Plugin {
  constructor(wasm, opts = null) {
    this.wasm = wasm;
    this.extism = null;
    this.module = null;
    this.instance = null;
    this.opts = opts || new PluginOptions();
    this.wasi = null;
  }

  async initExtism() {
    const extismWasm = this.opts.runtime ||
      (await readFile("extism-runtime.wasm"));
    const module = new WebAssembly.Module(extismWasm);
    const imports = structuredClone(this.opts.functions);
    if (this.opts.useWasi) {
      this.wasi = await this.opts.getWasi();
      imports["wasi_snapshot_preview1"] = this.wasi.importObject();
    }
    this.extism = {
      instance: new WebAssembly.Instance(module, {}),
      module: module,
    };
  }

  init() {
    this.module = new WebAssembly.Module(this.wasm);
    this.instance = new WebAssembly.Instance(this.module, {
      "env": this.extism.instance.exports,
    });
  }

  getMemory() {
    return new Uint8Array(
      this.extism.instance.exports.memory.buffer,
      0,
      this.extism.instance.exports.memory.buffer.length,
    );
  }

  getError() {
    const memory = this.getMemory();
    const errorOffs = this.extism.instance.exports.extism_error_get();
    if (errorOffs === 0) {
      return null;
    }
    const errorLen = this.extism.instance.exports.extism_length(errorOffs);

    const output = new Uint8ClampedArray(Number(errorLen));
    for (let i = 0; i < Number(errorLen); i++) {
      output[i] = memory[Number(errorOffs) + i];
    }
    return new TextDecoder().decode(output.buffer);
  }

  setInput(data) {
    const input = this.extism.instance.exports.extism_alloc(
      BigInt(data.length),
    );
    this.extism.instance.exports.extism_reset();
    this.extism.instance.exports.extism_input_set(input, BigInt(data.length));
    const memory = this.getMemory();
    for (let i = 0; i < data.length; i++) {
      memory[Number(input) + i] = data[i];
    }
  }

  getOutput() {
    const memory = this.getMemory();
    const outputOffs = this.extism.instance.exports.extism_output_offset();
    const outputLen = this.extism.instance.exports.extism_output_length();

    const output = new Uint8ClampedArray(Number(outputLen));
    for (let i = 0; i < Number(outputLen); i++) {
      output[i] = memory[Number(outputOffs) + i];
    }
    return output;
  }

  async call(name, input) {
    await this.initExtism();
    this.setInput(input);
    this.init();

    const rc = this.instance.exports[name]();
    if (rc != 0) {
      const msg = this.getError() || "Call failed";
      throw new Error(msg);
    }

    return this.getOutput();
  }
}
