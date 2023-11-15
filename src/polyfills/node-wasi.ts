import { WASI } from 'wasi';
import { type InternalWasi } from '../mod.ts';

export async function loadWasi(allowedPaths: { [from: string]: string }): Promise<InternalWasi> {
  const context = new WASI({
    version: 'preview1',
    preopens: allowedPaths,
  } as any);

  return {
    async importObject() {
      return context.wasiImport;
    },

    async initialize(instance: WebAssembly.Instance) {
      const memory = instance.exports.memory as WebAssembly.Memory;

      if (!memory) {
        throw new Error('The module has to export a default memory.');
      }

      if (instance.exports._initialize) {
        const init = instance.exports._initialize as CallableFunction;
        if (context.initialize) {
          context.initialize({
            exports: {
              memory,
              _initialize: () => {
                init();
              },
            },
          });
        } else {
          init();
        }
      } else {
        context.start({
          exports: {
            memory,
            _start: () => {},
          },
        });
      }
    },
  };
}
