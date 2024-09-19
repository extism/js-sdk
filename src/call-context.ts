import { type PluginConfig, PluginOutput, MemoryOptions } from './interfaces.ts';
import { CAPABILITIES } from './polyfills/deno-capabilities.ts';

export const BEGIN = Symbol('begin');
export const END = Symbol('end');
export const ENV = Symbol('env');
export const SET_HOST_CONTEXT = Symbol('set-host-context');
export const GET_BLOCK = Symbol('get-block');
export const IMPORT_STATE = Symbol('import-state');
export const EXPORT_STATE = Symbol('export-state');
export const STORE = Symbol('store-value');
export const RESET = Symbol('reset');

export class Block {
  buffer: ArrayBufferLike;
  view: DataView;
  local: boolean;

  get byteLength(): number {
    return this.buffer.byteLength;
  }

  constructor(arrayBuffer: ArrayBufferLike, local: boolean) {
    this.buffer = arrayBuffer;
    this.view = new DataView(this.buffer);
    this.local = local;
  }

  static indexToAddress(idx: bigint | number): bigint {
    return BigInt(idx) << 48n;
  }

  static addressToIndex(addr: bigint | number): number {
    return Number(BigInt(addr) >> 48n);
  }

  static maskAddress(addr: bigint | number): number {
    return Number(BigInt(addr) & ((1n << 48n) - 1n));
  }
}

export type CallState = {
  blocks: [ArrayBufferLike | null, number][];
  stack: [number | null, number | null, number | null][];
};

export class CallContext {
  #stack: [number | null, number | null, number | null][];
  /** @hidden */
  #blocks: (Block | null)[] = [];
  #logger: Console;
  #decoder: TextDecoder;
  #encoder: TextEncoder;
  #arrayBufferType: { new(size: number): ArrayBufferLike };
  #config: PluginConfig;
  #vars: Map<string, Uint8Array> = new Map();
  #varsSize: number;
  #memoryOptions: MemoryOptions;
  #hostContext: any

  /** @hidden */
  constructor(type: { new(size: number): ArrayBufferLike }, logger: Console, config: PluginConfig, memoryOptions: MemoryOptions) {
    this.#arrayBufferType = type;
    this.#logger = logger;
    this.#decoder = new TextDecoder();
    this.#encoder = new TextEncoder();
    this.#memoryOptions = memoryOptions;

    this.#varsSize = 0;
    this.#stack = [];

    // reserve the null page.
    this.alloc(1);

    this.#config = config;
  }

  hostContext<T = any>(): T {
    return this.#hostContext as T
  }

