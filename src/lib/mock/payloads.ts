import { ByteWriter } from "../ble/byte-writer";
import { TreadmillDataFlag } from "../ble/ftms/treadmill-data";
import { HeartRateFlag } from "../ble/hr/measurement";

/**
 * Builders for the byte payloads a real peripheral would notify.
 *
 * The simulator uses these so mock mode runs through the production parsers
 * instead of shortcutting straight to parsed objects — if the flag handling or a
 * resolution is wrong, the demo shows it.
 */

export interface TreadmillDataFields {
  speedKph?: number;
  averageSpeedKph?: number;
  totalDistanceM?: number;
  /** Inclination and ramp angle share one flag and must be supplied together. */
  inclinationPercent?: number;
  rampAngleDegrees?: number;
  positiveElevationGainM?: number;
  negativeElevationGainM?: number;
  instantaneousPaceMinPerKm?: number;
  averagePaceMinPerKm?: number;
  totalEnergyKcal?: number;
  energyPerHourKcal?: number;
  energyPerMinuteKcal?: number;
  heartRateBpm?: number;
  metabolicEquivalent?: number;
  elapsedTimeS?: number;
  remainingTimeS?: number;
  forceOnBeltNewtons?: number;
  powerOutputWatts?: number;
}

const UINT16_NOT_AVAILABLE = 0xffff;
const UINT8_NOT_AVAILABLE = 0xff;

/** Encodes a Treadmill Data (0x2ACD) notification from the fields provided. */
export function buildTreadmillDataPayload(fields: TreadmillDataFields): Uint8Array {
  let flags = 0;
  const body = new ByteWriter();

  // Bit 0 is "more data", whose meaning is inverted: leaving it clear is what
  // declares the instantaneous speed field present.
  if (fields.speedKph === undefined) {
    flags |= TreadmillDataFlag.moreData;
  } else {
    body.uint16(Math.round(fields.speedKph * 100));
  }

  if (fields.averageSpeedKph !== undefined) {
    flags |= TreadmillDataFlag.averageSpeed;
    body.uint16(Math.round(fields.averageSpeedKph * 100));
  }

  if (fields.totalDistanceM !== undefined) {
    flags |= TreadmillDataFlag.totalDistance;
    body.uint24(Math.round(fields.totalDistanceM));
  }

  if (fields.inclinationPercent !== undefined || fields.rampAngleDegrees !== undefined) {
    flags |= TreadmillDataFlag.inclinationAndRampAngle;
    body.int16(Math.round((fields.inclinationPercent ?? 0) * 10));
    body.int16(Math.round((fields.rampAngleDegrees ?? 0) * 10));
  }

  if (
    fields.positiveElevationGainM !== undefined ||
    fields.negativeElevationGainM !== undefined
  ) {
    flags |= TreadmillDataFlag.elevationGain;
    body.uint16(Math.round((fields.positiveElevationGainM ?? 0) * 10));
    body.uint16(Math.round((fields.negativeElevationGainM ?? 0) * 10));
  }

  if (fields.instantaneousPaceMinPerKm !== undefined) {
    flags |= TreadmillDataFlag.instantaneousPace;
    body.uint8(clampUint8(Math.round(fields.instantaneousPaceMinPerKm * 10)));
  }

  if (fields.averagePaceMinPerKm !== undefined) {
    flags |= TreadmillDataFlag.averagePace;
    body.uint8(clampUint8(Math.round(fields.averagePaceMinPerKm * 10)));
  }

  if (
    fields.totalEnergyKcal !== undefined ||
    fields.energyPerHourKcal !== undefined ||
    fields.energyPerMinuteKcal !== undefined
  ) {
    flags |= TreadmillDataFlag.expendedEnergy;
    body.uint16(fields.totalEnergyKcal !== undefined ? Math.round(fields.totalEnergyKcal) : UINT16_NOT_AVAILABLE);
    body.uint16(
      fields.energyPerHourKcal !== undefined ? Math.round(fields.energyPerHourKcal) : UINT16_NOT_AVAILABLE,
    );
    body.uint8(
      fields.energyPerMinuteKcal !== undefined
        ? clampUint8(Math.round(fields.energyPerMinuteKcal))
        : UINT8_NOT_AVAILABLE,
    );
  }

  if (fields.heartRateBpm !== undefined) {
    flags |= TreadmillDataFlag.heartRate;
    body.uint8(clampUint8(Math.round(fields.heartRateBpm)));
  }

  if (fields.metabolicEquivalent !== undefined) {
    flags |= TreadmillDataFlag.metabolicEquivalent;
    body.uint8(clampUint8(Math.round(fields.metabolicEquivalent * 10)));
  }

  if (fields.elapsedTimeS !== undefined) {
    flags |= TreadmillDataFlag.elapsedTime;
    body.uint16(Math.round(fields.elapsedTimeS));
  }

  if (fields.remainingTimeS !== undefined) {
    flags |= TreadmillDataFlag.remainingTime;
    body.uint16(Math.round(fields.remainingTimeS));
  }

  if (fields.forceOnBeltNewtons !== undefined || fields.powerOutputWatts !== undefined) {
    flags |= TreadmillDataFlag.forceOnBeltAndPowerOutput;
    body.int16(Math.round(fields.forceOnBeltNewtons ?? 0));
    body.int16(Math.round(fields.powerOutputWatts ?? 0));
  }

  // The flags word is only complete once every field has been considered, so the
  // header is prepended rather than written first.
  return concat(new ByteWriter().uint16(flags).toUint8Array(), body.toUint8Array());
}

