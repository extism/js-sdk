import { type PluginConfig } from './mod.ts';
import { FEATURES } from 'js-sdk:features';

export const BEGIN = Symbol('begin')
export const END = Symbol('end')
export const ENV = Symbol('env')
export const GET_BLOCK = Symbol('get-block')
export const IMPORT_STATE = Symbol('import-state')
export const EXPORT_STATE = Symbol('export-state')
export const STORE = Symbol('store-value')

export class Block {
  buffer: ArrayBufferLike
  view: DataView
  local: boolean

  get byteLength() {
    return this.buffer.byteLength
  }

  constructor(arrayBuffer: ArrayBufferLike, local: boolean) {
    this.buffer = arrayBuffer
    this.view = new DataView(this.buffer)
    this.local = local
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

export type CallState = { blocks: [ArrayBufferLike | null, number][], stack: [number | null, number | null, number | null][] };

export class CallContext {
  #stack: [number | null, number | null, number | null][];
  #blocks: (Block | null)[] = [];
  #logger: Console
  #decoder: TextDecoder;
  #encoder: TextEncoder;
  #arrayBufferType: { new(size: number): ArrayBufferLike ;}
  #config: PluginConfig;

  readString(addr: bigint | number): string | null {
    const blockIdx = Block.addressToIndex(addr);
    const block = this.#blocks[blockIdx];
    if (!block) {
      return null
    }

    const buffer = (
      (!(block.buffer instanceof ArrayBuffer) && !FEATURES.allowSharedBufferCodec)
      ? new Uint8Array(block.buffer).slice().buffer
      : block.buffer
    );

    return this.#decoder.decode(buffer);
  }

  store(input: string | Uint8Array | number): bigint {
    const idx = this[STORE](input);
    if (!idx) {
      throw new Error('failed to store output')
    }
    return Block.indexToAddress(idx)
  }

  [ENV] = {
    extism_alloc: (n: bigint): bigint => {
      const block = this.alloc(n)
      const addr = Block.indexToAddress(block)
      return addr;
    },

    extism_free: (addr: number) => {
      this.#blocks[Block.addressToIndex(addr)] = null;
    },

    extism_load_u8: (addr: bigint): number => {
      const blockIdx = Block.addressToIndex(addr);
      const offset = Block.maskAddress(addr);
      const block = this.#blocks[blockIdx];
      return block?.view.getUint8(Number(offset)) as number;
    },

    extism_load_u64: (addr: bigint): bigint => {
      const blockIdx = Block.addressToIndex(addr);
      const offset = Block.maskAddress(addr);
      const block = this.#blocks[blockIdx];
      return block?.view.getBigUint64(Number(offset), true) as bigint;
    },

    extism_store_u8: (addr: bigint, n: number) => {
      const blockIdx = Block.addressToIndex(addr);
      const offset = Block.maskAddress(addr);
      const block = this.#blocks[blockIdx];
      block?.view.setUint8(Number(offset), Number(n));
    },

    extism_store_u64: (addr: bigint, n: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const offset = Block.maskAddress(addr);
      const block = this.#blocks[blockIdx];
      block?.view.setBigUint64(Number(offset), n, true);
    },

    extism_input_length: () => {
      return BigInt(this.#input?.byteLength ?? 0);
    },

    extism_input_load_u8: (addr: bigint): number => {
      const offset = Block.maskAddress(addr);
      return this.#input?.view.getUint8(Number(offset)) as number;
    },

    extism_input_load_u64: (addr: bigint): bigint => {
      const offset = Block.maskAddress(addr);
      return this.#input?.view.getBigUint64(Number(offset), true) as bigint;
    },

    extism_output_set: (addr: bigint, length: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx]
      if (!block) {
        throw new Error('cannot assign to this block')
      }

      if (length > block.buffer.byteLength) {
        throw new Error('length longer than target block')
      }

      this.#stack[this.#stack.length - 1][1] = blockIdx;
    },

    extism_error_set: (addr: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx]
      if (!block) {
        throw new Error('cannot assign to this block')
      }

      this.#stack[this.#stack.length - 1][2] = blockIdx;
    },

    extism_config_get: (addr: bigint): bigint => {
      const key = this.readString(addr);

      if (key === null) {
        return 0n
      }

      if (key in this.#config) {
        return this.store(this.#config[key])
      }

      return 0n
    },

    extism_var_get(_i: bigint): bigint {
      return 0n
    },

    extism_var_set(_n: bigint, _i: bigint) {
    },

    extism_http_request(_requestOffset: bigint, _bodyOffset: bigint): bigint {
      return 0n
    },

    extism_http_status_code(): number {
      return 0
    },

    extism_length: (addr: bigint): bigint => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        return 0n;
      }
      return BigInt(block.buffer.byteLength)
    },

    extism_log_warn: (addr: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        return this.#logger.error(`failed to log(warn): bad block reference in addr 0x${addr.toString(16).padStart(64, '0')}`)
      }
      const text = this.#decoder.decode(block.buffer);
      this.#logger.warn(text);
    },

