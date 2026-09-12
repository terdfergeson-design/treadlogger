/**
 * Sequential little-endian reader for GATT characteristic payloads.
 *
 * Every multi-byte field in the FTMS and Heart Rate specifications is
 * little-endian, so endianness is baked in rather than passed per call.
 */
export class ByteCursor {
  private readonly view: DataView;
  private cursor = 0;

  constructor(source: DataView | ArrayBuffer | Uint8Array) {
    if (source instanceof DataView) {
      this.view = source;
    } else if (source instanceof Uint8Array) {
      this.view = new DataView(source.buffer, source.byteOffset, source.byteLength);
    } else {
      this.view = new DataView(source);
    }
  }

  get offset(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.view.byteLength - this.cursor;
  }

  /**
   * True when at least `byteCount` bytes are still unread. Peripherals are
   * allowed to truncate optional trailing fields, and some do, so every read is
   * guarded rather than assumed.
   */
  has(byteCount: number): boolean {
    return this.remaining >= byteCount;
  }

  uint8(): number {
    const value = this.view.getUint8(this.cursor);
    this.cursor += 1;
    return value;
  }

  int8(): number {
    const value = this.view.getInt8(this.cursor);
    this.cursor += 1;
    return value;
  }

  uint16(): number {
    const value = this.view.getUint16(this.cursor, true);
    this.cursor += 2;
    return value;
  }

  int16(): number {
    const value = this.view.getInt16(this.cursor, true);
    this.cursor += 2;
    return value;
  }

  /** FTMS uses 24-bit unsigned fields for distance, which DataView lacks. */
  uint24(): number {
    const low = this.view.getUint8(this.cursor);
    const mid = this.view.getUint8(this.cursor + 1);
    const high = this.view.getUint8(this.cursor + 2);
    this.cursor += 3;
    return low | (mid << 8) | (high << 16);
  }

  uint32(): number {
    const value = this.view.getUint32(this.cursor, true);
    this.cursor += 4;
    return value;
  }
}

/** Builds a DataView from a byte list. Convenience for tests and mocks. */
export function bytesToDataView(bytes: number[] | Uint8Array): DataView {
  const array = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return new DataView(array.buffer, array.byteOffset, array.byteLength);
}
