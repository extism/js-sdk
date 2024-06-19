import { type PluginConfig, PluginOutput, MemoryOptions } from './interfaces.ts';
import { CAPABILITIES } from './polyfills/deno-capabilities.ts';

export const BEGIN = Symbol('begin');
export const END = Symbol('end');
export const ENV = Symbol('env');
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
  #blocks: (Block | null)[] = [];
  #logger: Console;
  #decoder: TextDecoder;
  #encoder: TextEncoder;
  #arrayBufferType: { new(size: number): ArrayBufferLike };
  #config: PluginConfig;
  #vars: Map<string, Uint8Array> = new Map();
  #memoryOptions: MemoryOptions;

  /** @hidden */
  constructor(type: { new(size: number): ArrayBufferLike }, logger: Console, config: PluginConfig, memoryOptions: MemoryOptions) {
    this.#arrayBufferType = type;
    this.#logger = logger;
    this.#decoder = new TextDecoder();
    this.#encoder = new TextEncoder();
    this.#memoryOptions = memoryOptions;

    this.#stack = [];

    // reserve the null page.
    this.alloc(1);

    this.#config = config;
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
  getVariable(name: string): Uint8Array | null {
    if (!this.#vars.has(name)) {
      return null;
    }
    return this.#vars.get(name) || null;
  }

  /**
   * Set a variable to a given string or byte array value. Returns the start
   * address of the variable. The start address is reused when changing the
   * value of an existing variable.
   */
  setVariable(name: string, value: string | Uint8Array) {
    if (typeof value === 'string'){
      value = this.#encoder.encode(value);
    }
    const buf = new Uint8Array(value.buffer.byteLength);
    buf.set(new Uint8Array(value.buffer));
    this.#vars.set(name, buf);
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

  /** @hidden */
  [ENV] = {
    alloc: (n: bigint): bigint => {
      return this.alloc(n);
    },

    free: (addr: number) => {
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

    store_u8: (addr: bigint, n: number) => {
      const blockIdx = Block.addressToIndex(addr);
      const offset = Block.maskAddress(addr);
      const block = this.#blocks[blockIdx];
      block?.view.setUint8(Number(offset), Number(n));
    },

    store_u64: (addr: bigint, n: bigint) => {
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

    output_set: (addr: bigint, length: bigint) => {
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

    error_set: (addr: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        throw new Error('cannot assign to this block');
      }

      this.#stack[this.#stack.length - 1][2] = blockIdx;
    },

    config_get: (addr: bigint): bigint => {
      const item = this.read(addr);

      if (item === null) {
        return 0n;
      }

      const key = item.string();

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
      if (this.#vars.has(key)){
        const value = this.store(this.#vars.get(key)!);
        return value;
      }

      return 0n;
    },

    var_set: (addr: bigint, valueaddr: bigint): 0n | undefined => {
      const item = this.read(addr);

      if (item === null) {
        return 0n;
      }

      const key = item.string();
      if (valueaddr === 0n) {
        this.#vars.delete(key);
        return 0n;
      }

      const valueBlock = this.#blocks[Block.addressToIndex(valueaddr)];
      if (this.#memoryOptions.maxVarBytes) {
        const currentBytes = [...this.#vars.values()].map(x => x.length).reduce((acc, length) => acc + length, 0)
        const totalBytes = currentBytes + (valueBlock?.byteLength ?? 0);
        if (totalBytes > this.#memoryOptions.maxVarBytes) {
          throw Error(`var memory limit exceeded: ${totalBytes} bytes requested, ${this.#memoryOptions.maxVarBytes} allowed`);
        }
      }

      const value = this.read(valueaddr);
      if (value){
        const buf = new Uint8Array(value!.buffer.byteLength);
        buf.set(value.bytes());
        this.#vars.set(key, buf);
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
    if (!input) {
      return null;
    }

    if (typeof input === 'string') {
      input = this.#encoder.encode(input);
    }

    if (input instanceof Uint8Array) {
      if (input.buffer.constructor === this.#arrayBufferType) {
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
  [BEGIN](input: number | null) {
    this.#stack.push([input, null, null]);
  }

  /** @hidden */
  [END](): [number | null, number | null] {
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
