import type {
  Manifest,
  ManifestWasmUrl,
  ManifestWasmData,
  ManifestWasmPath,
  ManifestWasmResponse,
  ManifestWasmModule,
  ManifestLike,
  PluginConfigLike,
  ManifestOptions,
} from './interfaces.ts';
import { readFile } from './polyfills/node-fs.ts';
import { responseToModule } from './polyfills/response-to-module.ts';

async function _populateWasmField(candidate: ManifestLike, _fetch: typeof fetch): Promise<ManifestLike> {
  if (candidate instanceof ArrayBuffer) {
    return { wasm: [{ data: new Uint8Array(candidate as ArrayBuffer) }] };
  }

  if (candidate instanceof WebAssembly.Module) {
    return { wasm: [{ module: candidate as WebAssembly.Module }] };
  }

  if (typeof candidate === 'string') {
    if (candidate.search(/^\s*\{/g) === 0) {
      return parseManifestFromJson(candidate);
    }

    if (candidate.search(/^(https?|file):\/\//) !== 0) {
      return { wasm: [{ path: candidate }] };
    }

    candidate = new URL(candidate);
  }

  if (candidate instanceof Response || candidate?.constructor?.name === 'Response') {
    const response: Response = candidate as Response;
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    switch (contentType.split(';')[0]) {
      case 'application/octet-stream':
      case 'application/wasm':
        return { wasm: [{ response }] };
      case 'application/json':
      case 'text/json':
        return _populateWasmField(parseManifestFromJson(await response.text()), _fetch);
      default:
        throw new TypeError(
          `While processing manifest URL "${response.url}"; expected content-type of "text/json", "application/json", "application/octet-stream", or "application/wasm"; got "${contentType}" after stripping off charset.`,
        );
    }
  }

  if (candidate instanceof URL) {
    return _populateWasmField(await _fetch(candidate, { redirect: 'follow' }), _fetch);
  }

  if (!('wasm' in candidate)) {
    throw new TypeError('Expected "wasm" key in manifest');
  }

  if (!Array.isArray(candidate.wasm)) {
    throw new TypeError('Expected "manifest.wasm" to be array');
  }

  const badItemIdx = candidate.wasm.findIndex(
    (item) =>
      !('data' in item) && !('url' in item) && !('path' in item) && !('module' in item) && !('response' in item),
  );
  if (badItemIdx > -1) {
    throw new TypeError(
      `Expected every item in "manifest.wasm" to include either a "data", "url", or "path" key; got bad item at index ${badItemIdx}`,
    );
  }

  return { ...(candidate as Manifest) };
}

function parseManifestFromJson(json: string): Manifest {
  const parsed = JSON.parse(json);

  return {
    wasm: parsed.wasm,
    allowedPaths: parsed.allowed_paths,
    allowedHosts: parsed.allowed_hosts,
    config: parsed.config,
    timeoutMs: parsed.timeout_ms,
    memory: {
      maxHttpResponseBytes: parsed.memory?.max_http_response_bytes,
      maxPages: parsed.memory?.max_pages,
      maxVarBytes: parsed.memory?.max_var_bytes,
    }
  };
}

async function intoManifest(candidate: ManifestLike, _fetch: typeof fetch = fetch): Promise<Manifest> {
  const manifest = (await _populateWasmField(candidate, _fetch)) as Manifest;
  manifest.config ??= {};
  return manifest;
}

export async function toWasmModuleData(
  input: ManifestLike,
  _fetch: typeof fetch,
): Promise<[ManifestOptions, string[], WebAssembly.Module[]]> {
  const names: string[] = [];

  const manifest = await intoManifest(input, _fetch);
  const manifestOpts: ManifestOptions = {
    allowedPaths: manifest.allowedPaths,
    allowedHosts: manifest.allowedHosts,
    config: manifest.config,
    timeoutMs: manifest.timeoutMs,
  };

  const manifestsWasm = await Promise.all(
    manifest.wasm.map(async (item, idx, all) => {
      let module: WebAssembly.Module;
      let buffer: ArrayBuffer | undefined;
      if ((item as ManifestWasmData).data) {
        const data = (item as ManifestWasmData).data;
        buffer = data.buffer ? data.buffer : data;
        module = await WebAssembly.compile(data);
      } else if ((item as ManifestWasmPath).path) {
        const path = (item as ManifestWasmPath).path;
        const data = await readFile(path);
        buffer = data.buffer as ArrayBuffer;
        module = await WebAssembly.compile(data);
      } else if ((item as ManifestWasmUrl).url) {
        const response = await _fetch((item as ManifestWasmUrl).url, {
          headers: {
            accept: 'application/wasm;q=0.9,application/octet-stream;q=0.8',
            'user-agent': 'extism',
          },
        });
        const result = await responseToModule(response, Boolean(item.hash));
        buffer = result.data;
        module = result.module;
      } else if ((item as ManifestWasmResponse).response) {
        const result = await responseToModule((item as ManifestWasmResponse).response, Boolean(item.hash));
        buffer = result.data;
        module = result.module;
      } else if ((item as ManifestWasmModule).module) {
        (<any>names[idx]) = item.name ?? String(idx);
        module = (item as ManifestWasmModule).module;
      } else {
        throw new Error(
          `Unrecognized wasm item at index ${idx}. Keys include: "${Object.keys(item).sort().join(',')}"`,
        );
      }

      let potentialName = String(idx);
      if (item.hash) {
        if (!buffer) {
          throw new Error('Item specified a hash but WebAssembly.Module source data is unavailable for hashing');
        }

        const hashBuffer = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
        const checkBuffer = new Uint8Array(32);
        let eq = true;
        for (let i = 0; i < 32; ++i) {
          checkBuffer[i] = parseInt(item.hash.slice(i << 1, (i << 1) + 2), 16);
          // do not exit early: we want to do a constant time comparison
          eq = eq && checkBuffer[i] === hashBuffer[i];
        }
        const hashAsString = () => [...hashBuffer].map((xs) => xs.toString(16).padStart(2, '0')).join('');

        if (!eq) {
          throw new Error(`Plugin error: hash mismatch. Expected: ${item.hash}. Actual: ${hashAsString()}`);
        }

        potentialName = hashAsString();
      }

      (<any>names[idx]) = item.name ?? (idx === all.length - 1 ? 'main' : potentialName);

      return module;
    }),
  );

  if (!names.includes('main')) {
    throw new Error('manifest with multiple modules must designate one "main" module');
  }

  return [manifestOpts, names, manifestsWasm];
}
