import { CallContext } from './call-context.ts';

/**
 * {@link Plugin} Config
 */
export interface PluginConfigLike {
  [key: string]: string;
}

/**
 * `PluginOutput` is a view around some memory exposed by the plugin. Typically
 * returned by {@link Plugin#call | `plugin.call()`} or {@link CallContext#read
 * | `callContext.read()`}. It implements the read side of
 * [`DataView`](https://mdn.io/dataview) along with methods for reading string
 * and JSON data out of the backing buffer.
 */
export class PluginOutput extends DataView {
  static #decoder = new TextDecoder();
  #bytes: Uint8Array | null = null;

  /** @hidden */
  constructor(buffer: ArrayBufferLike) {
    super(buffer);
  }

  json(): any {
    return JSON.parse(this.string());
  }

  arrayBuffer(): ArrayBufferLike {
    return this.buffer;
  }

  string(): string {
    return PluginOutput.#decoder.decode(this.buffer);
  }

  bytes(): Uint8Array {
    this.#bytes ??= new Uint8Array(this.buffer);
    return this.#bytes;
  }

  setInt8(_byteOffset: number, _value: number): void {
    throw new Error('Cannot set values on output');
  }

  setInt16(_byteOffset: number, _value: number, _littleEndian?: boolean | undefined): void {
    throw new Error('Cannot set values on output');
  }

  setInt32(_byteOffset: number, _value: number, _littleEndian?: boolean | undefined): void {
    throw new Error('Cannot set values on output');
  }

  setUint8(_byteOffset: number, _value: number): void {
    throw new Error('Cannot set values on output');
  }

  setUint16(_byteOffset: number, _value: number, _littleEndian?: boolean | undefined): void {
    throw new Error('Cannot set values on output');
  }

  setUint32(_byteOffset: number, _value: number, _littleEndian?: boolean | undefined): void {
    throw new Error('Cannot set values on output');
  }

  setFloat32(_byteOffset: number, _value: number, _littleEndian?: boolean | undefined): void {
    throw new Error('Cannot set values on output');
  }

  setFloat64(_byteOffset: number, _value: number, _littleEndian?: boolean | undefined): void {
    throw new Error('Cannot set values on output');
  }

  setBigInt64(_byteOffset: number, _value: bigint, _littleEndian?: boolean | undefined): void {
    throw new Error('Cannot set values on output');
  }

  setBigUint64(_byteOffset: number, _value: bigint, _littleEndian?: boolean | undefined): void {
    throw new Error('Cannot set values on output');
  }
}

export type PluginConfig = Record<string, string>;

export interface Plugin {
  /**
   * Check if a function exists in the WebAssembly module.
   *
   * @param {string | [string, string]} funcName The function's name, or a tuple of target module name and function name.
   * @returns {Promise<boolean>} true if the function exists, otherwise false
   */
  functionExists(funcName: string | [string, string]): Promise<boolean>;
  close(): Promise<void>;

  /**
   * Call a specific function from the WebAssembly module with provided input.
   *
   * @param {string | [string, string]} funcName The name of the function to call
   * @param {Uint8Array | string} input The input to pass to the function
   * @returns {Promise<PluginOutput | null>} The result from the function call
   */
  call(funcName: string | [string, string], input?: string | number | Uint8Array): Promise<PluginOutput | null>;
  getExports(name?: string): Promise<WebAssembly.ModuleExportDescriptor[]>;
  getImports(name?: string): Promise<WebAssembly.ModuleImportDescriptor[]>;
  getInstance(name?: string): Promise<WebAssembly.Instance>;
}

/**
 * Options for initializing an Extism plugin.
 */
export interface ExtismPluginOptions {
  /**
   * Whether or not to enable WASI preview 1.
   */
  useWasi?: boolean | undefined;

