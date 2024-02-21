import { CallContext, RESET, GET_BLOCK, BEGIN, END, ENV, STORE } from './call-context.ts';
import { PluginOutput, type InternalConfig, InternalWasi } from './interfaces.ts';
import { loadWasi } from './polyfills/deno-wasi.ts';

export const EXTISM_ENV = 'extism:host/env';

type InstantiatedModule = [WebAssembly.Module, WebAssembly.Instance];

export class ForegroundPlugin {
  #context: CallContext;
  #modules: InstantiatedModule[];
  #names: string[];
  #active: boolean = false;
  #wasi: InternalWasi | null;

  constructor(context: CallContext, names: string[], modules: InstantiatedModule[], wasi: InternalWasi | null) {
    this.#context = context;
    this.#names = names;
    this.#modules = modules;
    this.#wasi = wasi;
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
                const exports = WebAssembly.Module.exports(guest[0]);
                return exports.find((item) => {
                  return item.name === search[0] && item.kind === 'function';
                });
              }),
              search[0],
            ];

      if (!target) {
        return false;
      }

      const func = target[1].exports[name] as any;

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
              const exports = WebAssembly.Module.exports(guest[0]);
              return exports.find((item) => {
                return item.name === search[0] && item.kind === 'function';
              });
            }),
            search[0],
          ];

    if (!target) {
      throw Error(`Plugin error: target "${search.join('" "')}" does not exist`);
    }
    const func = target[1].exports[name] as any;
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
    const target = String(name ?? 'main');
    const idx = this.#names.findIndex((xs) => xs === target);
    if (idx === -1) {
      throw new Error(`no module named "${name}"`);
    }
    return this.#modules[idx];
  }

  async getExports(name?: string): Promise<WebAssembly.ModuleExportDescriptor[]> {
    return WebAssembly.Module.exports(this.lookupTarget(name)[0]) || [];
  }

  async getImports(name?: string): Promise<WebAssembly.ModuleImportDescriptor[]> {
    return WebAssembly.Module.imports(this.lookupTarget(name)[0]) || [];
  }

  async getInstance(name?: string): Promise<WebAssembly.Instance> {
    return this.lookupTarget(name)[1];
  }

  async close(): Promise<void> {
    if (this.#wasi) {
      await this.#wasi.close();
      this.#wasi = null;
    }
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

  // find the "main" module and try to instantiate it.
  const mainIndex = names.indexOf('main');
  const seen: Map<WebAssembly.Module, WebAssembly.Instance> = new Map();
  // assert(mainIndex !== -1);

  await instantiateModule('main', modules[mainIndex], imports, wasi, names, modules, seen);

  const instances = [...seen.entries()];
  return new ForegroundPlugin(context, names, instances, wasi);
}


async function instantiateModule(
  current: string,
  module: WebAssembly.Module,
  imports: Record<string, Record<string, any>>,
  wasi: InternalWasi | null,
  names: string[],
  modules: WebAssembly.Module[],
  linked: Map<WebAssembly.Module, WebAssembly.Instance | null>
) {
  linked.set(module, null);

  const instantiationImports: Record<string, Record<string, WebAssembly.ExportValue | Function>> = {}
  const requested = WebAssembly.Module.imports(module);

  for (const { kind, module, name } of requested) {
    const nameIdx = names.indexOf(module)
    if (nameIdx === -1) {
      // lookup from "imports"
      if (!Object.hasOwnProperty.call(imports, module)) {
        throw new Error(`from module "${current}": cannot resolve import "${module}" "${name}": not provided by host imports nor linked manifest items`);
      }

      if (!Object.hasOwnProperty.call(imports[module], name)) {
        throw new Error(`from module "${current}": cannot resolve import "${module}" "${name}" ("${module}" is a host module, but does not contain "${name}")`);
      }

      switch (kind) {
        case `function`: {
          instantiationImports[module] ??= {}
          instantiationImports[module][name] = imports[module][name] as Function;
          break
        }
        default:
          throw new Error(`from module "${current}": in import "${module}" "${name}", "${kind}"-typed host imports are not supported yet`)
      }

    } else {
      // lookup from "linked"
      const provider = modules[nameIdx]
      const providerExports = WebAssembly.Module.exports(provider)

      const target = providerExports.find(xs => {
        return xs.name === name && xs.kind === kind
      });

      if (!target) {
        throw new Error(`from module "${current}": cannot import "${module}" "${name}"; no export matched request`)
      }

      // TODO: IIRC the Wasmtime linking behavior, WASI "command" modules should be instantiated each time they're requested by a module in the
      // tree. Verify this behavior and adjust the implementation as necessary!

      if (!linked.has(provider)) {
        await instantiateModule(module, modules[nameIdx], imports, wasi, names, modules, linked)
      }

      const instance: WebAssembly.Instance | null | undefined = linked.get(modules[nameIdx])

      if (!instance) {
        // circular import, either make a trampoline or bail
        if (kind === 'function') {
          instantiationImports[module] = {}
          let cached: Function | null = null;
          instantiationImports[module][name] = (...args: (number | bigint)[]) => {
            if (cached) {
              return cached(...args);
            }
            const instance = linked.get(modules[nameIdx]);
            if (!instance) {
              throw new Error(`from module instance "${current}": target module "${module}" was never instantiated`);
            }
            cached = instance.exports[name] as Function;
            return cached(...args)
          }
        } else {
          throw new Error(`from module "${current}": cannot import "${module}" "${name}"; circular imports of type="${kind}" are not supported`)
        }
      } else {
        // Add each requested import value piecemeal, since we have to validate that _all_ import requests are satisfied by this
        // module.
        instantiationImports[module] ??= {};
        instantiationImports[module][name] = instance.exports[name] as WebAssembly.ExportValue;
      }
    }
  }

  const instance = await WebAssembly.instantiate(module, instantiationImports);

  const guestType = instance.exports.hs_init
    ? 'haskell'
    : instance.exports._initialize
    ? 'reactor'
    : instance.exports._start
    ? 'command'
    : 'none';

  // TODO: when should we call this?
  if (wasi) {
    await wasi?.initialize(instance);
  }

  const initRuntime: any = instance.exports.hs_init ? instance.exports.hs_init : () => {};
  initRuntime();

  linked.set(module, instance);
  return instance
}
