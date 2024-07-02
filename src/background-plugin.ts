/*eslint-disable no-empty*/
import { CallContext, RESET, IMPORT_STATE, EXPORT_STATE, STORE, GET_BLOCK } from './call-context.ts';
import { MemoryOptions, PluginOutput, SAB_BASE_OFFSET, SharedArrayBufferSection, type InternalConfig } from './interfaces.ts';
import { readBodyUpTo } from './utils.ts';
import { WORKER_URL } from './worker-url.ts';
import { Worker } from 'node:worker_threads';
import { CAPABILITIES } from './polyfills/deno-capabilities.ts';
import { EXTISM_ENV } from './foreground-plugin.ts';
import { matches } from './polyfills/deno-minimatch.ts';

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
      return { async: true, value: promise };
    };
  })();

class BackgroundPlugin {
  sharedData: SharedArrayBuffer;
  sharedDataView: DataView;
  hostFlag: Int32Array;
  opts: InternalConfig;
  worker?: Worker;
  modules: WebAssembly.Module[];
  names: string[];

  #context: CallContext;
  #request: [(result: any[]) => void, (result: any[]) => void] | null = null;

  constructor(sharedData: SharedArrayBuffer, names: string[], modules: WebAssembly.Module[], opts: InternalConfig, context: CallContext) {
    this.sharedData = sharedData;
    this.sharedDataView = new DataView(sharedData);
    this.hostFlag = new Int32Array(sharedData);
    this.opts = opts;
    this.names = names;
    this.modules = modules;
    this.#context = context;

    this.hostFlag[0] = SAB_BASE_OFFSET;
  }

