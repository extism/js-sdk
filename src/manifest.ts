/**
 * Represents a path or url to a WASM module
 */
export type ManifestWasmFile = {
  path: string;
  name?: string;
  hash?: string;
};

/**
 * Represents the raw bytes of a WASM file loaded into memory
 */
export type ManifestWasmData = {
  data: Uint8Array;
  name?: string;
  hash?: string;
};

/**
 * {@link ExtismPlugin} Config
 */
export type PluginConfig = Map<string, string>;

/**
 * The WASM to load as bytes or a path
 */
export type ManifestWasm = ManifestWasmFile | ManifestWasmData;

/**
 * The manifest which describes the {@link ExtismPlugin} code and
 * runtime constraints.
 *
 * @see [Extism > Concepts > Manifest](https://extism.org/docs/concepts/manifest)
 */
export type Manifest = {
  wasm: Array<ManifestWasm>;
  //memory?: ManifestMemory;
  config?: PluginConfig;
  allowed_hosts?: Array<string>;
};


// PluginWasi provides a unified interface for the supported WASI implementations
export class PluginWasi {
  wasi: any;
  imports: any;

  constructor(wasi: any, imports: any) {
    this.wasi = wasi;
    this.imports = imports;
  }

  importObject() {
    return this.imports;
  }
}