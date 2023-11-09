import { parentPort } from 'node:worker_threads';

import {
  ForegroundPlugin,
  createForegroundPlugin as _createForegroundPlugin,
} from './foreground-plugin.ts';
import { CallContext, EXPORT_STATE, CallState, IMPORT_STATE } from './call-context.ts';
import { type InternalConfig } from './interfaces.ts';

// TODO: make this configurable
const MAX_WAIT = 5000;

class Reactor {
  hostFlag: Int32Array | null;
  sharedData: SharedArrayBuffer | null;
  sharedDataView: DataView | null;
  plugin?: ForegroundPlugin;
  port: Exclude<typeof parentPort, null>;
  dynamicHandlers: Map<string, (...args: any[]) => Promise<any>>;
  context?: CallContext;

  constructor(port: typeof parentPort) {
    if (!port) {
      throw new Error('This should be unreachable: this module should only be invoked as a web worker.');
    }

    this.sharedData = null;
    this.sharedDataView = null;
    this.hostFlag = null;
    this.port = port;
    this.port.on('message', (ev: any) => this.handleMessage(ev));
    this.port.postMessage({ type: 'initialized' });

    this.dynamicHandlers = new Map();
    this.dynamicHandlers.set(
      'call',
      async (transfer: any[], name: string | [string, string], input: number | null, state: CallState) => {
        if (!this.context) {
          throw new Error('invalid state: no context available to worker reactor');
        }

        this.context[IMPORT_STATE](state);

        const results: any = await this.plugin?.callBlock(name, input).then(
          (indices) => [null, indices],
          (err) => [err, null],
        );

        state = this.context[EXPORT_STATE]();
        for (const [block] of state.blocks) {
          if (block) {
            transfer.push(block);
          }
        }

        if (results[0]) {
          results[0] = {
            originalStack: results[0]?.stack,
            message: results[0]?.message,
          };
        }

        return { results, state };
      },
    );

    this.dynamicHandlers.set('reset', async (_txf) => {
      return this.plugin?.reset();
    });

    this.dynamicHandlers.set('getExports', async (_txf, name) => {
      return this.plugin?.getExports(name);
    });

    this.dynamicHandlers.set('getImports', async (_txf, name) => {
      return this.plugin?.getImports(name);
    });

    this.dynamicHandlers.set('functionExists', async (_txf, name) => {
      return this.plugin?.functionExists(name);
    });
  }

  async handleMessage(ev: any) {
    switch (ev.type) {
      case 'init':
        return await this.handleInit(ev);
      case 'invoke':
        return await this.handleInvoke(ev);
    }
  }

  async handleInvoke(ev: { handler: string; args: any[] }) {
    const handler = this.dynamicHandlers.get(ev.handler);
    if (!handler) {
      return this.port.postMessage({
        type: 'return',
        result: [`no handler registered for ${ev.handler}`, null],
      });
    }

    const transfer: any[] = [];
    const results = await handler(transfer, ...(ev.args || [])).then(
      (ok) => [null, ok],
      (err) => [err, null],
    );

    if (results[0]) {
      results[0] = {
        originalStack: results[0]?.stack,
        message: results[0]?.message,
      };
    }

    return this.port.postMessage(
      {
        type: 'return',
        results,
      },
      transfer,
    );
  }

  async handleInit(
    ev: InternalConfig & {
      type: string;
      names: string[];
      modules: ArrayBuffer[];
      sharedData: SharedArrayBuffer;
      functions: { [name: string]: string[] };
    },
  ) {
    this.sharedData = ev.sharedData;
    this.sharedDataView = new DataView(ev.sharedData);
    this.hostFlag = new Int32Array(this.sharedData);

    const functions = Object.fromEntries(
      Object.entries(ev.functions).map(([namespace, funcs]) => {
        return [
          namespace,
          Object.fromEntries(
            funcs.map((funcName) => {
              return [
                funcName,
                (context: CallContext, ...args: any[]) => this.callHost(context, namespace, funcName, args),
              ];
            }),
          ),
        ];
      }),
    );

    const { type: _, modules, functions: __, ...opts } = ev;

    const logLevel = (level: string) => (message: string) => this.port.postMessage({ type: 'log', level, message });

    // TODO: we're using non-blocking log functions here; to properly preserve behavior we
    // should invoke these and wait on the host to return.
    const logger = Object.fromEntries(
      ['info', 'debug', 'warn', 'error'].map((lvl) => [lvl, logLevel(lvl)]),
    ) as unknown as Console;

    this.context = new CallContext(ArrayBuffer, logger, ev.config);
    // TODO: replace our internal fetch and logger
    this.plugin = await _createForegroundPlugin(
      { ...opts, functions, fetch, logger } as InternalConfig,
      ev.names,
      modules,
      this.context,
    );

    this.port.postMessage({ type: 'ready' });
  }