export interface HeartRateFields {
  heartRateBpm: number;
  /** Forces the 16-bit encoding even for values that fit in a byte. */
  useSixteenBit?: boolean;
  sensorContactSupported?: boolean;
  sensorContactDetected?: boolean;
  energyExpendedKj?: number;
  rrIntervalsS?: number[];
}

/** Encodes a Heart Rate Measurement (0x2A37) notification. */
export function buildHeartRateMeasurementPayload(fields: HeartRateFields): Uint8Array {
  const sixteenBit = fields.useSixteenBit ?? fields.heartRateBpm > 0xff;

  let flags = 0;
  if (sixteenBit) flags |= HeartRateFlag.sixteenBitValue;
  if (fields.sensorContactSupported) flags |= HeartRateFlag.sensorContactSupported;
  if (fields.sensorContactDetected) flags |= HeartRateFlag.sensorContactDetected;
  if (fields.energyExpendedKj !== undefined) flags |= HeartRateFlag.energyExpendedPresent;
  if (fields.rrIntervalsS?.length) flags |= HeartRateFlag.rrIntervalPresent;

  const writer = new ByteWriter().uint8(flags);

  if (sixteenBit) {
    writer.uint16(Math.round(fields.heartRateBpm));
  } else {
    writer.uint8(clampUint8(Math.round(fields.heartRateBpm)));
  }

  if (fields.energyExpendedKj !== undefined) {
    writer.uint16(Math.round(fields.energyExpendedKj));
  }

  for (const interval of fields.rrIntervalsS ?? []) {
    writer.uint16(Math.round(interval * 1024));
  }

  return writer.toUint8Array();
}

/** Encodes a Supported Speed Range (0x2AD4) read. */
export function buildSpeedRangePayload(
  minKph: number,
  maxKph: number,
  incrementKph: number,
): Uint8Array {
  return new ByteWriter()
    .uint16(Math.round(minKph * 100))
    .uint16(Math.round(maxKph * 100))
    .uint16(Math.round(incrementKph * 100))
    .toUint8Array();
}

/** Encodes a Supported Inclination Range (0x2AD5) read. */
export function buildInclinationRangePayload(
  minPercent: number,
  maxPercent: number,
  incrementPercent: number,
): Uint8Array {
  return new ByteWriter()
    .int16(Math.round(minPercent * 10))
    .int16(Math.round(maxPercent * 10))
    .uint16(Math.round(incrementPercent * 10))
    .toUint8Array();
}

/** Encodes a Fitness Machine Feature (0x2ACC) read. */
export function buildFeaturePayload(machineFlags: number, targetFlags: number): Uint8Array {
  return new ByteWriter().uint32(machineFlags).uint32(targetFlags).toUint8Array();
}

/** Encodes a Fitness Machine Status (0x2ADA) notification. */
export function buildStatusPayload(opCode: number, parameter: number[] = []): Uint8Array {
  const writer = new ByteWriter().uint8(opCode);
  for (const byte of parameter) writer.uint8(byte);
  return writer.toUint8Array();
}

/** Encodes a control-point response indication. */
export function buildControlPointResponsePayload(
  requestOpCode: number,
  resultCode: number,
  parameter: number[] = [],
): Uint8Array {
  const writer = new ByteWriter().uint8(0x80).uint8(requestOpCode).uint8(resultCode);
  for (const byte of parameter) writer.uint8(byte);
  return writer.toUint8Array();
}

function clampUint8(value: number): number {
  return Math.min(0xff, Math.max(0, value));
}

function concat(head: Uint8Array, tail: Uint8Array): Uint8Array {
  const out = new Uint8Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return out;
}
