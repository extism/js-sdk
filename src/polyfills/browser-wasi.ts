import { WASI, Fd, File, OpenFile, ConsoleStdout } from '@bjorn3/browser_wasi_shim';
import { type InternalWasi } from '../interfaces.ts';

export async function loadWasi(
  _allowedPaths: { [from: string]: string },
  enableWasiOutput: boolean,
  fileDescriptors: Fd[],
): Promise<InternalWasi> {
  console.log('fileDescriptors = ', fileDescriptors);
  const args: Array<string> = [];
  const envVars: Array<string> = [];
  const fds: Fd[] = enableWasiOutput
    ? [
        ConsoleStdout.lineBuffered((msg) => console.log(msg)), // fd 0 is dup'd to stdout
        ConsoleStdout.lineBuffered((msg) => console.log(msg)),
        ConsoleStdout.lineBuffered((msg) => console.warn(msg)),
        ...fileDescriptors,
      ]
    : [
        new OpenFile(new File([])), // stdin
        new OpenFile(new File([])), // stdout
        new OpenFile(new File([])), // stderr
        ...fileDescriptors,
      ];

  const context = new WASI(args, envVars, fds, { debug: false });

  return {
    async importObject() {
      return context.wasiImport;
    },

    async close() {
      // noop
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