  callHost(context: CallContext, namespace: string, func: string, args: (number | bigint)[]): number | bigint | void {
    if (!this.hostFlag) {
      throw new Error('attempted to call host before receiving shared array buffer');
    }
    const state = context[EXPORT_STATE]();

    this.port.postMessage({
      type: 'invoke',
      namespace,
      func,
      args,
      state,
    });

    const reader = new RingBufferReader(this.sharedData as SharedArrayBuffer);
    const blocks: [ArrayBufferLike | null, number][] = [];
    let retval: any;

    do {
      const sectionType = reader.readUint8();
      switch (sectionType) {
        // end
        case 0:
          state.blocks = blocks;
          context[IMPORT_STATE](state);
          reader.close();
          this.hostFlag[0] = RingBufferReader.SAB_BASE_OFFSET;
          return retval;

        // ret i64
        case 1:
          retval = reader.readUint64();
          break;

        // ret f64
        case 2:
          retval = reader.readFloat64();
          break;

        // ret void
        case 3:
          retval = undefined;
          break;

        // block
        case 4:
          {
            const index = reader.readUint32();
            const len = reader.readUint32();
            if (!len) {
              blocks.push([null, index]);
            } else {
              const output = new Uint8Array(len);
              reader.read(output);
              blocks.push([output.buffer, index]);
            }
          }
          break;

        default:
          throw new Error(
            `invalid section type="${sectionType}"; please open an issue (https://github.com/extism/js-sdk/issues/new?title=shared+array+buffer+bad+section+type+${sectionType}&labels=bug)`,
          );
          break;
      }
    } while (1);
  }
}

new Reactor(parentPort);

class RingBufferReader {
  input: SharedArrayBuffer;
  flag: Int32Array;
  inputOffset: number;
  scratch: ArrayBuffer;
  scratchView: DataView;
  expected: number;

  static SAB_IDX = 0;
  static SAB_BASE_OFFSET = 4;

  constructor(input: SharedArrayBuffer) {
    this.input = input;
    this.inputOffset = RingBufferReader.SAB_BASE_OFFSET;
    this.flag = new Int32Array(this.input);
    this.scratch = new ArrayBuffer(8);
    this.scratchView = new DataView(this.scratch);
    this.expected = 0;
    this.pull(false);
  }

  get available() {
    return this.flag[0] - this.inputOffset;
  }

  close() {
    while (
      Atomics.compareExchange(this.flag, RingBufferReader.SAB_IDX, this.expected, RingBufferReader.SAB_BASE_OFFSET) !==
      RingBufferReader.SAB_BASE_OFFSET
    ) {} // eslint-disable-line no-empty
    Atomics.notify(this.flag, RingBufferReader.SAB_IDX, MAX_WAIT);
  }

  pull(reset: boolean = true) {
    if (reset) {
      while (
        Atomics.compareExchange(
          this.flag,
          RingBufferReader.SAB_IDX,
          this.expected,
          RingBufferReader.SAB_BASE_OFFSET,
        ) !== RingBufferReader.SAB_BASE_OFFSET
      ) {} // eslint-disable-line no-empty
      Atomics.notify(this.flag, RingBufferReader.SAB_IDX, MAX_WAIT);
    }
    // host now copies out, once it's done it writes the available bytes to the flag.
    const v = Atomics.wait(this.flag, 0, RingBufferReader.SAB_BASE_OFFSET, MAX_WAIT);
    this.expected = Atomics.load(this.flag, 0);
    if (v === 'timed-out') {
      throw new Error(`Worker timed out waiting for response from host after ${MAX_WAIT}ms ${this.flag[0]}`);
    }
    this.inputOffset = RingBufferReader.SAB_BASE_OFFSET;
  }

  read(output: Uint8Array) {
    if (output.byteLength < this.available) {
      output.set(new Uint8Array(this.input).subarray(this.inputOffset, this.inputOffset + output.byteLength));
      this.inputOffset += output.byteLength;
      return;
    }

    let outputOffset = 0;
    let extent = this.available;
    // read ::= [outputoffset, inputoffset, extent]
    // firstread = [this.outputOffset, 0, this.available - this.outputOffset]
    do {
      output.set(new Uint8Array(this.input).subarray(this.inputOffset, this.inputOffset + extent), outputOffset);
      outputOffset += extent;
      this.inputOffset += extent;
      if (outputOffset === output.byteLength) {
        break;
      }

      if (this.available < 0) {
        break;
      }

      this.pull();
      extent = Math.min(Math.max(this.available, 0), output.byteLength - outputOffset);
    } while (outputOffset !== output.byteLength);
  }

  readUint8(): number {
    this.read(new Uint8Array(this.scratch).subarray(0, 1));
    return this.scratchView.getUint8(0);
  }

  readUint32(): number {
    this.read(new Uint8Array(this.scratch).subarray(0, 4));
    return this.scratchView.getUint32(0, true);
  }

  readUint64(): bigint {
    this.read(new Uint8Array(this.scratch));
    return this.scratchView.getBigUint64(0, true);
  }

  readFloat64(): number {
    this.read(new Uint8Array(this.scratch));
    return this.scratchView.getFloat64(0, true);
  }
}
