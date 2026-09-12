import { describe, expect, it } from "vitest";
import { bytesToDataView } from "../byte-cursor";
import { paceFromSpeed, parseTreadmillData } from "./treadmill-data";

/**
 * Payloads here are written out byte by byte from the FTMS specification rather
 * than produced by this project's own encoder, so the test checks the parser
 * against the spec instead of against a mirror of itself.
 */

describe("parseTreadmillData", () => {
  it("reads instantaneous speed when the More Data bit is clear", () => {
    // flags 0x0000, speed 1050 (0x041A) at 0.01 km/h.
    const data = parseTreadmillData(bytesToDataView([0x00, 0x00, 0x1a, 0x04]));

    expect(data.speedKph).toBe(10.5);
  });

  it("reads speeds in the machine's unit when that unit is mph", () => {
    // Same bytes as above: 1050 is 10.50 mph on this machine, so 16.9 km/h.
    const data = parseTreadmillData(bytesToDataView([0x00, 0x00, 0x1a, 0x04]), "mph");

    expect(data.speedKph).toBeCloseTo(16.898, 3);
  });

  it("converts average speed as well as instantaneous speed", () => {
    // flags 0x0002: instantaneous speed present (bit 0 clear) plus average.
    const data = parseTreadmillData(
      bytesToDataView([0x02, 0x00, 0x5e, 0x01, 0x2c, 0x01]),
      "mph",
    );

    expect(data.speedKph).toBeCloseTo(5.633, 3);
    expect(data.averageSpeedKph).toBeCloseTo(4.828, 3);
  });

  it("omits instantaneous speed when the More Data bit is set", () => {
    // Bit 0 is inverted: set means the speed field was not transmitted.
    const data = parseTreadmillData(bytesToDataView([0x01, 0x00]));

    expect(data.speedKph).toBeUndefined();
  });

  it("walks the full field layout a treadmill typically sends", () => {
    // Flags 0x04BE selects average speed, total distance, inclination and ramp
    // angle, elevation gain, instantaneous pace, expended energy and elapsed
    // time, with bit 0 clear so instantaneous speed leads the payload.
    const data = parseTreadmillData(
      bytesToDataView([
        0xbe, 0x04, // flags
        0xd2, 0x04, // instantaneous speed 1234 -> 12.34 km/h
        0x4c, 0x04, // average speed 1100 -> 11.00 km/h
        0x39, 0x30, 0x00, // total distance 12345 m (uint24)
        0x23, 0x00, // inclination 35 -> 3.5 %
        0x14, 0x00, // ramp angle 20 -> 2.0 degrees
        0xf5, 0x00, // positive elevation gain 245 -> 24.5 m
        0x00, 0x00, // negative elevation gain 0
        0x31, // instantaneous pace 49 -> 4.9 min/km
        0xfa, 0x00, // total energy 250 kcal
        0xbc, 0x02, // energy per hour 700 kcal
        0x0c, // energy per minute 12 kcal
        0x26, 0x07, // elapsed time 1830 s
      ]),
    );

    expect(data).toMatchObject({
      speedKph: 12.34,
      averageSpeedKph: 11,
      totalDistanceM: 12345,
      inclinationPercent: 3.5,
      rampAngleDegrees: 2,
      positiveElevationGainM: 24.5,
      negativeElevationGainM: 0,
      instantaneousPaceMinPerKm: 4.9,
      instantaneousPaceRaw: 49,
      totalEnergyKcal: 250,
      energyPerHourKcal: 700,
      energyPerMinuteKcal: 12,
      elapsedTimeS: 1830,
    });
  });

  it("reads declines as negative inclination", () => {
    // flags 0x0009: More Data set (no speed) plus inclination and ramp angle.
    const data = parseTreadmillData(
      bytesToDataView([0x09, 0x00, 0xe7, 0xff, 0xf2, 0xff]),
    );

    expect(data.inclinationPercent).toBeCloseTo(-2.5, 6);
    expect(data.rampAngleDegrees).toBeCloseTo(-1.4, 6);
  });

  it("treats all-ones energy fields as unavailable rather than as huge values", () => {
    const data = parseTreadmillData(
      bytesToDataView([0x81, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff]),
    );

    expect(data.totalEnergyKcal).toBeUndefined();
    expect(data.energyPerHourKcal).toBeUndefined();
    expect(data.energyPerMinuteKcal).toBeUndefined();
  });

  it("reads the treadmill's own heart rate but ignores a zero reading", () => {
    // flags 0x0101: More Data set, heart rate present.
    expect(parseTreadmillData(bytesToDataView([0x01, 0x01, 0x8d])).heartRateBpm).toBe(141);
    expect(parseTreadmillData(bytesToDataView([0x01, 0x01, 0x00])).heartRateBpm).toBeUndefined();
  });

  it("reads signed force and power at the end of the payload", () => {
    // flags 0x1001: More Data set, force on belt and power output present.
    const data = parseTreadmillData(
      bytesToDataView([0x01, 0x10, 0x9c, 0xff, 0x2c, 0x01]),
    );

    expect(data.forceOnBeltNewtons).toBe(-100);
    expect(data.powerOutputWatts).toBe(300);
  });

  it("stops cleanly when a peripheral truncates a field the flags promised", () => {
    // Flags claim total distance, but only two of its three bytes arrived.
    const data = parseTreadmillData(bytesToDataView([0x04, 0x00, 0x1a, 0x04, 0x39, 0x30]));

    expect(data.speedKph).toBe(10.5);
    expect(data.totalDistanceM).toBeUndefined();
  });

  it("rejects a payload too short to hold the flags field", () => {
    expect(() => parseTreadmillData(bytesToDataView([0x00]))).toThrow(/too short/i);
  });

  it("accepts a Uint8Array as well as a DataView", () => {
    const data = parseTreadmillData(Uint8Array.from([0x00, 0x00, 0x1a, 0x04]));

    expect(data.speedKph).toBe(10.5);
  });
});

describe("paceFromSpeed", () => {
  it("converts km/h into minutes per kilometre", () => {
    expect(paceFromSpeed(12)).toBe(5);
    expect(paceFromSpeed(10)).toBe(6);
  });

  it("has no pace for a stopped belt", () => {
    expect(paceFromSpeed(0)).toBeUndefined();
    expect(paceFromSpeed(undefined)).toBeUndefined();
  });
});
