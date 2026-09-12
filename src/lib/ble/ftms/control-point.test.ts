import { describe, expect, it } from "vitest";
import { bytesToDataView } from "../byte-cursor";
import {
  ControlOpCode,
  ControlResultCode,
  parseControlPointResponse,
  pause,
  requestControl,
  reset,
  setTargetInclination,
  setTargetSpeed,
  startOrResume,
  stop,
} from "./control-point";
import { parseTreadmillData } from "./treadmill-data";

describe("control point commands", () => {
  it("encodes the bare op codes", () => {
    expect([...requestControl()]).toEqual([0x00]);
    expect([...reset()]).toEqual([0x01]);
    expect([...startOrResume()]).toEqual([0x07]);
  });

  it("distinguishes stop from pause by parameter", () => {
    expect([...stop()]).toEqual([0x08, 0x01]);
    expect([...pause()]).toEqual([0x08, 0x02]);
  });

  it("encodes target speed as little-endian uint16 at 0.01 km/h", () => {
    // 12.5 km/h -> 1250 -> 0x04E2.
    expect([...setTargetSpeed(12.5)]).toEqual([0x02, 0xe2, 0x04]);
    expect([...setTargetSpeed(1)]).toEqual([0x02, 0x64, 0x00]);
  });

  it("encodes target incline as little-endian sint16 at 0.1 %", () => {
    expect([...setTargetInclination(7.5)]).toEqual([0x03, 0x4b, 0x00]);
    // -2.5 % -> -25 -> 0xFFE7.
    expect([...setTargetInclination(-2.5)]).toEqual([0x03, 0xe7, 0xff]);
  });

  it("encodes target speed in the machine's unit when that unit is mph", () => {
    // The runner asks for 3.5 km/h. A machine that reads the field as mph has
    // to be sent 2.17 mph -> 217 -> 0x00D9 to put the belt at 3.5 km/h.
    expect([...setTargetSpeed(3.5, "mph")]).toEqual([0x02, 0xd9, 0x00]);

    // Sending the km/h number unconverted is the reported bug: the machine
    // reads 3.50 mph and runs the belt at 5.63 km/h.
    expect([...setTargetSpeed(3.5)]).toEqual([0x02, 0x5e, 0x01]);
  });

  it("survives a round trip through an mph machine within the 0.01 mph quantum", () => {
    for (const speedKph of [1, 3.5, 8, 12.5, 16]) {
      const raw = new DataView(setTargetSpeed(speedKph, "mph").buffer).getUint16(1, true);
      // What the machine would report back for the speed it was just given.
      const reported = parseTreadmillData(
        bytesToDataView([0x00, 0x00, raw & 0xff, raw >> 8]),
        "mph",
      );

      expect(reported.speedKph).toBeCloseTo(speedKph, 1);
    }
  });

  it("refuses values that cannot be encoded", () => {
    expect(() => setTargetSpeed(-1)).toThrow(RangeError);
    expect(() => setTargetSpeed(1000)).toThrow(RangeError);
    expect(() => setTargetInclination(5000)).toThrow(RangeError);
  });
});

describe("parseControlPointResponse", () => {
  it("reports success against the op code it answers", () => {
    const response = parseControlPointResponse(bytesToDataView([0x80, 0x02, 0x01]));

    expect(response.requestOpCode).toBe(ControlOpCode.setTargetSpeed);
    expect(response.resultCode).toBe(ControlResultCode.success);
    expect(response.succeeded).toBe(true);
    expect(response.message).toMatch(/set target speed succeeded/i);
  });

  it("explains a rejection in terms of what to do about it", () => {
    const response = parseControlPointResponse(bytesToDataView([0x80, 0x07, 0x05]));

    expect(response.succeeded).toBe(false);
    expect(response.message).toMatch(/request control first/i);
  });

  it("names an out-of-range parameter", () => {
    const response = parseControlPointResponse(bytesToDataView([0x80, 0x03, 0x03]));

    expect(response.succeeded).toBe(false);
    expect(response.message).toMatch(/out of range/i);
  });

  it("keeps trailing response parameters", () => {
    const response = parseControlPointResponse(
      bytesToDataView([0x80, 0x13, 0x01, 0x64, 0x00]),
    );

    expect([...(response.parameter ?? [])]).toEqual([0x64, 0x00]);
  });

  it("rejects a payload that is not a 0x80 response", () => {
    expect(() => parseControlPointResponse(bytesToDataView([0x01, 0x02, 0x01]))).toThrow(/0x80/);
  });

  it("rejects a truncated response", () => {
    expect(() => parseControlPointResponse(bytesToDataView([0x80, 0x02]))).toThrow(/3 bytes/);
  });
});
