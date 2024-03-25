import { CallContext, RESET, GET_BLOCK, BEGIN, END, ENV, STORE } from './call-context.ts';
import { PluginOutput, type InternalConfig, InternalWasi } from './interfaces.ts';
import { loadWasi } from './polyfills/deno-wasi.ts';

export const EXTISM_ENV = 'extism:host/env';

type InstantiatedModule = [WebAssembly.Module, WebAssembly.Instance];

export class ForegroundPlugin {
  #context: CallContext;
  #instancePair: InstantiatedModule;
  #active: boolean = false;
  #wasi: InternalWasi[];

  constructor(context: CallContext, instancePair: InstantiatedModule, wasi: InternalWasi[]) {
    this.#context = context;
    this.#instancePair = instancePair;
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

  async functionExists(funcName: string): Promise<boolean> {
    return typeof this.#instancePair[1].exports[funcName] === 'function';
  }

  async callBlock(funcName: string, input: number | null): Promise<[number | null, number | null]> {
    this.#active = true;
    const func: CallableFunction | undefined = this.#instancePair[1].exports[funcName] as CallableFunction;

    if (!func) {
      throw Error(`Plugin error: function "${funcName}" does not exist`);
    }

    if (typeof func !== 'function') {
      throw Error(`Plugin error: export "${funcName}" is not a function`);
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

  async call(funcName: string, input?: string | Uint8Array): Promise<PluginOutput | null> {
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

  async getExports(): Promise<WebAssembly.ModuleExportDescriptor[]> {
    return WebAssembly.Module.exports(this.#instancePair[0]) || [];
  }

  async getImports(): Promise<WebAssembly.ModuleImportDescriptor[]> {
    return WebAssembly.Module.imports(this.#instancePair[0]) || [];
  }

  async getInstance(): Promise<WebAssembly.Instance> {
    return this.#instancePair[1];
  }

  async close(): Promise<void> {
    await Promise.all(this.#wasi.map((xs) => xs.close()));
    this.#wasi.length = 0;
  }
}

export async function createForegroundPlugin(
  opts: InternalConfig,
  names: string[],
  modules: WebAssembly.Module[],
  context: CallContext = new CallContext(ArrayBuffer, opts.logger, opts.config),
): Promise<ForegroundPlugin> {
  const imports: Record<string, Record<string, any>> = {
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
  if (mainIndex === -1) {
    throw new Error('Unreachable: manifests must have at least one "main" module. Enforced by "src/manifest.ts")');
  }
  const seen: Map<WebAssembly.Module, WebAssembly.Instance> = new Map();
  const wasiList: InternalWasi[] = [];

  const instance = await instantiateModule(['main'], modules[mainIndex], imports, opts, wasiList, names, modules, seen);

  return new ForegroundPlugin(context, [modules[mainIndex], instance], wasiList);
}

async function instantiateModule(
  current: string[],
  module: WebAssembly.Module,
  imports: Record<string, Record<string, any>>,
  opts: InternalConfig,
  wasiList: InternalWasi[],
  names: string[],
  modules: WebAssembly.Module[],
  linked: Map<WebAssembly.Module, WebAssembly.Instance | null>,
) {
  linked.set(module, null);

  const instantiationImports: Record<string, Record<string, WebAssembly.ExportValue | CallableFunction>> = {};
  const requested = WebAssembly.Module.imports(module);

  let wasi = null;
  for (const { kind, module, name } of requested) {
    const nameIdx = names.indexOf(module);

    if (nameIdx === -1) {
      if (module === 'wasi_snapshot_preview1' && wasi === null) {
        if (!opts.wasiEnabled) {
          throw new Error('WASI is not enabled; see the "wasiEnabled" plugin option');
        }

        if (wasi === null) {
          wasi = await loadWasi(opts.allowedPaths, opts.enableWasiOutput, opts.fileDescriptors);
          wasiList.push(wasi);
          imports.wasi_snapshot_preview1 = await wasi.importObject();
        }
      }

      // lookup from "imports"
      if (!Object.hasOwnProperty.call(imports, module)) {
        throw new Error(
          `from module "${current.join(
            '"/"',
          )}": cannot resolve import "${module}" "${name}": not provided by host imports nor linked manifest items`,
        );
      }

      if (!Object.hasOwnProperty.call(imports[module], name)) {
        throw new Error(
          `from module "${current.join(
            '"/"',
          )}": cannot resolve import "${module}" "${name}" ("${module}" is a host module, but does not contain "${name}")`,
        );
      }

      switch (kind) {
        case `function`: {
          instantiationImports[module] ??= {};
          instantiationImports[module][name] = imports[module][name] as CallableFunction;
          break;
        }
        default:
          throw new Error(
            `from module "${current.join(
              '"/"',
            )}": in import "${module}" "${name}", "${kind}"-typed host imports are not supported yet`,
          );
      }
    } else {
      // lookup from "linked"
      const provider = modules[nameIdx];
      const providerExports = WebAssembly.Module.exports(provider);

      const target = providerExports.find((xs) => {
        return xs.name === name && xs.kind === kind;
      });

      if (!target) {
        throw new Error(
          `from module "${current.join('"/"')}": cannot import "${module}" "${name}"; no export matched request`,
        );
      }

      // If the dependency provides "_start", treat it as a WASI Command module; instantiate it (and its subtree) directly.
      const instance = providerExports.find((xs) => xs.name === '_start')
        ? await instantiateModule([...current, module], provider, imports, opts, wasiList, names, modules, new Map())
        : !linked.has(provider)
        ? (await instantiateModule([...current, module], provider, imports, opts, wasiList, names, modules, linked),
          linked.get(provider))
        : linked.get(provider);

      if (!instance) {
        // circular import, either make a trampoline or bail
        if (kind === 'function') {
          instantiationImports[module] = {};
          let cached: CallableFunction | null = null;
          instantiationImports[module][name] = (...args: (number | bigint)[]) => {
            if (cached) {
              return cached(...args);
            }
            const instance = linked.get(modules[nameIdx]);
            if (!instance) {
              throw new Error(
                `from module instance "${current.join('"/"')}": target module "${module}" was never instantiated`,
              );
            }
            cached = instance.exports[name] as CallableFunction;
            return cached(...args);
          };
        } else {
          throw new Error(
            `from module "${current.join(
              '"/"',
            )}": cannot import "${module}" "${name}"; circular imports of type="${kind}" are not supported`,
          );
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

  if (wasi) {
    await wasi?.initialize(instance);
    if (instance.exports.hs_init) {
      (instance.exports.hs_init as CallableFunction)();
    }
  } else
    switch (guestType) {
      case 'command':
        if (instance.exports._initialize) {
          (instance.exports._initialize as CallableFunction)();
        }

        (instance.exports._start as CallableFunction)();
        break;
      case 'reactor':
        (instance.exports._initialize as CallableFunction)();
        break;
      case 'haskell':
        (instance.exports.hs_init as CallableFunction)();
        break;
    }

  linked.set(module, instance);
  return instance;
}
