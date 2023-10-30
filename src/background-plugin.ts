import { CallContext, IMPORT_STATE, EXPORT_STATE, STORE, GET_BLOCK } from './call-context.ts';
import { PluginOutput, type InternalConfig } from './interfaces.ts';
import { WORKER_URL } from 'js-sdk:worker-url';
import { Worker } from 'node:worker_threads';
import { CAPABILITIES } from 'js-sdk:capabilities';

const MAX_WAIT = 5000;

enum SharedArrayBufferSection {
  End = 0,
  RetI64 = 1,
  RetF64 = 2,
  RetVoid = 3,
  Block = 4,
}

// Firefox has not yet implemented Atomics.waitAsync, but we can polyfill
// it using a worker as a one-off.
//
// TODO: we should probably give _each_ background plugin its own waiter
// script.
const AtomicsWaitAsync =
  Atomics.waitAsync ||
  (() => {
    const src = `onmessage = ev => {
    const [b, i, v] = ev.data
    const f = new Int32Array(b)
    postMessage(Atomics.wait(f, i, v));
  }`;

    const blob = new (Blob as any)([src], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    return (ia: any, index, value) => {
      const promise = new Promise((resolve) => {
        w.once('message', (data) => {
          resolve(data);
        });
      });
      w.postMessage([ia.buffer, index, value]);
      return promise;
    };
  })();

class BackgroundPlugin {
  worker: Worker;
  sharedData: SharedArrayBuffer;
  sharedDataView: DataView;
  hostFlag: Int32Array;
  opts: InternalConfig;

  #context: CallContext;
  #request: [(result: any[]) => void, (result: any[]) => void] | null = null;

  constructor(worker: Worker, sharedData: SharedArrayBuffer, opts: InternalConfig, context: CallContext) {
    this.worker = worker;
    this.sharedData = sharedData;
    this.sharedDataView = new DataView(sharedData);
    this.hostFlag = new Int32Array(sharedData);
    this.opts = opts;
    this.#context = context;

    this.worker.on('message', (ev) => this.#handleMessage(ev));
  }

  async #handleMessage(ev: any) {
    switch (ev?.type) {
      case 'invoke':
        return this.#handleInvoke(ev);
      case 'return':
        return this.#handleReturn(ev);
      case 'log':
        return this.#handleLog(ev);
    }
  }

  #handleLog(ev: any) {
    const fn = (this.opts.logger as any)[ev.level as string];
    if (typeof fn !== 'function') {
      this.opts.logger?.error(`failed to find loglevel="${ev.level}" on logger: message=${ev.message}`);
    } else {
      fn.call(this.opts.logger, ev.message);
    }
  }

  #handleReturn(ev: any) {
    const responder = this.#request || null;
    if (responder === null) {
      // This is fatal, we should probably panic
      throw new Error(`received "return" call with no corresponding request`);
    }

    this.#request = null;

    const [resolve, reject] = responder;

    if (!Array.isArray(ev.results) || ev.results.length !== 2) {
      return reject(new Error(`received malformed "return"`) as any);
    }

    const [err, data] = ev.results;

    err ? reject(err) : resolve(data);
  }

  // host -> guest() invoke
  async #invoke(handler: string, ...args: any[]): Promise<any> {
    if (this.#request) {
      throw new Error('plugin is not reentrant');
    }
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.#request = [resolve as any, reject as any];

    this.worker.postMessage({
      type: 'invoke',
      handler,
      args,
    });

    return promise;
  }

  async functionExists(funcName: string | [string, string]): Promise<boolean> {
    return await this.#invoke('functionExists', funcName);
  }

  // host -> guest invoke()
  async call(funcName: string | [string, string], input?: string | Uint8Array): Promise<PluginOutput | null> {
    const index = this.#context[STORE](input);

    const [errorIdx, outputIdx] = await this.callBlock(funcName, index);

    const shouldThrow = errorIdx !== null;
    const idx = errorIdx ?? outputIdx;

    if (idx === null) {
      return null;
    }

    const block = this.#context[GET_BLOCK](idx);

    if (block === null) {
      return null;
    }

    const buf = new PluginOutput(
      CAPABILITIES.allowSharedBufferCodec
      ? block.buffer
      : new Uint8Array(block.buffer).slice().buffer
    );

    if (shouldThrow) {
      const msg = new TextDecoder().decode(buf);
      throw new Error(`Plugin-originated error: ${msg}`);
    }

    return buf;
  }

  async callBlock(funcName: string | [string, string], input: number | null): Promise<[number | null, number | null]> {
    const exported = this.#context[EXPORT_STATE]();
    const { results, state } = await this.#invoke('call', funcName, input, exported);
    this.#context[IMPORT_STATE](state, true);

    const [err, data] = results;
    if (err) {
      throw err;
    }

    return data;
  }

  // guest -> host invoke()
  async #handleInvoke(ev: any) {
    const namespace = this.opts.functions[ev.namespace];
    const func = (namespace ?? {})[ev.func];
    try {
      if (!func) {
        throw Error(`Plugin error: host function "${ev.namespace}" "${ev.func}" does not exist`);
      }

      this.#context[IMPORT_STATE](ev.state, true);

      const data = await func(this.#context, ...ev.args);

      const { blocks } = this.#context[EXPORT_STATE]();

      // Writes to the ring buffer MAY return a promise if the write would wrap.
      // Writes that fit within the ring buffer return void.
      const writer = new RingBufferWriter(this.sharedData);
      let promise: any;
      for (const [buffer, destination] of blocks) {
        promise = writer.writeUint8(SharedArrayBufferSection.Block);
        if (promise) {
          await promise;
        }

        promise = writer.writeUint32(destination);
        if (promise) {
          await promise;
        }

        promise = writer.writeUint32(buffer?.byteLength || 0);
        if (promise) {
          await promise;
        }

        if (buffer) {
          promise = writer.write(new Uint8Array(buffer));
          if (promise) {
            await promise;
          }
        }
      }

      if (typeof data === 'bigint') {
        promise = writer.writeUint8(SharedArrayBufferSection.RetI64);
        if (promise) {
          await promise;
        }

        promise = writer.writeUint64(data);
        if (promise) {
          await promise;
        }
      } else if (typeof data === 'number') {
        promise = writer.writeUint8(SharedArrayBufferSection.RetF64);
        if (promise) {
          await promise;
        }

        promise = writer.writeFloat64(data);
        if (promise) {
          await promise;
        }
      } else {
        promise = writer.writeUint8(SharedArrayBufferSection.RetVoid);
        if (promise) {
          await promise;
        }
      }
      ((await writer.writeUint8(SharedArrayBufferSection.End)) as any) || writer.flush();
    } catch (err) {
      this.close();
      const [, reject] = this.#request as any[];
      this.#request = null;
      return reject(err);
    }
  }

  async getExports(name?: string): Promise<WebAssembly.ModuleExportDescriptor[]> {
    return await this.#invoke('getExports', name ?? '0');
  }

  async getImports(name?: string): Promise<WebAssembly.ModuleImportDescriptor[]> {
    return await this.#invoke('getImports', name ?? '0');
  }

  async getInstance(): Promise<WebAssembly.Instance> {
    throw new Error('todo');
  }

  async close(): Promise<void> {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null as any;
    }
  }
}

