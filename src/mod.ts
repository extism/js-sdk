export type {
  Manifest,
  ManifestWasm,
  ManifestWasmUrl,
  ManifestWasmData,
  ManifestLike as IntoManifest,
} from './manifest.ts';
import { FEATURES } from 'js-sdk:features';
export { FEATURES } from 'js-sdk:features';

import { ManifestLike, intoManifest as _intoManifest, toWasmModuleData as _toWasmModuleData } from './manifest.ts';

import { createForegroundPlugin as _createForegroundPlugin } from './foreground-plugin.ts';
import { createBackgroundPlugin as _createBackgroundPlugin } from './background-plugin.ts';
export { type CallContext } from './call-context.ts';

/**
 * {@link Plugin} Config
 */
export interface PluginConfigLike {
  [key: string]: string;
}
export type PluginConfig = { [key: string]: string };

/**
 * Options for initializing an Extism plugin.
 */
export interface ExtismPluginOptions {
  useWasi?: boolean | undefined;
  runInWorker?: boolean | undefined;
  logger?: Console;
  functions?: { [key: string]: { [key: string]: any } } | undefined;
  allowedPaths?: { [key: string]: string } | undefined;
  allowedHosts?: string[] | undefined;
  config?: PluginConfigLike | undefined;
  fetch?: typeof fetch;
}

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
   * @returns {Promise<Uint8Array>} The result from the function call
   */
  call(funcName: string | [string, string], input?: string | number | Uint8Array): Promise<Uint8Array | null>;
  callBlock(funcName: string | [string, string], input?: number | null): Promise<[number | null, number | null]>;
  getExports(name?: string): Promise<WebAssembly.ModuleExportDescriptor[]>;
  getImports(name?: string): Promise<WebAssembly.ModuleImportDescriptor[]>;
  getInstance(name?: string): Promise<WebAssembly.Instance>;
}

// TODO: move these into another module...
export interface InternalConfig {
  logger: Console;
  allowedHosts: string[];
  allowedPaths: { [key: string]: string };
  functions: { [namespace: string]: { [func: string]: any } };
  fetch: typeof fetch;
  wasiEnabled: boolean;
  config: PluginConfig;
}

export interface InternalWasi {
  importObject(): Promise<Record<string, WebAssembly.ImportValue>>;
  initialize(instance: WebAssembly.Instance): Promise<void>;
}

export default async function createPlugin(
  manifest: ManifestLike | PromiseLike<ManifestLike>,
  opts: ExtismPluginOptions = {},
): Promise<Plugin> {
  manifest = await _intoManifest(await Promise.resolve(manifest));
  opts = { ...opts };
  opts.useWasi ??= false;
  opts.functions = opts.functions || {};
  opts.allowedPaths ??= {};
  opts.allowedHosts ??= <any>[].concat(opts.allowedHosts || []);
  opts.logger ??= console;
  opts.config ??= {};

  opts.runInWorker ??= FEATURES.hasWorkerCapability;
  if (opts.runInWorker && !FEATURES.hasWorkerCapability) {
    throw new Error(
      'Cannot enable off-thread wasm; current context is not `crossOriginIsolated` (see https://mdn.io/crossOriginIsolated)',
    );
  }

  const [names, moduleData] = await _toWasmModuleData(manifest, opts.fetch ?? fetch);

  const config = { ...opts.config, ...manifest.config };
  const allowedHosts = [...(manifest.allowed_hosts || []), ...(opts.allowedHosts || [])];
  const allowedPaths = opts.allowedPaths || {};
  const functions = opts.functions || {};
  const logger = opts.logger || console;
  const _fetch = opts.fetch || fetch;
  const wasiEnabled = Boolean(opts.useWasi);

  const ic: InternalConfig = {
    allowedHosts,
    allowedPaths,
    functions,
    fetch: _fetch,
    wasiEnabled,
    logger,
    config,
  };

  return (opts.runInWorker ? _createBackgroundPlugin : _createForegroundPlugin)(ic, names, moduleData);
}
