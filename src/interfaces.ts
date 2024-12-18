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

  override setInt8(_byteOffset: number, _value: number): void {
    throw new Error('Cannot set values on output');
  }

  override setInt16(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  override setInt32(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  override setUint8(_byteOffset: number, _value: number): void {
    throw new Error('Cannot set values on output');
  }

  override setUint16(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  override setUint32(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  override setFloat32(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  override setFloat64(_byteOffset: number, _value: number, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  override setBigInt64(_byteOffset: number, _value: bigint, _littleEndian?: boolean): void {
    throw new Error('Cannot set values on output');
  }

  override setBigUint64(_byteOffset: number, _value: bigint, _littleEndian?: boolean): void {
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
   * @param {T} hostContext Per-call context to make available to host functions
   * @returns {Promise<PluginOutput | null>} The result from the function call
   */
  call<T>(funcName: string, input?: string | number | Uint8Array, hostContext?: T): Promise<PluginOutput | null>;
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
 * Arguments to be passed to `node:worker_threads.Worker` when `runInWorker: true`.
 */
export interface NodeWorkerArgs {
  name?: string;
  execArgv?: string[];
  argv?: string[];
  env?: Record<string, string>;
  resourceLimits?: {
    maxOldGenerationSizeMb?: number;
    maxYoungGenerationSizeMb?: number;
    codeRangeSizeMb?: number;
    stackSizeMb?: number;
  };
  [k: string]: any;
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
   * A logger implementation. Must provide `trace`, `info`, `debug`, `warn`, and `error` methods.
   */
  logger?: Console;

  /**
   * The log level to use.
   */
  logLevel?: LogLevel;

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
  functions?:
    | {
        [key: string]: {
          [key: string]: (callContext: CallContext, ...args: any[]) => any;
        };
      }
    | undefined;
  allowedPaths?: { [key: string]: string } | undefined;

  /**
   * A list of allowed hostnames. Wildcard subdomains are supported via `*`.
   *
   * Requires the plugin to run in a worker using `runInWorker: true`.
   *
   * @example
   * ```ts
   * await createPlugin('path/to/some/wasm', {
   *   runInWorker: true,
   *   allowedHosts: ['*.example.com', 'www.dylibso.com']
   * })
   * ```
   */
  allowedHosts?: string[] | undefined;

  memory?: MemoryOptions;

  timeoutMs?: number | null;

  /**
   * Whether WASI stdout should be forwarded to the host.
   *
   * Overrides the `EXTISM_ENABLE_WASI_OUTPUT` environment variable.
   */
  enableWasiOutput?: boolean;
  config?: PluginConfigLike;
  fetch?: typeof fetch;
  sharedArrayBufferSize?: number;

  /**
   * Determines whether or not HTTP response headers should be exposed to plugins,
   * when set to `true`, `extism:host/env::http_headers` will return the response
   *  headers for HTTP requests made using `extism:host/env::http_request`
   */
  allowHttpResponseHeaders?: boolean;

  /**
   * Arguments to pass to the `node:worker_threads.Worker` instance when `runInWorker: true`.
   *
   * This is particularly useful for changing `process.execArgv`, which controls certain startup
   * behaviors in node (`--import`, `--require`, warnings.)
   *
   * If not set, defaults to removing the current `execArgv` and disabling node warnings.
   */
  nodeWorkerArgs?: NodeWorkerArgs;
}

export type MemoryOptions = {
  /**
   * Maximum number of pages to allocate for the WebAssembly memory. Each page is 64KB.
   */
  maxPages?: number | undefined;

  /**
   * Maximum number of bytes to read from an HTTP response.
   */
  maxHttpResponseBytes?: number | undefined;

  /**
   * Maximum number of bytes to allocate for plugin Vars.
   */
  maxVarBytes?: number | undefined;
};

type CamelToSnakeCase<S extends string> = S extends `${infer T}${infer U}`
  ? `${T extends Capitalize<T> ? '_' : ''}${Lowercase<T>}${CamelToSnakeCase<U>}`
  : S;

type SnakeCase<T extends Record<string, any>> = {
  [K in keyof T as CamelToSnakeCase<K & string>]: T[K];
};

export interface NativeManifestOptions
  extends Pick<ExtismPluginOptions, 'allowedPaths' | 'allowedHosts' | 'memory' | 'config' | 'timeoutMs'> {}
/**
 * The subset of {@link ExtismPluginOptions} attributes available for configuration via
 * a {@link Manifest}. If an attribute is specified at both the {@link ExtismPluginOptions} and
 * `ManifestOptions` level, the plugin option will take precedence.
 */
export type ManifestOptions = NativeManifestOptions & SnakeCase<NativeManifestOptions>;

export interface InternalConfig extends Required<NativeManifestOptions> {
  logger: Console;
  logLevel: LogLevelPriority;
  enableWasiOutput: boolean;
  functions: { [namespace: string]: { [func: string]: any } };
  fetch: typeof fetch;
  wasiEnabled: boolean;
  sharedArrayBufferSize: number;
  allowHttpResponseHeaders: boolean;
  nodeWorkerArgs: NodeWorkerArgs;
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
export interface Manifest extends ManifestOptions {
  wasm: Array<ManifestWasm>;
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
 * @throws [TypeError](https://mdn.io/TypeError) when `URL` parameters don't resolve to a known `content-type`
 * @throws [TypeError](https://mdn.io/TypeError) when the resulting {@link Manifest} does not contain a `wasm` member with valid {@link ManifestWasm} items.
 *
 * @see [Extism](https://extism.org/) > [Concepts](https://extism.org/docs/category/concepts) > [Manifest](https://extism.org/docs/concepts/manifest)
 */
export type ManifestLike = Manifest | Response | WebAssembly.Module | ArrayBuffer | string | URL;

export interface Capabilities {
  /**
   * Whether or not the environment supports [JSPI](https://github.com/WebAssembly/js-promise-integration/blob/main/proposals/js-promise-integration/Overview.md).
   *
   * If supported, host functions may be asynchronous without running the plugin with `runInWorker: true`.
   *
   * - ✅ node 23+
   * - ❌ deno
   * - ❌ bun
   * - ❌ firefox
   * - ❌ chrome
   * - ❌ webkit
   */
  supportsJSPromiseInterface: boolean;

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
   * Whether or not the host environment supports timeouts.
   *
   * - ✅ node
   * - ✅ deno
   * - ❌ bun (Exhibits strange behavior when await'ing `worker.terminate()`.)
   * - ✅ firefox
   * - ✅ chrome
   * - ✅ webkit
   */
  supportsTimeouts: boolean;

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

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

export function logLevelToPriority(level: LogLevel): LogLevelPriority {
  switch (level) {
    case 'trace':
      return 0;
    case 'debug':
      return 1;
    case 'info':
      return 2;
    case 'warn':
      return 3;
    case 'error':
      return 4;
    case 'silent':
      return 0x7fffffff;
    default:
      throw new TypeError(
        `unrecognized log level "${level}"; expected one of "trace", "debug", "info", "warn", "error", "silent"`,
      );
  }
}

export type LogLevelPriority = 0 | 1 | 2 | 3 | 4 | 0x7fffffff;

export function priorityToLogLevel(level: LogLevelPriority): LogLevel {
  switch (level) {
    case 0:
      return 'trace';
    case 1:
      return 'debug';
    case 2:
      return 'info';
    case 3:
      return 'warn';
    case 4:
      return 'error';
    case 0x7fffffff:
      return 'silent';
    default:
      throw new TypeError(
        `unrecognized log level "${level}"; expected one of "trace", "debug", "info", "warn", "error", "silent"`,
      );
  }
}