  /**
   * Allocate a chunk of host memory visible to plugins via other extism host functions.
   * Returns the start address of the block.
   */
  alloc(size: bigint | number): bigint {
    const block = new Block(new this.#arrayBufferType(Number(size)), true);
    const index = this.#blocks.length;
    this.#blocks.push(block);

    if (this.#memoryOptions.maxPages) {
      const pageSize = 64 * 1024;
      const totalBytes = this.#blocks.reduce((acc, block) => acc + (block?.buffer.byteLength ?? 0), 0)
      const totalPages = Math.ceil(totalBytes / pageSize);

      if (totalPages > this.#memoryOptions.maxPages) {
        this.#logger.error(`memory limit exceeded: ${totalPages} pages requested, ${this.#memoryOptions.maxPages} allowed`);
        return 0n;
      }
    }

    return Block.indexToAddress(index);
  }

  /**
   * Read a variable from extism memory by name.
   *
   * @returns {@link PluginOutput}
   */
  getVariable(name: string): PluginOutput | null {
    if (!this.#vars.has(name)) {
      return null;
    }
    return new PluginOutput(this.#vars.get(name)!.buffer);
  }

  /**
   * Set a variable to a given string or byte array value.
   */
  setVariable(name: string, value: string | Uint8Array) {
    const buffer = (
      typeof value === 'string'
        ? this.#encoder.encode(value)
        : value
    )

    const variable = this.#vars.get(name)

    const newSize = this.#varsSize + buffer.byteLength - (variable?.byteLength || 0)
    if (newSize > (this.#memoryOptions?.maxVarBytes || Infinity)) {
      throw new Error(`var memory limit exceeded: ${newSize} bytes requested, ${this.#memoryOptions.maxVarBytes} allowed`)
    }
    this.#varsSize = newSize
    this.#vars.set(name, buffer);
  }

  /**
   * Delete a variable if present.
   */
  deleteVariable(name: string) {
    const variable = this.#vars.get(name)
    if (!variable) {
      return
    }
    this.#vars.delete(name)
    this.#varsSize -= variable.byteLength
  }

  /**
   * Given an address in extism memory, return a {@link PluginOutput} that represents
   * a view of that memory. Returns null if the address is invalid.
   *
   * @returns bigint
   */
  read(addr: bigint | number): PluginOutput | null {
    const blockIdx = Block.addressToIndex(addr);
    const block = this.#blocks[blockIdx];
    if (!block) {
      return null;
    }

    const buffer =
      !(block.buffer instanceof ArrayBuffer) && !CAPABILITIES.allowSharedBufferCodec
        ? new Uint8Array(block.buffer).slice().buffer
        : block.buffer;

    return new PluginOutput(buffer);
  }

  /**
   * Store a string or Uint8Array value in extism memory.
   *
   * @returns bigint
   */
  store(input: string | Uint8Array): bigint {
    const idx = this[STORE](input);
    if (!idx) {
      throw new Error('failed to store output');
    }
    return Block.indexToAddress(idx);
  }

  length(addr: bigint): bigint {
    const blockIdx = Block.addressToIndex(addr);
    const block = this.#blocks[blockIdx];
    if (!block) {
      return 0n;
    }
    return BigInt(block.buffer.byteLength);
  }

  setError(err: string | Error | null = null) {
    const blockIdx = err ? this[STORE](err instanceof Error ? err.message : err) : 0
    if (!blockIdx) {
      throw new Error('could not store error value')
    }

    this.#stack[this.#stack.length - 1][2] = blockIdx;
  }

  /** @hidden */
  [ENV] = {
    alloc: (n: bigint): bigint => {
      return this.alloc(n);
    },

    free: (addr: number): void => {
      this.#blocks[Block.addressToIndex(addr)] = null;
    },

    load_u8: (addr: bigint): number => {
      const blockIdx = Block.addressToIndex(addr);
      const offset = Block.maskAddress(addr);
      const block = this.#blocks[blockIdx];
      return block?.view.getUint8(Number(offset)) as number;
    },

    load_u64: (addr: bigint): bigint => {
      const blockIdx = Block.addressToIndex(addr);
      const offset = Block.maskAddress(addr);
      const block = this.#blocks[blockIdx];
      return block?.view.getBigUint64(Number(offset), true) as bigint;
    },

    store_u8: (addr: bigint, n: number): void => {
      const blockIdx = Block.addressToIndex(addr);
      const offset = Block.maskAddress(addr);
      const block = this.#blocks[blockIdx];
      block?.view.setUint8(Number(offset), Number(n));
    },

    store_u64: (addr: bigint, n: bigint): void => {
      const blockIdx = Block.addressToIndex(addr);
      const offset = Block.maskAddress(addr);
      const block = this.#blocks[blockIdx];
      block?.view.setBigUint64(Number(offset), n, true);
    },

    input_offset: (): bigint => {
      const blockIdx = this.#stack[this.#stack.length - 1][0];
      return Block.indexToAddress(blockIdx || 0);
    },

    input_length: (): bigint => {
      return BigInt(this.#input?.byteLength ?? 0);
    },

    input_load_u8: (addr: bigint): number => {
      const offset = Block.maskAddress(addr);
      return this.#input?.view.getUint8(Number(offset)) as number;
    },

    input_load_u64: (addr: bigint): bigint => {
      const offset = Block.maskAddress(addr);
      return this.#input?.view.getBigUint64(Number(offset), true) as bigint;
    },

    output_set: (addr: bigint, length: bigint): void => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        throw new Error(`cannot assign to this block (addr=${addr.toString(16).padStart(16, '0')}; length=${length})`);
      }

      if (length > block.buffer.byteLength) {
        throw new Error('length longer than target block');
      }

      this.#stack[this.#stack.length - 1][1] = blockIdx;
    },

    error_set: (addr: bigint): void => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        throw new Error('cannot assign error to this block');
      }

      this.#stack[this.#stack.length - 1][2] = blockIdx;
    },

    error_get: (): bigint => {
      const error = this.#stack[this.#stack.length - 1][2]
      if (error) {
        return Block.indexToAddress(error)
      }
      return 0n
    },

    config_get: (addr: bigint): bigint => {
      const item = this.read(addr);

      if (item === null) {
        return 0n;
      }

      const key = item.string();

      this[ENV].free(addr);

      if (key in this.#config) {
        return this.store(this.#config[key]);
      }

      return 0n;
    },

    var_get: (addr: bigint): bigint => {
      const item = this.read(addr);

      if (item === null) {
        return 0n;
      }

      const key = item.string();
      this[ENV].free(addr);

      const result = this.getVariable(key);
      const stored = result ? this[STORE](result.bytes()) || 0 : 0;
      return Block.indexToAddress(stored)
    },

    var_set: (addr: bigint, valueaddr: bigint): void => {
      const item = this.read(addr);

      if (item === null) {
        this.#logger.error(`attempted to set variable using invalid key address (addr="${addr.toString(16)}H")`);
        return;
      }

      const key = item.string();
      this[ENV].free(addr);

      if (valueaddr === 0n) {
        this.deleteVariable(key)
        return;
      }

      const valueBlock = this.#blocks[Block.addressToIndex(valueaddr)];
      if (!valueBlock) {
        this.#logger.error(`attempted to set variable to invalid address (key="${key}"; addr="${valueaddr.toString(16)}H")`);
        return;
      }

      try {
        // Copy the variable value out of the block for TWO reasons:
        // 1. Variables outlive blocks -- blocks are reset after each invocation.
        // 2. If the block is backed by a SharedArrayBuffer, we can't read text out of it directly (in many browser contexts.)
        const copied = new Uint8Array(valueBlock.buffer.byteLength)
        copied.set(new Uint8Array(valueBlock.buffer), 0)
        this.setVariable(key, copied);
        this[ENV].free(valueaddr);
      } catch (err: any) {
        this.#logger.error(err.message)
        this.setError(err)
        return;
      }
    },

    http_request: (_requestOffset: bigint, _bodyOffset: bigint): bigint => {
      this.#logger.error('http_request is not enabled');
      return 0n;
    },

    http_status_code: (): number => {
      this.#logger.error('http_status_code is not enabled');
      return 0;
    },

    length: (addr: bigint): bigint => {
      return this.length(addr);
    },

    length_unsafe: (addr: bigint): bigint => {
      return this.length(addr);
    },

    log_warn: (addr: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        this.#logger.error(
          `failed to log(warn): bad block reference in addr 0x${addr.toString(16).padStart(64, '0')}`,
        );
        return;
      }
      const text = this.#decoder.decode(block.buffer);
      this.#logger.warn(text);
      this[ENV].free(addr);
    },

