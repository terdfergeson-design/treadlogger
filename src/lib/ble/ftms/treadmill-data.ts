import { ByteCursor } from "../byte-cursor";
import {
  DEFAULT_MACHINE_SPEED_UNIT,
  fromMachineSpeed,
  type MachineSpeedUnit,
} from "./speed-units";

/**
 * Treadmill Data characteristic (0x2ACD) of the Fitness Machine Service.
 *
 * The payload is a 16-bit flags field followed by only the fields the flags
 * advertise, in a fixed order. Treadmills differ in which fields they send, and
 * some change the set mid-session, so the layout has to be walked every packet
 * rather than cached.
 */

export const TreadmillDataFlag = {
  /**
   * Inverted, unlike every other flag in the characteristic: Instantaneous
   * Speed is present when this bit is CLEAR. The bit means "more data follows in
   * a later packet", which implies the first field was omitted.
   */
  moreData: 1 << 0,
  averageSpeed: 1 << 1,
  totalDistance: 1 << 2,
  inclinationAndRampAngle: 1 << 3,
  elevationGain: 1 << 4,
  instantaneousPace: 1 << 5,
  averagePace: 1 << 6,
  expendedEnergy: 1 << 7,
  heartRate: 1 << 8,
  metabolicEquivalent: 1 << 9,
  elapsedTime: 1 << 10,
  remainingTime: 1 << 11,
  forceOnBeltAndPowerOutput: 1 << 12,
  /**
   * Not part of the FTMS spec — bits 13-15 of this field are reserved there.
   * A THERUN T15 was observed setting this bit on an extra, otherwise-empty
   * Treadmill Data notification it sends right after every standard one,
   * with a two-byte cumulative step count following the flags. Treat it as
   * a vendor extension rather than a documented field: other machines are
   * very unlikely to use bit 13 the same way, if they set it at all.
   */
  stepCount: 1 << 13,
} as const;

/** FTMS signals "this reading is unavailable" with an all-ones field. */
const UINT16_NOT_AVAILABLE = 0xffff;
const UINT8_NOT_AVAILABLE = 0xff;

export interface TreadmillData {
  /** Raw flags, retained so callers can tell "absent" from "zero". */
  flags: number;
  speedKph?: number;
  averageSpeedKph?: number;
  totalDistanceM?: number;
  /** Belt grade as a percentage. Negative values are declines. */
  inclinationPercent?: number;
  rampAngleDegrees?: number;
  positiveElevationGainM?: number;
  negativeElevationGainM?: number;
  /**
   * The FTMS spec labels the pace fields "kilometre per minute", but a uint8 at
   * 0.1 resolution only spans a usable range when read as minutes per
   * kilometre, which is what treadmills emit in practice. Prefer
   * {@link paceFromSpeed} for display: it is derived from the much
   * higher-resolution speed field and is present on every packet.
   */
  instantaneousPaceMinPerKm?: number;
  averagePaceMinPerKm?: number;
  /** Raw pace bytes, in case a peripheral really does use the spec's unit. */
  instantaneousPaceRaw?: number;
  averagePaceRaw?: number;
  totalEnergyKcal?: number;
  energyPerHourKcal?: number;
  energyPerMinuteKcal?: number;
  /** Heart rate reported by the treadmill itself, not the chest strap. */
  heartRateBpm?: number;
  metabolicEquivalent?: number;
  elapsedTimeS?: number;
  remainingTimeS?: number;
  forceOnBeltNewtons?: number;
  powerOutputWatts?: number;
  /**
   * Cumulative step count. Vendor-specific, not an FTMS field — see
   * {@link TreadmillDataFlag.stepCount}. Only present on machines that set
   * that bit; most treadmills never will.
   */
  stepCount?: number;
}

/**
 * Parses one Treadmill Data notification.
 *
 * Fields the peripheral omitted, and fields it explicitly marked unavailable,
 * both come back `undefined`.
 *
 * `unit` names the unit the machine puts in the speed fields; the speeds handed
 * back are km/h either way. The pace fields are left as the machine sent them,
 * since the dashboard derives pace from speed.
 */
