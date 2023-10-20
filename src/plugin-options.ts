import { EMBEDDED_RUNTIME, EMBEDDED_RUNTIME_HASH } from './runtime.ts';
import type { ManifestWasm } from './manifest.ts';
import { FEATURES } from 'js-sdk:features';

/**
 * Options for initializing an Extism plugin.
 */
export interface ExtismPluginOptions {
  useWasi?: boolean | undefined;
  runtime?: ManifestWasm | undefined;
  offMainThread?: boolean | undefined;
  logger?: Console;
  functions?: { [key: string]: { [key: string]: any } } | undefined;
  allowedPaths?: { [key: string]: string } | undefined;
  allowedHosts?: string[] | undefined;
  config?: PluginConfigLike | undefined;
  fetch?: typeof fetch;
}

export function intoPluginOptions(opts: ExtismPluginOptions): ExtismPluginOptions {
  opts = {...opts};
  opts.useWasi ??= false;
  opts.functions = opts.functions || {};
  opts.runtime ??= {
    data: Uint8Array.from(atob(EMBEDDED_RUNTIME) as ArrayLike<string>, (xs: string, _idx: number) => xs.codePointAt(0) as number),
    hash: EMBEDDED_RUNTIME_HASH
  }
  opts.allowedPaths ??= {};
  opts.allowedHosts ??= <any>[].concat(opts.allowedHosts || []);
  opts.logger ??= console;

  opts.offMainThread ??= FEATURES.hasOffThreadCapability;
  if (opts.offMainThread && !FEATURES.hasOffThreadCapability) {
    throw new Error(
      'Cannot enable off-thread wasm; current context is not `crossOriginIsolated` (see https://mdn.io/crossOriginIsolated)'
    );
  }

  opts.config = opts.config ?? {};
  return opts;
}
