"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_1 = require("./plugin");
const browser_wasi_shim_1 = require("@bjorn3/browser_wasi_shim");
const minimatch_1 = require("minimatch");
class ExtismPlugin extends plugin_1.ExtismPluginBase {
    supportsHttpRequests() {
        return true;
    }
    matches(text, pattern) {
        return (0, minimatch_1.minimatch)(text, pattern);
    }
    httpRequest(request, body) {
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
        let responseBody;
        switch (xhr.responseType) {
            case "arraybuffer":
                responseBody = new Uint8Array(xhr.response);
                break;
            case "blob":
                throw new Error("Blob response type is not supported in a synchronous context.");
            case "document":
            case "json":
            case "text":
            case "":
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
    static async calculateHash(data) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }
    static async newPlugin(manifestData, options) {
        let moduleData = await (0, plugin_1.fetchModuleData)(manifestData, this.fetchWasm, this.calculateHash);
        let runtime = await (0, plugin_1.instantiateRuntime)(options.runtime, this.fetchWasm);
        return new ExtismPlugin(runtime, moduleData, options);
    }
    static async fetchWasm(wasm) {
        let data;
        if (wasm.data) {
            data = wasm.data;
        }
        else if (wasm.path) {
            throw new Error(`Unsupported wasm source: ${wasm}`);
        }
        else if (wasm.url) {
            const response = await fetch(wasm.url);
            data = await response.arrayBuffer();
        }
        else {
            throw new Error(`Unrecognized wasm source: ${wasm}`);
        }
        return data;
    }
    loadWasi(options) {
        const args = [];
        const envVars = [];
        let fds = [
        // new XtermStdio(term), // stdin
        // new XtermStdio(term), // stdout
        // new XtermStdio(term), // stderr
        ];
        const wasi = new browser_wasi_shim_1.WASI(args, envVars, fds);
        return new plugin_1.PluginWasi(wasi, wasi.wasiImport);
    }
}
// @ts-ignore
window.ExtismPlugin = ExtismPlugin;
// @ts-ignore
window.ExtismPluginOptions = plugin_1.ExtismPluginOptions;
// export {
//   ExtismPlugin,
//   ExtismPluginOptions,
//   Manifest,
//   ManifestWasm,
//   ManifestWasmData,
//   ManifestWasmFile,
// }
