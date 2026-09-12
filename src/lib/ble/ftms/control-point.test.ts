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
