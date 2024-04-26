import { CAPABILITIES } from './polyfills/deno-capabilities.ts';

import type { ManifestLike, InternalConfig, ExtismPluginOptions, Plugin } from './interfaces.ts';

import { toWasmModuleData as _toWasmModuleData } from './manifest.ts';

import { createForegroundPlugin as _createForegroundPlugin } from './foreground-plugin.ts';
import { createBackgroundPlugin as _createBackgroundPlugin } from './background-plugin.ts';

export { CAPABILITIES } from './polyfills/deno-capabilities.ts';

export type {
  Capabilities,
  ExtismPluginOptions,
  ManifestLike,
  ManifestWasmResponse,
  ManifestWasmModule,
  ManifestWasmData,
  ManifestWasmUrl,
  ManifestWasmPath,
  ManifestWasm,
  Manifest,
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
  opts.allowedPaths ??= {};
  opts.allowedHosts ??= <any>[].concat(opts.allowedHosts || []);
  opts.logger ??= console;
  opts.config ??= {};
  opts.fetch ??= fetch;

  // TODO(chrisdickinson): reset this to `CAPABILITIES.hasWorkerCapability` once we've fixed https://github.com/extism/js-sdk/issues/46.
  opts.runInWorker ??= false;
  if (opts.runInWorker && !CAPABILITIES.hasWorkerCapability) {
    throw new Error(
      'Cannot enable off-thread wasm; current context is not `crossOriginIsolated` (see https://mdn.io/crossOriginIsolated)',
    );
  }

  const [names, moduleData] = await _toWasmModuleData(await Promise.resolve(manifest), opts.fetch ?? fetch);

  const ic: InternalConfig = {
    allowedHosts: opts.allowedHosts as [],
    allowedPaths: opts.allowedPaths,
    functions: opts.functions,
    fetch: opts.fetch || fetch,
    wasiEnabled: opts.useWasi,
    logger: opts.logger,
    config: opts.config,
    enableWasiOutput: opts.enableWasiOutput,
    sharedArrayBufferSize: Number(opts.sharedArrayBufferSize) || 1 << 16,
    fileDescriptors: opts.fileDescriptors ?? [],
  };

  return (opts.runInWorker ? _createBackgroundPlugin : _createForegroundPlugin)(ic, names, moduleData);
}

export { createPlugin as newPlugin };

export default createPlugin;
