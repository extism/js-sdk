import { Fd } from '@bjorn3/browser_wasi_shim';

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

  text(): string {
    return this.string();
  }

  /** @hidden */
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

  setInt16(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  setInt32(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  setUint8(_byteOffset: number, _value: number): void {
    throw new Error('Cannot set values on output');
  }

  setUint16(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  setUint32(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  setFloat32(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  setFloat64(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  setBigInt64(_byteOffset: number, _value: bigint, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  setBigUint64(_byteOffset: number, _value: bigint, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }
}

export type PluginConfig = Record<string, string>;

export interface Plugin {
  /**
   * Check if a function exists in the WebAssembly module.
   *
   * @param {string} funcName The function's name.
   * @returns {Promise<boolean>} true if the function exists, otherwise false
   */
  functionExists(funcName: string): Promise<boolean>;
  close(): Promise<void>;

  /**
   * Call a specific function from the WebAssembly module with provided input.
   *
   * @param {string} funcName The name of the function to call
   * @param {Uint8Array | string} input The input to pass to the function
   * @returns {Promise<PluginOutput | null>} The result from the function call
   */
  call(funcName: string, input?: string | number | Uint8Array): Promise<PluginOutput | null>;
  getExports(): Promise<WebAssembly.ModuleExportDescriptor[]>;
  getImports(): Promise<WebAssembly.ModuleImportDescriptor[]>;
  getInstance(): Promise<WebAssembly.Instance>;

  /**
   * Whether the plugin is currently processing a call.
   */
  isActive(): boolean;

  /**
   * Reset Plugin memory. If called while the plugin is {@link Plugin#isActive|actively executing}, memory will not be reset.
   *
   * @returns {Promise<boolean>} Whether or not the reset was successful.
   */
  reset(): Promise<boolean>;
}

/**
 * Options for initializing an Extism plugin.
 */
export interface ExtismPluginOptions {
  /**
   * Whether or not to enable WASI preview 1.
   */
  useWasi?: boolean;

  /**
   * Whether or not to run the Wasm module in a Worker thread. Requires
   * {@link Capabilities#hasWorkerCapability | `CAPABILITIES.hasWorkerCapability`} to
   * be true. Defaults to false.
   *
   * This feature is marked experimental as we work out [a bug](https://github.com/extism/js-sdk/issues/46).
   *
   * @experimental
   */
  runInWorker?: boolean;

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
  fileDescriptors?: Fd[];

  /**
   * Whether WASI stdout should be forwarded to the host.
   *
   * Overrides the `EXTISM_ENABLE_WASI_OUTPUT` environment variable.
   */
  enableWasiOutput?: boolean;
  config?: PluginConfigLike;
  fetch?: typeof fetch;
  sharedArrayBufferSize?: number;
}

export interface InternalConfig {
  logger: Console;
  allowedHosts: string[];
  allowedPaths: { [key: string]: string };
  enableWasiOutput: boolean;
  functions: { [namespace: string]: { [func: string]: any } };
  fetch: typeof fetch;
  wasiEnabled: boolean;
  config: PluginConfig;
  sharedArrayBufferSize: number;
  fileDescriptors: Fd[];
}

export interface InternalWasi {
  importObject(): Promise<Record<string, WebAssembly.ImportValue>>;
  initialize(instance: WebAssembly.Instance): Promise<void>;
  close(): Promise<void>;
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
 * Represents a WASM module as a response
 */
export interface ManifestWasmResponse {
  response: Response;
}

/**
 * Represents a WASM module as a response
 */
export interface ManifestWasmModule {
  module: WebAssembly.Module;
}

/**
 * The WASM to load as bytes, a path, a fetch `Response`, a `WebAssembly.Module`, or a url
 *
 * @property name The name of the Wasm module. Used when disambiguating {@link Plugin#call | `Plugin#call`} targets when the
 * plugin embeds multiple Wasm modules.
 *
 * @property hash The expected SHA-256 hash of the associated Wasm module data. {@link createPlugin} validates incoming Wasm against
 * provided hashes. If running on Node v18, `node` must be invoked using the `--experimental-global-webcrypto` flag.
 *
 * ⚠️ `module` cannot be used in conjunction with `hash`: the Web Platform does not currently provide a way to get source
 * bytes from a `WebAssembly.Module` in order to hash.
 *
 */
export type ManifestWasm = (
  | ManifestWasmUrl
  | ManifestWasmData
  | ManifestWasmPath
  | ManifestWasmResponse
  | ManifestWasmModule
) & {
  name?: string;
  hash?: string;
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
  config?: PluginConfigLike;
}

/**
 * Any type that can be converted into an Extism {@link Manifest}.
 * - `object` instances that implement {@link Manifest} are validated.
 * - `ArrayBuffer` instances are converted into {@link Manifest}s with a single {@link ManifestUint8Array} member.
 * - `URL` instances are fetched and their responses interpreted according to their `content-type` response header. `application/wasm` and `application/octet-stream` items
 *   are treated as {@link ManifestUint8Array} items; `application/json` and `text/json` are treated as JSON-encoded {@link Manifest}s.
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
export type ManifestLike = Manifest | Response | WebAssembly.Module | ArrayBuffer | string | URL;

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

  /**
   * Whether or not the `EXTISM_ENABLE_WASI_OUTPUT` environment variable has been set.
   *
   * This value is consulted whenever {@link ExtismPluginOptions#enableWasiOutput} is omitted.
   */
  extismStdoutEnvVarSet: boolean;
}

export const SAB_BASE_OFFSET = 4;

export enum SharedArrayBufferSection {
  End = 0xff,
  RetI64 = 1,
  RetF64 = 2,
  RetVoid = 3,
  Block = 4,
}
