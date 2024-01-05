import { CallContext, RESET, GET_BLOCK, BEGIN, END, ENV, STORE } from './call-context.ts';
import { PluginOutput, type InternalConfig } from './interfaces.ts';
import { loadWasi } from './polyfills/deno-wasi.ts';

export const EXTISM_ENV = 'extism:host/env';

type InstantiatedModule = { guestType: string; module: WebAssembly.Module; instance: WebAssembly.Instance };

export class ForegroundPlugin {
  #context: CallContext;
  #modules: InstantiatedModule[];
  #names: string[];
  #active: boolean = false;

  constructor(context: CallContext, names: string[], modules: InstantiatedModule[]) {
    this.#context = context;
    this.#names = names;
    this.#modules = modules;
  }

  async reset(): Promise<boolean> {
    if (this.isActive()) {
      return false;
    }

    this.#context[RESET]();
    return true;
  }

  isActive() {
    return this.#active;
  }

  async functionExists(funcName: string | [string, string]): Promise<boolean> {
    try {
      const search: string[] = [].concat(<any>funcName);
      const [target, name] =
        search.length === 2
          ? [this.lookupTarget(search[0]), search[1]]
          : [
              this.#modules.find((guest) => {
                const exports = WebAssembly.Module.exports(guest.module);
                return exports.find((item) => {
                  return item.name === search[0] && item.kind === 'function';
                });
              }),
              search[0],
            ];

      if (!target) {
        return false;
      }

      const func = target.instance.exports[name] as any;

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
    this.#active = true;
    const search: string[] = [].concat(<any>funcName);
    const [target, name] =
      search.length === 2
        ? [this.lookupTarget(search[0]), search[1]]
        : [
            this.#modules.find((guest) => {
              const exports = WebAssembly.Module.exports(guest.module);
              return exports.find((item) => {
                return item.name === search[0] && item.kind === 'function';
              });
            }),
            search[0],
          ];

    if (!target) {
      throw Error(`Plugin error: target "${search.join('" "')}" does not exist`);
    }
    const func = target.instance.exports[name] as any;
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
    } finally {
      this.#active = false;
    }
  }

  async call(funcName: string | [string, string], input?: string | Uint8Array): Promise<PluginOutput | null> {
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

    const output = new PluginOutput(block.buffer);
    if (shouldThrow) {
      throw new Error(`Plugin-originated error: ${output.string()}`);
    }
    return output;
  }

  private lookupTarget(name: any): InstantiatedModule {
    const target = String(name ?? '0');
    const idx = this.#names.findIndex((xs) => xs === target);
    if (idx === -1) {
      throw new Error(`no module named "${name}"`);
    }
    return this.#modules[idx];
  }

  async getExports(name?: string): Promise<WebAssembly.ModuleExportDescriptor[]> {
    return WebAssembly.Module.exports(this.lookupTarget(name).module) || [];
  }

  async getImports(name?: string): Promise<WebAssembly.ModuleImportDescriptor[]> {
    return WebAssembly.Module.imports(this.lookupTarget(name).module) || [];
  }

  async getInstance(name?: string): Promise<WebAssembly.Instance> {
    return this.lookupTarget(name).instance;
  }

  async close(): Promise<void> {
    // noop
  }
}

export async function createForegroundPlugin(
  opts: InternalConfig,
  names: string[],
  modules: WebAssembly.Module[],
  context: CallContext = new CallContext(ArrayBuffer, opts.logger, opts.config),
): Promise<ForegroundPlugin> {
  const wasi = opts.wasiEnabled ? await loadWasi(opts.allowedPaths, opts.enableWasiOutput) : null;

  const imports: Record<string, Record<string, any>> = {
    ...(wasi ? { wasi_snapshot_preview1: await wasi.importObject() } : {}),
    [EXTISM_ENV]: context[ENV],
    env: {},
  };

  for (const namespace in opts.functions) {
    imports[namespace] = imports[namespace] || {};
    for (const func in opts.functions[namespace]) {
      imports[namespace][func] = opts.functions[namespace][func].bind(null, context);
    }
  }

  const instances = await Promise.all(
    modules.map(async (module) => {
      const instance = await WebAssembly.instantiate(module, imports);
      if (wasi) {
        await wasi?.initialize(instance);
      }

      const guestType = instance.exports.hs_init
        ? 'haskell'
        : instance.exports._initialize
        ? 'reactor'
        : instance.exports._start
        ? 'command'
        : 'none';

      const initRuntime: any = instance.exports.hs_init ? instance.exports.hs_init : () => {};
      initRuntime();

      return { module, instance, guestType };
    }),
  );

  return new ForegroundPlugin(context, names, instances);
}
