import { ByteCursor } from "../byte-cursor";

/**
 * Heart Rate Measurement characteristic (0x2A37).
 *
 * An 8-bit flags byte, then the heart rate as either one or two bytes depending
 * on flag bit 0, then optional energy-expended and RR-interval fields. Chest
 * straps normally send the 8-bit form but switch to 16-bit rather than clip, so
 * both widths have to be handled on the same connection.
 */

export const HeartRateFlag = {
  /** Set means the heart rate value is uint16; clear means uint8. */
  sixteenBitValue: 1 << 0,
  sensorContactDetected: 1 << 1,
  sensorContactSupported: 1 << 2,
  energyExpendedPresent: 1 << 3,
  rrIntervalPresent: 1 << 4,
} as const;

/**
 * Whether the strap is making skin contact.
 *
 * A strap that cannot detect contact reports "unsupported", which is different
 * from a strap that checked and found none — the UI should only nag about
 * electrode contact in the latter case.
 */
export type SensorContactStatus = "unsupported" | "detected" | "not-detected";

export interface HeartRateMeasurement {
  flags: number;
  heartRateBpm: number;
  sensorContact: SensorContactStatus;
  /** Cumulative energy expended in kilojoules, if the strap tracks it. */
  energyExpendedKj?: number;
  /** Beat-to-beat intervals in seconds, oldest first. */
  rrIntervalsS?: number[];
}

/** RR intervals are transmitted in units of 1/1024 second. */
const RR_INTERVAL_UNITS_PER_SECOND = 1024;

export function parseHeartRateMeasurement(
  source: DataView | ArrayBuffer | Uint8Array,
): HeartRateMeasurement {
  const cursor = new ByteCursor(source);

  if (!cursor.has(2)) {
    throw new Error("Heart Rate Measurement payload must contain flags and a value");
  }

  const flags = cursor.uint8();
  const present = (flag: number) => (flags & flag) !== 0;

  const isSixteenBit = present(HeartRateFlag.sixteenBitValue);
  if (isSixteenBit && !cursor.has(2)) {
    throw new Error("Heart Rate Measurement claims a 16-bit value but is truncated");
  }

  const heartRateBpm = isSixteenBit ? cursor.uint16() : cursor.uint8();

  let sensorContact: SensorContactStatus = "unsupported";
  if (present(HeartRateFlag.sensorContactSupported)) {
    sensorContact = present(HeartRateFlag.sensorContactDetected) ? "detected" : "not-detected";
  }

  const measurement: HeartRateMeasurement = { flags, heartRateBpm, sensorContact };

  if (present(HeartRateFlag.energyExpendedPresent) && cursor.has(2)) {
    measurement.energyExpendedKj = cursor.uint16();
  }

  if (present(HeartRateFlag.rrIntervalPresent)) {
    // A single notification can carry several intervals; the count is implied by
    // the remaining payload length rather than stated.
    const rrIntervalsS: number[] = [];
    while (cursor.has(2)) {
      rrIntervalsS.push(cursor.uint16() / RR_INTERVAL_UNITS_PER_SECOND);
    }
    if (rrIntervalsS.length > 0) {
      measurement.rrIntervalsS = rrIntervalsS;
    }
  }

  return measurement;
}

const BODY_SENSOR_LOCATIONS = [
  "Other",
  "Chest",
  "Wrist",
  "Finger",
  "Hand",
  "Ear lobe",
  "Foot",
] as const;

/** Body Sensor Location (0x2A38). */
export function parseBodySensorLocation(
  source: DataView | ArrayBuffer | Uint8Array,
): string {
  const cursor = new ByteCursor(source);
  if (!cursor.has(1)) return "Unknown";
  const location = cursor.uint8();
  return BODY_SENSOR_LOCATIONS[location] ?? "Unknown";
}