export async function createBackgroundPlugin(
  opts: InternalConfig,
  names: string[],
  modules: ArrayBuffer[],
): Promise<BackgroundPlugin> {
  const worker = new Worker(WORKER_URL);
  const context = new CallContext(SharedArrayBuffer, opts.logger, opts.config);

  await new Promise((resolve, reject) => {
    worker.on('message', function handler(ev) {
      if (ev?.type !== 'initialized') {
        reject(new Error(`received unexpected message (type=${ev?.type})`));
      }

      worker.removeListener('message', handler);
      resolve(null);
    });
  });

  // NB(chrisdickinson): We *have* to create the SharedArrayBuffer in
  // the parent context because -- for whatever reason! -- chromium does
  // not allow the creation of shared buffers in worker contexts, but firefox
  // and webkit do.
  const sharedData = new (SharedArrayBuffer as any)(1 << 16);

  const { fetch: _, logger: __, ...rest } = opts;
  const message = {
    ...rest,
    type: 'init',
    functions: Object.fromEntries(Object.entries(opts.functions || {}).map(([k, v]) => [k, Object.keys(v)])),
    names,
    modules,
    sharedData,
  };

  const onready = new Promise((resolve, reject) => {
    worker.on('message', function handler(ev) {
      if (ev?.type !== 'ready') {
        reject(new Error(`received unexpected message (type=${ev?.type})`));
      }

      worker.removeListener('message', handler);
      resolve(null);
    });
  });

  worker.postMessage(message, modules);
  await onready;

  return new BackgroundPlugin(worker, sharedData, opts, context);
}

