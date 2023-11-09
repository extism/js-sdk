import { WASI, Fd, File, OpenFile } from '@bjorn3/browser_wasi_shim';
import { type InternalWasi } from '../mod.ts';

export async function loadWasi(_allowedPaths: { [from: string]: string }): Promise<InternalWasi> {
  const args: Array<string> = [];
  const envVars: Array<string> = [];
  const fds: Fd[] = [
    new OpenFile(new File([])), // stdin
    new OpenFile(new File([])), // stdout
    new OpenFile(new File([])), // stderr
  ];

  const context = new WASI(args, envVars, fds);

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
        if (context.initialize){
          context.initialize({
            exports: {
              memory,
              _initialize: () => {
                init();
              }
            }
          });
        } else {
          init();
        }
      } else if (instance.exports._start) {
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
