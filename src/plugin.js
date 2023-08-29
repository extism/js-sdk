"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtismPluginBase = exports.instantiateRuntime = exports.fetchModuleData = exports.PluginWasi = exports.ExtismPluginOptions = void 0;
class ExtismPluginOptions {
    useWasi;
    functions;
    runtime;
    allowedPaths;
    allowedHosts;
    config;
    constructor() {
        this.useWasi = false;
        this.functions = {};
        this.runtime = null;
        this.allowedPaths = {};
        this.config = {};
        this.allowedHosts = [];
    }
    withWasi(value = true) {
        this.useWasi = value;
        return this;
    }
    withRuntime(runtime) {
        this.runtime = runtime;
        return this;
    }
    withFunction(moduleName, funcName, func) {
        const x = this.functions[moduleName] ?? {};
        x[funcName] = func;
        this.functions[moduleName] = x;
        return this;
    }
    withAllowedPath(dest, src) {
        this.allowedPaths[dest] = src || dest;
        return this;
    }
    withConfig(key, value) {
        this.config[key] = value;
        return this;
    }
    withConfigs(configs) {
        for (let key in configs) {
            this.config[key] = configs[key];
        }
        return this;
    }
    withAllowedHost(pattern) {
        this.allowedHosts.push(pattern.trim());
        return this;
    }
    withAllowedHosts(patterns) {
        for (const pattern of patterns) {
            this.withAllowedHost(pattern);
        }
        return this;
    }
}
exports.ExtismPluginOptions = ExtismPluginOptions;
// PluginWasi provides a unified interface for the supported WASI implementations
class PluginWasi {
    wasi;
    imports;
    constructor(wasi, imports) {
        this.wasi = wasi;
        this.imports = imports;
    }
    importObject() {
        return this.imports;
    }
    initialize() { }
}
exports.PluginWasi = PluginWasi;
async function fetchModuleData(manifestData, fetchWasm, calculateHash) {
    let moduleData = null;
    if (manifestData instanceof ArrayBuffer) {
        moduleData = manifestData;
    }
    else if (manifestData.wasm) {
        const wasmData = manifestData.wasm;
        if (wasmData.length > 1)
            throw Error('This runtime only supports one module in Manifest.wasm');
        const wasm = wasmData[0];
        moduleData = await fetchWasm(wasm);
    }
    else if (manifestData.data ||
        manifestData.path ||
        manifestData.url) {
        moduleData = await fetchWasm(manifestData);
        const expected = manifestData.hash;
        if (expected) {
            const actual = await calculateHash(moduleData);
            if (actual != expected) {
                throw new Error('Plugin error: hash mismatch');
            }
        }
    }
    if (!moduleData) {
        throw Error(`Unsure how to interpret manifest ${manifestData.path}`);
    }
    return moduleData;
}
exports.fetchModuleData = fetchModuleData;
async function instantiateRuntime(runtime, fetchWasm) {
    if (!runtime) {
        throw Error('Please specify Extism runtime.');
    }
    const extismWasm = await fetchWasm(runtime);
    const extismModule = new WebAssembly.Module(extismWasm);
    const extismInstance = new WebAssembly.Instance(extismModule, {});
    return extismInstance;
}
exports.instantiateRuntime = instantiateRuntime;
async function calculateHash(data) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return hashHex;
}
class ExtismPluginBase {
    moduleData;
    allocator;
    vars;
    input;
    output;
    module;
    options;
    lastStatusCode = 0;
    constructor(extism, moduleData, options) {
        this.moduleData = moduleData;
        this.allocator = new Allocator(extism);
        this.vars = {};
        this.input = new Uint8Array();
        this.output = new Uint8Array();
        this.options = options;
    }
    async getExports() {
        const module = await this._instantiateModule();
        return module.instance.exports;
    }
    async getImports() {
        const module = await this._instantiateModule();
        return WebAssembly.Module.imports(module.module);
    }
    async getInstance() {
        const module = await this._instantiateModule();
        return module.instance;
    }
    async functionExists(name) {
        const module = await this._instantiateModule();
        return module.instance.exports[name] ? true : false;
    }
    async call(func_name, input) {
        const module = await this._instantiateModule();
        if (typeof input === 'string') {
            this.input = new TextEncoder().encode(input);
        }
        else if (input instanceof Uint8Array) {
            this.input = input;
        }
        else {
            throw new Error('Plugin error: input should be string or Uint8Array');
        }
        this.allocator.reset();
        let func = module.instance.exports[func_name];
        if (!func) {
            throw Error(`Plugin error: function does not exist ${func_name}`);
        }
        //@ts-ignore
        func();
        return this.output;
    }
    async _instantiateModule() {
        if (this.module) {
            return this.module;
        }
        const environment = this.makeEnv();
        const pluginWasi = this.loadWasi(this.options);
        let imports = {
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
    makeEnv() {
        const plugin = this;
        var env = {
            extism_alloc(n) {
                const response = plugin.allocator.alloc(n);
                return response;
            },
            extism_free(n) {
                plugin.allocator.free(n);
            },
            extism_load_u8(n) {
                return plugin.allocator.getMemoryBuffer()[Number(n)];
            },
            extism_load_u64(n) {
                let cast = new DataView(plugin.allocator.getMemory().buffer, Number(n));
                return cast.getBigUint64(0, true);
            },
            extism_store_u8(offset, n) {
                plugin.allocator.getMemoryBuffer()[Number(offset)] = Number(n);
            },
            extism_store_u64(offset, n) {
                const tmp = new DataView(plugin.allocator.getMemory().buffer, Number(offset));
                tmp.setBigUint64(0, n, true);
            },
            extism_input_length() {
                return BigInt(plugin.input.length);
            },
            extism_input_load_u8(i) {
                return plugin.input[Number(i)];
            },
            extism_input_load_u64(idx) {
                let cast = new DataView(plugin.input.buffer, Number(idx));
                return cast.getBigUint64(0, true);
            },
            extism_output_set(offset, length) {
                const offs = Number(offset);
                const len = Number(length);
                plugin.output = plugin.allocator.getMemoryBuffer().slice(offs, offs + len);
            },
            extism_error_set(i) {
                throw plugin.allocator.getString(i);
            },
            extism_config_get(i) {
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
            extism_var_get(i) {
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
            extism_var_set(n, i) {
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
            extism_http_request(requestOffset, bodyOffset) {
                if (!plugin.supportsHttpRequests()) {
                    plugin.allocator.free(bodyOffset);
                    plugin.allocator.free(requestOffset);
                    return BigInt(0);
                }
                const requestJson = plugin.allocator.getString(requestOffset);
                if (requestJson == null) {
                    throw new Error('Invalid request.');
                }
                var request = JSON.parse(requestJson);
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
                    throw new Error(`HTTP request to '${request.url}' is not allowed`);
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
            extism_http_status_code() {
                return plugin.lastStatusCode;
            },
            extism_length(i) {
                return plugin.allocator.getLength(i);
            },
            extism_log_warn(i) {
                const s = plugin.allocator.getString(i);
                console.warn(s);
            },
            extism_log_info(i) {
                const s = plugin.allocator.getString(i);
                console.log(s);
            },
            extism_log_debug(i) {
                const s = plugin.allocator.getString(i);
                console.debug(s);
            },
            extism_log_error(i) {
                const s = plugin.allocator.getString(i);
                console.error(s);
            },
        };
        return env;
    }
}
exports.ExtismPluginBase = ExtismPluginBase;
class Allocator {
    extism;
    constructor(extism) {
        this.extism = extism;
    }
    reset() {
        return this.extism.exports.extism_reset.call(undefined);
    }
    alloc(length) {
        return this.extism.exports.extism_alloc.call(undefined, length);
    }
    getMemory() {
        return this.extism.exports.memory;
    }
    getMemoryBuffer() {
        return new Uint8Array(this.getMemory().buffer);
    }
    getBytes(offset) {
        if (offset == BigInt(0)) {
            return null;
        }
        const length = this.getLength(offset);
        return new Uint8Array(this.getMemory().buffer, Number(offset), Number(length));
    }
    getString(offset) {
        const bytes = this.getBytes(offset);
        if (bytes === null) {
            return null;
        }
        return new TextDecoder().decode(bytes);
    }
    allocBytes(data) {
        const offs = this.alloc(BigInt(data.length));
        const bytes = this.getBytes(offs);
        if (bytes === null) {
            this.free(offs);
            return BigInt(0);
        }
        bytes.set(data);
        return offs;
    }
    allocString(data) {
        const bytes = new TextEncoder().encode(data);
        return this.allocBytes(bytes);
    }
    getLength(offset) {
        return this.extism.exports.extism_length.call(undefined, offset);
    }
    free(offset) {
        if (offset == BigInt(0)) {
            return;
        }
        this.extism.exports.extism_free.call(undefined, offset);
    }
}
