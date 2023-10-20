import { PluginConfigLike } from './mod.ts';
import { readFile } from 'js-sdk:fs';

/**
 * Represents the raw bytes of a WASM file loaded into memory
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
 */
export type ManifestWasm = (
  ManifestWasmUrl |
  ManifestWasmData |
  ManifestWasmPath
) & {
  name?: string | undefined;
  hash?: string | undefined;
};

/**
 * The manifest which describes the {@link ExtismPlugin} code and
 * runtime constraints.
 *
 * @see [Extism > Concepts > Manifest](https://extism.org/docs/concepts/manifest)
 */
export interface Manifest {
  wasm: Array<ManifestWasm>;
  config?: PluginConfigLike | undefined;
  allowed_hosts?: Array<string> | undefined;
}

/**
 * Any type that can be converted into an Extism {@link Manifest}.
 * - `object` instances that implement {@link Manifest} are validated.
 * - `ArrayBuffer` instances are converted into {@link Manifest}s with a single {@link ManifestWasmData} member.
 * - `URL` instances are fetched and their responses interpreted according to their `content-type` response header. `application/wasm` and `application/octet-stream` items
 *   are treated as {@link ManifestWasmData} items; `application/json` and `text/json` are treated as JSON-encoded {@link Manifest}s.
 * - `string` instances that start with `http://`, `https://`, or `file://` are treated as URLs.
 * - `string` instances that DO NOT start with `http://`, `https://`, or `file://` are treated as JSON-encoded {@link Manifest}s.
 *
 * @throws {@link TypeError} when `URL` parameters don't resolve to a known `content-type`
 * @throws {@link TypeError} when the resulting {@link Manifest} does not contain a `wasm` member with valid {@link ManifestWasm} items.
 */
export type ManifestLike = Manifest | ArrayBuffer | string | URL;

async function _populateWasmField(candidate: ManifestLike, _fetch: typeof fetch): Promise<ManifestLike> {
  if (candidate instanceof ArrayBuffer) {
    return { wasm: [{ data: new Uint8Array(candidate as ArrayBuffer) }] };
  }

  if (typeof candidate === 'string') {
    if (candidate.search(/^\s*\{/g) === 0) {
      return JSON.parse(candidate);
    }

    if (candidate.search(/^(https?|file):\/\//) !== 0) {
      return { wasm: [{ path: candidate }] }
    }

    candidate = new URL(candidate);
  }

  if (candidate instanceof URL) {
    const response = await _fetch(candidate, { redirect: 'follow' });
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    switch (contentType.split(';')[0]) {
      case 'application/octet-stream':
      case 'application/wasm':
        return _populateWasmField(await response.arrayBuffer(), _fetch);
      case 'application/json':
      case 'text/json':
        return _populateWasmField(JSON.parse(await response.text()), _fetch);
      default:
        throw new TypeError(
          `While processing manifest URL "${candidate}"; expected content-type of "text/json", "application/json", "application/octet-stream", or "application/wasm"; got "${contentType}" after stripping off charset.`
        )
    }
  }

  if (!('wasm' in candidate)) {
    throw new TypeError('Expected "wasm" key in manifest')
  }

  if (!Array.isArray(candidate.wasm)) {
    throw new TypeError('Expected "manifest.wasm" to be array')
  }

  const badItemIdx = candidate.wasm.findIndex(
    item => !('data' in item) && !('url' in item) && !('path' in item)
  );
  if (badItemIdx > -1) {
    throw new TypeError(`Expected every item in "manifest.wasm" to include either a "data", "url", or "path" key; got bad item at index ${badItemIdx}`)
  }

  return {...candidate as Manifest};
}

export async function intoManifest(candidate: ManifestLike, _fetch: typeof fetch = fetch): Promise<Manifest> {
  const manifest = await _populateWasmField(candidate, _fetch) as Manifest;
  manifest.config ??= {};
  manifest.allowed_hosts = <any>[].concat(manifest.allowed_hosts || [] as any);
  return manifest;
}

export async function toWasmModuleData(manifest: Manifest, _fetch: typeof fetch): Promise<[string[], ArrayBuffer[]]> {
  const names: string[] = [];

  const manifestsWasm = await Promise.all(manifest.wasm.map(async (item, idx) => {
    let buffer: ArrayBuffer;
    if ((item as ManifestWasmData).data) {
      const data = (item as ManifestWasmData).data;

      if ((data as Uint8Array).buffer) {
        buffer = data.buffer;
      } else {
        buffer = data as ArrayBuffer;
      }
    } else if ((item as ManifestWasmPath).path) {
      const path = (item as ManifestWasmPath).path;
      const data = await readFile(path);
      buffer = data.buffer as ArrayBuffer;
    } else {
      const response = await _fetch((item as ManifestWasmUrl).url, {
        headers: {
          accept: 'application/wasm;q=0.9,application/octet-stream;q=0.8',
          'user-agent': 'extism'
        }
      })

      buffer = await response.arrayBuffer();
    }

    if (item.hash) {
      const hashBuffer = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
      const checkBuffer = new Uint8Array(32);
      let eq = true;
      for (let i = 0; i < 32; ++i) {
        checkBuffer[i] = parseInt(item.hash.slice(i<<1, (i<<1) + 2), 16);
        // do not exit early: we want to do a constant time comparison
        eq = eq && (checkBuffer[i] === hashBuffer[i]);
      }
      const hashAsString = () => [...hashBuffer].map(xs => xs.toString(16).padStart(2, '0')).join(''); 

      if (!eq) {
        throw new Error(`Plugin error: hash mismatch. Expected: ${item.hash}. Actual: ${hashAsString()}`);
      }

      item.name ??= hashAsString();
    }

    (<any>names[idx]) = item.name ?? String(idx);
    return buffer
  }));

  return [names, manifestsWasm]
}
