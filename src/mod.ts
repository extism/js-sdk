import { CAPABILITIES } from './polyfills/deno-capabilities.ts';

import {
  logLevelToPriority,
  type ExtismPluginOptions,
  type InternalConfig,
  type ManifestLike,
  type Plugin,
} from './interfaces.ts';

import { toWasmModuleData as _toWasmModuleData } from './manifest.ts';

import { createForegroundPlugin as _createForegroundPlugin } from './foreground-plugin.ts';
import { createBackgroundPlugin as _createBackgroundPlugin } from './background-plugin.ts';

export { CAPABILITIES } from './polyfills/deno-capabilities.ts';

export type {
  Capabilities,
  ExtismPluginOptions,
  LogLevel,
  Manifest,
  ManifestLike,
  ManifestWasm,
  ManifestWasmData,
  ManifestWasmModule,
  ManifestWasmPath,
  ManifestWasmResponse,
  ManifestWasmUrl,
  MemoryOptions,
  Plugin,
  PluginConfig,
  PluginConfigLike,
  PluginOutput,
} from './interfaces.ts';

export type { CallContext, CallContext as CurrentPlugin } from './call-context.ts';

/**
 * Create a {@link Plugin} given a {@link ManifestLike} and {@link ExtismPluginOptions}.
 *
 * Plugins wrap Wasm modules, exposing rich access to exported functions.
 *
 * ```ts
 * const plugin = await createPlugin(
 *   'https://github.com/extism/plugins/releases/download/v0.3.0/count_vowels.wasm',
 *   { useWasi: true }
 * );
 *
 * try {
 *   const result = await plugin.call('count_vowels', 'hello world');
 *   const parsed = result.json();
 *
 *   console.log(parsed); // { count: 3, total: 3, vowels: "aeiouAEIOU" }
 * } finally {
 *   await plugin.close();
 * }
 * ```
 *
 * {@link Plugin | `Plugin`} can run on a background thread when the
 * environment supports it. You can see if the current environment supports
 * background plugins by checking the {@link Capabilities#hasWorkerCapability |
 * `hasWorkerCapability`} property of {@link CAPABILITIES}.
 *
 * @param manifest A {@link ManifestLike | `ManifestLike`}. May be a `string`
 * representing a URL, JSON, a path to a wasm file ({@link
 * Capabilities#manifestSupportsPaths | in environments} where paths are
 * supported); an [ArrayBuffer](https://mdn.io/ArrayBuffer); or a {@link
 * Manifest}.
 *
 * @param opts {@link ExtismPluginOptions | options} for controlling the behavior
 * of the plugin.
 *
 * @returns a promise for a {@link Plugin}.
 */
export async function createPlugin(
  manifest: ManifestLike | PromiseLike<ManifestLike>,
  opts: ExtismPluginOptions = {},
): Promise<Plugin> {
  opts = { ...opts };
  opts.useWasi ??= false;
  opts.enableWasiOutput ??= opts.useWasi ? CAPABILITIES.extismStdoutEnvVarSet : false;
  opts.functions = opts.functions || {};

  // TODO(chrisdickinson): reset this to `CAPABILITIES.hasWorkerCapability` once we've fixed https://github.com/extism/js-sdk/issues/46.
  opts.runInWorker ??= false;

  opts.logger ??= console;
  opts.logLevel ??= 'silent';
  opts.fetch ??= fetch;

  const [manifestOpts, names, moduleData] = await _toWasmModuleData(
    await Promise.resolve(manifest),
    opts.fetch ?? fetch,
  );

  opts.allowedPaths = opts.allowedPaths || manifestOpts.allowedPaths || {};
  opts.allowedHosts = opts.allowedHosts || manifestOpts.allowedHosts || [];
  opts.config = opts.config || manifestOpts.config || {};
  opts.memory = opts.memory || manifestOpts.memory || {};
  opts.timeoutMs = opts.timeoutMs || manifestOpts.timeoutMs || null;
  opts.nodeWorkerArgs = Object.assign(
    {
      name: 'extism plugin',
      execArgv: ['--disable-warning=ExperimentalWarning'],
    },
    opts.nodeWorkerArgs || {},
  );

  if (opts.allowedHosts.length && !opts.runInWorker) {
    if (!(WebAssembly as any).Suspending) {
      throw new TypeError(
        '"allowedHosts" requires "runInWorker: true". HTTP functions are only available to plugins running in a worker.',
      );
    }
  }

  if (opts.timeoutMs && !opts.runInWorker) {
    throw new TypeError(
      '"timeout" requires "runInWorker: true". Call timeouts are only available to plugins running in a worker.',
    );
  }

  if (opts.runInWorker && !CAPABILITIES.hasWorkerCapability) {
    throw new Error(
      'Cannot enable off-thread wasm; current context is not `crossOriginIsolated` (see https://mdn.io/crossOriginIsolated)',
    );
  }

  for (const guest in opts.allowedPaths) {
    const host = opts.allowedPaths[guest];

    if (host.startsWith('ro:')) {
      throw new Error(`Readonly dirs are not supported: ${host}`);
    }
  }

  const ic: InternalConfig = {
    executingInWorker: false,
    allowedHosts: opts.allowedHosts as [],
    allowedPaths: opts.allowedPaths,
    functions: opts.functions,
    fetch: opts.fetch || fetch,
    wasiEnabled: opts.useWasi,
    logger: opts.logger,
    logLevel: logLevelToPriority(opts.logLevel || 'silent'),
    config: opts.config,
    enableWasiOutput: opts.enableWasiOutput,
    sharedArrayBufferSize: Number(opts.sharedArrayBufferSize) || 1 << 16,
    timeoutMs: opts.timeoutMs,
    memory: opts.memory,
    allowHttpResponseHeaders: !!opts.allowHttpResponseHeaders,
    nodeWorkerArgs: opts.nodeWorkerArgs || {},
  };

  return (opts.runInWorker ? _createBackgroundPlugin : _createForegroundPlugin)(ic, names, moduleData);
}

export { createPlugin as newPlugin };

export default createPlugin;
