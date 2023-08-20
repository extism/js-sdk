export default class Allocator {
  extism: WebAssembly.Instance;

  constructor(extism: WebAssembly.Instance) {
    this.extism = extism;
  }

  reset() {
    return (this.extism.exports.extism_reset as Function).call(null);
  }

  alloc(length: bigint): bigint {
    return (this.extism.exports.extism_alloc as Function).call(length);
  }

  getMemory(): WebAssembly.Memory {
    return (this.extism.exports.memory as WebAssembly.Memory);
  }

  getMemoryBuffer(): Uint8Array {
    return new Uint8Array(this.getMemory().buffer);
  }

  getBytes(offset: bigint): Uint8Array {
    const length = this.getLength(offset)

    return new Uint8Array(this.getMemory().buffer, Number(offset), Number(length));
  }

  getString(offset: bigint): string | null {
    const bytes = this.getBytes(offset);
    if (bytes === null) {
      return null;
    }

    return new TextDecoder().decode(bytes);
  }

  allocBytes(data: Uint8Array): bigint {
    const offs = this.alloc(BigInt(data.length));
    const bytes = this.getBytes(offs);
    if (bytes === null) {
      this.free(offs);
      return BigInt(0);
    }

    bytes.set(data);
    return offs;
  }

  allocString(data: string): bigint {
    const bytes = new TextEncoder().encode(data);
    return this.allocBytes(bytes);
  }

  getLength(offset: bigint): bigint {
    return (this.extism.exports.extism_length as Function).call(offset);
  }

  free(offset: bigint) {
    (this.extism.exports.extism_free as Function).call(offset);
  }
}