    extism_log_info: (addr: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        return this.#logger.error(`failed to log(info): bad block reference in addr 0x${addr.toString(16).padStart(64, '0')}`)
      }
      const text = this.#decoder.decode(block.buffer);
      this.#logger.info(text);
    },

    extism_log_debug: (addr: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        return this.#logger.error(`failed to log(debug): bad block reference in addr 0x${addr.toString(16).padStart(64, '0')}`)
      }
      const text = this.#decoder.decode(block.buffer);
      this.#logger.debug(text);
    },

    extism_log_error: (addr: bigint) => {
      const blockIdx = Block.addressToIndex(addr);
      const block = this.#blocks[blockIdx];
      if (!block) {
        return this.#logger.error(`failed to log(error): bad block reference in addr 0x${addr.toString(16).padStart(64, '0')}`)
      }
      const text = this.#decoder.decode(block.buffer);
      this.#logger.error(text);
    },
  }

  get #input(): Block | null {
    const idx = this.#stack[this.#stack.length - 1][0]
    if (idx === null) {
      return null
    }
    return this.#blocks[idx]
  }

  constructor(type: { new(size: number): ArrayBufferLike ;}, logger: Console, config: PluginConfig) {
    this.#arrayBufferType = type
    this.#logger = logger
    this.#decoder = new TextDecoder()
    this.#encoder = new TextEncoder()
    this.#stack = []

    // reserve the null page.
    this.alloc(1)

    this.#config = config
  }

  alloc(size: bigint | number): number {
    const block = new Block(new (this.#arrayBufferType)(Number(size)), true);
    const index = this.#blocks.length;
    this.#blocks.push(block);
    return index;
  }

  [GET_BLOCK](index: number): Block {
    const block = this.#blocks[index];
    if (!block) {
      throw new Error(`invalid block index: ${index}`)
    }
    return block
  }

  [IMPORT_STATE](state: CallState, copy: boolean = false) {
    // eslint-disable-next-line prefer-const
    for (let [buf, idx] of state.blocks) {
      if (buf && copy) {
        const dst = new Uint8Array(new (this.#arrayBufferType)(Number(buf.byteLength)));
        dst.set(new Uint8Array(buf))
        buf = dst.buffer
      }
      this.#blocks[idx] = buf ? new Block(buf, false) : null
    }
    this.#stack = state.stack
  }

  [EXPORT_STATE](): CallState {
    return {
      stack: this.#stack.slice(),
      blocks: this.#blocks.map((block, idx) => {
        if (!block) {
          return [null, idx]
        }

        if (block.local) {
          block.local = false
          return [block.buffer, idx]
        }
        return null
      }).filter(Boolean) as [ArrayBufferLike, number][]
    }
  }

  [STORE](input?: string | Uint8Array | number) {
    if (!input) {
      return null
    } 

    if (typeof input === 'string') {
      input = this.#encoder.encode(input);
    }

    if (input instanceof Uint8Array) {
      if (input.buffer.constructor === this.#arrayBufferType) {
        // no action necessary, wrap it up in a block
        const idx = this.#blocks.length
        this.#blocks.push(new Block(input.buffer, true))
        return idx
      }
      const idx = this.alloc(input.length);
      const block = this.#blocks[idx] as Block;
      const buf = new Uint8Array(block.buffer);
      buf.set(input, 0);
      return idx
    }

    return input
  }

  [BEGIN](input: number | null) {
    this.#stack.push([input, null, null])
  }

  [END](): [number | null, number | null] {
    const [, outputIdx, errorIdx] = this.#stack.pop() as (number | null)[];
    const outputPosition = errorIdx === null ? 1 : 0
    const idx = errorIdx ?? outputIdx
    const result: [number | null, number | null] = [null, null]

    if (idx === null) {
      return result
    }

    const block = this.#blocks[idx]

    if (block === null) {
      // TODO: this might be an error? we got an output idx but it referred to a freed (or non-existant) block
      return result
    }

    result[outputPosition] = idx

    return result
  }
}
