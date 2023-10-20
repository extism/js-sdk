import Context from 'https://deno.land/std@0.200.0/wasi/snapshot_preview1.ts';
import { type InternalWasi } from '../mod.ts';

export async function loadWasi(allowedPaths: {[from: string]: string}): Promise<InternalWasi> {
  const context = new Context({
    preopens: allowedPaths,
    exitOnReturn: false,
  });

  return {
    async importObject() {
      return context.exports
    },

    async initialize(instance: WebAssembly.Instance) {
      const memory = instance.exports.memory as WebAssembly.Memory;

      if (!memory) {
        throw new Error('The module has to export a default memory.');
      }

      context.start({
        exports: {
          memory,
          _start: () => { },
        },
      });
    }
  }
}
