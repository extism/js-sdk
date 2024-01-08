import { WASI, Fd, File, OpenFile, wasi } from '@bjorn3/browser_wasi_shim';
import { type InternalWasi } from '../mod.ts';

class Output extends Fd {
  #mode: string;

  constructor(mode: string) {
    super();
    this.#mode = mode;
  }

  fd_write(view8: Uint8Array, iovs: [wasi.Iovec]): { ret: number; nwritten: number } {
    let nwritten = 0;
    const decoder = new TextDecoder();
    const str = iovs.reduce((acc, iovec, idx, all) => {
      nwritten += iovec.buf_len;
      const buffer = view8.slice(iovec.buf, iovec.buf + iovec.buf_len);
      return acc + decoder.decode(buffer, { stream: idx !== all.length - 1 });
    }, '');

    (console[this.#mode] as any)(str);

    return { ret: 0, nwritten };
  }
}

export async function loadWasi(
  _allowedPaths: { [from: string]: string },
  enableWasiOutput: boolean,
): Promise<InternalWasi> {
  const args: Array<string> = [];
  const envVars: Array<string> = [];
  const fds: Fd[] = enableWasiOutput
    ? [
        new Output('log'), // fd 0 is dup'd to stdout
        new Output('log'),
        new Output('error'),
      ]
    : [
        new OpenFile(new File([])), // stdin
        new OpenFile(new File([])), // stdout
        new OpenFile(new File([])), // stderr
      ];

  const context = new WASI(args, envVars, fds);

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
