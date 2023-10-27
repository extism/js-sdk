import { CallContext, GET_BLOCK, BEGIN, END, ENV, STORE } from './call-context.ts';
import { type InternalConfig } from './mod.ts';
import { loadWasi } from 'js-sdk:wasi';

const DYLIBSO_ENV = 'env';

class ForegroundPlugin {
  #context: CallContext;
  #modules: { guestType: string; module: WebAssembly.WebAssemblyInstantiatedSource }[];
  #names: string[];

  constructor(
    context: CallContext,
    names: string[],
    modules: { guestType: string; module: WebAssembly.WebAssemblyInstantiatedSource }[],
  ) {
    this.#context = context;
    this.#names = names;
    this.#modules = modules;
  }

  async functionExists(funcName: string | [string, string]): Promise<boolean> {
    try {
      const search: string[] = [].concat(<any>funcName);
      const [target, name] =
        search.length === 2
          ? [this.lookupTarget(search[0]), search[1]]
          : [
              this.#modules.find((guest) => {
                const exports = WebAssembly.Module.exports(guest.module.module);
                return exports.find((item) => {
                  return item.name === search[0] && item.kind === 'function';
                });
              }),
              search[0],
            ];

      if (!target) {
        return false;
      }

      const func = target.module.instance.exports[name] as any;

      if (!func) {
        return false;
      }

      return true;
    } catch {
      // lookupTarget will throw if it cannot find the specified target; cast it into a boolean
      return false;
    }
  }

  async callBlock(funcName: string | [string, string], input: number | null): Promise<[number | null, number | null]> {
    const search: string[] = [].concat(<any>funcName);
    const [target, name] =
      search.length === 2
        ? [this.lookupTarget(search[0]), search[1]]
        : [
            this.#modules.find((guest) => {
              const exports = WebAssembly.Module.exports(guest.module.module);
              return exports.find((item) => {
                return item.name === search[0] && item.kind === 'function';
              });
            }),
            search[0],
          ];

    if (!target) {
      throw Error(`Plugin error: target "${search.join('" "')}" does not exist`);
    }
    const func = target.module.instance.exports[name] as any;
    if (!func) {
      throw Error(`Plugin error: function "${search.join('" "')}" does not exist`);
    }

    this.#context[BEGIN](input ?? null);
    try {
      func();
      return this.#context[END]();
    } catch (err) {
      this.#context[END]();
      throw err;
    }
  }

  async call(funcName: string | [string, string], input?: string | Uint8Array): Promise<Uint8Array | null> {
    const inputIdx = this.#context[STORE](input);
    const [errorIdx, outputIdx] = await this.callBlock(funcName, inputIdx);
    const shouldThrow = errorIdx !== null;
    const idx = errorIdx ?? outputIdx;

    if (idx === null) {
      return null;
    }

    const block = this.#context[GET_BLOCK](idx);
    if (!block) {
      return null;
    }

    const buf = new Uint8Array(block.buffer);
    if (shouldThrow) {
      const msg = new TextDecoder().decode(buf);
      throw new Error(`Plugin-originated error: ${msg}`);
    }
    return buf;
  }

  private lookupTarget(name: any): { guestType: string; module: WebAssembly.WebAssemblyInstantiatedSource } {
    const target = String(name ?? '0');
    const idx = this.#names.findIndex((xs) => xs === target);
    if (idx === -1) {
      throw new Error(`no module named "${name}"`);
    }
    return this.#modules[idx];
  }

  async getExports(name?: string): Promise<WebAssembly.ModuleExportDescriptor[]> {
    return WebAssembly.Module.exports(this.lookupTarget(name).module.module) || [];
  }

  async getImports(name?: string): Promise<WebAssembly.ModuleImportDescriptor[]> {
    return WebAssembly.Module.imports(this.lookupTarget(name).module.module) || [];
  }

  async getInstance(name?: string): Promise<WebAssembly.Instance> {
    return this.lookupTarget(name).module.instance;
  }

  async close(): Promise<void> {
    // noop
  }
}

export async function createForegroundPlugin(
  opts: InternalConfig,
  names: string[],
  sources: ArrayBuffer[],
  context: CallContext = new CallContext(ArrayBuffer, opts.logger, opts.config),
): Promise<ForegroundPlugin> {
  const wasi = opts.wasiEnabled ? await loadWasi(opts.allowedPaths) : null;

  const imports: Record<string, Record<string, any>> = {
    ...(wasi ? { wasi_snapshot_preview1: await wasi.importObject() } : {}),
    [DYLIBSO_ENV]: context[ENV],
  };

  for (const namespace in opts.functions) {
    imports[namespace] = imports[namespace] || {};
    for (const func in opts.functions[namespace]) {
      imports[namespace][func] = opts.functions[namespace][func].bind(null, context);
    }
  }

  const modules = await Promise.all(
    sources.map(async (source, idx, all) => {
      const isRuntime = idx === all.length;
      const module = await WebAssembly.instantiate(source, (isRuntime ? {} : imports) as WebAssembly.Imports);
      if (!isRuntime && module.instance.exports._start) {
        await wasi?.initialize(module.instance);
      }

      const guestType = module.instance.exports._initialize
        ? 'reactor'
        : module.instance.exports.hs_init
        ? 'haskell'
        : module.instance.exports.__wasm_call_ctors
        ? 'command'
        : 'none';

      const init: any = module.instance.exports._initialize
        ? module.instance.exports._initialize
        : module.instance.exports.hs_init
        ? module.instance.exports.hs_init
        : module.instance.exports.__wasm_call_ctors
        ? module.instance.exports.__wasm_call_ctors
        : () => {};

      init();

      return { module, guestType };
    }),
  );

  return new ForegroundPlugin(context, names, modules);
}
