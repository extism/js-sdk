import { CAPABILITIES } from 'js-sdk:capabilities';

import type {
  ManifestLike,
  InternalConfig,
  ExtismPluginOptions,
  Plugin,
} from './interfaces.ts';

import { intoManifest as _intoManifest, toWasmModuleData as _toWasmModuleData } from './manifest.ts';

import { createForegroundPlugin as _createForegroundPlugin } from './foreground-plugin.ts';
import { createBackgroundPlugin as _createBackgroundPlugin } from './background-plugin.ts';

export { CAPABILITIES } from 'js-sdk:capabilities';

export type {
  Capabilities,
  ExtismPluginOptions,
  ManifestLike,
  ManifestWasmData,
  ManifestWasmUrl,
  ManifestWasmPath,
  ManifestWasm,
  Manifest,
  Plugin
} from './interfaces.ts';

export type {
  CallContext,
  CallContext as CurrentPlugin,
} from './call-context.ts'

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
 * {@link Plugin | `Plugin`} default to running on a background thread when the
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
  manifest = await _intoManifest(await Promise.resolve(manifest));
  opts = { ...opts };
  opts.useWasi ??= false;
  opts.functions = opts.functions || {};
  opts.allowedPaths ??= {};
  opts.allowedHosts ??= <any>[].concat(opts.allowedHosts || []);
  opts.logger ??= console;
  opts.config ??= {};

  opts.runInWorker ??= CAPABILITIES.hasWorkerCapability;
  if (opts.runInWorker && !CAPABILITIES.hasWorkerCapability) {
    throw new Error(
      'Cannot enable off-thread wasm; current context is not `crossOriginIsolated` (see https://mdn.io/crossOriginIsolated)',
    );
  }

  const [names, moduleData] = await _toWasmModuleData(manifest, opts.fetch ?? fetch);

  const ic: InternalConfig = {
    allowedHosts: opts.allowedHosts as [],
    allowedPaths: opts.allowedPaths,
    functions: opts.functions,
    fetch: opts.fetch || fetch,
    wasiEnabled: opts.useWasi,
    logger: opts.logger,
    config: opts.config,
  };

  return (opts.runInWorker ? _createBackgroundPlugin : _createForegroundPlugin)(ic, names, moduleData);
}

export default createPlugin;
