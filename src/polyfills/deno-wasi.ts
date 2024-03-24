import { Fd } from '@bjorn3/browser_wasi_shim';
import Context from 'https://deno.land/std@0.200.0/wasi/snapshot_preview1.ts';
import { type InternalWasi } from '../interfaces.ts';
import { devNull } from 'node:os';
import { open } from 'node:fs/promises';
import { closeSync } from 'node:fs';

async function createDevNullFDs() {
  const [stdin, stdout] = await Promise.all([open(devNull, 'r'), open(devNull, 'w')]);
  let needsClose = true;
  const fr = new globalThis.FinalizationRegistry((held: number) => {
    try {
      if (needsClose) closeSync(held);
    } catch {
      // The fd may already be closed.
    }
  });
  fr.register(stdin, stdin.fd);
  fr.register(stdout, stdout.fd);

  return {
    async close() {
      needsClose = false;
      await Promise.all([stdin.close(), stdout.close()]).catch(() => {});
    },
    fds: [stdin.fd, stdout.fd, stdout.fd],
  };
}

export async function loadWasi(
  allowedPaths: { [from: string]: string },
  enableWasiOutput: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fileDescriptors: Fd[],
): Promise<InternalWasi> {
  const {
    close,
    fds: [stdin, stdout, stderr],
  } = enableWasiOutput ? { async close() {}, fds: [0, 1, 2] } : await createDevNullFDs();
  const context = new Context({
    preopens: allowedPaths,
    exitOnReturn: false,
    stdin,
    stdout,
    stderr,
  });

  return {
    async importObject() {
      return context.exports;
    },

    async close() {
      await close();
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
