import { describe, expect, it } from "vitest";
import { bytesToDataView } from "../byte-cursor";
import { parseFitnessMachineFeature } from "./features";
import { parseSupportedInclinationRange, parseSupportedSpeedRange } from "./ranges";
import { parseFitnessMachineStatus, StatusOpCode } from "./status";

describe("parseSupportedSpeedRange", () => {
  it("reads min, max and increment at 0.01 km/h", () => {
    const range = parseSupportedSpeedRange(
      bytesToDataView([0x32, 0x00, 0xd0, 0x07, 0x0a, 0x00]),
    );

    expect(range).toEqual({ minKph: 0.5, maxKph: 20, incrementKph: 0.1 });
  });

  it("converts the bounds when the machine's unit is mph", () => {
    // Same bytes read as 0.5 / 20 / 0.1 mph, so the control gets km/h bounds.
    const range = parseSupportedSpeedRange(
      bytesToDataView([0x32, 0x00, 0xd0, 0x07, 0x0a, 0x00]),
      "mph",
    );

    expect(range.minKph).toBeCloseTo(0.805, 3);
    expect(range.maxKph).toBeCloseTo(32.187, 3);
    expect(range.incrementKph).toBeCloseTo(0.161, 3);
  });

  it("rejects a short payload", () => {
    expect(() => parseSupportedSpeedRange(bytesToDataView([0x32, 0x00]))).toThrow(/6 bytes/);
  });
});

describe("parseSupportedInclinationRange", () => {
  it("reads a signed minimum so declining treadmills work", () => {
    // -3.0 % -> -30 -> 0xFFE2.
    const range = parseSupportedInclinationRange(
      bytesToDataView([0xe2, 0xff, 0x96, 0x00, 0x05, 0x00]),
    );

    expect(range.minPercent).toBeCloseTo(-3, 6);
    expect(range.maxPercent).toBe(15);
    expect(range.incrementPercent).toBe(0.5);
  });
});

describe("parseFitnessMachineFeature", () => {
  it("decodes both bitfields", () => {
    // Machine flags 0x0000123D: average speed, total distance, inclination,
    // elevation gain, pace, expended energy and elapsed time.
    // Target flags 0x00000003: speed and inclination targets.
    const report = parseFitnessMachineFeature(
      bytesToDataView([0x3d, 0x12, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]),
    );

    expect(report.machine).toMatchObject({
      averageSpeed: true,
      totalDistance: true,
      inclination: true,
      elevationGain: true,
      pace: true,
      expendedEnergy: true,
      elapsedTime: true,
      cadence: false,
      resistanceLevel: false,
      powerMeasurement: false,
    });

    expect(report.targets).toMatchObject({
      speed: true,
      inclination: true,
      resistance: false,
      power: false,
    });
  });

  it("rejects a short payload", () => {
    expect(() => parseFitnessMachineFeature(bytesToDataView([0x00, 0x00]))).toThrow(/8 bytes/);
  });
});

describe("parseFitnessMachineStatus", () => {
  it("separates a console pause from a console stop", () => {
    expect(parseFitnessMachineStatus(bytesToDataView([0x02, 0x02])).state).toBe("paused");
    expect(parseFitnessMachineStatus(bytesToDataView([0x02, 0x01])).state).toBe("stopped");
  });

  it("assumes a stop when the parameter is missing", () => {
    expect(parseFitnessMachineStatus(bytesToDataView([0x02])).state).toBe("stopped");
  });

  it("reports the safety key and console start", () => {
    const safety = parseFitnessMachineStatus(bytesToDataView([0x03]));
    expect(safety.state).toBe("stopped");
    expect(safety.message).toMatch(/safety key/i);

    expect(parseFitnessMachineStatus(bytesToDataView([0x04])).state).toBe("running");
  });

  it("reads changed targets", () => {
    const speed = parseFitnessMachineStatus(bytesToDataView([0x05, 0xe2, 0x04]));
    expect(speed.targetSpeedKph).toBe(12.5);

    const incline = parseFitnessMachineStatus(bytesToDataView([0x06, 0xe7, 0xff]));
    expect(incline.targetInclinePercent).toBeCloseTo(-2.5, 6);
  });

  it("reads a changed target speed in the machine's unit", () => {
    const speed = parseFitnessMachineStatus(bytesToDataView([0x05, 0xe2, 0x04]), "mph");

    expect(speed.targetSpeedKph).toBeCloseTo(20.117, 3);
    expect(speed.message).toMatch(/12\.5 mph/);
  });

  it("flags a loss of control permission", () => {
    const status = parseFitnessMachineStatus(bytesToDataView([StatusOpCode.controlPermissionLost]));

    expect(status.controlLost).toBe(true);
    expect(status.message).toMatch(/revoked/i);
  });

  it("describes an unrecognised op code without throwing", () => {
    expect(parseFitnessMachineStatus(bytesToDataView([0x77])).message).toMatch(/0x77/);
  });

  it("rejects an empty payload", () => {
    expect(() => parseFitnessMachineStatus(bytesToDataView([]))).toThrow(/empty/i);
  });
});
