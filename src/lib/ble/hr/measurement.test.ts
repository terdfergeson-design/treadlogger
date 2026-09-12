import { describe, expect, it } from "vitest";
import { bytesToDataView } from "../byte-cursor";
import { parseBodySensorLocation, parseHeartRateMeasurement } from "./measurement";

describe("parseHeartRateMeasurement", () => {
  it("reads the common 8-bit form", () => {
    const measurement = parseHeartRateMeasurement(bytesToDataView([0x00, 0x48]));

    expect(measurement.heartRateBpm).toBe(72);
    expect(measurement.sensorContact).toBe("unsupported");
    expect(measurement.energyExpendedKj).toBeUndefined();
    expect(measurement.rrIntervalsS).toBeUndefined();
  });

  it("reads the 16-bit form when flag bit 0 is set", () => {
    // Flag 0x01 widens the value field; 300 is 0x012C little-endian.
    const measurement = parseHeartRateMeasurement(bytesToDataView([0x01, 0x2c, 0x01]));

    expect(measurement.heartRateBpm).toBe(300);
  });

  it("does not misread a 16-bit value as 8-bit", () => {
    // The same bytes with the width flag cleared mean 44 bpm followed by a
    // trailing byte, which is what a naive parser gets wrong.
    expect(parseHeartRateMeasurement(bytesToDataView([0x00, 0x2c, 0x01])).heartRateBpm).toBe(44);
    expect(parseHeartRateMeasurement(bytesToDataView([0x01, 0x2c, 0x01])).heartRateBpm).toBe(300);
  });

  it("distinguishes contact not detected from contact not supported", () => {
    // Bit 2 says the strap can detect contact; bit 1 says it currently does.
    expect(parseHeartRateMeasurement(bytesToDataView([0x06, 0x64])).sensorContact).toBe(
      "detected",
    );
    expect(parseHeartRateMeasurement(bytesToDataView([0x04, 0x64])).sensorContact).toBe(
      "not-detected",
    );
    expect(parseHeartRateMeasurement(bytesToDataView([0x02, 0x64])).sensorContact).toBe(
      "unsupported",
    );
  });

  it("reads energy expended and RR intervals after a 16-bit value", () => {
    const measurement = parseHeartRateMeasurement(
      bytesToDataView([
        0x19, // flags: 16-bit value, energy expended, RR intervals
        0xc8, 0x00, // 200 bpm
        0xdc, 0x05, // 1500 kJ
        0x00, 0x04, // 1024 / 1024 s
        0x00, 0x02, // 512 / 1024 s
      ]),
    );

    expect(measurement.heartRateBpm).toBe(200);
    expect(measurement.energyExpendedKj).toBe(1500);
    expect(measurement.rrIntervalsS).toEqual([1, 0.5]);
  });

  it("reads every RR interval in a packet that carries several", () => {
    const measurement = parseHeartRateMeasurement(
      bytesToDataView([0x10, 0x3c, 0x00, 0x04, 0x10, 0x04, 0xf0, 0x03]),
    );

    expect(measurement.heartRateBpm).toBe(60);
    expect(measurement.rrIntervalsS).toHaveLength(3);
    expect(measurement.rrIntervalsS?.[0]).toBeCloseTo(1, 6);
    expect(measurement.rrIntervalsS?.[1]).toBeCloseTo(1040 / 1024, 6);
    expect(measurement.rrIntervalsS?.[2]).toBeCloseTo(1008 / 1024, 6);
  });

  it("rejects a payload with no room for a value", () => {
    expect(() => parseHeartRateMeasurement(bytesToDataView([0x00]))).toThrow(/flags and a value/i);
  });

  it("rejects a 16-bit claim that the payload cannot satisfy", () => {
    expect(() => parseHeartRateMeasurement(bytesToDataView([0x01, 0xc8]))).toThrow(/truncated/i);
  });
});

describe("parseBodySensorLocation", () => {
  it("names known locations", () => {
    expect(parseBodySensorLocation(bytesToDataView([0x01]))).toBe("Chest");
    expect(parseBodySensorLocation(bytesToDataView([0x02]))).toBe("Wrist");
  });

  it("falls back for unknown or empty values", () => {
    expect(parseBodySensorLocation(bytesToDataView([0x63]))).toBe("Unknown");
    expect(parseBodySensorLocation(bytesToDataView([]))).toBe("Unknown");
  });
});
