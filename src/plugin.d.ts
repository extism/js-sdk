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
export type PluginConfig = {
    [key: string]: string;
};
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
    config?: PluginConfig;
    allowed_hosts?: Array<string>;
};
export declare class ExtismPluginOptions {
    useWasi: boolean;
    functions: {
        [key: string]: {
            [key: string]: any;
        };
    };
    runtime: ManifestWasm | null;
    allowedPaths: {
        [key: string]: string;
    };
    allowedHosts: string[];
    config: PluginConfig;
    constructor();
    withWasi(value?: boolean): this;
    withRuntime(runtime: ManifestWasm): this;
    withFunction(moduleName: string, funcName: string, func: any): this;
    withAllowedPath(dest: string, src: string | null): this;
    withConfig(key: string, value: string): this;
    withConfigs(configs: {
        [key: string]: string;
    }): this;
    withAllowedHost(pattern: string): this;
    withAllowedHosts(patterns: string[]): this;
}
export declare class PluginWasi {
    wasi: any;
    imports: any;
    constructor(wasi: any, imports: any);
    importObject(): any;
    initialize(): void;
}
export declare function fetchModuleData(manifestData: Manifest | ManifestWasm | ArrayBuffer, fetchWasm: (wasm: ManifestWasm) => Promise<ArrayBuffer>, calculateHash: (buffer: ArrayBuffer) => Promise<string>): Promise<ArrayBuffer>;
export declare function instantiateRuntime(runtime: ManifestWasm | null, fetchWasm: (wasm: ManifestWasm) => Promise<ArrayBuffer>): Promise<WebAssembly.Instance>;
export type HttpResponse = {
    body: Uint8Array;
    status: number;
};
export type HttpRequest = {
    url: string;
    headers: {
        [key: string]: string;
    };
    method: string;
};
export declare abstract class ExtismPluginBase {
    moduleData: ArrayBuffer;
    allocator: Allocator;
    vars: Record<string, Uint8Array>;
    input: Uint8Array;
    output: Uint8Array;
    module?: WebAssembly.WebAssemblyInstantiatedSource;
    options: ExtismPluginOptions;
    lastStatusCode: number;
    constructor(extism: WebAssembly.Instance, moduleData: ArrayBuffer, options: ExtismPluginOptions);
    getExports(): Promise<WebAssembly.Exports>;
    getImports(): Promise<WebAssembly.ModuleImportDescriptor[]>;
    getInstance(): Promise<WebAssembly.Instance>;
    functionExists(name: string): Promise<boolean>;
    call(func_name: string, input: Uint8Array | string): Promise<Uint8Array>;
    abstract loadWasi(options: ExtismPluginOptions): PluginWasi;
    abstract supportsHttpRequests(): boolean;
    abstract httpRequest(request: HttpRequest, body: Uint8Array | null): HttpResponse;
    abstract matches(text: string, pattern: string): boolean;
    _instantiateModule(): Promise<WebAssembly.WebAssemblyInstantiatedSource>;
    makeEnv(): any;
}
declare class Allocator {
    extism: WebAssembly.Instance;
    constructor(extism: WebAssembly.Instance);
    reset(): any;
    alloc(length: bigint): bigint;
    getMemory(): WebAssembly.Memory;
    getMemoryBuffer(): Uint8Array;
    getBytes(offset: bigint): Uint8Array | null;
    getString(offset: bigint): string | null;
    allocBytes(data: Uint8Array): bigint;
    allocString(data: string): bigint;
    getLength(offset: bigint): bigint;
    free(offset: bigint): void;
}
export {};