  /**
   * Whether or not to run the Wasm module in a Worker thread. Requires
   * {@link Capabilities#hasWorkerCapability | `CAPABILITIES.hasWorkerCapability`} to
   * be true.
   */
  runInWorker?: boolean | undefined;

  /**
   * A logger implementation. Must provide `info`, `debug`, `warn`, and `error` methods.
   */
  logger?: Console;

  /**
   * A map of namespaces to function names to host functions.
   *
   * ```js
   * const functions = {
   *   'my_great_namespace': {
   *     'my_func': (callContext: CallContext, input: bigint) => {
   *       const output = callContext.read(input);
   *       if (output !== null) {
   *         console.log(output.string());
   *       }
   *     }
   *   }
   * }
   * ```
   */
  functions?: { [key: string]: { [key: string]: (callContext: CallContext, ...args: any[]) => any } } | undefined;
  allowedPaths?: { [key: string]: string } | undefined;
  allowedHosts?: string[] | undefined;
  config?: PluginConfigLike | undefined;
  fetch?: typeof fetch;
  sharedArrayBufferSize?: number;
}

export interface InternalConfig {
  logger: Console;
  allowedHosts: string[];
  allowedPaths: { [key: string]: string };
  functions: { [namespace: string]: { [func: string]: any } };
  fetch: typeof fetch;
  wasiEnabled: boolean;
  config: PluginConfig;
  sharedArrayBufferSize: number;
}

export interface InternalWasi {
  importObject(): Promise<Record<string, WebAssembly.ImportValue>>;
  initialize(instance: WebAssembly.Instance): Promise<void>;
}

/**
 * Represents the raw bytes of a WASM file loaded into memory
 *
 * @category Manifests
 */
export interface ManifestWasmData {
  data: Uint8Array;
}

/**
 * Represents a url to a WASM module
 */
export interface ManifestWasmUrl {
  url: URL | string;
}

/**
 * Represents a path to a WASM module
 */
export interface ManifestWasmPath {
  path: string;
}

/**
 * The WASM to load as bytes, a path, or a url
 *
 * @property name The name of the Wasm module. Used when disambiguating {@link Plugin#call | `Plugin#call`} targets when the
 * plugin embeds multiple Wasm modules.
 *
 * @property hash The expected SHA-256 hash of the associated Wasm module data. {@link createPlugin} validates incoming Wasm against
 * provided hashes.
 */
export type ManifestWasm = (ManifestWasmUrl | ManifestWasmData | ManifestWasmPath) & {
  name?: string | undefined;
  hash?: string | undefined;
};

/**
 * The manifest which describes the {@link Plugin} code and runtime constraints. This is passed to {@link createPlugin}
 *
 * ```js
 * let manifest = {
 *   wasm: [{name: 'my-wasm', url: 'http://example.com/path/to/wasm'}],
 *   config: {
 *     'greeting': 'hello' // these variables will be available via `extism_get_var` in plugins
 *   }
 * }
 * ```
 *
 * Every member of `.wasm` is expected to be an instance of {@link ManifestWasm}.
 *
 * @see [Extism](https://extism.org/) > [Concepts](https://extism.org/docs/category/concepts) > [Manifest](https://extism.org/docs/concepts/manifest)
 */
export interface Manifest {
  wasm: Array<ManifestWasm>;
  config?: PluginConfigLike | undefined;
}