export function parseTreadmillData(
  source: DataView | ArrayBuffer | Uint8Array,
  unit: MachineSpeedUnit = DEFAULT_MACHINE_SPEED_UNIT,
): TreadmillData {
  const cursor = new ByteCursor(source);

  if (!cursor.has(2)) {
    throw new Error("Treadmill Data payload is too short to contain the flags field");
  }

  const flags = cursor.uint16();
  const data: TreadmillData = { flags };
  const present = (flag: number) => (flags & flag) !== 0;

  if (!present(TreadmillDataFlag.moreData) && cursor.has(2)) {
    data.speedKph = fromMachineSpeed(cursor.uint16() / 100, unit);
  }

  if (present(TreadmillDataFlag.averageSpeed) && cursor.has(2)) {
    data.averageSpeedKph = fromMachineSpeed(cursor.uint16() / 100, unit);
  }

  if (present(TreadmillDataFlag.totalDistance) && cursor.has(3)) {
    data.totalDistanceM = cursor.uint24();
  }

  if (present(TreadmillDataFlag.inclinationAndRampAngle) && cursor.has(4)) {
    data.inclinationPercent = cursor.int16() / 10;
    data.rampAngleDegrees = cursor.int16() / 10;
  }

  if (present(TreadmillDataFlag.elevationGain) && cursor.has(4)) {
    data.positiveElevationGainM = cursor.uint16() / 10;
    data.negativeElevationGainM = cursor.uint16() / 10;
  }

  if (present(TreadmillDataFlag.instantaneousPace) && cursor.has(1)) {
    const raw = cursor.uint8();
    data.instantaneousPaceRaw = raw;
    if (raw !== UINT8_NOT_AVAILABLE) {
      data.instantaneousPaceMinPerKm = raw / 10;
    }
  }

  if (present(TreadmillDataFlag.averagePace) && cursor.has(1)) {
    const raw = cursor.uint8();
    data.averagePaceRaw = raw;
    if (raw !== UINT8_NOT_AVAILABLE) {
      data.averagePaceMinPerKm = raw / 10;
    }
  }

  if (present(TreadmillDataFlag.expendedEnergy) && cursor.has(5)) {
    const totalEnergy = cursor.uint16();
    const energyPerHour = cursor.uint16();
    const energyPerMinute = cursor.uint8();

    if (totalEnergy !== UINT16_NOT_AVAILABLE) data.totalEnergyKcal = totalEnergy;
    if (energyPerHour !== UINT16_NOT_AVAILABLE) data.energyPerHourKcal = energyPerHour;
    if (energyPerMinute !== UINT8_NOT_AVAILABLE) data.energyPerMinuteKcal = energyPerMinute;
  }

  if (present(TreadmillDataFlag.heartRate) && cursor.has(1)) {
    const heartRate = cursor.uint8();
    if (heartRate !== 0) data.heartRateBpm = heartRate;
  }

  if (present(TreadmillDataFlag.metabolicEquivalent) && cursor.has(1)) {
    data.metabolicEquivalent = cursor.uint8() / 10;
  }

  if (present(TreadmillDataFlag.elapsedTime) && cursor.has(2)) {
    data.elapsedTimeS = cursor.uint16();
  }

  if (present(TreadmillDataFlag.remainingTime) && cursor.has(2)) {
    data.remainingTimeS = cursor.uint16();
  }

  if (present(TreadmillDataFlag.forceOnBeltAndPowerOutput) && cursor.has(4)) {
    data.forceOnBeltNewtons = cursor.int16();
    data.powerOutputWatts = cursor.int16();
  }

  if (present(TreadmillDataFlag.stepCount) && cursor.has(2)) {
    data.stepCount = cursor.uint16();
  }

  return data;
}

/**
 * Converts km/h to minutes per kilometre. Returns undefined when the belt is
 * stopped, where pace is mathematically unbounded.
 */
export function paceFromSpeed(speedKph: number | undefined): number | undefined {
  if (speedKph === undefined || speedKph <= 0) return undefined;
  return 60 / speedKph;
}