class RingBufferWriter {
  output: SharedArrayBuffer;
  scratch: ArrayBuffer;
  scratchView: DataView;
  outputOffset: number;

  constructor(output: SharedArrayBuffer) {
    this.scratch = new ArrayBuffer(8);
    this.scratchView = new DataView(this.scratch);
    this.output = output;
    this.outputOffset = 4;
  }

  async spanningWrite(input: Uint8Array) {
    let outputOffset = this.outputOffset;
    let inputOffset = 0;
    let toWrite = this.output.byteLength - this.outputOffset;
    let flushedWriteCount = 1 + Math.floor((input.byteLength - toWrite) / this.output.byteLength);
    const finalWrite = (input.byteLength - toWrite) % this.output.byteLength;
    do {
      new Uint8Array(this.output).set(input.subarray(inputOffset, toWrite), outputOffset);
      await this.flush();
      inputOffset += toWrite;
      outputOffset = 4;
      toWrite = this.output.byteLength - 4;
      --flushedWriteCount;
    } while (flushedWriteCount != 0);

    if (finalWrite) {
      new Uint8Array(this.output).set(input.subarray(inputOffset, finalWrite), outputOffset);
      outputOffset += finalWrite;
    }

    this.outputOffset = outputOffset;
  }

  write(bytes: ArrayBufferLike): void | Promise<void> {
    if (bytes.byteLength + this.outputOffset < this.output.byteLength) {
      new Uint8Array(this.output).set(new Uint8Array(bytes), this.outputOffset);
      this.outputOffset += bytes.byteLength;
      return;
    }

    return this.spanningWrite(new Uint8Array(bytes));
  }

  writeUint8(value: number): void | Promise<void> {
    this.scratchView.setUint8(0, value);
    return this.write(this.scratch.slice(0, 1));
  }

  writeUint32(value: number): void | Promise<void> {
    this.scratchView.setUint32(0, value, true);
    return this.write(this.scratch.slice(0, 4));
  }

  writeUint64(value: bigint): void | Promise<void> {
    this.scratchView.setBigUint64(0, value, true);
    return this.write(this.scratch.slice(0, 8));
  }

  writeFloat64(value: number): void | Promise<void> {
    this.scratchView.setFloat64(0, value, true);
    return this.write(this.scratch.slice(0, 8));
  }

  async flush() {
    const flag = new Int32Array(this.output);

    Atomics.store(flag, 0, this.outputOffset);
    Atomics.notify(flag, 0);
    const result = AtomicsWaitAsync(flag, 0, this.outputOffset, MAX_WAIT);
    if (result.async) {
      result.value = (await result.value) as any;
    }

    if (result.value === 'timed-out') {
      throw new Error('encountered timeout while flushing host function to worker memory');
    }
  }
}