/**
 * Any type that can be converted into an Extism {@link Manifest}.
 * - `object` instances that implement {@link Manifest} are validated.
 * - `ArrayBuffer` instances are converted into {@link Manifest}s with a single {@link ManifestWasmData} member.
 * - `URL` instances are fetched and their responses interpreted according to their `content-type` response header. `application/wasm` and `application/octet-stream` items
 *   are treated as {@link ManifestWasmData} items; `application/json` and `text/json` are treated as JSON-encoded {@link Manifest}s.
 * - `string` instances that start with `http://`, `https://`, or `file://` are treated as URLs.
 * - `string` instances that start with `{` treated as JSON-encoded {@link Manifest}s.
 * - All other `string` instances are treated as {@link ManifestWasmPath}.
 *
 * ```js
 * let manifest = {
 *   wasm: [{name: 'my-wasm', url: 'http://example.com/path/to/wasm'}],
 *   config: {
 *     'greeting': 'hello' // these variables will be available via `extism_get_var` in plugins
 *   }
 * }
 *
 * let manifest = '{"wasm": {"url": "https://example.com"}}'
 * let manifest = 'path/to/file.wasm'
 * let manifest = new ArrayBuffer()
 * ```
 *
 * @see [Extism](https://extism.org/) > [Concepts](https://extism.org/docs/category/concepts) > [Manifest](https://extism.org/docs/concepts/manifest)
 *
 * @throws {@link TypeError} when `URL` parameters don't resolve to a known `content-type`
 * @throws {@link TypeError} when the resulting {@link Manifest} does not contain a `wasm` member with valid {@link ManifestWasm} items.
 */
export type ManifestLike = Manifest | ArrayBuffer | string | URL;

export interface Capabilities {
  /**
   * Whether or not the environment allows SharedArrayBuffers to be passed to `TextDecoder.decode` and `TextEncoder.encodeInto` directly
   *
   * - ✅ node
   * - ✅ deno
   * - ✅ bun
   * - ❌ firefox
   * - ❌ chrome
   * - ❌ webkit
   */
  allowSharedBufferCodec: boolean;

  /**
   * Whether or not {@link ManifestWasm} items support the "path:" key.
   *
   * - ✅ node
   * - ✅ deno
   * - ✅ bun
   * - ❌ firefox
   * - ❌ chrome
   * - ❌ webkit
   */
  manifestSupportsPaths: boolean;

  /**
   * Whether or not cross-origin checks are enforced for outgoing HTTP requests on this platform.
   *
   * - ❌ node
   * - ❌ deno
   * - ❌ bun
   * - ✅ firefox
   * - ✅ chrome
   * - ✅ webkit
   */
  crossOriginChecksEnforced: boolean;

  /**
   * Whether or not the host environment has access to a filesystem.
   *
   * - ✅ node
   * - ✅ deno
   * - ✅ bun
   * - ❌ firefox
   * - ❌ chrome
   * - ❌ webkit
   */
  fsAccess: boolean;

  /**
   * Whether or not the host environment supports moving Wasm plugin workloads to a worker. This requires
   * SharedArrayBuffer support, which requires `window.crossOriginIsolated` to be true in browsers.
   *
   * @see [`crossOriginalIsolated` on MDN](https://mdn.io/crossOriginIsolated)
   *
   * - ✅ node
   * - ✅ deno
   * - ✅ bun
   * - 🔒 firefox
   * - 🔒 chrome
   * - 🔒 webkit
   */
  hasWorkerCapability: boolean;

  /**
   * Whether or not the host environment supports WASI preview 1.
   *
   * @see [`WASI`](https://wasi.dev/) and [`WASI Preview 1`](https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md)
   *
   * - ✅ node (via [`node:wasi`](https://nodejs.org/api/wasi.html))
   * - ✅ deno (via [`deno.land/std/wasi/snapshot_preview1`](https://deno.land/std@0.200.0/wasi/snapshot_preview1.ts))
   * - ❌ bun
   * - ✅ firefox (via [`@bjorn3/browser_wasi_shim`](https://www.npmjs.com/package/@bjorn3/browser_wasi_shim))
   * - ✅ chrome (via [`@bjorn3/browser_wasi_shim`](https://www.npmjs.com/package/@bjorn3/browser_wasi_shim))
   * - ✅ webkit (via [`@bjorn3/browser_wasi_shim`](https://www.npmjs.com/package/@bjorn3/browser_wasi_shim))
   */
  supportsWasiPreview1: boolean;
}
