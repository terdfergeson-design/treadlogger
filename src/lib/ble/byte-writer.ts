/**
 * Growable little-endian byte writer.
 *
 * Used to build control-point payloads and, in the simulator, to synthesise the
 * exact notification bytes a treadmill or chest strap would send. Emitting real
 * payloads means mock mode exercises the production parsers rather than
 * bypassing them.
 */
export class ByteWriter {
  private readonly bytes: number[] = [];

  uint8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  int8(value: number): this {
    return this.uint8(value < 0 ? value + 0x100 : value);
  }

  uint16(value: number): this {
    const clamped = value & 0xffff;
    this.bytes.push(clamped & 0xff, (clamped >> 8) & 0xff);
    return this;
  }

  int16(value: number): this {
    return this.uint16(value < 0 ? value + 0x10000 : value);
  }

  uint24(value: number): this {
    const clamped = value & 0xffffff;
    this.bytes.push(clamped & 0xff, (clamped >> 8) & 0xff, (clamped >> 16) & 0xff);
    return this;
  }

  uint32(value: number): this {
    const clamped = value >>> 0;
    this.bytes.push(
      clamped & 0xff,
      (clamped >>> 8) & 0xff,
      (clamped >>> 16) & 0xff,
      (clamped >>> 24) & 0xff,
    );
    return this;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  toDataView(): DataView {
    const array = this.toUint8Array();
    return new DataView(array.buffer, array.byteOffset, array.byteLength);
  }

  get length(): number {
    return this.bytes.length;
  }
}