  async restartWorker() {
    if (this.worker) {
      this.worker.terminate();
    }

    this.worker = await createWorker(this.opts, this.names, this.modules, this.sharedData);
    this.worker.on('message', (ev) => this.#handleMessage(ev));
  }

  async reset(): Promise<boolean> {
    if (this.isActive()) {
      return false;
    }

    await this.#invoke('reset');

    this.#context[RESET]();
    return true;
  }

  isActive() {
    return Boolean(this.#request);
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

    if (!this.worker) {
      throw new Error('worker has crashed');
    }

    this.worker.postMessage({
      type: 'invoke',
      handler,
      args,
    });

    return promise;
  }

  async functionExists(funcName: string): Promise<boolean> {
    return await this.#invoke('functionExists', funcName);
  }

  // host -> guest invoke()
  async call(funcName: string, input?: string | Uint8Array): Promise<PluginOutput | null> {
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
      CAPABILITIES.allowSharedBufferCodec ? block.buffer : new Uint8Array(block.buffer).slice().buffer,
    );

    if (shouldThrow) {
      const msg = new TextDecoder().decode(buf);
      throw new Error(`Plugin-originated error: ${msg}`);
    }

    return buf;
  }

  async callBlock(funcName: string, input: number | null): Promise<[number | null, number | null]> {
    const exported = this.#context[EXPORT_STATE]();
    const { results, state } = await this.#invoke('call', funcName, input, exported);
    this.#context[IMPORT_STATE](state, true);

    const [err, data] = results;
    if (err) {
      throw err;
    }

    return data;
  }

  async getExports(): Promise<WebAssembly.ModuleExportDescriptor[]> {
    return await this.#invoke('getExports');
  }

  async getImports(): Promise<WebAssembly.ModuleImportDescriptor[]> {
    return await this.#invoke('getImports');
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

  // guest -> host invoke()
  async #handleInvoke(ev: any) {
    const writer = new RingBufferWriter(this.sharedData);
    const namespace = this.opts.functions[ev.namespace];
    const func = (namespace ?? {})[ev.func];
    // XXX(chrisdickinson): this is cürsëd code. Add a setTimeout because some platforms
    // don't spin their event loops if the only pending item is a Promise generated by Atomics.waitAsync.
    //
    // - https://github.com/nodejs/node/pull/44409
    // - https://github.com/denoland/deno/issues/14786
    const timer = setInterval(() => { }, 0);
    try {
      if (!func) {
        throw Error(`Plugin error: host function "${ev.namespace}" "${ev.func}" does not exist`);
      }

      // Fill the shared array buffer with an expected garbage value to make debugging
      // errors more straightforward
      new Uint8Array(this.sharedData).subarray(8).fill(0xfe);

      this.#context[IMPORT_STATE](ev.state, true);

      const data = await func(this.#context, ...ev.args);

      const { blocks } = this.#context[EXPORT_STATE]();

      // Writes to the ring buffer MAY return a promise if the write would wrap.
      // Writes that fit within the ring buffer return void.
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
          promise = writer.write(buffer);
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

      promise = writer.writeUint8(SharedArrayBufferSection.End);
      if (promise) {
        await promise;
      }
      await writer.flush();
    } catch (err) {
      this.close();
      const [, reject] = this.#request as any[];
      this.#request = null;
      return reject(err);
    } finally {
      clearInterval(timer);
    }
  }
}

// Return control to the waiting promise. Anecdotally, this appears to help
// with a race condition in Bun.
const MAX_WAIT = 500;
class RingBufferWriter {
  output: SharedArrayBuffer;
  scratch: ArrayBuffer;
  scratchView: DataView;
  outputOffset: number;
  flag: Int32Array;

  static SAB_IDX = 0;

  constructor(output: SharedArrayBuffer) {
    this.scratch = new ArrayBuffer(8);
    this.scratchView = new DataView(this.scratch);
    this.output = output;
    this.outputOffset = SAB_BASE_OFFSET;
    this.flag = new Int32Array(this.output);
    this.wait(0);
  }

  async wait(lastKnownValue: number) {
    // if the flag == SAB_BASE_OFFSET, that means "we have ownership", every other value means "the thread has ownership"
    let value = 0;
    do {
      value = Atomics.load(this.flag, 0);
      if (value === lastKnownValue) {
        const { value: result, async } = AtomicsWaitAsync(this.flag, 0, lastKnownValue, MAX_WAIT);
        if (async) {
          if ((await result) === 'timed-out') {
            continue;
          }
        }
      }
    } while (value === lastKnownValue);
  }

  signal() {
    const old = Atomics.load(this.flag, 0);
    while (Atomics.compareExchange(this.flag, 0, old, this.outputOffset) === old) { }
    Atomics.notify(this.flag, 0, 1);
  }

  async flush() {
    if (this.outputOffset === SAB_BASE_OFFSET) {
      // no need to flush -- we haven't written anything!
      return;
    }

    const workerId = this.outputOffset;
    this.signal();
    this.outputOffset = SAB_BASE_OFFSET;
    await this.wait(workerId);
  }

  async spanningWrite(input: Uint8Array) {
    let inputOffset = 0;
    let toWrite = this.output.byteLength - this.outputOffset;
    let flushedWriteCount = 1 + Math.floor((input.byteLength - toWrite) / (this.output.byteLength - SAB_BASE_OFFSET));
    const finalWrite = (input.byteLength - toWrite) % (this.output.byteLength - SAB_BASE_OFFSET);

    do {
      new Uint8Array(this.output).set(input.subarray(inputOffset, inputOffset + toWrite), this.outputOffset);

      // increment the offset so we know we've written _something_ (and can bypass the "did we not write anything" check in `flush()`)
      this.outputOffset += toWrite;
      inputOffset += toWrite;
      await this.flush();

      // reset toWrite to the maximum available length. (So we may write 29 bytes the first time, but 4096 the next N times.
      toWrite = this.output.byteLength - SAB_BASE_OFFSET;
      --flushedWriteCount;
    } while (flushedWriteCount != 0);

    if (finalWrite) {
      this.write(input.subarray(inputOffset, inputOffset + finalWrite));
    }
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
}

class HttpContext {
  fetch: typeof fetch;
  lastStatusCode: number;
  allowedHosts: string[];
  memoryOptions: MemoryOptions;

  constructor(_fetch: typeof fetch, allowedHosts: string[], memoryOptions: MemoryOptions) {
    this.fetch = _fetch;
    this.allowedHosts = allowedHosts;
    this.lastStatusCode = 0;
    this.memoryOptions = memoryOptions;
  }

  contribute(functions: Record<string, Record<string, any>>) {
    functions[EXTISM_ENV] ??= {};
    functions[EXTISM_ENV].http_request = (callContext: CallContext, reqaddr: bigint, bodyaddr: bigint) =>
      this.makeRequest(callContext, reqaddr, bodyaddr);
    functions[EXTISM_ENV].http_status_code = () => this.lastStatusCode;
  }

  async makeRequest(callContext: CallContext, reqaddr: bigint, bodyaddr: bigint) {
    const req = callContext.read(reqaddr);
    if (req === null) {
      return 0n;
    }

    const { headers, header, url: rawUrl, method: m } = req.json();
    const method = m ?? 'GET';
    const url = new URL(rawUrl);

    const isAllowed = this.allowedHosts.some((allowedHost) => {
      return allowedHost === url.hostname || matches(url.hostname, allowedHost);
    });

    if (!isAllowed) {
      throw new Error(`Call error: HTTP request to "${url}" is not allowed (no allowedHosts match "${url.hostname}")`);
    }

    const body = bodyaddr === 0n || method === 'GET' || method === 'HEAD' ? null : callContext.read(bodyaddr)?.bytes();
    const fetch = this.fetch;
    const response = await fetch(rawUrl, {
      headers: headers || header,
      method,
      ...(body ? { body: body.slice() } : {}),
    });

    this.lastStatusCode = response.status;

    let bytes = this.memoryOptions.maxHttpResponseBytes ?
      await readBodyUpTo(response, this.memoryOptions.maxHttpResponseBytes) :
      new Uint8Array(await response.arrayBuffer());

    const result = callContext.store(bytes);

    return result;
  }
}

export async function createBackgroundPlugin(
  opts: InternalConfig,
  names: string[],
  modules: WebAssembly.Module[],
): Promise<BackgroundPlugin> {
  const context = new CallContext(SharedArrayBuffer, opts.logger, opts.config, opts.memory);
  const httpContext = new HttpContext(opts.fetch, opts.allowedHosts, opts.memory);
  httpContext.contribute(opts.functions);

  // NB(chrisdickinson): We *have* to create the SharedArrayBuffer in
  // the parent context because -- for whatever reason! -- chromium does
  // not allow the creation of shared buffers in worker contexts, but firefox
  // and webkit do.
  const sharedData = new (SharedArrayBuffer as any)(opts.sharedArrayBufferSize);
  new Uint8Array(sharedData).subarray(8).fill(0xfe);

  const plugin = new BackgroundPlugin(sharedData, names, modules, opts, context);
  await plugin.restartWorker();

  return plugin;
}

async function createWorker(
  opts: InternalConfig,
  names: string[],
  modules: WebAssembly.Module[],
  sharedData: SharedArrayBuffer): Promise<Worker> {
  const worker = new Worker(WORKER_URL);

  await new Promise((resolve, reject) => {
    worker.on('message', function handler(ev) {
      if (ev?.type !== 'initialized') {
        reject(new Error(`received unexpected message (type=${ev?.type})`));
      }

      worker.removeListener('message', handler);
      resolve(null);
    });
  });

  const onready = new Promise((resolve, reject) => {
    worker.on('message', function handler(ev) {
      if (ev?.type !== 'ready') {
        reject(new Error(`received unexpected message (type=${ev?.type})`));
      }

      worker.removeListener('message', handler);
      resolve(null);
    });
  });

  const { fetch: _, logger: __, ...rest } = opts;
  const message = {
    ...rest,
    type: 'init',
    functions: Object.fromEntries(Object.entries(opts.functions || {}).map(([k, v]) => [k, Object.keys(v)])),
    names,
    modules,
    sharedData,
  };

  worker.postMessage(message);
  await onready;

  return worker;
}