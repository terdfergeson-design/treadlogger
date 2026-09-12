import { ByteCursor } from "../byte-cursor";

/**
 * Supported Speed Range (0x2AD4) and Supported Inclination Range (0x2AD5).
 *
 * These bound what the control point will accept. Reading them lets the UI clamp
 * and step correctly instead of guessing and collecting "invalid parameter"
 * rejections.
 */

export interface SpeedRange {
  minKph: number;
  maxKph: number;
  /** Smallest change the machine honours. Used as the UI slider step. */
  incrementKph: number;
}

export interface InclinationRange {
  minPercent: number;
  maxPercent: number;
  incrementPercent: number;
}

/** All three fields are uint16 at 0.01 km/h. */
export function parseSupportedSpeedRange(
  source: DataView | ArrayBuffer | Uint8Array,
): SpeedRange {
  const cursor = new ByteCursor(source);

  if (!cursor.has(6)) {
    throw new Error("Supported Speed Range must be 6 bytes");
  }

  return {
    minKph: cursor.uint16() / 100,
    maxKph: cursor.uint16() / 100,
    incrementKph: cursor.uint16() / 100,
  };
}

/** Min and max are sint16 at 0.1 %; the increment is uint16 at 0.1 %. */
export function parseSupportedInclinationRange(
  source: DataView | ArrayBuffer | Uint8Array,
): InclinationRange {
  const cursor = new ByteCursor(source);

  if (!cursor.has(6)) {
    throw new Error("Supported Inclination Range must be 6 bytes");
  }

  return {
    minPercent: cursor.int16() / 10,
    maxPercent: cursor.int16() / 10,
    incrementPercent: cursor.uint16() / 10,
  };
}