    log_info: (addr: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        this.#logger.error(
          `failed to log(info): bad block reference in addr 0x${addr.toString(16).padStart(64, '0')}`,
        );
        return;
      }
      const text = this.#decoder.decode(block.buffer);
      this.#logger.info(text);
      this[ENV].free(addr);
    },

    log_debug: (addr: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        this.#logger.error(
          `failed to log(debug): bad block reference in addr 0x${addr.toString(16).padStart(64, '0')}`,
        );
        return;
      }
      const text = this.#decoder.decode(block.buffer);
      this.#logger.debug(text);
      this[ENV].free(addr);
    },

    log_error: (addr: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        this.#logger.error(
          `failed to log(error): bad block reference in addr 0x${addr.toString(16).padStart(64, '0')}`,
        );
        return;
      }
      const text = this.#decoder.decode(block.buffer);
      this.#logger.error(text);
      this[ENV].free(addr);
    },
  };

  /** @hidden */
  get #input(): Block | null {
    const idx = this.#stack[this.#stack.length - 1][0];
    if (idx === null) {
      return null;
    }
    return this.#blocks[idx];
  }

  /** @hidden */
  [RESET]() {
    this.#hostContext = null;

    // preserve the null page.
    this.#blocks.length = 1;

    // ... but dump the stack items.
    this.#stack.length = 0;
  }

  /** @hidden */
  [GET_BLOCK](index: number): Block {
    const block = this.#blocks[index];
    if (!block) {
      throw new Error(`invalid block index: ${index}`);
    }
    return block;
  }

  /** @hidden */
  [IMPORT_STATE](state: CallState, copy: boolean = false) {
    // eslint-disable-next-line prefer-const
    for (let [buf, idx] of state.blocks) {
      if (buf && copy) {
        const dst = new Uint8Array(new this.#arrayBufferType(Number(buf.byteLength)));
        dst.set(new Uint8Array(buf));
        buf = dst.buffer;
      }
      this.#blocks[idx] = buf ? new Block(buf, false) : null;
    }
    this.#stack = state.stack;
  }

  /** @hidden */
  [EXPORT_STATE](): CallState {
    return {
      stack: this.#stack.slice(),
      blocks: this.#blocks
        .map((block, idx) => {
          if (!block) {
            return [null, idx];
          }

          if (block.local) {
            block.local = false;
            return [block.buffer, idx];
          }
          return null;
        })
        .filter(Boolean) as [ArrayBufferLike, number][],
    };
  }

  /** @hidden */
  [STORE](input?: string | Uint8Array): number | null {
    if (typeof input === 'string') {
      input = this.#encoder.encode(input);
    }

    if (!input) {
      return null;
    }

    if (input instanceof Uint8Array) {
      if (
        input.buffer.constructor === this.#arrayBufferType &&
        input.byteOffset === 0 &&
        input.byteLength === input.buffer.byteLength
      ) {
        // no action necessary, wrap it up in a block
        const idx = this.#blocks.length;
        this.#blocks.push(new Block(input.buffer, true));
        return idx;
      }
      const idx = Block.addressToIndex(this.alloc(input.length));
      const block = this.#blocks[idx] as Block;
      const buf = new Uint8Array(block.buffer);
      buf.set(input, 0);
      return idx;
    }

    return input;
  }

  /** @hidden */
  [SET_HOST_CONTEXT](hostContext: any) {
    this.#hostContext = hostContext
  }

  /** @hidden */
  [BEGIN](input: number | null) {
    this.#stack.push([input, null, null]);
  }

  /** @hidden */
  [END](): [number | null, number | null] {
    this.#hostContext = null
    const [, outputIdx, errorIdx] = this.#stack.pop() as (number | null)[];
    const outputPosition = errorIdx === null ? 1 : 0;
    const idx = errorIdx ?? outputIdx;
    const result: [number | null, number | null] = [null, null];

    if (idx === null) {
      return result;
    }

    const block = this.#blocks[idx];

    if (block === null) {
      // TODO: this might be an error? we got an output idx but it referred to a freed (or non-existant) block
      return result;
    }

    result[outputPosition] = idx;

    return result;
  }
}
